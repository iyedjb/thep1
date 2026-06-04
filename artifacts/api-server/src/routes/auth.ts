import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getDb } from "../lib/sqlite";
import { LoginBody } from "@workspace/api-zod";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "ads-intelligence-secret-2026";

export function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

router.post("/auth/register", (req, res) => {
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
  // Check if user already exists
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (existing) {
    res.status(400).json({ error: "Já existe um usuário cadastrado com este e-mail" });
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
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

router.post("/auth/login", (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parse.data;
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at },
    token,
  });
});

router.post("/auth/logout", (_req, res) => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, (req: any, res) => {
  const db = getDb();
  const user = db.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?").get(req.userId) as any;
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, createdAt: user.created_at });
});

export default router;
