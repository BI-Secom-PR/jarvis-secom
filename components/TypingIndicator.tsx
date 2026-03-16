const StarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7.5 1L8.6 6.1L13.5 7.5L8.6 8.9L7.5 14L6.4 8.9L1.5 7.5L6.4 6.1L7.5 1Z"
      stroke="#78b4ff"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-2.5 self-start">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white/[0.07] border-[0.5px] border-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
        <StarIcon />
      </div>
      {/* Dots */}
      <div className="flex items-center gap-[5px] bg-white/[0.06] border-[0.5px] border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] rounded-[18px] rounded-bl-[5px] px-[18px] py-3.5">
        <span className="typing-dot" />
        <span className="typing-dot [animation-delay:0.18s]" />
        <span className="typing-dot [animation-delay:0.36s]" />
      </div>
    </div>
  );
}
