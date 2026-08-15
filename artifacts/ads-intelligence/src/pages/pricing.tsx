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
    <div className="min-h-full bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <section className="mx-auto max-w-[1380px] px-6 pb-24 pt-14 lg:px-10 lg:pt-20">
        <div className="grid gap-12 border-b border-primary/15 pb-14 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-4xl">
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/70">
              Simples por escolha
            </p>
            <h1 className="max-w-3xl text-5xl font-medium leading-[0.96] tracking-[-0.055em] sm:text-7xl lg:text-[92px]">
              Um plano para cada ritmo.
            </h1>
          </div>

          <div className="w-full lg:w-[330px]">
            <p className="mb-5 max-w-sm text-sm leading-6 text-muted-foreground">
              Todos os planos incluem a plataforma completa para pesquisa, criação e gestão. Você escolhe a capacidade.
            </p>
            <div className="grid grid-cols-2 rounded-full border border-primary/15 bg-card p-1 shadow-sm" aria-label="Período de cobrança">
              <button
                type="button"
                onClick={() => setBillingCycle("monthly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"}`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle("yearly")}
                className={`rounded-full px-4 py-2.5 text-sm transition-colors ${billingCycle === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"}`}
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
              className={`group relative flex min-h-[650px] flex-col rounded-3xl border p-7 text-foreground shadow-[0_18px_55px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-1 hover:shadow-[0_24px_65px_rgba(15,23,42,0.10)] lg:p-9 ${plan.featured ? "border-primary/35 bg-primary/[0.045]" : "border-primary/15 bg-card"}`}
            >
              <div className="flex items-start justify-between border-b border-primary/15 pb-7">
                <span className="font-mono text-xs text-primary/55">{plan.index}</span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                  {plan.featured ? "Mais escolhido" : plan.eyebrow}
                </span>
              </div>

              <div className="pt-9">
                <h2 className="text-3xl font-medium tracking-[-0.04em]">{plan.name}</h2>
                <p className="mt-4 min-h-20 max-w-sm text-sm leading-6 text-muted-foreground">{plan.description}</p>
                <div className="mt-9">
                  <p className="text-4xl font-medium tracking-[-0.045em]">
                    {formatBRL(getMonthlyEquivalent(plan, billingCycle))}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/75">
                    por mês{billingCycle === "yearly" ? ` · ${formatBRL(plan.yearlyPrice)} ao ano` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-10 flex-1 border-t border-primary/15 pt-7">
                <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/65">Incluído</p>
                <ol className="space-y-4">
                  {plan.features.map((feature, index) => (
                    <li key={feature} className="grid grid-cols-[24px_1fr] text-sm leading-5">
                      <span className="font-mono text-[10px] text-primary/45">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <Link
                href={`/checkout?plan=${plan.id}&cycle=${billingCycle}`}
                className="mt-10 flex h-13 items-center justify-center rounded-full border border-primary bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Assinar
              </Link>
            </article>
          ))}
        </div>

        <div className="grid gap-4 py-10 text-sm text-muted-foreground md:grid-cols-3">
          <p className="rounded-2xl border border-primary/15 bg-card p-5">Pagamento processado pelo Mercado Pago.</p>
          <p className="rounded-2xl border border-primary/15 bg-card p-5">Ativação após confirmação do pagamento.</p>
          <p className="rounded-2xl border border-primary/15 bg-card p-5">Cancele ou altere seu plano quando precisar.</p>
        </div>
      </section>
    </div>
  );
}
