import { ExternalLink } from 'lucide-react'
import { ModalShell } from './ModalShell'
import { LOCALES, useI18n, type Locale } from '../i18n'
import { useSettings } from '../hooks/useSettings'

/**
 * About / Teave — map credits, accuracy disclaimer, privacy, language, onboarding.
 */
export function TeavePanel({
  onClose,
  onOpenPrivacy,
  onReplayOnboarding,
}: {
  onClose: () => void
  onOpenPrivacy?: () => void
  onReplayOnboarding?: () => void
}) {
  const { t, locale } = useI18n()
  const { setLanguage } = useSettings()

  return (
    <ModalShell title={t('teave.title')} onClose={onClose}>
      <div
        data-testid="teave-panel"
        className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft"
      >
        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">{t('lang.title')}</h4>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t('lang.title')}
          >
            {LOCALES.map((code) => {
              const active = locale === code
              const label =
                code === 'et'
                  ? t('lang.et')
                  : code === 'en'
                    ? t('lang.en')
                    : t('lang.ru')
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`lang-${code}`}
                  onClick={() => setLanguage(code as Locale)}
                  className={`tap-scale min-h-11 rounded-xl px-3 py-2 text-[13px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${
                    active
                      ? 'bg-[#007AFF] text-white'
                      : 'bg-white text-[#1C1C1E] ring-1 ring-black/10'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">{t('teave.mapData')}</h4>
          <ul className="space-y-2 text-[13px] leading-snug text-ink">
            <li>
              Andmed:{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
              >
                © OpenStreetMap contributors (ODbL)
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              </a>
            </li>
            <li>
              Kaart:{' '}
              <a
                href="https://openfreemap.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#007AFF] underline-offset-2 hover:underline"
              >
                OpenFreeMap
              </a>
              ,{' '}
              <a
                href="https://openmaptiles.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#007AFF] underline-offset-2 hover:underline"
              >
                OpenMapTiles
              </a>
            </li>
            <li>
              Kaardimootor:{' '}
              <a
                href="https://maplibre.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
              >
                MapLibre
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              </a>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">
            {t('teave.accuracyTitle')}
          </h4>
          <p>{t('teave.accuracyBody')}</p>
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">{t('teave.privacy')}</h4>
          <div className="flex flex-col gap-2">
            {onOpenPrivacy ? (
              <button
                type="button"
                data-testid="teave-open-privacy"
                onClick={onOpenPrivacy}
                className="text-left font-semibold text-[#007AFF] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
              >
                {t('teave.privacy')}
              </button>
            ) : null}
            <a
              href="/privacy"
              className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
            >
              {t('teave.openFullPrivacy')}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </a>
            <a
              href="/support"
              className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
            >
              {t('teave.support')}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </a>
          </div>
        </section>

        {onReplayOnboarding ? (
          <section className="rounded-2xl bg-paper-2 p-3">
            <h4 className="mb-2 text-sm font-bold text-ink">
              {t('teave.onboarding')}
            </h4>
            <button
              type="button"
              data-testid="teave-replay-onboarding"
              onClick={onReplayOnboarding}
              className="font-semibold text-[#007AFF] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            >
              {t('teave.replayOnboarding')}
            </button>
          </section>
        ) : null}

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">{t('teave.contact')}</h4>
          <a
            href="mailto:parkwithme.tallinn@gmail.com"
            className="break-all font-semibold text-[#007AFF] underline-offset-2 hover:underline"
          >
            parkwithme.tallinn@gmail.com
          </a>
          <p className="mt-1.5 text-[12px] opacity-80">{t('teave.responseSla')}</p>
        </section>
      </div>
    </ModalShell>
  )
}
