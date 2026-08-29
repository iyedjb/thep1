import { Router } from "express";
import { requireAuth } from "./auth";
import { getDb } from "../lib/sqlite";
import {
  OAUTH_SCOPES, authenticateOAuthToken, createAuthorizationCode, exchangeAuthorizationCode,
  getOAuthClient, mcpResource, oauthIssuer, parseScopes, randomSecret, registerOAuthClient,
  requireRequestedScopes, revokeOAuthToken, rotateRefreshToken, validRedirectUri,
} from "../lib/oauth";

const router = Router();

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function oauthError(res: any, error: string, description: string, status = 400) {
  res.set("Cache-Control", "no-store");
  res.status(status).json({ error, error_description: description });
}

function consentHtml(clientName: string, request: Record<string, string>, scopes: string[]) {
  const scopeLabels: Record<string, string> = {
    openid: "Confirmar sua identidade", email: "Ver o e-mail da sua conta",
    "tracking:read": "Consultar rastreamento, países e dispositivos",
    "campaigns:read": "Consultar campanhas e desempenho",
    "postbacks:read": "Consultar leads, aprovações e pagamentos",
    "pages:read": "Consultar páginas publicadas",
  };
  const safeRequest = jsonForScript(request);
  const loginReturnTo = `/login?returnTo=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(request).toString()}`)}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar ao ClicLab</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f9fc;color:#0f1d3d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:24px}.shell{width:min(100%,480px)}.brand{font-size:22px;font-weight:850;letter-spacing:-.7px;margin:0 0 24px}.brand span{color:#19a7f2}.card{background:#fff;border:1px solid #e5ebf3;border-radius:28px;padding:32px;box-shadow:0 24px 70px rgba(15,29,61,.08)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:1.7px;color:#168ee3;font-weight:800}.title{font-size:27px;letter-spacing:-.8px;margin:10px 0 8px}.muted{color:#6c7b95;font-size:14px;line-height:1.6;margin:0}.client{margin:22px 0;border:1px solid #e8edf4;border-radius:18px;padding:16px;display:flex;gap:12px;align-items:center}.icon{width:40px;height:40px;border-radius:14px;background:#eaf7ff;color:#119be9;display:grid;place-items:center;font-weight:800}.client b{display:block;font-size:14px}.client small{color:#7d8ba3}.permissions{border-top:1px solid #edf1f6;border-bottom:1px solid #edf1f6;padding:10px 0;margin:20px 0}.permission{display:flex;gap:10px;padding:9px 0;font-size:13px;color:#42516b}.check{color:#13a97e;font-weight:900}.account{border-radius:16px;background:#f5f9fd;padding:13px 15px;margin-bottom:18px;font-size:12px;color:#63738d}.account b{color:#172542}.actions{display:grid;gap:10px}.button{border:0;border-radius:999px;height:48px;font-weight:750;font-size:14px;cursor:pointer}.primary{background:#23a4ee;color:#fff}.secondary{background:#fff;border:1px solid #dfe6ef;color:#53627a}.button:disabled{opacity:.55;cursor:wait}.error{display:none;background:#fff1f2;color:#be123c;border-radius:14px;padding:12px 14px;font-size:12px;margin-bottom:14px}.foot{text-align:center;color:#93a0b4;font-size:11px;margin-top:18px;line-height:1.5}
  </style></head><body><main class="shell"><div class="brand">Clic<span>Lab</span></div><section class="card"><div class="eyebrow">Conexão segura</div><h1 class="title">Conectar sua conta</h1><p class="muted"><strong>${escapeHtml(clientName)}</strong> quer acessar informações da sua conta ClicLab.</p><div class="client"><div class="icon">AI</div><div><b>${escapeHtml(clientName)}</b><small>Integração via ChatGPT e MCP</small></div></div><div class="permissions">${scopes.map((scope) => `<div class="permission"><span class="check">✓</span><span>${escapeHtml(scopeLabels[scope] || scope)}</span></div>`).join("")}</div><div id="error" class="error"></div><div id="account" class="account">Verificando sua sessão ClicLab…</div><div class="actions"><button id="approve" class="button primary" disabled>Autorizar conexão</button><button id="deny" class="button secondary" disabled>Cancelar</button></div><p class="foot">Você pode revogar o acesso a qualquer momento. O ClicLab nunca compartilha sua senha com o ChatGPT.</p></section></main><script>
  const authRequest=${safeRequest};const loginUrl=${jsonForScript(loginReturnTo)};let token=localStorage.getItem('ads_token');const account=document.getElementById('account'),errorBox=document.getElementById('error'),approve=document.getElementById('approve'),deny=document.getElementById('deny');
  function fail(message){errorBox.textContent=message;errorBox.style.display='block'}
  async function session(){if(!token){window.location.assign(loginUrl);return}const response=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token}});if(!response.ok){localStorage.removeItem('ads_token');window.location.assign(loginUrl);return}const user=await response.json();account.innerHTML='Conectando como <b>'+String(user.name||user.email).replace(/[&<>]/g,'')+'</b><br>'+String(user.email||'').replace(/[&<>]/g,'');approve.disabled=false;deny.disabled=false}
  async function decide(approved){approve.disabled=true;deny.disabled=true;try{const response=await fetch('/oauth/decision',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...authRequest,approved})});const data=await response.json();if(!response.ok)throw new Error(data.error_description||data.error||'Não foi possível concluir a conexão.');window.location.assign(data.redirectTo)}catch(error){fail(error.message);approve.disabled=false;deny.disabled=false}}
  approve.onclick=()=>decide(true);deny.onclick=()=>decide(false);session().catch(()=>window.location.assign(loginUrl));
  </script></body></html>`;
}

router.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({ resource: mcpResource(), authorization_servers: [oauthIssuer()], scopes_supported: OAUTH_SCOPES, resource_documentation: `${oauthIssuer()}/privacy.html` });
});

router.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const issuer = oauthIssuer();
  res.json({
    issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: OAUTH_SCOPES,
  });
});

router.post("/oauth/register", async (req, res) => {
  const clientName = String(req.body?.client_name || "ChatGPT").trim().slice(0, 160);
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
  if (!clientName || !redirectUris.length || redirectUris.length > 10 || redirectUris.some((uri: string) => !validRedirectUri(uri))) {
    return void oauthError(res, "invalid_client_metadata", "Informe redirect_uris HTTPS válidos.");
  }
  if (req.body?.token_endpoint_auth_method && req.body.token_endpoint_auth_method !== "none") {
    return void oauthError(res, "invalid_client_metadata", "Este servidor aceita clientes públicos com PKCE.");
  }
  const clientId = await registerOAuthClient({ clientName, redirectUris });
  res.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: clientName, redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
});

router.get("/oauth/authorize", async (req, res) => {
  try {
    const request = Object.fromEntries(Object.entries(req.query).map(([key, value]) => [key, String(value || "")])) as Record<string, string>;
    const client = await getOAuthClient(request.client_id || "");
    if (!client || !client.redirectUris.includes(request.redirect_uri) || request.response_type !== "code") throw new Error("Solicitação OAuth inválida.");
    if (request.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(request.code_challenge || "")) throw new Error("PKCE S256 é obrigatório.");
    const scopes = requireRequestedScopes(request.scope);
    if ((request.resource || mcpResource()).replace(/\/$/, "") !== mcpResource()) throw new Error("Recurso MCP inválido.");
    request.resource = mcpResource();
    res.set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.set("Cache-Control", "no-store").type("html").send(consentHtml(client.client_name, request, scopes));
  } catch (error: any) {
    res.status(400).type("html").send(`<h1>Não foi possível iniciar a conexão</h1><p>${escapeHtml(error.message)}</p>`);
  }
});

router.post("/oauth/decision", requireAuth, async (req: any, res) => {
  try {
    const clientId = String(req.body?.client_id || "");
    const redirectUri = String(req.body?.redirect_uri || "");
    const state = String(req.body?.state || "");
    const client = await getOAuthClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri) || req.body?.response_type !== "code") return void oauthError(res, "invalid_request", "Cliente ou redirecionamento inválido.");
    const redirect = new URL(redirectUri);
    if (!req.body?.approved) {
      redirect.searchParams.set("error", "access_denied");
      if (state) redirect.searchParams.set("state", state);
      return void res.json({ redirectTo: redirect.toString() });
    }
    if (req.body?.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(String(req.body?.code_challenge || ""))) return void oauthError(res, "invalid_request", "PKCE S256 é obrigatório.");
    const scopes = requireRequestedScopes(req.body?.scope);
    const resource = String(req.body?.resource || mcpResource()).replace(/\/$/, "");
    if (resource !== mcpResource()) return void oauthError(res, "invalid_target", "Recurso MCP inválido.");
    const code = await createAuthorizationCode({ clientId, userId: req.userId, redirectUri, scopes, resource, codeChallenge: String(req.body.code_challenge) });
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    res.set("Cache-Control", "no-store").json({ redirectTo: redirect.toString() });
  } catch (error: any) { oauthError(res, error.message === "invalid_scope" ? "invalid_scope" : "invalid_request", "Não foi possível autorizar esta conexão."); }
});

router.post("/oauth/token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const grantType = String(req.body?.grant_type || "");
  const clientId = String(req.body?.client_id || "");
  const client = await getOAuthClient(clientId);
  if (!client) return void oauthError(res, "invalid_client", "Cliente não reconhecido.", 401);
  const resource = String(req.body?.resource || mcpResource()).replace(/\/$/, "");
  if (resource !== mcpResource()) return void oauthError(res, "invalid_target", "Recurso MCP inválido.");
  const pair = grantType === "authorization_code"
    ? await exchangeAuthorizationCode({ code: String(req.body?.code || ""), clientId, redirectUri: String(req.body?.redirect_uri || ""), codeVerifier: String(req.body?.code_verifier || ""), resource })
    : grantType === "refresh_token"
      ? await rotateRefreshToken({ refreshToken: String(req.body?.refresh_token || ""), clientId, resource })
      : undefined;
  if (pair === undefined) return void oauthError(res, "unsupported_grant_type", "Use authorization_code ou refresh_token.");
  if (!pair) return void oauthError(res, "invalid_grant", "Código ou refresh token inválido.");
  res.json({ access_token: pair.accessToken, token_type: "Bearer", expires_in: pair.expiresIn, refresh_token: pair.refreshToken, scope: pair.scopes.join(" ") });
});

router.post("/oauth/revoke", async (req, res) => {
  await revokeOAuthToken(String(req.body?.token || ""));
  res.status(200).end();
});

router.get("/oauth/userinfo", async (req, res) => {
  const access = await authenticateOAuthToken(req.headers.authorization);
  if (!access || !access.scopes.includes("openid")) return void oauthError(res, "invalid_token", "Token inválido.", 401);
  const user = await getDb().prepare("SELECT id, email, name FROM users WHERE id = ?").get(access.userId) as any;
  res.json({ sub: String(user.id), name: user.name, ...(access.scopes.includes("email") ? { email: user.email, email_verified: true } : {}) });
});

router.get("/oauth/health", (_req, res) => res.json({ ok: true, issuer: oauthIssuer(), resource: mcpResource(), nonce: randomSecret(8) }));

router.get("/api/oauth/connections", requireAuth, async (req: any, res) => {
  const rows = await getDb().prepare(
    `SELECT t.client_id, c.client_name, t.scope, MAX(t.created_at) AS connected_at
     FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
     WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
     GROUP BY t.client_id, c.client_name, t.scope ORDER BY connected_at DESC`
  ).all(req.userId) as any[];
  res.json({ connections: rows.map((row) => ({ clientId: row.client_id, clientName: row.client_name || "ChatGPT", scopes: parseScopes(row.scope), connectedAt: row.connected_at })) });
});

router.delete("/api/oauth/connections/:clientId", requireAuth, async (req: any, res) => {
  await getDb().prepare("UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL").run(req.userId, String(req.params.clientId));
  res.status(204).end();
});

export default router;
