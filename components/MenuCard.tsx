import Link from 'next/link'

interface MenuCardProps {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}

export default function MenuCard({ href, icon, title, description }: MenuCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 sm:gap-4 p-5 sm:p-7 rounded-2xl sm:rounded-[24px]
        bg-surface md:backdrop-blur-[60px] md:backdrop-saturate-180
        border-[0.5px] border-separator
        shadow-(--shadow-modal)
        hover:border-accent-border
        active:scale-[0.985]
        transition-all duration-300 msg-appear"
    >
      <div className="w-11 h-11 rounded-2xl bg-accent-soft border-[0.5px] border-accent-border flex items-center justify-center
        group-hover:bg-accent-soft transition-all duration-300">
        {icon}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-ink tracking-[-0.2px]">{title}</span>
        <span className="text-sm text-ink-3 leading-[1.6] tracking-[-0.05px]">{description}</span>
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-xs text-ink-4 group-hover:text-ink-2 transition-colors">
        <span>Acessar</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </Link>
  )
}
