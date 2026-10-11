import { MapPinned, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { markOnboardingSeen } from '../lib/onboarding'

const SLIDES = [
  {
    id: 'welcome',
    Icon: MapPinned,
    title: "Tere tulemast ParkVibe'i!",
    body: 'Leia kiirelt ja privaatselt parkimiskohad üle Eesti.',
  },
  {
    id: 'private',
    Icon: ShieldCheck,
    title: 'Konto vaba ja privaatne',
    body: 'Sinu lemmikud ja seaded jäävad vaid sinu telefoni.',
  },
  {
    id: 'community',
    Icon: Users,
    title: 'Aita kogukonda',
    body: 'Märgi parklaid täis või vabaks ja teata vigadest ühe vajutusega.',
  },
] as const

/**
 * First-launch onboarding — Waze-like, lightweight, 3 short slides.
 * Shown only when localStorage parkvibe_onboarding_seen !== 'true'.
 */
export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const slide = SLIDES[step]!
  const last = step >= SLIDES.length - 1
  const { Icon } = slide

  const finish = () => {
    markOnboardingSeen()
    onClose()
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
      role="presentation"
      data-testid="onboarding-modal"
    >
      <div
        className="animate-slide-up w-full max-w-md overflow-hidden rounded-[28px] border border-black/8 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[linear-gradient(160deg,#007AFF_0%,#5AC8FA_55%,#E8F1FF_100%)] px-5 pb-8 pt-6 text-white">
          <p className="text-[12px] font-bold tracking-[0.08em] uppercase opacity-90">
            ParkVibe
          </p>
          <div
            className={`mt-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm`}
          >
            <Icon className="h-7 w-7" aria-hidden />
          </div>
          <h2
            id="onboarding-title"
            className="mt-4 text-[26px] font-bold leading-tight tracking-tight"
          >
            {slide.title}
          </h2>
          <p className="mt-2 text-[15px] font-medium leading-snug text-white/92">
            {slide.body}
          </p>
        </div>

        <div className="px-5 py-4">
          <div
            className="mb-4 flex items-center justify-center gap-1.5"
            role="tablist"
            aria-label="Tutvustuse sammud"
          >
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`Samm ${i + 1}`}
                onClick={() => setStep(i)}
                className={`h-2 rounded-full transition-all ${
                  i === step ? 'w-6 bg-[#007AFF]' : 'w-2 bg-[#D1D1D6]'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="tap-scale flex-1 rounded-2xl bg-[#F2F2F7] px-3 py-3.5 text-[15px] font-bold text-[#1C1C1E]"
              >
                Tagasi
              </button>
            ) : null}
            {!last ? (
              <button
                type="button"
                data-testid="onboarding-next"
                onClick={() => setStep((s) => Math.min(SLIDES.length - 1, s + 1))}
                className="tap-scale flex-[1.4] rounded-2xl bg-[#007AFF] px-3 py-3.5 text-[15px] font-bold text-white"
              >
                Edasi
              </button>
            ) : null}
            <button
              type="button"
              data-testid="onboarding-start"
              onClick={finish}
              className={`tap-scale rounded-2xl px-3 py-3.5 text-[15px] font-bold ${
                last
                  ? 'flex-[1.4] bg-[#007AFF] text-white'
                  : 'flex-1 bg-[#F2F2F7] text-[#1C1C1E]'
              }`}
            >
              Alusta kasutamist
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
