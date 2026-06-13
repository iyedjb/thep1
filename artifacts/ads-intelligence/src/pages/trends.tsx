import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, TrendingUp, Globe, MapPin, Sparkles, AlertCircle } from "lucide-react";

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

    const geoCode = geo === "Global" ? "" : geo === "Brasil" ? "BR" : geo === "Portugal" ? "PT" : geo === "Estados Unidos" ? "US" : "";
    const timeCode = timeRange === "12m" ? "today 12-m" : timeRange === "30d" ? "today 1-m" : timeRange === "7d" ? "now 7-d" : "today 12-m";

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
          const exploreQuery = exploreParams.join("&");

          window.trends.embed.renderExploreWidgetTo(
            containerRef.current,
            type,
            {
              comparisonItem: [{ keyword, geo: geoCode, time: timeCode }],
              category: 0,
              property: ""
            },
            {
              exploreQuery,
              guestPath: "https://trends.google.com:443/trends/embed/"
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
    <div className="w-full overflow-hidden rounded-xl bg-white p-1 border border-border/20 shadow-inner flex items-center justify-center min-h-[360px]">
      <div ref={containerRef} className="w-full min-h-[350px]" />
    </div>
  );
}

export default function Trends() {
  const { toast } = useToast();
  
  const [keyword, setKeyword] = useState("marketing digital");
  const [geo, setGeo] = useState("Global");
  const [timeRange, setTimeRange] = useState("12m");
  const [searchInput, setSearchInput] = useState("marketing digital");
  const [activeKeyword, setActiveKeyword] = useState("marketing digital");

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
    setActiveKeyword(searchInput);
    setKeyword(searchInput);
  };

  const handleGeoChange = (newGeo: string) => {
    setGeo(newGeo);
  };

  const handleTimeRangeChange = (newRange: string) => {
    setTimeRange(newRange);
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary animate-pulse" /> Google Trends Oficial
          </h1>
          <p className="text-muted-foreground mt-1">Dados reais e interativos diretamente da base do Google</p>
        </div>

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
            Pesquisar
          </Button>
        </form>
      </div>

      {/* Filters Card */}
      <div className="flex flex-wrap gap-4 items-center bg-white/50 backdrop-blur-md p-4 border border-border/60 rounded-2xl">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Localização:</span>
          <Select value={geo} onValueChange={handleGeoChange}>
            <SelectTrigger className="w-40 h-9 rounded-xl border-border/60">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Global">Global</SelectItem>
              <SelectItem value="Brasil">Brasil</SelectItem>
              <SelectItem value="Portugal">Portugal</SelectItem>
              <SelectItem value="Estados Unidos">Estados Unidos</SelectItem>
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
            </SelectContent>
          </Select>
        </div>
      </div>

      {activeKeyword ? (
        <div className="grid gap-6 md:grid-cols-7">
          {/* Interest Over Time */}
          <Card className="md:col-span-4 rounded-2xl bg-white/50 backdrop-blur-lg border border-white/60 shadow-[0_8px_30px_rgba(100,120,255,0.02)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                Interesse ao longo do tempo para &quot;{activeKeyword}&quot;
              </CardTitle>
              <CardDescription>Visualização interativa da popularidade de buscas históricas do Google.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <GoogleTrendsWidget
                keyword={activeKeyword}
                geo={geo}
                timeRange={timeRange}
                type="TIMESERIES"
              />
            </CardContent>
          </Card>

          {/* Interest by Region */}
          <Card className="md:col-span-3 rounded-2xl bg-white/50 backdrop-blur-lg border border-white/60 shadow-[0_8px_30px_rgba(100,120,255,0.02)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" /> Interesse por Região
              </CardTitle>
              <CardDescription>Distribuição de buscas nos principais mercados geográficos do Google.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <GoogleTrendsWidget
                keyword={activeKeyword}
                geo={geo}
                timeRange={timeRange}
                type="GEO_MAP"
              />
            </CardContent>
          </Card>

          {/* Related Queries */}
          <Card className="md:col-span-7 rounded-2xl bg-white/50 backdrop-blur-lg border border-white/60 shadow-[0_8px_30px_rgba(100,120,255,0.02)]">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" /> Consultas Relacionadas
              </CardTitle>
              <CardDescription>Termos relacionados que os usuários pesquisaram junto com esta palavra-chave.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <GoogleTrendsWidget
                keyword={activeKeyword}
                geo={geo}
                timeRange={timeRange}
                type="RELATED_QUERIES"
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border border-dashed rounded-2xl flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <AlertCircle className="h-10 w-10 text-muted-foreground/60 mb-2" />
          <p className="font-medium text-sm">Pesquise por uma palavra-chave acima para carregar as tendências do Google Trends</p>
        </Card>
      )}
    </div>
  );
}
