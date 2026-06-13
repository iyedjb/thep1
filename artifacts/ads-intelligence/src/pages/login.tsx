import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Activity, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export default function Login() {
  const [, setLocation] = useLocation();
  const loginMutation = useLogin();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Initialize Google Identity Services
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !window.google) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
    });
  }, []);

  const handleGoogleCredential = async (response: { credential: string }) => {
    setGoogleLoading(true);
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no login com Google");
      localStorage.setItem("ads_token", data.token);
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ title: "Erro no login com Google", description: err.message, variant: "destructive" });
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleClick = () => {
    if (window.google) {
      window.google.accounts.id.prompt();
    } else {
      toast({ title: "Google Sign-In indisponível", description: "Recarregue a página e tente novamente.", variant: "destructive" });
    }
  };

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data }, {
      onSuccess: (result) => {
        localStorage.setItem("ads_token", result.token);
        setLocation("/dashboard");
      },
      onError: () => {
        toast({
          title: "Erro no login",
          description: "Credenciais inválidas. Tente novamente.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left side - Login Form */}
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-16 xl:px-24 bg-white bg-dots-grid relative">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col items-center text-center gap-2 mb-8">
            <div className="w-12 h-12 bg-blue-50 text-primary rounded-full flex items-center justify-center mb-4">
              <Activity className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Bem-vindo!
            </h2>
            <p className="text-sm text-muted-foreground">
              Digite seu e-mail para começar
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail corporativo</FormLabel>
                    <FormControl>
                      <Input placeholder="voce@empresa.com.br" {...field} className="rounded-2xl bg-slate-50/50 border-slate-200/80 py-5 focus-visible:ring-sky-500/20 focus-visible:ring-4 focus-visible:border-sky-500 transition-all duration-200" data-testid="input-email" />
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
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="••••••••" 
                          {...field} 
                          className="rounded-2xl bg-slate-50/50 border-slate-200/80 py-5 pr-12 focus-visible:ring-sky-500/20 focus-visible:ring-4 focus-visible:border-sky-500 transition-all duration-200" 
                          data-testid="input-password" 
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full rounded-full py-6 font-semibold bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-white mt-4 transition-all shadow-md shadow-sky-500/10 hover:shadow-lg hover:shadow-sky-500/20 active:scale-[0.98] cursor-pointer" 
                disabled={loginMutation.isPending}
                data-testid="button-submit-login"
              >
                {loginMutation.isPending ? "Acessando..." : "Continuar"}
              </Button>

              <div className="text-center text-xs text-muted-foreground mt-4">
                Login para usuários cadastrados pela diretoria
              </div>

              <div className="relative flex py-4 items-center">
                <div className="flex-grow border-t border-border/60"></div>
                <span className="flex-shrink mx-4 text-xs text-muted-foreground uppercase tracking-wider">ou entre com</span>
                <div className="flex-grow border-t border-border/60"></div>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleGoogleClick}
                  disabled={googleLoading}
                  className="w-10 h-10 border border-border/80 hover:bg-slate-50 rounded-full flex items-center justify-center transition-colors shadow-sm disabled:opacity-50"
                  title="Entrar com Google"
                >
                  {googleLoading ? (
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                </button>
              </div>

              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Não tem uma conta? </span>
                <Link href="/signup" className="text-[#0ea5e9] hover:underline font-semibold">
                  Cadastre-se
                </Link>
              </div>
            </form>
          </Form>
        </div>
      </div>

      {/* Right side - Presentation Info (Full Image with Text Overlay) */}
      <div 
        className="hidden lg:flex w-[55%] bg-cover bg-center items-center justify-center relative border-l border-border/40 overflow-hidden"
        style={{ backgroundImage: `url('/images/auth_bg.png')` }}
      >
        {/* Subtle Dark Overlay to make the text pop */}
        <div className="absolute inset-0 bg-black/15 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

        {/* Text Overlay */}
        <div className="relative z-10 flex items-center gap-3 bg-white/10 backdrop-blur-md px-6 py-4 rounded-3xl border border-white/20 shadow-2xl select-none max-w-lg mx-6 animate-fade-in hover:bg-white/15 transition-all duration-300">
          <span className="text-white text-base md:text-lg font-medium tracking-wide">
            Success starts with
          </span>
          <div className="flex items-center gap-2 bg-[#0ea5e9] text-white px-4 py-1.5 rounded-2xl font-bold text-sm shadow-md hover:scale-[1.03] active:scale-[0.98] transition-all">
            <Activity className="w-4 h-4" />
            Ads Intelligence
          </div>
        </div>
      </div>
    </div>
  );
}
