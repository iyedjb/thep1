import { useState } from "react";
import { 
  useListKeywords, 
  useCreateKeyword, 
  useAnalyzeKeyword, 
  useGetKeywordTrends, 
  useGetIntentBreakdown,
  getListKeywordsQueryKey,
  getGetKeywordTrendsQueryKey,
  customFetch
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Brain, Plus, Search, TrendingUp, Sparkles, Check, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const newKeywordSchema = z.object({
  keyword: z.string().min(1, "A palavra-chave é obrigatória"),
  location: z.string().optional(),
});

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export default function Keywords() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState<string | undefined>(undefined);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Suggestions states
  const [seedInput, setSeedInput] = useState("");
  const [locationInput, setLocationInput] = useState("Brasil");
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [suggestionsResult, setSuggestionsResult] = useState<any[]>([]);
  const [searchSource, setSearchSource] = useState<string | null>(null);

  const { data: keywords, isLoading: loadingKeywords } = useListKeywords({ search }, { query: { queryKey: [...getListKeywordsQueryKey(), search] } });
  const { data: intentBreakdown, isLoading: loadingIntent } = useGetIntentBreakdown({ query: { queryKey: ["intent-breakdown"] } });
  const { data: trends, isLoading: loadingTrends } = useGetKeywordTrends(
    { keyword: selectedKeyword }, 
    { query: { queryKey: [...getGetKeywordTrendsQueryKey(), selectedKeyword], enabled: true } }
  );

  const createMutation = useCreateKeyword();
  const analyzeMutation = useAnalyzeKeyword();

  const form = useForm<z.infer<typeof newKeywordSchema>>({
    resolver: zodResolver(newKeywordSchema),
    defaultValues: {
      keyword: "",
      location: "",
    },
  });

  const onSubmit = (data: z.infer<typeof newKeywordSchema>) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKeywordsQueryKey() });
        setIsCreateOpen(false);
        form.reset();
        toast({ title: "Palavra-chave adicionada com sucesso" });
      },
      onError: () => {
        toast({ title: "Erro ao adicionar palavra-chave", variant: "destructive" });
      }
    });
  };

  const handleAnalyze = (id: number) => {
    analyzeMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKeywordsQueryKey() });
        toast({ title: "Análise concluída" });
      },
      onError: () => {
        toast({ title: "Erro ao analisar palavra-chave", variant: "destructive" });
      }
    });
  };

  const handleSearchSuggestions = async () => {
    if (!seedInput.trim()) {
      toast({ title: "Por favor, insira uma palavra-chave semente", variant: "destructive" });
      return;
    }
    setIsSearchingSuggestions(true);
    try {
      const res = await customFetch<{ suggestions: any[]; source: string }>(
        `/api/keywords/suggestions?seed=${encodeURIComponent(seedInput)}&location=${encodeURIComponent(locationInput)}`
      );
      setSuggestionsResult(res.suggestions || []);
      setSearchSource(res.source);
      toast({ title: `Encontradas ${res.suggestions?.length || 0} sugestões` });
    } catch (err: any) {
      toast({ title: "Erro ao buscar sugestões", description: err.message, variant: "destructive" });
    } finally {
      setIsSearchingSuggestions(false);
    }
  };

  const handleAddSuggestion = (text: string) => {
    createMutation.mutate({ 
      data: { 
        keyword: text, 
        location: locationInput 
      } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKeywordsQueryKey() });
        toast({ title: `Palavra-chave "${text}" adicionada com sucesso` });
      },
      onError: () => {
        toast({ title: "Erro ao adicionar palavra-chave", variant: "destructive" });
      }
    });
  };

  const isAlreadyTracked = (text: string) => {
    return keywords?.some(k => k.keyword.toLowerCase() === text.toLowerCase()) || false;
  };

  const getCompetitionBadge = (comp: string) => {
    switch (comp.toLowerCase()) {
      case "baixa": return <Badge variant="outline" className="text-green-500 border-green-500/20 bg-green-500/10">Baixa</Badge>;
      case "média": return <Badge variant="outline" className="text-yellow-500 border-yellow-500/20 bg-yellow-500/10">Média</Badge>;
      case "alta": return <Badge variant="outline" className="text-red-500 border-red-500/20 bg-red-500/10">Alta</Badge>;
      default: return <Badge variant="outline">{comp}</Badge>;
    }
  };

  const INTENT_COLORS = {
    "Transacional": "hsl(var(--chart-1))",
    "Comercial": "hsl(var(--chart-2))",
    "Informacional": "hsl(var(--chart-3))",
    "Navegacional": "hsl(var(--chart-4))",
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Palavras-chave</h1>
          <p className="text-muted-foreground mt-1">Pesquisa e análise de intenção de busca com IA</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-add-keyword">
              <Plus className="mr-2 h-4 w-4" /> Nova Palavra-chave
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Palavra-chave</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="keyword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Palavra-chave</FormLabel>
                      <FormControl>
                        <Input placeholder="ex: software de marketing" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Localização (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="ex: Brasil" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="my-keywords" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="my-keywords">Minhas Palavras</TabsTrigger>
          <TabsTrigger value="suggestions">Buscar Sugestões (Google Ads)</TabsTrigger>
        </TabsList>

        <TabsContent value="my-keywords" className="space-y-8 mt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Tendência de Busca (12 meses)</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingTrends ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : trends ? (
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                        <XAxis dataKey="month" className="text-xs" tickLine={false} axisLine={false} />
                        <YAxis className="text-xs" tickLine={false} axisLine={false} />
                        <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }} />
                        <Area type="monotone" dataKey="volume" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorVolume)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[300px] w-full flex items-center justify-center text-muted-foreground text-sm">
                    Selecione uma palavra-chave na tabela abaixo para ver o gráfico de tendências.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Intenção de Busca Geral</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingIntent ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : intentBreakdown ? (
                  <div className="h-[300px] w-full flex flex-col items-center">
                    <ResponsiveContainer width="100%" height="80%">
                      <PieChart>
                        <Pie
                          data={intentBreakdown}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="percentage"
                        >
                          {intentBreakdown.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={INTENT_COLORS[entry.intent as keyof typeof INTENT_COLORS] || "hsl(var(--primary))"} />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          formatter={(value: number) => `${value}%`}
                          contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="w-full mt-4 flex flex-wrap gap-2 justify-center">
                      {intentBreakdown.map((entry) => (
                        <div key={entry.intent} className="flex items-center text-xs">
                          <div className="w-3 h-3 rounded-full mr-1" style={{ backgroundColor: INTENT_COLORS[entry.intent as keyof typeof INTENT_COLORS] || "hsl(var(--primary))" }}></div>
                          <span className="text-muted-foreground">{entry.intent} ({entry.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Lista de Palavras-chave</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar..." 
                  className="pl-8" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              {loadingKeywords ? (
                <div className="space-y-4">
                  {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Palavra-chave</TableHead>
                      <TableHead className="text-right">Vol. de Busca</TableHead>
                      <TableHead>Concorrência</TableHead>
                      <TableHead className="text-right">CPC Médio</TableHead>
                      <TableHead>Análise IA</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keywords?.map((kw) => (
                      <TableRow key={kw.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedKeyword(kw.keyword)}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{kw.keyword}</span>
                            <span className="text-xs text-muted-foreground">{kw.location || "Global"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(kw.searchVolume)}</TableCell>
                        <TableCell>{getCompetitionBadge(kw.competition)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(kw.cpc)}</TableCell>
                        <TableCell className="max-w-[250px] truncate" title={kw.analysis || ""}>
                          {kw.analysis ? (
                            <span className="text-xs text-muted-foreground line-clamp-1">{kw.analysis}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Não analisado</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={(e) => { e.stopPropagation(); handleAnalyze(kw.id); }}
                            disabled={analyzeMutation.isPending && analyzeMutation.variables?.id === kw.id}
                            title="Analisar com IA"
                          >
                            <Brain className="h-4 w-4 text-primary" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {keywords?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Nenhuma palavra-chave encontrada.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suggestions" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Planejador de Palavras-chave (Google Ads)</CardTitle>
              <CardDescription>
                Obtenha novas ideias de palavras-chave, dados de volume de pesquisa, concorrência e lances em tempo real do Google Ads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Palavra-chave Semente</label>
                  <div className="relative">
                    <Sparkles className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="ex: marketing de afiliados, curso online, sapatos esportivos" 
                      className="pl-8" 
                      value={seedInput}
                      onChange={(e) => setSeedInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchSuggestions()}
                    />
                  </div>
                </div>
                <div className="w-full md:w-64">
                  <label className="text-sm font-medium mb-1 block">Localização</label>
                  <Input 
                    placeholder="ex: Brasil" 
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchSuggestions()}
                  />
                </div>
                <div className="flex items-end">
                  <Button 
                    className="w-full md:w-auto" 
                    onClick={handleSearchSuggestions} 
                    disabled={isSearchingSuggestions}
                  >
                    {isSearchingSuggestions ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Buscando...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Obter Sugestões
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {isSearchingSuggestions && (
                <div className="space-y-4 pt-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}

              {!isSearchingSuggestions && suggestionsResult.length > 0 && (
                <div className="space-y-4 pt-4">
                  <div className="flex justify-between items-center text-xs text-muted-foreground px-1">
                    <span>Fonte: {searchSource === "google-keyword-planner" ? "Google Ads Keyword Planner API (Real)" : "Mock/Backup"}</span>
                    <span>{suggestionsResult.length} ideias encontradas</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ideia de Palavra-chave</TableHead>
                        <TableHead className="text-right">Vol. Mensal Médio</TableHead>
                        <TableHead>Concorrência</TableHead>
                        <TableHead className="text-right font-medium text-primary">CPC Estimado</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suggestionsResult.map((suggestion, idx) => {
                        const tracked = isAlreadyTracked(suggestion.text);
                        return (
                          <TableRow key={idx} className="hover:bg-muted/50 transition-colors">
                            <TableCell className="font-semibold text-foreground">{suggestion.text}</TableCell>
                            <TableCell className="text-right font-mono">{formatNumber(suggestion.avgMonthlySearches)}</TableCell>
                            <TableCell>{getCompetitionBadge(suggestion.competition)}</TableCell>
                            <TableCell className="text-right font-mono text-primary font-medium">{formatCurrency(suggestion.cpc)}</TableCell>
                            <TableCell className="text-right">
                              {tracked ? (
                                <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20 py-1">
                                  <Check className="h-3 w-3 mr-1" /> Monitorada
                                </Badge>
                              ) : (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => handleAddSuggestion(suggestion.text)}
                                  disabled={createMutation.isPending}
                                >
                                  Monitorar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {!isSearchingSuggestions && suggestionsResult.length === 0 && (
                <div className="text-center py-12 border rounded-lg border-dashed text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 text-muted-foreground/55 animate-pulse" />
                  <p className="text-sm font-medium">Nenhuma sugestão carregada</p>
                  <p className="text-xs mt-1 text-muted-foreground/75">Digite uma palavra semente acima para pesquisar termos relacionados no Google Ads.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
