import { ReactNode, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sun, Moon, ChevronDown, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { MobileBottomNavigation, MobileProfileMenu } from "./mobile-navigation";
import { BackButton } from "@/components/ui/back-button";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campanhas",
  "/keywords": "Palavras-chave",
  "/reports": "Relatórios",
  "/trends": "Google Trends",
  "/creator": "Presell com IA",
  "/traffic-manager": "Gestor de Tráfego",
  "/drcash": "Dr. Cash",
  "/pricing": "Planos",
  "/support": "Suporte",
};

type ConnectionStatus = {
  configured: boolean;
  status: "not_configured" | "needs_account" | "connected" | "error";
  customerId: string | null;
  accounts: string[];
  error: string | null;
};

export function Layout({ children }: { children: ReactNode }) {
  const { data: user, error: userError, isError, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [switchingAccount, setSwitchingAccount] = useState<string | null>(null);

  const { data: adsStatus } = useQuery<ConnectionStatus>({
    queryKey: ["google-ads-connection"],
    queryFn: async () => {
      const response = await fetch("/api/status/google-ads", {
        headers: {
          ...(localStorage.getItem("ads_token") ? { Authorization: `Bearer ${localStorage.getItem("ads_token")}` } : {}),
        },
      });
      if (!response.ok) throw new Error("Erro");
      return response.json();
    },
    retry: false,
  });

  const selectAccount = async (customerId: string) => {
    setSwitchingAccount(customerId);
    try {
      const response = await fetch("/api/auth/google-ads/select-account", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("ads_token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ customerId }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || "Erro ao selecionar conta");
      }
      toast({
        title: "Conta selecionada",
        description: `Selecionada a conta ${customerId}`,
      });
      // Invalidate queries to trigger instant update
      await queryClient.invalidateQueries();
    } catch (err: any) {
      toast({
        title: "Erro ao alternar conta",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSwitchingAccount(null);
    }
  };

  const pageTitle = PAGE_TITLES[location] || "ClicLab";
  const isTrafficManager = location === "/traffic-manager";

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("light") ? "light" : "dark";
    }
    return "dark";
  });

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("app_theme", nextTheme);
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
  };

  useEffect(() => {
    const status = (userError as any)?.status;
    if (isError && (status === 401 || status === 403)) {
      if (status === 403) sessionStorage.setItem("account_access_error", "Sua conta está pausada ou bloqueada. Entre em contato com o suporte para recuperar o acesso.");
      localStorage.removeItem("ads_token");
      setLocation("/login");
    }
  }, [isError, setLocation, userError]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-10 w-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <div className="h-5 w-5 rounded-md bg-primary/60 animate-pulse" />
            </div>
            <div className="absolute inset-0 rounded-xl bg-primary/10 blur-md animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="relative flex h-screen flex-1 flex-col overflow-y-auto overflow-x-hidden bg-background min-w-0">
          {/* Top bar */}
          <header className={isTrafficManager
            ? "pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between p-5"
            : "sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-4 backdrop-blur-xl md:px-5"
          }>
            <div className="flex items-center gap-3">
              <SidebarTrigger className={isTrafficManager
                ? "pointer-events-auto hidden h-10 w-10 rounded-full border border-slate-200/80 bg-white/85 text-slate-500 shadow-[0_8px_32px_rgba(15,23,42,0.06)] backdrop-blur-sm hover:bg-white hover:text-slate-900 md:flex"
                : "hidden h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground md:flex"
              } />
              {isTrafficManager && (
                <BackButton href="/creator" label="Voltar para home" iconOnly className="pointer-events-auto bg-white md:hidden" />
              )}
              {!isTrafficManager && <div className="hidden h-4 w-px bg-border/60 md:block" />}
              {!isTrafficManager && <span className="text-sm font-semibold text-foreground/70">{pageTitle}</span>}
            </div>
            {!isTrafficManager && <div className="flex items-center gap-4">
              <MobileProfileMenu user={user} />
              <div className="hidden items-center gap-4 md:flex">
              {adsStatus?.status === "connected" && adsStatus.accounts && adsStatus.accounts.length > 0 && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-2 bg-muted/30 border-border/50 text-xs hover:bg-muted/50 cursor-pointer">
                        {switchingAccount ? (
                          <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                        ) : (
                          <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                        )}
                        <span>Conta: {adsStatus.customerId || "Nenhuma"}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-popover border border-border/60 backdrop-blur-xl">
                      {adsStatus.accounts.map((acc) => (
                        <DropdownMenuItem
                          key={acc}
                          onClick={() => selectAccount(acc)}
                          className={`text-xs gap-2 cursor-pointer ${acc === adsStatus.customerId ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                          <div className={`h-1.5 w-1.5 rounded-full ${acc === adsStatus.customerId ? "bg-emerald-400" : "bg-transparent"}`} />
                          <span>{acc}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="h-4 w-px bg-border/60" />
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="hidden"
                title={theme === "light" ? "Mudar para Modo Escuro" : "Mudar para Modo Claro"}
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-amber-400" />}
              </Button>
              </div>
            </div>}
          </header>
          <div className="flex-1 pb-24 md:pb-0">
            {children}
          </div>
        </main>
        <MobileBottomNavigation />
      </div>
    </SidebarProvider>
  );
}
