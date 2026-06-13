import { GoogleAdsApi, enums } from "google-ads-api";
import { logger } from "./logger";

let _client: GoogleAdsApi | null = null;
let _customerId: string | null = null;
let _loginCustomerId: string | null = null;

/**
 * Check if Google Ads credentials are configured
 */
export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env["GOOGLE_ADS_CLIENT_ID"] &&
    process.env["GOOGLE_ADS_CLIENT_SECRET"] &&
    process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] &&
    process.env["GOOGLE_ADS_REFRESH_TOKEN"] &&
    process.env["GOOGLE_ADS_CUSTOMER_ID"]
  );
}

/**
 * Get or create the Google Ads API client
 */
function getClient(): GoogleAdsApi | null {
  if (_client) return _client;

  if (!isGoogleAdsConfigured()) {
    logger.warn("Google Ads credentials not configured — using local fallback data");
    return null;
  }

  _client = new GoogleAdsApi({
    client_id: process.env["GOOGLE_ADS_CLIENT_ID"]!,
    client_secret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
    developer_token: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
  });

  _customerId = process.env["GOOGLE_ADS_CUSTOMER_ID"]!.replace(/-/g, "");
  _loginCustomerId = process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]?.replace(/-/g, "") || _customerId;

  return _client;
}

function getCustomer() {
  const client = getClient();
  if (!client || !_customerId) return null;

  return client.Customer({
    customer_id: _customerId,
    login_customer_id: _loginCustomerId || _customerId,
    refresh_token: process.env["GOOGLE_ADS_REFRESH_TOKEN"]!,
  });
}

// ============================================================================
// Keyword Planner
// ============================================================================

export interface KeywordIdea {
  keyword: string;
  avgMonthlySearches: number;
  competition: string;
  competitionIndex: number;
  lowCpc: number;
  highCpc: number;
  avgCpc: number;
  text?: string;
  cpc?: number;
  trends?: Array<{ month: string; volume: number }>;
}

/**
 * Get keyword ideas and real metrics from Google Keyword Planner
 */
export async function getKeywordIdeas(
  seedKeyword: string,
  location: string = "Brasil"
): Promise<KeywordIdea[]> {
  const customer = getCustomer();
  if (!customer) return [];

  try {
    // Location IDs: Brazil = 2076, São Paulo = 20106, Rio de Janeiro = 20109
    const locationId = getLocationId(location);

    const results = await customer.query(`
      SELECT
        keyword_plan_metrics.avg_monthly_searches,
        keyword_plan_metrics.competition,
        keyword_plan_metrics.competition_index,
        keyword_plan_metrics.low_top_of_page_bid_micros,
        keyword_plan_metrics.high_top_of_page_bid_micros
      FROM keyword_plan_idea
      WHERE keyword_plan_idea.keyword.text = '${seedKeyword}'
      AND keyword_plan_idea.geo_target_constants = 'geoTargetConstants/${locationId}'
      AND keyword_plan_idea.language = 'languageConstants/1014'
    `);

    // Note: The query syntax above is simplified. The actual Keyword Planner API
    // uses a different method. Let's use the service directly:
    return await fetchKeywordIdeasViaService(customer, seedKeyword, locationId);
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch keyword ideas from Google Ads");
    throw error;
  }
}

async function fetchKeywordIdeasViaService(
  customer: any,
  seedKeyword: string,
  locationId: string
): Promise<KeywordIdea[]> {
  try {
    const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: _customerId!,
      language: `languageConstants/1014`, // Portuguese
      geo_target_constants: [`geoTargetConstants/${locationId}`],
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_seed: {
        keywords: [seedKeyword],
      },
    });

    return (response || []).map((idea: any) => {
      const metrics = idea.keyword_idea_metrics || {};
      const avgSearches = Number(metrics.avg_monthly_searches || 0);
      const competitionEnum = metrics.competition;
      const lowBid = Number(metrics.low_top_of_page_bid_micros || 0) / 1_000_000;
      const highBid = Number(metrics.high_top_of_page_bid_micros || 0) / 1_000_000;
      const avgCpc = Math.round(((lowBid + highBid) / 2) * 100) / 100;

      // Extract trends from monthly_search_volumes
      const monthlySearchVolumes = metrics.monthly_search_volumes || [];
      const trends = monthlySearchVolumes.map((m: any) => ({
        month: mapMonthNumber(m.month),
        volume: Number(m.monthly_searches || 0),
      }));

      return {
        keyword: idea.text || seedKeyword,
        avgMonthlySearches: avgSearches,
        competition: mapCompetition(competitionEnum),
        competitionIndex: Number(metrics.competition_index || 0),
        lowCpc: Math.round(lowBid * 100) / 100,
        highCpc: Math.round(highBid * 100) / 100,
        avgCpc,
        text: idea.text || seedKeyword,
        cpc: avgCpc,
        trends,
      };
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "KeywordPlanIdeaService call failed");
    throw error;
  }
}

/**
 * Get real metrics for a single keyword
 */
export async function getKeywordMetrics(
  keyword: string,
  location: string = "Brasil"
): Promise<KeywordIdea | null> {
  const ideas = await getKeywordIdeas(keyword, location);
  // Find the exact match
  const exact = ideas.find(
    (i) => i.keyword.toLowerCase() === keyword.toLowerCase()
  );
  return exact || ideas[0] || null;
}

// ============================================================================
// Campaign Management
// ============================================================================

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: string;
  budgetAmountMicros: number;
  budgetAmount: number;
}

/**
 * Create a Search campaign in Google Ads
 */
export async function createGoogleAdsCampaign(
  name: string,
  dailyBudgetBrl: number,
  status: "ENABLED" | "PAUSED" = "ENABLED"
): Promise<GoogleAdsCampaign | null> {
  const customer = getCustomer();
  if (!customer) return null;

  try {
    const budgetMicros = Math.round(dailyBudgetBrl * 1_000_000);

    // Create campaign budget first
    const budgetResult = await customer.campaignBudgets.create([
      {
        name: `Budget - ${name} - ${Date.now()}`,
        amount_micros: budgetMicros,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
      },
    ]);

    const budgetResourceName = budgetResult.results[0]?.resource_name;
    if (!budgetResourceName) {
      throw new Error("Failed to create campaign budget");
    }

    // Create the campaign
    const campaignResult = await customer.campaigns.create([
      {
        name,
        status: status === "ENABLED" ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        campaign_budget: budgetResourceName,
        manual_cpc: {
          enhanced_cpc_enabled: true,
        },
      },
    ]);

    const campaignResourceName = campaignResult.results[0]?.resource_name;
    const campaignId = campaignResourceName?.split("/").pop() || "";

    logger.info({ campaignId, name }, "Campaign created in Google Ads");

    return {
      id: campaignId,
      name,
      status,
      budgetAmountMicros: budgetMicros,
      budgetAmount: dailyBudgetBrl,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to create Google Ads campaign");
    throw error;
  }
}

/**
 * Update a campaign in Google Ads
 */
export async function updateGoogleAdsCampaign(
  googleCampaignId: string,
  updates: { name?: string; status?: string; budget?: number }
): Promise<boolean> {
  const customer = getCustomer();
  if (!customer) return false;

  try {
    const campaignUpdate: any = {
      resource_name: `customers/${_customerId}/campaigns/${googleCampaignId}`,
    };

    if (updates.name) campaignUpdate.name = updates.name;
    if (updates.status) {
      campaignUpdate.status =
        updates.status === "ativo"
          ? enums.CampaignStatus.ENABLED
          : enums.CampaignStatus.PAUSED;
    }

    await customer.campaigns.update([campaignUpdate]);
    logger.info({ googleCampaignId }, "Campaign updated in Google Ads");
    return true;
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to update Google Ads campaign");
    throw error;
  }
}

/**
 * Remove (set to REMOVED) a campaign in Google Ads
 */
export async function removeGoogleAdsCampaign(googleCampaignId: string): Promise<boolean> {
  const customer = getCustomer();
  if (!customer) return false;

  try {
    await customer.campaigns.update([
      {
        resource_name: `customers/${_customerId}/campaigns/${googleCampaignId}`,
        status: enums.CampaignStatus.REMOVED,
      },
    ]);
    logger.info({ googleCampaignId }, "Campaign removed in Google Ads");
    return true;
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to remove Google Ads campaign");
    throw error;
  }
}

/**
 * Fetch all campaigns from Google Ads
 */
export async function listGoogleAdsCampaigns(): Promise<GoogleAdsCampaign[]> {
  const customer = getCustomer();
  if (!customer) return [];

  try {
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `);

    return (campaigns || []).map((row: any) => ({
      id: String(row.campaign?.id || ""),
      name: row.campaign?.name || "",
      status: mapCampaignStatus(row.campaign?.status),
      budgetAmountMicros: Number(row.campaign_budget?.amount_micros || 0),
      budgetAmount: Number(row.campaign_budget?.amount_micros || 0) / 1_000_000,
    }));
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to list Google Ads campaigns");
    throw error;
  }
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetrics {
  clicks: number;
  conversions: number;
  costMicros: number;
  cost: number;
  ctr: number;
  averageCpc: number;
  conversionsValue: number;
}

export interface DailyPerformance {
  date: string;
  clicks: number;
  conversions: number;
  cost: number;
}

export interface CampaignPerformance {
  campaignName: string;
  conversions: number;
  cost: number;
  clicks: number;
}

/**
 * Get aggregate performance metrics for a date range
 */
export async function getPerformanceSummary(
  days: number = 30
): Promise<PerformanceMetrics | null> {
  const customer = getCustomer();
  if (!customer) return null;

  const dateRange = days <= 7 ? "LAST_7_DAYS" : days <= 14 ? "LAST_14_DAYS" : "LAST_30_DAYS";

  try {
    const results = await customer.query(`
      SELECT
        metrics.clicks,
        metrics.conversions,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING ${dateRange}
        AND campaign.status != 'REMOVED'
    `);

    let totalClicks = 0;
    let totalConversions = 0;
    let totalCostMicros = 0;
    let totalConversionsValue = 0;

    for (const row of results || []) {
      totalClicks += Number(row.metrics?.clicks || 0);
      totalConversions += Number(row.metrics?.conversions || 0);
      totalCostMicros += Number(row.metrics?.cost_micros || 0);
      totalConversionsValue += Number(row.metrics?.conversions_value || 0);
    }

    const cost = totalCostMicros / 1_000_000;
    return {
      clicks: totalClicks,
      conversions: totalConversions,
      costMicros: totalCostMicros,
      cost,
      ctr: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
      averageCpc: totalClicks > 0 ? cost / totalClicks : 0,
      conversionsValue: totalConversionsValue,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get performance summary");
    throw error;
  }
}

/**
 * Get daily performance time-series data
 */
export async function getDailyPerformance(days: number = 30): Promise<DailyPerformance[]> {
  const customer = getCustomer();
  if (!customer) return [];

  const dateRange = days <= 7 ? "LAST_7_DAYS" : days <= 14 ? "LAST_14_DAYS" : "LAST_30_DAYS";

  try {
    const results = await customer.query(`
      SELECT
        segments.date,
        metrics.clicks,
        metrics.conversions,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date DURING ${dateRange}
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `);

    // Aggregate by date
    const byDate = new Map<string, DailyPerformance>();
    for (const row of results || []) {
      const date = row.segments?.date || "";
      const existing = byDate.get(date) || { date, clicks: 0, conversions: 0, cost: 0 };
      existing.clicks += Number(row.metrics?.clicks || 0);
      existing.conversions += Number(row.metrics?.conversions || 0);
      existing.cost += Number(row.metrics?.cost_micros || 0) / 1_000_000;
      byDate.set(date, existing);
    }

    return Array.from(byDate.values()).map((d) => ({
      ...d,
      cost: Math.round(d.cost * 100) / 100,
    }));
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get daily performance");
    throw error;
  }
}

/**
 * Get conversions grouped by campaign
 */
export async function getConversionsByCampaign(): Promise<CampaignPerformance[]> {
  const customer = getCustomer();
  if (!customer) return [];

  try {
    const results = await customer.query(`
      SELECT
        campaign.name,
        metrics.conversions,
        metrics.cost_micros,
        metrics.clicks
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.conversions DESC
    `);

    // Aggregate by campaign name
    const byCampaign = new Map<string, CampaignPerformance>();
    for (const row of results || []) {
      const name = row.campaign?.name || "Unknown";
      const existing = byCampaign.get(name) || { campaignName: name, conversions: 0, cost: 0, clicks: 0 };
      existing.conversions += Number(row.metrics?.conversions || 0);
      existing.cost += Number(row.metrics?.cost_micros || 0) / 1_000_000;
      existing.clicks += Number(row.metrics?.clicks || 0);
      byCampaign.set(name, existing);
    }

    return Array.from(byCampaign.values());
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get conversions by campaign");
    throw error;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getLocationId(location: string): string {
  const locations: Record<string, string> = {
    "brasil": "2076",
    "brazil": "2076",
    "são paulo": "20106",
    "sao paulo": "20106",
    "rio de janeiro": "20109",
    "belo horizonte": "20110",
    "curitiba": "20111",
    "porto alegre": "20112",
    "recife": "20113",
    "salvador": "20114",
    "fortaleza": "20115",
    "brasília": "20116",
    "brasilia": "20116",
  };
  return locations[location.toLowerCase()] || "2076"; // Default to Brazil
}

function mapCompetition(competitionEnum: number | undefined): string {
  switch (competitionEnum) {
    case 2: return "baixa";
    case 3: return "média";
    case 4: return "alta";
    default: return "média";
  }
}

function mapCampaignStatus(status: number | undefined): string {
  switch (status) {
    case 2: return "ativo";     // ENABLED
    case 3: return "pausado";   // PAUSED
    case 4: return "removido";  // REMOVED
    default: return "desconhecido";
  }
}

function mapMonthNumber(month: any): string {
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  if (typeof month === "number") {
    if (month >= 1 && month <= 12) return months[month - 1];
    return months[0];
  }
  if (typeof month === "string") {
    const m = month.toUpperCase();
    if (m.startsWith("JAN")) return "Jan";
    if (m.startsWith("FEB")) return "Fev";
    if (m.startsWith("MAR")) return "Mar";
    if (m.startsWith("APR")) return "Abr";
    if (m.startsWith("MAY")) return "Mai";
    if (m.startsWith("JUN")) return "Jun";
    if (m.startsWith("JUL")) return "Jul";
    if (m.startsWith("AUG")) return "Ago";
    if (m.startsWith("SEP")) return "Set";
    if (m.startsWith("OCT")) return "Out";
    if (m.startsWith("NOV")) return "Nov";
    if (m.startsWith("DEC")) return "Dez";
  }
  return "Jan";
}
