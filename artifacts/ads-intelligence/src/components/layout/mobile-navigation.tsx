import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const mobileLinks = [
  { path: "/creator", label: "Home" },
  { path: "/tracking", label: "Dados" },
  { path: "/domains", label: "Domínios" },
  { path: "/traffic-manager", label: "Gestor IA" },
  { path: "/trends", label: "Trends" },
];

function getPlanLabel(user: any) {
  if (user?.subscriptionStatus !== "active") return "Gratuito";
  return ({ starter: "Essencial", pro: "Profissional", enterprise: "Escala" } as Record<string, string>)[user?.subscriptionTier] || "Premium";
}

export function MobileBottomNavigation() {
  const [location] = useLocation();
  if (location === "/traffic-manager") return null;
  return (
    <nav aria-label="Navegação principal" className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-50 grid w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 grid-cols-5 rounded-full border border-primary/15 bg-white/95 p-1.5 shadow-[0_16px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl md:hidden">
      {mobileLinks.map((item) => {
        const active = location === item.path;
        return (
          <Link key={item.path} href={item.path} className={`flex h-12 items-center justify-center rounded-full px-2 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25 ${active ? "bg-primary text-white" : "text-slate-500 hover:bg-primary/[0.06] hover:text-primary"}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileProfileMenu({ user }: { user: any }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const initials = user?.name ? user.name.split(" ").map((part: string) => part[0]).slice(0, 2).join("").toUpperCase() : "U";

  const logout = () => {
    localStorage.removeItem("ads_token");
    queryClient.clear();
    setLogoutOpen(false);
    setLocation("/login");
  };

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <button type="button" aria-label="Abrir perfil" className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-white text-primary shadow-[0_6px_20px_rgba(15,23,42,0.06)] md:hidden">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">{initials}</AvatarFallback>
            </Avatar>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-[2rem] border-primary/15 bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 shadow-[0_-24px_70px_rgba(15,23,42,0.16)] [&>button.absolute]:right-5 [&>button.absolute]:top-5 [&>button.absolute]:rounded-full [&>button.absolute]:border [&>button.absolute]:border-primary/15 [&>button.absolute]:p-2.5">
          <SheetTitle className="sr-only">Perfil</SheetTitle>
          <SheetDescription className="sr-only">Acesse seu plano, suporte ou encerre a sessão.</SheetDescription>
          <div className="px-1 pb-4 pt-1">
            <div className="mb-3 flex items-center justify-between border-b border-primary/15 pb-2.5 pr-12">
              <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary/60">Plano atual</span>
              <span className="text-xs font-semibold text-primary">{getPlanLabel(user)}</span>
            </div>
            <p className="truncate text-sm font-medium text-slate-900">{user?.name || "Usuário"}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{user?.email || ""}</p>
          </div>
          <div className="border-y border-primary/15 py-1">
            <SheetClose asChild><Link href="/support" className="flex h-12 items-center rounded-2xl px-3 text-sm text-slate-800 hover:bg-primary/[0.06]">Suporte</Link></SheetClose>
            <SheetClose asChild><Link href="/pricing" className="flex h-12 items-center rounded-2xl px-3 text-sm text-slate-800 hover:bg-primary/[0.06]">Planos</Link></SheetClose>
          </div>
          <SheetClose asChild><button type="button" onClick={() => setLogoutOpen(true)} className="mt-1 flex h-12 w-full items-center rounded-2xl px-3 text-left text-sm text-slate-800 hover:bg-primary/[0.06]">Sair</button></SheetClose>
        </SheetContent>
      </Sheet>

      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-3xl border border-primary/15 bg-white p-6 sm:max-w-sm [&>button]:hidden">
          <DialogTitle className="text-2xl font-semibold text-slate-950">Sair da conta?</DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-500">Sua sessão será encerrada neste dispositivo.</DialogDescription>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" className="h-11 rounded-full" onClick={() => setLogoutOpen(false)}>Cancelar</Button>
            <Button type="button" className="h-11 rounded-full" onClick={logout}>Sair</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
