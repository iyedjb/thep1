import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  CheckCheck,
  Headphones,
  Sparkles,
  Shield,
  Clock,
  HelpCircle,
  Zap,
  RefreshCw,
  MessageCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";

interface ChatItem {
  id: number;
  subject: string;
  status: "open" | "resolved" | "closed";
  last_message: string;
  updated_at: string;
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

export default function SupportPage() {
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageText, setMessageText] = useState("");

  // Fetch or initialize user active support chat thread
  const { data, refetch: refetchChat, isLoading } = useQuery<{
    chat: ChatItem;
    messages: MessageItem[];
  }>({
    queryKey: ["user-support-chat"],
    queryFn: async () => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/support/my-chat", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Erro ao carregar suporte");
      return res.json();
    },
    refetchInterval: 3000, // Live poll every 3 seconds for admin replies
  });

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      const token = localStorage.getItem("ads_token");
      const res = await fetch("/api/support/send-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao enviar");
      }
      return res.json();
    },
    onSuccess: () => {
      setMessageText("");
      refetchChat();
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao enviar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (messageText.trim()) {
      sendMessageMutation.mutate(messageText.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-[calc(100vh-4rem)] p-4 sm:p-6 bg-background flex flex-col items-center justify-center">
      <div className="w-full max-w-4xl h-full flex flex-col rounded-2xl border border-border/60 bg-muted/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 border border-emerald-500/30">
              <AvatarFallback className="bg-emerald-500/20 text-emerald-400 font-bold">
                <Headphones className="w-5 h-5" />
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                Suporte Oficial Ads Intelligence
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                  Online 24/7
                </Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                Tire dúvidas sobre presells, Google Ads, pagamentos ou suporte técnico.
              </p>
            </div>
          </div>

          <Button variant="ghost" size="icon" onClick={() => refetchChat()}>
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        {/* WhatsApp-Style Chat Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:16px_16px]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando atendimento...
            </div>
          ) : (
            data?.messages.map((msg) => {
              const isUser = msg.sender_type === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[75%] sm:max-w-[65%] px-4 py-3 rounded-2xl text-xs space-y-1.5 shadow-md ${
                      isUser
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-emerald-950/80 text-emerald-100 border border-emerald-500/30 rounded-tl-none"
                    }`}
                  >
                    {!isUser && (
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-0.5">
                        Equipe de Suporte
                      </div>
                    )}
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                    <div className="flex items-center justify-end gap-1 text-[9px] opacity-75 font-mono">
                      <span>{formatTime(msg.created_at)}</span>
                      {isUser && (
                        <CheckCheck
                          className={`w-3.5 h-3.5 ${
                            msg.is_read ? "text-emerald-400" : "text-primary-foreground/60"
                          }`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Topic Suggestion Pills */}
        <div className="px-4 py-2 bg-muted/20 border-t border-border/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-bold text-muted-foreground uppercase shrink-0">
            Sugestões Rápidas:
          </span>
          {[
            "Como integrar minha conta do Google Ads?",
            "Como gerar uma Presell de alta conversão?",
            "Dúvidas sobre os planos Pro e Enterprise",
            "Preciso de ajuda com o pagamento Pix",
          ].map((topic, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              onClick={() => sendMessageMutation.mutate(topic)}
              className="text-[11px] h-7 px-3 shrink-0 bg-background/50 hover:bg-background"
            >
              {topic}
            </Button>
          ))}
        </div>

        {/* Input Footer */}
        <div className="p-3 border-t border-border/60 bg-muted/30 flex items-center gap-2">
          <Input
            placeholder="Digite sua mensagem para o suporte (Enter para enviar)..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 text-xs bg-background border-border/60"
          />
          <Button
            onClick={handleSend}
            disabled={sendMessageMutation.isPending || !messageText.trim()}
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold px-5"
          >
            <Send className="w-4 h-4 mr-1.5" />
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
