import React, { useState } from "react";
import { useLocation } from "wouter";
import { Shield, Lock, ArrowRight, Sparkles, CheckCircle2, AlertCircle, Key } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/layout/logo";

export default function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Informe o e-mail e a senha de administrador.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Credenciais de administrador inválidas");
      }

      // Store admin token & session
      localStorage.setItem("admin_token", data.adminToken);
      localStorage.setItem("ads_token", data.adminToken); // fallback token

      toast({
        title: "Acesso Concedido! 🛡️",
        description: `Bem-vindo ao Portal Administrativo, ${data.user.name}`,
      });

      setLocation("/admin");
    } catch (err: any) {
      toast({
        title: "Falha na Autenticação",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Background ambient lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-emerald-500/10 via-primary/10 to-purple-500/5 blur-[120px] pointer-events-none rounded-full" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <Shield className="w-3.5 h-3.5" /> Portal Administrativo da Plataforma
          </div>

          <div className="flex justify-center">
            <Logo iconSize={36} />
          </div>

          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            Acesso Restrito - Admin
          </h1>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Área exclusiva para administradores da plataforma para atendimento ao cliente e gestão de acessos.
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-border/80 bg-card/50 backdrop-blur-xl shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-400" />
              Autenticação de Segurança
            </CardTitle>
            <CardDescription className="text-xs">
              Digite seu e-mail e senha de Administrador.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleAdminLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90">E-mail Administrativo</label>
                <Input
                  type="email"
                  placeholder="admin@adsintelligence.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background/60 border-border text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90">Senha de Administrador</label>
                <Input
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-background/60 border-border text-xs"
                  required
                />
              </div>
            </CardContent>

            <CardFooter className="pt-2 flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-xs h-10 shadow-lg shadow-emerald-500/20"
              >
                {isLoading ? (
                  "Autenticando..."
                ) : (
                  <>
                    Entrar no Painel Admin <ArrowRight className="w-4 h-4 ml-1.5" />
                  </>
                )}
              </Button>

              <div className="p-3 rounded-lg border border-white/5 bg-white/[0.02] text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Dica: Use credenciais de Admin cadastradas</span>
                <Key className="w-3.5 h-3.5 text-muted-foreground/60" />
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
