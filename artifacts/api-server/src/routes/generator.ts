import { Router } from "express";
import { requireAuth } from "./auth";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";
import { GoogleGenerativeAI } from "@google/generative-ai";
import puppeteer from "puppeteer";


const router = Router();

type BridgeMode = "presell" | "upsell";

const PRESELL_SKILL = `
Cookie consent presell: create one self-contained index.html for Google Ads bridge pages. Ask no popup-style choice. Use a central consent card by default, with overlay, product logo/name, localized cookie/privacy copy, yes/no/close all redirecting to the affiliate URL, optional expandable offer details, SEO metadata, favicon fallback, tracking tags in head, responsive mobile-first layout, and design matched to the researched landing page.
`;

const UPSELL_SKILL = `
Upsell/order form: create one self-contained index.html for affiliate networks such as Dr.Cash/Kiwi. Use a premium order-form layout with product copy, benefits, product image if available, localized GDPR checkbox, cookie banner, privacy/terms/contact modals, countdown to midnight, tracking tags, and Dr.Cash SDK only when token and stream code are provided. All forms must use class orderForm, name and phone fields, and localized consent text.
`;

async function captureScreenshots(url: string, cookieString: string): Promise<{ desktop: string; mobile: string }> {
  logger.info({ url }, "Launching Puppeteer for screenshots...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1920, height: 1080 });
    
    // Set User-Agent to standard desktop browser
    await desktopPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    // Inject cookies if available
    if (cookieString) {
      try {
        const hostname = new URL(url).hostname;
        const cookieObjects = cookieString.split(';').map(c => {
          const parts = c.trim().split('=');
          if (parts.length >= 2) {
            return {
              name: parts[0],
              value: parts.slice(1).join('='),
              domain: hostname,
              path: '/'
            };
          }
          return null;
        }).filter(Boolean);
        if (cookieObjects.length > 0) {
          await desktopPage.setCookie(...(cookieObjects as any[]));
        }
      } catch (cookieErr: any) {
        logger.warn({ err: cookieErr.message }, "Failed to set cookies in Puppeteer");
      }
    }

    logger.info("Navigating desktop page...");
    await desktopPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Hide scrollbars before screenshot
    await desktopPage.addStyleTag({ content: '::-webkit-scrollbar { display: none !important; } html, body { scrollbar-width: none !important; }' });

    const desktopBuffer = (await desktopPage.screenshot({ fullPage: true, type: 'png' })) as Buffer;
    const desktopBase64 = `data:image/png;base64,${desktopBuffer.toString('base64')}`;

    const mobilePage = await browser.newPage();
    
    // Set mobile viewport (iPhone 13 aspect ratio and layout width)
    await mobilePage.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true
    });
    
    // Set standard mobile User-Agent
    await mobilePage.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1");

    // Inject cookies to mobile page
    if (cookieString) {
      try {
        const hostname = new URL(url).hostname;
        const cookieObjects = cookieString.split(';').map(c => {
          const parts = c.trim().split('=');
          if (parts.length >= 2) {
            return {
              name: parts[0],
              value: parts.slice(1).join('='),
              domain: hostname,
              path: '/'
            };
          }
          return null;
        }).filter(Boolean);
        if (cookieObjects.length > 0) {
          await mobilePage.setCookie(...(cookieObjects as any[]));
        }
      } catch (cookieErr: any) {
        logger.warn({ err: cookieErr.message }, "Failed to set cookies in Puppeteer");
      }
    }

    logger.info("Navigating mobile page...");
    await mobilePage.goto(url, { waitUntil: 'load', timeout: 30000 });
    
    // Wait for the page content to actually render on the mobile viewport.
    // Many sites serve different content or use JS-driven rendering for mobile,
    // which means networkidle2 fires before visible content appears.
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Also try to wait for the body to have meaningful content height
    try {
      await mobilePage.waitForFunction(
        () => document.body && document.body.scrollHeight > 100,
        { timeout: 5000 }
      );
    } catch (_) {
      // If this times out, proceed anyway — the 3s delay should be enough
    }

    // Hide scrollbars
    await mobilePage.addStyleTag({ content: '::-webkit-scrollbar { display: none !important; } html, body { scrollbar-width: none !important; }' });

    const mobileBuffer = (await mobilePage.screenshot({ fullPage: true, type: 'png' })) as Buffer;
    const mobileBase64 = `data:image/png;base64,${mobileBuffer.toString('base64')}`;

    logger.info("Puppeteer screenshots captured successfully!");
    return { desktop: desktopBase64, mobile: mobileBase64 };
  } finally {
    await browser.close();
  }
}

function normalizeUrl(url: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getAttributeValue(attrs: string, name: string): string | null {
  const regex = new RegExp(name + '\\s*=\\s*([\'"]?)([^\'"\\s>]+)\\1', 'i');
  const match = attrs.match(regex);
  return match && match[2] ? match[2] : null;
}

function isValidImageSrc(src: string): boolean {
  if (!src) return false;
  const s = src.toLowerCase();
  if (s.startsWith('data:image/gif') || s.startsWith('data:image/svg+xml') || s.startsWith('data:image/png;base64,i')) {
    // Standard blank 1x1 transparent png starts with 'data:image/png;base64,iVBORw0KGgo'
    if (s.length < 200) return false; 
  }
  if (s.includes('blank.gif') || s.includes('pixel.gif') || s.includes('spacer.gif') || s.includes('loader.gif') || s.includes('loading.gif') || s.includes('clear.gif')) return false;
  return true;
}

function extractJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json|html)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Groq did not return valid JSON.");
  }
}

function extractCleanCookies(headers: Headers): string {
  let cookieStrings: string[] = [];
  
  if (typeof (headers as any).getSetCookie === "function") {
    cookieStrings = (headers as any).getSetCookie();
  } else {
    const raw = headers.get("set-cookie");
    if (raw) {
      cookieStrings = raw.split(",");
    }
  }

  const cleanPairs: string[] = [];
  for (const str of cookieStrings) {
    const firstPart = str.split(";")[0].trim();
    if (firstPart && firstPart.includes("=")) {
      cleanPairs.push(firstPart);
    }
  }

  return cleanPairs.join("; ");
}

export async function fetchReferenceHtml(referenceUrl: string): Promise<{ html: string; cookies: string; finalUrl: string }> {
  try {
    let currentUrl = referenceUrl;
    const cookieMap = new Map<string, string>();
    let redirectCount = 0;
    const maxRedirects = 10;
    
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
      "Cache-Control": "max-age=0",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1"
    };

    while (redirectCount < maxRedirects) {
      if (cookieMap.size > 0) {
        headers["Cookie"] = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
      }

      const response = await fetch(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual"
      });

      // Extract set-cookies
      let cookieStrings: string[] = [];
      if (typeof (response.headers as any).getSetCookie === "function") {
        cookieStrings = (response.headers as any).getSetCookie();
      } else {
        const raw = response.headers.get("set-cookie");
        if (raw) {
          cookieStrings = raw.split(",");
        }
      }

      for (const cookieStr of cookieStrings) {
        const firstPart = cookieStr.split(";")[0].trim();
        if (firstPart && firstPart.includes("=")) {
          const parts = firstPart.split("=");
          const key = parts[0].trim();
          const value = parts.slice(1).join("=").trim();
          cookieMap.set(key, value);
        }
      }

      // Check redirect
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          currentUrl = new URL(location, currentUrl).href;
          redirectCount++;
          continue;
        }
      }

      if (!response.ok && response.status !== 304) {
        logger.warn({ status: response.status, currentUrl }, "Reference fetch returned non-200 status");
      }

      const html = await response.text();
      const cookies = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
      logger.info({ finalUrl: currentUrl, cookiesCount: cookieMap.size }, "Stateful reference fetch complete");
      
      return { 
        html: html.slice(0, 150000), 
        cookies, 
        finalUrl: currentUrl 
      };
    }
    
    throw new Error("Too many redirects");
  } catch (err: any) {
    logger.warn({ err: err.message, referenceUrl }, "Stateful reference fetch failed");
    return { html: "", cookies: "", finalUrl: referenceUrl };
  }
}


export async function inlinePageAssets(rawHtml: string, referenceUrl: string, cookies: string): Promise<string> {
  let html = rawHtml;
  
  // Parse reference URL to get base paths
  const urlObj = new URL(referenceUrl);
  const origin = urlObj.origin;
  let basePath = origin;
  if (urlObj.pathname.includes('/')) {
    basePath = origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
  } else {
    basePath = origin + '/';
  }

  const getAbsoluteUrl = (relPath: string, cssContextUrl: string | null = null): string => {
    const trimmed = relPath.trim();
    if (/^(https?:|data:|#|javascript:)/i.test(trimmed)) {
      return trimmed;
    }
    try {
      const contextUrl = cssContextUrl || referenceUrl;
      return new URL(trimmed, contextUrl).href;
    } catch (_) {
      if (trimmed.startsWith("//")) {
        return urlObj.protocol + trimmed;
      } else if (trimmed.startsWith("/")) {
        return origin + trimmed;
      } else {
        return basePath + trimmed;
      }
    }
  };

  const fetchAsset = async (url: string): Promise<{ buffer: Buffer; contentType: string } | null> => {
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Referer": referenceUrl
      };
      if (cookies) {
        headers["Cookie"] = cookies;
      }
      const res = await fetch(url, { headers });

      if (res.status === 200) {
        const buffer = await res.arrayBuffer();
        const contentType = res.headers.get("content-type") || "";
        return { buffer: Buffer.from(buffer), contentType };
      }
      logger.warn({ url, status: res.status }, "Failed to fetch asset during inlining");
      return null;
    } catch (err: any) {
      logger.warn({ url, err: err.message }, "Error fetching asset during inlining");
      return null;
    }
  };

  // 1. Process and inline CSS files
  const linkMatches = Array.from(html.matchAll(/<link\s+([^>]+)>/gi));
  for (const match of linkMatches) {
    const fullTag = match[0];
    const attrs = match[1];
    if (/rel=["']stylesheet["']/i.test(attrs)) {
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const relHref = hrefMatch[1];
        const absHref = getAbsoluteUrl(relHref);
        const asset = await fetchAsset(absHref);
        if (asset) {
          let cssText = asset.buffer.toString("utf8");
          
          // Inline relative url(...) inside CSS
          const urlRegex = /url\((['"]?)([^'")\s?#]+)(.*?)\1\)/gi;
          let urlMatch;
          const cssUrlsToReplace: Array<{ matchStr: string; absUrl: string }> = [];
          
          while ((urlMatch = urlRegex.exec(cssText)) !== null) {
            const relUrl = urlMatch[2];
            const queryAndAnchor = urlMatch[3] || "";
            const absUrl = getAbsoluteUrl(relUrl, absHref);
            
            // Check if it's an image
            const ext = path.extname(relUrl.split('?')[0]).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext);
            
            if (isImage) {
              cssUrlsToReplace.push({ matchStr: urlMatch[0], absUrl });
            } else {
              // For fonts/other, resolve to absolute URL
              const resolvedUrl = `url("${absUrl}${queryAndAnchor}")`;
              cssText = cssText.replaceAll(urlMatch[0], resolvedUrl);
            }
          }
          
          // Fetch and base64-encode images in CSS (only if size <= 3MB for completeness)
          for (const item of cssUrlsToReplace) {
            const imgAsset = await fetchAsset(item.absUrl);
            if (imgAsset && imgAsset.buffer.byteLength <= 3145728) {

              const base64 = imgAsset.buffer.toString("base64");
              const mime = imgAsset.contentType || "image/png";
              const dataUri = `url("data:${mime};base64,${base64}")`;
              cssText = cssText.replaceAll(item.matchStr, dataUri);
            } else {
              // Fallback to absolute URL if fetch fails or size > 10KB
              cssText = cssText.replaceAll(item.matchStr, `url("${item.absUrl}")`);
            }
          }

          html = html.replaceAll(fullTag, `<style>\n${cssText}\n</style>`);
        } else {
          // Defer loading of non-inlined CSS to prevent render-blocking
          if (!/media=/i.test(attrs) && !/onload=/i.test(attrs)) {
            const newTag = fullTag
              .replace(/rel=["']stylesheet["']/i, 'rel="stylesheet" media="print" onload="this.media=\'all\'"')
              .replace(/rel='stylesheet'/i, 'rel=\'stylesheet\' media=\'print\' onload="this.media=\'all\'"');
            html = html.replaceAll(fullTag, newTag);
          }
        }
      }
    }
  }

  // 1.5. Process and inline images inside inline <style> blocks of the HTML document
  const styleMatches = Array.from(html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi));
  for (const match of styleMatches) {
    const fullTag = match[0];
    const attrs = match[1];
    let cssText = match[2];
    
    const urlRegex = /url\((['"]?)([^'")\s?#]+)(.*?)\1\)/gi;
    let urlMatch;
    const cssUrlsToReplace: Array<{ matchStr: string; absUrl: string }> = [];
    
    while ((urlMatch = urlRegex.exec(cssText)) !== null) {
      const relUrl = urlMatch[2];
      const absUrl = getAbsoluteUrl(relUrl);
      
      const ext = path.extname(relUrl.split('?')[0]).toLowerCase();
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext) || relUrl.includes("image") || relUrl.includes("img");
      
      if (isImage) {
        cssUrlsToReplace.push({ matchStr: urlMatch[0], absUrl });
      }
    }
    
    for (const item of cssUrlsToReplace) {
      const imgAsset = await fetchAsset(item.absUrl);
      if (imgAsset && imgAsset.buffer.byteLength <= 3145728) {
        const base64 = imgAsset.buffer.toString("base64");
        const mime = imgAsset.contentType || "image/jpeg";
        const dataUri = `url("data:${mime};base64,${base64}")`;
        cssText = cssText.replaceAll(item.matchStr, dataUri);
      } else {
        cssText = cssText.replaceAll(item.matchStr, `url("${item.absUrl}")`);
      }
    }
    
    html = html.replaceAll(fullTag, `<style${attrs}>\n${cssText}\n</style>`);
  }

  // 1.6. Process and inline images inside inline style="" attributes
  const styleAttrRegex = /style=(['"])([^'"]*background[^'"]*)\1/gi;
  const styleAttrMatches = Array.from(html.matchAll(styleAttrRegex));
  for (const match of styleAttrMatches) {
    const fullAttr = match[0];
    const quote = match[1];
    let styleVal = match[2];
    
    const urlRegex = /url\((['"]?)([^'")\s?#]+)(.*?)\1\)/gi;
    let urlMatch;
    let modified = false;
    
    while ((urlMatch = urlRegex.exec(styleVal)) !== null) {
      const relUrl = urlMatch[2];
      const absUrl = getAbsoluteUrl(relUrl);
      
      const imgAsset = await fetchAsset(absUrl);
      if (imgAsset && imgAsset.buffer.byteLength <= 3145728) {
        const base64 = imgAsset.buffer.toString("base64");
        const mime = imgAsset.contentType || "image/jpeg";
        const dataUri = `url("data:${mime};base64,${base64}")`;
        styleVal = styleVal.replaceAll(urlMatch[0], dataUri);
        modified = true;
      } else {
        styleVal = styleVal.replaceAll(urlMatch[0], `url("${absUrl}")`);
        modified = true;
      }
    }
    
    if (modified) {
      html = html.replaceAll(fullAttr, `style=${quote}${styleVal}${quote}`);
    }
  }

  // 2. Process and inline JS files
  const scriptRegex = /<script\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/script>/gi;
  const scriptMatches = Array.from(html.matchAll(scriptRegex));
  for (const match of scriptMatches) {
    const fullTag = match[0];
    const attrs1 = match[1];
    const relSrc = match[2];
    const attrs2 = match[3];
    
    // Ignore external vendor libraries
    if (/jquery|google|analytics|gtm|facebook|pixel/i.test(relSrc) || relSrc.startsWith("http") || relSrc.startsWith("data:")) {
      // Add 'defer' to this external script if not already present, to avoid render blocking
      if (!/defer|async/i.test(attrs1 + attrs2)) {
        const newTag = fullTag
          .replace(`src="${relSrc}"`, `src="${relSrc}" defer`)
          .replace(`src='${relSrc}'`, `src='${relSrc}' defer`);
        html = html.replaceAll(fullTag, newTag);
      }
      continue;
    }
    
    const absSrc = getAbsoluteUrl(relSrc);
    const asset = await fetchAsset(absSrc);
    if (asset) {
      const jsText = asset.buffer.toString("utf8");
      html = html.replaceAll(fullTag, `<script>\n${jsText}\n</script>`);
    } else {
      // Defer execution of relative script that failed to inline
      if (!/defer|async/i.test(attrs1 + attrs2)) {
        const newTag = fullTag
          .replace(`src="${relSrc}"`, `src="${relSrc}" defer`)
          .replace(`src='${relSrc}'`, `src='${relSrc}' defer`);
        html = html.replaceAll(fullTag, newTag);
      }
    }
  }

  // 3. Process and inline HTML Images (including lazy-loaded image sources)
  const imgMatches = Array.from(html.matchAll(/<img\s+([^>]+)>/gi));
  for (const match of imgMatches) {
    const fullTag = match[0];
    const attrs = match[1];
    
    // Determine the best source URL for the image
    let selectedSrc = getAttributeValue(attrs, 'data-original') ||
                      getAttributeValue(attrs, 'data-lazy-src') ||
                      getAttributeValue(attrs, 'data-src') ||
                      getAttributeValue(attrs, 'src') ||
                      "";
    
    if (!selectedSrc) continue;

    // If the selected source is a base64 inline placeholder, and there is another source available, we check if one of them is valid
    if (!isValidImageSrc(selectedSrc)) {
      const alternativeSrc = [
        getAttributeValue(attrs, 'data-original'),
        getAttributeValue(attrs, 'data-lazy-src'),
        getAttributeValue(attrs, 'data-src'),
        getAttributeValue(attrs, 'src')
      ].find(src => src && isValidImageSrc(src));
      
      if (alternativeSrc) {
        selectedSrc = alternativeSrc;
      }
    }

    if (selectedSrc.startsWith("data:")) {
      // It's already inlined/base64, no need to process or modify the tag attributes
      continue;
    }

    // Rebuild the image tag attributes by removing all conflicting source/lazyload/srcset attributes
    // Also remove the self-closing slash from the end of attrs to avoid HTML validation/parsing issues
    let cleanedAttrs = attrs
      .replace(/(?:src|data-src|data-lazy-src|data-original)\s*=\s*(['"]?)[^'"]*\1/gi, "")
      .replace(/(?:srcset|data-srcset)\s*=\s*(['"]?)[^'"]*\1/gi, "")
      .trim()
      .replace(/\/$/, "")
      .trim();
    
    // Clean redundant multiple spaces
    cleanedAttrs = cleanedAttrs.replace(/\s+/g, " ");

    const absSrc = getAbsoluteUrl(selectedSrc);
    let finalSrc = absSrc;
    const asset = await fetchAsset(absSrc);
    
    if (asset && asset.buffer.byteLength <= 3145728) { // Limit to 3MB
      const base64 = asset.buffer.toString("base64");
      const mime = asset.contentType || "image/png";
      finalSrc = `data:${mime};base64,${base64}`;
    }
    
    const newTag = cleanedAttrs ? `<img ${cleanedAttrs} src="${finalSrc}">` : `<img src="${finalSrc}">`;
    html = html.replaceAll(fullTag, newTag);
  }

  return html;
}

async function researchWithExa(referenceUrl: string) {
  const exaKey = process.env.EXA_API_KEY || process.env.EXA_API_KEYEXA_API_KEY;
  if (!exaKey) {
    return { enabled: false, results: [], output: null };
  }

  try {
    const host = new URL(referenceUrl).hostname.replace(/^www\./, "");
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": exaKey,
      },
      body: JSON.stringify({
        query: `Analyze product landing page design, images, language, offer and copy for ${referenceUrl}`,
        includeDomains: [host],
        numResults: 3,
        type: "auto",
        contents: {
          text: { maxCharacters: 5000 },
          highlights: { numSentences: 3, highlightsPerUrl: 3 },
          summary: { query: "Summarize visual design, product, language, images, offer, benefits, pricing and conversion elements." },
        },
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Exa failed with ${response.status}`);
    }

    const data = (await response.json()) as any;
    return {
      enabled: true,
      results: (data.results || []).map((result: any) => ({
        title: result.title,
        url: result.url,
        image: result.image,
        favicon: result.favicon,
        summary: result.summary,
        highlights: result.highlights,
        text: result.text,
      })),
      output: data.output || null,
    };
  } catch (err: any) {
    logger.warn({ err: err.message, referenceUrl }, "Exa research failed");
    return { enabled: false, error: err.message, results: [], output: null };
  }
}

function makeAbsoluteUrls(html: string, baseUrl: string): string {
  try {
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;
    
    let basePath = origin;
    if (urlObj.pathname.includes('/')) {
      basePath = origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    } else {
      basePath = origin + '/';
    }

    // 1. Resolve src, href, action attributes
    let processed = html.replace(
      /\b(href|src|action)\s*=\s*(['"])([^'"]+)\2/gi,
      (match, attr, quote, val) => {
        const trimmed = val.trim();
        if (/^(https?:|data:|#|javascript:)/i.test(trimmed)) {
          return match;
        }
        
        let absoluteUrl = "";
        if (trimmed.startsWith("//")) {
          absoluteUrl = urlObj.protocol + trimmed;
        } else if (trimmed.startsWith("/")) {
          absoluteUrl = origin + trimmed;
        } else {
          absoluteUrl = basePath + trimmed;
        }
        return `${attr}=${quote}${absoluteUrl}${quote}`;
      }
    );

    // 2. Resolve background-image url() inside inline styles
    processed = processed.replace(
      /url\((['"]?)([^'")]+)\1\)/gi,
      (match, quote, val) => {
        const trimmed = val.trim();
        if (/^(https?:|data:|#|javascript:)/i.test(trimmed)) {
          return match;
        }
        
        let absoluteUrl = "";
        if (trimmed.startsWith("//")) {
          absoluteUrl = urlObj.protocol + trimmed;
        } else if (trimmed.startsWith("/")) {
          absoluteUrl = origin + trimmed;
        } else {
          absoluteUrl = basePath + trimmed;
        }
        return `url(${quote}${absoluteUrl}${quote})`;
      }
    );

    return processed;
  } catch (err) {
    return html;
  }
}

function extractProductName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return "Produto Oficial";
  }
}

function extractDomainName(urlStr: string): string {
  try {
    const hostname = new URL(urlStr).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    return parts[0];
  } catch {
    return "presell";
  }
}

interface PageMetadata {
  productName: string;
  primaryColor: string;
  ctaButtonColor?: string;
  productImageUrl: string;
  seoDescription?: string;
  productDetails?: string[];
  extractedPrice?: string;
  extractedFormula?: string;
  extractedOffer?: string;
  originalPrice?: string;
  promotionalPrice?: string;
}

function cleanHtmlText(text: string): string {
  if (!text) return "";
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPageMetadata(html: string, referenceUrl: string): PageMetadata {
  let productName = "";
  let seoDescription = "";
  const productDetails: string[] = [];
  let extractedPrice = "";
  let extractedFormula = "";
  let extractedOffer = "";
  let originalPrice = "";
  let promotionalPrice = "";

  if (!html) {
    return { productName: extractProductName(referenceUrl), primaryColor: "#16a34a", ctaButtonColor: "#16a34a", productImageUrl: "", seoDescription, productDetails, extractedPrice, extractedFormula, extractedOffer, originalPrice, promotionalPrice };
  }

  // Check og:title
  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
  if (ogTitleMatch && ogTitleMatch[1]) {
    const title = ogTitleMatch[1].trim();
    const cleanTitle = title.split(/[-|]/)[0].trim();
    if (cleanTitle && cleanTitle.length < 30) {
      productName = cleanTitle;
    }
  }
  // Check <title>
  if (!productName) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      const cleanTitle = title.split(/[-|]/)[0].trim();
      if (cleanTitle && cleanTitle.length < 30) {
        productName = cleanTitle;
      }
    }
  }
  // Fallback to domain name
  if (!productName) {
    productName = extractProductName(referenceUrl);
  }

  // Extract primary color by hex frequency excluding common grayscales
  let primaryColor = "#16a34a"; // fallback neutral green
  const hexRegex = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;
  const matches = html.match(hexRegex);
  if (matches && matches.length > 0) {
    const counts: Record<string, number> = {};
    for (const color of matches) {
      const norm = color.toLowerCase();
      if (norm === "#ffffff" || norm === "#fff" || 
          norm === "#000000" || norm === "#000" || 
          norm === "#333" || norm === "#333333" || 
          norm === "#666" || norm === "#666666" || 
          norm === "#999" || norm === "#999999" || 
          norm === "#ccc" || norm === "#cccccc" || 
          norm === "#eee" || norm === "#eeeeee" || 
          norm === "#ddd" || norm === "#dddddd" || 
          norm === "#f3f4f6" || norm === "#f9fafb" ||
          norm === "#e5e7eb" || norm === "#d1d5db" || norm === "#9ca3af" ||
          norm === "#4b5563" || norm === "#374151" || norm === "#1f2937" ||
          norm === "#111827" || norm === "#f8fafc" || norm === "#f1f5f9" ||
          norm === "#e2e8f0" || norm === "#cbd5e1" || norm === "#94a3b8" ||
          norm === "#64748b" || norm === "#475569" || norm === "#334155" ||
          norm === "#1e293b" || norm === "#0f172a") {
        continue;
      }
      counts[norm] = (counts[norm] || 0) + 1;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      primaryColor = sorted[0][0];
    }
  }

  // Extract CTA button color from the website CSS/HTML
  // Look for background-color or background on button, .btn, .cta, order, buy, submit elements
  let ctaButtonColor = primaryColor; // fallback to primary
  const btnColorPatterns = [
    // CSS rules targeting buttons/CTAs with background or background-color
    /(?:button|\.[a-z-]*btn[a-z-]*|\.[a-z-]*cta[a-z-]*|\.[a-z-]*buy[a-z-]*|\.[a-z-]*order[a-z-]*|\.[a-z-]*submit[a-z-]*|\.[a-z-]*comprar[a-z-]*|input\[type=["']?submit)\s*[^{}]*\{[^}]*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2})\b/gi,
    // Inline styles on button or anchor elements with btn/cta/order classes
    /<(?:button|a)[^>]*(?:class=["'][^"']*(?:btn|cta|buy|order|comprar|submit)[^"']*["'])[^>]*style=["'][^"']*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2})/gi,
    // Inline style on button elements directly
    /<button[^>]*style=["'][^"']*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2})/gi,
  ];
  const grayscaleSet = new Set(["#ffffff","#fff","#000000","#000","#333","#333333","#666","#666666","#999","#999999","#ccc","#cccccc","#eee","#eeeeee","#ddd","#dddddd","#f3f4f6","#f9fafb","#e5e7eb","#d1d5db","#9ca3af","#4b5563","#374151","#1f2937","#111827","#f8fafc","#f1f5f9","#e2e8f0","#cbd5e1","#94a3b8","#64748b","#475569","#334155","#1e293b","#0f172a"]);
  for (const pattern of btnColorPatterns) {
    let btnMatch;
    while ((btnMatch = pattern.exec(html)) !== null) {
      const color = (btnMatch[1] || "").toLowerCase();
      if (color && !grayscaleSet.has(color)) {
        ctaButtonColor = color;
        break;
      }
    }
    if (ctaButtonColor !== primaryColor) break;
  }

  // Extract main product image
  let productImageUrl = "";
  const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (ogImageMatch && ogImageMatch[1]) {
    productImageUrl = ogImageMatch[1].trim();
  }

  if (!productImageUrl) {
    const imgRegex = /<img\s+([^>]+)>/gi;
    const productKeywords = [/product/i, /prod/i, /pack/i, /bottle/i, /garrafa/i, /pot/i, /capsule/i, /gel/i, /box/i, /kit/i, /main/i, /hero/i, /comprar/i, /oferta/i, /cardiox/i];
    const candidates: string[] = [];
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const attrs = imgMatch[1];
      const src = getAttributeValue(attrs, 'data-original') ||
                  getAttributeValue(attrs, 'data-lazy-src') ||
                  getAttributeValue(attrs, 'data-src') ||
                  getAttributeValue(attrs, 'src');
      if (src && isValidImageSrc(src)) {
        if (productKeywords.some(kw => kw.test(src))) {
          candidates.push(src);
        }
      }
    }
    if (candidates.length > 0) {
      productImageUrl = candidates[0];
    } else {
      imgRegex.lastIndex = 0;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const attrs = imgMatch[1];
        const src = getAttributeValue(attrs, 'data-original') ||
                    getAttributeValue(attrs, 'data-lazy-src') ||
                    getAttributeValue(attrs, 'data-src') ||
                    getAttributeValue(attrs, 'src');
        if (src && isValidImageSrc(src) && !src.includes("icon") && !src.includes("logo") && !src.includes("avatar") && !src.endsWith(".svg")) {
          productImageUrl = src;
          break;
        }
      }
    }
  }

  if (productImageUrl && !/^(https?:|data:)/i.test(productImageUrl)) {
    try {
      const urlObj = new URL(referenceUrl);
      const origin = urlObj.origin;
      let basePath = origin;
      if (urlObj.pathname.includes('/')) {
        basePath = origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
      } else {
        basePath = origin + '/';
      }

      if (productImageUrl.startsWith("//")) {
        productImageUrl = urlObj.protocol + productImageUrl;
      } else if (productImageUrl.startsWith("/")) {
        productImageUrl = origin + productImageUrl;
      } else {
        productImageUrl = basePath + productImageUrl;
      }
    } catch (_) {}
  }

  // Broad list of words indicating medical claims, weight loss promises, cures, or guarantees
  const violationFilterRegex = /\b(perdi|perder|lose|weight|peso|kg|kilos|kilo|emagrecer|queimar|fat|gordura|grasa|liposuzione|liposuction|garantido|guaranteed|garantia|cure|cura|curar|trata|treat|elimina|eliminate|diabetes|diabético|hipertens|artrite|arthritis|cancro|câncer|morte|death|morrer|segredo|secret|clinicamente|comprovad[ao]|proven|clinically)\b/i;

  // Extract SEO description and clean it if it contains violating words
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
                        html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  if (metaDescMatch && metaDescMatch[1]) {
    const rawDesc = cleanHtmlText(metaDescMatch[1]);
    if (!violationFilterRegex.test(rawDesc)) {
      seoDescription = rawDesc;
    }
  }

  // Extract key details (e.g. benefit sentences or headings), FILTERING OUT VIOLATIONS
  const detailsRegex = /<(?:h2|h3|li|p)[^>]*>[\s\n]*([^<>]{15,120}?)[\s\n]*<\/(?:h2|h3|li|p)>/gi;
  let dMatch;
  const seenDetails = new Set<string>();

  while ((dMatch = detailsRegex.exec(html)) !== null && productDetails.length < 5) {
    const text = cleanHtmlText(dMatch[1]);
    if (
      text.length >= 15 &&
      text.length <= 120 &&
      !text.includes("<") &&
      !text.includes(">") &&
      !violationFilterRegex.test(text) && // Skip any violating lines!
      !/privacy|terms|contact|cookies|cookie|copyright|política|termos|contato|direitos reservados|sobre nós|about us/i.test(text) &&
      !seenDetails.has(text.toLowerCase())
    ) {
      productDetails.push(text);
      seenDetails.add(text.toLowerCase());
    }
  }

  // Attempt to parse price from HTML
  const priceRegex = /(?:R\$\s*\d+(?:[.,]\d{2})?|\d+\s*(?:zł|€|\$|lei|Kč|Ft|EUR|eur|Eur|PLN|pln|RON|ron|CZK|czk|лв|BGN|bgn|din|RSD|rsd|HUF|huf))/gi;
  const priceMatches = html.match(priceRegex);
  if (priceMatches && priceMatches.length > 0) {
    const uniquePrices = Array.from(new Set(priceMatches.map(p => p.trim())));
    if (uniquePrices.length === 1) {
      extractedPrice = uniquePrices[0];
      promotionalPrice = uniquePrices[0];
    } else if (uniquePrices.length >= 2) {
      const parseVal = (str: string): number => {
        const m = str.match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
      };
      const p1 = uniquePrices[0];
      const p2 = uniquePrices[1];
      const v1 = parseVal(p1);
      const v2 = parseVal(p2);
      
      if (v1 > 0 && v2 > 0) {
        if (v1 > v2) {
          originalPrice = p1;
          promotionalPrice = p2;
        } else {
          originalPrice = p2;
          promotionalPrice = p1;
        }
        extractedPrice = promotionalPrice;
      } else {
        extractedPrice = p1;
        promotionalPrice = p1;
      }
    }
  }

  // Attempt to parse ingredients/composition from HTML
  const formulaKeywords = /ingredienti|ingredientes|ingredients|composição|composizione|composición|composition/i;
  const listItemsRegex = /<li[^>]*>[\s\n]*([^<>]{5,60}?)[\s\n]*<\/li>/gi;
  let liMatch;
  const foundIngredients: string[] = [];
  
  if (formulaKeywords.test(html)) {
    const herbKeywords = /extrato|extract|vitamina|vitamin|mineral|ácido|acid|óleo|oil|semente|seed|raiz|root|folha|leaf|zinco|zinc|magnésio|magnesium|calcio|calcium/i;
    while ((liMatch = listItemsRegex.exec(html)) !== null && foundIngredients.length < 4) {
      const text = cleanHtmlText(liMatch[1]);
      if (herbKeywords.test(text) && text.length < 50 && !/peso|perda|emagrecer|queimar/i.test(text)) {
        foundIngredients.push(text);
      }
    }
  }
  if (foundIngredients.length > 0) {
    extractedFormula = foundIngredients.join(", ");
  }

  // Attempt to parse offer/discount from HTML
  const offerRegex = /(?:\d+%\s*(?:de\s+)?(?:desconto|off|discount|promo|rabat|reducere|sconto|sconti|remise)|\b(?:desconto|off|discount|rabat|reducere)\s*(?:de\s+)?\d+%|\b(?:compre|buy|pague|pay|paga)\s*\d+\s*(?:leve|get|paghi|prendi|obtenha)\s*\d+|\bcompre\s*\d+\s*(?:grátis|gratis))/gi;
  const offerMatches = html.match(offerRegex);
  if (offerMatches && offerMatches.length > 0) {
    const uniqueOffers = Array.from(new Set(offerMatches.map(o => o.trim())));
    if (uniqueOffers.length > 0) {
      extractedOffer = uniqueOffers[0];
    }
  }

  return { productName, primaryColor, ctaButtonColor, productImageUrl, seoDescription, productDetails, extractedPrice, extractedFormula, extractedOffer, originalPrice, promotionalPrice };
}

function getThankYouModalCode(
  productName: string,
  primaryColor: string,
  productImageUrl: string,
  referenceUrl: string,
  popupLanguage: string
): string {
  let domainName = "produto.com";
  try {
    domainName = new URL(referenceUrl).hostname.replace("www.", "");
  } catch (_) {}

  const finalSupportEmail = `suporte@${domainName}`;

  let lang = popupLanguage || "pt-BR";
  if (lang === "auto" || !lang) {
    lang = "pt-BR";
  }

  const localization: Record<string, {
    headline: string;
    subHeadline: string;
    productTitle: string;
    productDesc: string;
    discountBadge: string;
    adviserTitle: string;
    adviserDesc: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    badge1: string;
    badge2: string;
    badge3: string;
    badge4: string;
    footerText: string;
    closeBtn: string;
  }> = {
    "pt-BR": {
      headline: "Obrigado, seu pedido<br>foi <span style='color:#16a34a'>recebido</span>!",
      subHeadline: "Registramos sua solicitação corretamente. A equipe de vendas entrará em contato em breve e a entrega será realizada no prazo estabelecido.",
      productTitle: `${productName} - Suporte Oficial`,
      productDesc: "Preço de promoção - 50% de desconto<br>Garantia de satisfação - Frete seguro",
      discountBadge: "-50% OFF",
      adviserTitle: "Nosso consultor vai te ligar!",
      adviserDesc: "Nossa equipe de vendas entrará em contato em breve por telefone para confirmar o pedido, e a entrega será feita no prazo estabelecido.",
      step1Title: "Atenda a chamada do nosso consultor",
      step1Desc: "Nossa equipe de vendas entrará em contato por ligação em breve para confirmar o pedido.",
      step2Title: "Envio em 24 horas",
      step2Desc: "Após a confirmação por nossa equipe, seu pedido será enviado para garantir a entrega no prazo estabelecido.",
      step3Title: "Recebimento e pagamento na entrega",
      step3Desc: "Pague apenas quando o pacote chegar na sua porta.",
      badge1: "Entrega segura",
      badge2: "Produto certificado",
      badge3: "+2.500 avaliações",
      badge4: "100% natural",
      footerText: `Se você não puder atender a ligação, tentaremos de novo. Dúvidas? Escreva para: ${finalSupportEmail}`,
      closeBtn: "Voltar para o site"
    },
    "es": {
      headline: "¡Gracias, tu pedido<br>ha sido <span style='color:#16a34a'>recibido</span>!",
      subHeadline: "Hemos registrado tu solicitud correctamente. El equipo de ventas se pondrá en contacto en breve y la entrega se realizará en el plazo establecido.",
      productTitle: `${productName} - Soporte Oficial`,
      productDesc: "Precio de promoción - 50% de descuento<br>Garantía de satisfacción - Envío gratuito",
      discountBadge: "-50% OFF",
      adviserTitle: "¡Nuestro asesor te llamará!",
      adviserDesc: "Nuestro equipo de ventas te contactará por teléfono en breve para confirmar el pedido, y la entrega se realizará en el plazo establecido.",
      step1Title: "Atiende la llamada de nuestro asesor",
      step1Desc: "Nuestro equipo de ventas te llamará en breve para confirmar los detalles de tu pedido.",
      step2Title: "Envío en 24 horas",
      step2Desc: "Tras la confirmación por nuestro equipo, tu pedido será enviado para garantizar la entrega en el plazo establecido.",
      step3Title: "Recepción y pago contra entrega",
      step3Desc: "Pagas solo cuando el paquete llegue a tu puerta.",
      badge1: "Entrega segura",
      badge2: "Producto certificado",
      badge3: "+2.500 opiniones",
      badge4: "100% orgánico",
      footerText: `Si no puedes atender la llamada, te llamaremos de nuevo. ¿Preguntas? Escríbenos: ${finalSupportEmail}`,
      closeBtn: "Volver al sitio"
    },
    "en": {
      headline: "Thank you, your order<br>has been <span style='color:#16a34a'>received</span>!",
      subHeadline: "We have successfully registered your request. The sales team will contact you shortly and delivery will be made within the established timeframe.",
      productTitle: `${productName} - Official Support`,
      productDesc: "Promotion price - 50% discount<br>Satisfaction guarantee - Secure shipping",
      discountBadge: "-50% OFF",
      adviserTitle: "Our specialist will call you!",
      adviserDesc: "Our sales team will contact you by phone shortly to confirm your order, and delivery will be made within the established timeframe.",
      step1Title: "Answer the call from our specialist",
      step1Desc: "Our sales team will call you shortly to confirm your order details.",
      step2Title: "Shipping within 24 hours",
      step2Desc: "After confirmation by our team, your order will be shipped to ensure delivery within the established timeframe.",
      step3Title: "Cash on delivery",
      step3Desc: "Pay only when the package arrives at your door.",
      badge1: "Secure delivery",
      badge2: "Certified product",
      badge3: "+2,500 reviews",
      badge4: "100% natural",
      footerText: `If you cannot answer the call, we will call you again. Questions? Contact us: ${finalSupportEmail}`,
      closeBtn: "Back to website"
    }
  };

  const t = localization[lang] || localization["pt-BR"];

  let productIcon = "✨";
  const nameLower = productName.toLowerCase();
  if (nameLower.includes("cardi")) productIcon = "❤️";
  else if (nameLower.includes("clean") || nameLower.includes("detox") || nameLower.includes("tea") || nameLower.includes("chá") || nameLower.includes("green")) productIcon = "🌿";
  else if (nameLower.includes("drop") || nameLower.includes("gota")) productIcon = "💧";
  else if (nameLower.includes("caps") || nameLower.includes("tabs") || nameLower.includes("pill") || nameLower.includes("cardiox") || nameLower.includes("pills")) productIcon = "💊";
  else if (nameLower.includes("skin") || nameLower.includes("colagen") || nameLower.includes("crea") || nameLower.includes("gel") || nameLower.includes("lift")) productIcon = "✨";

  const btnColor = primaryColor || "#16a34a";

  return `
<!-- Inline Thank You Modal Structure and Styling -->
<style>
  .thanks-modal-overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(8px);
    z-index: 99999999;
    justify-content: center;
    align-items: center;
    padding: 20px;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .thanks-modal-content {
    background: #ffffff;
    border-radius: 24px;
    width: 100%;
    max-width: 480px;
    padding: 32px 24px;
    text-align: center;
    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    animation: thanksModalScaleUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: auto;
  }
  @keyframes thanksModalScaleUp {
    from { transform: scale(0.9); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .thanks-success-badge {
    width: 64px;
    height: 64px;
    background: #dcfce7;
    color: #16a34a;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
  }
  .thanks-success-badge svg {
    width: 32px;
    height: 32px;
    fill: none;
    stroke: currentColor;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .thanks-headline {
    font-size: 24px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 12px;
    line-height: 1.3;
  }
  .thanks-subheadline {
    font-size: 13px;
    color: #475569;
    margin-bottom: 24px;
    line-height: 1.5;
  }
  .thanks-product-box {
    display: flex;
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 16px;
    padding: 12px;
    gap: 12px;
    text-align: left;
    margin-bottom: 20px;
    align-items: center;
  }
  .thanks-product-img-wrapper {
    width: 50px;
    height: 50px;
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 20px;
    overflow: hidden;
  }
  .thanks-product-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .thanks-product-details {
    flex: 1;
  }
  .thanks-product-title {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 2px;
  }
  .thanks-product-desc {
    font-size: 11px;
    color: #64748b;
  }
  .thanks-steps {
    text-align: left;
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 24px;
  }
  .thanks-step-item {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }
  .thanks-step-item:last-child {
    margin-bottom: 0;
  }
  .thanks-step-num {
    width: 20px;
    height: 20px;
    background: ${btnColor};
    color: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .thanks-step-text {
    font-size: 12px;
    color: #334155;
    line-height: 1.45;
  }
  .thanks-step-text strong {
    color: #0f172a;
  }
  .thanks-btn {
    display: inline-block;
    width: 100%;
    background: ${btnColor};
    color: #ffffff;
    font-weight: 700;
    padding: 14px 20px;
    border-radius: 12px;
    text-decoration: none;
    font-size: 14px;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    transition: filter 0.15s, transform 0.1s;
  }
  .thanks-btn:hover {
    filter: brightness(0.92);
  }
  .thanks-btn:active {
    transform: scale(0.98);
  }
  .thanks-footer {
    font-size: 10px;
    color: #94a3b8;
    margin-top: 16px;
    line-height: 1.4;
  }
</style>

<div class="thanks-modal-overlay" id="thanksModalOverlay">
  <div class="thanks-modal-content">
    <div class="thanks-success-badge">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    <h1 class="thanks-headline">${t.headline}</h1>
    <p class="thanks-subheadline">${t.subHeadline}</p>
    
    <div class="thanks-product-box">
      <div class="thanks-product-img-wrapper">
        ${productImageUrl ? `<img class="thanks-product-img" src="${productImageUrl}" alt="${productName}" />` : `<span>${productIcon}</span>`}
      </div>
      <div class="thanks-product-details">
        <h4 class="thanks-product-title">${t.productTitle}</h4>
        <p class="thanks-product-desc">${t.productDesc.split("<br>")[0]}</p>
      </div>
    </div>

    <div class="thanks-steps">
      <div class="thanks-step-item">
        <div class="thanks-step-num">1</div>
        <span class="thanks-step-text"><strong>${t.step1Title}</strong>: ${t.step1Desc}</span>
      </div>
      <div class="thanks-step-item">
        <div class="thanks-step-num">2</div>
        <span class="thanks-step-text"><strong>${t.step2Title}</strong>: ${t.step2Desc}</span>
      </div>
      <div class="thanks-step-item">
        <div class="thanks-step-num">3</div>
        <span class="thanks-step-text"><strong>${t.step3Title}</strong>: ${t.step3Desc}</span>
      </div>
    </div>

    <button class="thanks-btn" onclick="window.location.hash = ''">${t.closeBtn}</button>
    <p class="thanks-footer">${t.footerText}</p>
  </div>
</div>

<script>
(function() {
  var overlay = document.getElementById('thanksModalOverlay');
  function checkThanksHash() {
    if (overlay) {
      if (window.location.hash === '#obrigado' || window.location.hash === '#thanks') {
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      } else {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
      }
    }
  }
  window.addEventListener('hashchange', checkThanksHash);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkThanksHash);
  } else {
    checkThanksHash();
  }
})();
</script>
`;
}

function generateThankYouHtml(options: {
  productName: string;
  primaryColor: string;
  productImageUrl: string;
  referenceUrl: string;
  popupLanguage: string;
  supportEmail?: string;
  trackingTags?: string;
}): string {
  const { productName, primaryColor, productImageUrl, referenceUrl, popupLanguage, supportEmail = "", trackingTags = "" } = options;

  let domainName = "produto.com";
  try {
    domainName = new URL(referenceUrl).hostname.replace("www.", "");
  } catch (_) {}

  const finalSupportEmail = supportEmail || `suporte@${domainName}`;

  let lang = popupLanguage || "pt-BR";
  if (lang === "auto" || !lang) {
    lang = "pt-BR";
  }

  const localization: Record<string, {
    title: string;
    headline: string;
    subHeadline: string;
    productTitle: string;
    productDesc: string;
    discountBadge: string;
    adviserTitle: string;
    adviserDesc: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    badge1: string;
    badge2: string;
    badge3: string;
    badge4: string;
    footerText: string;
  }> = {
    "pt-BR": {
      title: "Pedido Recebido",
      headline: "Obrigado, seu pedido<br>foi <span>recebido</span>!",
      subHeadline: "Registramos sua solicitação corretamente. A equipe de vendas entrará em contato em breve e a entrega será realizada no prazo estabelecido.",
      productTitle: `${productName} - Suporte Oficial`,
      productDesc: "Preço de promoção - 50% de desconto<br>Garantia de satisfação - Frete seguro",
      discountBadge: "-50% OFF",
      adviserTitle: "Nosso consultor vai te ligar!",
      adviserDesc: "Nossa equipe de vendas entrará em contato em breve por telefone para confirmar o pedido, e a entrega será feita no prazo estabelecido.",
      step1Title: "Atenda a chamada do nosso consultor",
      step1Desc: "Nossa equipe de vendas entrará em contato por ligação em breve para confirmar o pedido.",
      step2Title: "Envio em 24 horas",
      step2Desc: "Após a confirmação por nossa equipe, seu pedido será enviado para garantir a entrega no prazo estabelecido.",
      step3Title: "Recebimento e pagamento na entrega",
      step3Desc: "Pague apenas quando o pacote chegar na sua porta. Entrega segura em sua residência.",
      badge1: "Entrega segura",
      badge2: "Produto certificado",
      badge3: "+2.500 avaliações",
      badge4: "100% natural",
      footerText: `Se você não puder atender a ligação, tentaremos de novo. Dúvidas? Escreva para: ${finalSupportEmail}`
    },
    "es": {
      title: "Pedido Recibido",
      headline: "¡Gracias, tu pedido<br>ha sido <span>recibido</span>!",
      subHeadline: "Hemos registrado tu solicitud correctamente. El equipo de ventas se pondrá en contacto en breve y la entrega se realizará en el plazo establecido.",
      productTitle: `${productName} - Soporte Oficial`,
      productDesc: "Precio de promoción - 50% de descuento<br>Garantía de satisfacción - Envío gratuito",
      discountBadge: "-50% OFF",
      adviserTitle: "¡Nuestro asesor te llamará!",
      adviserDesc: "Nuestro equipo de ventas te contactará por teléfono en breve para confirmar el pedido, y la entrega se realizará en el plazo establecido.",
      step1Title: "Atiende la llamada de nuestro asesor",
      step1Desc: "Nuestro equipo de ventas te llamará en breve para confirmar los detalles de tu pedido.",
      step2Title: "Envio en 24 horas",
      step2Desc: "Tras la confirmación por nuestro equipo, tu pedido será enviado para garantizar la entrega en el plazo establecido.",
      step3Title: "Recepción y pago contra entrega",
      step3Desc: "Pagas solo cuando el paquete llegue a tu puerta. Entrega segura a domicilio.",
      badge1: "Entrega segura",
      badge2: "Producto certificado",
      badge3: "+2.500 opiniones",
      badge4: "100% orgánico",
      footerText: `Si no puedes atender la llamada, te llamaremos de nuevo. ¿Preguntas? Escríbenos: ${finalSupportEmail}`
    },
    "en": {
      title: "Order Received",
      headline: "Thank you, your order<br>has been <span>received</span>!",
      subHeadline: "We have successfully registered your request. The sales team will contact you shortly and delivery will be made within the established timeframe.",
      productTitle: `${productName} - Official Support`,
      productDesc: "Promotion price - 50% discount<br>Satisfaction guarantee - Secure shipping",
      discountBadge: "-50% OFF",
      adviserTitle: "Our specialist will call you!",
      adviserDesc: "Our sales team will contact you by phone shortly to confirm your order, and delivery will be made within the established timeframe.",
      step1Title: "Answer the call from our specialist",
      step1Desc: "Our sales team will call you shortly to confirm your order details.",
      step2Title: "Shipping within 24 hours",
      step2Desc: "After confirmation by our team, your order will be shipped to ensure delivery within the established timeframe.",
      step3Title: "Cash on delivery",
      step3Desc: "Pay only when the package arrives at your door. Secure home delivery.",
      badge1: "Secure delivery",
      badge2: "Certified product",
      badge3: "+2,500 reviews",
      badge4: "100% natural",
      footerText: `If you cannot answer the call, we will call you again. Questions? Contact us: ${finalSupportEmail}`
    }
  };

  const t = localization[lang] || localization["pt-BR"];

  let productIcon = "✨";
  const nameLower = productName.toLowerCase();
  if (nameLower.includes("cardi")) productIcon = "❤️";
  else if (nameLower.includes("clean") || nameLower.includes("detox") || nameLower.includes("tea") || nameLower.includes("chá") || nameLower.includes("green")) productIcon = "🌿";
  else if (nameLower.includes("drop") || nameLower.includes("gota")) productIcon = "💧";
  else if (nameLower.includes("caps") || nameLower.includes("tabs") || nameLower.includes("pill") || nameLower.includes("cardiox") || nameLower.includes("pills")) productIcon = "💊";
  else if (nameLower.includes("skin") || nameLower.includes("colagen") || nameLower.includes("crea") || nameLower.includes("gel") || nameLower.includes("lift")) productIcon = "✨";

  let bgGradient = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
  if (primaryColor.startsWith("#")) {
    const hex = primaryColor.replace("#", "");
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    if (hex.length === 3) {
      r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
      g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
      b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
    }
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      const darkR = Math.max(0, Math.floor(r * 0.3));
      const darkG = Math.max(0, Math.floor(g * 0.05));
      const darkB = Math.max(0, Math.floor(b * 0.05));
      
      const midR = Math.max(0, Math.floor(r * 0.55));
      const midG = Math.max(0, Math.floor(g * 0.15));
      const midB = Math.max(0, Math.floor(b * 0.15));

      bgGradient = "radial-gradient(circle, rgb(" + midR + ", " + midG + ", " + midB + ") 0%, rgb(" + darkR + ", " + darkG + ", " + darkB + ") 100%)";
    }
  }

  let faviconUrl = "";
  try {
    const domain = new URL(referenceUrl).hostname;
    faviconUrl = "https://www.google.com/s2/favicons?domain=" + domain + "&sz=32";
  } catch (_) {}

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t.title}</title>
  ${faviconUrl ? '<link rel="icon" href="' + faviconUrl + '">' : ""}
  ${trackingTags}
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: ${bgGradient};
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      color: #1e293b;
    }
    
    .container {
      max-width: 600px;
      width: 100%;
      background: #ffffff;
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: hidden;
      animation: cardIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    
    @keyframes cardIn {
      from { opacity: 0; transform: scale(0.92) translateY(20px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    
    .success-badge {
      width: 52px;
      height: 52px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .success-badge svg {
      width: 28px;
      height: 28px;
      fill: none;
      stroke: currentColor;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    
    .product-tag {
      font-size: 14px;
      font-weight: 700;
      color: ${primaryColor};
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .headline {
      font-size: 28px;
      font-weight: 800;
      line-height: 1.25;
      color: #0f172a;
      margin-bottom: 16px;
      letter-spacing: -0.02em;
    }
    .headline span {
      color: ${primaryColor};
    }
    
    .subheadline {
      font-size: 14px;
      color: #475569;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    
    .product-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    .product-details {
      flex: 1;
    }
    .product-name {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .product-desc {
      font-size: 11px;
      color: #64748b;
      line-height: 1.5;
    }
    .product-img-wrapper {
      position: relative;
      width: 76px;
      height: 76px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #f1f5f9;
      padding: 6px;
    }
    .product-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .discount-badge {
      position: absolute;
      top: -6px;
      right: -6px;
      background: #f97316;
      color: #ffffff;
      font-size: 8px;
      font-weight: 800;
      padding: 3px 6px;
      border-radius: 99px;
      box-shadow: 0 2px 4px rgba(249, 115, 22, 0.3);
    }
    
    .adviser-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 16px;
      padding: 16px 20px;
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 28px;
    }
    .adviser-icon {
      width: 32px;
      height: 32px;
      background: #dcfce7;
      color: #16a34a;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .adviser-icon svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    .adviser-text {
      flex: 1;
    }
    .adviser-title {
      font-size: 13px;
      font-weight: 700;
      color: #14532d;
      margin-bottom: 3px;
    }
    .adviser-desc {
      font-size: 11px;
      color: #166534;
      line-height: 1.5;
    }
    
    .steps {
      display: flex;
      flex-direction: column;
      gap: 20px;
      border-top: 1px solid #f1f5f9;
      padding-top: 28px;
      margin-bottom: 28px;
    }
    .step-item {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .step-num {
      width: 24px;
      height: 24px;
      background: ${primaryColor};
      color: #ffffff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 2px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    }
    .step-content {
      flex: 1;
    }
    .step-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .step-desc {
      font-size: 11px;
      color: #64748b;
      line-height: 1.55;
    }
    
    .badges-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-top: 1px solid #f1f5f9;
      padding-top: 20px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .badge-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 600;
      color: #475569;
    }
    .badge-item svg {
      width: 12px;
      height: 12px;
      color: #10b981;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
    }
    
    .footer-support {
      font-size: 10px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.5;
    }
    .footer-support a {
      color: ${primaryColor};
      font-weight: 600;
      text-decoration: none;
    }
    .footer-support a:hover {
      text-decoration: underline;
    }
    
    @media (max-width: 480px) {
      .container {
        padding: 24px 20px;
        border-radius: 20px;
      }
      .headline {
        font-size: 24px;
      }
      .product-box {
        flex-direction: column-reverse;
        align-items: stretch;
        text-align: center;
      }
      .product-img-wrapper {
        margin: 0 auto;
      }
      .badges-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .badge-item {
        justify-content: center;
      }
    }
  </style>
</head>
<body>

  <div class="container">
    <div class="success-badge">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    
    <div class="product-tag">
      <span>${productIcon} ${productName}</span>
    </div>
    
    <h1 class="headline">${t.headline}</h1>
    
    <p class="subheadline">${t.subHeadline}</p>
    
    <div class="product-box">
      <div class="product-details">
        <h3 class="product-name">${t.productTitle}</h3>
        <p class="product-desc">${t.productDesc}</p>
      </div>
      <div class="product-img-wrapper">
        ${productImageUrl ? '<img class="product-img" src="' + productImageUrl + '" alt="' + productName + '" />' : '<div style="font-size: 24px;">' + productIcon + '</div>'}
        <span class="discount-badge">${t.discountBadge}</span>
      </div>
    </div>
    
    <div class="adviser-box">
      <div class="adviser-icon">
        <svg viewBox="0 0 24 24">
          <path d="M6.62 10.79a15.15 15.15 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.27 11.9 11.9 0 0 0 3.74.6 1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1A16 16 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.9 11.9 0 0 0 .6 3.74 1 1 0 0 1-.27 1.02z" />
        </svg>
      </div>
      <div class="adviser-text">
        <h4 class="adviser-title">${t.adviserTitle}</h4>
        <p class="adviser-desc">${t.adviserDesc}</p>
      </div>
    </div>
    
    <div class="steps">
      <div class="step-item">
        <div class="step-num">1</div>
        <div class="step-content">
          <h4 class="step-title">${t.step1Title}</h4>
          <p class="step-desc">${t.step1Desc}</p>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num">2</div>
        <div class="step-content">
          <h4 class="step-title">${t.step2Title}</h4>
          <p class="step-desc">${t.step2Desc}</p>
        </div>
      </div>
      <div class="step-item">
        <div class="step-num">3</div>
        <div class="step-content">
          <h4 class="step-title">${t.step3Title}</h4>
          <p class="step-desc">${t.step3Desc}</p>
        </div>
      </div>
    </div>
    
    <div class="badges-row">
      <div class="badge-item">
        <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        <span>${t.badge1}</span>
      </div>
      <div class="badge-item">
        <svg viewBox="0 0 24 24"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" /><polyline points="2 8.5 12 15 22 8.5" /><polyline points="12 22 12 15" /></svg>
        <span>${t.badge2}</span>
      </div>
      <div class="badge-item">
        <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        <span>${t.badge3}</span>
      </div>
      <div class="badge-item">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        <span>${t.badge4}</span>
      </div>
    </div>
    
    <p class="footer-support">${t.footerText}</p>
  </div>

</body>
</html>`;
}

/**
 * Directly clone the raw HTML (like DevTools "Copy element") and:
 * 1. Make all asset URLs absolute (images, stylesheets, scripts)
 * 2. Replace all <a href> links with the affiliate URL
 * 3. Replace all <form action> with the affiliate URL
 * 4. Strip existing cookie/consent banners
 * 5. Inject tracking tags into <head>
 * 6. Add a universal click interceptor script as safety net for onclick handlers
 */
function injectAffiliateIntoHtml(
  rawHtml: string,
  referenceUrl: string,
  affiliateUrl: string,
  trackingTags: string,
  apiToken?: string,
  streamCode?: string,
  thankYouUrl?: string
): string {
  // Step 1: Make all relative asset URLs absolute
  let html = makeAbsoluteUrls(rawHtml, referenceUrl);

  // Step 1.5: Inject favicon
  let faviconUrl = "";
  try {
    const domain = new URL(referenceUrl).hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (_) {}

  // Strip existing icons to avoid duplicates
  html = html.replace(/<link\s+[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/gi, "");
  
  if (faviconUrl) {
    const faviconTag = `<link rel="icon" href="${faviconUrl}">`;
    if (/<head([^>]*)>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n  ${faviconTag}`);
    } else {
      html = faviconTag + "\n" + html;
    }
  }

  // Step 2: Replace ALL <a href="..."> with the affiliate URL
  // We replace every anchor href so any button/link/CTA goes to affiliate
  html = html.replace(
    /<a(\s[^>]*?)href\s*=\s*(['"])[^'"]*\2/gi,
    (match, attrs, quote) => `<a${attrs}href=${quote}${affiliateUrl}${quote}`
  );

  const hasDrCash = !!(apiToken && streamCode);

  // Step 3: Replace all <form action="..."> with affiliate URL
  // ONLY if not using Dr.Cash, otherwise the SDK handles submission
  if (!hasDrCash) {
    html = html.replace(
      /<form(\s[^>]*?)action\s*=\s*(['"])[^'"]*\2/gi,
      (match, attrs, quote) => `<form${attrs}action=${quote}${affiliateUrl}${quote}`
    );
  }

  // Step 4: Strip common cookie/consent banner patterns
  // Remove elements with common cookie banner class/id names
  html = html.replace(
    /<[^>]+(id|class)=(['"])[^'"]*(?:cookie|consent|gdpr|lgpd|banner-cookie)[^'"]*\2[^>]*>[\s\S]*?<\/[a-z]+>/gi,
    ""
  );

  // Step 5: Inject tracking tags into <head>
  if (trackingTags && trackingTags.trim()) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n  ${trackingTags}`);
  }

  // Step 5.5: Clean up pre-existing Dr.Cash SDK scripts and calls if using Dr.Cash
  if (hasDrCash) {
    // Remove static.statthroat.tech and snippet.infothroat.com scripts
    html = html.replace(/<script[^>]*src=["']?[^"']*(?:statthroat\.tech|infothroat\.com)[^"']*["']?[^>]*><\/script>/gi, "");
    // Remove inline scripts initializing drlead
    html = html.replace(/<script[^>]*>[\s\S]*?drlead\.init[\s\S]*?<\/script>/gi, "");
  }

  // Step 6: Inject universal affiliate click interceptor + form submit interceptor / Dr.Cash SDK
  let drCashScript = "";
  if (hasDrCash) {
    drCashScript = `
<!-- Dr.Cash Lead SDK Integration -->
<script src="https://snippet.infothroat.com/dist/api/lead-1.1.0.min.js"></script>
<script>
(function() {
  function initDrCash() {
    var forms = document.querySelectorAll('form');
    if (forms.length === 0) {
      console.warn('Dr.Cash: No forms found to connect.');
      return;
    }
    forms.forEach(function(form) {
      form.classList.add('orderForm');
      form.removeAttribute('action');
      form.removeAttribute('method');
      form.removeAttribute('onsubmit');
      
      var inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach(function(input) {
        var nameAttr = (input.getAttribute('name') || '').toLowerCase();
        var placeholderAttr = (input.getAttribute('placeholder') || '').toLowerCase();
        var idAttr = (input.getAttribute('id') || '').toLowerCase();
        var type = (input.getAttribute('type') || '').toLowerCase();
        
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') {
          return;
        }
        
        if (nameAttr.indexOf('name') !== -1 || nameAttr.indexOf('nome') !== -1 || nameAttr.indexOf('client') !== -1 || placeholderAttr.indexOf('nome') !== -1 || placeholderAttr.indexOf('name') !== -1 || idAttr.indexOf('name') !== -1 || idAttr.indexOf('nome') !== -1) {
          input.setAttribute('name', 'name');
        }
        else if (nameAttr.indexOf('phone') !== -1 || nameAttr.indexOf('tel') !== -1 || nameAttr.indexOf('whatsapp') !== -1 || nameAttr.indexOf('celular') !== -1 || placeholderAttr.indexOf('tel') !== -1 || placeholderAttr.indexOf('phone') !== -1 || placeholderAttr.indexOf('whatsapp') !== -1 || idAttr.indexOf('phone') !== -1 || idAttr.indexOf('tel') !== -1) {
          input.setAttribute('name', 'phone');
        }
      });
    });
    
    if (typeof drlead !== 'undefined') {
      var thanksPage = ${JSON.stringify(thankYouUrl || "./Obrigado.html")};
      if (window.location.protocol === 'file:' || thanksPage === '#obrigado') {
        thanksPage = '#obrigado';
      }
      drlead.init({
        params: {
          token: ${JSON.stringify(apiToken)},
          stream_code: ${JSON.stringify(streamCode)},
          thanks_page: thanksPage
        }
      });
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrCash);
  } else {
    initDrCash();
  }
})();
</script>`;
  }

  const interceptorScript = `
<script>
(function() {
  var AFFILIATE = ${JSON.stringify(affiliateUrl)};
  var DR_CASH_ACTIVE = ${hasDrCash};
  var THANKS_PAGE = ${JSON.stringify(thankYouUrl || "#obrigado")};
  if (window.location.protocol === 'file:' || THANKS_PAGE === '#obrigado') {
    THANKS_PAGE = '#obrigado';
  }
  
  // Intercept clicks on navigational elements (excluding elements inside active Dr.Cash forms)
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, [onclick], input[type="submit"], input[type="button"]');
    if (!el) return;
    if (DR_CASH_ACTIVE && el.closest('form')) return;
    if (el.tagName === 'A' && el.href && el.href.indexOf(AFFILIATE) === 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    window.location.href = AFFILIATE;
  }, true);
  
  if (!DR_CASH_ACTIVE) {
    document.addEventListener('submit', function(e) {
      e.preventDefault();
      window.location.href = THANKS_PAGE;
    }, true);
  }
})();
</script>`;

  const injectedCode = (drCashScript ? drCashScript + "\n" : "") + interceptorScript;

  // Inject before </body> or at end
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${injectedCode}\n</body>`);
  } else {
    html += injectedCode;
  }

  return html;
}

const COOKIE_LOCALIZATION: Record<string, {
  title: string;
  desc: string;
  accept: string;
  decline: string;
  infoBtn: string;
  infoTitle: string;
  labelFormula: string;
  labelEntrega: string;
  labelPreco: string;
  labelOferta: string;
  valFormula: string;
  valEntrega: string;
  valPreco: string;
  valOferta: string;
  formatPreco: string;
  ctaOffer: string;
  descTemplate: string;
  priceDescFormat: string;
  priceValFormat: string;
}> = {
  "pt-BR": {
    title: "🍪 Política de Cookies",
    desc: "Utilizamos cookies para personalizar sua experiência. Ao continuar, você concorda com nossos termos.",
    accept: "Aceitar",
    decline: "Recusar",
    infoBtn: "Detalhes da Oferta",
    infoTitle: "Detalhes da Oferta",
    labelFormula: "Fórmula/Composição",
    labelEntrega: "Prazo de Entrega",
    labelPreco: "Preço e Condição",
    labelOferta: "Oferta Especial",
    valFormula: "Fórmula desenvolvida com compostos e extratos naturais selecionados.",
    valEntrega: "Envio rápido. Geralmente de 2 a 7 dias úteis com código de rastreamento.",
    valPreco: "Pagamento na Entrega (pague apenas ao receber o produto).",
    valOferta: "Promoção especial por tempo limitado no canal oficial.",
    formatPreco: "De <del>{orig}</del> por apenas <strong>{prom}</strong>",
    ctaOffer: "Aproveite o desconto! Oferta por tempo limitado.",
    descTemplate: "Página informativa oficial sobre o produto {prod}. Veja os detalhes da oferta e adquira com garantia de originalidade.",
    priceDescFormat: " De {orig} por apenas {prom}.",
    priceValFormat: " (Valor: {val})."
  },
  "es": {
    title: "🍪 Política de Cookies",
    desc: "Utilizamos cookies para personalizar su experiencia. Al continuar, usted acepta nuestros términos.",
    accept: "Aceptar",
    decline: "Rechazar",
    infoBtn: "Detalles de la Oferta",
    infoTitle: "Detalles de la Oferta",
    labelFormula: "Fórmula/Composição",
    labelEntrega: "Plazo de Entrega",
    labelPreco: "Precio y Condición",
    labelOferta: "Oferta Especial",
    valFormula: "Fórmula desarrollada con compuestos y extractos naturales seleccionados.",
    valEntrega: "Envío rápido. Generalmente de 2 a 7 dias hábiles con código de seguimiento.",
    valPreco: "Pago Contra Entrega (pague solo al recibir el producto).",
    valOferta: "Promoción especial por tempo limitado en el canal oficial.",
    formatPreco: "De <del>{orig}</del> por solo <strong>{prom}</strong>",
    ctaOffer: "¡Aprovecha el descuento! Oferta por tiempo limitado.",
    descTemplate: "Página informativa oficial sobre el producto {prod}. Vea los detalles de la oferta y compre con garantía de originalidad.",
    priceDescFormat: " De {orig} por solo {prom}.",
    priceValFormat: " (Valor: {val})."
  },
  "en": {
    title: "🍪 Cookie Policy",
    desc: "We use cookies to personalize your experience. By continuing, you agree to our terms.",
    accept: "Accept",
    decline: "Decline",
    infoBtn: "Offer Details",
    infoTitle: "Offer Details",
    labelFormula: "Formula/Ingredients",
    labelEntrega: "Delivery Time",
    labelPreco: "Price & Terms",
    labelOferta: "Special Offer",
    valFormula: "Formula developed with selected natural compounds and extracts.",
    valEntrega: "Fast shipping. Usually 2 to 7 business days with tracking number.",
    valPreco: "Cash on Delivery (pay only upon receiving the product).",
    valOferta: "Special limited-time promotion on the official channel.",
    formatPreco: "From <del>{orig}</del> to only <strong>{prom}</strong>",
    ctaOffer: "Enjoy the discount! Limited-time offer.",
    descTemplate: "Official informative page about the product {prod}. See the details of the offer and purchase with guarantee of originality.",
    priceDescFormat: " From {orig} to only {prom}.",
    priceValFormat: " (Price: {val})."
  },
  "it": {
    title: "🍪 Informativa sui Cookie",
    desc: "Utilizziamo i cookie per personalizzare la tua esperienza. Continuando, acconsenti ai nostri termini.",
    accept: "Accetta",
    decline: "Rifiuta",
    infoBtn: "Dettagli dell'Offerta",
    infoTitle: "Dettagli dell'Offerta",
    labelFormula: "Formula/Composizione",
    labelEntrega: "Tempi di Consegna",
    labelPreco: "Prezzo e Condizioni",
    labelOferta: "Offerta Speciale",
    valFormula: "Formula sviluppata con composti ed estratti naturali selezionati.",
    valEntrega: "Spedizione rapida. Geralmente 2-7 giorni lavorativi con codice di tracciamento.",
    valPreco: "Pagamento alla Consegna (paghi solo alla ricezione del prodotto).",
    valOferta: "Promozione speciale a tempo limitato sul canale ufficiale.",
    formatPreco: "Da <del>{orig}</del> a soli <strong>{prom}</strong>",
    ctaOffer: "Approfitta dello sconto! Offerta a tempo limitato.",
    descTemplate: "Pagina informativa ufficiale sul prodotto {prod}. Vedi i dettagli dell'offerta e acquista con garanzia di originalità.",
    priceDescFormat: " Da {orig} a soli {prom}.",
    priceValFormat: " (Valore: {val})."
  },
  "fr": {
    title: "🍪 Politique relative aux cookies",
    desc: "Nous utilisons des cookies pour personnaliser votre expérience. En continuant, vous acceptez nos conditions.",
    accept: "Accepter",
    decline: "Refuser",
    infoBtn: "Détails de l'offre",
    infoTitle: "Détails de l'offre",
    labelFormula: "Formule/Composition",
    labelEntrega: "Délai de Livraison",
    labelPreco: "Prix et Conditions",
    labelOferta: "Offre Spéciale",
    valFormula: "Formule développée avec des composés et extraits naturels sélectionnés.",
    valEntrega: "Expédition rapide. Généralement 2 à 7 jours ouvrables avec numéro de suivi.",
    valPreco: "Paiement à la Livraison (payez uniquement à la réception du produit).",
    valOferta: "Promotion spéciale à durée limitée sur le canal officiel.",
    formatPreco: "De <del>{orig}</del> à seulement <strong>{prom}</strong>",
    ctaOffer: "Profitez de la remise ! Offre à durée limitée.",
    descTemplate: "Page d'information officielle sur le produit {prod}. Consultez les détails de l'offre et achetez avec garantie d'authenticité.",
    priceDescFormat: " De {orig} à seulement {prom}.",
    priceValFormat: " (Valeur: {val})."
  },
  "de": {
    title: "🍪 Cookie-Richtlinie",
    desc: "Wir verwenden Cookies, um Ihre Erfahrung zu personalisieren. Durch die Fortsetzung stimmen Sie unseren Bedingungen zu.",
    accept: "Akzeptieren",
    decline: "Ablehnen",
    infoBtn: "Angebotsdetails",
    infoTitle: "Angebotsdetails",
    labelFormula: "Formel/Zusammensetzung",
    labelEntrega: "Lieferzeit",
    labelPreco: "Preis & Konditionen",
    labelOferta: "Sonderangebot",
    valFormula: "Formel entwickelt mit ausgewählten natürlichen Verbindungen und Extrakten.",
    valEntrega: "Schneller Versand. In der Regel 2 bis 7 Werktage mit Sendungsverfolgung.",
    valPreco: "Zahlung bei Lieferung (zahlen Sie erst bei Erhalt des Produkts).",
    valOferta: "Sonderaktion für begrenzte Zeit auf dem offiziellen Kanal.",
    formatPreco: "Von <del>{orig}</del> auf nur <strong>{prom}</strong>",
    ctaOffer: "Nutzen Sie den Rabatt! Zeitlich begrenztes Angebot.",
    descTemplate: "Offizielle Informationsseite über das Produkt {prod}. Sehen Sie sich die Angebotsdetails an und kaufen Sie mit Originalitätsgarantie.",
    priceDescFormat: " Von {orig} auf nur {prom}.",
    priceValFormat: " (Wert: {val})."
  },
  "ro": {
    title: "🍪 Politica de Cookie-uri",
    desc: "Folosim cookie-uri pentru a vă personaliza experiența. Continuând, sunteți de acord cu termenii noștri.",
    accept: "Acceptă",
    decline: "Refuză",
    infoBtn: "Detalii despre ofertă",
    infoTitle: "Detalii despre ofertă",
    labelFormula: "Formulă/Compoziție",
    labelEntrega: "Timp de Livrare",
    labelPreco: "Preț și Condiții",
    labelOferta: "Ofertă Specială",
    valFormula: "Formulă dezvoltată cu compuși și extracte naturale selectate.",
    valEntrega: "Livrare rapidă. De obicei 2-7 zile lucrătoare cu cod de urmărire.",
    valPreco: "Plată la Livrare (plătiți doar la primirea produsului).",
    valOferta: "Promoție specială pe perioadă limitată pe canalul oficial.",
    formatPreco: "De la <del>{orig}</del> la doar <strong>{prom}</strong>",
    ctaOffer: "Profită de reducere! Ofertă pe timp limitat.",
    descTemplate: "Pagina oficială de informații despre produsul {prod}. Consultați detaliile ofertei și cumpărați cu garanție de originalitate.",
    priceDescFormat: " De la {orig} la doar {prom}.",
    priceValFormat: " (Valoare: {val})."
  },
  "pl": {
    title: "🍪 Polityka Cookies",
    desc: "Używamy plików cookie, aby spersonalizować Twoje doświadczenie. Kontynuując, zgadzasz się na nasze warunki.",
    accept: "Akceptuję",
    decline: "Odrzucam",
    infoBtn: "Szczegóły oferty",
    infoTitle: "Szczegóły oferty",
    labelFormula: "Formuła/Skład",
    labelEntrega: "Czas Dostawy",
    labelPreco: "Cena i Warunki",
    labelOferta: "Oferta Specjalna",
    valFormula: "Formuła opracowana z wyselekcjonowanych naturalnych związków i ekstraktów.",
    valEntrega: "Szybka wysyłka. Zazwyczaj 2 do 7 dni roboczych z numerem śledzenia przesyłki.",
    valPreco: "Płatność przy Odbiorze (płać tylko przy odbiorze produktu).",
    valOferta: "Specjalna promocja ograniczona czasowo na oficjalnym kanale.",
    formatPreco: "Z <del>{orig}</del> na jedyne <strong>{prom}</strong>",
    ctaOffer: "Skorzystaj z rabatu! Oferta ograniczona czasowo.",
    descTemplate: "Oficjalna strona informacyjna o produkcie {prod}. Zobacz szczegóły oferty i kupuj z gwarancją oryginalności.",
    priceDescFormat: " Z {orig} na jedyne {prom}.",
    priceValFormat: " (Wartość: {val})."
  }
};

function detectLandingPageLanguage(html: string | null, referenceUrl: string, chosenLanguage: string = "auto"): string {
  let lang = chosenLanguage || "auto";
  if (lang !== "auto") {
    return lang;
  }

  // 1. Try to detect from HTML tag if available (optional quotes)
  if (html) {
    const htmlLangMatch = html.match(/<html\s+[^>]*lang=['"]?([a-zA-Z-]{2,5})['"]?/i);
    if (htmlLangMatch) {
      const rawLang = htmlLangMatch[1].toLowerCase();
      if (rawLang.startsWith("es")) return "es";
      if (rawLang.startsWith("pt")) return "pt-BR";
      if (rawLang.startsWith("en")) return "en";
      if (rawLang.startsWith("it")) return "it";
      if (rawLang.startsWith("fr")) return "fr";
      if (rawLang.startsWith("de")) return "de";
      if (rawLang.startsWith("ro")) return "ro";
      if (rawLang.startsWith("pl")) return "pl";
    }
  }

  // 2. Try to detect from reference URL
  if (referenceUrl) {
    const urlLower = referenceUrl.toLowerCase();
    if (urlLower.endsWith(".br") || urlLower.includes(".com.br")) {
      return "pt-BR";
    } else if (urlLower.endsWith(".es") || urlLower.includes(".com.es") || urlLower.includes("/es/")) {
      return "es";
    } else if (urlLower.endsWith(".it") || urlLower.includes("/it/")) {
      return "it";
    } else if (urlLower.endsWith(".fr") || urlLower.includes("/fr/")) {
      return "fr";
    } else if (urlLower.endsWith(".de") || urlLower.includes("/de/")) {
      return "de";
    } else if (urlLower.endsWith(".ro") || urlLower.includes("/ro/")) {
      return "ro";
    } else if (urlLower.endsWith(".pl") || urlLower.includes("/pl/")) {
      return "pl";
    }
  }

  // 3. Fallback: Robust word frequency / conjunction checking from HTML content
  if (html) {
    const textLower = html.toLowerCase();
    const scores: Record<string, number> = {
      "pt-BR": 0,
      "es": 0,
      "it": 0,
      "fr": 0,
      "de": 0,
      "ro": 0,
      "pl": 0,
      "en": 0
    };

    // Specific unique trigger words/phrases
    if (/\b(?:preço|desconto|composição|garantia|prazo|entrega|pague na entrega)\b/i.test(textLower)) scores["pt-BR"] += 15;
    if (/\b(?:precio|descuento|composición|garantía|plazo|contra entrega|pago contrareembolso)\b/i.test(textLower)) scores["es"] += 15;
    if (/\b(?:prezzo|sconto|composizione|garanzia|consegna|pagamento alla consegna)\b/i.test(textLower)) scores["it"] += 15;
    if (/\b(?:prix|remise|composition|garantie|livraison|paiement à la livraison)\b/i.test(textLower)) scores["fr"] += 15;
    if (/\b(?:preis|rabatt|zusammensetzung|garantie|lieferzeit|zahlung bei lieferung)\b/i.test(textLower)) scores["de"] += 15;
    if (/\b(?:preț|reducere|compoziție|garanție|timp de livrare|plată la livrare)\b/i.test(textLower)) scores["ro"] += 15;
    if (/\b(?:cena|rabat|skład|gwarancja|czas dostawy|płatność przy odbiorze)\b/i.test(textLower)) scores["pl"] += 15;

    // Split and count high frequency unique words/conjunctions
    const words = textLower.split(/\s+/);
    for (const w of words) {
      if (w === "y" || w === "con" || w === "para" || w === "los" || w === "las" || w === "del") scores["es"]++;
      if (w === "o" || w === "com" || w === "para" || w === "os" || w === "as" || w === "dos" || w === "das") scores["pt-BR"]++;
      if (w === "il" || w === "di" || w === "in" || w === "con" || w === "per" || w === "i" || w === "gli") scores["it"]++;
      if (w === "le" || w === "la" || w === "du" || w === "et" || w === "pour" || w === "avec") scores["fr"]++;
      if (w === "der" || w === "die" || w === "das" || w === "und" || w === "mit" || w === "für" || w === "von") scores["de"]++;
      if (w === "și" || w === "în" || w === "cu" || w === "pentru" || w === "din") scores["ro"]++;
      if (w === "w" || w === "i" || w === "z" || w === "na" || w === "dla") scores["pl"]++;
      if (w === "the" || w === "and" || w === "of" || w === "with" || w === "for" || w === "to") scores["en"]++;
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (best[0][1] > 3) {
      return best[0][0];
    }
  }

  return "en"; // default fallback
}

function generateScreenshotBridgeHtml(input: {
  referenceUrl: string;
  affiliateUrl: string;
  trackingTags: string;
  productHint: string;
  popupLanguage?: string;
}) {
  const product = input.productHint || "Oferta Oficial";
  const lang = detectLandingPageLanguage(null, input.referenceUrl, input.popupLanguage);
  
  const localization = COOKIE_LOCALIZATION[lang] || COOKIE_LOCALIZATION["en"];

  const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
  const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
  const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
  // Full-height, no crop — shows the full page naturally, using maxAge/24 cache for instant load
  const thumIoUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1280/${input.referenceUrl}`;

  let faviconUrl = "";
  try {
    const domain = new URL(input.referenceUrl).hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (_) {}

  const titleClean = localization.title.replace(/^🍪\s?/, "");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product}</title>
  <meta name="robots" content="index, follow" />
  <link rel="preload" as="image" href="${thumIoUrl}" />
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ""}
  ${input.trackingTags}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      /* Reserve space so content isn't hidden under the fixed bar */
      padding-bottom: 90px;
      cursor: pointer;
    }

    /* ── Website screenshot — a real responsive image, scrollable like a page ── */
    .site-screenshot {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
      -webkit-user-drag: none;
      user-select: none;
    }

    /* ── Cookie bar — fixed bottom, slides in, looks like every real GDPR notice ── */
    .cookie-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 99999;
      background: #ffffff;
      border-top: 1px solid #dee2e6;
      box-shadow: 0 -2px 20px rgba(0,0,0,0.10);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      animation: slideUp 0.35s ease forwards;
    }

    @keyframes slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }

    .cb-icon {
      font-size: 20px;
      line-height: 1;
      flex-shrink: 0;
    }

    .cb-text {
      flex: 1;
      min-width: 0;
    }

    .cb-title {
      font-size: 13px;
      font-weight: 700;
      color: #212529;
      margin-bottom: 2px;
    }

    .cb-desc {
      font-size: 12px;
      color: #6c757d;
      line-height: 1.5;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cb-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .cb-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 5px;
      cursor: pointer;
      border: none;
      white-space: nowrap;
      font-family: inherit;
      transition: filter 0.15s, transform 0.1s;
    }

    .cb-btn:active { transform: scale(0.97); }

    .cb-accept {
      background: #198754;
      color: #fff;
    }
    .cb-accept:hover { filter: brightness(0.92); }

    .cb-decline {
      background: transparent;
      color: #6c757d;
      border: 1px solid #ced4da;
    }
    .cb-decline:hover { background: #f8f9fa; }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      .cookie-bar {
        flex-wrap: wrap;
        padding: 12px 14px 14px;
        gap: 10px;
      }

      .cb-text { flex-basis: calc(100% - 34px); }

      .cb-desc {
        white-space: normal;
        overflow: visible;
        text-overflow: unset;
      }

      .cb-actions {
        width: 100%;
      }

      .cb-btn {
        flex: 1;
        padding: 11px 8px;
        font-size: 14px;
      }
    }
  </style>
</head>
<body>

  <!-- Loading Overlay -->
  <div id="screenshotLoader" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #ffffff; z-index: 9999999;">
    <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #198754; border-radius: 50%; animation: screenshotSpin 1s linear infinite;"></div>
  </div>
  <style>
    @keyframes screenshotSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>

  <img
    class="site-screenshot"
    src="${thumIoUrl}"
    alt="${product}"
    loading="eager"
    decoding="async"
    onload="var l = document.getElementById('screenshotLoader'); if(l) l.style.display='none';"
  />

  <script>
    // Safety net: hide loader after 5 seconds if image load event fails
    setTimeout(function() {
      var l = document.getElementById('screenshotLoader');
      if (l) l.style.display = 'none';
    }, 5000);
  </script>

  <div class="cookie-bar" id="cookieBar">
    <span class="cb-icon" aria-hidden="true" style="display: inline-flex; align-items: center;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </span>
    <div class="cb-text">
      <div class="cb-title">${titleClean}</div>
      <div class="cb-desc">${localization.desc}</div>
    </div>
    <div class="cb-actions">
      <button class="cb-btn cb-decline" id="btnDecline">${localization.decline}</button>
      <button class="cb-btn cb-accept"  id="btnAccept">${localization.accept}</button>
    </div>
  </div>

  <script>
  (function(){
    var DEST = ${JSON.stringify(input.affiliateUrl)};
    function go(e){ if(e) e.stopPropagation(); window.location.href = DEST; }
    document.getElementById('btnAccept').addEventListener('click', go);
    document.getElementById('btnDecline').addEventListener('click', go);
    // Any click outside the bar also redirects
    document.addEventListener('click', function(e){
      if(!e.target.closest('#cookieBar')) go();
    });
  })();
  </script>

</body>
</html>`;
}

function fallbackBridgeHtml(input: {
  referenceUrl: string;
  affiliateUrl: string;
  trackingTags: string;
  productHint: string;
  selectedOption?: string;
  popupLanguage?: string;
}) {
  const product = input.productHint || "Oferta Oficial";
  const isOptionA = input.selectedOption === "a";
  const lang = detectLandingPageLanguage(null, input.referenceUrl, input.popupLanguage);
  const localization = COOKIE_LOCALIZATION[lang] || COOKIE_LOCALIZATION["en"];

  let faviconUrl = "";
  try {
    const domain = new URL(input.referenceUrl).hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (_) {}

  const overlayHtml = isOptionA ? `
  <!-- Cookie Consent Overlay Modal -->
  <div class="cookie-overlay" id="cookieOverlay" onclick="window.location.href='${input.affiliateUrl}'">
    <div class="cookie-box" onclick="event.stopPropagation()">
      <div class="cookie-title">${localization.title}</div>
      <p class="cookie-desc">
        ${localization.desc}
      </p>
      <div class="cookie-buttons">
        <a href="${input.affiliateUrl}" class="cookie-btn cookie-btn-secondary">${localization.decline}</a>
        <a href="${input.affiliateUrl}" class="cookie-btn cookie-btn-primary">${localization.accept}</a>
      </div>
    </div>
  </div>
  ` : "";

  const overlayStyles = isOptionA ? `
    /* Cookie Overlay Modal Styling */
    .cookie-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      padding: 24px;
      cursor: pointer;
    }
    .cookie-box {
      background: #ffffff;
      border-radius: 12px;
      padding: 20px;
      max-width: 320px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05);
      text-align: center;
      cursor: default;
      animation: cookiePop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
    .cookie-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .cookie-desc {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .cookie-buttons {
      display: flex;
      justify-content: center;
      gap: 12px;
    }
    .cookie-btn {
      flex: 1;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .cookie-btn-secondary {
      background: #f44336;
      color: #ffffff;
    }
    .cookie-btn-secondary:hover {
      background: #e53935;
    }
    .cookie-btn-primary {
      background: #4caf50;
      color: #ffffff;
    }
    .cookie-btn-primary:hover {
      background: #43a047;
    }
    @keyframes cookiePop {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  ` : "";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product} - Canal Oficial</title>
  <meta name="robots" content="index, follow" />
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ""}
  ${input.trackingTags}
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #ffffff;
      color: #1e293b;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    header {
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header .logo {
      font-size: 18px;
      font-weight: 800;
      color: #0f766e;
    }
    header .badge {
      color: #0f766e;
      background: #ccfbf1;
      font-size: 10px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 999px;
    }
    .hero {
      max-width: 800px;
      margin: 80px auto;
      padding: 0 24px;
      text-align: center;
    }
    h1 {
      font-size: 42px;
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 16px;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    p {
      color: #475569;
      font-size: 18px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 8px;
      background: #0f766e;
      color: #fff;
      text-decoration: none;
      font-weight: 800;
      padding: 16px 32px;
      font-size: 16px;
      box-shadow: 0 10px 15px -3px rgba(15, 118, 110, 0.3);
      transition: all 0.2s;
    }
    .cta:hover {
      background: #0d5e58;
      transform: translateY(-1px);
    }
    .footer {
      background: #0f172a;
      color: #94a3b8;
      padding: 40px 24px;
      text-align: center;
      font-size: 12px;
    }
    ${overlayStyles}
  </style>
</head>
<body>
  ${overlayHtml}
  <header>
    <div class="logo">${product}</div>
    <span class="badge">Parceiro Autorizado</span>
  </header>
  <main class="hero">
    <h1>Adquira o ${product} Original</h1>
    <p>Você foi redirecionado com segurança para o canal de distribuição oficial do fabricante. Clique no botão abaixo para concluir sua compra com preço de fábrica e descontos especiais.</p>
    <a class="cta" href="${input.affiliateUrl}">Acessar Site Oficial do ${product}</a>
  </main>
  <footer class="footer">
    <p style="color: #64748b; font-size: 11px; margin-bottom: 8px">Este site é um canal seguro de redirecionamento. Não coletamos dados pessoais neste domínio.</p>
    <p>&copy; 2026 ${product}. Todos os direitos reservados.</p>
  </footer>
</body>
</html>`;
}

async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      redirect: "follow"
    });
    return res.url || url;
  } catch (err: any) {
    logger.warn({ err: err.message, url }, "Failed to resolve redirect URL with HEAD, trying GET...");
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        redirect: "follow"
      });
      return res.url || url;
    } catch (_) {
      return url;
    }
  }
}

async function downloadAsset(url: string, referenceUrl: string, cookies: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Referer": referenceUrl
    };
    if (cookies) {
      headers["Cookie"] = cookies;
    }
    const res = await fetch(url, { headers });

    if (res.status === 200) {
      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "";
      return { buffer: Buffer.from(buffer), contentType };
    }
    logger.warn({ url, status: res.status }, "Failed to fetch asset during template building");
    return null;
  } catch (err: any) {
    logger.warn({ url, err: err.message }, "Error fetching asset during template building");
    return null;
  }
}

async function extractBackgroundImage(html: string, referenceUrl: string, cookies: string): Promise<string> {
  try {
    // 1. Try body inline style
    const bodyStyleMatch = html.match(/<body[^>]*style=["'][^"']*background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i);
    if (bodyStyleMatch && bodyStyleMatch[2]) {
      return bodyStyleMatch[2].trim();
    }

    // 2. Try generic background-image inline style
    const inlineBgMatch = html.match(/background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i);
    if (inlineBgMatch && inlineBgMatch[2]) {
      return inlineBgMatch[2].trim();
    }

    // 3. Scan external stylesheets linked in the HTML document
    const cssLinks: string[] = [];
    const cssLinkRegex = /<link[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi;
    let match;
    while ((match = cssLinkRegex.exec(html)) !== null) {
      cssLinks.push(match[1]);
    }
    
    const stylesheetRegex = /<link[^>]*rel=["']stylesheet["'][^]href=["']([^"']+)["']/gi;
    let ssMatch;
    while ((ssMatch = stylesheetRegex.exec(html)) !== null) {
      cssLinks.push(ssMatch[1]);
    }

    const uniqueCssUrls = Array.from(new Set(cssLinks)).map(relUrl => {
      try {
        return new URL(relUrl.trim(), referenceUrl).href;
      } catch (_) {
        return "";
      }
    }).filter(url => url !== "");

    logger.info({ uniqueCssUrls }, "Compliance background extraction: scanning stylesheets");

    for (const cssUrl of uniqueCssUrls) {
      try {
        const asset = await downloadAsset(cssUrl, referenceUrl, cookies);
        if (asset) {
          const cssContent = asset.buffer.toString("utf8");
          
          // Pattern A: body background-image/background URL
          const bodyBgRegex = /(?:body|html|\.wrapper|\.main|\.page|\.bg-container)[^{]*\{[^}]*background(?:-image)?\s*:\s*url\((['"]?)([^'")\s]+)\1\)/i;
          const bodyMatch = cssContent.match(bodyBgRegex);
          if (bodyMatch && bodyMatch[2]) {
            const relBg = bodyMatch[2].trim();
            const absBg = new URL(relBg, cssUrl).href;
            logger.info({ cssUrl, relBg, absBg }, "Found body background-image URL in external stylesheet");
            return absBg;
          }

          // Pattern B: generic background urls matching keywords
          const bgUrlRegex = /background(?:-image)?\s*:\s*url\((['"]?)([^'")\s]+)\1\)/gi;
          let bgUrlMatch;
          while ((bgUrlMatch = bgUrlRegex.exec(cssContent)) !== null) {
            const relBg = bgUrlMatch[2].trim();
            if (relBg.includes("bg") || relBg.includes("background") || relBg.includes("hero") || relBg.includes("pattern") || relBg.includes("pulse") || relBg.includes("heart") || relBg.includes("beat")) {
              const absBg = new URL(relBg, cssUrl).href;
              logger.info({ cssUrl, relBg, absBg }, "Found keyword background-image URL in stylesheet");
              return absBg;
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message, cssUrl }, "Failed to fetch css during background extraction");
      }
    }

    // 4. Try og:image fallback
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      return ogImageMatch[1].trim();
    }

    // 5. Try first large img tag fallback
    const imgRegex = /<img\s+([^>]+)>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      const attrs = imgMatch[1];
      const src = getAttributeValue(attrs, 'data-original') ||
                  getAttributeValue(attrs, 'data-lazy-src') ||
                  getAttributeValue(attrs, 'data-src') ||
                  getAttributeValue(attrs, 'src');
      if (src && isValidImageSrc(src) && !src.includes("logo") && !src.includes("icon") && !src.includes("avatar")) {
        return new URL(src.trim(), referenceUrl).href;
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "extractBackgroundImage search failed");
  }

  return "";
}

function generateCleanBackgroundPresellHtml(input: {
  productName: string;
  referenceUrl: string;
  affiliateUrl: string;
  trackingTags: string;
  backgroundImageUrl: string;
  mobileBackgroundImageUrl?: string;
  popupLanguage: string;
  meta: PageMetadata;
}): string {
  const product = input.productName || "Oferta Oficial";
  const bgUrl = input.backgroundImageUrl;
  const mobileBgUrl = input.mobileBackgroundImageUrl || bgUrl;
  const lang = input.popupLanguage || "pt-BR";
  
  let faviconUrl = "";
  try {
    const domain = new URL(input.referenceUrl).hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (_) {}

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product}</title>
  <meta name="robots" content="index, follow" />
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ""}
  ${input.trackingTags}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #ffffff;
      min-height: 100vh;
      position: relative;
      overflow-x: hidden;
    }
    
    /* Ambient blurred background layer */
    .ambient-bg {
      position: fixed;
      inset: 0;
      background-image: url('${bgUrl}');
      background-size: cover;
      background-position: center top;
      filter: blur(50px);
      opacity: 0.35;
      z-index: 0;
      pointer-events: none;
    }
    
    .site-background-container {
      width: 100%;
      max-width: 1920px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }
    .site-background-img {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
      -webkit-user-drag: none;
      user-select: none;
    }
    .ads-desktop-bg {
      display: block;
    }
    .ads-mobile-bg {
      display: none;
    }
    @media (max-width: 768px) {
      .ambient-bg {
        display: none;
      }
      .site-background-container {
        width: 100%;
      }
      .site-background-img.ads-mobile-bg {
        display: block;
        width: 100%;
        height: auto;
      }
      .ads-desktop-bg {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="ambient-bg"></div>
  <div class="site-background-container">
    ${bgUrl ? `<img class="site-background-img ads-desktop-bg" src="${bgUrl}" alt="desktop background" />` : ""}
    ${mobileBgUrl ? `<img class="site-background-img ads-mobile-bg" src="${mobileBgUrl}" alt="mobile background" />` : ""}
  </div>
</body>
</html>`;
}

async function queryGemini(systemPrompt: string, userPrompt: string, jsonMode = false): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: jsonMode ? "application/json" : "text/plain",
      temperature: 0.1,
    }
  });

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: systemPrompt }]
      },
      {
        role: "model",
        parts: [{ text: "Entendido. Serei o seu especialista de copy para compliance de anúncios do Google. Envie-me os textos para análise." }]
      }
    ]
  });

  const result = await chat.sendMessage(userPrompt);
  return result.response.text();
}

function rewriteClaimsWithLocalDictionary(html: string): string {
  // Regex mapping of known violating patterns to safe compliance terminology
  const mapping: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /\b(comprovou sua eficácia|comprovado clinicamente|clinicamente comprovado|eficácia clínica comprovada)\b/gi, replacement: "Fórmula com ingredientes estudados" },
    { regex: /\b(cura a diabetes|cura o diabetes|controla a glicemia|reduzir os níveis de açúcar no sangue|reduz o açúcar no sangue)\b/gi, replacement: "apoia o equilíbrio metabólico saudável" },
    { regex: /\b(cura a hipertensão|cura a pressão alta|controla a pressão arterial|previne infartos)\b/gi, replacement: "promove a saúde cardiovascular" },
    { regex: /\b(elimina parasitas|mata vermes|elimina toxinas|desintoxicação total)\b/gi, replacement: "auxilia no equilíbrio da flora intestinal e suporte digestivo" },
    { regex: /\b(cura artrite|elimina a dor nas juntas|elimina a dor nas articulações)\b/gi, replacement: "promove o bem-estar e mobilidade articular" },
    { regex: /\b(perdi \d+\s*(?:kg|kilos|kilos em \d+ dias))\b/gi, replacement: "me sinto mais leve e com mais disposição" },
    { regex: /\b(emagreça rápido|queima de gordura garantida|perda de peso garantida)\b/gi, replacement: "auxilia na digestão e controle de peso saudável" },
    { regex: /\b(apenas \d+ unidades restantes|últimas \d+ unidades no estoque)\b/gi, replacement: "Aproveite a condição de lançamento" },
    { regex: /\b(o melhor do mundo|fórmula secreta|segredo que os médicos escondem)\b/gi, replacement: "Fórmula exclusiva com ingredientes de origem natural" },
    { regex: /\b(se não tratar pode levar à morte|risco de mortalidade alto)\b/gi, replacement: "Mantenha seus exames em dia e sua rotina saudável" },
    { regex: /\b(sem efeitos colaterais|100% livre de efeitos colaterais)\b/gi, replacement: "Fórmula suave desenvolvida com ingredientes naturais" }
  ];

  let cleaned = html;
  for (const item of mapping) {
    cleaned = cleaned.replace(item.regex, item.replacement);
  }
  return cleaned;
}

async function queryGroq(messages: any[], jsonMode = false) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not defined in environment");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages,
      temperature: 0.1,
      response_format: jsonMode ? { type: "json_object" } : undefined
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${text}`);
  }

  const data = await response.json() as any;
  return data.choices[0]?.message?.content || "";
}


async function rewriteClaimsForCompliance(html: string): Promise<string> {
  try {
    // 1. Find potential policy violating text segments inside typical content tags.
    // We match text between tags that contains no nested HTML tags.
    const tagRegex = /<([a-z1-6]+)(?:\s[^>]*)?>[\s\n]*([^<>]{10,1000}?)[\s\n]*<\/\1>/gi;
    
    // Broad keyword list covering all 6 violation categories from the agente-copy-compliance training:
    // CAT 1 - Medical claims, cures, clinical efficacy, study results
    // CAT 2 - Fake urgency / scarcity
    // CAT 3 - Superlatives / unverifiable claims
    // CAT 4 - Testimonials with specific results
    // CAT 5 - Fear / psychological pressure
    // CAT 6 - Misleading prices
    const keywordRegex = /\b(dias|days|semanas|weeks|perder|lose|peso|weight|emagrecer|queimar|fat|gordura|grasa|kg|kilos|kilo|garantido|guaranteed|garantia|cure|cura|curar|trata|treat|elimina|eliminate|elimine|combate|combat|comprovou|comprovad[ao]|aprovado|approved|comprovado|proven|clinicamente|clinically|efic[aá]cia|efficacy|m[eé]dico|doctor|especialista|specialist|parasita|parasite|verme|worm|toxina|toxin|diabetes|diab[eé]tic[oa]s?|hipertens[aã]o|c[aâ]ncer|artrite|arthritis|a[cç][uú]car|sangue|melhoria|improvement|estudo|study|estudos|studies|particip[ae]ntes?|participants?|ensaio|trial|pesquisa|research|percentagem|porcentagem|n[ií]veis|complicaç|complic|secreto|secret|proibido|escondido|unidades restantes|estoque|expira|expires|melhor do mundo|n[uú]mero 1|efeito colateral|side effect|mortalidade|mortality|morte|death|r[aá]pido|fast|instant[aâ]neo|instant|desconto|discount|promo[cç][aã]o|oferta especial)\b/i;
    
    // We scan using the regex and check against keywords.
    const candidates = new Set<string>();
    let match;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(html)) !== null) {
      const text = match[2];
      if (!text || text.trim().length < 10) continue;
      if (keywordRegex.test(text)) {
        candidates.add(text);
      }
    }

    if (candidates.size === 0) {
      logger.info("Compliance rewriter: No suspicious claims found in text nodes.");
      return html;
    }

    const candidatesList = Array.from(candidates);
    logger.info({ count: candidatesList.length }, "Compliance rewriter: Found text node candidates for checking");

    // 2. Full agente-copy-compliance training embedded as Groq system prompt
    const COMPLIANCE_SYSTEM_PROMPT = `Você é um especialista em compliance de copy para Google Ads com foco em páginas de afiliados de saúde e bem-estar. Sua função é receber textos extraídos de uma landing page, identificar os que violam as políticas do Google Ads e reescrevê-los com linguagem compliant — preservando idioma original e posicionamento do produto.

## REGRA PRINCIPAL SOBRE REESCRITA
SEMPRE gere uma alternativa compliant para textos violadores. NUNCA retorne string vazia ou null. Todo texto violador deve ter uma substituição com copy de qualidade que preserve o tom persuasivo mas dentro das políticas do Google Ads.

## CATEGORIAS DE VIOLAÇÃO — DETECTAR E REESCREVER

### CAT 1 — Alegações médicas, eficácia clínica e estudos
Proibido: "comprovou sua eficácia", "eliminar complicações relacionadas ao diabetes", "reduzir os níveis de açúcar no sangue", "clinicamente comprovado", "aprovado por médicos", percentuais de eficácia com referência a estudos ("73% dos diabéticos sentiram melhoria"), "X dias após o início do estudo", "melhoria 30 dias", nomes de doenças + promessa de resultado.
✅ Reescrever como: orientação a ingredientes naturais, bem-estar geral, rotina saudável.
Exemplos críticos:
- "O uso de [Produto] comprovou sua eficácia" → "Descubra por que [Produto] é a escolha de quem busca bem-estar"
- "Para reduzir os níveis de açúcar no sangue e eliminar complicações relacionadas ao diabetes" → "Para quem busca apoio ao equilíbrio metabólico com ingredientes naturais"
- "Percentagem de diabéticos que sentiram uma melhoria 30 dias após o início do estudo" → [retornar string vazia — esta linha indica seção com stats clínicos a ser removida]
- "Cura a hipertensão" → "Fórmula com ingredientes associados à saúde cardiovascular"
- "Elimina parasitas" → "Blend de ervas utilizadas na medicina tradicional para suporte intestinal"
- "97% de eficácia clínica" → "Escolhido por quem busca uma rotina de bem-estar mais equilibrada"
- "Clinicamente comprovado" → "Formulado com ingredientes de origem natural"

### CAT 2 — Urgência falsa e escassez manipuladora
Proibido: número fixo de unidades, timers em loop, "847 pessoas estão vendo agora", "Preço sobe amanhã".
✅ Exemplos: "Apenas 7 unidades restantes" → "Condição especial por tempo limitado" | "Preço sobe amanhã" → "Aproveite enquanto o desconto de lançamento está ativo" | Contadores falsos → [string vazia]

### CAT 3 — Superlativos e promessas não comprováveis
Proibido: "O melhor do mundo", "Número 1", "Resultado garantido em X dias", "Sem efeitos colaterais", "Fórmula secreta", "segredo que médicos escondem".
✅ Exemplos: "Resultado garantido em 30 dias" → "Para melhores resultados, use por pelo menos 30 dias" | "Sem efeitos colaterais" → "Formulado sem glúten, sem corantes artificiais" | "Fórmula secreta" → "Fórmula exclusiva com blend de ingredientes naturais"

### CAT 4 — Depoimentos com resultados extraordinários
Proibido: "Perdi 20kg em 30 dias" sem disclaimer.
✅ Suavizar: "me sinto com mais energia e leveza" (manter experiência subjetiva, remover resultado quantitativo)

### CAT 5 — Medo e pressão psicológica
Proibido: estatísticas de mortalidade, "Se não agir agora sua saúde piora", sintomas alarmistas com imagens de doenças.
✅ Exemplos: "Se não tratar pode levar à morte" → "Muitas pessoas buscam alternativas naturais quando sentem cansaço" | Estatísticas de mortalidade → [string vazia]

### CAT 6 — Preços enganosos
Proibido: preço original inflado sem referência, múltiplos preços riscados.
✅ Manter apenas: 1 preço original + 1 preço atual com contexto claro.

## REFERÊNCIA POR NICHO
Cardiovascular: ✅ "Fórmula com magnésio, coenzima Q10 e extrato de alho" ❌ "Controla a pressão arterial", "Previne infartos"
Emagrecimento: ✅ "Fórmula com café verde, chá verde e gengibre" ❌ "Emagrece X kg em Y dias", "Queima gordura garantida"
Parasitas/Detox: ✅ "Blend de ervas com propriedades purificantes: boldo, cúrcuma, pau-d'arco" ❌ "Elimina parasitas", "Mata vermes"
Diabetes/Metabólico: ✅ "Fórmula com berberina, canela e cromo — ingredientes estudados para equilíbrio metabólico" ❌ "Controla glicemia", "Reduz açúcar no sangue garantido"
Articulações: ✅ "Fórmula com colágeno, cúrcuma e boswellia" ❌ "Cura artrite", "Elimina dor nas juntas em X dias"

## REGRAS INVIOLÁVEIS
1. Preservar SEMPRE o idioma original (português, espanhol, inglês)
2. SEMPRE gerar uma substituição de qualidade — nunca retornar string vazia exceto para linhas com stats clínicos (percentagens + referência a estudo)
3. Nunca inventar ingredientes não mencionados no texto original
4. Textos que NÃO violam nenhuma categoria: retornar EXATAMENTE como estão
5. Retornar APENAS JSON válido, sem texto antes ou depois

## FORMATO DE RESPOSTA
{"texto original exato": "texto reescrito compliance"}`;

    const systemMessage = {
      role: "system",
      content: COMPLIANCE_SYSTEM_PROMPT
    };

    const userMessage = {
      role: "user",
      content: `Analise os textos abaixo. Para textos violadores: gere uma alternativa compliant persuasiva (NUNCA retorne string vazia, exceto para linhas com percentagens + referência a estudo clínico). Para textos não violadores: retorne idênticos. Retorne APENAS JSON válido.

Textos para analisar:
${JSON.stringify(candidatesList.map(c => c.trim()), null, 2)}`
    };

    let responseText = "";
    let useGemini = false;
    
    try {
      responseText = await queryGroq([systemMessage, userMessage], true);
    } catch (groqErr: any) {
      logger.warn({ err: groqErr.message }, "Groq compliance rewriter failed, trying Gemini...");
      useGemini = true;
    }

    if (useGemini) {
      try {
        responseText = await queryGemini(COMPLIANCE_SYSTEM_PROMPT, userMessage.content, true);
      } catch (geminiErr: any) {
        logger.error({ err: geminiErr.message }, "Gemini compliance rewriter failed, falling back to local dictionary");
        return rewriteClaimsWithLocalDictionary(html);
      }
    }

    let mapping: Record<string, string> = {};
    try {
      mapping = JSON.parse(responseText);
    } catch (parseErr: any) {
      logger.error({ err: parseErr.message, responseText }, "AI response is not valid JSON, using local dictionary");
      return rewriteClaimsWithLocalDictionary(html);
    }

    // 3. Apply the rewrites back into the HTML
    let cleanedHtml = html;
    let rewritesCount = 0;
    for (const [originalTrimmed, rewritten] of Object.entries(mapping)) {
      const originalFull = candidatesList.find(c => c.trim() === originalTrimmed);
      if (originalFull && originalTrimmed !== rewritten && rewritten.trim()) {
        cleanedHtml = cleanedHtml.replaceAll(originalFull, rewritten);
        rewritesCount++;
        logger.info({ originalFull, rewritten }, "Compliance rewriter: Rewrote claim");
      }
    }
    
    logger.info({ rewritesCount }, "Compliance rewriter: Finished replacing claims in HTML");
    
    // Always run the local dictionary afterwards to catch any edge cases that the AI missed
    return rewriteClaimsWithLocalDictionary(cleanedHtml);
  } catch (err: any) {
    logger.warn({ err: err.message }, "Compliance rewriter failed completely, running local dictionary on original HTML");
    return rewriteClaimsWithLocalDictionary(html);
  }
}

function stripBeforeAfterSections(html: string): string {
  try {
    // 1. Find opening tags of containers (section, div, li)
    const targetTagRegex = /<(section|div|li)(\s+[^>]*)?>/gi;
    
    let match;
    let iterations = 0;
    
    // We run a loop to find and remove these sections.
    while (iterations < 10) {
      targetTagRegex.lastIndex = 0;
      let foundTagStartIndex = -1;
      let foundTagName = "";
      let foundFullStartTag = "";
      
      while ((match = targetTagRegex.exec(html)) !== null) {
        const tagName = match[1];
        const fullStartTag = match[0];
        
        // Extract class or id attributes from this opening tag
        const classOrIdMatch = /\s(class|id)=['"]([^'"]*)['"]/i.exec(fullStartTag);
        if (classOrIdMatch) {
          const attrVal = classOrIdMatch[2].toLowerCase();
          const matchesKeyword = 
            attrVal.includes("result") || 
            attrVal.includes("before-after") || 
            attrVal.includes("bef-aft") || 
            attrVal.includes("testimonial") || 
            attrVal.includes("review") || 
            attrVal.includes("befaft");
            
          if (matchesKeyword) {
            foundTagStartIndex = match.index;
            foundTagName = tagName;
            foundFullStartTag = fullStartTag;
            break;
          }
        }
      }
      
      if (foundTagStartIndex === -1) break;
      
      // Balance tags to find the correct closing tag
      let openTagsCount = 0;
      const tagBalanceRegex = new RegExp(`<(?:${foundTagName}(?:\\s[^>]*)?|\\/${foundTagName})>`, 'gi');
      tagBalanceRegex.lastIndex = foundTagStartIndex;
      
      let balanceMatch;
      let tagEndIndex = -1;
      
      while ((balanceMatch = tagBalanceRegex.exec(html)) !== null) {
        const foundTag = balanceMatch[0];
        if (foundTag.startsWith('</')) {
          openTagsCount--;
        } else {
          openTagsCount++;
        }
        
        if (openTagsCount === 0) {
          tagEndIndex = balanceMatch.index + foundTag.length;
          break;
        }
      }
      
      if (tagEndIndex !== -1) {
        logger.info({ tagName: foundTagName, tagStartIndex: foundTagStartIndex, tagEndIndex }, "Stripping before/after section from HTML");
        html = html.substring(0, foundTagStartIndex) + html.substring(tagEndIndex);
      } else {
        // If we couldn't balance, we must break to avoid infinite loop
        break;
      }
      
      iterations++;
    }

    // 2. Remove any stray images containing before/after/bef-aft/befaft keywords in their src
    html = html.replace(/<img\s+[^>]*src=['"][^'"]*(?:before|after|bef-aft|bef_aft|befaft)[^'"]*['"][^>]*>/gi, "");
    
    return html;
  } catch (err: any) {
    logger.warn({ err: err.message }, "stripBeforeAfterSections failed, returning HTML unchanged");
    return html;
  }
}

/**
 * Remove entire sections/divs that contain clinical study percentage statistics.
 * These sections (e.g. "73% dos diabéticos sentiram melhoria após o estudo") cannot be
 * compliantly rewritten — the entire block must be removed.
 */
function removeStudyStatSections(html: string): string {
  try {
    // Keywords indicating a clinical study stats section
    const studyKeywordRegex = /\b(estudo|study|estudos|studies|melhoria|improvement|comprovad[ao]|comprovou|diabéticos|diab[eé]tic[oa]s|participantes|participants|ensaio|trial|percentagem|porcentagem|eficácia clínica|clinical efficacy)\b/i;
    // Percentage pattern: 21,2% or 73% or 90.4%
    const percentageRegex = /\d+[,.]?\d*\s*%/;

    const targetTagRegex = /<(section|div)(\s+[^>]*)?>/gi;
    let iterations = 0;

    while (iterations < 20) {
      targetTagRegex.lastIndex = 0;
      let foundStart = -1;
      let foundEnd = -1;

      let match;
      while ((match = targetTagRegex.exec(html)) !== null) {
        const tagName = match[1];
        const startIndex = match.index;

        // Balance open/close tags to find the full block
        const balanceRegex = new RegExp(`<(?:${tagName}(?:\\s[^>]*)?|\\/${tagName})>`, 'gi');
        balanceRegex.lastIndex = startIndex;

        let openCount = 0;
        let endIndex = -1;
        let bm;
        while ((bm = balanceRegex.exec(html)) !== null) {
          if (bm[0].startsWith('</')) openCount--;
          else openCount++;
          if (openCount === 0) {
            endIndex = bm.index + bm[0].length;
            break;
          }
        }

        if (endIndex === -1) continue;

        const blockText = html.substring(startIndex, endIndex);

        // Remove if block contains BOTH study keywords AND percentage stats
        if (studyKeywordRegex.test(blockText) && percentageRegex.test(blockText)) {
          foundStart = startIndex;
          foundEnd = endIndex;
          break;
        }
      }

      if (foundStart === -1) break;

      logger.info({ foundStart, foundEnd }, "Compliance: Removing clinical study stats section");
      html = html.substring(0, foundStart) + html.substring(foundEnd);
      iterations++;
    }

    return html;
  } catch (err: any) {
    logger.warn({ err: err.message }, "removeStudyStatSections failed, returning HTML unchanged");
    return html;
  }
}

/**
 * Injects a scroll-blocking overlay + a cookie consent popup that appears after 2 seconds.
 * Option A: the page looks like the real cloned site, scroll is locked,
 * and the cookie popup slides in after 2 seconds.
 */
function injectCookieConsentOverlay(
  html: string,
  affiliateUrl: string,
  referenceUrl: string,
  lang: string = "pt-BR",
  meta?: PageMetadata
): string {
  const detectedLang = detectLandingPageLanguage(html, referenceUrl, lang);
  const primaryColor = meta?.primaryColor || "#16a34a";
  const ctaButtonColor = meta?.ctaButtonColor || primaryColor;

  const localization = COOKIE_LOCALIZATION[detectedLang] || COOKIE_LOCALIZATION["en"];
  const titleClean = localization.title.replace(/^\u{1F36A}\s?/u, "");

  const productName = meta?.productName || "Produto";
  
  // Resolve / generate SEO description if empty
  let seoDesc = meta?.seoDescription || "";
  if (!seoDesc) {
    seoDesc = localization.descTemplate.replace("{prod}", productName);
  }

  // Add the price comparison details and CTA directly into the SEO description
  if (meta?.originalPrice && meta?.promotionalPrice) {
    const priceText = localization.priceDescFormat
      .replace("{orig}", meta.originalPrice)
      .replace("{prom}", meta.promotionalPrice);
    seoDesc += `${priceText} ${localization.ctaOffer}`;
  } else if (meta?.extractedPrice) {
    const priceText = localization.priceValFormat.replace("{val}", meta.extractedPrice);
    seoDesc += `${priceText} ${localization.ctaOffer}`;
  } else {
    seoDesc += ` ${localization.ctaOffer}`;
  }

  // Resolve formula, price, delivery, and offer values
  const valFormulaResolved = meta?.extractedFormula || localization.valFormula;
  
  let valPrecoResolved = "";
  if (meta?.originalPrice && meta?.promotionalPrice) {
    const mainPriceText = localization.formatPreco
      .replace("{orig}", meta.originalPrice)
      .replace("{prom}", meta.promotionalPrice);
    valPrecoResolved = `${mainPriceText} - ${localization.valPreco}`;
  } else if (meta?.extractedPrice) {
    valPrecoResolved = `${meta.extractedPrice} - ${localization.valPreco}`;
  } else {
    const baseOffer = meta?.extractedOffer || "";
    valPrecoResolved = baseOffer
      ? `${baseOffer} - ${localization.valPreco}`
      : localization.valPreco;
  }
  // Append CTA to pricing display as well
  valPrecoResolved = `${valPrecoResolved} (${localization.ctaOffer})`;

  const valEntregaResolved = localization.valEntrega;
  const valOfertaResolved = meta?.extractedOffer
    ? `${meta.extractedOffer} - ${localization.valOferta}`
    : localization.valOferta;

  // Additional safe details extracted from the landing page
  const seoDetails = meta?.productDetails || [];

  const overlay = `
<!-- Ads Intelligence: Cookie Overlay (popup after 2s) -->
<style id="ads-cookie-style">
  #ads-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: transparent;
    pointer-events: none;
  }
  #ads-overlay.ads-show {
    display: block;
  }
  #ads-card {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #ffffff;
    border-radius: 20px;
    padding: 36px 28px 28px;
    max-width: 400px;
    width: calc(100% - 40px);
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    text-align: center;
    box-shadow: 0 40px 80px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.06);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    animation: adsCardIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
    pointer-events: auto;
  }
  @keyframes adsCardIn {
    from { transform: translate(-50%, -50%) scale(0.8) translateY(30px); opacity: 0; }
    to   { transform: translate(-50%, -50%) scale(1)   translateY(0);    opacity: 1; }
  }
  #ads-icon-container { display: flex; justify-content: center; margin-bottom: 18px; }
  #ads-title  { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 10px; font-family: inherit; }
  #ads-desc   { font-size: 13px; color: #64748b; line-height: 1.65; margin: 0 0 24px; font-family: inherit; }
  #ads-btns   { display: flex; gap: 10px; }
  .ads-btn {
    flex: 1;
    padding: 13px 16px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    font-family: inherit;
    transition: transform 0.1s, filter 0.15s;
  }
  .ads-btn:active { transform: scale(0.96); }
  #ads-accept  { background: #16a34a; color: #fff; }
  #ads-accept:hover  { filter: brightness(0.9); }
  #ads-decline { background: #dc2626; color: #ffffff; border: none; }
  #ads-decline:hover { filter: brightness(0.9); }
  
  /* SEO Section Styles */
  #ads-seo-wrapper {
    margin-top: 24px;
    border-top: 1px dashed #e2e8f0;
    padding-top: 16px;
    text-align: left;
  }
  #ads-seo-toggle {
    background: none;
    border: none;
    color: ${primaryColor};
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    justify-content: center;
    font-family: inherit;
    outline: none;
    padding: 6px 0;
    transition: opacity 0.15s;
  }
  #ads-seo-toggle:hover {
    opacity: 0.8;
  }
  #ads-seo-arrow {
    transition: transform 0.25s ease;
  }
  #ads-seo-toggle.ads-active #ads-seo-arrow {
    transform: rotate(180deg);
  }
  #ads-seo-content {
    display: none;
    margin-top: 14px;
    font-size: 12px;
    color: #475569;
    line-height: 1.6;
    max-height: 180px;
    overflow-y: auto;
    padding-right: 6px;
  }
  #ads-seo-content.ads-show {
    display: block;
  }
  #ads-seo-title {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 6px;
    font-family: inherit;
  }
  #ads-seo-desc {
    margin: 0 0 12px;
    font-weight: 500;
    color: #334155;
    font-family: inherit;
  }
  .ads-seo-list {
    list-style-type: none;
    padding: 0;
    margin: 0;
  }
  .ads-seo-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    font-family: inherit;
  }
  .ads-seo-check {
    color: ${primaryColor};
    font-weight: bold;
    font-size: 14px;
    line-height: 1.2;
    user-select: none;
  }
  
  @media (max-width: 480px) {
    #ads-card  { padding: 28px 18px 22px; border-radius: 16px; }
    #ads-title { font-size: 16px; }
    #ads-btns  { flex-direction: column; }
  }
</style>
 
<div id="ads-overlay">
  <div id="ads-card" onclick="event.stopPropagation()">
    <div id="ads-icon-container">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <h3 id="ads-title">${titleClean}</h3>
    <p id="ads-desc">${localization.desc}</p>
    <div id="ads-btns">
      <button class="ads-btn" id="ads-decline">${localization.decline}</button>
      <button class="ads-btn" id="ads-accept">${localization.accept}</button>
    </div>
    
    <!-- SEO Expandable Information Section -->
    <div id="ads-seo-wrapper">
      <button id="ads-seo-toggle" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" id="ads-seo-arrow">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span>${localization.infoBtn}</span>
      </button>
      
      <div id="ads-seo-content">
        <h4 id="ads-seo-title">${localization.infoTitle}:</h4>
        <p id="ads-seo-desc">${seoDesc}</p>
        <ul class="ads-seo-list">
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelFormula}:</strong> ${valFormulaResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelEntrega}:</strong> ${valEntregaResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelPreco}:</strong> ${valPrecoResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelOferta}:</strong> ${valOfertaResolved}</span>
          </li>
          ${seoDetails.map(item => `
            <li class="ads-seo-item">
              <span class="ads-seo-check">✓</span>
              <span>${item}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  </div>
</div>

<script id="ads-cookie-js">
(function(){
  var D = ${JSON.stringify(affiliateUrl)};
  function go(e){ if(e){ e.preventDefault(); e.stopPropagation(); } window.location.href = D; }
  setTimeout(function(){
    var ov = document.getElementById('ads-overlay');
    if(ov) ov.classList.add('ads-show');
  }, 500);
  function bind(){
    var a = document.getElementById('ads-accept');
    var d = document.getElementById('ads-decline');
    var ov = document.getElementById('ads-overlay');
    if(a) a.addEventListener('click', go);
    if(d) d.addEventListener('click', go);
    if(ov) ov.addEventListener('click', function(e){ if(e.target===ov) go(e); });
    
    // Toggle SEO content
    var toggleBtn = document.getElementById('ads-seo-toggle');
    var contentDiv = document.getElementById('ads-seo-content');
    if (toggleBtn && contentDiv) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleBtn.classList.toggle('ads-active');
        contentDiv.classList.toggle('ads-show');
      });
    }

    document.addEventListener('click', function(e){
      if(!e.target.closest('#ads-card')) go(e);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, overlay + "\n</body>");
  }
  return html + overlay;
}

router.post("/generate-bridge-ai", requireAuth, async (req, res) => {
  const {
    referenceUrl,
    affiliateUrl,
    trackingTags = "",
    productHint = "",
    apiToken = "",
    streamCode = "",
    thankYouUrl = "",
    network = "Dr.Cash",
    selectedOption = "a",
    popupLanguage = "pt-BR",
    rawHtml = ""
  } = req.body || {};


  const normalizedReference = normalizeUrl(referenceUrl);
  const normalizedAffiliate = normalizeUrl(affiliateUrl);

  if (!normalizedReference || !normalizedAffiliate) {
    res.status(400).json({ error: "Missing referenceUrl or affiliateUrl" });
    return;
  }

  // OPTION A: Clone real HTML (same as Option B) — scroll locked, cookie popup appears after 2 seconds
  if (selectedOption === "a") {
    let detectedLang = popupLanguage;
    try {
      let rawHtmlString = rawHtml;
      let cookies = "";
      let finalUrl = normalizedReference;

      if (!rawHtmlString) {
        try {
          const fetchResult = await fetchReferenceHtml(normalizedReference);
          rawHtmlString = fetchResult.html;
          cookies = fetchResult.cookies;
          finalUrl = fetchResult.finalUrl;
        } catch (fetchErr: any) {
          logger.warn({ err: fetchErr.message }, "Option A: fetchReferenceHtml failed, using default fallback metadata");
        }
      } else {
        try {
          finalUrl = await resolveRedirectUrl(normalizedReference);
        } catch (redirectErr: any) {
          logger.warn({ err: redirectErr.message }, "Option A: resolveRedirectUrl failed");
        }
      }

      const meta = rawHtmlString 
        ? extractPageMetadata(rawHtmlString, finalUrl) 
        : { productName: productHint || extractProductName(finalUrl), primaryColor: "#16a34a", productImageUrl: "" };
        
      const resolvedProductName = productHint || meta.productName || extractProductName(finalUrl);
      detectedLang = rawHtmlString 
        ? detectLandingPageLanguage(rawHtmlString, finalUrl, popupLanguage) 
        : popupLanguage;

      let finalThankYouUrl = thankYouUrl;
      let thankYouFileName = "";
      let thankYouHtml = "";
      let shouldInjectThanksModal = false;

      if (!finalThankYouUrl || finalThankYouUrl === "./Obrigado.html" || finalThankYouUrl === "#obrigado") {
        finalThankYouUrl = "#obrigado";
        shouldInjectThanksModal = true;
      } else {
        thankYouFileName = finalThankYouUrl.replace(/^\.\//, "");
      }

      if (!shouldInjectThanksModal) {
        // Generate Thank You page matching colors, name, and image of the cloned page
        thankYouHtml = generateThankYouHtml({
          productName: resolvedProductName,
          primaryColor: meta.primaryColor,
          productImageUrl: meta.productImageUrl,
          referenceUrl: finalUrl,
          popupLanguage: detectedLang,
          supportEmail: "",
          trackingTags: trackingTags
        });
      }

      // Capture screenshots using local Puppeteer first, falling back to external APIs on failure
      let screenshotUrl = "";
      let mobileScreenshotUrl = "";
      let puppeteerSuccess = false;

      try {
        const pScreenshots = await captureScreenshots(finalUrl, cookies);
        screenshotUrl = pScreenshots.desktop;
        mobileScreenshotUrl = pScreenshots.mobile;
        puppeteerSuccess = true;
      } catch (puppeteerErr: any) {
        logger.warn({ err: puppeteerErr.message }, "Local Puppeteer screenshot failed, falling back to external APIs");
        const encodedFinalUrl = encodeURIComponent(finalUrl);
        screenshotUrl = `https://api.microlink.io/?url=${encodedFinalUrl}&screenshot=true&screenshot.fullPage=true&viewport.width=1920&viewport.height=1080&embed=screenshot.url`;
        mobileScreenshotUrl = `https://api.microlink.io/?url=${encodedFinalUrl}&screenshot=true&screenshot.fullPage=true&screenshot.device=iPhone%2013&embed=screenshot.url`;

        // Check if Microlink works, otherwise fallback to thum.io
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const testRes = await fetch(screenshotUrl, { method: "HEAD", signal: controller.signal });
          clearTimeout(timeoutId);
          if (testRes.status !== 200) {
            logger.warn({ status: testRes.status }, "Microlink checked, status not 200, falling back to thum.io");
            const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
            const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
            const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
            screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1920/fullpage/${finalUrl}`;
            mobileScreenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/iphone6plus/fullpage/${finalUrl}`;
          }
        } catch (err) {
          logger.warn({ err: (err as Error).message }, "Microlink checked, threw error/timeout, falling back to thum.io");
          const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
          const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
          const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
          screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1920/fullpage/${finalUrl}`;
          mobileScreenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/iphone6plus/fullpage/${finalUrl}`;
        }
      }

      // Generate extremely clean, policy-compliant presell page with background image only
      let cleanHtml = generateCleanBackgroundPresellHtml({
        productName: resolvedProductName,
        referenceUrl: finalUrl,
        affiliateUrl: normalizedAffiliate,
        trackingTags: trackingTags,
        backgroundImageUrl: screenshotUrl,
        mobileBackgroundImageUrl: mobileScreenshotUrl,
        popupLanguage: detectedLang,
        meta: meta
      });

      // Inject cookie consent overlay (locks scroll, pops up consent card with close button)
      let finalHtml = injectCookieConsentOverlay(cleanHtml, normalizedAffiliate, finalUrl, detectedLang, meta);

      // Always inject the thank you modal code as a robust fallback (e.g. when executing local files)
      const modalCode = getThankYouModalCode(
        resolvedProductName,
        meta.primaryColor || "#16a34a",
        meta.productImageUrl || "",
        finalUrl,
        detectedLang
      );
      if (/<\/body>/i.test(finalHtml)) {
        finalHtml = finalHtml.replace(/<\/body>/i, `${modalCode}\n</body>`);
      } else {
        finalHtml += modalCode;
      }

      // Inline assets using the captured cookies (inlines the background image and logo styles)
      try {
        finalHtml = await inlinePageAssets(finalHtml, finalUrl, cookies);
      } catch (inlineErr: any) {
        logger.warn({ err: inlineErr.message }, "Option A: Asset inlining failed, keeping raw URLs");
      }

      res.json({
        html: finalHtml,
        mode: "presell" as BridgeMode,
        productName: resolvedProductName,
        language: "auto",
        designSummary: "Cloned HTML — scroll locked, cookie consent popup appears after 2 seconds.",
        research: { enabled: false, results: [] },
        thankYouHtml,
        thankYouFileName
      });
      return;
    } catch (err: any) {
      // Fallback: screenshot bridge if site can't be fetched/cloned
      logger.warn({ err: err.message }, "Option A clone failed, falling back to screenshot bridge");
      try {
        const html = generateScreenshotBridgeHtml({
          referenceUrl: normalizedReference,
          affiliateUrl: normalizedAffiliate,
          trackingTags,
          productHint,
          popupLanguage: detectedLang
        });
        res.json({
          html,
          mode: "presell",
          productName: productHint || "Oferta Oficial",
          language: detectedLang || "pt-BR",
          designSummary: "Screenshot bridge (site could not be cloned — bot protection detected).",
          research: { enabled: false, results: [] }
        });
      } catch (fallbackErr: any) {
        res.status(500).json({ error: fallbackErr.message || "Failed to generate Option A page" });
      }
      return;
    }
  }

  // OPTION B: Direct HTML clone — fetch raw HTML (like DevTools Copy Element) and inject affiliate redirect
  try {
    let rawHtmlString = rawHtml;
    let cookies = "";
    let finalUrl = normalizedReference;

    if (!rawHtmlString) {
      const fetchResult = await fetchReferenceHtml(normalizedReference);
      rawHtmlString = fetchResult.html;
      cookies = fetchResult.cookies;
      finalUrl = fetchResult.finalUrl;
    } else {
      finalUrl = await resolveRedirectUrl(normalizedReference);
    }

    if (!rawHtmlString) {
      throw new Error("Could not fetch the reference page HTML. The site may block bots or require authentication.");
    }

    const meta = extractPageMetadata(rawHtmlString, finalUrl);
    const resolvedProductName = productHint || meta.productName || extractProductName(finalUrl);
    const domain = extractDomainName(normalizedAffiliate) || "presell";
    const timestamp = Date.now();

    let finalThankYouUrl = thankYouUrl;
    let thankYouFileName = "";
    let thankYouHtml = "";
    let shouldInjectThanksModal = false;

    if (!finalThankYouUrl || finalThankYouUrl === "./Obrigado.html" || finalThankYouUrl === "#obrigado") {
      finalThankYouUrl = "#obrigado";
      shouldInjectThanksModal = true;
    } else {
      thankYouFileName = finalThankYouUrl.replace(/^\.\//, "");
    }

    const detectedLang = detectLandingPageLanguage(rawHtmlString, finalUrl, popupLanguage);

    if (!shouldInjectThanksModal) {
      // Generate Thank You page matching colors, name, and image of the cloned page
      thankYouHtml = generateThankYouHtml({
        productName: resolvedProductName,
        primaryColor: meta.primaryColor,
        productImageUrl: meta.productImageUrl,
        referenceUrl: finalUrl,
        popupLanguage: detectedLang,
        supportEmail: "",
        trackingTags: trackingTags
      });
    }

    let finalHtml = injectAffiliateIntoHtml(
      rawHtmlString,
      finalUrl,
      normalizedAffiliate,
      trackingTags,
      apiToken,
      streamCode,
      finalThankYouUrl
    );


    // Always inject the thank you modal code as a robust fallback (e.g. when executing local files)
    const modalCode = getThankYouModalCode(
      resolvedProductName,
      meta.primaryColor || "#16a34a",
      meta.productImageUrl || "",
      finalUrl,
      detectedLang
    );
    if (/<\/body>/i.test(finalHtml)) {
      finalHtml = finalHtml.replace(/<\/body>/i, `${modalCode}\n</body>`);
    } else {
      finalHtml += modalCode;
    }

    // Strip before/after testimonial sections and reviews
    finalHtml = stripBeforeAfterSections(finalHtml);

    // Remove entire sections that contain clinical study percentage stats
    // (e.g. "73% dos diabéticos sentiram melhoria após o estudo") — these cannot be rewritten
    finalHtml = removeStudyStatSections(finalHtml);

    // Google Ads compliance claim rewriting using AI
    // Remaining violating copy (hero headlines, CTAs, bullets) is rewritten with compliant alternatives
    finalHtml = await rewriteClaimsForCompliance(finalHtml);

    // Inline assets using the captured cookies
    try {
      finalHtml = await inlinePageAssets(finalHtml, finalUrl, cookies);
    } catch (inlineErr: any) {
      logger.warn({ err: inlineErr.message }, "Option B: Asset inlining failed, keeping raw URLs");
    }

    res.json({
      html: finalHtml,
      mode: "presell" as BridgeMode,
      productName: resolvedProductName,
      language: "auto",
      designSummary: "Direct HTML clone of the original page — all CTAs redirect to affiliate URL.",
      research: { enabled: false, results: [] },
      thankYouHtml,
      thankYouFileName
    });
    return;
  } catch (err: any) {
    logger.error({ err: err.message }, "Option B direct clone failed");
    // Fallback to local template if fetch fails
    const html = fallbackBridgeHtml({
      referenceUrl: normalizedReference,
      affiliateUrl: normalizedAffiliate,
      trackingTags,
      productHint,
      selectedOption,
      popupLanguage
    });
    res.json({
      html,
      mode: "presell" as BridgeMode,
      productName: productHint || "Oferta Oficial",
      language: popupLanguage || "pt-BR",
      designSummary: `Direct clone failed (${err.message}), fallback template used.`,
      research: { enabled: false, results: [] },
    });
  }
});

router.post("/publish-bridge", requireAuth, (req, res) => {
  const { htmlContent, fileName, thankYouHtml, thankYouFileName } = req.body;
  if (!htmlContent || !fileName) {
    res.status(400).json({ error: "Missing htmlContent or fileName" });
    return;
  }

  try {
    const targetDir = path.resolve(process.cwd(), "../ads-intelligence/public");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, htmlContent, "utf8");
    logger.info({ filePath }, "Bridge page published successfully");

    if (thankYouHtml && thankYouFileName) {
      const tyFilePath = path.join(targetDir, thankYouFileName);
      fs.writeFileSync(tyFilePath, thankYouHtml, "utf8");
      logger.info({ filePath: tyFilePath }, "Thank you page published successfully");
    }

    res.json({
      success: true,
      url: `/${fileName}`,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to publish bridge page");
    res.status(500).json({ error: `Failed to publish: ${err.message}` });
  }
});

router.delete("/delete-bridge", requireAuth, (req, res) => {
  const { fileName, thankYouFileName } = req.body;
  if (!fileName) {
    res.status(400).json({ error: "Missing fileName" });
    return;
  }

  try {
    const targetDir = path.resolve(process.cwd(), "../ads-intelligence/public");
    const filePath = path.join(targetDir, fileName);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, "Bridge page deleted from server successfully");
    }

    if (thankYouFileName) {
      const tyFilePath = path.join(targetDir, thankYouFileName);
      if (fs.existsSync(tyFilePath)) {
        fs.unlinkSync(tyFilePath);
        logger.info({ filePath: tyFilePath }, "Thank you page deleted from server successfully");
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to delete bridge page");
    res.status(500).json({ error: `Failed to delete: ${err.message}` });
  }
});

export default router;
