import { useState } from "react";
import {
  useListCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  getListCampaignsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, MoreHorizontal, Pencil, Trash, Play, Pause,
  ChevronRight, ChevronLeft, Check, Target, Settings2,
  CalendarDays, Globe, Megaphone
  , Search, LayoutTemplate
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Google Ads geo locations ────────────────────────────────
const GEO_LOCATIONS: { code: string; label: string; region: string }[] = [
  // Americas
  { code: "2076", label: "Brasil", region: "Americas" },
  { code: "2840", label: "Estados Unidos", region: "Americas" },
  { code: "2484", label: "Mexico", region: "Americas" },
  { code: "2032", label: "Argentina", region: "Americas" },
  { code: "2152", label: "Chile", region: "Americas" },
  { code: "2170", label: "Colombia", region: "Americas" },
  { code: "2604", label: "Peru", region: "Americas" },
  { code: "2858", label: "Uruguay", region: "Americas" },
  { code: "2068", label: "Bolivia", region: "Americas" },
  { code: "2218", label: "Equador", region: "Americas" },
  { code: "2591", label: "Panama", region: "Americas" },
  { code: "2188", label: "Costa Rica", region: "Americas" },
  { code: "2124", label: "Canada", region: "Americas" },
  // Europe
  { code: "2724", label: "Espanha", region: "Europe" },
  { code: "2620", label: "Portugal", region: "Europe" },
  { code: "2826", label: "Reino Unido", region: "Europe" },
  { code: "2276", label: "Alemanha", region: "Europe" },
  { code: "2250", label: "Franca", region: "Europe" },
  { code: "2380", label: "Italia", region: "Europe" },
  { code: "2528", label: "Paises Baixos", region: "Europe" },
  { code: "2752", label: "Suecia", region: "Europe" },
  { code: "2578", label: "Noruega", region: "Europe" },
  { code: "2208", label: "Dinamarca", region: "Europe" },
  { code: "2246", label: "Finlandia", region: "Europe" },
  { code: "2040", label: "Austria", region: "Europe" },
  { code: "2056", label: "Belgica", region: "Europe" },
  { code: "2756", label: "Suica", region: "Europe" },
  { code: "2616", label: "Polonia", region: "Europe" },
  { code: "2203", label: "Republica Tcheca", region: "Europe" },
  { code: "2348", label: "Hungria", region: "Europe" },
  { code: "2642", label: "Romania", region: "Europe" },
  { code: "2300", label: "Grecia", region: "Europe" },
  // Asia Pacific
  { code: "2356", label: "India", region: "Asia Pacific" },
  { code: "2392", label: "Japao", region: "Asia Pacific" },
  { code: "2410", label: "Coreia do Sul", region: "Asia Pacific" },
  { code: "2036", label: "Australia", region: "Asia Pacific" },
  { code: "2554", label: "Nova Zelandia", region: "Asia Pacific" },
  { code: "2702", label: "Singapura", region: "Asia Pacific" },
  { code: "2458", label: "Malaysia", region: "Asia Pacific" },
  { code: "2360", label: "Indonesia", region: "Asia Pacific" },
  { code: "2764", label: "Tailandia", region: "Asia Pacific" },
  { code: "2704", label: "Vietna", region: "Asia Pacific" },
  { code: "2608", label: "Filipinas", region: "Asia Pacific" },
  { code: "2158", label: "Taiwan", region: "Asia Pacific" },
  { code: "2344", label: "Hong Kong", region: "Asia Pacific" },
  // Middle East & Africa
  { code: "2784", label: "Emirados Arabes Unidos", region: "Middle East & Africa" },
  { code: "2682", label: "Arabia Saudita", region: "Middle East & Africa" },
  { code: "2818", label: "Egito", region: "Middle East & Africa" },
  { code: "2710", label: "Africa do Sul", region: "Middle East & Africa" },
  { code: "2566", label: "Nigeria", region: "Middle East & Africa" },
  { code: "2404", label: "Quenia", region: "Middle East & Africa" },
  { code: "2376", label: "Israel", region: "Middle East & Africa" },
  { code: "2792", label: "Turquia", region: "Middle East & Africa" },
];

// ─── Languages (Google Ads language IDs) ────────────────────
const LANGUAGES = [
  { code: "1000", label: "Portugues" },
  { code: "1000", label: "Ingles" },
  { code: "1003", label: "Espanhol" },
  { code: "1001", label: "Frances" },
  { code: "1020", label: "Alemao" },
  { code: "1004", label: "Italiano" },
  { code: "1023", label: "Japones" },
  { code: "1018", label: "Coreano" },
  { code: "1025", label: "Chines Simplificado" },
  { code: "1028", label: "Chines Tradicional" },
  { code: "1055", label: "Arabe" },
  { code: "1014", label: "Russo" },
  { code: "1021", label: "Holandes" },
  { code: "1009", label: "Polones" },
  { code: "1016", label: "Turco" },
];

// ─── Bidding Strategies ──────────────────────────────────────
const BIDDING_STRATEGIES = [
  { value: "Maximize Clicks", label: "Maximizar Cliques", desc: "Gera o maior volume de cliques dentro do orcamento" },
  { value: "Maximize Conversions", label: "Maximizar Conversoes", desc: "Otimiza para o maior numero de conversoes" },
  { value: "Maximize Conversion Value", label: "Maximizar Valor de Conversao", desc: "Otimiza para o maior valor total de conversao" },
  { value: "Target CPA", label: "CPA Desejado (tCPA)", desc: "Mantem o custo por aquisicao perto de um alvo definido" },
  { value: "Target ROAS", label: "ROAS Desejado (tROAS)", desc: "Otimiza retorno sobre o gasto com anuncios" },
  { value: "Manual CPC", label: "CPC Manual", desc: "Controle total sobre lances por clique" },
  { value: "Enhanced CPC", label: "CPC Otimizado (eCPC)", desc: "CPC manual com ajustes automaticos inteligentes" },
  { value: "Target Impression Share", label: "Cota de Impressoes Desejada", desc: "Maximiza visibilidade em posicoes de destaque" },
];

// ─── Ad Networks ─────────────────────────────────────────────
const AD_NETWORKS = [
  { value: "Search Network", label: "Rede de Pesquisa", desc: "Anuncios texto na busca do Google" },
  { value: "Display Network", label: "Rede de Display", desc: "Banners em sites parceiros do Google" },
  { value: "Search Partners", label: "Parceiros de Pesquisa", desc: "Sites de busca parceiros do Google" },
  { value: "YouTube", label: "YouTube", desc: "Anuncios em video no YouTube" },
  { value: "Discover", label: "Discover & Gmail", desc: "Feed do Google Discover e Gmail" },
];

// ─── Schema ──────────────────────────────────────────────────
const campaignSchema = z.object({
  objective: z.string().default("SALES"),
  campaignType: z.literal("SEARCH").default("SEARCH"),
  name: z.string().min(1, "O nome e obrigatorio"),
  websiteUrl: z.string().url("Informe uma URL válida, incluindo https://"),
  budget: z.coerce.number().min(1, "O orcamento deve ser maior que 0"),
  status: z.string().optional(),
  targetAges: z.array(z.string()).default([]),
  targetGenders: z.array(z.string()).default([]),
  targetLocations: z.array(z.string()).default([]),
  targetLanguages: z.array(z.string()).default([]),
  biddingStrategy: z.string().default("Maximize Clicks"),
  adNetworks: z.array(z.string()).default([]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  adGroupName: z.string().min(1, "Informe o nome do grupo de anúncios"),
  keywords: z.array(z.string()).min(1, "Adicione pelo menos uma palavra-chave"),
  keywordMatchType: z.string().default("BROAD"),
  headlines: z.array(z.string().trim().min(1, "Preencha este título").max(30)).min(3, "Adicione pelo menos 3 títulos").max(15),
  descriptions: z.array(z.string().trim().min(1, "Preencha esta descrição").max(90)).min(2, "Adicione pelo menos 2 descrições").max(4),
  path1: z.string().max(15).regex(/^[\p{L}\p{N}-]*$/u, "Use apenas letras, números ou hífen").optional(),
  path2: z.string().max(15).regex(/^[\p{L}\p{N}-]*$/u, "Use apenas letras, números ou hífen").optional(),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

// ─── Step wizard config ──────────────────────────────────────
const WIZARD_STEPS = [
  { id: 1, label: "Objetivo", icon: Target },
  { id: 2, label: "Publico-Alvo", icon: Settings2 },
  { id: 3, label: "Redes & Lances", icon: Megaphone },
  { id: 4, label: "Localizacao & Idioma", icon: Globe },
  { id: 5, label: "Palavras-chave", icon: Search },
  { id: 6, label: "Anúncio", icon: LayoutTemplate },
  { id: 7, label: "Revisão", icon: CalendarDays },
];

// ─── Multi-step Campaign Form ────────────────────────────────
function CreativeAssetEditor({
  values,
  onChange,
  minimum,
  maximum,
  maxLength,
  multiline = false,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  minimum: number;
  maximum: number;
  maxLength: number;
  multiline?: boolean;
  label: string;
}) {
  const items = values.length >= minimum ? values : [...values, ...Array.from({ length: minimum - values.length }, () => "")];

  const updateItem = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const removeItem = (index: number) => {
    if (items.length <= minimum) return;
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="space-y-2.5">
      {items.map((value, index) => (
        <div key={`${label}-${index}`} className="group relative">
          {multiline ? (
            <Textarea value={value} maxLength={maxLength} onChange={(event) => updateItem(index, event.target.value)} placeholder={`${label} ${index + 1}`} className="min-h-20 resize-none rounded-xl bg-muted/20 pr-20 text-xs" />
          ) : (
            <Input value={value} maxLength={maxLength} onChange={(event) => updateItem(index, event.target.value)} placeholder={`${label} ${index + 1}`} className="h-11 rounded-xl bg-muted/20 pr-20 text-xs" />
          )}
          <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
            <span className={`text-[9px] tabular-nums ${value.length === maxLength ? "text-amber-600" : "text-muted-foreground"}`}>{value.length}/{maxLength}</span>
            {items.length > minimum && (
              <button type="button" onClick={() => removeItem(index)} className="rounded-md p-1 text-muted-foreground transition hover:bg-red-50 hover:text-red-500" aria-label={`Remover ${label.toLowerCase()}`}><Trash className="h-3 w-3" /></button>
            )}
          </div>
        </div>
      ))}
      {items.length < maximum && (
        <button type="button" onClick={() => onChange([...items, ""])} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/30 px-3 py-1.5 text-[10px] font-semibold text-primary transition hover:bg-primary/5"><Plus className="h-3 w-3" /> Adicionar {label.toLowerCase()}</button>
      )}
    </div>
  );
}

function CampaignWizard({
  form,
  onSubmit,
  isPending,
  onCancel,
}: {
  form: ReturnType<typeof useForm<CampaignFormData>>;
  onSubmit: (data: CampaignFormData) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [geoSearch, setGeoSearch] = useState("");

  const filteredGeos = geoSearch.trim()
    ? GEO_LOCATIONS.filter(g => g.label.toLowerCase().includes(geoSearch.toLowerCase()))
    : GEO_LOCATIONS;

  const geoByRegion = filteredGeos.reduce<Record<string, typeof GEO_LOCATIONS>>((acc, g) => {
    if (!acc[g.region]) acc[g.region] = [];
    acc[g.region].push(g);
    return acc;
  }, {});

  const goNext = async () => {
    const fields: (keyof CampaignFormData)[][] = [
      ["objective", "campaignType", "name", "websiteUrl", "budget", "status"],
      ["targetAges", "targetGenders"],
      ["biddingStrategy", "adNetworks"],
      ["targetLocations", "targetLanguages"],
      ["adGroupName", "keywords", "keywordMatchType"],
      ["headlines", "descriptions", "path1", "path2"],
      ["startDate", "endDate"],
    ];
    const valid = await form.trigger(fields[currentStep - 1]);
    if (valid && currentStep < WIZARD_STEPS.length) setCurrentStep(s => s + 1);
  };

  const goBack = () => {
    if (currentStep > 1) setCurrentStep(s => s - 1);
  };

  const handleCheckbox = (
    field: { value: string[]; onChange: (v: string[]) => void },
    value: string,
    checked: boolean
  ) => {
    field.onChange(
      checked ? [...(field.value || []), value] : (field.value || []).filter(v => v !== value)
    );
  };

  return (
    <Form {...form}>
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Step indicator */}
      <div className="grid shrink-0 grid-cols-7 gap-1 border-y border-border/60 bg-muted/10 px-5 py-3 sm:px-6">
        {WIZARD_STEPS.map((step) => {
          const isCompleted = currentStep > step.id;
          const isActive = currentStep === step.id;
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex min-w-0 items-center justify-center">
              <div className="flex min-w-0 items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-200 text-xs font-bold shrink-0 ${
                  isCompleted
                    ? "bg-primary border-primary text-primary-foreground"
                    : isActive
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground bg-muted/20"
                }`}>
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                <span className={`hidden min-w-0 truncate text-[10px] font-semibold transition-colors md:block ${
                  isActive ? "text-foreground" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/50"
                }`}>
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">

        {/* ── Step 1: Basic Info ── */}
        {currentStep === 1 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <FormField control={form.control} name="objective" render={({ field }) => (
              <FormItem>
                <div>
                  <FormLabel className="text-sm font-bold text-foreground">Qual é o objetivo da campanha?</FormLabel>
                  <p className="mt-1 text-xs text-muted-foreground">O Google Ads usa seu objetivo para recomendar configurações e lances.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { value: "SALES", label: "Vendas", description: "Aumentar vendas online" },
                    { value: "LEADS", label: "Leads", description: "Captar contatos" },
                    { value: "WEBSITE_TRAFFIC", label: "Tráfego", description: "Levar pessoas ao site" },
                    { value: "NONE", label: "Sem meta", description: "Configurar manualmente" },
                  ].map((objective) => (
                    <button
                      key={objective.value}
                      type="button"
                      onClick={() => field.onChange(objective.value)}
                      className={`rounded-2xl border p-3 text-left transition-all ${field.value === objective.value ? "border-primary bg-primary/5 ring-2 ring-primary/10" : "border-border/70 bg-white hover:border-primary/40 hover:bg-muted/20"}`}
                    >
                      <span className="text-xs font-bold text-foreground">{objective.label}</span>
                      <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{objective.description}</span>
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <p className="text-sm font-bold text-foreground">Tipo de campanha</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {["Pesquisa", "Performance Max", "Display", "Vídeo", "Shopping"].map((type, index) => (
                  <div key={type} className={`rounded-2xl border p-3 ${index === 0 ? "border-primary bg-primary/5 ring-2 ring-primary/10" : "border-border/60 bg-muted/10 opacity-55"}`}>
                    <Search className={`h-4 w-4 ${index === 0 ? "text-primary" : "text-muted-foreground"}`} />
                    <p className="mt-2 text-[11px] font-bold text-foreground">{type}</p>
                    {index > 0 && <p className="mt-0.5 text-[9px] text-muted-foreground">Em breve</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/10 p-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">
                Informacoes da Campanha
              </p>
            </div>

            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-foreground">Nome da Campanha</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="ex: Campanha Vendas - Black Friday 2025"
                    className="h-11 rounded-xl bg-muted/30 border-border focus-visible:ring-primary"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="websiteUrl" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-foreground">URL final do site</FormLabel>
                <FormControl>
                  <Input {...field} type="url" placeholder="https://www.suaempresa.com/produto" className="h-11 rounded-xl bg-muted/30 border-border focus-visible:ring-primary" />
                </FormControl>
                <p className="text-[10px] text-muted-foreground">A página que será aberta quando alguém clicar no anúncio.</p>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="budget" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Orcamento Diario (R$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      {...field}
                      placeholder="100.00"
                      className="h-11 rounded-xl bg-muted/30 border-border focus-visible:ring-primary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Status Inicial</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border focus:ring-primary">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="pausado">Pausado</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>
        )}

        {/* ── Step 2: Audience ── */}
        {currentStep === 2 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">
                Segmentacao de Publico-Alvo
              </p>
            </div>

            {/* Age ranges */}
            <FormField
              control={form.control}
              name="targetAges"
              render={() => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Faixas Etarias</FormLabel>
                  <p className="text-[11px] text-muted-foreground -mt-1">Nenhuma selecao = todas as idades</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((age) => (
                      <FormField key={age} control={form.control} name="targetAges" render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2.5 space-y-0 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(age)}
                              onCheckedChange={(checked) => handleCheckbox(field as any, age, !!checked)}
                            />
                          </FormControl>
                          <FormLabel className="text-xs font-medium cursor-pointer">{age}</FormLabel>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Gender */}
            <FormField
              control={form.control}
              name="targetGenders"
              render={() => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Genero</FormLabel>
                  <p className="text-[11px] text-muted-foreground -mt-1">Nenhuma selecao = todos os generos</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      { v: "MALE", l: "Masculino" },
                      { v: "FEMALE", l: "Feminino" },
                      { v: "UNDETERMINED", l: "Nao especificado" }
                    ].map(({ v, l }) => (
                      <FormField key={v} control={form.control} name="targetGenders" render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2.5 space-y-0 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(v)}
                              onCheckedChange={(checked) => handleCheckbox(field as any, v, !!checked)}
                            />
                          </FormControl>
                          <FormLabel className="text-xs font-medium cursor-pointer">{l}</FormLabel>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* ── Step 3: Networks & Bidding ── */}
        {currentStep === 3 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">
                Estrategia de Lances e Redes de Veiculacao
              </p>
            </div>

            {/* Bidding strategy */}
            <FormField control={form.control} name="biddingStrategy" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-semibold text-foreground">Estrategia de Lances</FormLabel>
                <div className="space-y-2">
                  {BIDDING_STRATEGIES.map(({ value, label, desc }) => (
                    <div
                      key={value}
                      onClick={() => field.onChange(value)}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-all duration-150 ${
                        field.value === value
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/60 bg-muted/10 hover:bg-muted/30"
                      }`}
                    >
                      <div className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 shrink-0 transition-all ${
                        field.value === value ? "border-primary bg-primary" : "border-muted-foreground/30"
                      }`}>
                        {field.value === value && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            {/* Ad networks */}
            <FormField
              control={form.control}
              name="adNetworks"
              render={() => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Redes de Veiculacao</FormLabel>
                  <p className="text-[11px] text-muted-foreground -mt-1">Onde seus anuncios serao exibidos</p>
                  <div className="space-y-2">
                    {AD_NETWORKS.map(({ value, label, desc }) => (
                      <FormField key={value} control={form.control} name="adNetworks" render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-xl border border-border/60 bg-muted/10 px-3.5 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(value)}
                              onCheckedChange={(checked) => handleCheckbox(field as any, value, !!checked)}
                              className="mt-0.5"
                            />
                          </FormControl>
                          <div>
                            <FormLabel className="text-xs font-semibold cursor-pointer">{label}</FormLabel>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                          </div>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* ── Step 4: Geo & Language ── */}
        {currentStep === 4 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">
                Localizacao Geografica e Idioma
              </p>
            </div>

            {/* Geo targeting */}
            <FormField
              control={form.control}
              name="targetLocations"
              render={() => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Paises / Regioes</FormLabel>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    {form.watch("targetLocations")?.length
                      ? `${form.watch("targetLocations").length} localizacoes selecionadas`
                      : "Nenhuma selecao = alcance global"}
                  </p>
                  <Input
                    placeholder="Buscar pais ou regiao..."
                    value={geoSearch}
                    onChange={e => setGeoSearch(e.target.value)}
                    className="h-9 rounded-xl bg-muted/30 border-border text-xs mb-3"
                  />
                  <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
                    {Object.entries(geoByRegion).map(([region, locs]) => (
                      <div key={region}>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">{region}</p>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {locs.map(({ label }) => (
                            <FormField key={label} control={form.control} name="targetLocations" render={({ field }) => (
                              <FormItem className="flex flex-row items-center gap-2 space-y-0 rounded-lg border border-border/50 bg-muted/10 px-2.5 py-2 hover:bg-muted/30 transition-colors cursor-pointer">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(label)}
                                    onCheckedChange={(checked) => handleCheckbox(field as any, label, !!checked)}
                                  />
                                </FormControl>
                                <FormLabel className="text-[11px] font-medium cursor-pointer">{label}</FormLabel>
                              </FormItem>
                            )} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Languages */}
            <FormField
              control={form.control}
              name="targetLanguages"
              render={() => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Idiomas de Segmentacao</FormLabel>
                  <p className="text-[11px] text-muted-foreground -mt-1">Nenhuma selecao = todos os idiomas</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {LANGUAGES.map(({ label }) => (
                      <FormField key={label} control={form.control} name="targetLanguages" render={({ field }) => (
                        <FormItem className="flex flex-row items-center gap-2 space-y-0 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2 hover:bg-muted/30 transition-colors cursor-pointer">
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(label)}
                              onCheckedChange={(checked) => handleCheckbox(field as any, label, !!checked)}
                            />
                          </FormControl>
                          <FormLabel className="text-[11px] font-medium cursor-pointer">{label}</FormLabel>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* ── Step 5: Scheduling ── */}
        {currentStep === 5 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div>
              <h3 className="text-base font-bold text-foreground">Grupo de anúncios e palavras-chave</h3>
              <p className="mt-1 text-xs text-muted-foreground">Agrupe termos relacionados ao mesmo produto ou intenção de busca.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="adGroupName" render={({ field }) => (
                <FormItem><FormLabel className="text-xs font-semibold">Nome do grupo de anúncios</FormLabel><FormControl><Input {...field} className="h-11 rounded-xl bg-muted/30" placeholder="Ex: Tênis esportivos" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="keywordMatchType" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold">Correspondência</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger className="h-11 rounded-xl bg-muted/30"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="BROAD">Ampla</SelectItem><SelectItem value="PHRASE">De frase</SelectItem><SelectItem value="EXACT">Exata</SelectItem></SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="keywords" render={({ field }) => (
              <FormItem>
                <div className="flex items-end justify-between gap-3"><div><FormLabel className="text-xs font-semibold">Palavras-chave</FormLabel><p className="mt-1 text-[10px] text-muted-foreground">Uma palavra-chave por linha.</p></div><span className="text-[10px] font-semibold text-primary">{field.value?.length || 0} adicionadas</span></div>
                <FormControl><Textarea value={(field.value || []).join("\n")} onChange={(event) => field.onChange(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder={"comprar tênis esportivo\ntênis para corrida\nloja de tênis online"} className="min-h-44 resize-none rounded-2xl bg-muted/20 font-mono text-xs leading-6" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs leading-5 text-blue-800">Essas palavras serão criadas diretamente no grupo de anúncios da sua conta Google Ads.</div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="grid gap-6 animate-in fade-in duration-200 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-5">
              <div><h3 className="text-base font-bold text-foreground">Anúncio responsivo de pesquisa</h3><p className="mt-1 text-xs text-muted-foreground">O Google combina seus títulos e descrições para encontrar a melhor versão.</p></div>
              <FormField control={form.control} name="headlines" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between"><FormLabel className="text-xs font-semibold">Títulos</FormLabel><span className="text-[10px] text-muted-foreground">3–15, até 30 caracteres</span></div>
                  <FormControl><CreativeAssetEditor values={field.value || []} onChange={field.onChange} minimum={3} maximum={15} maxLength={30} label="Título" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="descriptions" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between"><FormLabel className="text-xs font-semibold">Descrições</FormLabel><span className="text-[10px] text-muted-foreground">2–4, até 90 caracteres</span></div>
                  <FormControl><CreativeAssetEditor values={field.value || []} onChange={field.onChange} minimum={2} maximum={4} maxLength={90} multiline label="Descrição" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="path1" render={({ field }) => (<FormItem><FormLabel className="text-xs">Caminho 1</FormLabel><FormControl><Input {...field} placeholder="tenis" className="h-10 rounded-xl bg-muted/20" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="path2" render={({ field }) => (<FormItem><FormLabel className="text-xs">Caminho 2</FormLabel><FormControl><Input {...field} placeholder="corrida" className="h-10 rounded-xl bg-muted/20" /></FormControl><FormMessage /></FormItem>)} />
              </div>
            </div>
            <div className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Prévia no Google</p>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
                <div className="flex items-center gap-2 text-xs text-slate-700"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-bold">A</span><div><span className="font-semibold">Patrocinado</span><p className="text-[10px] text-slate-500">{form.watch("websiteUrl") || "www.suaempresa.com"}/{form.watch("path1")}/{form.watch("path2")}</p></div></div>
                <p className="mt-4 text-xl font-medium leading-7 text-[#1a0dab]">{form.watch("headlines")?.filter(Boolean).slice(0, 3).join(" | ") || "Seu título aparecerá aqui"}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{form.watch("descriptions")?.find(Boolean) || "Adicione descrições para visualizar seu anúncio de pesquisa."}</p>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-muted-foreground">A combinação final pode variar conforme a consulta e o dispositivo.</p>
            </div>
          </div>
        )}

        {currentStep === 7 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">
                Agendamento da Campanha
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/10 p-4 space-y-1.5">
              <p className="text-xs font-semibold text-foreground">Periodo de Veiculacao</p>
              <p className="text-[11px] text-muted-foreground">
                Defina quando a campanha deve comecar e terminar. Deixe em branco para veicular indefinidamente.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="startDate" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Data de Inicio</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      className="h-11 rounded-xl bg-muted/30 border-border focus-visible:ring-primary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="endDate" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold text-foreground">Data de Encerramento</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      className="h-11 rounded-xl bg-muted/30 border-border focus-visible:ring-primary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Summary */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Resumo da Campanha</p>
              {[
                { label: "Tipo", value: "Pesquisa" },
                { label: "Objetivo", value: form.watch("objective") },
                { label: "Grupo de anúncios", value: form.watch("adGroupName") || "—" },
                { label: "Palavras-chave", value: `${form.watch("keywords")?.length || 0} adicionadas` },
                { label: "Criativos", value: `${form.watch("headlines")?.filter(Boolean).length || 0} títulos · ${form.watch("descriptions")?.filter(Boolean).length || 0} descrições` },
                { label: "Nome", value: form.watch("name") || "—" },
                { label: "Orcamento Diario", value: form.watch("budget") ? `R$ ${Number(form.watch("budget")).toFixed(2)}` : "—" },
                { label: "Estrategia", value: form.watch("biddingStrategy") || "—" },
                {
                  label: "Localizacoes",
                  value: form.watch("targetLocations")?.length
                    ? `${form.watch("targetLocations").length} regioes`
                    : "Global"
                },
                {
                  label: "Redes",
                  value: form.watch("adNetworks")?.length
                    ? form.watch("adNetworks").join(", ")
                    : "Nenhuma selecionada"
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start gap-3 text-xs">
                  <span className="font-semibold text-muted-foreground shrink-0">{label}:</span>
                  <span className="text-foreground font-medium text-right truncate max-w-[200px]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-white px-5 py-4 sm:px-6">
        <Button
          type="button"
          variant="outline"
          onClick={currentStep === 1 ? onCancel : goBack}
          className="h-10 rounded-xl border-border text-muted-foreground"
        >
          {currentStep === 1 ? "Cancelar" : (
            <><ChevronLeft className="mr-1.5 h-4 w-4" /> Voltar</>
          )}
        </Button>

        {currentStep < WIZARD_STEPS.length ? (
          <Button
            type="button"
            onClick={goNext}
            className="h-10 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Proximo <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={isPending}
            onClick={form.handleSubmit(onSubmit)}
            className="h-10 rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            {isPending ? "Criando..." : (
              <><Check className="mr-1.5 h-4 w-4" /> Criar Campanha</>
            )}
          </Button>
        )}
      </div>
    </div>
    </Form>
  );
}

// ─── Main Campaigns Component ─────────────────────────────────
export default function Campaigns() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);

  const { data: campaigns, isLoading } = useListCampaigns({ query: { queryKey: getListCampaignsQueryKey() } });

  const createMutation = useCreateCampaign();
  const updateMutation = useUpdateCampaign();
  const deleteMutation = useDeleteCampaign();

  const defaultValues: CampaignFormData = {
    objective: "SALES",
    campaignType: "SEARCH",
    name: "",
    websiteUrl: "",
    budget: 100,
    status: "pausado",
    targetAges: [],
    targetGenders: [],
    targetLocations: [],
    targetLanguages: [],
    biddingStrategy: "Maximize Clicks",
    adNetworks: [],
    startDate: "",
    endDate: "",
    adGroupName: "Grupo de anúncios 1",
    keywords: [],
    keywordMatchType: "BROAD",
    headlines: ["", "", ""],
    descriptions: ["", ""],
    path1: "",
    path2: "",
  };

  const createForm = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues,
  });

  const editForm = useForm<CampaignFormData>({
    defaultValues,
  });

  const handleCreateSubmit = (data: CampaignFormData) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setIsCreateOpen(false);
        createForm.reset(defaultValues);
        toast({ title: "Campanha criada com sucesso" });
      },
      onError: (error: any) => toast({ title: "Erro ao criar campanha", description: error?.message, variant: "destructive" })
    });
  };

  const handleEditSubmit = (data: CampaignFormData) => {
    if (!editingCampaignId) return;
    updateMutation.mutate({ id: editingCampaignId, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setIsEditOpen(false);
        toast({ title: "Campanha atualizada com sucesso" });
      },
      onError: () => toast({ title: "Erro ao atualizar campanha", variant: "destructive" })
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja remover esta campanha?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          toast({ title: "Campanha removida com sucesso" });
        },
        onError: () => toast({ title: "Erro ao remover campanha", variant: "destructive" })
      });
    }
  };

  const handleStatusToggle = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "ativo" ? "pausado" : "ativo";
    updateMutation.mutate({ id, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        toast({ title: `Campanha ${newStatus === "ativo" ? "ativada" : "pausada"} com sucesso` });
      }
    });
  };

  const openEditDialog = (campaign: any) => {
    setEditingCampaignId(campaign.id);
    editForm.reset({
      name: campaign.name,
      budget: campaign.budget,
      status: campaign.status,
      targetAges: campaign.targetAges ?? [],
      targetGenders: campaign.targetGenders ?? [],
      targetLocations: campaign.targetLocations ?? [],
      targetLanguages: campaign.targetLanguages ?? [],
      biddingStrategy: campaign.biddingStrategy ?? "Maximize Clicks",
      adNetworks: campaign.adNetworks ?? [],
      startDate: campaign.startDate ?? "",
      endDate: campaign.endDate ?? "",
    });
    setIsEditOpen(true);
  };

  function formatCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  }

  function formatPercent(value: number) {
    return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100);
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ativo":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/15 gap-1.5 inline-flex items-center font-semibold text-[11px] uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Ativo
          </Badge>
        );
      case "pausado":
        return (
          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-amber-500/15 gap-1.5 inline-flex items-center font-semibold text-[11px] uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Pausado
          </Badge>
        );
      case "removido":
        return (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/15 gap-1.5 inline-flex items-center font-semibold text-[11px] uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            Removido
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-[11px] uppercase tracking-wider">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-8 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Campanhas</h1>
          <p className="text-muted-foreground text-sm mt-1">Crie e gerencie suas campanhas do Google Ads</p>
        </div>

        <Dialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) createForm.reset(defaultValues);
          }}
        >
          <DialogTrigger asChild>
            <Button className="h-10 rounded-xl gap-2 font-semibold shadow-[0_0_16px_rgba(59,130,246,0.15)]">
              <Plus className="h-4 w-4" /> Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent className="!flex !w-[calc(100vw-2rem)] !max-w-[1040px] max-h-[92vh] flex-col overflow-hidden gap-0 p-0">
            <DialogHeader className="shrink-0 px-5 pb-4 pt-6 sm:px-6">
              <DialogTitle className="text-lg font-bold">Criar Nova Campanha</DialogTitle>
              <p className="text-xs text-muted-foreground">Preencha os dados passo a passo para configurar sua campanha.</p>
            </DialogHeader>
            <CampaignWizard
              form={createForm}
              onSubmit={handleCreateSubmit}
              isPending={createMutation.isPending}
              onCancel={() => setIsCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog (simple form, no wizard needed for edits) */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Campanha</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold">Nome da Campanha</FormLabel>
                  <FormControl><Input {...field} className="h-11 rounded-xl bg-muted/30 border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="budget" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Orcamento Diario (R$)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} className="h-11 rounded-xl bg-muted/30 border-border" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="pausado">Pausado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="biddingStrategy" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold">Estrategia de Lances</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {BIDDING_STRATEGIES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={updateMutation.isPending} className="h-10 rounded-xl">
                  {updateMutation.isPending ? "Salvando..." : "Salvar Alteracoes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card className="border border-border/60 bg-card rounded-2xl shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-foreground">Todas as Campanhas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl bg-muted/40" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/40">
                  <TableHead className="pl-6 text-xs font-bold text-muted-foreground uppercase tracking-wider">Campanha</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">Orcamento</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">CPC</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">CTR</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">ROAS</TableHead>
                  <TableHead className="text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">Conversoes</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns?.map((campaign) => (
                  <TableRow key={campaign.id} className="hover:bg-muted/20 transition-colors border-border/30">
                    <TableCell className="font-medium py-4 pl-6">
                      <div className="space-y-1.5">
                        <div className="font-semibold text-foreground text-sm">{campaign.name}</div>
                        <div className="flex flex-wrap gap-1">
                          {(campaign.targetLocations?.length ?? 0) > 0 ? (
                            (campaign.targetLocations ?? []).slice(0, 3).map((loc: string) => (
                              <Badge key={loc} variant="outline" className="text-[9px] py-0 px-1.5 border-emerald-500/20 text-emerald-400 bg-emerald-500/5">{loc}</Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-muted-foreground/50 border-dashed">GEO: Global</Badge>
                          )}
                          {campaign.biddingStrategy && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-amber-500/20 text-amber-400 bg-amber-500/5">{campaign.biddingStrategy}</Badge>
                          )}
                          {(campaign.targetAges?.length ?? 0) > 0 && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-blue-500/20 text-blue-400 bg-blue-500/5">
                              {(campaign.targetAges ?? []).join(", ")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatCurrency(campaign.budget)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatCurrency(campaign.cpc)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatPercent(campaign.ctr)}</TableCell>
                    <TableCell className="text-right font-semibold text-sm text-primary tabular-nums">{campaign.roas.toFixed(2)}x</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{new Intl.NumberFormat("pt-BR").format(campaign.conversions)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 rounded-lg hover:bg-muted/60">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl">
                          <DropdownMenuItem onClick={() => handleStatusToggle(campaign.id, campaign.status)}>
                            {campaign.status === "ativo"
                              ? <><Pause className="mr-2 h-4 w-4" /> Pausar</>
                              : <><Play className="mr-2 h-4 w-4" /> Ativar</>
                            }
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(campaign)}>
                            <Pencil className="mr-2 h-4 w-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(campaign.id)}
                            className="text-red-400 focus:text-red-400 focus:bg-red-500/10"
                          >
                            <Trash className="mr-2 h-4 w-4" /> Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {campaigns?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                      Nenhuma campanha encontrada. Clique em "Nova Campanha" para comecar.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
