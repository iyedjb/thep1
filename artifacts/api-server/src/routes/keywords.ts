import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import { CreateKeywordBody } from "@workspace/api-zod";
import { analyzeKeywordWithAI, generateKeywordSuggestionsWithAI } from "../lib/gemini";
import { getKeywordMetrics, getKeywordIdeas, isGoogleAdsConfigured } from "../lib/google-ads";
import { logger } from "../lib/logger";

const router = Router();

function mapKeyword(k: any) {
  return {
    id: k.id,
    keyword: k.keyword,
    searchVolume: k.search_volume,
    competition: k.competition,
    cpc: k.cpc,
    location: k.location,
    period: k.period,
    analysis: k.analysis ?? null,
    intent: k.intent ?? null,
    createdAt: k.created_at,
  };
}

router.get("/keywords", requireAuth, (req: any, res) => {
  const db = getDb();
  const search = req.query.search as string | undefined;
  const rows = search
    ? db.prepare("SELECT * FROM keywords WHERE keyword LIKE ? ORDER BY search_volume DESC").all(`%${search}%`)
    : db.prepare("SELECT * FROM keywords ORDER BY search_volume DESC").all();
  res.json((rows as any[]).map(mapKeyword));
});

// NEW: Get keyword suggestions from Google Keyword Planner (or fallback to Gemini AI)
router.get("/keywords/suggestions", requireAuth, async (req: any, res) => {
  const seed = req.query.seed as string | undefined;
  const location = (req.query.location as string) || "Brasil";

  if (!seed) {
    res.status(400).json({ error: "seed query param required" });
    return;
  }

  // If Google Ads is not configured, fall back directly to Gemini AI
  if (!isGoogleAdsConfigured()) {
    try {
      const suggestions = await generateKeywordSuggestionsWithAI(seed, location);
      res.json({ suggestions, source: "gemini-ai", message: "Google Ads não configurado. Utilizando sugestões de IA." });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to generate suggestions with AI: " + err.message });
    }
    return;
  }

  try {
    const ideas = await getKeywordIdeas(seed, location);
    res.json({ suggestions: ideas, source: "google-keyword-planner" });
  } catch (error: any) {
    // If Google Ads fails (e.g. CUSTOMER_NOT_ENABLED), fall back to Gemini AI instead of failing
    try {
      const suggestions = await generateKeywordSuggestionsWithAI(seed, location);
      res.json({
        suggestions,
        source: "gemini-ai-fallback",
        message: `Falha ao conectar ao Google Ads (${error.message || error}). Utilizando sugestões de IA.`
      });
    } catch (aiErr: any) {
      res.status(500).json({ error: "Failed to fetch suggestions: " + error.message });
    }
  }
});

router.post("/keywords", requireAuth, async (req: any, res) => {
  const parse = CreateKeywordBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const db = getDb();
  const { keyword, location } = parse.data;
  const locationStr = location ?? "Brasil";

  // Try to get real data from Google Keyword Planner
  let searchVolume: number;
  let competition: string;
  let cpc: number;
  let dataSource = "estimated";
  let realTrends: Array<{ month: string; volume: number }> | undefined;

  if (isGoogleAdsConfigured()) {
    try {
      const realMetrics = await getKeywordMetrics(keyword, locationStr);
      if (realMetrics) {
        searchVolume = realMetrics.avgMonthlySearches;
        competition = realMetrics.competition;
        cpc = realMetrics.avgCpc;
        dataSource = "google-keyword-planner";
        realTrends = realMetrics.trends;
      } else {
        // Fallback: estimated values
        searchVolume = Math.round(5000 + Math.random() * 45000);
        const competitions = ["baixa", "média", "alta"];
        competition = competitions[Math.floor(Math.random() * 3)];
        cpc = Math.round((0.5 + Math.random() * 3) * 100) / 100;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Google Ads getKeywordMetrics failed, falling back to estimated data");
      searchVolume = Math.round(5000 + Math.random() * 45000);
      const competitions = ["baixa", "média", "alta"];
      competition = competitions[Math.floor(Math.random() * 3)];
      cpc = Math.round((0.5 + Math.random() * 3) * 100) / 100;
    }
  } else {
    // Fallback: estimated values
    searchVolume = Math.round(5000 + Math.random() * 45000);
    const competitions = ["baixa", "média", "alta"];
    competition = competitions[Math.floor(Math.random() * 3)];
    cpc = Math.round((0.5 + Math.random() * 3) * 100) / 100;
  }

  const result = db.prepare(
    "INSERT INTO keywords (keyword, search_volume, competition, cpc, location, period) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(keyword, searchVolume, competition, cpc, locationStr, "12 meses");
  const kwId = Number(result.lastInsertRowid);

  if (realTrends && realTrends.length > 0) {
    // Insert real monthly trends from Google Ads
    for (const t of realTrends) {
      db.prepare("INSERT INTO keyword_trends (keyword_id, month, volume) VALUES (?, ?, ?)").run(kwId, t.month, t.volume);
    }
  } else {
    // Generate trends
    const months = ["Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai"];
    for (const month of months) {
      const vol = Math.round(searchVolume * (0.7 + Math.random() * 0.6));
      db.prepare("INSERT INTO keyword_trends (keyword_id, month, volume) VALUES (?, ?, ?)").run(kwId, month, vol);
    }
  }

  const row = db.prepare("SELECT * FROM keywords WHERE id = ?").get(kwId) as any;
  res.status(201).json({ ...mapKeyword(row), dataSource });
});

router.post("/keywords/:id/analyze", requireAuth, async (req: any, res) => {
  const db = getDb();
  const kw = db.prepare("SELECT * FROM keywords WHERE id = ?").get(Number(req.params.id)) as any;
  if (!kw) {
    res.status(404).json({ error: "Keyword not found" });
    return;
  }

  try {
    const { analysis, intent } = await analyzeKeywordWithAI(
      kw.keyword,
      kw.search_volume,
      kw.competition,
      kw.cpc,
      kw.location
    );

    db.prepare("UPDATE keywords SET analysis = ?, intent = ? WHERE id = ?").run(analysis, intent, kw.id);
    res.json({ id: kw.id, analysis, intent });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to analyze keyword: " + error.message });
  }
});

router.get("/keywords/trends", requireAuth, (req: any, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string | undefined;
  if (keyword) {
    const kw = db.prepare("SELECT id FROM keywords WHERE keyword = ?").get(keyword) as any;
    if (kw) {
      const trends = db.prepare(
        "SELECT month, volume FROM keyword_trends WHERE keyword_id = ? ORDER BY rowid ASC"
      ).all(kw.id) as Array<{ month: string; volume: number }>;
      res.json(trends);
      return;
    }
  }
  const firstKw = db.prepare("SELECT id FROM keywords LIMIT 1").get() as any;
  if (!firstKw) {
    res.json([]);
    return;
  }
  const trends = db.prepare(
    "SELECT month, volume FROM keyword_trends WHERE keyword_id = ? ORDER BY rowid ASC"
  ).all(firstKw.id) as Array<{ month: string; volume: number }>;
  res.json(trends);
});

// Real intent breakdown computed from actual keyword data in the database
router.get("/keywords/intent-breakdown", requireAuth, (_req, res) => {
  const db = getDb();
  const rows = db.prepare(
    "SELECT intent, COUNT(*) as count FROM keywords WHERE intent IS NOT NULL GROUP BY intent"
  ).all() as Array<{ intent: string; count: number }>;

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  if (total === 0) {
    res.json([
      { intent: "Transacional", percentage: 0 },
      { intent: "Comercial", percentage: 0 },
      { intent: "Informacional", percentage: 0 },
      { intent: "Navegacional", percentage: 0 },
    ]);
    return;
  }

  const validIntents = ["Transacional", "Comercial", "Informacional", "Navegacional"];
  const breakdown = validIntents.map(intent => {
    const found = rows.find(r => r.intent === intent);
    return {
      intent,
      percentage: found ? Math.round((found.count / total) * 100) : 0,
    };
  });

  res.json(breakdown);
});

export default router;
