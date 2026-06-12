'use client';

import DOMPurify from 'dompurify';
import { Message } from '@/types/chat';
import { renderMarkdown } from '@/lib/markdown';
import dynamic from 'next/dynamic';

const ChartWidget = dynamic(() => import('./ChartWidget'), { ssr: false });

const StarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7.5 1L8.6 6.1L13.5 7.5L8.6 8.9L7.5 14L6.4 8.9L1.5 7.5L6.4 6.1L7.5 1Z"
      stroke="var(--accent-text)"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="4.5" r="2.5" stroke="var(--ink-2)" strokeWidth="1.4" />
    <path
      d="M2 13C2 10.2 4.2 8 7 8C9.8 8 12 10.2 12 13"
      stroke="var(--ink-2)"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

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

  return (
    <div
      className={`flex gap-2.5 items-end ${
        isAi ? 'max-w-[92%] md:max-w-[96%]' : 'max-w-[85%] md:max-w-[82%]'
      } msg-appear ${isAi ? 'self-start' : 'self-end flex-row-reverse'}`}
    >
      {/* Avatar — hidden on phones to free bubble width, iMessage-style */}
      <div
        className={`w-8 h-8 rounded-full hidden md:flex items-center justify-center flex-shrink-0 bg-fill border-[0.5px] shadow-(--shadow-bubble) ${
          isAi ? 'border-separator-strong' : 'border-separator'
        }`}
      >
        {isAi ? <StarIcon /> : <UserIcon />}
      </div>

      {/* Bubble */}
      <div
        className={`px-[15px] py-[11px] rounded-[18px] text-sm leading-[1.65] tracking-[-0.1px] break-words max-w-full bubble-content ${
          isAi
            ? 'bg-fill border-[0.5px] border-separator text-ink rounded-bl-[5px] shadow-(--shadow-bubble)'
            : 'bg-(--bubble-user) border-[0.5px] border-(--bubble-user-border) text-white rounded-br-[5px] shadow-(--shadow-bubble-user) whitespace-pre-wrap'
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
