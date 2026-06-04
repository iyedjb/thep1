import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";

const router = Router();

router.get("/dashboard/summary", requireAuth, (req: any, res) => {
  const db = getDb();
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const rows = db.prepare(
    "SELECT clicks, conversions, cost FROM performance_data WHERE date >= ?"
  ).all(cutoffStr) as Array<{ clicks: number; conversions: number; cost: number }>;

  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalConversions = rows.reduce((s, r) => s + r.conversions, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  const cpcAvg = totalClicks > 0 ? totalCost / totalClicks : 0;
  const cpa = totalConversions > 0 ? totalCost / totalConversions : 0;
  const ctr = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;
  const revenue = totalCost * 5.2;
  const roas = totalCost > 0 ? revenue / totalCost : 0;

  res.json({
    cpcAvg: Math.round(cpcAvg * 100) / 100,
    cpa: Math.round(cpa * 100) / 100,
    ctr: Math.round(ctr * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    conversions: totalConversions,
    totalCost: Math.round(totalCost * 100) / 100,
    cpcChange: 8.3,
    cpaChange: 12.4,
    ctrChange: 3.2,
    roasChange: 15.7,
  });
});

router.get("/dashboard/performance", requireAuth, (req: any, res) => {
  const db = getDb();
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const rows = db.prepare(
    "SELECT date, clicks, conversions, cost FROM performance_data WHERE date >= ? ORDER BY date ASC"
  ).all(cutoffStr) as Array<{ date: string; clicks: number; conversions: number; cost: number }>;

  res.json(
    rows.map((r) => ({
      date: r.date,
      clicks: r.clicks,
      conversions: r.conversions,
      cost: Math.round(r.cost * 100) / 100,
    }))
  );
});

router.get("/dashboard/conversions-by-campaign", requireAuth, (_req, res) => {
  const db = getDb();
  const campaigns = db.prepare(
    "SELECT name, conversions FROM campaigns ORDER BY conversions DESC"
  ).all() as Array<{ name: string; conversions: number }>;

  const total = campaigns.reduce((s, c) => s + c.conversions, 0);
  res.json(
    campaigns.map((c) => ({
      name: c.name,
      value: c.conversions,
      percentage: total > 0 ? Math.round((c.conversions / total) * 10000) / 100 : 0,
    }))
  );
});

export default router;
