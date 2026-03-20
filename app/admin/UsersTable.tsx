'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@/lib/db/schema'
import { logout } from '@/lib/authClient'
import { patchJson } from '@/lib/fetchUtils'

type UserRow = Pick<User, 'id' | 'email' | 'name' | 'role' | 'enabled' | 'createdAt'>

type EditState = {
  name:  string
  email: string
  role:  'ADMIN' | 'USER'
}

export default function UsersTable({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserRow[]
  currentUserId: string
}) {
  const router = useRouter()
  const [users, setUsers]       = useState(initialUsers)
  const [toggling, setToggling] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving]     = useState(false)
  const [editError, setEditError] = useState('')

  async function toggleEnabled(id: string, enable: boolean) {
    setToggling(id)
    const res = await patchJson(`/api/admin/users/${id}`, { enabled: enable })
    if (res.ok) {
      const updated = await res.json()
      setUsers(prev => prev.map(u => u.id === id ? { ...u, enabled: updated.enabled } : u))
    }
    setToggling(null)
  }

  function startEdit(user: UserRow) {
    setEditingId(user.id)
    setEditState({ name: user.name, email: user.email, role: user.role })
    setEditError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditState(null)
    setEditError('')
  }

  async function saveEdit(id: string) {
    if (!editState) return
    setSaving(true)
    setEditError('')

    const res = await patchJson(`/api/admin/users/${id}`, editState)
    const data = await res.json()

    if (!res.ok) {
      setEditError(data.error ?? 'Erro ao salvar.')
      setSaving(false)
      return
    }

    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...data } : u))
    setEditingId(null)
    setEditState(null)
    setSaving(false)
  }

  async function handleLogout() {
    await logout(router)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-white/40">{users.length} usuário(s)</p>
        <div className="flex gap-4">
          <a href="/" className="text-sm text-white/50 hover:text-white/80 transition-colors">
            ← Voltar ao chat
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-red-400/70 hover:text-red-400 transition-colors cursor-pointer"
          >
            Sair
          </button>
        </div>
      </div>

      <div className="bg-[rgba(10,10,20,0.82)] backdrop-blur-[60px] border-[0.5px] border-white/[0.14] rounded-[24px] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="text-left text-xs text-white/40 font-medium px-6 py-4">Nome</th>
              <th className="text-left text-xs text-white/40 font-medium px-6 py-4">E-mail</th>
              <th className="text-left text-xs text-white/40 font-medium px-6 py-4">Perfil</th>
              <th className="text-center text-xs text-white/40 font-medium px-6 py-4">Acesso</th>
              <th className="text-right text-xs text-white/40 font-medium px-6 py-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <Fragment key={user.id}>
                {/* Main row */}
                <tr
                  className={`border-b border-white/[0.05] last:border-0 transition-colors ${editingId === user.id ? 'bg-white/[0.03]' : ''}`}
                >
                  <td className="px-6 py-4 text-sm text-white/80">{user.name}</td>
                  <td className="px-6 py-4 text-sm text-white/50">{user.email}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full border-[0.5px] ${
                      user.role === 'ADMIN'
                        ? 'bg-[rgba(160,80,255,0.15)] border-[rgba(160,80,255,0.3)] text-purple-300/80'
                        : 'bg-white/[0.05] border-white/[0.1] text-white/40'
                    }`}>
                      {user.role === 'ADMIN' ? 'Admin' : 'Usuário'}
                    </span>
                  </td>

                  {/* Toggle switch */}
                  <td className="px-6 py-4 text-center">
                    {user.id === currentUserId ? (
                      <span className="text-xs text-white/20">—</span>
                    ) : (
                      <button
                        disabled={toggling === user.id}
                        onClick={() => toggleEnabled(user.id, !user.enabled)}
                        title={user.enabled ? 'Desativar acesso' : 'Aprovar acesso'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full border-[0.5px] transition-colors duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          user.enabled
                            ? 'bg-[rgba(0,200,100,0.25)] border-[rgba(0,200,100,0.4)]'
                            : 'bg-white/[0.08] border-white/[0.15]'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full shadow transition-transform duration-200 ${
                          user.enabled
                            ? 'translate-x-6 bg-green-400'
                            : 'translate-x-1 bg-white/30'
                        }`} />
                      </button>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    {user.id === currentUserId ? (
                      <span className="text-xs text-white/20">—</span>
                    ) : editingId === user.id ? (
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                    ) : (
                      <button
                        onClick={() => startEdit(user)}
                        className="text-xs text-[rgba(120,180,255,0.7)] hover:text-[rgba(120,180,255,1)] transition-colors cursor-pointer"
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>

                {/* Inline edit row */}
                {editingId === user.id && editState && (
                  <tr className="border-b border-white/[0.05] last:border-0 bg-white/[0.02]">
                    <td colSpan={5} className="px-6 py-5">
                      <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/40">Nome</label>
                            <input
                              type="text"
                              value={editState.name}
                              onChange={e => setEditState(s => s ? { ...s, name: e.target.value } : s)}
                              className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/40">E-mail</label>
                            <input
                              type="email"
                              value={editState.email}
                              onChange={e => setEditState(s => s ? { ...s, email: e.target.value } : s)}
                              className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-white/40">Perfil</label>
                            <select
                              value={editState.role}
                              onChange={e => setEditState(s => s ? { ...s, role: e.target.value as 'ADMIN' | 'USER' } : s)}
                              className="bg-black/30 border-[0.5px] border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white/90 outline-none focus:border-[rgba(80,160,255,0.5)] transition-colors cursor-pointer"
                            >
                              <option value="USER" style={{ background: '#0d0d1a' }}>Usuário</option>
                              <option value="ADMIN" style={{ background: '#0d0d1a' }}>Admin</option>
                            </select>
                          </div>
                        </div>

                        {editError && (
                          <p className="text-red-400/80 text-xs">{editError}</p>
                        )}

                        <div className="flex gap-2">
                          <button
                            disabled={saving}
                            onClick={() => saveEdit(user.id)}
                            className="text-xs px-4 py-2 bg-[rgba(41,151,255,0.22)] border-[0.5px] border-[rgba(80,170,255,0.35)] rounded-lg text-white/80 hover:bg-[rgba(41,151,255,0.36)] transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {saving ? 'Salvando...' : 'Salvar'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs px-4 py-2 border-[0.5px] border-white/[0.1] rounded-lg text-white/40 hover:text-white/60 hover:border-white/20 transition-colors cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
