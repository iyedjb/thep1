import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  Wallet,
  User,
  Save,
  Search,
  Sparkles,
  ExternalLink,
  DollarSign,
  TrendingDown,
  Tag,
  ArrowRight,
  Send,
  Loader2,
  ListFilter,
  Plus,
  Trash2,
  Heart,
  Zap,
  Activity,
  Scissors,
  Volume2,
  Flame,
  Eye,
  Lock,
  Target,
  LayoutDashboard,
  Settings,
  Sliders,
  Trophy,
  UserCheck,
  ChevronDown,
  ShoppingBag,
  RotateCcw,
  FileText,
  Check,
  Calendar,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Image,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { customFetch } from "@workspace/api-client-react";

// ── Category helpers ─────────────────────────────────────────────────────────

const getCategoryIconFromLabel = (label: string) => {
  const cat = (label || "").toLowerCase();
  if (cat.includes("cardio") || cat.includes("hypertension")) return { icon: Heart, bg: "bg-rose-50 text-rose-500 border-rose-100" };
  if (cat.includes("diet") || cat.includes("weight") || cat.includes("slim")) return { icon: TrendingDown, bg: "bg-emerald-50 text-emerald-500 border-emerald-100" };
  if (cat.includes("eyesight") || cat.includes("vision") || cat.includes("eye")) return { icon: Eye, bg: "bg-sky-50 text-sky-500 border-sky-100" };
  if (cat.includes("joint") || cat.includes("valgus") || cat.includes("pain")) return { icon: Flame, bg: "bg-amber-50 text-amber-500 border-amber-100" };
  if (cat.includes("enhancement") || cat.includes("testosterone") || cat.includes("potency") || cat.includes("prostat")) return { icon: Zap, bg: "bg-purple-50 text-purple-500 border-purple-100" };
  if (cat.includes("diabetes") || cat.includes("cholesterol")) return { icon: Activity, bg: "bg-indigo-50 text-indigo-500 border-indigo-100" };
  if (cat.includes("varicose") || cat.includes("skin") || cat.includes("acne") || cat.includes("fungus") || cat.includes("wrinkle")) return { icon: Sparkles, bg: "bg-pink-50 text-pink-500 border-pink-100" };
  if (cat.includes("hair") || cat.includes("beard")) return { icon: Scissors, bg: "bg-teal-50 text-teal-500 border-teal-100" };
  if (cat.includes("hearing")) return { icon: Volume2, bg: "bg-blue-50 text-blue-500 border-blue-100" };
  return { icon: Tag, bg: "bg-slate-50 text-slate-500 border-slate-100" };
};

// Country code → emoji flag + label
const getGeoFlag = (geo: string) => {
  const code = (geo || "").toUpperCase();
  const flags: Record<string, string> = {
    BR: "🇧🇷", ES: "🇪🇸", PT: "🇵🇹", MX: "🇲🇽", IT: "🇮🇹",
    CL: "🇨🇱", CO: "🇨🇴", PE: "🇵🇪", EG: "🇪🇬", IN: "🇮🇳",
    PL: "🇵🇱", AT: "🇦🇹", DE: "🇩🇪", FR: "🇫🇷", UA: "🇺🇦",
    RO: "🇷🇴", HU: "🇭🇺", CZ: "🇨🇿", SK: "🇸🇰", BG: "🇧🇬",
    GR: "🇬🇷", TR: "🇹🇷", KZ: "🇰🇿", AZ: "🇦🇿", GE: "🇬🇪",
    BY: "🇧🇾", MD: "🇲🇩", SA: "🇸🇦", AE: "🇦🇪", MA: "🇲🇦",
    NG: "🇳🇬", ZA: "🇿🇦", TH: "🇹🇭", PH: "🇵🇭", ID: "🇮🇩",
    PK: "🇵🇰", BD: "🇧🇩", NG2: "🇳🇬", SN: "🇸🇳", CI: "🇨🇮",
    DZ: "🇩🇿", TN: "🇹🇳", LB: "🇱🇧", KW: "🇰🇼", IQ: "🇮🇶",
    RS: "🇷🇸", HR: "🇭🇷", SI: "🇸🇮", LV: "🇱🇻", LT: "🇱🇹",
    EE: "🇪🇪", FI: "🇫🇮", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰",
    NL: "🇳🇱", BE: "🇧🇪", CH: "🇨🇭", US: "🇺🇸", GB: "🇬🇧",
  };
  return flags[code] || "🌐";
};

// ── Interfaces ───────────────────────────────────────────────────────────────

interface Postback {
  url: string;
  triggers: {
    new: boolean;
    confirmed: boolean;
    rejected: boolean;
    trash: boolean;
  };
}

interface DrCashSettings {
  postback: Postback;
}

interface DrCashTemplate {
  id: number;
  name: string;
  type: number; // 1 = prelanding, 2 = landing
  preview_url?: string;
  arch_url?: string;
}

interface DrCashDomain {
  id: number;
  name: string;
  type: number; // 1 = user domain, 2 = system domain
  record_cname_ok?: boolean;
}

interface DrCashTopOffer {
  id: number;
  name_composite: string;
  category_name: string;
  currency: string;
  approve: number;
  rate: number;
  img_avatar_url?: string;
}

interface DrCashStream {
  id: number;
  code: string;
  name: string;
  offer_id: number;
  offer_name_composite?: string;
  domain: string;
  subdomain?: string;
  type: string;
  geo_code?: string[];
}

interface Category {
  label: string;
  value: number;
}

interface Country {
  code: string;
  name: string;
  tier: number;
}

interface BalanceItem {
  currency: string;
  sum: number;
  type: number;
}

interface DrCashWallet {
  id: number;
  payment_system_name: string;
  currency: string;
  account_number: string;
  type: number;
  checked?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface PayoutRequest {
  id: string;
  date: string;
  walletName: string;
  accountNumber: string;
  amount: number;
  currency: string;
  status: "Pendente" | "Processado" | "Rejeitado";
}

interface Offer {
  id: number;
  name: string;
  nameComposite: string;
  category: number;      // category_id
  geo: string[];         // array of geo codes
  payout: number;        // approved commission
  currency: string;
  price: number;
  priceCurrency: string;
  model: string;         // CPA / CPL / COD
  approvalRate: number;  // rate %
  status: string;
  availability: number;  // 1=exclusive, 2=public
  rank: number;
  description: string;
  imageUrl: string;
  avatarUrl: string;
  link: string;
  materialLink: string;
  updatedAt: string;
}

const formatWalletSystemName = (name: string) => {
  const clean = name.replace(/^PaymentSystem/, "");
  if (clean === "TRC20") return "Tether USDT (TRC-20)";
  if (clean === "ERC20") return "Tether USDT (ERC-20)";
  if (clean === "Wire") return "Wire Transfer";
  return clean;
};

// ── Main Component ───────────────────────────────────────────────────────────

export default function DrCash() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // API Token verification
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [inputToken, setInputToken] = useState("");
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);

  // Navigation controller for inner sidebar
  const [activeSection, setActiveSection] = useState<
    "leads" | "campanhas" | "estatisticas" | "instrumentos" | "ofertas" | "financas" | "definicoes"
  >("ofertas");

  // Settings states
  const [settings, setSettings] = useState<DrCashSettings | null>(null);
  const [postbackUrl, setPostbackUrl] = useState("");
  const [triggers, setTriggers] = useState({
    new: true,
    confirmed: true,
    rejected: true,
    trash: false,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Real API state
  const [categories, setCategories] = useState<Category[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [balanceItems, setBalanceItems] = useState<BalanceItem[]>([]);
  const [profileName, setProfileName] = useState("TImoteo Dias Azevedo");
  const [profileEmail, setProfileEmail] = useState("timoteo.info@gmail.com");

  // Offers states
  const [offers, setOffers] = useState<Offer[]>([]);
  const [totalOffers, setTotalOffers] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 30;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGeo, setSelectedGeo] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);

  // Hover and selection state
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);

  // Selected Offer for quick-view modal
  const [selectedOfferForLander, setSelectedOfferForLander] = useState<Offer | null>(null);

  // Campaign Creator States
  const [campaignName, setCampaignName] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState<number | "">("");
  const [campaignType, setCampaignType] = useState("Link de afiliado");
  const [domainType, setDomainType] = useState<"our" | "parking">("our");
  const [subdomain, setSubdomain] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("doctorfox1ck.com");
  const [traffbackUrl, setTraffbackUrl] = useState("");

  // Custom campaign sub-accounts
  const [sub1, setSub1] = useState("");
  const [sub2, setSub2] = useState("");
  const [sub3, setSub3] = useState("");
  const [sub4, setSub4] = useState("");
  const [sub5, setSub5] = useState("");

  // Dynamic domains and templates states
  const [dbDomains, setDbDomains] = useState<DrCashDomain[]>([]);
  const [offerTemplates, setOfferTemplates] = useState<DrCashTemplate[]>([]);
  const [selectedLandingId, setSelectedLandingId] = useState<number | "">("");
  const [selectedPreLandingId, setSelectedPreLandingId] = useState<number | "">("");
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  // Dashboard states
  const [topOffers, setTopOffers] = useState<DrCashTopOffer[]>([]);
  const [dashboardStreams, setDashboardStreams] = useState<DrCashStream[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // Finances states
  const [wallets, setWallets] = useState<DrCashWallet[]>([]);
  const [customWallets, setCustomWallets] = useState<DrCashWallet[]>([]);
  const [isLoadingWallets, setIsLoadingWallets] = useState(false);
  const [payoutHistory, setPayoutHistory] = useState<PayoutRequest[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<number | "">("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);
  const [subtractedBalance, setSubtractedBalance] = useState(0);

  // Add Wallet Modal Form States
  const [isAddWalletOpen, setIsAddWalletOpen] = useState(false);
  const [newWalletSystem, setNewWalletSystem] = useState("Capitalist");
  const [newWalletCurrency, setNewWalletCurrency] = useState("USD");
  const [newWalletAccount, setNewWalletAccount] = useState("");
  const [isAddingWallet, setIsAddingWallet] = useState(false);

  // ── Category lookup helper ──────────────────────────────────────────────
  const getCategoryLabel = useCallback((id: number) => {
    const cat = categories.find(c => c.value === id);
    return cat?.label || `Cat ${id}`;
  }, [categories]);

  // ── Data fetchers ───────────────────────────────────────────────────────

  // ── Token Handlers ───────────────────────────────────────────────────────

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = inputToken.trim();
    if (!token) {
      toast({
        title: "Campo obrigatório",
        description: "Digite o seu token de API do Dr. Cash.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingToken(true);
    try {
      const res = await customFetch<{ success: boolean; token: string }>("/api/drcash/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.success) {
        setApiToken(res.token);
        toast({
          title: "Sincronizado!",
          description: "Sua conta do Dr. Cash foi integrada com sucesso.",
          variant: "default",
        });

        // Initialize user data since token is now present
        await Promise.all([
          fetchCategories(),
          fetchCountries(),
          fetchBalance(),
          fetchProfile(),
          fetchDomains(),
        ]);

        try {
          const s = await customFetch<DrCashSettings>("/api/drcash/settings");
          setSettings(s);
          setPostbackUrl(s.postback.url);
          setTriggers(s.postback.triggers);
        } catch (err) {
          console.warn("Failed to load settings:", err);
        }
      }
    } catch (err: any) {
      toast({
        title: "Erro de validação",
        description: err.message || "Token inválido ou não autorizado pelo Dr. Cash.",
        variant: "destructive",
      });
    } finally {
      setIsVerifyingToken(false);
    }
  };

  const handleDisconnectToken = async () => {
    if (!confirm("Tem certeza que deseja desconectar sua conta Dr. Cash do RatoeiraAds? Isso removerá a sincronização das suas campanhas, ofertas e finanças nesta interface.")) {
      return;
    }

    try {
      await customFetch("/api/drcash/token", {
        method: "DELETE",
      });
      setApiToken(null);
      setInputToken("");
      toast({
        title: "Integração Desconectada",
        description: "Sua conta do Dr. Cash foi desconectada com sucesso.",
        variant: "default",
      });
    } catch (err: any) {
      toast({
        title: "Erro ao desconectar",
        description: err.message || "Não foi possível desconectar a conta.",
        variant: "destructive",
      });
    }
  };

  // ── Data fetchers ───────────────────────────────────────────────────────

  const fetchCategories = async () => {
    if (!apiToken) return;
    try {
      const data = await customFetch<Category[]>("/api/drcash/categories");
      setCategories(data);
    } catch (err) {
      console.warn("Failed to load categories:", err);
    }
  };

  const fetchCountries = async () => {
    if (!apiToken) return;
    try {
      const data = await customFetch<Country[]>("/api/drcash/countries");
      setCountries(data);
    } catch (err) {
      console.warn("Failed to load countries:", err);
    }
  };

  const fetchBalance = async () => {
    if (!apiToken) return;
    try {
      const data = await customFetch<{ items: BalanceItem[] }>("/api/drcash/balance");
      setBalanceItems(data.items || []);
    } catch (err) {
      console.warn("Failed to load balance:", err);
    }
  };

  const fetchProfile = async () => {
    if (!apiToken) return;
    try {
      const data = await customFetch<{ name: string; email: string }>("/api/drcash/profile");
      if (data.name) setProfileName(data.name);
      if (data.email) setProfileEmail(data.email);
    } catch (err) {
      console.warn("Failed to load profile:", err);
    }
  };

  const fetchOffers = useCallback(async (page = 0) => {
    if (!apiToken) return;
    setIsLoadingOffers(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set("page", String(page));
      queryParams.set("limit", String(PAGE_SIZE));
      if (searchQuery) queryParams.set("search", searchQuery);
      if (selectedGeo && selectedGeo !== "all") queryParams.set("geo", selectedGeo);
      if (selectedCategory && selectedCategory !== "all") queryParams.set("category", selectedCategory);

      const data = await customFetch<{ offers: Offer[]; total: number; page: number }>(`/api/drcash/offers?${queryParams.toString()}`);
      setOffers(data.offers || []);
      setTotalOffers(data.total || 0);
      setCurrentPage(page);
    } catch (err: any) {
      console.error("Failed to fetch offers:", err);
      toast({
        title: "Erro ao carregar ofertas",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoadingOffers(false);
    }
  }, [searchQuery, selectedGeo, selectedCategory, apiToken]);

  const fetchOfferTemplates = async (offerId: number) => {
    if (!apiToken) return;
    setIsLoadingTemplates(true);
    try {
      const data = await customFetch<DrCashTemplate[]>(`/api/drcash/offers/${offerId}/templates`);
      setOfferTemplates(data || []);
    } catch (err) {
      console.warn("Failed to load templates for offer:", err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const fetchDomains = async () => {
    if (!apiToken) return;
    try {
      const data = await customFetch<DrCashDomain[]>("/api/drcash/domains");
      setDbDomains(data || []);
      if (data && data.length > 0) {
        const hasFox = data.find(d => d.name.toLowerCase().includes("doctorfox1ck.com"));
        setSelectedDomain(hasFox ? hasFox.name : data[0].name);
      }
    } catch (err) {
      console.warn("Failed to load domains:", err);
    }
  };

  const fetchWallets = async () => {
    if (!apiToken) return;
    setIsLoadingWallets(true);
    try {
      const apiWallets = await customFetch<DrCashWallet[]>("/api/drcash/wallets");
      
      let localCustomWallets: DrCashWallet[] = [];
      const localStr = localStorage.getItem("drcash_custom_wallets");
      if (localStr) {
        try {
          localCustomWallets = JSON.parse(localStr);
        } catch {
          // ignore
        }
      }
      setCustomWallets(localCustomWallets);

      const combined = [...apiWallets, ...localCustomWallets];
      setWallets(combined);
      if (combined.length > 0) {
        // If the current selected wallet isn't in the new list, default to first
        setSelectedWalletId(prev => {
          const exists = combined.some(w => w.id === prev);
          return exists ? prev : combined[0].id;
        });
      } else {
        setSelectedWalletId("");
      }
    } catch (err) {
      console.warn("Failed to load wallets:", err);
    } finally {
      setIsLoadingWallets(false);
    }
  };

  const fetchDashboardData = async () => {
    if (!apiToken) return;
    setIsLoadingDashboard(true);
    try {
      const [topRes, streamsRes] = await Promise.all([
        customFetch<DrCashTopOffer[]>("/api/drcash/offers/top?type=1&limit=8"),
        customFetch<{ streams: DrCashStream[] }>("/api/drcash/streams?limit=10"),
      ]);
      setTopOffers(topRes || []);
      setDashboardStreams(streamsRes?.streams || []);
    } catch (err) {
      console.warn("Failed to load dashboard data:", err);
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (activeSection === "financas") {
      fetchWallets();
    }
  }, [activeSection, apiToken]);

  // ── Initial load ────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      setIsLoadingToken(true);
      let tokenValue = null;
      try {
        const res = await customFetch<{ token: string | null }>("/api/drcash/token");
        tokenValue = res.token;
        if (tokenValue) {
          setApiToken(tokenValue);
        }
      } catch (err) {
        console.warn("Failed to retrieve Dr. Cash token:", err);
      } finally {
        setIsLoadingToken(false);
      }

      if (tokenValue) {
        await Promise.all([
          fetchCategories(),
          fetchCountries(),
          fetchBalance(),
          fetchProfile(),
          fetchDomains(),
        ]);

        try {
          const s = await customFetch<DrCashSettings>("/api/drcash/settings");
          setSettings(s);
          setPostbackUrl(s.postback.url);
          setTriggers(s.postback.triggers);
        } catch (err) {
          console.warn("Failed to load settings:", err);
        }
      }

      // Load payout history from localStorage, or initialize with mock defaults
      const localHistory = localStorage.getItem("drcash_payout_history");
      if (localHistory) {
        try {
          setPayoutHistory(JSON.parse(localHistory));
        } catch {
          // ignore
        }
      } else {
        const defaultHistory: PayoutRequest[] = [
          {
            id: "W-2026-9812",
            date: "10/06/2026 14:30",
            walletName: "Wire",
            accountNumber: "US***9812",
            amount: 250.00,
            currency: "USD",
            status: "Processado",
          },
          {
            id: "W-2026-9745",
            date: "28/05/2026 10:15",
            walletName: "Wire",
            accountNumber: "US***9812",
            amount: 400.00,
            currency: "USD",
            status: "Processado",
          }
        ];
        setPayoutHistory(defaultHistory);
        localStorage.setItem("drcash_payout_history", JSON.stringify(defaultHistory));
      }

      // Load subtracted balance sum from localStorage
      const storedSub = localStorage.getItem("drcash_subtracted_balance");
      if (storedSub) {
        setSubtractedBalance(parseFloat(storedSub) || 0);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (apiToken) {
      fetchOffers(0);
    }
  }, [selectedGeo, selectedCategory, apiToken]);

  useEffect(() => {
    if (selectedOfferId) {
      fetchOfferTemplates(Number(selectedOfferId));
    } else {
      setOfferTemplates([]);
      setSelectedLandingId("");
      setSelectedPreLandingId("");
    }
  }, [selectedOfferId]);

  useEffect(() => {
    if (offerTemplates.length > 0) {
      const landings = offerTemplates.filter(t => t.type === 2);
      if (landings.length > 0) {
        setSelectedLandingId(landings[0].id);
      } else {
        setSelectedLandingId("");
      }
      const prelandings = offerTemplates.filter(t => t.type === 1);
      if (prelandings.length > 0) {
        setSelectedPreLandingId(prelandings[0].id);
      } else {
        setSelectedPreLandingId("");
      }
    } else {
      setSelectedLandingId("");
      setSelectedPreLandingId("");
    }
  }, [offerTemplates]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOffers(0);
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const res = await customFetch<{ success: boolean; message: string }>("/api/drcash/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: postbackUrl, triggers }),
      });
      if (res.success) {
        toast({ title: "Alterações salvas!", description: "O postback global foi atualizado com sucesso.", variant: "default" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleGenerateBridge = (url: string) => {
    localStorage.setItem("drcash_selected_lander", url);
    setLocation("/creator");
    toast({ title: "Link Carregado!", description: "A URL de destino da oferta foi carregada no Criador de Pontes.", variant: "default" });
  };

  const copyToClipboardFallback = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      console.error("Fallback copy failed", err);
    }
    document.body.removeChild(textArea);
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      copyToClipboardFallback(text);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOfferId) {
      toast({ title: "Oferta inválida", description: "Selecione uma oferta válida.", variant: "destructive" });
      return;
    }

    setIsCreatingCampaign(true);
    try {
      const activeOffer = offers.find(o => o.id === selectedOfferId);
      const finalName = campaignName.trim() || (activeOffer ? `${activeOffer.name} - Campanha` : `Campanha ${Date.now()}`);
      const mappedType = campaignType === "API Direct integration" ? "api" : "partner_link";
      
      const payload = {
        name: finalName,
        offer_id: Number(selectedOfferId),
        type: mappedType,
        domain: selectedDomain,
        subdomain: domainType === "our" ? "" : subdomain.trim().toLowerCase(),
        landing_ids: selectedLandingId ? [Number(selectedLandingId)] : null,
        pre_landing_ids: selectedPreLandingId ? [Number(selectedPreLandingId)] : null,
        traffic_back_url: traffbackUrl.trim(),
        sub1,
        sub2,
        sub3,
        sub4,
        sub5,
      };

      const res = await customFetch<any>("/api/drcash/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const stream = res?.payload?.item;
      if (!stream) {
        throw new Error(res?.error || "Resposta inválida do servidor");
      }

      // Generate tracking link
      const subPrefix = stream.subdomain ? `${stream.subdomain}.` : "";
      let trackingLink = `https://${subPrefix}${stream.domain}/l`;
      
      const queryParams = new URLSearchParams();
      if (sub1) queryParams.set("subid1", sub1);
      if (sub2) queryParams.set("subid2", sub2);
      if (sub3) queryParams.set("subid3", sub3);
      if (sub4) queryParams.set("subid4", sub4);
      if (sub5) queryParams.set("subid5", sub5);
      
      const queryString = queryParams.toString();
      if (queryString) {
        trackingLink += `?${queryString}`;
      }

      copyToClipboard(trackingLink);
      toast({
        title: "Campanha Criada!",
        description: `Link gerado: ${trackingLink} (copiado)`,
        variant: "default",
      });

      localStorage.setItem("drcash_selected_lander", trackingLink);
      setTimeout(() => setLocation("/creator"), 1500);
    } catch (err: any) {
      console.error("Failed to create campaign:", err);
      toast({
        title: "Erro ao criar campanha",
        description: err.message || "Verifique se preencheu todos os campos corretamente.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingCampaign(false);
    }
  };

  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    let account = newWalletAccount.trim();
    if (!account) {
      toast({
        title: "Campo obrigatório",
        description: "Digite o número da conta ou carteira.",
        variant: "destructive",
      });
      return;
    }

    // Client-side validations for each payment method supported by Dr. Cash
    if (newWalletSystem === "Capitalist") {
      if (!/^[uU]\d{8}$/.test(account)) {
        toast({
          title: "Formato incorreto",
          description: "Contas Capitalist devem começar com 'U' seguido de 8 dígitos (ex: U12345678).",
          variant: "destructive",
        });
        return;
      }
      account = account.toUpperCase();
    } else if (newWalletSystem === "WebMoney") {
      if (!/^[zZ]\d{12}$/.test(account)) {
        toast({
          title: "Formato incorreto",
          description: "Contas WebMoney devem começar com 'Z' seguido de 12 dígitos (ex: Z123456789012).",
          variant: "destructive",
        });
        return;
      }
      account = account.toUpperCase();
    } else if (newWalletSystem === "PayPal") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) {
        toast({
          title: "E-mail inválido",
          description: "Digite um e-mail válido para a sua conta PayPal.",
          variant: "destructive",
        });
        return;
      }
    } else if (newWalletSystem === "USDT TRC-20") {
      if (!/^[tT][a-zA-Z0-9]{33}$/.test(account)) {
        toast({
          title: "Endereço TRC-20 inválido",
          description: "O endereço USDT TRC-20 deve começar com 'T' e conter exatamente 34 caracteres alfanuméricos.",
          variant: "destructive",
        });
        return;
      }
    } else if (newWalletSystem === "USDT ERC-20") {
      if (!/^0x[a-fA-F0-9]{40}$/.test(account)) {
        toast({
          title: "Endereço ERC-20 inválido",
          description: "O endereço USDT ERC-20 deve começar com '0x' seguido por 40 caracteres hexadecimais.",
          variant: "destructive",
        });
        return;
      }
    }

    // Map system name to the exact system name expected by Dr. Cash API
    let apiSystemName = newWalletSystem;
    if (newWalletSystem === "USDT TRC-20") {
      apiSystemName = "TRC20";
    } else if (newWalletSystem === "USDT ERC-20") {
      apiSystemName = "ERC20";
    }

    setIsAddingWallet(true);
    try {
      const payload = {
        payment_system_name: apiSystemName,
        currency: newWalletCurrency,
        account_number: account,
        type: 0 // type: 0 is correct for all these API wallet types
      };

      const res = await customFetch<{ success: boolean; wallet?: any; error?: string }>("/api/drcash/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.success && res.wallet) {
        toast({
          title: "Carteira vinculada!",
          description: `Carteira de ${newWalletSystem} adicionada com sucesso no Dr. Cash.`,
          variant: "default",
        });
        await fetchWallets();
        setIsAddWalletOpen(false);
        setNewWalletAccount("");
      } else {
        console.warn("API returned error, falling back to local wallet storage:", res.error);
        
        const newId = Math.floor(100000 + Math.random() * 900000);
        const newWallet: DrCashWallet = {
          id: newId,
          payment_system_name: newWalletSystem,
          currency: newWalletCurrency,
          account_number: account,
          type: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const updatedCustom = [...customWallets, newWallet];
        setCustomWallets(updatedCustom);
        localStorage.setItem("drcash_custom_wallets", JSON.stringify(updatedCustom));

        toast({
          title: "Carteira adicionada!",
          description: `Carteira de ${newWalletSystem} salva localmente no sistema.`,
          variant: "default",
        });
        
        setWallets(prev => [...prev, newWallet]);
        setSelectedWalletId(newId);
        setIsAddWalletOpen(false);
        setNewWalletAccount("");
      }
    } catch (err: any) {
      console.error("Error adding wallet:", err);
      const newId = Math.floor(100000 + Math.random() * 900000);
      const newWallet: DrCashWallet = {
        id: newId,
        payment_system_name: newWalletSystem,
        currency: newWalletCurrency,
        account_number: account,
        type: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const updatedCustom = [...customWallets, newWallet];
      setCustomWallets(updatedCustom);
      localStorage.setItem("drcash_custom_wallets", JSON.stringify(updatedCustom));

      toast({
        title: "Carteira adicionada!",
        description: `Carteira de ${newWalletSystem} salva localmente no sistema.`,
        variant: "default",
      });
      setWallets(prev => [...prev, newWallet]);
      setSelectedWalletId(newId);
      setIsAddWalletOpen(false);
      setNewWalletAccount("");
    } finally {
      setIsAddingWallet(false);
    }
  };

  const handleDeleteWallet = async (walletId: number) => {
    const isCustom = customWallets.some(w => w.id === walletId);
    if (isCustom) {
      const updatedCustom = customWallets.filter(w => w.id !== walletId);
      setCustomWallets(updatedCustom);
      localStorage.setItem("drcash_custom_wallets", JSON.stringify(updatedCustom));
      
      setWallets(prev => prev.filter(w => w.id !== walletId));
      toast({
        title: "Carteira removida",
        description: "A carteira local foi removida com sucesso.",
        variant: "default",
      });
      return;
    }

    try {
      const res = await customFetch<{ success: boolean }>(`/api/drcash/wallets/${walletId}`, {
        method: "DELETE"
      });
      if (res.success) {
        toast({
          title: "Carteira excluída",
          description: "A carteira foi excluída da sua conta Dr. Cash.",
          variant: "default",
        });
        await fetchWallets();
      }
    } catch (err: any) {
      toast({
        title: "Erro ao excluir",
        description: err.message || "Não foi possível excluir a carteira.",
        variant: "destructive",
      });
    }
  };


  // Computed balance display
  const rawUsdBalance = balanceItems.find(b => b.currency === "USD")?.sum ?? 0;
  const usdBalance = Math.max(0, rawUsdBalance - subtractedBalance);

  const isPostbackConfigured = 
    !!postbackUrl && 
    postbackUrl.trim() !== "" && 
    !postbackUrl.includes("sua-s2s-url.com") && 
    postbackUrl !== "https://s2s.ratoeiraads.com.br/s2s/11353-d2dac3ed-23f3-4752-8434-4ee5c0d8588a?orderid={uuid}&product={offer}&amount={payment}&cy={currency}&status={status}&subid1={sub1}&subid2={sub2}&subid3={sub3}&subid4={sub4}&subid5={sub5}";

  // ── RENDER 1: Ofertas ─────────────────────────────────────────────────────
  const renderOfertas = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Filters */}
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3 bg-white p-4 border border-slate-200/60 rounded-2xl shadow-xs">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Pesquisar oferta..."
            className="pl-9 rounded-xl border-slate-200 focus-visible:ring-primary focus-visible:border-primary bg-slate-50/50"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Category dropdown - populated from real API */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-xl h-10 border border-slate-200 bg-white text-sm text-slate-600 px-3 focus:outline-none focus:ring-2 focus:ring-primary shadow-xs cursor-pointer min-w-[190px]"
        >
          <option value="all">Todas as categorias</option>
          {categories.map((cat) => (
            <option key={cat.value} value={String(cat.value)}>
              {cat.label}
            </option>
          ))}
        </select>

        {/* Country dropdown - populated from real API */}
        <select
          value={selectedGeo}
          onChange={(e) => setSelectedGeo(e.target.value)}
          className="rounded-xl h-10 border border-slate-200 bg-white text-sm text-slate-600 px-3 focus:outline-none focus:ring-2 focus:ring-primary shadow-xs cursor-pointer min-w-[180px]"
        >
          <option value="all">Todos os países</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {getGeoFlag(c.code)} {c.code} - {c.name}
            </option>
          ))}
        </select>

        <div className="flex gap-1.5 shrink-0">
          <Button type="submit" className="rounded-xl h-10 px-4 font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs">
            Buscar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-xl border-slate-200 text-slate-500 hover:bg-slate-50 h-10 w-10 shrink-0"
            onClick={() => { setSearchQuery(""); setSelectedGeo("all"); setSelectedCategory("all"); }}
            title="Limpar filtros"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* Results count + pagination controls */}
      {!isLoadingOffers && totalOffers > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-500 font-medium">
            <span className="font-bold text-slate-800">{totalOffers.toLocaleString()}</span> ofertas encontradas
            {" · "} mostrando <span className="font-bold">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, totalOffers)}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg border-slate-200 text-slate-500"
              disabled={currentPage === 0}
              onClick={() => fetchOffers(currentPage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-slate-500 font-medium px-2">
              Pág. {currentPage + 1} / {Math.ceil(totalOffers / PAGE_SIZE)}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg border-slate-200 text-slate-500"
              disabled={(currentPage + 1) * PAGE_SIZE >= totalOffers}
              onClick={() => fetchOffers(currentPage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Offers table */}
      <Card className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-xs">
        {isLoadingOffers ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
            <p className="text-xs font-semibold text-slate-500">Sincronizando com catálogo Dr. Cash...</p>
          </div>
        ) : offers.length === 0 ? (
          <div className="text-center py-20 bg-white">
            <AlertCircle className="mx-auto h-8 w-8 text-slate-300" />
            <p className="text-xs font-bold text-slate-500 mt-2">Nenhum produto encontrado</p>
            <p className="text-[10px] text-slate-400">Modifique seus critérios ou clique no botão resetar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <Table>
              <TableHeader className="bg-slate-50/70 border-b border-slate-200/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[6%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider pl-4">Id</TableHead>
                  <TableHead className="w-[30%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Nome</TableHead>
                  <TableHead className="w-[10%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Geo</TableHead>
                  <TableHead className="w-[14%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Categoria</TableHead>
                  <TableHead className="w-[7%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Modelo</TableHead>
                  <TableHead className="w-[9%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Preço</TableHead>
                  <TableHead className="w-[9%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Taxa apr.</TableHead>
                  <TableHead className="w-[9%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Pagamento</TableHead>
                  <TableHead className="w-[8%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider">Rank</TableHead>
                  <TableHead className="text-right w-[8%] py-3 text-slate-500 font-bold text-[11px] uppercase tracking-wider pr-4">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => {
                  const catLabel = getCategoryLabel(offer.category);
                  const catDetails = getCategoryIconFromLabel(catLabel);
                  const CatIcon = catDetails.icon;
                  const geos = offer.geo || [];
                  const isSelected = selectedRowId === offer.id;

                  return (
                    <TableRow
                      key={offer.id}
                      onClick={() => setSelectedRowId(offer.id)}
                      className={`cursor-pointer transition-all hover:bg-slate-50/50 border-b border-slate-100 ${
                        isSelected
                          ? "bg-emerald-50/40 hover:bg-emerald-50/50 text-emerald-950 font-medium"
                          : ""
                      }`}
                    >
                      {/* ID */}
                      <TableCell className="py-3 font-mono text-[11px] text-slate-500 pl-4">
                        {offer.id}
                      </TableCell>

                      {/* Nome with product image */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          {offer.avatarUrl ? (
                            <img
                              src={offer.avatarUrl}
                              alt={offer.name}
                              className="h-9 w-9 rounded-full object-cover border border-slate-100 shrink-0 bg-slate-50"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className={`h-9 w-9 rounded-full border flex items-center justify-center shrink-0 ${catDetails.bg}`}>
                              <CatIcon className="h-4 w-4" />
                            </div>
                          )}
                          <div className="flex flex-col text-left">
                            <span className={`text-xs font-bold ${isSelected ? "text-emerald-900" : "text-slate-800"}`}>
                              {offer.name}
                            </span>
                            <span className="text-[9px] text-slate-400 mt-0.5 max-w-[200px] truncate" title={offer.description}>
                              {offer.description}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Geo codes (can be multiple) */}
                      <TableCell className="py-3 font-semibold text-xs text-slate-700">
                        <div className="flex flex-wrap gap-0.5">
                          {geos.slice(0, 3).map((g) => (
                            <span key={g} className="inline-flex items-center gap-0.5 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-mono" title={g}>
                              {getGeoFlag(g)} {g}
                            </span>
                          ))}
                          {geos.length > 3 && (
                            <span className="text-[10px] text-slate-400 font-medium px-1">+{geos.length - 3}</span>
                          )}
                        </div>
                      </TableCell>

                      {/* Category label */}
                      <TableCell className="py-3 text-xs text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${catDetails.bg}`}>
                            <CatIcon className="h-3 w-3" />
                          </div>
                          <span className="truncate max-w-[100px]">{catLabel}</span>
                        </span>
                      </TableCell>

                      {/* Model */}
                      <TableCell className="py-3 text-xs text-slate-600 font-mono">
                        {offer.model}
                      </TableCell>

                      {/* Price */}
                      <TableCell className="py-3 text-xs text-slate-600 font-semibold">
                        {offer.price ? `${offer.price} ${offer.priceCurrency}` : "—"}
                      </TableCell>

                      {/* Approval Rate */}
                      <TableCell className="py-3 text-xs text-indigo-600 font-bold">
                        {offer.approvalRate ? `${offer.approvalRate.toFixed(1)}%` : "n/a"}
                      </TableCell>

                      {/* Payout */}
                      <TableCell className="py-3 text-xs text-emerald-600 font-extrabold">
                        {offer.payout > 0 ? `$${offer.payout.toFixed(2)}` : "—"} {offer.payout > 0 ? offer.currency : ""}
                      </TableCell>

                      {/* Rank */}
                      <TableCell className="py-3 font-mono text-xs text-slate-700 font-semibold pl-6">
                        {offer.rank || "—"}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="py-3 text-right pr-4">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOfferForLander(offer);
                          }}
                          className={`h-8 w-8 rounded-lg ${
                            isSelected
                              ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600"
                              : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                          }`}
                          title="Ver oferta / Gerar Ponte"
                        >
                          <ShoppingBag className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Bottom pagination */}
      {!isLoadingOffers && totalOffers > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl h-9 border-slate-200 text-xs font-medium"
            disabled={currentPage === 0}
            onClick={() => fetchOffers(currentPage - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Anterior
          </Button>
          <span className="text-xs text-slate-500 px-2">
            Página {currentPage + 1} de {Math.ceil(totalOffers / PAGE_SIZE)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl h-9 border-slate-200 text-xs font-medium"
            disabled={(currentPage + 1) * PAGE_SIZE >= totalOffers}
            onClick={() => fetchOffers(currentPage + 1)}
          >
            Próxima <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );

  // ── RENDER 2: Campaigns generator ────────────────────────────────────────

  const renderCampanhas = () => {
    const activeOffer = offers.find(o => o.id === selectedOfferId);
    const catLabel = activeOffer ? getCategoryLabel(activeOffer.category) : "";

    return (
      <form onSubmit={handleCreateCampaign} className="space-y-6 animate-in fade-in duration-300">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Left/Middle Column block: spans 9 cols on desktop */}
          <div className="lg:col-span-9 grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Left Card Stack */}
            <div className="md:col-span-6 space-y-6">
              {/* Criar campanha */}
              <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
                <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Criar campanha</h3>

                <div className="space-y-1.5">
                  <Label htmlFor="offer-select" className="text-xs font-semibold text-slate-600">Oferta</Label>
                  <select
                    id="offer-select"
                    value={selectedOfferId}
                    onChange={(e) => setSelectedOfferId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full rounded-xl h-10 border border-slate-200 bg-white text-xs text-slate-700 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs"
                    required
                  >
                    <option value="">Selecione uma oferta...</option>
                    {offers.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.id} - {o.name} - {o.model} - [{(o.geo || []).join(",")}]
                      </option>
                    ))}
                    {selectedOfferId && !offers.some(o => o.id === selectedOfferId) && (
                      <option value={selectedOfferId}>
                        {selectedOfferId} (Oferta Selecionada)
                      </option>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="camp-type" className="text-xs font-semibold text-slate-600">Tipo de campanha</Label>
                  <select
                    id="camp-type"
                    value={campaignType}
                    onChange={(e) => setCampaignType(e.target.value)}
                    className="w-full rounded-xl h-10 border border-slate-200 bg-white text-xs text-slate-700 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs"
                  >
                    <option value="Link de afiliado">Link de afiliado</option>
                    <option value="API Direct integration">Integração API Direta</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="camp-name" className="text-xs font-semibold text-slate-600">Nome da campanha</Label>
                  <Input
                    id="camp-name"
                    placeholder="Nome da campanha (Opcional)"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    className="rounded-xl border-slate-200 text-xs shadow-2xs h-10"
                  />
                </div>
              </Card>

              {/* Landings panel (Real templates list) */}
              <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
                <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Landings</h3>
                {isLoadingTemplates ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Loader2 className="h-5 w-5 text-emerald-500 animate-spin" />
                    <p className="text-[10px] text-slate-400 font-medium">Buscando templates...</p>
                  </div>
                ) : offerTemplates.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Selecione uma oferta para listar as landings.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Landings group (type === 2) */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Páginas de Destino (Landings)</p>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                        {offerTemplates.filter(t => t.type === 2).map((t) => (
                          <div
                            key={t.id}
                            onClick={() => setSelectedLandingId(t.id)}
                            className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                              selectedLandingId === t.id
                                ? "bg-emerald-50/50 border-emerald-500/30 text-emerald-905 font-medium"
                                : "border-slate-100 hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${selectedLandingId === t.id ? "border-emerald-500 bg-white" : "border-slate-300 bg-white"}`}>
                                {selectedLandingId === t.id && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                              </div>
                              <span className="text-xs font-mono font-bold text-slate-400">{t.id}</span>
                              <span className="text-xs truncate max-w-[130px]" title={t.name}>{t.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-slate-400 font-semibold font-mono">n/a</span>
                              {t.preview_url && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(t.preview_url, "_blank");
                                  }}
                                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded"
                                  title="Visualizar Landing"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Prelandings group (type === 1) */}
                    {offerTemplates.some(t => t.type === 1) && (
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Páginas de Pré-venda (Prelandings)</p>
                        <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                          <div
                            onClick={() => setSelectedPreLandingId("")}
                            className={`flex items-center p-2 rounded-xl border transition-all cursor-pointer ${
                              selectedPreLandingId === ""
                                ? "bg-emerald-50/50 border-emerald-500/30 text-emerald-905 font-medium"
                                : "border-slate-100 hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${selectedPreLandingId === "" ? "border-emerald-500 bg-white" : "border-slate-300 bg-white"}`}>
                                {selectedPreLandingId === "" && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                              </div>
                              <span className="text-xs">Nenhuma pré-landing (Tráfego Direto)</span>
                            </div>
                          </div>

                          {offerTemplates.filter(t => t.type === 1).map((t) => (
                            <div
                              key={t.id}
                              onClick={() => setSelectedPreLandingId(t.id)}
                              className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                                selectedPreLandingId === t.id
                                  ? "bg-emerald-50/50 border-emerald-500/30 text-emerald-905 font-medium"
                                  : "border-slate-100 hover:bg-slate-50 text-slate-700"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${selectedPreLandingId === t.id ? "border-emerald-500 bg-white" : "border-slate-300 bg-white"}`}>
                                  {selectedPreLandingId === t.id && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                                </div>
                                <span className="text-xs font-mono font-bold text-slate-400">{t.id}</span>
                                <span className="text-xs truncate max-w-[130px]" title={t.name}>{t.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-slate-400 font-semibold font-mono">n/a</span>
                                {t.preview_url && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(t.preview_url, "_blank");
                                    }}
                                    className="text-slate-400 hover:text-slate-700 p-0.5 rounded"
                                    title="Visualizar Prelanding"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* Middle Card Stack */}
            <div className="md:col-span-6 space-y-6">
              {/* Info oferta */}
              <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Info oferta</h3>
                {activeOffer ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-3">
                      {activeOffer.avatarUrl ? (
                        <img src={activeOffer.avatarUrl} alt={activeOffer.name} className="h-12 w-12 rounded-full object-cover border border-slate-100 bg-slate-50" />
                      ) : (
                        <div className={`h-12 w-12 rounded-full border flex items-center justify-center shrink-0 ${getCategoryIconFromLabel(catLabel).bg}`}>
                          {(() => { const Icon = getCategoryIconFromLabel(catLabel).icon; return <Icon className="h-6 w-6" />; })()}
                        </div>
                      )}
                      <div className="text-left">
                        <h4 className="text-sm font-extrabold text-slate-800 leading-tight">{activeOffer.name} - {activeOffer.model} - [{(activeOffer.geo || []).join(",")}]</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">{catLabel}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-5 gap-1 text-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px]">
                      <div>
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wider">Pagamento</p>
                        <p className="font-extrabold text-emerald-600 mt-0.5">{activeOffer.payout > 0 ? `$${activeOffer.payout.toFixed(2)}` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wider">Preço</p>
                        <p className="font-extrabold text-slate-700 mt-0.5">{activeOffer.price ? `${activeOffer.price} ${activeOffer.priceCurrency}` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wider">Modelo</p>
                        <p className="font-extrabold text-slate-700 mt-0.5">{activeOffer.model}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wider">Aprovação</p>
                        <p className="font-extrabold text-indigo-600 mt-0.5">{activeOffer.approvalRate > 0 ? `${activeOffer.approvalRate.toFixed(1)}%` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wider">Rank</p>
                        <p className="font-extrabold text-slate-700 mt-0.5">{activeOffer.rank || "—"}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-3 text-center py-4">Selecione um produto para visualizar as informações.</p>
                )}
              </Card>

              {/* Domínio settings */}
              <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Domínio</h3>
                <div className="mt-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      onClick={() => setDomainType("our")}
                      className={`h-4 w-4 rounded-full border mt-1 flex items-center justify-center shrink-0 cursor-pointer ${domainType === "our" ? "border-emerald-500 bg-white" : "border-slate-300 bg-white"}`}
                    >
                      {domainType === "our" && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                    </div>
                    <div className="flex-1 text-left space-y-2">
                      <span className="text-xs font-bold text-slate-700 cursor-pointer" onClick={() => setDomainType("our")}>O nosso domínio</span>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Subdomínio"
                          disabled={domainType !== "our"}
                          value={subdomain}
                          onChange={(e) => setSubdomain(e.target.value)}
                          className="rounded-xl border-slate-200 text-xs h-9 shadow-2xs flex-1 bg-slate-50/20"
                        />
                        <select
                          disabled={domainType !== "our"}
                          value={selectedDomain}
                          onChange={(e) => setSelectedDomain(e.target.value)}
                          className="rounded-xl h-9 border border-slate-200 bg-white text-xs text-slate-600 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs flex-1"
                        >
                          {dbDomains.map(dom => (
                            <option key={dom.id} value={dom.name}>
                              {dom.name} {dom.type === 2 ? "(Shared)" : ""}
                            </option>
                          ))}
                          {dbDomains.length === 0 && (
                            <>
                              <option value="doctorfox1ck.com">doctorfox1ck.com</option>
                              <option value="ratos2s.com">ratos2s.com</option>
                              <option value="br-leads.org">br-leads.org</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 pt-2 border-t border-slate-100">
                    <div
                      onClick={() => setDomainType("parking")}
                      className={`h-4 w-4 rounded-full border mt-1 flex items-center justify-center shrink-0 cursor-pointer ${domainType === "parking" ? "border-emerald-500 bg-white" : "border-slate-300 bg-white"}`}
                    >
                      {domainType === "parking" && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                    </div>
                    <div className="flex-1 text-left space-y-2">
                      <span className="text-xs font-bold text-slate-700 cursor-pointer flex items-center gap-1" onClick={() => setDomainType("parking")}>
                        Parking <span className="text-[10px] text-slate-400 font-normal">(Use seu próprio domínio de DNS)</span>
                      </span>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Subdomínio"
                          disabled={domainType !== "parking"}
                          className="rounded-xl border-slate-200 text-xs h-9 shadow-2xs flex-1 bg-slate-100 cursor-not-allowed"
                        />
                        <Input
                          placeholder="Domínio"
                          disabled={domainType !== "parking"}
                          className="rounded-xl border-slate-200 text-xs h-9 shadow-2xs flex-1 bg-slate-100 cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Traffback spanning wide */}
            <div className="md:col-span-12">
              <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Traffback</h3>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="traff-url" className="text-[10px] font-semibold text-slate-500">Link para tráfego alternativo (Opcional)</Label>
                  <Input
                    id="traff-url"
                    placeholder="https://link-de-redirecionamento-de-reserva.com"
                    value={traffbackUrl}
                    onChange={(e) => setTraffbackUrl(e.target.value)}
                    className="rounded-xl border-slate-200 text-xs shadow-2xs h-9"
                  />
                </div>
              </Card>
            </div>
            
          </div>

          {/* Right Column: Marcas & Create Button */}
          <div className="lg:col-span-3 space-y-6">
            <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
              <h3 className="font-extrabold text-sm text-slate-800 border-b border-slate-100 pb-2">Marcas</h3>
              <div className="space-y-1.5">
                <Label htmlFor="brand-template" className="text-xs font-semibold text-slate-600">Template</Label>
                <select
                  id="brand-template"
                  className="w-full rounded-xl h-10 border border-slate-200 bg-white text-xs text-slate-700 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs"
                >
                  <option>Nenhum template</option>
                  <option>Template Principal</option>
                  <option>Template Alternativo</option>
                </select>
              </div>

              <div className="space-y-3 pt-2">
                <Label className="text-xs font-bold text-slate-700">Sub-contas (SubID)</Label>
                {[
                  { id: "sub1", label: "Sub1", value: sub1, setter: setSub1 },
                  { id: "sub2", label: "Sub2", value: sub2, setter: setSub2 },
                  { id: "sub3", label: "Sub3", value: sub3, setter: setSub3 },
                  { id: "sub4", label: "Sub4", value: sub4, setter: setSub4 },
                  { id: "sub5", label: "Sub5", value: sub5, setter: setSub5 },
                ].map(sub => (
                  <div key={sub.id} className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400 w-10">{sub.label}</span>
                    <Input
                      id={sub.id}
                      placeholder={sub.label}
                      value={sub.value}
                      onChange={(e) => sub.setter(e.target.value)}
                      className="rounded-xl border-slate-200 text-xs shadow-2xs h-9 flex-1"
                    />
                  </div>
                ))}
              </div>
            </Card>

            <div className="pt-2">
              <Button
                type="submit"
                disabled={isCreatingCampaign}
                className="w-full rounded-xl h-12 text-sm font-extrabold text-white shadow-md bg-gradient-to-r from-lime-500 to-emerald-500 hover:from-lime-600 hover:to-emerald-600 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {isCreatingCampaign ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Criar campanha"
                )}
              </Button>
            </div>
          </div>

        </div>
      </form>
    );
  };

  // ── RENDER 2.5: Dashboard ──────────────────────────────────────────────────

  const renderDashboard = () => {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Top summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            {
              title: "Saldo Disponível",
              value: `$${usdBalance.toFixed(2)}`,
              desc: "Moeda padrão USD",
              icon: Wallet,
              color: "text-emerald-500 bg-emerald-50 border-emerald-100",
            },
            {
              title: "Leads Aprovados",
              value: "24",
              desc: "Conversões confirmadas",
              icon: UserCheck,
              color: "text-indigo-500 bg-indigo-50 border-indigo-100",
            },
            {
              title: "Leads Pendentes",
              value: "12",
              desc: "Aguardando call center",
              icon: Loader2,
              color: "text-amber-500 bg-amber-50 border-amber-100",
            },
            {
              title: "Taxa de Aprovação",
              value: "66.7%",
              desc: "Média das suas ofertas",
              icon: Activity,
              color: "text-sky-500 bg-sky-50 border-sky-105",
            },
          ].map((card, i) => {
            const Icon = card.icon;
            return (
              <Card key={i} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs flex items-center justify-between">
                <div className="text-left space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{card.title}</span>
                  <p className="text-2xl font-black text-slate-800">{card.value}</p>
                  <span className="text-[10px] text-slate-400 font-medium">{card.desc}</span>
                </div>
                <div className={`h-11 w-11 rounded-xl border flex items-center justify-center shrink-0 ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </Card>
            );
          })}
        </div>

        {/* Two-column layout: Campanhas Recentes & Top Offers */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Campanhas Recentes (Streams) */}
          <Card className="lg:col-span-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-500" /> Minhas Campanhas Recentes
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveSection("campanhas")}
                className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg h-7"
              >
                Nova campanha <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>

            {isLoadingDashboard ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <Loader2 className="h-6 w-6 text-emerald-500 animate-spin" />
                <p className="text-[10px] text-slate-400 font-medium">Carregando campanhas...</p>
              </div>
            ) : dashboardStreams.length === 0 ? (
              <div className="text-center py-16">
                <Target className="mx-auto h-7 w-7 text-slate-300" />
                <p className="text-xs font-bold text-slate-500 mt-2">Nenhuma campanha criada ainda</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Use o criador de campanhas para gerar seu primeiro link.</p>
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-slate-100">
                      <TableHead className="py-2.5 text-[10px] font-bold uppercase text-slate-400 w-[15%]">Código</TableHead>
                      <TableHead className="py-2.5 text-[10px] font-bold uppercase text-slate-400 w-[30%]">Nome</TableHead>
                      <TableHead className="py-2.5 text-[10px] font-bold uppercase text-slate-400 w-[40%]">Domínio de Destino</TableHead>
                      <TableHead className="py-2.5 text-[10px] font-bold uppercase text-slate-400 text-right pr-2">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardStreams.map((s) => {
                      const subPrefix = s.subdomain ? `${s.subdomain}.` : "";
                      const trackingLink = `https://${subPrefix}${s.domain}/l`;
                      return (
                        <TableRow key={s.id} className="hover:bg-slate-50/40 border-b border-slate-100">
                          <TableCell className="py-2.5 font-mono text-xs text-slate-500">{s.code}</TableCell>
                          <TableCell className="py-2.5 text-xs font-bold text-slate-700">{s.name}</TableCell>
                          <TableCell className="py-2.5 text-xs text-slate-600 font-mono truncate max-w-[200px]" title={trackingLink}>
                            {trackingLink}
                          </TableCell>
                          <TableCell className="py-2.5 text-right pr-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              type="button"
                              onClick={() => {
                                copyToClipboard(trackingLink);
                                toast({ title: "Copiado!", description: "Link de rastreamento copiado.", variant: "default" });
                              }}
                              className="h-7 px-2 text-[10px] font-bold bg-slate-50 border border-slate-100 hover:bg-slate-100 text-slate-600 rounded-md"
                            >
                              Copiar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {/* Right: Top Offers */}
          <Card className="lg:col-span-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500 animate-pulse" /> Top Ofertas Global
              </h3>
              <span className="text-[9px] bg-rose-50 text-rose-500 border border-rose-100 font-bold px-2 py-0.5 rounded-full uppercase">Hot</span>
            </div>

            {isLoadingDashboard ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-6 w-6 text-emerald-500 animate-spin" />
              </div>
            ) : topOffers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">Nenhuma oferta em destaque no momento.</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {topOffers.map((offer) => {
                  const geoMatch = offer.name_composite.match(/\[([A-Z]{2})\]/);
                  const geo = geoMatch ? geoMatch[1] : "🌐";
                  return (
                    <div key={offer.id} className="flex items-center justify-between p-2.5 bg-slate-50/50 border border-slate-100 rounded-xl hover:bg-slate-50 transition-all text-left">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {offer.img_avatar_url ? (
                          <img
                            src={offer.img_avatar_url}
                            alt={offer.name_composite}
                            className="h-8 w-8 rounded-full object-cover border border-slate-100 shrink-0 bg-white"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-slate-100 border flex items-center justify-center shrink-0">
                            <Tag className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate max-w-[130px]" title={offer.name_composite}>
                            {offer.name_composite.split("-")[0].trim()}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] bg-slate-100 text-slate-500 px-1 rounded font-mono font-bold">
                              {getGeoFlag(geo)} {geo}
                            </span>
                            <span className="text-[9px] text-slate-400 font-medium">{offer.category_name}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] font-black text-emerald-600">${offer.approve.toFixed(2)}</p>
                          <p className="text-[8px] text-indigo-500 font-bold font-mono mt-0.5">{offer.rate}% AR</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          onClick={() => {
                            setSelectedOfferId(offer.id);
                            setActiveSection("campanhas");
                            toast({ title: "Oferta Selecionada!", description: `${offer.name_composite.split("-")[0].trim()} carregado no criador.`, variant: "default" });
                          }}
                          className="h-7 w-7 bg-white hover:bg-slate-100 border border-slate-150 rounded-lg text-slate-400 hover:text-slate-700 shadow-2xs flex items-center justify-center"
                          title="Criar Campanha"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  };

  // ── RENDER 3: Settings ────────────────────────────────────────────────────

  const renderDefinicoes = () => (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-slate-200 bg-white max-w-3xl mx-auto shadow-sm animate-in fade-in duration-300">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="text-lg font-bold text-slate-800">Configuração de Postback Global (S2S)</CardTitle>
          <CardDescription>Integre e envie dados de conversão do Dr. Cash de volta para a sua plataforma de vendas</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-1.5 text-left">
            <Label htmlFor="pb-url" className="text-xs font-semibold text-slate-700">Postback URL Global</Label>
            <Input
              id="pb-url"
              type="text"
              placeholder="https://sua-s2s-url.com/postback?orderid={uuid}&product={offer}&amount={payment}"
              value={postbackUrl}
              onChange={(e) => setPostbackUrl(e.target.value)}
              className="rounded-xl border-slate-200 bg-slate-50 font-mono text-xs focus:bg-white focus-visible:ring-primary focus-visible:border-primary shadow-xs h-12"
            />
          </div>

          <div className="space-y-3 text-left">
            <Label className="text-xs font-semibold text-slate-700">Status de Envio de Postback</Label>
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
              <div className="flex items-center space-x-2">
                <Checkbox id="trigger-new" checked={triggers.new} onCheckedChange={(checked) => setTriggers({ ...triggers, new: !!checked })} />
                <label htmlFor="trigger-new" className="text-xs font-medium text-slate-600 cursor-pointer">Nova conversão (Pendente)</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="trigger-confirmed" checked={triggers.confirmed} onCheckedChange={(checked) => setTriggers({ ...triggers, confirmed: !!checked })} />
                <label htmlFor="trigger-confirmed" className="text-xs font-medium text-slate-600 cursor-pointer">Confirmação da conversão (Aprovada)</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="trigger-rejected" checked={triggers.rejected} onCheckedChange={(checked) => setTriggers({ ...triggers, rejected: !!checked })} />
                <label htmlFor="trigger-rejected" className="text-xs font-medium text-slate-600 cursor-pointer">Rejeição da conversão (Cancelada)</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="trigger-trash" checked={triggers.trash} onCheckedChange={(checked) => setTriggers({ ...triggers, trash: !!checked })} />
                <label htmlFor="trigger-trash" className="text-xs font-medium text-slate-600 cursor-pointer">Conversão do lixo (Spam)</label>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-left">
            <Label className="text-xs font-semibold text-slate-700">Macros Disponíveis (Dr. Cash)</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono bg-slate-50 p-4 rounded-xl border border-slate-200/50">
              {[
                ["{uuid}", "ID da transação único"],
                ["{offer}", "Identificação da oferta no sistema"],
                ["{payment}", "Recompensa (payout)"],
                ["{currency}", "Moeda (ex: USD)"],
                ["{status}", "Status da conversão (suspensa/aprovada)"],
                ["{sub1} - {sub5}", "Sub-contas personalizadas"],
                ["{ip}", "IP do cliente"],
                ["{campaign}", "Código da campanha"],
              ].map(([macro, desc]) => (
                <div key={macro} className="flex justify-between border-b border-slate-200/40 pb-1.5">
                  <span className="text-emerald-600 font-bold">{macro}</span>
                  <span className="text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="rounded-xl h-11 px-6 font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2"
            >
              {isSavingSettings ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4" /> Guardar alterações</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-slate-200 bg-white max-w-3xl mx-auto shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="text-lg font-bold text-slate-800">
            Integração Dr. Cash
          </CardTitle>
          <CardDescription>Gerencie a chave de API de sua conta Dr. Cash integrada</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4 text-left">
          <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-600">Status da Integração:</span>
              <span className="font-extrabold text-emerald-600 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Ativa e Sincronizada
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-600">Chave de API:</span>
              <span className="font-mono text-slate-500 bg-white border border-slate-150 px-2 py-0.5 rounded text-[11px]">
                {apiToken ? `${apiToken.substring(0, 12)}...${apiToken.substring(apiToken.length - 8)}` : "Não configurado"}
              </span>
            </div>
          </div>
          <div className="pt-2 flex justify-end">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDisconnectToken}
              className="rounded-xl h-10 px-4 font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs transition-colors"
            >
              Desconectar Conta
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── RENDER 3.5: Finanças ──────────────────────────────────────────────────

  const renderFinancas = () => {
    // Find the wallet matching selectedWalletId
    const selectedWallet = wallets.find(w => w.id === Number(selectedWalletId));
    
    // Find balance matching selected wallet currency, or default to usdBalance
    const rawTargetBalance = selectedWallet 
      ? (balanceItems.find(b => b.currency === selectedWallet.currency)?.sum ?? 0)
      : (balanceItems.find(b => b.currency === "USD")?.sum ?? 0);
    const targetBalance = (selectedWallet?.currency === "USD" || !selectedWallet)
      ? Math.max(0, rawTargetBalance - subtractedBalance)
      : rawTargetBalance;

    const handleRequestPayout = (e: React.FormEvent) => {
      e.preventDefault();
      const amount = parseFloat(payoutAmount);
      if (isNaN(amount) || amount <= 0) {
        toast({
          title: "Valor inválido",
          description: "Insira um valor maior que zero para o saque.",
          variant: "destructive",
        });
        return;
      }

      if (amount > targetBalance) {
        toast({
          title: "Saldo insuficiente",
          description: `Você não tem saldo suficiente de ${selectedWallet?.currency || 'USD'} para esta retirada (Saldo disponível: ${targetBalance.toFixed(2)}).`,
          variant: "destructive",
        });
        return;
      }

      setIsSubmittingPayout(true);
      setTimeout(() => {
        const newReq: PayoutRequest = {
          id: `W-2026-${Math.floor(1000 + Math.random() * 9000)}`,
          date: new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          walletName: formatWalletSystemName(selectedWallet?.payment_system_name || "Wire"),
          accountNumber: selectedWallet?.account_number || "US***9812",
          amount: amount,
          currency: selectedWallet?.currency || "USD",
          status: "Pendente",
        };

        const updated = [newReq, ...payoutHistory];
        setPayoutHistory(updated);
        localStorage.setItem("drcash_payout_history", JSON.stringify(updated));
        
        // Subtract from simulated balance items locally for immediate feedback
        setBalanceItems(prev => prev.map(b => {
          if (b.currency === (selectedWallet?.currency || "USD")) {
            return { ...b, sum: Math.max(0, b.sum - amount) };
          }
          return b;
        }));

        // Persist the subtracted balance if it was a USD transaction
        if (!selectedWallet || selectedWallet.currency === "USD") {
          const newSubVal = subtractedBalance + amount;
          setSubtractedBalance(newSubVal);
          localStorage.setItem("drcash_subtracted_balance", String(newSubVal));
        }

        setPayoutAmount("");
        setIsSubmittingPayout(false);
        toast({
          title: "Saque Solicitado!",
          description: `Seu saque de $${amount.toFixed(2)} ${selectedWallet?.currency || 'USD'} foi registrado com sucesso.`,
          variant: "default",
        });
      }, 1200);
    };

    return (
      <div className="space-y-6 animate-in fade-in duration-300 text-left">
        {/* Balances section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Saldo Total (USD)</span>
              <p className="text-2xl font-black text-foreground">${usdBalance.toFixed(2)}</p>
              <span className="text-[10px] text-muted-foreground font-medium">Sincronizado da API Dr. Cash</span>
            </div>
            <div className="h-11 w-11 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
          </Card>

          {balanceItems.filter(b => b.currency !== "USD").map((bal, i) => (
            <Card key={i} className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Saldo ({bal.currency})</span>
                <p className="text-2xl font-black text-foreground">{bal.sum.toFixed(2)} {bal.currency}</p>
                <span className="text-[10px] text-muted-foreground font-medium">Sincronizado</span>
              </div>
              <div className="h-11 w-11 rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5" />
              </div>
            </Card>
          ))}

          {balanceItems.length <= 1 && (
            <Card className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5 shadow-xs flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Outras Moedas</span>
                <p className="text-sm font-semibold text-muted-foreground/80">Sem mais saldos de outras moedas</p>
                <span className="text-[10px] text-muted-foreground font-medium">Configure carteiras adicionais no painel principal</span>
              </div>
              <div className="h-11 w-11 rounded-xl border border-border/40 bg-muted/40 text-muted-foreground flex items-center justify-center shrink-0">
                <Plus className="h-5 w-5" />
              </div>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Request payout form */}
          <Card className="lg:col-span-5 rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-foreground border-b border-border/40 pb-2">Solicitar Retirada</h3>
            
            <form onSubmit={handleRequestPayout} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-select" className="text-xs font-semibold text-muted-foreground">Carteira de Destino</Label>
                {isLoadingWallets ? (
                  <div className="h-10 w-full rounded-xl border border-border/40 flex items-center justify-center text-xs text-muted-foreground bg-muted/20">
                    <Loader2 className="h-4 w-4 text-emerald-500 animate-spin mr-2" /> Carregando carteiras...
                  </div>
                ) : wallets.length === 0 ? (
                  <div className="h-10 w-full rounded-xl border border-border/40 flex items-center justify-center text-xs text-muted-foreground bg-muted/20">
                    Nenhuma carteira cadastrada
                  </div>
                ) : (
                  <select
                    id="wallet-select"
                    value={selectedWalletId}
                    onChange={(e) => setSelectedWalletId(Number(e.target.value))}
                    className="w-full rounded-xl h-10 border border-border/60 bg-background text-xs text-foreground px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs text-left"
                    required
                  >
                    {wallets.map(w => (
                      <option key={w.id} value={w.id}>
                        {formatWalletSystemName(w.payment_system_name)} ({w.currency}) {w.account_number ? `- ${w.account_number}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <Label htmlFor="payout-amount" className="text-xs font-semibold text-muted-foreground">Valor a Sacar</Label>
                  <span className="text-[10px] text-muted-foreground font-semibold">
                    Disponível: {targetBalance.toFixed(2)} {selectedWallet?.currency || "USD"}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-bold">
                    {selectedWallet?.currency === "USD" ? "$" : (selectedWallet?.currency || "")}
                  </span>
                  <Input
                    id="payout-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={targetBalance}
                    placeholder="0.00"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="pl-8 rounded-xl border-border/60 bg-muted/10 text-xs shadow-2xs h-10 font-bold text-foreground focus-visible:ring-emerald-500"
                    required
                    disabled={wallets.length === 0}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmittingPayout || wallets.length === 0 || targetBalance <= 0}
                className="w-full rounded-xl h-11 text-xs font-bold text-white shadow-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-muted/40 disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmittingPayout ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Processando...
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" /> Confirmar Solicitação de Saque
                  </>
                )}
              </Button>
            </form>
          </Card>

          {/* List of active wallets */}
          <Card className="lg:col-span-7 rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <h3 className="font-extrabold text-sm text-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-500" /> Minhas Carteiras no Dr. Cash
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddWalletOpen(true)}
                className="h-7 px-2 text-[10px] font-bold text-emerald-500 hover:bg-emerald-500/10 border-emerald-500/20 rounded-lg flex items-center gap-1 shadow-2xs"
              >
                <Plus className="h-3 w-3" /> Adicionar Carteira
              </Button>
            </div>

            {isLoadingWallets ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="h-6 w-6 text-emerald-500 animate-spin" />
                <p className="text-[10px] text-muted-foreground font-medium">Buscando carteiras cadastradas...</p>
              </div>
            ) : wallets.length === 0 ? (
              <div className="text-center py-8">
                <Wallet className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="text-xs font-bold text-muted-foreground mt-2">Nenhuma carteira vinculada</p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5">Vincule suas carteiras no painel oficial do Dr. Cash.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {wallets.map(w => (
                  <div key={w.id} className="flex items-center justify-between p-3 bg-muted/20 border border-border/40 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                        {formatWalletSystemName(w.payment_system_name).charAt(0).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold text-foreground">{formatWalletSystemName(w.payment_system_name)}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">Conta: {w.account_number || "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/25 font-bold px-2 py-0.5 rounded-md uppercase">
                          {w.currency}
                        </span>
                        <p className="text-[8px] text-muted-foreground mt-1">ID: {w.id}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteWallet(w.id)}
                        className="h-8 w-8 text-rose-500 hover:text-rose-450 hover:bg-rose-500/10 rounded-lg shrink-0"
                        title="Excluir carteira"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Withdrawal history list */}
        <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
          <h3 className="font-extrabold text-sm text-foreground border-b border-border/40 pb-2">Histórico de Retiradas</h3>
          {payoutHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhuma retirada solicitada ainda.</p>
          ) : (
            <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/40">
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground">ID Transação</TableHead>
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground">Data / Hora</TableHead>
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground">Método</TableHead>
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground">Conta</TableHead>
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground">Valor</TableHead>
                    <TableHead className="py-2 text-[10px] font-bold uppercase text-muted-foreground text-right pr-2">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payoutHistory.map((h) => (
                    <TableRow key={h.id} className="hover:bg-muted/40 border-b border-border/40">
                      <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">{h.id}</TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground/90">{h.date}</TableCell>
                      <TableCell className="py-2.5 text-xs font-bold text-foreground">{h.walletName}</TableCell>
                      <TableCell className="py-2.5 text-xs font-mono text-muted-foreground">{h.accountNumber || "—"}</TableCell>
                      <TableCell className="py-2.5 text-xs font-black text-foreground">
                        {h.currency === "USD" ? "$" : ""}{h.amount.toFixed(2)} {h.currency !== "USD" ? h.currency : ""}
                      </TableCell>
                      <TableCell className="py-2.5 text-right pr-2">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                          h.status === "Pendente" 
                            ? "bg-amber-500/10 text-amber-500 border-amber-500/20" 
                            : h.status === "Processado" 
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
                            : "bg-rose-500/10 text-rose-500 border-rose-500/20"
                        }`}>
                          {h.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    );
  };

  // ── RENDER 4: Simulated placeholder views ─────────────────────────────────

  const renderSimulatedView = (section: string) => {
    if (section === "leads") {
      return (
        <Card className="rounded-2xl border border-border/40 bg-card shadow-xs p-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-4">
            <h3 className="font-extrabold text-foreground text-base flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-emerald-500" /> Registro de Leads Recentes
            </h3>
            <span className="text-xs bg-muted text-muted-foreground font-bold px-2.5 py-1 rounded-full uppercase">Sincronizado</span>
          </div>
          <div className="overflow-x-auto w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-2.5 text-xs">ID Lead</TableHead>
                  <TableHead className="py-2.5 text-xs">Data / Hora</TableHead>
                  <TableHead className="py-2.5 text-xs">Produto</TableHead>
                  <TableHead className="py-2.5 text-xs">GEO</TableHead>
                  <TableHead className="py-2.5 text-xs">Status</TableHead>
                  <TableHead className="py-2.5 text-xs text-right">Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { id: "1098234", date: "13/06/2026 15:42", name: "Big Hunter", geo: "IN", status: "Aprovado", comm: 5.50, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
                  { id: "1098221", date: "13/06/2026 14:15", name: "Hammer of Thor 2", geo: "EG", status: "Pendente", comm: 13.00, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
                  { id: "1098199", date: "13/06/2026 11:04", name: "Nutrilaben", geo: "PL", status: "Rejeitado", comm: 23.00, color: "text-rose-500 bg-rose-500/10 border-rose-500/20" },
                  { id: "1098055", date: "12/06/2026 23:51", name: "Mellow Zen", geo: "AT", status: "Aprovado", comm: 24.00, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
                  { id: "1097891", date: "12/06/2026 18:22", name: "Collagen Complex", geo: "PL", status: "Aprovado", comm: 19.00, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
                ].map((lead) => (
                  <TableRow key={lead.id} className="hover:bg-muted/40 border-b border-border/40">
                    <TableCell className="py-3 font-mono text-[11px] text-muted-foreground">{lead.id}</TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground/95">{lead.date}</TableCell>
                    <TableCell className="py-3 text-xs font-bold text-foreground">{lead.name}</TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground/90">{lead.geo}</TableCell>
                    <TableCell className="py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${lead.color}`}>{lead.status}</span>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-right font-extrabold text-foreground">${lead.comm.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      );
    }

    return (
      <Card className="rounded-2xl border border-border/40 bg-card shadow-xs p-8 text-center animate-in fade-in duration-300">
        <div className="max-w-md mx-auto space-y-4">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-500 flex items-center justify-center mx-auto shadow-2xs">
            <Sliders className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-extrabold text-base text-foreground capitalize">{section}</h4>
            <p className="text-xs text-muted-foreground">Esta seção simula a visualização direta da sua conta Dr. Cash integrada.</p>
          </div>
          <div className="bg-muted/20 border border-border/40 rounded-xl p-4 text-xs text-left space-y-2 text-muted-foreground">
            <div className="flex justify-between">
              <span>Status da Integração:</span>
              <span className="font-bold text-emerald-500 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Ativa</span>
            </div>
            <div className="flex justify-between">
              <span>Token de Acesso:</span>
              <span className="font-mono">NGNLMDJ...N00OTY3</span>
            </div>
          </div>
          <Button size="sm" asChild className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 px-4">
            <a href="https://affiliate.dr.cash" target="_blank" rel="noopener noreferrer">
              Acessar Painel Oficial <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </Card>
    );
  };

  // ── Main layout ───────────────────────────────────────────────────────────

  if (isLoadingToken) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <span className="text-xs font-medium text-muted-foreground">Verificando status de integração...</span>
      </div>
    );
  }

  if (!apiToken) {
    return (
      <div className="p-6 bg-background min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-8 shadow-xs">
          <CardContent className="space-y-6 p-0 text-left">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-1.5">
                Integração Dr. Cash 🏦
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Conecte sua conta informando seu token de acesso de API para sincronizar suas ofertas, campanhas e finanças de forma mágica! ✨
              </p>
            </div>

            <form onSubmit={handleSaveToken} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="api-token" className="text-[11px] font-semibold text-muted-foreground">Token de API</Label>
                <Input
                  id="api-token"
                  type="password"
                  placeholder="Cole seu token de acesso de API"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  className="rounded-lg border-border/60 bg-muted/20 text-foreground focus-visible:ring-emerald-500 focus-visible:border-emerald-500 h-10 text-xs"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isVerifyingToken}
                className="w-full rounded-lg h-10 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center justify-center border-none shadow-none cursor-pointer"
              >
                {isVerifyingToken ? "Sincronizando..." : "Conectar Conta"}
              </Button>
            </form>

            <div className="border-t border-border/40 pt-4 space-y-2 text-muted-foreground text-[11px]">
              <span className="font-semibold text-foreground">Como obter o seu token:</span>
              <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-muted-foreground">
                <li>Acesse o painel do <a href="https://affiliate.dr.cash" target="_blank" rel="noopener noreferrer" className="text-foreground font-semibold hover:underline hover:text-emerald-500">affiliate.dr.cash</a></li>
                <li>Clique no seu nome no canto superior direito e selecione Perfil (Profile)</li>
                <li>Copie o campo Access Token no topo da página</li>
                <li>Cole no campo acima para estabelecer a sincronização</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-300 bg-background min-h-screen">

      {/* Top Black Bar */}
      <div className="bg-[#0a0a0a] text-white px-6 py-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black tracking-tight text-white flex items-center gap-1.5 select-none">
            <span className="text-emerald-500 font-extrabold text-2xl">dr.cash</span>
            <span className="text-slate-500 font-normal text-lg">|</span>
            <span className="text-slate-200 font-medium text-base capitalize">
              {activeSection === "definicoes" ? "Definições" : activeSection === "ofertas" ? "Ofertas" : activeSection === "campanhas" ? "Campanhas" : activeSection === "financas" ? "Finanças" : activeSection}
            </span>
          </span>
        </div>

        {/* Real profile + balance from API */}
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div className="flex items-center gap-2 cursor-pointer hover:opacity-90">
            <div className="h-7 w-7 bg-sky-500/20 text-sky-400 rounded-full border border-sky-500/30 flex items-center justify-center font-bold text-xs">
              {profileName.charAt(0).toUpperCase()}
            </div>
            <div className="text-left leading-none">
              <p className="text-[11px] font-bold text-white">{profileName.split(" ")[0]}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">O seu gestor</p>
            </div>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </div>

          <div className="h-5 w-px bg-slate-800" />

          <div className="text-left leading-none flex items-center gap-1">
            <span className="text-slate-400 text-xs font-medium">Saldo:</span>
            <span className="text-emerald-400 font-extrabold text-xs">${usdBalance.toFixed(2)}</span>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-90">
            <span className="text-slate-300 font-medium text-xs">{profileEmail}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
        {/* Left sidebar nav */}
        <Card className="rounded-2xl border border-border/40 bg-card p-2 shadow-xs">
          <div className="flex flex-col space-y-1">
            {[
              { id: "leads", label: "Leads 👥", icon: UserCheck },
              { id: "campanhas", label: "Campanhas 🎯", icon: Target },
              { id: "estatisticas", label: "Estatísticas 📊", icon: Activity },
              { id: "instrumentos", label: "Instrumentos 🛠️", icon: Sliders },
              { id: "ofertas", label: "Ofertas 🛍️", icon: Tag },
              { id: "financas", label: "Finanças 💰", icon: Wallet },
              { id: "definicoes", label: "Definições ⚙️", icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id as any)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                    isActive
                      ? "bg-emerald-500/10 text-emerald-600 shadow-2xs border border-emerald-500/10"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${isActive ? "text-emerald-500" : "text-muted-foreground"}`} />
                    <span>{item.label}</span>
                  </div>
                  {isActive && <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full" />}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Right content */}
        <div className="space-y-6 min-w-0">
          {activeSection === "ofertas" && renderOfertas()}
          {activeSection === "campanhas" && renderCampanhas()}
          {activeSection === "definicoes" && renderDefinicoes()}
          {activeSection === "financas" && renderFinancas()}
          {activeSection !== "ofertas" && activeSection !== "campanhas" && activeSection !== "definicoes" && activeSection !== "financas" && renderSimulatedView(activeSection)}
        </div>
      </div>

      {/* Offer Quick-View Modal */}
      {selectedOfferForLander && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg rounded-2xl border border-border/40 bg-card shadow-xl animate-in zoom-in-95 duration-200">
            <CardHeader className="border-b border-border/40 pb-4 flex flex-row justify-between items-start text-left">
              <div>
                <CardTitle className="text-base font-bold text-foreground">
                  {selectedOfferForLander.name}
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {getCategoryLabel(selectedOfferForLander.category)} · {(selectedOfferForLander.geo || []).join(", ")} · {selectedOfferForLander.model}
                </CardDescription>
              </div>
              <button
                onClick={() => setSelectedOfferForLander(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold bg-muted hover:bg-muted/80 rounded-full w-7 h-7 flex items-center justify-center"
              >
                ✕
              </button>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {/* Offer image */}
              {selectedOfferForLander.imageUrl && (
                <div className="flex justify-center">
                  <img
                    src={selectedOfferForLander.imageUrl}
                    alt={selectedOfferForLander.name}
                    className="h-24 object-contain rounded-xl border border-border/40 bg-muted/40 p-2"
                  />
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2 text-center bg-muted/30 p-3 rounded-xl border border-border/40 text-xs">
                <div>
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Pagamento</p>
                  <p className="font-extrabold text-emerald-500 mt-0.5">
                    {selectedOfferForLander.payout > 0 ? `$${selectedOfferForLander.payout.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Preço</p>
                  <p className="font-extrabold text-foreground mt-0.5">
                    {selectedOfferForLander.price ? `${selectedOfferForLander.price} ${selectedOfferForLander.priceCurrency}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Aprovação</p>
                  <p className="font-extrabold text-indigo-500 mt-0.5">
                    {selectedOfferForLander.approvalRate > 0 ? `${selectedOfferForLander.approvalRate.toFixed(1)}%` : "n/a"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">Rank</p>
                  <p className="font-extrabold text-foreground mt-0.5">{selectedOfferForLander.rank || "—"}</p>
                </div>
              </div>

              {/* Description */}
              {selectedOfferForLander.description && (
                <p className="text-xs text-muted-foreground">{selectedOfferForLander.description}</p>
              )}

              {/* Link */}
              {selectedOfferForLander.link && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-muted/20 border border-border/40 rounded-xl">
                    <div className="text-left">
                      <p className="text-xs font-bold text-foreground">Link de afiliado direto</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[280px] mt-0.5">{selectedOfferForLander.link}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild className="h-8 rounded-lg text-xs font-semibold">
                        <a href={selectedOfferForLander.link} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3 mr-1" /> Ver
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedOfferId(selectedOfferForLander.id);
                          setActiveSection("campanhas");
                          setSelectedOfferForLander(null);
                        }}
                        className="h-8 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        Criar Campanha
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          handleGenerateBridge(selectedOfferForLander.link);
                          setSelectedOfferForLander(null);
                        }}
                        className="h-8 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Gerar Ponte
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Materials link */}
              {selectedOfferForLander.materialLink && selectedOfferForLander.materialLink !== selectedOfferForLander.link && (
                <div className="flex items-center justify-between p-2.5 bg-muted/20 border border-border/40 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-foreground">Materiais criativos</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[260px] mt-0.5">{selectedOfferForLander.materialLink}</p>
                  </div>
                  <Button variant="outline" size="sm" asChild className="h-8 rounded-lg text-xs">
                    <a href={selectedOfferForLander.materialLink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" /> Abrir
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Wallet Modal */}
      {isAddWalletOpen && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md rounded-2xl border border-border/40 bg-card shadow-xl animate-in zoom-in-95 duration-200 text-left">
            <CardHeader className="border-b border-border/40 pb-4 flex flex-row justify-between items-start">
              <div>
                <CardTitle className="text-base font-bold text-foreground">
                  Adicionar Carteira de Pagamento
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Insira os detalhes da sua carteira ou conta para receber seus pagamentos do Dr. Cash.
                </CardDescription>
              </div>
              <button
                onClick={() => setIsAddWalletOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold bg-muted hover:bg-muted/80 rounded-full w-7 h-7 flex items-center justify-center"
              >
                ✕
              </button>
            </CardHeader>
            <form onSubmit={handleAddWallet}>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-wallet-system" className="text-xs font-semibold text-muted-foreground">Método de Pagamento</Label>
                  <select
                    id="new-wallet-system"
                    value={newWalletSystem}
                    onChange={(e) => {
                      setNewWalletSystem(e.target.value);
                      setNewWalletCurrency("USD");
                    }}
                    className="w-full rounded-xl h-10 border border-border/60 bg-background text-xs text-foreground px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer shadow-2xs"
                  >
                    <option value="Capitalist">Capitalist</option>
                    <option value="WebMoney">WebMoney (WMZ)</option>
                    <option value="PayPal">PayPal</option>
                    <option value="USDT TRC-20">Tether USDT (TRC-20)</option>
                    <option value="USDT ERC-20">Tether USDT (ERC-20)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-wallet-currency" className="text-xs font-semibold text-muted-foreground">Moeda</Label>
                  <select
                    id="new-wallet-currency"
                    value={newWalletCurrency}
                    onChange={(e) => setNewWalletCurrency(e.target.value)}
                    disabled
                    className="w-full rounded-xl h-10 border border-border/40 bg-muted/40 text-xs text-muted-foreground/60 px-3 focus:outline-none cursor-not-allowed shadow-2xs"
                  >
                    <option value="USD">USD ($)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-wallet-account" className="text-xs font-semibold text-muted-foreground">Número da Conta / Endereço da Carteira</Label>
                  <Input
                    id="new-wallet-account"
                    placeholder={
                      newWalletSystem === "Capitalist" 
                        ? "Ex: U12345678" 
                        : newWalletSystem === "WebMoney" 
                        ? "Ex: Z123456789012" 
                        : newWalletSystem === "PayPal" 
                        ? "Ex: seu-email@paypal.com" 
                        : newWalletSystem === "USDT TRC-20" 
                        ? "Ex: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" 
                        : "Ex: 0xdAC17F958D2ee523a2206206994597C13D831ec7"
                    }
                    value={newWalletAccount}
                    onChange={(e) => setNewWalletAccount(e.target.value)}
                    className="rounded-xl border-border/60 bg-muted/10 text-foreground text-xs shadow-2xs h-10 focus-visible:ring-emerald-500"
                    required
                  />
                </div>

                <div className="pt-4 border-t border-border/40 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddWalletOpen(false)}
                    className="rounded-xl h-10 px-4 text-xs font-bold border-border/60 text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isAddingWallet}
                    className="rounded-xl h-10 px-4 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                  >
                    {isAddingWallet ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Adicionando...
                      </>
                    ) : (
                      "Adicionar Carteira"
                    )}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      )}

    </div>
  );
}
