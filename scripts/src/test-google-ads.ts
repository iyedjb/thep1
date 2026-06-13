import { GoogleAdsApi } from "google-ads-api";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

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

async function testConnection() {
  console.log("Configured environment variables:");
  console.log("CLIENT_ID:", process.env["GOOGLE_ADS_CLIENT_ID"]);
  console.log("DEVELOPER_TOKEN:", process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]);
  console.log("CUSTOMER_ID:", process.env["GOOGLE_ADS_CUSTOMER_ID"]);
  console.log("LOGIN_CUSTOMER_ID:", process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]);

  if (
    !process.env["GOOGLE_ADS_CLIENT_ID"] ||
    !process.env["GOOGLE_ADS_CLIENT_SECRET"] ||
    !process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ||
    !process.env["GOOGLE_ADS_REFRESH_TOKEN"] ||
    !process.env["GOOGLE_ADS_CUSTOMER_ID"]
  ) {
    console.error("Missing Google Ads credentials in .env");
    return;
  }

  const client = new GoogleAdsApi({
    client_id: process.env["GOOGLE_ADS_CLIENT_ID"]!,
    client_secret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
    developer_token: process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
  });

  const customerId = process.env["GOOGLE_ADS_CUSTOMER_ID"]!.replace(/-/g, "");
  const loginCustomerId = process.env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"]?.replace(/-/g, "") || customerId;

  const customer = client.Customer({
    customer_id: customerId,
    login_customer_id: loginCustomerId,
    refresh_token: process.env["GOOGLE_ADS_REFRESH_TOKEN"]!,
  });

  try {
    console.log("\nAttempting to query campaigns from Google Ads...");
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM campaign
      LIMIT 10
    `);
    console.log("Success! Campaigns returned:", JSON.stringify(campaigns, null, 2));
  } catch (error: any) {
    console.error("Google Ads query failed:", error);
  }
}

testConnection();
