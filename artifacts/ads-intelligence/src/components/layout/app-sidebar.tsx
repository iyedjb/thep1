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
import { Activity, LayoutDashboard, Target, Key, FileText, LogOut, TrendingUp, Sparkles } from "lucide-react";
import { useGetMe, useLogout } from "@workspace/api-client-react";

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useGetMe();
  const logout = useLogout();

  const handleLogout = () => {
    localStorage.removeItem("ads_token");
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/login";
      }
    });
  };

  return (
    <Sidebar>
      <SidebarHeader className="h-20 flex items-center justify-center px-6 border-b border-sidebar-border/30 bg-sidebar/20">
        <div className="flex items-center gap-2.5 font-black text-xl text-sidebar-foreground tracking-tight">
          <Activity className="w-6.5 h-6.5 text-primary" />
          <span>Ads Intelligence</span>
        </div>
      </SidebarHeader>
      
      <SidebarContent className="px-2">
        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-4 text-xs font-bold uppercase tracking-wider text-sidebar-foreground/45 mb-2">Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/dashboard"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/dashboard" data-testid="link-dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/campaigns"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/campaigns" data-testid="link-campaigns">
                    <Target />
                    <span>Campanhas</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/creator"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/creator" data-testid="link-creator">
                    <Sparkles />
                    <span>Criador de Pontes</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/keywords"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/keywords" data-testid="link-keywords">
                    <Key />
                    <span>Palavras-chave</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/trends"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/trends" data-testid="link-trends">
                    <TrendingUp />
                    <span>Google Trends</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/reports"} size="lg" className="rounded-2xl h-12 px-4 [&>svg]:w-5 [&>svg]:h-5 [&>span]:text-base transition-all duration-200">
                  <Link href="/reports" data-testid="link-reports">
                    <FileText />
                    <span>Relatórios</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 mt-auto">
        <div className="flex items-center justify-between w-full bg-blue-50/30 border border-blue-100/15 p-3 rounded-[1.75rem] shadow-2xs">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col text-left">
              <span className="font-semibold text-sm text-sidebar-foreground leading-tight">{user?.name}</span>
              <span className="text-sidebar-foreground/50 text-[10px] mt-0.5 max-w-[110px] truncate">{user?.email}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/60 rounded-full w-9 h-9" data-testid="button-logout">
            <LogOut className="h-4.5 h-4.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
