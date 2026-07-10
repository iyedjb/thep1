import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, TrendingUp, Globe, MapPin, Sparkles, AlertCircle, Users, Heart, Cpu, Coins, Plus, Check, Loader2, BookOpen, Smartphone, Monitor, Trophy, X, Edit3 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, PieChart, Pie, Cell } from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCreateKeyword, getListKeywordsQueryKey, customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

const GENDER_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];
const DEVICE_COLORS = ["hsl(var(--chart-4))", "hsl(var(--chart-5))"];

function getDemographicsForKeyword(keyword: string) {
  let hash = 0;
  for (let i = 0; i < keyword.length; i++) {
    hash = keyword.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const maleBase = 35 + (hash % 25); // 35% to 60%
  const femaleBase = 95 - maleBase; // female = 100% - male - unknown
  const unknown = 5;
  const genders = [
    { name: "Masculino", value: maleBase },
    { name: "Feminino", value: femaleBase },
    { name: "Desconhecido", value: unknown },
  ];

  // Generate raw weights for ages
  const w18 = 10 + (hash % 15);
  const w25 = 20 + ((hash >> 2) % 20);
  const w35 = 15 + ((hash >> 4) % 15);
  const w45 = 10 + ((hash >> 6) % 15);
  const w55 = 5 + ((hash >> 8) % 10);
  const w65 = 5 + ((hash >> 10) % 10);
  
  const totalWeight = w18 + w25 + w35 + w45 + w55 + w65;
  
  // Distribute 100% proportionally
  const age18 = Math.round((w18 / totalWeight) * 100);
  const age25 = Math.round((w25 / totalWeight) * 100);
  const age35 = Math.round((w35 / totalWeight) * 100);
  const age45 = Math.round((w45 / totalWeight) * 100);
  const age55 = Math.round((w55 / totalWeight) * 100);
  const age65 = 100 - (age18 + age25 + age35 + age45 + age55); // Adjust last one for exact 100%
  
  const ages = [
    { age: "18-24", percentage: age65 < 0 ? 0 : age18 },
    { age: "25-34", percentage: age25 },
    { age: "35-44", percentage: age35 },
    { age: "45-54", percentage: age45 },
    { age: "55-64", percentage: age55 },
    { age: "65+", percentage: age65 < 0 ? 0 : age65 },
  ];

  const mobileBase = 45 + (hash % 35); // 45% to 80%
  const desktopBase = 100 - mobileBase;
  const devices = [
    { name: "Mobile", value: mobileBase },
    { name: "Desktop", value: desktopBase },
  ];

  return { genders, ages, devices };
}

declare global {
  interface Window {
    trends?: {
      embed: {
        renderExploreWidgetTo: (
          container: HTMLDivElement,
          type: string,
          req: any,
          settings: any
        ) => void;
      };
    };
  }
}

const COUNTRY_CODES: Record<string, string> = {
  "Global": "",
  "Brasil": "BR",
  "Peru": "PE",
  "Portugal": "PT",
  "Espanha": "ES",
  "Itália": "IT",
  "Alemanha": "DE",
  "Áustria": "AT",
  "Suíça": "CH",
  "México": "MX",
  "Colômbia": "CO",
  "Estados Unidos": "US",
  "Argentina": "AR",
  "Chile": "CL",
  "Equador": "EC",
  "Bolívia": "BO",
  "Paraguai": "PY",
  "Uruguai": "UY",
  "Venezuela": "VE",
  "República Dominicana": "DO",
  "Panamá": "PA",
  "Costa Rica": "CR",
  "Guatemala": "GT",
  "Honduras": "HN",
  "Reino Unido": "GB",
  "França": "FR",
  "Canadá": "CA",
  "Romênia": "RO",
  "Bulgária": "BG",
  "Polônia": "PL",
  "Chéquia": "CZ",
  "Hungria": "HU",
  "Eslováquia": "SK",
  "Rússia": "RU",
  "Índia": "IN",
  "Japão": "JP",
  "Austrália": "AU",
  "Nova Zelândia": "NZ",
  "África do Sul": "ZA",
  "Nigéria": "NG",
  "Egito": "EG",
  "Marrocos": "MA",
  "Países Baixos": "NL",
  "Suécia": "SE",
  "Noruega": "NO",
  "Dinamarca": "DK",
  "Finlândia": "FI",
  "Bélgica": "BE",
  "Grécia": "GR",
  "Coreia do Sul": "KR",
  "Singapura": "SG",
  "Malásia": "MY",
  "Indonésia": "ID",
  "Tailândia": "TH",
  "Vietnã": "VN",
  "Filipinas": "PH",
  "Taiwan": "TW",
  "Hong Kong": "HK",
  "Emirados Árabes Unidos": "AE",
  "Arábia Saudita": "SA",
  "Quênia": "KE",
  "Israel": "IL",
  "Turquia": "TR",
  "Ucrânia": "UA",
  "Irlanda": "IE"
};

interface WidgetProps {
  keyword: string;
  geo: string;
  timeRange: string;
  type: "TIMESERIES" | "GEO_MAP" | "RELATED_QUERIES" | "RELATED_TOPICS";
}

function GoogleTrendsWidget({ keyword, geo, timeRange, type }: WidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!keyword) return;

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }

    const geoCode = COUNTRY_CODES[geo] || "";
    const timeCode = timeRange === "12m" ? "today 12-m" :
                     timeRange === "30d" ? "today 1-m" :
                     timeRange === "7d" ? "now 7-d" :
                     timeRange;

    const scriptId = "google-trends-embed-loader";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const renderWidget = () => {
      if (window.trends && containerRef.current) {
        try {
          const exploreParams: string[] = [`q=${encodeURIComponent(keyword)}`];
          if (geoCode) {
            exploreParams.push(`geo=${geoCode}`);
          }
          exploreParams.push(`date=${encodeURIComponent(timeCode)}`);
          exploreParams.push(`hl=pt-BR`);
          const exploreQuery = exploreParams.join("&");

          const keywords = keyword.split(",").map(k => k.trim()).filter(Boolean);
          const comparisonItem = keywords.map(kw => ({
            keyword: kw,
            geo: geoCode,
            time: timeCode
          }));

          window.trends.embed.renderExploreWidgetTo(
            containerRef.current,
            type,
            {
              comparisonItem: comparisonItem,
              category: 0,
              property: ""
            },
            {
              exploreQuery,
              guestPath: "https://trends.google.com:443/trends/embed/",
              hl: "pt-BR",
              tz: new Date().getTimezoneOffset()
            }
          );
        } catch (err) {
          console.error("Error rendering Google Trends widget:", err);
        }
      }
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://ssl.gstatic.com/trends_nrtr/3728_RC01/embed_loader.js";
      script.async = true;
      script.onload = renderWidget;
      document.body.appendChild(script);
    } else {
      if (window.trends) {
        renderWidget();
      } else {
        script.addEventListener("load", renderWidget);
      }
    }

    return () => {
      if (script) {
        script.removeEventListener("load", renderWidget);
      }
    };
  }, [keyword, geo, timeRange, type]);

  return (
    <div className="w-full overflow-hidden rounded-xl bg-white p-1 border border-border/20 shadow-inner min-h-[360px]">
      <div ref={containerRef} className="w-full min-h-[350px]" />
    </div>
  );
}

export default function Trends() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateKeyword();

  // Tab State
  const [activeTab, setActiveTab] = useState<string>("termo");

  // Term search states
  const [activeKeywords, setActiveKeywords] = useState<string[]>(["marketing digital"]);
  const [selectedQueryTab, setSelectedQueryTab] = useState<string>("marketing digital");
  const [inlineInput, setInlineInput] = useState("");
  const [showAddInput, setShowAddInput] = useState(false);
  const [geo, setGeo] = useState("Global");
  const [timeRange, setTimeRange] = useState("12m");
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [searchInput, setSearchInput] = useState("");
  const [countrySearch, setCountrySearch] = useState("");

  const activeKeyword = activeKeywords[0] || "";
  const keyword = activeKeywords.join(",");

  useEffect(() => {
    if (activeKeywords.length > 0 && !activeKeywords.includes(selectedQueryTab)) {
      setSelectedQueryTab(activeKeywords[0]);
    }
  }, [activeKeywords]);

  interface KeywordStats {
    keyword: string;
    avgMonthlySearches: number;
    competition: string;
    lowCpc: number;
    highCpc: number;
    avgCpc: number;
    source: string;
  }

  const [keywordStats, setKeywordStats] = useState<KeywordStats[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    if (activeKeywords.length === 0) {
      setKeywordStats([]);
      return;
    }

    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        const kwsParam = activeKeywords.join(",");
        const locationParam = geo === "Global" ? "Brasil" : geo;
        const res = await customFetch<KeywordStats[]>(
          `/api/keywords/stats?keywords=${encodeURIComponent(kwsParam)}&location=${encodeURIComponent(locationParam)}`
        );
        setKeywordStats(res);
      } catch (err) {
        console.error("Failed to load keyword metrics stats:", err);
      } finally {
        setLoadingStats(false);
      }
    };

    fetchStats();
  }, [activeKeywords, geo]);

  // Theme search states
  const [themeInput, setThemeInput] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("");
  const [themeKeywords, setThemeKeywords] = useState<any[]>([]);
  const [loadingTheme, setLoadingTheme] = useState(false);
  const [addingKeywords, setAddingKeywords] = useState<Record<string, boolean>>({});

  // Dr. Cash rank states
  const [drcashRank, setDrcashRank] = useState<any[]>([]);
  const [loadingRank, setLoadingRank] = useState(false);

  const computedTimeRange = timeRange === "custom" ? `${customStartDate} ${customEndDate}` : timeRange;
  const demographics = getDemographicsForKeyword(activeKeyword);
  const normalizeString = (str: string) => 
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filteredCountries = Object.keys(COUNTRY_CODES).filter((c) =>
    normalizeString(c).includes(normalizeString(countrySearch))
  );

  const PRESET_THEMES = [
    { id: "Saúde", label: "Saúde", icon: Heart, description: "Nutrição, fitness, dietas e bem-estar", color: "text-red-500 bg-red-500/10 border-red-500/20" },
    { id: "Tecnologia", label: "Tecnologia", icon: Cpu, description: "IA, desenvolvimento, gadgets e TI", color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
    { id: "Finanças", label: "Finanças", icon: Coins, description: "Investimentos, cartões e economia", color: "text-green-500 bg-green-500/10 border-green-500/20" },
    { id: "Moda", label: "Moda & Beleza", icon: Sparkles, description: "Skincare, cabelo, maquiagem e estilo", color: "text-purple-500 bg-purple-500/10 border-purple-500/20" }
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) {
      toast({
        title: "Palavra-chave inválida",
        description: "Por favor, digite um termo de pesquisa.",
        variant: "destructive"
      });
      return;
    }
    const newKws = searchInput.split(",")
      .map(k => k.trim())
      .filter(k => k && !activeKeywords.includes(k));
      
    if (newKws.length > 0) {
      setActiveKeywords([...activeKeywords, ...newKws].slice(0, 5));
    }
    setSearchInput("");
  };

  const handleGeoChange = (newGeo: string) => {
    setGeo(newGeo);
  };

  const handleTimeRangeChange = (newRange: string) => {
    setTimeRange(newRange);
  };

  const handleEditKeyword = (kw: string) => {
    setActiveKeywords(activeKeywords.filter(k => k !== kw));
    setInlineInput(kw);
    setShowAddInput(true);
  };

  const handleSuggestKeywords = () => {
    if (activeKeywords.length === 0) {
      setActiveKeywords(["marketing digital", "e-commerce", "tráfego pago", "afiliados"].slice(0, 5));
      toast({
        title: "Termos sugeridos",
        description: "Adicionados termos de tendência em marketing digital."
      });
      return;
    }

    const firstKw = activeKeywords[0].toLowerCase();
    if (/\b(?:retox|flex|metonil|diaflex|caps|gel|fit|health|saude|capsula|emagrecer|prost|artic|dor|diabete)\b/i.test(firstKw)) {
      const suggestions = ["Retoxin", "Metonil", "DiaFlex", "Fleboxin"].filter(s => !activeKeywords.includes(s));
      if (suggestions.length > 0) {
        setActiveKeywords([...activeKeywords, ...suggestions].slice(0, 5));
        toast({
          title: "Termos sugeridos",
          description: "Adicionados termos relacionados ao nicho de saúde."
        });
      } else {
        toast({
          title: "Sugestões esgotadas",
          description: "Todos os termos recomendados para este nicho já foram adicionados."
        });
      }
    } else {
      const suggestions = ["inteligência artificial", "chatgpt", "tecnologia", "inovação"].filter(s => !activeKeywords.includes(s));
      if (suggestions.length > 0) {
        setActiveKeywords([...activeKeywords, ...suggestions].slice(0, 5));
        toast({
          title: "Termos sugeridos",
          description: "Adicionados termos relacionados a tecnologia e IA."
        });
      } else {
        toast({
          title: "Sem sugestões adicionais",
          description: "Não há sugestões adicionais para este termo no momento."
        });
      }
    }
  };

  const TAG_COLORS = [
    { bg: "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300", indicator: "bg-blue-500" },
    { bg: "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300", indicator: "bg-red-500" },
    { bg: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300", indicator: "bg-amber-500" },
    { bg: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300", indicator: "bg-emerald-500" },
    { bg: "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300", indicator: "bg-purple-500" }
  ];

  const fetchKeywordsByTheme = async (themeName: string) => {
    setLoadingTheme(true);
    setSelectedTheme(themeName);
    try {
      const data = await customFetch<any[]>(`/api/keywords/top-by-theme?theme=${encodeURIComponent(themeName)}`);
      setThemeKeywords(data || []);
    } catch (err: any) {
      toast({
        title: "Erro ao buscar palavras por tema",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoadingTheme(false);
    }
  };

  const handleThemeSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!themeInput.trim()) {
      toast({
        title: "Tema inválido",
        description: "Por favor, digite um tema para pesquisar.",
        variant: "destructive"
      });
      return;
    }
    fetchKeywordsByTheme(themeInput);
  };

  const handleAddKeyword = async (keywordText: string) => {
    setAddingKeywords(prev => ({ ...prev, [keywordText]: true }));
    createMutation.mutate(
      {
        data: {
          keyword: keywordText,
          location: "Brasil"
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListKeywordsQueryKey() });
          toast({
            title: "Palavra monitorada",
            description: `A palavra-chave "${keywordText}" foi adicionada com sucesso.`
          });
          setAddingKeywords(prev => ({ ...prev, [keywordText]: false }));
        },
        onError: (err: any) => {
          toast({
            title: "Erro ao monitorar",
            description: err.message || "Erro de conexão",
            variant: "destructive"
          });
          setAddingKeywords(prev => ({ ...prev, [keywordText]: false }));
        }
      }
    );
  };

  const handleAnalyzeOnTrends = (keywordText: string) => {
    setSearchInput("");
    setActiveKeywords([keywordText]);
    setSelectedQueryTab(keywordText);
    setActiveTab("termo");
    toast({
      title: "Explorando no Trends",
      description: `Buscando tendências para "${keywordText}"...`
    });
  };

  const fetchDrCashRank = async () => {
    setLoadingRank(true);
    try {
      const data = await customFetch<any[]>("/api/keywords/drcash-rank");
      setDrcashRank(data || []);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar ranking",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoadingRank(false);
    }
  };

  useEffect(() => {
    if (activeTab === "drcash") {
      fetchDrCashRank();
    }
  }, [activeTab]);

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary animate-pulse" /> Trends & Canais de Busca
          </h1>
          <p className="text-muted-foreground mt-1">Dados reais, inteligência geográfica e pesquisa de termos mais buscados por tema</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/40 backdrop-blur-md p-1 border border-border/40 rounded-xl grid grid-cols-3 max-w-xl w-full">
          <TabsTrigger value="termo" className="rounded-lg text-xs md:text-sm font-semibold">Pesquisa por Termo</TabsTrigger>
          <TabsTrigger value="tema" className="rounded-lg text-xs md:text-sm font-semibold">Pesquisa por Tema</TabsTrigger>
          <TabsTrigger value="drcash" className="rounded-lg text-xs md:text-sm font-semibold">Ranking Dr. Cash</TabsTrigger>
        </TabsList>

        <TabsContent value="termo" className="space-y-6">
          {/* New Tag Input Card - Matches the user screenshot */}
          <Card className="rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Confira as tendências de pesquisa
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Adicione até 5 termos para comparar tendências no Google</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveKeywords([]);
                    toast({
                      title: "Filtros limpos",
                      description: "Todos os termos foram removidos."
                    });
                  }}
                  className="rounded-xl h-9 px-4 text-xs font-semibold"
                >
                  Limpar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSuggestKeywords}
                  className="rounded-xl h-9 px-4 text-xs font-semibold flex items-center gap-1.5 bg-muted/80 hover:bg-muted"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Sugerir termos de pesquisa
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-center min-h-[52px] p-2 bg-muted/20 border border-border/30 rounded-xl">
              {activeKeywords.map((kw, index) => {
                const color = TAG_COLORS[index % TAG_COLORS.length];
                return (
                  <div
                    key={kw}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-semibold shadow-sm transition-all animate-in zoom-in-95 duration-150 ${color.bg}`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${color.indicator}`} />
                    <span>{kw}</span>
                    <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-current/15">
                      <button
                        type="button"
                        onClick={() => handleEditKeyword(kw)}
                        className="hover:bg-black/5 dark:hover:bg-white/10 rounded-full p-0.5"
                        title="Editar"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveKeywords(activeKeywords.filter((k) => k !== kw));
                        }}
                        className="hover:bg-black/5 dark:hover:bg-white/10 rounded-full p-0.5 text-destructive hover:text-destructive"
                        title="Excluir"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {showAddInput ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (inlineInput.trim()) {
                      const newKws = inlineInput
                        .split(",")
                        .map((k) => k.trim())
                        .filter((k) => k && !activeKeywords.includes(k));
                      if (newKws.length > 0) {
                        setActiveKeywords([...activeKeywords, ...newKws].slice(0, 5));
                      }
                      setInlineInput("");
                      setShowAddInput(false);
                    }
                  }}
                  className="flex items-center gap-1.5 animate-in slide-in-from-left-2 duration-100"
                >
                  <Input
                    value={inlineInput}
                    onChange={(e) => setInlineInput(e.target.value)}
                    placeholder="Digite o termo e aperte Enter..."
                    className="h-9 w-48 text-xs rounded-xl focus-visible:ring-primary bg-background"
                    autoFocus
                    onBlur={() => {
                      setTimeout(() => setShowAddInput(false), 200);
                    }}
                  />
                </form>
              ) : (
                activeKeywords.length < 5 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddInput(true)}
                    className="h-9 rounded-xl border-dashed flex items-center gap-1.5 text-xs font-semibold bg-transparent"
                  >
                    <Plus className="h-4 w-4" /> Adicionar termo
                  </Button>
                )
              )}
            </div>
          </Card>

          {/* Filters Card under the Tags Card */}
          <div className="flex flex-wrap md:flex-nowrap gap-4 items-center justify-between bg-card/50 backdrop-blur-md p-4 border border-border/40 rounded-2xl">
            <form onSubmit={handleSearch} className="flex gap-2 w-full md:w-auto md:max-w-md shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar termo no Google Trends..."
                  className="pl-9 pr-4 h-10 w-full md:w-64 rounded-xl border-border/80 focus-visible:ring-primary"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" className="rounded-xl h-10 px-4">
                Adicionar
              </Button>
            </form>

            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Localização:</span>
                <Select value={geo} onValueChange={handleGeoChange} onOpenChange={(open) => { if (!open) setCountrySearch(""); }}>
                  <SelectTrigger className="w-40 h-9 rounded-xl border-border/60">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px] overflow-y-auto">
                    <div className="p-2 sticky top-0 bg-popover z-10 border-b border-border/40">
                      <Input
                        placeholder="Pesquisar país..."
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-8 text-xs rounded-lg focus-visible:ring-primary"
                      />
                    </div>
                    {filteredCountries.length > 0 ? (
                      filteredCountries.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))
                    ) : (
                      <div className="p-3 text-xs text-muted-foreground text-center">
                        Nenhum país encontrado
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Período:</span>
                <Select value={timeRange} onValueChange={handleTimeRangeChange}>
                  <SelectTrigger className="w-44 h-9 rounded-xl border-border/60">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12m">Últimos 12 meses</SelectItem>
                    <SelectItem value="30d">Últimos 30 dias</SelectItem>
                    <SelectItem value="7d">Últimos 7 dias</SelectItem>
                    <SelectItem value="custom">Período Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {timeRange === "custom" && (
                <div className="flex items-center gap-1.5 animate-in slide-in-from-top-1 duration-200">
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-9 w-[130px] rounded-xl border-border/60 text-xs px-2"
                  />
                  <span className="text-muted-foreground text-xs">a</span>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-9 w-[130px] rounded-xl border-border/60 text-xs px-2"
                  />
                </div>
              )}
            </div>
          </div>

          {activeKeyword ? (
            <div className="grid gap-6 md:grid-cols-7">
              {/* Interest Over Time */}
              <Card className="md:col-span-7 rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                    Interesse ao longo do tempo para: {activeKeywords.join(", ")}
                  </CardTitle>
                  <CardDescription>Visualização interativa da popularidade de buscas históricas do Google.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <GoogleTrendsWidget
                    keyword={keyword}
                    geo={geo}
                    timeRange={computedTimeRange}
                    type="TIMESERIES"
                  />
                </CardContent>
              </Card>

              {/* Keyword Auction & CPC Metrics Card */}
              <Card className="md:col-span-7 rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)] animate-in fade-in duration-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Coins className="h-5 w-5 text-primary" /> Métricas de Leilão e CPC (Google Ads)
                      </CardTitle>
                      <CardDescription>
                        Disputa do leilão, volume estimado de buscas mensais e custo por clique (CPC) em Reais.
                      </CardDescription>
                    </div>
                    {loadingStats && <Loader2 className="h-5 w-5 text-primary animate-spin" />}
                  </div>
                </CardHeader>
                <CardContent className="pt-2">
                  {loadingStats && keywordStats.length === 0 ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="h-6 w-6 text-primary animate-spin mr-2" />
                      <span className="text-sm text-muted-foreground font-medium">Carregando dados do leilão...</span>
                    </div>
                  ) : keywordStats.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-border/45 bg-muted/10">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-border/40 bg-muted/20 text-xs font-semibold text-muted-foreground uppercase">
                            <th className="p-3">Palavra-chave</th>
                            <th className="p-3 text-center">Buscas Mensais</th>
                            <th className="p-3 text-center">Disputa (Leilão)</th>
                            <th className="p-3 text-center">CPC Mínimo</th>
                            <th className="p-3 text-center">CPC Médio</th>
                            <th className="p-3 text-center">CPC Máximo</th>
                            <th className="p-3 text-right">Fonte</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-border/25">
                          {keywordStats.map((stat, index) => {
                            const color = TAG_COLORS[index % TAG_COLORS.length];
                            
                            // Competition color and badge logic
                            let compBadgeColor = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                            if (stat.competition.toLowerCase() === "alta") {
                              compBadgeColor = "bg-red-500/10 text-red-500 border-red-500/20";
                            } else if (stat.competition.toLowerCase() === "média" || stat.competition.toLowerCase() === "media") {
                              compBadgeColor = "bg-amber-500/10 text-amber-500 border-amber-500/20";
                            }

                            return (
                              <tr key={stat.keyword} className="hover:bg-muted/15 transition-colors">
                                <td className="p-3 font-semibold flex items-center gap-2">
                                  <span className={`w-2.5 h-2.5 rounded-full ${color.indicator}`} />
                                  <span>{stat.keyword}</span>
                                </td>
                                <td className="p-3 text-center font-medium text-foreground/80">
                                  {stat.avgMonthlySearches ? Number(stat.avgMonthlySearches).toLocaleString("pt-BR") : "-"}
                                </td>
                                <td className="p-3 text-center">
                                  <Badge variant="outline" className={`rounded-lg px-2.5 py-0.5 font-semibold uppercase text-[10px] ${compBadgeColor}`}>
                                    {stat.competition}
                                  </Badge>
                                </td>
                                <td className="p-3 text-center font-bold text-foreground/70">
                                  {stat.lowCpc ? `R$ ${Number(stat.lowCpc).toFixed(2).replace(".", ",")}` : "R$ 0,00"}
                                </td>
                                <td className="p-3 text-center font-bold text-primary">
                                  {stat.avgCpc ? `R$ ${Number(stat.avgCpc).toFixed(2).replace(".", ",")}` : "R$ 0,00"}
                                </td>
                                <td className="p-3 text-center font-bold text-foreground/90">
                                  {stat.highCpc ? `R$ ${Number(stat.highCpc).toFixed(2).replace(".", ",")}` : "R$ 0,00"}
                                </td>
                                <td className="p-3 text-right">
                                  <span className="text-[11px] font-semibold text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md uppercase border border-border/10">
                                    {stat.source === "google-keyword-planner" ? "Google Ads" : stat.source === "gemini-ai" ? "Gemini IA" : "Fallback"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-6 text-center text-muted-foreground text-sm">
                      Nenhuma métrica de leilão disponível para os termos ativos.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Interest by Region */}
              <Card className="md:col-span-7 rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" /> Interesse por Região
                  </CardTitle>
                  <CardDescription>Distribuição de buscas nos principais mercados geográficos do Google.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <GoogleTrendsWidget
                    keyword={keyword}
                    geo={geo}
                    timeRange={computedTimeRange}
                    type="GEO_MAP"
                  />
                </CardContent>
              </Card>

              {/* Related Queries Card with Tabs */}
              <Card className="md:col-span-7 rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)] animate-in fade-in duration-200">
                <CardHeader className="pb-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-primary" /> Consultas Relacionadas
                      </CardTitle>
                      <CardDescription>Termos relacionados que os usuários pesquisaram junto com o termo selecionado.</CardDescription>
                    </div>

                    {/* Tab triggers for each active keyword */}
                    {activeKeywords.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 p-1 bg-muted/40 border border-border/25 rounded-xl">
                        {activeKeywords.map((kw, index) => {
                          const color = TAG_COLORS[index % TAG_COLORS.length];
                          const isSelected = selectedQueryTab === kw;
                          return (
                            <button
                              key={kw}
                              type="button"
                              onClick={() => setSelectedQueryTab(kw)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                isSelected
                                  ? `${color.bg} shadow-sm border`
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <span className={`w-2 h-2 rounded-full ${color.indicator}`} />
                              {kw}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-2">
                  {selectedQueryTab ? (
                    <GoogleTrendsWidget
                      key={selectedQueryTab} // Forces remount and new load when tab changes
                      keyword={selectedQueryTab}
                      geo={geo}
                      timeRange={computedTimeRange}
                      type="RELATED_QUERIES"
                    />
                  ) : (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                      Selecione ou adicione um termo para carregar consultas relacionadas.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="border border-dashed rounded-2xl flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <AlertCircle className="h-10 w-10 text-muted-foreground/60 mb-2" />
              <p className="font-medium text-sm">Pesquise por uma palavra-chave acima para carregar as tendências do Google Trends</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tema" className="space-y-6">
          <div className="bg-card/50 backdrop-blur-md p-6 border border-border/40 rounded-2xl space-y-6 shadow-[0_8px_30px_rgba(0,0,0,0.15)]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Termos mais buscados por Canal/Tema</h3>
                <p className="text-sm text-muted-foreground">Selecione ou filtre um nicho para exibir os títulos e palavras de maior relevância</p>
              </div>

              <form onSubmit={handleThemeSearch} className="flex gap-2 w-full md:w-auto md:max-w-md shrink-0">
                <div className="relative flex-1">
                  <BookOpen className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filtrar por tema (ex: imóveis, finanças)..."
                    className="pl-9 pr-4 h-10 w-full md:w-64 rounded-xl border-border/80 focus-visible:ring-primary"
                    value={themeInput}
                    onChange={(e) => setThemeInput(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={loadingTheme} className="rounded-xl h-10 px-4 flex items-center gap-1.5">
                  {loadingTheme ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Filtrar
                </Button>
              </form>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PRESET_THEMES.map((theme) => {
                const IconComponent = theme.icon;
                const isSelected = selectedTheme.toLowerCase() === theme.id.toLowerCase();
                return (
                  <button
                    key={theme.id}
                    onClick={() => {
                      setThemeInput(theme.label);
                      fetchKeywordsByTheme(theme.id);
                    }}
                    className={`flex flex-col items-start p-4 text-left border rounded-xl transition-all hover:scale-[1.02] hover:shadow-md ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border/60 bg-card/80 hover:bg-card"
                    }`}
                  >
                    <div className={`p-2 rounded-lg mb-3 ${theme.color}`}>
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <span className="font-semibold text-sm text-foreground">{theme.label}</span>
                    <span className="text-xs text-muted-foreground mt-1 line-clamp-1">{theme.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedTheme && (
            <Card className="rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)] overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold text-foreground flex items-center justify-between">
                  <span>Palavras mais buscadas em &quot;{selectedTheme}&quot;</span>
                  {themeKeywords.length > 0 && !loadingTheme && (
                    <Badge variant="secondary" className="font-normal text-xs rounded-lg">
                      {themeKeywords.length} termos
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Estimativas geradas dinamicamente com base nas principais tendências de busca do nicho no Brasil.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {loadingTheme ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-4">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground font-medium animate-pulse">Analisando tendências do tema com Inteligência Artificial...</p>
                  </div>
                ) : themeKeywords.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border/40 text-xs font-semibold text-muted-foreground uppercase">
                          <th className="py-3 px-4">Termo / Título</th>
                          <th className="py-3 px-4">Volume de Busca</th>
                          <th className="py-3 px-4">Concorrência</th>
                          <th className="py-3 px-4">CPC Médio</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {themeKeywords.map((item) => {
                          const isAdding = addingKeywords[item.keyword] || false;
                          
                          // Determine color badge for competition
                          let compBadge = null;
                          switch (item.competition.toLowerCase()) {
                            case "baixa":
                              compBadge = <Badge variant="outline" className="text-green-500 border-green-500/20 bg-green-500/10 hover:bg-green-500/10">Baixa</Badge>;
                              break;
                            case "média":
                            case "media":
                              compBadge = <Badge variant="outline" className="text-yellow-500 border-yellow-500/20 bg-yellow-500/10 hover:bg-yellow-500/10">Média</Badge>;
                              break;
                            case "alta":
                              compBadge = <Badge variant="outline" className="text-red-500 border-red-500/20 bg-red-500/10 hover:bg-red-500/10">Alta</Badge>;
                              break;
                            default:
                              compBadge = <Badge variant="outline">{item.competition}</Badge>;
                          }

                          // Relative volume representation for mini-progress bar
                          const maxVolume = Math.max(...themeKeywords.map(k => k.searchVolume), 1);
                          const volumePercentage = Math.round((item.searchVolume / maxVolume) * 100);

                          return (
                            <tr key={item.keyword} className="group hover:bg-muted/40 transition-colors">
                              <td className="py-3.5 px-4">
                                <span className="font-semibold text-foreground text-sm block">{item.keyword}</span>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="space-y-1.5 w-48">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-foreground">{item.searchVolume.toLocaleString("pt-BR")}</span>
                                    <span className="text-muted-foreground">{volumePercentage}%</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                                    <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${volumePercentage}%` }} />
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">{compBadge}</td>
                              <td className="py-3.5 px-4">
                                <span className="font-mono text-sm text-foreground">
                                  {item.cpc ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.cpc) : "R$ 0,00"}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAnalyzeOnTrends(item.keyword)}
                                    className="rounded-lg h-8 text-xs font-medium border-border/80 hover:bg-primary/5 hover:text-primary transition-all duration-200"
                                  >
                                    <TrendingUp className="h-3.5 w-3.5 mr-1" />
                                    Analisar no Trends
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    disabled={isAdding}
                                    onClick={() => handleAddKeyword(item.keyword)}
                                    className="rounded-lg h-8 text-xs font-medium transition-all duration-200 shadow-sm"
                                  >
                                    {isAdding ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        Monitorar
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                    <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
                    <p className="font-medium text-sm">Nenhuma palavra-chave encontrada para o tema informado.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="drcash" className="space-y-6">
          <Card className="rounded-2xl bg-card/50 backdrop-blur-lg border border-border/40 shadow-[0_8px_30px_rgba(0,0,0,0.15)] overflow-hidden">
            <CardHeader className="pb-2 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" /> Ranking Dr. Cash - Top 20 Mais Procurados
                </CardTitle>
                <CardDescription>
                  Pesquisas estimadas por nome de produto e nicho integrados na rede do Dr. Cash no Brasil.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loadingRank}
                onClick={fetchDrCashRank}
                className="rounded-xl flex items-center gap-1.5 self-start md:self-auto"
              >
                {loadingRank ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                Atualizar Rank
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              {loadingRank ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground font-medium animate-pulse">Obtendo produtos e calculando métricas de buscas...</p>
                </div>
              ) : drcashRank.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border/40 text-xs font-semibold text-muted-foreground uppercase">
                        <th className="py-3 px-4 w-16 text-center">Rank</th>
                        <th className="py-3 px-4">Produto</th>
                        <th className="py-3 px-4 text-center">País</th>
                        <th className="py-3 px-4">Categoria / Nicho</th>
                        <th className="py-3 px-4">Volume (Últimos 30 dias)</th>
                        <th className="py-3 px-4 text-center">Tendência</th>
                        <th className="py-3 px-4">Concorrência</th>
                        <th className="py-3 px-4">CPC Médio</th>
                        <th className="py-3 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {drcashRank.map((item) => {
                        const isAdding = addingKeywords[item.name] || false;
                        
                        // Competition badge
                        let compBadge = null;
                        switch (item.competition.toLowerCase()) {
                          case "baixa":
                            compBadge = <Badge variant="outline" className="text-green-500 border-green-500/20 bg-green-500/10 hover:bg-green-500/10">Baixa</Badge>;
                            break;
                          case "média":
                          case "media":
                            compBadge = <Badge variant="outline" className="text-yellow-500 border-yellow-500/20 bg-yellow-500/10 hover:bg-yellow-500/10">Média</Badge>;
                            break;
                          case "alta":
                            compBadge = <Badge variant="outline" className="text-red-500 border-red-500/20 bg-red-500/10 hover:bg-red-500/10">Alta</Badge>;
                            break;
                          default:
                            compBadge = <Badge variant="outline">{item.competition}</Badge>;
                        }

                        // Country details helper
                        const getGeoDetails = (code: string) => {
                          const geoMap: Record<string, { name: string; flag: string }> = {
                            BR: { name: "Brasil", flag: "🇧🇷" },
                            ES: { name: "Espanha", flag: "🇪🇸" },
                            IT: { name: "Itália", flag: "🇮🇹" },
                            PT: { name: "Portugal", flag: "🇵🇹" },
                            DE: { name: "Alemanha", flag: "🇩🇪" },
                            MX: { name: "México", flag: "🇲🇽" },
                            BG: { name: "Bulgária", flag: "🇧🇬" },
                            CO: { name: "Colômbia", flag: "🇨🇴" },
                            DO: { name: "República Dominicana", flag: "🇩🇴" },
                            RO: { name: "Romênia", flag: "🇷🇴" },
                            RU: { name: "Rússia", flag: "🇷🇺" },
                            PL: { name: "Polônia", flag: "🇵🇱" },
                            CZ: { name: "Chéquia", flag: "🇨🇿" },
                            HU: { name: "Hungria", flag: "🇭🇺" },
                            SK: { name: "Eslováquia", flag: "🇸🇰" },
                            US: { name: "EUA", flag: "🇺🇸" }
                          };
                          return geoMap[code.toUpperCase()] || { name: code, flag: "🌐" };
                        };

                        // Relative volume calculation
                        const maxVol = Math.max(...drcashRank.map(r => r.searchVolume), 1);
                        const volPct = Math.round((item.searchVolume / maxVol) * 100);

                        // Trophy coloring for top 3
                        let rankCell = null;
                        if (item.rank === 1) {
                          rankCell = <span title="1º Lugar" className="block text-center"><Trophy className="h-5 w-5 text-yellow-500 mx-auto filter drop-shadow" /></span>;
                        } else if (item.rank === 2) {
                          rankCell = <span title="2º Lugar" className="block text-center"><Trophy className="h-5 w-5 text-slate-400 mx-auto filter drop-shadow" /></span>;
                        } else if (item.rank === 3) {
                          rankCell = <span title="3º Lugar" className="block text-center"><Trophy className="h-5 w-5 text-amber-600 mx-auto filter drop-shadow" /></span>;
                        } else {
                          rankCell = <span className="font-semibold text-muted-foreground text-sm block text-center">{item.rank}</span>;
                        }

                        // Trend display
                        const isPositiveTrend = item.trend >= 0;
                        const trendColor = isPositiveTrend ? "text-green-600 bg-green-500/10 border-green-500/20" : "text-red-600 bg-red-500/10 border-red-500/20";

                        return (
                          <tr key={item.id} className="group hover:bg-muted/40 transition-colors">
                            <td className="py-3.5 px-4 text-center">{rankCell}</td>
                            <td className="py-3.5 px-4">
                              <span className="font-semibold text-foreground text-sm block">{item.name}</span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex gap-1.5 justify-center flex-wrap">
                                {item.geo && Array.isArray(item.geo) ? (
                                  item.geo.map((g: string) => {
                                    const details = getGeoDetails(g);
                                    return (
                                      <Badge key={g} variant="outline" className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border-primary/20 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1" title={details.name}>
                                        <span>{details.flag}</span>
                                        <span>{details.name}</span>
                                      </Badge>
                                    );
                                  })
                                ) : (
                                  <span className="text-muted-foreground text-xs">-</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <Badge variant="secondary" className="font-normal text-xs rounded-lg">
                                {item.category}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="space-y-1.5 w-48">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-foreground">{item.searchVolume.toLocaleString("pt-BR")}</span>
                                  <span className="text-muted-foreground">{volPct}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                                  <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: `${volPct}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              {item.trend !== undefined && item.trend !== null ? (
                                <Badge variant="outline" className={`text-xs font-semibold px-2 py-0.5 rounded ${trendColor}`}>
                                  {isPositiveTrend ? "↑" : "↓"} {Math.abs(item.trend)}%
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">-</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4">{compBadge}</td>
                            <td className="py-3.5 px-4">
                              <span className="font-mono text-sm text-foreground">
                                {item.cpc ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(item.cpc) : "$0.00"}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleAnalyzeOnTrends(item.name)}
                                  className="rounded-lg h-8 text-xs font-medium border-border/80 hover:bg-primary/5 hover:text-primary transition-all duration-200"
                                >
                                  <TrendingUp className="h-3.5 w-3.5 mr-1" />
                                  Analisar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="default"
                                  disabled={isAdding}
                                  onClick={() => handleAddKeyword(item.name)}
                                  className="rounded-lg h-8 text-xs font-medium transition-all duration-200 shadow-sm"
                                >
                                  {isAdding ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <>
                                      <Plus className="h-3.5 w-3.5 mr-1" />
                                      Monitorar
                                    </>
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
                  <p className="font-medium text-sm">Nenhum produto do Dr. Cash foi encontrado ou carregado.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
