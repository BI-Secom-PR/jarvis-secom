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
      stroke="#78b4ff"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="4.5" r="2.5" stroke="white" strokeWidth="1.4" opacity="0.5" />
    <path
      d="M2 13C2 10.2 4.2 8 7 8C9.8 8 12 10.2 12 13"
      stroke="white"
      strokeWidth="1.4"
      strokeLinecap="round"
      opacity="0.5"
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
      className={`flex gap-2.5 items-end ${isAi ? 'max-w-[96%]' : 'max-w-[82%]'} msg-appear ${
        isAi ? 'self-start' : 'self-end flex-row-reverse'
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isAi
            ? 'bg-white/[0.07] border-[0.5px] border-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
            : 'bg-white/[0.06] border-[0.5px] border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]'
        }`}
      >
        {isAi ? <StarIcon /> : <UserIcon />}
      </div>

      {/* Bubble */}
      <div
        className={`px-[15px] py-[11px] rounded-[18px] text-sm leading-[1.65] tracking-[-0.1px] break-words max-w-full bubble-content ${
          isAi
            ? 'bg-white/[0.06] border-[0.5px] border-white/[0.12] text-white/[0.88] rounded-bl-[5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]'
            : 'bg-[rgba(41,151,255,0.28)] border-[0.5px] border-[rgba(80,170,255,0.45)] text-white rounded-br-[5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_16px_rgba(41,151,255,0.18)]'
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
