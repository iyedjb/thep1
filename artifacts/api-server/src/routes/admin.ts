import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { requireAuth } from "./auth";
import { getDb } from "../lib/sqlite";
import { logger } from "../lib/logger";

const router = Router();
const JWT_SECRET = process.env["SESSION_SECRET"] ?? "ads-intelligence-secret-2026";
const ADMIN_PERMISSIONS = ["dashboard.view", "clients.view", "clients.manage", "cashbox.view", "cashbox.manage", "payments.view", "audit.view", "access.manage"] as const;
type AdminPermission = typeof ADMIN_PERMISSIONS[number];

function parsePermissions(raw: unknown): AdminPermission[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter((item): item is AdminPermission => ADMIN_PERMISSIONS.includes(item)) : [];
  } catch { return []; }
}
function normalizeEmail(value: unknown) { return String(value || "").trim().toLowerCase(); }
async function audit(adminId: number, action: string, targetType?: string, targetId?: string | number | bigint, details?: unknown) {
  try {
    const actor = await getDb().prepare("SELECT name, email FROM admin_accounts WHERE id = ?").get(adminId) as any;
    const auditDetails = { ...(details && typeof details === "object" ? details as Record<string, unknown> : {}), actor: actor ? { name: actor.name, email: actor.email } : undefined };
    await getDb().prepare("INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(adminId, action, targetType || null, targetId == null ? null : String(targetId), JSON.stringify(auditDetails));
  } catch (error) { logger.warn({ error, adminId, action }, "Could not write admin audit log"); }
}
function utcDateKey(date: Date) { return date.toISOString().slice(0, 10); }
function utcMonthKey(date: Date) { return date.toISOString().slice(0, 7); }
function parseDatabaseDate(value: unknown) {
  const raw = String(value || "");
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw);
}
function adminPayload(account: any) {
  return {
    id: Number(account.id), email: account.email, name: account.name, roleName: account.role_name,
    isOwner: Boolean(account.is_owner),
    permissions: account.is_owner ? [...ADMIN_PERMISSIONS] : parsePermissions(account.permissions),
    active: Boolean(account.active), createdAt: account.created_at,
  };
}

export async function requireAdmin(req: any, res: any, next: any) {
  const auth = req.headers.authorization as string | undefined;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) return void res.status(401).json({ error: "Sessão administrativa necessária." });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!payload?.adminAccountId) throw new Error("invalid token");
    const account = await getDb().prepare("SELECT * FROM admin_accounts WHERE id = ?").get(payload.adminAccountId) as any;
    if (!account || !account.active) return void res.status(403).json({ error: "Este acesso administrativo está desativado." });
    req.admin = adminPayload(account);
    req.adminId = Number(account.id);
    next();
  } catch { res.status(401).json({ error: "Sessão administrativa inválida ou expirada." }); }
}
function requirePermission(permission: AdminPermission) {
  return (req: any, res: any, next: any) => {
    if (req.admin?.isOwner || req.admin?.permissions?.includes(permission)) return next();
    res.status(403).json({ error: "Seu perfil não possui permissão para esta ação." });
  };
}

router.get("/admin/setup-status", async (_req, res) => {
  try {
    const row = await getDb().prepare("SELECT COUNT(*) as count FROM admin_accounts").get() as any;
    res.json({ configured: Number(row?.count || 0) > 0 });
  } catch (err: any) { res.status(500).json({ error: "Erro ao verificar configuração: " + err.message }); }
});

router.post("/admin/setup", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (name.length < 2 || !email.includes("@") || password.length < 8) return void res.status(400).json({ error: "Informe nome, e-mail válido e senha com pelo menos 8 caracteres." });
  const db = getDb();
  try {
    const row = await db.prepare("SELECT COUNT(*) as count FROM admin_accounts").get() as any;
    if (Number(row?.count || 0) > 0) return void res.status(409).json({ error: "A configuração inicial já foi concluída." });
    const result = await db.prepare(
      "INSERT INTO admin_accounts (email, name, password_hash, role_name, permissions, is_owner, active) VALUES (?, ?, ?, 'Proprietário', ?, true, true)"
    ).run(email, name, bcrypt.hashSync(password, 12), JSON.stringify(ADMIN_PERMISSIONS));
    const account = await db.prepare("SELECT * FROM admin_accounts WHERE id = ?").get(result.lastInsertRowid) as any;
    await audit(Number(account.id), "admin.owner.created", "admin_account", account.id, { roleName: "Proprietário" });
    const token = jwt.sign({ adminAccountId: Number(account.id) }, JWT_SECRET, { expiresIn: "7d" });
    logger.info({ adminId: account.id }, "Initial admin owner configured");
    res.status(201).json({ adminToken: token, admin: adminPayload(account) });
  } catch (err: any) { res.status(500).json({ error: "Erro ao criar o acesso proprietário: " + err.message }); }
});

router.post("/admin/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email || !password) return void res.status(400).json({ error: "E-mail e senha são obrigatórios." });
  try {
    const account = await getDb().prepare("SELECT * FROM admin_accounts WHERE email = ?").get(email) as any;
    if (!account || !bcrypt.compareSync(password, account.password_hash)) return void res.status(401).json({ error: "E-mail ou senha incorretos." });
    if (!account.active) return void res.status(403).json({ error: "Este acesso administrativo foi desativado." });
    const token = jwt.sign({ adminAccountId: Number(account.id) }, JWT_SECRET, { expiresIn: "7d" });
    await audit(Number(account.id), "admin.login", "admin_account", account.id);
    res.json({ adminToken: token, admin: adminPayload(account) });
  } catch (err: any) { res.status(500).json({ error: "Erro ao entrar: " + err.message }); }
});

router.get("/admin/session", requireAdmin, (req: any, res) => res.json({ admin: req.admin }));

router.get("/admin/dashboard", requireAdmin, requirePermission("dashboard.view"), async (_req, res) => {
  const db = getDb();
  try {
    const customers = await db.prepare("SELECT COUNT(*) as count FROM users WHERE COALESCE(role, 'user') != 'admin'").get() as any;
    const active = await db.prepare("SELECT COUNT(*) as count FROM users WHERE COALESCE(role, 'user') != 'admin' AND subscription_status = 'active' AND account_status = 'active'").get() as any;
    const revenue = await db.prepare("SELECT COALESCE(SUM(transaction_amount), 0) as total FROM payments WHERE status = 'approved'").get() as any;
    const approvedPayments = await db.prepare("SELECT transaction_amount, created_at FROM payments WHERE status = 'approved'").all() as any[];
    const dailyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();
    approvedPayments.forEach((payment) => {
      const date = parseDatabaseDate(payment.created_at);
      if (Number.isNaN(date.getTime())) return;
      dailyMap.set(utcDateKey(date), (dailyMap.get(utcDateKey(date)) || 0) + Number(payment.transaction_amount || 0));
      monthlyMap.set(utcMonthKey(date), (monthlyMap.get(utcMonthKey(date)) || 0) + Number(payment.transaction_amount || 0));
    });
    const now = new Date();
    const revenueDaily = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (29 - index)));
      const key = utcDateKey(date);
      return { date: key, label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }), total: dailyMap.get(key) || 0 };
    });
    const revenueMonthly = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1));
      const key = utcMonthKey(date);
      return { month: key, label: date.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", ""), total: monthlyMap.get(key) || 0 };
    });
    res.json({ metrics: { customers: Number(customers?.count || 0), revenue: Number(revenue?.total || 0), activeSubscriptions: Number(active?.count || 0) }, revenueDaily, revenueMonthly });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar o dashboard: " + err.message }); }
});

router.get("/admin/users", requireAdmin, requirePermission("clients.view"), async (_req, res) => {
  try {
    const users = await getDb().prepare(
      `SELECT u.id, u.email, u.name, COALESCE(u.subscription_tier, 'free') as subscription_tier,
              COALESCE(u.subscription_status, 'free') as subscription_status, COALESCE(u.account_status, 'active') as account_status,
              u.subscription_expires_at, u.created_at, (SELECT COUNT(*) FROM payments p WHERE p.user_id = u.id AND p.status = 'approved') as approved_payments
       FROM users u WHERE COALESCE(u.role, 'user') != 'admin' ORDER BY u.id DESC`
    ).all();
    res.json({ users });
  } catch (err: any) { res.status(500).json({ error: "Erro ao buscar clientes: " + err.message }); }
});

router.get("/admin/users/:id", requireAdmin, requirePermission("clients.view"), async (req, res) => {
  const db = getDb();
  try {
    const user = await db.prepare(
      "SELECT id, email, name, COALESCE(subscription_tier, 'free') as subscription_tier, COALESCE(subscription_status, 'free') as subscription_status, COALESCE(account_status, 'active') as account_status, subscription_expires_at, created_at FROM users WHERE id = ?"
    ).get(req.params.id) as any;
    if (!user) return void res.status(404).json({ error: "Cliente não encontrado." });
    const payments = await db.prepare("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.id);
    const chat = await db.prepare("SELECT * FROM support_chats WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.params.id) as any;
    const messages = chat ? await db.prepare("SELECT * FROM support_messages WHERE chat_id = ? ORDER BY id ASC").all(chat.id) : [];
    res.json({ user, payments, chat: chat || null, messages });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar o cliente: " + err.message }); }
});

router.post("/admin/create-temp-user", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const planTier = String(req.body?.planTier || "free");
  if (!name || !email.includes("@") || !["free", "starter", "pro", "enterprise"].includes(planTier)) return void res.status(400).json({ error: "Dados do cliente inválidos." });
  const db = getDb();
  try {
    if (await db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return void res.status(409).json({ error: "Este e-mail já está cadastrado." });
    const rawPassword = String(req.body?.customPassword || "").trim() || `Temp#${crypto.randomBytes(4).toString("hex")}`;
    if (rawPassword.length < 8) return void res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
    const expiresAt = planTier === "free" ? null : new Date(Date.now() + 30 * 86400000).toISOString();
    const result = await db.prepare(
      "INSERT INTO users (email, name, password_hash, role, is_temporary, subscription_tier, subscription_status, subscription_expires_at, account_status) VALUES (?, ?, ?, 'user', true, ?, ?, ?, 'active')"
    ).run(email, name, bcrypt.hashSync(rawPassword, 10), planTier, planTier === "free" ? "free" : "active", expiresAt);
    await audit(req.adminId, "client.created", "user", result.lastInsertRowid, { name, email, planTier });
    res.status(201).json({ user: { id: Number(result.lastInsertRowid), email, name, password: rawPassword, planTier } });
  } catch (err: any) { res.status(500).json({ error: "Erro ao criar cliente: " + err.message }); }
});

router.put("/admin/users/:id/tier", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const planTier = String(req.body?.planTier || "");
  if (!["free", "starter", "pro", "enterprise"].includes(planTier)) return void res.status(400).json({ error: "Plano inválido." });
  const expiresAt = planTier === "free" ? null : new Date(Date.now() + 30 * 86400000).toISOString();
  const db = getDb();
  const target = await db.prepare("SELECT name, email FROM users WHERE id = ?").get(req.params.id) as any;
  await db.prepare("UPDATE users SET subscription_tier = ?, subscription_status = ?, subscription_expires_at = ? WHERE id = ?").run(planTier, planTier === "free" ? "free" : "active", expiresAt, req.params.id);
  await audit(req.adminId, "client.plan.updated", "user", req.params.id, { planTier, targetName: target?.name, targetEmail: target?.email });
  res.json({ success: true, planTier });
});
router.put("/admin/users/:id/status", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const status = String(req.body?.status || "");
  if (!["active", "paused", "banned"].includes(status)) return void res.status(400).json({ error: "Status inválido." });
  const db = getDb();
  const target = await db.prepare("SELECT name, email FROM users WHERE id = ?").get(req.params.id) as any;
  await db.prepare("UPDATE users SET account_status = ? WHERE id = ?").run(status, req.params.id);
  await audit(req.adminId, "client.status.updated", "user", req.params.id, { status, targetName: target?.name, targetEmail: target?.email });
  res.json({ success: true, status });
});
router.delete("/admin/users/:id", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const db = getDb();
  const target = await db.prepare("SELECT name, email FROM users WHERE id = ? AND COALESCE(role, 'user') != 'admin'").get(req.params.id) as any;
  await db.prepare("DELETE FROM users WHERE id = ? AND COALESCE(role, 'user') != 'admin'").run(req.params.id);
  await audit(req.adminId, "client.deleted", "user", req.params.id, { targetName: target?.name, targetEmail: target?.email });
  res.json({ success: true });
});

router.get("/admin/payments", requireAdmin, requirePermission("payments.view"), async (_req, res) => {
  try {
    const payments = await getDb().prepare("SELECT p.*, u.name as user_name, u.email as user_email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 250").all() as any[];
    const approved = payments.filter((item) => item.status === "approved");
    res.json({ summary: { approvedRevenue: approved.reduce((sum, item) => sum + Number(item.transaction_amount || 0), 0), approvedCount: approved.length, pendingCount: payments.filter((item) => item.status === "pending").length }, payments });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar pagamentos: " + err.message }); }
});

router.get("/admin/cashbox", requireAdmin, requirePermission("cashbox.view"), async (_req, res) => {
  try {
    const db = getDb();
    const approvedPayments = await db.prepare(
      `SELECT id, transaction_amount as amount, COALESCE(payment_method_id, 'checkout') as payment_method,
              plan_tier, created_at FROM payments WHERE status = 'approved' ORDER BY created_at DESC`
    ).all() as any[];
    const manual = await db.prepare("SELECT * FROM cash_ledger ORDER BY movement_date DESC, id DESC").all() as any[];
    const movements = [
      ...approvedPayments.map((payment) => ({ id: `payment-${payment.id}`, source: "payment", movement_type: "entry", amount: Number(payment.amount || 0), description: `Checkout ${payment.plan_tier || ""}`.trim(), category: "Assinaturas", payment_method: payment.payment_method || "checkout", movement_date: String(payment.created_at).slice(0, 10), created_at: payment.created_at })),
      ...manual.map((item) => ({ ...item, id: `manual-${item.id}`, source: "manual", amount: Number(item.amount || 0) })),
    ].sort((a, b) => String(b.movement_date).localeCompare(String(a.movement_date)));
    const entries = movements.filter((item) => item.movement_type === "entry").reduce((sum, item) => sum + item.amount, 0);
    const exits = movements.filter((item) => item.movement_type === "exit").reduce((sum, item) => sum + item.amount, 0);
    const now = new Date();
    const seriesMap = new Map<string, { month: string; label: string; entries: number; exits: number }>();
    Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1))).forEach((date) => {
      const month = utcMonthKey(date);
      seriesMap.set(month, { month, label: date.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", ""), entries: 0, exits: 0 });
    });
    const methodMap = new Map<string, number>();
    movements.forEach((item) => {
      const month = String(item.movement_date).slice(0, 7);
      const point = seriesMap.get(month);
      if (!point) return;
      if (item.movement_type === "entry") point.entries += item.amount; else point.exits += item.amount;
      seriesMap.set(month, point);
      if (item.movement_type === "entry") methodMap.set(item.payment_method || "Não informado", (methodMap.get(item.payment_method || "Não informado") || 0) + item.amount);
    });
    res.json({ summary: { entries, exits, balance: entries - exits }, movements, series: Array.from(seriesMap.values()), methods: Array.from(methodMap, ([name, value]) => ({ name, value })) });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar o caixa: " + err.message }); }
});

router.post("/admin/cashbox/movements", requireAdmin, requirePermission("cashbox.manage"), async (req: any, res) => {
  const movementType = String(req.body?.movementType || "");
  const amount = Number(req.body?.amount);
  const description = String(req.body?.description || "").trim();
  const category = String(req.body?.category || "").trim();
  const paymentMethod = String(req.body?.paymentMethod || "").trim();
  const movementDate = String(req.body?.movementDate || "").slice(0, 10);
  if (!["entry", "exit"].includes(movementType) || !Number.isFinite(amount) || amount <= 0 || !description || !/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) return void res.status(400).json({ error: "Preencha tipo, valor, descrição e data do movimento." });
  const db = getDb();
  const result = await db.prepare("INSERT INTO cash_ledger (movement_type, amount, description, category, payment_method, movement_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(movementType, amount, description, category || null, paymentMethod || null, movementDate, req.adminId);
  await audit(req.adminId, "cashbox.movement.created", "cash_ledger", result.lastInsertRowid, { movementType, amount, description });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.delete("/admin/cashbox/movements/:id", requireAdmin, requirePermission("cashbox.manage"), async (req: any, res) => {
  const db = getDb();
  const target = await db.prepare("SELECT movement_type, amount, description FROM cash_ledger WHERE id = ?").get(req.params.id) as any;
  await db.prepare("DELETE FROM cash_ledger WHERE id = ?").run(req.params.id);
  await audit(req.adminId, "cashbox.movement.deleted", "cash_ledger", req.params.id, target ? { movementType: target.movement_type, amount: Number(target.amount), description: target.description } : undefined);
  res.json({ success: true });
});

router.get("/admin/accounts", requireAdmin, requirePermission("access.manage"), async (_req, res) => {
  const accounts = await getDb().prepare("SELECT id, email, name, role_name, permissions, is_owner, active, created_at FROM admin_accounts ORDER BY is_owner DESC, id ASC").all() as any[];
  res.json({ accounts: accounts.map(adminPayload) });
});
router.post("/admin/accounts", requireAdmin, requirePermission("access.manage"), async (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const roleName = String(req.body?.roleName || "Equipe").trim();
  const permissions = parsePermissions(req.body?.permissions).filter((item) => item !== "access.manage");
  if (!name || !email.includes("@") || password.length < 8 || !roleName) return void res.status(400).json({ error: "Revise os dados do novo acesso." });
  try {
    const db = getDb();
    const result = await db.prepare("INSERT INTO admin_accounts (email, name, password_hash, role_name, permissions, is_owner, active, created_by) VALUES (?, ?, ?, ?, ?, false, true, ?)").run(email, name, bcrypt.hashSync(password, 12), roleName, JSON.stringify(permissions), req.adminId);
    const account = await db.prepare("SELECT * FROM admin_accounts WHERE id = ?").get(result.lastInsertRowid);
    await audit(req.adminId, "admin.access.created", "admin_account", result.lastInsertRowid, { permissions, roleName, targetName: name, targetEmail: email });
    res.status(201).json({ account: adminPayload(account) });
  } catch (err: any) { res.status(409).json({ error: err.message.includes("UNIQUE") ? "Este e-mail já possui acesso." : "Erro ao criar acesso." }); }
});
router.put("/admin/accounts/:id/status", requireAdmin, requirePermission("access.manage"), async (req: any, res) => {
  const db = getDb();
  const target = await db.prepare("SELECT name, email, is_owner FROM admin_accounts WHERE id = ?").get(req.params.id) as any;
  if (!target || target.is_owner || Number(req.params.id) === req.adminId) return void res.status(400).json({ error: "Este acesso não pode ser alterado." });
  await db.prepare("UPDATE admin_accounts SET active = ? WHERE id = ?").run(Boolean(req.body?.active), req.params.id);
  await audit(req.adminId, "admin.access.status.updated", "admin_account", req.params.id, { active: Boolean(req.body?.active), targetName: target.name, targetEmail: target.email });
  res.json({ success: true });
});
router.delete("/admin/accounts/:id", requireAdmin, requirePermission("access.manage"), async (req: any, res) => {
  const db = getDb();
  const target = await db.prepare("SELECT name, email, role_name, is_owner FROM admin_accounts WHERE id = ?").get(req.params.id) as any;
  if (!target || target.is_owner || Number(req.params.id) === req.adminId) return void res.status(400).json({ error: "Este acesso não pode ser excluído." });
  await audit(req.adminId, "admin.access.deleted", "admin_account", req.params.id, { targetName: target.name, targetEmail: target.email, roleName: target.role_name });
  await db.prepare("DELETE FROM admin_accounts WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

router.get("/admin/audit-logs", requireAdmin, requirePermission("audit.view"), async (req: any, res) => {
  try {
    const range = ["7", "30", "all", "custom"].includes(String(req.query.range)) ? String(req.query.range) : "7";
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const rows = await getDb().prepare(
      `SELECT l.*, a.name as current_admin_name, a.email as current_admin_email
       FROM admin_audit_logs l LEFT JOIN admin_accounts a ON a.id = l.admin_id
       ORDER BY l.created_at DESC`
    ).all() as any[];
    const now = new Date();
    const start = range === "7" || range === "30" ? new Date(now.getTime() - Number(range) * 86400000) : range === "custom" && from ? new Date(`${from}T00:00:00`) : null;
    const end = range === "custom" && to ? new Date(`${to}T23:59:59.999`) : null;
    const logs = rows.filter((row) => {
      const date = parseDatabaseDate(row.created_at);
      return !Number.isNaN(date.getTime()) && (!start || date >= start) && (!end || date <= end);
    }).map((row) => {
      let details: any = {};
      try { details = row.details ? JSON.parse(row.details) : {}; } catch { details = {}; }
      return { id: Number(row.id), adminId: row.admin_id == null ? null : Number(row.admin_id), adminName: row.current_admin_name || details.actor?.name || "Acesso removido", adminEmail: row.current_admin_email || details.actor?.email || "", action: row.action, targetType: row.target_type, targetId: row.target_id, details, createdAt: row.created_at };
    });
    res.json({ logs, summary: { total: logs.length, administrators: new Set(logs.map((item) => item.adminName)).size, changes: logs.filter((item) => item.action !== "admin.login").length } });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar atividades: " + err.message }); }
});

router.get("/admin/chats", requireAdmin, requirePermission("clients.view"), async (_req, res) => {
  const chats = await getDb().prepare("SELECT c.*, u.name as user_name, u.email as user_email, COALESCE(u.subscription_tier, 'free') as user_tier, (SELECT COUNT(*) FROM support_messages m WHERE m.chat_id = c.id AND m.sender_type = 'user' AND m.is_read = false) as unread_count FROM support_chats c JOIN users u ON u.id = c.user_id ORDER BY c.updated_at DESC").all();
  res.json({ chats });
});
router.get("/admin/chats/:chatId/messages", requireAdmin, requirePermission("clients.view"), async (req, res) => {
  const db = getDb();
  res.json({ chat: await db.prepare("SELECT * FROM support_chats WHERE id = ?").get(req.params.chatId), messages: await db.prepare("SELECT * FROM support_messages WHERE chat_id = ? ORDER BY id ASC").all(req.params.chatId) });
});
router.post("/admin/chats/:chatId/reply", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) return void res.status(400).json({ error: "A mensagem não pode ser vazia." });
  const db = getDb();
  const result = await db.prepare("INSERT INTO support_messages (chat_id, sender_type, sender_id, content, is_read) VALUES (?, 'admin', NULL, ?, true)").run(req.params.chatId, content);
  await db.prepare("UPDATE support_chats SET last_message = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(content, req.params.chatId);
  await audit(req.adminId, "support.reply.sent", "support_chat", req.params.chatId);
  res.json({ message: await db.prepare("SELECT * FROM support_messages WHERE id = ?").get(result.lastInsertRowid) });
});
router.put("/admin/chats/:chatId/status", requireAdmin, requirePermission("clients.manage"), async (req: any, res) => {
  const status = String(req.body?.status || "");
  if (!["open", "resolved", "closed"].includes(status)) return void res.status(400).json({ error: "Status inválido." });
  await getDb().prepare("UPDATE support_chats SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, req.params.chatId);
  await audit(req.adminId, "support.status.updated", "support_chat", req.params.chatId, { status });
  res.json({ success: true });
});

router.get("/support/my-chat", requireAuth, async (req: any, res) => {
  const db = getDb();
  try {
    let chat = await db.prepare("SELECT * FROM support_chats WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.userId) as any;
    if (!chat) {
      const result = await db.prepare("INSERT INTO support_chats (user_id, subject, status, last_message) VALUES (?, 'Suporte', 'open', 'Conversa iniciada')").run(req.userId);
      chat = await db.prepare("SELECT * FROM support_chats WHERE id = ?").get(result.lastInsertRowid);
    }
    const messages = await db.prepare("SELECT * FROM support_messages WHERE chat_id = ? ORDER BY id ASC").all(chat.id);
    await db.prepare("UPDATE support_messages SET is_read = true WHERE chat_id = ? AND sender_type = 'admin'").run(chat.id);
    res.json({ chat, messages });
  } catch (err: any) { res.status(500).json({ error: "Erro ao carregar suporte: " + err.message }); }
});
router.post("/support/send-message", requireAuth, async (req: any, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) return void res.status(400).json({ error: "Mensagem não pode ser vazia." });
  const db = getDb();
  let chat = await db.prepare("SELECT id FROM support_chats WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.userId) as any;
  if (!chat) { const result = await db.prepare("INSERT INTO support_chats (user_id, subject, status) VALUES (?, 'Suporte', 'open')").run(req.userId); chat = { id: result.lastInsertRowid }; }
  const result = await db.prepare("INSERT INTO support_messages (chat_id, sender_type, sender_id, content, is_read) VALUES (?, 'user', ?, ?, false)").run(chat.id, req.userId, content);
  await db.prepare("UPDATE support_chats SET last_message = ?, status = 'open', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(content, chat.id);
  res.json({ message: await db.prepare("SELECT * FROM support_messages WHERE id = ?").get(result.lastInsertRowid) });
});

export default router;
