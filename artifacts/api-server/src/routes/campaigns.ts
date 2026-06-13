import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import { CreateCampaignBody, UpdateCampaignBody } from "@workspace/api-zod";
import {
  createGoogleAdsCampaign,
  updateGoogleAdsCampaign,
  removeGoogleAdsCampaign,
  listGoogleAdsCampaigns,
  isGoogleAdsConfigured,
} from "../lib/google-ads";
import { logger } from "../lib/logger";

const router = Router();

function getFriendlyError(err: any): string {
  const msg = err.message || String(err);
  if (msg.includes("CUSTOMER_NOT_ENABLED") || msg.includes("not yet enabled or has been deactivated")) {
    return "A conta do Google Ads 156-990-3086 está desativada ou não foi ativada. Por favor, ative a conta no console do Google Ads para gerenciar campanhas.";
  }
  return msg;
}

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
    googleCampaignId: c.google_campaign_id ?? null,
    syncedWithGoogleAds: !!c.google_campaign_id,
    targetAges: c.target_ages ? JSON.parse(c.target_ages) : [],
    targetGenders: c.target_genders ? JSON.parse(c.target_genders) : [],
    createdAt: c.created_at,
  };
}

// GET /campaigns — merge local SQLite with Google Ads live data
router.get("/campaigns", requireAuth, async (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM campaigns ORDER BY id ASC").all() as any[];

  // If Google Ads is configured, sync status from Google Ads
  if (isGoogleAdsConfigured()) {
    try {
      const googleCampaigns = await listGoogleAdsCampaigns();
      const googleMap = new Map(googleCampaigns.map(c => [c.id, c]));

      for (const row of rows) {
        if (row.google_campaign_id) {
          const gc = googleMap.get(row.google_campaign_id);
          if (gc) {
            // Sync status and budget from Google Ads
            db.prepare("UPDATE campaigns SET status = ?, budget = ? WHERE id = ?")
              .run(gc.status, gc.budgetAmount, row.id);
            row.status = gc.status;
            row.budget = gc.budgetAmount;
          }
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "Failed to sync campaign status from Google Ads");
    }
  }

  res.json(rows.map(mapCampaign));
});

// POST /campaigns — create in both Google Ads and SQLite
router.post("/campaigns", requireAuth, async (req, res) => {
  const parse = CreateCampaignBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { name, budget, status, targetAges, targetGenders } = parse.data;
  const db = getDb();

  let googleCampaignId: string | null = null;
  let googleSynced = false;

  // Try to create in Google Ads
  if (isGoogleAdsConfigured()) {
    try {
      const gadsStatus = (status ?? "ativo") === "ativo" ? "ENABLED" : "PAUSED";
      const gCampaign = await createGoogleAdsCampaign(name, budget, gadsStatus as "ENABLED" | "PAUSED");
      if (gCampaign) {
        googleCampaignId = gCampaign.id;
        googleSynced = true;
        logger.info({ googleCampaignId, name }, "Campaign created in Google Ads");
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to create campaign in Google Ads");
      res.status(500).json({ error: `Erro ao criar campanha no Google Ads: ${getFriendlyError(err)}` });
      return;
    }
  }

  // Save to local SQLite
  const result = db.prepare(
    "INSERT INTO campaigns (name, budget, status, google_campaign_id, target_ages, target_genders) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    name,
    budget,
    status ?? "ativo",
    googleCampaignId,
    JSON.stringify(targetAges ?? []),
    JSON.stringify(targetGenders ?? [])
  );

  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(result.lastInsertRowid)) as any;
  res.status(201).json({ ...mapCampaign(row), googleSynced });
});

// GET /campaigns/:id
router.get("/campaigns/:id", requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(mapCampaign(row));
});

// PATCH /campaigns/:id — update in both Google Ads and SQLite
router.patch("/campaigns/:id", requireAuth, async (req, res) => {
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

  const { name, budget, status, targetAges, targetGenders } = parse.data;

  // Sync to Google Ads if we have a google_campaign_id
  if (isGoogleAdsConfigured() && existing.google_campaign_id) {
    try {
      await updateGoogleAdsCampaign(existing.google_campaign_id, {
        name: name ?? existing.name,
        status: status ?? existing.status,
        budget: budget ?? existing.budget,
      });
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to update campaign in Google Ads");
      res.status(500).json({ error: `Erro ao atualizar campanha no Google Ads: ${getFriendlyError(err)}` });
      return;
    }
  }

  db.prepare(
    "UPDATE campaigns SET name = ?, budget = ?, status = ?, target_ages = ?, target_genders = ? WHERE id = ?"
  ).run(
    name ?? existing.name,
    budget ?? existing.budget,
    status ?? existing.status,
    targetAges ? JSON.stringify(targetAges) : existing.target_ages,
    targetGenders ? JSON.stringify(targetGenders) : existing.target_genders,
    Number(req.params.id)
  );
  const updated = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  res.json(mapCampaign(updated));
});

// DELETE /campaigns/:id — remove from Google Ads and SQLite
router.delete("/campaigns/:id", requireAuth, async (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  // Remove from Google Ads first
  if (isGoogleAdsConfigured() && existing.google_campaign_id) {
    try {
      await removeGoogleAdsCampaign(existing.google_campaign_id);
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to remove campaign from Google Ads");
      res.status(500).json({ error: `Erro ao remover campanha no Google Ads: ${getFriendlyError(err)}` });
      return;
    }
  }

  db.prepare("DELETE FROM campaigns WHERE id = ?").run(Number(req.params.id));
  res.status(204).send();
});

export default router;
