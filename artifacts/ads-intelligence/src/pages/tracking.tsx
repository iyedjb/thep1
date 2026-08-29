import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TrackingData = {
  period: string;
  presells: Array<{ id: number; product_name: string | null; published_url: string | null; status: string }>;
  sites: Array<{ id: number; name: string; siteKey: string; status: string; trackingAddress: string; snippet: string }>;
  summary: { visits: number; uniqueVisitors: number; todayVisits: number; engagedVisits: number; clickEvents: number; leads: number; approvedLeads: number; paidLeads: number; revenue: number; revenueCurrency: string | null; revenueByCurrency: Array<{ currency: string; amount: number }>; escapeRate: number };
  pages: Array<{ id: number | string; name: string; url: string; snippet?: string; status: string; visits: number; clicks: number; conversions: number; revenue: number; clickRate: number; escapeRate: number }>;
  devices: Array<{ name: string; value: number }>;
  countries: Array<{ name: string; value: number }>;
  daily: Array<{ date: string; visits: number; clicks: number }>;
  recentVisitors: Array<{ id: string; ip: string; country: string; city: string; device: string; browser: string; operatingSystem: string; clicked: boolean; source: string; createdAt: string }>;
  recentConversions: Array<{ id: number; provider: string; orderId: string; status: string; statusGroup: "pending" | "approved" | "paid" | "rejected"; payout: number; currency: string | null; campaign: string | null; site: string; matched: boolean; receivedAt: string }>;
};

type EventDetails = {
  clientId: string | null;
  visitorId: string | null;
  ip: string | null;
  countryCode: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  operatingSystem: string | null;
  userAgent: string | null;
  origin: string | null;
  pageUrl: string | null;
  parameters: Record<string, string>;
  clickIdType: string | null;
  clickId: string | null;
  clickCount: number;
  clickedAt: string | null;
  sender?: string | null;
  integrationName?: string | null;
  orderId?: string | null;
  status?: string | null;
  statusGroup?: string | null;
  payout?: number;
  currency?: string | null;
  campaign?: string | null;
  matched?: boolean;
  payload?: Record<string, unknown>;
};

type TrackingEvent = {
  id: string;
  type: "visit" | "click" | "pending" | "approved" | "paid" | "rejected";
  title: string;
  description: string;
  siteId: number | null;
  siteName: string;
  source: "paid" | "organic" | "postback";
  occurredAt: string;
  details: EventDetails;
};

type ActivityData = { events: TrackingEvent[] };

const emptyData: TrackingData = {
  period: "7d",
  presells: [], sites: [],
  summary: { visits: 0, uniqueVisitors: 0, todayVisits: 0, engagedVisits: 0, clickEvents: 0, leads: 0, approvedLeads: 0, paidLeads: 0, revenue: 0, revenueCurrency: null, revenueByCurrency: [], escapeRate: 0 },
  pages: [], devices: [], countries: [], daily: [], recentVisitors: [], recentConversions: [],
};

const deviceNames: Record<string, string> = { desktop: "Desktop", mobile: "Celular", tablet: "Tablet" };
const eventFilters = [
  { value: "all", label: "Todos" },
  { value: "visit", label: "Acessos" },
  { value: "click", label: "Cliques" },
  { value: "pending", label: "Leads" },
  { value: "approved", label: "Aprovados" },
  { value: "paid", label: "Pagos" },
  { value: "rejected", label: "Rejeitados" },
];

const detailSections = [
  { value: "identity", label: "Identificação" },
  { value: "location", label: "Localização" },
  { value: "device", label: "Dispositivo" },
  { value: "attribution", label: "Origem e cliques" },
  { value: "parameters", label: "Parâmetros" },
  { value: "conversion", label: "Conversão" },
];

function valueOrDash(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function DetailValue({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return <div className="min-w-0 border-b border-border/70 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className={`mt-1 break-all text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>{valueOrDash(value)}</p></div>;
}

function formatMoment(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatRevenue(data: TrackingData) {
  if (!data.summary.revenueByCurrency.length) return "—";
  if (data.summary.revenueByCurrency.length > 1) return `${data.summary.revenueByCurrency.length} moedas`;
  const item = data.summary.revenueByCurrency[0];
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency }).format(item.amount);
  } catch {
    return `${item.currency} ${item.amount.toFixed(2)}`;
  }
}

export default function TrackingPage() {
  const [period, setPeriod] = useState("7d");
  const [siteId, setSiteId] = useState("all");
  const [source, setSource] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [visibleSections, setVisibleSections] = useState(() => new Set(detailSections.map((section) => section.value)));
  const [copiedPage, setCopiedPage] = useState<number | string | null>(null);
  const token = localStorage.getItem("ads_token");
  const query = useQuery<TrackingData>({
    queryKey: ["tracking-overview", period, siteId, source],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (siteId !== "all") params.set("siteId", siteId);
      if (source !== "all") params.set("source", source);
      const response = await fetch(`/api/tracking/overview?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Não foi possível carregar o rastreamento.");
      return response.json();
    },
    refetchInterval: 10_000,
  });
  const activityQuery = useQuery<ActivityData>({
    queryKey: ["tracking-events", period, siteId],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (siteId !== "all") params.set("siteId", siteId);
      const response = await fetch(`/api/tracking/activity?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Não foi possível carregar os eventos.");
      return response.json();
    },
    refetchInterval: 5_000,
  });
  const data = query.data || emptyData;
  const filteredEvents = useMemo(() => (activityQuery.data?.events || []).filter((event) =>
    (eventType === "all" || event.type === eventType)
    && (source === "all" || event.source === source || (event.source === "postback" && source === "paid"))
  ), [activityQuery.data?.events, eventType, source]);
  const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId) || filteredEvents[0] || null;
  const totalDeviceVisits = data.devices.reduce((sum, item) => sum + item.value, 0);
  const chartData = useMemo(() => data.daily.map((item) => ({
    ...item,
    label: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${item.date}T12:00:00`)),
  })), [data.daily]);
  const copyScript = async (page: TrackingData["pages"][number]) => {
    if (!page.snippet) return;
    await navigator.clipboard.writeText(page.snippet);
    setCopiedPage(page.id);
    window.setTimeout(() => setCopiedPage(null), 1600);
  };
  const copyValue = async (value: string | null, key: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedValue(key);
    window.setTimeout(() => setCopiedValue(null), 1500);
  };
  const toggleSection = (value: string) => setVisibleSections((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <div className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Tempo real</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">Rastreamento</h1>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="tracking-site">Selecionar site</label>
          <select id="tracking-site" value={siteId} onChange={(event) => setSiteId(event.target.value)} className="h-11 min-w-56 rounded-full border border-border bg-background px-4 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">
            <option value="all">Todos os sites</option>
            {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <div className="grid grid-cols-3 rounded-full border border-border p-1">
            {[{ value: "all", label: "Todos" }, { value: "paid", label: "Pago" }, { value: "organic", label: "Orgânico" }].map((item) => <button key={item.value} type="button" onClick={() => setSource(item.value)} className={`h-9 rounded-full px-4 text-xs font-semibold transition-colors ${source === item.value ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
          </div>
          <div className="grid grid-cols-3 rounded-full border border-border p-1">
            {["7d", "30d", "90d"].map((value) => <button key={value} type="button" onClick={() => setPeriod(value)} className={`h-9 rounded-full px-4 text-xs font-semibold transition-colors ${period === value ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}>{value.replace("d", " dias")}</button>)}
          </div>
        </div>
      </div>

      {query.isError ? <div className="my-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">Não foi possível carregar os dados agora.</div> : null}

      <section className="grid grid-cols-2 border-b border-border sm:grid-cols-4 xl:grid-cols-8">
        {[
          ["Visitas", data.summary.visits],
          ["Visitantes", data.summary.uniqueVisitors],
          ["Cliques", data.summary.engagedVisits],
          ["Visitas hoje", data.summary.todayVisits],
          ["Leads", data.summary.leads],
          ["Aprovados", data.summary.approvedLeads],
          ["Pagos", data.summary.paidLeads],
          ["Receita", formatRevenue(data)],
          ["Fuga", `${data.summary.escapeRate}%`],
        ].map(([label, value], index) => <div key={String(label)} className={`py-6 sm:px-5 ${label === "Fuga" ? "col-span-2 sm:col-span-1 xl:col-span-8 xl:border-t" : ""} ${index % 2 === 1 ? "border-l border-border" : ""} ${index > 0 && index < 8 ? "xl:border-l xl:border-border" : ""}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p></div>)}
      </section>

      <section className="border-b border-border py-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-foreground">Eventos em tempo real</h2><span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>Ao vivo</span></div>
            <p className="mt-1 text-sm text-muted-foreground">Selecione um evento para ver todos os dados capturados.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {eventFilters.map((item) => <button key={item.value} type="button" onClick={() => { setEventType(item.value); setSelectedEventId(null); }} className={`h-9 rounded-full border px-4 text-xs font-semibold transition-colors ${eventType === item.value ? "border-primary bg-primary text-white" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>{item.label}</button>)}
          </div>
        </div>

        <div className="mt-6 grid overflow-hidden rounded-[26px] border border-border bg-background xl:grid-cols-[380px_minmax(0,1fr)]">
          <div className="border-b border-border xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Atividade</p><span className="text-xs text-muted-foreground">{filteredEvents.length}</span></div>
            <div className="max-h-[700px] overflow-y-auto">
              {filteredEvents.map((event) => {
                const active = selectedEvent?.id === event.id;
                const positive = event.type === "approved" || event.type === "paid";
                return <button key={event.id} type="button" onClick={() => setSelectedEventId(event.id)} className={`block w-full border-b border-border/70 px-5 py-4 text-left transition-colors ${active ? "bg-primary/[0.06]" : "hover:bg-muted/40"}`}>
                  <div className="flex items-start gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${positive ? "bg-emerald-500" : event.type === "rejected" ? "bg-red-500" : event.type === "click" ? "bg-violet-500" : "bg-primary"}`}/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold text-foreground">{event.title}</p><time className="shrink-0 text-[10px] text-muted-foreground">{formatMoment(event.occurredAt)}</time></div><p className="mt-1 truncate text-xs text-muted-foreground">{event.siteName}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{event.description}</p></div></div>
                </button>;
              })}
              {!filteredEvents.length ? <div className="px-6 py-16 text-center"><p className="text-sm font-medium text-foreground">Nenhum evento neste filtro</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Novos acessos, cliques e postbacks aparecerão aqui automaticamente.</p></div> : null}
            </div>
          </div>

          <div className="min-w-0">
            {selectedEvent ? <>
              <div className="border-b border-border px-5 py-5 sm:px-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{selectedEvent.siteName}</p><h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{selectedEvent.title}</h3><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "medium" }).format(new Date(selectedEvent.occurredAt))}</p></div>
                  <button type="button" onClick={() => setShowPersonalization((value) => !value)} className="h-9 self-start rounded-full border border-border px-4 text-xs font-semibold text-foreground hover:border-primary/40">Personalizar dados</button>
                </div>
                {showPersonalization ? <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">{detailSections.map((section) => <button key={section.value} type="button" onClick={() => toggleSection(section.value)} className={`h-8 rounded-full border px-3 text-[11px] font-semibold ${visibleSections.has(section.value) ? "border-primary/30 bg-primary/[0.07] text-primary" : "border-border text-muted-foreground"}`}>{visibleSections.has(section.value) ? "✓ " : "+ "}{section.label}</button>)}</div> : null}
              </div>

              <div className="space-y-7 px-5 py-6 sm:px-7">
                {visibleSections.has("identity") ? <div><p className="text-xs font-semibold text-foreground">Identificação</p><div className="mt-2 grid sm:grid-cols-2"><div className="sm:pr-5"><DetailValue label="Client ID" value={selectedEvent.details.clientId} mono/><button type="button" onClick={() => copyValue(selectedEvent.details.clientId, "client")} className="mt-2 text-[11px] font-semibold text-primary">{copiedValue === "client" ? "Copiado" : "Copiar Client ID"}</button></div><div className="sm:border-l sm:border-border sm:pl-5"><DetailValue label="Visitor ID" value={selectedEvent.details.visitorId} mono/></div></div></div> : null}

                {visibleSections.has("location") ? <div><p className="text-xs font-semibold text-foreground">Localização</p><div className="mt-2 grid grid-cols-2 gap-x-5 sm:grid-cols-4"><DetailValue label="País" value={selectedEvent.details.country}/><DetailValue label="Código" value={selectedEvent.details.countryCode}/><DetailValue label="Cidade" value={selectedEvent.details.city}/><DetailValue label="IP" value={selectedEvent.details.ip} mono/></div></div> : null}

                {visibleSections.has("device") ? <div><p className="text-xs font-semibold text-foreground">Dispositivo</p><div className="mt-2 grid gap-x-5 sm:grid-cols-3"><DetailValue label="Tipo" value={deviceNames[selectedEvent.details.device || ""] || selectedEvent.details.device}/><DetailValue label="Navegador" value={selectedEvent.details.browser}/><DetailValue label="Sistema" value={selectedEvent.details.operatingSystem}/></div><DetailValue label="User agent" value={selectedEvent.details.userAgent} mono/></div> : null}

                {visibleSections.has("attribution") ? <div><p className="text-xs font-semibold text-foreground">Origem e cliques</p><div className="mt-2 grid gap-x-5 sm:grid-cols-3"><DetailValue label="Origem" value={selectedEvent.details.origin}/><DetailValue label="Fonte" value={selectedEvent.source === "postback" ? "Postback" : selectedEvent.source === "paid" ? "Pago" : "Orgânico"}/><DetailValue label="Total de cliques" value={selectedEvent.details.clickCount}/><DetailValue label="Tipo do Click ID" value={selectedEvent.details.clickIdType}/><DetailValue label="Click ID" value={selectedEvent.details.clickId} mono/><DetailValue label="Último clique" value={selectedEvent.details.clickedAt ? formatMoment(selectedEvent.details.clickedAt) : null}/></div><DetailValue label="URL acessada" value={selectedEvent.details.pageUrl} mono/><div className="flex gap-4"><button type="button" onClick={() => copyValue(selectedEvent.details.pageUrl, "url")} className="mt-2 text-[11px] font-semibold text-primary">{copiedValue === "url" ? "Copiada" : "Copiar URL"}</button></div><DetailValue label="Referrer / origem" value={selectedEvent.details.origin} mono/></div> : null}

                {visibleSections.has("parameters") ? <div><p className="text-xs font-semibold text-foreground">Parâmetros da URL</p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(selectedEvent.details.parameters || {}).map(([key, value]) => <span key={key} className="max-w-full break-all rounded-full bg-muted px-3 py-1.5 text-[11px] text-foreground"><strong>{key}:</strong> {value}</span>)}{!Object.keys(selectedEvent.details.parameters || {}).length ? <span className="text-xs text-muted-foreground">Nenhum parâmetro recebido.</span> : null}</div></div> : null}

                {visibleSections.has("conversion") && selectedEvent.source === "postback" ? <div><p className="text-xs font-semibold text-foreground">Conversão recebida</p><div className="mt-2 grid gap-x-5 sm:grid-cols-3"><DetailValue label="Enviado por" value={selectedEvent.details.integrationName || selectedEvent.details.sender}/><DetailValue label="Pedido / Lead" value={selectedEvent.details.orderId} mono/><DetailValue label="Status" value={selectedEvent.details.status}/><DetailValue label="Comissão" value={selectedEvent.details.payout ? `${selectedEvent.details.currency || ""} ${selectedEvent.details.payout.toFixed(2)}`.trim() : null}/><DetailValue label="Campanha" value={selectedEvent.details.campaign}/><DetailValue label="Atribuição" value={selectedEvent.details.matched ? "Ligado ao clique" : "Sem correspondência"}/></div><DetailValue label="Dados enviados pela plataforma" value={JSON.stringify(selectedEvent.details.payload || {}, null, 2)} mono/></div> : null}
              </div>
            </> : <div className="flex min-h-[420px] items-center justify-center px-8 text-center"><div><p className="text-sm font-semibold text-foreground">Selecione um evento</p><p className="mt-2 text-xs text-muted-foreground">Os detalhes completos aparecerão aqui.</p></div></div>}
          </div>
        </div>
      </section>

      <section className="border-b border-border py-8">
        <div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold text-foreground">Visitas e cliques</h2><span className="text-xs text-muted-foreground">Atualização automática</span></div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
              <defs><linearGradient id="trackingVisits" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00a6fb" stopOpacity={0.2}/><stop offset="100%" stopColor="#00a6fb" stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={28}/>
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}/>
              <Tooltip contentStyle={{ borderRadius: 16, border: "1px solid hsl(var(--border))", boxShadow: "0 16px 40px rgba(15,23,42,.1)", fontSize: 12 }} />
              <Area type="monotone" dataKey="visits" name="Visitas" stroke="#00a6fb" strokeWidth={2.5} fill="url(#trackingVisits)" />
              <Area type="monotone" dataKey="clicks" name="Cliques" stroke="#111827" strokeWidth={2} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {!data.summary.visits ? <p className="mt-3 text-center text-sm text-muted-foreground">As primeiras visitas aparecerão aqui assim que uma presell publicada for acessada.</p> : null}
      </section>

      <section className="grid border-b border-border lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <div className="py-8 lg:pr-10">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Desempenho por site</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead><tr className="border-y border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><th className="py-3 pr-4 font-medium">Site</th><th className="px-3 py-3 text-right font-medium">Visitas</th><th className="px-3 py-3 text-right font-medium">Cliques</th><th className="px-3 py-3 text-right font-medium">Vendas</th><th className="px-3 py-3 text-right font-medium">Taxa</th><th className="px-3 py-3 text-right font-medium">Fuga</th><th className="py-3 pl-3 text-right font-medium">Ação</th></tr></thead>
              <tbody>{data.pages.map((page) => <tr key={page.id} className="border-b border-border/80"><td className="max-w-xs py-4 pr-4"><p className="truncate text-sm font-medium">{page.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{page.url || "Ainda não publicada"}</p></td><td className="px-3 py-4 text-right text-sm">{page.visits}</td><td className="px-3 py-4 text-right text-sm">{page.clicks}</td><td className="px-3 py-4 text-right text-sm font-medium">{page.conversions}</td><td className="px-3 py-4 text-right text-sm">{page.clickRate}%</td><td className="px-3 py-4 text-right text-sm font-medium">{page.escapeRate}%</td><td className="py-4 pl-3 text-right">{page.snippet ? <button type="button" onClick={() => copyScript(page)} title="Cole o código dentro da tag <head> da página" className="h-8 rounded-full border border-border px-3 text-xs font-semibold hover:border-primary/35 hover:text-primary">{copiedPage === page.id ? "Copiado" : "Copiar para <head>"}</button> : <span className="text-xs text-muted-foreground">—</span>}</td></tr>)}</tbody>
            </table>
            {!data.pages.length ? <div className="py-14 text-center text-sm text-muted-foreground">Nenhum dado registrado ainda.</div> : null}
          </div>
        </div>
        <div className="border-t border-border py-8 lg:border-l lg:border-t-0 lg:pl-10">
          <h2 className="text-lg font-semibold">Dispositivos</h2>
          <div className="mx-auto mt-4 h-44 max-w-xs"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.devices.length ? data.devices : [{ name: "Sem dados", value: 1 }]} dataKey="value" innerRadius={52} outerRadius={76} paddingAngle={2} fill="#00a6fb" stroke="white" strokeWidth={3}/><Tooltip /></PieChart></ResponsiveContainer></div>
          <div className="space-y-3">{data.devices.map((item) => <div key={item.name} className="flex items-center justify-between border-b border-border/70 pb-3 text-sm"><span className="text-muted-foreground">{deviceNames[item.name] || item.name}</span><span className="font-medium">{totalDeviceVisits ? Math.round((item.value / totalDeviceVisits) * 100) : 0}% <span className="ml-2 text-xs text-muted-foreground">{item.value}</span></span></div>)}</div>
        </div>
      </section>

      <section className="py-8"><h2 className="mb-5 text-lg font-semibold">Países</h2><div className="grid gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">{data.countries.map((country) => <div key={country.name}><div className="mb-2 flex justify-between text-sm"><span>{country.name}</span><span className="text-muted-foreground">{country.value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${data.summary.visits ? Math.max(3, (country.value / data.summary.visits) * 100) : 0}%` }}/></div></div>)}{!data.countries.length ? <p className="text-sm text-muted-foreground">Os países aparecerão após os primeiros acessos.</p> : null}</div></section>

    </div>
  );
}
