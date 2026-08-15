import { useState } from "react";
import { Link } from "wouter";
import {
  BillingCycle,
  SUBSCRIPTION_PLANS,
  formatBRL,
  getMonthlyEquivalent,
} from "@/lib/subscription-plans";

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#111111] selection:bg-black selection:text-white">
      <header className="border-b border-black/10 bg-[#f7f7f5]">
        <div className="mx-auto flex h-20 max-w-[1380px] items-center justify-between px-6 lg:px-10">
          <Link href="/" className="text-[15px] font-semibold tracking-[-0.02em]">
            ClicLab
          </Link>
          <p className="hidden text-xs uppercase tracking-[0.18em] text-black/45 sm:block">
            Planos e assinatura
          </p>
          <Link href="/login" className="border-b border-black pb-0.5 text-sm font-medium">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1380px] px-6 pb-24 pt-16 lg:px-10 lg:pt-24">
        <div className="grid gap-12 border-b border-black/15 pb-14 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-4xl">
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">
              Simples por escolha
            </p>
            <h1 className="max-w-3xl text-5xl font-medium leading-[0.96] tracking-[-0.055em] sm:text-7xl lg:text-[92px]">
              Um plano para cada ritmo.
            </h1>
          </div>

          <div className="w-full lg:w-[330px]">
            <p className="mb-5 max-w-sm text-sm leading-6 text-black/55">
              Todos os planos incluem a plataforma completa para pesquisa, criação e gestão. Você escolhe a capacidade.
            </p>
            <div className="grid grid-cols-2 rounded-full border border-black/15 bg-white p-1" aria-label="Período de cobrança">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "monthly" ? "bg-black text-white" : "text-black/55"}`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "yearly" ? "bg-black text-white" : "text-black/55"}`}
              >
                Anual · −20%
              </button>
            </div>
          </div>
        </div>

        <div className="grid border-x border-black/15 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`group relative flex min-h-[650px] flex-col border-b border-black/15 p-7 transition-colors lg:p-9 ${plan.featured ? "bg-black text-white" : "bg-[#f7f7f5] text-black md:border-r"}`}
            >
              <div className="flex items-start justify-between border-b border-current/15 pb-7">
                <span className="font-mono text-xs opacity-45">{plan.index}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-55">
                  {plan.featured ? "Mais escolhido" : plan.eyebrow}
                </span>
              </div>

              <div className="pt-9">
                <h2 className="text-3xl font-medium tracking-[-0.04em]">{plan.name}</h2>
                <p className="mt-4 min-h-20 max-w-sm text-sm leading-6 opacity-60">{plan.description}</p>
                <div className="mt-9">
                  <p className="text-4xl font-medium tracking-[-0.045em]">
                    {formatBRL(getMonthlyEquivalent(plan, billingCycle))}
                  </p>
                  <p className="mt-1 text-xs opacity-50">
                    por mês{billingCycle === "yearly" ? ` · ${formatBRL(plan.yearlyPrice)} ao ano` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-10 flex-1 border-t border-current/15 pt-7">
                <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-45">Incluído</p>
                <ol className="space-y-4">
                  {plan.features.map((feature, index) => (
                    <li key={feature} className="grid grid-cols-[24px_1fr] text-sm leading-5">
                      <span className="font-mono text-[10px] opacity-35">{String(index + 1).padStart(2, "0")}</span>
                      <span className="opacity-75">{feature}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <Link
                href={`/checkout?plan=${plan.id}&cycle=${billingCycle}`}
                className={`mt-10 flex h-13 items-center justify-center rounded-full border px-6 text-sm font-semibold transition-colors ${plan.featured ? "border-white bg-white text-black hover:bg-black hover:text-white" : "border-black bg-black text-white hover:bg-transparent hover:text-black"}`}
              >
                Assinar
              </Link>
            </article>
          ))}
        </div>

        <div className="grid gap-8 border-b border-black/15 py-10 text-sm text-black/55 md:grid-cols-3">
          <p>Pagamento processado pelo Mercado Pago.</p>
          <p>Ativação após confirmação do pagamento.</p>
          <p>Cancele ou altere seu plano quando precisar.</p>
        </div>
      </section>
    </main>
  );
}
