import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  MessageSquare,
  UserPlus,
  Trash2,
  Send,
  CheckCheck,
  Search,
  Shield,
  Crown,
  Zap,
  Sparkles,
  RefreshCw,
  Copy,
  CheckCircle2,
  Clock,
  Check,
  UserCheck,
  Key,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

interface UserItem {
  id: number;
  email: string;
  name: string;
  role: string;
  is_temporary: boolean;
  subscription_tier: string;
  subscription_status: string;
  created_at: string;
}

interface ChatItem {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_tier: string;
  subject: string;
  status: "open" | "resolved" | "closed";
  last_message: string;
  updated_at: string;
  unread_count: number;
}

interface MessageItem {
  id: number;
  chat_id: number;
  sender_type: "user" | "admin";
  sender_id: number;
  content: string;
  is_read: boolean;
  created_at: string;
}

import { Logo } from "@/components/layout/logo";
import { useLocation } from "wouter";
import { LogOut } from "lucide-react";

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<"users" | "chat">("chat");
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [searchChat, setSearchChat] = useState("");
  const [chatFilterStatus, setChatFilterStatus] = useState<"all" | "open" | "resolved">("open");

  // Admin token authentication guard
  useEffect(() => {
    const adminToken = localStorage.getItem("admin_token");
    if (!adminToken) {
      setLocation("/admin/login");
    }
  }, [setLocation]);

  const handleAdminLogout = () => {
    localStorage.removeItem("admin_token");
    toast({ title: "Sessão encerrada com sucesso" });
    setLocation("/admin/login");
  };

  // Temp User Creation State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempTier, setTempTier] = useState<"pro" | "enterprise">("pro");
  const [tempPassword, setTempPassword] = useState("");
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
    planTier: string;
  } | null>(null);

  // Fetch Users List
  const { data: usersData, refetch: refetchUsers } = useQuery<{ users: UserItem[] }>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/admin/users", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Falha ao carregar usuários");
      return res.json();
    },
    enabled: activeTab === "users",
  });

  // Fetch Chats List
  const { data: chatsData, refetch: refetchChats } = useQuery<{ chats: ChatItem[] }>({
    queryKey: ["admin-chats"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/admin/chats", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Falha ao carregar conversas");
      return res.json();
    },
    refetchInterval: 4000, // Poll every 4 seconds for WhatsApp live updates
  });

  // Fetch Current Thread Messages
  const { data: threadData, refetch: refetchMessages } = useQuery<{
    chat: ChatItem;
    messages: MessageItem[];
  }>({
    queryKey: ["admin-chat-messages", selectedChatId],
    queryFn: async () => {
      if (!selectedChatId) return null as any;
      const token = localStorage.getItem("ads_token");
      const res = await fetch(`/api/admin/chats/${selectedChatId}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Falha ao carregar mensagens");
      return res.json();
    },
    enabled: !!selectedChatId,
    refetchInterval: 3000,
  });

  // Auto scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadData?.messages]);

  // Create Temp User Mutation
  const createTempUserMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/admin/create-temp-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: tempName,
          email: tempEmail,
          planTier: tempTier,
          customPassword: tempPassword,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar usuário");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedCredentials({
        email: data.user.email,
        password: data.user.password,
        planTier: data.user.planTier,
      });
      setIsCreateModalOpen(false);
      refetchUsers();
      toast({
        title: "Usuário Temporário Criado!",
        description: `Conta criada para ${data.user.email} no plano ${data.user.planTier.toUpperCase()}`,
      });
      setTempName("");
      setTempEmail("");
      setTempPassword("");
    },
    onError: (err: any) => {
      toast({
        title: "Erro na criação",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Send Admin Reply Mutation
  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChatId || !replyContent.trim()) return;
      const token = localStorage.getItem("ads_token");
      const res = await fetch(`/api/admin/chats/${selectedChatId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: replyContent }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao enviar resposta");
      }
      return res.json();
    },
    onSuccess: () => {
      setReplyContent("");
      refetchMessages();
      refetchChats();
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao enviar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Update Chat Status Mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (status: "open" | "resolved") => {
      if (!selectedChatId) return;
      const token = localStorage.getItem("ads_token");
      const res = await fetch(`/api/admin/chats/${selectedChatId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar status");
      return res.json();
    },
    onSuccess: () => {
      refetchMessages();
      refetchChats();
      toast({ title: "Status da conversa atualizado" });
    },
  });

  // Delete User Mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao excluir");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchUsers();
      toast({ title: "Conta de usuário removida" });
    },
  });

  // Change Tier Mutation
  const changeTierMutation = useMutation({
    mutationFn: async ({ userId, planTier }: { userId: number; planTier: string }) => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch(`/api/admin/users/${userId}/tier`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planTier }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar plano");
      return res.json();
    },
    onSuccess: () => {
      refetchUsers();
      toast({ title: "Plano do usuário atualizado!" });
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReplyMutation.mutate();
    }
  };

  // Filtered Chats
  const filteredChats = (chatsData?.chats || []).filter((chat) => {
    const matchesSearch =
      chat.user_name.toLowerCase().includes(searchChat.toLowerCase()) ||
      chat.user_email.toLowerCase().includes(searchChat.toLowerCase()) ||
      chat.last_message.toLowerCase().includes(searchChat.toLowerCase());

    if (chatFilterStatus === "all") return matchesSearch;
    return matchesSearch && chat.status === chatFilterStatus;
  });

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Standalone Admin Header */}
      <div className="px-6 py-3 border-b border-border/60 bg-card/60 backdrop-blur-md flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-4">
          <Logo iconSize={28} />
          <div className="h-6 w-px bg-border/60" />
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
                Portal Administrativo da Plataforma
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[9px] uppercase tracking-wider px-2 py-0">
                  Painel de Controle
                </Badge>
              </h1>
            </div>
          </div>
        </div>

        {/* Navigation Tabs + Logout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/40">
            <Button
              variant={activeTab === "chat" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("chat")}
              className="gap-2 text-xs h-8"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat Atendimento
              {chatsData?.chats?.some((c) => c.unread_count > 0) && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              )}
            </Button>
            <Button
              variant={activeTab === "users" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("users")}
              className="gap-2 text-xs h-8"
            >
              <Users className="w-3.5 h-3.5" />
              Gerenciador de Contas
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleAdminLogout}
            className="text-xs h-8 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
            Sair do Admin
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0">
        {activeTab === "chat" ? (
          /* WHATSAPP WEB STYLE DUAL PANE CHAT */
          <div className="h-full grid grid-cols-12 divide-x divide-border/60">
            {/* Left Conversations Sidebar */}
            <div className="col-span-4 flex flex-col h-full bg-muted/10">
              {/* Search & Filters */}
              <div className="p-3 border-b border-border/40 space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar conversa ou e-mail..."
                    value={searchChat}
                    onChange={(e) => setSearchChat(e.target.value)}
                    className="pl-9 text-xs h-9 bg-background/50 border-border/60"
                  />
                </div>

                <div className="flex gap-1">
                  {(["open", "resolved", "all"] as const).map((st) => (
                    <Button
                      key={st}
                      variant={chatFilterStatus === st ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setChatFilterStatus(st)}
                      className="text-[11px] h-7 flex-1 capitalize"
                    >
                      {st === "open" ? "Abertos" : st === "resolved" ? "Resolvidos" : "Todos"}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Chat Threads List */}
              <div className="flex-1 overflow-y-auto divide-y divide-border/20">
                {filteredChats.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    Nenhuma conversa encontrada.
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const isSelected = selectedChatId === chat.id;
                    const tier = (chat.user_tier || "free").toLowerCase();

                    return (
                      <div
                        key={chat.id}
                        onClick={() => setSelectedChatId(chat.id)}
                        className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/10 border-l-4 border-primary"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <Avatar className="w-10 h-10 border border-white/10 shrink-0">
                          <AvatarFallback className="bg-emerald-500/20 text-emerald-400 font-bold text-xs">
                            {chat.user_name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-semibold text-xs text-foreground truncate">
                              {chat.user_name}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {formatTime(chat.updated_at)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-muted-foreground truncate">
                              {chat.user_email}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1.5 py-0 h-4 border uppercase ${
                                tier === "enterprise"
                                  ? "border-purple-500/40 text-purple-400"
                                  : tier === "pro"
                                  ? "border-primary/40 text-primary"
                                  : "border-muted text-muted-foreground"
                              }`}
                            >
                              {tier}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground/80 truncate">
                            {chat.last_message || "Sem mensagens"}
                          </p>
                        </div>

                        {chat.unread_count > 0 && (
                          <div className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold text-[10px] flex items-center justify-center shrink-0">
                            {chat.unread_count}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Chat Thread Window */}
            <div className="col-span-8 flex flex-col h-full bg-background relative">
              {selectedChatId && threadData?.chat ? (
                <>
                  {/* Chat Header */}
                  <div className="px-5 py-3 border-b border-border/60 bg-muted/20 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-9 h-9 border border-white/10">
                        <AvatarFallback className="bg-emerald-500/20 text-emerald-400 font-bold text-xs">
                          {threadData.chat.user_name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                          {threadData.chat.user_name}
                          <Badge
                            className={`text-[9px] uppercase px-1.5 py-0 ${
                              threadData.chat.user_tier === "enterprise"
                                ? "bg-purple-500/20 text-purple-300"
                                : threadData.chat.user_tier === "pro"
                                ? "bg-primary/20 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            Plano {threadData.chat.user_tier || "FREE"}
                          </Badge>
                        </h3>
                        <p className="text-xs text-muted-foreground">{threadData.chat.user_email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant={threadData.chat.status === "resolved" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() =>
                          updateStatusMutation.mutate(
                            threadData.chat.status === "resolved" ? "open" : "resolved"
                          )
                        }
                        className="text-xs gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        {threadData.chat.status === "resolved" ? "Resolvido" : "Marcar Resolvido"}
                      </Button>

                      <Button variant="ghost" size="icon" onClick={() => refetchMessages()}>
                        <RefreshCw className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>

                  {/* Messages Scroll Area with WhatsApp Feel */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px]">
                    {threadData.messages.map((msg) => {
                      const isAdmin = msg.sender_type === "admin";
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-xs space-y-1 shadow-sm ${
                              isAdmin
                                ? "bg-emerald-600 text-white rounded-tr-none"
                                : "bg-muted/80 text-foreground border border-border/40 rounded-tl-none"
                            }`}
                          >
                            <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                            <div className="flex items-center justify-end gap-1 text-[9px] opacity-75 font-mono">
                              <span>{formatTime(msg.created_at)}</span>
                              {isAdmin && (
                                <CheckCheck className="w-3 h-3 text-emerald-200" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Quick Responses Bar */}
                  <div className="px-4 py-2 bg-muted/10 border-t border-border/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase shrink-0">
                      Respostas Rápidas:
                    </span>
                    {[
                      "Olá! Como posso ajudar com suas campanhas hoje?",
                      "Sua conta foi ativada e seu plano atualizado!",
                      "Verifiquei sua presell e ela está pronta para rodar.",
                      "Qualquer dúvida estou à disposição!",
                    ].map((text, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        onClick={() => setReplyContent(text)}
                        className="text-[11px] h-6 px-2.5 shrink-0 bg-background/40 hover:bg-background"
                      >
                        {text.slice(0, 25)}...
                      </Button>
                    ))}
                  </div>

                  {/* Chat Input Footer */}
                  <div className="p-3 border-t border-border/60 bg-muted/20 flex items-center gap-2">
                    <Input
                      placeholder="Escreva uma resposta para o usuário (Pressione Enter para enviar)..."
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 text-xs bg-background/60 border-border/60"
                    />
                    <Button
                      onClick={() => sendReplyMutation.mutate()}
                      disabled={sendReplyMutation.isPending || !replyContent.trim()}
                      className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold"
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Enviar
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground space-y-3">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <MessageSquare className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground">Central de Atendimento Suporte</h3>
                  <p className="text-xs max-w-sm">
                    Selecione uma conversa na lista à esquerda para responder em tempo real ao cliente.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* USERS & TEMPORARY ACCOUNTS MANAGEMENT TAB */
          <div className="p-6 space-y-6 overflow-y-auto h-full">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Gerenciador de Usuários e Acessos</h2>
                <p className="text-xs text-muted-foreground">
                  Crie contas temporárias com permissões especiais para testes, suporte ou clientes.
                </p>
              </div>

              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Criar Conta Temporária
              </Button>
            </div>

            {/* Users Table */}
            <Card className="border-border/60">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border/60 bg-muted/30 uppercase text-[10px] font-bold text-muted-foreground">
                      <tr>
                        <th className="p-3.5">ID</th>
                        <th className="p-3.5">Nome / E-mail</th>
                        <th className="p-3.5">Tipo de Conta</th>
                        <th className="p-3.5">Função</th>
                        <th className="p-3.5">Plano Ativo</th>
                        <th className="p-3.5">Data de Criação</th>
                        <th className="p-3.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {(usersData?.users || []).map((u) => (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3.5 font-mono text-muted-foreground">#{u.id}</td>
                          <td className="p-3.5">
                            <div className="font-semibold text-foreground">{u.name}</div>
                            <div className="text-[11px] text-muted-foreground">{u.email}</div>
                          </td>
                          <td className="p-3.5">
                            {u.is_temporary ? (
                              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                                Temporária
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                Definitiva
                              </Badge>
                            )}
                          </td>
                          <td className="p-3.5">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                u.role === "admin"
                                  ? "border-emerald-500/40 text-emerald-400"
                                  : "border-border"
                              }`}
                            >
                              {u.role === "admin" ? "Administrador" : "Usuário"}
                            </Badge>
                          </td>
                          <td className="p-3.5">
                            <Select
                              defaultValue={u.subscription_tier || "free"}
                              onValueChange={(tier) =>
                                changeTierMutation.mutate({ userId: u.id, planTier: tier })
                              }
                            >
                              <SelectTrigger className="h-7 text-xs w-32 border-border/60">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="free">Grátis</SelectItem>
                                <SelectItem value="pro">Pro (R$ 97)</SelectItem>
                                <SelectItem value="enterprise">Enterprise (R$ 197)</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3.5 text-muted-foreground font-mono text-[11px]">
                            {new Date(u.created_at).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="p-3.5 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteUserMutation.mutate(u.id)}
                              className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10 h-7 w-7"
                              title="Excluir Usuário"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Temporary Account Dialog */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-md bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Criar Conta Temporária
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Gere um acesso de teste temporário para clientes ou equipe com plano pré-ativado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Nome Completo</label>
              <Input
                placeholder="Ex: Usuário Teste"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">E-mail de Acesso</label>
              <Input
                placeholder="cliente.teste@exemplo.com"
                value={tempEmail}
                onChange={(e) => setTempEmail(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Plano Atribuído</label>
              <Select value={tempTier} onValueChange={(val: any) => setTempTier(val)}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pro">Plano PRO (Acesso Total)</SelectItem>
                  <SelectItem value="enterprise">Plano Enterprise (Escala Agência)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Senha (Opcional - Gerada automaticamente se vazia)</label>
              <Input
                placeholder="Deixe em branco para senha aleatória"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button
              onClick={() => createTempUserMutation.mutate()}
              disabled={createTempUserMutation.isPending || !tempName || !tempEmail}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              Gerar Credenciais Temporárias
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated Credentials View Modal */}
      <Dialog open={!!createdCredentials} onOpenChange={() => setCreatedCredentials(null)}>
        <DialogContent className="sm:max-w-md bg-background border-emerald-500/40 text-foreground">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-1">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <DialogTitle className="text-center text-emerald-400 font-bold">
              Credenciais Geradas com Sucesso!
            </DialogTitle>
            <DialogDescription className="text-xs text-center text-muted-foreground">
              Copie os dados abaixo e envie ao usuário para acesso imediato.
            </DialogDescription>
          </DialogHeader>

          {createdCredentials && (
            <div className="space-y-3 pt-2">
              <div className="p-3 rounded-lg border border-border bg-muted/40 font-mono text-xs space-y-1.5">
                <div>
                  <span className="text-muted-foreground">E-mail:</span>{" "}
                  <strong className="text-foreground">{createdCredentials.email}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Senha:</span>{" "}
                  <strong className="text-emerald-400">{createdCredentials.password}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Plano:</span>{" "}
                  <strong className="uppercase text-primary">{createdCredentials.planTier}</strong>
                </div>
              </div>

              <Button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `Login: ${createdCredentials.email}\nSenha: ${createdCredentials.password}\nPlano: ${createdCredentials.planTier.toUpperCase()}`
                  );
                  toast({ title: "Credenciais copiadas para a área de transferência!" });
                }}
                className="w-full bg-emerald-500 text-black font-bold hover:bg-emerald-600"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copiar Credenciais
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
