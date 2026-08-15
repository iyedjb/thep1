import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT || "3001";
const port = Number(rawPort);
const basePath = process.env.BASE_PATH ?? "/";
const workspaceEnv = loadEnv(
  process.env.NODE_ENV === "production" ? "production" : "development",
  path.resolve(import.meta.dirname, "../.."),
  "",
);

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(
      workspaceEnv.VITE_GOOGLE_CLIENT_ID || workspaceEnv.GOOGLE_CLIENT_ID || "",
    ),
  },
  plugins: [
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
      },
    },
  },
});
