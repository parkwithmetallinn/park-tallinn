import {
  ArrowLeft,
  CircleHelp,
  Filter,
  Info,
  Moon,
  Settings,
  Shield,
  Sun,
  User,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  animationsDisabled,
  APP_VERSION,
  type AppSettings,
} from '../../lib/appSettings'
import type { FilterId } from '../../types'
import { ProfileHeaderChip, ProfileView } from './ProfileView'
import { SettingsView } from './SettingsView'
import { HelpFeedbackView } from './HelpFeedbackView'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

/** History state marker — avoids clashing with spot deep-link replaceState. */
const MENU_HISTORY_KEY = 'parkMenu'

export type MenuView = 'root' | 'profile' | 'settings' | 'help' | 'filters'

export type MenuFilterOption = {
  id: FilterId
  label: string
  color?: string
}

type MenuHistoryState = {
  [MENU_HISTORY_KEY]: true
  view: MenuView
}

type MenuPanelProps = {
  open: boolean
  onClose: () => void
  dark?: boolean
  settings: AppSettings
  onSettingsChange: (patch: Partial<AppSettings>) => void
  onClearPins: () => void
  pinCount: number
  hasActiveSession: boolean
  activeSessionLabel?: string | null
  wakeLockSupported: boolean
  /** Open directly on a sub-view (e.g. deep-link). */
  initialView?: MenuView
  filter: FilterId
  filterOptions: MenuFilterOption[]
  onFilterChange: (id: FilterId) => void
  onToggleTheme: () => void
  /** Close menu, then open the target chrome panel. */
  onOpenRules: () => void
  onOpenTeave: () => void
  onOpenPrivacy: () => void
}

const ACCOUNT_ITEMS: {
  view: Exclude<MenuView, 'root' | 'filters'>
  label: string
  icon: ReactNode
}[] = [
  {
    view: 'profile',
    label: 'Profiil',
    icon: <User className="h-5 w-5" aria-hidden />,
  },
  {
    view: 'settings',
    label: 'Seaded',
    icon: <Settings className="h-5 w-5" aria-hidden />,
  },
  {
    view: 'help',
    label: 'Abi ja tagasiside',
    icon: <CircleHelp className="h-5 w-5" aria-hidden />,
  },
]

const VIEW_TITLES: Record<MenuView, string> = {
  root: 'Menüü',
  profile: 'Profiil',
  settings: 'Seaded',
  help: 'Abi ja tagasiside',
  filters: 'Filtrid',
}

function isMenuState(state: unknown): state is MenuHistoryState {
  return (
    !!state &&
    typeof state === 'object' &&
    (state as MenuHistoryState)[MENU_HISTORY_KEY] === true &&
    typeof (state as MenuHistoryState).view === 'string'
  )
}

function prefersNoMotion(): boolean {
  if (animationsDisabled()) return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function MenuRowButton({
  label,
  icon,
  onClick,
  dark,
  badge,
  trailing,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  dark?: boolean
  badge?: string | null
  trailing?: ReactNode
}) {
  const itemHover = dark ? 'active:bg-white/10' : 'active:bg-black/[0.06]'
  const rowBorder = dark ? 'border-white/8' : 'border-black/6'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge}` : label}
      className={`tap-scale flex min-h-14 w-full items-center gap-3 border-b px-4 text-left text-[16px] font-semibold transition ${rowBorder} ${itemHover}`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          dark ? 'bg-white/10' : 'bg-black/[0.06]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            dark ? 'bg-white/12 text-[#EBEBF5]' : 'bg-black/8 text-[#3A3A3C]'
          }`}
        >
          {badge}
        </span>
      ) : null}
      {trailing}
    </button>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  dark,
  icon,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  dark?: boolean
  icon: ReactNode
}) {
  const rowBorder = dark ? 'border-white/8' : 'border-black/6'
  return (
    <div
      className={`flex min-h-14 items-center gap-3 border-b px-4 ${rowBorder}`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          dark ? 'bg-white/10' : 'bg-black/[0.06]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[16px] font-semibold">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${
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

function SectionHeading({
  children,
  muted,
}: {
  children: ReactNode
  muted: string
}) {
  return (
    <h3
      className={`px-4 pb-2 pt-5 text-[12px] font-bold tracking-wide uppercase ${muted}`}
    >
      {children}
    </h3>
  )
}

export function MenuPanel({
  open,
  onClose,
  dark = false,
  settings,
  onSettingsChange,
  onClearPins,
  pinCount,
  hasActiveSession,
  activeSessionLabel,
  wakeLockSupported,
  initialView = 'root',
  filter,
  filterOptions,
  onFilterChange,
  onToggleTheme,
  onOpenRules,
  onOpenTeave,
  onOpenPrivacy,
}: MenuPanelProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [view, setView] = useState<MenuView>(initialView)
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)
  /** How many menu history entries we own (root + optional sub-view). */
  const depthRef = useRef(0)
  /** Suppress double-close when we pop history ourselves. */
  const closingRef = useRef(false)

  const reduceMotion = prefersNoMotion()
  const transitionMs = reduceMotion ? 0 : 250

  const pushMenuState = useCallback((next: MenuView) => {
    const state: MenuHistoryState = { [MENU_HISTORY_KEY]: true, view: next }
    window.history.pushState(state, '')
  }, [])

  const closeEntireMenu = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const depth = depthRef.current
    depthRef.current = 0
    if (depth > 0) {
      window.history.go(-depth)
    }
    onClose()
    // Allow future opens after the history catch-up settles
    window.setTimeout(() => {
      closingRef.current = false
    }, 0)
  }, [onClose])

  // Mount / enter / exit animation + body scroll lock
  useEffect(() => {
    if (open) {
      previouslyFocused.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      setView(initialView)
      setMounted(true)
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const id = requestAnimationFrame(() => setEntered(true))
      return () => {
        cancelAnimationFrame(id)
        document.body.style.overflow = prevOverflow
      }
    }
    if (mounted) {
      setEntered(false)
      const t = window.setTimeout(() => setMounted(false), transitionMs)
      return () => window.clearTimeout(t)
    }
  }, [open, initialView, mounted, transitionMs])

  // History: push root on open; sync popstate; clean up if unmounted while open
  useEffect(() => {
    if (!open) return

    closingRef.current = false
    if (initialView === 'root') {
      depthRef.current = 1
      pushMenuState('root')
    } else {
      depthRef.current = 2
      pushMenuState('root')
      pushMenuState(initialView)
      setView(initialView)
    }

    const onPop = (e: PopStateEvent) => {
      if (closingRef.current) return
      const st = e.state
      if (isMenuState(st)) {
        setView(st.view)
        depthRef.current = st.view === 'root' ? 1 : 2
        return
      }
      // Left the menu stack via OS/browser back
      depthRef.current = 0
      onClose()
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // If parent closed without going through closeEntireMenu, drop our entries
      if (depthRef.current > 0 && !closingRef.current) {
        const d = depthRef.current
        depthRef.current = 0
        closingRef.current = true
        window.history.go(-d)
        window.setTimeout(() => {
          closingRef.current = false
        }, 0)
      }
    }
  }, [open, initialView, onClose, pushMenuState])

  // Focus trap + Escape
  useEffect(() => {
    if (!open || !mounted) return
    const panel = panelRef.current
    if (panel) {
      const heading = panel.querySelector<HTMLElement>('h1,h2')
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(heading ?? first ?? panel).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (view !== 'root') {
          window.history.back()
          return
        }
        closeEntireMenu()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (nodes.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (!open) previouslyFocused.current?.focus?.()
    }
  }, [open, mounted, view, closeEntireMenu])

  // Restore focus when fully unmounted
  useEffect(() => {
    if (!mounted && !open) {
      previouslyFocused.current?.focus?.()
    }
  }, [mounted, open])

  const go = (next: MenuView) => {
    if (next === view) return
    if (view === 'root' && next !== 'root') {
      setView(next)
      depthRef.current = 2
      pushMenuState(next)
      return
    }
    setView(next)
  }

  const goBack = () => {
    if (view === 'root') {
      closeEntireMenu()
      return
    }
    window.history.back()
  }

  /** Close menu, then run a map-side action. */
  const runAfterClose = (action: () => void) => {
    closeEntireMenu()
    window.setTimeout(action, transitionMs + 10)
  }

  if (!mounted) return null

  const pageBg = dark
    ? 'bg-[#121417] text-[#F5F5F7]'
    : 'bg-[#F2F4F7] text-[#1C1C1E]'
  const headerBg = dark ? 'bg-[#1C1C1E]/95' : 'bg-white/95'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const border = dark ? 'border-white/10' : 'border-black/8'
  const cardBg = dark ? 'bg-[#1C1C1E]' : 'bg-white'
  const itemHover = dark ? 'active:bg-white/10' : 'active:bg-black/[0.04]'

  const activeFilterLabel =
    filterOptions.find((f) => f.id === filter)?.label ?? 'Kõik'

  const enterClass = reduceMotion
    ? entered
      ? 'opacity-100'
      : 'opacity-0'
    : entered
      ? 'translate-y-0 opacity-100'
      : 'translate-y-4 opacity-0'

  const subEnterClass = reduceMotion
    ? ''
    : 'animate-[menu-slide-in_250ms_ease-out]'

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="menu-overlay"
      className={`menu-fullscreen fixed inset-0 z-[100] flex min-h-[100vh] h-[100dvh] flex-col outline-none ${pageBg} transition-[opacity,transform] duration-[250ms] ease-out motion-reduce:transition-none ${enterClass}`}
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
      }}
    >
      <header
        className={`sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b px-2 py-2 ${border} ${headerBg}`}
      >
        {view !== 'root' ? (
          <button
            type="button"
            onClick={goBack}
            className="tap-scale flex h-11 w-11 items-center justify-center rounded-full"
            aria-label="Tagasi"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <span className="w-11" aria-hidden />
        )}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1
            id={titleId}
            tabIndex={-1}
            className="truncate text-[17px] font-bold outline-none"
          >
            {VIEW_TITLES[view]}
          </h1>
          {view === 'root' ? (
            <p className={`truncate text-xs ${muted}`}>ParkVibe</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={closeEntireMenu}
          className="tap-scale flex h-11 w-11 items-center justify-center rounded-full"
          aria-label="Sulge menüü"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="mx-auto w-full max-w-[640px] px-0 pb-6">
          {view === 'root' ? (
            <div>
              <div className={`mx-3 mt-4 overflow-hidden rounded-2xl ${cardBg}`}>
                <ProfileHeaderChip
                  dark={dark}
                  onClick={() => go('profile')}
                />
              </div>

              <nav aria-label="Kaart">
                <SectionHeading muted={muted}>Kaart</SectionHeading>
                <div className={`mx-3 overflow-hidden rounded-2xl ${cardBg}`}>
                  <ToggleRow
                    label="Tume kaart"
                    checked={dark}
                    onChange={() => onToggleTheme()}
                    dark={dark}
                    icon={
                      dark ? (
                        <Moon className="h-5 w-5" aria-hidden />
                      ) : (
                        <Sun className="h-5 w-5" aria-hidden />
                      )
                    }
                  />
                  <MenuRowButton
                    label="Filtrid"
                    icon={<Filter className="h-5 w-5" aria-hidden />}
                    onClick={() => go('filters')}
                    dark={dark}
                    badge={filter === 'all' ? null : activeFilterLabel}
                  />
                </div>
              </nav>

              <nav aria-label="Info">
                <SectionHeading muted={muted}>Info</SectionHeading>
                <div className={`mx-3 overflow-hidden rounded-2xl ${cardBg}`}>
                  <MenuRowButton
                    label="Parkimisreeglid"
                    icon={<CircleHelp className="h-5 w-5" aria-hidden />}
                    onClick={() => runAfterClose(onOpenRules)}
                    dark={dark}
                  />
                  <MenuRowButton
                    label="Teave"
                    icon={<Info className="h-5 w-5" aria-hidden />}
                    onClick={() => runAfterClose(onOpenTeave)}
                    dark={dark}
                  />
                  <MenuRowButton
                    label="Privaatsus"
                    icon={<Shield className="h-5 w-5" aria-hidden />}
                    onClick={() => runAfterClose(onOpenPrivacy)}
                    dark={dark}
                  />
                </div>
              </nav>

              <nav aria-label="Konto">
                <SectionHeading muted={muted}>Konto</SectionHeading>
                <div className={`mx-3 overflow-hidden rounded-2xl ${cardBg}`}>
                  {ACCOUNT_ITEMS.map((item) => (
                    <MenuRowButton
                      key={item.view}
                      label={item.label}
                      icon={item.icon}
                      onClick={() => go(item.view)}
                      dark={dark}
                      badge={
                        item.view === 'profile' && hasActiveSession
                          ? 'Sessioon'
                          : item.view === 'profile' && pinCount > 0
                            ? `${pinCount}`
                            : null
                      }
                    />
                  ))}
                </div>
              </nav>

              <p className={`mt-8 px-4 text-center text-[11px] ${muted}`}>
                Versioon {APP_VERSION}
              </p>
            </div>
          ) : (
            <div className={`px-4 pt-4 ${subEnterClass}`}>
              {view === 'filters' ? (
                <div className="space-y-3" data-testid="menu-filters">
                  <p className={`text-sm leading-relaxed ${muted}`}>
                    Vali, milliseid parklaid kaardil näidata. Valik sulgeb menüü
                    ja rakendub kohe.
                  </p>
                  <div
                    className={`overflow-hidden rounded-2xl ${cardBg}`}
                    role="radiogroup"
                    aria-label="Kaardi filtrid"
                  >
                    {filterOptions.map((f) => {
                      const active = filter === f.id
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-filter={f.id}
                          onClick={() => {
                            onFilterChange(f.id)
                            closeEntireMenu()
                          }}
                          className={`tap-scale flex min-h-14 w-full items-center gap-3 border-b px-4 text-left text-[16px] font-semibold ${
                            dark ? 'border-white/8' : 'border-black/6'
                          } ${itemHover} ${
                            active
                              ? dark
                                ? 'bg-[#007AFF]/25'
                                : 'bg-[#007AFF]/12'
                              : ''
                          }`}
                        >
                          {f.color ? (
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: f.color }}
                              aria-hidden
                            />
                          ) : (
                            <span
                              className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
                                dark ? 'border-white/30' : 'border-black/25'
                              }`}
                              aria-hidden
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {f.label}
                          </span>
                          {active ? (
                            <span className="text-xs font-bold text-[#007AFF]">
                              Aktiivne
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {view === 'profile' ? (
                <ProfileView
                  dark={dark}
                  pinCount={pinCount}
                  hasActiveSession={hasActiveSession}
                  activeSessionLabel={activeSessionLabel}
                />
              ) : null}

              {view === 'settings' ? (
                <SettingsView
                  dark={dark}
                  settings={settings}
                  onChange={onSettingsChange}
                  onClearPins={() => {
                    onClearPins()
                    closeEntireMenu()
                  }}
                  pinCount={pinCount}
                  wakeLockSupported={wakeLockSupported}
                />
              ) : null}

              {view === 'help' ? <HelpFeedbackView dark={dark} /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
