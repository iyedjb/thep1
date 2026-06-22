import { Router } from "express";
import { getDb } from "../lib/sqlite";
import { requireAuth } from "./auth";
import { CreateCampaignBody, UpdateCampaignBody } from "@workspace/api-zod";
import {
  createGoogleAdsCampaign,
  updateGoogleAdsCampaign,
  removeGoogleAdsCampaign,
  listGoogleAdsCampaigns,
} from "../lib/google-ads";
import { logger } from "../lib/logger";
import { getGoogleAdsConnection } from "../lib/google-ads-connections";

const router = Router();

function getFriendlyError(err: any): string {
  const msg = err.message || String(err);
  if (msg.includes("CUSTOMER_NOT_ENABLED") || msg.includes("not yet enabled or has been deactivated")) {
    return "A conta selecionada está desativada ou ainda não foi habilitada no Google Ads.";
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
    targetLocations: c.target_locations ? JSON.parse(c.target_locations) : [],
    targetLanguages: c.target_languages ? JSON.parse(c.target_languages) : [],
    biddingStrategy: c.bidding_strategy ?? null,
    adNetworks: c.ad_networks ? JSON.parse(c.ad_networks) : [],
    startDate: c.start_date ?? null,
    endDate: c.end_date ?? null,
    createdAt: c.created_at,
  };
}

// GET /campaigns — merge local SQLite with Google Ads live data
router.get("/campaigns", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    const connection = await requireConnection(req.userId);
    const googleCampaigns = await listGoogleAdsCampaigns(connection);
    for (const campaign of googleCampaigns) {
      const existing = await db.prepare(
        "SELECT id FROM campaigns WHERE user_id = ? AND google_campaign_id = ?",
      ).get(req.userId, campaign.id) as any;
      if (existing) {
        await db.prepare("UPDATE campaigns SET name = ?, status = ?, budget = ? WHERE id = ?")
          .run(campaign.name, campaign.status, campaign.budgetAmount, existing.id);
      } else {
        await db.prepare(`
          INSERT INTO campaigns (user_id, name, status, budget, google_campaign_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(req.userId, campaign.name, campaign.status, campaign.budgetAmount, campaign.id);
      }
    }
    const rows = await db.prepare("SELECT * FROM campaigns WHERE user_id = ? ORDER BY id ASC").all(req.userId) as any[];
    res.json(rows.map(mapCampaign));
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar campanhas: " + err.message });
  }
});

// POST /campaigns — create in both Google Ads and SQLite
router.post("/campaigns", requireAuth, async (req, res) => {
  const parse = CreateCampaignBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const {
    name,
    budget,
    status,
    targetAges,
    targetGenders,
    targetLocations,
    targetLanguages,
    biddingStrategy,
    adNetworks,
    startDate,
    endDate,
    websiteUrl,
    adGroupName,
    keywords,
    keywordMatchType,
    headlines,
    descriptions,
    path1,
    path2,
  } = parse.data;
  const db = getDb();
  const connection = await requireConnection((req as any).userId);

  let googleCampaignId: string | null = null;
  let googleSynced = false;

  // Try to create in Google Ads
  try {
    const gadsStatus = (status ?? "ativo") === "ativo" ? "ENABLED" : "PAUSED";
    const gCampaign = await createGoogleAdsCampaign(
      name,
      budget,
      gadsStatus as "ENABLED" | "PAUSED",
      {
        targetLocations,
        targetLanguages,
        biddingStrategy,
        adNetworks,
        startDate,
        endDate,
        websiteUrl,
        adGroupName,
        keywords,
        keywordMatchType,
        headlines,
        descriptions,
        path1,
        path2,
      },
      connection
    );
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

  try {
    // Save to local SQLite
    const result = await db.prepare(
      `INSERT INTO campaigns (
        user_id, name, budget, status, google_campaign_id, 
        target_ages, target_genders, target_locations, target_languages, 
        bidding_strategy, ad_networks, start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      (req as any).userId,
      name,
      budget,
      status ?? "ativo",
      googleCampaignId,
      JSON.stringify(targetAges ?? []),
      JSON.stringify(targetGenders ?? []),
      JSON.stringify(targetLocations ?? []),
      JSON.stringify(targetLanguages ?? []),
      biddingStrategy ?? null,
      JSON.stringify(adNetworks ?? []),
      startDate ?? null,
      endDate ?? null
    );

    const row = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(result.lastInsertRowid)) as any;
    res.status(201).json({ ...mapCampaign(row), googleSynced });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao salvar campanha localmente: " + err.message });
  }
});

// GET /campaigns/:id
router.get("/campaigns/:id", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    const row = await db.prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.userId) as any;
    if (!row) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(mapCampaign(row));
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar detalhes da campanha: " + err.message });
  }
});

// PATCH /campaigns/:id — update in both Google Ads and SQLite
router.patch("/campaigns/:id", requireAuth, async (req: any, res) => {
  const parse = UpdateCampaignBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const db = getDb();
  try {
    const existing = await db.prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.userId) as any;
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const {
      name,
      budget,
      status,
      targetAges,
      targetGenders,
      targetLocations,
      targetLanguages,
      biddingStrategy,
      adNetworks,
      startDate,
      endDate,
    } = parse.data;

    // Sync to Google Ads if we have a google_campaign_id
    if (existing.google_campaign_id) {
      try {
        const connection = await requireConnection(req.userId);
        await updateGoogleAdsCampaign(existing.google_campaign_id, {
          name: name ?? existing.name,
          status: status ?? existing.status,
          budget: budget ?? existing.budget,
          biddingStrategy: biddingStrategy,
          adNetworks: adNetworks,
          startDate: startDate,
          endDate: endDate,
        }, connection);
      } catch (err: any) {
        logger.error({ err: err.message }, "Failed to update campaign in Google Ads");
        res.status(500).json({ error: `Erro ao atualizar campanha no Google Ads: ${getFriendlyError(err)}` });
        return;
      }
    }

    await db.prepare(
      `UPDATE campaigns SET 
        name = ?, 
        budget = ?, 
        status = ?, 
        target_ages = ?, 
        target_genders = ?, 
        target_locations = ?, 
        target_languages = ?, 
        bidding_strategy = ?, 
        ad_networks = ?, 
        start_date = ?, 
        end_date = ? 
      WHERE id = ?`
    ).run(
      name ?? existing.name,
      budget ?? existing.budget,
      status ?? existing.status,
      targetAges ? JSON.stringify(targetAges) : existing.target_ages,
      targetGenders ? JSON.stringify(targetGenders) : existing.target_genders,
      targetLocations ? JSON.stringify(targetLocations) : existing.target_locations,
      targetLanguages ? JSON.stringify(targetLanguages) : existing.target_languages,
      biddingStrategy !== undefined ? biddingStrategy : existing.bidding_strategy,
      adNetworks ? JSON.stringify(adNetworks) : existing.ad_networks,
      startDate !== undefined ? startDate : existing.start_date,
      endDate !== undefined ? endDate : existing.end_date,
      Number(req.params.id)
    );
    const updated = await db.prepare("SELECT * FROM campaigns WHERE id = ?").get(Number(req.params.id)) as any;
    res.json(mapCampaign(updated));
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao atualizar campanha localmente: " + err.message });
  }
});

// DELETE /campaigns/:id — remove from Google Ads and SQLite
router.delete("/campaigns/:id", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    const existing = await db.prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.userId) as any;
    if (!existing) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Remove from Google Ads first
    if (existing.google_campaign_id) {
      try {
        const connection = await requireConnection(req.userId);
        await removeGoogleAdsCampaign(existing.google_campaign_id, connection);
      } catch (err: any) {
        logger.error({ err: err.message }, "Failed to remove campaign from Google Ads");
        res.status(500).json({ error: `Erro ao remover campanha no Google Ads: ${getFriendlyError(err)}` });
        return;
      }
    }

    await db.prepare("DELETE FROM campaigns WHERE id = ?").run(Number(req.params.id));
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao remover campanha localmente: " + err.message });
  }
});

export default router;

async function requireConnection(userId: number) {
  const connection = await getGoogleAdsConnection(userId);
  if (!connection?.customerId) throw new Error("Google Ads ainda não está conectado");
  return {
    refreshToken: connection.refreshToken,
    customerId: connection.customerId,
    loginCustomerId: connection.loginCustomerId,
  };
}
