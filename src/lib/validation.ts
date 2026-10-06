import { z } from 'zod'

/** Estonian-ish plate / session code: letters+digits, existing UI allows ≥2 chars. */
export const carNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(12)
  .regex(/^[A-Z0-9ÄÖÜÕ\- ]+$/i)

export const zoneCodeSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[A-Za-z0-9ÄÖÜÕäöüõ+\-_./ ]*$/)

export const parkingSessionActionSchema = z.enum([
  'start',
  'stop',
  'status',
  'extend',
  'notify',
])

/** endsAt must be ISO and 1 minute–24 hours ahead of now. */
function isValidExtendEndsAt(iso: string): boolean {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return false
  const now = Date.now()
  return ms >= now + 60_000 && ms <= now + 24 * 60 * 60 * 1000
}

const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(256),
      })
      .optional(),
  })
  .passthrough()

const emailSchema = z.string().trim().email().max(254)

export const parkingSessionBodySchema = z
  .object({
    action: parkingSessionActionSchema,
    carNumber: carNumberSchema.optional(),
    zone: zoneCodeSchema.optional(),
    endsAt: z.string().trim().min(1).optional(),
    pushSubscription: pushSubscriptionSchema.optional(),
    email: emailSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.action === 'start' ||
      val.action === 'stop' ||
      val.action === 'status' ||
      val.action === 'extend' ||
      val.action === 'notify'
    ) {
      if (!val.carNumber) {
        ctx.addIssue({
          code: 'custom',
          path: ['carNumber'],
          message: 'carNumber required',
        })
      }
    }
    if (val.action === 'start' && !val.zone) {
      ctx.addIssue({
        code: 'custom',
        path: ['zone'],
        message: 'zone required',
      })
    }
    if (val.action === 'extend') {
      if (!val.endsAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'endsAt required',
        })
      } else if (!isValidExtendEndsAt(val.endsAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'endsAt out of range',
        })
      }
    }
    if (val.action === 'notify') {
      if (!val.pushSubscription && !val.email) {
        ctx.addIssue({
          code: 'custom',
          path: ['pushSubscription'],
          message: 'pushSubscription or email required',
        })
      }
    }
  })

export const searchQuerySchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^[\p{L}\p{N}\s.,'\-/+()&]+$/u)

export const reportProposeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  type: z.enum(['free', 'timed', 'paid', 'other']),
  kind: z.enum(['street', 'lot']),
  limit: z.string().trim().max(80).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
  /** Honeypot — must stay empty */
  company_website: z.string().max(0).optional().or(z.literal('')),
})

export const reportInvalidSchema = z.object({
  reason: z.enum(['nonexistent', 'blocked', 'private', 'other']),
  note: z.string().trim().max(500).optional().or(z.literal('')),
  company_website: z.string().max(0).optional().or(z.literal('')),
})

export type ParkingSessionBody = z.infer<typeof parkingSessionBodySchema>

/** Sanitize session body; returns null when invalid (caller keeps existing error UX). */
export function parseParkingSessionBody(
  input: unknown,
): ParkingSessionBody | null {
  const parsed = parkingSessionBodySchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function clampSearchQuery(raw: string): string {
  const trimmed = raw.trim().slice(0, 120)
  const parsed = searchQuerySchema.safeParse(trimmed)
  return parsed.success ? parsed.data : trimmed.replace(/[^\p{L}\p{N}\s.,'\-/+()&]/gu, '').slice(0, 120)
}
