import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CreditCard, LayoutDashboard, Menu, ShieldCheck, Users, WalletCards, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";

type Permission = "dashboard.view" | "clients.view" | "clients.manage" | "cashbox.view" | "cashbox.manage" | "payments.view" | "access.manage";
type Section = "dashboard" | "clients" | "cashbox" | "payments" | "access";
type AdminSession = { id: number; name: string; email: string; roleName: string; isOwner: boolean; permissions: Permission[] };
type Client = { id: number; name: string; email: string; subscription_tier: string; subscription_status: string; account_status: string; subscription_expires_at?: string; created_at: string; approved_payments: number };
type Payment = { id: number; user_name?: string; user_email?: string; status: string; transaction_amount: number; plan_tier: string; billing_cycle: string; payment_method_id?: string; created_at: string };
type Message = { id: number; sender_type: "user" | "admin"; content: string; created_at: string };
type ClientDetail = { user: Client; payments: Payment[]; chat: { id: number; status: string } | null; messages: Message[] };
type AdminAccount = AdminSession & { active: boolean; createdAt?: string };
type CashMovement = { id: string; source: "payment" | "manual"; movement_type: "entry" | "exit"; amount: number; description: string; category?: string; payment_method?: string; movement_date: string };

const nav: Array<{ id: Section; label: string; permission: Permission; icon: LucideIcon }> = [
  { id: "dashboard", label: "Dashboard", permission: "dashboard.view", icon: LayoutDashboard },
  { id: "clients", label: "Clientes", permission: "clients.view", icon: Users },
  { id: "cashbox", label: "Caixa", permission: "cashbox.view", icon: WalletCards },
  { id: "payments", label: "Pagamentos", permission: "payments.view", icon: CreditCard },
  { id: "access", label: "Acessos", permission: "access.manage", icon: ShieldCheck },
];
const permissionLabels: Array<{ id: Permission; label: string }> = [
  { id: "dashboard.view", label: "Visualizar dashboard" },
  { id: "clients.view", label: "Visualizar clientes e conversas" },
  { id: "clients.manage", label: "Editar clientes e responder conversas" },
  { id: "cashbox.view", label: "Visualizar o caixa" },
  { id: "cashbox.manage", label: "Registrar entradas e saídas" },
  { id: "payments.view", label: "Visualizar checkouts e relatórios" },
];

async function adminApi(path: string, init?: RequestInit) {
  const token = localStorage.getItem("admin_token");
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}), Authorization: `Bearer ${token || ""}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir esta ação.");
  return data;
}
function formatMoney(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function formatDate(value?: string) {
  if (!value) return "—";
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  return new Date(value).toLocaleDateString("pt-BR");
}
function planName(value: string) { return ({ free: "Gratuito", starter: "Essencial", pro: "Profissional", enterprise: "Escala" } as Record<string, string>)[value] || value; }

async function downloadPaymentPdf(payments: Payment[], summary: any) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(0, 166, 251); doc.rect(0, 0, 210, 7, "F");
  doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Clic Lab", 16, 24);
  doc.setFontSize(12); doc.text("Relatório de pagamentos", 16, 33);
  doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.setFontSize(9); doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 16, 40);
  doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("Receita aprovada", 16, 55); doc.text("Aprovados", 82, 55); doc.text("Pendentes", 143, 55);
  doc.setFontSize(14); doc.text(formatMoney(summary.approvedRevenue), 16, 64); doc.text(String(summary.approvedCount), 82, 64); doc.text(String(summary.pendingCount), 143, 64);
  autoTable(doc, { startY: 75, head: [["Data", "Cliente", "Plano", "Método", "Status", "Valor"]], body: payments.map((item) => [formatDate(item.created_at), item.user_name || item.user_email || "Cliente", planName(item.plan_tier), item.payment_method_id || "—", item.status, formatMoney(item.transaction_amount)]), styles: { font: "helvetica", fontSize: 8, cellPadding: 3, textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: 0.15 }, headStyles: { fillColor: [0, 166, 251], textColor: [255, 255, 255], fontStyle: "bold" }, alternateRowStyles: { fillColor: [248, 250, 252] }, margin: { left: 16, right: 16 }, didDrawPage: ({ pageNumber }) => { doc.setFontSize(8); doc.setTextColor(148, 163, 184); doc.text(`Clic Lab · Página ${pageNumber}`, 16, 290); } });
  doc.save(`pagamentos-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [section, setSection] = useState<Section>("dashboard");
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [cashbox, setCashbox] = useState<any>(null);
  const [payments, setPayments] = useState<any>(null);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; description: string; actionLabel: string; run: () => Promise<void> } | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", email: "", password: "", planTier: "free" });
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "", roleName: "Atendimento", permissions: ["dashboard.view", "clients.view"] as Permission[] });
  const [movementForm, setMovementForm] = useState({ movementType: "entry", amount: "", description: "", category: "", paymentMethod: "Pix", movementDate: new Date().toISOString().slice(0, 10) });

  const can = (permission: Permission) => Boolean(admin?.isOwner || admin?.permissions.includes(permission));
  const allowedNav = useMemo(() => nav.filter((item) => can(item.permission)), [admin]);
  const filteredClients = useMemo(() => clients.filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(search.toLowerCase())), [clients, search]);

  const logout = () => { localStorage.removeItem("admin_token"); setLocation("/admin/login"); };
  const loadSection = async (target: Section) => {
    setLoading(true);
    try {
      if (target === "dashboard") setDashboard(await adminApi("/api/admin/dashboard"));
      if (target === "clients") setClients((await adminApi("/api/admin/users")).users || []);
      if (target === "cashbox") setCashbox(await adminApi("/api/admin/cashbox"));
      if (target === "payments") setPayments(await adminApi("/api/admin/payments"));
      if (target === "access") setAccounts((await adminApi("/api/admin/accounts")).accounts || []);
    } catch (error: any) { toast({ title: "Não foi possível carregar", description: error.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    adminApi("/api/admin/session").then(({ admin: session }) => {
      setAdmin(session);
      const first = nav.find((item) => session.isOwner || session.permissions.includes(item.permission));
      if (!first) { logout(); return; }
      setSection(first.id); loadSection(first.id);
    }).catch(logout);
  }, []);

  const changeSection = (target: Section) => { setSection(target); setMobileSidebarOpen(false); loadSection(target); };
  const openClient = async (id: number) => {
    try { setDetail(await adminApi(`/api/admin/users/${id}`)); setDetailOpen(true); }
    catch (error: any) { toast({ title: "Erro ao abrir cliente", description: error.message, variant: "destructive" }); }
  };
  const updateClient = async (client: Client, status: string) => {
    try { await adminApi(`/api/admin/users/${client.id}/status`, { method: "PUT", body: JSON.stringify({ status }) }); setClients((current) => current.map((item) => item.id === client.id ? { ...item, account_status: status } : item)); if (detail?.user.id === client.id) setDetail({ ...detail, user: { ...detail.user, account_status: status } }); toast({ title: status === "banned" ? "Cliente bloqueado" : status === "paused" ? "Cliente pausado" : "Cliente ativado" }); }
    catch (error: any) { toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" }); }
  };
  const deleteClient = async (client: Client) => {
    try { await adminApi(`/api/admin/users/${client.id}`, { method: "DELETE" }); setClients((current) => current.filter((item) => item.id !== client.id)); setDetailOpen(false); toast({ title: "Cliente excluído", description: "A lista foi atualizada." }); }
    catch (error: any) { toast({ title: "Não foi possível excluir", description: error.message, variant: "destructive" }); }
  };
  const changePlan = async (planTier: string) => {
    if (!detail) return;
    try { await adminApi(`/api/admin/users/${detail.user.id}/tier`, { method: "PUT", body: JSON.stringify({ planTier }) }); setDetail({ ...detail, user: { ...detail.user, subscription_tier: planTier, subscription_status: planTier === "free" ? "free" : "active" } }); setClients((current) => current.map((item) => item.id === detail.user.id ? { ...item, subscription_tier: planTier, subscription_status: planTier === "free" ? "free" : "active" } : item)); toast({ title: "Plano atualizado", description: `${detail.user.name} agora está no plano ${planName(planTier)}.` }); }
    catch (error: any) { toast({ title: "Não foi possível alterar o plano", description: error.message, variant: "destructive" }); }
  };
  const sendReply = async (event: FormEvent) => {
    event.preventDefault(); if (!detail?.chat || !reply.trim()) return;
    try { await adminApi(`/api/admin/chats/${detail.chat.id}/reply`, { method: "POST", body: JSON.stringify({ content: reply }) }); setReply(""); setDetail(await adminApi(`/api/admin/users/${detail.user.id}`)); }
    catch (error: any) { toast({ title: "Mensagem não enviada", description: error.message, variant: "destructive" }); }
  };
  const createClient = async (event: FormEvent) => {
    event.preventDefault();
    try { const data = await adminApi("/api/admin/create-temp-user", { method: "POST", body: JSON.stringify({ ...clientForm, customPassword: clientForm.password }) }); setCreateClientOpen(false); setClientForm({ name: "", email: "", password: "", planTier: "free" }); await loadSection("clients"); toast({ title: "Cliente criado", description: `Senha inicial: ${data.user.password}` }); }
    catch (error: any) { toast({ title: "Não foi possível criar", description: error.message, variant: "destructive" }); }
  };
  const createAdmin = async (event: FormEvent) => {
    event.preventDefault();
    try { await adminApi("/api/admin/accounts", { method: "POST", body: JSON.stringify(adminForm) }); setCreateAdminOpen(false); setAdminForm({ name: "", email: "", password: "", roleName: "Atendimento", permissions: ["dashboard.view", "clients.view"] }); await loadSection("access"); toast({ title: "Acesso criado" }); }
    catch (error: any) { toast({ title: "Não foi possível criar o acesso", description: error.message, variant: "destructive" }); }
  };
  const createMovement = async (event: FormEvent) => {
    event.preventDefault();
    try { await adminApi("/api/admin/cashbox/movements", { method: "POST", body: JSON.stringify({ ...movementForm, amount: Number(movementForm.amount) }) }); setMovementOpen(false); setMovementForm({ movementType: "entry", amount: "", description: "", category: "", paymentMethod: "Pix", movementDate: new Date().toISOString().slice(0, 10) }); setCashbox(await adminApi("/api/admin/cashbox")); toast({ title: "Movimento registrado", description: "O caixa foi atualizado." }); }
    catch (error: any) { toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" }); }
  };
  const deleteMovement = async (movement: CashMovement) => {
    const numericId = movement.id.replace("manual-", "");
    await adminApi(`/api/admin/cashbox/movements/${numericId}`, { method: "DELETE" });
    setCashbox(await adminApi("/api/admin/cashbox"));
    toast({ title: "Movimento excluído", description: "O saldo foi recalculado." });
  };

  if (!admin) return <main className="min-h-screen bg-background" />;
  const dotButton = <span className="flex gap-[3px]" aria-hidden="true"><span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" /></span>;
  const navigation = <nav className="mt-10 space-y-1">{allowedNav.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => changeSection(item.id)} className={`flex h-11 w-full items-center gap-3 rounded-xl px-4 text-left text-sm font-semibold transition-colors ${section === item.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}><Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.4}/><span>{item.label}</span></button>; })}</nav>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-background px-6 py-8 lg:flex lg:flex-col">
        <div><p className="text-sm font-semibold">Clic Lab</p><p className="mt-1 text-xs text-muted-foreground">Administração</p></div>
        {navigation}
        <div className="mt-auto border-t border-border pt-5"><p className="truncate text-sm font-medium">{admin.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{admin.roleName}</p><button onClick={logout} className="mt-5 text-xs text-muted-foreground hover:text-foreground">Sair</button></div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-5 py-4 backdrop-blur-xl lg:px-10">
          <div className="flex items-center justify-between"><div className="flex items-center gap-3"><button onClick={() => setMobileSidebarOpen(true)} aria-label="Abrir menu administrativo" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border lg:hidden"><Menu className="h-5 w-5" strokeWidth={2.5}/></button><div><p className="text-lg font-semibold">{nav.find((item) => item.id === section)?.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{admin.roleName}</p></div></div><button onClick={logout} className="text-xs text-muted-foreground lg:hidden">Sair</button></div>
        </header>

        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}><SheetContent side="left" className="w-[286px] border-r border-border bg-background p-6"><SheetTitle className="text-left text-base">Clic Lab</SheetTitle><SheetDescription className="text-left text-xs">Administração</SheetDescription>{navigation}<div className="absolute bottom-7 left-6 right-6 border-t border-border pt-5"><p className="truncate text-sm font-semibold">{admin.name}</p><p className="mt-1 text-xs text-muted-foreground">{admin.roleName}</p></div></SheetContent></Sheet>

        <div className="mx-auto max-w-7xl px-5 py-8 lg:px-10 lg:py-12">
          {loading ? <p className="py-24 text-center text-sm text-muted-foreground">Carregando...</p> : null}

          {!loading && section === "dashboard" && dashboard && <section>
            <div className="grid grid-cols-3 border-y border-border">{[["Clientes", dashboard.metrics.customers], ["Receita", formatMoney(dashboard.metrics.revenue)], ["Assinaturas ativas", dashboard.metrics.activeSubscriptions]].map(([label, value], index) => <div key={String(label)} className={`py-6 ${index ? "border-l border-border pl-5 lg:pl-8" : ""}`}><p className="text-2xl font-semibold tracking-tight lg:text-3xl">{value}</p><p className="mt-2 text-xs text-muted-foreground">{label}</p></div>)}</div>
            <div className="mt-12"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Receita</h2><p className="mt-1 text-xs text-muted-foreground">Pagamentos aprovados por mês</p></div></div><div className="mt-8 h-80 w-full border-b border-border pb-4"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dashboard.revenueSeries}><defs><linearGradient id="adminRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00a6fb" stopOpacity={0.2}/><stop offset="100%" stopColor="#00a6fb" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="hsl(var(--border))" /><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11}/><YAxis axisLine={false} tickLine={false} fontSize={11}/><Tooltip formatter={(value) => formatMoney(Number(value))}/><Area type="monotone" dataKey="total" stroke="#00a6fb" strokeWidth={2} fill="url(#adminRevenue)" /></AreaChart></ResponsiveContainer></div></div>
          </section>}

          {!loading && section === "clients" && <section>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail" className="h-11 max-w-md rounded-full" />{can("clients.manage") && <Button onClick={() => setCreateClientOpen(true)} className="h-11 rounded-full px-6">Novo cliente</Button>}</div>
            <div className="mt-8 overflow-x-auto border-y border-border"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-4 font-medium">Cliente</th><th className="py-4 font-medium">Plano</th><th className="py-4 font-medium">Status</th><th className="py-4 font-medium">Desde</th><th className="py-4 text-right font-medium">Ações</th></tr></thead><tbody>{filteredClients.map((client) => <tr key={client.id} className="border-b border-border/70 last:border-0"><td className="py-4"><p className="text-sm font-medium">{client.name}</p><p className="mt-1 text-xs text-muted-foreground">{client.email}</p></td><td className="py-4 text-sm">{planName(client.subscription_tier)}</td><td className="py-4"><span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${client.account_status === "active" ? "bg-emerald-100 text-emerald-700" : client.account_status === "paused" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{client.account_status === "active" ? "Ativo" : client.account_status === "paused" ? "Pausado" : "Bloqueado"}</span></td><td className="py-4 text-xs text-muted-foreground">{formatDate(client.created_at)}</td><td className="py-4 text-right"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label={`Ações de ${client.name}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60">{dotButton}</button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44 rounded-2xl p-2"><DropdownMenuItem onClick={() => openClient(client.id)} className="rounded-xl py-2.5">Ver mais</DropdownMenuItem>{can("clients.manage") && <><DropdownMenuSeparator/><DropdownMenuItem onClick={() => updateClient(client, client.account_status === "paused" ? "active" : "paused")} className="rounded-xl py-2.5">{client.account_status === "paused" ? "Ativar cliente" : "Pausar cliente"}</DropdownMenuItem><DropdownMenuItem onClick={() => updateClient(client, client.account_status === "banned" ? "active" : "banned")} className="rounded-xl py-2.5">{client.account_status === "banned" ? "Remover bloqueio" : "Bloquear cliente"}</DropdownMenuItem><DropdownMenuItem onClick={() => setConfirmAction({ title: "Excluir cliente?", description: `${client.name} e os dados vinculados serão removidos permanentemente.`, actionLabel: "Excluir cliente", run: () => deleteClient(client) })} className="rounded-xl py-2.5 text-destructive focus:text-destructive">Excluir cliente</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></td></tr>)}</tbody></table>{filteredClients.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}</div>
          </section>}

          {!loading && section === "cashbox" && cashbox && <section>
            <div className="flex items-start justify-between gap-5"><div><h2 className="text-2xl font-semibold tracking-tight">Movimentação financeira</h2><p className="mt-2 text-sm text-muted-foreground">Entradas aprovadas, registros manuais e saídas da operação.</p></div>{can("cashbox.manage") && <Button onClick={() => setMovementOpen(true)} className="rounded-full px-6">Novo movimento</Button>}</div>
            <div className="mt-8 grid grid-cols-3 border-y border-border">{[["Entradas", formatMoney(cashbox.summary.entries)], ["Saídas", formatMoney(cashbox.summary.exits)], ["Saldo", formatMoney(cashbox.summary.balance)]].map(([label, value], index) => <div key={String(label)} className={`py-6 ${index ? "border-l border-border pl-4 sm:pl-6 lg:pl-8" : ""}`}><p className="text-xl font-semibold sm:text-2xl">{value}</p><p className="mt-2 text-xs text-muted-foreground">{label}</p></div>)}</div>
            <div className="mt-12 grid gap-10 xl:grid-cols-[1.5fr_1fr]"><div><h3 className="text-sm font-semibold">Fluxo mensal</h3><div className="mt-5 h-72 border-b border-border"><ResponsiveContainer width="100%" height="100%"><AreaChart data={cashbox.series}><CartesianGrid vertical={false} stroke="hsl(var(--border))"/><XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={11}/><YAxis axisLine={false} tickLine={false} fontSize={11}/><Tooltip formatter={(value) => formatMoney(Number(value))}/><Area type="monotone" dataKey="entries" name="Entradas" stroke="#00a6fb" fill="#00a6fb22" strokeWidth={2}/><Area type="monotone" dataKey="exits" name="Saídas" stroke="#f59e0b" fill="#f59e0b18" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></div><div><h3 className="text-sm font-semibold">Entradas por método</h3><div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={cashbox.methods} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>{cashbox.methods.map((_: any, index: number) => <Cell key={index} fill={["#00a6fb", "#38bdf8", "#7dd3fc", "#bae6fd", "#0ea5e9"][index % 5]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value))}/></PieChart></ResponsiveContainer></div><div className="space-y-2">{cashbox.methods.slice(0, 5).map((method: any, index: number) => <div key={method.name} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ["#00a6fb", "#38bdf8", "#7dd3fc", "#bae6fd", "#0ea5e9"][index % 5] }}/>{method.name}</span><span className="font-medium">{formatMoney(method.value)}</span></div>)}</div></div></div>
            <div className="mt-12 overflow-x-auto border-y border-border"><table className="w-full min-w-[780px]"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-4 font-medium">Data</th><th className="py-4 font-medium">Descrição</th><th className="py-4 font-medium">Método</th><th className="py-4 font-medium">Tipo</th><th className="py-4 text-right font-medium">Valor</th><th className="py-4 text-right font-medium">Ações</th></tr></thead><tbody>{cashbox.movements.map((movement: CashMovement) => <tr key={movement.id} className="border-b border-border/70 last:border-0"><td className="py-4 text-xs text-muted-foreground">{formatDate(movement.movement_date)}</td><td className="py-4"><p className="text-sm font-medium">{movement.description}</p><p className="mt-1 text-xs text-muted-foreground">{movement.category || (movement.source === "payment" ? "Checkout" : "Manual")}</p></td><td className="py-4 text-sm">{movement.payment_method || "—"}</td><td className="py-4"><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${movement.movement_type === "entry" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{movement.movement_type === "entry" ? "Entrada" : "Saída"}</span></td><td className={`py-4 text-right text-sm font-semibold ${movement.movement_type === "entry" ? "text-emerald-700" : "text-amber-700"}`}>{movement.movement_type === "entry" ? "+" : "−"}{formatMoney(movement.amount)}</td><td className="py-4 text-right">{movement.source === "manual" && can("cashbox.manage") ? <DropdownMenu><DropdownMenuTrigger asChild><button aria-label={`Ações de ${movement.description}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60">{dotButton}</button></DropdownMenuTrigger><DropdownMenuContent align="end" className="rounded-2xl p-2"><DropdownMenuItem onClick={() => setConfirmAction({ title: "Excluir movimento?", description: "O saldo do caixa será recalculado imediatamente.", actionLabel: "Excluir movimento", run: () => deleteMovement(movement) })} className="rounded-xl py-2.5 text-destructive focus:text-destructive">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : <span className="text-xs text-muted-foreground">Automático</span>}</td></tr>)}</tbody></table></div>
          </section>}

          {!loading && section === "payments" && payments && <section>
            <div className="flex items-start justify-between gap-5"><div><h2 className="text-2xl font-semibold tracking-tight">Checkouts</h2><p className="mt-2 text-sm text-muted-foreground">Pagamentos iniciados, aprovados e pendentes.</p></div><Button onClick={() => downloadPaymentPdf(payments.payments, payments.summary)} variant="outline" className="rounded-full px-5">Gerar PDF</Button></div>
            <div className="mt-8 grid grid-cols-3 border-y border-border">{[["Receita aprovada", formatMoney(payments.summary.approvedRevenue)], ["Aprovados", payments.summary.approvedCount], ["Pendentes", payments.summary.pendingCount]].map(([label, value], index) => <div key={String(label)} className={`py-6 ${index ? "border-l border-border pl-4 sm:pl-6 lg:pl-8" : ""}`}><p className="text-xl font-semibold sm:text-2xl">{value}</p><p className="mt-2 text-xs text-muted-foreground">{label}</p></div>)}</div>
            <div className="mt-10 overflow-x-auto border-y border-border"><table className="w-full min-w-[760px]"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-4 font-medium">Cliente</th><th className="py-4 font-medium">Plano</th><th className="py-4 font-medium">Método</th><th className="py-4 font-medium">Valor</th><th className="py-4 font-medium">Status</th><th className="py-4 font-medium">Data</th></tr></thead><tbody>{payments.payments.map((payment: Payment) => <tr key={payment.id} className="border-b border-border/70 last:border-0"><td className="py-4"><p className="text-sm">{payment.user_name || "Cliente"}</p><p className="mt-1 text-xs text-muted-foreground">{payment.user_email}</p></td><td className="py-4 text-sm">{planName(payment.plan_tier)}</td><td className="py-4 text-sm">{payment.payment_method_id || "—"}</td><td className="py-4 text-sm font-medium">{formatMoney(payment.transaction_amount)}</td><td className="py-4"><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${payment.status === "approved" ? "bg-emerald-100 text-emerald-700" : payment.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{payment.status}</span></td><td className="py-4 text-xs text-muted-foreground">{formatDate(payment.created_at)}</td></tr>)}</tbody></table></div>
          </section>}

          {!loading && section === "access" && <section>
            <div className="flex items-start justify-between gap-5"><div><h2 className="text-2xl font-semibold tracking-tight">Equipe administrativa</h2><p className="mt-2 text-sm text-muted-foreground">Cada acesso recebe apenas as páginas e ações necessárias.</p></div><Button onClick={() => setCreateAdminOpen(true)} className="rounded-full px-6">Novo acesso</Button></div>
            <div className="mt-10 border-y border-border">{accounts.map((account) => <div key={account.id} className="flex items-center gap-4 border-b border-border/70 py-5 last:border-0"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{account.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{account.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{account.email} · {account.roleName}</p></div><span className={`hidden rounded-full px-3 py-1 text-[11px] font-semibold sm:inline-flex ${account.active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{account.active ? "Ativo" : "Pausado"}</span><p className="hidden text-xs text-muted-foreground md:block">{account.isOwner ? "Acesso total" : `${account.permissions.length} permissões`}</p>{!account.isOwner && <DropdownMenu><DropdownMenuTrigger asChild><button aria-label={`Ações de ${account.name}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted/60">{dotButton}</button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40 rounded-2xl p-2"><DropdownMenuItem onClick={async () => { await adminApi(`/api/admin/accounts/${account.id}/status`, { method: "PUT", body: JSON.stringify({ active: !account.active }) }); setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, active: !item.active } : item)); toast({ title: account.active ? "Acesso pausado" : "Acesso ativado" }); }} className="rounded-xl py-2.5">{account.active ? "Desativar" : "Ativar"}</DropdownMenuItem><DropdownMenuItem onClick={() => setConfirmAction({ title: "Excluir acesso?", description: `${account.name} não poderá mais entrar no painel administrativo.`, actionLabel: "Excluir acesso", run: async () => { await adminApi(`/api/admin/accounts/${account.id}`, { method: "DELETE" }); setAccounts((current) => current.filter((item) => item.id !== account.id)); toast({ title: "Acesso excluído" }); } })} className="rounded-xl py-2.5 text-destructive focus:text-destructive">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>)}</div>
          </section>}
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-3xl p-0 [&>button]:hidden"><DialogTitle className="sr-only">Detalhes do cliente</DialogTitle><DialogDescription className="sr-only">Plano, pagamentos e conversa do cliente.</DialogDescription>{detail && <div><div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-5 backdrop-blur-xl"><div><p className="text-lg font-semibold">{detail.user.name}</p><p className="mt-1 text-xs text-muted-foreground">{detail.user.email}</p></div><button onClick={() => setDetailOpen(false)} className="h-9 rounded-full border border-border px-4 text-xs">Fechar</button></div><div className="space-y-9 p-6"><div className="grid grid-cols-3 border-y border-border"><div className="py-5"><p className="text-xs text-muted-foreground">Plano</p><p className="mt-2 text-sm font-semibold">{planName(detail.user.subscription_tier)}</p></div><div className="border-l border-border py-5 pl-5"><p className="text-xs text-muted-foreground">Conta</p><span className={`mt-2 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${detail.user.account_status === "active" ? "bg-emerald-100 text-emerald-700" : detail.user.account_status === "paused" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{detail.user.account_status === "active" ? "Ativo" : detail.user.account_status === "paused" ? "Pausado" : "Bloqueado"}</span></div><div className="border-l border-border py-5 pl-5"><p className="text-xs text-muted-foreground">Renovação</p><p className="mt-2 text-sm font-semibold">{formatDate(detail.user.subscription_expires_at)}</p></div></div>{can("clients.manage") && <div><label className="text-sm font-medium">Alterar plano manualmente</label><Select value={detail.user.subscription_tier} onValueChange={changePlan}><SelectTrigger className="mt-3 h-11 rounded-2xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="free">Gratuito</SelectItem><SelectItem value="starter">Essencial</SelectItem><SelectItem value="pro">Profissional</SelectItem><SelectItem value="enterprise">Escala</SelectItem></SelectContent></Select></div>}<div><h3 className="text-sm font-semibold">Pagamentos recentes</h3><div className="mt-3 border-y border-border">{detail.payments.length ? detail.payments.slice(0, 5).map((payment) => <div key={payment.id} className="flex items-center justify-between border-b border-border/70 py-3 text-xs last:border-0"><span>{formatDate(payment.created_at)} · {payment.status}</span><span className="font-medium">{formatMoney(payment.transaction_amount)}</span></div>) : <p className="py-5 text-xs text-muted-foreground">Nenhum pagamento registrado.</p>}</div></div><div><h3 className="text-sm font-semibold">Conversa</h3><div className="mt-3 max-h-64 space-y-3 overflow-y-auto border-y border-border py-4">{detail.messages.length ? detail.messages.map((message) => <div key={message.id} className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-5 ${message.sender_type === "admin" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>{message.content}</div>) : <p className="text-xs text-muted-foreground">Ainda não há mensagens.</p>}</div>{detail.chat && can("clients.manage") && <form onSubmit={sendReply} className="mt-3 flex gap-2"><Input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Escreva uma resposta" className="h-11 rounded-full"/><Button type="submit" className="h-11 rounded-full px-5">Enviar</Button></form>}</div></div></div>}</DialogContent></Dialog>

      <Dialog open={createClientOpen} onOpenChange={setCreateClientOpen}><DialogContent className="max-w-md rounded-3xl p-7"><DialogTitle className="text-2xl">Novo cliente</DialogTitle><DialogDescription>Crie um acesso manual e escolha o plano inicial.</DialogDescription><form onSubmit={createClient} className="mt-6 space-y-4"><Input placeholder="Nome" value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} className="h-11 rounded-2xl" required/><Input type="email" placeholder="E-mail" value={clientForm.email} onChange={(event) => setClientForm({ ...clientForm, email: event.target.value })} className="h-11 rounded-2xl" required/><Input type="password" placeholder="Senha inicial (mínimo 8 caracteres)" value={clientForm.password} onChange={(event) => setClientForm({ ...clientForm, password: event.target.value })} className="h-11 rounded-2xl" minLength={8}/><Select value={clientForm.planTier} onValueChange={(value) => setClientForm({ ...clientForm, planTier: value })}><SelectTrigger className="h-11 rounded-2xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="free">Gratuito</SelectItem><SelectItem value="starter">Essencial</SelectItem><SelectItem value="pro">Profissional</SelectItem><SelectItem value="enterprise">Escala</SelectItem></SelectContent></Select><Button type="submit" className="h-11 w-full rounded-full">Criar cliente</Button></form></DialogContent></Dialog>

      <Dialog open={createAdminOpen} onOpenChange={setCreateAdminOpen}><DialogContent className="max-w-lg rounded-3xl p-7"><DialogTitle className="text-2xl">Novo acesso administrativo</DialogTitle><DialogDescription>Defina o papel e as permissões. O gerenciamento de acessos permanece exclusivo do proprietário.</DialogDescription><form onSubmit={createAdmin} className="mt-6 space-y-4"><Input placeholder="Nome" value={adminForm.name} onChange={(event) => setAdminForm({ ...adminForm, name: event.target.value })} className="h-11 rounded-2xl" required/><Input type="email" placeholder="E-mail" value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} className="h-11 rounded-2xl" required/><Input placeholder="Nome do papel, ex: Financeiro" value={adminForm.roleName} onChange={(event) => setAdminForm({ ...adminForm, roleName: event.target.value })} className="h-11 rounded-2xl" required/><Input type="password" placeholder="Senha inicial" value={adminForm.password} onChange={(event) => setAdminForm({ ...adminForm, password: event.target.value })} className="h-11 rounded-2xl" minLength={8} required/><div className="border-y border-border py-3">{permissionLabels.map((permission) => <label key={permission.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm"><input type="checkbox" checked={adminForm.permissions.includes(permission.id)} onChange={(event) => setAdminForm({ ...adminForm, permissions: event.target.checked ? [...adminForm.permissions, permission.id] : adminForm.permissions.filter((item) => item !== permission.id) })} className="h-4 w-4 accent-[#00a6fb]"/><span>{permission.label}</span></label>)}</div><Button type="submit" className="h-11 w-full rounded-full">Criar acesso</Button></form></DialogContent></Dialog>

      <Dialog open={movementOpen} onOpenChange={setMovementOpen}><DialogContent className="max-w-md rounded-3xl p-7"><DialogTitle className="text-2xl">Novo movimento</DialogTitle><DialogDescription>Registre uma entrada ou saída manual no caixa.</DialogDescription><form onSubmit={createMovement} className="mt-6 space-y-4"><Select value={movementForm.movementType} onValueChange={(value) => setMovementForm({ ...movementForm, movementType: value })}><SelectTrigger className="h-11 rounded-2xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="entry">Entrada</SelectItem><SelectItem value="exit">Saída</SelectItem></SelectContent></Select><Input type="number" min="0.01" step="0.01" placeholder="Valor" value={movementForm.amount} onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })} className="h-11 rounded-2xl" required/><Input placeholder="Descrição" value={movementForm.description} onChange={(event) => setMovementForm({ ...movementForm, description: event.target.value })} className="h-11 rounded-2xl" required/><Input placeholder="Categoria" value={movementForm.category} onChange={(event) => setMovementForm({ ...movementForm, category: event.target.value })} className="h-11 rounded-2xl"/><Select value={movementForm.paymentMethod} onValueChange={(value) => setMovementForm({ ...movementForm, paymentMethod: value })}><SelectTrigger className="h-11 rounded-2xl"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="Pix">Pix</SelectItem><SelectItem value="Cartão">Cartão</SelectItem><SelectItem value="Boleto">Boleto</SelectItem><SelectItem value="Transferência">Transferência</SelectItem><SelectItem value="Dinheiro">Dinheiro</SelectItem><SelectItem value="Outro">Outro</SelectItem></SelectContent></Select><Input type="date" value={movementForm.movementDate} onChange={(event) => setMovementForm({ ...movementForm, movementDate: event.target.value })} className="h-11 rounded-2xl" required/><Button type="submit" className="h-11 w-full rounded-full">Salvar movimento</Button></form></DialogContent></Dialog>

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}><DialogContent className="max-w-sm rounded-3xl p-6"><DialogTitle className="text-xl">{confirmAction?.title}</DialogTitle><DialogDescription className="mt-2 leading-6">{confirmAction?.description}</DialogDescription><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmAction(null)} className="rounded-full">Cancelar</Button><Button variant="destructive" onClick={async () => { const action = confirmAction; setConfirmAction(null); if (action) { try { await action.run(); } catch (error: any) { toast({ title: "Não foi possível excluir", description: error.message, variant: "destructive" }); } } }} className="rounded-full px-5">{confirmAction?.actionLabel}</Button></div></DialogContent></Dialog>
    </main>
  );
}
