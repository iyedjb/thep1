import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

let pnpmCmd = "pnpm";
let pnpmArgs: string[] = [];

try {
  execSync("pnpm --version", { stdio: "ignore", shell: true });
} catch {
  pnpmCmd = "npx";
  pnpmArgs = ["pnpm"];
}

interface Service {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  color: string;
}

const services: Service[] = [
  {
    name: "API",
    cwd: path.join(rootDir, "artifacts/api-server"),
    command: pnpmCmd,
    args: [...pnpmArgs, "run", "start"],
    env: { PORT: "3002", NODE_ENV: "development" },
    color: "\x1b[36m", // Cyan
  },
  {
    name: "Sandbox",
    cwd: path.join(rootDir, "artifacts/mockup-sandbox"),
    command: pnpmCmd,
    args: [...pnpmArgs, "run", "dev"],
    env: { PORT: "3000", BASE_PATH: "/" },
    color: "\x1b[35m", // Magenta
  },
  {
    name: "Ads",
    cwd: path.join(rootDir, "artifacts/ads-intelligence"),
    command: pnpmCmd,
    args: [...pnpmArgs, "run", "dev"],
    env: { PORT: process.env.ADS_PORT || "3001" },
    color: "\x1b[32m", // Green
  },
];

const activeProcesses: ChildProcess[] = [];

function log(serviceName: string, color: string, data: string) {
  const lines = data.split("\n");
  for (const line of lines) {
    if (line.trim()) {
      console.log(`${color}[${serviceName}]\x1b[0m ${line}`);
    }
  }
}

async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: isWindows,
    });

    proc.stdout?.on("data", (data) => {
      process.stdout.write(data);
    });

    proc.stderr?.on("data", (data) => {
      process.stderr.write(data);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command ${command} ${args.join(" ")} failed with code ${code}`));
      }
    });
  });
}

async function start() {
  console.log("\x1b[1m\x1b[34m[System] Building API server...\x1b[0m");
  try {
    await runCommand(
      path.join(rootDir, "artifacts/api-server"),
      pnpmCmd,
      [...pnpmArgs, "run", "build"],
      { PORT: "3002", NODE_ENV: "development" }
    );
    console.log("\x1b[1m\x1b[34m[System] API server built successfully.\x1b[0m");
  } catch (error: any) {
    console.error("\x1b[31m[System] API build failed:\x1b[0m", error.message);
    process.exit(1);
  }

  console.log("\x1b[1m\x1b[34m[System] Starting all services...\x1b[0m");

  const isWindows = process.platform === "win32";

  for (const service of services) {
    const proc = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: { ...process.env, ...service.env },
      shell: isWindows,
    });

    activeProcesses.push(proc);

    proc.stdout?.on("data", (data) => {
      log(service.name, service.color, data.toString());
    });

    proc.stderr?.on("data", (data) => {
      log(service.name, service.color, data.toString());
    });

    proc.on("close", (code) => {
      if (code !== null) {
        console.log(`\x1b[31m[System] ${service.name} service stopped with code ${code}\x1b[0m`);
      }
    });
  }
}

function cleanup() {
  console.log("\x1b[1m\x1b[34m[System] Stopping all active services...\x1b[0m");
  for (const proc of activeProcesses) {
    if (proc.pid && !proc.killed) {
      if (process.platform === "win32") {
        try {
          spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
        } catch {
          proc.kill();
        }
      } else {
        proc.kill();
      }
    }
  }
}

process.on("SIGINT", () => {
  console.log("\n\x1b[1m\x1b[34m[System] Received SIGINT (Ctrl+C). Cleaning up...\x1b[0m");
  cleanup();
  setTimeout(() => process.exit(0), 500);
});

process.on("SIGTERM", () => {
  console.log("\n\x1b[1m\x1b[34m[System] Received SIGTERM. Cleaning up...\x1b[0m");
  cleanup();
  setTimeout(() => process.exit(0), 500);
});

start().catch((err) => {
  console.error("\x1b[31m[System] Error starting services:\x1b[0m", err);
  cleanup();
  process.exit(1);
});
