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
      className="group flex flex-col gap-4 p-7 rounded-[24px]
        bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] backdrop-saturate-180
        border-[0.5px] border-white/[0.14]
        shadow-[0_0_0_0.5px_rgba(255,255,255,0.07),0_24px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.1)]
        hover:bg-[rgba(15,15,30,0.88)]
        hover:border-[rgba(80,170,255,0.28)]
        hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.09),0_24px_60px_rgba(0,0,0,0.7),0_0_40px_rgba(41,151,255,0.08),inset_0_1px_0_rgba(255,255,255,0.13)]
        transition-all duration-300 msg-appear"
    >
      <div className="w-11 h-11 rounded-2xl bg-[rgba(41,151,255,0.12)] border-[0.5px] border-[rgba(80,170,255,0.22)] flex items-center justify-center
        group-hover:bg-[rgba(41,151,255,0.22)] group-hover:border-[rgba(80,170,255,0.38)] transition-all duration-300">
        {icon}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-white tracking-[-0.2px]">{title}</span>
        <span className="text-sm text-white/40 leading-[1.6] tracking-[-0.05px]">{description}</span>
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-xs text-white/20 group-hover:text-white/40 transition-colors">
        <span>Acessar</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </Link>
  )
}
