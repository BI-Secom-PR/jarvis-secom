'use client';

import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export interface InputAreaHandle {
  focus: () => void;
}

const InputArea = forwardRef<InputAreaHandle, Props>(function InputArea({ onSend, disabled }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || disabled) return;
    el.value = '';
    autoResize();
    onSend(text);
  }, [disabled, onSend, autoResize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-5 pt-3.5 pb-[18px] bg-black/[0.12] border-t-[0.5px] border-white/[0.08] flex-shrink-0">
      {/* Input row — visionOS inset bezel */}
      <div className="flex gap-2 items-end bg-black/[0.35] border-[0.5px] border-white/[0.12] rounded-2xl px-4 py-2.5 pr-2.5 transition-[border-color,box-shadow] duration-200 shadow-[inset_0_2px_8px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)] focus-within:border-[rgba(80,160,255,0.5)] focus-within:shadow-[inset_0_2px_8px_rgba(0,0,0,0.4),0_0_0_2.5px_rgba(41,151,255,0.18)]">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Pergunte sobre campanhas, regiões, audiência..."
          onKeyDown={handleKeyDown}
          onInput={autoResize}
          className="flex-1 bg-transparent border-none outline-none text-white/[0.92] text-[15px] font-[inherit] resize-none min-h-[22px] max-h-[120px] leading-[1.5] tracking-[-0.1px] py-0.5 placeholder:text-white/20"
          style={{ height: 22 }}
        />
        <button
          onClick={handleSend}
          disabled={disabled}
          title="Enviar"
          className="w-9 h-9 rounded-full border-[0.5px] border-[rgba(80,170,255,0.45)] bg-[rgba(41,151,255,0.32)] text-white flex items-center justify-center flex-shrink-0 cursor-pointer transition-[background,border-color] duration-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_10px_rgba(0,0,0,0.25)] hover:bg-[rgba(41,151,255,0.46)] hover:border-[rgba(80,170,255,0.6)] active:opacity-75 disabled:bg-white/[0.06] disabled:border-white/10 disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[15px] h-[15px]"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p className="text-[11px] text-white/[0.18] text-center mt-2.5 tracking-[0.1px]">
        Enter para enviar &nbsp;·&nbsp; Shift+Enter para nova linha &nbsp;·&nbsp; ⌘N nova sessão
      </p>
    </div>
  );
});

export default InputArea;
