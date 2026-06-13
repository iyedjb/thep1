import { useState, useEffect } from "react";
import { Link as RouterLink } from "wouter";
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
  ChevronLeft,
  Code,
  ArrowRight,
  ShieldCheck,
  Link,
  Laptop,
  Loader2,
  Check,
  Trash2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Globe
} from "lucide-react";

type Step = "form" | "generating" | "done" | "actions";
type View = "create" | "websites";

interface SavedWebsite {
  id: string;
  destinationUrl: string;
  scripts: string[];
  generatedHtml: string;
  publishedUrl: string;
  fileName: string;
  status: "active" | "paused" | "local";
  createdAt: string;
  popupLanguage?: string;
}

const POPUP_LANGS: Record<string, { headline: string; sub: string; namePlaceholder: string; contactPlaceholder: string; btn: string; close: string; thanks: string; }> = {
  "pt-BR": {
    headline: "Gostou do nosso produto?",
    sub: "Deixe seu contato e nossa equipe entrará em contato com você em breve.",
    namePlaceholder: "Seu nome",
    contactPlaceholder: "E-mail ou WhatsApp",
    btn: "Quero ser contatado!",
    close: "Não, obrigado",
    thanks: "Obrigado! Entraremos em contato em breve."
  },
  "en": {
    headline: "Did you like our product?",
    sub: "Leave your contact and our team will reach out to you shortly.",
    namePlaceholder: "Your name",
    contactPlaceholder: "E-mail or Phone",
    btn: "Contact me!",
    close: "No, thanks",
    thanks: "Thank you! We will contact you soon."
  },
  "es": {
    headline: "¿Te gustó nuestro producto?",
    sub: "Deja tu contacto y nuestro equipo se comunicará contigo pronto.",
    namePlaceholder: "Tu nombre",
    contactPlaceholder: "Correo o WhatsApp",
    btn: "¡Contáctenme!",
    close: "No, gracias",
    thanks: "¡Gracias! Nos comunicaremos pronto."
  }
};

export default function Creator() {
  const { toast } = useToast();

  // Switcher view state
  const [activeView, setActiveView] = useState<View>("create");

  // Form states
  const [destinationUrl, setDestinationUrl] = useState("");
  const [scripts, setScripts] = useState<string[]>([""]);
  const [popupLanguage, setPopupLanguage] = useState("pt-BR");
  
  // Step state for creation wizard
  const [step, setStep] = useState<Step>("form");
  const [generatingMessage, setGeneratingMessage] = useState("Criando base do redirecionador...");

  // Generated code & publishing states for current wizard run
  const [generatedHtml, setGeneratedHtml] = useState("");
  const [currentWebsiteId, setCurrentWebsiteId] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  // Saved websites state loaded from localStorage
  const [savedWebsites, setSavedWebsites] = useState<SavedWebsite[]>([]);

  // Load saved websites on mount
  useEffect(() => {
    const list = localStorage.getItem("saved_bridges");
    if (list) {
      try {
        setSavedWebsites(JSON.parse(list));
      } catch (_) {}
    }

    const drcashLander = localStorage.getItem("drcash_selected_lander");
    if (drcashLander) {
      setDestinationUrl(drcashLander);
      localStorage.removeItem("drcash_selected_lander");
      toast({
        title: "Oferta Carregada",
        description: "A Landing Page do Dr. Cash foi inserida no link de destino.",
        variant: "default"
      });
    }
  }, []);

  // Save websites helper
  const saveWebsites = (newList: SavedWebsite[]) => {
    setSavedWebsites(newList);
    localStorage.setItem("saved_bridges", JSON.stringify(newList));
  };

  // Compile the clean HTML redirector page
  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!destinationUrl.trim()) {
      toast({
        title: "Link de destino obrigatório",
        description: "Por favor, insira a URL final para onde o tráfego será direcionado.",
        variant: "destructive"
      });
      return;
    }

    // Ensure URL has protocol
    let targetUrl = destinationUrl.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
      setDestinationUrl(targetUrl);
    }

    let domainName = "Carregando...";
    try {
      domainName = new URL(targetUrl).hostname.replace("www.", "");
    } catch (_) {}

    // Concatenate non-empty scripts
    const combinedTags = scripts.filter(s => s.trim() !== "").join("\n    ");

    const template = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${domainName}</title>
    ${combinedTags}
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body, html {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background-color: #0f172a;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            position: absolute;
            top: 0; left: 0;
            z-index: 1;
        }
    </style>
</head>
<body>
    <iframe src="${targetUrl}"></iframe>
</body>
</html>`;

    setGeneratedHtml(template);
    
    const newId = Date.now().toString();
    setCurrentWebsiteId(newId);

    // Save into history as a local generated item initially
    const newSite: SavedWebsite = {
      id: newId,
      destinationUrl: targetUrl,
      scripts: scripts.filter(s => s.trim() !== ""),
      generatedHtml: template,
      publishedUrl: "",
      fileName: "",
      status: "local",
      createdAt: new Date().toLocaleDateString("pt-BR"),
      popupLanguage
    };
    saveWebsites([newSite, ...savedWebsites]);

    // Start step animation flow
    setStep("generating");
    setGeneratingMessage("Compilando código HTML...");

    // Timing flow for visual feedback
    setTimeout(() => {
      setGeneratingMessage("Injetando scripts e tags do cabeçalho...");
    }, 700);

    setTimeout(() => {
      setGeneratingMessage("Finalizando página de redirecionamento...");
    }, 1400);

    setTimeout(() => {
      setStep("done");
    }, 2000);

    setTimeout(() => {
      setStep("actions");
      toast({
        title: "Página Gerada!",
        description: "Código HTML compilado com sucesso. Selecione uma ação abaixo.",
        variant: "default"
      });
    }, 3000);
  };

  // Handle download of generated HTML file
  const handleDownload = () => {
    try {
      const blob = new Blob([generatedHtml], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      let domain = "ponte";
      try {
        domain = new URL(destinationUrl).hostname.replace("www.", "").split(".")[0];
      } catch (_) {}

      a.download = `redirect-${domain}.html`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast({
        title: "Download Iniciado",
        description: "O arquivo HTML foi baixado com sucesso.",
        variant: "default"
      });
    } catch (err: any) {
      toast({
        title: "Erro ao baixar arquivo",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  // Publish to Vite client public folder via API
  const handlePublish = async () => {
    setIsPublishing(true);
    setPublishedUrl("");

    let domain = "ponte";
    try {
      domain = new URL(destinationUrl).hostname.replace("www.", "").split(".")[0];
    } catch (_) {}

    const fileName = `redirect-${domain}-${Date.now()}.html`;
    const token = localStorage.getItem("ads_token");

    try {
      const response = await fetch("/api/publish-bridge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          htmlContent: generatedHtml,
          fileName: fileName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erro ao publicar no servidor.");
      }

      // Update current website in the saved list with publication data
      const updatedList = savedWebsites.map(site => {
        if (site.id === currentWebsiteId) {
          return {
            ...site,
            publishedUrl: data.url,
            fileName: fileName,
            status: "active" as const
          };
        }
        return site;
      });
      saveWebsites(updatedList);

      setPublishedUrl(data.url);
      toast({
        title: "Página Publicada!",
        description: "Sua página de redirecionamento está online.",
        variant: "default"
      });
    } catch (err: any) {
      toast({
        title: "Erro de Publicação",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setIsPublishing(false);
    }
  };

  // Actions for saved websites list
  const downloadSavedWebsite = (site: SavedWebsite) => {
    const blob = new Blob([site.generatedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    let domain = "ponte";
    try {
      domain = new URL(site.destinationUrl).hostname.replace("www.", "").split(".")[0];
    } catch (_) {}
    a.download = `redirect-${domain}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Download Iniciado", description: "O arquivo foi baixado com sucesso." });
  };

  const copyPublishedLink = (url: string) => {
    navigator.clipboard.writeText(`${window.location.origin}${url}`);
    toast({ title: "Link Copiado!", description: "Copiado para a área de transferência." });
  };

  // Toggles pause / play state by overwriting server file content
  const toggleWebsiteStatus = async (site: SavedWebsite) => {
    const isCurrentlyActive = site.status === "active";
    const newStatus = isCurrentlyActive ? "paused" : "active";
    
    const pausedTemplate = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Página Pausada</title>
    <style>
        body {
            background-color: #0f172a;
            color: #f8fafc;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 24px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            max-width: 400px;
        }
        h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px 0; }
        p { font-size: 13px; color: #94a3b8; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Página Pausada</h1>
        <p>Este redirecionamento está temporariamente inativo.</p>
    </div>
</body>
</html>`;

    const targetHtml = isCurrentlyActive ? pausedTemplate : site.generatedHtml;
    const token = localStorage.getItem("ads_token");

    try {
      const response = await fetch("/api/publish-bridge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          htmlContent: targetHtml,
          fileName: site.fileName
        })
      });

      if (!response.ok) throw new Error("Erro ao atualizar status no servidor.");

      const updatedList = savedWebsites.map(s => {
        if (s.id === site.id) {
          return { ...s, status: newStatus as "active" | "paused" };
        }
        return s;
      });
      saveWebsites(updatedList);
      toast({
        title: isCurrentlyActive ? "Página Pausada!" : "Página Ativada!",
        description: isCurrentlyActive 
          ? "O redirecionador foi desativado temporariamente no servidor."
          : "O redirecionador está ativo novamente.",
        variant: "default"
      });
    } catch (err: any) {
      toast({ title: "Erro ao alterar status", description: err.message, variant: "destructive" });
    }
  };

  // Exclude page locally and delete from server
  const deleteWebsite = async (site: SavedWebsite) => {
    if (site.status === "active" || site.status === "paused") {
      const token = localStorage.getItem("ads_token");
      try {
        await fetch("/api/delete-bridge", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({ fileName: site.fileName })
        });
      } catch (_) {}
    }

    const updatedList = savedWebsites.filter(s => s.id !== site.id);
    saveWebsites(updatedList);
    toast({ title: "Página Excluída", description: "O redirecionador foi excluído com sucesso." });
  };

  // Helper to count how many head tags were injected
  const getTagCount = () => {
    return scripts.filter(s => s.trim() !== "").length;
  };

  const handleBackToEdit = () => {
    setStep("form");
    setPublishedUrl("");
  };

  return (
    <div className="relative min-h-[calc(100vh-80px)] p-4 md:p-8 flex flex-col items-stretch justify-start bg-slate-50/50 pt-10">
      
      {/* Decorative clean background mesh */}
      <div className="absolute top-0 left-0 w-full h-full bg-dots-grid pointer-events-none -z-10 opacity-70" />
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px] pointer-events-none -z-10" />
      
      <div className={`w-full ${activeView === "create" ? "max-w-xl mx-auto" : "max-w-full"} space-y-6 z-10`}>
        
        {/* Header Block (Hidden when generating/done) */}
        {step !== "generating" && step !== "done" && (
          <div className="text-center space-y-2 animate-in fade-in duration-300">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center justify-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" /> Criador de Pontes IA
            </h1>
            <p className="text-slate-500 text-xs md:text-sm max-w-lg mx-auto">
              Gere um redirecionador instantâneo com iframe em tela cheia e códigos de rastreamento personalizados.
            </p>
          </div>
        )}

        {/* VIEW SELECTOR SWITCHER (Only shown when not loading/done) */}
        {step !== "generating" && step !== "done" && (
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50 max-w-[240px] mx-auto animate-in fade-in duration-300">
            <button
              onClick={() => {
                setActiveView("create");
                setStep("form"); // reset step
              }}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                activeView === "create"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Configurar Ponte
            </button>
            <button
              onClick={() => setActiveView("websites")}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded transition-all ${
                activeView === "websites"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Minhas Pontes
            </button>
          </div>
        )}

        {/* VIEW 1: CREATE PORTAL */}
        {activeView === "create" && (
          <>
            {/* STEP 1: Input Form */}
            {step === "form" && (
              <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
                <Card className="border border-slate-200 bg-white shadow-md rounded-2xl">
                  <CardContent className="p-6 md:p-8 space-y-6">
                    <div className="text-center space-y-1 pb-2 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-800">Nova Ponte</h2>
                      <p className="text-xs text-slate-400">Insira o link final e insira as tags de verificação ou pixel</p>
                    </div>

                    <form onSubmit={handleGenerate} className="space-y-5" autoComplete="off">
                      
                      {/* Destination Link */}
                      <div className="space-y-1.5">
                        <Label htmlFor="dest-url" className="text-xs font-semibold text-slate-700">
                          Link de Destino Final (URL)
                        </Label>
                        <Input 
                          id="dest-url" 
                          type="text"
                          name="random_url_field"
                          autoComplete="new-password"
                          placeholder="https://pagina-de-destino.com/oferta"
                          value={destinationUrl} 
                          onChange={(e) => setDestinationUrl(e.target.value)}
                          className="rounded-xl h-11 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 focus-visible:border-primary shadow-sm"
                          required
                        />
                      </div>

                      {/* Custom Head/Header Tags (Dynamic Numbered List 1, 2, 3...) */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                          <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                            <Code className="h-3.5 w-3.5 text-primary" /> Scripts do Cabeçalho
                          </Label>
                          <span className="text-[9px] text-slate-400">Google tag, pixels, verification...</span>
                        </div>

                        {scripts.map((script, index) => (
                          <div key={index} className="space-y-1.5 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500">Script {index + 1}</span>
                              {scripts.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = scripts.filter((_, i) => i !== index);
                                    setScripts(updated);
                                  }}
                                  className="text-[9px] text-rose-500 hover:underline font-bold"
                                >
                                  Remover
                                </button>
                              )}
                            </div>
                            <Textarea 
                              name={`script_field_${index}`}
                              autoComplete="new-password"
                              placeholder={`Cole o script/meta tag ${index + 1} aqui...`}
                              value={script}
                              onChange={(e) => {
                                const updated = [...scripts];
                                updated[index] = e.target.value;
                                setScripts(updated);
                              }}
                              className="rounded-xl border-slate-200 min-h-[90px] resize-y bg-white font-mono text-xs focus-visible:ring-primary focus-visible:ring-2"
                            />
                          </div>
                        ))}

                        {/* Add script button */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full border-dashed border-slate-300 text-slate-500 hover:text-slate-700 hover:border-slate-400 rounded-xl text-[10px] h-9 font-bold"
                          onClick={() => setScripts([...scripts, ""])}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Adicionar Novo Script
                        </Button>
                      </div>

                      {/* Generate Button */}
                      <Button 
                        type="submit" 
                        size="lg" 
                        className="w-full rounded-xl h-11 text-xs font-bold bg-primary hover:bg-primary/90 text-white shadow-sm transition-all duration-200"
                      >
                        Gerar Página de Redirecionamento
                      </Button>

                    </form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* STEP 2: Clean Generating Animation */}
            {step === "generating" && (
              <div className="w-full text-center py-12 space-y-6 animate-in fade-in zoom-in-95 duration-300">
                <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-slate-100 border-t-primary animate-spin" />
                  <Code className="h-6 w-6 text-primary animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-slate-800 animate-pulse">{generatingMessage}</h3>
                  <p className="text-xs text-slate-400">Criando ponte limpa sem cookie banners...</p>
                </div>
              </div>
            )}

            {/* STEP 3: Clean Done Animation */}
            {step === "done" && (
              <div className="w-full text-center py-12 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 animate-in zoom-in spin-in-12 duration-500">
                  <Check className="h-8 w-8" strokeWidth={3} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-slate-800">Concluído!</h3>
                  <p className="text-xs text-slate-400">Página compilada com sucesso.</p>
                </div>
              </div>
            )}

            {/* STEP 4: Actions Card */}
            {step === "actions" && (
              <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <Card className="border border-slate-200 bg-white shadow-md rounded-2xl">
                  <CardContent className="p-6 md:p-8 space-y-6">
                    
                    <div className="text-center space-y-1 pb-3 border-b border-slate-100">
                      <div className="mx-auto w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 mb-2">
                        <CheckCircle className="h-5 w-5" />
                      </div>
                      <h3 className="font-bold text-lg text-slate-800">Página Criada com Sucesso</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Sua página de redirecionamento está pronta e livre de pop-ups.
                      </p>
                    </div>

                    {/* Settings Details Display */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-200/50">
                        <span className="font-semibold text-slate-400">Destino:</span>
                        <span className="truncate max-w-[200px] font-mono text-primary font-medium" title={destinationUrl}>{destinationUrl}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="font-semibold text-slate-400">Scripts:</span>
                        <span className="font-mono text-slate-700">
                          {getTagCount() > 0 ? `Sim (${getTagCount()} tags)` : "Nenhum"}
                        </span>
                      </div>
                    </div>

                    {/* Primary Action Buttons */}
                    <div className="space-y-3 pt-2">
                      
                      {/* Download HTML Button */}
                      <Button 
                        variant="outline" 
                        size="lg" 
                        className="w-full rounded-xl h-11 text-xs font-bold border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 flex items-center justify-center gap-1.5 transition-all hover:scale-[1.01]" 
                        onClick={handleDownload}
                      >
                        <Download className="h-4 w-4 text-primary" /> Baixar HTML
                      </Button>
                      
                      {/* Publish Button */}
                      <Button 
                        size="lg" 
                        className="w-full rounded-xl h-11 text-xs font-bold bg-primary hover:bg-primary/95 text-white flex items-center justify-center gap-1.5 transition-all hover:scale-[1.01]" 
                        onClick={handlePublish} 
                        disabled={isPublishing}
                      >
                        {isPublishing ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Publicando...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4" /> Publicar no Servidor
                          </>
                        )}
                      </Button>

                      {/* Edit/Back Button */}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="w-full rounded-lg h-8 text-xs text-slate-400 hover:text-slate-600" 
                        onClick={handleBackToEdit}
                      >
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Editar Configurações
                      </Button>

                    </div>

                  </CardContent>
                </Card>

                {/* Published URL Success Banner */}
                {publishedUrl && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-left shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs">
                        <CheckCircle className="h-4 w-4 text-emerald-500" /> Link de Redirecionamento Online!
                      </div>
                      <span className="text-xs font-mono text-slate-500 select-all block mt-0.5 truncate max-w-[280px] md:max-w-[340px]">
                        {window.location.origin}{publishedUrl}
                      </span>
                    </div>
                    
                    <div className="flex gap-2 w-full md:w-auto shrink-0 justify-end">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-9 rounded-lg text-xs font-semibold border-slate-200 hover:bg-slate-50 text-slate-700" 
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}${publishedUrl}`);
                          toast({ title: "Link copiado!", description: "Copiado para a área de transferência." });
                        }}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
                      </Button>
                      <Button 
                        asChild 
                        size="sm" 
                        className="h-9 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Acessar
                        </a>
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            )}
          </>
        )}

        {/* VIEW 2: WEBSITES MANAGEMENT LIST */}
        {activeView === "websites" && (
          <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h3 className="font-bold text-xl text-slate-800">Minhas Pontes</h3>
                <p className="text-xs text-slate-500">Gerencie, baixe ou edite seus redirecionadores salvos localmente</p>
              </div>
              <div className="text-xs text-slate-400 font-semibold bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/40 w-fit">
                Total: {savedWebsites.length} {savedWebsites.length === 1 ? "ponte" : "pontes"}
              </div>
            </div>

            {/* List of Websites as a Table */}
            {savedWebsites.length === 0 ? (
              <div className="text-center py-16 space-y-3 border border-dashed border-slate-200 rounded-2xl bg-white shadow-xs">
                <Globe className="mx-auto h-8 w-8 text-slate-300" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500">Nenhuma ponte criada ainda</p>
                  <p className="text-[10px] text-slate-400">Configure uma ponte na aba ao lado para salvá-la aqui.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto w-full border border-slate-200/60 rounded-xl bg-white shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-slate-50/50">
                      <TableHead className="w-[35%] py-3">Ponte / Destino</TableHead>
                      <TableHead className="w-[15%] py-3">Status</TableHead>
                      <TableHead className="w-[15%] py-3">Scripts</TableHead>
                      <TableHead className="w-[15%] py-3">Criado Em</TableHead>
                      <TableHead className="text-right w-[20%] py-3 pr-4">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedWebsites.map((site) => {
                      let displayDomain = site.destinationUrl;
                      try {
                        displayDomain = new URL(site.destinationUrl).hostname.replace("www.", "");
                      } catch (_) {}

                      return (
                        <TableRow key={site.id} className="hover:bg-slate-50/50 transition-colors">
                          <TableCell className="align-middle py-3">
                            <div className="flex flex-col min-w-0 max-w-[280px] md:max-w-xs xl:max-w-md">
                              <span className="font-semibold text-slate-900 truncate" title={site.destinationUrl}>
                                {displayDomain}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono truncate mt-0.5" title={site.destinationUrl}>
                                {site.destinationUrl}
                              </span>
                              {site.publishedUrl && (
                                <a 
                                  href={site.publishedUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-1 font-mono w-fit"
                                >
                                  <ExternalLink className="h-2.5 w-2.5" /> Ver online
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="align-middle py-3">
                            {site.status === "active" && (
                              <Badge className="bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 border-emerald-500/20 py-0.5 px-2 rounded font-bold text-[9px] uppercase tracking-wider">
                                Ativo
                              </Badge>
                            )}
                            {site.status === "paused" && (
                              <Badge className="bg-amber-500/10 hover:bg-amber-500/15 text-amber-700 border-amber-500/20 py-0.5 px-2 rounded font-bold text-[9px] uppercase tracking-wider">
                                Pausado
                              </Badge>
                            )}
                            {site.status === "local" && (
                              <Badge className="bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 py-0.5 px-2 rounded font-bold text-[9px] uppercase tracking-wider">
                                Local
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-middle py-3">
                            <span className="text-xs text-slate-600 font-medium">
                              {site.scripts.length} {site.scripts.length === 1 ? "script" : "scripts"}
                            </span>
                          </TableCell>
                          <TableCell className="align-middle py-3 font-mono text-[11px] text-slate-500">
                            {site.createdAt}
                          </TableCell>
                          <TableCell className="text-right align-middle py-3 pr-4">
                            <div className="flex items-center justify-end gap-1">
                              {/* Download */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                onClick={() => downloadSavedWebsite(site)}
                                title="Baixar HTML"
                              >
                                <Download className="h-4 w-4" />
                              </Button>

                              {/* Pause/Play status toggle */}
                              {(site.status === "active" || site.status === "paused") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                  onClick={() => toggleWebsiteStatus(site)}
                                  title={site.status === "active" ? "Pausar Redirecionamento" : "Ativar Redirecionamento"}
                                >
                                  {site.status === "active" ? (
                                    <Pause className="h-4 w-4" />
                                  ) : (
                                    <Play className="h-4 w-4 text-emerald-500" />
                                  )}
                                </Button>
                              )}

                              {/* Copy Link */}
                              {(site.status === "active" || site.status === "paused") && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                  onClick={() => copyPublishedLink(site.publishedUrl)}
                                  title="Copiar Link Online"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              )}

                              {/* Load back/duplicate */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                onClick={() => {
                                  setDestinationUrl(site.destinationUrl);
                                  setScripts(site.scripts.length > 0 ? site.scripts : [""]);
                                  setActiveView("create");
                                  setStep("form");
                                  toast({ title: "Dados carregados!", description: "Dados da ponte carregados no formulário de criação." });
                                }}
                                title="Editar/Duplicar"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>

                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                                onClick={() => deleteWebsite(site)}
                                title="Excluir"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
