import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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
  const loginMutation = useLogin();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

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
      localStorage.setItem("ads_token", data.token);
      setLocation("/dashboard");
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

  const onSubmit = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data }, {
      onSuccess: (result) => {
        localStorage.setItem("ads_token", result.token);
        setLocation("/dashboard");
      },
      onError: () => toast({ title: "Não foi possível entrar", description: "Confira seu e-mail e sua senha.", variant: "destructive" }),
    });
  };

  return (
    <AuthShell eyebrow="Bem-vindo de volta" title="Entre na sua conta ClicLab" description="Insira seus dados para acessar o painel e gerenciar suas campanhas.">
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
            disabled={loginMutation.isPending}
            className="h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:bg-primary/90 active:scale-[0.99] transition-all"
            data-testid="button-submit-login"
          >
            {loginMutation.isPending ? (
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
    </AuthShell>
  );
}
