/**
 * Google Ads OAuth2 Refresh Token Generator
 *
 * Run this script ONCE to generate a refresh token for Google Ads API access.
 *
 * It will:
 * 1. Open your browser to Google's authorization page
 * 2. Start a local server on port 8888 to catch the redirect
 * 3. Exchange the auth code for a refresh token
 * 4. Print the refresh token and automatically write it to .env
 */

import http from "http";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Load .env manually before anything else
const __dirname0 = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR0 = path.resolve(__dirname0, "../..");
const ENV_FILE0 = path.resolve(ROOT_DIR0, ".env");
if (fs.existsSync(ENV_FILE0)) {
  const lines = fs.readFileSync(ENV_FILE0, "utf-8").split("\n");
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const ENV_FILE = path.resolve(ROOT_DIR, ".env");

// ── Read credentials from .env ──────────────────────────────────────────────
function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(ENV_FILE)) return env;
  const lines = fs.readFileSync(ENV_FILE, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function writeRefreshToken(token: string) {
  let content = fs.readFileSync(ENV_FILE, "utf-8");
  if (content.includes("GOOGLE_ADS_REFRESH_TOKEN=")) {
    content = content.replace(
      /GOOGLE_ADS_REFRESH_TOKEN=.*/,
      `GOOGLE_ADS_REFRESH_TOKEN=${token}`
    );
  } else {
    content += `\nGOOGLE_ADS_REFRESH_TOKEN=${token}\n`;
  }
  fs.writeFileSync(ENV_FILE, content, "utf-8");
  console.log("\n✅ Refresh token saved to .env automatically!");
}

// ── OAuth configuration ──────────────────────────────────────────────────────
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth-callback`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

async function main() {
  const env = readEnv();
  const clientId = env["GOOGLE_ADS_CLIENT_ID"];
  const clientSecret = env["GOOGLE_ADS_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    console.error("❌ GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET must be set in .env");
    process.exit(1);
  }

  const existingToken = env["GOOGLE_ADS_REFRESH_TOKEN"];
  if (existingToken) {
    console.log("✅ GOOGLE_ADS_REFRESH_TOKEN already set in .env:");
    console.log(`   ${existingToken.slice(0, 20)}...`);
    console.log("\nIf you need a new token, clear it from .env and run again.");
    process.exit(0);
  }

  // Build the authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // Force showing the consent screen to always get a refresh token
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  console.log("━".repeat(60));
  console.log("🔐 Google Ads OAuth2 — Gerador de Refresh Token");
  console.log("━".repeat(60));
  console.log("\n📋 Client ID:", clientId.slice(0, 30) + "...");
  console.log("🌐 Redirect URI:", REDIRECT_URI);
  console.log("\n⏳ Iniciando servidor local na porta", REDIRECT_PORT, "...");

  // Start a local server to catch the redirect
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/oauth-callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html><body style="font-family:sans-serif;padding:40px;background:#fee;text-align:center">
            <h2>❌ Erro na autorização</h2>
            <p style="color:#c00">${error}</p>
            <p>Feche esta aba e tente novamente.</p>
          </body></html>
        `);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end("Missing code");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><body style="font-family:sans-serif;padding:40px;background:#efffef;text-align:center">
          <h2 style="color:#0a0">✅ Autorização bem-sucedida!</h2>
          <p>Você pode fechar esta aba e voltar ao terminal.</p>
          <p style="color:#666;font-size:13px">Gerando refresh token...</p>
        </body></html>
      `);
      server.close();
      resolve(code);
    });

    server.listen(REDIRECT_PORT, () => {
      console.log("✅ Servidor local pronto!\n");
      console.log("🚀 Abrindo o browser para autorização...");
      console.log("\n   Se não abrir automaticamente, acesse:");
      console.log("   " + authUrl);
      console.log("");

      // Open browser (Windows)
      const platform = process.platform;
      const cmd =
        platform === "win32" ? `start "${authUrl}"` :
        platform === "darwin" ? `open "${authUrl}"` :
        `xdg-open "${authUrl}"`;

      exec(cmd, (err) => {
        if (err) {
          console.log("⚠️  Não foi possível abrir o browser automaticamente.");
          console.log("   Por favor, abra manualmente a URL acima.");
        }
      });

      console.log("⏳ Aguardando autorização no browser...\n");
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${REDIRECT_PORT} is already in use. Kill the process using it and try again.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Timeout: no authorization received after 5 minutes"));
    }, 5 * 60 * 1000);
  });

  // Exchange the authorization code for tokens
  console.log("🔄 Trocando authorization code por tokens...\n");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${tokenResponse.status} — ${errorBody}`);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  if (!tokens.refresh_token) {
    console.error("❌ No refresh token received from Google.");
    console.error("   This happens when the app was already authorized without 'prompt=consent'.");
    console.error("   Go to https://myaccount.google.com/permissions and revoke access, then try again.");
    process.exit(1);
  }

  console.log("━".repeat(60));
  console.log("✅ SUCESSO! Refresh Token gerado:");
  console.log("━".repeat(60));
  console.log("\n🔑 GOOGLE_ADS_REFRESH_TOKEN:");
  console.log(tokens.refresh_token);
  console.log("");

  // Save to .env automatically
  writeRefreshToken(tokens.refresh_token);

  console.log("\n📋 Scope autorizado:", tokens.scope);
  console.log("\n🎉 Tudo pronto! Agora você pode usar a Google Ads API.");
  console.log("   Reinicie o servidor: npx tsx server/index\n");
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message);
  process.exit(1);
});
