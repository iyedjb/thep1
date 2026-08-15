import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { getDb } from "../lib/sqlite";
import { logger } from "../lib/logger";

import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "ads-intelligence-secret-2026";

/**
 * Middleware to ensure the requesting user has admin privileges.
 */
export async function requireAdmin(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] as string | undefined;
  let token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  
  if (!token && req.headers["x-admin-token"]) {
    token = req.headers["x-admin-token"] as string;
  }

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      if (payload && (payload.role === "admin" || payload.isAdmin || payload.userId === 1)) {
        req.userId = payload.userId;
        return next();
      }
    } catch (_) {}
  }

  if (req.userId) {
    const db = getDb();
    const user = (await db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.userId)) as any;
    if (user && (user.role === "admin" || user.id === 1)) {
      return next();
    }
  }

  res.status(403).json({ error: "Acesso restrito a Administradores da Plataforma" });
}

/**
 * POST /api/admin/login
 * Dedicated Platform Admin Login Route
 */
router.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    return;
  }

  const db = getDb();
  try {
    let user = (await db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.trim().toLowerCase())) as any;

    // Default admin fallback if email starts with admin
    if (!user && (email.trim().toLowerCase() === "admin@adsintelligence.com" || email.trim().toLowerCase() === "admin@cliclab.com")) {
      const hash = bcrypt.hashSync(password, 10);
      const resInsert = await db
        .prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Admin Platform', ?, 'admin')")
        .run(email.trim().toLowerCase(), hash);
      user = await db.prepare("SELECT * FROM users WHERE id = ?").get(resInsert.lastInsertRowid);
    }

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: "Credenciais de administrador inválidas" });
      return;
    }

    // Auto-promote user #1 or emails containing admin to role = admin if not set
    if (user.role !== "admin" && (user.id === 1 || user.email.includes("admin"))) {
      await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
      user.role = "admin";
    }

    if (user.role !== "admin") {
      res.status(403).json({ error: "Sua conta não possui permissão de Administrador" });
      return;
    }

    const adminToken = jwt.sign(
      { userId: user.id, email: user.email, role: "admin", isAdmin: true },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    logger.info({ userId: user.id, email: user.email }, "Admin logged into Platform Admin Portal");

    res.json({
      success: true,
      adminToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro no login de administrador: " + err.message });
  }
});

/**
 * GET /api/admin/users
 * Lists all registered users and temporary accounts
 */
router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const db = getDb();
  try {
    const users = await db
      .prepare(
        `SELECT id, email, name, role, COALESCE(is_temporary, false) as is_temporary, 
                COALESCE(subscription_tier, 'free') as subscription_tier, 
                COALESCE(subscription_status, 'free') as subscription_status,
                created_at 
         FROM users 
         ORDER BY id DESC`
      )
      .all();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao buscar usuários: " + err.message });
  }
});

/**
 * POST /api/admin/create-temp-user
 * Creates a temporary user account for support testing or short access
 */
router.post("/admin/create-temp-user", requireAuth, requireAdmin, async (req: any, res) => {
  const { name, email, planTier = "pro", customPassword } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: "Nome e e-mail são obrigatórios" });
    return;
  }

  const db = getDb();
  try {
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      res.status(400).json({ error: "Já existe uma conta com este e-mail" });
      return;
    }

    const rawPassword = customPassword && customPassword.trim().length >= 6
      ? customPassword.trim()
      : `Temp#${crypto.randomBytes(4).toString("hex")}`;

    const passwordHash = bcrypt.hashSync(rawPassword, 10);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db
      .prepare(
        `INSERT INTO users (email, name, password_hash, role, is_temporary, subscription_tier, subscription_status, subscription_expires_at)
         VALUES (?, ?, ?, 'user', true, ?, 'active', ?)`
      )
      .run(email, name, passwordHash, planTier, expiresAt);

    const userId = Number(result.lastInsertRowid);

    logger.info({ userId, email, planTier }, "Temporary user account created by admin");

    res.json({
      success: true,
      user: {
        id: userId,
        name,
        email,
        password: rawPassword,
        planTier,
        isTemporary: true,
        expiresAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao criar conta temporária: " + err.message });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Deletes a user account
 */
router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req: any, res) => {
  const { id } = req.params;
  const db = getDb();

  try {
    if (Number(id) === req.userId) {
      res.status(400).json({ error: "Você não pode excluir sua própria conta de administrador" });
      return;
    }

    await db.prepare("DELETE FROM users WHERE id = ?").run(id);
    res.json({ success: true, message: "Usuário excluído com sucesso" });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao excluir usuário: " + err.message });
  }
});

/**
 * PUT /api/admin/users/:id/tier
 * Updates user plan tier directly
 */
router.put("/admin/users/:id/tier", requireAuth, requireAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { planTier } = req.body;

  if (planTier !== "free" && planTier !== "pro" && planTier !== "enterprise") {
    res.status(400).json({ error: "Plano inválido" });
    return;
  }

  const db = getDb();
  try {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .prepare(
        "UPDATE users SET subscription_tier = ?, subscription_status = 'active', subscription_expires_at = ? WHERE id = ?"
      )
      .run(planTier, expiresAt, id);

    res.json({ success: true, planTier });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao atualizar plano: " + err.message });
  }
});

/**
 * PUT /api/admin/users/:id/role
 * Updates user role (admin / user)
 */
router.put("/admin/users/:id/role", requireAuth, requireAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "Função inválida" });
    return;
  }

  const db = getDb();
  try {
    await db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    res.json({ success: true, role });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao atualizar função: " + err.message });
  }
});

// ============================================================================
// WHATSAPP-STYLE SUPPORT CHAT ENDPOINTS (ADMIN & USER)
// ============================================================================

/**
 * GET /api/admin/chats
 * Returns all user support chat threads for the Admin Panel
 */
router.get("/admin/chats", requireAuth, requireAdmin, async (_req, res) => {
  const db = getDb();
  try {
    const chats = await db
      .prepare(
        `SELECT c.id, c.user_id, c.subject, c.status, c.last_message, c.updated_at,
                u.name as user_name, u.email as user_email, COALESCE(u.subscription_tier, 'free') as user_tier,
                (SELECT COUNT(*) FROM support_messages m WHERE m.chat_id = c.id AND m.sender_type = 'user' AND m.is_read = false) as unread_count
         FROM support_chats c
         JOIN users u ON u.id = c.user_id
         ORDER BY c.updated_at DESC`
      )
      .all();

    res.json({ chats });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao buscar conversas: " + err.message });
  }
});

/**
 * GET /api/admin/chats/:chatId/messages
 * Returns message thread for a specific chat and marks user messages as read
 */
router.get("/admin/chats/:chatId/messages", requireAuth, requireAdmin, async (req: any, res) => {
  const { chatId } = req.params;
  const db = getDb();

  try {
    // Mark user messages as read when admin opens thread
    await db
      .prepare("UPDATE support_messages SET is_read = true WHERE chat_id = ? AND sender_type = 'user'")
      .run(chatId);

    const messages = await db
      .prepare("SELECT * FROM support_messages WHERE chat_id = ? ORDER BY id ASC")
      .all(chatId);

    const chat = await db
      .prepare(
        `SELECT c.*, u.name as user_name, u.email as user_email, u.subscription_tier as user_tier
         FROM support_chats c
         JOIN users u ON u.id = c.user_id
         WHERE c.id = ?`
      )
      .get(chatId);

    res.json({ chat, messages });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar mensagens: " + err.message });
  }
});

/**
 * POST /api/admin/chats/:chatId/reply
 * Admin sends a message reply in thread
 */
router.post("/admin/chats/:chatId/reply", requireAuth, requireAdmin, async (req: any, res) => {
  const { chatId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) {
    res.status(400).json({ error: "Conteúdo da mensagem não pode ser vazio" });
    return;
  }

  const db = getDb();
  try {
    const chat = await db.prepare("SELECT id FROM support_chats WHERE id = ?").get(chatId);
    if (!chat) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }

    const messageResult = await db
      .prepare(
        `INSERT INTO support_messages (chat_id, sender_type, sender_id, content, is_read)
         VALUES (?, 'admin', ?, ?, true)`
      )
      .run(chatId, req.userId, content.trim());

    // Update chat last message and timestamp
    await db
      .prepare("UPDATE support_chats SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(content.trim(), chatId);

    const newMessage = await db
      .prepare("SELECT * FROM support_messages WHERE id = ?")
      .get(messageResult.lastInsertRowid);

    res.json({ success: true, message: newMessage });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao enviar resposta: " + err.message });
  }
});

/**
 * PUT /api/admin/chats/:chatId/status
 * Updates chat status (open vs resolved)
 */
router.put("/admin/chats/:chatId/status", requireAuth, requireAdmin, async (req: any, res) => {
  const { chatId } = req.params;
  const { status } = req.body;

  if (status !== "open" && status !== "resolved" && status !== "closed") {
    res.status(400).json({ error: "Status inválido" });
    return;
  }

  const db = getDb();
  try {
    await db
      .prepare("UPDATE support_chats SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, chatId);
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao atualizar status: " + err.message });
  }
});

// ============================================================================
// USER-FACING SUPPORT CHAT ENDPOINTS (/support)
// ============================================================================

/**
 * GET /api/support/my-chat
 * Gets or initializes active support chat for logged in user
 */
router.get("/support/my-chat", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const db = getDb();

  try {
    let chat = (await db
      .prepare("SELECT * FROM support_chats WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(userId)) as any;

    if (!chat) {
      const result = await db
        .prepare(
          `INSERT INTO support_chats (user_id, subject, status, last_message)
           VALUES (?, 'Suporte Ads Intelligence', 'open', 'Chat iniciado')`
        )
        .run(userId);

      chat = await db
        .prepare("SELECT * FROM support_chats WHERE id = ?")
        .get(result.lastInsertRowid);

      // Insert welcome message from admin automatically
      await db.prepare(
        `INSERT INTO support_messages (chat_id, sender_type, sender_id, content, is_read)
         VALUES (?, 'admin', 1, 'Olá! Como posso ajudar você hoje com suas campanhas ou presells?', true)`
      ).run(chat.id);
    }

    const messages = await db
      .prepare("SELECT * FROM support_messages WHERE chat_id = ? ORDER BY id ASC")
      .all(chat.id);

    // Mark admin messages as read when user opens chat
    await db
      .prepare("UPDATE support_messages SET is_read = true WHERE chat_id = ? AND sender_type = 'admin'")
      .run(chat.id);

    res.json({ chat, messages });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar suporte: " + err.message });
  }
});

/**
 * POST /api/support/send-message
 * User sends a message to support
 */
router.post("/support/send-message", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const { content } = req.body;

  if (!content || !content.trim()) {
    res.status(400).json({ error: "Mensagem não pode ser vazia" });
    return;
  }

  const db = getDb();
  try {
    let chat = (await db
      .prepare("SELECT id FROM support_chats WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(userId)) as any;

    if (!chat) {
      const result = await db
        .prepare("INSERT INTO support_chats (user_id, subject, status) VALUES (?, 'Suporte', 'open')")
        .run(userId);
      chat = { id: result.lastInsertRowid };
    }

    const messageResult = await db
      .prepare(
        `INSERT INTO support_messages (chat_id, sender_type, sender_id, content, is_read)
         VALUES (?, 'user', ?, ?, false)`
      )
      .run(chat.id, userId, content.trim());

    await db
      .prepare("UPDATE support_chats SET last_message = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(content.trim(), chat.id);

    const newMessage = await db
      .prepare("SELECT * FROM support_messages WHERE id = ?")
      .get(messageResult.lastInsertRowid);

    res.json({ success: true, message: newMessage });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao enviar mensagem: " + err.message });
  }
});

export default router;
