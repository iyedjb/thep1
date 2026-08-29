import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plus, Radio } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

type ConnectionStatus = "disabled" | "expired" | "needs_public_url" | "ready" | "receiving";
type ExpirationDays = null | 30 | 60 | 90;

type Provider = { id: string; name: string; method: string };

type Integration = {
  id: number;
  name: string;
  provider: string;
  providerName: string;
  method: string;
  template: string;
  publiclyReachable: boolean;
  connectionStatus: ConnectionStatus;
  lastEventAt: string | null;
  lastMatchedEventAt: string | null;
  lastTestedAt: string | null;
  expiresAt: string | null;
};

const STATUS_COPY: Record<ConnectionStatus, { label: string; description: string; dot: string }> = {
  disabled: { label: "Desativada", description: "Esta API está desativada.", dot: "bg-muted-foreground" },
  expired: { label: "Expirada", description: "Esta URL não aceita mais eventos.", dot: "bg-rose-500" },
  needs_public_url: {
    label: "Inativa",
    description: "Publique o app em um domínio público com HTTPS para receber e testar eventos.",
    dot: "bg-amber-500",
  },
  ready: { label: "Aguardando evento", description: "A URL está pronta para receber eventos.", dot: "bg-blue-500" },
  receiving: { label: "Funcionando", description: "Os eventos estão chegando normalmente.", dot: "bg-emerald-500" },
};

const EXPIRATIONS: Array<{ value: ExpirationDays; label: string }> = [
  { value: null, label: "Nunca" },
  { value: 30, label: "30 dias" },
  { value: 60, label: "60 dias" },
  { value: 90, label: "90 dias" },
];

function authHeaders(json = false) {
  const token = localStorage.getItem("ads_token");
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  if (!response.ok) throw new Error("Não foi possível carregar as APIs.");
  return response.json();
}

function formatDate(value: string | null, empty = "Nenhum evento") {
  if (!value) return empty;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Não foi possível copiar.");
}

export default function ApiPostbacksPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiName, setApiName] = useState("");
  const [expirationDays, setExpirationDays] = useState<ExpirationDays>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const integrations = useQuery<Integration[]>({
    queryKey: ["postback-integrations"],
    queryFn: () => loadJson("/api/postback/integrations"),
    refetchInterval: 30_000,
  });
  const providers = useQuery<Provider[]>({
    queryKey: ["postback-providers"],
    queryFn: () => loadJson("/api/postback/providers"),
  });
  const items = integrations.data || [];
  const active = items.find((item) => item.id === activeId) || null;

  useEffect(() => {
    if (activeId !== null && !items.some((item) => item.id === activeId)) setActiveId(null);
  }, [activeId, items]);

  function closeDialog() {
    setDialogOpen(false);
    setSelectedProvider(null);
    setApiName("");
    setExpirationDays(null);
  }

  async function createApi() {
    if (!selectedProvider || !apiName.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/postback/integrations", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ provider: selectedProvider, name: apiName.trim(), expirationDays }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível criar a API.");
      await integrations.refetch();
      setActiveId(result.id);
      closeDialog();
      toast({ title: "API criada" });
    } catch (error: any) {
      toast({ title: "Erro ao criar API", description: error.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl(integration: Integration) {
    try {
      await copyToClipboard(integration.template);
      setCopiedId(integration.id);
      toast({ title: "URL copiada", description: "A URL completa está na área de transferência." });
      window.setTimeout(() => setCopiedId(null), 1_500);
    } catch (error: any) {
      toast({ title: "Não foi possível copiar", description: error.message, variant: "destructive" });
    }
  }

  async function testApi(integration: Integration) {
    setTestingId(integration.id);
    try {
      const response = await fetch(`/api/postback/integrations/${integration.id}/test`, {
        method: "POST",
        headers: authHeaders(true),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "O teste falhou.");
      await integrations.refetch();
      toast({
        title: "Teste concluído",
        description: result.scope === "public"
          ? "O endpoint público respondeu corretamente."
          : "O endpoint respondeu localmente. Publique com HTTPS para confirmar o acesso externo.",
      });
    } catch (error: any) {
      toast({ title: "API ainda não está acessível", description: error.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-9">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Integrações</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">APIs</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Gere uma URL para receber notificações das plataformas diretamente no ClicLab.
          </p>
        </div>
        {items.length > 0 ? (
          <Button className="rounded-full px-5" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nova API
          </Button>
        ) : null}
      </header>

      {integrations.isLoading ? (
        <div className="py-10"><Skeleton className="h-10 w-52 rounded-full" /></div>
      ) : items.length === 0 ? (
        <section className="flex min-h-[380px] flex-col items-center justify-center border-b border-border text-center">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Nenhuma API criada</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Escolha a plataforma, dê um nome e gere a primeira integração.
          </p>
          <Button className="mt-6 rounded-full px-6" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Criar nova API
          </Button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-border py-7">
            {items.map((integration) => {
              const status = STATUS_COPY[integration.connectionStatus];
              const selected = integration.id === activeId;
              return (
                <button
                  key={integration.id}
                  type="button"
                  onClick={() => setActiveId(selected ? null : integration.id)}
                  className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${selected ? "bg-primary-foreground" : status.dot}`} />
                  {integration.name}
                  <span className={selected ? "text-primary-foreground/70" : "text-muted-foreground"}>{integration.providerName}</span>
                </button>
              );
            })}
          </div>

          {active ? (() => {
            const status = STATUS_COPY[active.connectionStatus];
            return (
              <section className="border-b border-border py-9">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{active.name}</h2>
                    <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{active.providerName} · {active.method}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                      <span className="text-sm font-semibold text-foreground">{status.label}</span>
                    </div>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">{status.description}</p>
                  </div>
                </div>

                <div className="mt-7">
                  <label htmlFor={`postback-url-${active.id}`} className="text-sm font-semibold text-foreground">URL</label>
                  <div className="mt-3 flex overflow-hidden rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-primary/20">
                    <textarea
                      id={`postback-url-${active.id}`}
                      value={active.template}
                      readOnly
                      spellCheck={false}
                      rows={4}
                      className="min-h-24 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-xs leading-6 text-foreground outline-none"
                    />
                    <Button type="button" variant="ghost" size="icon" className="m-2 shrink-0" onClick={() => copyUrl(active)} aria-label="Copiar URL">
                      {copiedId === active.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button className="rounded-full px-5" onClick={() => testApi(active)} disabled={testingId === active.id || active.connectionStatus === "expired"}>
                    {testingId === active.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
                    Testar API
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {active.lastTestedAt ? `Último teste: ${formatDate(active.lastTestedAt)}` : "Ainda não testada"}
                  </p>
                  <Button asChild variant="outline" className="rounded-full px-5">
                    <Link href={`/postbacks/${active.id}`}>Ver eventos recebidos</Link>
                  </Button>
                </div>

                <div className="mt-8 grid gap-5 text-sm sm:grid-cols-3">
                  <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Validade</p><p className="mt-2 font-medium text-foreground">{formatDate(active.expiresAt, "Nunca expira")}</p></div>
                  <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Último evento</p><p className="mt-2 font-medium text-foreground">{formatDate(active.lastEventAt)}</p></div>
                  <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Última atribuição</p><p className="mt-2 font-medium text-foreground">{formatDate(active.lastMatchedEventAt)}</p></div>
                </div>
              </section>
            );
          })() : (
            <p className="py-16 text-center text-sm text-muted-foreground">Clique em uma API para ver os detalhes.</p>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (open) setDialogOpen(true); else closeDialog(); }}>
        <DialogContent className="rounded-3xl p-7 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Criar nova API</DialogTitle>
            <DialogDescription>Configure a integração antes de gerar a URL.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-3">
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Plataforma</p>
              <div className="flex flex-wrap gap-2">
                {providers.isLoading ? <Skeleton className="h-10 w-28 rounded-full" /> : null}
                {providers.data?.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProvider(provider.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      selectedProvider === provider.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
                    }`}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="api-name" className="text-sm font-semibold text-foreground">Nome</label>
              <Input id="api-name" value={apiName} onChange={(event) => setApiName(event.target.value)} maxLength={80} placeholder="Ex.: Campanhas principais" className="mt-2 h-11 rounded-xl" />
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Expiração</p>
              <div className="flex flex-wrap gap-2">
                {EXPIRATIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setExpirationDays(option.value)}
                    className={`rounded-full border px-3.5 py-2 text-sm transition-colors ${
                      expirationDays === option.value ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button className="w-full rounded-full" disabled={!selectedProvider || !apiName.trim() || creating} onClick={createApi}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Gerar API
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
