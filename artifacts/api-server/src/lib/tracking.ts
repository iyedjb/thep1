import crypto from "crypto";
import type { Request } from "express";
import { getDb } from "./sqlite";

type PublishedPresell = {
  id: number;
  user_id: number;
  product_name?: string;
};

export type TrackingSite = {
  id: number;
  user_id: number;
  presell_id?: number | null;
  name: string;
  site_key: string;
  slug?: string | null;
};

function header(req: Request, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function normalizeIp(value: string) {
  const first = value.split(",")[0]?.trim() || "unknown";
  return first.replace(/^::ffff:/, "");
}

function countryName(code: string) {
  if (code === "LOCAL") return "Ambiente local";
  if (!code || code === "XX" || code === "T1") return "Não identificado";
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const device = /ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(userAgent)
    ? "tablet"
    : /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)
      ? "mobile"
      : "desktop";

  let browser = "Outro";
  if (/edg\//.test(ua)) browser = "Edge";
  else if (/opr\//.test(ua) || /opera/.test(ua)) browser = "Opera";
  else if (/firefox\//.test(ua)) browser = "Firefox";
  else if (/chrome\//.test(ua) || /crios\//.test(ua)) browser = "Chrome";
  else if (/safari\//.test(ua)) browser = "Safari";

  let operatingSystem = "Outro";
  if (/windows/.test(ua)) operatingSystem = "Windows";
  else if (/iphone|ipad|ipod/.test(ua)) operatingSystem = "iOS";
  else if (/android/.test(ua)) operatingSystem = "Android";
  else if (/mac os|macintosh/.test(ua)) operatingSystem = "macOS";
  else if (/linux/.test(ua)) operatingSystem = "Linux";

  return { device, browser, operatingSystem };
}

function trafficSource(pagePath: string, referrer: string) {
  try {
    const url = new URL(pagePath || "/", "https://tracking.local");
    const medium = String(url.searchParams.get("utm_medium") || "").toLowerCase();
    const paidMarker = ["gclid", "wbraid", "gbraid", "msclkid", "ttclid"]
      .some((key) => Boolean(url.searchParams.get(key)));
    if (paidMarker || /^(cpc|ppc|paid|paidsearch|paid-social|display|affiliate)$/.test(medium)) return "paid";
  } catch {}
  return "organic";
}

async function getOrCreatePresellSite(presell: PublishedPresell): Promise<TrackingSite> {
  const db = getDb();
  const existing = await db.prepare("SELECT * FROM tracking_sites WHERE user_id = ? AND presell_id = ?").get(presell.user_id, presell.id) as TrackingSite | undefined;
  if (existing) return existing;
  const siteKey = crypto.randomBytes(24).toString("hex");
  try {
    const inserted = await db.prepare(
      "INSERT INTO tracking_sites (user_id, presell_id, name, site_key) VALUES (?, ?, ?, ?)"
    ).run(presell.user_id, presell.id, presell.product_name || `Presell ${presell.id}`, siteKey);
    return { id: Number(inserted.lastInsertRowid), user_id: presell.user_id, presell_id: presell.id, name: presell.product_name || `Presell ${presell.id}`, site_key: siteKey };
  } catch {
    const raced = await db.prepare("SELECT * FROM tracking_sites WHERE user_id = ? AND presell_id = ?").get(presell.user_id, presell.id) as TrackingSite | undefined;
    if (!raced) throw new Error("Unable to create the presell tracker");
    return raced;
  }
}

export async function recordTrackingVisit(req: Request, site: TrackingSite, pagePath?: string, referrer?: string) {
  const userAgent = header(req, "user-agent");
  const ip = normalizeIp(String(req.ip || req.socket.remoteAddress || "unknown"));
  const localRequest = ip === "::1" || ip === "127.0.0.1" || ip === "localhost";
  const geoCode = localRequest
    ? "LOCAL"
    : (header(req, "cf-ipcountry") || header(req, "x-vercel-ip-country") || header(req, "x-country-code") || header(req, "x-geo-country") || "").toUpperCase();
  const rawCity = localRequest
    ? "Localhost"
    : header(req, "cf-ipcity") || header(req, "x-vercel-ip-city") || header(req, "x-geo-city") || "";
  let city = rawCity;
  try { city = decodeURIComponent(rawCity); } catch {}
  const { device, browser, operatingSystem } = parseUserAgent(userAgent);
  const visitToken = crypto.randomBytes(24).toString("hex");
  const visitorKey = crypto.createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");
  const resolvedReferrer = referrer ?? header(req, "referer");
  const resolvedPagePath = pagePath || req.originalUrl;
  const source = trafficSource(resolvedPagePath, resolvedReferrer);

  await getDb().prepare(
    `INSERT INTO tracking_visits
      (presell_id, tracking_site_id, user_id, visit_token, visitor_key, ip_address, country_code, country_name, city, device_type, browser, operating_system, user_agent, referrer, page_path, traffic_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    site.presell_id || null,
    site.id,
    site.user_id,
    visitToken,
    visitorKey,
    ip,
    geoCode,
    countryName(geoCode),
    city,
    device,
    browser,
    operatingSystem,
    userAgent.slice(0, 2048),
    resolvedReferrer,
    resolvedPagePath,
    source,
  );

  return visitToken;
}

export async function recordPublishedVisit(req: Request, presell: PublishedPresell) {
  const site = await getOrCreatePresellSite(presell);
  return recordTrackingVisit(req, site);
}

export function injectTagIntoHead(html: string, tag: string) {
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `  ${tag}\n</head>`);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (openingTag) => `${openingTag}\n  ${tag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (openingTag) => `${openingTag}\n<head>\n  ${tag}\n</head>`);
  }
  const doctype = html.match(/^\s*<!doctype\s+html[^>]*>/i);
  if (doctype) {
    return html.replace(doctype[0], `${doctype[0]}\n<head>\n  ${tag}\n</head>`);
  }
  return `<head>\n  ${tag}\n</head>\n${html}`;
}

export function injectClickTracker(html: string, visitToken: string) {
  // Published pages already contain the external tracker in <head>. Give that
  // script the server-created visit token instead of adding a second listener
  // in <body>, which used to double-count visits and clicks.
  const externalTracker = /<script\b(?=[^>]*\bsrc=["'][^"']*\/api\/tracker\.js(?:\?[^"']*)?["'])[^>]*>/i;
  if (externalTracker.test(html)) {
    let resolvedTracker = "";
    const htmlWithoutTracker = html.replace(externalTracker, (scriptTag) => {
      if (/\bdata-visit-token\s*=/i.test(scriptTag)) {
        resolvedTracker = scriptTag.replace(/\bdata-visit-token\s*=\s*(["'])[^"']*\1/i, `data-visit-token="${visitToken}"`);
      } else {
        resolvedTracker = scriptTag.replace(/>$/, ` data-visit-token="${visitToken}">`);
      }
      return "";
    });
    return injectTagIntoHead(htmlWithoutTracker, resolvedTracker);
  }

  const tracker = `<script data-cliclab-tracker data-visit-token="${visitToken}">(function(){var t=${JSON.stringify(visitToken)};var u='/api/tracking/click';function d(){var r=function(){document.querySelectorAll('a[href]').forEach(function(a){try{var x=new URL(a.getAttribute('href')||'',location.href);if(!/^https?:$/.test(x.protocol)||x.origin===location.origin)return;x.searchParams.set('clickid',t);a.setAttribute('href',x.toString());}catch(_){}});document.querySelectorAll('form').forEach(function(f){var x=f.querySelectorAll('input[name="clickid"]');if(x.length)x.forEach(function(i){i.value=t;});else{var i=document.createElement('input');i.type='hidden';i.name='clickid';i.value=t;f.appendChild(i);}});};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',r,{once:true});else r();}d();document.addEventListener('click',function(e){var n=e.target&&e.target.closest?e.target.closest('a,button,[role="button"],input[type="submit"]'):null;if(!n)return;var b=JSON.stringify({token:t});try{if(navigator.sendBeacon){navigator.sendBeacon(u,new Blob([b],{type:'application/json'}));}else{fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true});}}catch(_){}} ,true);})();</script>`;
  return injectTagIntoHead(html, tracker);
}
