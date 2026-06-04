import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Activity, Sparkles, FileText, MessageSquare, Share2, Shield, TrendingUp, Cpu, Check, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState } from "react";

const signupSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("E-mail inválido"),
  password: z.string(),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

export default function Signup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const passwordValue = form.watch("password") || "";

  // Password rules checks
  const hasMinLength = passwordValue.length >= 8;
  const hasNumber = /\d/.test(passwordValue);
  const hasUppercase = /[A-Z]/.test(passwordValue);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(passwordValue);

  const allRulesMet = hasMinLength && hasNumber && hasUppercase && hasSpecial;

  const onSubmit = async (data: z.infer<typeof signupSchema>) => {
    if (!allRulesMet) {
      toast({
        title: "Requisitos de senha",
        description: "Certifique-se de preencher todos os requisitos da senha.",
        variant: "destructive",
      });
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Erro ao realizar cadastro.");
      }

      localStorage.setItem("ads_token", result.token);
      toast({
        title: "Cadastro realizado!",
        description: "Sua conta foi criada com sucesso.",
      });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({
        title: "Erro no cadastro",
        description: err.message || "Não foi possível criar sua conta. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left side - Signup Form */}
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-16 xl:px-24 bg-white bg-dots-grid relative">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col gap-2 mb-6">
            <Link href="/login" className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-2 w-fit font-semibold">
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar ao login
            </Link>
            <div className="flex items-center gap-2 text-primary">
              <Activity className="h-7 w-7" />
              <span className="font-bold text-xl text-foreground">Ads Intelligence</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              Crie sua conta
            </h2>
            <p className="text-sm text-muted-foreground">
              Cadastre-se para começar
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3.5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome Completo</FormLabel>
                    <FormControl>
                      <Input placeholder="Seu nome" {...field} className="rounded-2xl bg-slate-50/50 py-5" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">E-mail corporativo</FormLabel>
                    <FormControl>
                      <Input placeholder="voce@empresa.com.br" {...field} className="rounded-2xl bg-slate-50/50 py-5" />
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
                      <Input type="password" placeholder="••••••••" {...field} className="rounded-2xl bg-slate-50/50 py-5" />
                    </FormControl>
                    
                    {/* Password Requirements Checklist */}
                    <div className="mt-2 p-3 bg-slate-50 border border-border/50 rounded-2xl space-y-1 text-[11px] text-muted-foreground">
                      <p className="font-semibold text-foreground mb-1">Requisitos de segurança:</p>
                      <div className="flex items-center gap-1.5">
                        {hasMinLength ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mx-1" />
                        )}
                        <span className={hasMinLength ? "text-green-600 font-medium" : ""}>Mínimo de 8 caracteres</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasNumber ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mx-1" />
                        )}
                        <span className={hasNumber ? "text-green-600 font-medium" : ""}>Pelo menos um número</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasUppercase ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mx-1" />
                        )}
                        <span className={hasUppercase ? "text-green-600 font-medium" : ""}>Pelo menos uma letra maiúscula</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasSpecial ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 mx-1" />
                        )}
                        <span className={hasSpecial ? "text-green-600 font-medium" : ""}>Pelo menos um caractere especial</span>
                      </div>
                    </div>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confirmar Senha</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="rounded-2xl bg-slate-50/50 py-5" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full rounded-full py-5 font-semibold bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-white mt-4 transition-colors" 
                disabled={isPending || !allRulesMet}
              >
                {isPending ? "Criando conta..." : "Criar minha conta"}
              </Button>
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
