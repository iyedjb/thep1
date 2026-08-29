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

const emptyData: TrackingData = {
  period: "7d",
  presells: [], sites: [],
  summary: { visits: 0, uniqueVisitors: 0, todayVisits: 0, engagedVisits: 0, clickEvents: 0, leads: 0, approvedLeads: 0, paidLeads: 0, revenue: 0, revenueCurrency: null, revenueByCurrency: [], escapeRate: 0 },
  pages: [], devices: [], countries: [], daily: [], recentVisitors: [], recentConversions: [],
};

const deviceNames: Record<string, string> = { desktop: "Desktop", mobile: "Celular", tablet: "Tablet" };

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
    refetchInterval: 30_000,
  });
  const data = query.data || emptyData;
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

      <section className="border-b border-border py-8">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Postbacks recentes</h2><span className="text-xs text-muted-foreground">Tempo real</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead><tr className="border-y border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><th className="py-3 font-medium">Pedido</th><th className="py-3 font-medium">Site</th><th className="py-3 font-medium">Campanha</th><th className="py-3 font-medium">Status</th><th className="py-3 text-right font-medium">Comissão</th><th className="py-3 text-right font-medium">Recebido</th></tr></thead>
            <tbody>{data.recentConversions.map((conversion) => <tr key={conversion.id} className="border-b border-border/80"><td className="py-4"><p className="font-mono text-xs font-medium">{conversion.orderId}</p><p className="mt-1 text-[11px] text-muted-foreground">{conversion.matched ? "Atribuído ao clique" : "Sem correspondência"}</p></td><td className="py-4 text-sm">{conversion.site}</td><td className="max-w-48 truncate py-4 text-sm text-muted-foreground">{conversion.campaign || "—"}</td><td className="py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${conversion.statusGroup === "paid" || conversion.statusGroup === "approved" ? "bg-emerald-50 text-emerald-700" : conversion.statusGroup === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{conversion.status}</span></td><td className="py-4 text-right text-sm font-medium">{conversion.payout ? `${conversion.currency || ""} ${conversion.payout.toFixed(2)}`.trim() : "—"}</td><td className="py-4 text-right text-xs text-muted-foreground">{formatMoment(conversion.receivedAt)}</td></tr>)}</tbody>
          </table>
          {!data.recentConversions.length ? <p className="py-12 text-center text-sm text-muted-foreground">Os leads e pagamentos aparecerão aqui quando a plataforma enviar o primeiro postback.</p> : null}
        </div>
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

      <section className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
        <div className="py-8 lg:pr-10">
          <h2 className="mb-5 text-lg font-semibold">Visitantes recentes</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left"><thead><tr className="border-y border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><th className="py-3 font-medium">Visitante</th><th className="py-3 font-medium">Local</th><th className="py-3 font-medium">Dispositivo</th><th className="py-3 font-medium">Origem</th><th className="py-3 text-right font-medium">Acesso</th></tr></thead><tbody>{data.recentVisitors.map((visitor) => <tr key={visitor.id} className="border-b border-border/80"><td className="py-4"><p className="font-mono text-xs font-medium">{visitor.ip}</p><p className="mt-1 text-[11px] text-muted-foreground">{visitor.clicked ? "Clicou" : "Sem clique"}</p></td><td className="py-4 text-sm"><p>{visitor.city ? `${visitor.city}, ` : ""}{visitor.country}</p></td><td className="py-4 text-sm"><p>{deviceNames[visitor.device] || visitor.device}</p><p className="mt-1 text-xs text-muted-foreground">{visitor.browser} · {visitor.operatingSystem}</p></td><td className="py-4 text-sm">{visitor.source === "paid" ? "Pago" : "Orgânico"}</td><td className="py-4 text-right text-xs text-muted-foreground">{formatMoment(visitor.createdAt)}</td></tr>)}</tbody></table>{!data.recentVisitors.length ? <p className="py-12 text-center text-sm text-muted-foreground">Nenhum visitante registrado neste período.</p> : null}</div>
        </div>
        <div className="border-t border-border py-8 lg:border-l lg:border-t-0 lg:pl-10"><h2 className="mb-5 text-lg font-semibold">Países</h2><div className="space-y-4">{data.countries.map((country) => <div key={country.name}><div className="mb-2 flex justify-between text-sm"><span>{country.name}</span><span className="text-muted-foreground">{country.value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${data.summary.visits ? Math.max(3, (country.value / data.summary.visits) * 100) : 0}%` }}/></div></div>)}{!data.countries.length ? <p className="text-sm text-muted-foreground">Os países aparecerão após os primeiros acessos.</p> : null}</div></div>
      </section>

    </div>
  );
}
