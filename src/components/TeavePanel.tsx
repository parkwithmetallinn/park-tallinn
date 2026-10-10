import { ExternalLink } from 'lucide-react'
import { ModalShell } from './ModalShell'
import { LOCALES, useI18n, type Locale } from '../i18n'

/** Set when a public privacy policy URL is preferred over the in-app modal. */
const PRIVACY_POLICY_URL = ''

/**
 * About / Teave — map credits, accuracy disclaimer, privacy, language.
 */
export function TeavePanel({
  onClose,
  onOpenPrivacy,
}: {
  onClose: () => void
  onOpenPrivacy?: () => void
}) {
  const { t, locale, setLocale } = useI18n()
  const privacyUrl = PRIVACY_POLICY_URL.trim()

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
                  onClick={() => setLocale(code as Locale)}
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
          <ul className="space-y-1.5">
            <li>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
              >
                © OpenStreetMap contributors
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              </a>
            </li>
            <li className="font-medium text-ink">OpenFreeMap</li>
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
          {privacyUrl ? (
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
            >
              {t('teave.privacy')}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </a>
          ) : onOpenPrivacy ? (
            <button
              type="button"
              data-testid="teave-open-privacy"
              onClick={onOpenPrivacy}
              className="font-semibold text-[#007AFF] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            >
              {t('teave.privacy')}
            </button>
          ) : (
            <p className="font-medium text-ink">
              {t('teave.privacy')}{' '}
              <span className="font-normal opacity-70">{t('common.soon')}</span>
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">{t('teave.contact')}</h4>
          <a
            href="mailto:parkwithme.tallinn@gmail.com"
            className="break-all font-semibold text-[#007AFF] underline-offset-2 hover:underline"
          >
            parkwithme.tallinn@gmail.com
          </a>
        </section>
      </div>
    </ModalShell>
  )
}
