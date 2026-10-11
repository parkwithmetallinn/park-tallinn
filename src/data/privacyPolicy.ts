/**
 * ParkVibe privacy policy — structured copy for /privacy and the in-app modal.
 * Primary language: Estonian, with a clear English section.
 */

export type PrivacySection = {
  id: string
  title: string
  paragraphs: string[]
  bullets?: string[]
}

export const PRIVACY_POLICY_TITLE_ET = 'Privaatsuspoliitika — ParkVibe'
export const PRIVACY_POLICY_TITLE_EN = 'Privacy Policy — ParkVibe'
export const PRIVACY_POLICY_UPDATED = 'Viimati uuendatud / Last updated: 11. oktoober 2026'

/** @deprecated Prefer PRIVACY_POLICY_TITLE_ET */
export const PRIVACY_POLICY_TITLE = PRIVACY_POLICY_TITLE_ET

export const PRIVACY_POLICY_INTRO_ET =
  'ParkVibe on kontovaba parkimiskaart. Me ei kogu ega salvesta isikuandmeid, ei jälgi sind väljaspool rakendust ning ei seo sind kontoga.'

export const PRIVACY_POLICY_INTRO_EN =
  'ParkVibe is an account-less parking map. We do not collect or store personal data, do not track you outside the app, and do not tie you to an account.'

export const PRIVACY_POLICY_SECTIONS_ET: PrivacySection[] = [
  {
    id: 'accountless',
    title: '1. Kontovaba teenus',
    paragraphs: [
      'ParkVibe ei nõua registreerimist ega sisselogimist. Sul ei ole kasutajakontot ning me ei seo sinu tegevust nime, e-posti ega muu isikutunnusega.',
    ],
  },
  {
    id: 'no-personal',
    title: '2. Isikuandmed',
    paragraphs: [
      'Me ei salvesta isikuandmeid (nt nime, aadressi ega telefoninumbrit). Valikulised meeldetuletused (e-post või push) on ajutised ja seotud vaid aktiivse parkimissessiooniga; need kustutatakse sessiooni lõppedes või hiljemalt paari tunni jooksul.',
    ],
  },
  {
    id: 'local',
    title: '3. Andmed sinu seadmes',
    paragraphs: [
      'Lemmikud, kodu/töö kohad, keele- ja teema seaded, tutvustus ning anonüümne installi tunnus salvestatakse ainult sinu seadme localStorage’is. Need andmed ei lähe meie serverisse ega ole seotud kontoga.',
    ],
  },
  {
    id: 'location',
    title: '4. Asukoht',
    paragraphs: [
      'Asukohta kasutatakse ainult sinu seadmes kaardi, marsruudi ja täis-teate läheduskontrolli jaoks. Me ei saada ega salvesta asukohaajalugu meie serveritesse.',
    ],
  },
  {
    id: 'reports',
    title: '5. Kogukonna teated',
    paragraphs: [
      'Parkla „täis“ / „vabu kohti“ teated ja tagasiside töödeldakse anonüümsete räsiväärtustega (installi ja võrguaadressi põhjal, koos soolaga), et piirata kuritarvitamist. Algset IP-d ega asukohta räsist taastada ei saa. Teated on lühiajalised; asukohaajalugu ei säilitata.',
    ],
  },
  {
    id: 'tracking',
    title: '6. Jälgimine ja reklaam',
    paragraphs: [
      'Me ei jälgi sind väljaspool rakendust. Reklaami- ega jälgimisküpsiseid ei kasutata. Analüütika (kui aktiivne) on koondatud ja ei tuvasta sind isikuna.',
    ],
  },
  {
    id: 'contact-et',
    title: '7. Kontakt',
    paragraphs: [
      'Küsimused privaatsuse kohta: parkwithme.tallinn@gmail.com. Vastame mõistliku aja jooksul. Kaebuse saad esitada Andmekaitse Inspektsioonile (aki.ee).',
    ],
  },
]

export const PRIVACY_POLICY_SECTIONS_EN: PrivacySection[] = [
  {
    id: 'accountless-en',
    title: '1. Account-less service',
    paragraphs: [
      'ParkVibe does not require registration or sign-in. You have no user account, and we do not link your activity to a name, email, or other personal identifier.',
    ],
  },
  {
    id: 'no-personal-en',
    title: '2. Personal data',
    paragraphs: [
      'We do not store personal data such as your name, address, or phone number. Optional reminders (email or push) are temporary and tied only to an active parking session; they are deleted when the session ends or within a few hours at the latest.',
    ],
  },
  {
    id: 'local-en',
    title: '3. Data on your device',
    paragraphs: [
      'Favorites, Home/Work places, language and theme settings, onboarding, and an anonymous install id stay in your device’s local storage. They are not uploaded to our servers and are not linked to an account.',
    ],
  },
  {
    id: 'location-en',
    title: '4. Location',
    paragraphs: [
      'Location is used only on your device for the map, routing, and the proximity check for FULL community reports. We do not send or store location history on our servers.',
    ],
  },
  {
    id: 'reports-en',
    title: '5. Community reports',
    paragraphs: [
      '“Full” / “free spots” reports and feedback are processed with anonymous hashes (derived from an install id and network address with a salt) to limit abuse. The original IP or location cannot be recovered from the hash. Reports are short-lived; we do not keep a location history.',
    ],
  },
  {
    id: 'tracking-en',
    title: '6. Tracking and ads',
    paragraphs: [
      'We do not track you outside the app. We do not use advertising or tracking cookies. Any analytics (if enabled) is aggregated and does not identify you personally.',
    ],
  },
  {
    id: 'contact-en',
    title: '7. Contact',
    paragraphs: [
      'Privacy questions: parkwithme.tallinn@gmail.com. You may also contact the Estonian Data Protection Inspectorate (aki.ee).',
    ],
  },
]

/** Combined sections for the compact in-app Privacy modal (ET first, then EN summary). */
export const PRIVACY_POLICY_SECTIONS: PrivacySection[] = [
  ...PRIVACY_POLICY_SECTIONS_ET,
  {
    id: 'en-summary',
    title: 'English summary',
    paragraphs: [PRIVACY_POLICY_INTRO_EN],
    bullets: [
      'Account-less — no sign-in, no personal profile.',
      'Favorites and settings stay on your device (local storage).',
      'Location is not stored as history on our servers.',
      'Community reports use anonymous hashes only.',
      'No tracking outside the app; no ad cookies.',
    ],
  },
]
