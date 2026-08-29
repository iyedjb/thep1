import { Router } from "express";
import crypto from "crypto";
import { getDb } from "../lib/sqlite";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";

const router = Router();

const PROVIDERS = {
  lemonad: {
    name: "LemonAD",
    method: "GET",
    template: (endpoint: string) =>
      `${endpoint}?orderid={leadid}&status={status}&clickid={clickid}&amount={payoutOrZero}&utm_campaign={utmCampaign}&utm_content={utmContent}&utm_medium={utmMedium}&utm_source={utmSource}&utm_term={utmTerm}&global_source={globalSource}`,
  },
} as const;

type ProviderId = keyof typeof PROVIDERS;

function providerId(storageProvider: string) {
  return storageProvider.split(":", 1)[0] as ProviderId;
}

function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

function providerStorageKey(provider: ProviderId) {
  return `${provider}:${crypto.randomBytes(8).toString("hex")}`;
}

function requestBaseUrl(req: any) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return `${forwardedProtocol || req.protocol}://${forwardedHost || req.get("host")}`.replace(/\/$/, "");
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const privateHost = host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local")
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return url.protocol === "https:" && !privateHost;
  } catch {
    return false;
  }
}

function publicBaseUrl(req: any) {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
  const requested = requestBaseUrl(req);
  if (isPublicHttpsUrl(configured)) return configured;
  if (isPublicHttpsUrl(requested)) return requested;
  return configured || requested;
}

function endpoint(req: any, provider: ProviderId, token: string) {
  return `${publicBaseUrl(req)}/api/postback/${provider}/${token}`;
}

function firstValue(payload: Record<string, any>, names: string[], maxLength = 2048) {
  for (const name of names) {
    const raw = payload[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim().slice(0, maxLength);
    }
  }
  return "";
}

function statusGroup(status: string) {
  const normalized = status.toLowerCase();
  if (/paid|payment|payout|pago|pagamento|deposit|ftd/.test(normalized)) return "paid";
  if (/sale|confirm|approved|approve|success|complete|converted|conversion|purchase|aprov|vend/.test(normalized)) return "approved";
  if (/reject|rejected|trash|invalid|declin|cancel|rejeit|recus|duplic/.test(normalized)) return "rejected";
  return "pending";
}

function safePayload(payload: Record<string, any>) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(payload).slice(0, 50).map(([key, raw]) => {
      const value = Array.isArray(raw) ? raw[0] : raw;
      return [key.slice(0, 100), String(value ?? "").slice(0, 2048)];
    }),
  ));
}

async function integrationJson(req: any, integration: any) {
  const provider = providerId(integration.provider);
  const definition = PROVIDERS[provider];
  const callbackBaseUrl = publicBaseUrl(req);
  const publiclyReachable = isPublicHttpsUrl(callbackBaseUrl);
  const activity = await getDb().prepare(
    "SELECT MAX(received_at) AS last_event_at, MAX(CASE WHEN tracking_visit_id IS NOT NULL THEN received_at ELSE NULL END) AS last_matched_event_at FROM postback_events WHERE integration_id = ?"
  ).get(integration.id) as any;
  const expired = Boolean(integration.expires_at && new Date(integration.expires_at).getTime() <= Date.now());
  const connectionStatus = expired
    ? "expired"
    : !integration.enabled
    ? "disabled"
    : !publiclyReachable
      ? "needs_public_url"
      : activity?.last_event_at
        ? "receiving"
        : "ready";
  const callbackEndpoint = endpoint(req, provider, integration.token);

  return {
    id: integration.id,
    name: integration.name || definition.name,
    provider,
    providerName: definition.name,
    method: definition.method,
    publiclyReachable,
    connectionStatus,
    lastEventAt: activity?.last_event_at || null,
    lastMatchedEventAt: activity?.last_matched_event_at || null,
    lastTestedAt: integration.last_tested_at || null,
    expiresAt: integration.expires_at || null,
    template: definition.template(callbackEndpoint),
  };
}

router.get("/postback/providers", requireAuth, (_req, res) => {
  res.json(Object.entries(PROVIDERS).map(([id, provider]) => ({ id, name: provider.name, method: provider.method })));
});

router.get("/postback/integrations", requireAuth, async (req: any, res) => {
  try {
    const integrations = await getDb().prepare(
      "SELECT id, provider, token, name, expires_at, last_tested_at, enabled FROM postback_integrations WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.userId) as any[];
    const supported = integrations.filter((item) => isProviderId(providerId(item.provider)));
    res.json(await Promise.all(supported.map((item) => integrationJson(req, item))));
  } catch (error: any) {
    logger.error({ err: error.message, userId: req.userId }, "Unable to list postback integrations");
    res.status(500).json({ error: "Não foi possível carregar as APIs." });
  }
});

router.post("/postback/integrations", requireAuth, async (req: any, res) => {
  const provider = String(req.body?.provider || "").toLowerCase();
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const expirationDays = req.body?.expirationDays === null ? null : Number(req.body?.expirationDays);
  if (!isProviderId(provider)) {
    res.status(400).json({ error: "Plataforma não suportada." });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "Dê um nome para a API." });
    return;
  }
  if (expirationDays !== null && ![30, 60, 90].includes(expirationDays)) {
    res.status(400).json({ error: "Validade inválida." });
    return;
  }

  try {
    const db = getDb();
    const expiresAt = expirationDays === null
      ? null
      : new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await db.prepare(
      "INSERT INTO postback_integrations (user_id, provider, token, name, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(req.userId, providerStorageKey(provider), crypto.randomUUID(), name, expiresAt);
    const integration = await db.prepare(
      "SELECT id, provider, token, name, expires_at, last_tested_at, enabled FROM postback_integrations WHERE id = ?"
    ).get(Number(result.lastInsertRowid)) as any;

    res.status(201).json(await integrationJson(req, integration));
  } catch (error: any) {
    logger.error({ err: error.message, userId: req.userId, provider }, "Unable to create postback integration");
    res.status(500).json({ error: "Não foi possível criar a API." });
  }
});

router.post("/postback/integrations/:id/test", requireAuth, async (req: any, res) => {
  try {
    const integration = await getDb().prepare(
      "SELECT id, provider, token, name, expires_at, last_tested_at, enabled FROM postback_integrations WHERE id = ? AND user_id = ?"
    ).get(Number(req.params.id), req.userId) as any;
    if (!integration) {
      res.status(404).json({ error: "API não encontrada." });
      return;
    }
    if (!integration.enabled || (integration.expires_at && new Date(integration.expires_at).getTime() <= Date.now())) {
      res.status(409).json({ error: "Esta API não está ativa." });
      return;
    }
    const provider = providerId(integration.provider);
    const publicTest = isPublicHttpsUrl(publicBaseUrl(req));
    const signature = crypto.createHash("sha256").update(`cliclab-test:${integration.token}`).digest("hex");
    const testBase = publicTest ? publicBaseUrl(req) : requestBaseUrl(req);
    const testUrl = new URL(`${testBase}/api/postback/${provider}/${integration.token}`);
    testUrl.searchParams.set("__cliclab_test", signature);
    const response = await fetch(testUrl, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok || (await response.text()).trim() !== "OK") {
      throw new Error(`Callback de teste respondeu com HTTP ${response.status}`);
    }

    const refreshed = await getDb().prepare(
      "SELECT id, provider, token, name, expires_at, last_tested_at, enabled FROM postback_integrations WHERE id = ?"
    ).get(integration.id) as any;
    res.json({ ok: true, scope: publicTest ? "public" : "local", integration: await integrationJson(req, refreshed) });
  } catch (error: any) {
    logger.error({ err: error.message, userId: req.userId }, "Unable to test postback integration");
    res.status(502).json({ error: "O endpoint não respondeu ao teste externo." });
  }
});

router.get("/postback/integrations/:id/events", requireAuth, async (req: any, res) => {
  try {
    const integration = await getDb().prepare(
      "SELECT id, provider, name FROM postback_integrations WHERE id = ? AND user_id = ?"
    ).get(Number(req.params.id), req.userId) as any;
    if (!integration || !isProviderId(providerId(integration.provider))) {
      res.status(404).json({ error: "API não encontrada." });
      return;
    }

    const provider = providerId(integration.provider);
    const rows = await getDb().prepare(
      `SELECT e.id, e.external_event_id, e.click_id, e.status, e.status_group, e.payout, e.currency,
              e.raw_payload, e.received_at, v.id AS visit_id, v.ip_address, v.country_name, v.city,
              v.device_type, v.browser, v.operating_system, v.page_path, v.referrer,
              s.id AS site_id, s.name AS site_name, s.slug AS site_slug
       FROM postback_events e
       LEFT JOIN tracking_visits v ON v.id = e.tracking_visit_id
       LEFT JOIN tracking_sites s ON s.id = v.tracking_site_id
       WHERE e.integration_id = ? AND e.user_id = ?
       ORDER BY e.received_at DESC, e.id DESC
       LIMIT 200`
    ).all(integration.id, req.userId) as any[];

    res.json({
      integration: {
        id: integration.id,
        name: integration.name || PROVIDERS[provider].name,
        provider,
        providerName: PROVIDERS[provider].name,
      },
      events: rows.map((event) => {
        let payload: Record<string, string> = {};
        try { payload = JSON.parse(String(event.raw_payload || "{}")); } catch {}
        const phone = firstValue(payload, ["phone", "phone_number", "telephone", "tel"], 80) || null;
        const customerName = firstValue(payload, ["name", "customer_name", "customerName", "fio"], 200) || null;
        return {
          id: Number(event.id),
          sender: PROVIDERS[provider].name,
          orderId: event.external_event_id || null,
          clickId: event.click_id || null,
          status: event.status,
          statusGroup: event.status_group,
          payout: Number(event.payout || 0),
          currency: event.currency || null,
          phone,
          customerName,
          receivedAt: event.received_at,
          matched: Boolean(event.visit_id),
          site: event.site_id ? { id: Number(event.site_id), name: event.site_name, slug: event.site_slug } : null,
          visitor: event.visit_id ? {
            ip: event.ip_address || null,
            country: event.country_name || null,
            city: event.city || null,
            device: event.device_type || null,
            browser: event.browser || null,
            operatingSystem: event.operating_system || null,
            pagePath: event.page_path || null,
            referrer: event.referrer || null,
          } : null,
          payload,
        };
      }),
    });
  } catch (error: any) {
    logger.error({ err: error.message, userId: req.userId }, "Unable to load postback events");
    res.status(500).json({ error: "Não foi possível carregar os eventos da API." });
  }
});

async function receivePostback(req: any, res: any) {
  const provider = String(req.params.provider || "").toLowerCase();
  const token = String(req.params.token || "");
  if (!isProviderId(provider) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    res.status(404).type("text/plain").send("NOT FOUND");
    return;
  }

  try {
    const db = getDb();
    const integration = await db.prepare(
      `SELECT id, user_id, token, expires_at FROM postback_integrations
       WHERE token = ? AND (provider = ? OR provider LIKE ?) AND enabled = true`
    ).get(token, provider, `${provider}:%`) as any;
    if (!integration || (integration.expires_at && new Date(integration.expires_at).getTime() <= Date.now())) {
      res.status(404).type("text/plain").send("NOT FOUND");
      return;
    }

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const payload = { ...req.query, ...body } as Record<string, any>;
    const testSignature = firstValue(payload, ["__cliclab_test"], 64);
    if (testSignature) {
      const expected = crypto.createHash("sha256").update(`cliclab-test:${integration.token}`).digest("hex");
      const suppliedBuffer = Buffer.from(testSignature);
      const expectedBuffer = Buffer.from(expected);
      if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
        res.status(403).type("text/plain").send("INVALID TEST");
        return;
      }
      await db.prepare("UPDATE postback_integrations SET last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(integration.id);
      res.status(200).type("text/plain").send("OK");
      return;
    }
    const externalEventId = firstValue(payload, ["orderid", "order_id", "leadid", "lead_id", "transaction_id"], 255);
    const clickId = firstValue(payload, ["clickid", "click_id", "subid", "sub_id", "cid"], 255);
    const status = firstValue(payload, ["status", "lead_status", "cnv_status"], 100) || "unknown";
    if (!externalEventId && !clickId) {
      res.status(400).type("text/plain").send("MISSING IDENTIFIER");
      return;
    }

    const amountValue = firstValue(payload, ["amount", "payout", "payoutOrZero", "revenue"], 40).replace(",", ".");
    const parsedAmount = Number(amountValue);
    const payout = Number.isFinite(parsedAmount) ? Math.max(-1_000_000_000, Math.min(1_000_000_000, parsedAmount)) : 0;
    const currency = firstValue(payload, ["currency", "cy"], 16).toUpperCase();
    const utmCampaign = firstValue(payload, ["utm_campaign", "utmCampaign"], 2048);
    const utmContent = firstValue(payload, ["utm_content", "utmContent"], 2048);
    const utmMedium = firstValue(payload, ["utm_medium", "utmMedium"], 2048);
    const utmSource = firstValue(payload, ["utm_source", "utmSource", "global_source", "globalSource"], 2048);
    const utmTerm = firstValue(payload, ["utm_term", "utmTerm"], 2048);
    const group = statusGroup(status);
    const eventKey = crypto.createHash("sha256")
      .update([externalEventId, clickId, status.toLowerCase(), payout, currency].join("|"))
      .digest("hex");
    const visit = clickId
      ? await db.prepare("SELECT id FROM tracking_visits WHERE visit_token = ? AND user_id = ?").get(clickId, integration.user_id) as any
      : null;
    const existing = await db.prepare("SELECT id FROM postback_events WHERE integration_id = ? AND event_key = ?")
      .get(integration.id, eventKey) as any;

    if (!existing) {
      await db.prepare(
        `INSERT INTO postback_events
          (integration_id, user_id, tracking_visit_id, provider, event_key, external_event_id, click_id, status, status_group, payout, currency, utm_campaign, utm_content, utm_medium, utm_source, utm_term, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        integration.id, integration.user_id, visit?.id || null, provider, eventKey,
        externalEventId || null, clickId || null, status, group, payout, currency || null,
        utmCampaign || null, utmContent || null, utmMedium || null, utmSource || null, utmTerm || null,
        safePayload(payload),
      );
    }

    logger.info({ provider, userId: integration.user_id, status, matchedVisit: Boolean(visit) }, "Postback received");
    res.status(200).type("text/plain").send("OK");
  } catch (error: any) {
    logger.error({ err: error.message, provider }, "Unable to process postback");
    res.status(500).type("text/plain").send("ERROR");
  }
}

router.route("/postback/:provider/:token").get(receivePostback).post(receivePostback);

export default router;
