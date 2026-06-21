import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import {
  getPerformanceSummary,
  getDailyPerformance,
  getConversionsByCampaign,
  isGoogleAdsConfigured,
} from "../lib/google-ads";
import { logger } from "../lib/logger";

const router = Router();

router.get("/status/google-ads", requireAuth, async (req: any, res): Promise<void> => {
  const configured = isGoogleAdsConfigured();
  if (!configured) {
    res.json({
      configured: false,
      status: "not_configured",
      customerId: process.env["GOOGLE_ADS_CUSTOMER_ID"] || null,
      error: "Credenciais do Google Ads não encontradas no arquivo .env"
    });
    return;
  }

  try {
    // Attempt a lightweight query to verify connectivity
    await getPerformanceSummary(1);
    res.json({
      configured: true,
      status: "connected",
      customerId: process.env["GOOGLE_ADS_CUSTOMER_ID"],
      error: null
    });
  } catch (err: any) {
    res.json({
      configured: true,
      status: "error",
      customerId: process.env["GOOGLE_ADS_CUSTOMER_ID"],
      error: err.message || String(err)
    });
  }
});

router.get("/dashboard/summary", requireAuth, async (req: any, res): Promise<void> => {
  const db = getDb();
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;

  // ── Try Google Ads first ─────────────────────────────────────────────────
  if (isGoogleAdsConfigured()) {
    try {
      const gSummary = await getPerformanceSummary(days);
      if (gSummary) {
        // Real ROAS from Google Ads (conversions_value / cost)
        const roas =
          gSummary.cost > 0 ? gSummary.conversionsValue / gSummary.cost : 0;

        // Previous period for comparison (same window before current)
        const prevSummary = await getPerformanceSummary(days * 2);
        const prevCost = (prevSummary?.cost ?? 0) - gSummary.cost;
        const prevClicks = (prevSummary?.clicks ?? 0) - gSummary.clicks;
        const prevConversions = (prevSummary?.conversions ?? 0) - gSummary.conversions;

        const prevCpc = prevClicks > 0 ? prevCost / prevClicks : 0;
        const prevCpa =
          prevConversions > 0 ? prevCost / prevConversions : 0;
        const prevCtr =
          prevClicks > 0 ? (prevConversions / prevClicks) * 100 : 0;

        const pct = (cur: number, prev: number) =>
          prev === 0 ? 0 : Math.round(((cur - prev) / prev) * 1000) / 10;

        res.json({
          cpcAvg: Math.round(gSummary.averageCpc * 100) / 100,
          cpa:
            gSummary.conversions > 0
              ? Math.round((gSummary.cost / gSummary.conversions) * 100) / 100
              : 0,
          ctr: Math.round(gSummary.ctr * 100) / 100,
          roas: Math.round(roas * 100) / 100,
          conversions: gSummary.conversions,
          totalCost: Math.round(gSummary.cost * 100) / 100,
          cpcChange: pct(gSummary.averageCpc, prevCpc),
          cpaChange: pct(
            gSummary.conversions > 0 ? gSummary.cost / gSummary.conversions : 0,
            prevCpa
          ),
          ctrChange: pct(gSummary.ctr, prevCtr),
          roasChange: 0,
          source: "google-ads",
        });
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Google Ads dashboard summary failed, falling back to database");
    }
  }

  try {
    // ── Fallback: Database local data ──────────────────────────────────────────
    const now = new Date();
    const currentCutoff = new Date(now);
    currentCutoff.setDate(currentCutoff.getDate() - days);
    const currentCutoffStr = currentCutoff.toISOString().split("T")[0];

    const previousCutoff = new Date(currentCutoff);
    previousCutoff.setDate(previousCutoff.getDate() - days);
    const previousCutoffStr = previousCutoff.toISOString().split("T")[0];

    const currentRows = await db.prepare(
      "SELECT clicks, conversions, cost FROM performance_data WHERE date >= ?"
    ).all(currentCutoffStr) as Array<{ clicks: number; conversions: number; cost: number }>;

    const previousRows = await db.prepare(
      "SELECT clicks, conversions, cost FROM performance_data WHERE date >= ? AND date < ?"
    ).all(previousCutoffStr, currentCutoffStr) as Array<{ clicks: number; conversions: number; cost: number }>;

    const totalClicks = currentRows.reduce((s, r) => s + r.clicks, 0);
    const totalConversions = currentRows.reduce((s, r) => s + r.conversions, 0);
    const totalCost = currentRows.reduce((s, r) => s + r.cost, 0);

    const cpcAvg = totalClicks > 0 ? totalCost / totalClicks : 0;
    const cpa = totalConversions > 0 ? totalCost / totalConversions : 0;
    const ctr = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

    const campaigns = await db.prepare("SELECT budget, roas FROM campaigns WHERE status = 'ativo'").all() as any[];
    const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0);
    const weightedRoas =
      totalBudget > 0
        ? campaigns.reduce((s, c) => s + c.roas * (c.budget / totalBudget), 0)
        : 0;

    const prevClicks = previousRows.reduce((s, r) => s + r.clicks, 0);
    const prevConversions = previousRows.reduce((s, r) => s + r.conversions, 0);
    const prevCost = previousRows.reduce((s, r) => s + r.cost, 0);
    const prevCpc = prevClicks > 0 ? prevCost / prevClicks : 0;
    const prevCpa = prevConversions > 0 ? prevCost / prevConversions : 0;
    const prevCtr = prevClicks > 0 ? (prevConversions / prevClicks) * 100 : 0;

    const pct = (cur: number, prev: number) =>
      prev === 0 ? 0 : Math.round(((cur - prev) / prev) * 1000) / 10;

    res.json({
      cpcAvg: Math.round(cpcAvg * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      roas: Math.round(weightedRoas * 100) / 100,
      conversions: totalConversions,
      totalCost: Math.round(totalCost * 100) / 100,
      cpcChange: pct(cpcAvg, prevCpc),
      cpaChange: pct(cpa, prevCpa),
      ctrChange: pct(ctr, prevCtr),
      roasChange: pct(weightedRoas, weightedRoas),
      source: "postgres",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao obter resumo do dashboard: " + err.message });
  }
});

router.get("/dashboard/performance", requireAuth, async (req: any, res): Promise<void> => {
  const db = getDb();
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;

  // Try Google Ads first
  if (isGoogleAdsConfigured()) {
    try {
      const gData = await getDailyPerformance(days);
      if (gData.length > 0) {
        res.json(gData);
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Google Ads performance failed, falling back to database");
    }
  }

  try {
    // Fallback: Database
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const rows = await db.prepare(
      "SELECT date, clicks, conversions, cost FROM performance_data WHERE date >= ? ORDER BY date ASC"
    ).all(cutoffStr) as Array<{ date: string; clicks: number; conversions: number; cost: number }>;

    res.json(rows.map(r => ({ ...r, cost: Math.round(r.cost * 100) / 100 })));
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao obter desempenho diário: " + err.message });
  }
});

router.get("/dashboard/conversions-by-campaign", requireAuth, async (_req, res): Promise<void> => {
  const db = getDb();

  // Try Google Ads first
  if (isGoogleAdsConfigured()) {
    try {
      const gData = await getConversionsByCampaign();
      if (gData.length > 0) {
        const total = gData.reduce((s, c) => s + c.conversions, 0);
        res.json(gData.map(c => ({
          name: c.campaignName,
          value: c.conversions,
          percentage: total > 0 ? Math.round((c.conversions / total) * 10000) / 100 : 0,
        })));
        return;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Google Ads conversions failed, falling back to database");
    }
  }

  try {
    // Fallback: Database
    const campaigns = await db.prepare(
      "SELECT name, conversions FROM campaigns ORDER BY conversions DESC"
    ).all() as Array<{ name: string; conversions: number }>;

    const total = campaigns.reduce((s, c) => s + c.conversions, 0);
    res.json(campaigns.map(c => ({
      name: c.name,
      value: c.conversions,
      percentage: total > 0 ? Math.round((c.conversions / total) * 10000) / 100 : 0,
    })));
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao obter conversões por campanha: " + err.message });
  }
});

export default router;
