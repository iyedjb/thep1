import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type DomainItem = {
  id: number;
  name: string;
  siteKey: string;
  status: string;
  presellId: number | null;
  slug: string;
  publicUrl: string;
  trackingAddress: string;
  snippet: string;
  connectedName?: string | null;
  publishedUrl?: string | null;
};

async function loadDomains(): Promise<DomainItem[]> {
  const token = localStorage.getItem("ads_token");
  const response = await fetch("/api/tracking/sites", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error("Não foi possível carregar seus domínios.");
  const data = await response.json();
  return Array.isArray(data.sites) ? data.sites : [];
}

export default function DomainsPage() {
  const domains = useQuery({ queryKey: ["tracking-sites"], queryFn: loadDomains });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<DomainItem | null>(null);
  const [copiedId, setCopiedId] = useState<number | "created" | null>(null);

  const createDomain = async () => {
    if (name.trim().length < 3 || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const token = localStorage.getItem("ads_token");
      const response = await fetch("/api/tracking/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name, slug: name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível criar o domínio.");
      setCreated(result);
      await domains.refetch();
    } catch (error: any) {
      setCreateError(error.message || "Não foi possível criar o domínio.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (value: string, id: number | "created") => {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  };

  const closeDialog = (open: boolean) => {
    setCreateOpen(open);
    if (!open) { setName(""); setCreated(null); setCopiedId(null); setCreateError(""); }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Publicação</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Meus domínios</h1>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-white hover:bg-primary/90">Criar domínio</button>
      </header>

      <section className="py-8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead><tr className="border-y border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground"><th className="py-3 pr-5 font-medium">Endereço público</th><th className="px-4 py-3 font-medium">Conexão</th><th className="px-4 py-3 font-medium">Status</th><th className="py-3 pl-4 text-right font-medium">Ações</th></tr></thead>
            <tbody>{(domains.data || []).map((domain) => <tr key={domain.id} className="border-b border-border"><td className="py-5 pr-5"><p className="text-sm font-semibold">{domain.name}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{domain.publicUrl || domain.trackingAddress}</p></td><td className="px-4 py-5"><p className="text-sm">{domain.presellId ? "Presell conectada" : "Disponível"}</p><p className="mt-1 text-xs text-muted-foreground">{domain.presellId ? "Link acessível" : "Pronto para publicar"}</p></td><td className="px-4 py-5 text-sm"><span className="rounded-full bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold text-primary">Ativo</span></td><td className="py-5 pl-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => copy(domain.publicUrl || domain.trackingAddress, domain.id)} className="h-9 rounded-full border border-border px-4 text-xs font-semibold hover:border-primary/35 hover:text-primary">{copiedId === domain.id ? "Copiado" : "Copiar endereço"}</button><button type="button" onClick={() => copy(domain.snippet, domain.id)} className="h-9 rounded-full border border-border px-4 text-xs font-semibold hover:border-primary/35 hover:text-primary">Copiar script</button></div></td></tr>)}</tbody>
          </table>
        </div>
        {!domains.isLoading && !(domains.data || []).length ? <div className="py-24 text-center"><p className="text-base font-semibold">Nenhum domínio criado</p><p className="mt-2 text-sm text-muted-foreground">Crie um domínio antes de publicar sua primeira presell.</p><button type="button" onClick={() => setCreateOpen(true)} className="mt-6 h-11 rounded-full bg-primary px-6 text-sm font-semibold text-white">Criar domínio</button></div> : null}
      </section>

      <Dialog open={createOpen} onOpenChange={closeDialog}>
        <DialogContent className="max-w-xl rounded-[2rem] border border-primary/15 bg-background p-0 shadow-[0_30px_100px_rgba(15,23,42,0.18)]">
          <DialogTitle className="sr-only">Criar domínio</DialogTitle><DialogDescription className="sr-only">Crie um domínio para publicar e rastrear uma presell.</DialogDescription>
          <div className="border-b border-border px-7 py-5"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Meus domínios</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{created ? "Domínio criado" : "Novo domínio"}</h2></div>
          {!created ? <div className="px-7 py-7"><label htmlFor="new-domain-name" className="text-sm font-medium">Escolha o endereço</label><div className="mt-3 flex h-12 items-center overflow-hidden rounded-2xl border border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"><span className="border-r border-border bg-muted/35 px-4 text-xs text-muted-foreground">{window.location.host}/</span><input id="new-domain-name" autoFocus value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} onKeyDown={(event) => event.key === "Enter" && createDomain()} placeholder="minha-oferta" className="h-full min-w-0 flex-1 px-4 text-sm outline-none"/></div><p className="mt-3 text-xs leading-5 text-muted-foreground">Este será o link usado na campanha. A presell será conectada somente ao publicar.</p>{createError ? <p className="mt-3 text-sm text-red-600">{createError}</p> : null}<button type="button" disabled={creating || name.trim().length < 3} onClick={createDomain} className="mt-7 h-12 w-full rounded-full bg-primary text-sm font-semibold text-white disabled:opacity-45">{creating ? "Criando..." : "Criar endereço"}</button></div> : <div className="px-7 py-7"><p className="text-xs text-muted-foreground">Endereço público</p><p className="mt-2 break-all font-mono text-sm font-semibold">{created.publicUrl || created.trackingAddress}</p><p className="mt-6 text-sm text-muted-foreground">Selecione este endereço ao publicar uma presell. Depois disso, o link abrirá a página diretamente.</p><button type="button" onClick={() => copy(created.publicUrl || created.trackingAddress, "created")} className="mt-6 h-12 w-full rounded-full bg-primary text-sm font-semibold text-white">{copiedId === "created" ? "Endereço copiado" : "Copiar endereço"}</button><button type="button" onClick={() => closeDialog(false)} className="mt-2 h-11 w-full rounded-full text-sm text-muted-foreground hover:bg-muted">Concluir</button></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
