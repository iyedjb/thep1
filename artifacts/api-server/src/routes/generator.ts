import { Router } from "express";
import { requireAuth } from "./auth";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";
import { getDb } from "../lib/sqlite";
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
    await desktopPage.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    
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
    try {
      await desktopPage.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e: any) {
      logger.warn({ err: e.message }, "Desktop navigation timed out or failed, attempting capture anyway...");
    }
    
    // Wait 3 seconds for animations, lazy images, and layouts to settle
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Hide scrollbars before screenshot
    try {
      await desktopPage.addStyleTag({ content: '::-webkit-scrollbar { display: none !important; } html, body { scrollbar-width: none !important; }' });
    } catch (_) {}

    const desktopBuffer = (await desktopPage.screenshot({ fullPage: false, type: 'jpeg', quality: 95 })) as Buffer;
    const desktopBase64 = `data:image/jpeg;base64,${desktopBuffer.toString('base64')}`;

    const mobilePage = await browser.newPage();
    
    // Set mobile viewport (iPhone 13 aspect ratio and layout width)
    await mobilePage.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
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
    try {
      await mobilePage.goto(url, { waitUntil: 'load', timeout: 20000 });
    } catch (e: any) {
      logger.warn({ err: e.message }, "Mobile navigation timed out or failed, attempting capture anyway...");
    }
    
    // Wait for the page content to actually render on the mobile viewport.
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Also try to wait for the body to have meaningful content height
    try {
      await mobilePage.waitForFunction(
        // @ts-ignore - document is available in the browser-evaluated context of Puppeteer
        () => document.body && document.body.scrollHeight > 100,
        { timeout: 5000 }
      );
    } catch (_) {
      // If this times out, proceed anyway — the 3s delay should be enough
    }

    // Hide scrollbars
    try {
      await mobilePage.addStyleTag({ content: '::-webkit-scrollbar { display: none !important; } html, body { scrollbar-width: none !important; }' });
    } catch (_) {}

    const mobileBuffer = (await mobilePage.screenshot({ fullPage: false, type: 'jpeg', quality: 95 })) as Buffer;
    const mobileBase64 = `data:image/jpeg;base64,${mobileBuffer.toString('base64')}`;

    logger.info("Puppeteer screenshots captured successfully!");
    return { desktop: desktopBase64, mobile: mobileBase64 };
  } finally {
    await browser.close();
  }
}

function normalizeUrl(url: string) {
  let trimmed = String(url || "").trim();
  if (!trimmed) return "";
  
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  
  if (trimmed.startsWith("http://")) {
    const isLocal = /http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)/i.test(trimmed);
    if (!isLocal) {
      trimmed = trimmed.replace(/^http:\/\//i, "https://");
    }
  }
  
  return trimmed;
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
  // Try rendering via Puppeteer first to support React/Next/Nuxt dynamic SPAs and hydrated components
  try {
    logger.info({ referenceUrl }, "Attempting dynamic page fetch using Puppeteer...");
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      
      await page.goto(referenceUrl, { waitUntil: 'load', timeout: 25000 });
      // Wait 4 seconds for JS rendering, API fetches and hydration to complete
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      const html = await page.content();
      const finalUrl = page.url();
      const pageCookies = await page.cookies();
      const cookies = pageCookies.map(c => `${c.name}=${c.value}`).join("; ");
      
      logger.info({ finalUrl, cookiesCount: pageCookies.length }, "Puppeteer dynamic page fetch successful!");
      await browser.close();
      return {
        html: html.slice(0, 800000), // Larger limit to hold fully-hydrated markup
        cookies,
        finalUrl
      };
    } catch (err: any) {
      await browser.close();
      logger.warn({ err: err.message }, "Puppeteer dynamic page fetch failed, falling back to static fetch");
    }
  } catch (launchErr: any) {
    logger.warn({ err: launchErr.message }, "Failed to launch Puppeteer for dynamic fetch, falling back to static fetch");
  }

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
        html: html.slice(0, 800000), 
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
            // Resolve relative href to absolute URL so the browser can load it from the original server
            let resolvedTag = fullTag;
            const absHref = getAbsoluteUrl(relHref);
            resolvedTag = resolvedTag.replace(relHref, absHref);
            
            // Defer loading of non-inlined CSS to prevent render-blocking
            if (!/media=/i.test(attrs) && !/onload=/i.test(attrs)) {
              resolvedTag = resolvedTag
                .replace(/rel=["']stylesheet["']/i, 'rel="stylesheet" media="print" onload="this.media=\'all\'"')
                .replace(/rel='stylesheet'/i, 'rel=\'stylesheet\' media=\'print\' onload="this.media=\'all\'"');
            }
            html = html.replaceAll(fullTag, resolvedTag);
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
      // Resolve relative src to absolute URL so the browser can load it from the original server
      const absSrc = getAbsoluteUrl(relSrc);
      let resolvedTag = fullTag
        .replace(`src="${relSrc}"`, `src="${absSrc}"`)
        .replace(`src='${relSrc}'`, `src='${absSrc}'`);
        
      // Defer execution of relative script that failed to inline
      if (!/defer|async/i.test(attrs1 + attrs2)) {
        resolvedTag = resolvedTag
          .replace(`src="${absSrc}"`, `src="${absSrc}" defer`)
          .replace(`src='${absSrc}'`, `src='${absSrc}' defer`);
      }
      html = html.replaceAll(fullTag, resolvedTag);
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
    
    let candidate = parts[0];
    if (parts.length >= 3) {
      const subdomain = parts[0].toLowerCase();
      // Skip tracking-like short subdomains to target the actual brand domain
      const isTrackingSubdomain = subdomain.length <= 6 || 
        ["click", "track", "offer", "promo", "app", "go", "link", "aff", "lp", "flow", "page", "prod", "official"].includes(subdomain);
      
      if (isTrackingSubdomain) {
        candidate = parts[1];
      }
    }
    
    return candidate.charAt(0).toUpperCase() + candidate.slice(1);
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
  backgroundColor?: string;
  productImageUrl: string;
  seoDescription?: string;
  productDetails?: string[];
  extractedPrice?: string;
  extractedFormula?: string;
  extractedOffer?: string;
  originalPrice?: string;
  promotionalPrice?: string;
  isGadget?: boolean;
  isDigital?: boolean;
  isCod?: boolean;
  extractedDelivery?: string;
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
function filterNonCompliantSentences(text: string): string {
  if (!text) return "";
  
  // Split into sentences using punctuation (. ! ?)
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  const promiseClaimRegex = /\b(?:100%|garanti[ad]o?|guaranteed|garantito|garantita|result[as]o?|result|results|cura?r?|cure|guarire|sanar|trata?r?|treat|treatment|tratamiento|trattamento|médic[oa]s?|doctor?s?|medici?|milagre?s?|miracle?s?|milagro?s?|miracolo?i?|rápido?a?|rapidamente|fast|quickly|rápidamente|rapido|eficaz|eficiente|effective|efficient|efficace|provad[oa]|comprovad[oa]|testad[oa]|proven|tested|probad[oa]|provato|elimina?r?|acaba?r?|remove?r?|eliminate|rimuovere|best|mejor|melhor|migliore|únic[oa]|exclusiv[oa]|unique|exclusive|unico|esclusivo)\b/i;
  
  const safeSentences = sentences
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 10) return false;
      return !promiseClaimRegex.test(s);
    });
    
  let result = safeSentences.join(" ");
  if (result && !result.endsWith(".")) {
    result += ".";
  }
  return result;
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
  const violationFilterRegex = /\b(perdi|perder|lose|weight|peso|kg|kilos|kilo|emagrecer|queimar|fat|gordura|grasa|liposuzione|liposuction|garantido|guaranteed|garantia|cure|cura|curar|trata|treat|elimina|eliminate|diabetes|diabético|hipertens|artrite|arthritis|cancro|câncer|morte|death|morrer|segredo|secret|clinicamente|comprovad[ao]|proven|clinically|prostatite|prostate|prostatitis|próstata|reprodutor|reproducteur|reproductor|reproductive|maladie|maladies|doença|doenças|enfermedad|enfermedades|disease|diseases|remédio|remedio|remède|remedy|combater|combate|combat|combattre|lutar|luta|luchar|lucha|lutter|fight|guérir|soigner|tratamento|tratamentos|tratamiento|treatment|efficace|efficacement|eficaz|eficazmente|effectively|prouvé|prouvée|provado|provada|probado|probada|garanti|garantie|garantizado|garantizada|éliminer|élimine|perdre|poids|graisse)\b/i;

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

  // 1. Check direct HTML CSS selectors for prices (Dr.Cash / affiliate landing page standard classes)
  const oldPriceMatch = html.match(/class=["'][^"']*(?:price-old|price_old|price-before|old-price)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
                        html.match(/class=["'][^"']*(?:price-old|price_old|price-before|old-price)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                        html.match(/<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/i);
  if (oldPriceMatch && oldPriceMatch[1]) {
    const rawOld = oldPriceMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (/\d/.test(rawOld)) {
      originalPrice = rawOld;
    }
  }

  const newPriceMatch = html.match(/class=["'][^"']*(?:price-new|price_new|price-current|new-price|promo-price)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
                        html.match(/class=["'][^"']*(?:price-new|price_new|price-current|new-price|promo-price)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (newPriceMatch && newPriceMatch[1]) {
    const rawNew = newPriceMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (/\d/.test(rawNew)) {
      promotionalPrice = rawNew;
      extractedPrice = rawNew;
    }
  }

  // 2. Fallback regex to parse price from HTML text
  const priceRegex = /(?:(?:R\$|\$|€|£|¥|S\/\.?|PEN|MXN|COP|CLP|ARS|EUR|PLN|RON|CZK|HUF|GTQ|BOB|DOP|CRC|PYG|UYU|HNL|NIO)\s*\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s*(?:zł|€|\$|£|¥|lei|Kč|Ft|EUR|eur|Eur|PLN|pln|RON|ron|CZK|czk|лв|BGN|bgn|din|RSD|rsd|HUF|huf|PEN|pen|GTQ|gtq|S\/\.?))/gi;
  const parseVal = (str: string): number => {
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  };

  // Strip head, script, style, and HTML tags so we only match visible page text
  const cleanTextForPrice = html
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const priceMatches = cleanTextForPrice.match(priceRegex);
  if (priceMatches && priceMatches.length > 0) {
    const uniquePrices = Array.from(new Set(priceMatches.map(p => p.trim())))
      .filter(p => parseVal(p) > 0);

    if (!originalPrice && !promotionalPrice) {
      if (uniquePrices.length === 1) {
        extractedPrice = uniquePrices[0];
        promotionalPrice = uniquePrices[0];
      } else if (uniquePrices.length >= 2) {
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
  }

  // Attempt to parse ingredients/composition, specs or digital content from HTML
  const gadgetKeywords = /dispositivo|aparelho|tecnologia|ar condicionado|cooler|ventilador|aquecedor|gadget|device|technology|air conditioner|heater|fan|led|lamp|lampada|light|camera|tool|ferramenta|massager|massageador|mini|portátil|portable|ultrassônico|ultrasonic/i;
  const isGadget = gadgetKeywords.test(html) || referenceUrl.toLowerCase().includes("coolcove") || html.toLowerCase().includes("coolcove");

  const digitalKeywords = /e-book|ebook|curso|course|treinamento|training|software|app|aplicativo|plataforma|platform|inscrição|subscription|assinatura|serviço|service|ebooks|cursos|programas|program|pdf|guia|guide/i;
  const isDigital = !isGadget && (digitalKeywords.test(html) || digitalKeywords.test(referenceUrl));

  const listItemsRegex = /<li[^>]*>[\s\n]*([^<>]{5,60}?)[\s\n]*<\/li>/gi;
  let liMatch;
  const foundIngredients: string[] = [];

  if (isGadget || isDigital) {
    while ((liMatch = listItemsRegex.exec(html)) !== null && foundIngredients.length < 4) {
      const text = cleanHtmlText(liMatch[1]);
      if (
        text.length > 10 && 
        text.length < 60 && 
        !/preço|desconto|comprar|garantia|entreg|site|oficial|promoc|polít|privac|cookies|termo/i.test(text) &&
        !violationFilterRegex.test(text)
      ) {
        foundIngredients.push(text);
      }
    }
  } else {
    const formulaKeywords = /ingredienti|ingredientes|ingredients|composição|composizione|composición|composition/i;
    if (formulaKeywords.test(html)) {
      const herbKeywords = /extrato|extract|vitamina|vitamin|mineral|ácido|acid|óleo|oil|semente|seed|raiz|root|folha|leaf|zinco|zinc|magnésio|magnesium|calcio|calcium/i;
      while ((liMatch = listItemsRegex.exec(html)) !== null && foundIngredients.length < 4) {
        const text = cleanHtmlText(liMatch[1]);
        if (herbKeywords.test(text) && text.length < 50 && !/peso|perda|emagrecer|queimar/i.test(text)) {
          foundIngredients.push(text);
        }
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

  const codKeywords = /pague na entrega|pague ao receber|contra entrega|contra-entrega|pago contra entrega|cash on delivery|pagamento na entrega|pagamento ao receber|\bcod\b|paghi alla consegna|pagamento alla consegna|paiement à la livraison|zahlung bei lieferung|plată la livrare|płatność przy odbiorze/i;
  const isCod = codKeywords.test(html) || referenceUrl.toLowerCase().includes("cod");

  // Attempt to parse delivery/shipping terms from HTML
  let extractedDelivery = "";
  const deliveryRegex = /(?:(\d+(?:\s*(?:a|-)\s*\d+)?\s*(?:dias|days|días|giorni|jours|tage|working days|dias úteis|business days)))/i;
  const deliveryMatch = html.match(deliveryRegex);
  if (deliveryMatch) {
    extractedDelivery = deliveryMatch[1].trim();
  }

  let backgroundColor = "";
  const bgMatch = html.match(/body[^{}]*\{[^}]*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2}|rgba?\([^)]+\)|[a-z]+)/i) ||
                  html.match(/<body[^>]*style=["'][^"']*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2}|rgba?\([^)]+\)|[a-z]+)/i) ||
                  html.match(/(?:\.bg-[a-z0-9-]+|\.wrapper|\.site-content|\.page-bg)[^{}]*\{[^}]*background(?:-color)?\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2})/i);
  if (bgMatch && bgMatch[1]) {
    backgroundColor = bgMatch[1].toLowerCase();
  }

  if (!seoDescription && productDetails.length > 0) {
    seoDescription = productDetails.slice(0, 3).join(". ");
  }

  if (seoDescription) {
    seoDescription = filterNonCompliantSentences(seoDescription);
  }

  return { productName, primaryColor, ctaButtonColor, backgroundColor, productImageUrl, seoDescription, productDetails, extractedPrice, extractedFormula, extractedOffer, originalPrice, promotionalPrice, isGadget, isDigital, isCod, extractedDelivery };
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
    },
    "th": {
      headline: "ขอบคุณ คำสั่งซื้อของคุณ<br>ได้รับการ <span style='color:#16a34a'>บันทึกแล้ว</span>!",
      subHeadline: "เราได้บันทึกคำสั่งซื้อของคุณเรียบร้อยแล้ว ทีมงานขายจะติดต่อกลับในไม่ช้า และจะดำเนินการจัดส่งตามระยะเวลาที่กำหนด",
      productTitle: `${productName} - ฝ่ายสนับสนุนอย่างเป็นทางการ`,
      productDesc: "ราคาโปรโมชัน - ส่วนลด 50%<br>รับประกันความพึงพอใจ - จัดส่งปลอดภัย",
      discountBadge: "-50% OFF",
      adviserTitle: "เจ้าหน้าที่ของเราจะโทรหาคุณ!",
      adviserDesc: "ทีมงานขายของเราจะติดต่อกลับทางโทรศัพท์เพื่อยืนยันคำสั่งซื้อในไม่ช้า และจะดำเนินการจัดส่งตามระยะเวลาที่กำหนด",
      step1Title: "รับสายจากเจ้าหน้าที่ของเรา",
      step1Desc: "ทีมงานขายจะโทรหาคุณในไม่ช้าเพื่อยืนยันรายละเอียดคำสั่งซื้อ",
      step2Title: "จัดส่งภายใน 24 ชั่วโมง",
      step2Desc: "หลังการยืนยันโดยทีมงาน คำสั่งซื้อของคุณจะถูกจัดส่งเพื่อให้ถึงตามระยะเวลาที่กำหนด",
      step3Title: "รับสินค้าและชำระเงินปลายทาง",
      step3Desc: "ชำระเงินเมื่อพัสดุส่งถึงหน้าบ้านคุณเท่านั้น",
      badge1: "จัดส่งปลอดภัย",
      badge2: "สินค้าผ่านการรับรอง",
      badge3: "+2,500 รีวิว",
      badge4: "ธรรมชาติ 100%",
      footerText: `หากคุณไม่สามารถรับสายได้ เราจะติดต่อกลับอีกครั้ง มีคำถาม? ติดต่อเรา: ${finalSupportEmail}`,
      closeBtn: "กลับสู่เว็บไซต์"
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

  // Step 4.5: Strip framework scripts and link preloads to prevent hydration breaking the rendered DOM
  // Remove modulepreload links for framework assets
  html = html.replace(/<link\b[^>]*rel=["'](?:modulepreload|prefetch)["'][^>]*href=["']?[^"']*(?:_nuxt|_next|chunks|webpack|vendor)[^"']*["']?[^>]*>/gi, "");
  // Remove framework script bundles
  html = html.replace(/<script\b[^>]*src=["']?[^"']*\/(?:_nuxt|_next|chunks|webpack|vendor|entry|app)\b[^"']*["']?[^>]*><\/script>/gi, "");

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
  
  // Intercept clicks on navigational elements (excluding elements inside active Dr.Cash forms and local/legal anchors)
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a, button, [onclick], input[type="submit"], input[type="button"]');
    if (!el) return;
    if (DR_CASH_ACTIVE && el.closest('form')) return;
    
    // Do not intercept if it's a link to a local page (e.g. terms, privacy, same-domain anchors)
    if (el.tagName === 'A') {
      var href = el.getAttribute('href') || '';
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }
      var url;
      try {
        url = new URL(el.href);
        if (url.origin === window.location.origin) {
          var path = url.pathname.toLowerCase();
          if (path.indexOf('privacy') !== -1 || path.indexOf('terms') !== -1 || path.indexOf('condicoes') !== -1 || path.indexOf('politica') !== -1) {
            return;
          }
        }
      } catch(_) {}
    }
    
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
  labelEntregaDigital: string;
  labelPreco: string;
  labelOferta: string;
  valFormula: string;
  valEntregaPhysical: string;
  valEntregaDigital: string;
  valPrecoCOD: string;
  valPrecoOnline: string;
  valOferta: string;
  formatPreco: string;
  ctaOffer: string;
  descTemplate: string;
  priceDescFormat: string;
  priceValFormat: string;
  labelGadget: string;
  valGadget: string;
  labelDigital: string;
  valDigital: string;
  valGenericCampaignInfo: string;
  valPrecoGeneric: string;
  valPrecoGenericCond: string;
  valPrecoGenericFallback: string;
  valOfertaGeneric: string;
  labelInfoRelevante: string;
  valInfoRelevante: string;
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
    labelEntregaDigital: "Forma de Acesso",
    labelPreco: "Preço e Condição",
    labelOferta: "Oferta Especial",
    valFormula: "Fórmula desenvolvida com compostos e extratos naturais selecionados.",
    valEntregaPhysical: "Envio de acordo com os prazos de entrega e frete do site oficial.",
    valEntregaDigital: "Acesso imediato por e-mail após a confirmação do pagamento.",
    valPrecoCOD: "Pagamento na Entrega (pague apenas ao receber o produto).",
    valPrecoOnline: "Pagamento Seguro Online (Cartão de Crédito, Boleto ou PIX).",
    valOferta: "Promoção especial por tempo limitado no canal oficial.",
    formatPreco: "De <del>{orig}</del> por apenas <strong>{prom}</strong>",
    ctaOffer: "Aproveite o desconto! Oferta por tempo limitado.",
    descTemplate: "Página informativa oficial sobre o produto {prod}. Veja os detalhes da oferta e adquira com garantia de originalidade.",
    priceDescFormat: " De {orig} por apenas {prom}.",
    priceValFormat: " (Valor: {val}).",
    labelGadget: "Especificações Técnicas",
    valGadget: "Especificações e recursos de alta tecnologia desenvolvidos pelo fabricante.",
    labelDigital: "Conteúdo / Recursos",
    valDigital: "Recursos e materiais informativos de alta qualidade desenvolvidos por especialistas.",
    valGenericCampaignInfo: "Consulte informações nesta campanha.",
    valPrecoGeneric: "Valor promocional disponível no canal oficial do fabricante.",
    valPrecoGenericCond: "Pagamento seguro processado através do canal oficial.",
    valPrecoGenericFallback: "Veja os detalhes da oferta.",
    valOfertaGeneric: "Desconto promocional especial disponível nesta campanha.",
    labelInfoRelevante: "Informações Relevantes",
    valInfoRelevante: "Canal oficial informativo da campanha. Os termos de garantia e políticas de reembolso são os estabelecidos pelo site oficial."
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
    labelEntregaDigital: "Forma de Acceso",
    labelPreco: "Precio y Condición",
    labelOferta: "Oferta Especial",
    valFormula: "Fórmula desarrollada con compuestos y extractos naturales seleccionados.",
    valEntregaPhysical: "Envío de acuerdo con los plazos de entrega y flete del sitio oficial.",
    valEntregaDigital: "Acceso inmediato por correo electrónico después de la confirmación del pago.",
    valPrecoCOD: "Pago Contra Entrega (pague solo al recibir el producto).",
    valPrecoOnline: "Pago Seguro Online (Tarjeta de Crédito, PayPal o métodos locales).",
    valOferta: "Promoción especial por tempo limitado en el canal oficial.",
    formatPreco: "De <del>{orig}</del> por solo <strong>{prom}</strong>",
    ctaOffer: "¡Aprovecha el descuento! Oferta por tiempo limitado.",
    descTemplate: "Página informativa oficial sobre el producto {prod}. Vea los detalles de la oferta y compre con garantía de originalidad.",
    priceDescFormat: " De {orig} por solo {prom}.",
    priceValFormat: " (Valor: {val}).",
    labelGadget: "Especificaciones Técnicas",
    valGadget: "Especificaciones y características de alta tecnología desarrolladas por el fabricante.",
    labelDigital: "Contenido / Recursos",
    valDigital: "Recursos y materiales informativos de alta calidad desarrollados por especialistas.",
    valGenericCampaignInfo: "Consulte información en esta campaña.",
    valPrecoGeneric: "Valor promocional disponible en el canal oficial del fabricante.",
    valPrecoGenericCond: "Pago seguro procesado a través del canal oficial.",
    valPrecoGenericFallback: "Vea los detalles de la oferta.",
    valOfertaGeneric: "Descuento promocional especial disponible en esta campaña.",
    labelInfoRelevante: "Información Relevante",
    valInfoRelevante: "Canal oficial informativo de la campaña. Los términos de garantía y políticas de reembolso son los establecidos por el sitio oficial."
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
    labelEntregaDigital: "Access Method",
    labelPreco: "Price & Terms",
    labelOferta: "Special Offer",
    valFormula: "Formula developed with selected natural compounds and extracts.",
    valEntregaPhysical: "Shipping according to delivery times and rates of the official store.",
    valEntregaDigital: "Immediate access by email after payment confirmation.",
    valPrecoCOD: "Cash on Delivery (pay only upon receiving the product).",
    valPrecoOnline: "Secure Online Payment (Credit Card, PayPal or local payment methods).",
    valOferta: "Special limited-time promotion on the official channel.",
    formatPreco: "From <del>{orig}</del> to only <strong>{prom}</strong>",
    ctaOffer: "Enjoy the discount! Limited-time offer.",
    descTemplate: "Official informative page about the product {prod}. See the details of the offer and purchase with guarantee of originality.",
    priceDescFormat: " From {orig} to only {prom}.",
    priceValFormat: " (Price: {val}).",
    labelGadget: "Technical Specifications",
    valGadget: "High-tech specifications and features developed by the manufacturer.",
    labelDigital: "Content / Features",
    valDigital: "High-quality resources and informative materials developed by experts.",
    valGenericCampaignInfo: "Check information in this campaign.",
    valPrecoGeneric: "Promotional value available on the official manufacturer's channel.",
    valPrecoGenericCond: "Secure payment processed through the official channel.",
    valPrecoGenericFallback: "See the details of the offer.",
    valOfertaGeneric: "Special promotional discount available in this campaign.",
    labelInfoRelevante: "Relevant Information",
    valInfoRelevante: "Official informative channel for the campaign. Warranty terms and refund policies are those established by the official website."
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
    labelEntregaDigital: "Modalità di Accesso",
    labelPreco: "Prezzo e Condizioni",
    labelOferta: "Offerta Speciale",
    valFormula: "Formula sviluppata con composti ed estratti naturali selezionati.",
    valEntregaPhysical: "Spedizione secondo i tempi di consegna e le tariffe del sito ufficiale.",
    valEntregaDigital: "Accesso immediato via e-mail dopo la conferma del pagamento.",
    valPrecoCOD: "Pagamento alla Consegna (paghi solo alla ricezione del prodotto).",
    valPrecoOnline: "Pagamento Online Sicuro (Carta di Credito, PayPal o metodi locali).",
    valOferta: "Promozione speciale a tempo limitato sul canale ufficiale.",
    formatPreco: "Da <del>{orig}</del> a soli <strong>{prom}</strong>",
    ctaOffer: "Approfitta dello sconto! Offerta a tempo limitato.",
    descTemplate: "Pagina informativa ufficiale sul prodotto {prod}. Vedi i dettagli dell'offerta e acquista con garanzia di originalità.",
    priceDescFormat: " Da {orig} a soli {prom}.",
    priceValFormat: " (Valore: {val}).",
    labelGadget: "Specifiche Tecniche",
    valGadget: "Specifiche e caratteristiche high-tech sviluppate dal produttore.",
    labelDigital: "Contenuto / Caratteristiche",
    valDigital: "Risorse e materiali informativi di alta qualità sviluppati da esperti.",
    valGenericCampaignInfo: "Consulta le informazioni in questa campagna.",
    valPrecoGeneric: "Valore promozionale disponibile sul canale ufficiale del produttore.",
    valPrecoGenericCond: "Pagamento sicuro elaborato tramite il canale ufficiale.",
    valPrecoGenericFallback: "Vedi i dettagli dell'offerta.",
    valOfertaGeneric: "Sconto promozionale speciale disponibile in questa campagna.",
    labelInfoRelevante: "Informazioni Rilevanti",
    valInfoRelevante: "Canale informativo ufficiale della campagna. I termini di garanzia e le politiche di rimborso sono quelli stabiliti dal sito ufficiale."
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
    labelEntregaDigital: "Mode d'Accès",
    labelPreco: "Prix et Conditions",
    labelOferta: "Offre Spéciale",
    valFormula: "Formule développée avec des composés et extraits naturels sélectionnés.",
    valEntregaPhysical: "Livraison selon les délais et tarifs du site officiel.",
    valEntregaDigital: "Accès immédiat par e-mail après confirmation du paiement.",
    valPrecoCOD: "Paiement à la Livraison (payez uniquement à la réception du produit).",
    valPrecoOnline: "Paiement en ligne sécurisé (Carte de crédit, PayPal ou moyens locaux).",
    valOferta: "Promotion spéciale à durée limitée sur le canal officiel.",
    formatPreco: "De <del>{orig}</del> à seulement <strong>{prom}</strong>",
    ctaOffer: "Profitez de la remise ! Offre à durée limitée.",
    descTemplate: "Page d'information officielle sur le produit {prod}. Consultez les détails de l'offre et achetez avec garantie d'authenticité.",
    priceDescFormat: " De {orig} à seulement {prom}.",
    priceValFormat: " (Valeur: {val}).",
    labelGadget: "Spécifications Techniques",
    valGadget: "Spécifications et fonctionnalités de haute technologie développées par le fabricant.",
    labelDigital: "Contenu / Caractéristiques",
    valDigital: "Ressources et supports d'information de haute qualité développés par des experts.",
    valGenericCampaignInfo: "Consultez les informations de cette campagne.",
    valPrecoGeneric: "Valeur promotionnelle disponible sur le canal officiel du fabricant.",
    valPrecoGenericCond: "Paiement sécurisé traité via le canal officiel.",
    valPrecoGenericFallback: "Consultez les détails de l'offre.",
    valOfertaGeneric: "Remise promotionnelle spéciale disponible pour cette campagne.",
    labelInfoRelevante: "Informations Pertinentes",
    valInfoRelevante: "Canal d'information officiel de la campagne. Les conditions de garantie et les politiques de remboursement sont celles établies par le site officiel."
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
    labelEntregaDigital: "Zugangsmethode",
    labelPreco: "Preis & Konditionen",
    labelOferta: "Sonderangebot",
    valFormula: "Formel entwickelt mit ausgewählten natürlichen Verbindungen und Extrakten.",
    valEntregaPhysical: "Versand gemäß den Lieferzeiten und Tarifen der offiziellen Website.",
    valEntregaDigital: "Sofortiger Zugriff per E-Mail nach Zahlungsbestätigung.",
    valPrecoCOD: "Zahlung bei Lieferung (zahlen Sie erst bei Erhalt des Produkts).",
    valPrecoOnline: "Sichere Online-Zahlung (Kreditkarte, PayPal oder lokale Methoden).",
    valOferta: "Sonderaktion für begrenzte Zeit auf dem offiziellen Kanal.",
    formatPreco: "Von <del>{orig}</del> auf nur <strong>{prom}</strong>",
    ctaOffer: "Nutzen Sie den Rabatt! Zeitlich begrenztes Angebot.",
    descTemplate: "Offizielle Informationsseite über das Produkt {prod}. Sehen Sie sich die Angebotsdetails an und kaufen Sie mit Originalitätsgarantie.",
    priceDescFormat: " Von {orig} auf nur {prom}.",
    priceValFormat: " (Wert: {val}).",
    labelGadget: "Technische Spezifikationen",
    valGadget: "Vom Hersteller entwickelte High-Tech-Spezifikationen und -Funktionen.",
    labelDigital: "Inhalt / Funktionen",
    valDigital: "Hochwertige Ressourcen und Informationsmaterialien von Experten.",
    valGenericCampaignInfo: "Informationen in dieser Kampagne prüfen.",
    valPrecoGeneric: "Werbewert auf dem offiziellen Kanal des Herstellers verfügbar.",
    valPrecoGenericCond: "Sichere Zahlung über den offiziellen Kanal.",
    valPrecoGenericFallback: "Siehe die Details des Angebots.",
    valOfertaGeneric: "Spezieller Aktionsrabatt in dieser Kampagne verfügbar.",
    labelInfoRelevante: "Relevante Informationen",
    valInfoRelevante: "Offizieller Informationskanal der Kampagne. Die Garantiebedingungen und Rückerstattungsrichtlinien entsprechen denen der offiziellen Website."
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
    labelEntregaDigital: "Metodă de Acces",
    labelPreco: "Preț și Condiții",
    labelOferta: "Ofertă Specială",
    valFormula: "Formulă dezvoltată cu compuși și extracte naturale selectate.",
    valEntregaPhysical: "Livrare în conformitate cu termenele și tarifele site-ului oficial.",
    valEntregaDigital: "Acces imediat prin e-mail după confirmarea plății.",
    valPrecoCOD: "Plată la Livrare (plătiți doar la primirea produsului).",
    valPrecoOnline: "Plată Online Securizată (Card de Credit, PayPal sau metode locale).",
    valOferta: "Promoție specială pe perioadă limitată pe canalul oficial.",
    formatPreco: "De la <del>{orig}</del> la doar <strong>{prom}</strong>",
    ctaOffer: "Profită de reducere! Ofertă pe timp limitat.",
    descTemplate: "Pagina oficială de informații despre produsul {prod}. Consultați detaliile ofertei și cumpărați cu garanție de originalitate.",
    priceDescFormat: " De la {orig} la doar {prom}.",
    priceValFormat: " (Valoare: {val}).",
    labelGadget: "Specificații Tehnice",
    valGadget: "Specificații și caracteristici de înaltă tehnologie dezvoltate de producător.",
    labelDigital: "Conținut / Caracteristici",
    valDigital: "Resurse de înaltă calitate și materiale informative dezvoltate de experți.",
    valGenericCampaignInfo: "Consultați informațiile din această campanie.",
    valPrecoGeneric: "Valoare promoțională disponibilă pe canalul oficial al producătorului.",
    valPrecoGenericCond: "Plată securizată procesată prin canalul oficial.",
    valPrecoGenericFallback: "Vedeți detaliile ofertei.",
    valOfertaGeneric: "Reducere promoțională specială disponibilă în această campanie.",
    labelInfoRelevante: "Informații Relevante",
    valInfoRelevante: "Canal informativ oficial al campaniei. Termenii de garanție și politicile de rambursare sunt cele stabilite de site-ul oficial."
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
    labelEntregaDigital: "Sposób Dostępu",
    labelPreco: "Cena i Warunki",
    labelOferta: "Oferta Specjalna",
    valFormula: "Formuła opracowana z wyselekcjonowanych naturalnych związków i ekstraktów.",
    valEntregaPhysical: "Wysyłka zgodnie z terminami i stawkami oficjalnej strony.",
    valEntregaDigital: "Natychmiastowy dostęp przez e-mail po potwierdzeniu płatności.",
    valPrecoCOD: "Płatność przy Odbiorze (płać tylko przy odbiorze produktu).",
    valPrecoOnline: "Bezpieczna Płatność Online (Karta Kredytowa, PayPal lub lokalne metody).",
    valOferta: "Specjalna promocja ograniczona czasowo na oficjalnym kanale.",
    formatPreco: "Z <del>{orig}</del> na jedyne <strong>{prom}</strong>",
    ctaOffer: "Skorzystaj z rabatu! Oferta ograniczona czasowo.",
    descTemplate: "Oficjalna strona informacyjna o produkcie {prod}. Zobacz szczegóły oferty i kupuj z gwarancją oryginalności.",
    priceDescFormat: " Z {orig} na jedyne {prom}.",
    priceValFormat: " (Wartość: {val}).",
    labelGadget: "Specyfikacje Techniczne",
    valGadget: "Zaawansowane technicznie specyfikacje i funkcje opracowane przez producenta.",
    labelDigital: "Zawartość / Funkcje",
    valDigital: "Wysokiej jakości zasoby i materiały informacyjne opracowane przez ekspertów.",
    valGenericCampaignInfo: "Sprawdź informacje w tej kampanii.",
    valPrecoGeneric: "Wartość promocyjna dostępna na oficjalnym kanale producenta.",
    valPrecoGenericCond: "Bezpieczna płatność realizowana za pośrednictwem oficjalnego kanału.",
    valPrecoGenericFallback: "Zobacz szczegóły oferty.",
    valOfertaGeneric: "Specjalny rabat promocyjny dostępny w tej kampanii.",
    labelInfoRelevante: "Istotne Informacje",
    valInfoRelevante: "Oficjalny kanał informacyjny kampanii. Warunki gwarancji i zasady zwrotów są zgodne z określonymi na oficjalnej stronie."
  },
  "ar": {
    title: "🍪 سياسة ملفات التعريف",
    desc: "نستخدم ملفات تعريف الارتباط لتحسين تجربتك. بالاستمرار، فإنك توافق على شروطنا.",
    accept: "قبول",
    decline: "رفض",
    infoBtn: "تفاصيل العرض",
    infoTitle: "تفاصيل العرض",
    labelFormula: "التركيبة / المكونات",
    labelEntrega: "مدة التوصيل",
    labelEntregaDigital: "طريقة الوصول",
    labelPreco: "السعر والشروط",
    labelOferta: "عرض خاص",
    valFormula: "تركيبة مطورة بمكونات ومستخلصات طبيعية مختارة بعناية.",
    valEntregaPhysical: "الشحن يتم وفقًا للمواعيد والأسعار الخاصة بالموقع الرسمي.",
    valEntregaDigital: "وصول فوري عبر البريد الإلكتروني بعد تأكيد الدفع.",
    valPrecoCOD: "الدفع عند الاستلام (ادفع فقط عند استلام المنتج).",
    valPrecoOnline: "دفع آمن عبر الإنترنت (بطاقة الائتمان أو وسائل الدفع المحلية).",
    valOferta: "عرض ترويجي خاص لفترة محدودة على القناة الرسمية.",
    formatPreco: "من <del>{orig}</del> إلى <strong>{prom}</strong> فقط",
    ctaOffer: "استفيد من الخصم! عرض لفترة محدودة.",
    descTemplate: "الصفحة التعريفية الرسمية للمنتج {prod}. تعرف على تفاصيل العرض واشترِ مع ضمان الأصالة.",
    priceDescFormat: " من {orig} إلى {prom} فقط.",
    priceValFormat: " (السعر: {val}).",
    labelGadget: "المواصفات الفنية",
    valGadget: "مواصفات ومميزات عالية التقنية تم تطويرها بواسطة الشركة المصنعة.",
    labelDigital: "المحتوى / الميزات",
    valDigital: "مصادر ومواد إعلامية عالية الجودة تم تطويرها بواسطة خبراء.",
    valGenericCampaignInfo: "تحقق من المعلومات المتوفرة في هذه الحملة.",
    valPrecoGeneric: "قيمة ترويجية متاحة على القناة الرسمية للشركة المصنعة.",
    valPrecoGenericCond: "دفع آمن معالج عبر القناة الرسمية.",
    valPrecoGenericFallback: "انظر تفاصيل العرض.",
    valOfertaGeneric: "خصم ترويجي خاص متاح في هذه الحملة.",
    labelInfoRelevante: "معلومات هامة",
    valInfoRelevante: "القناة الإخبارية الرسمية للحملة. شروط الضمان وسياسات الاسترداد هي تلك المحددة على الموقع الرسمي."
  },
  "th": {
    title: "🍪 นโยบายคุกกี้",
    desc: "เราใช้คุกกี้เพื่อปรับปรุงประสบการณ์ของคุณ หากดำเนินการต่อ แสดงว่าคุณยอมรับข้อตกลงของเรา",
    accept: "ยอมรับ",
    decline: "ปฏิเสธ",
    infoBtn: "รายละเอียดข้อเสนอ",
    infoTitle: "รายละเอียดข้อเสนอ",
    labelFormula: "สูตร / ส่วนประกอบ",
    labelEntrega: "ระยะเวลาจัดส่ง",
    labelEntregaDigital: "วิธีการเข้าถึง",
    labelPreco: "ราคาและเงื่อนไข",
    labelOferta: "ข้อเสนอพิเศษ",
    valFormula: "สูตรที่ได้รับการพัฒนาด้วยสารสกัดและส่วนผสมธรรมชาติที่คัดสรรมาเป็นอย่างดี",
    valEntregaPhysical: "การจัดส่งเป็นไปตามระยะเวลาและค่าจัดส่งของเว็บไซต์อย่างเป็นทางการ",
    valEntregaDigital: "เข้าถึงได้ทันทีทางอีเมลหลังยืนยันการชำระเงิน",
    valPrecoCOD: "ชำระเงินปลายทาง (จ่ายเมื่อได้รับสินค้าเท่านั้น)",
    valPrecoOnline: "ชำระเงินออนไลน์อย่างปลอดภัย (บัตรเครดิต, PayPal หรือวิธีการชำระเงินในท้องถิ่น)",
    valOferta: "โปรโมชันพิเศษจำกัดเวลาในช่องทางอย่างเป็นทางการ",
    formatPreco: "จาก <del>{orig}</del> เหลือเพียง <strong>{prom}</strong>",
    ctaOffer: "รับส่วนลดทันที! ข้อเสนอมีจำนวนและเวลาจำกัด",
    descTemplate: "หน้าข้อมูลอย่างเป็นทางการเกี่ยวกับผลิตภัณฑ์ {prod} ดูรายละเอียดข้อเสนอและสั่งซื้อพร้อมการรับประกันของแท้",
    priceDescFormat: " จาก {orig} เหลือเพียง {prom}",
    priceValFormat: " (ราคา: {val})",
    labelGadget: "ข้อมูลจำเพาะทางเทคนิค",
    valGadget: "ข้อมูลจำเพาะและคุณสมบัติไฮเทคที่พัฒนาโดยผู้ผลิต",
    labelDigital: "เนื้อหา / คุณสมบัติ",
    valDigital: "ทรัพยากรและเนื้อหาข้อมูลคุณภาพสูงที่พัฒนาโดยผู้เชี่ยวชาญ",
    valGenericCampaignInfo: "ตรวจสอบข้อมูลในแคมเปญนี้",
    valPrecoGeneric: "ราคาราคาโปรโมชันบนช่องทางอย่างเป็นทางการของผู้ผลิต",
    valPrecoGenericCond: "การชำระเงินที่ปลอดภัยผ่านช่องทางอย่างเป็นทางการ",
    valPrecoGenericFallback: "ดูรายละเอียดข้อเสนอ",
    valOfertaGeneric: "ส่วนลดโปรโมชันพิเศษที่มีในแคมเปญนี้",
    labelInfoRelevante: "ข้อมูลที่เกี่ยวข้อง",
    valInfoRelevante: "ช่องทางข้อมูลอย่างเป็นทางการของแคมเปญ เงื่อนไขการรับประกันและนโยบายการคืนเงินเป็นไปตามที่เว็บไซต์อย่างเป็นทางการกำหนด"
  }
};

function detectLanguageFromText(cleanText: string): string {
  if (/[\u0600-\u06FF]/.test(cleanText)) {
    return "ar";
  }
  if (/[\u0E00-\u0E7F]/.test(cleanText)) {
    return "th";
  }
  const scores: Record<string, number> = {
    "pt-BR": 0,
    "es": 0,
    "it": 0,
    "fr": 0,
    "de": 0,
    "ro": 0,
    "pl": 0,
    "en": 0,
    "ar": 0,
    "th": 0
  };

  // Specific unique trigger words/phrases
  if (/\b(?:preço|desconto|composição|garantia|prazo|entrega|pague na entrega|cápsulas|articulações)\b/i.test(cleanText)) scores["pt-BR"] += 25;
  if (/\b(?:precio|descuento|composición|garantía|plazo|contra entrega|pago|pedir|articulaciones|cápsulas|dolor|hinchazón|solicitud|recibirlo|anterior|actual)\b/i.test(cleanText)) scores["es"] += 25;
  if (/\b(?:prezzo|sconto|composizione|garanzia|consegna|pagamento alla consegna)\b/i.test(cleanText)) scores["it"] += 25;
  if (/\b(?:prix|remise|composition|garantie|livraison|paiement à la livraison|réduction|commander|officiel|produit|offre)\b/i.test(cleanText)) scores["fr"] += 25;
  if (/\b(?:preis|rabatt|zusammensetzung|garantie|lieferzeit|zahlung bei lieferung)\b/i.test(cleanText)) scores["de"] += 25;
  if (/\b(?:preț|reducere|compoziție|garanție|timp de livrare|plată la livrare)\b/i.test(cleanText)) scores["ro"] += 25;
  if (/\b(?:cena|rabat|skład|gwarancja|czas dostawy|płatność przy odbiorze)\b/i.test(cleanText)) scores["pl"] += 25;

  // Split and count high frequency unique words/conjunctions
  const words = cleanText.split(/\s+/);
  for (const w of words) {
    if (w === "y" || w === "con" || w === "para" || w === "los" || w === "las" || w === "del" || w === "el" || w === "la" || w === "un" || w === "una" || w === "por" || w === "sin") scores["es"]++;
    if (w === "o" || w === "com" || w === "para" || w === "os" || w === "as" || w === "dos" || w === "das" || w === "um" || w === "uma" || w === "por" || w === "sem") scores["pt-BR"]++;
    if (w === "il" || w === "di" || w === "in" || w === "con" || w === "per" || w === "i" || w === "gli") scores["it"]++;
    if (w === "le" || w === "la" || w === "du" || w === "et" || w === "pour" || w === "avec" || w === "les" || w === "des" || w === "un" || w === "une" || w === "est" || w === "en") scores["fr"]++;
    if (w === "der" || w === "die" || w === "das" || w === "und" || w === "mit" || w === "für" || w === "von") scores["de"]++;
    if (w === "și" || w === "în" || w === "cu" || w === "pentru" || w === "din") scores["ro"]++;
    if (w === "w" || w === "i" || w === "z" || w === "na" || w === "dla") scores["pl"]++;
    if (w === "the" || w === "and" || w === "of" || w === "with" || w === "for" || w === "to") scores["en"]++;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (best[0][1] > 3) {
    return best[0][0];
  }
  return "en";
}

function detectLandingPageLanguage(html: string | null, referenceUrl: string, chosenLanguage: string = "auto", meta?: PageMetadata): string {
  let lang = chosenLanguage || "auto";
  if (lang !== "auto") {
    return lang;
  }

  // 1. Check full HTML text content first (most reliable, as developers often leave incorrect <html lang="en"> tags on cloned/translated sites)
  if (html) {
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    const langFromHtmlText = detectLanguageFromText(cleanText);
    if (langFromHtmlText && (langFromHtmlText !== "en" || !/<html\s+[^>]*lang=['"]?([a-zA-Z-]{2,5})['"]?/i.test(html))) {
      return langFromHtmlText;
    }
  }

  // 2. Try to detect from HTML tag if available (optional quotes)
  if (html) {
    const htmlLangMatch = html.match(/<html\s+[^>]*lang=['"]?([a-zA-Z-]{2,5})['"]?/i);
    if (htmlLangMatch) {
      const rawLang = htmlLangMatch[1].toLowerCase();
      if (rawLang.startsWith("th")) return "th";
      if (rawLang.startsWith("ar")) return "ar";
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

  // 3. Try to detect from reference URL
  if (referenceUrl) {
    const urlLower = referenceUrl.toLowerCase();
    if (urlLower.endsWith(".th") || urlLower.includes(".co.th") || urlLower.includes("/th/")) {
      return "th";
    } else if (urlLower.endsWith(".br") || urlLower.includes(".com.br")) {
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
    } else if (urlLower.endsWith(".ma") || urlLower.includes("/ar/") || urlLower.includes("/ma/")) {
      return "ar";
    }
  }

  // 4. Fallback: Check metadata text
  let metadataText = "";
  if (meta) {
    if (meta.seoDescription) {
      metadataText += " " + meta.seoDescription.toLowerCase();
    }
    if (meta.productName) {
      metadataText += " " + meta.productName.toLowerCase();
    }
    if (meta.productDetails && Array.isArray(meta.productDetails)) {
      metadataText += " " + meta.productDetails.join(" ").toLowerCase();
    }
  }

  if (metadataText.trim()) {
    const langFromMetadata = detectLanguageFromText(metadataText);
    if (langFromMetadata !== "en") {
      return langFromMetadata;
    }
  }

  return "en"; // default fallback
}

async function generateScreenshotBridgeHtml(input: {
  referenceUrl: string;
  affiliateUrl: string;
  trackingTags: string;
  productHint: string;
  popupLanguage?: string;
}) {
  const product = input.productHint || "Oferta Oficial";
  let lang = detectLandingPageLanguage(null, input.referenceUrl, input.popupLanguage);
  
  // When initial detection falls back to English (default), try a quick fetch
  // to get the actual <html lang> attribute from the landing page
  if (lang === "en" && (!input.popupLanguage || input.popupLanguage === "auto")) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(input.referenceUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html",
          "Range": "bytes=0-4096"
        },
        redirect: "follow",
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const partialHtml = await res.text();
      const finalUrl = res.url || input.referenceUrl;
      const quickLang = detectLandingPageLanguage(partialHtml, finalUrl, "auto");
      if (quickLang !== "en") {
        lang = quickLang;
      }
    } catch (_) {
      // Silently ignore — keep the fallback lang
    }
  }

  const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
  const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
  const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
  // Use high-definition 1920px width to ensure screenshot looks perfectly crisp on all devices
  const thumIoUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1920/${input.referenceUrl}`;
  const mobileThumIoUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/390/${input.referenceUrl}`;

  let faviconUrl = "";
  try {
    const domain = new URL(input.referenceUrl).hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch (_) {}

  const localization = COOKIE_LOCALIZATION[lang] || COOKIE_LOCALIZATION["en"];
  let seoDesc = localization.descTemplate.replace("{prod}", product);
  seoDesc += ` ${localization.valPrecoGenericFallback} ${localization.ctaOffer}`;
  seoDesc = rewriteClaimsWithLocalDictionary(seoDesc);

  // Generate background presell layout with the high-resolution screenshot
  const cleanHtml = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product}</title>
  <meta name="description" content="${seoDesc}" />
  <meta name="robots" content="index, follow" />
  <link rel="preload" as="image" href="${thumIoUrl}" />
  <link rel="preload" as="image" href="${mobileThumIoUrl}" />
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ""}
  ${input.trackingTags}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #ffffff;
      position: relative;
    }
    
    /* Ambient blurred background layer */
    .ambient-bg {
      position: fixed;
      inset: 0;
      background-image: url('${thumIoUrl}');
      background-size: cover;
      background-position: center top;
      filter: blur(50px);
      opacity: 0.35;
      z-index: 0;
      pointer-events: none;
    }
    
    .site-background-container {
      position: fixed;
      inset: 0;
      overflow: hidden;
      z-index: 1;
    }
    .site-background-img {
      display: block;
      width: 100vw;
      height: 100vh;
      object-fit: cover;
      object-position: center top;
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
      .site-background-img.ads-mobile-bg {
        display: block;
      }
      .ads-desktop-bg {
        display: none;
      }
    }
    
    @keyframes screenshotSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="ambient-bg"></div>
  <div class="site-background-container">
    <div id="screenshotLoader" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #ffffff; z-index: 9999999;">
      <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #198754; border-radius: 50%; animation: screenshotSpin 1s linear infinite;"></div>
    </div>
    <img
      class="site-background-img ads-desktop-bg"
      src="${thumIoUrl}"
      alt="desktop background"
      onload="var l = document.getElementById('screenshotLoader'); if(l) l.style.display='none';"
    />
    <img
      class="site-background-img ads-mobile-bg"
      src="${mobileThumIoUrl}"
      alt="mobile background"
    />
  </div>
  <script>
    setTimeout(function() {
      var l = document.getElementById('screenshotLoader');
      if (l) l.style.display = 'none';
    }, 5000);
  </script>
</body>
</html>`;

  // Inject the premium centered cookie overlay popup
  return injectCookieConsentOverlay(cleanHtml, input.affiliateUrl, input.referenceUrl, lang);
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
  const isRtl = lang === "ar";

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
      ${isRtl ? 'direction: rtl;' : ''}
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

async function generateCleanBackgroundPresellHtml(input: {
  productName: string;
  referenceUrl: string;
  affiliateUrl: string;
  trackingTags: string;
  backgroundImageUrl: string;
  mobileBackgroundImageUrl?: string;
  popupLanguage: string;
  meta: PageMetadata;
}): Promise<string> {
  const product = input.productName || "Oferta Oficial";
  const bgUrl = input.backgroundImageUrl;
  const mobileBgUrl = input.mobileBackgroundImageUrl || bgUrl;
  const lang = input.popupLanguage || "pt-BR";
  
  let faviconUrl = "";
  if (input.meta?.productImageUrl) {
    faviconUrl = input.meta.productImageUrl;
  } else {
    try {
      const domain = new URL(input.referenceUrl).hostname;
      faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch (_) {}
  }

  // Inline favicon as base64 to prevent external domain loading compliance flags
  if (faviconUrl && faviconUrl.startsWith("http")) {
    try {
      faviconUrl = await downloadAsBase64(faviconUrl);
    } catch (_) {
      // Safe fallback SVG favicon to keep it self-contained
      faviconUrl = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>";
    }
  }

  const localization = COOKIE_LOCALIZATION[lang] || COOKIE_LOCALIZATION["en"];
  let seoDesc = localization.descTemplate.replace("{prod}", product);
  seoDesc += ` ${localization.valPrecoGenericFallback} ${localization.ctaOffer}`;
  seoDesc = rewriteClaimsWithLocalDictionary(seoDesc);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product}</title>
  <meta name="description" content="${seoDesc}" />
  <meta name="robots" content="index, follow" />
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ""}
  ${input.trackingTags}
  <style id="presell-cookie-styles">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #ffffff;
      position: relative;
    }
    
    /* Ambient blurred background layer */
    .ambient-bg {
      position: fixed;
      inset: 0;
      ${bgUrl ? `background-image: url("${bgUrl}");` : ""}
      background-size: cover;
      background-position: center top;
      filter: blur(50px);
      opacity: 0.35;
      z-index: 0;
      pointer-events: none;
    }
    
    .site-background-container {
      position: fixed;
      inset: 0;
      overflow: hidden;
      z-index: 1;
    }
    .site-background-img {
      display: block;
      width: 100vw;
      height: 100vh;
      object-fit: cover;
      object-position: center top;
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
      .site-background-img.ads-mobile-bg {
        display: block;
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
    // --- PORTUGUESE PATTERNS ---
    { regex: /\b(dor\s+e\s+restaurar\s+lagoas|dor\s+nas\s+lagoas)\b/gi, replacement: "conforto e bem-estar corporal" },
    { regex: /\b(restaurar\s+)?(lagoas)\b/gi, replacement: "flexibilidade corporal" },
    { regex: /\b(?:doença|doenca)\s+de\s+dentro\s+para\s+fora\b/gi, replacement: "desconforto de forma natural" },
    { regex: /(?:dentro de|após apenas|apos apenas|em|após|apos)\s+\d+(?:\s+a\s+\d+)?\s*(?:dias|semanas)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "com o uso regular" },
    { regex: /\b(?:remove(?:r)?|elimina(?:r)?|combate(?:r)?|trata(?:r)?|previne|alivia(?:r)?)\s+(?:o|a|os|as)?\s*(?:ignição|ignicao|inflamação|inflamacao|inchaço|inchaco|vermelhidão|vermelhidao)(?:\s*(?:,\s*|e\s+|ou\s+)(?:ignição|ignicao|inflamação|inflamacao|inchaço|inchaco|vermelhidão|vermelhidao))*/gi, replacement: "auxilia no alívio e conforto" },
    { regex: /\b(?:remove(?:r)?|elimina(?:r)?|combate(?:r)?|trata(?:r)?|previne|alivia(?:r)?)\s+(?:e\s+previne\s+)?(?:deposição|deposicao)\s+de\s+sal(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia no conforto articular" },
    { regex: /\b(?:reconstrói|reconstroi|regenera|recupera|restaura|restaurar)\s+(?:o|a|os|as)?\s*(?:exausto\s+)?(?:tecido cartilaginoso|cartilagem)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia na manutenção articular" },
    { regex: /\b(?:restaura|restaurar)\s+(?:o|a|os|as)?\s*mobilidade(?:\s*(?:de|das|dos)?\s*articulações)?(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia na movimentação das articulações" },
    
    // --- POLISH VARICOSE & VASCULAR & FEAR-MONGERING PATTERNS (HTML-TAG TOLERANT) ---
    { regex: /ŻYLAKI(?:\s*<[^>]+>)*\s*(?:ZABIJAJĄ|SĄ\s+ŚMIERTELNIE|SĄ\s+NIEBEZPIECZNE|ZABIJAJA|SA\s+SMIERTELNIE|SA\s+NIEBEZPIECZNE)(?:\s*<[^>]+>)*\s*(?:PIĘKNO|SMIERTELNIE|PIEKNO|I\s+ZDROWIE)?(?:\s*<[^>]+>)*\s*(?:TWOICH\s+NÓG)?/gi, replacement: "Zadbaj o conforto e beleza das suas pernas" },
    { regex: /śmiertelnie(?:\s*<[^>]+>)*\s*niebiezpiecznie!?/gi, replacement: "Cuidado diário para as pernas" },
    { regex: /śmiertelnie(?:\s*<[^>]+>)*\s*niebezpiecznie!?/gi, replacement: "Cuidado diário para as pernas" },
    { regex: /Usuwa(?:\s*<[^>]+>)*\s*(?:przyczynę|przyczyne)?(?:\s*<[^>]+>)*\s*żylaków/gi, replacement: "Auxilia no conforto das pernas" },
    { regex: /Usuwa(?:\s*<[^>]+>)*\s*(?:problem\s+)?(?:siatki\s+żylnej|pajączków)/gi, replacement: "Auxilia no aspecto visual da pele" },
    { regex: /Neutralizuje(?:\s*<[^>]+>)*\s*ból(?:\s*<[^>]+>)*\s*i(?:\s*<[^>]+>)*\s*obrzęk/gi, replacement: "Promove alívio e conforto" },
    { regex: /tworzenie\s+się\s+skrzepów|skrzepów\s+krwi|zakrzepica|udar|paraliż|paraliz|śmierć|smierc|krwawienie/gi, replacement: "conforto vascular" },
    { regex: /nagłe\s+zerwanie\s+zakrzepu|dostanie\s+się\s+do\s+naczyń\s+mózgu|spowodować\s+udar/gi, replacement: "suporte à circulação saudável" },
    { regex: /jedyną\s+alternatywą\s+dla\s+zabiegu\s+chirurgicznego|jedyna\s+alternatywa\s+dla\s+zabiegu\s+chirurgicznego/gi, replacement: "suporte diário e cuidado natural" },
    { regex: /bez\s+skalpela/gi, replacement: "cuidado suave" },
    { regex: /bez\s+antybiotyków/gi, replacement: "fórmula natural" },
    { regex: /bez\s+kosztownych\s+zabiegów/gi, replacement: "praticidade no dia a dia" },
    { regex: /wyniki\s+za\s+\d+\s*(?:dni|tygodnie|tygodni)/gi, replacement: "Resultados com uso regular" },
    { regex: /przed\s+i\s+po/gi, replacement: "cuidados diários" },
    { regex: /kardiochirurg|flebolog|ekspert\s+medycyny|chirurg|chirurgiem/gi, replacement: "Especialista em bem-estar" },
    { regex: /nieuleczalny/gi, replacement: "requer cuidados diários" },
    { regex: /niepłodności/gi, replacement: "bem-estar geral" },
    { regex: /UKRYWAJĄC\s+SWOJE\s+NOGI/gi, replacement: "CUIDANDO DAS SUAS PERNAS" },
    { regex: /PRZYMYKASZ\s+OCZY\s+NA\s+KONSEKWENCJE/gi, replacement: "DESCUBRA COMO MANTER O CONFORTO" },

    // --- POLISH PATTERNS ---
    // Joints/Pain/Mobility/Cartilage (Polish)
    { regex: /\b(pozbądź\s+się\s+bólu|pozbadz\s+sie\s+bolu|zlikwiduj\s+ból|usuwa\s+ból|ból\s+stawów|bol\s+stawow)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "komfort i dobre samopoczucie stawów" },
    { regex: /\b(?:usuwa|eliminuje|zwalcza|leczy|zapobiega)\s+(?:zapalenie|obrzęk|obrzek|zaczerwienienie)(?:\s*(?:,\s*|i\s+|lub\s+)(?:zapalenie|obrzęk|obrzek|zaczerwienienie))*/gi, replacement: "pomaga łagodzić dyskomfort" },
    { regex: /\b(?:usuwa|eliminuje|zapobiega)\s+(?:i\s+zapobiega\s+)?(?:odkładaniu\s+się\s+soli|odkladaniu\s+sie\s+soli)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "wspiera ruchomość stawów" },
    { regex: /\b(?:odbudowuje|regeneruje|przywraca|przywróć|przywroc|odbudować|regenerować|przywrócić)\s+(?:wycieńczoną\s+|wycienczona\s+)?(?:tkankę\s+chrzęstną|chrząstkę|stawy|tkanke\s+chrzestna|chrzastke)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "wspiera regenerację stawów" },
    { regex: /\b(?:przywraca|przywróć|przywroc)\s+(?:ruchomość|ruchomosc)(?:\s+stawów|\s+stawow)?(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "wspomaga elastyczność i ruchomość" },
    { regex: /\b(?:choroby|choroba)\s+od\s+wewnątrz/gi, replacement: "dyskomfortu w naturalny sposób" },
    
    // Timelines & Scarcity (Polish)
    { regex: /(?:w ciągu|w ciagu|za|po|już po|juz po)\s+\d+(?:\s*-\s*\d+)?\s*(?:dni|tygodni|dniach)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "przy regularnym stosowaniu" },
    { regex: /\b(?:tylko|zostało|ostatnie)\s+\d+\s*(?:sztuk|opakowań|opakowaniach|miejsc)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "Skorzystaj z oferty specjalnej" },
    { regex: /\b(?:cena\s+wzrośnie|oferta\s+wygasa)\s+(?:jutro|dzisiaj|wkrótce)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "Skorzystaj z oferty premierowej" },

    // Superlatives/Promises (Polish)
    { regex: /\b(najlepszy\s+na\s+świecie|sekretna\s+formuła|sekret,\s+który\s+lekarze\s+ukrywają|rewolucyjne\s+odkrycie|cudowna\s+formuła|cudowne\s+lekarstwo)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "Wyjątkowa formuła z naturalnymi składnikami" },
    { regex: /\b(bez\s+skutków\s+ubocznych|bez\s+skutkow\s+ubocznych|100%\s+naturalny\s+i\s+bezpieczny|brak\s+przeciwwskazań)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "Łagodna formuła oparta na naturalnych składnikami" },
    { regex: /\b(gwarantowany\s+wynik|gwarancja\s+satysfakcji|zerowe\s+ryzyko|gwarantowane\s+rezultaty)(?![a-zA-Z0-9ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, replacement: "Dla najlepszych rezultatów stosuj regularnie" },

    // --- SPANISH PATTERNS ---
    { regex: /\b(cura(?:r)?|controla(?:r)?|reduz(?:ir)?|regula(?:r)?|estabiliza(?:r)?|normaliza(?:r)?)\s+(?:el|la|los|las\s+)?(?:presión|presion|hipertensión|hipertension|presión arterial|presion arterial)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "apoya la salud cardiovascular" },
    { regex: /\b(previene|evita|elimina|cura(?:r)?|revierte(?:r)?)\s+(?:el|la|los|las\s+)?(?:infarto|infartos|derrame|derrames|avc|cardiopatía|cardiopatias)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "ayuda a mantener la salud del corazón" },
    { regex: /\b(cura(?:r)?|revierte(?:r)?|controla(?:r)?|reduz(?:ir)?|regula(?:r)?|estabiliza(?:r)?|normaliza(?:r)?)\s+(?:el|la|los|las\s+)?(?:diabetes|glucosa|glucemia|azúcar en la sangre|azucar en la sangre)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "apoya el equilibrio metabólico saludable" },
    { regex: /\b(elimina|matar|mata|expulsa|limpa|combate)\s+(?:el|la|los|las\s+)?(?:parasitos|parásitos|lombrices|vermes|toxinas|bacterias|hongos)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "ayuda al equilibrio de la flora intestinal" },
    { regex: /\b(cura(?:r)?|elimina(?:r)?|alivia(?:r)?|acaba(?:r)? con)\s+(?:el|la|los|las\s+)?(?:artritis|artrosis|dolor de articulaciones|dolor articular|reumatismo)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "promove el bienestar y la movilidad articular" },
    { regex: /\b(elimina|alivia|reduce)\s+(?:el|la|los|las\s+)?(?:inflamación|inflamacion|hinchazón|hinchazon|enrojecimiento)(?:\s*(?:,\s*|y\s+|o\s+)(?:inflamación|inflamacion|hinchazón|hinchazon|enrojecimiento))*/gi, replacement: "ayuda al alivio y confort" },
    { regex: /\b(elimina|combate|previene)\s+(?:el|la|los|las\s+)?(?:depósito de sal|depósitos de sal|depositos de sal)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "apoya el confort articular" },
    { regex: /\b(reconstruye|regenera|recupera|restaura|restaurar)\s+(?:el|la|los|las\s+)?(?:tejido cartilaginoso|cartílago|articulaciones)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "ayuda al mantenimiento articular" },
    { regex: /\b(restaura|restaurar)\s+(?:el|la|los|las\s+)?(?:movilidad)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "apoya la movilidad de las articulaciones" },
    { regex: /(?:dentro de|en|después de|despues de|después de solo)\s+\d+(?:\s*-\s*\d+)?\s*(?:días|dia|semanas|dias)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "con el uso regular" },
    { regex: /\b(?:solo|quedan|últimas|ultimas)\s+\d+\s*(?:unidades|frascos|kits|cupos)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "Aproveche la oferta de lanzamiento" },
    { regex: /(?:el precio sube|la oferta expira)\s+(?:mañana|hoy|pronto|en breve)/gi, replacement: "Aproveche la condición especial de lanzamiento" },
    { regex: /\b(el mejor del mundo|fórmula secreta|secreto que los médicos escondem|descubrimiento revolucionario|fórmula milagrosa|cura milagrosa)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "Fórmula exclusiva con ingredientes de origen natural" },
    { regex: /\b(sin efectos secundarios|100% natural y sin contraindicaciones|libre de efectos secundarios|no tiene contraindicaciones)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "Fórmula suave desarrollada con ingredientes de origen natural" },
    { regex: /\b(resultado garantido|satisfacción garantida o su dinero de vuelta|risco zero|garantía blindada)(?![a-zA-Z0-9á-úÁ-ÚñÑíÍóÓéÉáÁúÚãõÃÕçÇ])/gi, replacement: "Para mejores resultados, use de manera regular" },

    // --- PORTUGUESE BASELINE FALLBACK ---
    { regex: /\b(cura(?:r)?|controla(?:r)?|reduz(?:ir)?|regula(?:r)?|estabiliza(?:r)?|normaliza(?:r)?)\s+(?:(?:o|a|os|as)\s+)?(?:pressão|pressao|hipertensão|hipertensao|pressão arterial|pressao arterial)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "apoia a saúde cardiovascular" },
    { regex: /\b(previne|evita|elimina|cura(?:r)?|reverte(?:r)?)\s+(?:(?:o|a|os|as)\s+)?(?:infarto|infartos|derrame|derrames|avc|cardiopatia|cardiopatias)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia na manutenção da saúde do coração" },
    { regex: /\b(cura(?:r)?|reverte(?:r)?|controla(?:r)?|reduz(?:ir)?|regula(?:r)?|estabiliza(?:r)?|normaliza(?:r)?)\s+(?:(?:o|a|os|as)\s+)?(?:diabetes|glicose|glicemia|açúcar no sangue|acucar no sangue)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "apoia o equilíbrio metabólico saudável" },
    { regex: /\b(fim da|acabe com a|adeus ao|adeus à|adeus a)\s+(?:diabetes|glicose alta|glicemia alta|pressão alta|hipertensão)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "suporte natural para uma rotina saudável" },
    { regex: /\b(elimina|matar|mata|expulsa|limpa|combate)\s+(?:(?:o|a|os|as)\s+)?(?:parasitas|vermes|toxinas|bactérias ruins|fungos)(?:\s+(?:e|ou)\s+(?:parasitas|vermes|toxinas|bactérias ruins|fungos))?(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia no equilíbrio da flora intestinal e suporte digestivo" },
    { regex: /\b(desintoxicação total|detox completo|limpeza do organismo)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "suporte ao bem-estar digestivo" },
    { regex: /\b(cura(?:r)?|elimina(?:r)?|alivia(?:r)?|acaba(?:r)? com)\s+(?:(?:o|a|os|as)\s+)?(?:artrite|artrose|dor nas juntas|dor nas articulações|dores nas juntas|dores nas articulações|reumatismo)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "promove o bem-estar e mobilidade articular" },
    { regex: /\b(emagreça|emagreca|perca|perder|queime|queimar)\s+(?:rápido|rapido|fácil|facil|garantido|de vez|urgente)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia no controle de peso saudável" },
    { regex: /\b(queima de gordura garantida|perda de peso garantida|emagrecimento garantido|emagreça de forma rápida)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "auxilia na digestão e controle de peso saudável" },
    { regex: /\bperdi\s+\d+\s*(?:kg|kilos|quilos|kilos em \d+ dias|kg em \d+ dias|quilos em \d+ dias)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "me sinto mais leve e com mais disposição" },
    { regex: /\b(?:apenas|restam|últimas|ultimas)\s+\d+\s*(?:unidades|frascos|kits|vagas)(?:\s+restantes|\s+no estoque)?(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "Aproveite a condição de lançamento" },
    { regex: /(?:o preço|o valor|a oferta)\s+(?:sobe|vai subir|expira|termina)\s+(?:amanhã|hoje|em breve|em poucas horas)/gi, replacement: "Aproveite enquanto a condição de lançamento está ativa" },
    { regex: /\b(o melhor do mundo|fórmula secreta|segredo que os médicos escondem|descoberta revolucionária|fórmula milagrosa|cura milagrosa)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "Fórmula exclusiva com ingredientes de origem natural" },
    { regex: /\b(sem efeitos colaterais|100% natural e sem contraindicações|livre de efeitos colaterais|não tem contraindicação)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "Fórmula suave desenvolvida com ingredientes de origem natural" },
    { regex: /\b(resultado garantido|satisfação garantida ou seu dinheiro de volta|risco zero|garantia blindada)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "Para melhores resultados, utilize o produto de forma regular" },
    { regex: /\b(se não tratar pode levar à morte|risco de mortalidade alto|silenciosa e mortal|pode te matar|morte silenciosa)(?![a-zA-Z0-9á-úÁ-ÚãõÃÕçÇ])/gi, replacement: "Mantenha seus exames em dia e sua rotina saudável" },
    { regex: /\b(comprovou sua eficácia|comprovado clinicamente|clinicamente comprovado|eficácia clínica comprovada)\b/gi, replacement: "Fórmula com ingredientes estudados" },

    // --- ADDITIONAL MULTI-LANGUAGE MEDICAL & PROSTATE COMPLIANCE PATTERNS ---
    // French (prostate/remedy/diseases)
    { regex: /\b(?:combattre|lutter|guérir|soigner)\s+efficacement\s+(?:la\s+)?prostatite\b/gi, replacement: "soutenir le confort urinaire et la prostate" },
    { regex: /\b(?:combattre|lutter|guérir|soigner)\s+efficacement\s+contre\s+la\s+prostatite\b/gi, replacement: "soutenir le confort urinaire et la prostate" },
    { regex: /\b(?:les\s+)?maladies\s+chroniques\s+du\s+système\s+reproducteur\b/gi, replacement: "le confort urinaire et la vitalité masculine" },
    { regex: /\bun\s+remède\s+naturel\b/gi, replacement: "un produit formulé avec des ingrédients naturels" },
    { regex: /\bprostatite\b/gi, replacement: "confort urinaire" },
    { regex: /\bprostate\b/gi, replacement: "confort masculin" },
    { regex: /\bsystème\s+reproducteur\b/gi, replacement: "bien-être masculin" },
    { regex: /\bmaladie\s+chronique\b/gi, replacement: "inconfort" },
    { regex: /\bmaladies\s+chroniques\b/gi, replacement: "inconforts" },
    { regex: /\bremède\b/gi, replacement: "produit naturel" },
    { regex: /\b50%\s+de\s+réduction\b/gi, replacement: "remise promotionnelle" },
    { regex: /\boffre\s+à\s+durée\s+limitée\b/gi, replacement: "offre spéciale" },

    // Portuguese (prostate/remedy/diseases)
    { regex: /\b(?:combater|lutar)\s+eficazmente\s+(?:a\s+)?prostatite\b/gi, replacement: "auxiliar no conforto urinário e saúde da próstata" },
    { regex: /\b(?:combater|lutar)\s+eficazmente\s+contra\s+a\s+prostatite\b/gi, replacement: "auxiliar no conforto urinário e saúde da próstata" },
    { regex: /\b(?:as\s+)?doenças\s+crônicas\s+do\s+sistema\s+reprodutor\b/gi, replacement: "o conforto e bem-estar masculino" },
    { regex: /\bum\s+remédio\s+natural\b/gi, replacement: "um produto formulado com ingredientes naturais" },
    { regex: /\bprostatite\b/gi, replacement: "conforto urinário" },
    { regex: /\bpróstata\b/gi, replacement: "conforto masculino" },
    { regex: /\bsistema\s+reprodutor\b/gi, replacement: "bem-estar masculino" },
    { regex: /\bdoença\s+crônica\b/gi, replacement: "desconforto" },
    { regex: /\bdoenças\s+crônicas\b/gi, replacement: "desconfortos" },
    { regex: /\bremédio\b/gi, replacement: "suplemento natural" },

    // Spanish (prostate/remedy/diseases)
    { regex: /\b(?:combatir|luchar)\s+eficazmente\s+(?:la\s+)?prostatitis\b/gi, replacement: "apoyar el confort urinario y la salud de la próstata" },
    { regex: /\b(?:combatir|luchar)\s+eficazmente\s+contra\s+la\s+prostatitis\b/gi, replacement: "apoyar el confort urinario y la salud de la próstata" },
    { regex: /\b(?:las\s+)?enfermedades\s+crónicas\s+del\s+sistema\s+reproductor\b/gi, replacement: "el confort y bienestar masculino" },
    { regex: /\bun\s+remedio\s+natural\b/gi, replacement: "un producto formulado con ingredientes naturales" },
    { regex: /\bprostatitis\b/gi, replacement: "confort urinario" },
    { regex: /\bpróstata\b/gi, replacement: "confort masculino" },
    { regex: /\bsistema\s+reproductor\b/gi, replacement: "bienestar masculino" },
    { regex: /\benfermedad\s+crónica\b/gi, replacement: "incomodidad" },
    { regex: /\benfermedades\s+crónicas\b/gi, replacement: "incomodidades" },
    { regex: /\bremedio\b/gi, replacement: "suplemento natural" },

    // English (prostate/remedy/diseases)
    { regex: /\b(?:combat|fight)\s+effectively\s+prostatitis\b/gi, replacement: "support urinary comfort and prostate health" },
    { regex: /\b(?:combat|fight)\s+effectively\s+against\s+prostatitis\b/gi, replacement: "support urinary comfort and prostate health" },
    { regex: /\b(?:the\s+)?chronic\s+diseases\s+of\s+the\s+reproductive\s+system\b/gi, replacement: "urinary comfort and male vitality" },
    { regex: /\ba\s+natural\s+remedy\b/gi, replacement: "a supplement with natural ingredients" },
    { regex: /\bprostatitis\b/gi, replacement: "urinary comfort" },
    { regex: /\bprostate\b/gi, replacement: "male comfort" },
    { regex: /\breproductive\s+system\b/gi, replacement: "male well-being" },
    { regex: /\bchronic\s+disease\b/gi, replacement: "discomfort" },
    { regex: /\bchronic\s+diseases\b/gi, replacement: "discomforts" },
    { regex: /\bremedy\b/gi, replacement: "natural product" }
  ];

  let cleaned = html;
  for (const item of mapping) {
    cleaned = cleaned.replaceAll(item.regex, item.replacement);
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


async function rewriteClaimsForCompliance(html: string): Promise<{ html: string; aiFailed: boolean }> {
  try {
    interface CandidateItem {
      raw: string;
      plain: string;
    }
    
    const candidatesList: CandidateItem[] = [];
    const seenPlain = new Set<string>();
    const tagRegex = /<(h[1-6]|p|li|div|td|a|span|button)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;
    tagRegex.lastIndex = 0;

    while ((match = tagRegex.exec(html)) !== null) {
      const rawText = match[2];
      if (!rawText) continue;
      const plainText = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (plainText.length < 8 || plainText.length > 1200) continue;

      if (!seenPlain.has(plainText)) {
        seenPlain.add(plainText);
        candidatesList.push({ raw: rawText.trim(), plain: plainText });
      }
    }

    if (candidatesList.length === 0) {
      logger.info("Compliance rewriter: No text nodes found.");
      return { html: rewriteClaimsWithLocalDictionary(html), aiFailed: false };
    }

    logger.info({ count: candidatesList.length }, "Compliance rewriter: Found text node candidates for checking");

    const COMPLIANCE_SYSTEM_PROMPT = `Você é um especialista em compliance de copy para Google Ads com foco em páginas de afiliados de saúde e bem-estar. Sua função é receber textos extraídos de uma landing page, identificar os que violam as políticas do Google Ads e reescrevê-los com linguagem compliant — preservando idioma original e posicionamento do produto.

## REGRA PRINCIPAL SOBRE REESCRITA
SEMPRE gere uma alternativa compliant para textos violadores. NUNCA retorne string vazia ou null. Todo texto violador deve ter uma substituição com copy de qualidade que preserve o tom persuasivo mas dentro das políticas do Google Ads.

## FORMATO DE RESPOSTA (JSON OBRIGATÓRIO)
Retorne APENAS um JSON válido no formato:
{
  "respostas": [
    { "original": "texto original exato", "rewritten": "texto reescrito compliant" }
  ]
}`;

    const systemMessage = {
      role: "system",
      content: COMPLIANCE_SYSTEM_PROMPT
    };

    const userMessage = {
      role: "user",
      content: `Analise e reescreva os textos abaixo para cumprirem com as políticas do Google Ads. Para textos violadores: gere uma alternativa compliant persuasiva mantendo o mesmo idioma original. Para textos não violadores: mantenha a propriedade "rewritten" IDÊNTICA à "original".

Textos para analisar:
${JSON.stringify(candidatesList.map(c => c.plain), null, 2)}`
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
        return { html: rewriteClaimsWithLocalDictionary(html), aiFailed: true };
      }
    }

    let mapping: { respostas?: Array<{ original?: string; rewritten?: string }> } = {};
    try {
      mapping = JSON.parse(responseText);
    } catch (parseErr: any) {
      logger.error({ err: parseErr.message, responseText }, "AI response is not valid JSON, using local dictionary");
      return { html: rewriteClaimsWithLocalDictionary(html), aiFailed: true };
    }

    // 3. Apply the rewrites back into the HTML
    let cleanedHtml = html;
    let rewritesCount = 0;
    const responsesArray = mapping.respostas || [];
    
    for (const item of responsesArray) {
      if (item.original && item.rewritten && item.original !== item.rewritten && item.rewritten.trim()) {
        const cand = candidatesList.find(c => c.plain === item.original);
        if (cand) {
          cleanedHtml = cleanedHtml.replace(cand.raw, item.rewritten);
          rewritesCount++;
          logger.info({ original: item.original, rewritten: item.rewritten }, "Compliance rewriter: Rewrote claim");
        } else {
          cleanedHtml = cleanedHtml.replaceAll(item.original, item.rewritten);
          rewritesCount++;
        }
      }
    }
    
    logger.info({ rewritesCount }, "Compliance rewriter: Finished replacing claims in HTML");
    
    // Always run the local dictionary afterwards to catch any edge cases that the AI missed
    return { html: rewriteClaimsWithLocalDictionary(cleanedHtml), aiFailed: false };
  } catch (err: any) {
    logger.warn({ err: err.message }, "Compliance rewriter failed completely, running local dictionary on original HTML");
    return { html: rewriteClaimsWithLocalDictionary(html), aiFailed: true };
  }
}

function stripBeforeAfterSections(html: string): string {
  try {
    // 1. Find opening tags of containers (section, div, li) by class/ID keywords
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
        const blockLen = tagEndIndex - foundTagStartIndex;
        if (blockLen < html.length * 0.35) {
          logger.info({ tagName: foundTagName, tagStartIndex: foundTagStartIndex, tagEndIndex }, "Stripping before/after section from HTML");
          html = html.substring(0, foundTagStartIndex) + html.substring(tagEndIndex);
        }
      } else {
        // If we couldn't balance, we must break to avoid infinite loop
        break;
      }
      
      iterations++;
    }

    // 1.5. Semantic Reviews/Testimonials Section Stripping (targeting <section>, <div class="..."> and <article> tags)
    // Matches heading/title tags containing testimonial/review/trust/before-after vocabulary in multiple languages
    const reviewHeadingKeywords = /\b(depoimento|depoimentos|avaliaç|testemunho|opinio|comentari|review|testimonial|feedback|rating|opinion|testimonio|reseña|resena|avis|temoignage|témoignage|bewertung|rezension|erfahrungsbericht|vertrauen uns|erfahrung|erfolgsgeschichte|customer stories|histórias de sucesso|opiniones|comentarios|testimonios|vertrauen|opinia|opinie|wyniki|przed i po|before and after|antes y después|antes e depois)\b/i;
    const containerTagRegex = /<(section|div|article)(\s+[^>]*)?>/gi;
    let containerMatch;
    let semanticIterations = 0;

    while (semanticIterations < 15) {
      containerTagRegex.lastIndex = 0;
      let foundContainerStartIndex = -1;
      let foundContainerTagName = "";

      while ((containerMatch = containerTagRegex.exec(html)) !== null) {
        const tagName = containerMatch[1];
        const startIndex = containerMatch.index;

        // Balance the tag
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

        // SAFETY: Ignore root container wrappers that comprise more than 35% of the total HTML
        if (blockText.length >= html.length * 0.35) continue;

        const headingMatches = blockText.match(/<(?:h[1-6]|div|p|span)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|div|p|span)>/gi) || [];
        let isReviewSection = false;
        for (const h of headingMatches) {
          const text = h.replace(/<[^>]+>/g, "").trim().toLowerCase();
          if (reviewHeadingKeywords.test(text)) {
            isReviewSection = true;
            break;
          }
        }

        if (isReviewSection) {
          foundContainerStartIndex = startIndex;
          foundContainerTagName = tagName;
          break;
        }
      }

      if (foundContainerStartIndex === -1) break;

      // Balance and strip
      let openTagsCount = 0;
      const tagBalanceRegex = new RegExp(`<(?:${foundContainerTagName}(?:\\s[^>]*)?|\\/${foundContainerTagName})>`, 'gi');
      tagBalanceRegex.lastIndex = foundContainerStartIndex;

      let balanceMatch;
      let tagEndIndex = -1;
      while ((balanceMatch = tagBalanceRegex.exec(html)) !== null) {
        const foundTag = balanceMatch[0];
        if (foundTag.startsWith('</')) openTagsCount--;
        else openTagsCount++;

        if (openTagsCount === 0) {
          tagEndIndex = balanceMatch.index + foundTag.length;
          break;
        }
      }

      if (tagEndIndex !== -1) {
        const blockLen = tagEndIndex - foundContainerStartIndex;
        if (blockLen < html.length * 0.35) {
          logger.info({ tagName: foundContainerTagName, tagStartIndex: foundContainerStartIndex, tagEndIndex }, "Stripping semantic reviews section from HTML");
          html = html.substring(0, foundContainerStartIndex) + html.substring(tagEndIndex);
        }
      } else {
        break;
      }
      semanticIterations++;
    }

    // 2. Remove any stray images containing before/after/bef-aft/bef_aft/befaft keywords in their src
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
    // Keywords indicating a clinical study stats section across languages (PT, EN, ES, PL, FR, DE)
    const studyKeywordRegex = /\b(estudo|study|estudos|studies|melhoria|improvement|comprovad[ao]|comprovou|diabéticos|diab[eé]tic[oa]s|participantes|participants|ensaio|trial|percentagem|porcentagem|eficácia clínica|clinical efficacy|badania|badanie|skutecznoś|skutecznos|wolontariusz|instytucie|rezultaty|investigación|estudio|estudios|resultados|voluntarios|etude|éco|badaniach|zmniejszyła|zmniejszyla)\b/i;
    // Percentage pattern: 21,2% or 73% or 90.4% or 87,8%
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

        // SAFETY: Ignore root container wrappers that comprise more than 35% of the total HTML
        if (blockText.length >= html.length * 0.35) continue;

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
  const detectedLang = (lang && lang !== "auto" && COOKIE_LOCALIZATION[lang])
    ? lang
    : detectLandingPageLanguage(html, referenceUrl, lang, meta);
  const primaryColor = meta?.primaryColor || "#16a34a";
  const ctaButtonColor = meta?.ctaButtonColor || primaryColor;

  const localization = COOKIE_LOCALIZATION[detectedLang] || COOKIE_LOCALIZATION["en"];
  const titleClean = localization.title.replace(/^\u{1F36A}\s?/u, "");
  const isRtl = detectedLang === "ar";

  const productName = meta?.productName || "Produto";
  
  // ALWAYS generate a safe, generic SEO description to prevent Google Ads policy violations
  let seoDesc = localization.descTemplate.replace("{prod}", productName);

  // Resolve formula/spec/digital label and value
  let labelFormulaResolved = localization.labelFormula;
  let valFormulaResolved = localization.valGenericCampaignInfo;

  if (meta?.isGadget) {
    labelFormulaResolved = localization.labelGadget;
  } else if (meta?.isDigital) {
    labelFormulaResolved = localization.labelDigital;
  }

  // Add CTA directly into the SEO description (price is kept generic)
  seoDesc += ` ${localization.valPrecoGenericFallback} ${localization.ctaOffer}`;
  
  // Apply local compliance mapping to override any violating terminology in the description
  seoDesc = rewriteClaimsWithLocalDictionary(seoDesc);
  
  // Generic pricing and payment conditions
  let valPrecoResolved = localization.valPrecoGenericCond;
  valPrecoResolved = `${valPrecoResolved} (${localization.ctaOffer})`;

  let labelEntregaResolved = localization.labelEntrega;
  let valEntregaResolved = meta?.isDigital ? localization.valEntregaDigital : localization.valEntregaPhysical;
  if (meta?.isDigital) {
    labelEntregaResolved = localization.labelEntregaDigital;
  }

  const valOfertaResolved = meta?.extractedOffer
    ? `${meta.extractedOffer} - ${localization.valOferta}`
    : localization.valOfertaGeneric;

  // Additional safe details extracted from the landing page, sanitized for compliance
  const seoDetails = (meta?.productDetails || []).map(item => rewriteClaimsWithLocalDictionary(item));

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
    border: 1px solid #e2e8f0;
    border-top: 4px solid ${primaryColor};
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
    ${isRtl ? 'direction: rtl; text-align: right;' : ''}
  }
  @keyframes adsCardIn {
    from { transform: translate(-50%, -50%) scale(0.8) translateY(30px); opacity: 0; }
    to   { transform: translate(-50%, -50%) scale(1)   translateY(0);    opacity: 1; }
  }
  .ads-close-btn {
    position: absolute;
    top: 14px;
    ${isRtl ? 'left: 14px;' : 'right: 14px;'}
    width: 28px;
    height: 28px;
    background: #f1f5f9;
    border-radius: 50%;
    color: #64748b;
    font-size: 18px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
    user-select: none;
    z-index: 10;
  }
  .ads-close-btn:hover {
    background: #e2e8f0;
    color: #334155;
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
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ads-btn:active { transform: scale(0.96); }
  #ads-accept  { background: #16a34a; color: #fff; }
  #ads-accept:hover  { filter: brightness(0.9); }
  #ads-decline { background: #dc2626; color: #ffffff; border: none; }
  #ads-decline:hover { filter: brightness(0.9); }
  
  #ads-card del {
    text-decoration: line-through !important;
    opacity: 0.7;
  }
  
  /* SEO Section Styles */
  #ads-seo-wrapper {
    margin-top: 24px;
    border-top: 1px dashed #e2e8f0;
    padding-top: 16px;
    text-align: ${isRtl ? 'right' : 'left'};
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
    <a class="ads-close-btn" href="${affiliateUrl}" aria-label="Close">&times;</a>
    <div id="ads-icon-container">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <h3 id="ads-title">${titleClean}</h3>
    <p id="ads-desc">${localization.desc}</p>
    <div id="ads-btns">
      <a class="ads-btn" id="ads-decline" href="${affiliateUrl}">${localization.decline}</a>
      <a class="ads-btn" id="ads-accept" href="${affiliateUrl}">${localization.accept}</a>
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
            <span><strong>${labelFormulaResolved}:</strong> ${valFormulaResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${labelEntregaResolved}:</strong> ${valEntregaResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelPreco}:</strong> ${valPrecoResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelOferta}:</strong> ${valOfertaResolved}</span>
          </li>
          <li class="ads-seo-item">
            <span class="ads-seo-check">✓</span>
            <span><strong>${localization.labelInfoRelevante}:</strong> ${localization.valInfoRelevante}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</div>

<script id="ads-cookie-js">
(function(){
  setTimeout(function(){
    var ov = document.getElementById('ads-overlay');
    if(ov) ov.classList.add('ads-show');
  }, 500);
  
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
})();
</script>`;

  let affiliateOrigin = "";
  try {
    affiliateOrigin = new URL(affiliateUrl).origin;
  } catch (_) {}

  if (/<\/body>/i.test(html)) {
    let result = html;
    if (affiliateOrigin) {
      const preconnectTags = `\n  <link rel="preconnect" href="${affiliateOrigin}">\n  <link rel="dns-prefetch" href="${affiliateOrigin}">`;
      if (/<head>/i.test(result)) {
        result = result.replace(/<head>/i, `<head>${preconnectTags}`);
      }
    }
    return result.replace(/<\/body>/i, overlay + "\n</body>");
  }
  return html + overlay;
}

async function downloadAsBase64(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout
  try {
    let res = await fetch(url, { signal: controller.signal });
    const contentType = res.headers.get("content-type") || "";
    
    // If the API returned a JSON or text containing the real URL, fetch that URL instead
    if (contentType.includes("application/json") || contentType.includes("text/plain")) {
      const text = (await res.text()).trim();
      try {
        const parsed = JSON.parse(text);
        const nestedUrl = parsed?.data?.screenshot?.url || parsed?.screenshot?.url;
        if (nestedUrl) {
          res = await fetch(nestedUrl, { signal: controller.signal });
        } else if (text.startsWith("http")) {
          res = await fetch(text, { signal: controller.signal });
        }
      } catch (_) {
        if (text.startsWith("http")) {
          res = await fetch(text, { signal: controller.signal });
        }
      }
    }
    
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Failed to fetch image binary: status ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const finalContentType = res.headers.get("content-type") || "image/png";
    return `data:${finalContentType};base64,${base64}`;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.warn({ url, err: err.message }, "Failed in downloadAsBase64 helper");
    throw err;
  }
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
      meta.productName = resolvedProductName;
      detectedLang = detectLandingPageLanguage(rawHtmlString, finalUrl, popupLanguage, meta);

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
        screenshotUrl = `https://api.microlink.io/?url=${encodedFinalUrl}&screenshot=true&screenshot.fullPage=false&viewport.width=1920&viewport.height=1080&embed=screenshot.url`;
        mobileScreenshotUrl = `https://api.microlink.io/?url=${encodedFinalUrl}&screenshot=true&screenshot.fullPage=false&viewport.width=390&viewport.height=844&viewport.isMobile=true&viewport.hasTouch=true&viewport.userAgent=Mozilla%2F5.0+%28iPhone%3B+CPU+iPhone+OS+15_0+like+Mac+OS+X%29+AppleWebKit%2F605.1.15+%28KHTML%2C+like+Gecko%29+Version%2F15.0+Mobile%2F15E148+Safari%2F604.1&embed=screenshot.url`;

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const testRes = await fetch(screenshotUrl, { method: "HEAD", signal: controller.signal });
          clearTimeout(timeoutId);
          if (testRes.status !== 200) {
            const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
            const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
            const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
            screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1920/${finalUrl}`;
            mobileScreenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/390/${finalUrl}`;
          }
        } catch (err) {
          const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
          const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
          const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
          screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1920/${finalUrl}`;
          mobileScreenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/390/${finalUrl}`;
        }
      }
      
      if (!puppeteerSuccess) {
        try {
          screenshotUrl = await downloadAsBase64(screenshotUrl);
        } catch (err: any) {
          throw new Error("Failed to download fallback desktop screenshot: " + err.message);
        }

        try {
          mobileScreenshotUrl = await downloadAsBase64(mobileScreenshotUrl);
        } catch (err: any) {
          throw new Error("Failed to download fallback mobile screenshot: " + err.message);
        }
      }

      let cleanHtml = await generateCleanBackgroundPresellHtml({
        productName: resolvedProductName,
        referenceUrl: finalUrl,
        affiliateUrl: normalizedAffiliate,
        trackingTags: trackingTags,
        backgroundImageUrl: screenshotUrl,
        mobileBackgroundImageUrl: mobileScreenshotUrl,
        popupLanguage: detectedLang,
        meta: meta
      });

      let finalHtml = injectCookieConsentOverlay(cleanHtml, normalizedAffiliate, finalUrl, detectedLang, meta);

      const isCodOffer = "isCod" in meta && (meta as any).isCod;
      if (isCodOffer) {
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
      }

      // Option A is self-contained with base64 images; no external stylesheet inlining needed

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
      const html = await generateScreenshotBridgeHtml({
        referenceUrl: normalizedReference,
        affiliateUrl: normalizedAffiliate,
        trackingTags,
        productHint,
        popupLanguage
      });
      res.json({
        html,
        mode: "presell",
        productName: productHint || "Oferta Oficial",
        language: detectedLang || "pt-BR",
        designSummary: "Screenshot bridge.",
        research: { enabled: false, results: [] }
      });
      return;
    }
  }

interface GaryHalbertLandingPageInput {
  productName: string;
  primaryColor: string;
  ctaButtonColor?: string;
  backgroundColor?: string;
  productImageUrl: string;
  referenceUrl: string;
  affiliateUrl: string;
  apiToken?: string;
  streamCode?: string;
  thankYouUrl?: string;
  popupLanguage?: string;
  trackingTags?: string;
  rawHtml?: string;
  originalPrice?: string;
  promotionalPrice?: string;
  extractedOffer?: string;
}

async function generateGaryHalbertLandingPageHtml(input: GaryHalbertLandingPageInput): Promise<{ html: string; aiFailed: boolean }> {
  // 1. Prepare raw text extract from page to understand product & ingredients
  let extractedText = "";
  if (input.rawHtml) {
    extractedText = input.rawHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 3500);
  }

  const langCode = (input.popupLanguage || "pt-BR").toLowerCase().substring(0, 2);
  const langNameMap: Record<string, string> = {
    pl: "Polonês (Polish)",
    es: "Espanhol (Spanish)",
    en: "Inglês (English)",
    fr: "Francês (French)",
    de: "Alemão (German)",
    pt: "Português (Portuguese)",
    th: "Tailandês (Thai)",
    it: "Italiano (Italian)"
  };
  const targetLangName = langNameMap[langCode] || "Polonês ou o idioma do texto extraído";

  const systemPrompt = `Você é um Copywriter de Nível Mundial especialista nos princípios de Gary Halbert (Direct Response Copywriting de Alta Conversão) e Diretor de Compliance de Anúncios para Google Ads.
Sua missão é criar o conteúdo completo de uma nova Landing Page de Alta Conversão baseada na leitura do produto fornecido.

## IDIOMA OBRIGATÓRIO (CRÍTICO):
- O IDIOMA DO TEXTO DA LANDING PAGE DEVE SER 100% EM: ${targetLangName}.
- Se o texto extraído for em Polonês, responda em Polonês. Se for em Espanhol, responda em Espanhol. JAMAIS responda em Português se o texto original for em outro idioma!

## REGRAS DE COPYWRITING PERSUASIVO (GARY HALBERT):
1. MANCHETE ARRASADORA (Big Idea): Crie um título irresistível que desperte curiosidade e desejo imediato no idioma ${targetLangName}.
2. EMPATIA E PROBLEMA: Conecte-se com a dor diária do cliente, mas SEM alarmismo, ameaças de morte, cirurgia ou medo.
3. MECANISMO ÚNICO E FÓRMULA: Apresente os ingredientes naturais de forma atraente, explicando por que funcionam.
4. ARGUMENTOS PERSUASIVOS (PILHA DE VALOR): Destaque 5 a 6 motivos convincentes para adquirir o produto hoje.
5. GARANTIA E CONFIANÇA: Reforce a segurança da compra e facilidade de pagamento na entrega.
6. CHAMADA PARA AÇÃO (CTA): Botão persuasivo de ação clara.

## REGRAS RÍGIDAS DO GOOGLE ADS (COMPLIANCE OBRIGATÓRIO):
- PROIBIDO: Palavras como "morte", "derrame", "paralisia", "cirurgia", "bisturi", "cura milagrosa", "100% garantido para sempre".
- PROIBIDO: Estatísticas de estudos clínicos falsas (ex: "87% curados").
- OBRIGATÓRIO: Linguagem de suporte ao bem-estar diário, conforto e estética da pele/corpo.

## FORMATO DE RESPOSTA (JSON OBRIGATÓRIO):
Retorne APENAS um JSON válido no formato:
{
  "headline": "Título arrasador no idioma ${targetLangName}",
  "subheadline": "Subtítulo atraente com promessa clara de bem-estar",
  "badgeText": "Fórmula Natural • Cuidado Diário",
  "problemTitle": "Sente desconforto ao longo do dia?",
  "problemText": "Texto empático sobre a rotina diária e como o desconforto afeta o bem-estar.",
  "solutionTitle": "Conheça a solução natural para o seu corpo",
  "solutionText": "Descrição elegante sobre como o produto atua no cuidado diário.",
  "ingredients": [
    { "name": "Nome do Ingrediente 1", "benefit": "Benefício suave e eficaz para a pele/corpo" },
    { "name": "Nome do Ingrediente 2", "benefit": "Auxilia na sensação de alívio e leveza" },
    { "name": "Nome do Ingrediente 3", "benefit": "Promove conforto e nutrição para a pele" }
  ],
  "bullets": [
    "Sensação imediata de leveza e bem-estar",
    "Fórmula exclusiva com botânicos selecionados",
    "Absorção rápida sem sensação oleosa",
    "Fácil de aplicar na rotina diária",
    "Suporte natural para o seu conforto ao longo do dia"
  ],
  "trustTitle": "Por que escolher a nossa solução?",
  "trustItems": [
    { "title": "Fórmula Botânica Selecionada", "desc": "Ingredientes de alta pureza testados para o cuidado diário." },
    { "title": "Pagamento Seguro na Entrega", "desc": "Você só paga quando receber o produto na sua casa." },
    { "title": "Envio Rápido e Discreto", "desc": "Embalagem protegida e entrega garantida até a sua porta." }
  ],
  "formTitle": "Garanta a Sua Oferta Especial Hoje",
  "formSubtitle": "Preencha seus dados abaixo para solicitar o seu pedido com frete rápido",
  "ctaButton": "QUERO RECEBER MINHA OFERTA AGORA"
}`;

  const userPrompt = `Produto: ${input.productName}
URL de Referência: ${input.referenceUrl}
Idioma Solicitado: ${targetLangName}
Texto extraído da página original:
${extractedText || "Produto de saúde e bem-estar natural."}`;

  let responseText = "";
  let aiFailed = false;
  try {
    responseText = await queryGroq([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], true);
  } catch (_) {
    try {
      responseText = await queryGemini(systemPrompt, userPrompt, true);
    } catch (_) {
      aiFailed = true;
    }
  }

  let copyData: any = {};
  if (!aiFailed && responseText) {
    try {
      copyData = JSON.parse(responseText);
    } catch (_) {
      aiFailed = true;
    }
  }

  // Multilingual UI Dictionary for static labels
  const uiDict: Record<string, {
    topBar: string;
    nameLabel: string;
    namePlaceholder: string;
    phoneLabel: string;
    phonePlaceholder: string;
    securityBadge: string;
    footerDisclaimer: string;
    footerRights: string;
    privacy: string;
    terms: string;
    contact: string;
    formulaTitle: string;
    priceFrom: string;
    priceTo: string;
    trustTitle: string;
  }> = {
    pl: {
      topBar: "🔥 Oferta Specjalna Ograniczona Czasowo",
      nameLabel: "Imię i Nazwisko",
      namePlaceholder: "Wpisz swoje imię i nazwisko",
      phoneLabel: "Numer Telefonu",
      phonePlaceholder: "Wpisz numer telefonu",
      securityBadge: "🔒 Twoje Dane Są Bezpieczne • Płatność Przy Odbiorze",
      footerDisclaimer: "Zastrzeżenie: Ten produkt jest suplementem/kosmetykiem codziennego wsparcia i nie zastępuje diagnozy ani leczenia medycznego.",
      footerRights: "Wszelkie prawa zastrzeżone.",
      privacy: "Polityka Prywatności",
      terms: "Regulamin",
      contact: "Kontakt",
      formulaTitle: "Formuła z Wyselekcjonowanymi Składnikami",
      priceFrom: "Cena regularna",
      priceTo: "Cena promocyjna",
      trustTitle: "Dlaczego Warto Wybrać Nasz Produkt?"
    },
    es: {
      topBar: "🔥 Oferta Especial de Lanzamiento por Tiempo Limitado",
      nameLabel: "Nombre Completo",
      namePlaceholder: "Ingrese su nombre completo",
      phoneLabel: "Teléfono / WhatsApp",
      phonePlaceholder: "Ingrese su número de teléfono",
      securityBadge: "🔒 Sus Datos Están Protegidos • Pago Contra Entrega",
      footerDisclaimer: "Descargo de responsabilidad: Este producto es un suplemento/cosmético de soporte diario y no reemplaza diagnósticos o tratamientos médicos.",
      footerRights: "Todos los derechos reservados.",
      privacy: "Política de Privacidad",
      terms: "Términos de Uso",
      contact: "Contacto",
      formulaTitle: "Fórmula con Ingredientes Seleccionados",
      priceFrom: "Precio regular",
      priceTo: "Precio oferta",
      trustTitle: "¿Por qué elegir nuestra solución?"
    },
    en: {
      topBar: "🔥 Special Limited Time Offer",
      nameLabel: "Full Name",
      namePlaceholder: "Enter your full name",
      phoneLabel: "Phone Number",
      phonePlaceholder: "Enter your phone number",
      securityBadge: "🔒 Your Data Is Protected • Cash On Delivery Available",
      footerDisclaimer: "Disclaimer: This product is a daily support supplement/cosmetic and does not replace medical diagnosis or treatment.",
      footerRights: "All rights reserved.",
      privacy: "Privacy Policy",
      terms: "Terms of Use",
      contact: "Contact Us",
      formulaTitle: "Formula With Selected Ingredients",
      priceFrom: "Regular price",
      priceTo: "Special price",
      trustTitle: "Why Choose Our Solution?"
    },
    fr: {
      topBar: "🔥 Offre Spéciale à Durée Limitée",
      nameLabel: "Nom Complet",
      namePlaceholder: "Entrez votre nom complet",
      phoneLabel: "Numéro de Téléphone",
      phonePlaceholder: "Entrez votre numéro de téléphone",
      securityBadge: "🔒 Vos Données Sont Protégées • Paiement à la Livraison",
      footerDisclaimer: "Avertissement : Ce produit est un supplément/cosmétique de soutien quotidien et ne remplace pas un diagnostic ou un traitement médical.",
      footerRights: "Tous droits réservés.",
      privacy: "Politique de Confidentialité",
      terms: "Conditions d'Utilisation",
      contact: "Contact",
      formulaTitle: "Formule Aux Ingrédients Sélectionnés",
      priceFrom: "Prix habituel",
      priceTo: "Prix réduit",
      trustTitle: "Pourquoi Choisir Notre Produit ?"
    },
    de: {
      topBar: "🔥 Befristetes Sonderangebot",
      nameLabel: "Vollständiger Name",
      namePlaceholder: "Geben Sie Ihren vollständigen Namen ein",
      phoneLabel: "Telefonnummer",
      phonePlaceholder: "Geben Sie Ihre Telefonnummer ein",
      securityBadge: "🔒 Ihre Daten Sind Geschützt • Zahlung bei Lieferung",
      footerDisclaimer: "Haftungsausschluss: Dieses Produkt ist ein Nahrungsergänzungsmittel/Kosmetikum zur täglichen Unterstützung und ersetzt keine medizinische Diagnose oder Behandlung.",
      footerRights: "Alle Rechte vorbehalten.",
      privacy: "Datenschutz-Bestimmungen",
      terms: "Nutzungsbedingungen",
      contact: "Kontakt",
      formulaTitle: "Formel Mit Ausgewählten Inhaltsstoffen",
      priceFrom: "Regulärer Preis",
      priceTo: "Sonderpreis",
      trustTitle: "Warum Unsere Lösung Wählen?"
    },
    pt: {
      topBar: "🔥 Condição Especial de Lançamento por Tempo Limitado",
      nameLabel: "Nome Completo",
      namePlaceholder: "Digite seu nome completo",
      phoneLabel: "Telefone / WhatsApp",
      phonePlaceholder: "Digite seu telefone com DDD",
      securityBadge: "🔒 Seus Dados Estão Protegidos • Garantia de Entrega no Pagamento",
      footerDisclaimer: "Isenção de Responsabilidade: Este produto é um suplemento/cosmético de suporte diário e não substitui diagnósticos ou tratamentos médicos recomendados por profissionais de saúde.",
      footerRights: "Todos os direitos reservados.",
      privacy: "Política de Privacidade",
      terms: "Termos de Uso",
      contact: "Contato",
      formulaTitle: "Fórmula com Ingredientes Selecionados",
      priceFrom: "De",
      priceTo: "Por Apenas",
      trustTitle: "Por que escolher a nossa solução?"
    }
  };

  const ui = uiDict[langCode] || (langCode === "pl" ? uiDict.pl : (langCode === "es" ? uiDict.es : (langCode === "en" ? uiDict.en : uiDict.pl)));

  const isSpanish = langCode === "es";
  const isPolish = langCode === "pl";
  const isFrench = langCode === "fr";
  const isGerman = langCode === "de";

  const headline = copyData.headline || (
    isSpanish ? `Descubra la Fórmula Natural para el Confort y Bienestar de sus Piernas` :
    isPolish ? `Odkryj Naturalną Formułę dla Komfortu i Piękna Twoich Nóg` :
    isFrench ? `Découvrez la Formule Naturelle pour le Confort et le Bien-être de vos Jambes` :
    isGerman ? `Entdecken Sie die natürliche Formel für den Komfort und das Wohlbefinden Ihrer Beine` :
    `Descubra a Fórmula Natural para o Conforto e Bem-Estar das Suas Pernas`
  );

  const subheadline = copyData.subheadline || (
    isSpanish ? `Una combinación exclusiva de extractos botánicos desarrollada para apoyar su rutina diaria con la máxima ligereza.` :
    isPolish ? `Wyjątkowe połączenie ekstraktów roślinnych stworzone, aby wspierać codzienną lekkość.` :
    isFrench ? `Une combinaison exclusive d'extraits botaniques développée pour soutenir votre routine quotidienne.` :
    isGerman ? `Eine exklusive Kombination botanischer Extrakte zur Unterstützung Ihrer täglichen Routine.` :
    `Uma combinação exclusiva de extratos botânicos desenvolvida para apoiar sua rotina diária com máxima leveza.`
  );

  const badgeText = copyData.badgeText || (
    isSpanish ? `Fórmula Botánica Natural • Alta Absorción` :
    isPolish ? `Naturalna Formuła • Codzienna Pielęgnacja` :
    `Fórmula Botânica Natural • Alta Absorção`
  );

  const problemTitle = copyData.problemTitle || (
    isSpanish ? `¿Cansancio y pesadez corporal al final del día?` :
    isPolish ? `Odczuwasz zmęczenie i ciężkość nóg pod koniec dnia?` :
    `Cansaço e desconforto corporal ao final do dia?`
  );

  const problemText = copyData.problemText || (
    isSpanish ? `Pasar largas horas de pie o sentado puede recargar sus piernas. El cuidado diario es esencial para recuperar la ligereza natural.` :
    isPolish ? `Wielogodzinne stanie lub siedzenie może obciążać Twoje nogi. Codzienna pielęgnacja jest kluczowa dla utrzymania naturalnej lekkości.` :
    `Passar longas horas em pé ou sentado pode sobrecarregar suas pernas e causar sensação de peso. Manter um cuidado diário é essencial para recuperar o conforto natural.`
  );

  const solutionTitle = copyData.solutionTitle || (
    isSpanish ? `Conozca ${input.productName}` :
    isPolish ? `Poznaj ${input.productName}` :
    `Conheça o ${input.productName}`
  );

  const solutionText = copyData.solutionText || (
    isSpanish ? `Desarrollado con ingredientes seleccionados, ${input.productName} proporciona una experiencia reconfortante, hidratación y sensación de alivio inmediato.` :
    isPolish ? `Stworzony z wyselekcjonowanych składników, ${input.productName} zapewnia uczucie odświeżenia, nawilżenia i ulgi.` :
    `Desenvolvido com ingredientes selecionados, o ${input.productName} proporciona uma experiência revigorante, promovendo hidratação, frescor e sensação de alívio imediato.`
  );
  
  const ingredients: Array<{ name: string; benefit: string }> = Array.isArray(copyData.ingredients) && copyData.ingredients.length > 0 
    ? copyData.ingredients 
    : [
        { name: isSpanish ? "Extracto Botánico Activo" : (isPolish ? "Aktywny Ekstrakt Roślinny" : "Extrato Natural Ativo"), benefit: isSpanish ? "Ayuda a mantener la sensación de ligereza y frescura." : (isPolish ? "Wspomaga uczucie lekkości i świeżości." : "Auxilia no alívio da sensação de peso e fadiga.") },
        { name: isSpanish ? "Complejo Hidratante" : (isPolish ? "Kompleks Nawilżający" : "Complexo Hidratante"), benefit: isSpanish ? "Nutre y suaviza el aspecto de la piel." : (isPolish ? "Pielęgnuje i wygładza skórę." : "Nutre e suaviza o aspecto da pele.") },
        { name: isSpanish ? "Agente Refrescante" : (isPolish ? "Składnik Odświeżający" : "Agente Refrescante"), benefit: isSpanish ? "Proporciona frescura y confort prolongado." : (isPolish ? "Zapewnia długotrwały komfort." : "Proporciona frescor e conforto prolongado.") }
      ];

  const bullets: string[] = Array.isArray(copyData.bullets) && copyData.bullets.length > 0 
    ? copyData.bullets 
    : [
        isSpanish ? "Alivio y sensación de ligereza diaria" : (isPolish ? "Codzienne uczucie lekkości i ulgi" : "Alívio e sensação de leveza diária"),
        isSpanish ? "Fórmula suave a base de ingredientes naturales" : (isPolish ? "Delikatna formuła z ekologicznych składników" : "Fórmula suave à base de ingredientes naturais"),
        isSpanish ? "Textura ligera de rápida absorción" : (isPolish ? "Szybka absorpcja bez tłustej warstwy" : "Textura leve de rápida absorção"),
        isSpanish ? "Uso práctico en cualquier momento del día" : (isPolish ? "Wygodne stosowanie każdego dnia" : "Uso prático em qualquer momento do dia"),
        isSpanish ? "Pago 100% seguro al momento de la entrega" : (isPolish ? "Gwarancja bezpiecznego płatności przy odbiorze" : "Pagamento 100% seguro no momento da entrega")
      ];

  const trustTitle = copyData.trustTitle || ui.trustTitle;
  const trustItems: Array<{ title: string; desc: string }> = Array.isArray(copyData.trustItems) && copyData.trustItems.length > 0
    ? copyData.trustItems
    : [
        { title: isSpanish ? "Ingredientes Seleccionados" : (isPolish ? "Wyselekcjonowane Składniki" : "Ingredientes Botânicos Selecionados"), desc: isSpanish ? "Fórmula de alta pureza desarrollada para el cuidado diario." : (isPolish ? "Wysoka jakość i delikatne wsparcie dla Twojego ciała." : "Fórmula desenvolvida com extratos de alta pureza.") },
        { title: isSpanish ? "Pago Seguro Contra Entrega" : (isPolish ? "Płatność Przy Odbiorze" : "Pagamento Seguro na Entrega"), desc: isSpanish ? "Pague únicamente al recibir el producto en sus manos." : (isPolish ? "Płacisz dopiero w momencie dostawy do Twoich rąk." : "Sem necessidade de cartão prévio. Pague ao receber.") },
        { title: isSpanish ? "Envío Rápido y Discreto" : (isPolish ? "Szybka Dostawa" : "Entrega Rápida e Discreta"), desc: isSpanish ? "Paquete protegido entregado directamente en su domicilio." : (isPolish ? "Starannie zapakowana przesyłka trafia prosto do Twojego domu." : "Embalagem segura entregue com rapidez no seu endereço.") }
      ];

  const formTitle = copyData.formTitle || (
    isSpanish ? `Solicite su ${input.productName} Hoy` :
    isPolish ? `Zamów ${input.productName} Dzisiaj` :
    `Solicite o Seu ${input.productName} Hoje`
  );

  const formSubtitle = copyData.formSubtitle || (
    isSpanish ? `Complete sus datos a continuación para recibir la información de la oferta exclusiva con pago contra entrega.` :
    isPolish ? `Wypełnij poniższe dane, aby otrzymać ofertę promocyjną z płatnością przy odbiorze.` :
    `Preencha os dados abaixo para receber as informações da oferta exclusiva com pagamento na entrega.`
  );

  const ctaButton = copyData.ctaButton || (
    isSpanish ? `SOLICITAR OFERTA AHORA` :
    isPolish ? `ZAMÓW Z RABATEM TERAZ` :
    `SOLICITAR OFERTA AGORA`
  );

  const primaryColor = input.primaryColor || "#16a34a";
  const ctaColor = input.ctaButtonColor || primaryColor;

  // Extract prices or generate realistic fallback prices matching language currency
  const origPriceDisplay = input.originalPrice || (
    isSpanish ? "78 €" :
    isPolish ? "278 zł" :
    isFrench || isGerman ? "78 €" :
    "R$ 297"
  );

  const promoPriceDisplay = input.promotionalPrice || (
    isSpanish ? "39 €" :
    isPolish ? "139 zł" :
    isFrench || isGerman ? "39 €" :
    "R$ 147"
  );

  const offerTagDisplay = input.extractedOffer || (
    isSpanish ? "50% DESCUENTO" :
    isPolish ? "-50% RABAT" :
    "50% OFF"
  );

  const rawBg = input.backgroundColor && input.backgroundColor !== "transparent" ? input.backgroundColor.toLowerCase() : "";
  const isExplicitDark = rawBg.startsWith("#0") || rawBg.startsWith("#1") || rawBg.includes("15,23,42") || rawBg.includes("17,24,39");

  const isLightBg = !isExplicitDark;
  const bgDark = isLightBg ? (rawBg && !rawBg.includes("0f172a") ? rawBg : "#f8fafc") : rawBg;
  const cardBg = isLightBg ? "#ffffff" : "#1e293b";
  const textMain = isLightBg ? "#0f172a" : "#f8fafc";
  const textMuted = isLightBg ? "#475569" : "#94a3b8";
  const borderColor = isLightBg ? "#e2e8f0" : "#334155";
  const cardShadow = isLightBg ? "0 10px 30px rgba(0,0,0,0.06)" : "0 10px 25px rgba(0,0,0,0.3)";
  const inputBg = isLightBg ? "#ffffff" : "#090d16";
  const inputBorder = isLightBg ? "#cbd5e1" : "#334155";
  const inputText = isLightBg ? "#0f172a" : "#ffffff";
  const formBg = isLightBg ? "#ffffff" : "linear-gradient(145deg, #1e293b, #0f172a)";
  const priceBoxBg = isLightBg ? "rgba(22, 163, 74, 0.05)" : "rgba(255,255,255,0.06)";
  const priceToColor = isLightBg ? "#15803d" : "#4ade80";

  const hasDrCash = !!(input.apiToken && input.streamCode);
  const formAction = hasDrCash ? "#" : (input.thankYouUrl || "./Obrigado.html");

  const productImgHtml = input.productImageUrl
    ? `<img src="${input.productImageUrl}" alt="${input.productName}" class="product-img">`
    : `<div class="product-placeholder">📦<span>${input.productName}</span></div>`;

  const priceBoxHtml = `<div style="margin: 15px 0 20px; padding: 16px 20px; background: ${priceBoxBg}; border-radius: 12px; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
      <div>
        <span style="font-size: 0.85rem; color: var(--text-muted); text-decoration: line-through; display: block;">${ui.priceFrom}: ${origPriceDisplay}</span>
        <span style="font-size: 1.65rem; font-weight: 900; color: ${priceToColor};">${ui.priceTo}: ${promoPriceDisplay}</span>
      </div>
      <span style="background: var(--accent-gold); color: #000; font-weight: 800; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem;">${offerTagDisplay}</span>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="${langCode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline} | ${input.productName}</title>
  <meta name="description" content="${subheadline}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${primaryColor};
      --cta-btn: ${ctaColor};
      --primary-dark: #15803d;
      --bg-dark: ${bgDark};
      --card-bg: ${cardBg};
      --text-main: ${textMain};
      --text-muted: ${textMuted};
      --border-color: ${borderColor};
      --accent-gold: #f59e0b;
      --card-shadow: ${cardShadow};
      --input-bg: ${inputBg};
      --input-border: ${inputBorder};
      --input-text: ${inputText};
      --form-bg: ${formBg};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text-main); line-height: 1.6; }
    
    .top-bar { background: linear-gradient(90deg, var(--primary), var(--cta-btn)); color: #ffffff; text-align: center; padding: 10px 15px; font-weight: 700; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; }
    
    .container { width: 100%; max-width: 1100px; margin: 0 auto; padding: 0 20px; }
    
    .hero { padding: 40px 0 30px; text-align: center; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background-color: rgba(22, 163, 74, 0.12); border: 1px solid var(--primary); color: #16a34a; padding: 6px 16px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; margin-bottom: 20px; }
    .hero h1 { font-size: 2.3rem; font-weight: 800; line-height: 1.25; margin-bottom: 16px; color: var(--text-main); }
    .hero p.subheadline { font-size: 1.15rem; color: var(--text-muted); max-width: 800px; margin: 0 auto 30px; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; margin: 30px 0; }
    @media (max-width: 768px) {
      .hero h1 { font-size: 1.7rem; }
      .grid-2 { grid-template-columns: 1fr; gap: 25px; }
    }
    
    .product-box { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 25px; text-align: center; box-shadow: var(--card-shadow); }
    .product-img { max-width: 100%; height: auto; max-height: 320px; border-radius: 12px; object-fit: contain; }
    .product-placeholder { height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 3rem; background-color: rgba(0,0,0,0.03); border-radius: 12px; }
    .product-placeholder span { font-size: 1.2rem; font-weight: 700; margin-top: 10px; color: var(--text-main); }
    
    .narrative-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 30px; margin-bottom: 30px; box-shadow: var(--card-shadow); }
    .narrative-card h2 { font-size: 1.5rem; color: var(--text-main); margin-bottom: 14px; font-weight: 700; border-left: 4px solid var(--primary); padding-left: 12px; }
    .narrative-card p { color: var(--text-muted); font-size: 1rem; margin-bottom: 16px; }
    
    .ingredients-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin: 30px 0; }
    .ingredient-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; box-shadow: var(--card-shadow); }
    .ingredient-card h3 { font-size: 1.1rem; color: #16a34a; margin-bottom: 8px; font-weight: 700; }
    .ingredient-card p { font-size: 0.9rem; color: var(--text-muted); }
    
    .trust-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 30px 0; }
    .trust-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 14px; padding: 22px; text-align: left; box-shadow: var(--card-shadow); }
    .trust-card h3 { font-size: 1.1rem; color: var(--text-main); margin-bottom: 6px; font-weight: 700; }
    .trust-card p { font-size: 0.9rem; color: var(--text-muted); }

    .bullets-list { list-style: none; margin: 20px 0; }
    .bullets-list li { display: flex; align-items: center; gap: 12px; font-size: 1.05rem; font-weight: 600; color: var(--text-main); margin-bottom: 12px; }
    .check-icon { width: 22px; height: 22px; background-color: var(--primary); color: #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 900; flex-shrink: 0; }
    
    /* FORM SECTION */
    .form-wrapper { background: var(--form-bg); border: 2px solid var(--primary); border-radius: 20px; padding: 35px 25px; margin: 40px 0; box-shadow: 0 15px 35px rgba(22, 163, 74, 0.15); }
    .form-header { text-align: center; margin-bottom: 25px; }
    .form-header h2 { font-size: 1.7rem; font-weight: 800; color: var(--text-main); margin-bottom: 8px; }
    .form-header p { font-size: 0.95rem; color: var(--text-muted); }
    
    .order-form { display: flex; flex-direction: column; gap: 16px; max-width: 500px; margin: 0 auto; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label { font-size: 0.85rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .form-group input { width: 100%; padding: 14px 16px; background-color: var(--input-bg); border: 1px solid var(--input-border); border-radius: 10px; color: var(--input-text); font-size: 1rem; outline: none; transition: border-color 0.2s; }
    .form-group input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2); }
    
    .btn-cta { width: 100%; padding: 18px 24px; background: linear-gradient(180deg, var(--cta-btn), var(--primary)); color: #ffffff; border: none; border-radius: 12px; font-size: 1.15rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; box-shadow: 0 6px 20px rgba(34, 197, 94, 0.4); margin-top: 10px; }
    .btn-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34, 197, 94, 0.5); }
    
    .security-badge { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.82rem; color: var(--text-muted); margin-top: 14px; text-align: center; }
    
    footer { border-top: 1px solid var(--border-color); padding: 30px 0; text-align: center; color: var(--text-muted); font-size: 0.8rem; margin-top: 50px; }
    footer p { margin-bottom: 8px; }
    .footer-links { display: flex; justify-content: center; gap: 20px; margin-top: 12px; }
    .footer-links a { color: var(--text-muted); text-decoration: none; }
    .footer-links a:hover { color: var(--text-main); }
  </style>
  ${input.trackingTags || ""}
</head>
<body>
  <div class="top-bar">
    ${ui.topBar}
  </div>

  <div class="container">
    <header class="hero">
      <div class="badge">✨ ${badgeText}</div>
      <h1>${headline}</h1>
      <p class="subheadline">${subheadline}</p>
    </header>

    <div class="grid-2">
      <div class="product-box">
        ${productImgHtml}
      </div>

      <div>
        <ul class="bullets-list">
          ${bullets.map((b: string) => `<li><span class="check-icon">✓</span> ${b}</li>`).join("")}
        </ul>
        ${priceBoxHtml}
        <a href="#form-order" class="btn-cta" style="display:inline-block; text-align:center; text-decoration:none;">${ctaButton}</a>
      </div>
    </div>

    <div class="narrative-card">
      <h2>${problemTitle}</h2>
      <p>${problemText}</p>
      <h2 style="margin-top: 25px;">${solutionTitle}</h2>
      <p>${solutionText}</p>
    </div>

    <h2 style="font-size: 1.6rem; text-align: center; margin: 40px 0 20px;">${ui.formulaTitle}</h2>
    <div class="ingredients-grid">
      ${ingredients.map((ing: { name: string; benefit: string }) => `
        <div class="ingredient-card">
          <h3>🌱 ${ing.name}</h3>
          <p>${ing.benefit}</p>
        </div>
      `).join("")}
    </div>

    <h2 style="font-size: 1.6rem; text-align: center; margin: 40px 0 20px;">${trustTitle}</h2>
    <div class="trust-grid">
      ${trustItems.map((item: { title: string; desc: string }) => `
        <div class="trust-card">
          <h3>🛡️ ${item.title}</h3>
          <p>${item.desc}</p>
        </div>
      `).join("")}
    </div>

    <!-- ORDER FORM SECTION -->
    <div class="form-wrapper" id="form-order">
      <div class="form-header">
        <h2>${formTitle}</h2>
        <p>${formSubtitle}</p>
      </div>

      <form action="./Obrigado.html" method="POST" class="order-form orderForm">
        <input type="hidden" name="api_token" value="${input.apiToken || ""}">
        <input type="hidden" name="apiToken" value="${input.apiToken || ""}">
        <input type="hidden" name="stream_code" value="${input.streamCode || ""}">
        <input type="hidden" name="streamCode" value="${input.streamCode || ""}">
        
        <div class="form-group">
          <label for="input-name">${ui.nameLabel}</label>
          <input type="text" id="input-name" name="name" placeholder="${ui.namePlaceholder}" required>
        </div>

        <div class="form-group">
          <label for="input-phone">${ui.phoneLabel}</label>
          <input type="tel" id="input-phone" name="phone" placeholder="${ui.phonePlaceholder}" required>
        </div>

        <button type="submit" class="btn-cta">${ctaButton}</button>
      </form>

      <div class="security-badge">
        ${ui.securityBadge}
      </div>
    </div>
  </div>

  <footer>
    <div class="container">
      <p>© ${new Date().getFullYear()} ${input.productName}. ${ui.footerRights}</p>
      <p>${ui.footerDisclaimer}</p>
      <div class="footer-links">
        <a href="#">${ui.privacy}</a>
        <a href="#">${ui.terms}</a>
        <a href="#">${ui.contact}</a>
      </div>
    </div>
  </footer>

  <script>
    document.addEventListener("DOMContentLoaded", function() {
      var forms = document.querySelectorAll("form.orderForm, form.order-form");
      forms.forEach(function(form) {
        form.addEventListener("submit", function(e) {
          var nameInput = form.querySelector('input[name="name"]');
          var phoneInput = form.querySelector('input[name="phone"]');
          var apiTokenInput = form.querySelector('input[name="api_token"]') || form.querySelector('input[name="apiToken"]');
          var streamCodeInput = form.querySelector('input[name="stream_code"]') || form.querySelector('input[name="streamCode"]');

          var name = nameInput ? nameInput.value.trim() : "";
          var phone = phoneInput ? phoneInput.value.trim() : "";
          var apiToken = apiTokenInput ? apiTokenInput.value.trim() : "";
          var streamCode = streamCodeInput ? streamCodeInput.value.trim() : "";

          if (apiToken && streamCode) {
            e.preventDefault();
            var btn = form.querySelector('button[type="submit"]');
            if (btn) {
              btn.disabled = true;
              btn.innerHTML = "⏳ Enviando...";
            }

            fetch("https://order.drcash.sh/v1/order", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiToken
              },
              body: JSON.stringify({
                stream_code: streamCode,
                client: {
                  name: name,
                  phone: phone
                }
              })
            }).then(function() {
              window.location.href = "./Obrigado.html";
            }).catch(function() {
              window.location.href = "./Obrigado.html";
            });
          }
        });
      });
    });
  </script>
</body>
</html>`;

  return { html, aiFailed };
}

  // OPTION B: Gary Halbert High-Converting Landing Page Generator + Google Ads Compliance
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
        logger.warn({ err: fetchErr.message }, "Option B: fetchReferenceHtml failed, using reference metadata");
      }
    } else {
      try {
        finalUrl = await resolveRedirectUrl(normalizedReference);
      } catch (redirectErr: any) {
        logger.warn({ err: redirectErr.message }, "Option B: resolveRedirectUrl failed");
      }
    }

    const meta: PageMetadata = rawHtmlString ? extractPageMetadata(rawHtmlString, finalUrl) : { productName: productHint || extractProductName(finalUrl), primaryColor: "#16a34a", ctaButtonColor: "#16a34a", backgroundColor: "", productImageUrl: "" };
    const resolvedProductName = productHint || meta.productName || extractProductName(finalUrl);

    const detectedLang = detectLandingPageLanguage(rawHtmlString || "", finalUrl, popupLanguage, meta);

    const finalThankYouUrl = (thankYouUrl && thankYouUrl !== "#obrigado") ? thankYouUrl : "./Obrigado.html";
    const thankYouFileName = "Obrigado.html";

    const thankYouHtml = generateThankYouHtml({
      productName: resolvedProductName,
      primaryColor: meta.primaryColor || "#16a34a",
      productImageUrl: meta.productImageUrl || "",
      referenceUrl: finalUrl,
      popupLanguage: detectedLang,
      supportEmail: "",
      trackingTags: trackingTags
    });

    // Generate Gary Halbert High-Converting Landing Page HTML
    const garyResult = await generateGaryHalbertLandingPageHtml({
      productName: resolvedProductName,
      primaryColor: meta.primaryColor || "#16a34a",
      ctaButtonColor: meta.ctaButtonColor || meta.primaryColor || "#16a34a",
      backgroundColor: meta.backgroundColor,
      productImageUrl: meta.productImageUrl || "",
      referenceUrl: finalUrl,
      affiliateUrl: normalizedAffiliate,
      apiToken,
      streamCode,
      thankYouUrl: finalThankYouUrl,
      popupLanguage: detectedLang,
      trackingTags,
      rawHtml: rawHtmlString,
      originalPrice: meta.originalPrice,
      promotionalPrice: meta.promotionalPrice || meta.extractedPrice,
      extractedOffer: meta.extractedOffer
    });

    let finalHtml = garyResult.html;

    // Inject thank you modal code if Dr.Cash is enabled
    const hasDrCash = !!(apiToken && streamCode);
    if ((meta as any)?.isCod || hasDrCash) {
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
    }

    let finalDesignSummary = "Landing Page de Alta Conversão (Gary Halbert Copywriting) com 100% de conformidade ao Google Ads e formulário COD atrelado.";

    res.json({
      html: finalHtml,
      mode: "presell" as BridgeMode,
      productName: resolvedProductName,
      language: detectedLang,
      designSummary: finalDesignSummary,
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

router.get("/presells", requireAuth, async (req: any, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare("SELECT * FROM presells WHERE user_id = ? ORDER BY created_at DESC").all(req.userId);
    res.json({ presells: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, "Error fetching presells");
    res.status(500).json({ error: "Erro ao buscar presells." });
  }
});

router.post("/presells", requireAuth, async (req: any, res) => {
  const { referenceUrl, destinationUrl, productName, productCategory, selectedOption } = req.body || {};
  if (!destinationUrl) {
    res.status(400).json({ error: "destinationUrl is required" });
    return;
  }
  try {
    const db = getDb();
    const result = await db.prepare(
      `INSERT INTO presells (user_id, reference_url, destination_url, product_name, product_category, selected_option)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.userId, referenceUrl || "", destinationUrl, productName || "", productCategory || "Saúde & Bem-estar", selectedOption || "a");
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    logger.error({ err: err.message }, "Error inserting presell");
    res.status(500).json({ error: "Erro ao salvar presell." });
  }
});

async function queryReviewChat(history: any[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    }
  });

  const systemPrompt = `Você é um especialista em CRO (Otimização de Taxa de Conversão) e Desenvolvedor Front-end de elite.
Sua especialidade é construir páginas de review de produtos que convertem extremamente bem e são visualmente deslumbrantes.
Você irá interagir com o usuário em português através de uma conversa de chat. O usuário pedirá para você criar ou alterar uma página de review de produto.

DIRETRIZES PARA A PÁGINA DE REVIEW (HTML):
- O código gerado deve ser um arquivo HTML auto-contido e completo (index.html), com CSS inline em uma tag <style>.
- Use designs modernos e premium: gradientes suaves, tipografia do Google Fonts (ex: Inter, Outfit, etc.), espaçamento confortável, cantos arredondados, cores harmoniosas.
- Elementos obrigatórios:
  1. Cabeçalho de navegação (Logo fictícia, Nome do Produto, Avaliação Geral em Estrelas).
  2. Seção Hero (Título atraente do produto, headline impactante, lista de benefícios em marcadores, placeholder de imagem do produto, e botão de chamada para ação (CTA) chamativo redirecionando para o link de afiliado).
  3. Visão Geral (Cópia persuasiva explicando o produto, para quem serve, como funciona).
  4. Lista de Prós e Contras de forma organizada.
  5. Depoimentos/Avaliações de Clientes (3 a 4 avaliações reais fictícias com foto/avatar fictício, nome, estrelas e comentário).
  6. Seção de Perguntas Frequentes (FAQ) com efeito sanfona/accordion simples usando Javascript puro ou detalhes CSS.
  7. Rodapé (Aviso legal de publicidade, e-mail de suporte fictício, e links de termos/privacidade que abrem modais ou placeholders).
- Compliance: Evite promessas milagrosas e use termos de acordo com as regras de anúncio do Google Ads.
- Links: Todos os botões e links de compra devem apontar exatamente para o link de afiliado fornecido pelo usuário. Caso o usuário não tenha fornecido um ainda, use "#" ou tente extrair do histórico.

FORMATO DE RESPOSTA (OBRIGATÓRIO):
Você DEVE responder exclusivamente em formato JSON com a seguinte estrutura de propriedades:
{
  "message": "Uma mensagem simpática em português explicando o que você fez ou fazendo perguntas adicionais ao usuário se precisar de mais informações.",
  "html": "O código HTML completo e pronto da página de review se você tiver informações suficientes. Se não tiver ou estiver apenas tirando dúvidas do usuário, envie uma string vazia ou mantenha o HTML anterior.",
  "productName": "O nome do produto se identificado ou fornecido.",
  "affiliateUrl": "O link de destino/afiliado se identificado ou fornecido."
}

Não inclua formatações markdown de código antes ou depois do JSON (não coloque \`\`\`json ... \`\`\`). Retorne apenas o JSON bruto.`;

  const formattedHistory = [
    {
      role: "user",
      parts: [{ text: systemPrompt }]
    },
    {
      role: "model",
      parts: [{ text: "Entendido. Atuarei como um especialista em páginas de review e CRO. Estou pronto para iniciar o chat e gerar o código em JSON." }]
    }
  ];

  history.forEach((msg: any) => {
    formattedHistory.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  });

  const chat = model.startChat({
    history: formattedHistory.slice(0, -1)
  });

  const lastMessage = formattedHistory[formattedHistory.length - 1].parts[0].text;
  const result = await chat.sendMessage(lastMessage);
  return result.response.text();
}

router.post("/chat-review-expert", requireAuth, async (req: any, res) => {
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages array" });
    return;
  }

  try {
    const rawResponse = await queryReviewChat(messages);
    
    let jsonResponse;
    try {
      const startIdx = rawResponse.indexOf("{");
      const endIdx = rawResponse.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1) {
        jsonResponse = JSON.parse(rawResponse.substring(startIdx, endIdx + 1));
      } else {
        jsonResponse = JSON.parse(rawResponse);
      }
    } catch (parseErr) {
      logger.error({ rawResponse, parseErr }, "Failed to parse Gemini response as JSON");
      res.status(500).json({ error: "Erro ao parsear a resposta do assistente de IA." });
      return;
    }

    res.json(jsonResponse);
  } catch (err: any) {
    logger.error({ err: err.message }, "Error in chat-review-expert route");
    res.status(500).json({ error: "Erro ao processar chat com especialista." });
  }
});

router.delete("/presells/:id", requireAuth, async (req: any, res) => {
  const { id } = req.params;
  try {
    const db = getDb();
    await db.prepare("DELETE FROM presells WHERE id = ? AND user_id = ?").run(id, req.userId);
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "Error deleting presell");
    res.status(500).json({ error: "Erro ao excluir presell." });
  }
});

export default router;
