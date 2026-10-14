import { useState } from 'react'
import {
  loadLocalProfile,
  profileInitials,
  saveLocalProfile,
  type LocalProfile,
} from '../../lib/localProfile'

type ProfileViewProps = {
  pinCount: number
  hasActiveSession: boolean
  activeSessionLabel?: string | null
  dark?: boolean
}

export function ProfileView({
  pinCount,
  hasActiveSession,
  activeSessionLabel,
  dark = false,
}: ProfileViewProps) {
  const [profile, setProfile] = useState<LocalProfile>(() => loadLocalProfile())
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(profile.displayName)
  const [savedFlash, setSavedFlash] = useState(false)

  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const card = dark ? 'bg-white/8' : 'bg-black/[0.04]'
  const input = dark
    ? 'border-white/15 bg-[#2C2C2E] text-[#F5F5F7]'
    : 'border-black/10 bg-white text-[#1C1C1E]'

  const saveName = () => {
    const next = {
      ...profile,
      displayName: draftName.trim().slice(0, 40) || 'Kasutaja',
    }
    saveLocalProfile(next)
    setProfile(next)
    setEditing(false)
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1600)
  }

  const initials = profileInitials(profile.displayName)

  return (
    <div className="space-y-4" data-testid="profile-view">
      <div className="flex items-center gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-lg font-bold text-white"
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{profile.displayName}</p>
          {profile.email ? (
            <p className={`truncate text-sm ${muted}`}>{profile.email}</p>
          ) : (
            <p className={`text-sm ${muted}`}>Kohalik profiil (ilma sisselogimiseta)</p>
          )}
        </div>
      </div>

      <div className={`rounded-2xl p-3 ${card}`}>
        <h3 className="mb-2 text-sm font-bold">Kokkuvõte</h3>
        <ul className={`space-y-1.5 text-sm ${muted}`}>
          <li>
            Isiklikud pinnid:{' '}
            <span className={dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'}>
              {pinCount}
            </span>
          </li>
          <li>
            Parkimissessioon:{' '}
            <span className={dark ? 'text-[#F5F5F7]' : 'text-[#1C1C1E]'}>
              {hasActiveSession
                ? activeSessionLabel
                  ? `Aktiivne · ${activeSessionLabel}`
                  : 'Aktiivne'
                : 'Puudub'}
            </span>
          </li>
        </ul>
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor="profile-display-name">
            Kuvatav nimi
          </label>
          <input
            id="profile-display-name"
            type="text"
            maxLength={40}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2.5 text-base outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${input}`}
            autoComplete="nickname"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveName}
              className="tap-scale min-h-11 flex-1 rounded-xl bg-[#007AFF] px-3 text-sm font-bold text-white"
            >
              Salvesta
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftName(profile.displayName)
                setEditing(false)
              }}
              className={`tap-scale min-h-11 flex-1 rounded-xl px-3 text-sm font-bold ${card}`}
            >
              Tühista
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraftName(profile.displayName)
            setEditing(true)
          }}
          className="tap-scale flex min-h-11 w-full items-center justify-center rounded-xl bg-[#007AFF] px-3 text-sm font-bold text-white"
        >
          Muuda nime
        </button>
      )}

      {savedFlash ? (
        <p className="text-center text-sm font-medium text-[#34C759]" role="status">
          Nimi salvestatud
        </p>
      ) : null}

      <p className={`text-xs leading-relaxed ${muted}`}>
        Kontot ega sisselogimist pole — nimi ja andmed jäävad sellesse seadmesse.
      </p>
    </div>
  )
}

/** Small header chip used in the menu root. */
export function ProfileHeaderChip({
  onClick,
  dark = false,
}: {
  onClick: () => void
  dark?: boolean
}) {
  const profile = loadLocalProfile()
  const initials = profileInitials(profile.displayName)
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap-scale flex w-full min-h-11 items-center gap-3 rounded-2xl px-2 py-2 text-left transition ${
        dark ? 'hover:bg-white/8' : 'hover:bg-black/5'
      }`}
      aria-label="Ava profiil"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-sm font-bold text-white"
        aria-hidden
      >
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{profile.displayName}</span>
        <span className={`block text-xs ${muted}`}>Profiil</span>
      </span>
    </button>
  )
}
