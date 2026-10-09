import type { HTMLAttributes } from 'react'

const ARIA = 'Parkla on täis'

export type FullIndicatorVariant = 'icon' | 'chip'

type FullIndicatorProps = {
  /** `icon` — compact map/sheet badge; `chip` — red dot + small "Täis" text */
  variant?: FullIndicatorVariant
  className?: string
  /** Override test id (default: spot-full-badge for chip, none for icon) */
  'data-testid'?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>

/**
 * Compact community "full lot" indicator — red core + GPU-friendly CSS pulse.
 * Map markers use `createFullIndicatorElement` from `lib/fullIndicatorDom`
 * with the same `.parking-full-indicator` classes.
 */
export function FullIndicator({
  variant = 'icon',
  className = '',
  'data-testid': testId,
  ...rest
}: FullIndicatorProps) {
  if (variant === 'chip') {
    return (
      <span
        className={`parking-full-chip ${className}`.trim()}
        data-testid={testId ?? 'spot-full-badge'}
        title={ARIA}
        aria-label={ARIA}
        {...rest}
      >
        <span
          className="parking-full-indicator parking-full-indicator--inline"
          aria-hidden="true"
        >
          <span className="parking-full-indicator__ring" />
          <span className="parking-full-indicator__core">!</span>
        </span>
        <span className="parking-full-chip__text">Täis</span>
      </span>
    )
  }

  return (
    <span
      className={`parking-full-indicator ${className}`.trim()}
      title={ARIA}
      aria-label={ARIA}
      data-testid={testId}
      {...rest}
    >
      <span className="parking-full-indicator__ring" aria-hidden="true" />
      <span className="parking-full-indicator__core" aria-hidden="true">
        !
      </span>
    </span>
  )
}
