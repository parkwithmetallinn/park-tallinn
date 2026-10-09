import { Lock, MapPin, Navigation, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  formatCoords,
  reverseGeocode,
  type ReverseGeocodeResult,
} from '../lib/geocode'
import {
  MY_PIN_COLOR_KEYS,
  MY_PIN_COLORS,
  type MyPin,
  type MyPinColor,
} from '../lib/myPins'
import { useSheetClose } from './AnimatedBottomSheet'

export type MyPinDraft = {
  lat: number
  lng: number
}

export type MyPinSheetSavePayload = {
  name: string
  note: string
  color: MyPinColor
  lat: number
  lng: number
  address?: string
}

export function MyPinSheet({
  mode,
  draft,
  pin,
  dark,
  onClose,
  onSave,
  onDelete,
  onNavigate,
  onColorPreview,
  onDragRequest,
}: {
  mode: 'create' | 'edit'
  draft?: MyPinDraft | null
  pin?: MyPin | null
  dark?: boolean
  onClose: () => void
  onSave: (payload: MyPinSheetSavePayload) => void
  onDelete?: () => void
  onNavigate?: () => void
  /** Live color preview while editing (updates draft/map pin). */
  onColorPreview?: (color: MyPinColor) => void
  /** When true, parent enables marker dragging (edit mode). */
  onDragRequest?: (enabled: boolean) => void
}) {
  const lat = pin?.lat ?? draft?.lat ?? 0
  const lng = pin?.lng ?? draft?.lng ?? 0
  const [name, setName] = useState(pin?.name ?? '')
  const [note, setNote] = useState(pin?.note ?? '')
  const [color, setColor] = useState<MyPinColor>(pin?.color ?? 'red')
  const [address, setAddress] = useState<string | undefined>(pin?.address)
  const [suggestedName, setSuggestedName] = useState('')
  const [addrLoading, setAddrLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const noteId = useId()
  const geocodeAbort = useRef<AbortController | null>(null)

  const stableClose = () => onClose()
  const { requestClose, sheetClassName } = useSheetClose(stableClose)

  useEffect(() => {
    onDragRequest?.(mode === 'edit')
    return () => onDragRequest?.(false)
  }, [mode, onDragRequest])

  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [])

  // Reverse geocode for create, or when edit pin moved (address cleared)
  useEffect(() => {
    if (mode === 'edit' && pin?.address) {
      setAddress(pin.address)
      return
    }
    geocodeAbort.current?.abort()
    const ac = new AbortController()
    geocodeAbort.current = ac
    setAddrLoading(true)
    void reverseGeocode(lat, lng, ac.signal).then((r: ReverseGeocodeResult | null) => {
      if (ac.signal.aborted) return
      setAddrLoading(false)
      if (!r) {
        setAddress(undefined)
        return
      }
      setAddress(r.address)
      setSuggestedName(r.suggestedName)
    })
    return () => ac.abort()
  }, [lat, lng, mode, pin?.address, pin?.updatedAt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  const pickColor = (c: MyPinColor) => {
    setColor(c)
    onColorPreview?.(c)
  }

  const handleSave = () => {
    if (saving) return
    setSaving(true)
    const trimmed = name.trim()
    const finalName = trimmed || suggestedName.trim() || 'Minu pin'
    onSave({
      name: finalName.slice(0, 60),
      note: note.trim().slice(0, 280),
      color,
      lat,
      lng,
      address,
    })
  }

  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/95 text-[#F5F5F7] shadow-[0_8px_28px_rgba(0,0,0,0.4)] md:bg-[#1C1C1E]/78'
    : 'border-black/8 bg-white/95 text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.12)] md:border-white/55 md:bg-white/72'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const soft = dark ? 'text-[#EBEBF5]/80' : 'text-[#636366]'
  const chip = dark ? 'bg-white/10' : 'bg-[#F2F2F7]'
  const inputCls = dark
    ? 'border-white/10 bg-white/8 text-[#F5F5F7] placeholder:text-[#98989D]'
    : 'border-black/8 bg-white/90 text-[#1C1C1E] placeholder:text-[#8E8E93]'

  const title = mode === 'create' ? 'Uus pin' : pin?.name || 'Minu pin'
  const fill = MY_PIN_COLORS[color]
  const addrLine = addrLoading
    ? 'Otsin aadressi…'
    : address || formatCoords(lat, lng)

  return (
    <div
      className={`${sheetClassName} pointer-events-none absolute z-30 left-3 right-3 bottom-[max(1rem,env(safe-area-inset-bottom))] max-h-[min(45dvh,50vh)] sm:top-[10rem] sm:right-auto sm:bottom-auto sm:left-4 sm:w-[22rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:max-h-[min(80vh,calc(100dvh-11rem))]`}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-testid="my-pin-sheet"
    >
      <div
        className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border ${panel} md:backdrop-blur-md`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 pb-4">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${fill}22` }}
                aria-hidden
              >
                <MapPin className="h-5 w-5" style={{ color: fill }} strokeWidth={2.4} />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-[15px] leading-snug font-bold tracking-tight">
                  {title}
                </h3>
                <p className={`mt-0.5 text-[11px] leading-snug ${soft}`}>{addrLine}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${chip} ${muted}`}
              aria-label="Sulge"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label htmlFor={nameId} className={`mb-1 block text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
            Nimi
          </label>
          <input
            ref={nameRef}
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSave()
              }
            }}
            maxLength={60}
            placeholder={suggestedName || 'Minu pin'}
            enterKeyHint="done"
            className={`mb-2.5 w-full rounded-xl border px-3 py-2.5 text-[15px] font-semibold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${inputCls}`}
            autoComplete="off"
          />

          <label htmlFor={noteId} className={`mb-1 block text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
            Märkus
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            maxLength={280}
            rows={2}
            placeholder="Märkus (valikuline)"
            className={`mb-2.5 w-full resize-none rounded-xl border px-3 py-2.5 text-[13px] font-medium outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${inputCls}`}
          />

          <p className={`mb-1.5 text-[10px] font-semibold tracking-wide uppercase ${muted}`}>
            Värv
          </p>
          <div className="mb-3 flex flex-wrap gap-1" role="listbox" aria-label="Pinni värv">
            {MY_PIN_COLOR_KEYS.map((c) => {
              const selected = c === color
              return (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={c}
                  onClick={() => pickColor(c)}
                  className="flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
                >
                  <span
                    className={`block h-8 w-8 rounded-full ring-offset-2 ${
                      selected
                        ? dark
                          ? 'ring-2 ring-[#007AFF] ring-offset-[#1C1C1E]'
                          : 'ring-2 ring-[#007AFF] ring-offset-white'
                        : ''
                    }`}
                    style={{ background: MY_PIN_COLORS[c] }}
                  />
                </button>
              )
            })}
          </div>

          {mode === 'edit' && onNavigate ? (
            <button
              type="button"
              onClick={onNavigate}
              className="tap-scale mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-3 py-2.5 text-[14px] font-bold text-white transition active:scale-[0.98]"
            >
              <Navigation className="h-4 w-4" strokeWidth={2.4} />
              Navigeeri siia
            </button>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestClose}
              className={`tap-scale flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 py-2.5 text-[14px] font-semibold transition active:scale-[0.98] ${chip} ${soft}`}
            >
              Tühista
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="tap-scale flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#007AFF] px-3 py-2.5 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              Salvesta
            </button>
          </div>

          {mode === 'edit' && onDelete ? (
            <div className="mt-2.5">
              {confirmDelete ? (
                <div
                  className={`rounded-xl px-3 py-2.5 ${dark ? 'bg-white/8' : 'bg-[#FF3B30]/08'}`}
                >
                  <p className="mb-2 text-[13px] font-semibold">Kustuta see pin?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className={`tap-scale flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-[13px] font-semibold ${chip}`}
                    >
                      Ei
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      className="tap-scale flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#FF3B30] px-3 text-[13px] font-bold text-white"
                    >
                      Jah, kustuta
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="tap-scale flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-[#FF3B30] transition active:scale-[0.98]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Kustuta
                </button>
              )}
            </div>
          ) : null}

          <p className={`mt-3 flex items-center justify-center gap-1.5 text-[11px] font-medium ${muted}`}>
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            Ainult sina näed seda pinni
          </p>
        </div>
      </div>
    </div>
  )
}
