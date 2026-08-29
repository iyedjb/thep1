import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "../lib/sqlite";
import { LoginBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import crypto from "crypto";

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
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_SECONDS = 45;
const OTP_MAX_ATTEMPTS = 5;

function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function otpHash(challengeToken: string, code: string) {
  return crypto.createHmac("sha256", JWT_SECRET).update(`${challengeToken}:${code}`).digest("hex");
}

function createOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function dateValue(value: unknown) {
  const raw = String(value || "");
  return new Date(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`).getTime();
}

function maskedEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

async function sendLoginCode(email: string, name: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const safeName = escapeEmailHtml(name || "Olá");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "ClicLab <onboarding@resend.dev>",
      to: [email],
      subject: `${code} é o seu código ClicLab`,
      text: `Seu código de verificação ClicLab é ${code}. Ele expira em 10 minutos. Se você não tentou entrar, ignore esta mensagem.`,
      html: `<!doctype html><html><body style="margin:0;background:#f5f8fc;font-family:Inter,Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #e6edf5;border-radius:24px;overflow:hidden"><tr><td style="padding:32px 36px"><div style="font-size:20px;font-weight:800;letter-spacing:-.5px">Clic<span style="color:#09a7ee">Lab</span></div><div style="height:1px;background:#edf2f7;margin:26px 0"></div><p style="margin:0 0 8px;font-size:14px;color:#64748b">Olá, ${safeName}</p><h1 style="margin:0;font-size:25px;line-height:1.25;letter-spacing:-.6px">Confirme seu acesso</h1><p style="margin:12px 0 24px;font-size:14px;line-height:1.65;color:#64748b">Use o código abaixo para concluir seu login. Ele expira em 10 minutos.</p><div style="padding:20px;border-radius:16px;background:#f0f9ff;text-align:center;font-size:34px;font-weight:800;letter-spacing:8px;color:#0284c7">${code}</div><p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">Se você não tentou entrar, pode ignorar esta mensagem. Nunca compartilhe este código.</p></td></tr></table></td></tr></table></body></html>`,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
}

function authResult(user: any) {
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  return {
    user: {
      id: user.id, email: user.email, name: user.name, createdAt: user.created_at,
      subscriptionTier: user.subscription_tier || "free",
      subscriptionStatus: user.subscription_status || "free",
      subscriptionExpiresAt: user.subscription_expires_at || null,
    },
    token,
  };
}

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
    const recent = await db.prepare(
      "SELECT last_sent_at FROM login_otp_challenges WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1"
    ).get(user.id) as any;
    if (recent && Date.now() - dateValue(recent.last_sent_at) < OTP_RESEND_SECONDS * 1000) {
      res.status(429).json({ error: `Aguarde ${OTP_RESEND_SECONDS} segundos antes de solicitar outro código.` });
      return;
    }
    await db.prepare("DELETE FROM login_otp_challenges WHERE user_id = ?").run(user.id);
    const challengeToken = crypto.randomUUID();
    const code = createOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    await db.prepare(
      "INSERT INTO login_otp_challenges (token, user_id, code_hash, attempts_remaining, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(challengeToken, user.id, otpHash(challengeToken, code), OTP_MAX_ATTEMPTS, expiresAt);
    try {
      await sendLoginCode(user.email, user.name, code);
    } catch (emailError: any) {
      await db.prepare("DELETE FROM login_otp_challenges WHERE token = ?").run(challengeToken);
      logger.error({ err: emailError.message }, "Unable to send login verification code");
      res.status(503).json({ error: "Não foi possível enviar o código de verificação agora." });
      return;
    }
    res.json({ requiresOtp: true, challengeToken, maskedEmail: maskedEmail(user.email), expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: OTP_RESEND_SECONDS });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao realizar login: " + err.message });
  }
});

router.post("/auth/verify-otp", async (req, res) => {
  const challengeToken = String(req.body?.challengeToken || "");
  const code = String(req.body?.code || "").replace(/\D/g, "");
  if (!/^[0-9a-f-]{36}$/i.test(challengeToken) || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Digite o código de 6 números." });
    return;
  }
  try {
    const db = getDb();
    const challenge = await db.prepare(
      `SELECT c.token, c.code_hash, c.attempts_remaining, c.expires_at,
              u.id, u.email, u.name, u.created_at, u.account_status,
              u.subscription_tier, u.subscription_status, u.subscription_expires_at
       FROM login_otp_challenges c JOIN users u ON u.id = c.user_id
       WHERE c.token = ? AND c.consumed_at IS NULL`
    ).get(challengeToken) as any;
    if (!challenge || dateValue(challenge.expires_at) <= Date.now() || Number(challenge.attempts_remaining) <= 0) {
      res.status(410).json({ error: "Este código expirou. Volte e solicite um novo." });
      return;
    }
    const supplied = Buffer.from(otpHash(challengeToken, code), "hex");
    const expected = Buffer.from(String(challenge.code_hash), "hex");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      await db.prepare("UPDATE login_otp_challenges SET attempts_remaining = attempts_remaining - 1 WHERE token = ?").run(challengeToken);
      const remaining = Number(challenge.attempts_remaining) - 1;
      res.status(401).json({ error: remaining > 0 ? `Código incorreto. ${remaining} tentativa(s) restante(s).` : "Código bloqueado. Solicite outro." });
      return;
    }
    if (challenge.account_status === "paused" || challenge.account_status === "banned") {
      res.status(403).json({ error: "Este acesso não está disponível." });
      return;
    }
    await db.prepare("UPDATE login_otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE token = ?").run(challengeToken);
    res.json(authResult(challenge));
  } catch (error: any) {
    logger.error({ err: error.message }, "Unable to verify login code");
    res.status(500).json({ error: "Não foi possível verificar o código." });
  }
});

router.post("/auth/resend-otp", async (req, res) => {
  const challengeToken = String(req.body?.challengeToken || "");
  try {
    const db = getDb();
    const challenge = await db.prepare(
      `SELECT c.*, u.email, u.name FROM login_otp_challenges c JOIN users u ON u.id = c.user_id
       WHERE c.token = ? AND c.consumed_at IS NULL`
    ).get(challengeToken) as any;
    if (!challenge) return void res.status(404).json({ error: "Verificação não encontrada." });
    const elapsed = Date.now() - dateValue(challenge.last_sent_at);
    if (elapsed < OTP_RESEND_SECONDS * 1000) {
      res.status(429).json({ error: `Aguarde ${Math.ceil(OTP_RESEND_SECONDS - elapsed / 1000)} segundos.` });
      return;
    }
    const code = createOtp();
    await sendLoginCode(challenge.email, challenge.name, code);
    await db.prepare(
      "UPDATE login_otp_challenges SET code_hash = ?, attempts_remaining = ?, expires_at = ?, last_sent_at = CURRENT_TIMESTAMP WHERE token = ?"
    ).run(otpHash(challengeToken, code), OTP_MAX_ATTEMPTS, new Date(Date.now() + OTP_TTL_MS).toISOString(), challengeToken);
    res.json({ ok: true, expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: OTP_RESEND_SECONDS });
  } catch (error: any) {
    logger.error({ err: error.message }, "Unable to resend login code");
    res.status(503).json({ error: "Não foi possível reenviar o código agora." });
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
