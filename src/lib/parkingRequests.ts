/**
 * Crowdsourced parking moderation queue.
 * Frontend NEVER mutates production GeoJSON — only writes pending requests
 * and (on admin approve) a separate local active overlay / suppress list.
 */

import { normalizeSpot } from './geojson'
import type { ParkingSpot, SpotType } from '../types'

export type ParkingRequestType = 'PROPOSE_NEW' | 'REPORT_INVALID'
export type ParkingRequestStatus = 'pending' | 'approved' | 'rejected'

export type ParkingRequest = {
  id: string
  type: ParkingRequestType
  status: ParkingRequestStatus
  createdAt: string
  updatedAt: string
  /** Map pin for review */
  lat: number
  lng: number
  /** Human notes */
  note: string
  /** PROPOSE_NEW fields */
  name?: string
  proposedKind?: 'street' | 'lot'
  proposedType?: SpotType
  address?: string
  timeLimit?: string
  /** REPORT_INVALID fields */
  targetFeatureId?: string
  targetName?: string
  targetLayer?: string
  reason?: 'nonexistent' | 'blocked' | 'private' | 'other'
}

/** Approved PROPOSE_NEW → live overlay (not production geojson). */
export type ApprovedOverlaySpot = ParkingSpot

const REQUESTS_KEY = 'parkvibe_parking_requests'
const APPROVED_OVERLAYS_KEY = 'parkvibe_approved_overlays'
const SUPPRESSED_IDS_KEY = 'parkvibe_suppressed_feature_ids'

function nowIso() {
  return new Date().toISOString()
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

export function listParkingRequests(): ParkingRequest[] {
  const list = readJson<ParkingRequest[]>(REQUESTS_KEY, [])
  return Array.isArray(list) ? list : []
}

export function listPendingParkingRequests(): ParkingRequest[] {
  return listParkingRequests()
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveParkingRequests(list: ParkingRequest[]) {
  writeJson(REQUESTS_KEY, list)
}

export function enqueueParkingRequest(
  input: Omit<ParkingRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): ParkingRequest {
  const req: ParkingRequest = {
    ...input,
    id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const list = listParkingRequests()
  list.unshift(req)
  saveParkingRequests(list)
  return req
}

export function updateParkingRequestStatus(
  id: string,
  status: ParkingRequestStatus,
): ParkingRequest | null {
  const list = listParkingRequests()
  const idx = list.findIndex((r) => r.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], status, updatedAt: nowIso() }
  saveParkingRequests(list)
  return list[idx]
}

export function loadApprovedOverlays(): ApprovedOverlaySpot[] {
  const list = readJson<ApprovedOverlaySpot[]>(APPROVED_OVERLAYS_KEY, [])
  if (!Array.isArray(list)) return []
  return list.map((s) => normalizeSpot(s))
}

export function saveApprovedOverlays(spots: ApprovedOverlaySpot[]) {
  writeJson(APPROVED_OVERLAYS_KEY, spots)
}

export function loadSuppressedFeatureIds(): Set<string> {
  const list = readJson<string[]>(SUPPRESSED_IDS_KEY, [])
  return new Set(Array.isArray(list) ? list : [])
}

export function saveSuppressedFeatureIds(ids: Set<string>) {
  writeJson(SUPPRESSED_IDS_KEY, [...ids])
}

/**
 * Admin Approve — merge into local active layer only.
 * Never writes public/data/*.geojson.
 */
export function approveParkingRequest(id: string): {
  ok: boolean
  message: string
  request?: ParkingRequest
} {
  const list = listParkingRequests()
  const req = list.find((r) => r.id === id)
  if (!req) return { ok: false, message: 'Päringut ei leitud' }
  if (req.status !== 'pending') {
    return { ok: false, message: `Juba ${req.status}` }
  }

  if (req.type === 'PROPOSE_NEW') {
    const spot = normalizeSpot({
      id: `approved-${req.id}`,
      name: req.name || 'Kasutaja ettepanek',
      type: req.proposedType || 'free',
      kind: req.proposedKind || 'street',
      badge: req.proposedType === 'timed' ? 'KELLAGA' : 'TASUTA',
      timeLimit: req.timeLimit || 'Kontrolli silti',
      lat: req.lat,
      lng: req.lng,
      address: req.address || `${req.lat.toFixed(5)}, ${req.lng.toFixed(5)}`,
      desc: req.note || 'Moderaatori kinnitatud ettepanek',
      custom: true,
      landmark: true,
      layer:
        req.proposedType === 'timed'
          ? 'timed'
          : req.proposedType === 'free'
            ? 'free_street'
            : 'municipal',
    })
    const overlays = loadApprovedOverlays()
    overlays.push(spot)
    saveApprovedOverlays(overlays)
  } else if (req.type === 'REPORT_INVALID') {
    if (!req.targetFeatureId) {
      return { ok: false, message: 'Puudub targetFeatureId' }
    }
    const suppressed = loadSuppressedFeatureIds()
    suppressed.add(req.targetFeatureId)
    saveSuppressedFeatureIds(suppressed)
  }

  updateParkingRequestStatus(id, 'approved')
  return { ok: true, message: 'Kinnitatud', request: { ...req, status: 'approved' } }
}

export function rejectParkingRequest(id: string): {
  ok: boolean
  message: string
} {
  const updated = updateParkingRequestStatus(id, 'rejected')
  if (!updated) return { ok: false, message: 'Päringut ei leitud' }
  return { ok: true, message: 'Tagasi lükatud' }
}

/** Official DB check helper — look up feature id in loaded spot lists. */
export function officialDbLookup(
  featureId: string | undefined,
  spots: ParkingSpot[],
): ParkingSpot | null {
  if (!featureId) return null
  return spots.find((s) => s.id === featureId) ?? null
}
