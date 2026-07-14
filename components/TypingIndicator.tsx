export default function TypingIndicator() {
  return (
    <div className="flex flex-col self-start msg-appear">
      <span
        className="font-hud text-[8px] uppercase tracking-[0.28em] mb-1.5 pl-1"
        style={{ color: "var(--hud-cyan)", textShadow: "0 0 10px var(--hud-cyan)" }}
      >
        ◇ Jarvis
      </span>
      <div className="flex items-center gap-[6px] hud-panel rounded-[12px] px-[18px] py-3.5">
        <span className="typing-dot" />
        <span className="typing-dot [animation-delay:0.18s]" />
        <span className="typing-dot [animation-delay:0.36s]" />
      </div>
    </div>
  );
}
