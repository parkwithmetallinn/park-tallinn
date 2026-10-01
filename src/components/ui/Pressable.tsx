import type { ButtonHTMLAttributes, ReactNode } from 'react'

type PressableProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  /** Visual tone helpers */
  variant?: 'plain' | 'filled' | 'soft' | 'danger' | 'fab'
}

const variantClass: Record<NonNullable<PressableProps['variant']>, string> = {
  plain: 'bg-transparent',
  filled: 'bg-moss text-white shadow-sm',
  soft: 'bg-[#F2F2F7] text-[#1C1C1E]',
  danger: 'bg-[#FF3B30] text-white',
  fab: 'rounded-full shadow-[0_4px_16px_rgba(15,23,42,0.14)]',
}

/**
 * Interactive control with fluid press physics (~0.96 scale),
 * distinct hover / active / disabled states.
 */
export function Pressable({
  children,
  className = '',
  variant = 'plain',
  type = 'button',
  disabled,
  ...rest
}: PressableProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`pressable ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
