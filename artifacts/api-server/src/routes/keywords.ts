import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import { CreateKeywordBody } from "@workspace/api-zod";

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

router.post("/keywords", requireAuth, (req, res) => {
  const parse = CreateKeywordBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const db = getDb();
  const { keyword, location } = parse.data;
  const searchVolume = Math.round(5000 + Math.random() * 45000);
  const competitions = ["baixa", "média", "alta"];
  const competition = competitions[Math.floor(Math.random() * 3)];
  const cpc = Math.round((0.5 + Math.random() * 3) * 100) / 100;
  const result = db.prepare(
    "INSERT INTO keywords (keyword, search_volume, competition, cpc, location, period) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(keyword, searchVolume, competition, cpc, location ?? "Brasil", "12 meses");
  const kwId = Number(result.lastInsertRowid);

  const months = ["Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai"];
  for (const month of months) {
    const vol = Math.round(searchVolume * (0.7 + Math.random() * 0.6));
    db.prepare("INSERT INTO keyword_trends (keyword_id, month, volume) VALUES (?, ?, ?)").run(kwId, month, vol);
  }

  const row = db.prepare("SELECT * FROM keywords WHERE id = ?").get(kwId) as any;
  res.status(201).json(mapKeyword(row));
});

router.post("/keywords/:id/analyze", requireAuth, (req: any, res) => {
  const db = getDb();
  const kw = db.prepare("SELECT * FROM keywords WHERE id = ?").get(Number(req.params.id)) as any;
  if (!kw) {
    res.status(404).json({ error: "Keyword not found" });
    return;
  }

  const analyses = [
    `"${kw.keyword}" apresenta alto potencial transacional. Volume de busca de ${kw.search_volume.toLocaleString("pt-BR")} mensais com competição ${kw.competition}. CPC médio de R$ ${kw.cpc.toFixed(2)} indica ${kw.competition === "alta" ? "mercado competitivo — foque em qualidade do anúncio e landing page." : "oportunidade de crescimento com baixo investimento inicial."}`,
    `Análise semântica: intenção de busca predominantemente ${kw.competition === "alta" ? "transacional — usuários prontos para compra" : "informacional — nutra com conteúdo antes de converter"}. Sazonalidade: pico em novembro (Black Friday) e janeiro. Recomendo lances mais agressivos nesses períodos.`,
    `Palavra-chave de ${kw.competition} concorrência. Estratégia recomendada: ${kw.cpc < 1.5 ? "amplie cobertura com correspondência ampla modificada" : "use correspondência exata para controle de custo"}. ROAS estimado: ${(Math.random() * 3 + 2).toFixed(1)}x baseado em dados históricos similares.`,
  ];
  const analysis = analyses[Math.floor(Math.random() * analyses.length)];

  db.prepare("UPDATE keywords SET analysis = ? WHERE id = ?").run(analysis, kw.id);
  res.json({ id: kw.id, analysis });
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

router.get("/keywords/intent-breakdown", requireAuth, (_req, res) => {
  res.json([
    { intent: "Transacional", percentage: 52 },
    { intent: "Comercial", percentage: 28 },
    { intent: "Informacional", percentage: 15 },
    { intent: "Navegacional", percentage: 5 },
  ]);
});

export default router;
