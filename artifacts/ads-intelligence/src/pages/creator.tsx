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
  productName?: string;
  productHeadline?: string;
  productDescription?: string;
  productCategory?: string;
  ctaText?: string;
  supportEmail?: string;
  apiToken?: string;
  streamCode?: string;
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

const LOCALIZED_TEXT: Record<string, {
  partnerApproved: string;
  privacy: string;
  terms: string;
  contact: string;
  disclaimer: string;
  copyright: string;
  privacyTitle: string;
  privacyP1: string;
  privacyP2: string;
  privacyP3: string;
  privacyP4: string;
  termsTitle: string;
  termsP1: string;
  termsP2: string;
  termsP3: string;
  termsP4: string;
  contactTitle: string;
  contactP1: string;
  contactP2: string;
  contactP3: string;
  seoHeaderTitle: string;
  seoHeaderCategory: string;
  seoWelcome: string;
  seoDescriptionDefault: string;
  seoWhyTitle: string;
  seoWhyDesc: string;
  seoLi1Title: string;
  seoLi1Desc: string;
  seoLi2Title: string;
  seoLi2Desc: string;
  seoLi3Title: string;
  seoLi3Desc: string;
  seoDeliveryTitle: string;
  seoDeliveryDesc: string;
}> = {
  "pt-BR": {
    partnerApproved: "Parceiro Autorizado",
    privacy: "Política de Privacidade",
    terms: "Termos de Uso",
    contact: "Contato",
    disclaimer: "Aviso Legal: Este site é um canal de redirecionamento informativo e não possui vínculos diretos ou de afiliação de patrocínio com o Google LLC, Google Ads ou Facebook Ads.",
    copyright: "Todos os direitos reservados.",
    privacyTitle: "Política de Privacidade",
    privacyP1: "Sua privacidade é muito importante para nós. Esta Política de Privacidade descreve como suas informações pessoais são tratadas ao usar este site de redirecionamento.",
    privacyP2: "<strong>Coleta de Informações:</strong> Não coletamos informações de identificação pessoal neste site de redirecionamento, exceto eventuais dados anônimos de tráfego fornecidos por cookies de terceiros (como Google Analytics ou pixels de rastreamento) se ativados pelo proprietário.",
    privacyP3: "<strong>Links para Terceiros:</strong> Este site contém links redirecionando para sites externos. Não temos controle sobre as políticas de privacidade desses sites de terceiros, por isso recomendamos a leitura das políticas deles ao acessá-los.",
    privacyP4: "Ao utilizar nosso site de redirecionamento, você concorda com os termos aqui dispostos.",
    termsTitle: "Termos de Uso",
    termsP1: "Seja bem-vindo ao nosso site de redirecionamento.",
    termsP2: "<strong>Aceitação dos Termos:</strong> Ao utilizar este site, você concorda em cumprir e estar vinculado a estes Termos de Uso. Se você não concordar com qualquer parte destes termos, não utilize o site.",
    termsP3: "<strong>Uso do Site:</strong> Este site tem como objetivo fornecer um canal informativo seguro de redirecionamento para o site oficial do produto. Você concorda em não tentar violar a segurança do site, usar robôs de scraping ou praticar qualquer atividade ilícita aqui.",
    termsP4: "<strong>Limitação de Responsabilidade:</strong> Não nos responsabilizamos por qualquer compra realizada no site de destino final. Toda a transação comercial é de responsabilidade exclusiva do fornecedor oficial do produto ou serviço acessado.",
    contactTitle: "Contato",
    contactP1: "Precisa de suporte ou tem alguma dúvida técnica em relação a este redirecionador?",
    contactP2: "Entre em contato conosco pelo e-mail oficial abaixo:",
    contactP3: "Responderemos o mais breve possível.",
    seoHeaderTitle: "Site Oficial do Distribuidor Autorizado",
    seoHeaderCategory: "Categoria:",
    seoWelcome: "Seja bem-vindo à página de distribuição oficial.",
    seoDescriptionDefault: "Oferecemos produtos de alta qualidade, fabricados sob os mais rigorosos padrões de segurança e controle. Compre com total segurança e garantia de satisfação direta do fabricante.",
    seoWhyTitle: "Por que Adquirir o",
    seoWhyDesc: "Ao comprar através do canal oficial, você garante acesso às promoções exclusivas, suporte ao cliente dedicado e produtos com certificações originais de laboratório.",
    seoLi1Title: "Garantia de Satisfação:",
    seoLi1Desc: "Proteção total para sua compra direta.",
    seoLi2Title: "Frete Seguro:",
    seoLi2Desc: "Entrega rápida acompanhada de código de rastreamento.",
    seoLi3Title: "Compra Protegida:",
    seoLi3Desc: "Seus dados financeiros totalmente seguros.",
    seoDeliveryTitle: "Como Funciona a Entrega?",
    seoDeliveryDesc: "Nossa logística é otimizada para despachar os pedidos em tempo recorde. Você receberá atualizações constantes sobre o status de envio diretamente no seu e-mail cadastrado ou WhatsApp no momento da compra no site oficial."
  },
  "en": {
    partnerApproved: "Authorized Partner",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    contact: "Contact Us",
    disclaimer: "Disclaimer: This website is an informative redirect channel and has no direct links or sponsorship affiliation with Google LLC, Google Ads, or Facebook Ads.",
    copyright: "All rights reserved.",
    privacyTitle: "Privacy Policy",
    privacyP1: "Your privacy is very important to us. This Privacy Policy describes how your personal information is handled when using this redirect site.",
    privacyP2: "<strong>Information Collection:</strong> We do not collect personally identifiable information on this redirect site, except for any anonymous traffic data provided by third-party cookies (such as Google Analytics or tracking pixels) if enabled by the owner.",
    privacyP3: "<strong>Links to Third Parties:</strong> This site contains links redirecting to external sites. We have no control over the privacy policies of these third-party sites, so we recommend reading their policies when accessing them.",
    privacyP4: "By using our redirect site, you agree to the terms set forth herein.",
    termsTitle: "Terms of Use",
    termsP1: "Welcome to our redirect site.",
    termsP2: "<strong>Acceptance of Terms:</strong> By using this site, you agree to comply with and be bound by these Terms of Use. If you do not agree with any part of these terms, do not use the site.",
    termsP3: "<strong>Use of the Site:</strong> This site aims to provide a secure informative redirect channel to the official product page. You agree not to attempt to violate the security of the site, use scraping robots, or practice any illegal activity here.",
    termsP4: "<strong>Limitation of Liability:</strong> We are not responsible for any purchases made on the final destination site. All commercial transactions are the sole responsibility of the official supplier of the product or service accessed.",
    contactTitle: "Contact Us",
    contactP1: "Need support or have any technical questions regarding this redirector?",
    contactP2: "Please contact us via the official email address below:",
    contactP3: "We will reply as soon as possible.",
    seoHeaderTitle: "Official Authorized Distributor Site",
    seoHeaderCategory: "Category:",
    seoWelcome: "Welcome to the official distribution page.",
    seoDescriptionDefault: "We offer high-quality products, manufactured under the strictest safety and quality standards. Buy with complete safety and direct satisfaction guarantee from the manufacturer.",
    seoWhyTitle: "Why Buy",
    seoWhyDesc: "When buying through the official channel, you guarantee access to exclusive promotions, dedicated customer support, and products with original laboratory certifications.",
    seoLi1Title: "Satisfaction Guarantee:",
    seoLi1Desc: "Total protection for your direct purchase.",
    seoLi2Title: "Secure Shipping:",
    seoLi2Desc: "Fast delivery accompanied by a tracking code.",
    seoLi3Title: "Protected Purchase:",
    seoLi3Desc: "Your financial data is completely secure.",
    seoDeliveryTitle: "How Does Delivery Work?",
    seoDeliveryDesc: "Our logistics are optimized to dispatch orders in record time. You will receive constant updates on shipping status directly to your registered email or WhatsApp at the time of purchase on the official website."
  },
  "es": {
    partnerApproved: "Socio Autorizado",
    privacy: "Política de Privacidad",
    terms: "Términos de Uso",
    contact: "Contacto",
    disclaimer: "Aviso Legal: Este sitio es un canal de redirección informativo y no tiene vínculos directos ni de afiliación de patrocinio con Google LLC, Google Ads o Facebook Ads.",
    copyright: "Todos los derechos reservados.",
    privacyTitle: "Política de Privacidad",
    privacyP1: "Su privacidad es muy importante para nosotros. Esta Política de Privacidad de describe cómo se maneja su información personal al utilizar este sitio de redirección.",
    privacyP2: "<strong>Recopilación de Información:</strong> No recopilamos información de identificación personal en este sitio de redirección, excepto eventuales datos de tráfico anónimos proporcionados por cookies de terceros (como Google Analytics o píxeles de seguimiento) si el propietario los habilita.",
    privacyP3: "<strong>Enlaces a Terceros:</strong> Este sitio contiene enlaces que redireccionan a sitios externos. No tenemos control sobre las políticas de privacidad de estos sitios de terceros, por lo que recomendamos leer sus políticas al acceder a ellos.",
    privacyP4: "Al utilizar nuestro sitio de redirección, acepta los términos aquí establecidos.",
    termsTitle: "Términos de Uso",
    termsP1: "Bienvenido a nuestro sitio de redirección.",
    termsP2: "<strong>Aceptación de los Términos:</strong> Al utilizar este sitio, acepta cumplir y estar sujeto a estos Términos de Uso. Si no está de acuerdo con alguna parte de estos términos, no utilice el sitio.",
    termsP3: "<strong>Uso del Sitio:</strong> Este sitio tiene como objetivo proporcionar un canal de redirección informativo seguro a la página oficial del producto. Acepta no intentar violar la seguridad del sitio, utilizar robots de scraping ni realizar ninguna actividad ilegal aquí.",
    termsP4: "<strong>Limitación de Responsabilidad:</strong> No nos hacemos responsables de las compras realizadas en el sitio de destino final. Toda transacción comercial es responsabilidad exclusiva del proveedor oficial del producto o servicio accedido.",
    contactTitle: "Contacto",
    contactP1: "¿Necesita soporte o tiene alguna duda técnica sobre este redireccionador?",
    contactP2: "Póngase en contacto con nosotros a través del correo electrónico oficial a continuación:",
    contactP3: "Responderemos lo antes posible.",
    seoHeaderTitle: "Sitio Oficial del Distribuidor Autorizado",
    seoHeaderCategory: "Categoría:",
    seoWelcome: "Bienvenido a la página oficial de distribución.",
    seoDescriptionDefault: "Ofrecemos productos de alta calidad, fabricados bajo las más estrictas normas de seguridad y control. Compre con total seguridad y garantía de satisfacción directa del fabricante.",
    seoWhyTitle: "Por qué comprar",
    seoWhyDesc: "Al comprar a través del canal oficial, se garantiza el acceso a promociones exclusivas, soporte al cliente dedicado y productos con certificaciones originales de laboratorio.",
    seoLi1Title: "Garantía de Satisfacción:",
    seoLi1Desc: "Protección total para su compra directa.",
    seoLi2Title: "Envío Seguro:",
    seoLi2Desc: "Entrega rápida acompañada de un código de seguimiento.",
    seoLi3Title: "Compra Protegida:",
    seoLi3Desc: "Sus datos financieros están completamente seguros.",
    seoDeliveryTitle: "¿Cómo funciona la entrega?",
    seoDeliveryDesc: "Nuestra logística está optimizada para despachar los pedidos en tiempo récord. Recibirá actualizaciones constantes sobre el estado del envío directamente en su correo electrónico registrado o WhatsApp al momento de la compra en el sitio web oficial."
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
  const [productName, setProductName] = useState("");
  const [productHeadline, setProductHeadline] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productCategory, setProductCategory] = useState("Saúde & Bem-estar");
  const [ctaText, setCtaText] = useState("Ir para o Site Oficial");
  const [supportEmail, setSupportEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [streamCode, setStreamCode] = useState("");
  
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

    // Fetch default API token
    const fetchDefaultToken = async () => {
      try {
        const token = localStorage.getItem("ads_token");
        const res = await fetch("/api/drcash/token", {
          headers: {
            "Authorization": token ? `Bearer ${token}` : ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            setApiToken(data.token);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar token Dr. Cash", err);
      }
    };
    fetchDefaultToken();
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

    // Extract dynamic clean product name from target URL if product name is empty
    let cleanProductName = productName.trim();
    if (!cleanProductName) {
      try {
        const parts = domainName.split(".");
        if (parts.length > 0) {
          cleanProductName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        }
      } catch (_) {
        cleanProductName = "Produto Oficial";
      }
    }

    // Concatenate non-empty scripts
    const combinedTags = scripts.filter(s => s.trim() !== "").join("\n    ");

    const t = LOCALIZED_TEXT[popupLanguage] || LOCALIZED_TEXT["pt-BR"];

    const template = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${cleanProductName} - ${t.partnerApproved}</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    ${combinedTags}
    <style>
        :root {
            --primary: #5850ec;
            --primary-hover: #453ec9;
            --primary-light: rgba(88, 80, 236, 0.1);
            --bg-gradient: linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%);
            --text-dark: #1f2937;
            --text-muted: #4b5563;
            --card-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.08), 0 15px 25px -10px rgba(0, 0, 0, 0.04);
            --border-glass: rgba(255, 255, 255, 0.6);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body, html {
            width: 100%;
            min-height: 100vh;
            background: var(--bg-gradient);
            font-family: 'Outfit', -apple-system, sans-serif;
            color: var(--text-dark);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        
        .main-content {
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 20px 100px;
        }

        .landing-container {
            display: grid;
            grid-template-columns: 1.1fr 1fr;
            gap: 40px;
            max-width: 1000px;
            width: 100%;
            align-items: center;
        }
        
        @media (max-width: 868px) {
            .landing-container {
                grid-template-columns: 1fr;
                gap: 32px;
                padding-bottom: 40px;
            }
        }
        
        /* Product Hero */
        .product-hero {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
        }
        .category-badge {
            background-color: var(--primary-light);
            color: var(--primary);
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 16px;
        }
        .product-hero h1 {
            font-size: 2.5rem;
            font-weight: 800;
            line-height: 1.25;
            color: var(--text-dark);
            margin-bottom: 16px;
            letter-spacing: -0.02em;
        }
        @media (max-width: 600px) {
            .product-hero h1 {
                font-size: 1.95rem;
            }
        }
        .product-desc {
            font-size: 1.05rem;
            line-height: 1.6;
            color: var(--text-muted);
            margin-bottom: 24px;
        }
        
        /* Benefits List */
        .benefits-list {
            display: flex;
            flex-direction: column;
            gap: 14px;
            width: 100%;
        }
        .benefit-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            font-size: 0.95rem;
            line-height: 1.5;
            color: var(--text-muted);
        }
        .check-icon {
            width: 20px;
            height: 20px;
            fill: #10b981;
            flex-shrink: 0;
            margin-top: 1px;
        }
        
        /* Form Card */
        .form-card {
            background: #ffffff;
            border-radius: 20px;
            padding: 32px;
            box-shadow: var(--card-shadow);
            border: 1px solid var(--border-glass);
            width: 100%;
            position: relative;
            overflow: hidden;
        }
        @media (max-width: 600px) {
            .form-card {
                padding: 24px;
            }
        }
        .form-header {
            margin-bottom: 24px;
            text-align: left;
        }
        .form-header h3 {
            font-size: 1.35rem;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 6px;
        }
        .form-header p {
            font-size: 0.85rem;
            color: var(--text-muted);
            line-height: 1.4;
        }
        
        /* Form Elements */
        .input-group {
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            text-align: left;
        }
        .input-group label {
            font-size: 0.72rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
        }
        .input-group input {
            width: 100%;
            padding: 11px 14px;
            border-radius: 10px;
            border: 1px solid #d1d5db;
            font-family: inherit;
            font-size: 0.92rem;
            color: var(--text-dark);
            transition: all 0.2s;
            background-color: #f9fafb;
        }
        .input-group input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(88, 80, 236, 0.15);
            background-color: #ffffff;
        }
        
        /* Submit Button */
        .submit-btn {
            width: 100%;
            background-color: var(--primary);
            color: #ffffff;
            border: none;
            padding: 13px 20px;
            border-radius: 10px;
            font-size: 0.95rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
            margin-top: 20px;
            box-shadow: 0 4px 6px -1px rgba(88, 80, 236, 0.15);
        }
        .submit-btn:hover {
            background-color: var(--primary-hover);
            transform: translateY(-1px);
            box-shadow: 0 8px 12px -2px rgba(88, 80, 236, 0.25);
        }
        .submit-btn:active {
            transform: translateY(0);
        }
        .arrow-icon {
            width: 18px;
            height: 18px;
            fill: currentColor;
            transition: transform 0.2s;
        }
        .submit-btn:hover .arrow-icon {
            transform: translateX(2px);
        }
        
        /* Alerts & Success State */
        .alert-box {
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 0.82rem;
            margin-top: 14px;
            text-align: left;
        }
        .error-alert {
            background-color: #fef2f2;
            color: #b91c1c;
            border: 1px solid #fca5a5;
        }
        
        .success-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: 16px 8px;
            animation: scaleIn 0.3s ease-out forwards;
        }
        .success-icon {
            width: 48px;
            height: 48px;
            border-radius: 9999px;
            background-color: #ecfdf5;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #10b981;
            margin-bottom: 14px;
            border: 1px solid #a7f3d0;
        }
        .success-icon svg {
            width: 24px;
            height: 24px;
            fill: currentColor;
        }
        .success-box h4 {
            font-size: 1.15rem;
            font-weight: 700;
            color: #065f46;
            margin-bottom: 10px;
        }
        .success-box p {
            font-size: 0.88rem;
            line-height: 1.45;
            color: var(--text-muted);
            margin-bottom: 14px;
        }
        .success-note {
            font-size: 0.78rem !important;
            font-weight: 600;
            color: var(--primary) !important;
        }
        
        /* Animations */
        @keyframes scaleIn {
            from { transform: scale(0.95); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        
        /* Footer/Legal overlay elements */
        .legal-bar {
            background-color: rgba(17, 24, 39, 0.95);
            backdrop-filter: blur(8px);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            color: #f3f4f6;
            font-size: 0.72rem;
            padding: 12px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 1000;
            flex-wrap: wrap;
            gap: 12px;
            width: 100%;
        }
        .legal-bar .disclaimer-text {
            color: #9ca3af;
            font-size: 0.65rem;
            max-width: 50%;
            text-align: left;
        }
        .legal-bar .links {
            display: flex;
            gap: 16px;
        }
        .legal-bar .links a {
            color: #818cf8;
            text-decoration: none;
            font-weight: 600;
        }
        .legal-bar .links a:hover {
            text-decoration: underline;
        }
        @media (max-width: 768px) {
            .legal-bar {
                flex-direction: column;
                text-align: center;
                padding: 16px;
            }
            .legal-bar .disclaimer-text {
                max-width: 100%;
                text-align: center;
            }
        }
        
        /* Modals style */
        .modal {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background-color: rgba(17, 24, 39, 0.7);
            z-index: 2000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .modal:target {
            display: flex;
        }
        .modal-content {
            background-color: #ffffff;
            border-radius: 16px;
            max-width: 500px;
            width: 100%;
            max-height: 80vh;
            overflow-y: auto;
            padding: 28px;
            position: relative;
            text-align: left;
            box-shadow: var(--card-shadow);
            color: #1f2937;
        }
        .modal-close {
            position: absolute;
            top: 12px; right: 16px;
            font-size: 1.5rem;
            font-weight: 700;
            color: #9ca3af;
            text-decoration: none;
            cursor: pointer;
        }
        .modal-close:hover { color: #111827; }
        .modal h2 { margin-bottom: 12px; font-size: 1.25rem; font-weight: 700; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
        .modal p { margin-bottom: 12px; font-size: 0.85rem; color: #4b5563; line-height: 1.6; }
    </style>
</head>
<body>
    
    <div class="main-content">
        <div class="landing-container">
            <div class="product-hero animate-fade-in">
                <span class="category-badge">${productCategory}</span>
                <h1>${productHeadline || t.seoWelcome}</h1>
                <p class="product-desc">${productDescription || t.seoDescriptionDefault}</p>
                
                <div class="benefits-list">
                    <div class="benefit-item">
                        <svg class="check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        <span><strong>${t.seoLi1Title}</strong> ${t.seoLi1Desc}</span>
                    </div>
                    <div class="benefit-item">
                        <svg class="check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        <span><strong>Garantia de Satisfação:</strong> Receba com total segurança e garantia direta de laboratório.</span>
                    </div>
                    <div class="benefit-item">
                        <svg class="check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        <span><strong>${t.seoLi3Title}</strong> ${t.seoLi3Desc}</span>
                    </div>
                </div>
            </div>
            
            <div class="form-card animate-fade-in" style="animation-delay: 0.1s;">
                <div class="form-header">
                    <h3>Solicitar ${cleanProductName}</h3>
                    <p>Preencha os dados abaixo para receber o contato do suporte oficial e efetivar seu pedido.</p>
                </div>
                
                <form class="orderForm">
                    <div class="input-group">
                        <label for="lead-name">Nome Completo</label>
                        <input type="text" id="lead-name" name="name" placeholder="Ex: João Silva" required />
                    </div>
                    
                    <div class="input-group">
                        <label for="lead-phone">Telefone / WhatsApp</label>
                        <input type="tel" id="lead-phone" name="phone" placeholder="Ex: (11) 99999-9999" required />
                    </div>
                    
                    <button type="submit" class="submit-btn">
                        <span>${ctaText}</span>
                        <svg class="arrow-icon" viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
                    </button>
                </form>
                
                <div id="error-container" class="alert-box error-alert" style="display: none;"></div>
                
                <div id="success-container" class="success-box" style="display: none;">
                    <div class="success-icon">
                        <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    </div>
                    <h4>Pedido Registrado com Sucesso!</h4>
                    <p>Seus dados foram enviados. Um consultor oficial de vendas entrará em contato em breve para confirmar seu endereço de entrega e opções de frete.</p>
                    <p class="success-note">Por favor, mantenha sua linha telefônica ativa.</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Overlay legal bar that floats on top -->
    <div class="legal-bar">
        <span>&copy; 2026 ${cleanProductName}. ${t.copyright}</span>
        <span class="disclaimer-text">${t.disclaimer}</span>
        <div class="links">
            <a href="#privacy">${t.privacy}</a>
            <a href="#terms">${t.terms}</a>
            <a href="#contact">${t.contact}</a>
        </div>
    </div>

    <!-- Privacy Policy Modal -->
    <div id="privacy" class="modal">
        <div class="modal-content">
            <a href="#" class="modal-close">&times;</a>
            <h2>${t.privacyTitle}</h2>
            <p>${t.privacyP1}</p>
            <p>${t.privacyP2}</p>
            <p>${t.privacyP3}</p>
            <p>${t.privacyP4}</p>
        </div>
    </div>

    <!-- Terms of Use Modal -->
    <div id="terms" class="modal">
        <div class="modal-content">
            <a href="#" class="modal-close">&times;</a>
            <h2>${t.termsTitle}</h2>
            <p>${t.termsP1}</p>
            <p>${t.termsP2}</p>
            <p>${t.termsP3}</p>
            <p>${t.termsP4}</p>
        </div>
    </div>

    <!-- Contact Modal -->
    <div id="contact" class="modal">
        <div class="modal-content">
            <a href="#" class="modal-close">&times;</a>
            <h2>${t.contactTitle}</h2>
            <p>${t.contactP1}</p>
            <p>${t.contactP2}</p>
            <p style="font-weight: 600; color: var(--primary); margin-top: 16px;">
                ${supportEmail || 'suporte@' + domainName}
            </p>
            <p style="font-size: 0.75rem; color: #9ca3af; margin-top: 24px;">${t.contactP3}</p>
        </div>
    </div>

    <script src="https://snippet.infothroat.com/dist/api/lead-1.1.0.min.js"></script>
    <script>
        drlead.init({
            params: {
                token: "${apiToken}",
                stream_code: "${streamCode}",
                thanks_page: "#"
            },
            callback: function(error, response) {
                var form = document.querySelector('.orderForm');
                var successDiv = document.getElementById('success-container');
                var errorDiv = document.getElementById('error-container');
                if (error) {
                    errorDiv.style.display = 'block';
                    errorDiv.innerText = error.message || 'Ocorreu um erro ao registrar seu pedido. Por favor, tente novamente.';
                } else {
                    form.style.display = 'none';
                    successDiv.style.display = 'block';
                    if (errorDiv) errorDiv.style.display = 'none';
                }
            }
        });
    </script>
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
      popupLanguage,
      productName,
      productHeadline,
      productDescription,
      productCategory,
      ctaText,
      supportEmail,
      apiToken,
      streamCode
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
                          Link da Campanha Dr.Cash / Destino
                        </Label>
                        <Input 
                          id="dest-url" 
                          type="text"
                          name="random_url_field"
                          autoComplete="new-password"
                          placeholder="https://drcash.link/xxxxx ou URL da campanha"
                          value={destinationUrl} 
                          onChange={(e) => {
                            const val = e.target.value;
                            setDestinationUrl(val);
                            // Auto-extract stream code if detected (e.g. numeric segment)
                            try {
                              const match = val.match(/[\/|=]([0-9]+)(?:\?|$|\/|&)/) || val.match(/^([0-9]+)$/);
                              if (match && match[1]) {
                                setStreamCode(match[1]);
                              }
                            } catch (_) {}
                          }}
                          className="rounded-xl h-11 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 focus-visible:border-primary shadow-sm"
                          required
                        />
                      </div>

                      {/* Dr.Cash API Credentials Section */}
                      <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="space-y-1.5 col-span-2 md:col-span-1">
                          <Label htmlFor="api-token" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> API Token Dr.Cash
                          </Label>
                          <Input 
                            id="api-token" 
                            type="text"
                            placeholder="Seu API Token"
                            value={apiToken} 
                            onChange={(e) => setApiToken(e.target.value)}
                            className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm text-xs font-mono"
                            required
                          />
                        </div>

                        <div className="space-y-1.5 col-span-2 md:col-span-1">
                          <Label htmlFor="stream-code" className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                            <Link className="h-3.5 w-3.5 text-primary" /> Código da Campanha (stream_code)
                          </Label>
                          <Input 
                            id="stream-code" 
                            type="text"
                            placeholder="Confirmar stream_code (ex: 12345)"
                            value={streamCode} 
                            onChange={(e) => setStreamCode(e.target.value)}
                            className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm text-xs font-mono"
                            required
                          />
                        </div>
                      </div>

                      {/* Product Name & Product Category */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="product-name" className="text-xs font-semibold text-slate-700">
                            Nome do Produto
                          </Label>
                          <Input 
                            id="product-name" 
                            type="text"
                            placeholder="Ex: Cardiol"
                            value={productName} 
                            onChange={(e) => setProductName(e.target.value)}
                            className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="product-category" className="text-xs font-semibold text-slate-700">
                            Categoria do Produto
                          </Label>
                          <select
                            id="product-category"
                            value={productCategory}
                            onChange={(e) => setProductCategory(e.target.value)}
                            className="w-full rounded-xl h-10 border border-slate-200 bg-white text-sm text-slate-600 px-3 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm cursor-pointer"
                          >
                            <option value="Saúde & Bem-estar">Saúde & Bem-estar</option>
                            <option value="Beleza & Cuidados">Beleza & Cuidados</option>
                            <option value="Finanças & Investimentos">Finanças & Investimentos</option>
                            <option value="Cursos & Educação">Cursos & Educação</option>
                            <option value="E-commerce & Geral">E-commerce & Geral</option>
                          </select>
                        </div>
                      </div>

                      {/* Product Headline */}
                      <div className="space-y-1.5">
                        <Label htmlFor="product-headline" className="text-xs font-semibold text-slate-700">
                          Título Principal (Headline)
                        </Label>
                        <Input 
                          id="product-headline" 
                          type="text"
                          placeholder="Ex: Você está convidado a conhecer a página oficial"
                          value={productHeadline} 
                          onChange={(e) => setProductHeadline(e.target.value)}
                          className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm"
                        />
                      </div>

                      {/* Product Description */}
                      <div className="space-y-1.5">
                        <Label htmlFor="product-description" className="text-xs font-semibold text-slate-700">
                          Descrição Curta da Oferta
                        </Label>
                        <Textarea 
                          id="product-description"
                          placeholder="Ex: Clique abaixo para ser redirecionado com segurança para o site oficial do distribuidor autorizado e garantir sua oferta exclusiva..."
                          value={productDescription} 
                          onChange={(e) => setProductDescription(e.target.value)}
                          className="rounded-xl border-slate-200 min-h-[60px] resize-y bg-white text-xs focus-visible:ring-primary focus-visible:ring-2"
                        />
                      </div>

                      {/* CTA Button Text, Support Email & Language */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="cta-text" className="text-xs font-semibold text-slate-700">
                            Texto do Botão (CTA)
                          </Label>
                          <Input 
                            id="cta-text" 
                            type="text"
                            placeholder="Ex: Ir para o Site Oficial"
                            value={ctaText} 
                            onChange={(e) => setCtaText(e.target.value)}
                            className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="support-email" className="text-xs font-semibold text-slate-700">
                            E-mail de Suporte
                          </Label>
                          <Input 
                            id="support-email" 
                            type="email"
                            placeholder="suporte@seudominio.com"
                            value={supportEmail} 
                            onChange={(e) => setSupportEmail(e.target.value)}
                            className="rounded-xl h-10 border-slate-200 bg-white focus-visible:ring-primary focus-visible:ring-2 shadow-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="page-lang" className="text-xs font-semibold text-slate-700">
                            Idioma do Rodapé
                          </Label>
                          <select
                            id="page-lang"
                            value={popupLanguage}
                            onChange={(e) => setPopupLanguage(e.target.value)}
                            className="w-full rounded-xl h-10 border border-slate-200 bg-white text-sm text-slate-600 px-3 focus:outline-none focus:ring-2 focus:ring-primary shadow-sm cursor-pointer"
                          >
                            <option value="pt-BR">Português (pt-BR)</option>
                            <option value="en">English (en)</option>
                            <option value="es">Español (es)</option>
                          </select>
                        </div>
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
                                  setProductName(site.productName || "");
                                  setProductHeadline(site.productHeadline || "");
                                  setProductDescription(site.productDescription || "");
                                  setProductCategory(site.productCategory || "Saúde & Bem-estar");
                                  setCtaText(site.ctaText || "Ir para o Site Oficial");
                                  setSupportEmail(site.supportEmail || "");
                                  setApiToken(site.apiToken || "");
                                  setStreamCode(site.streamCode || "");
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
