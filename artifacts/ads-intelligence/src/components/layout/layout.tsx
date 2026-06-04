import { ReactNode, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";

export function Layout({ children }: { children: ReactNode }) {
  const { data: user, isError, isLoading } = useGetMe();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isError) {
      setLocation("/login");
    }
  }, [isError, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">Carregando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-auto bg-background flex flex-col">
          <header className="h-14 flex items-center px-4 border-b border-border/60 bg-white/40 backdrop-blur-md sticky top-0 z-30">
            <SidebarTrigger className="hover:bg-primary/10 hover:text-primary rounded-full transition-colors" />
          </header>
          <div className="flex-1">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
