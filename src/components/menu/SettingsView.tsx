import { useState } from 'react'
import { LOCALES, type Locale } from '../../i18n'
import type { AppSettings, DistanceUnits, MapStyleSetting } from '../../lib/appSettings'

type SettingsViewProps = {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onClearPins: () => void
  pinCount: number
  dark?: boolean
  wakeLockSupported: boolean
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  dark,
}: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean; badge?: string }[]
  onChange: (v: T) => void
  dark?: boolean
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-bold" id={`${label}-label`}>
        {label}
      </p>
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-labelledby={`${label}-label`}
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              className={`tap-scale min-h-11 rounded-xl px-3 py-2 text-[13px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'bg-[#007AFF] text-white'
                  : dark
                    ? 'bg-white/10 text-[#EBEBF5] ring-1 ring-white/10'
                    : 'bg-white text-[#1C1C1E] ring-1 ring-black/10'
              }`}
            >
              {opt.label}
              {opt.badge ? (
                <span className="ml-1 text-[11px] font-semibold opacity-80">
                  ({opt.badge})
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  dark,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  dark?: boolean
}) {
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-bold">{label}</p>
        {description ? (
          <p className={`mt-0.5 text-xs leading-snug ${muted}`}>{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] disabled:opacity-50 ${
          checked ? 'bg-[#34C759]' : dark ? 'bg-white/20' : 'bg-black/15'
        }`}
      >
        <span
          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
          aria-hidden
        />
      </button>
    </div>
  )
}

const LANG_LABELS: Record<Locale, string> = {
  et: 'Eesti',
  en: 'English',
  ru: 'Русский',
}

export function SettingsView({
  settings,
  onChange,
  onClearPins,
  pinCount,
  dark = false,
  wakeLockSupported,
}: SettingsViewProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  const card = dark ? 'bg-white/8' : 'bg-black/[0.04]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'

  return (
    <div className="space-y-5" data-testid="settings-view">
      <section className={`space-y-3 rounded-2xl p-3 ${card}`}>
        <Segmented<Locale>
          label="Keel"
          value={settings.language}
          dark={dark}
          onChange={(language) => onChange({ language })}
          options={LOCALES.map((code) => ({
            value: code,
            label: LANG_LABELS[code],
          }))}
        />
      </section>

      <section className={`space-y-3 rounded-2xl p-3 ${card}`}>
        <Segmented<MapStyleSetting>
          label="Kaardi stiil"
          value={settings.mapStyle}
          dark={dark}
          onChange={(mapStyle) => onChange({ mapStyle })}
          options={[
            { value: 'light', label: 'Hele' },
            { value: 'dark', label: 'Tume' },
            { value: 'auto', label: 'Automaatne' },
          ]}
        />
      </section>

      <section className={`space-y-3 rounded-2xl p-3 ${card}`}>
        <Segmented<DistanceUnits>
          label="Ühikud"
          value={settings.units}
          dark={dark}
          onChange={(units) => onChange({ units })}
          options={[
            { value: 'metric', label: 'm / km' },
            { value: 'imperial', label: 'mi' },
          ]}
        />
      </section>

      <section className={`space-y-4 rounded-2xl p-3 ${card}`}>
        <ToggleRow
          label="Hoia ekraan ärkvel navigeerimisel"
          description={
            wakeLockSupported
              ? 'Kasutab Wake Lock API-t, kui marsruut on aktiivne.'
              : 'Selles brauseris pole Wake Lock toetatud.'
          }
          checked={settings.keepAwakeOnNav}
          onChange={(keepAwakeOnNav) => onChange({ keepAwakeOnNav })}
          disabled={!wakeLockSupported}
          dark={dark}
        />
        <ToggleRow
          label="Animatsioonid"
          description="Pulsatsioon, kaardi liikumine ja üleminekud."
          checked={settings.animations}
          onChange={(animations) => onChange({ animations })}
          dark={dark}
        />
      </section>

      <section className={`space-y-3 rounded-2xl p-3 ${card}`}>
        <div>
          <p className="text-sm font-bold">Isiklikud pinnid</p>
          <p className={`mt-0.5 text-xs ${muted}`}>
            Hetkel {pinCount} {pinCount === 1 ? 'pinn' : 'pinni'}.
          </p>
        </div>
        {!confirmClear ? (
          <button
            type="button"
            disabled={pinCount === 0}
            onClick={() => setConfirmClear(true)}
            className="tap-scale min-h-11 w-full rounded-xl bg-[#FF3B30] px-3 text-sm font-bold text-white disabled:opacity-40"
          >
            Kustuta kõik pinnid
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#FF3B30]">
              Kas oled kindel? Seda ei saa tagasi võtta.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onClearPins()
                  setConfirmClear(false)
                }}
                className="tap-scale min-h-11 flex-1 rounded-xl bg-[#FF3B30] px-3 text-sm font-bold text-white"
              >
                Jah, kustuta
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className={`tap-scale min-h-11 flex-1 rounded-xl px-3 text-sm font-bold ${
                  dark ? 'bg-white/10' : 'bg-white ring-1 ring-black/10'
                }`}
              >
                Tühista
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
