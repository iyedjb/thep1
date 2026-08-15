import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
      const token = localStorage.getItem("admin_token");
      if (token) {
        const session = await fetch("/api/admin/session", { headers: { Authorization: `Bearer ${token}` } });
        if (session.ok) { setLocation("/admin"); return; }
        localStorage.removeItem("admin_token");
      }
      const response = await fetch("/api/admin/setup-status");
      const data = await response.json();
      setConfigured(Boolean(data.configured));
    };
    check().catch(() => setConfigured(true));
  }, [setLocation]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!configured && password !== confirmPassword) {
      toast({ title: "As senhas não coincidem", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(configured ? "/api/admin/login" : "/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível continuar.");
      localStorage.setItem("admin_token", data.adminToken);
      setLocation("/admin");
    } catch (error: any) {
      toast({ title: configured ? "Acesso recusado" : "Não foi possível criar o acesso", description: error.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  if (configured === null) return <main className="min-h-screen bg-background" />;

  return (
    <main className="grid min-h-screen bg-background px-6 text-foreground lg:grid-cols-[1fr_1fr]">
      <section className="hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:px-16 lg:py-14">
        <p className="text-sm font-semibold tracking-tight">Clic Lab</p>
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Administração</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight">Controle a operação com clareza.</h1>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">Clientes, assinaturas, pagamentos e acessos administrativos em um único ambiente.</p>
        </div>
        <p className="text-xs text-muted-foreground">Acesso privado da plataforma</p>
      </section>

      <section className="flex items-center justify-center py-16 lg:px-16">
        <form onSubmit={submit} className="w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{configured ? "Acesso administrativo" : "Primeiro acesso"}</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight">{configured ? "Entrar" : "Criar acesso proprietário"}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{configured ? "Use as credenciais cadastradas na configuração inicial." : "Este será o único proprietário inicial. Depois, você poderá criar acessos limitados para sua equipe."}</p>

          <div className="mt-10 space-y-5">
            {!configured && <div className="space-y-2"><label htmlFor="admin-name" className="text-sm font-medium">Seu nome</label><Input id="admin-name" value={name} onChange={(event) => setName(event.target.value)} className="h-12 rounded-2xl" required /></div>}
            <div className="space-y-2"><label htmlFor="admin-email" className="text-sm font-medium">E-mail</label><Input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 rounded-2xl" autoComplete="email" required /></div>
            <div className="space-y-2"><label htmlFor="admin-password" className="text-sm font-medium">Senha</label><Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 rounded-2xl" autoComplete={configured ? "current-password" : "new-password"} minLength={8} required /></div>
            {!configured && <div className="space-y-2"><label htmlFor="admin-confirm" className="text-sm font-medium">Confirmar senha</label><Input id="admin-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-12 rounded-2xl" autoComplete="new-password" minLength={8} required /></div>}
          </div>

          <Button type="submit" disabled={loading} className="mt-8 h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">{loading ? "Aguarde..." : configured ? "Entrar" : "Criar e entrar"}</Button>
        </form>
      </section>
    </main>
  );
}
