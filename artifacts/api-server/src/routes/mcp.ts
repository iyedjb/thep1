import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateOAuthToken, mcpResource, oauthIssuer } from "../lib/oauth";
import { createClicLabMcpServer } from "../lib/mcp-server";
import { logger } from "../lib/logger";

const router = Router();

function unauthorized(res: any) {
  res.set("WWW-Authenticate", `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource", scope="openid tracking:read campaigns:read postbacks:read pages:read"`);
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Authentication required" }, id: null });
}

router.post("/mcp", async (req, res) => {
  const access = await authenticateOAuthToken(req.headers.authorization);
  if (!access) return void unauthorized(res);
  const server = createClicLabMcpServer(access);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => { void transport.close(); void server.close(); });
  } catch (error: any) {
    logger.error({ err: error.message, userId: access.userId }, "Unable to handle MCP request");
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

router.get("/mcp", async (req, res) => {
  const access = await authenticateOAuthToken(req.headers.authorization);
  if (!access) return void unauthorized(res);
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST for this stateless MCP endpoint." }, id: null });
});

router.delete("/mcp", async (req, res) => {
  const access = await authenticateOAuthToken(req.headers.authorization);
  if (!access) return void unauthorized(res);
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "This MCP endpoint is stateless." }, id: null });
});

router.get("/mcp/health", (_req, res) => res.json({ ok: true, name: "cliclab", version: "1.0.0", resource: mcpResource() }));

export default router;
