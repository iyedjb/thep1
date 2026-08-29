import { Router } from "express";
import crypto from "crypto";
import { getDb } from "../lib/sqlite";
import { logger } from "../lib/logger";
import { recordTrackingVisit, type TrackingSite } from "../lib/tracking";
import { requireAuth } from "./auth";

const router = Router();

function publicBaseUrl(req: any) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return String(process.env.PUBLIC_APP_URL || `${forwardedProtocol || req.protocol}://${forwardedHost || req.get("host")}`).replace(/\/$/, "");
}

const RESERVED_SLUGS = new Set([
  "api", "admin", "assets", "campaigns", "checkout", "creator", "dashboard", "domains",
  "drcash", "favicon", "google-trends", "keywords", "login", "p", "pricing", "reports",
  "signup", "support", "tracking", "traffic-manager", "trends",
]);

function normalizeSlug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

async function ensureSiteSlug(site: any) {
  const current = String(site.slug || "");
  if (current && !current.startsWith(`site-${Number(site.id)}-`)) return current;
  const friendly = normalizeSlug(String(site.name || ""));
  if (friendly.length >= 3 && !RESERVED_SLUGS.has(friendly)) {
    const collision = await getDb().prepare("SELECT id FROM tracking_sites WHERE slug = ? AND id <> ?").get(friendly, site.id) as any;
    if (!collision) {
      await getDb().prepare("UPDATE tracking_sites SET slug = ? WHERE id = ?").run(friendly, site.id);
      return friendly;
    }
  }
  const fallback = `site-${Number(site.id)}-${String(site.site_key).slice(0, 6)}`;
  await getDb().prepare("UPDATE tracking_sites SET slug = ? WHERE id = ?").run(fallback, site.id);
  return fallback;
}

function installationSnippet(baseUrl: string, siteKey: string) {
  return `<!-- Cole este código dentro de <head> -->\n<script async src="${baseUrl}/api/tracker.js" data-site="${siteKey}"></script>`;
}

function pageMetadata(pagePath: string) {
  try {
    const url = new URL(pagePath || "/", "https://tracking.local");
    const parameters = Object.fromEntries(url.searchParams.entries());
    const clickKeys = ["gclid", "wbraid", "gbraid", "msclkid", "ttclid", "fbclid", "raclid", "clickid"];
    const clickKey = clickKeys.find((key) => Boolean(parameters[key]));
    return {
      pageUrl: pagePath || null,
      parameters,
      clickIdType: clickKey ? clickKey.toUpperCase() : null,
      clickId: clickKey ? parameters[clickKey] : null,
    };
  } catch {
    return { pageUrl: pagePath || null, parameters: {}, clickIdType: null, clickId: null };
  }
}

function visitDetails(visit: any) {
  const page = pageMetadata(String(visit.page_path || ""));
  return {
    clientId: visit.visit_token || null,
    visitorId: visit.visitor_key || null,
    ip: visit.ip_address || null,
    countryCode: visit.country_code || null,
    country: visit.country_name || null,
    city: visit.city || null,
    device: visit.device_type || null,
    browser: visit.browser || null,
    operatingSystem: visit.operating_system || null,
    userAgent: visit.user_agent || null,
    viewportWidth: visit.viewport_width ? Number(visit.viewport_width) : null,
    viewportHeight: visit.viewport_height ? Number(visit.viewport_height) : null,
    screenWidth: visit.screen_width ? Number(visit.screen_width) : null,
    screenHeight: visit.screen_height ? Number(visit.screen_height) : null,
    origin: visit.referrer || null,
    pageUrl: page.pageUrl,
    parameters: page.parameters,
    clickIdType: page.clickIdType,
    clickId: page.clickId,
    clickCount: Number(visit.clicks || 0),
    clickedAt: visit.clicked_at || null,
  };
}

router.get("/tracker.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "public, max-age=300").send(`(function(){
var s=document.currentScript,k=s&&s.getAttribute('data-site');if(!k)return;
var o=new URL(s.src).origin,t=s.getAttribute('data-visit-token')||'';
function c(){if(!t)return;var b=JSON.stringify({token:t,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,screenWidth:screen.width,screenHeight:screen.height});try{fetch(o+'/api/tracking/context',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true,credentials:'omit'});}catch(_){}}
function d(){if(!t)return;var r=function(){document.querySelectorAll('a[href]').forEach(function(a){try{var u=new URL(a.getAttribute('href')||'',location.href);if(!/^https?:$/.test(u.protocol)||u.origin===location.origin)return;u.searchParams.set('clickid',t);a.setAttribute('href',u.toString());}catch(_){}});document.querySelectorAll('form').forEach(function(f){var x=f.querySelectorAll('input[name="clickid"]');if(x.length){x.forEach(function(i){i.value=t;});}else{var i=document.createElement('input');i.type='hidden';i.name='clickid';i.value=t;f.appendChild(i);}});};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',r,{once:true});else r();}
if(t){d();c();}else fetch(o+'/api/tracking/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:k,pageUrl:location.href,referrer:document.referrer}),keepalive:true,credentials:'omit'}).then(function(r){return r.ok?r.json():null}).then(function(v){t=v&&v.token||'';d();c();}).catch(function(){});
document.addEventListener('click',function(e){var n=e.target&&e.target.closest?e.target.closest('a,button,[role="button"],input[type="submit"]'):null;if(!n||!t)return;var b=JSON.stringify({token:t});try{if(navigator.sendBeacon)navigator.sendBeacon(o+'/api/tracking/click',new Blob([b],{type:'application/json'}));else fetch(o+'/api/tracking/click',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true,credentials:'omit'});}catch(_){ }},true);
})();`);
});

router.post("/tracking/visit", async (req, res) => {
  const siteKey = String(req.body?.siteKey || "");
  if (!/^[a-f0-9]{48}$/.test(siteKey)) {
    res.status(400).json({ error: "Identificador de rastreamento inválido." });
    return;
  }
  try {
    const site = await getDb().prepare("SELECT * FROM tracking_sites WHERE site_key = ? AND status = 'active'").get(siteKey) as TrackingSite | undefined;
    if (!site) {
      res.status(404).json({ error: "Rastreador não encontrado." });
      return;
    }
    const token = await recordTrackingVisit(
      req,
      site,
      String(req.body?.pageUrl || "").slice(0, 2048),
      String(req.body?.referrer || "").slice(0, 2048),
    );
    res.json({ token });
  } catch (error: any) {
    logger.warn({ err: error.message }, "Unable to register external visit");
    res.status(500).json({ error: "Não foi possível registrar a visita." });
  }
});

router.post("/tracking/sites", requireAuth, async (req: any, res) => {
  const slug = normalizeSlug(String(req.body?.slug || req.body?.name || ""));
  const name = String(req.body?.name || slug).trim().replace(/\s+/g, " ").slice(0, 80) || slug;
  if (slug.length < 3) {
    res.status(400).json({ error: "O endereço precisa ter pelo menos 3 caracteres." });
    return;
  }
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ error: "Este endereço é reservado. Escolha outro nome." });
    return;
  }
  try {
    const siteKey = crypto.randomBytes(24).toString("hex");
    const result = await getDb().prepare(
      "INSERT INTO tracking_sites (user_id, name, site_key, slug) VALUES (?, ?, ?, ?)"
    ).run(req.userId, name, siteKey, slug);
    const baseUrl = publicBaseUrl(req);
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      name,
      siteKey,
      slug,
      publicUrl: `${baseUrl}/${slug}`,
      trackingAddress: `${baseUrl}/${slug}`,
      snippet: installationSnippet(baseUrl, siteKey),
      status: "active",
    });
  } catch (error: any) {
    if (/unique|duplicate/i.test(String(error.message))) {
      res.status(409).json({ error: "Este endereço já está em uso. Escolha outro nome." });
      return;
    }
    logger.error({ err: error.message }, "Unable to create tracking site");
    res.status(500).json({ error: "Não foi possível criar o domínio." });
  }
});

router.get("/tracking/sites", requireAuth, async (req: any, res) => {
  try {
    const rows = await getDb().prepare(
      "SELECT id, name, site_key, slug, status, presell_id, created_at FROM tracking_sites WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.userId) as any[];
    const baseUrl = publicBaseUrl(req);
    const sites = await Promise.all(rows.map(async (site) => {
      const slug = await ensureSiteSlug(site);
      return {
        id: Number(site.id), name: site.name, siteKey: site.site_key, slug, status: site.status,
        presellId: site.presell_id ? Number(site.presell_id) : null,
        publicUrl: `${baseUrl}/${slug}`,
        trackingAddress: `${baseUrl}/${slug}`,
        snippet: installationSnippet(baseUrl, site.site_key),
      };
    }));
    res.json({ baseUrl, sites });
  } catch (error: any) {
    logger.error({ err: error.message }, "Unable to list tracking sites");
    res.status(500).json({ error: "Não foi possível carregar os domínios." });
  }
});

router.post("/tracking/click", async (req, res) => {
  const token = String(req.body?.token || "");
  if (!/^[a-f0-9]{48}$/.test(token)) {
    res.status(204).end();
    return;
  }
  try {
    await getDb().prepare(
      "UPDATE tracking_visits SET clicks = clicks + 1, clicked_at = CURRENT_TIMESTAMP WHERE visit_token = ?"
    ).run(token);
  } catch (error: any) {
    logger.warn({ err: error.message }, "Unable to register tracked click");
  }
  res.status(204).end();
});

router.post("/tracking/context", async (req, res) => {
  const token = String(req.body?.token || "");
  if (!/^[a-f0-9]{48}$/.test(token)) return void res.status(204).end();
  const dimension = (value: unknown) => {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 16_000 ? parsed : null;
  };
  const viewportWidth = dimension(req.body?.viewportWidth);
  const viewportHeight = dimension(req.body?.viewportHeight);
  const screenWidth = dimension(req.body?.screenWidth);
  const screenHeight = dimension(req.body?.screenHeight);
  const effectiveWidth = viewportWidth || screenWidth;
  const device = effectiveWidth ? (effectiveWidth <= 767 ? "mobile" : effectiveWidth <= 1100 ? "tablet" : "desktop") : null;
  try {
    await getDb().prepare(
      `UPDATE tracking_visits SET viewport_width = ?, viewport_height = ?, screen_width = ?, screen_height = ?,
       device_type = COALESCE(?, device_type) WHERE visit_token = ?`
    ).run(viewportWidth, viewportHeight, screenWidth, screenHeight, device, token);
  } catch (error: any) {
    logger.warn({ err: error.message }, "Unable to enrich tracked visit");
  }
  res.status(204).end();
});

router.get("/tracking/activity", requireAuth, async (req: any, res) => {
  try {
    const days = req.query.period === "30d" ? 30 : req.query.period === "90d" ? 90 : 7;
    const requestedSite = Number(req.query.siteId || 0);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    const db = getDb();
    const sites = await db.prepare(
      "SELECT id, name, slug FROM tracking_sites WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.userId) as any[];
    const allowedSiteIds = new Set(sites.map((site) => Number(site.id)));
    const siteId = requestedSite && allowedSiteIds.has(requestedSite) ? requestedSite : 0;
    const visits = siteId
      ? await db.prepare(
          `SELECT v.*, s.name AS site_name FROM tracking_visits v
           LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id
           WHERE v.user_id = ? AND v.tracking_site_id = ? AND v.created_at >= ?
           ORDER BY v.created_at DESC LIMIT 150`
        ).all(req.userId, siteId, since) as any[]
      : await db.prepare(
          `SELECT v.*, s.name AS site_name FROM tracking_visits v
           LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id
           WHERE v.user_id = ? AND v.created_at >= ?
           ORDER BY v.created_at DESC LIMIT 150`
        ).all(req.userId, since) as any[];
    const postbacks = await db.prepare(
      `SELECT e.*, i.name AS integration_name,
              v.tracking_site_id, v.visit_token, v.visitor_key, v.ip_address, v.country_code,
              v.country_name, v.city, v.device_type, v.browser, v.operating_system, v.user_agent,
              v.viewport_width, v.viewport_height, v.screen_width, v.screen_height,
              v.referrer, v.page_path, v.traffic_source, v.clicks, v.clicked_at,
              s.name AS site_name
       FROM postback_events e
       LEFT JOIN postback_integrations i ON i.id = e.integration_id
       LEFT JOIN tracking_visits v ON v.id = e.tracking_visit_id
       LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id
       WHERE e.user_id = ? AND e.received_at >= ?
       ORDER BY e.received_at DESC LIMIT 150`
    ).all(req.userId, since) as any[];

    const events: any[] = [];
    for (const visit of visits) {
      const location = [visit.city, visit.country_name].filter(Boolean).join(", ") || "Local não identificado";
      events.push({
        id: `visit-${visit.id}`,
        type: "visit",
        title: "Novo acesso",
        description: `${location} · ${visit.device_type || "Dispositivo desconhecido"}`,
        siteId: visit.tracking_site_id ? Number(visit.tracking_site_id) : null,
        siteName: visit.site_name || "Página publicada",
        source: visit.traffic_source || "organic",
        occurredAt: visit.created_at,
        details: visitDetails(visit),
      });
      if (visit.clicked_at) {
        events.push({
          id: `click-${visit.id}`,
          type: "click",
          title: Number(visit.clicks || 0) > 1 ? `${visit.clicks} cliques na página` : "Clique na página",
          description: "O visitante interagiu com uma chamada para ação.",
          siteId: visit.tracking_site_id ? Number(visit.tracking_site_id) : null,
          siteName: visit.site_name || "Página publicada",
          source: visit.traffic_source || "organic",
          occurredAt: visit.clicked_at,
          details: visitDetails(visit),
        });
      }
    }

    const postbackTitles: Record<string, string> = {
      pending: "Novo lead",
      approved: "Lead aprovado",
      rejected: "Lead rejeitado",
      paid: "Pagamento recebido",
    };
    for (const event of postbacks) {
      if (siteId && Number(event.tracking_site_id) !== siteId) continue;
      const attributedVisit = visitDetails(event);
      const amount = Number(event.payout || 0);
      const monetary = amount
        ? ` · ${String(event.currency || "USD").toUpperCase()} ${amount.toFixed(2)}`
        : "";
      events.push({
        id: `postback-${event.id}`,
        type: event.status_group,
        title: postbackTitles[event.status_group] || "Atualização de lead",
        description: `${event.external_event_id || event.click_id || "Lead sem identificador"}${monetary}`,
        siteId: event.tracking_site_id ? Number(event.tracking_site_id) : null,
        siteName: event.site_name || "Sem atribuição a uma página",
        source: "postback",
        occurredAt: event.received_at,
        details: {
          ...attributedVisit,
          sender: event.provider || null,
          integrationName: event.integration_name || null,
          orderId: event.external_event_id || null,
          clickId: event.click_id || attributedVisit.clickId,
          clickIdType: event.click_id ? "CLICKID" : attributedVisit.clickIdType,
          status: event.status || null,
          statusGroup: event.status_group || null,
          payout: Number(event.payout || 0),
          currency: event.currency || null,
          campaign: event.utm_campaign || null,
          matched: Boolean(event.tracking_visit_id),
          payload: (() => {
            try { return JSON.parse(String(event.raw_payload || "{}")); } catch { return {}; }
          })(),
        },
      });
    }

    const eventPriority: Record<string, number> = { visit: 0, click: 1, pending: 2, approved: 3, rejected: 3, paid: 4 };
    events.sort((a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      || (eventPriority[b.type] || 0) - (eventPriority[a.type] || 0)
    );
    res.json({ period: `${days}d`, sites, events: events.slice(0, 200) });
  } catch (error: any) {
    logger.error({ err: error.message, userId: req.userId }, "Unable to load activity");
    res.status(500).json({ error: "Não foi possível carregar a atividade." });
  }
});

router.get("/tracking/overview", requireAuth, async (req: any, res) => {
  try {
    const days = req.query.period === "30d" ? 30 : req.query.period === "90d" ? 90 : 7;
    const source = req.query.source === "paid" ? "paid" : req.query.source === "organic" ? "organic" : "all";
    const requestedSite = Number(req.query.siteId || 0);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const db = getDb();
    const presells = await db.prepare(
      `SELECT id, product_name, destination_url, published_url, status, created_at
       FROM presells WHERE user_id = ? ORDER BY created_at DESC`
    ).all(req.userId) as any[];
    const sites = await db.prepare(
      "SELECT id, presell_id, name, site_key, slug, status, created_at FROM tracking_sites WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.userId) as any[];
    for (const site of sites) site.slug = await ensureSiteSlug(site);
    const allowedSiteIds = new Set(sites.map((item) => Number(item.id)));
    const selectedSite = requestedSite && allowedSiteIds.has(requestedSite) ? requestedSite : 0;
    const visits = selectedSite
      ? await db.prepare("SELECT * FROM tracking_visits WHERE user_id = ? AND tracking_site_id = ? AND created_at >= ? ORDER BY created_at DESC").all(req.userId, selectedSite, since)
      : await db.prepare("SELECT * FROM tracking_visits WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC").all(req.userId, since);
    const postbackEvents = await db.prepare(
      `SELECT e.*, v.tracking_site_id, v.traffic_source AS visit_traffic_source
       FROM postback_events e
       LEFT JOIN tracking_visits v ON v.id = e.tracking_visit_id
       WHERE e.user_id = ? AND e.received_at >= ?
       ORDER BY e.received_at DESC, e.id DESC`
    ).all(req.userId, since) as any[];

    const unfilteredRows = visits as any[];
    const rows = source === "all" ? unfilteredRows : unfilteredRows.filter((row) => String(row.traffic_source || "organic") === source);
    const eventSource = (event: any) => {
      if (event.visit_traffic_source) return String(event.visit_traffic_source);
      const medium = String(event.utm_medium || "").toLowerCase();
      return /^(cpc|ppc|paid|paidsearch|paid-social|display|affiliate)$/.test(medium) ? "paid" : "organic";
    };
    const scopedEvents = postbackEvents.filter((event) =>
      (!selectedSite || Number(event.tracking_site_id) === selectedSite)
      && (source === "all" || eventSource(event) === source)
    );
    const latestLeadEvents = new Map<string, any>();
    for (const event of scopedEvents) {
      const leadKey = `${event.provider}:${event.external_event_id || event.click_id || event.event_key}`;
      if (!latestLeadEvents.has(leadKey)) latestLeadEvents.set(leadKey, event);
    }
    const leadEvents = [...latestLeadEvents.values()];
    const approvedLeadEvents = leadEvents.filter((event) => event.status_group === "approved" || event.status_group === "paid");
    const paidLeadEvents = leadEvents.filter((event) => event.status_group === "paid");
    const revenueEvents = paidLeadEvents.length ? paidLeadEvents : approvedLeadEvents;
    const revenueByCurrencyMap = new Map<string, number>();
    for (const event of revenueEvents) {
      const currency = String(event.currency || "USD").toUpperCase();
      revenueByCurrencyMap.set(currency, (revenueByCurrencyMap.get(currency) || 0) + Number(event.payout || 0));
    }
    const revenueByCurrency = [...revenueByCurrencyMap.entries()].map(([currency, amount]) => ({ currency, amount }));
    const uniqueVisitors = new Set(rows.map((row) => row.visitor_key)).size;
    const engagedVisits = rows.filter((row) => Number(row.clicks || 0) > 0).length;
    const clickEvents = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayVisits = rows.filter((row) => String(row.created_at).slice(0, 10) === todayKey).length;

    const countBy = (key: string, fallback: string) => {
      const totals = new Map<string, number>();
      for (const row of rows) {
        const label = String(row[key] || fallback);
        totals.set(label, (totals.get(label) || 0) + 1);
      }
      return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    };

    const trackedPresellIds = new Set(sites.filter((site) => site.presell_id).map((site) => Number(site.presell_id)));
    const siteStats = sites.map((site) => {
      const pageVisits = rows.filter((row) => Number(row.tracking_site_id) === Number(site.id));
      const pageLeadEvents = leadEvents.filter((event) => Number(event.tracking_site_id) === Number(site.id));
      const pageConversions = pageLeadEvents.filter((event) => event.status_group === "approved" || event.status_group === "paid");
      const pageRevenueEvents = pageLeadEvents.some((event) => event.status_group === "paid")
        ? pageLeadEvents.filter((event) => event.status_group === "paid")
        : pageConversions;
      const clicks = pageVisits.filter((row) => Number(row.clicks || 0) > 0).length;
      const total = pageVisits.length;
      return {
        id: Number(site.id),
        name: site.name,
        url: `${publicBaseUrl(req)}/${site.slug}`,
        snippet: installationSnippet(publicBaseUrl(req), site.site_key),
        status: site.status,
        visits: total,
        clicks,
        conversions: pageConversions.length,
        revenue: pageRevenueEvents.reduce((sum, event) => sum + Number(event.payout || 0), 0),
        clickRate: total ? Math.round((clicks / total) * 100) : 0,
        escapeRate: total ? Math.round(((total - clicks) / total) * 100) : 0,
      };
    });
    const legacyPresellStats = presells.filter((presell) => !trackedPresellIds.has(Number(presell.id))).map((presell) => {
      const pageVisits = rows.filter((row) => Number(row.presell_id) === Number(presell.id));
      const clicks = pageVisits.filter((row) => Number(row.clicks || 0) > 0).length;
      const total = pageVisits.length;
      return { id: `presell-${presell.id}`, name: presell.product_name || `Presell ${presell.id}`, url: presell.published_url || presell.destination_url, status: presell.status, visits: total, clicks, conversions: 0, revenue: 0, clickRate: total ? Math.round((clicks / total) * 100) : 0, escapeRate: total ? Math.round(((total - clicks) / total) * 100) : 0 };
    });
    const pageStats = [...siteStats, ...legacyPresellStats].sort((a, b) => b.visits - a.visits);

    const dailyMap = new Map<string, { visits: number; clicks: number }>();
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      dailyMap.set(date, { visits: 0, clicks: 0 });
    }
    for (const row of rows) {
      const date = new Date(row.created_at).toISOString().slice(0, 10);
      const point = dailyMap.get(date);
      if (point) {
        point.visits += 1;
        if (Number(row.clicks || 0) > 0) point.clicks += 1;
      }
    }

    res.json({
      period: `${days}d`,
      source,
      presells,
      sites: sites.map((site) => ({
        id: Number(site.id),
        name: site.name,
        siteKey: site.site_key,
        slug: site.slug,
        status: site.status,
        publicUrl: `${publicBaseUrl(req)}/${site.slug}`,
        trackingAddress: `${publicBaseUrl(req)}/${site.slug}`,
        snippet: installationSnippet(publicBaseUrl(req), site.site_key),
      })),
      summary: {
        visits: rows.length,
        uniqueVisitors,
        todayVisits,
        engagedVisits,
        clickEvents,
        leads: leadEvents.length,
        approvedLeads: approvedLeadEvents.length,
        paidLeads: paidLeadEvents.length,
        revenue: revenueByCurrency.length === 1 ? revenueByCurrency[0].amount : 0,
        revenueCurrency: revenueByCurrency.length === 1 ? revenueByCurrency[0].currency : null,
        revenueByCurrency,
        escapeRate: rows.length ? Math.round(((rows.length - engagedVisits) / rows.length) * 100) : 0,
      },
      pages: pageStats,
      devices: countBy("device_type", "desktop"),
      countries: countBy("country_name", "Não identificado").slice(0, 8),
      daily: [...dailyMap.entries()].map(([date, values]) => ({ date, ...values })),
      recentVisitors: rows.slice(0, 12).map((row) => ({
        id: row.visit_token.slice(0, 12),
        ip: row.ip_address || "—",
        country: row.country_name || "Não identificado",
        city: row.city || "",
        device: row.device_type,
        browser: row.browser || "Outro",
        operatingSystem: row.operating_system || "Outro",
        clicked: Number(row.clicks || 0) > 0,
        source: row.traffic_source || "organic",
        createdAt: row.created_at,
      })),
      recentConversions: leadEvents.slice(0, 12).map((event) => ({
        id: Number(event.id),
        provider: event.provider,
        orderId: event.external_event_id || "—",
        status: event.status,
        statusGroup: event.status_group,
        payout: Number(event.payout || 0),
        currency: event.currency || null,
        campaign: event.utm_campaign || null,
        site: sites.find((site) => Number(site.id) === Number(event.tracking_site_id))?.name || "Não atribuído",
        matched: Boolean(event.tracking_visit_id),
        receivedAt: event.received_at,
      })),
    });
  } catch (error: any) {
    logger.error({ err: error.message }, "Unable to load tracking overview");
    res.status(500).json({ error: "Não foi possível carregar o rastreamento." });
  }
});

export default router;
