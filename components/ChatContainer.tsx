"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Message } from "@/types/chat";
import { DEFAULT_MODEL, type ModelId } from "@/lib/agent";
import * as chatApi from "@/lib/chatApi";
import type { SessionUser } from "@/lib/auth";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import InputArea, { type InputAreaHandle } from "./InputArea";
import WelcomeCard from "./WelcomeCard";
import UserMenu from "./UserMenu";
import HudCorners from "./HudCorners";
import dynamic from "next/dynamic";
const VoiceMode = dynamic(() => import("./VoiceMode"), { ssr: false });

async function callChatApi(
  text: string,
  history: Message[],
  model: ModelId,
  chatSessionId: string | null,
): Promise<{ output: string; chartData: unknown }> {
  const conversationHistory = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatInput: text, messages: conversationHistory, model, chatSessionId }),
  });
  if (res.status === 401) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  if (res.redirected) {
    throw Object.assign(new Error("Sessão expirada"), { status: 401 });
  }
  // Gateway timeouts (function killed mid-response) return plain-text bodies
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "O servidor demorou demais para responder. Tente novamente ou faça uma pergunta mais simples.",
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { output: data.output ?? "", chartData: data.chartData ?? undefined };
}

export default function ChatContainer({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputAreaHandle>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isFirstMsgRef = useRef(true);

  const scrollBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollBottom();
  }, [messages, isTyping]);

  // iOS Safari ignores interactive-widget=resizes-content: when the software
  // keyboard opens, keep the conversation pinned to the bottom by hand.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const createChatSession = useCallback(async () => {
    const id = await chatApi.createSession("Nova conversa");
    if (id) {
      sessionIdRef.current = id;
      isFirstMsgRef.current = true;
    }
  }, []);

  // Create initial chat session on mount
  useEffect(() => {
    createChatSession();
  }, [createChatSession]);

  // Cmd+N (Mac) / Ctrl+N (Win/Linux) → new chat session
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMessages([]);
        setIsTyping(false);
        await createChatSession();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createChatSession]);

  const saveMessage = useCallback(
    async (role: "USER" | "AI", content: string, chartData?: unknown) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      await chatApi.saveMessage(sid, role, content, chartData).catch(() => {});
    },
    [],
  );

  const updateTitle = useCallback(async (text: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !isFirstMsgRef.current) return;
    isFirstMsgRef.current = false;
    await chatApi.updateSessionTitle(sid, text.slice(0, 60)).catch(() => {});
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", text }]);
      setIsTyping(true);
      saveMessage("USER", text);
      updateTitle(text);

      try {
        const { output, chartData } = await callChatApi(text, messages, selectedModel, sessionIdRef.current);
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          text: output,
          chartData: chartData as Message["chartData"],
        };
        setMessages((prev) => [...prev, aiMsg]);
        saveMessage("AI", aiMsg.text, aiMsg.chartData);
      } catch (err) {
        if ((err as { status?: number }).status === 401) { router.push("/login"); return; }
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "ai",
            text: `⚠️ Erro ao conectar com o servidor:\n\`${(err as Error).message}\`\n\nTente novamente em alguns instantes.`,
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [messages, selectedModel, saveMessage, updateTitle, router],
  );

  return (
    <div className="relative z-10 w-full h-full flex flex-col overflow-hidden md:mx-5 md:my-[4dvh] md:max-w-9/12 md:h-[92dvh] md:max-h-225 md:rounded-[18px] md:border md:border-[color:var(--separator-strong)] md:[box-shadow:0_0_50px_rgba(39,224,255,0.08),inset_0_0_60px_rgba(6,12,26,0.6)]">
      {/* HUD frame corners (desktop) */}
      <div className="hidden md:block">
        <HudCorners accent="cyan" size={18} inset={8} />
      </div>

      {/* Header — HUD command bar */}
      <div className="relative flex items-center gap-2 md:gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-7 md:py-4.5 border-b border-separator shrink-0">
        {/* Cyan scan rail under the header */}
        <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span
            className="block h-full w-1/4 animate-hud-sweep motion-reduce:hidden"
            style={{ background: "linear-gradient(90deg, transparent, var(--hud-cyan), transparent)" }}
          />
        </span>
        <a
          href="/"
          title="Voltar ao início"
          className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-fill-2 transition-all duration-150 shrink-0 -ml-2 md:-ml-2"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        {/* Diamond glyph (replaces the old ring) */}
        <span
          className="shrink-0 text-[15px] leading-none animate-hud-flicker motion-reduce:animate-none"
          style={{ color: "var(--hud-cyan)", textShadow: "0 0 12px var(--hud-cyan)" }}
        >
          ◇
        </span>
        <div className="min-w-0">
          <h1
            className="font-hud text-[15px] md:text-[17px] font-bold uppercase tracking-[0.24em] text-ink"
            style={{ textShadow: "0 0 14px rgba(39,224,255,0.45)" }}
          >
            Jarvis
          </h1>
          <p className="font-hud text-[8px] uppercase tracking-[0.34em] text-ink-3 mt-1 hidden md:block">
            SECOM · Data Assistant
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <div className="hidden md:flex items-center gap-1.5">
            <span
              title="Online"
              className="w-1.5 h-1.5 bg-success rounded-full shadow-[0_0_8px_rgba(48,217,184,0.8)] animate-pulse-green"
            />
            <span className="font-hud text-[8px] uppercase tracking-[0.28em] text-ink-3">Online</span>
          </div>
          <UserMenu user={user} hideThemeToggle />
        </div>
      </div>

      {/* Messages — float over the lattice */}
      <div className="messages-scroll flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7 flex flex-col gap-3.5 md:gap-4 scroll-smooth">
        <WelcomeCard />
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <InputArea ref={inputRef} onSend={handleSend} disabled={isTyping} onVoiceClick={() => setVoiceOpen(true)} />

      {voiceOpen && <VoiceMode onClose={() => setVoiceOpen(false)} model={selectedModel} />}
    </div>
  );
}
