import puppeteer from 'puppeteer';

async function main() {
  console.log("Launching Puppeteer...");
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    console.log("Navigating to https://example.com ...");
    await page.goto("https://example.com", { waitUntil: "networkidle2" });
    const screenshot = await page.screenshot({ fullPage: true });
    console.log("Screenshot captured successfully! Length:", screenshot.length);
    await browser.close();
  } catch (err) {
    console.error("Puppeteer failed:", err);
  }
}

main();
