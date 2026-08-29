import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Eye, EyeOff, MailCheck } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          prompt: () => void;
          renderButton: (parent: HTMLElement, options: any) => void;
        };
      };
    };
  }
}

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

function GoogleIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.9 6.9 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(() => Boolean(localStorage.getItem("ads_token")));
  const [loginPending, setLoginPending] = useState(false);
  const [otpPending, setOtpPending] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<{ token: string; email: string } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [accessMessage, setAccessMessage] = useState(() => sessionStorage.getItem("account_access_error") || "");

  useEffect(() => { sessionStorage.removeItem("account_access_error"); }, []);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    const savedToken = localStorage.getItem("ads_token");
    if (!savedToken) {
      setCheckingSession(false);
      return;
    }

    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${savedToken}` } })
      .then(async (response) => {
        if (response.ok) {
          const currentUser = await response.json();
          queryClient.setQueryData(getGetMeQueryKey(), currentUser);
          setLocation("/creator");
          return;
        }
        const denied = await response.json().catch(() => ({}));
        if (response.status === 403) setAccessMessage(denied.error || "Seu acesso à plataforma está temporariamente indisponível.");
        localStorage.removeItem("ads_token");
        queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false));
  }, [queryClient, setLocation]);

  const handleGoogleCredential = async (response: { credential: string }) => {
    setGoogleLoading(true);
    try {
      const result = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Não foi possível entrar com Google");
      if (data.requiresOtp) {
        setOtpChallenge({ token: data.challengeToken, email: data.maskedEmail });
        setOtpCode("");
        setResendIn(Number(data.resendAfterSeconds || 45));
        return;
      }
      localStorage.setItem("ads_token", data.token);
      queryClient.setQueryData(getGetMeQueryKey(), data.user);
      setLocation("/creator");
    } catch (error: any) {
      toast({ title: "Erro no login com Google", description: error.message, variant: "destructive" });
    } finally {
      setGoogleLoading(false);
    }
  };

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const renderGButton = () => {
      if (!window.google?.accounts?.id) return;
      const container = document.getElementById("google-button-container");
      if (!container) return;
      
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
      });
      
      window.google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        logo_alignment: "center",
      });
    };

    // If GIS already loaded, init immediately
    if (window.google?.accounts?.id) {
      renderGButton();
      return;
    }

    // Otherwise wait for the script to load
    const script = document.querySelector("script[src*='accounts.google.com/gsi/client']");
    if (script) {
      script.addEventListener("load", renderGButton);
    }
  }, []);

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setLoginPending(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) { setAccessMessage(result.error || "Seu acesso está indisponível."); return; }
        throw new Error(result.error || "Confira seu e-mail e sua senha.");
      }
      if (result.requiresOtp) {
        setOtpChallenge({ token: result.challengeToken, email: result.maskedEmail });
        setOtpCode("");
        setResendIn(Number(result.resendAfterSeconds || 45));
        return;
      }
      localStorage.setItem("ads_token", result.token);
      queryClient.setQueryData(getGetMeQueryKey(), result.user);
      setLocation("/creator");
    } catch (error: any) { toast({ title: "Não foi possível entrar", description: error.message, variant: "destructive" }); }
    finally { setLoginPending(false); }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!otpChallenge || otpCode.length !== 6) return;
    setOtpPending(true);
    try {
      const response = await fetch("/api/auth/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken: otpChallenge.token, code: otpCode }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Código inválido.");
      localStorage.setItem("ads_token", result.token);
      queryClient.setQueryData(getGetMeQueryKey(), result.user);
      setLocation("/creator");
    } catch (error: any) {
      toast({ title: "Não foi possível confirmar", description: error.message, variant: "destructive" });
    } finally { setOtpPending(false); }
  };

  const resendOtp = async () => {
    if (!otpChallenge || resendIn > 0) return;
    setOtpPending(true);
    try {
      const response = await fetch("/api/auth/resend-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken: otpChallenge.token }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível reenviar.");
      setOtpCode("");
      setResendIn(Number(result.resendAfterSeconds || 45));
      toast({ title: "Novo código enviado" });
    } catch (error: any) { toast({ title: "Falha ao reenviar", description: error.message, variant: "destructive" }); }
    finally { setOtpPending(false); }
  };

  if (checkingSession) {
    return <div className="min-h-screen bg-white" aria-label="Verificando sessão" />;
  }

  return (
    <AuthShell eyebrow={otpChallenge ? "Verificação segura" : "Bem-vindo de volta"} title={otpChallenge ? "Confirme seu acesso" : "Entre na sua conta ClicLab"} description={otpChallenge ? `Enviamos um código de 6 números para ${otpChallenge.email}.` : "Insira seus dados para acessar o painel e gerenciar suas campanhas."}>
      <Dialog open={Boolean(accessMessage)} onOpenChange={(open) => { if (!open) setAccessMessage(""); }}><DialogContent className="max-w-sm rounded-3xl border-slate-200 bg-white p-7 text-slate-950"><DialogTitle className="text-2xl">Acesso indisponível</DialogTitle><DialogDescription className="mt-3 leading-6 text-slate-500">{accessMessage}</DialogDescription><Button onClick={() => setAccessMessage("")} className="mt-5 h-11 w-full rounded-full">Entendi</Button></DialogContent></Dialog>
      {otpChallenge ? <form onSubmit={verifyOtp} className="space-y-5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-primary"><MailCheck className="h-5 w-5" /></div>
        <div><label htmlFor="login-otp" className="text-xs font-semibold text-slate-600">Código de verificação</label><Input id="login-otp" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000" className="mt-2 h-14 rounded-xl border-slate-200 bg-white text-center font-mono text-2xl font-semibold tracking-[0.22em] text-slate-900 shadow-sm focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20" /></div>
        <Button type="submit" disabled={otpPending || otpCode.length !== 6} className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_0_20px_rgba(59,130,246,0.25)]">{otpPending ? "Verificando..." : "Confirmar e entrar"}</Button>
        <div className="flex items-center justify-between text-xs"><button type="button" onClick={() => { setOtpChallenge(null); setOtpCode(""); }} className="inline-flex items-center gap-1.5 font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5"/>Voltar</button><button type="button" disabled={otpPending || resendIn > 0} onClick={resendOtp} className="font-semibold text-primary disabled:text-slate-400">{resendIn > 0 ? `Reenviar em ${resendIn}s` : "Reenviar código"}</button></div>
      </form> : <>
      {/* Google OAuth Official Button */}
      <div id="google-button-container" className="w-full flex justify-center h-12 mb-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center"></div>

      <div className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">ou com e-mail e senha</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-slate-600">E-mail</FormLabel>
                <FormControl>
                  <Input
                    placeholder="voce@empresa.com"
                    autoComplete="email"
                    {...field}
                    className="h-12 rounded-xl border-slate-200 bg-white px-4 text-slate-900 placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20 shadow-sm transition-all"
                    data-testid="input-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs font-semibold text-slate-600">Senha</FormLabel>
                </div>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...field}
                      className="h-12 rounded-xl border-slate-200 bg-white px-4 pr-12 text-slate-900 placeholder:text-slate-400 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20 shadow-sm transition-all"
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            disabled={loginPending}
            className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:bg-primary/90 active:scale-[0.99] transition-all"
            data-testid="button-submit-login"
          >
            {loginPending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Entrando...
              </span>
            ) : "Entrar"}
          </Button>
        </form>
      </Form>

      <p className="mt-8 text-center text-sm text-slate-500">
        Ainda não tem uma conta?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:text-primary/80 transition-colors">
          Criar conta
        </Link>
      </p>
      </>}
    </AuthShell>
  );
}
