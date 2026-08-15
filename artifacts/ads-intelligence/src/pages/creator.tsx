import { useState, useEffect } from "react";
import JSZip from "jszip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { BackButton } from "@/components/ui/back-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  Download,
  FolderArchive,
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
  Zap,
  Layers,
  Tag,
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
  leadNetwork?: "none" | "drcash" | "lemonad";
  lemonOfferId?: string;
  lemonWebmasterToken?: string;
  lemonCost?: string;
  selectedOption?: "a" | "b" | "review";
  thankYouHtml?: string;
  thankYouFileName?: string;
  lemonPhpHtml?: string;
  lemonPhpFileName?: string;
}

const TRAFFIC_CHAT_STORAGE_KEY = "traffic_manager_chat_state";
const TRAFFIC_CHAT_GREETING = "Olá! Sou seu gestor de tráfego especializado em Google Ads e Meta Ads para produtos de afiliados. Posso te ajudar a criar uma campanha do zero, escrever copy de alta conversão, montar extensões, pesquisar palavras-chave ou diagnosticar uma campanha que já está rodando. Por onde quer começar?";

export default function Creator() {
  const { toast } = useToast();

  const [activeView, setActiveView] = useState<View>("websites");

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
  const [leadNetwork, setLeadNetwork] = useState<"none" | "drcash" | "lemonad">("none");
  const [pendingLeadNetwork, setPendingLeadNetwork] = useState<"none" | "drcash" | "lemonad">("none");
  const [lemonOfferId, setLemonOfferId] = useState("");
  const [lemonWebmasterToken, setLemonWebmasterToken] = useState("");
  const [lemonCost, setLemonCost] = useState("");
  const [thankYouUrl, setThankYouUrl] = useState("./Obrigado.html");
  const [designSummary, setDesignSummary] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedStep, setAdvancedStep] = useState<1 | 2>(1);
  const [selectedOption, setSelectedOption] = useState<"a" | "b">("a");
  const [keepOriginalStructure, setKeepOriginalStructure] = useState(false);

  const [step, setStep] = useState<Step>("form");
  const [generatingMessage, setGeneratingMessage] = useState("Criando base do redirecionador...");

  const [generatedHtml, setGeneratedHtml] = useState("");
  const [thankYouHtml, setThankYouHtml] = useState("");
  const [thankYouFileName, setThankYouFileName] = useState("");
  const [lemonPhpHtml, setLemonPhpHtml] = useState("");
  const [lemonPhpFileName, setLemonPhpFileName] = useState("");
  const [currentWebsiteId, setCurrentWebsiteId] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const [savedWebsites, setSavedWebsites] = useState<SavedWebsite[]>([]);

  const [activeMode, setActiveMode] = useState<"redirect" | "traffic">("redirect");
  const [trafficChatMessages, setTrafficChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: TRAFFIC_CHAT_GREETING }
  ]);
  const [trafficChatInput, setTrafficChatInput] = useState("");
  const [isTrafficChatSending, setIsTrafficChatSending] = useState(false);
  const [trafficChatStateLoaded, setTrafficChatStateLoaded] = useState(false);

  const fetchPresells = async () => {
    try {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/presells", {
        headers: { "Authorization": token ? `Bearer ${token}` : "" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.presells) {
          const mapped = data.presells.map((site: any) => ({
            id: site.id.toString(),
            referenceUrl: site.reference_url,
            destinationUrl: site.destination_url,
            productName: site.product_name,
            productCategory: site.product_category,
            selectedOption: site.selected_option,
            createdAt: site.created_at ? new Date(site.created_at).toLocaleDateString("pt-BR") : "",
            publishedUrl: site.published_url || "",
            fileName: site.publish_path || "",
            status: (site.status || "local") as SavedWebsite["status"],
            generatedHtml: "",
            scripts: []
          }));
          setSavedWebsites(mapped);
        }
      }
    } catch (err) {
      console.error("Erro ao buscar presells", err);
    }
  };

  const handleTrafficChatSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trafficChatInput.trim() || isTrafficChatSending) return;

    const userMsg = trafficChatInput.trim();
    setTrafficChatInput("");

    const newMessages = [...trafficChatMessages, { role: "user" as const, content: userMsg }];
    setTrafficChatMessages(newMessages);
    setIsTrafficChatSending(true);

    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch("/api/chat-traffic-manager", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ messages: newMessages })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao conversar com o gestor de tráfego.");

      setTrafficChatMessages(prev => [...prev, { role: "assistant" as const, content: data.message }]);
    } catch (err: any) {
      toast({ title: "Erro no Chat", description: err.message, variant: "destructive" });
    } finally {
      setIsTrafficChatSending(false);
    }
  };

  const handleTrafficChatReset = () => {
    setTrafficChatMessages([{ role: "assistant", content: TRAFFIC_CHAT_GREETING }]);
    try {
      localStorage.removeItem(TRAFFIC_CHAT_STORAGE_KEY);
    } catch (err) {
      console.error("Erro ao limpar chat salvo", err);
    }
  };

  useEffect(() => {
    fetchPresells();

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

    try {
      const savedChatState = localStorage.getItem(TRAFFIC_CHAT_STORAGE_KEY);
      if (savedChatState) {
        const parsed = JSON.parse(savedChatState);
        if (Array.isArray(parsed.trafficChatMessages) && parsed.trafficChatMessages.length > 0) setTrafficChatMessages(parsed.trafficChatMessages);
      }
    } catch (err) {
      console.error("Erro ao restaurar chat salvo", err);
    } finally {
      setTrafficChatStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!trafficChatStateLoaded) return;
    try {
      localStorage.setItem(TRAFFIC_CHAT_STORAGE_KEY, JSON.stringify({ trafficChatMessages }));
    } catch (err) {
      console.error("Erro ao salvar chat no localStorage", err);
    }
  }, [trafficChatStateLoaded, trafficChatMessages]);

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
    if (leadNetwork === "lemonad" && (!lemonOfferId.trim() || !lemonWebmasterToken.trim())) {
      toast({ title: "Dados da LemonAd obrigatórios", description: "Informe o Offer ID e o Webmaster Token da oferta para gerar o lemon.php.", variant: "destructive" });
      return;
    }

    let targetUrl = destinationUrl.trim();
    if (!/^https?:\/\//i.test(targetUrl)) { targetUrl = "https://" + targetUrl; setDestinationUrl(targetUrl); }
    let sourceUrl = referenceUrl.trim();
    if (!/^https?:\/\//i.test(sourceUrl)) { sourceUrl = "https://" + sourceUrl; setReferenceUrl(sourceUrl); }

    const token = localStorage.getItem("ads_token");
    const combinedAiTags = scripts.filter(s => s.trim() !== "").join("\n    ");

    setStep("generating");
      setGeneratingMessage("Pesquisando design e idioma");
    setGeneratedHtml(""); setPublishedUrl(""); setDesignSummary("");

    setTimeout(() => setGeneratingMessage("Organizando a estrutura da presell"), 900);
    setTimeout(() => setGeneratingMessage(keepOriginalStructure
      ? "Revisando a estrutura original"
      : "Gerando a nova página"), 1800);

    try {
      const response = await fetch("/api/generate-bridge-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "" },
        body: JSON.stringify({
          referenceUrl: sourceUrl, affiliateUrl: targetUrl, trackingTags: combinedAiTags,
          productHint: productName,
          apiToken: leadNetwork === "drcash" ? apiToken : "",
          streamCode: leadNetwork === "drcash" ? streamCode : "",
          lemonOfferId: leadNetwork === "lemonad" ? lemonOfferId : "",
          lemonWebmasterToken: leadNetwork === "lemonad" ? lemonWebmasterToken : "",
          lemonCost: leadNetwork === "lemonad" ? lemonCost : "",
          thankYouUrl,
          network: "Dr.Cash", selectedOption, popupLanguage, rawHtml,
          keepOriginalStructure: selectedOption === "b" ? keepOriginalStructure : false
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

      const lemonHtml = data.lemonPhpHtml || "";
      const lemonFileName = data.lemonPhpFileName || "";
      setLemonPhpHtml(lemonHtml);
      setLemonPhpFileName(lemonFileName);

      let savedId = Date.now().toString();
      try {
        const dbRes = await fetch("/api/presells", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({
            referenceUrl: sourceUrl,
            destinationUrl: targetUrl,
            productName: data.productName || productName,
            productCategory,
            selectedOption
          })
        });
        if (dbRes.ok) {
          const dbData = await dbRes.json();
          if (dbData.id) savedId = dbData.id.toString();
        }
      } catch (err) {
        console.error("Erro ao persistir no banco de dados", err);
      }

      setCurrentWebsiteId(savedId);

      const newSite: SavedWebsite = {
        id: savedId, referenceUrl: sourceUrl, destinationUrl: targetUrl,
        scripts: [], generatedHtml: html,
        publishedUrl: "", fileName: "", status: "local",
        createdAt: new Date().toLocaleDateString("pt-BR"),
        popupLanguage: data.language || popupLanguage, productName: data.productName || productName,
        productHeadline, productDescription: data.designSummary || productDescription,
        productCategory, ctaText, supportEmail, apiToken, streamCode, selectedOption,
        leadNetwork, lemonOfferId, lemonWebmasterToken, lemonCost,
        thankYouHtml: tyHtml, thankYouFileName: tyFileName,
        lemonPhpHtml: lemonHtml, lemonPhpFileName: lemonFileName
      };
      setSavedWebsites(prev => [newSite, ...prev]);
      setRawHtml(""); // Reset pasted HTML on success
      setGeneratingMessage("Finalizando e salvando");
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Download iniciado", description: "O arquivo HTML está pronto para abrir." });
    } catch (err: any) {
      toast({ title: "Erro ao baixar arquivo", description: err.message, variant: "destructive" });
    }
  };

  const handleDownloadHostingerZip = async () => {
    try {
      toast({ title: "Preparando o pacote", description: "Organizando HTML, CSS e imagens." });
      const zip = new JSZip();
      let html = generatedHtml;

      // 1. Extract inline <style> tags and external <link rel="stylesheet"> CSS
      let cssContent = "";
      const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
      let styleMatch;
      while ((styleMatch = styleRegex.exec(generatedHtml)) !== null) {
        cssContent += styleMatch[1] + "\n\n";
      }

      // Keep any stylesheet that cannot be downloaded. Previously every link was removed,
      // which left local ZIP previews without the source page styling when CORS blocked fetch().
      const downloadedStyleTags = new Set<string>();
      if (selectedOption !== "a") {
        const stylesheetTags = generatedHtml.match(/<link\b[^>]*>/gi) || [];
        for (const tag of stylesheetTags) {
          const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] || "";
          const cssHref = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
          if (!/\bstylesheet\b/i.test(rel) || !cssHref || cssHref.includes("css/styles.css")) continue;
          try {
            const fullUrl = new URL(cssHref, referenceUrl || destinationUrl).href;
            const res = await fetch(fullUrl);
            if (res.ok) {
              const text = (await res.text()).replace(
                /url\(\s*(["']?)(?!data:|https?:|\/\/|#)([^"')]+)\1\s*\)/gi,
                (_match, quote, assetPath) => `url(${quote}${new URL(assetPath.trim(), fullUrl).href}${quote})`,
              );
              cssContent += text + "\n\n";
              downloadedStyleTags.add(tag);
            }
          } catch (_) {}
        }
      }

      // Inline styles are moved to a real local file. Only external links successfully copied
      // into that file are removed; failed links remain usable as remote fallbacks.
      html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
      downloadedStyleTags.forEach((tag) => { html = html.replace(tag, ""); });

      if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, '<head>\n  <link rel="stylesheet" href="./css/styles.css">');
      } else {
        html = '<link rel="stylesheet" href="./css/styles.css">\n' + html;
      }

      // 2. Extract Base64 images and save to images/ folder
      const imagesFolder = zip.folder("images");
      let imgCount = 0;
      const dataUriRegex = /data:(image\/[a-zA-Z0-9\+\-\.]+);base64,([a-zA-Z0-9\+\/=\s]+)/g;
      
      const replacedHtml = html.replace(dataUriRegex, (matchStr, mimeType, base64Data) => {
        imgCount++;
        const ext = mimeType.split("/")[1]?.replace("+xml", "") || "png";
        const filename = `img-${imgCount}.${ext}`;
        const cleanBase64 = base64Data.replace(/\s/g, "");
        if (imagesFolder) {
          imagesFolder.file(filename, cleanBase64, { base64: true });
        }
        return `./images/${filename}`;
      });

      const replacedCss = cssContent.replace(dataUriRegex, (matchStr, mimeType, base64Data) => {
        imgCount++;
        const ext = mimeType.split("/")[1]?.replace("+xml", "") || "png";
        const filename = `img-${imgCount}.${ext}`;
        const cleanBase64 = base64Data.replace(/\s/g, "");
        if (imagesFolder) {
          imagesFolder.file(filename, cleanBase64, { base64: true });
        }
        return `../images/${filename}`;
      });

      // Save css/styles.css in ZIP
      if (replacedCss.trim()) {
        zip.file("css/styles.css", replacedCss.trim());
      } else {
        // Fallback default CSS if no style was found
        zip.file("css/styles.css", "/* Hostinger Presell Styles */\nbody { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }\nimg { max-width: 100%; height: auto; }\n.container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 15px; }");
      }

      // 3. Add index.html to zip
      zip.file("index.html", replacedHtml);

      // If thankYouHtml exists (and not #obrigado modal), add thank-you page as well
      if (thankYouHtml && thankYouFileName) {
        let tyHtml = thankYouHtml;
        if (cssContent.trim() && !/<link[^>]+styles\.css/i.test(tyHtml)) {
          tyHtml = tyHtml.replace(/<head>/i, '<head>\n  <link rel="stylesheet" href="css/styles.css">');
        }
        zip.file(thankYouFileName.replace(/^\.\//, ""), tyHtml);
      }

      // If lemonPhpHtml exists (LemonAd network selected), add the server-side lead handler
      if (lemonPhpHtml && lemonPhpFileName) {
        zip.file(lemonPhpFileName.replace(/^\.\//, ""), lemonPhpHtml);
      }

      // 4. Generate zip blob and trigger download
      let domain = "presell";
      try { domain = new URL(destinationUrl).hostname.replace("www.", "").split(".")[0]; } catch (_) {}
      
      const prefix = selectedOption === "a" ? "hostinger-cookie" : "hostinger-clone";
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${prefix}-${domain}.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast({
        title: "Pacote ZIP pronto",
        description: (lemonPhpHtml && lemonPhpFileName)
          ? "Descompacte num hosting com PHP ativo. Inclui lemon.php — sem suporte a PHP o formulário de lead não vai funcionar."
          : "Descompacte na Hostinger (hPanel). Arquivos index.html, css/ e images/ criados!"
      });
    } catch (err: any) {
      toast({ title: "Erro ao gerar pacote ZIP", description: err.message, variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    if (!generatedHtml || !currentWebsiteId || isPublishing) return;
    setIsPublishing(true);
    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch("/api/publish-bridge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          htmlContent: generatedHtml,
          presellId: currentWebsiteId,
          pageName: productName || new URL(destinationUrl).hostname,
          thankYouHtml,
          thankYouFileName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível publicar a página.");
      const absoluteUrl = new URL(data.url, window.location.origin).href;
      setPublishedUrl(absoluteUrl);
      setSavedWebsites((current) => current.map((site) => site.id === currentWebsiteId
        ? { ...site, publishedUrl: absoluteUrl, fileName: data.url, status: "active" }
        : site));
      toast({ title: "Página publicada", description: "O link já está disponível em Minhas Presells." });
    } catch (err: any) {
      toast({ title: "Erro ao publicar", description: err.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  };

  const updateWebsiteStatus = async (site: SavedWebsite) => {
    const nextStatus = site.status === "paused" ? "active" : "paused";
    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch(`/api/presells/${site.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível alterar o status.");
      setSavedWebsites((current) => current.map((item) => item.id === site.id ? { ...item, status: nextStatus } : item));
      toast({ title: nextStatus === "paused" ? "Presell pausada" : "Presell ativada" });
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    }
  };

  const copyPublishedUrl = async (url: string) => {
    const absoluteUrl = new URL(url, window.location.origin).href;
    await navigator.clipboard.writeText(absoluteUrl);
    toast({ title: "Link copiado" });
  };

  const deleteWebsite = async (site: SavedWebsite) => {
    const token = localStorage.getItem("ads_token");
    try {
      const response = await fetch(`/api/presells/${site.id}`, {
        method: "DELETE",
        headers: { "Authorization": token ? `Bearer ${token}` : "" }
      });
      if (response.ok) {
        setSavedWebsites(savedWebsites.filter(s => s.id !== site.id));
        toast({ title: "Presell Excluída 🗑️", description: "O redirecionador foi excluído do histórico com sucesso." });
      } else {
        throw new Error("Erro ao excluir do servidor.");
      }
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
  };

  const getTagCount = () => scripts.filter(s => s.trim() !== "").length;
  const handleBackToEdit = () => { setStep("form"); setPublishedUrl(""); };

  const filteredWebsites = savedWebsites;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-background [&_svg]:hidden">
      <Dialog open={showAdvanced} onOpenChange={(open) => { setShowAdvanced(open); if (!open) setAdvancedStep(1); }}>
        <DialogContent className="max-w-lg rounded-3xl border border-border bg-background p-0 shadow-2xl [&>button]:hidden">
          <DialogTitle className="sr-only">Configurar integração</DialogTitle>
          <DialogDescription className="sr-only">Selecione uma integração e informe suas credenciais.</DialogDescription>
          <div className="border-b border-border px-7 py-5">
            <p className="text-xs font-semibold text-primary">Etapa {advancedStep} de 2</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {advancedStep === 1 ? "Escolha a integração" : pendingLeadNetwork === "drcash" ? "Configurar Dr. Cash" : "Configurar Lemon Ads"}
            </h2>
          </div>

          {advancedStep === 1 ? (
            <div className="space-y-3 px-7 py-8">
              {(["drcash", "lemonad"] as const).map((network) => (
                <button
                  key={network}
                  type="button"
                  onClick={() => setPendingLeadNetwork(network)}
                  className={`flex h-14 w-full items-center rounded-2xl border px-5 text-left text-sm font-semibold transition-colors ${pendingLeadNetwork === network ? "border-primary bg-primary/[0.06] text-primary" : "border-border bg-background text-foreground hover:border-primary/35"}`}
                >
                  {network === "drcash" ? "Dr. Cash" : "Lemon Ads"}
                </button>
              ))}
              {pendingLeadNetwork !== "none" && (
                <button type="button" onClick={() => { setPendingLeadNetwork("none"); setLeadNetwork("none"); setShowAdvanced(false); }} className="px-1 pt-2 text-xs text-muted-foreground hover:text-foreground">
                  Remover integração
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5 px-7 py-8">
              {pendingLeadNetwork === "drcash" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="modal-api-token">API Token</Label>
                    <Input id="modal-api-token" value={apiToken} onChange={(e) => setApiToken(e.target.value)} className="h-12 rounded-xl bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="modal-stream-code">Stream code</Label>
                    <Input id="modal-stream-code" value={streamCode} onChange={(e) => setStreamCode(e.target.value)} className="h-12 rounded-xl bg-background" />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="modal-offer-id">Offer ID</Label>
                    <Input id="modal-offer-id" value={lemonOfferId} onChange={(e) => setLemonOfferId(e.target.value)} className="h-12 rounded-xl bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="modal-cost">Cost</Label>
                    <Input id="modal-cost" value={lemonCost} onChange={(e) => setLemonCost(e.target.value)} className="h-12 rounded-xl bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="modal-webmaster-token">Webmaster Token</Label>
                    <Input id="modal-webmaster-token" value={lemonWebmasterToken} onChange={(e) => setLemonWebmasterToken(e.target.value)} className="h-12 rounded-xl bg-background" />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
            <Button type="button" variant="ghost" className="h-12 rounded-full border border-border" onClick={() => advancedStep === 1 ? setShowAdvanced(false) : setAdvancedStep(1)}>
              {advancedStep === 1 ? "Cancelar" : "Voltar"}
            </Button>
            <Button
              type="button"
              className="h-12 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={advancedStep === 1 && pendingLeadNetwork === "none"}
              onClick={() => {
                if (advancedStep === 1) setAdvancedStep(2);
                else {
                  setLeadNetwork(pendingLeadNetwork);
                  setShowAdvanced(false);
                  setAdvancedStep(1);
                  toast({ title: "Integração adicionada" });
                }
              }}
            >
              {advancedStep === 1 ? "Próximo" : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Ambient background glows */}
      <div className="hidden">
        <div className="absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-1/2 -right-20 w-[400px] h-[400px] rounded-full bg-primary/[0.025] blur-[100px]" />
        <div className="absolute -bottom-20 left-1/3 w-[350px] h-[350px] rounded-full bg-primary/4 blur-[80px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] space-y-7 px-4 py-5 md:px-8 md:py-7">

        {/* ── Hero Header ─────────────────────────────────────── */}
        {step !== "generating" && step !== "done" && (
          <div className="hidden">
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

            {/* Mode Switcher */}
            <div className="flex bg-card border border-border p-1 rounded-xl gap-2 w-full md:w-fit mt-6 shadow-sm">
              <button
                type="button"
                onClick={() => { setActiveMode("redirect"); setStep("form"); }}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                  activeMode === "redirect"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                Redirecionador Inteligente
              </button>
              <button
                type="button"
                onClick={() => { setActiveMode("traffic"); }}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                  activeMode === "traffic"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Gestor de Tráfego
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { icon: Layers, label: "Presells Criadas", value: savedWebsites.length, color: "text-primary" },
                { icon: ShieldCheck, label: "Modelo Cookies", value: savedWebsites.filter(s => s.selectedOption === "a").length, color: "text-emerald-500" },
                { icon: Zap, label: "Modelo Clone", value: savedWebsites.filter(s => s.selectedOption === "b").length, color: "text-amber-500" },
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
        <div className="block">

          {/* ── LEFT: Form / Wizard ──────────────────────────── */}
          <div className={`mx-auto w-full max-w-3xl space-y-5 ${activeView === "create" ? "block" : "hidden"}`}>

            {activeMode === "redirect" && (
              <>
                {/* STEP: Form */}
                {step === "form" && (
              <div className="animate-slide-up">
                <Card className="border-0 bg-transparent shadow-none rounded-none overflow-visible">
                  {/* Card gradient top accent */}
                  <div className="hidden" />
                  <CardContent className="space-y-7 p-0">
                    <div className="sticky top-14 z-30 -mx-4 flex h-16 items-center gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur-xl md:mx-0 md:rounded-b-2xl">
                      <BackButton onClick={() => setActiveView("websites")} label="Voltar para minhas presells" iconOnly className="shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">Nova presell</p>
                        <p className="truncate text-xs text-muted-foreground">Redirecionamento</p>
                      </div>
                    </div>

                    <form onSubmit={handleGenerate} className="space-y-6 [&_input]:text-sm [&_textarea]:text-sm" autoComplete="off">

                      {/* Reference URL */}
                      <div className="space-y-2">
                        <Label htmlFor="reference-url" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          Página de referência
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
                            className="h-12 rounded-2xl border-border bg-background pl-9 text-sm shadow-none focus-visible:ring-primary placeholder:text-muted-foreground/55"
                            required
                          />
                        </div>
                      </div>

                      {/* Product Name (Optional) */}
                      <div className="space-y-2">
                        <Label htmlFor="product-name" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          Nome do produto <span className="font-normal text-muted-foreground">(opcional)</span>
                        </Label>
                        <div className="relative">
                          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="product-name"
                            type="text"
                            placeholder="Ex: Reulex (Se vazio, tenta extrair do site)"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            className="h-12 rounded-2xl border-border bg-background pl-9 text-sm shadow-none focus-visible:ring-primary placeholder:text-muted-foreground/55"
                          />
                        </div>
                      </div>

                      {/* Paste HTML Bypass */}
                      <div className="space-y-1.5 pt-1">
                        <Label htmlFor="raw-html" className="flex items-center gap-1 text-sm font-medium text-foreground">
                          Código HTML <span className="font-normal text-muted-foreground">(opcional)</span>
                        </Label>
                        <Textarea
                          id="raw-html"
                          placeholder="Cole o código-fonte HTML completo da página se o robô do servidor for bloqueado pelo rastreador (bot protection)"
                          value={rawHtml}
                          onChange={(e) => setRawHtml(e.target.value)}
                          className="min-h-24 resize-y rounded-2xl border-border bg-background text-sm shadow-none placeholder:text-muted-foreground/55"
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
                              className={`group relative rounded-2xl border p-5 cursor-pointer transition-colors ${
                                selectedOption === key
                                  ? "border-primary bg-primary/[0.05]"
                                  : "border-border bg-background hover:border-primary/35"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="hidden">
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
                                <p className="hidden">{badge}</p>
                                <p className="hidden">{desc}</p>
                                <div className="hidden">
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

                        {selectedOption === "b" && (
                          <label
                            htmlFor="keep-original-structure"
                            className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/20 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                          >
                            <input
                              id="keep-original-structure"
                              type="checkbox"
                              checked={keepOriginalStructure}
                              onChange={(e) => setKeepOriginalStructure(e.target.checked)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary cursor-pointer"
                            />
                            <span className="text-xs font-medium text-foreground">Manter estrutura original da página</span>
                          </label>
                        )}
                      </div>

                      {/* Language Selection */}
                      <div className="space-y-2">
                        <Label htmlFor="popup-language" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-black">3</span>
                          Idioma do Pop-up de Cookies
                        </Label>
                        <Select value={popupLanguage} onValueChange={setPopupLanguage}>
                          <SelectTrigger id="popup-language" className="h-11 rounded-xl border-border bg-background text-xs shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-border bg-popover">
                            <SelectItem value="auto">Detectar automaticamente</SelectItem>
                            <SelectItem value="pt-BR">Português — Brasil</SelectItem>
                            <SelectItem value="pt-PT">Português — Portugal</SelectItem>
                            <SelectItem value="es">Espanhol</SelectItem>
                            <SelectItem value="en">Inglês</SelectItem>
                            <SelectItem value="it">Italiano</SelectItem>
                            <SelectItem value="fr">Francês</SelectItem>
                            <SelectItem value="de">Alemão</SelectItem>
                            <SelectItem value="nl">Holandês</SelectItem>
                            <SelectItem value="sv">Sueco</SelectItem>
                            <SelectItem value="da">Dinamarquês</SelectItem>
                            <SelectItem value="fi">Finlandês</SelectItem>
                            <SelectItem value="no">Norueguês</SelectItem>
                            <SelectItem value="ro">Romeno</SelectItem>
                            <SelectItem value="pl">Polonês</SelectItem>
                            <SelectItem value="ar">Árabe</SelectItem>
                            <SelectItem value="he">Hebraico</SelectItem>
                            <SelectItem value="th">Tailandês</SelectItem>
                            <SelectItem value="ja">Japonês</SelectItem>
                          </SelectContent>
                        </Select>
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
                        onClick={() => { setPendingLeadNetwork(leadNetwork); setAdvancedStep(1); setShowAdvanced(true); }}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/35"
                      >
                        <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                          <Code className="h-3.5 w-3.5 text-primary" />
                          Opções Avançadas
                        </span>
                        <span className={`text-[10px] font-bold transition-colors ${showAdvanced ? "text-primary" : "text-muted-foreground"}`}>
                          {leadNetwork === "none" ? "Configurar" : leadNetwork === "drcash" ? "Dr. Cash" : "Lemon Ads"}
                        </span>
                      </button>

                      {/* Advanced fields */}
                      {false && (
                        <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-4 animate-slide-up">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Rede de Geração de Lead (Opção B)</p>

                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { key: "none" as const, label: "Nenhuma" },
                              { key: "drcash" as const, label: "Dr.Cash" },
                              { key: "lemonad" as const, label: "LemonAd" },
                            ]).map(({ key, label }) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setLeadNetwork(key)}
                                className={`rounded-lg h-9 text-[11px] font-bold border transition-colors ${
                                  leadNetwork === key
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted/30 text-muted-foreground border-border hover:text-foreground"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          {leadNetwork === "drcash" && (
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
                          )}

                          {leadNetwork === "lemonad" && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <Label htmlFor="lemon-offer-id" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                    <ShieldCheck className="h-3 w-3 text-primary" /> Offer ID
                                  </Label>
                                  <Input id="lemon-offer-id" type="text" placeholder="Ex: 96af8850-cbee-..." value={lemonOfferId}
                                    onChange={(e) => setLemonOfferId(e.target.value)}
                                    className="rounded-lg h-9 bg-muted/30 border-border text-xs font-mono" />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="lemon-cost" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                    <Tag className="h-3 w-3 text-primary" /> Custo (Price)
                                  </Label>
                                  <Input id="lemon-cost" type="text" placeholder="Ex: 780" value={lemonCost}
                                    onChange={(e) => setLemonCost(e.target.value)}
                                    className="rounded-lg h-9 bg-muted/30 border-border text-xs font-mono" />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="lemon-token" className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                  <Link className="h-3 w-3 text-primary" /> Webmaster Token
                                </Label>
                                <Input id="lemon-token" type="text" placeholder="Token do seu perfil na LemonAd" value={lemonWebmasterToken}
                                  onChange={(e) => setLemonWebmasterToken(e.target.value)}
                                  className="rounded-lg h-9 bg-muted/30 border-border text-xs font-mono" />
                              </div>
                              <p className="text-[10px] text-muted-foreground leading-relaxed">
                                Gera um <code className="font-mono">lemon.php</code> junto com a página (só na Opção B, sem "Manter estrutura original") — exige hospedagem com PHP.
                                {selectedOption !== "b" && <span className="text-amber-500 font-semibold"> Selecione a Opção B acima para ativar.</span>}
                                {selectedOption === "b" && keepOriginalStructure && <span className="text-amber-500 font-semibold"> Desmarque "Manter estrutura original" para ativar.</span>}
                              </p>
                            </div>
                          )}
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
                <div className="mx-auto max-w-xl py-20 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Construindo</p>
                  <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{generatingMessage.replace(/^[^\p{L}\p{N}]+/u, "")}</h3>
                  <div className="mx-auto mt-10 grid max-w-sm grid-cols-3 gap-2" aria-label="Progresso da criação">
                    {[0, 1, 2].map((item) => (
                      <span key={item} className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                        <span className="block h-full origin-left animate-pulse rounded-full bg-primary" style={{ animationDelay: `${item * 220}ms` }} />
                      </span>
                    ))}
                  </div>
                  <p className="mx-auto mt-6 max-w-sm text-sm leading-6 text-muted-foreground">Organizando a estrutura, os estilos e os links finais.</p>
                </div>
              </div>
            )}

            {/* STEP: Done */}
            {step === "done" && (
              <div className="animate-slide-up">
                <div className="mx-auto max-w-xl py-20 text-center">
                  <div className="mx-auto h-1.5 max-w-sm overflow-hidden rounded-full bg-primary/10">
                    <div className="h-full w-full animate-pulse rounded-full bg-primary" />
                  </div>
                  <h3 className="mt-7 text-2xl font-semibold tracking-tight text-foreground">Página pronta</h3>
                  <p className="mt-2 text-sm text-muted-foreground">Abrindo as opções finais.</p>
                </div>
              </div>
            )}

            {/* STEP: Actions */}
            {step === "actions" && (
              <div className="space-y-4 animate-slide-up">
                <Card className="border-0 bg-transparent shadow-none rounded-none overflow-visible">
                  <CardContent className="space-y-7 p-0">
                    <div className="flex items-start justify-between gap-4 border-b border-border pb-6">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Página pronta</p>
                        <h3 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Instale ou publique</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Escolha onde deseja usar a nova presell.</p>
                      </div>
                      <BackButton onClick={handleBackToEdit} label="Editar configuração" />
                    </div>

                    {/* Summary */}
                    <div className="space-y-2 border-y border-border py-5 text-xs">
                      {[
                        { label: "Modelo", value: selectedOption === "b" ? "Clone limpo" : "Cookies" },
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
                          <p className="text-[11px] leading-relaxed text-muted-foreground">{designSummary}</p>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="lg" className="h-12 w-full rounded-full border-primary/25 text-sm font-semibold text-primary hover:bg-primary/[0.06]">
                            Download
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64 rounded-2xl border-border p-2 shadow-xl">
                          <DropdownMenuItem onClick={handleDownloadHostingerZip} className="cursor-pointer rounded-xl px-4 py-3 text-sm">
                            Pacote ZIP
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={handleDownload} className="cursor-pointer rounded-xl px-4 py-3 text-sm">
                            Arquivo HTML
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="lg" onClick={handlePublish} disabled={isPublishing || Boolean(publishedUrl)} className="h-12 rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                        {isPublishing ? "Publicando..." : publishedUrl ? "Publicado" : "Publicar"}
                      </Button>
                    </div>

                    {publishedUrl && (
                      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground">Link público</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{publishedUrl}</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => copyPublishedUrl(publishedUrl)} className="h-9 rounded-full border border-border px-4 text-xs font-medium hover:border-primary/30">Copiar</button>
                          <a href={publishedUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full border border-border px-4 text-xs font-medium hover:border-primary/30">Acessar</a>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
              </>
            )}

            {/* Traffic Manager Chat Panel */}
            {activeMode === "traffic" && (
              <div className="space-y-4 animate-slide-up">
                <Card className="border border-border bg-card shadow-md rounded-2xl overflow-hidden">
                  <div className="h-1 w-full bg-primary" />
                  <CardContent className="p-6 space-y-4 flex flex-col h-[640px]">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <div>
                        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                          Gestor de Tráfego
                        </h2>
                        <p className="text-[10px] text-muted-foreground">Google Ads e Meta Ads para produtos de afiliados — campanhas, copy, keywords e diagnóstico.</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={handleTrafficChatReset} className="h-7 text-[10px] rounded-lg text-muted-foreground hover:text-foreground">
                        Resetar Chat
                      </Button>
                    </div>

                    {/* Chat Messages Log */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                      {trafficChatMessages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl p-3 leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-tr-none"
                              : "bg-muted/80 text-foreground rounded-tl-none border border-border/40"
                          }`}>
                            <p className="font-semibold text-[10px] opacity-80 mb-1">
                              {msg.role === "user" ? "Você" : "Gestor de Tráfego"}
                            </p>
                            <p className="whitespace-pre-line text-[11px]">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {isTrafficChatSending && (
                        <div className="flex justify-start">
                          <div className="bg-muted/60 text-muted-foreground rounded-2xl rounded-tl-none p-3 border border-border/30 max-w-[85%] flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary mr-1" />
                            <span className="text-[10px] font-medium">Pensando na melhor estratégia...</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Chat Input form */}
                    <form onSubmit={handleTrafficChatSend} className="flex gap-2 pt-2 border-t border-border/40">
                      <Input
                        type="text"
                        placeholder="Ex: Quero criar uma campanha do zero para meu produto..."
                        value={trafficChatInput}
                        onChange={(e) => setTrafficChatInput(e.target.value)}
                        className="rounded-xl h-10 text-xs bg-muted/40 border-border focus-visible:ring-primary placeholder:text-muted-foreground/60 flex-1"
                        disabled={isTrafficChatSending}
                        required
                      />
                      <Button type="submit" size="sm" className="rounded-xl h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/95" disabled={isTrafficChatSending}>
                        Enviar
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* ── RIGHT: Bridge History Table ──────────────────── */}
          <div className={`mx-auto w-full max-w-6xl ${activeView === "websites" ? "block" : "hidden"}`}>
            <Card className="border-0 bg-transparent shadow-none rounded-none overflow-visible h-full">
              <div className="hidden" />
              <CardContent className="p-0 space-y-8">
                {/* Table header */}
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-3xl font-semibold tracking-tight text-foreground">Presells</h3>
                    <button
                      type="button"
                      onClick={() => { setActiveView("create"); setStep("form"); }}
                      className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Criar presell
                    </button>
                  </div>
                  <div className="grid grid-cols-3 border-y border-border">
                    {[
                      ["Total", savedWebsites.length],
                      ["Cookies", savedWebsites.filter((site) => site.selectedOption === "a").length],
                      ["Clone", savedWebsites.filter((site) => site.selectedOption === "b").length],
                    ].map(([label, value], index) => (
                      <div key={String(label)} className={`py-5 ${index > 0 ? "border-l border-border pl-5" : ""}`}>
                        <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Empty state */}
                {filteredWebsites.length === 0 ? (
                  <div className="flex min-h-48 flex-col items-center justify-center border-b border-border py-12 text-center">
                    <p className="text-sm font-semibold text-foreground">Nenhuma presell criada ainda</p>
                    <button
                      onClick={() => { setActiveView("create"); setStep("form"); }}
                      className="mt-5 h-11 rounded-full border border-primary/25 px-6 text-sm font-semibold text-primary hover:bg-primary/[0.06]"
                    >
                      Criar a primeira
                    </button>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                       <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent bg-muted/30 border-b border-border/60">
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground">Presell / Destino</TableHead>
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground">Modelo</TableHead>
                            <TableHead className="py-3 text-[11px] font-bold text-muted-foreground text-center">Data</TableHead>
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
                                      {site.publishedUrl || site.destinationUrl}
                                    </span>
                                    <span className="mt-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                                      {site.status === "paused" ? "Pausada" : site.publishedUrl ? "Publicada" : "Local"}
                                    </span>
                                  </div>
                                </TableCell>

                                <TableCell className="py-3">
                                  <div className="flex flex-col gap-1">
                                    <Badge variant="outline" className={`text-[8px] font-bold uppercase tracking-wider w-fit ${
                                      site.selectedOption === "b"
                                        ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                                        : site.selectedOption === "review"
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                                    }`}>
                                      {site.selectedOption === "b" ? "Clone" : site.selectedOption === "review" ? "Review" : "Cookies"}
                                    </Badge>
                                  </div>
                                </TableCell>

                                <TableCell className="py-3 text-center">
                                  <span className="text-[11px] text-muted-foreground font-mono font-medium">
                                    {site.createdAt}
                                  </span>
                                </TableCell>

                                <TableCell className="py-3 text-right pr-4">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button type="button" aria-label="Abrir ações da presell" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-muted-foreground hover:border-border hover:bg-muted/40">
                                        <span className="flex gap-[3px]" aria-hidden="true"><span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" /><span className="h-1 w-1 rounded-full bg-current" /></span>
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48 rounded-2xl border-border p-2 shadow-xl">
                                      {site.publishedUrl && (
                                        <>
                                          <DropdownMenuItem onClick={() => window.open(new URL(site.publishedUrl, window.location.origin).href, "_blank", "noopener,noreferrer")} className="cursor-pointer rounded-xl px-3 py-2.5 text-sm">
                                            Acessar
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => copyPublishedUrl(site.publishedUrl)} className="cursor-pointer rounded-xl px-3 py-2.5 text-sm">
                                            Copiar link
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => updateWebsiteStatus(site)} className="cursor-pointer rounded-xl px-3 py-2.5 text-sm">
                                            {site.status === "paused" ? "Ativar" : "Pausar"}
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                        </>
                                      )}
                                      <DropdownMenuItem onClick={() => deleteWebsite(site)} className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-destructive focus:text-destructive">
                                        Excluir
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
