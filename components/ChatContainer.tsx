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
import JarvisRing from "./JarvisRing";
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
    <div className="w-full h-full flex flex-col bg-surface-opaque rounded-none border-0 overflow-hidden relative z-10 md:mx-5 md:max-w-9/12 md:h-[92dvh] md:max-h-225 md:bg-surface md:backdrop-blur-[60px] md:backdrop-saturate-180 md:border-[0.5px] md:border-separator md:rounded-[28px] md:shadow-(--shadow-card)">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-6 md:py-4.5 bg-fill border-b-[0.5px] border-separator shrink-0">
        <a
          href="/"
          title="Voltar ao início"
          className="w-11 h-11 md:w-8 md:h-8 rounded-xl flex items-center justify-center text-ink-3 hover:text-ink-2 hover:bg-fill-2 transition-all duration-150 shrink-0 -ml-2 md:-ml-1 md:mr-0.5"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        <div className="shrink-0 md:hidden">
          <JarvisRing size={34} />
        </div>
        <div className="shrink-0 hidden md:block">
          <JarvisRing size={44} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold text-ink tracking-[-0.2px]">
            Jarvis
          </h1>
          <p className="text-xs text-ink-3 mt-0.5 hidden md:block">
            Assistente de dados da SECOM
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 md:gap-2.5">
          <div
            title="Online"
            className="w-2 h-2 bg-success rounded-full shadow-[0_0_6px_rgba(52,199,89,0.55)] animate-pulse-green hidden md:block"
          />
          <UserMenu user={user} />
        </div>
      </div>

      {/* Messages */}
      <div className="messages-scroll flex-1 overflow-y-auto px-3.5 py-4 md:px-6 md:py-7 flex flex-col gap-3 md:gap-3.5 scroll-smooth">
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
