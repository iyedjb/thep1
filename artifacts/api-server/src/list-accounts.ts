import { GoogleAdsApi } from "google-ads-api";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../../.env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    if (val && !process.env[key]) process.env[key] = val;
  }
}

async function run() {
  const client = new GoogleAdsApi({
    client_id: process.env["GOOGLE_ADS_CLIENT_ID"]!,
    client_secret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
    developer_token: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
  });

  try {
    console.log("Listing accessible customers using GoogleAdsApi client library...");
    const customers = await client.listAccessibleCustomers(
      process.env["GOOGLE_ADS_REFRESH_TOKEN"]!
    );
    console.log("Accessible customers:", customers);
  } catch (err: any) {
    console.error("Error listing customers:", err.message || err);
    if (err.details) console.error("Details:", JSON.stringify(err.details, null, 2));
  }
}

run();
