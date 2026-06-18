import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Activity, Sparkles, FileText, MessageSquare, Share2, Shield, TrendingUp, Cpu, Check, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState } from "react";

const signupSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("E-mail inválido"),
  password: z.string(),
});

export default function Signup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome Completo</FormLabel>
                    <FormControl>
                      <Input placeholder="Seu nome" {...field} className="rounded-2xl bg-slate-50/50 border-slate-200/80 py-5 focus-visible:ring-sky-500/20 focus-visible:ring-4 focus-visible:border-sky-500 transition-all duration-200" />
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
                      <Input placeholder="voce@empresa.com.br" {...field} className="rounded-2xl bg-slate-50/50 border-slate-200/80 py-5 focus-visible:ring-sky-500/20 focus-visible:ring-4 focus-visible:border-sky-500 transition-all duration-200" />
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
                    
                    {/* Password Requirements Checklist */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 px-1 text-[11px] text-muted-foreground transition-all duration-300">
                      <div className="flex items-center gap-1.5 col-span-2 text-foreground font-semibold text-xs mb-0.5">
                        Requisitos de segurança:
                      </div>
                      <div className={`flex items-center gap-1.5 transition-colors duration-250 ${hasMinLength ? "text-emerald-600" : "text-slate-400"}`}>
                        {hasMinLength ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mx-1.5 shrink-0" />
                        )}
                        <span className={hasMinLength ? "font-medium text-emerald-600" : ""}>Mínimo de 8 caracteres</span>
                      </div>
                      <div className={`flex items-center gap-1.5 transition-colors duration-250 ${hasNumber ? "text-emerald-600" : "text-slate-400"}`}>
                        {hasNumber ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mx-1.5 shrink-0" />
                        )}
                        <span className={hasNumber ? "font-medium text-emerald-600" : ""}>Pelo menos um número</span>
                      </div>
                      <div className={`flex items-center gap-1.5 transition-colors duration-250 ${hasUppercase ? "text-emerald-600" : "text-slate-400"}`}>
                        {hasUppercase ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mx-1.5 shrink-0" />
                        )}
                        <span className={hasUppercase ? "font-medium text-emerald-600" : ""}>Letra maiúscula</span>
                      </div>
                      <div className={`flex items-center gap-1.5 transition-colors duration-250 ${hasSpecial ? "text-emerald-600" : "text-slate-400"}`}>
                        {hasSpecial ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mx-1.5 shrink-0" />
                        )}
                        <span className={hasSpecial ? "font-medium text-emerald-600" : ""}>Caractere especial</span>
                      </div>
                    </div>

                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                className="w-full rounded-full py-6 font-semibold bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-white mt-5 transition-all shadow-md shadow-sky-500/10 hover:shadow-lg hover:shadow-sky-500/20 active:scale-[0.98] cursor-pointer" 
                disabled={isPending || !allRulesMet}
              >
                {isPending ? "Criando conta..." : "Criar minha conta"}
              </Button>
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
