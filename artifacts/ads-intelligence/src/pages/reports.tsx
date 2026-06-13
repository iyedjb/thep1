import { useGetDashboardSummary, useListCampaigns } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100);
}

export default function Reports() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ days: 30 });
  const { data: campaigns, isLoading: loadingCampaigns } = useListCampaigns();
  const { toast } = useToast();

  const handleExportCSV = () => {
    if (!campaigns || campaigns.length === 0) {
      toast({ title: "Nenhum dado para exportar", variant: "destructive" });
      return;
    }

    const headers = ["Campanha", "Status", "Orçamento (R$)", "CPC (R$)", "CTR (%)", "Conversões", "CPA (R$)", "ROAS"];
    const rows = campaigns.map((c) => {
      const cpa = c.conversions > 0 ? (c.budget * c.cpc) / c.conversions : 0;
      return [
        c.name,
        c.status,
        c.budget.toFixed(2),
        c.cpc.toFixed(2),
        c.ctr.toFixed(1),
        c.conversions.toString(),
        cpa.toFixed(2),
        c.roas.toFixed(2),
      ];
    });

    // Add summary row
    const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0);
    const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
    const avgCpc = campaigns.reduce((s, c) => s + c.cpc, 0) / campaigns.length;
    const avgCtr = campaigns.reduce((s, c) => s + c.ctr, 0) / campaigns.length;
    const avgRoas = campaigns.reduce((s, c) => s + c.roas, 0) / campaigns.length;
    const totalCpa = totalConversions > 0 ? (totalBudget * avgCpc) / totalConversions : 0;

    rows.push([
      "TOTAL / MÉDIA",
      "-",
      totalBudget.toFixed(2),
      avgCpc.toFixed(2),
      avgCtr.toFixed(1),
      totalConversions.toString(),
      totalCpa.toFixed(2),
      avgRoas.toFixed(2),
    ]);

    // BOM for Excel UTF-8 compatibility
    const BOM = "\uFEFF";
    const csvContent = BOM + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-campanhas-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({ title: "Relatório exportado com sucesso!" });
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Relatórios</h1>
          <p className="text-muted-foreground mt-1">Análise agregada e exportação de dados</p>
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={loadingCampaigns || !campaigns?.length}>
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Investimento Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-3xl font-bold">{formatCurrency(summary?.totalCost || 0)}</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Retorno (ROAS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-3xl font-bold">{summary?.roas?.toFixed(2) || 0}x</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Total de Conversões
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-3xl font-bold">{new Intl.NumberFormat("pt-BR").format(summary?.conversions || 0)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Métricas Detalhadas por Campanha</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCampaigns ? (
            <div className="space-y-4">
              {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Orçamento</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Conversões</TableHead>
                  <TableHead className="text-right">CPA</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns?.map((campaign) => {
                  // Real CPA computed from campaign metrics
                  const cpa = campaign.conversions > 0 
                    ? (campaign.budget * campaign.cpc) / campaign.conversions 
                    : 0;
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.name}</TableCell>
                      <TableCell className="text-right">{formatCurrency(campaign.budget)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(campaign.cpc)}</TableCell>
                      <TableCell className="text-right">{formatPercent(campaign.ctr)}</TableCell>
                      <TableCell className="text-right">{new Intl.NumberFormat("pt-BR").format(campaign.conversions)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cpa)}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{campaign.roas.toFixed(2)}x</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
