"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { logout } from "@/lib/authClient";
import { postJson } from "@/lib/fetchUtils";
import ThemeToggle from "@/components/ThemeToggle";

export default function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    await logout(router);
  }

  function openModal() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
    setSuccess(false);
    setOpen(true);
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (next !== confirm) {
      setError("As novas senhas não coincidem.");
      return;
    }

    setLoading(true);
    const res = await postJson("/api/auth/change-password", { currentPassword: current, newPassword: next });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao alterar senha.");
      return;
    }

    setSuccess(true);
    setTimeout(() => setOpen(false), 1500);
  }

  return (
    <>
      {/* Desktop layout — unchanged */}
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
        <button
          onClick={openModal}
          className="text-xs text-ink-3 max-w-30 truncate hover:text-ink-2 transition-colors cursor-pointer py-3 -my-3"
          title="Alterar senha"
        >
          {user.name}
        </button>
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
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>
            )}

            <button
              onClick={() => { setMenuOpen(false); openModal(); }}
              className="w-full flex items-center justify-between py-3.5 px-1 text-sm text-ink-2 hover:text-ink transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[70%] text-left">{user.name}</span>
              <span className="text-xs text-ink-4 shrink-0">Alterar senha</span>
            </button>

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

      {/* Change password modal */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-full sm:max-w-sm bg-surface-opaque sm:bg-surface sm:backdrop-blur-[60px] border-[0.5px] border-separator rounded-t-3xl rounded-b-none sm:rounded-3xl p-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:p-7 shadow-(--shadow-modal)">
            <h2 className="text-base font-semibold text-ink mb-2 pl-4">
              Alterar senha
            </h2>
            <p className="text-xs text-ink-3 mb-1.5 pt-1.5 pl-4">
              {user.name}
            </p>

            {success ? (
              <p className="text-success text-sm text-center py-4">
                Senha alterada com sucesso!
              </p>
            ) : (
              <form
                onSubmit={handleChangePassword}
                className="flex flex-col gap-3 p-1.5"
              >
                <input
                  type="password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Senha atual"
                  className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Nova senha (mín. 8 caracteres)"
                  className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
                />
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirmar nova senha"
                  className="bg-surface-input border-[0.5px] border-separator rounded-xl px-4 py-3 text-[16px] sm:text-sm text-ink placeholder:text-ink-4 outline-none focus:border-accent-border transition-colors"
                />

                {error && (
                  <p className="text-danger text-xs px-1">{error}</p>
                )}

                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 bg-fill border-[0.5px] border-separator rounded-xl py-3 text-sm text-ink-2 hover:text-ink transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-accent text-accent-ink rounded-xl py-3 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {loading ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
