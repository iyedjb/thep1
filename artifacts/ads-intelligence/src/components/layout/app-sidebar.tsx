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
  SidebarGroupLabel
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Target, FileText, LogOut, TrendingUp, Sparkles, Globe, CheckCircle2 } from "lucide-react";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

type GoogleAdsStatus = {
  configured: boolean;
  status: "connected" | "not_configured" | "error" | "needs_account";
  customerId: string | null;
  error: string | null;
};

// Keywords nav item is intentionally excluded to hide it from the sidebar
// (the /keywords route still exists and works)
const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/campaigns", label: "Campanhas", icon: Target },
  { path: "/creator", label: "Presell com IA", icon: Sparkles },
  { path: "/drcash", label: "Dr. Cash", icon: Globe },
  { path: "/trends", label: "Google Trends", icon: TrendingUp },
  { path: "/reports", label: "Relatórios", icon: FileText },
];

function formatCustomerId(value: string) {
  const clean = value.replace(/\D/g, "");
  return clean.length === 10
    ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
    : clean;
}

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useGetMe();
  const logout = useLogout();

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

  const handleLogout = () => {
    localStorage.removeItem("ads_token");
    logout.mutate(undefined, {
      onSuccess: () => { window.location.href = "/login"; }
    });
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  const isConnected = statusQuery.data?.status === "connected";
  const customerId = statusQuery.data?.customerId;

  return (
    <Sidebar className="border-r border-sidebar-border/60">
      {/* Logo + Account ID */}
      <SidebarHeader className="px-5 pt-5 pb-4 border-b border-sidebar-border/40 space-y-4">
        <Link href="/dashboard" className="flex items-center gap-3 group select-none">
          <div className="relative flex h-11 w-11 items-center justify-center transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary">
              <rect x="3" y="15" width="2.5" height="5" rx="0.5" />
              <rect x="8" y="11" width="2.5" height="9" rx="0.5" />
              <rect x="13" y="8" width="2.5" height="12" rx="0.5" />
              <rect x="18" y="5" width="2.5" height="15" rx="0.5" />
              <path d="M2 13C6 11 12 7 21 3" />
              <path d="M16 3h5v5" />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-extrabold text-sidebar-foreground tracking-tight">ClickLab</span>
          </div>
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

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/35 mb-1.5">
            Navegacao
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map(({ path, label, icon: Icon }) => {
                const isActive = location === path;
                return (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      size="lg"
                      className={`
                        group relative h-11 rounded-xl px-3 gap-3 transition-all duration-200
                        [&>svg]:w-4 [&>svg]:h-4 [&>span]:text-[13.5px] [&>span]:font-medium
                        ${isActive
                          ? "bg-primary/15 text-primary border border-primary/20 shadow-[0_0_16px_rgba(99,179,237,0.08)]"
                          : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/5"
                        }
                      `}
                    >
                      <Link href={path} data-testid={`link-${label.toLowerCase().replace(/\s/g, "-")}`}>
                        {isActive && (
                          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full opacity-80" />
                        )}
                        <Icon className={isActive ? "text-primary" : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/70 transition-colors"} />
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

      {/* User footer */}
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.05] bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
          <Avatar className="h-9 w-9 border border-white/10">
            <AvatarFallback className="bg-primary/20 text-primary font-bold text-sm border-0">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col text-left min-w-0 flex-1">
            <span className="font-semibold text-[13px] text-sidebar-foreground leading-tight truncate">
              {user?.name || "Usuario"}
            </span>
            <span className="text-muted-foreground/50 text-[10px] font-medium mt-0.5 truncate">
              {user?.email || ""}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="text-sidebar-foreground/35 hover:text-red-400 hover:bg-red-500/10 rounded-lg w-8 h-8 shrink-0 transition-colors"
            data-testid="button-logout"
            title="Sair"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
