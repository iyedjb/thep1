import { FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Message = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "traffic_manager_chat_state";
export default function TrafficManager() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.trafficChatMessages) && parsed.trafficChatMessages.length) {
        const restored = parsed.trafficChatMessages as Message[];
        if (restored.length === 1 && restored[0]?.role === "assistant") {
          setMessages([]);
          localStorage.removeItem(STORAGE_KEY);
        } else {
          setMessages(restored);
        }
      }
    } catch (_) {
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ trafficChatMessages: messages }));
  }, [loaded, messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

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
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const conversationTitle = messages.find((message) => message.role === "user")?.content || "Conversa atual";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-white font-sans">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1200 900" preserveAspectRatio="none">
        <path d="M -80 700 Q 180 430 500 120" stroke="rgb(0 166 251 / 0.10)" strokeWidth="1.5" strokeDasharray="7 8" fill="none" />
        <path d="M 500 920 Q 760 500 1160 80" stroke="rgb(0 166 251 / 0.08)" strokeWidth="1.5" strokeDasharray="7 8" fill="none" />
      </svg>

      <Sheet>
        <SheetTrigger asChild>
          <button type="button" aria-label="Abrir histórico" className="absolute right-5 top-5 z-20 flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-full border border-slate-200/80 bg-white/85 text-slate-500 shadow-[0_8px_32px_rgba(15,23,42,0.06)] backdrop-blur-sm hover:bg-white hover:text-slate-900">
            <span className="h-px w-4 bg-current" />
            <span className="h-px w-4 bg-current" />
            <span className="sr-only">Histórico</span>
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="flex w-full flex-col border-slate-200 bg-white p-6 sm:max-w-md [&>button.absolute]:right-5 [&>button.absolute]:top-5 [&>button.absolute]:h-10 [&>button.absolute]:w-10 [&>button.absolute]:rounded-full [&>button.absolute]:border [&>button.absolute]:border-slate-200/80 [&>button.absolute]:bg-white [&>button.absolute]:p-3 [&>button.absolute]:shadow-[0_8px_32px_rgba(15,23,42,0.06)]">
          <SheetTitle className="text-2xl font-semibold tracking-tight text-slate-900">Conversas</SheetTitle>
          <SheetDescription className="sr-only">Abra a conversa atual ou comece uma nova.</SheetDescription>
          <div className="mt-8 flex-1 border-t border-slate-200 pt-5">
            {messages.length > 0 ? (
              <SheetClose asChild>
                <button type="button" className="w-full rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-4 text-left">
                  <span className="block truncate text-sm font-semibold text-slate-900">{conversationTitle}</span>
                  <span className="mt-1 block text-xs text-slate-500">{messages.length} mensagens</span>
                </button>
              </SheetClose>
            ) : (
              <p className="pt-8 text-center text-sm text-slate-400">Nenhuma conversa ainda</p>
            )}
          </div>
          <SheetClose asChild>
            <button type="button" onClick={reset} className="h-12 w-full rounded-full bg-primary px-6 text-sm font-semibold text-white hover:bg-primary/90">
              Nova conversa
            </button>
          </SheetClose>
        </SheetContent>
      </Sheet>

      <main ref={scrollRef} className="relative z-10 h-full overflow-y-auto overscroll-contain px-6 sm:px-10">
        <div className="mx-auto w-full max-w-3xl space-y-10 pb-40 pt-28">
          {messages.map((message, index) => (
            <div key={index} className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={message.role === "user" ? "max-w-[82%]" : "w-full max-w-[90%]"}>
                <p className={`break-words whitespace-pre-wrap text-[16px] font-normal leading-[1.55] ${message.role === "user" ? "rounded-[20px] rounded-br-[5px] bg-primary px-5 py-3.5 text-white shadow-sm" : "text-[#374151]"}`}>
                  {message.content}
                </p>
              </div>
            </div>
          ))}
          {sending && <p className="text-[16px] text-[#9CA3AF] animate-pulse">Pensando...</p>}
          <div ref={endRef} className="h-3" />
        </div>
      </main>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/95 to-transparent px-6 pb-8 pt-14 sm:px-10">
        <form onSubmit={send} className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-2">
          <div className="flex h-[54px] min-w-0 flex-1 items-center rounded-[27px] border border-slate-200/80 bg-white/85 px-5 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pergunte ao Gestor de Tráfego" className="h-full flex-1 border-0 bg-transparent px-0 text-[16px] font-medium text-slate-900 shadow-none placeholder:text-[#9CA3AF] focus-visible:ring-0" />
          </div>
          <Button type="submit" aria-label="Enviar" disabled={sending || !input.trim()} className="h-[54px] w-[54px] shrink-0 rounded-full bg-primary p-0 text-xl font-semibold text-white shadow-[0_8px_32px_rgba(0,166,251,0.18)] hover:bg-primary/90 disabled:border disabled:border-slate-200 disabled:bg-white/85 disabled:text-[#9CA3AF] disabled:opacity-100">
            ↑
          </Button>
        </form>
      </footer>
    </div>
  );
}
