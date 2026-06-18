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
  // Exchange token
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
  const tokenObj = await tokenResponse.json() as any;
  const accessToken = tokenObj.access_token;

  console.log("Token obtained:", accessToken ? "YES" : "NO");

  const methods = ["GET", "POST"];
  const versions = ["v16", "v17"];

  for (const v of versions) {
    for (const m of methods) {
      const url = `https://googleads.googleapis.com/${v}/customers:listAccessibleCustomers`;
      console.log(`\nTesting ${m} on ${url}...`);
      
      const res = await fetch(url, {
        method: m,
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": process.env["GOOGLE_ADS_DEVELOPER_TOKEN"]!,
          "Content-Type": "application/json",
        }
      });

      console.log("Status:", res.status);
      const text = await res.text();
      console.log("Response snippet:", text.slice(0, 300));
    }
  }
}

run().catch(console.error);
