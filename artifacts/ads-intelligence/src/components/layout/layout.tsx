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

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campanhas",
  "/keywords": "Palavras-chave",
  "/reports": "Relatórios",
  "/trends": "Google Trends",
  "/creator": "Presell com IA",
  "/drcash": "Dr. Cash",
};

type ConnectionStatus = {
  configured: boolean;
  status: "not_configured" | "needs_account" | "connected" | "error";
  customerId: string | null;
  accounts: string[];
  error: string | null;
};

export function Layout({ children }: { children: ReactNode }) {
  const { data: user, isError, isLoading } = useGetMe();
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

  const pageTitle = PAGE_TITLES[location] || "ClickLab";

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
    if (isError) {
      setLocation("/login");
    }
  }, [isError, setLocation]);

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
        <main className="flex-1 overflow-auto bg-background flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-14 flex items-center justify-between px-5 border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg transition-colors w-8 h-8" />
              <div className="h-4 w-px bg-border/60" />
              <span className="text-sm font-semibold text-foreground/70">{pageTitle}</span>
            </div>
            <div className="flex items-center gap-4">
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
                className="text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg w-8 h-8 transition-colors cursor-pointer"
                title={theme === "light" ? "Mudar para Modo Escuro" : "Mudar para Modo Claro"}
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-amber-400" />}
              </Button>
            </div>
          </header>
          <div className="flex-1">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
