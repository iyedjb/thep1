import { GoogleAdsApi, enums } from "google-ads-api";
import { logger } from "./logger";

let _client: GoogleAdsApi | null = null;

export type GoogleAdsCredentials = {
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string | null;
};

/**
 * Check if Google Ads credentials are configured
 */
export function isGoogleAdsConfigured(credentials?: GoogleAdsCredentials | null): boolean {
  return !!(
    process.env["GOOGLE_ADS_CLIENT_ID"] &&
    process.env["GOOGLE_ADS_CLIENT_SECRET"] &&
    process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] &&
    (credentials
      ? credentials.refreshToken && credentials.customerId
      : process.env["GOOGLE_ADS_REFRESH_TOKEN"] && process.env["GOOGLE_ADS_CUSTOMER_ID"])
  );
}

/**
 * Get or create the Google Ads API client
 */
function getClient(): GoogleAdsApi | null {
  if (_client) return _client;

  if (!process.env["GOOGLE_ADS_CLIENT_ID"] || !process.env["GOOGLE_ADS_CLIENT_SECRET"] || !process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]) {
    logger.warn("Google Ads credentials not configured — using local fallback data");
    return null;
  }

  _client = new GoogleAdsApi({
    client_id: process.env["GOOGLE_ADS_CLIENT_ID"]!,
    client_secret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
    developer_token: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
  });

  return _client;
}

function resolveCredentials(credentials?: GoogleAdsCredentials): GoogleAdsCredentials | null {
  if (credentials?.refreshToken && credentials.customerId) return credentials;
  const refreshToken = process.env["GOOGLE_ADS_REFRESH_TOKEN"];
  const customerId = process.env["GOOGLE_ADS_CUSTOMER_ID"];
  if (!refreshToken || !customerId) return null;
  return {
    refreshToken,
    customerId,
    loginCustomerId: process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"] || customerId,
  };
}

function getCustomer(credentials?: GoogleAdsCredentials) {
  const client = getClient();
  const resolved = resolveCredentials(credentials);
  if (!client || !resolved) return null;
  const customerId = resolved.customerId.replace(/-/g, "");
  const loginCustomerId = resolved.loginCustomerId?.replace(/-/g, "");

  return client.Customer({
    customer_id: customerId,
    login_customer_id: loginCustomerId || undefined,
    refresh_token: resolved.refreshToken,
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
  location: string = "Brasil",
  credentials?: GoogleAdsCredentials,
): Promise<KeywordIdea[]> {
  const customer = getCustomer(credentials);
  if (!customer) return [];

  try {
    const locationId = getLocationConstantId(location);
    const languageId = getLanguageIdForLocation(location);

    return await fetchKeywordIdeasViaService(
      customer,
      seedKeyword,
      locationId,
      resolveCredentials(credentials)!.customerId,
      languageId,
    );
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch keyword ideas from Google Ads");
    throw error;
  }
}

async function fetchKeywordIdeasViaService(
  customer: any,
  seedKeyword: string,
  locationId: string,
  customerId: string,
  languageId: string,
): Promise<KeywordIdea[]> {
  try {
    const keywords = seedKeyword
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: customerId.replace(/-/g, ""),
      language: `languageConstants/${languageId}`,
      geo_target_constants: [`geoTargetConstants/${locationId}`],
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_seed: {
        keywords: keywords,
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
  location: string = "Brasil",
  credentials?: GoogleAdsCredentials,
): Promise<KeywordIdea | null> {
  const ideas = await getKeywordIdeas(keyword, location, credentials);
  // Find the exact match
  const exact = ideas.find(
    (i) => i.keyword.toLowerCase() === keyword.toLowerCase()
  );
  return exact || ideas[0] || null;
}

/**
 * Get real metrics for multiple keywords in a single batch query
 */
export async function getKeywordMetricsBatch(
  keywords: string[],
  location: string = "Brasil",
  credentials?: GoogleAdsCredentials,
): Promise<Record<string, KeywordIdea>> {
  const customer = getCustomer(credentials) as any;
  if (!customer || keywords.length === 0) return {};

  try {
    const locationId = getLocationConstantId(location);
    const languageId = getLanguageIdForLocation(location);

    const response = await customer.keywordPlanIdeas.generateKeywordIdeas({
      customer_id: resolveCredentials(credentials)!.customerId.replace(/-/g, ""),
      language: `languageConstants/${languageId}`,
      geo_target_constants: [`geoTargetConstants/${locationId}`],
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      keyword_seed: {
        keywords: keywords,
      },
    }) as any;

    const result: Record<string, KeywordIdea> = {};
    for (const idea of response || []) {
      const kwText = (idea.text || "").toLowerCase();
      const metrics = idea.keyword_idea_metrics || {};
      const avgSearches = Number(metrics.avg_monthly_searches || 0);
      const competitionEnum = metrics.competition;
      const lowBid = Number(metrics.low_top_of_page_bid_micros || 0) / 1_000_000;
      const highBid = Number(metrics.high_top_of_page_bid_micros || 0) / 1_000_000;
      const avgCpc = Math.round(((lowBid + highBid) / 2) * 100) / 100;

      const monthlySearchVolumes = metrics.monthly_search_volumes || [];
      const trends = monthlySearchVolumes.map((m: any) => ({
        month: mapMonthNumber(m.month),
        volume: Number(m.monthly_searches || 0),
      }));

      result[kwText] = {
        keyword: idea.text || "",
        avgMonthlySearches: avgSearches,
        competition: mapCompetition(competitionEnum),
        competitionIndex: Number(metrics.competition_index || 0),
        lowCpc: Math.round(lowBid * 100) / 100,
        highCpc: Math.round(highBid * 100) / 100,
        avgCpc,
        text: idea.text || "",
        cpc: avgCpc,
        trends,
      };
    }
    return result;
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch keyword ideas batch from Google Ads");
    throw error;
  }
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
  cpc?: number;
  ctr?: number;
  roas?: number;
  conversions?: number;
}

/**
 * Create a Search campaign in Google Ads
 */
export async function createGoogleAdsCampaign(
  name: string,
  dailyBudgetBrl: number,
  status: "ENABLED" | "PAUSED" = "ENABLED",
  options?: {
    targetLocations?: string[];
    targetLanguages?: string[];
    biddingStrategy?: string;
    adNetworks?: string[];
    startDate?: string;
    endDate?: string;
    websiteUrl?: string;
    adGroupName?: string;
    keywords?: string[];
    keywordMatchType?: string;
    headlines?: string[];
    descriptions?: string[];
    path1?: string;
    path2?: string;
  },
  credentials?: GoogleAdsCredentials,
): Promise<GoogleAdsCampaign | null> {
  const customer = getCustomer(credentials);
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

    // Prepare bidding strategy
    const biddingFields: any = {};
    const strategy = options?.biddingStrategy ?? "Maximize Clicks";
    if (strategy === "Maximize Clicks") {
      biddingFields.maximize_clicks = {};
    } else if (strategy === "Maximize Conversions") {
      biddingFields.maximize_conversions = {};
    } else if (strategy === "Maximize Conversion Value") {
      biddingFields.maximize_conversion_value = {};
    } else if (strategy === "Target CPA") {
      biddingFields.target_cpa = {};
    } else if (strategy === "Target ROAS") {
      biddingFields.target_roas = {};
    } else if (strategy === "Manual CPC" || strategy === "Enhanced CPC") {
      biddingFields.manual_cpc = { enhanced_cpc_enabled: strategy === "Enhanced CPC" };
    } else if (strategy === "Target Impression Share") {
      biddingFields.target_impression_share = {
        location: enums.TargetImpressionShareLocation.ANYWHERE_ON_PAGE,
        location_fraction_micros: 1_000_000,
      };
    } else {
      biddingFields.maximize_clicks = {};
    }

    // Prepare network settings
    const networkSettings = {
      target_google_search: options?.adNetworks?.includes("Search Network") ?? true,
      target_search_network: options?.adNetworks?.includes("Search Partners") ?? false,
      target_content_network: options?.adNetworks?.includes("Display Network") ?? false,
      target_partner_search_network: false,
    };

    // Create the campaign
    const campaignResult = await customer.campaigns.create([
      {
        name,
        status: status === "ENABLED" ? enums.CampaignStatus.ENABLED : enums.CampaignStatus.PAUSED,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        campaign_budget: budgetResourceName,
        network_settings: networkSettings,
        ...biddingFields,
        start_date: options?.startDate ? options.startDate.replace(/-/g, "") : undefined,
        end_date: options?.endDate ? options.endDate.replace(/-/g, "") : undefined,
      },
    ]);

    const campaignResourceName = campaignResult.results[0]?.resource_name;
    if (!campaignResourceName) {
      throw new Error("Failed to get campaign resource name from Google Ads");
    }
    const campaignId = campaignResourceName.split("/").pop() || "";

    logger.info({ campaignId, name }, "Campaign created in Google Ads");

    // Add criteria targets asynchronously (if specified)
    if (options?.targetLocations && options.targetLocations.length > 0) {
      try {
        const locationCriteria = options.targetLocations.map((loc) => {
          const locId = getLocationConstantId(loc);
          return {
            campaign: campaignResourceName,
            location: {
              location_constant: `locationConstants/${locId}`,
            },
            type: enums.CriterionType.LOCATION,
          };
        });
        await customer.campaignCriteria.create(locationCriteria as any);
        logger.info({ campaignId, targetLocations: options.targetLocations }, "Locations targeted on Google Ads");
      } catch (err: any) {
        logger.error({ campaignId, err: err.message }, "Failed to apply location targeting to Google Ads campaign");
      }
    }

    if (options?.targetLanguages && options.targetLanguages.length > 0) {
      try {
        const languageCriteria = options.targetLanguages.map((lang) => {
          const langId = getLanguageConstantId(lang);
          return {
            campaign: campaignResourceName,
            language: {
              language_constant: `languageConstants/${langId}`,
            },
            type: enums.CriterionType.LANGUAGE,
          };
        });
        await customer.campaignCriteria.create(languageCriteria as any);
        logger.info({ campaignId, targetLanguages: options.targetLanguages }, "Languages targeted on Google Ads");
      } catch (err: any) {
        logger.error({ campaignId, err: err.message }, "Failed to apply language targeting to Google Ads campaign");
      }
    }

    // A useful Search campaign needs an ad group, keyword criteria, and a
    // responsive search ad. Creating only the campaign shell leaves nothing
    // eligible to serve in Google Ads.
    if (options?.adGroupName && options.websiteUrl && options.keywords?.length) {
      const adGroupResult = await customer.adGroups.create([
        {
          campaign: campaignResourceName,
          name: options.adGroupName,
          status: status === "ENABLED" ? enums.AdGroupStatus.ENABLED : enums.AdGroupStatus.PAUSED,
          type: enums.AdGroupType.SEARCH_STANDARD,
        },
      ] as any);
      const adGroupResourceName = adGroupResult.results[0]?.resource_name;
      if (!adGroupResourceName) throw new Error("Google Ads did not return the new ad group");

      const matchType =
        options.keywordMatchType === "EXACT"
          ? enums.KeywordMatchType.EXACT
          : options.keywordMatchType === "PHRASE"
            ? enums.KeywordMatchType.PHRASE
            : enums.KeywordMatchType.BROAD;

      await customer.adGroupCriteria.create(
        options.keywords.map((keyword) => ({
          ad_group: adGroupResourceName,
          status: enums.AdGroupCriterionStatus.ENABLED,
          keyword: { text: keyword, match_type: matchType },
        })) as any,
      );

      const headlines = (options.headlines || []).filter(Boolean).slice(0, 15);
      const descriptions = (options.descriptions || []).filter(Boolean).slice(0, 4);
      if (headlines.length < 3 || descriptions.length < 2) {
        throw new Error("Responsive Search Ads require at least 3 headlines and 2 descriptions");
      }

      await customer.adGroupAds.create([
        {
          ad_group: adGroupResourceName,
          status: status === "ENABLED" ? enums.AdGroupAdStatus.ENABLED : enums.AdGroupAdStatus.PAUSED,
          ad: {
            final_urls: [options.websiteUrl],
            responsive_search_ad: {
              headlines: headlines.map((text) => ({ text })),
              descriptions: descriptions.map((text) => ({ text })),
              path1: options.path1 || undefined,
              path2: options.path2 || undefined,
            },
          },
        },
      ] as any);

      logger.info(
        { campaignId, adGroup: options.adGroupName, keywords: options.keywords.length },
        "Search campaign, ad group, keywords, and responsive search ad created in Google Ads",
      );
    }

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
  updates: { 
    name?: string; 
    status?: string; 
    budget?: number;
    biddingStrategy?: string;
    adNetworks?: string[];
    startDate?: string;
    endDate?: string;
  },
  credentials?: GoogleAdsCredentials,
): Promise<boolean> {
  const customer = getCustomer(credentials);
  if (!customer) return false;

  try {
    const campaignUpdate: any = {
      resource_name: `customers/${resolveCredentials(credentials)!.customerId.replace(/-/g, "")}/campaigns/${googleCampaignId}`,
    };

    if (updates.name) campaignUpdate.name = updates.name;
    if (updates.status) {
      campaignUpdate.status =
        updates.status === "ativo"
          ? enums.CampaignStatus.ENABLED
          : enums.CampaignStatus.PAUSED;
    }

    if (updates.biddingStrategy) {
      const s = updates.biddingStrategy;
      if (s === "Maximize Clicks") {
        campaignUpdate.maximize_clicks = {};
      } else if (s === "Maximize Conversions") {
        campaignUpdate.maximize_conversions = {};
      } else if (s === "Maximize Conversion Value") {
        campaignUpdate.maximize_conversion_value = {};
      } else if (s === "Target CPA") {
        campaignUpdate.target_cpa = {};
      } else if (s === "Target ROAS") {
        campaignUpdate.target_roas = {};
      } else if (s === "Manual CPC" || s === "Enhanced CPC") {
        campaignUpdate.manual_cpc = { enhanced_cpc_enabled: s === "Enhanced CPC" };
      } else if (s === "Target Impression Share") {
        campaignUpdate.target_impression_share = {
          location: enums.TargetImpressionShareLocation.ANYWHERE_ON_PAGE,
          location_fraction_micros: 1_000_000,
        };
      }
    }

    if (updates.adNetworks) {
      campaignUpdate.network_settings = {
        target_google_search: updates.adNetworks.includes("Search Network"),
        target_search_network: updates.adNetworks.includes("Search Partners"),
        target_content_network: updates.adNetworks.includes("Display Network"),
        target_partner_search_network: false,
      };
    }

    if (updates.startDate) {
      campaignUpdate.start_date = updates.startDate.replace(/-/g, "");
    }
    if (updates.endDate) {
      campaignUpdate.end_date = updates.endDate.replace(/-/g, "");
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
export async function removeGoogleAdsCampaign(googleCampaignId: string, credentials?: GoogleAdsCredentials): Promise<boolean> {
  const customer = getCustomer(credentials);
  if (!customer) return false;

  try {
    await customer.campaigns.update([
      {
        resource_name: `customers/${resolveCredentials(credentials)!.customerId.replace(/-/g, "")}/campaigns/${googleCampaignId}`,
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
export async function listGoogleAdsCampaigns(credentials?: GoogleAdsCredentials): Promise<GoogleAdsCampaign[]> {
  const customer = getCustomer(credentials);
  if (!customer) return [];

  try {
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros,
        metrics.clicks,
        metrics.conversions,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_value
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date DURING LAST_30_DAYS
      ORDER BY campaign.name
    `);

    return (campaigns || []).map((row: any) => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1_000_000;
      const conversionsValue = Number(row.metrics?.conversions_value || 0);
      const roas = cost > 0 ? conversionsValue / cost : 0;

      return {
        id: String(row.campaign?.id || ""),
        name: row.campaign?.name || "",
        status: mapCampaignStatus(row.campaign?.status),
        budgetAmountMicros: Number(row.campaign_budget?.amount_micros || 0),
        budgetAmount: Number(row.campaign_budget?.amount_micros || 0) / 1_000_000,
        cpc: Number(row.metrics?.average_cpc || 0) / 1_000_000,
        ctr: Number(row.metrics?.ctr || 0) * 100, // Google Ads API returns CTR as decimal (e.g. 0.05 for 5%)
        roas: roas,
        conversions: Number(row.metrics?.conversions || 0),
      };
    });
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
  days: number = 30,
  credentials?: GoogleAdsCredentials,
): Promise<PerformanceMetrics | null> {
  const customer = getCustomer(credentials);
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
export async function getDailyPerformance(days: number = 30, credentials?: GoogleAdsCredentials): Promise<DailyPerformance[]> {
  const customer = getCustomer(credentials);
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
export async function getConversionsByCampaign(credentials?: GoogleAdsCredentials): Promise<CampaignPerformance[]> {
  const customer = getCustomer(credentials);
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

function getLocationConstantId(loc: string): string {
  const mapping: Record<string, string> = {
    // Americas
    "brasil": "2076", "brazil": "2076",
    "estados unidos": "2840", "united states": "2840",
    "mexico": "2484", "méxico": "2484",
    "argentina": "2032",
    "chile": "2152",
    "colombia": "2170", "colômbia": "2170",
    "peru": "2604", "perú": "2604",
    "uruguay": "2858", "uruguai": "2858",
    "bolivia": "2068", "bolívia": "2068",
    "equador": "2218", "ecuador": "2218",
    "panama": "2591", "panamá": "2591",
    "costa rica": "2188",
    "canada": "2124", "canadá": "2124",
    // Europe
    "espanha": "2724", "spain": "2724",
    "portugal": "2620",
    "reino unido": "2826", "united kingdom": "2826",
    "alemanha": "2276", "germany": "2276",
    "franca": "2250", "france": "2250", "frança": "2250",
    "italia": "2380", "italy": "2380", "itália": "2380",
    "paises baixos": "2528", "netherlands": "2528", "países baixos": "2528",
    "suecia": "2752", "sweden": "2752", "suécia": "2752",
    "noruega": "2578", "norway": "2578",
    "dinamarca": "2208", "denmark": "2208",
    "finlandia": "2246", "finland": "2246", "finlândia": "2246",
    "austria": "2040", "áustria": "2040",
    "belgica": "2056", "belgium": "2056", "bélgica": "2056",
    "suica": "2756", "switzerland": "2756", "suíça": "2756",
    "polonia": "2616", "poland": "2616", "polônia": "2616",
    "republica tcheca": "2203", "czech republic": "2203", "república tcheca": "2203",
    "hungria": "2348", "hungary": "2348",
    "romania": "2642", "romênia": "2642",
    "grecia": "2300", "greece": "2300", "grécia": "2300",
    // Asia Pacific
    "india": "2356", "índia": "2356",
    "japao": "2392", "japan": "2392", "japão": "2392",
    "coreia do sul": "2410", "south korea": "2410",
    "australia": "2036", "austrália": "2036",
    "nova zelandia": "2554", "new zealand": "2554", "nova zelândia": "2554",
    "singapura": "2702", "singapore": "2702",
    "malaysia": "2458", "malásia": "2458",
    "indonesia": "2360", "indonésia": "2360",
    "tailandia": "2764", "thailand": "2764", "tailândia": "2764",
    "vietna": "2704", "vietnam": "2704", "vietnã": "2704",
    "filipinas": "2608", "philippines": "2608",
    "taiwan": "2158",
    "hong kong": "2344",
    // Middle East & Africa
    "emirados arabes unidos": "2784", "united arab emirates": "2784", "emirados árabes unidos": "2784",
    "arabia saudita": "2682", "saudi arabia": "2682", "arábia saudita": "2682",
    "egito": "2818", "egypt": "2818",
    "africa do sul": "2710", "south africa": "2710", "áfrica do sul": "2710",
    "nigeria": "2566", "nigéria": "2566",
    "quenia": "2404", "kenya": "2404", "quênia": "2404",
    "israel": "2376",
    "turquia": "2792", "turkey": "2792",
  };
  return mapping[loc.toLowerCase()] || "2076"; // Default to Brazil
}

function getLanguageConstantId(lang: string): string {
  const mapping: Record<string, string> = {
    // Portuguese
    "portugues": "1014", "português": "1014", "portuguese": "1014",
    // English
    "ingles": "1000", "inglês": "1000", "english": "1000",
    // Spanish
    "espanhol": "1003", "spanish": "1003",
    // French
    "frances": "1002", "français": "1002", "french": "1002",
    // German
    "alemao": "1001", "alemão": "1001", "german": "1001",
    // Italian
    "italiano": "1004", "italian": "1004",
    // Japanese
    "japones": "1005", "japonês": "1005", "japanese": "1005",
    // Korean
    "coreano": "1012", "korean": "1012",
    // Chinese Simplified
    "chines simplificado": "1017", "chinês simplificado": "1017", "chinese simplified": "1017",
    // Chinese Traditional
    "chines tradicional": "1018", "chinês tradicional": "1018", "chinese traditional": "1018",
    // Arabic
    "arabe": "1019", "árabe": "1019", "arabic": "1019",
    // Russian
    "russo": "1020", "russian": "1020",
    // Dutch
    "holandes": "1010", "holandês": "1010", "dutch": "1010",
    // Polish
    "polones": "1030", "polonês": "1030", "polish": "1030",
    // Turkish
    "turco": "1037", "turkish": "1037",
  };
  return mapping[lang.toLowerCase()] || "1014"; // Default to Portuguese
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

function getLanguageIdForLocation(location: string): string {
  const loc = location.toLowerCase();
  if (loc.includes("brasil") || loc.includes("brazil") || loc.includes("portugal")) {
    return "1014"; // Portuguese
  }
  if (
    loc.includes("espanha") ||
    loc.includes("spain") ||
    loc.includes("mexico") ||
    loc.includes("méxico") ||
    loc.includes("argentina") ||
    loc.includes("chile") ||
    loc.includes("colombia") ||
    loc.includes("colômbia") ||
    loc.includes("peru") ||
    loc.includes("perú") ||
    loc.includes("uruguay") ||
    loc.includes("uruguai") ||
    loc.includes("bolivia") ||
    loc.includes("bolívia") ||
    loc.includes("equador") ||
    loc.includes("ecuador") ||
    loc.includes("panama") ||
    loc.includes("panamá") ||
    loc.includes("costa rica")
  ) {
    return "1003"; // Spanish
  }
  if (
    loc.includes("alemanha") ||
    loc.includes("germany") ||
    loc.includes("austria") ||
    loc.includes("áustria") ||
    loc.includes("suica") ||
    loc.includes("suíça") ||
    loc.includes("switzerland")
  ) {
    return "1001"; // German
  }
  if (loc.includes("franca") || loc.includes("france") || loc.includes("frança")) {
    return "1002"; // French
  }
  if (loc.includes("italia") || loc.includes("italy") || loc.includes("itália")) {
    return "1004"; // Italian
  }
  if (loc.includes("polonia") || loc.includes("poland") || loc.includes("polônia")) {
    return "1030"; // Polish
  }
  if (loc.includes("japao") || loc.includes("japan") || loc.includes("japão")) {
    return "1005"; // Japanese
  }
  if (loc.includes("coreia")) {
    return "1012"; // Korean
  }
  if (loc.includes("russo") || loc.includes("russia") || loc.includes("rússia")) {
    return "1020"; // Russian
  }
  if (loc.includes("turquia") || loc.includes("turkey")) {
    return "1037"; // Turkish
  }
  // Default to English for international queries to get maximum coverage
  return "1000";
}

