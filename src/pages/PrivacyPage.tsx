import {
  PRIVACY_POLICY_INTRO_EN,
  PRIVACY_POLICY_INTRO_ET,
  PRIVACY_POLICY_SECTIONS_EN,
  PRIVACY_POLICY_SECTIONS_ET,
  PRIVACY_POLICY_TITLE_ET,
  PRIVACY_POLICY_UPDATED,
} from '../data/privacyPolicy'
import { LegalPageShell, LegalSection } from './LegalPageShell'

function SectionList({
  sections,
}: {
  sections: typeof PRIVACY_POLICY_SECTIONS_ET
}) {
  return (
    <>
      {sections.map((section) => (
        <LegalSection key={section.id} title={section.title}>
          {section.paragraphs.map((p) => (
            <p key={p.slice(0, 48)}>{p}</p>
          ))}
          {section.bullets?.length ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((b) => (
                <li key={b.slice(0, 48)}>{b}</li>
              ))}
            </ul>
          ) : null}
        </LegalSection>
      ))}
    </>
  )
}

/** App Store / public Privacy Policy at /privacy */
export function PrivacyPage() {
  return (
    <LegalPageShell
      title={PRIVACY_POLICY_TITLE_ET}
      subtitle={PRIVACY_POLICY_UPDATED}
    >
      <div data-testid="privacy-page" className="space-y-1">
        <LegalSection title="Kokkuvõte">
          <p>{PRIVACY_POLICY_INTRO_ET}</p>
        </LegalSection>
        <SectionList sections={PRIVACY_POLICY_SECTIONS_ET} />

        <div className="my-6 border-t border-black/8 pt-5">
          <p className="mb-1 text-[12px] font-bold tracking-[0.04em] text-[#007AFF]">
            ENGLISH
          </p>
          <h2 className="mb-3 text-[20px] font-bold tracking-tight">
            Privacy Policy — ParkVibe
          </h2>
          <LegalSection title="Summary">
            <p>{PRIVACY_POLICY_INTRO_EN}</p>
          </LegalSection>
          <SectionList sections={PRIVACY_POLICY_SECTIONS_EN} />
        </div>

        <p className="pt-2 text-center text-[13px] text-[#8E8E93]">
          <a href="/support" className="font-semibold text-[#007AFF] hover:underline">
            Tugi / Support
          </a>
          {' · '}
          <a href="/" className="font-semibold text-[#007AFF] hover:underline">
            Ava kaart
          </a>
        </p>
      </div>
    </LegalPageShell>
  )
}
