import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Invitation = { email: string; roleKey: string; roleName: string; expiresAt: string };

export default function AdminAcceptInvitePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", confirmation: "" });

  useEffect(() => {
    if (!token) { setError("Este convite não é válido."); setLoading(false); return; }
    fetch(`/api/admin/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Este convite não está disponível.");
        setInvitation(data);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirmation) { toast({ title: "As senhas não coincidem", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, password: form.password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível criar seu acesso.");
      setComplete(true);
    } catch (reason: any) { toast({ title: "Convite não concluído", description: reason.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  };

  return <AuthShell eyebrow="Equipe administrativa" title={complete ? "Acesso criado" : "Complete seu convite"} description={complete ? "Sua conta administrativa está pronta para uso." : "Defina seus dados para acessar o painel com as permissões do seu papel."}>
    {loading ? <div className="py-16 text-center text-sm text-slate-500">Validando convite...</div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-700">{error}</div> : complete ? <div className="text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6"/></div><p className="mt-5 text-sm leading-6 text-slate-500">Agora você pode entrar usando seu e-mail e a senha que acabou de criar.</p><Button onClick={() => setLocation("/admin/login")} className="mt-6 h-12 w-full rounded-xl">Entrar no painel administrativo</Button></div> : invitation ? <form onSubmit={submit} className="space-y-4">
      <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary"><ShieldCheck className="h-4 w-4"/></span><div><p className="text-xs text-slate-500">Papel atribuído</p><p className="text-sm font-semibold text-slate-900">{invitation.roleName}</p></div></div></div>
      <div><label className="text-xs font-semibold text-slate-600">E-mail</label><Input value={invitation.email} disabled className="mt-2 h-12 rounded-xl border-slate-200 bg-slate-50 px-4 text-slate-500"/></div>
      <div><label htmlFor="invite-name" className="text-xs font-semibold text-slate-600">Seu nome</label><Input id="invite-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" placeholder="Nome completo" className="mt-2 h-12 rounded-xl border-slate-200 bg-white px-4" required/></div>
      <div><label htmlFor="invite-password" className="text-xs font-semibold text-slate-600">Crie uma senha</label><div className="relative mt-2"><Input id="invite-password" type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" placeholder="Mínimo 8 caracteres" className="h-12 rounded-xl border-slate-200 bg-white px-4 pr-12" required/><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div><p className="mt-2 text-[11px] leading-4 text-slate-400">Use maiúscula, minúscula, número e símbolo.</p></div>
      <div><label htmlFor="invite-confirmation" className="text-xs font-semibold text-slate-600">Confirme a senha</label><Input id="invite-confirmation" type="password" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} autoComplete="new-password" placeholder="Digite novamente" className="mt-2 h-12 rounded-xl border-slate-200 bg-white px-4" required/></div>
      <Button type="submit" disabled={submitting} className="h-12 w-full rounded-xl font-semibold">{submitting ? "Criando acesso..." : "Criar meu acesso"}</Button>
    </form> : null}
  </AuthShell>;
}
