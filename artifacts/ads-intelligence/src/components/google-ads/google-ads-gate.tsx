import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Loader2, AlertTriangle, RefreshCw, Lock, ArrowRight, XCircle, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ConnectionStatus = {
  configured: boolean;
  status: "not_configured" | "needs_account" | "connected" | "error";
  customerId: string | null;
  accounts: string[];
  error: string | null;
};

function authHeaders(json = false) {
  const token = localStorage.getItem("ads_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function getConnectionStatus() {
  const response = await fetch("/api/status/google-ads", { headers: authHeaders() });
  if (!response.ok) throw new Error("Não foi possível verificar sua conexão com o Google Ads");
  return response.json() as Promise<ConnectionStatus>;
}

export function GoogleAdsGate({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorFromUrl, setErrorFromUrl] = useState<string | null>(null);
  const [syncStep, setSyncStep] = useState(0);

  const statusQuery = useQuery({
    queryKey: ["google-ads-connection"],
    queryFn: getConnectionStatus,
    retry: false,
  });

  // Watch URL params for OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAdsParam = params.get("googleAds");
    const messageParam = params.get("message");
    let timer: NodeJS.Timeout | undefined;

    if (googleAdsParam === "connected") {
      setIsSyncing(true);
      setErrorFromUrl(null);
      window.history.replaceState({}, document.title, window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["google-ads-connection"] });
      queryClient.invalidateQueries({ queryKey: ["google-ads-status"] });
      timer = setTimeout(() => { setIsSyncing(false); }, 3200);
    } else if (googleAdsParam === "error") {
      setIsSyncing(true);
      setErrorFromUrl(null);
      window.history.replaceState({}, document.title, window.location.pathname);
      timer = setTimeout(() => {
        setIsSyncing(false);
        setErrorFromUrl(messageParam || "Erro desconhecido ao conectar com o Google Ads");
      }, 3200);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  // Handle sync animation steps
  useEffect(() => {
    if (!isSyncing) { setSyncStep(0); return; }
    const interval = setInterval(() => {
      setSyncStep((prev) => (prev < 3 ? prev + 1 : prev));
    }, 750);
    return () => clearInterval(interval);
  }, [isSyncing]);

  const connect = async () => {
    setConnecting(true);
    setErrorFromUrl(null);
    try {
      const response = await fetch(
        `/api/auth/google-ads/connect?returnOrigin=${encodeURIComponent(window.location.origin)}`,
        { headers: authHeaders() },
      );
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Não foi possível iniciar a conexão");
      window.location.assign(data.url);
    } catch (error: any) {
      setConnecting(false);
      toast({ title: "Não foi possível conectar", description: error.message, variant: "destructive" });
    }
  };

  const selectAccount = async (customerId: string) => {
    setSelectingId(customerId);
    try {
      const response = await fetch("/api/auth/google-ads/select-account", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ customerId }),
      });
      const data = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(data?.error || "Não foi possível selecionar a conta");
      await queryClient.invalidateQueries({ queryKey: ["google-ads-connection"] });
      await queryClient.invalidateQueries({ queryKey: ["google-ads-status"] });
    } catch (error: any) {
      toast({ title: "Erro ao selecionar conta", description: error.message, variant: "destructive" });
    } finally {
      setSelectingId(null);
    }
  };

  const syncSteps = [
    "Estabelecendo conexão segura com o Google...",
    "Validando escopos e tokens de acesso...",
    "Carregando campanhas e métricas...",
    "Construindo seu painel de controle..."
  ];

  // Animation styles
  const customStyles = (
    <style>{`
      @keyframes dashflow {
        to { stroke-dashoffset: -20; }
      }
      @keyframes pulse-node {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.05); opacity: 0.9; }
      }
      .flowing-dash { stroke-dasharray: 6 6; animation: dashflow 1s linear infinite; }
      .pulse-node-l { transform-origin: 100px 60px; animation: pulse-node 2.5s ease-in-out infinite; }
      .pulse-node-r { transform-origin: 300px 60px; animation: pulse-node 2.5s ease-in-out infinite 0.4s; }
    `}</style>
  );

  // 1. Loading
  if (statusQuery.isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary/60" />
          <p className="text-xs font-medium text-muted-foreground">Verificando conexão...</p>
        </div>
      </div>
    );
  }

  // 2. Syncing animation
  if (isSyncing) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6">
        {customStyles}
        <div className="flex w-full max-w-lg flex-col items-center text-center animate-in fade-in duration-500">
          {/* SVG animation */}
          <svg className="w-full max-w-xs h-28 mb-2" viewBox="0 0 400 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="nodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
              <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#FBBC05" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            {/* Line */}
            <path d="M 128 60 L 272 60" stroke="url(#lineGrad)" strokeWidth="3" strokeLinecap="round" className="flowing-dash" />

            {/* Left node */}
            <g className="pulse-node-l">
              <circle cx="100" cy="60" r="32" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.3)" strokeWidth="1.5" />
              <circle cx="100" cy="60" r="22" fill="url(#nodeGrad)" />
              <rect x="91" y="53" width="4" height="13" rx="2" fill="white" opacity="0.9" />
              <rect x="98" y="47" width="4" height="19" rx="2" fill="white" opacity="0.9" />
              <rect x="105" y="56" width="4" height="10" rx="2" fill="white" opacity="0.9" />
            </g>

            {/* Right node (Google Ads) */}
            <g className="pulse-node-r">
              <circle cx="300" cy="60" r="32" fill="rgba(251,188,5,0.08)" stroke="rgba(251,188,5,0.2)" strokeWidth="1.5" />
              <circle cx="300" cy="60" r="22" fill="white" fillOpacity="0.06" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <g transform="translate(285, 45) scale(1.25)">
                <path fill="#FBBC05" d="M14.73 3.2a3.25 3.25 0 0 1 4.44 1.19l4.39 7.6a3.25 3.25 0 0 1-5.63 3.25l-4.39-7.6a3.25 3.25 0 0 1 1.19-4.44Z" />
                <path fill="#4285F4" d="M8.8 6.45a3.24 3.24 0 0 1 1.19 4.44L5.6 18.5a3.25 3.25 0 1 1-5.63-3.25l4.39-7.6A3.25 3.25 0 0 1 8.8 6.45Z" />
                <path fill="#34A853" d="M8.05 18.74A3.25 3.25 0 1 1 11.3 22a3.25 3.25 0 0 1-3.25-3.25Z" />
              </g>
            </g>
          </svg>

          <h2 className="text-xl font-bold tracking-tight text-foreground mt-2">Sincronizando com Google Ads</h2>
          <p className="mt-2 text-sm text-muted-foreground">Aguarde enquanto importamos seus dados com segurança.</p>

          {/* Steps */}
          <div className="mt-8 w-full max-w-sm rounded-2xl border border-border/50 bg-card/80 p-5">
            <div className="flex items-center gap-2 mb-4 border-b border-border/30 pb-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Progresso</span>
            </div>
            <div className="flex flex-col gap-3">
              {syncSteps.map((stepText, idx) => (
                <div key={idx} className="flex items-center gap-2.5 text-xs">
                  {syncStep > idx ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : syncStep === idx ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border border-border shrink-0" />
                  )}
                  <span className={`transition-colors ${
                    syncStep === idx ? "font-semibold text-foreground" :
                    syncStep > idx ? "text-muted-foreground/40 line-through" : "text-muted-foreground/50"
                  }`}>
                    {stepText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Error state
  const activeError = errorFromUrl || (statusQuery.data?.status === "error" ? statusQuery.data.error : null);
  if (activeError) {
    const errorDetails = parseErrorDetails(activeError);
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-12 animate-in fade-in zoom-in-95 duration-500">
        <div className="w-full max-w-xl rounded-2xl border border-border/50 bg-card/80 p-6 sm:p-8 shadow-lg">
          <div className="flex items-start gap-4 border-b border-border/40 pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/80">Erro de Integração</p>
              <h2 className="text-xl font-bold tracking-tight text-foreground mt-1">{errorDetails.title}</h2>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">O que aconteceu?</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{errorDetails.what}</p>
            </div>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Por que ocorreu?</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{errorDetails.why}</p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-400/80 mb-3">Como resolver?</h3>
              <ul className="space-y-2.5">
                {errorDetails.how.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 font-bold text-amber-400 shrink-0 text-[10px]">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-border/40 flex flex-col sm:flex-row gap-3">
            <Button
              onClick={connect}
              disabled={connecting}
              className="h-11 flex-1 rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:bg-primary/90 transition-all"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {errorDetails.isAccountIssue ? "Escolher outra conta Google" : "Tentar novamente"}
            </Button>
            {statusQuery.data?.status === "error" && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (confirm("Deseja realmente desconectar e limpar os dados locais de conexão?")) {
                    await fetch("/api/auth/google-ads/connection", { method: "DELETE", headers: authHeaders() });
                    setErrorFromUrl(null);
                    await queryClient.invalidateQueries({ queryKey: ["google-ads-connection"] });
                  }
                }}
                className="h-11 px-6 rounded-xl border-border/60 hover:bg-white/5 font-semibold text-muted-foreground transition-all"
              >
                Limpar Conexão
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. Connected
  if (statusQuery.data?.status === "connected") {
    return <>{children}</>;
  }

  // 5. Needs Account Selection
  const needsAccount = statusQuery.data?.status === "needs_account";
  const accounts = statusQuery.data?.accounts || [];

  if (needsAccount) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-12 animate-in fade-in zoom-in-95 duration-500">
        <div className="w-full max-w-md rounded-2xl border border-border/50 bg-card/80 p-6 sm:p-8 shadow-lg text-center flex flex-col items-center">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary/70">Múltiplas Contas</p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground mt-2">Escolha sua conta</h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            Encontramos mais de uma conta vinculada ao seu e-mail. Selecione qual deseja acompanhar.
          </p>

          <div className="mt-8 w-full space-y-2">
            {accounts.map((accountId) => (
              <button
                key={accountId}
                type="button"
                onClick={() => selectAccount(accountId)}
                disabled={Boolean(selectingId)}
                className="group flex w-full h-14 items-center justify-between rounded-xl border border-border/50 bg-card px-4 text-sm font-semibold text-foreground hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 transition-all duration-200 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-border/50 text-muted-foreground group-hover:text-primary group-hover:border-primary/30 transition-colors">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="block font-semibold text-foreground">Conta Individual</span>
                    <span className="block text-[11px] text-muted-foreground font-normal">ID: {formatCustomerId(accountId)}</span>
                  </div>
                </div>
                {selectingId === accountId ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:translate-x-1 group-hover:text-primary transition-all" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-8 pt-5 border-t border-border/30 w-full flex items-center justify-center gap-2 text-xs text-muted-foreground/50">
            <Lock className="h-3 w-3" />
            <span>Seus dados estão protegidos sob os termos do Google Cloud.</span>
          </div>
        </div>
      </div>
    );
  }

  // 6. Not Connected — landing
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-lg flex-col items-center text-center animate-reveal">
        {/* Hero icon */}
        <div className="relative mb-8">
          <div className="h-24 w-24 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <svg className="h-12 w-12" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#FBBC05" d="M14.73 3.2a3.25 3.25 0 0 1 4.44 1.19l4.39 7.6a3.25 3.25 0 0 1-5.63 3.25l-4.39-7.6a3.25 3.25 0 0 1 1.19-4.44Z" />
              <path fill="#4285F4" d="M8.8 6.45a3.24 3.24 0 0 1 1.19 4.44L5.6 18.5a3.25 3.25 0 1 1-5.63-3.25l4.39-7.6A3.25 3.25 0 0 1 8.8 6.45Z" />
              <path fill="#34A853" d="M8.05 18.74A3.25 3.25 0 1 1 11.3 22a3.25 3.25 0 0 1-3.25-3.25Z" />
            </svg>
          </div>
          <div className="absolute -inset-4 rounded-[2rem] bg-primary/5 blur-2xl" />
          {/* Orbit rings */}
          <div className="absolute -inset-6 rounded-full border border-primary/10 animate-spin" style={{ animationDuration: "12s" }} />
          <div className="absolute -inset-10 rounded-full border border-primary/5 animate-spin" style={{ animationDuration: "20s", animationDirection: "reverse" }} />
        </div>

        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/70 mb-3">Google Ads</p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Vamos sincronizar seus dados?
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
          Conecte sua conta para visualizar campanhas, palavras-chave e relatórios com seus dados reais de forma dinâmica.
        </p>

        <Button
          onClick={connect}
          disabled={connecting}
          className="mt-8 h-12 rounded-xl bg-primary px-8 font-semibold text-primary-foreground shadow-[0_0_28px_rgba(59,130,246,0.3)] hover:bg-primary/90 active:scale-[0.99] transition-all flex items-center gap-2.5"
        >
          {connecting ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Abrindo o Google...</>
          ) : (
            <><Zap className="h-4 w-4" fill="currentColor" />Conectar com Google Ads</>
          )}
        </Button>

        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground/50">
          <Lock className="h-3.5 w-3.5" />
          <span>Você autoriza apenas as contas que possui permissão para acessar.</span>
        </div>
      </div>
    </div>
  );
}

function formatCustomerId(value: string) {
  const clean = value.replace(/\D/g, "");
  return clean.length === 10 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}` : clean;
}

function parseErrorDetails(errMsg: string) {
  const msg = errMsg || "";

  if (msg.includes("No Google Ads accounts") || msg.includes("customerIds.length === 0")) {
    return {
      title: "Nenhuma conta vinculada",
      what: "Nenhuma conta de anúncios ativa do Google Ads foi localizada no login selecionado.",
      why: "A conta do Google que você selecionou não possui nenhuma conta de anúncios ativa ou associada ao seu e-mail.",
      how: [
        "Acesse ads.google.com para criar ou confirmar a existência de uma conta com esse e-mail.",
        "Se você possui uma conta em outro e-mail, clique em 'Escolher outra conta Google' e selecione o e-mail correto.",
        "Ou peça ao administrador para convidar seu e-mail atual como Administrador."
      ],
      isAccountIssue: true
    };
  }

  if (msg.includes("CUSTOMER_NOT_ENABLED") || msg.includes("not yet enabled") || msg.includes("deactivated")) {
    return {
      title: "Conta inativa ou suspensa",
      what: "A conta do Google Ads selecionada está inativa ou foi desativada.",
      why: "Isso ocorre se a conta foi suspensa por falta de pagamento, inatividade ou violação de políticas.",
      how: [
        "Faça login no Google Ads (ads.google.com) e regularize pendências financeiras.",
        "Certifique-se de que a conta está ativa e pronta para veicular anúncios.",
        "Selecione outra conta de anúncios válida durante o processo de sincronização."
      ],
      isAccountIssue: false
    };
  }

  if (msg.includes("DEVELOPER_TOKEN") || msg.includes("developer token") || msg.includes("not approved")) {
    return {
      title: "Token de acesso pendente",
      what: "O Token de desenvolvedor da API ainda não foi liberado em produção pelo Google.",
      why: "Para sincronizar dados reais, o Google exige a liberação e validação do token de API.",
      how: [
        "Se você está testando, conecte uma Conta de Teste do Google Ads.",
        "Se você é o proprietário, consulte o painel de desenvolvedores e aguarde a aprovação.",
        "Em caso de dúvidas, contate a administração do sistema."
      ],
      isAccountIssue: false
    };
  }

  return {
    title: "Falha de comunicação",
    what: "Não foi possível concluir a sincronização da sua conta com o Google Ads.",
    why: `O Google retornou o seguinte erro técnico: "${msg}"`,
    how: [
      "Verifique se você permitiu o acesso ao escopo do Google Ads na tela de consentimento.",
      "Tente novamente a conexão clicando no botão abaixo.",
      "Se o erro persistir, faça login novamente e tente refazer a vinculação."
    ],
    isAccountIssue: false
  };
}
