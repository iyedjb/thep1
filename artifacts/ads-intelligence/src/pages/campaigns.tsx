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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Plus, MoreHorizontal, Pencil, Trash, Play, Pause } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";

const campaignSchema = z.object({
  name: z.string().min(1, "O nome é obrigatório"),
  budget: z.coerce.number().min(1, "O orçamento deve ser maior que 0"),
  status: z.string().optional(),
  targetAges: z.array(z.string()).default([]),
  targetGenders: z.array(z.string()).default([]),
});

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

  const createForm = useForm<z.infer<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: { name: "", budget: 100, status: "ativo", targetAges: [], targetGenders: [] },
  });

  const editForm = useForm<z.infer<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: { name: "", budget: 100, status: "ativo", targetAges: [], targetGenders: [] },
  });

  const handleCreateSubmit = (data: z.infer<typeof campaignSchema>) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
        setIsCreateOpen(false);
        createForm.reset();
        toast({ title: "Campanha criada com sucesso" });
      },
      onError: () => toast({ title: "Erro ao criar campanha", variant: "destructive" })
    });
  };

  const handleEditSubmit = (data: z.infer<typeof campaignSchema>) => {
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
        return <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">Ativo</Badge>;
      case "pausado":
        return <Badge className="bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20">Pausado</Badge>;
      case "removido":
        return <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20">Removido</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Campanhas</h1>
          <p className="text-muted-foreground mt-1">Gerencie suas campanhas e orçamentos</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Nova Campanha
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Nova Campanha</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(handleCreateSubmit)} className="space-y-4">
                <FormField control={createForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da Campanha</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="budget" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Orçamento (R$)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status Inicial</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="pausado">Pausado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <div className="space-y-4 border-t pt-4">
                  <h4 className="text-sm font-semibold text-slate-700">Segmentação de Público</h4>
                  
                  <FormField
                    control={createForm.control}
                    name="targetAges"
                    render={() => (
                      <FormItem>
                        <FormLabel>Faixas Etárias</FormLabel>
                        <div className="grid grid-cols-3 gap-2">
                          {["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((age) => (
                            <FormField
                              key={age}
                              control={createForm.control}
                              name="targetAges"
                              render={({ field }) => {
                                return (
                                  <FormItem key={age} className="flex flex-row items-center space-x-2 space-y-0 p-2 border rounded-md">
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value?.includes(age)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value || []), age])
                                            : field.onChange((field.value || []).filter((value) => value !== age))
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="text-xs font-normal cursor-pointer">{age}</FormLabel>
                                  </FormItem>
                                )
                              }}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={createForm.control}
                    name="targetGenders"
                    render={() => (
                      <FormItem>
                        <FormLabel>Gêneros</FormLabel>
                        <div className="grid grid-cols-3 gap-2">
                          {["Masculino", "Feminino", "Desconhecido"].map((gender) => (
                            <FormField
                              key={gender}
                              control={createForm.control}
                              name="targetGenders"
                              render={({ field }) => {
                                return (
                                  <FormItem key={gender} className="flex flex-row items-center space-x-2 space-y-0 p-2 border rounded-md">
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value?.includes(gender)}
                                        onCheckedChange={(checked) => {
                                          return checked
                                            ? field.onChange([...(field.value || []), gender])
                                            : field.onChange((field.value || []).filter((value) => value !== gender))
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="text-xs font-normal cursor-pointer">{gender}</FormLabel>
                                  </FormItem>
                                )
                              }}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Criando..." : "Criar Campanha"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Campanha</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da Campanha</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="budget" render={({ field }) => (
                <FormItem>
                  <FormLabel>Orçamento (R$)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              
              <div className="space-y-4 border-t pt-4">
                <h4 className="text-sm font-semibold text-slate-700">Segmentação de Público</h4>
                
                <FormField
                  control={editForm.control}
                  name="targetAges"
                  render={() => (
                    <FormItem>
                      <FormLabel>Faixas Etárias</FormLabel>
                      <div className="grid grid-cols-3 gap-2">
                        {["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((age) => (
                          <FormField
                            key={age}
                            control={editForm.control}
                            name="targetAges"
                            render={({ field }) => {
                              return (
                                <FormItem key={age} className="flex flex-row items-center space-x-2 space-y-0 p-2 border rounded-md">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(age)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), age])
                                          : field.onChange((field.value || []).filter((value) => value !== age))
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-xs font-normal cursor-pointer">{age}</FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="targetGenders"
                  render={() => (
                    <FormItem>
                      <FormLabel>Gêneros</FormLabel>
                      <div className="grid grid-cols-3 gap-2">
                        {["Masculino", "Feminino", "Desconhecido"].map((gender) => (
                          <FormField
                            key={gender}
                            control={editForm.control}
                            name="targetGenders"
                            render={({ field }) => {
                              return (
                                <FormItem key={gender} className="flex flex-row items-center space-x-2 space-y-0 p-2 border rounded-md">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(gender)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), gender])
                                          : field.onChange((field.value || []).filter((value) => value !== gender))
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-xs font-normal cursor-pointer">{gender}</FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Todas as Campanhas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orçamento</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Conversões</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns?.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium py-3">
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground">{campaign.name}</div>
                        <div className="flex flex-wrap gap-1">
                          {campaign.targetAges && campaign.targetAges.length > 0 ? (
                            campaign.targetAges.map((age: string) => (
                              <Badge key={age} variant="secondary" className="text-[9px] font-medium py-0 px-1">{age}</Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-[9px] py-0 px-1 text-muted-foreground border-dashed">Idades: Todas</Badge>
                          )}
                          {campaign.targetGenders && campaign.targetGenders.length > 0 ? (
                            campaign.targetGenders.map((gender: string) => (
                              <Badge key={gender} variant="outline" className="text-[9px] font-medium py-0 px-1 border-primary/20 text-primary">{gender}</Badge>
                            ))
                          ) : (
                            <Badge variant="outline" className="text-[9px] py-0 px-1 text-muted-foreground border-dashed">Gêneros: Todos</Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(campaign.budget)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(campaign.cpc)}</TableCell>
                    <TableCell className="text-right">{formatPercent(campaign.ctr)}</TableCell>
                    <TableCell className="text-right font-medium text-primary">{campaign.roas.toFixed(2)}x</TableCell>
                    <TableCell className="text-right">{new Intl.NumberFormat("pt-BR").format(campaign.conversions)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleStatusToggle(campaign.id, campaign.status)}>
                            {campaign.status === "ativo" ? (
                              <><Pause className="mr-2 h-4 w-4" /> Pausar</>
                            ) : (
                              <><Play className="mr-2 h-4 w-4" /> Ativar</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(campaign)}>
                            <Pencil className="mr-2 h-4 w-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(campaign.id)} className="text-red-600 focus:text-red-600 focus:bg-red-100 dark:focus:bg-red-950">
                            <Trash className="mr-2 h-4 w-4" /> Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {campaigns?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Nenhuma campanha encontrada.
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
