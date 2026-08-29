import crypto from "crypto";
import { getDb } from "./sqlite";

export const OAUTH_SCOPES = [
  "openid",
  "email",
  "tracking:read",
  "campaigns:read",
  "postbacks:read",
  "pages:read",
] as const;

export type OAuthScope = typeof OAUTH_SCOPES[number];
export type OAuthAccess = { userId: number; clientId: string; scopes: OAuthScope[]; resource: string };

export function oauthIssuer() {
  return String(process.env.OAUTH_ISSUER || process.env.PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3002").replace(/\/$/, "");
}

export function mcpResource() {
  return String(process.env.MCP_PUBLIC_URL || `${oauthIssuer()}/mcp`).replace(/\/$/, "");
}

export function hashSecret(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function parseDatabaseDate(value: unknown) {
  if (value instanceof Date) return value;
  const raw = String(value || "");
  return new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
}

export function parseScopes(value: unknown): OAuthScope[] {
  const requested = String(value || "").split(/\s+/).filter(Boolean);
  return [...new Set(requested.filter((scope): scope is OAuthScope => OAUTH_SCOPES.includes(scope as OAuthScope)))];
}

export function requireRequestedScopes(value: unknown) {
  const raw = String(value || "").split(/\s+/).filter(Boolean);
  const scopes = parseScopes(value);
  if (!raw.length || raw.some((scope) => !OAUTH_SCOPES.includes(scope as OAuthScope))) {
    throw new Error("invalid_scope");
  }
  return scopes;
}

export function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch { return false; }
}

export async function getOAuthClient(clientId: string) {
  const client = await getDb().prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as any;
  if (!client) return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(String(client.redirect_uris || "[]")); } catch {}
  return { ...client, redirectUris };
}

export async function registerOAuthClient(input: { clientName: string; redirectUris: string[] }) {
  const clientId = `cliclab_${randomSecret(24)}`;
  await getDb().prepare(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method) VALUES (?, ?, ?, 'none')"
  ).run(clientId, input.clientName, JSON.stringify(input.redirectUris));
  return clientId;
}

export async function createAuthorizationCode(input: {
  clientId: string; userId: number; redirectUri: string; scopes: OAuthScope[]; resource: string; codeChallenge: string;
}) {
  const code = randomSecret(32);
  await getDb().prepare(
    `INSERT INTO oauth_authorization_codes
      (code_hash, client_id, user_id, redirect_uri, scope, resource, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(hashSecret(code), input.clientId, input.userId, input.redirectUri, input.scopes.join(" "), input.resource, input.codeChallenge, new Date(Date.now() + 5 * 60_000).toISOString());
  return code;
}

function pkceMatches(verifier: string, expectedChallenge: string) {
  const actual = crypto.createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(expectedChallenge);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function issueTokenPair(userId: number, clientId: string, scopes: OAuthScope[], resource: string) {
  const accessToken = `clat_${randomSecret(32)}`;
  const refreshToken = `clrt_${randomSecret(40)}`;
  const accessExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const db = getDb();
  await db.prepare(
    "INSERT INTO oauth_tokens (token_hash, token_type, client_id, user_id, scope, resource, expires_at) VALUES (?, 'access', ?, ?, ?, ?, ?)"
  ).run(hashSecret(accessToken), clientId, userId, scopes.join(" "), resource, accessExpiresAt);
  await db.prepare(
    "INSERT INTO oauth_tokens (token_hash, token_type, client_id, user_id, scope, resource, expires_at) VALUES (?, 'refresh', ?, ?, ?, ?, ?)"
  ).run(hashSecret(refreshToken), clientId, userId, scopes.join(" "), resource, refreshExpiresAt);
  return { accessToken, refreshToken, expiresIn: 3600, scopes };
}

export async function exchangeAuthorizationCode(input: {
  code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string;
}) {
  const db = getDb();
  const record = await db.prepare("SELECT * FROM oauth_authorization_codes WHERE code_hash = ?").get(hashSecret(input.code)) as any;
  if (!record || record.used_at || record.client_id !== input.clientId || record.redirect_uri !== input.redirectUri || record.resource !== input.resource) return null;
  if (parseDatabaseDate(record.expires_at).getTime() <= Date.now() || !pkceMatches(input.codeVerifier, String(record.code_challenge))) return null;
  const consumed = await db.prepare("UPDATE oauth_authorization_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").run(record.id);
  if (!consumed.changes) return null;
  return issueTokenPair(Number(record.user_id), record.client_id, parseScopes(record.scope), record.resource);
}

export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; resource: string }) {
  const db = getDb();
  const record = await db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh'").get(hashSecret(input.refreshToken)) as any;
  if (!record || record.revoked_at || record.client_id !== input.clientId || record.resource !== input.resource || parseDatabaseDate(record.expires_at).getTime() <= Date.now()) return null;
  const revoked = await db.prepare("UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").run(record.id);
  if (!revoked.changes) return null;
  return issueTokenPair(Number(record.user_id), record.client_id, parseScopes(record.scope), record.resource);
}

export async function authenticateOAuthToken(authorization: unknown): Promise<OAuthAccess | null> {
  const value = String(authorization || "");
  if (!value.startsWith("Bearer ")) return null;
  const record = await getDb().prepare(
    "SELECT user_id, client_id, scope, resource, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'"
  ).get(hashSecret(value.slice(7))) as any;
  if (!record || record.revoked_at || record.resource !== mcpResource() || parseDatabaseDate(record.expires_at).getTime() <= Date.now()) return null;
  const user = await getDb().prepare("SELECT account_status FROM users WHERE id = ?").get(record.user_id) as any;
  if (!user || user.account_status === "paused" || user.account_status === "banned") return null;
  return { userId: Number(record.user_id), clientId: String(record.client_id), scopes: parseScopes(record.scope), resource: String(record.resource) };
}

export async function revokeOAuthToken(token: string) {
  await getDb().prepare("UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL").run(hashSecret(token));
}

export async function auditMcp(access: OAuthAccess, toolName: string, success: boolean, durationMs: number) {
  try {
    await getDb().prepare("INSERT INTO mcp_audit_logs (user_id, client_id, tool_name, success, duration_ms) VALUES (?, ?, ?, ?, ?)")
      .run(access.userId, access.clientId, toolName, success, Math.max(0, Math.round(durationMs)));
  } catch {}
}
