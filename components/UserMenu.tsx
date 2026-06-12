"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { logout } from "@/lib/authClient";
import { postJson } from "@/lib/fetchUtils";
import ThemeToggle from "@/components/ThemeToggle";

export default function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
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
      <div className="flex items-center gap-2 md:gap-3">
        <ThemeToggle />
        {user.role === "ADMIN" && (
          <a
            href="/admin"
            className="text-xs text-ink-4 hover:text-ink-2 transition-colors hidden sm:block py-3 -my-3"
          >
            Usuários
          </a>
        )}
        <button
          onClick={openModal}
          className="text-xs text-ink-3 max-w-20 md:max-w-30 truncate hover:text-ink-2 transition-colors cursor-pointer py-3 -my-3"
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

      {/* Change password modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
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
