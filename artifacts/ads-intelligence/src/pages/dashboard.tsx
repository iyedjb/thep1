import { useGetDashboardSummary, useGetPerformance, useGetConversionsByCampaign } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownIcon, ArrowUpIcon, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
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

export default function Dashboard() {
  const [days, setDays] = useState("30");
  
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ days: parseInt(days) }, { query: { queryKey: ["dashboard-summary", days] }});
  const { data: performance, isLoading: loadingPerformance } = useGetPerformance({ days: parseInt(days) }, { query: { queryKey: ["dashboard-performance", days] }});
  const { data: conversions, isLoading: loadingConversions } = useGetConversionsByCampaign({ query: { queryKey: ["dashboard-conversions"] }});

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Visão geral de performance de suas campanhas</p>
        </div>
        <div className="w-48">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="14">Últimos 14 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {loadingSummary ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
        ) : summary ? (
          <>
            <StatCard 
              title="CPC Médio" 
              value={formatCurrency(summary.cpcAvg)} 
              change={summary.cpcChange} 
              inverse={true} 
            />
            <StatCard 
              title="CPA" 
              value={formatCurrency(summary.cpa)} 
              change={summary.cpaChange} 
              inverse={true} 
            />
            <StatCard 
              title="CTR" 
              value={formatPercent(summary.ctr)} 
              change={summary.ctrChange} 
            />
            <StatCard 
              title="ROAS" 
              value={typeof summary.roas === "number" ? `${summary.roas.toFixed(2)}x` : "-"} 
              change={summary.roasChange} 
            />
          </>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-7">
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle>Desempenho</CardTitle>
          </CardHeader>
          <CardContent className="pl-0">
            {loadingPerformance ? (
              <Skeleton className="h-[300px] w-full" />
            ) : Array.isArray(performance) ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performance} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="date" className="text-xs" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" className="text-xs" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" className="text-xs" tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="clicks" name="Cliques" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                    <Line yAxisId="left" type="monotone" dataKey="conversions" name="Conversões" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="cost" name="Custo" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Conversões por Campanha</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingConversions ? (
              <Skeleton className="h-[300px] w-full" />
            ) : Array.isArray(conversions) ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={conversions}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {conversions.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                      formatter={(value: number) => formatNumber(value)}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, change, inverse = false }: { title: string, value: string, change: number, inverse?: boolean }) {
  // If inverse is true, a decrease is good (e.g. lower CPC)
  const isPositiveChange = change > 0;
  const isGood = inverse ? !isPositiveChange : isPositiveChange;
  
  return (
    <Card className="bg-white/50 backdrop-blur-lg border border-white/60 shadow-[0_8px_30px_rgba(100,120,255,0.02)] transition-all duration-300 hover:shadow-[0_12px_35px_rgba(100,120,255,0.06)] hover:scale-[1.03] hover:bg-white/75 rounded-[1.75rem]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Activity className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs mt-1 flex items-center gap-1">
          <span className={isGood ? "text-green-500 flex items-center" : "text-red-500 flex items-center"}>
            {isPositiveChange ? <ArrowUpIcon className="h-3 w-3" /> : <ArrowDownIcon className="h-3 w-3" />}
            {Math.abs(change)}%
          </span>
          <span className="text-muted-foreground">vs. período anterior</span>
        </p>
      </CardContent>
    </Card>
  );
}


