import { fetchReferenceHtml, inlinePageAssets } from "../../artifacts/api-server/src/routes/generator.ts";
import fs from "fs";
import path from "path";

async function main() {
  const referenceUrl = "https://adsssite.com/view/18303?flow=NGYxNTM4YzktMzg5Yi00YjQzLWFjZTctNDI2YTdjY2FhM2M1&bunch=98b71887-f771-4454-a784-d8a6ed041ed5";
  console.log("Fetching reference HTML and cookies...");
  const { html, cookies } = await fetchReferenceHtml(referenceUrl);
  console.log("HTML length:", html.length);
  console.log("Cookies:", cookies);
  
  if (!html) {
    throw new Error("Could not fetch landing page!");
  }

  console.log("Inlining assets...");
  const finalHtml = await inlinePageAssets(html, referenceUrl, cookies);
  console.log("Inlining complete. Final HTML length:", finalHtml.length);

  const outputPath = path.resolve(process.cwd(), "C:\\Users\\hssilva4\\.gemini\\antigravity-ide\\scratch\\inlined_result_ts.html");
  fs.writeFileSync(outputPath, finalHtml, "utf8");
  console.log("Result saved to:", outputPath);
}

main().catch(err => {
  console.error("Test failed:", err);
});
