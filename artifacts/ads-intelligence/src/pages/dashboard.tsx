import { useGetDashboardSummary, useGetPerformance, useGetConversionsByCampaign } from "@workspace/api-client-react";
import { ArrowDownIcon, ArrowUpIcon, RefreshCw, TrendingUp, MousePointerClick, DollarSign, BarChart3 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type GoogleAdsStatus = {
  configured: boolean;
  status: "connected" | "not_configured" | "error";
  customerId: string | null;
  error: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

const PERIOD_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "14", label: "14 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

const CHART_COLORS = ["#60a5fa", "#34d399", "#a78bfa", "#fbbf24", "#f472b6"];

export default function Dashboard() {
  const [days, setDays] = useState("30");
  const { toast } = useToast();

  const summaryQuery = useGetDashboardSummary({ days: parseInt(days) }, { query: { queryKey: ["dashboard-summary", days] } });
  const performanceQuery = useGetPerformance({ days: parseInt(days) }, { query: { queryKey: ["dashboard-performance", days] } });
  const conversionsQuery = useGetConversionsByCampaign({ query: { queryKey: ["dashboard-conversions"] } });
  const statusQuery = useQuery({
    queryKey: ["google-ads-status"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const response = await fetch("/api/status/google-ads", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Não foi possível verificar a conexão");
      return response.json() as Promise<GoogleAdsStatus>;
    },
    retry: false,
  });

  const { data: summary, isLoading: loadingSummary } = summaryQuery;
  const { data: performance, isLoading: loadingPerformance } = performanceQuery;
  const { data: conversions, isLoading: loadingConversions } = conversionsQuery;

  const retryDashboard = () => {
    void Promise.all([
      statusQuery.refetch(),
      summaryQuery.refetch(),
      performanceQuery.refetch(),
      conversionsQuery.refetch(),
    ]);
  };

  const hasDashboardData =
    (Array.isArray(performance) && performance.length > 0) ||
    (Array.isArray(conversions) && conversions.some((item) => item.value > 0)) ||
    Boolean(summary && (summary.totalCost > 0 || summary.conversions > 0));

  if (statusQuery.isLoading || loadingSummary || loadingPerformance || loadingConversions) {
    return <DashboardLoading />;
  }

  if (statusQuery.data?.status === "not_configured") {
    return (
      <EmptyState
        title="Vamos conectar seus dados?"
        description="Sincronize sua conta do Google Ads para transformar campanhas e resultados em uma visão clara, sempre atualizada."
        actionLabel="Conectar com Google Ads"
        onAction={() => toast({ title: "Conexão Google Ads", description: "O fluxo seguro por usuário será aberto aqui." })}
      />
    );
  }

  const hasError = statusQuery.isError || statusQuery.data?.status === "error" || summaryQuery.isError || performanceQuery.isError || conversionsQuery.isError;
  if (hasError) {
    return (
      <EmptyState
        title="Algo não saiu como esperado"
        description="Não conseguimos carregar seus dados do Google Ads agora. Sua conta continua segura — tente novamente em instantes."
        actionLabel="Tentar novamente"
        onAction={retryDashboard}
        isRetry
      />
    );
  }

  if (!hasDashboardData) {
    return (
      <EmptyState
        title="Ainda não há dados por aqui"
        description="Sua conta está conectada, mas ainda não encontramos atividade no período selecionado. Assim que houver dados, seu dashboard aparecerá aqui."
        actionLabel="Sincronizar novamente"
        onAction={retryDashboard}
        isRetry
      />
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visao geral de desempenho das suas campanhas</p>
        </div>
        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card p-1 shadow-sm">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                days === opt.value
                  ? "bg-primary text-primary-foreground shadow-[0_0_12px_rgba(59,130,246,0.25)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {loadingSummary ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl bg-card/80" />)
        ) : summary ? (
          <>
            <StatCard
              title="CPC Médio"
              value={formatCurrency(summary.cpcAvg)}
              change={summary.cpcChange}
              inverse
              icon={<MousePointerClick className="h-4 w-4" />}
              color="blue"
              animate
            />
            <StatCard
              title="CPA"
              value={formatCurrency(summary.cpa)}
              change={summary.cpaChange}
              inverse
              icon={<DollarSign className="h-4 w-4" />}
              color="violet"
              animate
            />
            <StatCard
              title="CTR"
              value={formatPercent(summary.ctr)}
              change={summary.ctrChange}
              icon={<TrendingUp className="h-4 w-4" />}
              color="emerald"
              animate
            />
            <StatCard
              title="ROAS"
              value={typeof summary.roas === "number" ? `${summary.roas.toFixed(2)}x` : "—"}
              change={summary.roasChange}
              icon={<BarChart3 className="h-4 w-4" />}
              color="amber"
              animate
            />
          </>
        ) : null}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-7">
        {/* Performance chart */}
        <div className="lg:col-span-4 rounded-2xl border border-border/50 bg-card/80 p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Desempenho</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Cliques, conversões e custo ao longo do tempo</p>
            </div>
          </div>
          {loadingPerformance ? (
            <Skeleton className="h-[280px] w-full rounded-xl bg-background/50" />
          ) : Array.isArray(performance) && performance.length > 0 ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performance} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-clicks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="grad-conversions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(215 20% 45%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(215 20% 45%)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222 47% 9%)",
                      border: "1px solid hsl(216 34% 14%)",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "hsl(213 31% 91%)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}
                    cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }}
                  />
                  <Area type="monotone" dataKey="clicks" name="Cliques" stroke="#60a5fa" strokeWidth={2} fill="url(#grad-clicks)" dot={false} />
                  <Area type="monotone" dataKey="conversions" name="Conversões" stroke="#34d399" strokeWidth={2} fill="url(#grad-conversions)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
              Sem dados no período selecionado
            </div>
          )}
        </div>

        {/* Conversions pie chart */}
        <div className="lg:col-span-3 rounded-2xl border border-border/50 bg-card/80 p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-foreground">Conversões por Campanha</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Distribuição entre campanhas ativas</p>
          </div>
          {loadingConversions ? (
            <Skeleton className="h-[280px] w-full rounded-xl bg-background/50" />
          ) : Array.isArray(conversions) && conversions.length > 0 ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={conversions}
                    cx="50%"
                    cy="44%"
                    innerRadius={56}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {conversions.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222 47% 9%)",
                      border: "1px solid hsl(216 34% 14%)",
                      borderRadius: "12px",
                      fontSize: "12px",
                      color: "hsl(213 31% 91%)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}
                    formatter={(value: number) => [formatNumber(value), "Conversões"]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
              Sem conversões no período
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ───────────────────────────────────────────────
const COLOR_MAP: Record<string, { text: string; bg: string; glow: string }> = {
  blue:   { text: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20",   glow: "shadow-[0_0_20px_rgba(96,165,250,0.12)]" },
  violet: { text: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", glow: "shadow-[0_0_20px_rgba(167,139,250,0.12)]" },
  emerald:{ text: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20", glow: "shadow-[0_0_20px_rgba(52,211,153,0.12)]" },
  amber:  { text: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20",  glow: "shadow-[0_0_20px_rgba(251,191,36,0.12)]" },
};

function StatCard({
  title, value, change, inverse = false, icon, color = "blue", animate = false,
}: {
  title: string; value: string; change: number; inverse?: boolean; icon: React.ReactNode; color?: string; animate?: boolean;
}) {
  const isPositiveChange = change > 0;
  const isGood = inverse ? !isPositiveChange : isPositiveChange;
  const c = COLOR_MAP[color] || COLOR_MAP.blue;

  let feedback = "";
  if (isGood) {
    if (title.includes("CTR")) feedback = "Acima da media";
    else if (title.includes("ROAS")) feedback = "Retorno otimo";
    else if (title.includes("CPA")) feedback = "Custo eficiente";
    else if (title.includes("CPC")) feedback = "Lance eficiente";
  } else {
    feedback = "Requer atencao";
  }

  return (
    <div className={`
      stat-card-shine relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 p-5
      hover:border-border hover:bg-card transition-all duration-300 cursor-default
      ${animate ? "animate-slide-up" : ""}
    `}>
      {/* Icon + title */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-muted-foreground">{title}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${c.bg} ${c.text}`}>
          {icon}
        </div>
      </div>

      {/* Value */}
      <div className="text-2xl font-bold tracking-tight text-foreground">{value}</div>

      {/* Change */}
      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className={`flex items-center gap-0.5 text-xs font-semibold rounded-md px-1.5 py-0.5 ${
            isGood
              ? "text-emerald-400 bg-emerald-500/10"
              : "text-red-400 bg-red-500/10"
          }`}>
            {isPositiveChange ? <ArrowUpIcon className="h-3 w-3" /> : <ArrowDownIcon className="h-3 w-3" />}
            {Math.abs(change)}%
          </span>
          <span className="text-[11px] text-muted-foreground">vs. anterior</span>
        </div>
        <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
          {feedback}
        </span>
      </div>

      {/* Subtle corner glow */}
      <div className={`absolute -bottom-4 -right-4 h-16 w-16 rounded-full ${c.bg.split(" ")[0]} blur-2xl opacity-50`} />
    </div>
  );
}

// ─── Loading State ───────────────────────────────────────────
function DashboardLoading() {
  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32 rounded-lg bg-card/80" />
          <Skeleton className="h-4 w-56 rounded-lg bg-card/60" />
        </div>
        <Skeleton className="h-10 w-56 rounded-xl bg-card/80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl bg-card/80" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-7">
        <Skeleton className="lg:col-span-4 h-80 rounded-2xl bg-card/80" />
        <Skeleton className="lg:col-span-3 h-80 rounded-2xl bg-card/80" />
      </div>
    </div>
  );
}

// ─── Empty / Error State ─────────────────────────────────────
function EmptyState({ title, description, actionLabel, onAction, isRetry = false }: {
  title: string; description: string; actionLabel: string; onAction: () => void; isRetry?: boolean;
}) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center text-center animate-reveal">
        {/* Icon */}
        <div className="relative mb-8">
          <div className="h-20 w-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <BarChart3 className="h-10 w-10 text-primary/60" />
          </div>
          <div className="absolute inset-0 rounded-3xl bg-primary/5 blur-xl" />
        </div>

        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/70">Google Ads</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>

        <Button
          onClick={onAction}
          className="mt-8 h-12 rounded-xl bg-primary px-8 font-semibold text-primary-foreground shadow-[0_0_24px_rgba(59,130,246,0.25)] hover:bg-primary/90 active:scale-[0.99] transition-all flex items-center gap-2"
        >
          {isRetry ? <RefreshCw className="h-4 w-4" /> : <GoogleAdsIcon />}
          {actionLabel}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground/50">Você mantém o controle da conexão e pode removê-la quando quiser.</p>
      </div>
    </div>
  );
}

function GoogleAdsIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M14.73 3.2a3.25 3.25 0 0 1 4.44 1.19l4.39 7.6a3.25 3.25 0 0 1-5.63 3.25l-4.39-7.6a3.25 3.25 0 0 1 1.19-4.44ZM8.8 6.45a3.24 3.24 0 0 1 1.19 4.44L5.6 18.5a3.25 3.25 0 1 1-5.63-3.25l4.39-7.6A3.25 3.25 0 0 1 8.8 6.45ZM8.05 18.74A3.25 3.25 0 1 1 11.3 22a3.25 3.25 0 0 1-3.25-3.25Z" />
    </svg>
  );
}
