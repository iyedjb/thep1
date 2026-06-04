import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import { CreateCampaignBody, UpdateCampaignBody } from "@workspace/api-zod";

const router = Router();

function mapCampaign(c: any) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    budget: c.budget,
    cpc: c.cpc,
    ctr: c.ctr,
    roas: c.roas,
    conversions: c.conversions,
    createdAt: c.created_at,
  };
}

router.get("/campaigns", requireAuth, (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY id ASC").all();
  res.json((rows as any[]).map(mapCampaign));
});

router.post("/campaigns", requireAuth, (req, res) => {
  const parse = CreateCampaignBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { name, budget, status } = parse.data;
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO campaigns (name, budget, status) VALUES (?, ?, ?)"
  ).run(name, budget, status ?? "ativo");
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(result.lastInsertRowid)) as any;
  res.status(201).json(mapCampaign(row));
});

router.get("/campaigns/:id", requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(mapCampaign(row));
});

router.patch("/campaigns/:id", requireAuth, (req, res) => {
  const parse = UpdateCampaignBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const db = getDb();
  const existing = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const { name, budget, status } = parse.data;
  db.prepare("UPDATE campaigns SET name = ?, budget = ?, status = ? WHERE id = ?").run(
    name ?? existing.name,
    budget ?? existing.budget,
    status ?? existing.status,
    Number(req.params.id)
  );
  const updated = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  res.json(mapCampaign(updated));
});

router.delete("/campaigns/:id", requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(Number(req.params.id));
  res.status(204).send();
});

export default router;
