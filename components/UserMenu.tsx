"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { logout } from "@/lib/authClient";
import ThemeToggle from "@/components/ThemeToggle";

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout(router);
  }

  return (
    <>
      {/* Desktop layout */}
      <div className="hidden md:flex items-center gap-3">
        <ThemeToggle />
        {user.role === "ADMIN" && (
          <a
            href="/admin"
            className="text-xs text-ink-4 hover:text-ink-2 transition-colors py-3 -my-3"
          >
            Usuários
          </a>
        )}
        <a
          href="/perfil"
          className="text-xs text-ink-3 max-w-30 truncate hover:text-ink-2 transition-colors py-3 -my-3"
          title="Perfil — senha e chaves de acesso"
        >
          {user.name}
        </a>
        <button
          onClick={handleLogout}
          className="text-xs text-ink-4 hover:text-danger transition-colors cursor-pointer py-3 -my-3"
          title="Sair"
        >
          Sair
        </button>
      </div>

      {/* Mobile — hamburger button */}
      <button
        onClick={() => setMenuOpen(true)}
        aria-label="Abrir menu"
        className="md:hidden w-11 h-11 flex items-center justify-center rounded-xl text-ink-3 hover:text-ink-2 hover:bg-fill-2 transition-all duration-150 -mr-1"
      >
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Mobile bottom-sheet drawer — always in DOM for smooth transition */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-200 ${menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />

        {/* Panel */}
        <div
          className={`absolute bottom-0 left-0 right-0 bg-surface-opaque border-t border-separator rounded-t-3xl transition-transform duration-300 ease-out ${menuOpen ? "translate-y-0" : "translate-y-full"}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-1 rounded-full bg-separator" />
          </div>

          <div className="px-5 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-1">
            {/* Theme */}
            <div className="flex items-center justify-between py-3 px-1">
              <span className="text-sm text-ink-2">Tema</span>
              <ThemeToggle />
            </div>

            {user.role === "ADMIN" && (
              <a
                href="/admin"
                className="flex items-center justify-between py-3.5 px-1 text-sm text-ink-2 hover:text-ink transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>Usuários</span>
                <ChevronIcon />
              </a>
            )}

            <a
              href="/perfil"
              className="flex items-center justify-between gap-3 py-3.5 px-1 text-sm text-ink-2 hover:text-ink transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span>Perfil</span>
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-ink-4 truncate">{user.name}</span>
                <ChevronIcon />
              </span>
            </a>

            <div className="h-px bg-separator mx-1" />

            <button
              onClick={() => { setMenuOpen(false); handleLogout(); }}
              className="w-full flex items-center py-3.5 px-1 text-sm text-danger hover:opacity-80 transition-opacity cursor-pointer"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
