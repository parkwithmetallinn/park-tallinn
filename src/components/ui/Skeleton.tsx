import type { CSSProperties, ReactNode } from 'react'

/** Base shimmer block — mirrors content layout while data loads. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return <div className={`skeleton-shimmer ${className}`} style={style} aria-hidden />
}

export function SkeletonText({
  lines = 2,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3 rounded-full ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  )
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return (
    <Skeleton
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  )
}

/** Active-sessions list placeholder cards */
export function SessionsListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Laadin sessioone">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="rounded-2xl border border-ink/8 bg-white px-3.5 py-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24 rounded-md" />
              <Skeleton className="h-3 w-40 rounded-md" />
              <Skeleton className="h-3 w-28 rounded-md" />
            </div>
            <Skeleton className="h-6 w-14 rounded-lg" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Admin moderation queue row placeholders */
export function AdminRequestListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl bg-white/5 px-3 py-2.5">
          <div className="mb-2 flex gap-2">
            <Skeleton className="h-4 w-20 rounded-md bg-white/10" />
            <Skeleton className="ml-auto h-4 w-14 rounded-md bg-white/10" />
          </div>
          <Skeleton className="mb-1.5 h-3.5 w-3/4 rounded-md bg-white/10" />
          <Skeleton className="h-3 w-1/2 rounded-md bg-white/10" />
        </div>
      ))}
    </div>
  )
}

/** Full-bleed map loading chrome */
export function MapChromeSkeleton() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex flex-col bg-[#E8EEF2]"
      aria-busy="true"
      aria-label="Kaart laeb"
    >
      <div className="skeleton-shimmer h-full w-full opacity-80" />
      <div className="absolute inset-x-0 top-0 px-3 pt-[max(0.65rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-lg space-y-2">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="absolute right-3 bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-2">
        <Skeleton className="h-[52px] w-[52px] rounded-full" />
        <Skeleton className="h-[52px] w-[52px] rounded-full" />
        <Skeleton className="h-[52px] w-[52px] rounded-full" />
      </div>
    </div>
  )
}

export function SkeletonFade({
  loading,
  skeleton,
  children,
  className = '',
}: {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <div
        className={`transition-opacity duration-300 ${
          loading ? 'pointer-events-none absolute inset-0 opacity-100' : 'opacity-0'
        }`}
      >
        {skeleton}
      </div>
      <div
        className={`transition-opacity duration-300 ${
          loading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {children}
      </div>
    </div>
  )
}
