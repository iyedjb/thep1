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
    <main className="min-h-screen bg-[#f8fbff] text-[#111827] selection:bg-blue-600 selection:text-white">
      <header className="border-b border-blue-100 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1380px] items-center justify-between px-6 lg:px-10">
          <Link href="/" className="text-[15px] font-semibold tracking-[-0.02em]">
            ClicLab
          </Link>
          <p className="hidden text-xs uppercase tracking-[0.18em] text-blue-600/60 sm:block">
            Planos e assinatura
          </p>
          <Link href="/login" className="rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1380px] px-6 pb-24 pt-16 lg:px-10 lg:pt-24">
        <div className="grid gap-12 border-b border-blue-100 pb-14 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-4xl">
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-600/65">
              Simples por escolha
            </p>
            <h1 className="max-w-3xl text-5xl font-medium leading-[0.96] tracking-[-0.055em] sm:text-7xl lg:text-[92px]">
              Um plano para cada ritmo.
            </h1>
          </div>

          <div className="w-full lg:w-[330px]">
            <p className="mb-5 max-w-sm text-sm leading-6 text-slate-500">
              Todos os planos incluem a plataforma completa para pesquisa, criação e gestão. Você escolhe a capacidade.
            </p>
            <div className="grid grid-cols-2 rounded-full border border-blue-100 bg-white p-1 shadow-sm" aria-label="Período de cobrança">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "monthly" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-blue-700"}`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "yearly" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-blue-700"}`}
              >
                Anual · −20%
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-5 pt-10 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`group relative flex min-h-[650px] flex-col rounded-3xl border p-7 shadow-[0_18px_55px_rgba(37,99,235,0.07)] transition-all hover:-translate-y-1 hover:shadow-[0_24px_65px_rgba(37,99,235,0.12)] lg:p-9 ${plan.featured ? "border-blue-300 bg-blue-50 text-[#111827]" : "border-blue-100 bg-white text-[#111827]"}`}
            >
              <div className="flex items-start justify-between border-b border-blue-100 pb-7">
                <span className="font-mono text-xs text-blue-500/55">{plan.index}</span>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                  {plan.featured ? "Mais escolhido" : plan.eyebrow}
                </span>
              </div>

              <div className="pt-9">
                <h2 className="text-3xl font-medium tracking-[-0.04em]">{plan.name}</h2>
                <p className="mt-4 min-h-20 max-w-sm text-sm leading-6 text-slate-500">{plan.description}</p>
                <div className="mt-9">
                  <p className="text-4xl font-medium tracking-[-0.045em]">
                    {formatBRL(getMonthlyEquivalent(plan, billingCycle))}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    por mês{billingCycle === "yearly" ? ` · ${formatBRL(plan.yearlyPrice)} ao ano` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-10 flex-1 border-t border-blue-100 pt-7">
                <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600/55">Incluído</p>
                <ol className="space-y-4">
                  {plan.features.map((feature, index) => (
                    <li key={feature} className="grid grid-cols-[24px_1fr] text-sm leading-5">
                      <span className="font-mono text-[10px] text-blue-500/40">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-slate-600">{feature}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <Link
                href={`/checkout?plan=${plan.id}&cycle=${billingCycle}`}
                className="mt-10 flex h-13 items-center justify-center rounded-full border border-blue-600 bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Assinar
              </Link>
            </article>
          ))}
        </div>

        <div className="grid gap-4 py-10 text-sm text-slate-500 md:grid-cols-3">
          <p className="rounded-2xl border border-blue-100 bg-white p-5">Pagamento processado pelo Mercado Pago.</p>
          <p className="rounded-2xl border border-blue-100 bg-white p-5">Ativação após confirmação do pagamento.</p>
          <p className="rounded-2xl border border-blue-100 bg-white p-5">Cancele ou altere seu plano quando precisar.</p>
        </div>
      </section>
    </main>
  );
}
