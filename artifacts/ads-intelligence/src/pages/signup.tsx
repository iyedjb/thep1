import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { Link, useLocation } from "wouter";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const signupSchema = z.object({
  name: z.string().min(2, "Informe seu nome completo"),
  email: z.string().email("Informe um e-mail válido"),
  password: z.string(),
});

export default function Signup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const password = form.watch("password") || "";
  const rules = [
    { label: "8 caracteres", valid: password.length >= 8 },
    { label: "1 número", valid: /\d/.test(password) },
    { label: "1 maiúscula", valid: /[A-Z]/.test(password) },
    { label: "1 caractere especial", valid: /[!@#$%^&*(),.?":{}|<>]/.test(password) },
  ];
  const passwordIsValid = rules.every((rule) => rule.valid);

  const onSubmit = async (data: z.infer<typeof signupSchema>) => {
    if (!passwordIsValid) return;
    setIsPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível criar sua conta");
      localStorage.setItem("ads_token", result.token);
      setLocation("/dashboard");
    } catch (error: any) {
      toast({ title: "Erro ao criar conta", description: error.message, variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AuthShell eyebrow="Comece agora" title="Crie sua conta" description="Organize seus dados de mídia e encontre oportunidades com mais rapidez.">
      <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary">
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao login
      </Link>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-semibold text-foreground/70">Nome completo</FormLabel>
              <FormControl>
                <Input
                  placeholder="Como podemos chamar você?"
                  autoComplete="name"
                  {...field}
                  className="h-12 rounded-xl border-border/60 bg-white/5 px-4 text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-semibold text-foreground/70">E-mail</FormLabel>
              <FormControl>
                <Input
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                  {...field}
                  className="h-12 rounded-xl border-border/60 bg-white/5 px-4 text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs font-semibold text-foreground/70">Senha</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Crie uma senha segura"
                    autoComplete="new-password"
                    {...field}
                    className="h-12 rounded-xl border-border/60 bg-white/5 px-4 pr-12 text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary/60 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 border border-border/40 p-3.5">
            {rules.map((rule) => (
              <div key={rule.label} className={`flex items-center gap-1.5 text-[11px] ${rule.valid ? "font-medium text-emerald-400" : "text-muted-foreground/60"}`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full ${rule.valid ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-muted-foreground/40"}`}>
                  {rule.valid && <Check className="h-2.5 w-2.5" />}
                </span>
                {rule.label}
              </div>
            ))}
          </div>

          <Button
            type="submit"
            disabled={isPending || !passwordIsValid}
            className="mt-2 h-12 w-full rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:bg-primary/90 active:scale-[0.99] transition-all"
          >
            {isPending ? "Criando conta..." : "Criar minha conta"}
          </Button>
        </form>
      </Form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tem uma conta?{" "}
        <Link href="/login" className="font-semibold text-primary hover:text-primary/80 transition-colors">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
