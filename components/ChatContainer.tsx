"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Message } from "@/types/chat";
import { MODELS, DEFAULT_MODEL, type ModelId } from "@/lib/agent";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import InputArea, { type InputAreaHandle } from "./InputArea";
import WelcomeCard from "./WelcomeCard";
import dynamic from "next/dynamic";
const VoiceMode = dynamic(() => import("./VoiceMode"), { ssr: false });

const StarIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9 1L10.3 7.2L16.5 9L10.3 10.8L9 17L7.7 10.8L1.5 9L7.7 7.2L9 1Z"
      stroke="#78b4ff"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export default function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(DEFAULT_MODEL);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputAreaHandle>(null);

  const scrollBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollBottom();
  }, [messages, isTyping]);

  // Cmd+N (Mac) / Ctrl+N (Win/Linux) → new session
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMessages([]);
        setIsTyping(false);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);

      try {
        const conversationHistory = messages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatInput: text,
            messages: conversationHistory,
            model: selectedModel,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          text: data.output ?? "",
          chartData: data.chartData ?? undefined,
        };
        setMessages((prev) => [...prev, aiMsg]);
      } catch (err) {
        const errMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          text: `⚠️ Erro ao conectar com o servidor:\n\`${(err as Error).message}\`\n\nTente novamente em alguns instantes.`,
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsTyping(false);
      }
    },
    [messages, selectedModel],
  );

  return (
    <div className="w-full max-w-9/12 h-[92vh] max-h-225 flex flex-col bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] backdrop-saturate-180 border-[0.5px] border-white/[0.14] rounded-[28px] overflow-hidden shadow-[0_0_0_0.5px_rgba(255,255,255,0.07),0_40px_100px_rgba(0,0,0,0.85),0_0_60px_rgba(100,40,200,0.12),inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(255,255,255,0.04)] relative z-10 mx-5">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4.5 bg-white/3 border-b-[0.5px] border-white/10 shrink-0">
        <div className="w-10 h-10 rounded-full bg-white/[0.07] border-[0.5px] border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] flex items-center justify-center shrink-0">
          <StarIcon />
        </div>
        <div>
          <h1 className="text-[17px] font-semibold text-white tracking-[-0.2px]">
            Jarvis
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            Assistente de dados da SECOM
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as ModelId)}
            disabled={isTyping}
            className="appearance-none bg-white/6 border-[0.5px] border-white/[0.14] rounded-lg px-3 py-1.5 text-[12px] text-white/60 font-[inherit] tracking-[-0.1px] cursor-pointer outline-none transition-[border-color,background] duration-150 hover:bg-white/9 hover:text-white/80 focus:border-[rgba(80,160,255,0.4)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 10px center",
              paddingRight: "28px",
            }}
          >
            {(["groq", "google"] as const).map((provider) => (
              <optgroup
                key={provider}
                label={provider === "groq" ? "⚡ Groq" : "✦ Google"}
                style={{
                  background: "#0d0d1a",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {MODELS.filter((m) => m.provider === provider).map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    style={{
                      background: "#0d0d1a",
                      color: "rgba(255,255,255,0.8)",
                    }}
                  >
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div
            title="Online"
            className="w-2 h-2 bg-[#34c759] rounded-full shadow-[0_0_6px_rgba(52,199,89,0.55)] animate-pulse-green"
          />
        </div>
      </div>

      {/* Messages */}
      <div className="messages-scroll flex-1 overflow-y-auto px-6 py-7 flex flex-col gap-3.5 scroll-smooth">
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
