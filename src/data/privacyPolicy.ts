/**
 * ParkVibe privacy policy — structured copy for the in-app Privacy modal.
 * Source language for this document: English.
 */

export type PrivacySection = {
  id: string
  title: string
  paragraphs: string[]
  bullets?: string[]
}

export const PRIVACY_POLICY_TITLE = 'Privacy Policy — ParkVibe'

export const PRIVACY_POLICY_UPDATED = 'Last updated: October 11, 2026'

export const PRIVACY_POLICY_SECTIONS: PrivacySection[] = [
  {
    id: 'controller',
    title: '1. Data Controller',
    paragraphs: [
      'ParkVibe team, contact: parkwithme.tallinn@gmail.com. All questions and requests: parkwithme.tallinn@gmail.com.',
    ],
  },
  {
    id: 'data',
    title: '2. What Data We Process and Why',
    paragraphs: [],
    bullets: [
      'Parking zone, start and end time: for calculating the parking session and fee. We store session data for up to 90 days, then delete it.',
      'Email address (optional): for sending a reminder 10 minutes before the parking expires. We delete the address when the session ends or at the latest within 2 hours thereafter.',
      'Push notification subscription (optional): for sending notifications to your device. We delete it when the session ends or at the latest within 2 hours thereafter.',
      'Parking lot status reports (“full” / “free spots”): displayed to other users. We store them for 24 hours. We store a hashed value generated from the IP address and a salt alongside the report to prevent spam. The original IP cannot be recovered from the hash.',
      'Location data is used only on your device to display the map; we do not store location data on our servers.',
    ],
  },
  {
    id: 'legal',
    title: '3. Legal Basis',
    paragraphs: [
      'Provision of service (parking session), consent (email and push, can be withdrawn at any time), and legitimate interest (anti-spam, security).',
    ],
  },
  {
    id: 'recipients',
    title: '4. Data Recipients (Processors)',
    paragraphs: [
      'Supabase (database, Frankfurt/Stockholm), Vercel (hosting), n8n Cloud (automated reminders), Google Gmail (email dispatch). We do not sell data.',
    ],
  },
  {
    id: 'rights',
    title: '5. Your Rights',
    paragraphs: [
      'You have the right to access, rectify, erase, restrict processing of your data, and withdraw your consent. Contact parkwithme.tallinn@gmail.com, we will respond within 30 days. You can lodge a complaint with the Estonian Data Protection Inspectorate (aki.ee).',
    ],
  },
  {
    id: 'cookies',
    title: '6. Cookies and Local Storage',
    paragraphs: [
      'We store session states and preferences locally on your device. No advertising or tracking cookies are used.',
    ],
  },
  {
    id: 'changes',
    title: '7. Changes',
    paragraphs: ['If we update this policy, we will revise the date.'],
  },
]
