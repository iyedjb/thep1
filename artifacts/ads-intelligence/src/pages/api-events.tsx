import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleDollarSign, CircleX, UserPlus } from "lucide-react";
import { Link, useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

type ApiEvent = {
  id: number;
  sender: string;
  orderId: string | null;
  clickId: string | null;
  status: string;
  statusGroup: "pending" | "approved" | "rejected" | "paid";
  payout: number;
  currency: string | null;
  phone: string | null;
  customerName: string | null;
  receivedAt: string;
  matched: boolean;
  site: { id: number; name: string; slug: string } | null;
  visitor: {
    clientId: string | null;
    visitorId: string | null;
    countryCode: string | null;
    country: string | null;
    city: string | null;
    device: string | null;
    browser: string | null;
    operatingSystem: string | null;
    userAgent: string | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
    screenWidth: number | null;
    screenHeight: number | null;
    clickCount: number;
    pagePath: string | null;
    referrer: string | null;
  } | null;
  payload: Record<string, string>;
};

type EventsResponse = {
  integration: { id: number; name: string; provider: string; providerName: string };
  events: ApiEvent[];
};

const EVENT_STYLE = {
  pending: { label: "Novo lead", icon: UserPlus, color: "text-amber-600", bg: "bg-amber-50" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
  rejected: { label: "Rejeitado", icon: CircleX, color: "text-rose-600", bg: "bg-rose-50" },
  paid: { label: "Pagamento", icon: CircleDollarSign, color: "text-emerald-700", bg: "bg-emerald-50" },
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1.5 break-all text-sm font-medium text-foreground">{children || "—"}</div>
    </div>
  );
}

export default function ApiEventsPage() {
  const params = useParams<{ id: string }>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const query = useQuery<EventsResponse>({
    queryKey: ["postback-events", params.id],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const response = await fetch(`/api/postback/integrations/${params.id}/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Não foi possível carregar os eventos.");
      return response.json();
    },
    refetchInterval: 10_000,
  });
  const events = query.data?.events || [];
  const selected = events.find((event) => event.id === selectedId) || events[0] || null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
      <header className="border-b border-border pb-8">
        <Link href="/postbacks" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Voltar para APIs
        </Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Eventos recebidos</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{query.data?.integration.name || "Detalhes da API"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{query.data?.integration.providerName || "Plataforma"} envia estas notificações ao ClicLab.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Atualização automática</div>
        </div>
      </header>

      {query.isLoading ? (
        <div className="grid gap-8 py-8 lg:grid-cols-[0.9fr_1.4fr]"><Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" /></div>
      ) : query.isError ? (
        <p className="py-20 text-center text-sm text-rose-600">Não foi possível carregar os eventos desta API.</p>
      ) : events.length === 0 ? (
        <div className="py-24 text-center"><h2 className="text-lg font-semibold">Nenhum evento recebido</h2><p className="mt-2 text-sm text-muted-foreground">Quando a plataforma enviar o primeiro postback, todos os detalhes aparecerão aqui.</p></div>
      ) : (
        <div className="grid gap-10 py-8 lg:grid-cols-[0.85fr_1.45fr]">
          <div className="divide-y divide-border border-y border-border">
            {events.map((event) => {
              const style = EVENT_STYLE[event.statusGroup] || EVENT_STYLE.pending;
              const Icon = style.icon;
              const active = selected?.id === event.id;
              return (
                <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className={`flex w-full gap-3 px-2 py-4 text-left transition-colors ${active ? "bg-primary/[0.05]" : "hover:bg-muted/40"}`}>
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.bg} ${style.color}`}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3"><strong className="text-sm text-foreground">{style.label}</strong><time className="text-[11px] text-muted-foreground">{formatDate(event.receivedAt)}</time></span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{event.orderId || event.clickId || "Sem identificador"}</span>
                    <span className="mt-1 block truncate text-xs font-medium text-primary/75">{event.site?.name || "Sem atribuição"}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
                <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Evento #{selected.id}</p><h2 className="mt-1 text-xl font-semibold text-foreground">{selected.status}</h2></div>
                <p className="text-sm font-medium text-foreground">{formatDate(selected.receivedAt)}</p>
              </div>

              <div className="grid gap-x-8 gap-y-6 border-b border-border py-7 sm:grid-cols-2">
                <Value label="Enviado por">{selected.sender}</Value>
                <Value label="Site">{selected.site?.name || "Sem atribuição"}</Value>
                <Value label="ID do lead/pedido">{selected.orderId}</Value>
                <Value label="Click ID">{selected.clickId}</Value>
                <Value label="Nome">{selected.customerName || "Não enviado pela plataforma"}</Value>
                <Value label="Telefone">{selected.phone || "Não enviado pela plataforma"}</Value>
                <Value label="Valor">{selected.payout ? `${selected.currency || ""} ${selected.payout.toFixed(2)}`.trim() : "—"}</Value>
                <Value label="Atribuição">{selected.matched ? "Visitante identificado" : "Não atribuída"}</Value>
              </div>

              <div className="border-b border-border py-7">
                <h3 className="text-sm font-semibold text-foreground">Visitante atribuído</h3>
                {!selected.matched ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><strong>Este callback chegou sem Client ID.</strong> A LemonAD não devolveu o parâmetro <code>clickid</code>, por isso este evento antigo não pode ser ligado retroativamente a um acesso. As presells LemonAD agora enviam o Client ID automaticamente.</div> : null}
                <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                  <Value label="Client ID">{selected.visitor?.clientId || selected.clickId}</Value>
                  <Value label="Visitor ID">{selected.visitor?.visitorId}</Value>
                  <Value label="País">{[selected.visitor?.country, selected.visitor?.countryCode].filter(Boolean).join(" · ")}</Value>
                  <Value label="Cidade">{selected.visitor?.city}</Value>
                  <Value label="Dispositivo">{selected.visitor?.device === "desktop" ? "Computador" : selected.visitor?.device === "mobile" ? "Celular" : selected.visitor?.device === "tablet" ? "Tablet" : selected.visitor?.device}</Value>
                  <Value label="Viewport">{selected.visitor?.viewportWidth ? `${selected.visitor.viewportWidth} × ${selected.visitor.viewportHeight}` : null}</Value>
                  <Value label="Tela">{selected.visitor?.screenWidth ? `${selected.visitor.screenWidth} × ${selected.visitor.screenHeight}` : null}</Value>
                  <Value label="Navegador">{[selected.visitor?.browser, selected.visitor?.operatingSystem].filter(Boolean).join(" · ")}</Value>
                  <Value label="Cliques">{selected.visitor?.clickCount}</Value>
                  <Value label="Origem">{selected.visitor?.referrer}</Value>
                </div>
                <div className="mt-6 space-y-5"><Value label="URL acessada">{selected.visitor?.pagePath}</Value><Value label="User agent">{selected.visitor?.userAgent}</Value></div>
              </div>

              <div className="py-7">
                <h3 className="text-sm font-semibold text-foreground">Payload recebido</h3>
                <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-muted/20 px-4">
                  {Object.entries(selected.payload).map(([key, value]) => (
                    <div key={key} className="grid gap-1 py-3 text-xs sm:grid-cols-[160px_1fr]"><span className="font-mono text-muted-foreground">{key}</span><span className="break-all font-mono text-foreground">{String(value)}</span></div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
