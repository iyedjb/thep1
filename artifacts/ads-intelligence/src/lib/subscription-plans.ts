export type PlanTier = "starter" | "pro" | "enterprise";
export type BillingCycle = "monthly" | "yearly";

export interface SubscriptionPlan {
  id: PlanTier;
  index: string;
  name: string;
  eyebrow: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  featured?: boolean;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    index: "01",
    name: "Essencial",
    eyebrow: "Para começar",
    description: "A estrutura certa para validar ofertas e operar com clareza desde o primeiro dia.",
    monthlyPrice: 49,
    yearlyPrice: 470,
    features: [
      "3 campanhas ativas",
      "20 presells com IA por mês",
      "Pesquisa de palavras-chave",
      "Google Trends integrado",
      "Suporte por e-mail",
    ],
  },
  {
    id: "pro",
    index: "02",
    name: "Profissional",
    eyebrow: "Para crescer",
    description: "Mais capacidade, automação e inteligência para quem transforma tráfego em operação.",
    monthlyPrice: 97,
    yearlyPrice: 930,
    featured: true,
    features: [
      "Campanhas ilimitadas",
      "Presells ilimitadas com IA",
      "Dr. Cash integrado",
      "Análises avançadas de mercado",
      "Suporte prioritário",
    ],
  },
  {
    id: "enterprise",
    index: "03",
    name: "Escala",
    eyebrow: "Para equipes",
    description: "Governança e volume para agências e operações que não podem perder velocidade.",
    monthlyPrice: 197,
    yearlyPrice: 1890,
    features: [
      "Tudo do Profissional",
      "Múltiplas contas Google Ads",
      "Geração em massa",
      "API e webhooks",
      "Atendimento dedicado",
    ],
  },
];

export function getSubscriptionPlan(planId: string | null | undefined) {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId) || SUBSCRIPTION_PLANS[1];
}

export function getPlanPrice(plan: SubscriptionPlan, cycle: BillingCycle) {
  return cycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
}

export function getMonthlyEquivalent(plan: SubscriptionPlan, cycle: BillingCycle) {
  return cycle === "yearly" ? plan.yearlyPrice / 12 : plan.monthlyPrice;
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}
