import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "./sqlite";
import { auditMcp, type OAuthAccess, type OAuthScope } from "./oauth";

const periodSchema = z.enum(["7d", "30d", "90d"]).default("7d");
const numberValue = (value: unknown) => Number(value || 0);
const nullableText = (value: unknown) => value == null || value === "" ? null : String(value);

function since(period: "7d" | "30d" | "90d") {
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  return new Date(Date.now() - days * 24 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

function ensureScope(access: OAuthAccess, scope: OAuthScope) {
  if (!access.scopes.includes(scope)) throw new Error(`A conexão não possui a permissão ${scope}.`);
}

async function ensureSite(userId: number, siteId?: number) {
  if (!siteId) return null;
  const site = await getDb().prepare("SELECT id, name FROM tracking_sites WHERE id = ? AND user_id = ?").get(siteId, userId) as any;
  if (!site) throw new Error("Site não encontrado nesta conta.");
  return site;
}

async function toolResult(access: OAuthAccess, name: string, work: () => Promise<{ data: Record<string, unknown>; text: string }>) {
  const started = Date.now();
  try {
    const result = await work();
    await auditMcp(access, name, true, Date.now() - started);
    return { structuredContent: result.data, content: [{ type: "text" as const, text: result.text }] };
  } catch (error: any) {
    await auditMcp(access, name, false, Date.now() - started);
    return { isError: true, content: [{ type: "text" as const, text: error.message || "Não foi possível consultar o ClicLab." }] };
  }
}

export function createClicLabMcpServer(access: OAuthAccess) {
  const server = new McpServer(
    { name: "cliclab", version: "1.0.0" },
    { instructions: "Use as ferramentas ClicLab para consultar dados da conta conectada. Respeite períodos, moedas e identificadores retornados. Não invente métricas ausentes e não exponha tokens, IPs ou payloads brutos." }
  );

  server.registerTool("get_account_overview", {
    title: "Ver conta ClicLab",
    description: "Use quando o usuário quiser confirmar qual conta ClicLab está conectada e o estado geral da integração.",
    inputSchema: {},
    outputSchema: { account: z.object({ id: z.number(), name: z.string(), email: z.string().nullable(), subscriptionTier: z.string(), subscriptionStatus: z.string() }) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async () => toolResult(access, "get_account_overview", async () => {
    ensureScope(access, "openid");
    const row = await getDb().prepare("SELECT id, name, email, subscription_tier, subscription_status FROM users WHERE id = ?").get(access.userId) as any;
    const account = { id: Number(row.id), name: String(row.name), email: access.scopes.includes("email") ? String(row.email) : null, subscriptionTier: String(row.subscription_tier || "free"), subscriptionStatus: String(row.subscription_status || "free") };
    return { data: { account }, text: `Conta conectada: ${account.name}. Plano ${account.subscriptionTier}.` };
  }));

  server.registerTool("list_tracking_sites", {
    title: "Listar sites rastreados",
    description: "Lista sites e páginas da conta ClicLab com contagens recentes de visitas, cliques e conversões.",
    inputSchema: { period: periodSchema },
    outputSchema: { period: z.string(), sites: z.array(z.object({ id: z.number(), name: z.string(), slug: z.string().nullable(), status: z.string(), visits: z.number(), clicks: z.number(), conversions: z.number() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ period }) => toolResult(access, "list_tracking_sites", async () => {
    ensureScope(access, "tracking:read");
    const rows = await getDb().prepare(
      `SELECT s.id, s.name, s.slug, s.status,
        (SELECT COUNT(*) FROM tracking_visits v WHERE v.tracking_site_id = s.id AND v.user_id = s.user_id AND v.created_at >= ?) AS visits,
        (SELECT COALESCE(SUM(v.clicks), 0) FROM tracking_visits v WHERE v.tracking_site_id = s.id AND v.user_id = s.user_id AND v.created_at >= ?) AS clicks,
        (SELECT COUNT(*) FROM postback_events e JOIN tracking_visits v ON v.id = e.tracking_visit_id WHERE v.tracking_site_id = s.id AND e.user_id = s.user_id AND e.received_at >= ? AND e.status_group IN ('approved','paid')) AS conversions
       FROM tracking_sites s WHERE s.user_id = ? ORDER BY s.created_at DESC`
    ).all(since(period), since(period), since(period), access.userId) as any[];
    const sites = rows.map((row) => ({ id: Number(row.id), name: String(row.name), slug: nullableText(row.slug), status: String(row.status || "active"), visits: numberValue(row.visits), clicks: numberValue(row.clicks), conversions: numberValue(row.conversions) }));
    return { data: { period, sites }, text: `${sites.length} site(s) encontrado(s) para ${period}.` };
  }));

  server.registerTool("get_tracking_summary", {
    title: "Consultar resumo de rastreamento",
    description: "Resume visitas, visitantes, cliques, leads, aprovações, pagamentos, receita, países e dispositivos em um período.",
    inputSchema: { period: periodSchema, siteId: z.number().int().positive().optional() },
    outputSchema: { period: z.string(), siteId: z.number().nullable(), summary: z.object({ visits: z.number(), uniqueVisitors: z.number(), clicks: z.number(), leads: z.number(), approved: z.number(), paid: z.number(), revenueByCurrency: z.array(z.object({ currency: z.string(), amount: z.number() })) }), countries: z.array(z.object({ name: z.string(), value: z.number() })), devices: z.array(z.object({ name: z.string(), value: z.number() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ period, siteId }) => toolResult(access, "get_tracking_summary", async () => {
    ensureScope(access, "tracking:read");
    await ensureSite(access.userId, siteId);
    const db = getDb();
    const visits = siteId
      ? await db.prepare("SELECT visitor_key, clicks, country_name, device_type FROM tracking_visits WHERE user_id = ? AND tracking_site_id = ? AND created_at >= ?").all(access.userId, siteId, since(period)) as any[]
      : await db.prepare("SELECT visitor_key, clicks, country_name, device_type FROM tracking_visits WHERE user_id = ? AND created_at >= ?").all(access.userId, since(period)) as any[];
    const events = siteId
      ? await db.prepare("SELECT e.status_group, e.payout, e.currency FROM postback_events e JOIN tracking_visits v ON v.id = e.tracking_visit_id WHERE e.user_id = ? AND v.tracking_site_id = ? AND e.received_at >= ?").all(access.userId, siteId, since(period)) as any[]
      : await db.prepare("SELECT status_group, payout, currency FROM postback_events WHERE user_id = ? AND received_at >= ?").all(access.userId, since(period)) as any[];
    const count = (key: string, fallback: string) => {
      const values = new Map<string, number>();
      visits.forEach((row) => { const label = String(row[key] || fallback); values.set(label, (values.get(label) || 0) + 1); });
      return [...values.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    };
    const revenues = new Map<string, number>();
    events.filter((event) => event.status_group === "paid").forEach((event) => { const currency = String(event.currency || "USD").toUpperCase(); revenues.set(currency, (revenues.get(currency) || 0) + numberValue(event.payout)); });
    const summary = { visits: visits.length, uniqueVisitors: new Set(visits.map((row) => row.visitor_key)).size, clicks: visits.reduce((total, row) => total + numberValue(row.clicks), 0), leads: events.length, approved: events.filter((event) => ["approved", "paid"].includes(event.status_group)).length, paid: events.filter((event) => event.status_group === "paid").length, revenueByCurrency: [...revenues.entries()].map(([currency, amount]) => ({ currency, amount })) };
    return { data: { period, siteId: siteId || null, summary, countries: count("country_name", "Não identificado"), devices: count("device_type", "desktop") }, text: `${summary.visits} visitas, ${summary.clicks} cliques e ${summary.leads} leads em ${period}.` };
  }));

  server.registerTool("list_recent_activity", {
    title: "Listar atividade recente",
    description: "Lista visitas, cliques e eventos de conversão recentes com país, cidade, dispositivo e atribuição, sem retornar IP ou payload bruto.",
    inputSchema: { period: periodSchema, siteId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).default(25) },
    outputSchema: { events: z.array(z.object({ id: z.string(), type: z.string(), title: z.string(), occurredAt: z.string(), site: z.string(), country: z.string().nullable(), city: z.string().nullable(), device: z.string().nullable(), browser: z.string().nullable(), source: z.string().nullable(), orderId: z.string().nullable(), status: z.string().nullable(), payout: z.number().nullable(), currency: z.string().nullable() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ period, siteId, limit }) => toolResult(access, "list_recent_activity", async () => {
    ensureScope(access, "tracking:read");
    await ensureSite(access.userId, siteId);
    const db = getDb();
    const visits = siteId
      ? await db.prepare("SELECT v.*, s.name AS site_name FROM tracking_visits v LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id WHERE v.user_id = ? AND v.tracking_site_id = ? AND v.created_at >= ? ORDER BY v.created_at DESC LIMIT 100").all(access.userId, siteId, since(period)) as any[]
      : await db.prepare("SELECT v.*, s.name AS site_name FROM tracking_visits v LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id WHERE v.user_id = ? AND v.created_at >= ? ORDER BY v.created_at DESC LIMIT 100").all(access.userId, since(period)) as any[];
    const postbacks = siteId
      ? await db.prepare("SELECT e.*, s.name AS site_name, v.country_name, v.city, v.device_type, v.browser, v.traffic_source FROM postback_events e JOIN tracking_visits v ON v.id = e.tracking_visit_id LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id WHERE e.user_id = ? AND v.tracking_site_id = ? AND e.received_at >= ? ORDER BY e.received_at DESC LIMIT 100").all(access.userId, siteId, since(period)) as any[]
      : await db.prepare("SELECT e.*, s.name AS site_name, v.country_name, v.city, v.device_type, v.browser, v.traffic_source FROM postback_events e LEFT JOIN tracking_visits v ON v.id = e.tracking_visit_id LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id WHERE e.user_id = ? AND e.received_at >= ? ORDER BY e.received_at DESC LIMIT 100").all(access.userId, since(period)) as any[];
    const events = [
      ...visits.map((row) => ({ id: `visit-${row.id}`, type: numberValue(row.clicks) ? "click" : "visit", title: numberValue(row.clicks) ? "Clique na página" : "Novo acesso", occurredAt: String(row.clicked_at || row.created_at), site: String(row.site_name || "Página publicada"), country: nullableText(row.country_name), city: nullableText(row.city), device: nullableText(row.device_type), browser: nullableText(row.browser), source: nullableText(row.traffic_source), orderId: null, status: null, payout: null, currency: null })),
      ...postbacks.map((row) => ({ id: `postback-${row.id}`, type: String(row.status_group || "lead"), title: row.status_group === "paid" ? "Pagamento recebido" : row.status_group === "approved" ? "Lead aprovado" : "Novo lead", occurredAt: String(row.received_at), site: String(row.site_name || "Sem atribuição"), country: nullableText(row.country_name), city: nullableText(row.city), device: nullableText(row.device_type), browser: nullableText(row.browser), source: nullableText(row.traffic_source), orderId: nullableText(row.external_event_id), status: nullableText(row.status), payout: row.payout == null ? null : numberValue(row.payout), currency: nullableText(row.currency) })),
    ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, limit);
    return { data: { events }, text: `${events.length} evento(s) recente(s) encontrado(s).` };
  }));

  server.registerTool("list_campaigns", {
    title: "Listar campanhas",
    description: "Lista campanhas da conta com orçamento e métricas armazenadas de desempenho.",
    inputSchema: { status: z.string().max(50).optional(), limit: z.number().int().min(1).max(100).default(50) },
    outputSchema: { campaigns: z.array(z.object({ id: z.number(), name: z.string(), status: z.string(), budget: z.number(), cpc: z.number(), ctr: z.number(), roas: z.number(), conversions: z.number(), googleCampaignId: z.string().nullable() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ status, limit }) => toolResult(access, "list_campaigns", async () => {
    ensureScope(access, "campaigns:read");
    const rows = status
      ? await getDb().prepare("SELECT id, name, status, budget, cpc, ctr, roas, conversions, google_campaign_id FROM campaigns WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?").all(access.userId, status, limit) as any[]
      : await getDb().prepare("SELECT id, name, status, budget, cpc, ctr, roas, conversions, google_campaign_id FROM campaigns WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(access.userId, limit) as any[];
    const campaigns = rows.map((row) => ({ id: Number(row.id), name: String(row.name), status: String(row.status), budget: numberValue(row.budget), cpc: numberValue(row.cpc), ctr: numberValue(row.ctr), roas: numberValue(row.roas), conversions: numberValue(row.conversions), googleCampaignId: nullableText(row.google_campaign_id) }));
    return { data: { campaigns }, text: `${campaigns.length} campanha(s) encontrada(s).` };
  }));

  server.registerTool("get_campaign_performance", {
    title: "Ver desempenho da campanha",
    description: "Consulta detalhes e métricas de uma campanha específica pelo identificador retornado por list_campaigns.",
    inputSchema: { campaignId: z.number().int().positive() },
    outputSchema: { campaign: z.object({ id: z.number(), name: z.string(), status: z.string(), budget: z.number(), cpc: z.number(), ctr: z.number(), roas: z.number(), conversions: z.number(), targetLocations: z.string().nullable(), targetLanguages: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable() }) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ campaignId }) => toolResult(access, "get_campaign_performance", async () => {
    ensureScope(access, "campaigns:read");
    const row = await getDb().prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").get(campaignId, access.userId) as any;
    if (!row) throw new Error("Campanha não encontrada nesta conta.");
    const campaign = { id: Number(row.id), name: String(row.name), status: String(row.status), budget: numberValue(row.budget), cpc: numberValue(row.cpc), ctr: numberValue(row.ctr), roas: numberValue(row.roas), conversions: numberValue(row.conversions), targetLocations: nullableText(row.target_locations), targetLanguages: nullableText(row.target_languages), startDate: nullableText(row.start_date), endDate: nullableText(row.end_date) };
    return { data: { campaign }, text: `${campaign.name}: ${campaign.conversions} conversões, ROAS ${campaign.roas}.` };
  }));

  server.registerTool("list_postback_integrations", {
    title: "Listar integrações de postback",
    description: "Lista integrações de afiliados configuradas e seu estado, sem revelar URLs privadas ou tokens.",
    inputSchema: {},
    outputSchema: { integrations: z.array(z.object({ id: z.number(), name: z.string(), provider: z.string(), enabled: z.boolean(), expiresAt: z.string().nullable(), lastTestedAt: z.string().nullable(), lastEventAt: z.string().nullable() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async () => toolResult(access, "list_postback_integrations", async () => {
    ensureScope(access, "postbacks:read");
    const rows = await getDb().prepare(`SELECT i.id, i.name, i.provider, i.enabled, i.expires_at, i.last_tested_at,
      (SELECT MAX(e.received_at) FROM postback_events e WHERE e.integration_id = i.id AND e.user_id = i.user_id) AS last_event_at
      FROM postback_integrations i WHERE i.user_id = ? ORDER BY i.created_at DESC`).all(access.userId) as any[];
    const integrations = rows.map((row) => ({ id: Number(row.id), name: String(row.name || row.provider), provider: String(row.provider), enabled: Boolean(row.enabled), expiresAt: nullableText(row.expires_at), lastTestedAt: nullableText(row.last_tested_at), lastEventAt: nullableText(row.last_event_at) }));
    return { data: { integrations }, text: `${integrations.length} integração(ões) de postback encontrada(s).` };
  }));

  server.registerTool("get_postback_events", {
    title: "Consultar eventos de postback",
    description: "Consulta leads, aprovações, rejeições e pagamentos de uma integração, incluindo atribuição, país e dispositivo quando disponíveis.",
    inputSchema: { integrationId: z.number().int().positive().optional(), statusGroup: z.enum(["pending", "approved", "rejected", "paid"]).optional(), limit: z.number().int().min(1).max(100).default(25) },
    outputSchema: { events: z.array(z.object({ id: z.number(), integrationId: z.number(), provider: z.string(), orderId: z.string().nullable(), clickId: z.string().nullable(), status: z.string().nullable(), statusGroup: z.string(), payout: z.number(), currency: z.string().nullable(), campaign: z.string().nullable(), site: z.string().nullable(), country: z.string().nullable(), city: z.string().nullable(), device: z.string().nullable(), matched: z.boolean(), receivedAt: z.string() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ integrationId, statusGroup, limit }) => toolResult(access, "get_postback_events", async () => {
    ensureScope(access, "postbacks:read");
    if (integrationId) {
      const integration = await getDb().prepare("SELECT id FROM postback_integrations WHERE id = ? AND user_id = ?").get(integrationId, access.userId);
      if (!integration) throw new Error("Integração não encontrada nesta conta.");
    }
    let sql = `SELECT e.id, e.integration_id, e.provider, e.external_event_id, e.click_id, e.status, e.status_group, e.payout, e.currency, e.utm_campaign, e.received_at,
      v.country_name, v.city, v.device_type, v.id AS visit_id, s.name AS site_name FROM postback_events e
      LEFT JOIN tracking_visits v ON v.id = e.tracking_visit_id LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id WHERE e.user_id = ?`;
    const args: unknown[] = [access.userId];
    if (integrationId) { sql += " AND e.integration_id = ?"; args.push(integrationId); }
    if (statusGroup) { sql += " AND e.status_group = ?"; args.push(statusGroup); }
    sql += " ORDER BY e.received_at DESC LIMIT ?"; args.push(limit);
    const rows = await getDb().prepare(sql).all(...args) as any[];
    const events = rows.map((row) => ({ id: Number(row.id), integrationId: Number(row.integration_id), provider: String(row.provider), orderId: nullableText(row.external_event_id), clickId: nullableText(row.click_id), status: nullableText(row.status), statusGroup: String(row.status_group), payout: numberValue(row.payout), currency: nullableText(row.currency), campaign: nullableText(row.utm_campaign), site: nullableText(row.site_name), country: nullableText(row.country_name), city: nullableText(row.city), device: nullableText(row.device_type), matched: Boolean(row.visit_id), receivedAt: String(row.received_at) }));
    return { data: { events }, text: `${events.length} evento(s) de postback encontrado(s).` };
  }));

  server.registerTool("list_published_pages", {
    title: "Listar páginas publicadas",
    description: "Lista páginas e presells do usuário com produto, destino, URL publicada e status.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
    outputSchema: { pages: z.array(z.object({ id: z.number(), name: z.string(), destinationUrl: z.string().nullable(), publishedUrl: z.string().nullable(), status: z.string(), createdAt: z.string() })) },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  }, async ({ limit }) => toolResult(access, "list_published_pages", async () => {
    ensureScope(access, "pages:read");
    const rows = await getDb().prepare("SELECT id, product_name, destination_url, published_url, status, created_at FROM presells WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(access.userId, limit) as any[];
    const pages = rows.map((row) => ({ id: Number(row.id), name: String(row.product_name || `Página ${row.id}`), destinationUrl: nullableText(row.destination_url), publishedUrl: nullableText(row.published_url), status: String(row.status || "local"), createdAt: String(row.created_at) }));
    return { data: { pages }, text: `${pages.length} página(s) encontrada(s).` };
  }));

  return server;
}
