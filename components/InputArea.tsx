'use client';

import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  onVoiceClick?: () => void;
}

export interface InputAreaHandle {
  focus: () => void;
}

const InputArea = forwardRef<InputAreaHandle, Props>(function InputArea({ onSend, disabled, onVoiceClick }, ref) {
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
    <div className="px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-5 md:pt-3.5 md:pb-[18px] bg-fill border-t-[0.5px] border-separator flex-shrink-0">
      {/* Input row — visionOS inset bezel */}
      <div className="flex gap-1.5 md:gap-2 items-end bg-surface-input border-[0.5px] border-separator rounded-3xl md:rounded-2xl px-4 py-1.5 pr-1.5 md:py-2.5 md:pr-2.5 transition-[border-color,box-shadow] duration-200 shadow-(--shadow-bezel) focus-within:border-accent-border focus-within:shadow-(--shadow-bezel-focus)">
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Pergunte sobre campanhas, regiões, audiência..."
          onKeyDown={handleKeyDown}
          onInput={autoResize}
          className="flex-1 bg-transparent border-none outline-none text-ink text-[16px] md:text-[15px] font-[inherit] resize-none min-h-[22px] max-h-[120px] leading-[1.5] tracking-[-0.1px] py-0.5 self-center placeholder:text-ink-4"
          style={{ height: 22 }}
        />
        <button
          onClick={onVoiceClick}
          title="Modo de voz"
          type="button"
          className="w-11 h-11 md:w-9 md:h-9 rounded-full flex items-center justify-center flex-shrink-0 text-ink-3 hover:text-ink-2 hover:bg-fill active:scale-95 transition-all duration-150"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] md:w-[17px] md:h-[17px]">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="9" y1="22" x2="15" y2="22" />
          </svg>
        </button>
        <button
          onClick={handleSend}
          disabled={disabled}
          title="Enviar"
          className="w-11 h-11 md:w-9 md:h-9 rounded-full bg-accent text-accent-ink flex items-center justify-center flex-shrink-0 cursor-pointer transition-[background,opacity] duration-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_10px_rgba(0,0,0,0.18)] hover:opacity-90 active:opacity-75 disabled:bg-fill-2 disabled:text-ink-4 disabled:shadow-none disabled:cursor-not-allowed"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[15px] h-[15px]"
            style={{ transform: 'translate(-1px, 1px)' }}
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p className="hidden md:block text-[11px] text-ink-4 text-center mt-2.5 tracking-[0.1px]">
        Enter para enviar &nbsp;·&nbsp; Shift+Enter para nova linha &nbsp;·&nbsp; ⌘N nova sessão
      </p>
    </div>
  );
});

export default InputArea;
