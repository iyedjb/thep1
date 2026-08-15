import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "../lib/sqlite";
import { LoginBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "ads-intelligence-secret-2026";

type LoginAttempt = {
  failures: number;
  lockLevel: number;
  blockedUntil: number;
  lastAttemptAt: number;
};

const loginAttemptsByIp = new Map<string, LoginAttempt>();
const LOGIN_FAILURES_PER_LOCK = 5;
const LOGIN_LOCK_MINUTES = [5, 10, 15];
const LOGIN_ATTEMPT_TTL = 24 * 60 * 60 * 1000;

function getLoginIp(req: any) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function getActiveLoginBlock(ip: string) {
  const attempt = loginAttemptsByIp.get(ip);
  if (!attempt) return null;
  const now = Date.now();
  if (now - attempt.lastAttemptAt > LOGIN_ATTEMPT_TTL) {
    loginAttemptsByIp.delete(ip);
    return null;
  }
  return attempt.blockedUntil > now ? attempt : null;
}

function registerLoginFailure(ip: string) {
  const now = Date.now();
  const current = loginAttemptsByIp.get(ip) || { failures: 0, lockLevel: 0, blockedUntil: 0, lastAttemptAt: now };
  current.failures += 1;
  current.lastAttemptAt = now;
  if (current.failures >= LOGIN_FAILURES_PER_LOCK) {
    const minutes = LOGIN_LOCK_MINUTES[Math.min(current.lockLevel, LOGIN_LOCK_MINUTES.length - 1)];
    current.failures = 0;
    current.lockLevel = Math.min(current.lockLevel + 1, LOGIN_LOCK_MINUTES.length - 1);
    current.blockedUntil = now + minutes * 60 * 1000;
  }
  loginAttemptsByIp.set(ip, current);
  return current;
}

export async function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    if (!payload.userId) throw new Error("invalid customer token");
    const user = await getDb().prepare("SELECT account_status FROM users WHERE id = ?").get(payload.userId) as any;
    if (!user) {
      res.status(401).json({ error: "Conta não encontrada." });
      return;
    }
    if (user.account_status === "paused" || user.account_status === "banned") {
      res.status(403).json({ error: user.account_status === "banned" ? "Esta conta foi bloqueada." : "Esta conta está temporariamente pausada." });
      return;
    }
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function optionalAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] as string | undefined;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
      req.userId = payload.userId;
    } catch (_) {}
  }
  next();
}

router.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios" });
    return;
  }
  
  // Validate password requirements (at least 8 chars, 1 number, 1 uppercase, 1 special char)
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
  if (!passwordRegex.test(password)) {
    res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres, contendo pelo menos um número, uma letra maiúscula e um caractere especial" });
    return;
  }

  const db = getDb();
  try {
    // Check if user already exists
    const existing = await db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (existing) {
      res.status(400).json({ error: "Já existe um usuário cadastrado com este e-mail" });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
      .run(email, name, passwordHash);
    const userId = Number(result.lastInsertRowid);
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
    
    res.json({
      user: { id: userId, email, name, createdAt: new Date().toISOString() },
      token
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao cadastrar usuário: " + err.message });
  }
});

router.post("/auth/login", async (req, res) => {
  const loginIp = getLoginIp(req);
  const activeBlock = getActiveLoginBlock(loginIp);
  if (activeBlock) {
    const retryAfterSeconds = Math.max(1, Math.ceil((activeBlock.blockedUntil - Date.now()) / 1000));
    res.setHeader("Retry-After", retryAfterSeconds);
    res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${Math.ceil(retryAfterSeconds / 60)} minuto(s).`,
      retryAfterSeconds,
    });
    return;
  }

  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    registerLoginFailure(loginIp);
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parse.data;
  const db = getDb();
  try {
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      const attempt = registerLoginFailure(loginIp);
      if (attempt.blockedUntil > Date.now()) {
        const retryAfterSeconds = Math.max(1, Math.ceil((attempt.blockedUntil - Date.now()) / 1000));
        res.setHeader("Retry-After", retryAfterSeconds);
        res.status(429).json({
          error: `Cinco tentativas incorretas. Acesso bloqueado por ${Math.ceil(retryAfterSeconds / 60)} minuto(s).`,
          retryAfterSeconds,
        });
        return;
      }
      res.status(401).json({ error: "E-mail ou senha incorretos" });
      return;
    }
    if (user.account_status === "paused" || user.account_status === "banned") {
      res.status(403).json({ error: user.account_status === "banned" ? "Esta conta foi bloqueada." : "Esta conta está temporariamente pausada." });
      return;
    }
    loginAttemptsByIp.delete(loginIp);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        subscriptionTier: user.subscription_tier || "free",
        subscriptionStatus: user.subscription_status || "free",
        subscriptionExpiresAt: user.subscription_expires_at || null,
      },
      token,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao realizar login: " + err.message });
  }
});

// Google OAuth Sign-In
router.post("/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: "Google credential is required" });
    return;
  }

  const googleClientId = process.env["GOOGLE_CLIENT_ID"];
  if (!googleClientId) {
    res.status(500).json({ error: "Google OAuth not configured on server" });
    return;
  }

  try {
    // Verify the Google ID token using Google's tokeninfo endpoint (no extra library needed)
    const verifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
    );
    
    if (!verifyResponse.ok) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    const payload = await verifyResponse.json() as {
      sub: string;
      email: string;
      name: string;
      email_verified: string;
      aud: string;
    };

    // Verify the token was issued for our app
    if (payload.aud !== googleClientId) {
      res.status(401).json({ error: "Token not issued for this application" });
      return;
    }

    if (payload.email_verified !== "true") {
      res.status(401).json({ error: "Google email not verified" });
      return;
    }

    const db = getDb();
    
    // Find or create user
    let user = await db.prepare("SELECT * FROM users WHERE email = ?").get(payload.email) as any;
    
    if (!user) {
      // Create new user with a random password hash (they'll use Google to login)
      const randomHash = bcrypt.hashSync(crypto.randomUUID(), 10);
      const result = await db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
        .run(payload.email, payload.name, randomHash);
      user = {
        id: Number(result.lastInsertRowid),
        email: payload.email,
        name: payload.name,
        created_at: new Date().toISOString(),
        subscription_tier: "free",
        subscription_status: "free",
      };
      logger.info({ email: payload.email }, "New user created via Google OAuth");
    }

    if (user.account_status === "paused" || user.account_status === "banned") {
      res.status(403).json({ error: user.account_status === "banned" ? "Esta conta foi bloqueada." : "Esta conta está temporariamente pausada." });
      return;
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        subscriptionTier: user.subscription_tier || "free",
        subscriptionStatus: user.subscription_status || "free",
        subscriptionExpiresAt: user.subscription_expires_at || null,
      },
      token,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Google OAuth verification failed");
    res.status(500).json({ error: "Failed to verify Google token" });
  }
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    const user = await db
      .prepare(
        "SELECT id, email, name, created_at, subscription_tier, subscription_status, subscription_expires_at FROM users WHERE id = ?"
      )
      .get(req.userId) as any;
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
      subscriptionTier: user.subscription_tier || "free",
      subscriptionStatus: user.subscription_status || "free",
      subscriptionExpiresAt: user.subscription_expires_at || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao obter dados do usuário: " + err.message });
  }
});

export default router;
