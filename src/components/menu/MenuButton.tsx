import { Menu } from 'lucide-react'

type MenuButtonProps = {
  open: boolean
  onClick: () => void
  dark?: boolean
  /** Hide on small screens when a left info sheet would collide. */
  hiddenOnMobile?: boolean
  className?: string
}

/**
 * Round hamburger control — top-left, ≥44×44 touch target.
 */
export function MenuButton({
  open,
  onClick,
  dark = false,
  hiddenOnMobile = false,
  className = '',
}: MenuButtonProps) {
  return (
    <button
      type="button"
      data-testid="menu-button"
      onClick={onClick}
      aria-label="Menüü"
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`tap-scale flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-[0_4px_16px_rgba(15,23,42,0.18)] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${
        dark
          ? 'border-white/15 bg-[#1C1C1E] text-[#F5F5F7] shadow-[0_4px_16px_rgba(0,0,0,0.45)]'
          : 'border-black/8 bg-white text-[#1C1C1E]'
      } ${
        hiddenOnMobile ? 'max-sm:pointer-events-none max-sm:invisible max-sm:opacity-0' : ''
      } ${className}`.trim()}
    >
      <Menu className="h-5 w-5" strokeWidth={2.4} aria-hidden />
    </button>
  )
}
