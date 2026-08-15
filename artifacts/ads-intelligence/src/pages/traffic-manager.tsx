import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Message = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "traffic_manager_chat_state";
const GREETING = "Como posso ajudar com sua campanha hoje?";

export default function TrafficManager() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.trafficChatMessages) && parsed.trafficChatMessages.length) {
        setMessages(parsed.trafficChatMessages);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trafficChatMessages: messages }));
  }, [messages]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || sending) return;
    const next = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const token = localStorage.getItem("ads_token");
      const response = await fetch("/api/chat-traffic-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar a mensagem.");
      setMessages((current) => [...current, { role: "assistant", content: data.message }]);
    } catch (error: any) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([{ role: "assistant", content: GREETING }]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] w-full max-w-4xl flex-col overflow-hidden px-6 py-8 sm:px-10 lg:px-14">
      <div className="flex shrink-0 items-center justify-between pb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.035em]">Gestor de Tráfego</h1>
        <button type="button" onClick={reset} className="text-sm text-muted-foreground hover:text-foreground">Limpar conversa</button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto overscroll-contain py-10 pr-2">
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "ml-auto max-w-[82%]" : "max-w-[90%]"}>
            <p className="mb-2 px-1 text-[11px] font-semibold text-muted-foreground">{message.role === "user" ? "Você" : "Gestor de Tráfego"}</p>
            <p className={`break-words whitespace-pre-line text-[15px] leading-7 ${message.role === "user" ? "rounded-[20px] rounded-br-md bg-primary px-5 py-3.5 text-primary-foreground" : "px-1 text-foreground"}`}>
              {message.content}
            </p>
          </div>
        ))}
        {sending && <p className="text-sm text-muted-foreground">Respondendo…</p>}
      </div>

      <form onSubmit={send} className="flex shrink-0 gap-3 bg-background pb-2 pt-5">
        <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Escreva sua mensagem" className="h-[52px] rounded-full border-border bg-background px-6 text-[15px] shadow-sm" />
        <Button type="submit" disabled={sending || !input.trim()} className="h-[52px] rounded-full bg-primary px-7 text-primary-foreground shadow-sm hover:bg-primary/90">Enviar</Button>
      </form>
    </div>
  );
}
