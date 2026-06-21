import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// ── Load .env before anything else ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname_here = path.dirname(__filename);
const paths = [
  path.resolve(__dirname_here, "../../../.env"),
  path.resolve(__dirname_here, "../../.env"),
  path.resolve(process.cwd(), ".env"),
];
let envPath = "";
for (const p of paths) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}
if (envPath) {
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

import app from "./app";
import { logger } from "./lib/logger";
import { initDb } from "./lib/sqlite";
import { seedDb } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initDb();
await seedDb();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
