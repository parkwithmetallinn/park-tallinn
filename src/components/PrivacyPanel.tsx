import { ModalShell } from './ModalShell'
import {
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TITLE,
  PRIVACY_POLICY_UPDATED,
} from '../data/privacyPolicy'
import { useI18n } from '../i18n'

/** Privacy policy modal — same shell styling as the rules modal. */
export function PrivacyPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()

  return (
    <ModalShell title={t('chrome.privacy')} onClose={onClose}>
      <div
        data-testid="privacy-panel"
        className="max-h-[60vh] space-y-3 overflow-y-auto text-xs leading-relaxed text-ink-soft"
      >
        <div className="rounded-2xl bg-paper-2 p-3">
          <h4 className="mb-1 text-sm font-bold text-ink">{PRIVACY_POLICY_TITLE}</h4>
          <p className="text-[12px] opacity-80">{PRIVACY_POLICY_UPDATED}</p>
        </div>

        {PRIVACY_POLICY_SECTIONS.map((section) => (
          <section key={section.id} className="rounded-2xl bg-paper-2 p-3">
            <h4 className="mb-1 text-sm font-bold text-ink">{section.title}</h4>
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 40)} className="mt-1">
                {p}
              </p>
            ))}
            {section.bullets?.length ? (
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                {section.bullets.map((b) => (
                  <li key={b.slice(0, 48)}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </ModalShell>
  )
}
