import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BillingCycle, PlanTier, formatBRL, getSubscriptionPlan } from "@/lib/subscription-plans";
import { BackButton } from "@/components/ui/back-button";

type PaymentState = "idle" | "pending" | "approved" | "failure";
type PaymentMethod = "card" | "pix";
interface PaymentConfiguration { configured: boolean; accessTokenConfigured: boolean; publicKeyConfigured: boolean; publicKey: string; }
interface PixPayment { qrCode: string; qrCodeBase64: string; ticketUrl?: string; }
const CHECKOUT_TEST_PRICE = 0.5;
declare global { interface Window { MercadoPago?: any; } }

async function safeFetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();
  let data: any = {};
  if (body) try { data = JSON.parse(body); } catch { data = { error: body.slice(0, 180) }; }
  if (!response.ok) throw new Error(data.error || `Não foi possível concluir a solicitação (${response.status}).`);
  return data;
}

function loadPaymentSdk() {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://sdk.mercadopago.com/js/v2"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Não foi possível carregar o formulário seguro.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Não foi possível carregar o formulário seguro."));
    document.head.appendChild(script);
  });
}

function readCheckoutParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    plan: getSubscriptionPlan(params.get("plan")),
    cycle: params.get("cycle") === "yearly" ? "yearly" as BillingCycle : "monthly" as BillingCycle,
  };
}

export default function CheckoutPage() {
  const initial = useMemo(readCheckoutParams, []);
  const [planTier] = useState<PlanTier>(initial.plan.id);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initial.cycle);
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [paymentId, setPaymentId] = useState("");
  const [pixPayment, setPixPayment] = useState<PixPayment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [configuration, setConfiguration] = useState<PaymentConfiguration | null>(null);
  const cardFormRef = useRef<any>(null);
  const plan = getSubscriptionPlan(planTier);
  const total = CHECKOUT_TEST_PRICE;
  const monthlyEquivalent = CHECKOUT_TEST_PRICE;
  const token = localStorage.getItem("ads_token");

  useEffect(() => {
    safeFetchJson("/api/mercadopago/config").then(setConfiguration)
      .catch(() => setConfiguration({ configured: false, accessTokenConfigured: false, publicKeyConfigured: false, publicKey: "" }));
  }, []);

  useEffect(() => {
    if (paymentMethod !== "card" || !token || !configuration?.configured || !configuration.publicKey) return;
    let cancelled = false;
    let cardForm: any;
    loadPaymentSdk().then(() => {
      if (cancelled || !window.MercadoPago) return;
      const sdk = new window.MercadoPago(configuration.publicKey, { locale: "pt-BR" });
      cardForm = sdk.cardForm({
        amount: total.toFixed(2), iframe: true,
        form: {
          id: "form-checkout",
          cardNumber: { id: "form-checkout__cardNumber", placeholder: "0000 0000 0000 0000" },
          expirationDate: { id: "form-checkout__expirationDate", placeholder: "MM/AA" },
          securityCode: { id: "form-checkout__securityCode", placeholder: "CVV" },
          cardholderName: { id: "form-checkout__cardholderName", placeholder: "Nome completo" },
          issuer: { id: "form-checkout__issuer", placeholder: "Banco emissor" },
          installments: { id: "form-checkout__installments", placeholder: "Parcelas" },
          identificationType: { id: "form-checkout__identificationType", placeholder: "Documento" },
          identificationNumber: { id: "form-checkout__identificationNumber", placeholder: "000.000.000-00" },
          cardholderEmail: { id: "form-checkout__cardholderEmail", placeholder: "voce@email.com" },
        },
        callbacks: {
          onFormMounted: (mountError: any) => { if (mountError) setError("Não foi possível iniciar o formulário de pagamento."); },
          onSubmit: async (event: Event) => {
            event.preventDefault();
            setIsSubmitting(true); setError("");
            try {
              const data = cardForm.getCardFormData();
              const result = await safeFetchJson("/api/mercadopago/create-card-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ planTier, billingCycle, token: data.token, paymentMethodId: data.paymentMethodId, issuerId: data.issuerId, installments: Number(data.installments), identificationType: data.identificationType, identificationNumber: data.identificationNumber }),
              });
              setPaymentId(result.paymentId);
              if (result.approved) setPaymentState("approved");
              else if (result.status === "pending" || result.status === "in_process") setPaymentState("pending");
              else { setPaymentState("failure"); setError("O cartão não foi aprovado. Confira os dados ou tente outro cartão."); }
            } catch (submitError: any) {
              setPaymentState("failure");
              setError(submitError.message || "Não foi possível processar o pagamento.");
            } finally { setIsSubmitting(false); }
          },
        },
      });
      cardFormRef.current = cardForm;
    }).catch((sdkError) => setError(sdkError.message));
    return () => { cancelled = true; cardForm?.unmount?.(); cardFormRef.current = null; };
  }, [billingCycle, configuration?.configured, configuration?.publicKey, paymentMethod, planTier, token, total]);

  const createPix = async () => {
    if (!token) return;
    setIsSubmitting(true);
    setError("");
    setPixPayment(null);
    try {
      const result = await safeFetchJson("/api/mercadopago/create-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planTier, billingCycle }),
      });
      setPaymentId(result.paymentId);
      setPixPayment({ qrCode: result.qrCode, qrCodeBase64: result.qrCodeBase64, ticketUrl: result.ticketUrl });
      setPaymentState(result.status === "approved" ? "approved" : "pending");
    } catch (pixError: any) {
      setPaymentState("failure");
      setError(pixError.message || "Não foi possível gerar o Pix.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!paymentId || paymentState !== "pending" || !token) return;
    const interval = window.setInterval(async () => {
      try {
        const result = await safeFetchJson(`/api/mercadopago/verify-payment/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (result.approved) setPaymentState("approved");
        else if (result.status === "rejected" || result.status === "cancelled") setPaymentState("failure");
      } catch (_) {}
    }, 5000);
    return () => window.clearInterval(interval);
  }, [paymentId, paymentState, token]);

  if (paymentState === "approved") return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <section className="w-full max-w-xl text-center">
        <p className="text-xs font-semibold text-primary">Pagamento confirmado</p>
        <h1 className="mt-6 text-5xl font-semibold leading-none tracking-tight">Sua assinatura está ativa.</h1>
        <a href="/creator" className="mt-10 flex h-13 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Continuar</a>
      </section>
    </main>
  );

  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-6 lg:px-10">
          <BackButton href="/pricing" label="Planos" />
          <span className="text-sm font-semibold">Finalizar assinatura</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1240px] lg:min-h-[calc(100vh-64px)] lg:grid-cols-[0.82fr_1.18fr]">
        <section className="min-w-0 border-b border-border px-6 py-12 lg:border-b-0 lg:border-r lg:px-10 lg:py-16 xl:px-16">
          <p className="text-xs font-semibold text-primary">Seu plano</p>
          <div className="mt-8 flex items-start justify-between gap-8 border-b border-border pb-8">
            <div><h1 className="text-3xl font-semibold tracking-tight">{plan.name}</h1><p className="mt-2 text-sm text-muted-foreground">{billingCycle === "yearly" ? "Assinatura anual" : "Assinatura mensal"}</p></div>
            <p className="whitespace-nowrap text-right text-2xl font-semibold">{formatBRL(monthlyEquivalent)}<span className="block pt-1 text-xs font-normal text-muted-foreground">valor de teste</span></p>
          </div>
          <div className="py-8">
            <div className="grid grid-cols-2 rounded-full border border-border p-1">
              <button type="button" onClick={() => setBillingCycle("monthly")} className={`rounded-full py-2.5 text-sm ${billingCycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Mensal</button>
              <button type="button" onClick={() => setBillingCycle("yearly")} className={`rounded-full py-2.5 text-sm ${billingCycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Anual · −20%</button>
            </div>
          </div>
          <div className="flex items-center justify-between border-y border-border py-5 text-sm"><span className="text-muted-foreground">Total de hoje</span><strong>{formatBRL(total)}</strong></div>
          <ol className="space-y-4 py-8">
            {plan.features.map((feature, index) => <li key={feature} className="grid grid-cols-[28px_1fr] text-sm"><span className="font-mono text-[10px] text-primary/60">{String(index + 1).padStart(2, "0")}</span><span className="text-muted-foreground">{feature}</span></li>)}
          </ol>
        </section>

        <section className="min-w-0 px-6 py-12 lg:px-10 lg:py-16 xl:px-16">
          <div className="mx-auto max-w-xl">
            <h2 className="text-4xl font-semibold tracking-tight">Pagamento</h2>
            <div className="mt-8 grid grid-cols-2 rounded-full border border-border p-1" aria-label="Forma de pagamento">
              <button type="button" onClick={() => { setPaymentMethod("pix"); setError(""); }} className={`rounded-full py-2.5 text-sm transition-colors ${paymentMethod === "pix" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Pix</button>
              <button type="button" onClick={() => { setPaymentMethod("card"); setError(""); }} className={`rounded-full py-2.5 text-sm transition-colors ${paymentMethod === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Cartão</button>
            </div>
            {error && <p className="mt-6 border-l-2 border-primary pl-4 text-sm leading-6">{error}</p>}
            {paymentState === "pending" && <p className="mt-6 border-l-2 border-primary pl-4 text-sm">Aguardando confirmação. Esta página atualizará automaticamente e ativará o plano quando o pagamento for aprovado.</p>}
            {!token ? (
              <div className="mt-10 border-t border-border pt-8"><a href="/login" className="flex h-13 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Entrar para continuar</a></div>
            ) : paymentMethod === "pix" ? (
              <PixCheckout configured={Boolean(configuration?.accessTokenConfigured)} isSubmitting={isSubmitting} payment={pixPayment} total={total} onCreate={createPix} />
            ) : configuration && !configuration.configured ? (
              <UnavailableCardForm total={total} />
            ) : (
              <form id="form-checkout" className="mt-10 space-y-6">
                <Field label="Número do cartão"><div id="form-checkout__cardNumber" className="mp-secure-field h-12 rounded-xl border border-input bg-background px-4" /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Validade"><div id="form-checkout__expirationDate" className="mp-secure-field h-12 rounded-xl border border-input bg-background px-4" /></Field>
                  <Field label="CVV"><div id="form-checkout__securityCode" className="mp-secure-field h-12 rounded-xl border border-input bg-background px-4" /></Field>
                </div>
                <Field label="Nome no cartão" htmlFor="form-checkout__cardholderName"><input id="form-checkout__cardholderName" className="checkout-input" /></Field>
                <Field label="E-mail" htmlFor="form-checkout__cardholderEmail"><input id="form-checkout__cardholderEmail" type="email" className="checkout-input" /></Field>
                <div className="grid grid-cols-[0.42fr_1fr] gap-4">
                  <Field label="Documento" htmlFor="form-checkout__identificationType"><select id="form-checkout__identificationType" className="checkout-input" /></Field>
                  <Field label="Número" htmlFor="form-checkout__identificationNumber"><input id="form-checkout__identificationNumber" className="checkout-input" /></Field>
                </div>
                <select id="form-checkout__issuer" className="hidden" />
                <Field label="Parcelamento" htmlFor="form-checkout__installments"><select id="form-checkout__installments" className="checkout-input" /></Field>
                <button id="form-checkout__submit" type="submit" disabled={isSubmitting || paymentState === "pending"} className="mt-2 h-13 w-full rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40">{isSubmitting ? "Processando…" : `Pagar ${formatBRL(total)}`}</button>
                <p className="text-center text-[11px] leading-5 text-muted-foreground">Os dados do cartão são criptografados e não ficam armazenados.</p>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function PixCheckout({ configured, isSubmitting, payment, total, onCreate }: { configured: boolean; isSubmitting: boolean; payment: PixPayment | null; total: number; onCreate: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    if (!payment?.qrCode) return;
    await navigator.clipboard.writeText(payment.qrCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (!configured) return (
    <div className="mt-10 border-t border-border pt-8">
      <p className="border-l-2 border-primary pl-4 text-sm text-muted-foreground">O Pix está temporariamente indisponível.</p>
      <button disabled className="mt-8 h-13 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground opacity-35">Gerar Pix de {formatBRL(total)}</button>
    </div>
  );

  if (!payment) return (
    <div className="mt-10 border-t border-border pt-8">
      <p className="text-sm leading-6 text-muted-foreground">Gere um Pix de teste e conclua o pagamento no aplicativo do seu banco.</p>
      <button type="button" onClick={onCreate} disabled={isSubmitting} className="mt-8 h-13 w-full rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">{isSubmitting ? "Gerando…" : `Gerar Pix de ${formatBRL(total)}`}</button>
    </div>
  );

  return (
    <div className="mt-10 border-t border-border pt-8 text-center">
      {payment.qrCodeBase64 && <img src={`data:image/png;base64,${payment.qrCodeBase64}`} alt="Código QR do Pix" className="mx-auto h-52 w-52" />}
      <p className="mt-6 text-sm font-medium">Escaneie o código ou copie o Pix.</p>
      <button type="button" onClick={copyCode} className="mt-6 h-12 w-full rounded-full border border-primary/25 text-sm font-semibold text-primary hover:bg-primary/[0.06]">{copied ? "Código copiado" : "Copiar código Pix"}</button>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="space-y-2"><label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>{children}</div>;
}

function UnavailableCardForm({ total }: { total: number }) {
  const disabledClass = "checkout-input text-muted-foreground opacity-70";
  return (
    <div className="mt-10 space-y-6">
      <Field label="Número do cartão"><input disabled placeholder="0000 0000 0000 0000" className={disabledClass} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Validade"><input disabled placeholder="MM/AA" className={disabledClass} /></Field>
        <Field label="CVV"><input disabled placeholder="CVV" className={disabledClass} /></Field>
      </div>
      <Field label="Nome no cartão"><input disabled placeholder="Nome completo" className={disabledClass} /></Field>
      <Field label="E-mail"><input disabled placeholder="voce@email.com" className={disabledClass} /></Field>
      <div className="grid grid-cols-[0.42fr_1fr] gap-4">
        <Field label="Documento"><input disabled placeholder="CPF" className={disabledClass} /></Field>
        <Field label="Número"><input disabled placeholder="000.000.000-00" className={disabledClass} /></Field>
      </div>
      <Field label="Parcelamento"><input disabled placeholder="Selecione" className={disabledClass} /></Field>
      <p className="border-l-2 border-primary pl-4 text-sm text-muted-foreground">Os pagamentos estão temporariamente indisponíveis.</p>
      <button disabled className="h-13 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground opacity-35">Pagar {formatBRL(total)}</button>
    </div>
  );
}
