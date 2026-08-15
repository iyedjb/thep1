import { useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CheckCircle2 } from "lucide-react";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./logo";

type GoogleAdsStatus = {
  configured: boolean;
  status: "connected" | "not_configured" | "error" | "needs_account";
  customerId: string | null;
  error: string | null;
};

const navItems = [
  { path: "/creator", label: "Presell com IA" },
  { path: "/tracking", label: "Rastreamento" },
  { path: "/domains", label: "Meus domínios" },
  { path: "/traffic-manager", label: "Gestor de Tráfego" },
  { path: "/trends", label: "Google Trends" },
];

function formatCustomerId(value: string) {
  const clean = value.replace(/\D/g, "");
  return clean.length === 10
    ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
    : clean;
}

export function AppSidebar() {
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: user } = useGetMe() as any;
  const logout = useLogout();
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);

  const statusQuery = useQuery<GoogleAdsStatus>({
    queryKey: ["google-ads-connection"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/status/google-ads", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("status error");
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const confirmLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        localStorage.removeItem("ads_token");
        window.location.href = "/login";
      },
    });
  };

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase()
    : "U";
  const planLabels: Record<string, string> = {
    free: "Gratuito",
    starter: "Essencial",
    pro: "Profissional",
    enterprise: "Escala",
  };
  const currentPlan = user?.subscriptionStatus === "active"
    ? (planLabels[user?.subscriptionTier] || "Premium")
    : "Gratuito";

  const isConnected = statusQuery.data?.status === "connected";
  const customerId = statusQuery.data?.customerId;
  return (
    <>
      <Sidebar className="border-r border-sidebar-border/60 bg-sidebar">
      {/* Logo + Account ID */}
      <SidebarHeader className="px-5 pt-5 pb-4 border-b border-sidebar-border/40 space-y-4">
        <Link href="/creator" onClick={() => isMobile && setOpenMobile(false)} className="flex items-center gap-3 group select-none">
          <Logo iconSize={32} textClass="text-sidebar-foreground" />
        </Link>

        {/* Google Ads account chip */}
        {isConnected && customerId ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-400/70 leading-none mb-0.5">Conta Conectada</p>
              <p className="text-[11px] font-semibold text-sidebar-foreground font-mono truncate">
                {formatCustomerId(customerId)}
              </p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          </div>
        ) : statusQuery.data && !isConnected ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 leading-none mb-0.5">Google Ads</p>
              <p className="text-[11px] font-medium text-muted-foreground/60">Nao conectado</p>
            </div>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="px-4 py-5">
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/35 mb-1.5">
            Navegação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(({ path, label }) => {
                const isActive = location === path;
                return (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      size="lg"
                      className={`
                        group relative h-11 rounded-full px-4 gap-3 transition-all duration-200
                        [&>svg]:w-4 [&>svg]:h-4 [&>span]:text-[13.5px] [&>span]:font-medium
                        ${isActive
                          ? "bg-primary/[0.07] text-primary border border-primary/20"
                          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/5"
                        }
                      `}
                    >
                      <Link href={path} onClick={() => isMobile && setOpenMobile(false)} data-testid={`link-${label.toLowerCase().replace(/\s/g, "-")}`}>
                        {isActive && (
                          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full opacity-80" />
                        )}
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

        <SidebarFooter className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-card p-3 text-left shadow-[0_8px_28px_rgba(15,23,42,0.06)] transition-all hover:border-primary/30 hover:shadow-[0_10px_32px_rgba(15,23,42,0.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                data-testid="button-profile-menu"
                aria-label="Abrir menu do perfil"
              >
                <Avatar className="h-9 w-9 border border-primary/15">
                  <AvatarFallback className="border-0 bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
                    {user?.name || "Usuário"}
                  </span>
                  <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.16em] text-primary/60">
                    Abrir perfil
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={10}
              className="w-[16.5rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-primary/15 bg-popover p-1.5 text-popover-foreground shadow-[0_24px_70px_rgba(15,23,42,0.16)] sm:w-72"
            >
              <div className="px-3 pb-2.5 pt-2">
                <div className="mb-3 flex items-center justify-between border-b border-primary/15 pb-2.5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary/60">Plano atual</p>
                  <p className="text-xs font-semibold text-primary">{currentPlan}</p>
                </div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary/60">Sua conta</p>
                <p className="mt-2 truncate text-sm font-medium">{user?.name || "Usuário"}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email || ""}</p>
              </div>
              <DropdownMenuSeparator className="bg-primary/15" />
              <DropdownMenuItem asChild className="cursor-pointer rounded-xl px-3 py-3 text-sm focus:bg-primary/10 focus:text-primary">
                <Link href="/support" onClick={() => isMobile && setOpenMobile(false)}>Suporte</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-xl px-3 py-3 text-sm focus:bg-primary/10 focus:text-primary">
                <Link href="/pricing" onClick={() => isMobile && setOpenMobile(false)}>Planos</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-primary/15" />
              <DropdownMenuItem
                onSelect={() => setIsLogoutOpen(true)}
                className="cursor-pointer rounded-xl px-3 py-3 text-sm focus:bg-primary/10 focus:text-primary"
              >
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <Dialog open={isLogoutOpen} onOpenChange={setIsLogoutOpen}>
        <DialogContent className="max-w-[440px] overflow-hidden rounded-3xl border border-primary/15 bg-background p-0 text-foreground shadow-[0_30px_100px_rgba(15,23,42,0.20)] [&>button]:hidden">
          <DialogTitle className="sr-only">Confirmar saída</DialogTitle>
          <DialogDescription className="sr-only">Confirme se deseja encerrar sua sessão neste dispositivo.</DialogDescription>
          <div className="border-b border-primary/15 bg-primary/[0.05] px-7 py-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-primary/70">Confirmar saída</p>
          </div>
          <div className="px-7 py-9">
            <h2 className="max-w-xs text-4xl font-medium leading-[0.98] tracking-[-0.05em]">Deseja sair da sua conta?</h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
              Sua sessão será encerrada neste dispositivo. Você poderá entrar novamente quando quiser.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-primary/15 p-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsLogoutOpen(false)}
              className="h-12 rounded-full border border-primary/15 bg-background text-sm text-foreground hover:bg-primary/10 hover:text-primary"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmLogout}
              disabled={logout.isPending}
              className="h-12 rounded-full bg-primary text-sm text-primary-foreground hover:bg-primary/90"
            >
              {logout.isPending ? "Saindo…" : "Sair da conta"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
