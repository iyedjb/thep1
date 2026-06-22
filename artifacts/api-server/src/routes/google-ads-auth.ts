import { Router } from "express";
import jwt from "jsonwebtoken";
import { GoogleAdsApi } from "google-ads-api";
import { requireAuth } from "./auth";
import {
  deleteGoogleAdsConnection,
  saveGoogleAdsConnection,
  selectGoogleAdsCustomer,
} from "../lib/google-ads-connections";

const router = Router();
const SCOPE = "https://www.googleapis.com/auth/adwords";

function sessionSecret() {
  return process.env["SESSION_SECRET"] ?? "ads-intelligence-secret-2026";
}

function appCredentials() {
  const clientId = process.env["GOOGLE_ADS_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_ADS_CLIENT_SECRET"];
  const developerToken = process.env["GOOGLE_ADS_DEVELOPER_TOKEN"];
  if (!clientId || !clientSecret || !developerToken) {
    throw new Error("Google Ads application credentials are not configured");
  }
  return { clientId, clientSecret, developerToken };
}

function callbackUrl(req: any) {
  if (process.env["GOOGLE_ADS_REDIRECT_URI"]) return process.env["GOOGLE_ADS_REDIRECT_URI"];
  const port = process.env.PORT || "3002";
  return `http://localhost:${port}/api/auth/google-ads/callback`;
}

function safeReturnOrigin(value: unknown) {
  if (typeof value !== "string") return "http://localhost:3011";
  try {
    const url = new URL(value);
    const allowedProductionOrigin = process.env["FRONTEND_URL"];
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || value === allowedProductionOrigin) {
      return url.origin;
    }
  } catch {}
  return process.env["FRONTEND_URL"] || "http://localhost:3011";
}

router.get("/auth/google-ads/connect", requireAuth, (req: any, res) => {
  try {
    const { clientId } = appCredentials();
    const returnOrigin = safeReturnOrigin(req.query.returnOrigin);
    const state = jwt.sign(
      { userId: req.userId, purpose: "google-ads", returnOrigin },
      sessionSecret(),
      { expiresIn: "10m" },
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl(req),
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state,
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/auth/google-ads/callback", async (req: any, res) => {
  let returnOrigin = process.env["FRONTEND_URL"] || "http://localhost:3011";
  try {
    if (req.query.error) throw new Error(String(req.query.error));
    const payload = jwt.verify(String(req.query.state || ""), sessionSecret()) as {
      userId: number;
      purpose: string;
      returnOrigin: string;
    };
    if (payload.purpose !== "google-ads") throw new Error("Invalid OAuth state");
    returnOrigin = safeReturnOrigin(payload.returnOrigin);
    const { clientId, clientSecret, developerToken } = appCredentials();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(req.query.code || ""),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl(req),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json() as { refresh_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.refresh_token) {
      throw new Error(tokens.error_description || "Google did not return a refresh token");
    }

    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });
    const accessible = await client.listAccessibleCustomers(tokens.refresh_token);
    const customerIds = (accessible.resource_names || []).map((name: string) => name.split("/").pop() || "").filter(Boolean);
    if (customerIds.length === 0) throw new Error("No Google Ads accounts are available for this Google user");
    await saveGoogleAdsConnection(payload.userId, tokens.refresh_token, customerIds);
    res.redirect(`${returnOrigin}/dashboard?googleAds=connected`);
  } catch (error: any) {
    res.redirect(`${returnOrigin}/dashboard?googleAds=error&message=${encodeURIComponent(error.message)}`);
  }
});

router.post("/auth/google-ads/select-account", requireAuth, async (req: any, res) => {
  const selected = await selectGoogleAdsCustomer(req.userId, String(req.body.customerId || ""));
  if (!selected) {
    res.status(400).json({ error: "Conta do Google Ads inválida" });
    return;
  }
  res.json({ success: true });
});

router.delete("/auth/google-ads/connection", requireAuth, async (req: any, res) => {
  await deleteGoogleAdsConnection(req.userId);
  res.status(204).send();
});

export default router;
