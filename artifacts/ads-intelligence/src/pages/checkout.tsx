import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  BillingCycle,
  PlanTier,
  formatBRL,
  getMonthlyEquivalent,
  getPlanPrice,
  getSubscriptionPlan,
} from "@/lib/subscription-plans";

type PaymentMethod = "mercadopago" | "pix";
type PaymentState = "idle" | "pending" | "approved" | "failure";

interface PixPayment {
  paymentId: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl?: string;
  amount: number;
}

interface MercadoPagoConfiguration {
  configured: boolean;
  accessTokenConfigured: boolean;
  returnUrlConfigured: boolean;
  webhookConfigured: boolean;
}

async function safeFetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();
  let data: any = {};

  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = { error: body.slice(0, 180) };
    }
  }

  if (!response.ok) {
    throw new Error(data.error || `Não foi possível concluir a solicitação (${response.status}).`);
  }

  return data;
}

function readCheckoutParams() {
  const params = new URLSearchParams(window.location.search);
  const requestedCycle = params.get("cycle");
  return {
    plan: getSubscriptionPlan(params.get("plan")),
    cycle: requestedCycle === "yearly" ? "yearly" as BillingCycle : "monthly" as BillingCycle,
    paymentId: params.get("payment_id") || params.get("collection_id"),
    returnedStatus: params.get("payment_status") || params.get("status") || params.get("collection_status"),
  };
}

export default function CheckoutPage() {
  const initial = useMemo(readCheckoutParams, []);
  const [planTier] = useState<PlanTier>(initial.plan.id);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initial.cycle);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mercadopago");
  const [paymentState, setPaymentState] = useState<PaymentState>(initial.returnedStatus === "failure" ? "failure" : "idle");
  const [pixPayment, setPixPayment] = useState<PixPayment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [mercadoPagoConfig, setMercadoPagoConfig] = useState<MercadoPagoConfiguration | null>(null);

  const plan = getSubscriptionPlan(planTier);
  const total = getPlanPrice(plan, billingCycle);
  const monthlyEquivalent = getMonthlyEquivalent(plan, billingCycle);
  const token = localStorage.getItem("ads_token");

  useEffect(() => {
    safeFetchJson("/api/mercadopago/config")
      .then((data) => setMercadoPagoConfig(data))
      .catch(() => setMercadoPagoConfig({ configured: false, accessTokenConfigured: false, returnUrlConfigured: false, webhookConfigured: false }));
  }, []);

  const verifyPayment = async (paymentId: string) => {
    if (!token) return;
    setIsChecking(true);
    try {
      const data = await safeFetchJson(`/api/mercadopago/verify-payment/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.approved) {
        setPaymentState("approved");
        setError("");
      } else if (data.status === "rejected" || data.status === "cancelled") {
        setPaymentState("failure");
        setError("O pagamento não foi aprovado. Você pode tentar novamente com outro meio de pagamento.");
      } else {
        setPaymentState("pending");
      }
    } catch (verificationError: any) {
      setError(verificationError.message || "Não foi possível verificar o pagamento.");
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (initial.paymentId && token) {
      verifyPayment(initial.paymentId);
    } else if (initial.returnedStatus === "success" && !initial.paymentId) {
      setError("O Mercado Pago não retornou o identificador necessário para confirmar este pagamento.");
    }
  }, [initial.paymentId, initial.returnedStatus, token]);

  useEffect(() => {
    if (!pixPayment?.paymentId || paymentState === "approved") return;
    const interval = window.setInterval(() => verifyPayment(pixPayment.paymentId), 5000);
    return () => window.clearInterval(interval);
  }, [pixPayment?.paymentId, paymentState]);

  const authenticatedRequest = (body: Record<string, unknown>) => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const beginMercadoPagoCheckout = async () => {
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const data = await safeFetchJson(
        "/api/mercadopago/create-preference",
        authenticatedRequest({ planTier, billingCycle }),
      );
      if (!data.initPoint) throw new Error("O Mercado Pago não retornou uma URL de pagamento.");
      window.location.href = data.initPoint;
    } catch (checkoutError: any) {
      setError(checkoutError.message || "Não foi possível abrir o Mercado Pago.");
      setIsSubmitting(false);
    }
  };

  const createPixPayment = async () => {
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const data = await safeFetchJson(
        "/api/mercadopago/create-pix",
        authenticatedRequest({ planTier, billingCycle }),
      );
      setPixPayment({
        paymentId: data.paymentId,
        qrCode: data.qrCode,
        qrCodeBase64: data.qrCodeBase64,
        ticketUrl: data.ticketUrl,
        amount: data.amount,
      });
      setPaymentState("pending");
    } catch (pixError: any) {
      setError(pixError.message || "Não foi possível gerar o Pix.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyPixCode = async () => {
    if (!pixPayment?.qrCode) return;
    await navigator.clipboard.writeText(pixPayment.qrCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2400);
  };

  if (paymentState === "approved") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8fbff] px-6 text-[#111827]">
        <section className="w-full max-w-xl rounded-3xl border border-blue-100 bg-white p-8 shadow-[0_24px_70px_rgba(37,99,235,0.12)] sm:p-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600/65">Pagamento confirmado</p>
          <h1 className="mt-7 text-5xl font-medium leading-none tracking-[-0.05em]">Sua assinatura está ativa.</h1>
          <p className="mt-6 max-w-md text-sm leading-6 text-slate-500">
            O Mercado Pago confirmou o pagamento e o plano {plan.name} já foi aplicado à sua conta.
          </p>
          <a href="/creator" className="mt-10 flex h-13 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Continuar para a plataforma
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8fbff] text-[#111827] selection:bg-blue-600 selection:text-white">
      <header className="border-b border-blue-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto grid h-20 max-w-[1320px] grid-cols-3 items-center px-6 lg:px-10">
          <Link href="/pricing" className="justify-self-start text-sm text-slate-500 hover:text-blue-700">Voltar aos planos</Link>
          <Link href="/" className="justify-self-center text-[15px] font-semibold tracking-[-0.02em]">ClicLab</Link>
          <span className="justify-self-end text-xs uppercase tracking-[0.18em] text-blue-600/50">Checkout</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1360px] gap-6 p-5 sm:p-7 lg:min-h-[calc(100vh-80px)] lg:grid-cols-[0.92fr_1.08fr]">
        <section className="min-w-0 rounded-3xl border border-blue-100 bg-white px-6 py-12 shadow-[0_18px_55px_rgba(37,99,235,0.06)] lg:px-10 lg:py-16 xl:px-16">
          <div className="mx-auto max-w-xl lg:ml-auto lg:mr-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600/60">Resumo da assinatura</p>
            <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
              <div className="flex items-start justify-between gap-8">
                <div>
                  <p className="text-3xl font-medium tracking-[-0.04em]">{plan.name}</p>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">{plan.description}</p>
                </div>
                <p className="whitespace-nowrap text-right text-2xl font-medium tracking-[-0.04em]">
                  {formatBRL(monthlyEquivalent)}
                  <span className="block pt-1 text-[11px] font-normal tracking-normal text-slate-400">por mês</span>
                </p>
              </div>
            </div>

            <div className="py-8">
              <p className="mb-4 text-xs font-medium">Período da assinatura</p>
              <div className="grid grid-cols-2 rounded-full border border-blue-100 bg-blue-50/50 p-1">
                <button type="button" onClick={() => setBillingCycle("monthly")} className={`rounded-full py-2.5 text-sm ${billingCycle === "monthly" ? "bg-blue-600 text-white" : "text-slate-500"}`}>Mensal</button>
                <button type="button" onClick={() => setBillingCycle("yearly")} className={`rounded-full py-2.5 text-sm ${billingCycle === "yearly" ? "bg-blue-600 text-white" : "text-slate-500"}`}>Anual · −20%</button>
              </div>

              <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-blue-100 bg-white">
                <div className="border-r border-blue-100 p-5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-blue-600/50">Cobrança</p>
                  <p className="mt-2 text-sm">{billingCycle === "yearly" ? "A cada 12 meses" : "A cada mês"}</p>
                </div>
                <div className="p-5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-blue-600/50">Total de hoje</p>
                  <p className="mt-2 text-sm font-semibold">{formatBRL(total)}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-blue-100 py-8">
              <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600/50">O que você recebe</p>
              <ol className="space-y-4">
                {plan.features.map((feature, index) => (
                  <li key={feature} className="grid grid-cols-[28px_1fr] text-sm">
                    <span className="font-mono text-[10px] text-blue-500/40">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-slate-600">{feature}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-3xl border border-blue-100 bg-white px-6 py-12 shadow-[0_18px_55px_rgba(37,99,235,0.08)] lg:px-10 lg:py-16 xl:px-16">
          <div className="mx-auto max-w-xl lg:ml-0 lg:mr-auto">
            <div className="flex items-end justify-between border-b border-blue-100 pb-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600/60">Etapa final</p>
                <h1 className="mt-4 text-4xl font-medium tracking-[-0.045em]">Pagamento</h1>
              </div>
              <p className="text-xs text-blue-600/45">Mercado Pago</p>
            </div>

            <div className="py-8">
              <p className="mb-4 text-xs font-medium">Como deseja pagar?</p>
              <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-blue-100 bg-blue-50/40 p-1">
                <button type="button" onClick={() => setPaymentMethod("mercadopago")} className={`rounded-xl px-5 py-4 text-left text-sm ${paymentMethod === "mercadopago" ? "bg-blue-600 text-white" : "text-slate-500"}`}>Cartão ou boleto</button>
                <button type="button" onClick={() => setPaymentMethod("pix")} className={`rounded-xl px-5 py-4 text-left text-sm ${paymentMethod === "pix" ? "bg-blue-600 text-white" : "text-slate-500"}`}>Pix</button>
              </div>
            </div>

            {error && <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-slate-700">{error}</div>}

            {mercadoPagoConfig && !mercadoPagoConfig.configured && (
              <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm leading-6 text-slate-600">
                {!mercadoPagoConfig.accessTokenConfigured
                  ? "O checkout está aguardando o Access Token do Mercado Pago. Nenhuma cobrança simulada será criada."
                  : "Defina APP_URL com o IP desta máquina ou um domínio HTTPS para o Mercado Pago retornar ao checkout."}
              </div>
            )}

            {!token ? (
              <div className="border-t border-blue-100 pt-8">
                <h2 className="text-xl font-medium tracking-[-0.025em]">Entre para continuar</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">Sua conta é necessária para vincular e verificar o pagamento com segurança.</p>
                <a href="/login" className="mt-8 flex h-13 items-center justify-center rounded-full bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700">Entrar na minha conta</a>
              </div>
            ) : paymentMethod === "mercadopago" ? (
              <div className="border-t border-blue-100 pt-8">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-blue-600/50">Ambiente de pagamento</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">Os dados do cartão são preenchidos diretamente no Mercado Pago.</p>
                  </div>
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-blue-600/50">Confirmação</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">Seu plano só é ativado após a aprovação real da cobrança.</p>
                  </div>
                </div>
                <button type="button" onClick={beginMercadoPagoCheckout} disabled={isSubmitting || mercadoPagoConfig?.configured !== true} className="mt-8 flex h-13 w-full items-center justify-center rounded-full bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-35">
                  {isSubmitting ? "Abrindo checkout…" : `Continuar e pagar ${formatBRL(total)}`}
                </button>
              </div>
            ) : (
              <div className="border-t border-blue-100 pt-8">
                {pixPayment ? (
                  <div>
                    <div className="grid gap-7 sm:grid-cols-[190px_1fr] sm:items-center">
                      <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white p-3">
                        {pixPayment.qrCodeBase64 ? (
                          <img src={`data:image/png;base64,${pixPayment.qrCodeBase64}`} alt="Código QR Pix" className="aspect-square w-full object-contain" />
                        ) : (
                          <div className="grid aspect-square place-items-center rounded-xl bg-blue-50 px-4 text-center text-xs text-slate-500">Código QR indisponível. Use o código copia e cola.</div>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-blue-600/50">Aguardando confirmação</p>
                        <p className="mt-3 text-2xl font-medium tracking-[-0.035em]">{formatBRL(pixPayment.amount)}</p>
                        <p className="mt-3 text-sm leading-6 text-slate-500">A página verifica o pagamento automaticamente a cada cinco segundos.</p>
                      </div>
                    </div>
                    <div className="mt-7 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
                      <p className="break-all font-mono text-[11px] leading-5 text-slate-500">{pixPayment.qrCode}</p>
                    </div>
                    <button type="button" onClick={copyPixCode} className="mt-3 h-12 w-full rounded-full border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50">{copied ? "Código copiado" : "Copiar código Pix"}</button>
                    <p className="mt-4 text-center text-xs text-slate-400">{isChecking ? "Verificando pagamento…" : "Aguardando pagamento"}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm leading-6 text-slate-500">O código Pix é emitido pelo Mercado Pago e vinculado à sua assinatura. A ativação acontece somente depois da confirmação.</p>
                    <button type="button" onClick={createPixPayment} disabled={isSubmitting || mercadoPagoConfig?.accessTokenConfigured !== true} className="mt-8 flex h-13 w-full items-center justify-center rounded-full bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-35">
                      {isSubmitting ? "Gerando Pix…" : `Gerar Pix de ${formatBRL(total)}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-10 border-t border-blue-100 pt-5 text-center text-[11px] leading-5 text-slate-400">
              Ao continuar, você concorda com os termos da assinatura. A ClicLab não recebe nem armazena os dados do seu cartão.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
