import { Router } from "express";
import { requireAuth } from "./auth";
import {
  getPerformanceSummary,
  getDailyPerformance,
  getConversionsByCampaign,
} from "../lib/google-ads";
import { logger } from "../lib/logger";
import { getGoogleAdsConnection } from "../lib/google-ads-connections";

const router = Router();

router.get("/status/google-ads", requireAuth, async (req: any, res): Promise<void> => {
  const connection = await getGoogleAdsConnection(req.userId);
  if (!connection) {
    res.json({
      configured: false,
      status: "not_configured",
      customerId: null,
      accounts: [],
      error: "Google Ads ainda não está conectado",
    });
    return;
  }

  if (!connection.customerId) {
    res.json({
      configured: true,
      status: "needs_account",
      customerId: null,
      accounts: connection.accessibleCustomerIds,
      error: null,
    });
    return;
  }

  res.json({
    configured: true,
    status: "connected",
    customerId: connection.customerId,
    accounts: connection.accessibleCustomerIds,
    error: null,
  });
});

router.get("/dashboard/summary", requireAuth, async (req: any, res): Promise<void> => {
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;
  const connection = await getGoogleAdsConnection(req.userId);
  if (!connection?.customerId) {
    res.status(409).json({ error: "Google Ads ainda não está conectado" });
    return;
  }

  try {
    const credentials = toCredentials(connection);
    const summary = await getPerformanceSummary(days, credentials);
    if (!summary) {
      res.json(emptySummary());
      return;
    }

    const roas = summary.cost > 0 ? summary.conversionsValue / summary.cost : 0;
    const previousWindow = await getPerformanceSummary(days * 2, credentials);
    const previousCost = (previousWindow?.cost ?? 0) - summary.cost;
    const previousClicks = (previousWindow?.clicks ?? 0) - summary.clicks;
    const previousConversions = (previousWindow?.conversions ?? 0) - summary.conversions;
    const previousCpc = previousClicks > 0 ? previousCost / previousClicks : 0;
    const previousCpa = previousConversions > 0 ? previousCost / previousConversions : 0;
    const previousCtr = previousClicks > 0 ? (previousConversions / previousClicks) * 100 : 0;
    const percentChange = (current: number, previous: number) =>
      previous === 0 ? 0 : Math.round(((current - previous) / previous) * 1000) / 10;

    res.json({
      cpcAvg: Math.round(summary.averageCpc * 100) / 100,
      cpa: summary.conversions > 0 ? Math.round((summary.cost / summary.conversions) * 100) / 100 : 0,
      ctr: Math.round(summary.ctr * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      conversions: summary.conversions,
      totalCost: Math.round(summary.cost * 100) / 100,
      cpcChange: percentChange(summary.averageCpc, previousCpc),
      cpaChange: percentChange(summary.conversions > 0 ? summary.cost / summary.conversions : 0, previousCpa),
      ctrChange: percentChange(summary.ctr, previousCtr),
      roasChange: 0,
      source: "google-ads",
    });
  } catch (error: any) {
    logger.warn({ error: error.message }, "Google Ads dashboard summary failed");
    res.status(502).json({ error: "Não foi possível carregar os dados do Google Ads" });
  }
});

router.get("/dashboard/performance", requireAuth, async (req: any, res): Promise<void> => {
  const days = parseInt((req.query.days as string) ?? "30", 10) || 30;
  const connection = await getGoogleAdsConnection(req.userId);
  if (!connection?.customerId) {
    res.status(409).json({ error: "Google Ads ainda não está conectado" });
    return;
  }

  try {
    res.json(await getDailyPerformance(days, toCredentials(connection)));
  } catch (error: any) {
    logger.warn({ error: error.message }, "Google Ads performance failed");
    res.status(502).json({ error: "Não foi possível carregar o desempenho do Google Ads" });
  }
});

router.get("/dashboard/conversions-by-campaign", requireAuth, async (req: any, res): Promise<void> => {
  const connection = await getGoogleAdsConnection(req.userId);
  if (!connection?.customerId) {
    res.status(409).json({ error: "Google Ads ainda não está conectado" });
    return;
  }

  try {
    const campaigns = await getConversionsByCampaign(toCredentials(connection));
    const total = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0);
    res.json(campaigns.map((campaign) => ({
      name: campaign.campaignName,
      value: campaign.conversions,
      percentage: total > 0 ? Math.round((campaign.conversions / total) * 10000) / 100 : 0,
    })));
  } catch (error: any) {
    logger.warn({ error: error.message }, "Google Ads conversions failed");
    res.status(502).json({ error: "Não foi possível carregar as conversões do Google Ads" });
  }
});

function emptySummary() {
  return {
    cpcAvg: 0,
    cpa: 0,
    ctr: 0,
    roas: 0,
    conversions: 0,
    totalCost: 0,
    cpcChange: 0,
    cpaChange: 0,
    ctrChange: 0,
    roasChange: 0,
    source: "google-ads",
  };
}

function toCredentials(connection: NonNullable<Awaited<ReturnType<typeof getGoogleAdsConnection>>>) {
  return {
    refreshToken: connection.refreshToken,
    customerId: connection.customerId!,
    loginCustomerId: connection.loginCustomerId,
  };
}

export default router;
