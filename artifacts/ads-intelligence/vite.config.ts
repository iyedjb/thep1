import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { Plugin } from "vite";

const rawPort = process.env.PORT || "3001";
const port = Number(rawPort);
const basePath = process.env.BASE_PATH ?? "/";
const workspaceEnv = loadEnv(
  process.env.NODE_ENV === "production" ? "production" : "development",
  path.resolve(import.meta.dirname, "../.."),
  "",
);

const appRoutes = new Set(["api", "login", "signup", "admin", "creator", "tracking", "domains", "pricing", "checkout", "support", "traffic-manager", "trends", "google-trends", "dashboard", "campaigns", "keywords", "reports", "drcash", "src", "assets", "node_modules"]);

function campaignPageProxy(): Plugin {
  const handler = async (req: any, res: any, next: () => void) => {
    const pathname = String(req.url || "/").split("?")[0].replace(/^\/+|\/+$/g, "");
    const parts = pathname.split("/");
    if (!pathname || parts.length > 2 || appRoutes.has(parts[0]) || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(parts[0]) || (parts[1] && !/^[a-zA-Z0-9._-]+$/.test(parts[1]))) return next();
    try {
      const upstream = await fetch(`http://localhost:3002/api/public${req.url}`, {
        headers: {
          "user-agent": String(req.headers["user-agent"] || ""),
          "referer": String(req.headers.referer || ""),
          "x-forwarded-host": String(req.headers.host || ""),
          "x-forwarded-proto": "http",
          "x-forwarded-for": String(req.socket?.remoteAddress || ""),
        },
      });
      res.statusCode = upstream.status;
      upstream.headers.forEach((value, key) => {
        if (!new Set(["content-encoding", "content-length", "transfer-encoding"]).has(key.toLowerCase())) res.setHeader(key, value);
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.statusCode = 502;
      res.end("Não foi possível abrir esta página.");
    }
  };
  return {
    name: "campaign-page-proxy",
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(
      workspaceEnv.VITE_GOOGLE_CLIENT_ID || workspaceEnv.GOOGLE_CLIENT_ID || "",
    ),
  },
  plugins: [
    campaignPageProxy(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
