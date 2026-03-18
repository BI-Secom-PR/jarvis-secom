"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

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
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
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
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
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
      <div className="flex items-center gap-3">
        {user.role === "ADMIN" && (
          <a
            href="/admin"
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            Usuários
          </a>
        )}
        <button
          onClick={openModal}
          className="text-xs text-white/40 max-w-30 truncate hover:text-white/70 transition-colors cursor-pointer"
          title="Alterar senha"
        >
          {user.name}
        </button>
        <button
          onClick={handleLogout}
          className="text-xs text-white/25 hover:text-red-400/70 transition-colors cursor-pointer"
          title="Sair"
        >
          Sair
        </button>
      </div>

      {/* Change password modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm bg-[rgba(10,10,20,0.92)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-3xl p-7 shadow-[0_40px_100px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <h2 className="text-base font-semibold text-white mb-2 pl-4">
              Alterar senha
            </h2>
            <p className="text-xs text-white/35 mb-1.5 pt-1.5 pl-4">
              {user.name}
            </p>

            {success ? (
              <p className="text-green-400/80 text-sm text-center py-4">
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
                  className="bg-black/30 border-[0.5px] border-white/12 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Nova senha (mín. 8 caracteres)"
                  className="bg-black/30 border-[0.5px] border-white/12 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
                />
                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirmar nova senha"
                  className="bg-black/30 border-[0.5px] border-white/12 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
                />

                {error && (
                  <p className="text-red-400/80 text-xs px-1">{error}</p>
                )}

                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 bg-white/5 border-[0.5px] border-white/10 rounded-xl py-3 text-sm text-white/50 hover:text-white/70 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-[rgba(41,151,255,0.22)] border-[0.5px] border-[rgba(80,170,255,0.35)] rounded-xl py-3 text-sm text-white font-medium hover:bg-[rgba(41,151,255,0.36)] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
