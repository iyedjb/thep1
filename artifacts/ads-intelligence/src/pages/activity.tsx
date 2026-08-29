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
  details: {
    clientId: string | null; visitorId: string | null; countryCode: string | null; country: string | null; city: string | null;
    device: string | null; browser: string | null; operatingSystem: string | null; userAgent: string | null;
    viewportWidth: number | null; viewportHeight: number | null; screenWidth: number | null; screenHeight: number | null;
    origin: string | null; pageUrl: string | null; clickId: string | null; clickIdType: string | null; clickCount: number;
    parameters: Record<string, string>; sender?: string | null; orderId?: string | null; status?: string | null;
    payout?: number; currency?: string | null; matched?: boolean; payload?: Record<string, unknown>;
  };
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
              <div key={event.id} className="py-5">
                <button type="button" onClick={() => setSelectedId((current) => current === event.id ? null : event.id)} className="flex w-full gap-4 text-left">
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
                  <p className="mt-2 text-[11px] font-semibold text-primary">{selectedId === event.id ? "Ocultar detalhes" : "Ver detalhes"}</p>
                </div>
                </button>
                {selectedId === event.id ? <div className="ml-[52px] mt-5 rounded-2xl border border-border bg-muted/15 p-5 sm:p-6">
                  {event.source === "postback" && !event.details.matched ? <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><strong>Callback recebido sem Client ID.</strong> A plataforma não devolveu o <code>clickid</code>, então este lead ainda não pode ser ligado a um visitante. Novas presells LemonAD agora enviam esse identificador automaticamente.</div> : null}
                  <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                    <Detail label="Client ID" value={event.details.clientId || event.details.clickId}/>
                    <Detail label="País" value={[event.details.country, event.details.countryCode].filter(Boolean).join(" · ")}/>
                    <Detail label="Cidade" value={event.details.city}/>
                    <Detail label="Dispositivo" value={event.details.device === "desktop" ? "Computador" : event.details.device === "mobile" ? "Celular" : event.details.device === "tablet" ? "Tablet" : event.details.device}/>
                    <Detail label="Viewport" value={event.details.viewportWidth ? `${event.details.viewportWidth} × ${event.details.viewportHeight}` : null}/>
                    <Detail label="Tela" value={event.details.screenWidth ? `${event.details.screenWidth} × ${event.details.screenHeight}` : null}/>
                    <Detail label="Navegador" value={[event.details.browser, event.details.operatingSystem].filter(Boolean).join(" · ")}/>
                    <Detail label="Origem" value={event.details.origin}/>
                    <Detail label="Cliques" value={event.details.clickCount}/>
                    {event.source === "postback" ? <><Detail label="Lead / pedido" value={event.details.orderId}/><Detail label="Status" value={event.details.status}/><Detail label="Valor" value={event.details.payout ? `${event.details.currency || ""} ${event.details.payout.toFixed(2)}`.trim() : null}/></> : null}
                  </div>
                  <div className="mt-5"><Detail label="URL acessada" value={event.details.pageUrl}/></div>
                  {Object.keys(event.details.parameters || {}).length ? <div className="mt-5 flex flex-wrap gap-2">{Object.entries(event.details.parameters).map(([key, value]) => <span key={key} className="rounded-full bg-background px-3 py-1.5 text-[11px] text-foreground"><strong>{key}:</strong> {value}</span>)}</div> : null}
                  {event.source === "postback" ? <div className="mt-6 border-t border-border pt-5"><p className="text-xs font-semibold text-foreground">Payload recebido</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-background p-4 text-[11px] text-muted-foreground">{JSON.stringify(event.details.payload || {}, null, 2)}</pre></div> : null}
                </div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 break-all text-sm font-medium text-foreground">{value === null || value === undefined || value === "" ? "—" : String(value)}</p></div>;
}
