import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Activity, Sparkles, FileText, MessageSquare, Share2, Shield, TrendingUp, Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
                      <Input placeholder="voce@empresa.com.br" {...field} className="rounded-2xl bg-slate-50/50 py-5" data-testid="input-email" />
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
                      <Input type="password" placeholder="••••••••" {...field} className="rounded-2xl bg-slate-50/50 py-5" data-testid="input-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full rounded-full py-5 font-semibold bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-white mt-2 transition-colors" 
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
                  onClick={() => toast({ title: "Google Login", description: "Implementação em andamento." })}
                  className="w-10 h-10 border border-border/80 hover:bg-slate-50 rounded-full flex items-center justify-center transition-colors shadow-sm"
                >
                  <GoogleIcon />
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

      {/* Right side - Presentation Info */}
      <div className="hidden lg:flex w-[55%] bg-[#f4f9fd] bg-dots-grid items-center justify-center p-12 relative border-l border-border/40">
        <div className="w-full max-w-xl p-10 bg-white border border-white/80 shadow-[0_15px_45px_rgba(30,100,250,0.05)] rounded-[2.5rem] flex flex-col">
          {/* Header 4 Icons */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground mt-1">IA 24/7</span>
            </div>
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground mt-1">Relatórios</span>
            </div>
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                <MessageSquare className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground mt-1">Suporte</span>
            </div>
            <div className="flex flex-col items-center text-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                <Share2 className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground mt-1">Integração</span>
            </div>
          </div>

          {/* Title and description */}
          <div className="text-left mb-8">
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-4">
              Sua Jornada de Performance Começa Aqui!
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Acesse ferramentas de inteligência, otimize campanhas de Google Ads em tempo real e acompanhe seu crescimento com relatórios intuitivos.
            </p>
          </div>

          {/* Pill tags */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#f8fafc]/80 border border-slate-100/80 rounded-[22px] p-5 flex flex-col items-center text-center hover:scale-[1.02] transition-transform duration-200 shadow-2xs">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="text-sm font-extrabold text-foreground">24/7</span>
              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">Suporte IA</span>
            </div>
            <div className="bg-[#f8fafc]/80 border border-slate-100/80 rounded-[22px] p-5 flex flex-col items-center text-center hover:scale-[1.02] transition-transform duration-200 shadow-2xs">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                <Shield className="w-5 h-5" />
              </div>
              <span className="text-sm font-extrabold text-slate-800">100%</span>
              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">Seguro</span>
            </div>
            <div className="bg-[#f8fafc]/80 border border-slate-100/80 rounded-[22px] p-5 flex flex-col items-center text-center hover:scale-[1.02] transition-transform duration-200 shadow-2xs">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-sm font-extrabold text-foreground">ROAS</span>
              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">Otimizado</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
