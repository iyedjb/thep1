import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Download,
  ExternalLink,
  Copy,
  RefreshCw,
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  Code,
  ArrowRight,
  ShieldCheck,
  Link,
  Loader2,
  Check,
  Trash2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Globe,
  Search,
  Zap,
  Layout,
  Layers,
} from "lucide-react";

type Step = "form" | "generating" | "done" | "actions";
type View = "create" | "websites";

interface SavedWebsite {
  id: string;
  referenceUrl?: string;
  destinationUrl: string;
  scripts: string[];
  generatedHtml: string;
  publishedUrl: string;
  fileName: string;
  status: "active" | "paused" | "local";
  createdAt: string;
  popupLanguage?: string;
  productName?: string;
  productHeadline?: string;
  productDescription?: string;
  productCategory?: string;
  ctaText?: string;
  supportEmail?: string;
  apiToken?: string;
  streamCode?: string;
  selectedOption?: "a" | "b";
  thankYouHtml?: string;
  thankYouFileName?: string;
}

export default function Creator() {
  const { toast } = useToast();

  const [activeView, setActiveView] = useState<View>("create");
  const [searchTerm, setSearchTerm] = useState("");

  const [referenceUrl, setReferenceUrl] = useState("");
  const [rawHtml, setRawHtml] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [scripts, setScripts] = useState<string[]>([""]);
  const [popupLanguage, setPopupLanguage] = useState("auto");
  const [productName, setProductName] = useState("");
  const [productHeadline, setProductHeadline] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productCategory, setProductCategory] = useState("Saúde & Bem-estar");
  const [ctaText, setCtaText] = useState("Ir para o Site Oficial");
  const [supportEmail, setSupportEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [streamCode, setStreamCode] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("./Obrigado.html");
  const [designSummary, setDesignSummary] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedOption, setSelectedOption] = useState<"a" | "b">("a");

  const [step, setStep] = useState<Step>("form");
  const [generatingMessage, setGeneratingMessage] = useState("Criando base do redirecionador...");

  const [generatedHtml, setGeneratedHtml] = useState("");
  const [thankYouHtml, setThankYouHtml] = useState("");
  const [thankYouFileName, setThankYouFileName] = useState("");
  const [currentWebsiteId, setCurrentWebsiteId] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const [savedWebsites, setSavedWebsites] = useState<SavedWebsite[]>([]);

  useEffect(() => {
    const list = localStorage.getItem("saved_bridges");
    if (list) {
      try { setSavedWebsites(JSON.parse(list)); } catch (_) {}
    }

    const drcashLander = localStorage.getItem("drcash_selected_lander");
    if (drcashLander) {
      setReferenceUrl(drcashLander);
      localStorage.removeItem("drcash_selected_lander");
      toast({ title: "Oferta Carregada ✅", description: "A Landing Page do Dr. Cash foi inserida no link de destino." });
    }

    const fetchDefaultToken = async () => {
      try {
        const token = localStorage.getItem("ads_token");
        const res = await fetch("/api/drcash/token", {
          headers: { "Authorization": token ? `Bearer ${token}` : "" }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) setApiToken(data.token);
        }
      } catch (err) { console.error("Erro ao buscar token Dr. Cash", err); }
    };
    fetchDefaultToken();
  }, []);

  const saveWebsites = (newList: SavedWebsite[]) => {
    setSavedWebsites(newList);
    
    let listToSave = newList;
    let success = false;
    let attempts = 0;
    
    while (!success && attempts < newList.length) {
      try {
        localStorage.setItem("saved_bridges", JSON.stringify(listToSave));
        success = true;
      } catch (err: any) {
        if (err.name === "QuotaExceededError" || err.message?.toLowerCase().includes("quota")) {
          // Evict the oldest item with non-empty HTML to free up space
          let clearedSomething = false;
          for (let i = listToSave.length - 1; i >= 0; i--) {
            if (listToSave[i].generatedHtml) {
              listToSave = listToSave.map((s, idx) => idx === i ? { ...s, generatedHtml: "" } : s);
              clearedSomething = true;
              break;
            }
          }
          if (!clearedSomething) {
            break;
          }
          attempts++;
        } else {
          break;
        }
      }
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!referenceUrl.trim()) {
      toast({ title: "Página de referência obrigatória", description: "Informe a landing page que a IA deve pesquisar para copiar design.", variant: "destructive" });
      return;
    }
    if (!destinationUrl.trim()) {
      toast({ title: "Link de destino obrigatório", description: "Por favor, insira a URL final para onde o tráfego será direcionado.", variant: "destructive" });
      return;
    }

    let targetUrl = destinationUrl.trim();
    if (!/^https?:\/\//i.test(targetUrl)) { targetUrl = "https://" + targetUrl; setDestinationUrl(targetUrl); }
    let sourceUrl = referenceUrl.trim();
    if (!/^https?:\/\//i.test(sourceUrl)) { sourceUrl = "https://" + sourceUrl; setReferenceUrl(sourceUrl); }

    const token = localStorage.getItem("ads_token");
    const combinedAiTags = scripts.filter(s => s.trim() !== "").join("\n    ");

    setStep("generating");
    setGeneratingMessage("🔍 Pesquisando design e idioma com IA...");
    setGeneratedHtml(""); setPublishedUrl(""); setDesignSummary("");

    setTimeout(() => setGeneratingMessage("🧠 Treinando contexto com skills de presell e upsell..."), 900);
    setTimeout(() => setGeneratingMessage("⚡ Gerando HTML world-class com Groq GPT-OSS 120B..."), 1800);

    try {
      const response = await fetch("/api/generate-bridge-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
        body: JSON.stringify({
          referenceUrl: sourceUrl, affiliateUrl: targetUrl, trackingTags: combinedAiTags,
          productHint: productName, apiToken, streamCode, thankYouUrl,
          network: "Dr.Cash", selectedOption, popupLanguage, rawHtml
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao gerar página com IA.");

      const html = data.html || "";
      setGeneratedHtml(html);
      setDesignSummary(data.designSummary || "");

      const tyHtml = data.thankYouHtml || "";
      const tyFileName = data.thankYouFileName || "";
      setThankYouHtml(tyHtml);
      setThankYouFileName(tyFileName);

      const newId = Date.now().toString();
      setCurrentWebsiteId(newId);

      const newSite: SavedWebsite = {
        id: newId, referenceUrl: sourceUrl, destinationUrl: targetUrl,
        scripts: scripts.filter(s => s.trim() !== ""), generatedHtml: html,
        publishedUrl: "", fileName: "", status: "local",
        createdAt: new Date().toLocaleDateString("pt-BR"),
        popupLanguage: data.language || popupLanguage, productName: data.productName || productName,
        productHeadline, productDescription: data.designSummary || productDescription,
        productCategory, ctaText, supportEmail, apiToken, streamCode, selectedOption,
        thankYouHtml: tyHtml, thankYouFileName: tyFileName
      };
      saveWebsites([newSite, ...savedWebsites]);
      setRawHtml(""); // Reset pasted HTML on success
      setGeneratingMessage("✅ Finalizando e salvando no histórico...");
      setStep("done");
      setTimeout(() => {
        setStep("actions");
        toast({ title: "🚀 Página Gerada com IA!", description: "HTML world-class criado com base na página pesquisada." });
      }, 900);
    } catch (err: any) {
      setStep("form");
      toast({ title: "Erro ao gerar com IA", description: err.message, variant: "destructive" });
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([generatedHtml], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      let domain = "presell";
      try { domain = new URL(destinationUrl).hostname.replace("www.", "").split(".")[0]; } catch (_) {}
      a.download = `redirect-${domain}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download Iniciado ⬇️", description: "O arquivo HTML foi baixado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro ao baixar arquivo", description: err.message, variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setPublishedUrl("");
    let domain = "presell";
    try { domain = new URL(destinationUrl).hostname.replace("www.", "").split(".")[0]; } catch (_) {}
    const fileName = `presell-${domain}-${Date.now()}.html`;
    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch("/api/publish-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ htmlContent: generatedHtml, fileName, thankYouHtml, thankYouFileName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao publicar no servidor.");
      const updatedList = savedWebsites.map(site =>
        site.id === currentWebsiteId ? { ...site, publishedUrl: data.url, fileName, thankYouFileName, status: "active" as const } : site
      );
      saveWebsites(updatedList);
      setPublishedUrl(data.url);
      toast({ title: "🎉 Página Publicada!", description: "Sua página de redirecionamento está online." });
    } catch (err: any) {
      toast({ title: "Erro de Publicação", description: err.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const downloadSavedWebsite = async (site: SavedWebsite) => {
    let html = site.generatedHtml;
    
    // Fallback: If local storage has cleared the cached html, try to fetch it from the published server URL
    if (!html && site.publishedUrl) {
      try {
        const res = await fetch(site.publishedUrl);
        if (res.ok) {
          html = await res.text();
        }
      } catch (_) {}
    }
    
    if (!html) {
      toast({
        title: "Conteúdo Indisponível 🗃️",
        description: "O cache local desta página foi limpo para poupar espaço. Use 'Reutilizar / Editar' para gerá-la novamente.",
        variant: "destructive"
      });
      return;
    }
    
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    let domain = "presell";
    try { domain = new URL(site.destinationUrl).hostname.replace("www.", "").split(".")[0]; } catch (_) {}
    a.download = `redirect-${domain}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Download Iniciado", description: "O arquivo foi baixado com sucesso." });
  };

  const copyPublishedLink = (url: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${url}`);
    toast({ title: "Link Copiado! 📋", description: "Copiado para a área de transferência." });
  };

  const toggleWebsiteStatus = async (site: SavedWebsite) => {
    let targetHtml = "";
    const isCurrentlyActive = site.status === "active";
    const newStatus = isCurrentlyActive ? "paused" : "active";
    const pausedTemplate = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Página Pausada</title><style>body{background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.c{text-align:center;padding:24px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);max-width:400px}h1{font-size:20px;font-weight:700;margin:0 0 8px}p{font-size:13px;color:#94a3b8;margin:0}</style></head><body><div class="c"><h1>Página Pausada</h1><p>Este redirecionamento está temporariamente inativo.</p></div></body></html>`;
    
    if (isCurrentlyActive) {
      targetHtml = pausedTemplate;
    } else {
      targetHtml = site.generatedHtml;
      
      // Fallback: If cache was evicted, try to restore from the published page on server before we paused it
      if (!targetHtml && site.publishedUrl) {
        try {
          const res = await fetch(site.publishedUrl);
          if (res.ok) {
            targetHtml = await res.text();
          }
        } catch (_) {}
      }
    }
    
    if (!targetHtml) {
      toast({
        title: "Não foi possível ativar 🚫",
        description: "O código-fonte original não está disponível no cache local. Clique em 'Reutilizar / Editar' para gerá-lo de novo.",
        variant: "destructive"
      });
      return;
    }
    
    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch("/api/publish-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ htmlContent: targetHtml, fileName: site.fileName })
      });
      if (!response.ok) throw new Error("Erro ao atualizar status no servidor.");
      const updatedList = savedWebsites.map(s =>
        s.id === site.id ? { ...s, status: newStatus as "active" | "paused" } : s
      );
      saveWebsites(updatedList);
      toast({ title: isCurrentlyActive ? "Página Pausada ⏸️" : "Página Ativada ▶️" });
    } catch (err: any) {
      toast({ title: "Erro ao alterar status", description: err.message, variant: "destructive" });
    }
  };

  const deleteWebsite = async (site: SavedWebsite) => {
    if (site.status === "active" || site.status === "paused") {
      const token = localStorage.getItem("ads_token");
      try {
        await fetch("/api/delete-bridge", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
          body: JSON.stringify({ fileName: site.fileName, thankYouFileName: site.thankYouFileName })
        });
      } catch (_) {}
    }
    saveWebsites(savedWebsites.filter(s => s.id !== site.id));
    toast({ title: "Presell Excluída 🗑️", description: "O redirecionador foi excluído com sucesso." });
  };

  const getTagCount = () => scripts.filter(s => s.trim() !== "").length;
  const handleBackToEdit = () => { setStep("form"); setPublishedUrl(""); };

  const filteredWebsites = savedWebsites.filter((site) => {
    const term = searchTerm.toLowerCase();
    return site.destinationUrl.toLowerCase().includes(term) ||
      (site.referenceUrl || "").toLowerCase().includes(term) ||
      (site.productName || "").toLowerCase().includes(term);
  });

  return (
    <div className="min-h-[calc(100vh-80px)] bg-background">
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/2 -right-20 w-[400px] h-[400px] rounded-full bg-violet-500/4 blur-[100px]" />
        <div className="absolute -bottom-20 left-1/3 w-[350px] h-[350px] rounded-full bg-primary/4 blur-[80px]" />
      </div>

      <div className="relative z-10 max-w-[1440px] mx-auto px-4 md:px-8 py-8 space-y-8">

        {/* ── Hero Header ─────────────────────────────────────── */}
        {step !== "generating" && step !== "done" && (
          <div className="animate-slide-up">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 mb-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-primary">AI Presell Creator</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
                  <span className="gradient-text">Presell com IA</span>
                  <Sparkles className="h-7 w-7 text-primary animate-pulse shrink-0" />
                </h1>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-lg">
                  Gere páginas de redirecionamento inteligentes com pesquisa de design por IA, detecção automática de idioma e código limpo e otimizado.
                </p>
              </div>

              {/* Mobile tab switcher */}
              <div className="flex bg-card border border-border p-1 rounded-xl gap-1 w-full md:w-auto md:min-w-[260px] lg:hidden shadow-xs">
                {(["create", "websites"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setActiveView(v); if (v === "create") setStep("form"); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${
                      activeView === v
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === "create" ? "⚡ Nova Presell" : `🗂️ Histórico (${savedWebsites.length})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { icon: Layers, label: "Presells Criadas", value: savedWebsites.length, color: "text-primary" },
                { icon: Globe, label: "Ativas Online", value: savedWebsites.filter(s => s.status === "active").length, color: "text-emerald-500" },
                { icon: Zap, label: "Pixels Injetados", value: savedWebsites.reduce((acc, s) => acc + s.scripts.length, 0), color: "text-amber-500" },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="glass-card rounded-xl p-3 md:p-4 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-card flex items-center justify-center border border-border shrink-0 ${color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl md:text-2xl font-black text-foreground">{value}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Main 2-col Layout ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* ── LEFT: Form / Wizard ──────────────────────────── */}
          <div className={`w-full lg:col-span-5 space-y-5 ${activeView === "create" ? "block" : "hidden lg:block"}`}>

            {/* STEP: Form */}
            {step === "form" && (
              <div className="animate-slide-up">
                <Card className="border border-border bg-card shadow-md rounded-2xl overflow-hidden">
                  {/* Card gradient top accent */}
                  <div className="h-1 w-full bg-gradient-to-r from-primary via-violet-500 to-primary" />
                  <CardContent className="p-6 space-y-6">
                    <div className="space-y-1">
                      <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                        <Layout className="h-4 w-4 text-primary" />
                        Nova Presell de Redirecionamento
                      </h2>
                      <p className="text-xs text-muted-foreground">A IA pesquisa a página original e gera a estrutura otimizada automaticamente.</p>
                    </div>

                    <form onSubmit={handleGenerate} className="space-y-5" autoComplete="off">

                      {/* Reference URL */}
                      <div className="space-y-2">
                        <Label htmlFor="reference-url" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-black">1</span>
                          Página de Referência (Landing Page Original)
                        </Label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="reference-url"
                            type="text"
                            name="reference_url_field"
                            autoComplete="new-password"
                            placeholder="https://produto-original.com/landing-page"
                            value={referenceUrl}
                            onChange={(e) => setReferenceUrl(e.target.value)}
                            className="pl-9 rounded-xl h-11 bg-muted/40 border-border focus-visible:ring-primary text-xs font-mono placeholder:text-muted-foreground/60"
                            required
                          />
                        </div>
                      </div>

                      {/* Paste HTML Bypass */}
                      <div className="space-y-1.5 pt-1">
                        <Label htmlFor="raw-html" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                          Código HTML da Página (Opcional - Use se o servidor estiver bloqueado)
                        </Label>
                        <Textarea
                          id="raw-html"
                          placeholder="Cole o código-fonte HTML completo da página se o robô do servidor for bloqueado pelo rastreador (bot protection)"
                          value={rawHtml}
                          onChange={(e) => setRawHtml(e.target.value)}
                          className="rounded-xl border-border min-h-[90px] resize-y bg-muted/20 font-mono text-[11px] placeholder:text-muted-foreground/60"
                        />
                      </div>

                      {/* Template selection */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-black">2</span>
                          Modelo da Página
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            {
                              key: "a" as const,
                              icon: ShieldCheck,
                              title: "Opção A: Cookies",
                              badge: "Google Ads ✓",
                              badgeColor: "text-emerald-400",
                              iconBg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                              desc: "Página com consentimento de cookies e aviso legal. Proteção extra para campanhas frias.",
                              features: ["Aviso legal incluso", "Ideal p/ campanhas frias"],
                            },
                            {
                              key: "b" as const,
                              icon: Zap,
                              title: "Opção B: Clone",
                              badge: "Alta Conversão",
                              badgeColor: "text-sky-400",
                              iconBg: "bg-sky-500/10 text-sky-400 border-sky-500/20",
                              desc: "Clona a página fielmente, remove popups e insere seu link de afiliado.",
                              features: ["Links substituídos", "Scripts limpos"],
                            },
                          ].map(({ key, icon: Icon, title, badge, badgeColor, iconBg, desc, features }) => (
                            <div
                              key={key}
                              onClick={() => setSelectedOption(key)}
                              className={`group relative rounded-xl border-2 p-4 cursor-pointer transition-all duration-200 ${
                                selectedOption === key
                                  ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                                  : "border-border bg-muted/20 hover:border-border/80 hover:bg-muted/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${iconBg}`}>
                                  <Icon className="h-3.5 w-3.5" />
                                </div>
                                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
                                  selectedOption === key ? "bg-primary border-primary" : "border-muted-foreground/30"
                                }`}>
                                  {selectedOption === key && <Check className="h-2.5 w-2.5 text-primary-foreground stroke-[3]" />}
                                </div>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold text-foreground">{title}</p>
                                <p className={`text-[9px] font-bold uppercase tracking-wider ${badgeColor} mb-2`}>{badge}</p>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
                                <div className="mt-3 space-y-1 pt-2.5 border-t border-border/50">
                                  {features.map(f => (
                                    <div key={f} className="flex items-center gap-1 text-[9px] font-semibold text-muted-foreground">
                                      <Check className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                                      <span>{f}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Language Selection */}
                      <div className="space-y-2">
                        <Label htmlFor="popup-language" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-black">3</span>
                          Idioma do Pop-up de Cookies
                        </Label>
                        <select
                          id="popup-language"
                          value={popupLanguage}
                          onChange={(e) => setPopupLanguage(e.target.value)}
                          className="w-full rounded-xl h-11 border border-border bg-card text-xs text-foreground px-3 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer shadow-2xs"
                        >
                          <option value="auto">Detectar do idioma do site (Recomendado)</option>
                          <option value="pt-BR">Português (pt-BR)</option>
                          <option value="es">Espanhol (es)</option>
                          <option value="en">Inglês (en)</option>
                          <option value="it">Italiano (it)</option>
                          <option value="fr">Francês (fr)</option>
                          <option value="de">Alemão (de)</option>
                          <option value="ro">Romeno (ro)</option>
                          <option value="pl">Polonês (pl)</option>
                          <option value="ar">Árabe (ar)</option>
                        </select>
                      </div>

                      {/* Destination URL */}
                      <div className="space-y-2">
                        <Label htmlFor="dest-url" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-black">4</span>
                          Link Final de Destino / Afiliado
                        </Label>
                        <div className="relative">
                          <ArrowRight className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="dest-url"
                            type="text"
                            name="random_url_field"
                            autoComplete="new-password"
                            placeholder="https://drcash.link/xxxxx ou link de afiliado"
                            value={destinationUrl}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDestinationUrl(val);
                              try {
                                const match = val.match(/[\/|=]([0-9]+)(?:\?|$|\/|&)/) || val.match(/^([0-9]+)$/);
                                if (match && match[1]) setStreamCode(match[1]);
                              } catch (_) {}
                            }}
                            className="pl-9 rounded-xl h-11 bg-muted/40 border-border focus-visible:ring-primary text-xs font-mono placeholder:text-muted-foreground/60"
                            required
                          />
                        </div>
                      </div>

                      {/* Advanced settings toggle */}
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                          <Code className="h-3.5 w-3.5 text-primary" />
                          Opções Avançadas
                        </span>
                        <span className={`text-[10px] font-bold transition-colors ${showAdvanced ? "text-primary" : "text-muted-foreground"}`}>
                          {showAdvanced ? "▲ Ocultar" : "▼ Dr.Cash & Tags"}
                        </span>
                      </button>

                      {/* Advanced fields */}
                      {showAdvanced && (
                        <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4 animate-slide-up">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Parâmetros Opcionais</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="api-token" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3 text-primary" /> API Token Dr.Cash
                              </Label>
                              <Input id="api-token" type="text" placeholder="Seu API Token" value={apiToken}
                                onChange={(e) => setApiToken(e.target.value)}
                                className="rounded-lg h-9 bg-muted/30 border-border text-xs font-mono" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="stream-code" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                <Link className="h-3 w-3 text-primary" /> stream_code
                              </Label>
                              <Input id="stream-code" type="text" placeholder="Ex: 12345" value={streamCode}
                                onChange={(e) => setStreamCode(e.target.value)}
                                className="rounded-lg h-9 bg-muted/30 border-border text-xs font-mono" />
                            </div>

                          </div>
                        </div>
                      )}

                      {/* Scripts section */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Code className="h-3.5 w-3.5 text-primary" />
                            Scripts & Pixels
                            {getTagCount() > 0 && (
                              <Badge className="ml-1 bg-primary/15 text-primary border-0 text-[9px] px-1.5 py-0.5">
                                {getTagCount()} injetado{getTagCount() > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </Label>
                          <span className="text-[9px] text-muted-foreground">GTM, Meta Pixel, GA4...</span>
                        </div>

                        {scripts.map((script, index) => (
                          <div key={index} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-muted-foreground">Script #{index + 1}</span>
                              {scripts.length > 1 && (
                                <button type="button"
                                  onClick={() => setScripts(scripts.filter((_, i) => i !== index))}
                                  className="text-[9px] text-destructive hover:text-destructive/80 font-bold transition-colors"
                                >Remover</button>
                              )}
                            </div>
                            <Textarea
                              name={`script_field_${index}`}
                              autoComplete="new-password"
                              placeholder="Cole o código do pixel completo (<script>...</script>)"
                              value={script}
                              onChange={(e) => {
                                const updated = [...scripts];
                                updated[index] = e.target.value;
                                setScripts(updated);
                              }}
                              className="rounded-xl border-border min-h-[80px] resize-y bg-muted/30 font-mono text-[11px] focus-visible:ring-primary"
                            />
                          </div>
                        ))}

                        <Button type="button" variant="outline" size="sm"
                          className="w-full border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 rounded-xl text-[10px] h-9 font-bold"
                          onClick={() => setScripts([...scripts, ""])}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Script / Pixel
                        </Button>
                      </div>

                      {/* Generate button */}
                      <Button
                        type="submit"
                        size="lg"
                        className="w-full rounded-xl h-13 text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Gerar Presell com IA
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* STEP: Generating */}
            {step === "generating" && (
              <div className="animate-slide-up">
                <Card className="border border-border bg-card rounded-2xl overflow-hidden">
                  <div className="h-1 w-full bg-gradient-to-r from-primary via-violet-500 to-primary animate-pulse" />
                  <CardContent className="p-10 text-center space-y-6">
                    <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                      <div className="absolute inset-0 rounded-full border-4 border-border border-t-primary animate-spin" />
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-base font-bold text-foreground">{generatingMessage}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                        Aguarde enquanto a IA processa o design da página original e constrói código premium.
                      </p>
                    </div>
                    <div className="flex justify-center gap-1.5">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* STEP: Done */}
            {step === "done" && (
              <div className="animate-slide-up">
                <Card className="border border-emerald-500/30 bg-emerald-500/5 rounded-2xl overflow-hidden">
                  <CardContent className="p-10 text-center space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center">
                      <Check className="h-8 w-8 text-emerald-500" strokeWidth={3} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Concluído! 🎉</h3>
                      <p className="text-xs text-muted-foreground mt-1">Estrutura compilada com sucesso.</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* STEP: Actions */}
            {step === "actions" && (
              <div className="space-y-4 animate-slide-up">
                <Card className="border border-border bg-card rounded-2xl overflow-hidden">
                  <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-primary to-violet-500" />
                  <CardContent className="p-6 space-y-5">
                    <div className="text-center space-y-2">
                      <div className="mx-auto w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <CheckCircle className="h-6 w-6 text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-foreground">Página Criada! 🚀</h3>
                        <p className="text-xs text-muted-foreground">Pronta para download ou publicação instantânea.</p>
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-muted/30 border border-border/60 rounded-xl p-4 space-y-2 text-xs">
                      {[
                        { label: "Modelo", value: selectedOption === "b" ? "Clone Limpo 🎯" : "Cookies ✅" },
                        { label: "Referência", value: referenceUrl, mono: true },
                        { label: "Destino", value: destinationUrl, mono: true, highlight: true },
                      ].map(({ label, value, mono, highlight }) => (
                        <div key={label} className="flex justify-between items-start gap-3 py-1 border-b border-border/40 last:border-0">
                          <span className="font-semibold text-muted-foreground shrink-0">{label}:</span>
                          <span className={`truncate max-w-[180px] text-right font-medium ${mono ? "font-mono" : ""} ${highlight ? "text-primary" : "text-foreground"}`} title={value}>{value}</span>
                        </div>
                      ))}
                      {designSummary && (
                        <div className="pt-2">
                          <span className="font-semibold text-muted-foreground block mb-1.5">Status IA:</span>
                          <p className="text-muted-foreground leading-relaxed text-[10px] bg-card border border-border/50 p-2.5 rounded-lg">{designSummary}</p>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="space-y-2.5">
                      <Button variant="outline" size="lg"
                        className="w-full rounded-xl h-11 text-xs font-bold border-border hover:border-primary/40 hover:bg-primary/5 text-foreground flex items-center justify-center gap-2 transition-all"
                        onClick={handleDownload}
                      >
                        <Download className="h-4 w-4 text-primary" /> Baixar Código HTML
                      </Button>

                      <Button size="lg"
                        className="w-full rounded-xl h-11 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all"
                        onClick={handlePublish} disabled={isPublishing}
                      >
                        {isPublishing ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Publicando...</>
                        ) : (
                          <><RefreshCw className="h-4 w-4 mr-1.5" /> Publicar no Servidor</>
                        )}
                      </Button>

                      <Button variant="ghost" size="sm"
                        className="w-full rounded-xl h-9 text-xs text-muted-foreground hover:text-foreground"
                        onClick={handleBackToEdit}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" /> Configurar Outra Página
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Published URL banner */}
                {publishedUrl && (
                  <div className="glass-card rounded-xl p-4 border border-emerald-500/25 bg-emerald-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-slide-up">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                        <CheckCircle2 className="h-4 w-4" /> Link Ativo Online!
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground select-all block truncate max-w-[260px]">
                        {window.location.origin}{publishedUrl}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px] font-semibold border-border"
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${publishedUrl}`); toast({ title: "Link copiado! 📋" }); }}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
                      </Button>
                      <Button asChild size="sm" className="h-8 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                        <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: Bridge History Table ──────────────────── */}
          <div className={`w-full lg:col-span-7 ${activeView === "websites" ? "block" : "hidden lg:block"}`}>
            <Card className="border border-border bg-card shadow-md rounded-2xl overflow-hidden h-full">
              <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-primary to-violet-500" />
              <CardContent className="p-6 space-y-5">
                {/* Table header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      Minhas Presells
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{savedWebsites.length} links configurados no sistema</p>
                  </div>
                  <div className="relative w-full sm:w-60 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Buscar presell ou destino..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 rounded-xl h-9 text-xs border-border bg-muted/30 focus-visible:ring-primary"
                    />
                  </div>
                </div>

                {/* Empty state */}
                {filteredWebsites.length === 0 ? (
                  <div className="text-center py-16 space-y-4 border border-dashed border-border/60 rounded-xl bg-muted/10">
                    <div className="mx-auto w-14 h-14 rounded-xl bg-muted/40 border border-border/60 flex items-center justify-center">
                      <Globe className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <div className="space-y-1 max-w-xs mx-auto">
                      <p className="text-sm font-semibold text-foreground">
                        {searchTerm ? "Nenhum resultado" : "Nenhuma presell criada ainda"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {searchTerm ? "Tente alterar os termos da busca." : "Preencha o formulário ao lado e clique em Gerar."}
                      </p>
                    </div>
                    {!searchTerm && (
                      <button
                        onClick={() => { setActiveView("create"); setStep("form"); }}
                        className="text-xs text-primary font-semibold hover:underline lg:hidden"
                      >
                        Criar primeira presell →
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent bg-muted/30 border-b border-border/60">
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground">Presell / Destino</TableHead>
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground">Status</TableHead>
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground text-center">Tags</TableHead>
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground text-right pr-4">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredWebsites.map((site) => {
                            let displayDomain = site.destinationUrl;
                            try { displayDomain = new URL(site.destinationUrl).hostname.replace("www.", ""); } catch (_) {}

                            return (
                              <TableRow key={site.id} className="hover:bg-muted/20 transition-colors border-b border-border/40">
                                <TableCell className="py-3">
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-xs text-foreground truncate max-w-[160px] md:max-w-[220px]" title={site.destinationUrl}>
                                      {displayDomain}
                                    </span>
                                    <span className="text-[9.5px] text-muted-foreground font-mono truncate mt-0.5 max-w-[160px] md:max-w-[220px]" title={site.destinationUrl}>
                                      {site.destinationUrl}
                                    </span>
                                    {site.publishedUrl && (
                                      <a
                                        href={site.publishedUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] text-primary hover:underline flex items-center gap-1 mt-1 font-semibold w-fit"
                                      >
                                        <ExternalLink className="h-2.5 w-2.5" /> Ver Online
                                      </a>
                                    )}
                                  </div>
                                </TableCell>

                                <TableCell className="py-3">
                                  <div className="flex flex-col gap-1">
                                    {site.status === "active" && (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wider w-fit">
                                        ● Ativo
                                      </Badge>
                                    )}
                                    {site.status === "paused" && (
                                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/10 text-[9px] font-bold uppercase tracking-wider w-fit">
                                        ⏸ Pausado
                                      </Badge>
                                    )}
                                    {site.status === "local" && (
                                      <Badge className="bg-muted text-muted-foreground border-border hover:bg-muted text-[9px] font-bold uppercase tracking-wider w-fit">
                                        ⬇ Local
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className={`text-[8px] font-bold uppercase tracking-wider w-fit ${
                                      site.selectedOption === "b"
                                        ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                                        : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                                    }`}>
                                      {site.selectedOption === "b" ? "Clone" : "Cookies"}
                                    </Badge>
                                  </div>
                                </TableCell>

                                <TableCell className="py-3 text-center">
                                  <span className="text-[11px] text-muted-foreground font-mono font-medium">
                                    {site.scripts.length}
                                  </span>
                                </TableCell>

                                <TableCell className="py-3 text-right pr-4">
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={() => downloadSavedWebsite(site)} title="Baixar HTML">
                                      <Download className="h-3.5 w-3.5" />
                                    </Button>
                                    {(site.status === "active" || site.status === "paused") && (
                                      <>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={() => toggleWebsiteStatus(site)} title={site.status === "active" ? "Pausar" : "Ativar"}>
                                          {site.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={() => copyPublishedLink(site.publishedUrl)} title="Copiar Link">
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                      </>
                                    )}
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                      onClick={() => {
                                        setDestinationUrl(site.destinationUrl);
                                        setReferenceUrl(site.referenceUrl || "");
                                        setScripts(site.scripts.length > 0 ? site.scripts : [""]);
                                        setProductName(site.productName || "");
                                        setProductHeadline(site.productHeadline || "");
                                        setProductDescription(site.productDescription || "");
                                        setProductCategory(site.productCategory || "Saúde & Bem-estar");
                                        setCtaText(site.ctaText || "Ir para o Site Oficial");
                                        setSupportEmail(site.supportEmail || "");
                                        setApiToken(site.apiToken || "");
                                        setStreamCode(site.streamCode || "");
                                        setSelectedOption(site.selectedOption || "a");
                                        setActiveView("create");
                                        setStep("form");
                                        toast({ title: "Configuração carregada!", description: "Campos preenchidos com os parâmetros da presell." });
                                      }}
                                      title="Reutilizar / Editar"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10" onClick={() => deleteWebsite(site)} title="Excluir">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
