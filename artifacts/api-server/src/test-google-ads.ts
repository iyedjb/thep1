import { GoogleAdsApi } from "google-ads-api";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../../.env"); // Dist/src are relative

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
    console.log("\nAttempting to exchange refresh token for access token manually...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env["GOOGLE_ADS_CLIENT_ID"]!,
        client_secret: process.env["GOOGLE_ADS_CLIENT_SECRET"]!,
        refresh_token: process.env["GOOGLE_ADS_REFRESH_TOKEN"]!,
        grant_type: "refresh_token",
      }),
    });

    const status = tokenResponse.status;
    const body = await tokenResponse.text();
    console.log("OAuth response status:", status);
    console.log("OAuth response body:", body);

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed with status ${status}`);
    }

    console.log("OAuth credentials are valid!");

    console.log("OAuth credentials are valid!");

    const realCustomerId = "1569903086";
    console.log(`\nAttempting to query campaigns for customer ${realCustomerId}...`);
    const customer = client.Customer({
      customer_id: realCustomerId,
      login_customer_id: realCustomerId,
      refresh_token: process.env["GOOGLE_ADS_REFRESH_TOKEN"]!,
    });

    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM campaign
      LIMIT 10
    `);
    console.log("Success! Real campaigns returned:", JSON.stringify(campaigns, null, 2));
  } catch (error: any) {
    console.error("Query failed:", error.message || error);
    if (error.status) console.error("HTTP status:", error.status);
    if (error.details) console.error("Details:", JSON.stringify(error.details, null, 2));
  }
}

testConnection();
