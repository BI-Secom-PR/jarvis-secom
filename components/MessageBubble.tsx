'use client';

import DOMPurify from 'dompurify';
import { Message } from '@/types/chat';
import { renderMarkdown } from '@/lib/markdown';
import dynamic from 'next/dynamic';

const ChartWidget = dynamic(() => import('./ChartWidget'), { ssr: false });

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isAi = message.role === 'ai';

  const safeHtml = isAi
    ? DOMPurify.sanitize(renderMarkdown(message.text), {
        ADD_ATTR: ['target'],
      })
    : null;

  const accent = isAi ? 'var(--hud-cyan)' : 'var(--hud-gold)';

  return (
    <div
      className={`flex flex-col ${
        isAi ? 'max-w-[94%] md:max-w-[88%] self-start' : 'max-w-[88%] md:max-w-[78%] self-end'
      } msg-appear`}
    >
      {/* Role tag */}
      <span
        className={`font-hud text-[8px] uppercase tracking-[0.28em] mb-1.5 ${isAi ? 'pl-1' : 'self-end pr-1'}`}
        style={{ color: accent, textShadow: `0 0 10px ${accent}` }}
      >
        {isAi ? '◇ Jarvis' : 'Você ◆'}
      </span>

      {/* Bubble — HUD panel */}
      <div
        className={`relative px-[16px] py-[12px] rounded-[12px] text-sm leading-[1.65] tracking-[-0.1px] break-words max-w-full bubble-content hud-panel ${
          isAi ? 'text-ink' : 'hud-panel-gold text-(--bubble-user-ink) whitespace-pre-wrap'
        }`}
      >
        {isAi ? (
          <>
            <div dangerouslySetInnerHTML={{ __html: safeHtml! }} />
            {message.chartData && <ChartWidget chart={message.chartData} />}
          </>
        ) : (
          message.text
        )}
      </div>
    </div>
  );
}
