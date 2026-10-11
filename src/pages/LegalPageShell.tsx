import { ArrowLeft } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

/**
 * Clean full-page shell for App Store legal surfaces (/privacy, /support).
 * Scrollable independently of the map app’s overflow:hidden body.
 */
export function LegalPageShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    return () => {
      document.body.style.overflow = prev
      document.documentElement.style.overflow = ''
    }
  }, [])

  return (
    <div
      className="min-h-dvh bg-[radial-gradient(120%_80%_at_10%_-10%,#d7e8ff_0%,transparent_55%),radial-gradient(90%_70%_at_100%_0%,#e8f7ef_0%,transparent_45%),linear-gradient(180deg,#f4f7fb_0%,#eef2f6_100%)] text-[#1C1C1E]"
      data-testid="legal-page"
    >
      <header className="sticky top-0 z-10 border-b border-black/6 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <a
            href="/"
            className="tap-scale inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F2F7] text-[#1C1C1E] transition hover:bg-[#E5E5EA]"
            aria-label="Tagasi kaardile"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </a>
          <div className="min-w-0">
            <p className="text-[12px] font-bold tracking-[0.04em] text-[#007AFF]">
              ParkVibe
            </p>
            <h1 className="truncate text-[18px] font-bold leading-tight tracking-tight">
              {title}
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {subtitle ? (
          <p className="mb-5 text-[15px] leading-relaxed text-[#3A3A3C]">
            {subtitle}
          </p>
        ) : null}
        {children}
      </main>
    </div>
  )
}

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mb-3 rounded-2xl border border-black/6 bg-white/90 p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h2 className="mb-2 text-[15px] font-bold tracking-tight text-[#1C1C1E]">
        {title}
      </h2>
      <div className="space-y-2 text-[14px] leading-relaxed text-[#3A3A3C]">
        {children}
      </div>
    </section>
  )
}
