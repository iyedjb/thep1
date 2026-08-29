import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Eye, MousePointer2, UserPlus, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ActivityEvent = {
  id: string;
  type: "visit" | "click" | "pending" | "approved" | "rejected" | "paid";
  title: string;
  description: string;
  siteId: number | null;
  siteName: string;
  source: string;
  occurredAt: string;
};

type ActivityData = {
  period: string;
  sites: Array<{ id: number; name: string; slug: string }>;
  events: ActivityEvent[];
};

const EVENT_STYLE = {
  visit: { icon: Eye, color: "text-blue-600", bg: "bg-blue-50" },
  click: { icon: MousePointer2, color: "text-violet-600", bg: "bg-violet-50" },
  pending: { icon: UserPlus, color: "text-amber-600", bg: "bg-amber-50" },
  approved: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
  rejected: { icon: XCircle, color: "text-rose-600", bg: "bg-rose-50" },
  paid: { icon: Banknote, color: "text-emerald-700", bg: "bg-emerald-50" },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("ads_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatMoment(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("pt-BR", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
  ).format(date);
}

export default function ActivityPage() {
  const [siteId, setSiteId] = useState("all");
  const [period, setPeriod] = useState("7d");
  const activity = useQuery<ActivityData>({
    queryKey: ["tracking-activity", siteId, period],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (siteId !== "all") params.set("siteId", siteId);
      const response = await fetch(`/api/tracking/activity?${params}`, { headers: authHeaders() });
      if (!response.ok) throw new Error("Não foi possível carregar a atividade.");
      return response.json();
    },
    refetchInterval: 10_000,
  });

  const events = activity.data?.events || [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
      <header className="border-b border-border pb-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Rastreamento</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Atividade</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Acessos, cliques e notificações recebidas das plataformas em uma única linha do tempo.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Ao vivo
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-2">
          <select value={siteId} onChange={(event) => setSiteId(event.target.value)} className="h-10 rounded-full border border-border bg-background px-4 text-sm text-foreground outline-none focus:border-primary">
            <option value="all">Todos os sites</option>
            {activity.data?.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          {(["7d", "30d", "90d"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setPeriod(value)} className={`h-10 rounded-full border px-4 text-sm transition-colors ${period === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {value.replace("d", " dias")}
            </button>
          ))}
        </div>
      </header>

      {activity.isLoading ? (
        <div className="space-y-7 py-9">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div>
      ) : activity.isError ? (
        <p className="py-16 text-center text-sm text-rose-600">Não foi possível carregar a atividade.</p>
      ) : events.length === 0 ? (
        <div className="py-24 text-center">
          <h2 className="text-lg font-semibold text-foreground">Nenhuma atividade ainda</h2>
          <p className="mt-2 text-sm text-muted-foreground">Os novos acessos, cliques e leads aparecerão aqui automaticamente.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {events.map((event) => {
            const style = EVENT_STYLE[event.type] || EVENT_STYLE.pending;
            const Icon = style.icon;
            return (
              <div key={event.id} className="flex gap-4 py-5">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.bg} ${style.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{event.title}</p>
                    <time className="text-xs text-muted-foreground">{formatMoment(event.occurredAt)}</time>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
                  <p className="mt-1.5 text-xs font-medium text-primary/75">{event.siteName}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
