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
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { APP_VERSION, type AppSettings } from '../../lib/appSettings'
import type { FilterId } from '../../types'
import { ProfileHeaderChip, ProfileView } from './ProfileView'
import { SettingsView } from './SettingsView'
import { HelpFeedbackView } from './HelpFeedbackView'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export type MenuView = 'root' | 'profile' | 'settings' | 'help' | 'filters'

export type MenuFilterOption = {
  id: FilterId
  label: string
  color?: string
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

const VIEW_TITLES: Record<Exclude<MenuView, 'root'>, string> = {
  profile: 'Profiil',
  settings: 'Seaded',
  help: 'Abi ja tagasiside',
  filters: 'Filtrid',
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
  const itemHover = dark ? 'hover:bg-white/8' : 'hover:bg-black/[0.04]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge}` : label}
      className={`tap-scale flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-semibold transition ${itemHover}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          dark ? 'bg-white/10' : 'bg-black/[0.06]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
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
  const itemHover = dark ? 'hover:bg-white/8' : 'hover:bg-black/[0.04]'
  return (
    <div
      className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 ${itemHover}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          dark ? 'bg-white/10' : 'bg-black/[0.06]'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold">{label}</span>
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
      className={`px-3 pb-1 pt-1 text-[11px] font-bold tracking-wide uppercase ${muted}`}
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
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (open) {
      setView(initialView)
      previouslyFocused.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      const id = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(id)
    }
    setEntered(false)
  }, [open, initialView])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (view !== 'root') {
          setView('root')
          return
        }
        onClose()
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
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose, view])

  if (!open) return null

  const panelBg = dark
    ? 'bg-[#1C1C1E] text-[#F5F5F7]'
    : 'bg-white text-[#1C1C1E]'
  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const border = dark ? 'border-white/10' : 'border-black/8'
  const itemHover = dark ? 'hover:bg-white/8' : 'hover:bg-black/[0.04]'

  const onBackdropKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  const go = (next: MenuView) => setView(next)

  const activeFilterLabel =
    filterOptions.find((f) => f.id === filter)?.label ?? 'Kõik'

  /** Close drawer, then run action so modals are not covered by the menu. */
  const runAfterClose = (action: () => void) => {
    onClose()
    window.setTimeout(action, 0)
  }

  return (
    <div
      className="fixed inset-0 z-[80] font-sans"
      data-testid="menu-overlay"
      role="presentation"
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-[250ms] ease-out motion-reduce:transition-none ${
          entered ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        onKeyDown={onBackdropKey}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute top-0 left-0 flex h-full w-[min(320px,85vw)] max-w-full flex-col shadow-2xl outline-none transition-transform duration-[250ms] ease-out motion-reduce:transition-none ${panelBg} ${
          entered ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingLeft: 'env(safe-area-inset-left)',
        }}
      >
        <header
          className={`flex shrink-0 items-center gap-2 border-b px-3 py-2.5 ${border}`}
        >
          {view !== 'root' ? (
            <button
              type="button"
              onClick={() => setView('root')}
              className="tap-scale flex h-11 w-11 items-center justify-center rounded-full"
              aria-label="Tagasi"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-bold">
              {view === 'root' ? 'ParkVibe' : VIEW_TITLES[view]}
            </h2>
            {view === 'root' ? (
              <p className={`truncate text-xs ${muted}`}>Menüü</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-scale flex h-11 w-11 items-center justify-center rounded-full"
            aria-label="Sulge menüü"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {view === 'root' ? (
            <div className="space-y-5">
              <ProfileHeaderChip
                dark={dark}
                onClick={() => {
                  go('profile')
                }}
              />

              <nav aria-label="Kaart">
                <SectionHeading muted={muted}>Kaart</SectionHeading>
                <ul className="space-y-0.5">
                  <li>
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
                  </li>
                  <li>
                    <MenuRowButton
                      label="Filtrid"
                      icon={<Filter className="h-5 w-5" aria-hidden />}
                      onClick={() => go('filters')}
                      dark={dark}
                      badge={filter === 'all' ? null : activeFilterLabel}
                    />
                  </li>
                </ul>
              </nav>

              <nav aria-label="Info">
                <SectionHeading muted={muted}>Info</SectionHeading>
                <ul className="space-y-0.5">
                  <li>
                    <MenuRowButton
                      label="Parkimisreeglid"
                      icon={<CircleHelp className="h-5 w-5" aria-hidden />}
                      onClick={() => runAfterClose(onOpenRules)}
                      dark={dark}
                    />
                  </li>
                  <li>
                    <MenuRowButton
                      label="Teave"
                      icon={<Info className="h-5 w-5" aria-hidden />}
                      onClick={() => runAfterClose(onOpenTeave)}
                      dark={dark}
                    />
                  </li>
                  <li>
                    <MenuRowButton
                      label="Privaatsus"
                      icon={<Shield className="h-5 w-5" aria-hidden />}
                      onClick={() => runAfterClose(onOpenPrivacy)}
                      dark={dark}
                    />
                  </li>
                </ul>
              </nav>

              <nav aria-label="Konto">
                <SectionHeading muted={muted}>Konto</SectionHeading>
                <ul className="space-y-0.5">
                  {ACCOUNT_ITEMS.map((item) => (
                    <li key={item.view}>
                      <MenuRowButton
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
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : null}

          {view === 'filters' ? (
            <div className="space-y-2" data-testid="menu-filters">
              <p className={`px-1 text-xs leading-relaxed ${muted}`}>
                Vali, milliseid parklaid kaardil näidata.
              </p>
              <ul className="space-y-1" role="radiogroup" aria-label="Kaardi filtrid">
                {filterOptions.map((f) => {
                  const active = filter === f.id
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-filter={f.id}
                        onClick={() => {
                          onFilterChange(f.id)
                          setView('root')
                        }}
                        className={`tap-scale flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-semibold transition ${itemHover} ${
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
                        <span className="min-w-0 flex-1 truncate">{f.label}</span>
                        {active ? (
                          <span className="text-xs font-bold text-[#007AFF]">
                            Aktiivne
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
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
              onClearPins={onClearPins}
              pinCount={pinCount}
              wakeLockSupported={wakeLockSupported}
            />
          ) : null}

          {view === 'help' ? <HelpFeedbackView dark={dark} /> : null}
        </div>

        <footer className={`shrink-0 border-t px-4 py-3 ${border}`}>
          <p className={`text-center text-[11px] ${muted}`}>
            Versioon {APP_VERSION}
          </p>
        </footer>
      </div>
    </div>
  )
}
