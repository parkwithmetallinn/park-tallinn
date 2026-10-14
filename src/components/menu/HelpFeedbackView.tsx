import { ChevronDown, Loader2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import {
  submitFeedback,
  type FeedbackResult,
} from '../../lib/submitFeedback'

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Kuidas otsida parkla?',
    a: 'Kirjuta otsinguribale aadress, koht või parkla nimi (vähemalt 3 tähte). Vali soovitus või vajuta Enter — kaart liigub kohale ja näitab lähimaid parklaid.',
  },
  {
    q: 'Mida tähendavad värvid ja „täis“ märk?',
    a: 'Roheline on tasuta, oranž kellaajaga, sinine tasuline. Punane pulseeriv „!“ tähendab, et kogukond on teatanud, et parkla on täis. Staatus aegub aja jooksul.',
  },
  {
    q: 'Kuidas alustada parkimissessiooni?',
    a: 'Ava parkla info, vali tsoon ja käivita taimer / sessioon. Aktiivse sessiooni leiad kaardi alumisest kella nupust.',
  },
  {
    q: 'Kuidas lisada isiklikku pinni?',
    a: 'Vajuta ja hoia kaardil soovitud kohal — avaneb „Minu pinn“ leht, kuhu saad nime, värvi ja märkuse lisada. Pinnid salvestatakse ainult sellesse seadmesse.',
  },
  {
    q: 'Mida teha, kui parkla on täis?',
    a: 'Ava parkla ja saada „täis“ teade (ole kohapeal). Kaart soovitab lähedal olevaid alternatiive. Kui andmed on valed, kasuta veateadet parkla lehel.',
  },
  {
    q: 'Kas andmed on alati täpsed?',
    a: 'Kaart põhineb avalikel andmetel ja kogukonna teadetel. Kontrolli alati kohapealset silti — reeglid võivad muutuda.',
  },
]

type FeedbackCategory = 'Viga' | 'Ettepanek' | 'Muu'

type HelpFeedbackViewProps = {
  dark?: boolean
}

function isValidEmail(value: string): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function HelpFeedbackView({ dark = false }: HelpFeedbackViewProps) {
  const formId = useId()
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [category, setCategory] = useState<FeedbackCategory>('Ettepanek')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<{ message?: string; email?: string }>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  const [statusText, setStatusText] = useState('')

  const muted = dark ? 'text-[#98989D]' : 'text-[#8E8E93]'
  const card = dark ? 'bg-white/8' : 'bg-black/[0.04]'
  const field = dark
    ? 'border-white/15 bg-[#2C2C2E] text-[#F5F5F7]'
    : 'border-black/10 bg-white text-[#1C1C1E]'

  const validate = (): boolean => {
    const next: { message?: string; email?: string } = {}
    const trimmed = message.trim()
    if (trimmed.length < 10) {
      next.message = 'Sõnum peab olema vähemalt 10 märki.'
    } else if (trimmed.length > 180) {
      next.message = 'Sõnum on liiga pikk (max ~180 märki).'
    }
    if (!isValidEmail(email.trim())) {
      next.email = 'E-posti aadress ei ole korrektne.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const openMailtoFallback = (note: string) => {
    const subject = encodeURIComponent(`ParkVibe tagasiside · ${category}`)
    const body = encodeURIComponent(
      `${note}\n\n---\nKategooria: ${category}${
        email.trim() ? `\nE-post: ${email.trim()}` : ''
      }`,
    )
    window.location.href = `mailto:support@parkimine.ee?subject=${subject}&body=${body}`
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setStatus('loading')
    setStatusText('')

    // Prefix category; do NOT put email in note (API rejects contact info).
    const note = `[${category}] ${message.trim()}`.slice(0, 200)

    let result: FeedbackResult
    try {
      result = await submitFeedback({
        type: 'APP_FEEDBACK',
        note,
        company_website: honeypot,
      })
    } catch {
      result = { ok: false, message: 'Teadet ei õnnestunud saata.' }
    }

    if (result.ok) {
      setStatus('success')
      setStatusText(result.message)
      setMessage('')
      return
    }

    // Fallback: mailto (includes optional email in the body for a reply path)
    setStatus('error')
    setStatusText(
      `${result.message} Võid proovida e-posti kaudu.`,
    )
    openMailtoFallback(message.trim())
  }

  return (
    <div className="space-y-6" data-testid="help-feedback-view">
      <section>
        <h3 className="mb-2 text-sm font-bold">Korduma kippuvad küsimused</h3>
        <div className="space-y-2">
          {FAQ_ITEMS.map((item, i) => {
            const expanded = openFaq === i
            const panelId = `${formId}-faq-${i}`
            return (
              <div key={item.q} className={`overflow-hidden rounded-2xl ${card}`}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpenFaq(expanded ? null : i)}
                  className="tap-scale flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold"
                >
                  <span>{item.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${
                      expanded ? 'rotate-180' : ''
                    }`}
                    aria-hidden
                  />
                </button>
                {expanded ? (
                  <div
                    id={panelId}
                    className={`border-t px-3 py-2.5 text-sm leading-relaxed ${muted} ${
                      dark ? 'border-white/10' : 'border-black/5'
                    }`}
                  >
                    {item.a}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold">Tagasiside</h3>
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate>
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor={`${formId}-cat`}>
              Kategooria
            </label>
            <select
              id={`${formId}-cat`}
              value={category}
              onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              className={`min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${field}`}
            >
              <option value="Viga">Viga</option>
              <option value="Ettepanek">Ettepanek</option>
              <option value="Muu">Muu</option>
            </select>
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-semibold"
              htmlFor={`${formId}-msg`}
            >
              Sõnum
            </label>
            <textarea
              id={`${formId}-msg`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={180}
              required
              className={`w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${field}`}
              placeholder="Kirjeldus vähemalt 10 märki…"
            />
            {errors.message ? (
              <p className="mt-1 text-xs font-medium text-[#FF3B30]" role="alert">
                {errors.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-semibold"
              htmlFor={`${formId}-email`}
            >
              E-post (valikuline)
            </label>
            <input
              id={`${formId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={`min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF] ${field}`}
              placeholder="sina@näide.ee"
            />
            <p className={`mt-1 text-[11px] ${muted}`}>
              E-posti ei saadeta serverisse koos teatega (privaatsus). Kui saatmine
              ebaõnnestub, avaneb mailto koos aadressiga.
            </p>
            {errors.email ? (
              <p className="mt-1 text-xs font-medium text-[#FF3B30]" role="alert">
                {errors.email}
              </p>
            ) : null}
          </div>

          {/* Honeypot */}
          <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
            <label htmlFor={`${formId}-company`}>Company</label>
            <input
              id={`${formId}-company`}
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={status === 'loading'}
            className="tap-scale flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {status === 'loading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Saadan…
              </>
            ) : (
              'Saada'
            )}
          </button>

          {status === 'success' ? (
            <p className="text-sm font-medium text-[#34C759]" role="status">
              {statusText}
            </p>
          ) : null}
          {status === 'error' ? (
            <p className="text-sm font-medium text-[#FF3B30]" role="alert">
              {statusText}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  )
}
