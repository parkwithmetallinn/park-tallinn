import { ExternalLink } from 'lucide-react'
import { ModalShell } from './ModalShell'

/** Set when the public privacy policy page is ready. */
const PRIVACY_POLICY_URL = ''

/**
 * About / Teave — map credits, accuracy disclaimer, privacy placeholder.
 */
export function TeavePanel({ onClose }: { onClose: () => void }) {
  const privacyUrl = PRIVACY_POLICY_URL.trim()

  return (
    <ModalShell title="Teave" onClose={onClose}>
      <div
        data-testid="teave-panel"
        className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft"
      >
        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">Kaardiandmed</h4>
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
          <h4 className="mb-2 text-sm font-bold text-ink">Täpsuse märkus</h4>
          <p>
            Parkimisandmed ja reeglid pärinevad kogukonna kaardiandmetest
            (OpenStreetMap) ning võivad olla aegunud. Kontrolli alati tingimusi
            kohapeal liiklusmärgilt.
          </p>
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">Privaatsuspoliitika</h4>
          {privacyUrl ? (
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#007AFF] underline-offset-2 hover:underline"
            >
              Privaatsuspoliitika
              <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            </a>
          ) : (
            <p className="font-medium text-ink">
              Privaatsuspoliitika{' '}
              <span className="font-normal opacity-70">(tuleb varsti)</span>
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-2 text-sm font-bold text-ink">Kontakt</h4>
          <a
            href="mailto:parkwithme.tallinn@gmail.com"
            className="font-semibold text-[#007AFF] underline-offset-2 hover:underline break-all"
          >
            parkwithme.tallinn@gmail.com
          </a>
        </section>
      </div>
    </ModalShell>
  )
}
