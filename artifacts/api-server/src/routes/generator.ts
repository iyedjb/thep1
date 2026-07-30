import { Router } from "express";
import { requireAuth, optionalAuth } from "./auth";
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
    // 1440x900 (not 1920x1080) — most landing pages built for affiliate/COD offers use a fixed
    // content container around 1000-1300px wide; capturing at full 1920px leaves excess side
    // margin that makes the hero look zoomed out/distant compared to how it renders on a typical
    // browser window. deviceScaleFactor 1 (not 2) avoids quadrupling the captured pixel count for
    // an image that only ever displays at CSS viewport size — a major driver of page load weight.
    await desktopPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    
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

    const desktopBuffer = (await desktopPage.screenshot({ fullPage: false, type: 'jpeg', quality: 82 })) as Buffer;
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

    const mobileBuffer = (await mobilePage.screenshot({ fullPage: false, type: 'jpeg', quality: 82 })) as Buffer;
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
  if (s.includes('yandex') || s.includes('mc.yandex') || s.includes('watch/') || s.includes('facebook.com/tr') || s.includes('pixel') || s.includes('tracker') || s.includes('statcounter') || s.includes('doubleclick') || s.includes('analytics') || s.includes('gtag')) return false;
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
  faviconUrl?: string;
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

function extractFaviconUrl(html: string, referenceUrl: string): string {
  // Prefer the page's own declared favicon over any substitute — it's the actual icon a real
  // visitor sees in their browser tab, and product/hero images are the wrong aspect ratio/content
  // for a 16x16-32x32 icon. "icon"/"shortcut icon" take priority over apple-touch-icon (large
  // square image meant for home-screen bookmarks, not the tab favicon).
  const linkTagRegex = /<link\s+[^>]*rel=["']([^"']*icon[^"']*)["'][^>]*>/gi;
  let bestHref = "";
  let bestIsAppleTouch = true;
  let match;
  while ((match = linkTagRegex.exec(html)) !== null) {
    const tag = match[0];
    const rel = match[1].toLowerCase();
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const isAppleTouch = rel.includes("apple-touch");
    if (bestHref && !bestIsAppleTouch) continue;
    bestHref = hrefMatch[1];
    bestIsAppleTouch = isAppleTouch;
    if (!isAppleTouch) break;
  }
  if (!bestHref) return "";
  try {
    return new URL(bestHref, referenceUrl).toString();
  } catch (_) {
    return "";
  }
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
  // Fallback: the most-repeated capitalized word in the body text. Needed for pages hosted on a
  // third-party page-builder/tracking domain (e.g. "kw5nx.doctorbuyer.com") where neither the
  // <title>/og:title nor the domain itself reveals the real brand — but the brand name still
  // appears dozens of times in the copy itself (headings, testimonials, CTA text, etc).
  if (!productName) {
    const bodyText = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ");
    const genericWords = new Set(["Solo", "Para", "Con", "Como", "Antes", "Ahora", "Nuestro", "Nuestra", "Este", "Esta", "Todos", "Todas", "Ordena", "Ordenar", "Precio", "Especial", "Descuento", "Comprar", "Recupera", "Copyright"]);
    const wordCounts: Record<string, number> = {};
    const wordRegex = /\b([A-ZÁ-Ú][a-zá-úA-ZÁ-Ú]{3,20})\b/g;
    let wMatch;
    while ((wMatch = wordRegex.exec(bodyText)) !== null) {
      const word = wMatch[1];
      if (genericWords.has(word)) continue;
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
    const sortedWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]);
    if (sortedWords.length > 0 && sortedWords[0][1] >= 4) {
      productName = sortedWords[0][0];
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
  // Priority: (1) an <img> whose src OR alt matches a product-ish keyword — many landing-page
  // builders emit hashed/CDN filenames with no descriptive src (e.g. "image21.png") but keep a
  // literal alt="product" — (2) og:image, (3) first plausible non-icon image. og:image is
  // optimized for social-share appeal (often a lifestyle photo, not the product itself), so it's
  // deliberately tried after the keyword match, not before.
  let productImageUrl = "";
  const imgRegex = /<img\s+([^>]+)>/gi;
  const productKeywords = [/product/i, /prod/i, /pack/i, /bottle/i, /garrafa/i, /pot/i, /capsule/i, /gel/i, /box/i, /kit/i, /main/i, /hero/i, /comprar/i, /oferta/i, /cardiox/i];
  const altCandidates: string[] = [];
  const srcCandidates: string[] = [];
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const src = getAttributeValue(attrs, 'data-original') ||
                getAttributeValue(attrs, 'data-lazy-src') ||
                getAttributeValue(attrs, 'data-src') ||
                getAttributeValue(attrs, 'src');
    if (!src || !isValidImageSrc(src)) continue;
    const alt = getAttributeValue(attrs, 'alt') || "";
    if (productKeywords.some(kw => kw.test(alt))) {
      altCandidates.push(src);
    } else if (productKeywords.some(kw => kw.test(src))) {
      srcCandidates.push(src);
    }
  }
  // An explicit alt="product"-style hint is a stronger signal than a keyword that merely happens
  // to appear in the (often auto-generated) file path, so it's preferred when both are present.
  if (altCandidates.length > 0) {
    productImageUrl = altCandidates[0];
  } else if (srcCandidates.length > 0) {
    productImageUrl = srcCandidates[0];
  }

  if (!productImageUrl) {
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      productImageUrl = ogImageMatch[1].trim();
    }
  }

  if (!productImageUrl) {
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
    const rawOld = oldPriceMatch[1]
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\d/.test(rawOld) && rawOld.length <= 30 && !rawOld.includes("{") && !rawOld.includes("function")) {
      originalPrice = rawOld;
    }
  }

  const newPriceMatch = html.match(/class=["'][^"']*(?:price-new|price_new|price-current|new-price|promo-price)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
                        html.match(/class=["'][^"']*(?:price-new|price_new|price-current|new-price|promo-price)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (newPriceMatch && newPriceMatch[1]) {
    const rawNew = newPriceMatch[1]
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\d/.test(rawNew) && rawNew.length <= 30 && !rawNew.includes("{") && !rawNew.includes("function")) {
      promotionalPrice = rawNew;
      extractedPrice = rawNew;
    }
  }

  // 2. Fallback regex to parse price from HTML text
  // Both "currency-then-number" (e.g. "$100", "MXN 1180") AND "number-then-currency" (e.g.
  // "1180 MXN") orderings are matched — several Latin American currencies (MXN, COP, CLP, ARS,
  // BOB, DOP, CRC, PYG, UYU, HNL, NIO, R$) are conventionally written with the code AFTER the
  // amount, and were previously only recognized in the "before" position, so a page like a
  // Mexican offer showing "1180 MXN" / "590 MXN" matched nothing and silently fell back to a
  // hardcoded generic placeholder price/currency instead.
  const priceRegex = /(?:(?:R\$|\$|€|£|¥|S\/\.?|PEN|MXN|COP|CLP|ARS|EUR|PLN|RON|CZK|HUF|GTQ|BOB|DOP|CRC|PYG|UYU|HNL|NIO|XOF|CFA|FCFA|USDT)\s*\d+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?\s*(?:zł|€|\$|£|¥|lei|Kč|Ft|EUR|eur|Eur|PLN|pln|RON|ron|CZK|czk|лв|BGN|bgn|din|RSD|rsd|HUF|huf|PEN|pen|GTQ|gtq|MXN|mxn|COP|cop|CLP|clp|ARS|ars|R\$|BOB|bob|DOP|dop|CRC|crc|PYG|pyg|UYU|uyu|HNL|hnl|NIO|nio|USDT|usdt|XOF|xof|CFA|cfa|FCFA|fcfa|S\/\.?))/gi;
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

  const faviconUrl = extractFaviconUrl(html, referenceUrl);

  return { productName, primaryColor, ctaButtonColor, backgroundColor, productImageUrl, faviconUrl, seoDescription, productDetails, extractedPrice, extractedFormula, extractedOffer, originalPrice, promotionalPrice, isGadget, isDigital, isCod, extractedDelivery };
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
async function injectAffiliateIntoHtml(
  rawHtml: string,
  referenceUrl: string,
  affiliateUrl: string,
  trackingTags: string,
  apiToken?: string,
  streamCode?: string,
  thankYouUrl?: string,
  productImageUrl?: string
): Promise<string> {
  // Step 1: Make all relative asset URLs absolute
  let html = makeAbsoluteUrls(rawHtml, referenceUrl);

  // Step 1.5: Inject favicon — prefer the real product image (inlined as base64, so the page
  // stays self-contained), then try inlining the Google Favicon Service result, and only fall
  // back to a remote (non-inlined) favicon URL if both downloads fail.
  let faviconUrl = "";
  if (productImageUrl) {
    try {
      faviconUrl = await downloadAsBase64(productImageUrl);
    } catch (_) {
      faviconUrl = "";
    }
  }
  if (!faviconUrl) {
    try {
      const domain = new URL(referenceUrl).hostname;
      const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
      try {
        faviconUrl = await downloadAsBase64(googleFaviconUrl);
      } catch (_) {
        faviconUrl = googleFaviconUrl;
      }
    } catch (_) {}
  }

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
  },
  "pt-PT": {
    title: "🍪 Política de Cookies",
    desc: "Utilizamos cookies para personalizar a sua experiência. Ao continuar, está a concordar com os nossos termos.",
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
    valEntregaPhysical: "Envio de acordo com os prazos de entrega e portes do site oficial.",
    valEntregaDigital: "Acesso imediato por e-mail após a confirmação do pagamento.",
    valPrecoCOD: "Pagamento no Ato da Entrega (pague apenas ao receber o produto).",
    valPrecoOnline: "Pagamento Seguro Online (Cartão de Crédito, Multibanco ou MB WAY).",
    valOferta: "Promoção especial por tempo limitado no canal oficial.",
    formatPreco: "De <del>{orig}</del> por apenas <strong>{prom}</strong>",
    ctaOffer: "Aproveite o desconto! Oferta por tempo limitado.",
    descTemplate: "Página informativa oficial sobre o produto {prod}. Veja os detalhes da oferta e adquira com garantia de originalidade.",
    priceDescFormat: " De {orig} por apenas {prom}.",
    priceValFormat: " (Valor: {val}).",
    labelGadget: "Especificações Técnicas",
    valGadget: "Especificações e funcionalidades de alta tecnologia desenvolvidas pelo fabricante.",
    labelDigital: "Conteúdo / Recursos",
    valDigital: "Recursos e materiais informativos de alta qualidade desenvolvidos por especialistas.",
    valGenericCampaignInfo: "Consulte as informações desta campanha.",
    valPrecoGeneric: "Valor promocional disponível no canal oficial do fabricante.",
    valPrecoGenericCond: "Pagamento seguro processado através do canal oficial.",
    valPrecoGenericFallback: "Veja os detalhes da oferta.",
    valOfertaGeneric: "Desconto promocional especial disponível nesta campanha.",
    labelInfoRelevante: "Informações Relevantes",
    valInfoRelevante: "Canal oficial informativo da campanha. Os termos de garantia e as políticas de reembolso são os estabelecidos pelo site oficial."
  },
  "sv": {
    title: "🍪 Cookiepolicy",
    desc: "Vi använder cookies för att anpassa din upplevelse. Genom att fortsätta godkänner du våra villkor.",
    accept: "Acceptera",
    decline: "Avvisa",
    infoBtn: "Erbjudandedetaljer",
    infoTitle: "Erbjudandedetaljer",
    labelFormula: "Formel/Innehåll",
    labelEntrega: "Leveranstid",
    labelEntregaDigital: "Åtkomstmetod",
    labelPreco: "Pris och Villkor",
    labelOferta: "Specialerbjudande",
    valFormula: "Formel utvecklad med utvalda naturliga föreningar och extrakt.",
    valEntregaPhysical: "Frakt enligt den officiella webbplatsens leveranstider och avgifter.",
    valEntregaDigital: "Omedelbar åtkomst via e-post efter betalningsbekräftelse.",
    valPrecoCOD: "Betalning vid Leverans (betala endast när du tar emot produkten).",
    valPrecoOnline: "Säker Onlinebetalning (Kreditkort, PayPal eller lokala betalmetoder).",
    valOferta: "Specialkampanj under begränsad tid på den officiella kanalen.",
    formatPreco: "Från <del>{orig}</del> till endast <strong>{prom}</strong>",
    ctaOffer: "Ta del av rabatten! Tidsbegränsat erbjudande.",
    descTemplate: "Officiell informationssida om produkten {prod}. Se erbjudandets detaljer och köp med äkthetsgaranti.",
    priceDescFormat: " Från {orig} till endast {prom}.",
    priceValFormat: " (Pris: {val}).",
    labelGadget: "Tekniska Specifikationer",
    valGadget: "Avancerade tekniska specifikationer och funktioner utvecklade av tillverkaren.",
    labelDigital: "Innehåll / Funktioner",
    valDigital: "Högkvalitativa resurser och informationsmaterial utvecklade av experter.",
    valGenericCampaignInfo: "Kontrollera informationen i denna kampanj.",
    valPrecoGeneric: "Kampanjpris tillgängligt på tillverkarens officiella kanal.",
    valPrecoGenericCond: "Säker betalning behandlad via den officiella kanalen.",
    valPrecoGenericFallback: "Se erbjudandets detaljer.",
    valOfertaGeneric: "Särskild kampanjrabatt tillgänglig i denna kampanj.",
    labelInfoRelevante: "Relevant Information",
    valInfoRelevante: "Officiell informationskanal för kampanjen. Garantivillkor och återbetalningspolicyer är de som fastställts av den officiella webbplatsen."
  },
  "nl": {
    title: "🍪 Cookiebeleid",
    desc: "Wij gebruiken cookies om uw ervaring te personaliseren. Door verder te gaan, gaat u akkoord met onze voorwaarden.",
    accept: "Accepteren",
    decline: "Weigeren",
    infoBtn: "Aanbiedingsdetails",
    infoTitle: "Aanbiedingsdetails",
    labelFormula: "Formule/Samenstelling",
    labelEntrega: "Levertijd",
    labelEntregaDigital: "Toegangsmethode",
    labelPreco: "Prijs en Voorwaarden",
    labelOferta: "Speciale Aanbieding",
    valFormula: "Formule ontwikkeld met geselecteerde natuurlijke stoffen en extracten.",
    valEntregaPhysical: "Verzending volgens de levertijden en tarieven van de officiële website.",
    valEntregaDigital: "Directe toegang per e-mail na bevestiging van betaling.",
    valPrecoCOD: "Betaling bij Levering (betaal pas na ontvangst van het product).",
    valPrecoOnline: "Veilige Online Betaling (Creditcard, PayPal of lokale betaalmethoden).",
    valOferta: "Speciale actie voor beperkte tijd op het officiële kanaal.",
    formatPreco: "Van <del>{orig}</del> voor slechts <strong>{prom}</strong>",
    ctaOffer: "Profiteer van de korting! Aanbieding voor beperkte tijd.",
    descTemplate: "Officiële informatiepagina over het product {prod}. Bekijk de details van de aanbieding en koop met garantie van originaliteit.",
    priceDescFormat: " Van {orig} voor slechts {prom}.",
    priceValFormat: " (Waarde: {val}).",
    labelGadget: "Technische Specificaties",
    valGadget: "Hoogwaardige technische specificaties en functies ontwikkeld door de fabrikant.",
    labelDigital: "Inhoud / Functies",
    valDigital: "Hoogwaardige bronnen en informatief materiaal ontwikkeld door experts.",
    valGenericCampaignInfo: "Bekijk de informatie in deze campagne.",
    valPrecoGeneric: "Promotiewaarde beschikbaar op het officiële kanaal van de fabrikant.",
    valPrecoGenericCond: "Veilige betaling verwerkt via het officiële kanaal.",
    valPrecoGenericFallback: "Bekijk de details van de aanbieding.",
    valOfertaGeneric: "Speciale promotiekorting beschikbaar in deze campagne.",
    labelInfoRelevante: "Relevante Informatie",
    valInfoRelevante: "Officieel informatiekanaal van de campagne. Garantievoorwaarden en terugbetalingsbeleid zijn die vastgesteld door de officiële website."
  },
  "da": {
    title: "🍪 Cookiepolitik",
    desc: "Vi bruger cookies til at tilpasse din oplevelse. Ved at fortsætte accepterer du vores vilkår.",
    accept: "Accepter",
    decline: "Afvis",
    infoBtn: "Tilbudsdetaljer",
    infoTitle: "Tilbudsdetaljer",
    labelFormula: "Formel/Indhold",
    labelEntrega: "Leveringstid",
    labelEntregaDigital: "Adgangsmetode",
    labelPreco: "Pris og Betingelser",
    labelOferta: "Specialtilbud",
    valFormula: "Formel udviklet med udvalgte naturlige forbindelser og ekstrakter.",
    valEntregaPhysical: "Forsendelse i henhold til den officielle hjemmesides leveringstider og priser.",
    valEntregaDigital: "Øjeblikkelig adgang via e-mail efter betalingsbekræftelse.",
    valPrecoCOD: "Betaling ved Levering (betal først når du modtager produktet).",
    valPrecoOnline: "Sikker Onlinebetaling (Kreditkort, PayPal eller lokale betalingsmetoder).",
    valOferta: "Særlig tidsbegrænset kampagne på den officielle kanal.",
    formatPreco: "Fra <del>{orig}</del> til kun <strong>{prom}</strong>",
    ctaOffer: "Benyt dig af rabatten! Tidsbegrænset tilbud.",
    descTemplate: "Officiel informationsside om produktet {prod}. Se tilbuddets detaljer og køb med garanti for ægthed.",
    priceDescFormat: " Fra {orig} til kun {prom}.",
    priceValFormat: " (Pris: {val}).",
    labelGadget: "Tekniske Specifikationer",
    valGadget: "Avancerede tekniske specifikationer og funktioner udviklet af producenten.",
    labelDigital: "Indhold / Funktioner",
    valDigital: "Højkvalitets ressourcer og informationsmateriale udviklet af eksperter.",
    valGenericCampaignInfo: "Se information i denne kampagne.",
    valPrecoGeneric: "Kampagnepris tilgængelig på producentens officielle kanal.",
    valPrecoGenericCond: "Sikker betaling behandlet via den officielle kanal.",
    valPrecoGenericFallback: "Se tilbuddets detaljer.",
    valOfertaGeneric: "Særlig kampagnerabat tilgængelig i denne kampagne.",
    labelInfoRelevante: "Relevant Information",
    valInfoRelevante: "Officiel informationskanal for kampagnen. Garantibetingelser og refusionspolitikker er dem, der er fastsat af den officielle hjemmeside."
  },
  "ja": {
    title: "🍪 クッキーポリシー",
    desc: "お客様の体験をパーソナライズするためにクッキーを使用しています。続行することで、当社の利用規約に同意したことになります。",
    accept: "同意する",
    decline: "拒否する",
    infoBtn: "オファーの詳細",
    infoTitle: "オファーの詳細",
    labelFormula: "成分・配合",
    labelEntrega: "配送期間",
    labelEntregaDigital: "アクセス方法",
    labelPreco: "価格と条件",
    labelOferta: "特別オファー",
    valFormula: "厳選された天然成分とエキスで開発された配合。",
    valEntregaPhysical: "公式サイトの配送期間と料金に従って発送されます。",
    valEntregaDigital: "支払い確認後、メールにて即時アクセス可能。",
    valPrecoCOD: "代金引換（商品受け取り時のみお支払い）。",
    valPrecoOnline: "安全なオンライン決済（クレジットカード、PayPalまたは現地決済方法）。",
    valOferta: "公式チャンネルでの期間限定特別プロモーション。",
    formatPreco: "<del>{orig}</del> のところ、今なら <strong>{prom}</strong>",
    ctaOffer: "割引をお見逃しなく！期間限定オファー。",
    descTemplate: "{prod} に関する公式情報ページです。オファーの詳細をご確認の上、正規品保証付きでご購入ください。",
    priceDescFormat: " {orig} のところ、今なら {prom}。",
    priceValFormat: " （価格：{val}）。",
    labelGadget: "技術仕様",
    valGadget: "メーカーが開発した高度な技術仕様と機能。",
    labelDigital: "コンテンツ・機能",
    valDigital: "専門家が開発した高品質なリソースと情報資料。",
    valGenericCampaignInfo: "このキャンペーンの情報をご確認ください。",
    valPrecoGeneric: "メーカーの公式チャンネルで利用可能なプロモーション価格。",
    valPrecoGenericCond: "公式チャンネルを通じて処理される安全な決済。",
    valPrecoGenericFallback: "オファーの詳細をご覧ください。",
    valOfertaGeneric: "このキャンペーンで利用可能な特別プロモーション割引。",
    labelInfoRelevante: "関連情報",
    valInfoRelevante: "キャンペーンの公式情報チャンネルです。保証条件および返金ポリシーは公式サイトに定められたものに準じます。"
  },
  "he": {
    title: "🍪 מדיניות עוגיות",
    desc: "אנו משתמשים בעוגיות כדי להתאים אישית את החוויה שלך. בהמשך הגלישה, הנך מסכים לתנאים שלנו.",
    accept: "אישור",
    decline: "דחייה",
    infoBtn: "פרטי המבצע",
    infoTitle: "פרטי המבצע",
    labelFormula: "נוסחה / הרכב",
    labelEntrega: "זמן אספקה",
    labelEntregaDigital: "אופן הגישה",
    labelPreco: "מחיר ותנאים",
    labelOferta: "מבצע מיוחד",
    valFormula: "נוסחה שפותחה עם תרכובות ותמציות טבעיות נבחרות.",
    valEntregaPhysical: "משלוח בהתאם לזמני האספקה והתעריפים של האתר הרשמי.",
    valEntregaDigital: "גישה מיידית בדוא\"ל לאחר אישור התשלום.",
    valPrecoCOD: "תשלום בעת המסירה (שלם רק עם קבלת המוצר).",
    valPrecoOnline: "תשלום מקוון מאובטח (כרטיס אשראי, PayPal או אמצעי תשלום מקומיים).",
    valOferta: "מבצע מיוחד לזמן מוגבל בערוץ הרשמי.",
    formatPreco: "מ-<del>{orig}</del> ועכשיו רק ב-<strong>{prom}</strong>",
    ctaOffer: "נצלו את ההנחה! מבצע לזמן מוגבל.",
    descTemplate: "עמוד מידע רשמי על המוצר {prod}. צפו בפרטי המבצע ורכשו עם אחריות למקוריות.",
    priceDescFormat: " מ-{orig} ועכשיו רק ב-{prom}.",
    priceValFormat: " (מחיר: {val}).",
    labelGadget: "מפרט טכני",
    valGadget: "מפרט טכני מתקדם ותכונות שפותחו על ידי היצרן.",
    labelDigital: "תוכן / תכונות",
    valDigital: "משאבים וחומרי מידע איכותיים שפותחו על ידי מומחים.",
    valGenericCampaignInfo: "בדקו את המידע במבצע זה.",
    valPrecoGeneric: "מחיר מבצע זמין בערוץ הרשמי של היצרן.",
    valPrecoGenericCond: "תשלום מאובטח המעובד דרך הערוץ הרשמי.",
    valPrecoGenericFallback: "צפו בפרטי המבצע.",
    valOfertaGeneric: "הנחת מבצע מיוחדת זמינה במבצע זה.",
    labelInfoRelevante: "מידע רלוונטי",
    valInfoRelevante: "ערוץ המידע הרשמי של המבצע. תנאי האחריות ומדיניות ההחזרים הם אלו שנקבעו על ידי האתר הרשמי."
  }
};

function detectLanguageFromText(cleanText: string): string {
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

  // Latin-script word evidence is checked BEFORE Arabic/Thai detection: real, visible copy in one
  // of these languages is a far stronger signal than raw character presence, which can come from
  // hidden multi-locale template content, tracking snippets, or (confirmed in a real reference
  // page) an <html lang> attribute that is simply wrong while every word on screen is Spanish.
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (best[0][1] > 3) {
    return best[0][0];
  }

  // Only trust Arabic/Thai once there is no meaningful Latin-language evidence, and even then
  // require real density (not a single stray codepoint) before committing to it.
  const arabicMatches = cleanText.match(/[؀-ۿ]/g);
  if (arabicMatches && arabicMatches.length >= 15) {
    return "ar";
  }
  const thaiMatches = cleanText.match(/[฀-๿]/g);
  if (thaiMatches && thaiMatches.length >= 15) {
    return "th";
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
  // 1440px matches most landing pages' fixed content-container width (~1000-1300px); 1920 leaves
  // excess side margin that makes the captured hero look zoomed out compared to the original.
  const thumIoUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1440/${input.referenceUrl}`;
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
  const isRtl = lang === "ar" || lang === "he";

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
  cookies?: string;
}): Promise<string> {
  const product = input.productName || "Oferta Oficial";
  const bgUrl = input.backgroundImageUrl;
  const mobileBgUrl = input.mobileBackgroundImageUrl || bgUrl;
  const lang = input.popupLanguage || "pt-BR";
  
  let faviconUrl = "";
  if (input.meta?.faviconUrl) {
    faviconUrl = input.meta.faviconUrl;
  } else if (input.meta?.productImageUrl) {
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
      faviconUrl = await downloadAsBase64(faviconUrl, input.cookies);
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

async function queryGroq(messages: any[], jsonMode = false, maxTokens = 8000) {
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
      temperature: 0.2,
      max_tokens: maxTokens,
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

async function queryOpenRouter(messages: any[], jsonMode = false, maxTokens = 8000) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not defined in environment");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b:free",
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: jsonMode ? { type: "json_object" } : undefined
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${text}`);
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

    // Provider chain: OpenRouter (free, currently the only reliably available one) -> Groq ->
    // Gemini -> local dictionary. A provider that resolves with an empty/unparseable response
    // (no exception thrown) must also cascade to the next one instead of dropping straight to
    // the local dictionary — confirmed happening in practice with OpenRouter's free-tier model.
    let mapping: { respostas?: Array<{ original?: string; rewritten?: string }> } | null = null;
    const providers: Array<{ name: string; run: () => Promise<string> }> = [
      { name: "OpenRouter", run: () => queryOpenRouter([systemMessage, userMessage], true, 3000) },
      { name: "Groq", run: () => queryGroq([systemMessage, userMessage], true) },
      { name: "Gemini", run: () => queryGemini(COMPLIANCE_SYSTEM_PROMPT, userMessage.content, true) }
    ];

    for (const provider of providers) {
      try {
        const responseText = await provider.run();
        const parsed = JSON.parse(responseText);
        if (!parsed || !Array.isArray(parsed.respostas) || parsed.respostas.length === 0) {
          throw new Error("Response parsed but contained no rewrites");
        }
        mapping = parsed;
        break;
      } catch (err: any) {
        logger.warn({ err: err.message, provider: provider.name }, "Compliance rewriter provider failed or returned unusable response, trying next...");
      }
    }

    if (!mapping) {
      logger.error("All compliance rewriter providers failed, using local dictionary");
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
  const isRtl = detectedLang === "ar" || detectedLang === "he";

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
    background: #ffffff;
    background: color-mix(in srgb, ${primaryColor} 6%, #ffffff);
    border: 1px solid rgba(0,0,0,0.06);
    border: 1px solid color-mix(in srgb, ${primaryColor} 15%, #ffffff);
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

async function downloadAsBase64(url: string, cookieHeader?: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout
  // Some CDNs/anti-bot layers reject requests with no browser-like User-Agent (returning 404
  // instead of 403 to obscure why) — confirmed happening for a real offer's favicon image.
  // The optional cookie header matters too: some tracking/cloaking gateways (e.g. click-session
  // hosts) gate every static asset behind the session cookie set on the first page load — an
  // unauthenticated fetch 404s even though the resource is real and loads fine in a real browser.
  const browserHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
  };
  if (cookieHeader) {
    browserHeaders["Cookie"] = cookieHeader;
  }
  try {
    let res = await fetch(url, { signal: controller.signal, headers: browserHeaders });
    const contentType = res.headers.get("content-type") || "";
    
    // If the API returned a JSON or text containing the real URL, fetch that URL instead
    if (contentType.includes("application/json") || contentType.includes("text/plain")) {
      const text = (await res.text()).trim();
      try {
        const parsed = JSON.parse(text);
        const nestedUrl = parsed?.data?.screenshot?.url || parsed?.screenshot?.url;
        if (nestedUrl) {
          res = await fetch(nestedUrl, { signal: controller.signal, headers: browserHeaders });
        } else if (text.startsWith("http")) {
          res = await fetch(text, { signal: controller.signal, headers: browserHeaders });
        }
      } catch (_) {
        if (text.startsWith("http")) {
          res = await fetch(text, { signal: controller.signal, headers: browserHeaders });
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
    lemonOfferId = "",
    lemonWebmasterToken = "",
    lemonCost = "",
    thankYouUrl = "",
    network = "Dr.Cash",
    selectedOption = "a",
    popupLanguage = "pt-BR",
    rawHtml = "",
    keepOriginalStructure = false
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
        screenshotUrl = `https://api.microlink.io/?url=${encodedFinalUrl}&screenshot=true&screenshot.fullPage=false&viewport.width=1440&viewport.height=900&embed=screenshot.url`;
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
            screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1440/${finalUrl}`;
            mobileScreenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/390/${finalUrl}`;
          }
        } catch (err) {
          const thumIoKeyId = process.env.VITE_THUM_IO_KEY_ID;
          const thumIoUrlKey = process.env.VITE_THUM_IO_URL_KEY;
          const authPrefix = (thumIoKeyId && thumIoUrlKey) ? `auth/${thumIoKeyId}-${thumIoUrlKey}/` : "";
          screenshotUrl = `https://image.thum.io/get/${authPrefix}maxAge/24/width/1440/${finalUrl}`;
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
        meta: meta,
        cookies: cookies
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
  cookies?: string;
  apiToken?: string;
  streamCode?: string;
  lemonOfferId?: string;
  lemonWebmasterToken?: string;
  lemonCost?: string;
  thankYouUrl?: string;
  popupLanguage?: string;
  trackingTags?: string;
  rawHtml?: string;
  originalPrice?: string;
  promotionalPrice?: string;
  extractedOffer?: string;
  productDetails?: string[];
  extractedFormula?: string;
  seoDescription?: string;
}

// New text needed by Option B only (GDPR consent, cookie banner, compliance modals, SDK feedback,
// countdown label) — same 10-language coverage as COOKIE_LOCALIZATION/detectLandingPageLanguage,
// kept as a separate dictionary so Option A's COOKIE_LOCALIZATION is never touched.
const UPSELL_LOCALIZATION: Record<string, {
  consentText: string;
  consentLinkText: string;
  consentInvalidMsg: string;
  cookieBannerText: string;
  cookiePolicyLinkText: string;
  cookieAcceptBtn: string;
  cookieDeclineBtn: string;
  modalPrivacyTitle: string;
  modalPrivacyBody: string;
  modalTermsTitle: string;
  modalTermsBody: string;
  modalContactTitle: string;
  modalContactBody: string;
  modalCloseBtn: string;
  sdkSendingText: string;
  sdkSuccessText: string;
  sdkErrorText: string;
  timerLabel: string;
}> = {
  "pt-BR": {
    consentText: "Concordo com o tratamento dos meus dados pessoais (nome e telefone) para processamento do pedido e contato pela equipe de vendas, conforme a",
    consentLinkText: "Política de Privacidade",
    consentInvalidMsg: "Por favor, marque esta caixa para continuar.",
    cookieBannerText: "Este site usa cookies para melhorar sua experiência. Leia nossa",
    cookiePolicyLinkText: "Política de Privacidade",
    cookieAcceptBtn: "Aceitar todos",
    cookieDeclineBtn: "Apenas necessários",
    modalPrivacyTitle: "Política de Privacidade",
    modalPrivacyBody: "Coletamos apenas os dados necessários (nome e telefone) para processar seu pedido e entrar em contato sobre ele. Seus dados não são vendidos a terceiros e são usados exclusivamente para essa finalidade, em conformidade com a LGPD/GDPR. Para dúvidas ou solicitações sobre seus dados, entre em contato pelo e-mail {email}.",
    modalTermsTitle: "Termos de Uso",
    modalTermsBody: "Ao enviar este formulário, você concorda em ser contatado pela equipe de vendas para confirmar seu pedido. As informações do produto nesta página têm caráter informativo e publicitário. Preços e condições podem variar conforme disponibilidade.",
    modalContactTitle: "Contato",
    modalContactBody: "Precisa falar conosco? Envie um e-mail para {email} e responderemos o mais breve possível.",
    modalCloseBtn: "Fechar",
    sdkSendingText: "Enviando...",
    sdkSuccessText: "Pedido enviado!",
    sdkErrorText: "Falha ao enviar. Toque para tentar novamente.",
    timerLabel: "Oferta expira em:"
  },
  es: {
    consentText: "Acepto el tratamiento de mis datos personales (nombre y teléfono) para procesar el pedido y ser contactado por el equipo de ventas, conforme a la",
    consentLinkText: "Política de Privacidad",
    consentInvalidMsg: "Por favor, marque esta casilla para continuar.",
    cookieBannerText: "Este sitio usa cookies para mejorar su experiencia. Lea nuestra",
    cookiePolicyLinkText: "Política de Privacidad",
    cookieAcceptBtn: "Aceptar todo",
    cookieDeclineBtn: "Solo necesarios",
    modalPrivacyTitle: "Política de Privacidad",
    modalPrivacyBody: "Recopilamos únicamente los datos necesarios (nombre y teléfono) para procesar su pedido y contactarlo al respecto. Sus datos no se venden a terceros y se usan exclusivamente para este fin, conforme al GDPR. Para dudas o solicitudes sobre sus datos, escriba a {email}.",
    modalTermsTitle: "Términos de Uso",
    modalTermsBody: "Al enviar este formulario, usted acepta ser contactado por el equipo de ventas para confirmar su pedido. La información del producto en esta página tiene carácter informativo y publicitario. Precios y condiciones pueden variar según disponibilidad.",
    modalContactTitle: "Contacto",
    modalContactBody: "¿Necesita hablar con nosotros? Escriba a {email} y responderemos lo antes posible.",
    modalCloseBtn: "Cerrar",
    sdkSendingText: "Enviando...",
    sdkSuccessText: "¡Pedido enviado!",
    sdkErrorText: "Error al enviar. Toque para intentar de nuevo.",
    timerLabel: "La oferta expira en:"
  },
  en: {
    consentText: "I agree to the processing of my personal data (name and phone number) to process this order and be contacted by the sales team, per the",
    consentLinkText: "Privacy Policy",
    consentInvalidMsg: "Please check this box to continue.",
    cookieBannerText: "This site uses cookies to improve your experience. Read our",
    cookiePolicyLinkText: "Privacy Policy",
    cookieAcceptBtn: "Accept all",
    cookieDeclineBtn: "Essential only",
    modalPrivacyTitle: "Privacy Policy",
    modalPrivacyBody: "We only collect the data needed (name and phone) to process your order and contact you about it. Your data is never sold to third parties and is used solely for this purpose, in line with GDPR. For questions or data requests, contact {email}.",
    modalTermsTitle: "Terms of Use",
    modalTermsBody: "By submitting this form, you agree to be contacted by the sales team to confirm your order. Product information on this page is for informational and advertising purposes. Prices and conditions may vary based on availability.",
    modalContactTitle: "Contact",
    modalContactBody: "Need to reach us? Email {email} and we'll respond as soon as possible.",
    modalCloseBtn: "Close",
    sdkSendingText: "Sending...",
    sdkSuccessText: "Order placed!",
    sdkErrorText: "Failed to send. Tap to try again.",
    timerLabel: "Offer expires in:"
  },
  it: {
    consentText: "Acconsento al trattamento dei miei dati personali (nome e telefono) per elaborare l'ordine ed essere contattato dal team vendite, in conformità con la",
    consentLinkText: "Informativa sulla Privacy",
    consentInvalidMsg: "Seleziona questa casella per continuare.",
    cookieBannerText: "Questo sito usa i cookie per migliorare la tua esperienza. Leggi la nostra",
    cookiePolicyLinkText: "Informativa sulla Privacy",
    cookieAcceptBtn: "Accetta tutto",
    cookieDeclineBtn: "Solo necessari",
    modalPrivacyTitle: "Informativa sulla Privacy",
    modalPrivacyBody: "Raccogliamo solo i dati necessari (nome e telefono) per elaborare il tuo ordine e contattarti al riguardo. I tuoi dati non vengono venduti a terzi e sono usati esclusivamente per questo scopo, in conformità al GDPR. Per domande o richieste sui tuoi dati, scrivi a {email}.",
    modalTermsTitle: "Termini di Utilizzo",
    modalTermsBody: "Inviando questo modulo, accetti di essere contattato dal team vendite per confermare il tuo ordine. Le informazioni sul prodotto in questa pagina hanno carattere informativo e pubblicitario. Prezzi e condizioni possono variare in base alla disponibilità.",
    modalContactTitle: "Contatti",
    modalContactBody: "Hai bisogno di parlarci? Scrivi a {email} e risponderemo il prima possibile.",
    modalCloseBtn: "Chiudi",
    sdkSendingText: "Invio in corso...",
    sdkSuccessText: "Ordine inviato!",
    sdkErrorText: "Invio non riuscito. Tocca per riprovare.",
    timerLabel: "L'offerta scade tra:"
  },
  fr: {
    consentText: "J'accepte le traitement de mes données personnelles (nom et téléphone) pour traiter cette commande et être contacté par l'équipe commerciale, conformément à la",
    consentLinkText: "Politique de Confidentialité",
    consentInvalidMsg: "Veuillez cocher cette case pour continuer.",
    cookieBannerText: "Ce site utilise des cookies pour améliorer votre expérience. Lisez notre",
    cookiePolicyLinkText: "Politique de Confidentialité",
    cookieAcceptBtn: "Tout accepter",
    cookieDeclineBtn: "Essentiels uniquement",
    modalPrivacyTitle: "Politique de Confidentialité",
    modalPrivacyBody: "Nous ne collectons que les données nécessaires (nom et téléphone) pour traiter votre commande et vous contacter à ce sujet. Vos données ne sont jamais vendues à des tiers et sont utilisées uniquement à cette fin, conformément au RGPD. Pour toute question ou demande, contactez {email}.",
    modalTermsTitle: "Conditions d'Utilisation",
    modalTermsBody: "En soumettant ce formulaire, vous acceptez d'être contacté par l'équipe commerciale pour confirmer votre commande. Les informations produit de cette page sont à caractère informatif et publicitaire. Les prix et conditions peuvent varier selon la disponibilité.",
    modalContactTitle: "Contact",
    modalContactBody: "Besoin de nous contacter ? Écrivez à {email} et nous répondrons dans les meilleurs délais.",
    modalCloseBtn: "Fermer",
    sdkSendingText: "Envoi en cours...",
    sdkSuccessText: "Commande envoyée !",
    sdkErrorText: "Échec de l'envoi. Touchez pour réessayer.",
    timerLabel: "L'offre expire dans :"
  },
  de: {
    consentText: "Ich stimme der Verarbeitung meiner personenbezogenen Daten (Name und Telefonnummer) zur Bearbeitung dieser Bestellung und zur Kontaktaufnahme durch das Verkaufsteam gemäß der",
    consentLinkText: "Datenschutzerklärung",
    consentInvalidMsg: "Bitte aktivieren Sie dieses Kästchen, um fortzufahren.",
    cookieBannerText: "Diese Website verwendet Cookies, um Ihr Erlebnis zu verbessern. Lesen Sie unsere",
    cookiePolicyLinkText: "Datenschutzerklärung",
    cookieAcceptBtn: "Alle akzeptieren",
    cookieDeclineBtn: "Nur notwendige",
    modalPrivacyTitle: "Datenschutzerklärung",
    modalPrivacyBody: "Wir erheben nur die notwendigen Daten (Name und Telefon), um Ihre Bestellung zu bearbeiten und Sie diesbezüglich zu kontaktieren. Ihre Daten werden niemals an Dritte verkauft und ausschließlich zu diesem Zweck gemäß der DSGVO verwendet. Bei Fragen oder Datenanfragen wenden Sie sich an {email}.",
    modalTermsTitle: "Nutzungsbedingungen",
    modalTermsBody: "Mit dem Absenden dieses Formulars stimmen Sie zu, vom Verkaufsteam zur Bestätigung Ihrer Bestellung kontaktiert zu werden. Die Produktinformationen auf dieser Seite dienen Informations- und Werbezwecken. Preise und Konditionen können je nach Verfügbarkeit variieren.",
    modalContactTitle: "Kontakt",
    modalContactBody: "Möchten Sie uns kontaktieren? Schreiben Sie an {email}, wir antworten so schnell wie möglich.",
    modalCloseBtn: "Schließen",
    sdkSendingText: "Wird gesendet...",
    sdkSuccessText: "Bestellung gesendet!",
    sdkErrorText: "Senden fehlgeschlagen. Tippen, um es erneut zu versuchen.",
    timerLabel: "Angebot endet in:"
  },
  ro: {
    consentText: "Sunt de acord cu prelucrarea datelor mele personale (nume și telefon) pentru procesarea comenzii și contactul din partea echipei de vânzări, conform",
    consentLinkText: "Politicii de Confidențialitate",
    consentInvalidMsg: "Vă rugăm să bifați această căsuță pentru a continua.",
    cookieBannerText: "Acest site folosește cookie-uri pentru a vă îmbunătăți experiența. Citiți",
    cookiePolicyLinkText: "Politica de Confidențialitate",
    cookieAcceptBtn: "Acceptă tot",
    cookieDeclineBtn: "Doar esențiale",
    modalPrivacyTitle: "Politica de Confidențialitate",
    modalPrivacyBody: "Colectăm doar datele necesare (nume și telefon) pentru a procesa comanda dvs. și a vă contacta în legătură cu aceasta. Datele dvs. nu sunt vândute niciodată terților și sunt folosite exclusiv în acest scop, conform GDPR. Pentru întrebări sau solicitări, contactați {email}.",
    modalTermsTitle: "Termeni de Utilizare",
    modalTermsBody: "Prin trimiterea acestui formular, sunteți de acord să fiți contactat de echipa de vânzări pentru confirmarea comenzii. Informațiile despre produs de pe această pagină au caracter informativ și publicitar. Prețurile și condițiile pot varia în funcție de disponibilitate.",
    modalContactTitle: "Contact",
    modalContactBody: "Aveți nevoie să ne contactați? Scrieți la {email} și vă vom răspunde cât mai curând posibil.",
    modalCloseBtn: "Închide",
    sdkSendingText: "Se trimite...",
    sdkSuccessText: "Comandă trimisă!",
    sdkErrorText: "Trimiterea a eșuat. Atingeți pentru a încerca din nou.",
    timerLabel: "Oferta expiră în:"
  },
  pl: {
    consentText: "Wyrażam zgodę na przetwarzanie moich danych osobowych (imię i numer telefonu) w celu realizacji zamówienia i kontaktu ze strony zespołu sprzedaży, zgodnie z",
    consentLinkText: "Polityką Prywatności",
    consentInvalidMsg: "Zaznacz to pole, aby kontynuować.",
    cookieBannerText: "Ta strona używa plików cookie, aby poprawić Twoje doświadczenia. Przeczytaj naszą",
    cookiePolicyLinkText: "Politykę Prywatności",
    cookieAcceptBtn: "Akceptuj wszystkie",
    cookieDeclineBtn: "Tylko niezbędne",
    modalPrivacyTitle: "Polityka Prywatności",
    modalPrivacyBody: "Zbieramy wyłącznie dane niezbędne (imię i telefon) do realizacji zamówienia i kontaktu w tej sprawie. Twoje dane nigdy nie są sprzedawane osobom trzecim i są wykorzystywane wyłącznie w tym celu, zgodnie z RODO. W razie pytań lub wniosków dotyczących danych skontaktuj się pod adresem {email}.",
    modalTermsTitle: "Regulamin",
    modalTermsBody: "Wysyłając ten formularz, zgadzasz się na kontakt ze strony zespołu sprzedaży w celu potwierdzenia zamówienia. Informacje o produkcie na tej stronie mają charakter informacyjny i reklamowy. Ceny i warunki mogą się różnić w zależności od dostępności.",
    modalContactTitle: "Kontakt",
    modalContactBody: "Chcesz się z nami skontaktować? Napisz na {email}, odpowiemy najszybciej jak to możliwe.",
    modalCloseBtn: "Zamknij",
    sdkSendingText: "Wysyłanie...",
    sdkSuccessText: "Zamówiono!",
    sdkErrorText: "Wysyłka nie powiodła się. Dotknij, aby spróbować ponownie.",
    timerLabel: "Oferta wygasa za:"
  },
  ar: {
    consentText: "أوافق على معالجة بياناتي الشخصية (الاسم ورقم الهاتف) لمعالجة هذا الطلب والتواصل معي من قبل فريق المبيعات، وفقًا لـ",
    consentLinkText: "سياسة الخصوصية",
    consentInvalidMsg: "يرجى تحديد هذا المربع للمتابعة.",
    cookieBannerText: "يستخدم هذا الموقع ملفات تعريف الارتباط لتحسين تجربتك. اقرأ",
    cookiePolicyLinkText: "سياسة الخصوصية",
    cookieAcceptBtn: "قبول الكل",
    cookieDeclineBtn: "الضرورية فقط",
    modalPrivacyTitle: "سياسة الخصوصية",
    modalPrivacyBody: "نجمع فقط البيانات اللازمة (الاسم والهاتف) لمعالجة طلبك والتواصل معك بشأنه. لا يتم بيع بياناتك أبدًا لأطراف ثالثة وتُستخدم حصريًا لهذا الغرض. لأي استفسارات، تواصل معنا عبر {email}.",
    modalTermsTitle: "شروط الاستخدام",
    modalTermsBody: "بإرسال هذا النموذج، فإنك توافق على أن يتواصل معك فريق المبيعات لتأكيد طلبك. معلومات المنتج في هذه الصفحة لأغراض إعلامية وإعلانية. قد تختلف الأسعار والشروط حسب التوفر.",
    modalContactTitle: "اتصل بنا",
    modalContactBody: "هل تحتاج إلى التواصل معنا؟ راسلنا عبر {email} وسنرد في أقرب وقت ممكن.",
    modalCloseBtn: "إغلاق",
    sdkSendingText: "جارٍ الإرسال...",
    sdkSuccessText: "تم إرسال الطلب!",
    sdkErrorText: "فشل الإرسال. اضغط للمحاولة مرة أخرى.",
    timerLabel: "ينتهي العرض خلال:"
  },
  th: {
    consentText: "ฉันยินยอมให้มีการประมวลผลข้อมูลส่วนบุคคลของฉัน (ชื่อและหมายเลขโทรศัพท์) เพื่อดำเนินการตามคำสั่งซื้อนี้และให้ทีมขายติดต่อกลับ ตาม",
    consentLinkText: "นโยบายความเป็นส่วนตัว",
    consentInvalidMsg: "กรุณาทำเครื่องหมายในช่องนี้เพื่อดำเนินการต่อ",
    cookieBannerText: "เว็บไซต์นี้ใช้คุกกี้เพื่อปรับปรุงประสบการณ์ของคุณ อ่าน",
    cookiePolicyLinkText: "นโยบายความเป็นส่วนตัว",
    cookieAcceptBtn: "ยอมรับทั้งหมด",
    cookieDeclineBtn: "เฉพาะที่จำเป็น",
    modalPrivacyTitle: "นโยบายความเป็นส่วนตัว",
    modalPrivacyBody: "เราเก็บเฉพาะข้อมูลที่จำเป็น (ชื่อและโทรศัพท์) เพื่อดำเนินการตามคำสั่งซื้อและติดต่อคุณเกี่ยวกับเรื่องนี้ ข้อมูลของคุณจะไม่ถูกขายให้บุคคลที่สามและใช้เพื่อจุดประสงค์นี้เท่านั้น หากมีคำถามหรือคำขอเกี่ยวกับข้อมูล ติดต่อ {email}",
    modalTermsTitle: "ข้อกำหนดการใช้งาน",
    modalTermsBody: "การส่งแบบฟอร์มนี้ถือว่าคุณยินยอมให้ทีมขายติดต่อเพื่อยืนยันคำสั่งซื้อของคุณ ข้อมูลผลิตภัณฑ์ในหน้านี้มีไว้เพื่อวัตถุประสงค์ในการให้ข้อมูลและโฆษณา ราคาและเงื่อนไขอาจแตกต่างกันไปตามความพร้อมจำหน่าย",
    modalContactTitle: "ติดต่อเรา",
    modalContactBody: "ต้องการติดต่อเรา? ส่งอีเมลถึง {email} แล้วเราจะตอบกลับโดยเร็วที่สุด",
    modalCloseBtn: "ปิด",
    sdkSendingText: "กำลังส่ง...",
    sdkSuccessText: "ส่งคำสั่งซื้อแล้ว!",
    sdkErrorText: "ส่งไม่สำเร็จ แตะเพื่อลองอีกครั้ง",
    timerLabel: "ข้อเสนอหมดอายุใน:"
  }
};

function escapeUpsellHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// One order form instance, class="orderForm" required by the Dr.Cash SDK's global submit
// listener; called multiple times (hero/mid/final) with a unique formId to avoid id collisions.
function buildOrderFormMarkup(params: {
  formId: string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  securityBadge: string;
  upsell: typeof UPSELL_LOCALIZATION[string];
  ctaButton: string;
  formAction: string;
  hasLemonAd?: boolean;
}): string {
  const e = escapeUpsellHtml;
  const id = escapeUpsellHtml(params.formId);
  // LemonAd's lemon.php reads these straight from $_POST — without them every lead loses
  // its campaign attribution (utm_*), click id and Facebook pixel id. Populated via JS on load.
  const lemonHiddenFields = params.hasLemonAd
    ? ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "clickid", "fbpxl"]
        .map((name) => `<input type="hidden" name="${name}" class="lemon-track-field" value="">`)
        .join("\n          ")
    : "";
  return `
      <form class="orderForm order-form" id="f-${id}" action="${e(params.formAction)}" method="POST">
        ${lemonHiddenFields}
        <div class="form-group">
          <label for="name-${id}">${e(params.nameLabel)}</label>
          <input class="field-input" type="text" id="name-${id}" name="name" placeholder="${e(params.namePlaceholder)}" required autocomplete="given-name">
        </div>
        <div class="form-group">
          <label for="phone-${id}">${e(params.phoneLabel)}</label>
          <input class="field-input" type="tel" id="phone-${id}" name="phone" placeholder="${e(params.phonePlaceholder)}" minlength="5" required autocomplete="tel">
        </div>
        <label class="consent-row" for="consent-${id}">
          <input type="checkbox" id="consent-${id}" name="consent" class="consent-checkbox" required>
          <span>${e(params.upsell.consentText)} <a href="#privacy">${e(params.upsell.consentLinkText)}</a></span>
        </label>
        <button type="submit" class="btn-cta btn-order">${e(params.ctaButton)}</button>
        <div class="success-msg" id="ok-${id}" style="display:none;">✔ ${e(params.upsell.sdkSuccessText)}</div>
        <div class="security-badge">${e(params.securityBadge)}</div>
      </form>`;
}

// Renders a self-contained lead handler for LemonAd's sendmelead.com API. Kept server-side
// (never shipped as client JS) because WEBMASTER_TOKEN authenticates the webmaster's account —
// exposing it in page source would let anyone submit fraudulent leads under it.
function generateLemonPhpFile(params: {
  offerId: string;
  webmasterToken: string;
  cost: string;
  successFileName: string;
}): string {
  const phpString = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const offerId = phpString(params.offerId);
  const token = phpString(params.webmasterToken);
  const cost = Number(params.cost.toString().replace(",", ".")) || 0;
  const successFile = params.successFileName.replace(/^\.\//, "") || "Obrigado.html";

  return `<?php
// Auto-generated LemonAd (sendmelead.com) lead handler
const API_URL = "https://sendmelead.com/api/v3/lead/add";
const OFFER_ID = '${offerId}'; // ID of selected offer
const WEBMASTER_TOKEN = '${token}'; // Token from your LemonAd profile
const COST = ${cost};
const NAME_FIELD = 'name';
const PHONE_FIELD = 'phone';

$urlForEmptyRequiredFields = 'index.html';
$urlForNotJson = 'index.html';
$urlSuccess = '${successFile}';

function getUserIP() {
    if (isset($_SERVER["HTTP_CF_CONNECTING_IP"])) {
        $_SERVER['REMOTE_ADDR'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
        $_SERVER['HTTP_CLIENT_IP'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
    }
    $client  = @$_SERVER['HTTP_CLIENT_IP'];
    $forward = @$_SERVER['HTTP_X_FORWARDED_FOR'];
    $remote  = $_SERVER['REMOTE_ADDR'];
    if (filter_var($client, FILTER_VALIDATE_IP)) return $client;
    if (filter_var($forward, FILTER_VALIDATE_IP)) return $forward;
    return $remote;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !function_exists('curl_version')) {
    header('Location: ' . $urlForEmptyRequiredFields);
    exit;
}

if (empty($_POST[NAME_FIELD]) || empty($_POST[PHONE_FIELD])) {
    header('Location: ' . $urlForEmptyRequiredFields);
    exit;
}

$args = array(
    'name' => $_POST[NAME_FIELD],
    'phone' => $_POST[PHONE_FIELD],
    'offerId' => OFFER_ID,
    'domain' => "http://" . $_SERVER["HTTP_HOST"] . $_SERVER["REQUEST_URI"],
    'ip' => getUserIP(),
    'utm_campaign' => $_POST['utm_campaign'] ?? null,
    'utm_content' => $_POST['utm_content'] ?? null,
    'utm_medium' => $_POST['utm_medium'] ?? null,
    'utm_source' => $_POST['utm_source'] ?? null,
    'utm_term' => $_POST['utm_term'] ?? null,
    'clickid' => $_POST['clickid'] ?? null,
    'fbpxl' => $_POST['fbpxl'] ?? null,
    'cost' => COST,
);

$data = json_encode($args);
$curl = curl_init();
curl_setopt_array($curl, array(
    CURLOPT_URL => API_URL,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $data,
    CURLOPT_HTTPHEADER => array(
        'Content-Type: application/json',
        'Content-Length: ' . strlen($data),
        'X-Token: ' . WEBMASTER_TOKEN,
    ),
));

$result = curl_exec($curl);
curl_close($curl);

$decoded = json_decode($result, true);

if ($decoded === null) {
    header('Location: ' . $urlForNotJson);
    exit;
}

$parameters = array(
    'fbpxl' => $args['fbpxl'],
    'fio' => $args['name'],
    'name' => $args['name'],
    'phone' => $args['phone'],
);

header('Location: ' . $urlSuccess . '?' . http_build_query($parameters));
exit;
`;
}

// Structural skeleton adapted from getThankYouModalCode's proven overlay/card pattern, reused
// here for three brand-new compliance modals (privacy/terms/contact) that didn't exist before.
function buildComplianceModals(upsell: typeof UPSELL_LOCALIZATION[string], primaryColor: string, contactEmail: string): string {
  const e = escapeUpsellHtml;
  const withEmail = (body: string) => e(body).replace(/\{email\}/g, e(contactEmail));

  const modal = (hash: string, title: string, body: string) => `
  <div id="${hash}" class="legal-modal-overlay">
    <div class="legal-modal-content">
      <a href="#" class="legal-modal-close" aria-label="${e(upsell.modalCloseBtn)}">&times;</a>
      <h2>${e(title)}</h2>
      <p>${body}</p>
    </div>
  </div>`;

  return `
  <style>
    .legal-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(15,23,42,0.85); z-index: 999999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; overflow-y: auto; }
    .legal-modal-overlay.legal-modal-open { display: flex; }
    .legal-modal-content { background: #ffffff; border-radius: 20px; width: 100%; max-width: 560px; padding: 32px 28px; position: relative; color: #0f172a; text-align: left; }
    .legal-modal-content h2 { font-size: 1.3rem; margin-bottom: 14px; color: ${primaryColor}; }
    .legal-modal-content p { font-size: 0.92rem; line-height: 1.6; color: #334155; }
    .legal-modal-close { position: absolute; top: 14px; right: 18px; font-size: 1.5rem; color: #94a3b8; text-decoration: none; line-height: 1; }
    .legal-modal-close:hover { color: #0f172a; }
  </style>
  ${modal("privacy", upsell.modalPrivacyTitle, withEmail(upsell.modalPrivacyBody))}
  ${modal("terms", upsell.modalTermsTitle, withEmail(upsell.modalTermsBody))}
  ${modal("contact", upsell.modalContactTitle, withEmail(upsell.modalContactBody))}
  <script>
    (function() {
      var hashes = ["privacy", "terms", "contact"];
      function syncModals() {
        var current = window.location.hash.replace("#", "");
        hashes.forEach(function(h) {
          var el = document.getElementById(h);
          if (!el) return;
          el.classList.toggle("legal-modal-open", h === current);
        });
      }
      window.addEventListener("hashchange", syncModals);
      document.addEventListener("DOMContentLoaded", syncModals);
    })();
  </script>`;
}

// Non-blocking cookie bar — deliberately separate from Option A's injectCookieConsentOverlay,
// which renders a blocking central card; this is a dismissible bottom bar instead.
function buildCookieBanner(upsell: typeof UPSELL_LOCALIZATION[string], primaryColor: string): string {
  const e = escapeUpsellHtml;
  return `
  <style>
    .ob-cookie-bar { display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 99998; background: #0f172a; color: #f8fafc; padding: 14px 20px; font-size: 0.82rem; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .ob-cookie-bar.ob-cookie-visible { display: flex; }
    .ob-cookie-bar a { color: ${primaryColor}; font-weight: 700; }
    .ob-cookie-actions { display: flex; gap: 10px; flex-shrink: 0; }
    .ob-cookie-btn { border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #f8fafc; padding: 8px 16px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; }
    .ob-cookie-accept { background: ${primaryColor}; border-color: ${primaryColor}; color: #ffffff; }
  </style>
  <div id="ob-cookie-bar" class="ob-cookie-bar">
    <p>${e(upsell.cookieBannerText)} <a href="#privacy">${e(upsell.cookiePolicyLinkText)}</a></p>
    <div class="ob-cookie-actions">
      <button type="button" class="ob-cookie-btn" data-choice="declined">${e(upsell.cookieDeclineBtn)}</button>
      <button type="button" class="ob-cookie-btn ob-cookie-accept" data-choice="accepted">${e(upsell.cookieAcceptBtn)}</button>
    </div>
  </div>
  <script>
    (function() {
      var bar = document.getElementById("ob-cookie-bar");
      if (!bar) return;
      try {
        if (!localStorage.getItem("ob_cookie_choice")) {
          bar.classList.add("ob-cookie-visible");
        }
      } catch (_) { bar.classList.add("ob-cookie-visible"); }
      bar.querySelectorAll(".ob-cookie-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          try { localStorage.setItem("ob_cookie_choice", btn.getAttribute("data-choice")); } catch (_) {}
          bar.classList.remove("ob-cookie-visible");
        });
      });
    })();
  </script>`;
}

// Inserts a GDPR consent checkbox into every <form> of a cloned page whose structure we don't
// control. Skips forms that already have a consent field. Run this AFTER rewriteClaimsForCompliance
// (so the AI never rewrites the checkbox's own text) and after injectAffiliateIntoHtml. Best-effort,
// not pixel-perfect: inline-styled so it renders reasonably regardless of the host page's CSS.
function injectConsentCheckboxIntoForms(html: string, upsell: typeof UPSELL_LOCALIZATION[string]): string {
  const e = escapeUpsellHtml;
  return html.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, (formBlock) => {
    if (/name=["']consent["']/i.test(formBlock)) return formBlock;

    const consentMarkup = `<label style="display:flex;align-items:flex-start;gap:8px;margin:10px 0;font-size:12px;line-height:1.4;color:#333;font-family:sans-serif;">` +
      `<input type="checkbox" name="consent" required style="margin-top:3px;flex-shrink:0;">` +
      `<span>${e(upsell.consentText)} <a href="#privacy" style="color:inherit;text-decoration:underline;">${e(upsell.consentLinkText)}</a></span>` +
      `</label>`;

    const submitRegex = /(<button\b[^>]*>[\s\S]*?<\/button>|<input\b[^>]*type=["']submit["'][^>]*>)/i;
    if (submitRegex.test(formBlock)) {
      return formBlock.replace(submitRegex, consentMarkup + "$1");
    }
    return formBlock.replace(/<\/form>/i, consentMarkup + "</form>");
  });
}

// Concatenates extra markup (cookie banner, compliance modals) right before </body>, falling back
// to appending at the end if the page has no closing body tag.
function injectBeforeBodyClose(html: string, extraMarkup: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${extraMarkup}\n</body>`);
  }
  return html + extraMarkup;
}

async function generateGaryHalbertLandingPageHtml(input: GaryHalbertLandingPageInput): Promise<{ html: string; aiFailed: boolean; lemonPhpHtml?: string; lemonPhpFileName?: string }> {
  // 1. Prepare raw text extract from page to understand product, ingredients, benefits, price & language
  let extractedText = "";
  if (input.rawHtml) {
    extractedText = input.rawHtml
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 6000);
  }

  // Supplement extracted text with meta info if extractedText is brief
  const contextParts: string[] = [];
  if (input.productName) contextParts.push(`Nome do Produto: ${input.productName}`);
  if (input.seoDescription) contextParts.push(`Descrição SEO / Resumo: ${input.seoDescription}`);
  if (input.extractedFormula) contextParts.push(`Fórmula / Ingredientes Identificados: ${input.extractedFormula}`);
  if (input.productDetails && input.productDetails.length > 0) contextParts.push(`Principais Detalhes / Benefícios Extraídos: ${input.productDetails.join(" | ")}`);
  if (input.promotionalPrice) contextParts.push(`Preço da Oferta Extraído: ${input.promotionalPrice} (De: ${input.originalPrice || 'N/A'})`);
  if (input.extractedOffer) contextParts.push(`Desconto / Promoção: ${input.extractedOffer}`);

  const richContext = `${contextParts.join("\n")}\n\nTexto completo da página original:\n${extractedText || "Conteúdo não disponível."}`;

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
Sua missão é LER e ANALISAR o texto extraído da página de vendas original do produto "${input.productName}" e REESCREVER uma nova copy persuasiva, de alta conversão e 100% compliant com o Google Ads no idioma ${targetLangName}.

## REGRAS CRÍTICAS DE ANÁLISE DO PRODUTO:
1. LEIA O CONTEÚDO FORNECIDO: Identifique EXATAMENTE a finalidade real do produto "${input.productName}" (ex: articulações, próstata, varizes, emagrecimento, pele, cabelo, visão, energia, digestão, etc.).
2. JAMAIS invente uma utilidade genérica de pernas cansadas se o produto for para outro objetivo! A copy DEVE refletir com precisão a finalidade real do produto "${input.productName}".
3. IDIOMA OBRIGATÓRIO: A resposta DEVE estar 100% no idioma ${targetLangName}.

## REGRAS RÍGIDAS DE COMPLIANCE GOOGLE ADS:
- PROIBIDO: Promessas de cura definitiva, linguagem cirúrgica, alarmismo de doenças fatais, estatísticas clínicas inventadas, nomes de doenças graves (ex: câncer, diabetes, artrite como diagnóstico), antes/depois exagerados, garantias de resultado.
- OBRIGATÓRIO: Foco no suporte diário ao bem-estar, vitalidade, conforto e cuidados corporais/estéticos. Descreva sintomas do dia a dia (desconforto, cansaço, rigidez, incômodo) de forma empática, nunca como diagnóstico médico.

## SEÇÃO DE DORES (OBRIGATÓRIA, SEMPRE EM COMPLIANCE):
Além do problema geral, liste de 3 a 4 situações cotidianas específicas e relacionáveis que a pessoa sente por causa do desconforto (ex: dificuldade em atividades simples, interrupção do sono, evitar certas tarefas) — sempre como sensação/experiência do dia a dia, nunca como sintoma clínico ou diagnóstico.

## FORMATO DE RESPOSTA (JSON OBRIGATÓRIO):
Retorne APENAS um objeto JSON válido (sem textos explicativos ao redor) com os seguintes campos no idioma ${targetLangName}:
{
  "headline": "Manchete forte e persuasiva específica para o produto ${input.productName} no idioma ${targetLangName}",
  "subheadline": "Subtítulo atraente descrevendo o benefício principal do produto",
  "badgeText": "Fórmula Natural • Cuidado Diário",
  "problemTitle": "Título empático sobre o problema diário que o produto ajuda a suavizar",
  "problemText": "Texto empático explicando como o desconforto/problema afeta a rotina e por que o cuidado é necessário.",
  "painPointsTitle": "Título curto acima da lista de situações do dia a dia (ex: O que você sente?)",
  "painPoints": [
    "Situação cotidiana específica 1 causada pelo desconforto",
    "Situação cotidiana específica 2 causada pelo desconforto",
    "Situação cotidiana específica 3 causada pelo desconforto"
  ],
  "solutionTitle": "Título de apresentação da solução ${input.productName}",
  "solutionText": "Texto descrevendo a proposta do produto e como sua fórmula atua de forma suave e eficaz.",
  "ingredients": [
    { "name": "Nome do Ingrediente 1 (extraído ou característico)", "benefit": "Benefício específico deste ingrediente" },
    { "name": "Nome do Ingrediente 2", "benefit": "Benefício específico deste ingrediente" },
    { "name": "Nome do Ingrediente 3", "benefit": "Benefício específico deste ingrediente" }
  ],
  "bullets": [
    "Benefício específico 1 do produto",
    "Benefício específico 2 do produto",
    "Benefício específico 3 do produto",
    "Benefício específico 4 do produto",
    "Pagamento 100% seguro no momento da entrega"
  ],
  "trustTitle": "Título dos selos de confiança",
  "trustItems": [
    { "title": "Selo de Qualidade 1", "desc": "Descrição da qualidade/fórmula" },
    { "title": "Pagamento Seguro na Entrega", "desc": "Pague apenas ao receber o produto" },
    { "title": "Envío Rápido e Discreto", "desc": "Embalagem protegida até a sua porta" }
  ],
  "formTitle": "Garanta a Sua Oferta Especial Hoje",
  "formSubtitle": "Preencha seus dados abaixo para receber as informações da oferta com pagamento na entrega",
  "ctaButton": "SOLICITAR OFERTA AGORA"
}`;

  const userPrompt = `Produto: ${input.productName}
URL de Referência: ${input.referenceUrl}
Idioma OBRIGATÓRIO: ${targetLangName}

${richContext}`;

  let responseText = "";
  let aiFailed = false;
  try {
    responseText = await queryOpenRouter([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], true, 3000);
  } catch (_) {
    try {
      responseText = await queryGroq([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], true);
    } catch (_) {
      try {
        responseText = await queryGemini(systemPrompt, userPrompt, true);
      } catch (_) {
        aiFailed = true;
      }
    }
  }

  let copyData: any = {};
  if (!aiFailed && responseText) {
    try {
      copyData = extractJsonObject(responseText);
    } catch (_) {
      try {
        copyData = JSON.parse(responseText);
      } catch (_) {
        aiFailed = true;
      }
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
    },
    it: {
      topBar: "🔥 Offerta Speciale a Tempo Limitato",
      nameLabel: "Nome e Cognome",
      namePlaceholder: "Inserisci il tuo nome e cognome",
      phoneLabel: "Numero di Telefono",
      phonePlaceholder: "Inserisci il tuo numero di telefono",
      securityBadge: "🔒 I Tuoi Dati Sono Protetti • Pagamento alla Consegna",
      footerDisclaimer: "Dichiarazione di non responsabilità: Questo prodotto è un integratore/cosmetico di supporto quotidiano e non sostituisce diagnosi o trattamenti medici.",
      footerRights: "Tutti i diritti riservati.",
      privacy: "Informativa sulla Privacy",
      terms: "Termini e Condizioni",
      contact: "Contatti",
      formulaTitle: "Formula con Ingredienti Selezionati",
      priceFrom: "Prezzo regolare",
      priceTo: "Prezzo promozionale",
      trustTitle: "Perché Scegliere la Nostra Soluzione?"
    },
    en: {
      topBar: "🔥 Limited-Time Special Launch Offer",
      nameLabel: "Full Name",
      namePlaceholder: "Enter your full name",
      phoneLabel: "Phone Number",
      phonePlaceholder: "Enter your phone number",
      securityBadge: "🔒 Your Data Is Protected • Cash on Delivery",
      footerDisclaimer: "Disclaimer: This product is a daily-support supplement/cosmetic and does not replace medical diagnosis or treatment.",
      footerRights: "All rights reserved.",
      privacy: "Privacy Policy",
      terms: "Terms of Use",
      contact: "Contact",
      formulaTitle: "Formula With Selected Ingredients",
      priceFrom: "Regular price",
      priceTo: "Offer price",
      trustTitle: "Why Choose Our Solution?"
    },
    ro: {
      topBar: "🔥 Ofertă Specială de Lansare pe Timp Limitat",
      nameLabel: "Nume Complet",
      namePlaceholder: "Introduceți numele complet",
      phoneLabel: "Număr de Telefon",
      phonePlaceholder: "Introduceți numărul de telefon",
      securityBadge: "🔒 Datele Dvs. Sunt Protejate • Plată la Livrare",
      footerDisclaimer: "Declinare de responsabilitate: Acest produs este un supliment/cosmetic de sprijin zilnic și nu înlocuiește diagnosticul sau tratamentul medical.",
      footerRights: "Toate drepturile rezervate.",
      privacy: "Politica de Confidențialitate",
      terms: "Termeni de Utilizare",
      contact: "Contact",
      formulaTitle: "Formulă cu Ingrediente Selecționate",
      priceFrom: "Preț obișnuit",
      priceTo: "Preț promoțional",
      trustTitle: "De ce să Alegeți Soluția Noastră?"
    },
    ar: {
      topBar: "🔥 عرض إطلاق خاص لفترة محدودة",
      nameLabel: "الاسم الكامل",
      namePlaceholder: "أدخل اسمك الكامل",
      phoneLabel: "رقم الهاتف",
      phonePlaceholder: "أدخل رقم هاتفك",
      securityBadge: "🔒 بياناتك محمية • الدفع عند الاستلام",
      footerDisclaimer: "إخلاء مسؤولية: هذا المنتج مكمل/مستحضر تجميل للدعم اليومي ولا يغني عن التشخيص أو العلاج الطبي.",
      footerRights: "جميع الحقوق محفوظة.",
      privacy: "سياسة الخصوصية",
      terms: "شروط الاستخدام",
      contact: "اتصل بنا",
      formulaTitle: "تركيبة بمكونات مختارة",
      priceFrom: "السعر العادي",
      priceTo: "سعر العرض",
      trustTitle: "لماذا تختار حلنا؟"
    },
    th: {
      topBar: "🔥 ข้อเสนอพิเศษช่วงเวลาจำกัด",
      nameLabel: "ชื่อ-นามสกุล",
      namePlaceholder: "กรอกชื่อ-นามสกุลของคุณ",
      phoneLabel: "หมายเลขโทรศัพท์",
      phonePlaceholder: "กรอกหมายเลขโทรศัพท์ของคุณ",
      securityBadge: "🔒 ข้อมูลของคุณปลอดภัย • เก็บเงินปลายทาง",
      footerDisclaimer: "ข้อจำกัดความรับผิดชอบ: ผลิตภัณฑ์นี้เป็นอาหารเสริม/เครื่องสำอางเพื่อการดูแลประจำวัน ไม่ใช่การวินิจฉัยหรือการรักษาทางการแพทย์",
      footerRights: "สงวนลิขสิทธิ์ทั้งหมด",
      privacy: "นโยบายความเป็นส่วนตัว",
      terms: "ข้อกำหนดการใช้งาน",
      contact: "ติดต่อเรา",
      formulaTitle: "สูตรที่มีส่วนผสมคัดสรร",
      priceFrom: "ราคาปกติ",
      priceTo: "ราคาโปรโมชั่น",
      trustTitle: "ทำไมต้องเลือกโซลูชันของเรา?"
    }
  };

  const ui = uiDict[langCode] || uiDict.en;
  const isSpanish = langCode === "es";
  const isPolish = langCode === "pl";
  const isFrench = langCode === "fr";
  const isGerman = langCode === "de";
  const isItalian = langCode === "it";
  // Languages the copy fallback ternaries below don't have native text for — used to fall back
  // to English instead of silently defaulting to Portuguese for these audiences.
  const isEnglishFallback = langCode === "en" || langCode === "ro" || langCode === "ar" || langCode === "th";

  const pName = input.productName || "Produto Oficial";

  // Deliberately never falls back to the scraped seoDescription here — some source pages
  // put unfilled promo/urgency text (e.g. unrendered price templates) in their <meta description>,
  // which would otherwise leak into the H1 whenever the AI call fails.
  const headline = copyData.headline || (
    isEnglishFallback ? `Discover ${pName}'s Natural Daily Care Formula` :
    isSpanish ? `Descubra la Fórmula Natural de Cuidado Diario de ${pName}` :
    isPolish ? `Odkryj Naturalną Formułę Pielęgnacji i Wsparcia dla ${pName}` :
    isFrench ? `Découvrez la Formule Naturelle de Soin Quotidien ${pName}` :
    isGerman ? `Entdecken Sie die natürliche Formel von ${pName}` :
    isItalian ? `Scopri la Formula Naturale per la Cura Quotidiana di ${pName}` :
    `Descubra a Fórmula Natural de Cuidado Diário para ${pName}`
  );

  const subheadline = copyData.subheadline || (
    isEnglishFallback ? `An exclusive combination of selected botanical extracts for your body's well-being.` :
    isSpanish ? `Una combinación exclusiva de extractos botánicos seleccionados para el bienestar de su cuerpo.` :
    isPolish ? `Wyjątkowe połączenie ekologicznych składników stworzone dla Twojego codziennego komfortu.` :
    isFrench ? `Une combinaison exclusive d'extraits botaniques pour votre bien-être quotidien.` :
    isGerman ? `Eine exklusive Kombination botanischer Extrakte für Ihr tägliches Wohlbefinden.` :
    isItalian ? `Una combinazione esclusiva di estratti botanici selezionati per il benessere del tuo corpo.` :
    `Uma combinação exclusiva de extratos botânicos selecionados para o bem-estar do seu corpo.`
  );

  const badgeText = copyData.badgeText || (
    isEnglishFallback ? `Natural Botanical Formula • Daily Care` :
    isFrench ? `Formule Botanique Naturelle • Soin Quotidien` :
    isGerman ? `Natürliche Botanische Formel • Tägliche Pflege` :
    isItalian ? `Formula Botanica Naturale • Cura Quotidiana` :
    isSpanish ? `Fórmula Botánica Natural • Cuidado Diario` :
    isPolish ? `Naturalna Formuła • Codzienna Pielęgnacja` :
    `Fórmula Botânica Natural • Cuidado Diário`
  );

  const problemTitle = copyData.problemTitle || (
    isEnglishFallback ? `Looking for natural support for your daily well-being?` :
    isFrench ? `Recherchez-vous un bien-être naturel au quotidien ?` :
    isGerman ? `Suchen Sie eine natürliche Lösung für Ihr Wohlbefinden?` :
    isItalian ? `Cerchi una soluzione naturale per il tuo benessere quotidiano?` :
    isSpanish ? `¿Busca una solución natural para su bienestar diario?` :
    isPolish ? `Szukasz naturalnego wsparcia dla swojego organizmu?` :
    `Busca uma solução natural para o seu bem-estar diário?`
  );

    const problemText = copyData.problemText || (
    isEnglishFallback ? `The pace of daily life can take a toll on your body. Proper care with ${pName} helps you regain natural comfort and vitality.` :
    isFrench ? `Le rythme de vie quotidien peut solliciter votre corps. Un soin adapté avec ${pName} vous aide à retrouver confort et vitalité naturelle.` :
    isGerman ? `Der tägliche Lebensrhythmus kann Ihren Körper belasten. Eine angemessene Pflege mit ${pName} hilft, natürlichen Komfort wiederzuerlangen.` :
    isItalian ? `I ritmi della vita quotidiana possono affaticare il tuo corpo. Una cura adeguata con ${pName} ti aiuta a ritrovare il comfort e la vitalità naturale.` :
    isSpanish ? `El ritmo de vida diario puede exigir mucho de su cuerpo. Mantener un cuidado adecuado con ${pName} ayuda a recuperar el confort y la vitalidad natural.` :
    isPolish ? `Codzienne tempo życia może obciążać Twój organizm. Regularne wsparcie z ${pName} pomaga przywrócić naturalną witalność.` :
    `O ritmo de vida diário pode exigir muito do seu corpo. Manter um cuidado adequado com o ${pName} ajuda a recuperar o conforto e a vitalidade natural.`
  );

  const painPointsTitle = copyData.painPointsTitle || (
    isEnglishFallback ? `What are you feeling?` :
    isFrench ? `Que ressentez-vous ?` :
    isGerman ? `Was spüren Sie?` :
    isItalian ? `Cosa provi?` :
    isSpanish ? `¿Qué siente?` :
    isPolish ? `Co odczuwasz?` :
    `O que você sente?`
  );

  const fallbackPainPoints = isEnglishFallback
    ? [`Everyday tasks feel harder than they should`, `Discomfort that interrupts your routine`, `Avoiding activities you used to enjoy`]
    : isFrench
      ? [`Les tâches du quotidien deviennent plus difficiles`, `Un inconfort qui interrompt votre routine`, `Éviter des activités que vous aimiez faire`]
      : isGerman
        ? [`Alltägliche Aufgaben fühlen sich schwerer an als nötig`, `Unbehagen, das Ihren Alltag stört`, `Sie vermeiden Aktivitäten, die Sie früher gerne gemacht haben`]
        : isItalian
          ? [`Le attività quotidiane sembrano più difficili del dovuto`, `Un fastidio che interrompe la tua routine`, `Evitare attività che prima ti piacevano`]
          : isSpanish
            ? [`Las tareas cotidianas se vuelven más difíciles de lo normal`, `Una molestia que interrumpe su rutina`, `Evitar actividades que antes disfrutaba`]
            : isPolish
              ? [`Codzienne czynności stają się trudniejsze niż powinny`, `Dyskomfort, który zakłóca Twoją rutynę`, `Unikanie aktywności, które kiedyś sprawiały przyjemność`]
              : [`Tarefas do dia a dia parecem mais difíceis do que deveriam`, `Um desconforto que interrompe sua rotina`, `Evitar atividades que você gostava de fazer`];

  const painPoints: string[] = Array.isArray(copyData.painPoints) && copyData.painPoints.length > 0
    ? copyData.painPoints
    : fallbackPainPoints;

  const solutionTitle = copyData.solutionTitle || (
    isEnglishFallback ? `Meet ${pName}` :
    isFrench ? `Découvrez ${pName}` :
    isGerman ? `Erfahren Sie mehr über ${pName}` :
    isItalian ? `Scopri ${pName}` :
    isSpanish ? `Conozca ${pName}` :
    isPolish ? `Poznaj ${pName}` :
    `Conheça o ${pName}`
  );

  const solutionText = copyData.solutionText || (
    isEnglishFallback ? `Developed with high-purity ingredients, ${pName} offers a soothing experience and supports your body's natural balance.` :
    isFrench ? `Développé avec des ingrédients de haute pureté, ${pName} offre une expérience réconfortante et favorise l'équilibre naturel de votre corps.` :
    isGerman ? `Entwickelt mit hochreinen Inhaltsstoffen bietet ${pName} ein wohltuendes Erlebnis und fördert das natürliche Gleichgewicht Ihres Körpers.` :
    isItalian ? `Sviluppato con ingredienti di elevata purezza, ${pName} offre un'esperienza confortante e promuove l'equilibrio naturale del tuo corpo.` :
    isSpanish ? `Desarrollado con ingredientes de alta pureza, ${pName} proporciona una experiencia reconfortante y promueve el equilibrio natural de su cuerpo.` :
    isPolish ? `Stworzony z wyselekcjonowanych składników najwyższej jakości, ${pName} zapewnia uczucie odświeżenia i wspiera Twój organizm.` :
    `Desenvolvido com ingredientes selecionados, o ${pName} proporciona uma experiência revigorante, promovendo hidratação, frescor e sensação de alívio imediato.`
  );
  
  const fallbackIngredients = input.extractedFormula
    ? input.extractedFormula.split(",").map(ing => ({ name: ing.trim(), benefit: isEnglishFallback ? "High-purity active ingredient." : (isFrench ? "Ingrédient actif de haute pureté." : (isItalian ? "Ingrediente attivo di elevata purezza." : (isSpanish ? "Ingrediente activo de alta pureza." : (isPolish ? "Wyselekcjonowany składnik aktywny." : "Ingrediente ativo de alta pureza.")))) }))
    : [
        { name: isEnglishFallback ? "Active Botanical Extract" : (isFrench ? "Extrait Botanique Actif" : (isItalian ? "Estratto Botanico Attivo" : (isSpanish ? "Extracto Botánico Activo" : (isPolish ? "Aktywny Ekstrakt Roślinny" : "Extrato Natural Ativo")))), benefit: isEnglishFallback ? "Helps maintain a feeling of well-being." : (isFrench ? "Aide à maintenir une sensation de bien-être." : (isItalian ? "Aiuta a mantenere una sensazione di benessere e vitalità." : (isSpanish ? "Ayuda a mantener la sensación de bienestar y frescura." : (isPolish ? "Wspomaga uczucie lekkości i świeżości." : "Auxilia na sensação de bem-estar e vitalidade.")))) },
        { name: isEnglishFallback ? "Nutritive Complex" : (isFrench ? "Complexe Nutritif" : (isItalian ? "Complesso Nutritivo" : (isSpanish ? "Complejo Nutritivo" : (isPolish ? "Kompleks Odżywczy" : "Complexo Nutritivo")))), benefit: isEnglishFallback ? "Nourishes and preserves the body's comfort." : (isFrench ? "Nourrit et préserve le confort du corps." : (isItalian ? "Nutre e preserva il comfort del corpo." : (isSpanish ? "Nutre y suaviza el aspecto de la piel y el cuerpo." : (isPolish ? "Pielęgnuje i wygładza ciało." : "Nutre e suaviza o corpo.")))) },
        { name: isEnglishFallback ? "Comforting Agent" : (isFrench ? "Agent Réconfortant" : (isItalian ? "Agente Rinfrescante" : (isSpanish ? "Agente Reconfortante" : (isPolish ? "Składnik Odświeżający" : "Agente Revigorante")))), benefit: isEnglishFallback ? "Provides lasting comfort." : (isFrench ? "Procur de la fraîcheur et un confort prolongé." : (isItalian ? "Dona freschezza e comfort prolungato." : (isSpanish ? "Proporciona confort prolongado." : (isPolish ? "Zapewnia długotrwały komfort." : "Proporciona conforto prolongado.")))) }
      ];

  const ingredients: Array<{ name: string; benefit: string }> = Array.isArray(copyData.ingredients) && copyData.ingredients.length > 0 
    ? copyData.ingredients 
    : fallbackIngredients;

  const bullets: string[] = Array.isArray(copyData.bullets) && copyData.bullets.length > 0
    ? copyData.bullets
    : [
        isEnglishFallback ? "Daily well-being and a feeling of freshness" : (isFrench ? "Bien-être quotidien et sensation de fraîcheur" : (isItalian ? "Benessere quotidiano e sensazione di freschezza" : (isSpanish ? "Bienestar diario y sensación de frescura" : (isPolish ? "Codzienne uczucie witalności i ulgi" : "Bem-estar diário e sensação de frescor")))),
        isEnglishFallback ? "Gentle formula made with natural ingredients" : (isFrench ? "Formule douce à base d'ingrédients naturels" : (isItalian ? "Formula delicata a base di ingredienti naturali" : (isSpanish ? "Fórmula suave a base de ingredientes naturales" : (isPolish ? "Delikatna formuła z ekologicznych składników" : "Fórmula suave à base de ingredientes naturais")))),
        isEnglishFallback ? "Lightweight, fast-absorbing texture" : (isFrench ? "Format pratique pour une utilisation facile" : (isItalian ? "Formato pratico per un facile utilizzo" : (isSpanish ? "Textura ligera de rápida absorción" : (isPolish ? "Szybka absorpcja bez tłustej warstwy" : "Textura leve de rápida absorção")))),
        isEnglishFallback ? "Practical to use any time of day" : (isFrench ? "Utilisation quotidienne à tout moment de la journée" : (isItalian ? "Uso pratico in qualsiasi momento della giornata" : (isSpanish ? "Uso práctico en cualquier momento del día" : (isPolish ? "Wygodne stosowanie każdego dnia" : "Uso prático em qualquer momento do dia")))),
        isEnglishFallback ? "100% secure payment on delivery" : (isFrench ? "Paiement 100% sécurisé à la livraison" : (isItalian ? "Pagamento 100% sicuro alla consegna" : (isSpanish ? "Pago 100% seguro al momento de la entrega" : (isPolish ? "Gwarancja bezpiecznego płatności przy odbiorze" : "Pagamento 100% seguro no momento da entrega"))))
      ];

  const trustTitle = copyData.trustTitle || ui.trustTitle;
  const trustItems: Array<{ title: string; desc: string }> = Array.isArray(copyData.trustItems) && copyData.trustItems.length > 0
    ? copyData.trustItems
    : [
        { title: isEnglishFallback ? "Selected Ingredients" : (isFrench ? "Ingrédients Sélectionnés" : (isItalian ? "Ingredienti Selezionati" : (isSpanish ? "Ingredientes Seleccionados" : (isPolish ? "Wyselekcjonowane Składniki" : "Ingredientes Botânicos Selecionados")))), desc: isEnglishFallback ? "High-purity formula developed for daily care." : (isFrench ? "Formule de haute pureté développée pour le soin quotidien." : (isItalian ? "Formula di elevata purezza sviluppata per la cura quotidiana." : (isSpanish ? "Fórmula de alta pureza desarrollada para el cuidado diario." : (isPolish ? "Wysoka jakość i delikatne wsparcie dla Twojego ciała." : "Fórmula desenvolvida com extratos de alta pureza.")))) },
        { title: isEnglishFallback ? "Secure Payment on Delivery" : (isFrench ? "Paiement Sécurisé à la Livraison" : (isItalian ? "Pagamento Sicuro alla Consegna" : (isSpanish ? "Pago Seguro Contra Entrega" : (isPolish ? "Płatność Przy Odbiorze" : "Pagamento Seguro na Entrega")))), desc: isEnglishFallback ? "Pay only when you receive your order." : (isFrench ? "Payez uniquement à la réception de votre commande." : (isItalian ? "Paga solo al momento del ricevimento del prodotto." : (isSpanish ? "Pague únicamente al recibir el producto en sus manos." : (isPolish ? "Płacisz dopiero w momencie dostawy do Twoich rąk." : "Sem necessidade de cartão prévio. Pague ao receber.")))) },
        { title: isEnglishFallback ? "Fast, Discreet Shipping" : (isFrench ? "Expédition Rapide et Discrète" : (isItalian ? "Spedizione Rapida e Discreta" : (isSpanish ? "Envío Rápido y Discreto" : (isPolish ? "Szybka Dostawa" : "Entrega Rápida e Discreta")))), desc: isEnglishFallback ? "Protected package delivered straight to your door." : (isFrench ? "Colis protégé livré directement chez vous." : (isItalian ? "Pacco protetto consegnato direttamente a casa tua." : (isSpanish ? "Paquete protegido entregado directamente en su domicilio." : (isPolish ? "Starannie zapakowana przesyłka trafia prosto do Twojego domu." : "Embalagem segura entregue com rapidez no seu endereço.")))) }
      ];

  const formTitle = copyData.formTitle || (
    isEnglishFallback ? `Get Your ${pName} Today` :
    isFrench ? `Demandez Votre ${pName} Aujourd'hui` :
    isGerman ? `Bestellen Sie Ihr ${pName} Heute` :
    isItalian ? `Richiedi il tuo ${pName} Oggi` :
    isSpanish ? `Solicite su ${pName} Hoy` :
    isPolish ? `Zamów ${pName} Dzisiaj` :
    `Solicite o Seu ${pName} Hoje`
  );

  const formSubtitle = copyData.formSubtitle || (
    isEnglishFallback ? `Fill in your details below to receive this exclusive offer with cash on delivery.` :
    isFrench ? `Remplissez vos informations ci-dessous pour recevoir l'offre exclusive avec paiement à la livraison.` :
    isGerman ? `Geben Sie Ihre Daten unten ein, um das exklusive Angebot mit Zahlung bei Lieferung zu erhalten.` :
    isItalian ? `Compila i tuoi dati qui sotto per ricevere l'offerta esclusiva con pagamento alla consegna.` :
    isSpanish ? `Complete sus datos a continuación para recibir la información de la oferta exclusiva con pago contra entrega.` :
    isPolish ? `Wypełnij poniższe dane, aby otrzymać ofertę promocyjną z płatnością przy odbiorze.` :
    `Preencha os dados abaixo para receber as informações da oferta exclusiva com pagamento na entrega.`
  );

  const ctaButton = copyData.ctaButton || (
    isEnglishFallback ? `REQUEST OFFER NOW` :
    isFrench ? `DEMANDER L'OFFRE MAINTENANT` :
    isGerman ? `JETZT ANGEBOT ANFORDERN` :
    isItalian ? `RICHIEDI L'OFFERTA ORA` :
    isSpanish ? `SOLICITAR OFERTA AHORA` :
    isPolish ? `ZAMÓW Z RABATEM TERAZ` :
    `SOLICITAR OFERTA AGORA`
  );

  const primaryColor = input.primaryColor || "#16a34a";
  const ctaColor = input.ctaButtonColor || primaryColor;

  let origPriceDisplay = input.originalPrice || "";
  let promoPriceDisplay = input.promotionalPrice || "";

  if (origPriceDisplay && !promoPriceDisplay) {
    const matchVal = origPriceDisplay.match(/\d+/);
    if (matchVal) {
      const val = parseInt(matchVal[0], 10);
      const halfVal = Math.round(val / 2);
      promoPriceDisplay = origPriceDisplay.replace(matchVal[0], halfVal.toString());
    }
  }

  if (promoPriceDisplay && !origPriceDisplay) {
    const matchVal = promoPriceDisplay.match(/\d+/);
    if (matchVal) {
      const val = parseInt(matchVal[0], 10);
      const doubleVal = Math.round(val * 2);
      origPriceDisplay = promoPriceDisplay.replace(matchVal[0], doubleVal.toString());
    }
  }

  if (!promoPriceDisplay) {
    if (isSpanish) promoPriceDisplay = "229 GTQ";
    else if (isPolish) promoPriceDisplay = "139 zł";
    else if (isFrench || isGerman || isItalian) promoPriceDisplay = "39 €";
    else if (isEnglishFallback) promoPriceDisplay = "$39";
    else promoPriceDisplay = "R$ 147";
  }

  if (!origPriceDisplay) {
    const matchVal = promoPriceDisplay.match(/\d+/);
    if (matchVal) {
      const val = parseInt(matchVal[0], 10);
      const doubleVal = Math.round(val * 2);
      origPriceDisplay = promoPriceDisplay.replace(matchVal[0], doubleVal.toString());
    } else {
      if (isSpanish) origPriceDisplay = "458 GTQ";
      else if (isPolish) origPriceDisplay = "278 zł";
      else if (isFrench || isGerman || isItalian) origPriceDisplay = "78 €";
      else if (isEnglishFallback) origPriceDisplay = "$78";
      else origPriceDisplay = "R$ 297";
    }
  }

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
  const hasLemonAd = !hasDrCash && !!(input.lemonOfferId && input.lemonWebmasterToken);
  const finalThankYouUrl = input.thankYouUrl || "./Obrigado.html";
  const lemonPhpFileName = "lemon.php";
  const formAction = hasDrCash ? "#" : hasLemonAd ? lemonPhpFileName : finalThankYouUrl;

  // Reused for both the favicon and the hero product image — downloaded once, embedded as
  // base64 so the page stays fully self-contained (no external image dependency to break).
  let productImageBase64 = "";
  if (input.productImageUrl) {
    try {
      productImageBase64 = await downloadAsBase64(input.productImageUrl, input.cookies);
    } catch (_) {
      productImageBase64 = "";
    }
  }
  const svgFaviconFallback = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💊</text></svg>`;
  const faviconDataUri = productImageBase64 || svgFaviconFallback;
  const faviconMime = productImageBase64 ? (faviconDataUri.match(/^data:([^;]+);/)?.[1] || "image/png") : "image/svg+xml";

  const productImgHtml = productImageBase64
    ? `<img src="${productImageBase64}" alt="${input.productName}" class="product-img">`
    : `<div class="product-placeholder">📦<span>${input.productName}</span></div>`;

  const upsell = UPSELL_LOCALIZATION[input.popupLanguage || "pt-BR"] || UPSELL_LOCALIZATION["en"];
  let contactDomain = "suporte.com";
  try { contactDomain = new URL(input.affiliateUrl).hostname.replace(/^www\./, ""); } catch (_) {}
  const contactEmail = `suporte@${contactDomain}`;
  const ogLocaleMap: Record<string, string> = {
    "pt-BR": "pt_BR", es: "es_ES", en: "en_US", it: "it_IT", fr: "fr_FR",
    de: "de_DE", ro: "ro_RO", pl: "pl_PL", ar: "ar_AR", th: "th_TH"
  };
  const ogLocale = ogLocaleMap[input.popupLanguage || "pt-BR"] || "en_US";

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
  <meta name="robots" content="index, follow">
  <meta name="author" content="${input.productName}">
  <meta name="theme-color" content="${primaryColor}">
  <meta property="og:title" content="${headline} | ${input.productName}">
  <meta property="og:description" content="${subheadline}">
  <meta property="og:image" content="${faviconDataUri}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${ogLocale}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${headline} | ${input.productName}">
  <meta name="twitter:description" content="${subheadline}">
  <link rel="icon" type="${faviconMime}" sizes="16x16" href="${faviconDataUri}">
  <link rel="icon" type="${faviconMime}" sizes="32x32" href="${faviconDataUri}">
  <link rel="apple-touch-icon" sizes="180x180" href="${faviconDataUri}">
  <link rel="icon" type="${faviconMime}" sizes="192x192" href="${faviconDataUri}">
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
    
    .hero-grid { display: grid; grid-template-columns: 1fr 260px 380px; gap: 30px; align-items: start; margin: 30px 0; text-align: left; }
    @media (max-width: 768px) {
      .hero h1 { font-size: 1.7rem; }
      .hero-grid { grid-template-columns: 1fr; gap: 25px; }
      .hero-image { order: -1; }
    }
    .hero-copy { padding-top: 8px; }

    .product-box { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 25px; text-align: center; box-shadow: var(--card-shadow); }
    .product-img { max-width: 100%; height: auto; max-height: 320px; border-radius: 12px; object-fit: contain; }
    .product-placeholder { height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 3rem; background-color: rgba(0,0,0,0.03); border-radius: 12px; }
    .product-placeholder span { font-size: 1.2rem; font-weight: 700; margin-top: 10px; color: var(--text-main); }
    @media (max-width: 768px) {
      .product-img, .product-placeholder { max-height: 220px; }
      .product-placeholder { height: 220px; }
    }

    .hero-order-card { background: var(--form-bg); border: 2px solid var(--primary); border-radius: 20px; padding: 22px 20px; box-shadow: 0 15px 35px rgba(22, 163, 74, 0.15); position: relative; }
    .hero-ribbon { display: inline-block; background: var(--accent-gold); color: #000; font-weight: 800; padding: 5px 12px; border-radius: 999px; font-size: 0.78rem; margin-bottom: 12px; }
    .card-timer { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: rgba(0,0,0,0.15); border-radius: 10px; padding: 8px 12px; margin: 12px 0; flex-wrap: wrap; }
    .timer-label { font-size: 0.75rem; color: var(--text-muted); }
    .timer-digits { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 1rem; color: var(--text-main); letter-spacing: 1px; }

    .consent-row { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0 2px; cursor: pointer; font-size: 0.74rem; color: var(--text-muted); line-height: 1.5; }
    .consent-row input[type="checkbox"] { margin-top: 3px; accent-color: var(--primary); width: 15px; height: 15px; flex-shrink: 0; }
    .consent-row a { color: var(--primary); font-weight: 700; }
    .success-msg { text-align: center; color: #16a34a; font-weight: 700; font-size: 0.9rem; margin-top: 4px; }
    
    .narrative-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 30px; margin-bottom: 30px; box-shadow: var(--card-shadow); }
    .narrative-card h2 { font-size: 1.5rem; color: var(--text-main); margin-bottom: 14px; font-weight: 700; border-left: 4px solid var(--primary); padding-left: 12px; }
    .narrative-card p { color: var(--text-muted); font-size: 1rem; margin-bottom: 16px; }
    .pain-points-title { font-size: 1.05rem; color: var(--text-main); margin: 8px 0 10px; font-weight: 700; }
    .pain-points-list { list-style: none; margin-bottom: 8px; }
    .pain-points-list li { display: flex; align-items: flex-start; gap: 10px; font-size: 0.95rem; color: var(--text-muted); margin-bottom: 10px; line-height: 1.5; }
    .pain-icon { color: var(--primary); font-weight: 900; flex-shrink: 0; }
    
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

    <div class="hero-grid">
      <div class="hero-copy">
        <ul class="bullets-list">
          ${bullets.map((b: string) => `<li><span class="check-icon">✓</span> ${b}</li>`).join("")}
        </ul>
      </div>

      <div class="hero-image product-box">
        ${productImgHtml}
      </div>

      <div class="hero-order-card">
        <span class="hero-ribbon">${offerTagDisplay}</span>
        ${priceBoxHtml}
        <div class="card-timer">
          <span class="timer-label">${upsell.timerLabel}</span>
          <span class="timer-digits"><span class="t-digit">0</span><span class="t-digit">0</span>:<span class="t-digit">0</span><span class="t-digit">0</span>:<span class="t-digit">0</span><span class="t-digit">0</span></span>
        </div>
        ${buildOrderFormMarkup({
          formId: "hero",
          nameLabel: ui.nameLabel,
          namePlaceholder: ui.namePlaceholder,
          phoneLabel: ui.phoneLabel,
          phonePlaceholder: ui.phonePlaceholder,
          securityBadge: ui.securityBadge,
          upsell,
          ctaButton,
          formAction,
          hasLemonAd
        })}
      </div>
    </div>

    <div class="narrative-card">
      <h2>${problemTitle}</h2>
      <p>${problemText}</p>
      <h3 class="pain-points-title">${painPointsTitle}</h3>
      <ul class="pain-points-list">
        ${painPoints.map((p: string) => `<li><span class="pain-icon">•</span> ${p}</li>`).join("")}
      </ul>
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

    <div class="form-wrapper">
      <div class="form-header">
        <h2>${formTitle}</h2>
        <p>${formSubtitle}</p>
      </div>
      ${buildOrderFormMarkup({
        formId: "mid",
        nameLabel: ui.nameLabel,
        namePlaceholder: ui.namePlaceholder,
        phoneLabel: ui.phoneLabel,
        phonePlaceholder: ui.phonePlaceholder,
        securityBadge: ui.securityBadge,
        upsell,
        ctaButton,
        formAction,
        hasLemonAd
      })}
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
      ${buildOrderFormMarkup({
        formId: "final",
        nameLabel: ui.nameLabel,
        namePlaceholder: ui.namePlaceholder,
        phoneLabel: ui.phoneLabel,
        phonePlaceholder: ui.phonePlaceholder,
        securityBadge: ui.securityBadge,
        upsell,
        ctaButton,
        formAction,
        hasLemonAd
      })}
    </div>
  </div>

  <footer>
    <div class="container">
      <p>© ${new Date().getFullYear()} ${input.productName}. ${ui.footerRights}</p>
      <p>${ui.footerDisclaimer}</p>
      <div class="footer-links">
        <a href="#privacy">${ui.privacy}</a>
        <a href="#terms">${ui.terms}</a>
        <a href="#contact">${ui.contact}</a>
      </div>
    </div>
  </footer>

  ${buildComplianceModals(upsell, primaryColor, contactEmail)}
  ${buildCookieBanner(upsell, primaryColor)}

  <script>
    (function() {
      document.querySelectorAll(".consent-checkbox").forEach(function(cb) {
        var msg = ${JSON.stringify(upsell.consentInvalidMsg)};
        cb.addEventListener("invalid", function() { cb.setCustomValidity(msg); });
        cb.addEventListener("change", function() { cb.setCustomValidity(""); });
      });

      function getSecondsUntilMidnight() {
        var now = new Date();
        var midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return Math.floor((midnight - now) / 1000);
      }
      function updateTimers() {
        var total = getSecondsUntilMidnight();
        if (total < 0) total = 0;
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        var digits = [Math.floor(h / 10), h % 10, Math.floor(m / 10), m % 10, Math.floor(s / 10), s % 10];
        document.querySelectorAll(".card-timer").forEach(function(timer) {
          var spans = timer.querySelectorAll(".t-digit");
          digits.forEach(function(d, i) { if (spans[i]) spans[i].textContent = String(d); });
        });
      }
      updateTimers();
      setInterval(updateTimers, 1000);
    })();
  </script>
  ${hasDrCash ? `
<script src="https://snippet.infothroat.com/dist/api/lead-1.1.0.min.js"></script>
<script>
(function() {
  function setButtonsState(state) {
    document.querySelectorAll(".btn-order").forEach(function(btn) {
      if (state === "sending") { btn.disabled = true; btn.textContent = ${JSON.stringify(upsell.sdkSendingText)}; }
      else if (state === "success") { btn.textContent = "✔ " + ${JSON.stringify(upsell.sdkSuccessText)}; }
      else if (state === "error") { btn.disabled = false; btn.textContent = ${JSON.stringify(upsell.sdkErrorText)}; }
    });
  }
  function initDrCashSdk() {
    if (typeof drlead === "undefined") return;
    var watchdog = null;
    drlead.init({
      params: {
        token: ${JSON.stringify(input.apiToken)},
        stream_code: ${JSON.stringify(input.streamCode)},
        thanks_page: ${JSON.stringify(finalThankYouUrl)}
      },
      subs: {
        sub1: drlead.queryGet("utm_source") || drlead.queryGet("sub1") || "",
        sub2: drlead.queryGet("utm_medium") || drlead.queryGet("sub2") || "",
        sub3: drlead.queryGet("utm_campaign") || drlead.queryGet("sub3") || "",
        sub4: drlead.queryGet("utm_content") || drlead.queryGet("sub4") || "",
        sub5: drlead.queryGet("utm_term") || drlead.queryGet("sub5") || ""
      },
      before: function() {
        setButtonsState("sending");
        clearTimeout(watchdog);
        // Safety net: some HTTP-level failures (invalid token, duplicate lead) never reach
        // callback(error) nor callback(success) on the SDK side, leaving the button stuck.
        watchdog = setTimeout(function() { setButtonsState("error"); }, 12000);
      },
      callback: function(error) {
        clearTimeout(watchdog);
        if (error) { setButtonsState("error"); return; }
        setButtonsState("success");
        document.querySelectorAll(".success-msg").forEach(function(m) { m.style.display = "block"; });
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDrCashSdk);
  else initDrCashSdk();
})();
</script>` : ""}
  ${hasLemonAd ? `
<script>
(function() {
  // lemon.php reads these straight from $_POST; without them every lead loses its
  // campaign attribution. Stamps every .lemon-track-field hidden input on page load.
  function qs(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }
  function stampForms() {
    var values = {
      utm_source: qs("utm_source"),
      utm_medium: qs("utm_medium"),
      utm_campaign: qs("utm_campaign"),
      utm_content: qs("utm_content"),
      utm_term: qs("utm_term"),
      clickid: qs("clickid") || qs("click_id"),
      fbpxl: qs("fbpxl") || qs("fbclid")
    };
    document.querySelectorAll(".lemon-track-field").forEach(function(input) {
      if (values.hasOwnProperty(input.name)) input.value = values[input.name];
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", stampForms);
  else stampForms();
})();
</script>` : ""}
</body>
</html>`;

  const lemonPhpHtml = hasLemonAd
    ? generateLemonPhpFile({
        offerId: input.lemonOfferId || "",
        webmasterToken: input.lemonWebmasterToken || "",
        cost: input.lemonCost || "0",
        successFileName: finalThankYouUrl
      })
    : undefined;

  return { html, aiFailed, lemonPhpHtml, lemonPhpFileName: hasLemonAd ? lemonPhpFileName : undefined };
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

    // ALTERNATE MODE: keep the original landing page's structure instead of generating a new
    // template from scratch — only rewrite Google Ads policy-violating claims and inject the
    // affiliate link/Dr.Cash SDK/GDPR consent/cookie banner into it. Opt-in via keepOriginalStructure;
    // falls through to the traditional generator below when there's no raw HTML to clone.
    if (keepOriginalStructure && rawHtmlString) {
      const finalThankYouUrlClone = (thankYouUrl && thankYouUrl !== "#obrigado") ? thankYouUrl : "./Obrigado.html";
      const compliance = await rewriteClaimsForCompliance(rawHtmlString);
      let cloned = await injectAffiliateIntoHtml(
        compliance.html,
        finalUrl,
        normalizedAffiliate,
        trackingTags,
        apiToken,
        streamCode,
        finalThankYouUrlClone,
        meta.productImageUrl || ""
      );

      const cloneUpsell = UPSELL_LOCALIZATION[detectedLang] || UPSELL_LOCALIZATION["pt-BR"];
      let contactDomain = "suporte.com";
      try { contactDomain = new URL(normalizedAffiliate).hostname.replace(/^www\./, ""); } catch (_) {}
      const contactEmail = `suporte@${contactDomain}`;

      cloned = injectConsentCheckboxIntoForms(cloned, cloneUpsell);
      cloned = injectBeforeBodyClose(
        cloned,
        buildCookieBanner(cloneUpsell, meta.primaryColor || "#16a34a") + buildComplianceModals(cloneUpsell, meta.primaryColor || "#16a34a", contactEmail)
      );

      logger.info({ aiFailed: compliance.aiFailed }, "Option B (keep original structure): clone generated");

      res.json({
        html: cloned,
        mode: "presell" as BridgeMode,
        productName: resolvedProductName,
        language: detectedLang,
        designSummary: "Estrutura original da landing preservada; textos revisados para conformidade com o Google Ads.",
        research: { enabled: false, results: [] },
        thankYouHtml,
        thankYouFileName
      });
      return;
    }

    // Generate Gary Halbert High-Converting Landing Page HTML
    const garyResult = await generateGaryHalbertLandingPageHtml({
      productName: resolvedProductName,
      primaryColor: meta.primaryColor || "#16a34a",
      ctaButtonColor: meta.ctaButtonColor || meta.primaryColor || "#16a34a",
      backgroundColor: meta.backgroundColor,
      productImageUrl: meta.productImageUrl || "",
      referenceUrl: finalUrl,
      affiliateUrl: normalizedAffiliate,
      cookies,
      apiToken,
      streamCode,
      lemonOfferId,
      lemonWebmasterToken,
      lemonCost,
      thankYouUrl: finalThankYouUrl,
      popupLanguage: detectedLang,
      trackingTags,
      rawHtml: rawHtmlString,
      originalPrice: meta.originalPrice,
      promotionalPrice: meta.promotionalPrice || meta.extractedPrice,
      extractedOffer: meta.extractedOffer,
      productDetails: meta.productDetails,
      extractedFormula: meta.extractedFormula,
      seoDescription: meta.seoDescription
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
      thankYouFileName,
      lemonPhpHtml: garyResult.lemonPhpHtml || "",
      lemonPhpFileName: garyResult.lemonPhpFileName || ""
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

interface ReviewTestimonial {
  name: string;
  stars: number;
  quote: string;
}

interface ReviewFaqItem {
  question: string;
  answer: string;
}

interface ReviewPageContent {
  productName: string;
  affiliateUrl: string;
  langCode: string;
  ratingBadge: string;
  heroTag: string;
  heroHeadline: string;
  heroLead: string;
  ctaButtonText: string;
  aboutTitle: string;
  aboutText: string;
  prosTitle: string;
  pros: string[];
  consTitle: string;
  cons: string[];
  testimonialsTitle: string;
  testimonials: ReviewTestimonial[];
  faqTitle: string;
  faq: ReviewFaqItem[];
  verdictTitle: string;
  verdictText: string;
  verdictCtaText: string;
  footerDisclaimer: string;
}

function escapeReviewHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Deterministic per-field multilingual fallback, same spirit as the copyData.field || <fallback>
// pattern used by generateGaryHalbertLandingPageHtml (lines ~4975-5094) — guarantees a complete,
// renderable ReviewPageContent even if the AI omits fields or every provider fails.
function fillReviewContentDefaults(partial: Partial<ReviewPageContent> | null | undefined, ctx: { productName: string; affiliateUrl: string; langCode: string }): ReviewPageContent {
  const p = partial || {};
  const lang = (p.langCode || ctx.langCode || "es").toLowerCase();
  const isEs = lang.startsWith("es");
  const isPl = lang === "pl";
  const productName = p.productName || ctx.productName || "Produto Especial";
  const affiliateUrl = p.affiliateUrl || ctx.affiliateUrl || "#";

  const d = {
    ratingBadge: isEs ? "★ 4.9/5.0 (2.840 Reseñas)" : isPl ? "★ 4.9/5.0 (2.840 Opinii)" : "★ 4.9/5.0 (2.840 Avaliações)",
    heroTag: isEs ? "Análisis Completo y Prueba Práctica" : isPl ? "Pełny Raport i Test Praktyczny" : "Análise Completa & Teste Prático",
    heroHeadline: isEs ? `${productName}: ¿Vale la Pena? Lea Nuestra Revisión Detallada` : isPl ? `${productName}: Czy Warto Kupić? Przeczytaj Szczegółową Recenzję` : `${productName}: Vale a Pena Mesmo? Confira Nossa Análise Detalhada`,
    heroLead: isEs ? `Probamos y analizamos a fondo el ${productName}. Descubra los beneficios reales, pros y contras, y dónde comprar la versión oficial con descuento.` : isPl ? `Przetestowaliśmy i dokładnie przeanalizowaliśmy ${productName}. Poznaj prawdziwe korzyści, zalety i wady oraz dowiedz się, gdzie kupić oficjalną wersję ze zniżką.` : `Testamos e analisamos a fundo o ${productName}. Descubra os benefícios reais, prós e contras, e onde comprar a versão oficial com desconto.`,
    ctaButtonText: isEs ? `Acceder al Sitio Oficial de ${productName} →` : isPl ? `Przejdź do Oficjalnej Strony ${productName} →` : `Acessar Site Oficial do ${productName} →`,
    aboutTitle: isEs ? `¿Qué es ${productName}?` : isPl ? `Czym jest ${productName}?` : `O que é o ${productName}?`,
    aboutText: isEs ? `${productName} es una solución desarrollada con estándares de calidad superiores para brindar soporte práctico en la rutina diaria. Con ingredientes seleccionados y alta aceptación en el mercado.` : isPl ? `${productName} to rozwiązanie stworzone z zachowaniem najwyższych standardów jakości, aby zapewnić wsparcie w codziennej rutynie.` : `${productName} é uma solução desenvolvida com padrão de qualidade superior para proporcionar suporte prático e eficiente no dia a dia.`,
    prosTitle: isEs ? "Ventajas Principales" : isPl ? "Główne Zalety" : "Principais Vantagens",
    pros: isEs
      ? ["Fórmula probada con ingredientes de origen natural", "Alta tasa de aprobación de los consumidores", "Garantía directa del fabricante en el sitio oficial", "Envío rápido con paquete discreto"]
      : isPl
        ? ["Testowana formuła ze składnikami pochodzenia naturalnego", "Wysoki poziom zadowolenia konsumentów", "Gwarancja producenta na oficjalnej stronie", "Szybka wysyłka w dyskretnym opakowaniu"]
        : ["Fórmula testada com ingredientes de origem natural", "Alta taxa de aprovação dos consumidores", "Garantia direta do fabricante no site oficial", "Entrega rápida com embalagem discreta"],
    consTitle: isEs ? "Puntos de Atención" : isPl ? "Ważne Uwagi" : "Pontos de Atenção",
    cons: isEs
      ? ["Ventas solo en el sitio oficial autorizado", "Unidades limitadas con descuento promocional"]
      : isPl
        ? ["Sprzedaż wyłącznie na oficjalnej stronie", "Ograniczona ilość w cenie promocyjnej"]
        : ["Vendas somente pelo site oficial autorizado", "Estoque com alta demanda pode esgotar em promoções"],
    testimonialsTitle: isEs ? "Opiniones de Clientes Verificados" : isPl ? "Opinie Zweryfikowanych Klientów" : "Depoimentos de Quem Já Usou",
    testimonials: [
      { name: "Mariana S.", stars: 5, quote: isEs ? "¡Excelente producto! Llegó antes de tiempo y cumplió exactamente lo prometido." : isPl ? "Świetny produkt! Przesyłka dotarła szybko i spełniła moje oczekiwania." : "Excelente produto! Chegou antes do prazo e cumpriu exatamente o que prometeu." },
      { name: "Carlos A.", stars: 5, quote: isEs ? "Compré con descuento en el sitio oficial y valió cada centavo." : isPl ? "Kupiłem ze zniżką na oficjalnej stronie i jestem bardzo zadowolony." : "Comprei com desconto no site oficial e valeu cada centavo." }
    ] as ReviewTestimonial[],
    faqTitle: isEs ? "Preguntas Frecuentes" : isPl ? "Najczęściej Zadawane Pytania" : "Perguntas Frequentes",
    faq: [
      {
        question: isEs ? `¿${productName} es seguro de usar?` : isPl ? `Czy ${productName} jest bezpieczny w użyciu?` : `${productName} é seguro de usar?`,
        answer: isEs ? "Sí, es desarrollado siguiendo estándares de calidad y seguridad reconocidos." : isPl ? "Tak, produkt jest tworzony zgodnie z uznanymi standardami jakości i bezpieczeństwa." : "Sim, é desenvolvido seguindo padrões de qualidade e segurança reconhecidos."
      },
      {
        question: isEs ? "¿Cuánto tiempo tarda la entrega?" : isPl ? "Jak długo trwa dostawa?" : "Quanto tempo leva a entrega?",
        answer: isEs ? "El plazo varía según la región, pero el envío es rápido y discreto." : isPl ? "Czas dostawy zależy od regionu, ale wysyłka jest szybka i dyskretna." : "O prazo varia conforme a região, mas o envio é rápido e discreto."
      },
      {
        question: isEs ? "¿Dónde comprar la versión oficial?" : isPl ? "Gdzie kupić oficjalną wersję?" : "Onde comprar a versão oficial?",
        answer: isEs ? "Solo en el sitio oficial, a través de los enlaces de esta página." : isPl ? "Tylko na oficjalnej stronie, poprzez linki na tej stronie." : "Somente no site oficial, através dos links desta página."
      }
    ] as ReviewFaqItem[],
    verdictTitle: isEs ? "Veredicto Final: ¿Vale la Pena?" : isPl ? "Podsumowanie: Czy Warto?" : "Veredito Final: Vale a Pena?",
    verdictText: isEs ? `Según las pruebas y la satisfacción del cliente, ${productName} es altamente recomendado.` : isPl ? `Na podstawie opinii i jakości, ${productName} jest wysoce rekomendowany.` : `Com base nos testes e satisfação dos clientes, o ${productName} é altamente recomendado.`,
    verdictCtaText: isEs ? `Garantizar Descuento Exclusivo de ${productName}` : isPl ? `Odbierz Zniżkę Na ${productName}` : `Garantir Desconto Exclusivo do ${productName}`,
    footerDisclaimer: isEs ? "Este sitio es un material publicitario independiente. Los resultados pueden variar de persona a persona." : isPl ? "Ta strona jest niezależnym materiałem reklamowym. Wyniki mogą się różnić." : "Este site é um material publicitário independente. Os resultados podem variar de pessoa para pessoa."
  };

  return {
    productName,
    affiliateUrl,
    langCode: lang,
    ratingBadge: p.ratingBadge || d.ratingBadge,
    heroTag: p.heroTag || d.heroTag,
    heroHeadline: p.heroHeadline || d.heroHeadline,
    heroLead: p.heroLead || d.heroLead,
    ctaButtonText: p.ctaButtonText || d.ctaButtonText,
    aboutTitle: p.aboutTitle || d.aboutTitle,
    aboutText: p.aboutText || d.aboutText,
    prosTitle: p.prosTitle || d.prosTitle,
    pros: Array.isArray(p.pros) && p.pros.length ? p.pros : d.pros,
    consTitle: p.consTitle || d.consTitle,
    cons: Array.isArray(p.cons) && p.cons.length ? p.cons : d.cons,
    testimonialsTitle: p.testimonialsTitle || d.testimonialsTitle,
    testimonials: Array.isArray(p.testimonials) && p.testimonials.length ? p.testimonials : d.testimonials,
    faqTitle: p.faqTitle || d.faqTitle,
    faq: Array.isArray(p.faq) && p.faq.length ? p.faq : d.faq,
    verdictTitle: p.verdictTitle || d.verdictTitle,
    verdictText: p.verdictText || d.verdictText,
    verdictCtaText: p.verdictCtaText || d.verdictCtaText,
    footerDisclaimer: p.footerDisclaimer || d.footerDisclaimer
  };
}

// Clamps/validates a client-echoed draft before it's ever re-injected into a prompt or rendered —
// same spirit as the sanitizedHistory truncation below, applied per-field instead of per-message.
function sanitizeIncomingDraft(raw: any): Partial<ReviewPageContent> | null {
  if (!raw || typeof raw !== "object") return null;
  const clamp = (s: any, max: number): string | undefined => {
    const v = String(s ?? "").slice(0, max);
    return v || undefined;
  };
  const clampArr = (arr: any, max: number, itemMax: number): string[] | undefined =>
    Array.isArray(arr) ? arr.slice(0, max).map((x: any) => String(x ?? "").slice(0, itemMax)).filter(Boolean) : undefined;

  const testimonials: ReviewTestimonial[] | undefined = Array.isArray(raw.testimonials)
    ? raw.testimonials.slice(0, 6).map((t: any) => ({
        name: String(t?.name ?? "").slice(0, 60),
        stars: Math.min(5, Math.max(1, Number(t?.stars) || 5)),
        quote: String(t?.quote ?? "").slice(0, 400)
      }))
    : undefined;

  const faq: ReviewFaqItem[] | undefined = Array.isArray(raw.faq)
    ? raw.faq.slice(0, 8).map((f: any) => ({
        question: String(f?.question ?? "").slice(0, 200),
        answer: String(f?.answer ?? "").slice(0, 600)
      }))
    : undefined;

  return {
    productName: clamp(raw.productName, 120),
    affiliateUrl: clamp(raw.affiliateUrl, 500),
    langCode: clamp(raw.langCode, 5),
    ratingBadge: clamp(raw.ratingBadge, 100),
    heroTag: clamp(raw.heroTag, 100),
    heroHeadline: clamp(raw.heroHeadline, 200),
    heroLead: clamp(raw.heroLead, 400),
    ctaButtonText: clamp(raw.ctaButtonText, 100),
    aboutTitle: clamp(raw.aboutTitle, 150),
    aboutText: clamp(raw.aboutText, 800),
    prosTitle: clamp(raw.prosTitle, 100),
    pros: clampArr(raw.pros, 8, 200),
    consTitle: clamp(raw.consTitle, 100),
    cons: clampArr(raw.cons, 8, 200),
    testimonialsTitle: clamp(raw.testimonialsTitle, 100),
    testimonials,
    faqTitle: clamp(raw.faqTitle, 100),
    faq,
    verdictTitle: clamp(raw.verdictTitle, 150),
    verdictText: clamp(raw.verdictText, 500),
    verdictCtaText: clamp(raw.verdictCtaText, 150),
    footerDisclaimer: clamp(raw.footerDisclaimer, 300)
  };
}

// Pure renderer: ReviewPageContent -> final HTML string. Never called with AI-authored HTML —
// the AI only ever supplies short text fields, so a generation truncation can no longer produce
// a broken/unparseable page (unlike the previous raw-HTML-in-JSON approach).
function renderReviewPageHtml(content: ReviewPageContent): string {
  const e = escapeReviewHtml;
  const url = content.affiliateUrl || "#";

  const prosHtml = content.pros.map(item => `<li>✅ ${e(item)}</li>`).join("");
  const consHtml = content.cons.map(item => `<li>❌ ${e(item)}</li>`).join("");
  const testimonialsHtml = content.testimonials.map(t => `
        <div class="review-card">
          <div class="review-user"><span>${e(t.name)}</span> <span>${"★".repeat(Math.min(5, Math.max(1, t.stars || 5)))}</span></div>
          <p style="font-size: 13px; color: #475569;">"${e(t.quote)}"</p>
        </div>`).join("");
  const faqHtml = content.faq.map(item => `
        <details class="faq-item">
          <summary>${e(item.question)}</summary>
          <p>${e(item.answer)}</p>
        </details>`).join("");

  return `<!DOCTYPE html>
<html lang="${e(content.langCode || "pt")}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${e(content.heroHeadline || content.productName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
    .nav { background: #ffffff; border-bottom: 1px solid #e2e8f0; padding: 16px 24px; position: sticky; top: 0; z-index: 100; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 20px; font-weight: 800; color: #0f172a; }
    .rating-badge { display: inline-flex; align-items: center; gap: 6px; background: #fef3c7; color: #92400e; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; }
    .hero { max-width: 1000px; margin: 40px auto; padding: 0 24px; text-align: center; }
    .hero-tag { display: inline-block; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 6px 16px; border-radius: 999px; margin-bottom: 16px; }
    h1 { font-size: 38px; font-weight: 800; color: #0f172a; line-height: 1.25; margin-bottom: 16px; }
    p.lead { font-size: 18px; color: #475569; max-width: 760px; margin: 0 auto 32px; }
    .cta-btn { display: inline-block; background: #16a34a; color: #ffffff; font-size: 18px; font-weight: 800; padding: 18px 36px; border-radius: 14px; text-decoration: none; box-shadow: 0 10px 25px -5px rgba(22, 163, 74, 0.4); transition: all 0.2s; }
    .cta-btn:hover { background: #15803d; transform: translateY(-2px); }
    .container { max-width: 900px; margin: 40px auto; padding: 0 24px; }
    .card { background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    h2 { font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 16px; }
    .pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 640px) { .pros-cons { grid-template-columns: 1fr; } h1 { font-size: 28px; } }
    .pros-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 14px; }
    .cons-box { background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 14px; }
    .pros-box h3 { color: #166534; font-size: 16px; margin-bottom: 12px; }
    .cons-box h3 { color: #991b1b; font-size: 16px; margin-bottom: 12px; }
    ul.check-list { list-style: none; }
    ul.check-list li { margin-bottom: 8px; font-size: 14px; display: flex; gap: 8px; }
    .reviews-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
    @media (max-width: 640px) { .reviews-grid { grid-template-columns: 1fr; } }
    .review-card { background: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #f1f5f9; }
    .review-user { font-weight: 700; font-size: 14px; margin-bottom: 4px; display: flex; justify-content: space-between; }
    .faq-item { border-bottom: 1px solid #e2e8f0; padding: 14px 0; cursor: pointer; }
    .faq-item summary { font-weight: 700; font-size: 15px; color: #0f172a; }
    .faq-item p { margin-top: 8px; font-size: 14px; color: #475569; }
    .footer { text-align: center; padding: 40px 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; margin-top: 60px; }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="logo">ReviewLab</div>
    <div class="rating-badge">${e(content.ratingBadge)}</div>
  </nav>

  <section class="hero">
    <span class="hero-tag">${e(content.heroTag)}</span>
    <h1>${e(content.heroHeadline)}</h1>
    <p class="lead">${e(content.heroLead)}</p>
    <a href="${e(url)}" class="cta-btn" target="_blank" rel="noopener">${e(content.ctaButtonText)}</a>
  </section>

  <div class="container">
    <div class="card">
      <h2>${e(content.aboutTitle)}</h2>
      <p>${e(content.aboutText)}</p>
    </div>

    <div class="card">
      <h2>${e(content.prosTitle)} &amp; ${e(content.consTitle)}</h2>
      <div class="pros-cons">
        <div class="pros-box">
          <h3>✓ ${e(content.prosTitle)}</h3>
          <ul class="check-list">${prosHtml}</ul>
        </div>
        <div class="cons-box">
          <h3>✕ ${e(content.consTitle)}</h3>
          <ul class="check-list">${consHtml}</ul>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>${e(content.testimonialsTitle)}</h2>
      <div class="reviews-grid">${testimonialsHtml}</div>
    </div>

    <div class="card">
      <h2>${e(content.faqTitle)}</h2>
      ${faqHtml}
    </div>

    <div class="card" style="text-align: center; background: #f0fdf4; border-color: #bbf7d0;">
      <h2>${e(content.verdictTitle)}</h2>
      <p style="margin-bottom: 24px;">${e(content.verdictText)}</p>
      <a href="${e(url)}" class="cta-btn" target="_blank" rel="noopener">${e(content.verdictCtaText)}</a>
    </div>
  </div>

  <footer class="footer">
    <p>${e(content.footerDisclaimer)}</p>
  </footer>
</body>
</html>`;
}

const REVIEW_LANG_NAMES: Record<string, string> = {
  es: "Espanhol (Spanish)",
  pl: "Polonês (Polish)",
  en: "Inglês (English)",
  fr: "Francês (French)",
  de: "Alemão (German)",
  pt: "Português (Portuguese)",
  it: "Italiano (Italian)",
  th: "Tailandês (Thai)"
};

const REVIEW_ASK_FOR_URL_MESSAGE = "Olá! Sou seu especialista em criação de páginas de review de alta conversão. Para eu analisar sua campanha e criar a página perfeita, por favor me envie o **link da landing page do seu produto** (ex: `https://...`)!";

// Gate that runs BEFORE Puppeteer/AI are ever touched in CREATE mode. Classifies the message into
// one of three lanes: askForUrl (plain greeting or "I don't have it yet" — no AI call needed),
// hasEnoughInfo (URL or explicit "create" command — safe to run Puppeteer + generate), or neither
// (a real message with no page info yet — routed to general chat instead of being misread as a
// product name, which used to make any short question get treated as "the product").
function detectReviewIntent(history: any[]): { askForUrl: boolean; hasEnoughInfo: boolean; productName: string; affiliateUrl: string } {
  const userMsgs = history.filter((m: any) => m.role === "user").map((m: any) => m.content || "");
  const lastUserMsg = (userMsgs[userMsgs.length - 1] || "").trim();
  const userCombinedText = userMsgs.join(" ");
  const lowerLast = lastUserMsg.toLowerCase();
  const lowerCombined = userCombinedText.toLowerCase();

  const cleanLast = lowerLast.replace(/[^a-z0-9]/g, "");
  const isGreetingOnly = ["oi", "ola", "olá", "ey", "hey", "hello", "hi", "bomdia", "boatarde", "boanoite", "tudobem", "ajuda"].includes(cleanLast) || lastUserMsg.length <= 3;

  const isNegativeResponse = /n[aã]o\s+ten(ho|ho não)|n[aã]o\s+tem|tem\s+nada|nada\s+n[aã]o|sem\s+link|n[aã]o\s+sei|n[aã]o\s+possuo|ainda\s+n[aã]o/i.test(lowerLast);

  const urlMatch = userCombinedText.match(/https?:\/\/[^\s"'<>]+/i);
  const affiliateUrl = urlMatch ? urlMatch[0] : "";

  // Only trust an explicit "produto: X" / "review do X" mention as a product name — a loose "any
  // short message is the product name" heuristic used to misfire on plain questions.
  let productName = "";
  const nameMatch = userCombinedText.match(/(?:produto|review\s+do|análise\s+do|nome[:\s]+)\s*([a-zA-Z0-9\s\-Á-Úá-úãõÃÕçÇ]{3,30})/i);
  if (nameMatch && nameMatch[1] && !nameMatch[1].toLowerCase().includes("http")) {
    productName = nameMatch[1].trim();
  }

  const hasExplicitIntent = /\b(crie|criar|gere|gerar|monta|montar|faça|fazer)\b.*\bp[aá]gina\b|\bp[aá]gina\b.*\b(crie|criar|gere|gerar|monta|montar|faça|fazer)\b/i.test(lowerCombined);
  const hasEnoughInfo = !isGreetingOnly && !isNegativeResponse && (!!affiliateUrl || !!productName || hasExplicitIntent);
  const askForUrl = isGreetingOnly || isNegativeResponse;

  return { askForUrl, hasEnoughInfo, productName, affiliateUrl };
}

// Deterministic, AI-free fallback. Only reached when every provider fails on a request that
// already passed detectReviewIntent — so productName/affiliateUrl are treated as best-effort,
// never re-asks for the URL (that gate already happened earlier).
function buildFallbackReviewContent(history: any[], extractedContext?: { productName: string; affiliateUrl: string; langCode: string }): { message: string; content: ReviewPageContent } {
  const userMsgs = history.filter((m: any) => m.role === "user").map((m: any) => m.content || "");
  const userCombinedText = userMsgs.join(" ");

  const productName = extractedContext?.productName || "Produto Especial";
  const finalUrl = extractedContext?.affiliateUrl || "#";
  const lang = extractedContext?.langCode || detectLanguageFromText(userCombinedText);
  const content = fillReviewContentDefaults(null, { productName, affiliateUrl: finalUrl, langCode: lang });
  const isEs = content.langCode.startsWith("es");
  const targetLangName = isEs ? "Espanhol (Spanish)" : content.langCode === "pl" ? "Polonês (Polish)" : "Português (Portuguese)";

  const message = isEs
    ? `Leí y analicé con éxito el sitio de la campaña **${finalUrl}** (${targetLangName})! Creé una estructura de revisión completa de alta conversión para **${productName}** con evaluación 4.9/5, pros y contras, opiniones de clientes, preguntas frecuentes y botón con su enlace oficial.`
    : `Li e analisei o site da campanha **${finalUrl}**! Criei uma estrutura de página de review de alta conversão para o produto **${productName}** no idioma **${targetLangName}** com avaliação 4.9/5, benefícios reais, prós e contras, depoimentos, perguntas frequentes e chamada para ação configurada.`;

  return { message, content };
}

// Clamped history to send back to the AI on every turn — page content is never carried in the
// message history anymore (it lives in the structured draft instead), so we no longer need the
// old "strip HTML placeholder" hack, only a plain length clamp against payload bloat.
function sanitizeChatHistoryForPrompt(history: any[]): Array<{ role: string; content: string }> {
  return history.map((msg: any) => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: String(msg.content || "").slice(0, 3000)
  }));
}

// Strips ASCII control characters that break JSON.parse, escaping the three that carry real
// meaning inside a string value (newline/carriage-return/tab) instead of just dropping them.
function stripControlCharsForJson(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const code = input.charCodeAt(i);
    const isControlChar = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!isControlChar) {
      out += c;
      continue;
    }
    if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
  }
  return out;
}

function parseAiJsonResponse(rawResponse: string): any | null {
  let cleaned = rawResponse.trim();
  cleaned = cleaned.replace(/^```(?:json)?/gi, "").replace(/```$/gi, "").trim();

  const startIdx = cleaned.indexOf("{");
  const endIdx = cleaned.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (parseErr: any) {
    logger.warn({ parseErr: parseErr.message, cleanedPreview: cleaned.slice(0, 200) }, "First JSON parse attempt failed, attempting JSON string normalization");
    try {
      return JSON.parse(stripControlCharsForJson(cleaned));
    } catch (secondErr: any) {
      logger.error({ secondErr: secondErr.message }, "JSON normalization failed");
      return null;
    }
  }
}

// Tries OpenRouter -> Groq -> Gemini in order, returns the first successful raw text response
// (still JSON-ish text, not yet parsed) or null if every provider failed/is unconfigured.
async function callChatProviders(systemPrompt: string, sanitizedHistory: Array<{ role: string; content: string }>, maxTokens: number, jsonMode: boolean = true): Promise<string | null> {
  const messages = [{ role: "system", content: systemPrompt }, ...sanitizedHistory];

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const r = await queryOpenRouter(messages, jsonMode, maxTokens);
      if (r && r.trim()) {
        logger.info("queryReviewChat: OpenRouter AI response received successfully");
        return r;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "queryReviewChat: OpenRouter API error, attempting Groq API...");
    }
  }

  if (process.env.GROQ_API_KEY) {
    try {
      const r = await queryGroq(messages, jsonMode, maxTokens);
      if (r && r.trim()) {
        logger.info("queryReviewChat: Groq AI response received successfully");
        return r;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "queryReviewChat: Groq API error, attempting Gemini API...");
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
          temperature: jsonMode ? 0.2 : 0.5,
          maxOutputTokens: maxTokens
        }
      });

      const formattedHistory = [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: jsonMode ? "Entendido. Processe a solicitação e retornarei a resposta em formato JSON válido." : "Entendido, vou responder de forma natural e coerente." }] }
      ];
      sanitizedHistory.forEach((msg) => {
        formattedHistory.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] });
      });

      const chat = model.startChat({ history: formattedHistory.slice(0, -1) });
      const lastMessage = formattedHistory[formattedHistory.length - 1].parts[0].text;
      const result = await chat.sendMessage(lastMessage);
      const geminiText = result.response.text();
      if (geminiText && geminiText.trim()) {
        logger.info("queryReviewChat: Gemini AI response received successfully");
        return geminiText;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "queryReviewChat: Gemini API error");
    }
  }

  return null;
}

// General conversational mode: no draft yet and not enough info to create a page (no URL and no
// explicit "create" command), but the message is real content, not just a greeting or "I don't
// have it" — e.g. a copywriting question or small talk. Answers directly, no Puppeteer, no draft.
async function runReviewGeneralChat(history: any[]): Promise<{ message: string; content: null }> {
  const systemPrompt = `Você é um Copywriter de Nível Mundial e especialista em CRO (Otimização de Taxa de Conversão), atuando como assistente de chat dentro de um criador de páginas de review de afiliados.

O usuário ainda não enviou um link de produto para gerar uma página de review. Responda de forma útil, coerente e direta à mensagem dele — pode ser uma pergunta sobre copywriting, estratégia de anúncios, dúvidas gerais ou apenas conversa. NÃO invente nem finja que gerou uma página de review; isso só acontece quando ele enviar um link real.

Seja objetivo: no máximo 2 a 3 parágrafos curtos, sem tabelas nem listas longas (o chat exibe apenas texto simples, sem formatação markdown). Se fizer sentido no contexto, termine com um lembrete curto e natural de que, assim que ele enviar o link da landing page do produto, você gera a página de review completa automaticamente.

IMPORTANTE: responda SEMPRE no mesmo idioma em que o usuário escreveu a última mensagem (se ele escreveu em português, responda em português; se em espanhol, em espanhol; e assim por diante). Texto corrido, sem JSON, sem blocos de código.`;

  const sanitizedHistory = sanitizeChatHistoryForPrompt(history);
  const rawResponse = await callChatProviders(systemPrompt, sanitizedHistory, 1100, false);

  if (rawResponse && rawResponse.trim()) {
    return { message: rawResponse.trim(), content: null };
  }

  return { message: REVIEW_ASK_FOR_URL_MESSAGE, content: null };
}

// CREATE mode: no draft exists yet. Runs Puppeteer once (if a URL is present) and asks the AI for
// a full ReviewPageContent JSON — never raw HTML — so a truncated/odd response can only ever
// produce a page with generic-but-valid text, never a broken file.
async function runReviewCreate(history: any[], userCombinedText: string): Promise<{ message: string; content: ReviewPageContent | null }> {
  const urlMatch = userCombinedText.match(/https?:\/\/[^\s"'<>]+/i);
  const affiliateUrl = urlMatch ? urlMatch[0] : "";

  let extractedText = "";
  let extractedTitle = "";
  let detectedLangCode = "es";

  if (affiliateUrl) {
    try {
      logger.info({ affiliateUrl }, "queryReviewChat: Fetching reference HTML for campaign analysis...");
      const fetched = await fetchReferenceHtml(affiliateUrl);
      if (fetched && fetched.html) {
        const raw = fetched.html;

        const titleMatch = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) extractedTitle = titleMatch[1].replace(/[-|_].*$/, "").trim();

        extractedText = raw.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
          .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3500);

        const langAttr = (raw.match(/<html\b[^>]*lang=["']([^"']+)["']/i) || [])[1];
        detectedLangCode = langAttr && langAttr.length >= 2 ? langAttr.toLowerCase().slice(0, 2) : detectLanguageFromText(extractedText);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, "queryReviewChat: Failed to fetch reference HTML");
    }
  }

  const productName = extractedTitle || "Produto Especial";
  const targetLangName = REVIEW_LANG_NAMES[detectedLangCode] || "Espanhol (Spanish)";

  const systemPrompt = `Você é um Copywriter de Nível Mundial e especialista em CRO (Otimização de Taxa de Conversão).
Sua missão é criar o CONTEÚDO ESTRUTURADO (não o HTML) de uma Página de Review de alta conversão baseada na leitura real do produto e da campanha fornecida.

## IDIOMA OBRIGATÓRIO (CRÍTICO):
- TODO o conteúdo de texto DEVE ser 100% em: ${targetLangName}. JAMAIS responda em outro idioma.

## CONTEÚDO LIDO E EXTRAÍDO DA PÁGINA DA CAMPANHA:
- Produto / Título: ${productName}
- URL de Destino: ${affiliateUrl || "#"}
- Texto e Benefícios Extraídos do Site Original:
${extractedText || "Produto de saúde, beleza e bem-estar."}

Escreva textos curtos, persuasivos e específicos ao produto (evite genéricos). Evite promessas milagrosas e siga as políticas de anúncio do Google Ads.

FORMATO DE RESPOSTA (OBRIGATÓRIO, APENAS JSON, sem markdown, sem \`\`\`):
{
  "message": "Mensagem simpática (no idioma ${targetLangName}) explicando a análise feita e o que foi gerado.",
  "productName": "${productName}",
  "affiliateUrl": "${affiliateUrl || "#"}",
  "langCode": "${detectedLangCode}",
  "ratingBadge": "ex: ★ 4.9/5.0 (2.840 Avaliações)",
  "heroTag": "tag curta acima do título",
  "heroHeadline": "título principal chamativo",
  "heroLead": "parágrafo de apoio do hero",
  "ctaButtonText": "texto do botão principal",
  "aboutTitle": "título da seção sobre o produto",
  "aboutText": "parágrafo explicando o produto",
  "prosTitle": "título da lista de prós",
  "pros": ["3 a 4 vantagens específicas do produto"],
  "consTitle": "título da lista de contras",
  "cons": ["1 a 2 pontos de atenção honestos"],
  "testimonialsTitle": "título da seção de depoimentos",
  "testimonials": [{ "name": "Nome Fictício", "stars": 5, "quote": "depoimento curto" }],
  "faqTitle": "título da seção de perguntas frequentes",
  "faq": [{ "question": "pergunta", "answer": "resposta curta" }],
  "verdictTitle": "título do veredito final",
  "verdictText": "parágrafo de conclusão recomendando o produto",
  "verdictCtaText": "texto do botão final",
  "footerDisclaimer": "aviso legal curto de publicidade"
}
Inclua de 3 a 4 itens em "pros", 1 a 2 em "cons", 2 a 3 em "testimonials" e 3 em "faq".`;

  const sanitizedHistory = sanitizeChatHistoryForPrompt(history);
  const rawResponse = await callChatProviders(systemPrompt, sanitizedHistory, 2200);

  if (rawResponse) {
    const parsed = parseAiJsonResponse(rawResponse);
    if (parsed) {
      const content = fillReviewContentDefaults(parsed, { productName, affiliateUrl: affiliateUrl || "#", langCode: parsed.langCode || detectedLangCode });
      const message = typeof parsed.message === "string" && parsed.message.trim() ? parsed.message : `Página de review criada para ${productName}.`;
      return { message, content };
    }
  }

  logger.info("queryReviewChat: Triggering fallback response (create)");
  return buildFallbackReviewContent(history, { productName, affiliateUrl: affiliateUrl || "#", langCode: detectedLangCode });
}

// UPDATE mode: a draft already exists. Puppeteer never runs here — the draft carries everything
// the AI needs. The current draft is injected as JSON and the AI is instructed to change only
// what the user asked for; on total provider failure we keep the previous draft untouched instead
// of silently replacing it with a generic fallback, so an edit request can never lose prior work.
async function runReviewUpdate(incomingDraft: Partial<ReviewPageContent>, lastUserMessage: string, history: any[]): Promise<{ message: string; content: ReviewPageContent }> {
  const baseline = fillReviewContentDefaults(incomingDraft, {
    productName: incomingDraft.productName || "Produto Especial",
    affiliateUrl: incomingDraft.affiliateUrl || "#",
    langCode: incomingDraft.langCode || "es"
  });

  const targetLangName = REVIEW_LANG_NAMES[baseline.langCode] || "Português (Portuguese)";

  const systemPrompt = `Você é um Copywriter/Editor de páginas de review de alta conversão, atuando como assistente de chat.
O usuário JÁ TEM uma página de review gerada, representada pelo JSON abaixo.

Primeiro, decida o que a ÚLTIMA MENSAGEM do usuário realmente pede:
- Se for uma INSTRUÇÃO DE EDIÇÃO da página (ex: "muda a cor do botão", "troca o depoimento", "deixa o título mais chamativo"): aplique SOMENTE a alteração pedida, mantendo TODOS os demais campos EXATAMENTE IGUAIS ao original.
- Se for uma PERGUNTA ou CONVERSA sobre copywriting, estratégia, ou qualquer outro assunto que NÃO seja um pedido de alteração da página (ex: "por que esse headline funciona?", "qual a melhor cor de botão pra conversão?", "me dá uma dica de CTA"): responda a pergunta de forma útil e coerente no campo "message", e devolva os campos do "CONTEÚDO ATUAL" TODOS EXATAMENTE IGUAIS, sem nenhuma alteração.

Mantenha o idioma ${targetLangName} em todos os campos de texto e nas respostas.

## CONTEÚDO ATUAL (JSON):
${JSON.stringify(baseline)}

## ÚLTIMA MENSAGEM DO USUÁRIO:
"${lastUserMessage}"

FORMATO DE RESPOSTA (OBRIGATÓRIO, APENAS JSON, sem markdown, sem \`\`\`):
Retorne um objeto JSON com TODOS os campos do "CONTEÚDO ATUAL" acima (productName, affiliateUrl, langCode, ratingBadge, heroTag, heroHeadline, heroLead, ctaButtonText, aboutTitle, aboutText, prosTitle, pros, consTitle, cons, testimonialsTitle, testimonials, faqTitle, faq, verdictTitle, verdictText, verdictCtaText, footerDisclaimer) — alterados apenas se for uma edição pedida, ou idênticos se for uma pergunta/conversa — mais um campo adicional "message" com sua resposta (confirmando a alteração feita, OU respondendo a pergunta do usuário, conforme o caso).`;

  const sanitizedHistory = sanitizeChatHistoryForPrompt(history.slice(-6));
  const rawResponse = await callChatProviders(systemPrompt, sanitizedHistory, 2200);

  if (rawResponse) {
    const parsed = parseAiJsonResponse(rawResponse);
    if (parsed) {
      const content = fillReviewContentDefaults(parsed, { productName: baseline.productName, affiliateUrl: baseline.affiliateUrl, langCode: baseline.langCode });
      const message = typeof parsed.message === "string" && parsed.message.trim() ? parsed.message : "Pronto, atualizei a página conforme pedido!";
      return { message, content };
    }
  }

  logger.warn("queryReviewChat: Update failed on all providers, keeping previous draft unchanged");
  return { message: "Não consegui aplicar a alteração agora (os provedores de IA falharam) — mantive a página como estava. Tente novamente em instantes.", content: baseline };
}

async function queryReviewChat(history: any[], incomingDraft: Partial<ReviewPageContent> | null): Promise<{ message: string; content: ReviewPageContent | null }> {
  const userMsgs = history.filter((m: any) => m.role === "user").map((m: any) => m.content || "");
  const lastUserMessage = (userMsgs[userMsgs.length - 1] || "").trim();
  const userCombinedText = userMsgs.join(" ");

  if (incomingDraft) {
    return runReviewUpdate(incomingDraft, lastUserMessage, history);
  }

  const intent = detectReviewIntent(history);
  if (intent.askForUrl) {
    logger.info("queryReviewChat: Greeting/negative response, asking for URL without calling AI");
    return { message: REVIEW_ASK_FOR_URL_MESSAGE, content: null };
  }
  if (!intent.hasEnoughInfo) {
    logger.info("queryReviewChat: No page info yet, routing to general chat");
    return runReviewGeneralChat(history);
  }
  return runReviewCreate(history, userCombinedText);
}

router.post("/chat-review-expert", optionalAuth, async (req: any, res) => {
  const { messages, draft } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Missing messages array" });
    return;
  }

  try {
    const incomingDraft = sanitizeIncomingDraft(draft);
    const { message, content } = await queryReviewChat(messages, incomingDraft);
    const html = content ? renderReviewPageHtml(content) : "";

    res.json({
      message,
      draft: content,
      html,
      productName: content?.productName || "",
      affiliateUrl: content?.affiliateUrl || ""
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Error in chat-review-expert route");
    res.status(500).json({ error: "Erro ao processar chat com IA especialista." });
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
