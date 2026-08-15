import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Zap,
  Crown,
  ShieldCheck,
  QrCode,
  CreditCard,
  Copy,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Clock,
  ExternalLink,
  Award,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/layout/logo";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  subscriptionTier?: string;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string;
}

async function safeFetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `Erro HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err && err.error) msg = err.error;
    } catch (_) {
      try {
        const text = await res.text();
        if (text) msg = text.slice(0, 100);
      } catch (_) {}
    }
    throw new Error(msg);
  }
  return res.json();
}

export default function CheckoutPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "enterprise">("pro");
  const [isPixDialogOpen, setIsPixDialogOpen] = useState(false);
  const [pixData, setPixData] = useState<{
    paymentId: string;
    qrCode: string;
    qrCodeBase64: string;
    ticketUrl?: string;
    amount: number;
  } | null>(null);

  const [copiedPix, setCopiedPix] = useState(false);
  const [pixTimeLeft, setPixTimeLeft] = useState(900); // 15 min countdown
  const [isVerifyingPix, setIsVerifyingPix] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);

  // Fetch current user details
  const { data: user, refetch: refetchUser } = useQuery<UserProfile>({
    queryKey: ["user-me"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      return safeFetchJson("/api/auth/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    },
  });

  // Create Checkout Pro Preference Mutation
  const createPreferenceMutation = useMutation({
    mutationFn: async (plan: "pro" | "enterprise") => {
      const token = localStorage.getItem("ads_token");
      return safeFetchJson("/api/mercadopago/create-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planTier: plan,
          billingCycle,
        }),
      });
    },
    onSuccess: (data) => {
      if (data.initPoint) {
        window.location.href = data.initPoint;
      }
    },
    onError: (err: any) => {
      toast({
        title: "Erro no Checkout",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Create Pix Payment Mutation
  const createPixMutation = useMutation({
    mutationFn: async (plan: "pro" | "enterprise") => {
      const token = localStorage.getItem("ads_token");
      return safeFetchJson("/api/mercadopago/create-pix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planTier: plan,
          billingCycle,
        }),
      });
    },
    onSuccess: (data) => {
      setPixData({
        paymentId: data.paymentId,
        qrCode: data.qrCode,
        qrCodeBase64: data.qrCodeBase64,
        ticketUrl: data.ticketUrl,
        amount: data.amount,
      });
      setPixTimeLeft(900);
      setIsPixDialogOpen(true);
    },
    onError: (err: any) => {
      toast({
        title: "Erro Pix",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Dev Simulation Upgrade Mutation
  const simulateUpgradeMutation = useMutation({
    mutationFn: async (plan: "pro" | "enterprise") => {
      const token = localStorage.getItem("ads_token");
      return safeFetchJson("/api/subscription/simulate-upgrade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planTier: plan }),
      });
    },
    onSuccess: (data) => {
      refetchUser();
      queryClient.invalidateQueries({ queryKey: ["user-me"] });
      setIsPixDialogOpen(false);
      setIsSuccessModalOpen(true);
      toast({
        title: "Upgrade Concluído! 🎉",
        description: `Seu plano foi atualizado para ${data.planTier.toUpperCase()} com sucesso!`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erro na Simulação",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Countdown timer for Pix modal
  useEffect(() => {
    if (!isPixDialogOpen || pixTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setPixTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPixDialogOpen, pixTimeLeft]);

  // Live polling Pix payment status verification
  useEffect(() => {
    if (!isPixDialogOpen || !pixData?.paymentId) return;

    const pollInterval = setInterval(async () => {
      try {
        setIsVerifyingPix(true);
        const token = localStorage.getItem("ads_token");
        const res = await fetch(`/api/mercadopago/verify-payment/${pixData.paymentId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.approved) {
            clearInterval(pollInterval);
            setIsPixDialogOpen(false);
            setIsSuccessModalOpen(true);
            refetchUser();
            queryClient.invalidateQueries({ queryKey: ["user-me"] });
            toast({
              title: "Pagamento Confirmado! ⚡",
              description: "Sua assinatura foi ativada com sucesso. Aproveite todos os recursos!",
            });
          }
        }
      } catch (_) {
      } finally {
        setIsVerifyingPix(false);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [isPixDialogOpen, pixData?.paymentId]);

  const handleCopyPix = () => {
    if (pixData?.qrCode) {
      navigator.clipboard.writeText(pixData.qrCode);
      setCopiedPix(true);
      toast({
        title: "Copiado!",
        description: "Código Pix copia e cola copiado para a área de transferência.",
      });
      setTimeout(() => setCopiedPix(false), 3000);
    }
  };

  const formatMinutes = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const currentTier = user?.subscriptionTier || "free";

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8 bg-background relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-primary/10 via-purple-500/5 to-transparent blur-3xl pointer-events-none -z-10" />

      <div className="max-w-6xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Planos & Assinatura Ads Intelligence
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            Escolha o plano ideal para <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-400 to-purple-400">Escalar suas Campanhas</span>
          </h1>
          <p className="text-muted-foreground text-lg">
            Infraestrutura de pagamento segura via Mercado Pago com Pix instantâneo e liberação imediata da sua conta.
          </p>

          {/* Billing Cycle Switch */}
          <div className="pt-4 flex items-center justify-center gap-3 select-none">
            <span
              className={`text-sm font-medium cursor-pointer transition-colors ${
                billingCycle === "monthly" ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
              onClick={() => setBillingCycle("monthly")}
            >
              Cobrança Mensal
            </span>

            <button
              type="button"
              onClick={() => setBillingCycle(billingCycle === "monthly" ? "yearly" : "monthly")}
              className="relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-muted transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-75"
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-primary shadow-lg ring-0 transition duration-200 ease-in-out ${
                  billingCycle === "yearly" ? "translate-x-7" : "translate-x-0"
                }`}
              />
            </button>

            <span
              className={`text-sm font-medium cursor-pointer transition-colors flex items-center gap-1.5 ${
                billingCycle === "yearly" ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
              onClick={() => setBillingCycle("yearly")}
            >
              Cobrança Anual
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                Economize 20%
              </Badge>
            </span>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="grid md:grid-cols-2 gap-8 items-stretch max-w-4xl mx-auto">
          {/* Plano PRO */}
          <Card
            className={`relative flex flex-col justify-between transition-all duration-300 border-2 ${
              selectedPlan === "pro"
                ? "border-primary bg-primary/[0.03] shadow-[0_0_30px_rgba(99,179,237,0.15)]"
                : "border-border/60 hover:border-border"
            }`}
            onClick={() => setSelectedPlan("pro")}
          >
            {currentTier === "pro" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-emerald-500 text-black font-bold uppercase tracking-wider text-[10px] px-3 py-0.5">
                  Seu Plano Atual
                </Badge>
              </div>
            )}

            <CardHeader className="pb-6">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Zap className="w-6 h-6" />
                </div>
                <Badge variant="outline" className="border-primary/30 text-primary font-medium">
                  Mais Popular
                </Badge>
              </div>
              <CardTitle className="text-2xl font-bold mt-4">Plano Pro</CardTitle>
              <CardDescription className="text-sm">
                Ideal para afiliados profissionais e gestores que precisam de escala e criação de presells em alta performance.
              </CardDescription>

              <div className="pt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-foreground">
                  R$ {billingCycle === "yearly" ? "77,50" : "97,00"}
                </span>
                <span className="text-muted-foreground text-sm">/mês</span>
                {billingCycle === "yearly" && (
                  <span className="text-xs text-muted-foreground block ml-2">
                    (R$ 930 faturados anualmente)
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">
                O que está incluído:
              </div>
              <ul className="space-y-3 text-sm">
                {[
                  "Campanhas ilimitadas no Google Ads",
                  "Gerador de Presell com IA de alta conversão",
                  "Integração direta com Dr. Cash",
                  "Análise de Palavras-Chave e Google Trends",
                  "Suporte prioritário via WhatsApp",
                ].map((feat, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-foreground/90">{feat}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter className="pt-6 border-t border-border/40 flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/25"
                disabled={createPreferenceMutation.isPending || createPixMutation.isPending || currentTier === "pro"}
                onClick={() => createPixMutation.mutate("pro")}
              >
                {createPixMutation.isPending && selectedPlan === "pro" ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                Pagar com Pix (Liberação Imediata)
              </Button>

              <Button
                variant="outline"
                size="lg"
                className="w-full border-border hover:bg-white/5"
                disabled={createPreferenceMutation.isPending || createPixMutation.isPending || currentTier === "pro"}
                onClick={() => createPreferenceMutation.mutate("pro")}
              >
                {createPreferenceMutation.isPending && selectedPlan === "pro" ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="w-4 h-4 mr-2" />
                )}
                Checkout Mercado Pago (Cartão / Boleto)
              </Button>
            </CardFooter>
          </Card>

          {/* Plano ENTERPRISE */}
          <Card
            className={`relative flex flex-col justify-between transition-all duration-300 border-2 ${
              selectedPlan === "enterprise"
                ? "border-purple-500 bg-purple-500/[0.03] shadow-[0_0_30px_rgba(168,85,247,0.15)]"
                : "border-border/60 hover:border-border"
            }`}
            onClick={() => setSelectedPlan("enterprise")}
          >
            {currentTier === "enterprise" && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-purple-500 text-white font-bold uppercase tracking-wider text-[10px] px-3 py-0.5">
                  Seu Plano Atual
                </Badge>
              </div>
            )}

            <CardHeader className="pb-6">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Crown className="w-6 h-6" />
                </div>
                <Badge variant="outline" className="border-purple-500/30 text-purple-400 font-medium">
                  Escala Total
                </Badge>
              </div>
              <CardTitle className="text-2xl font-bold mt-4">Plano Enterprise</CardTitle>
              <CardDescription className="text-sm">
                Projetado para agências, grandes equipes e operações com alto volume de tráfego pago.
              </CardDescription>

              <div className="pt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-foreground">
                  R$ {billingCycle === "yearly" ? "157,50" : "197,00"}
                </span>
                <span className="text-muted-foreground text-sm">/mês</span>
                {billingCycle === "yearly" && (
                  <span className="text-xs text-muted-foreground block ml-2">
                    (R$ 1.890 faturados anualmente)
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">
                Tudo do Plano Pro +
              </div>
              <ul className="space-y-3 text-sm">
                {[
                  "Múltiplas contas de Google Ads integradas",
                  "Geração de Presell em massa via IA",
                  "Acesso completo à API e Webhooks",
                  "Gerente de conta dedicado 24/7",
                  "SLA garantido de 99.9% de uptime",
                ].map((feat, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="text-foreground/90">{feat}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter className="pt-6 border-t border-border/40 flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-lg shadow-purple-500/25"
                disabled={createPreferenceMutation.isPending || createPixMutation.isPending || currentTier === "enterprise"}
                onClick={() => createPixMutation.mutate("enterprise")}
              >
                {createPixMutation.isPending && selectedPlan === "enterprise" ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                Pagar com Pix (Liberação Imediata)
              </Button>

              <Button
                variant="outline"
                size="lg"
                className="w-full border-border hover:bg-white/5"
                disabled={createPreferenceMutation.isPending || createPixMutation.isPending || currentTier === "enterprise"}
                onClick={() => createPreferenceMutation.mutate("enterprise")}
              >
                {createPreferenceMutation.isPending && selectedPlan === "enterprise" ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="w-4 h-4 mr-2" />
                )}
                Checkout Mercado Pago (Cartão / Boleto)
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Security and Guarantee info */}
        <div className="grid sm:grid-cols-3 gap-6 pt-6 border-t border-border/40">
          <div className="flex items-start gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
            <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Mercado Pago Protegido</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Criptografia SSL de ponta a ponta e total privacidade dos dados financeiros.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
            <Zap className="w-6 h-6 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Liberação Instantânea</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                O pagamento via Pix é verificado automaticamente pelo nosso servidor em segundos.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
            <Award className="w-6 h-6 text-primary shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Sem Fidelidade</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cancele ou faça downgrade da sua assinatura a qualquer momento com 1 clique.
              </p>
            </div>
          </div>
        </div>

        {/* Quick sandbox simulation option for local testing */}
        <div className="text-center pt-4">
          <p className="text-xs text-muted-foreground">
            Desenvolvimento Local / Teste Sandbox:
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => simulateUpgradeMutation.mutate("pro")}
            className="text-xs text-primary underline hover:text-primary/80 mt-1"
          >
            Simular Upgrade Instantâneo para Plano PRO (Dev)
          </Button>
        </div>
      </div>

      {/* Pix QR Code Dialog */}
      <Dialog open={isPixDialogOpen} onOpenChange={setIsPixDialogOpen}>
        <DialogContent className="sm:max-w-md bg-background border-border/80 text-foreground">
          <DialogHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-1">
              <QrCode className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl font-bold text-center">
              Pagamento via Pix - Mercado Pago
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground">
              Abra o app do seu banco e escaneie o código abaixo ou copie o código Pix.
            </DialogDescription>
          </DialogHeader>

          {pixData && (
            <div className="space-y-5 pt-2">
              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-white text-black max-w-[240px] mx-auto shadow-xl">
                {pixData.qrCodeBase64 && pixData.qrCodeBase64.length > 50 ? (
                  <img
                    src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                    alt="Pix QR Code"
                    className="w-48 h-48 object-contain"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center bg-gray-100 rounded-lg p-2 text-center text-xs font-mono break-all text-gray-700">
                    <QrCode className="w-32 h-32 text-gray-800" />
                  </div>
                )}
              </div>

              {/* Amount and Timer */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border/60 bg-muted/20 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Valor Total</span>
                  <span className="font-bold text-lg text-emerald-400">
                    R$ {pixData.amount.toFixed(2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                    <Clock className="w-3.5 h-3.5" /> Expira em
                  </span>
                  <span className="font-mono font-bold text-yellow-400">
                    {formatMinutes(pixTimeLeft)}
                  </span>
                </div>
              </div>

              {/* Pix Copy & Paste input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">
                  Pix Copia e Cola:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={pixData.qrCode}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-border bg-muted/40 text-foreground truncate focus:outline-none"
                  />
                  <Button
                    onClick={handleCopyPix}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-4"
                  >
                    {copiedPix ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4 mr-1" />}
                    {copiedPix ? "Copiado" : "Copiar"}
                  </Button>
                </div>
              </div>

              {/* Live Verification Status indicator */}
              <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Aguardando pagamento... Verificando automaticamente</span>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => simulateUpgradeMutation.mutate(selectedPlan)}
                >
                  Testar / Simular Aprovação (Dev)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Celebration Dialog */}
      <Dialog open={isSuccessModalOpen} onOpenChange={setIsSuccessModalOpen}>
        <DialogContent className="sm:max-w-md bg-background border-emerald-500/40 text-foreground text-center">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <DialogTitle className="text-2xl font-extrabold text-emerald-400">
              Parabéns! Assinatura Ativada! 🎉
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Sua conta foi atualizada para o plano{" "}
              <strong className="text-foreground uppercase">{user?.subscriptionTier || "PRO"}</strong>.
              Você já tem acesso irrestrito a todas as ferramentas avançadas do Ads Intelligence.
            </DialogDescription>
          </DialogHeader>

          <div className="pt-4 space-y-3">
            <Button
              size="lg"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
              onClick={() => {
                setIsSuccessModalOpen(false);
                window.location.href = "/dashboard";
              }}
            >
              Ir para o Dashboard <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
