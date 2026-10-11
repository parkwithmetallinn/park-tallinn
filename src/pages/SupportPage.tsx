import { LegalPageShell, LegalSection } from './LegalPageShell'

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Kas ParkVibe vajab kontot?',
    a: 'Ei. ParkVibe on kontovaba — lemmikud ja seaded jäävad sinu telefoni.',
  },
  {
    q: 'Kuidas märgin, et parkla on täis?',
    a: 'Ava parkla detailvaade ja saada „täis“ teavitus. Täis-teate jaoks peab asukoht olema lubatud ja sa pead olema parkla lähedal (umbes 200 m). Koordinaate serverisse ei saadeta.',
  },
  {
    q: 'Miks mõni parkla on hall?',
    a: 'Hall tähendab, et hinnainfo on ebaselge. Saad aidata kaardistada: Tasuta, Kellaga või Tasuline.',
  },
  {
    q: 'Kas mu asukohta salvestatakse?',
    a: 'Ei. Asukohta kasutatakse vaid sinu seadmes kaardi ja läheduskontrolli jaoks. Asukohaajalugu meie serveritesse ei salvestata.',
  },
  {
    q: 'Kuidas teatan veast või uuest parklast?',
    a: 'Kasuta rakenduses „Lisa koht“ / veateadet või saada tagasisidet alloleva lingiga. Vastame teadetele ja küsimustele 48 tunni jooksul.',
  },
]

/** App Store / public Support page at /support */
export function SupportPage() {
  return (
    <LegalPageShell
      title="Tugi — ParkVibe"
      subtitle="Kuidas ParkVibe töötab ja kuidas abi saada."
    >
      <div data-testid="support-page">
        <LegalSection title="Kuidas ParkVibe töötab">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Ava kaart ja otsi aadressi või liigu kaardil — näed tasuta, kellaga
              ja tasulisi parklaid üle Eesti.
            </li>
            <li>
              Vali parkla, vaata reegleid ja navigeeri Waze’i, Google Mapsi või
              Apple Mapsiga.
            </li>
            <li>
              Salvesta lemmikud ning Kodu/Töö kohad — need jäävad vaid sinu
              seadmesse.
            </li>
            <li>
              Aita kogukonda: märgi parklaid täis või vabaks ja teata vigadest
              ühe vajutusega.
            </li>
          </ol>
        </LegalSection>

        <LegalSection title="KKK / FAQ">
          <div className="space-y-3">
            {FAQ.map((item) => (
              <div key={item.q}>
                <p className="font-bold text-[#1C1C1E]">{item.q}</p>
                <p className="mt-0.5">{item.a}</p>
              </div>
            ))}
          </div>
        </LegalSection>

        <LegalSection title="Kontakt ja tagasiside">
          <p>
            Vastame teadetele ja küsimustele 48 tunni jooksul.
          </p>
          <p>
            E-post:{' '}
            <a
              href="mailto:parkwithme.tallinn@gmail.com"
              className="break-all font-semibold text-[#007AFF] hover:underline"
            >
              parkwithme.tallinn@gmail.com
            </a>
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="/?feedback=1"
              className="tap-scale inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#007AFF] px-4 text-[14px] font-bold text-white"
            >
              Saada tagasisidet
            </a>
            <a
              href="/privacy"
              className="tap-scale inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#F2F2F7] px-4 text-[14px] font-bold text-[#1C1C1E]"
            >
              Privaatsuspoliitika
            </a>
          </div>
        </LegalSection>

        <LegalSection title="English">
          <p>
            ParkVibe is an account-less parking map for Estonia. Find free,
            timed, and paid lots, save favorites on your device, and help the
            community with full/free reports — without creating an account.
          </p>
          <p>
            We respond to messages and questions within 48 hours:{' '}
            <a
              href="mailto:parkwithme.tallinn@gmail.com"
              className="font-semibold text-[#007AFF] hover:underline"
            >
              parkwithme.tallinn@gmail.com
            </a>
            .
          </p>
          <p>
            <a href="/?feedback=1" className="font-semibold text-[#007AFF] hover:underline">
              Send feedback in the app
            </a>
            {' · '}
            <a href="/privacy" className="font-semibold text-[#007AFF] hover:underline">
              Privacy Policy
            </a>
          </p>
        </LegalSection>
      </div>
    </LegalPageShell>
  )
}
