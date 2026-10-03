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

export const parkingSessionActionSchema = z.enum(['start', 'stop', 'status'])

export const parkingSessionBodySchema = z
  .object({
    action: parkingSessionActionSchema,
    carNumber: carNumberSchema.optional(),
    zone: zoneCodeSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.action === 'start' || val.action === 'stop') {
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
