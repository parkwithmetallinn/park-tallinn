import {
  ArrowLeft,
  Check,
  ExternalLink,
  RefreshCw,
  Satellite,
  Shield,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  approveParkingRequest,
  listParkingRequests,
  listPendingParkingRequests,
  loadApprovedOverlays,
  loadSuppressedFeatureIds,
  officialDbLookup,
  rejectParkingRequest,
  type ParkingRequest,
} from '../lib/parkingRequests'
import { loadParkingPolygons, preciseCollectionToSpots } from '../lib/preciseParkingPolygons'
import { loadStreetParking, streetCollectionToSpots } from '../lib/streetParkingLines'
import type { ParkingSpot } from '../types'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(maplibreWorker)

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    esri: {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Esri World Imagery',
    },
  },
  layers: [{ id: 'esri', type: 'raster' as const, source: 'esri' }],
}

function reasonLabel(r?: string) {
  switch (r) {
    case 'nonexistent':
      return 'Olematu / vale'
    case 'blocked':
      return 'Blokeeritud'
    case 'private':
      return 'Eravaldus'
    default:
      return r || '—'
  }
}

export function AdminReviewView() {
  const [requests, setRequests] = useState<ParkingRequest[]>(() => listParkingRequests())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [officialSpots, setOfficialSpots] = useState<ParkingSpot[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [stats, setStats] = useState({ overlays: 0, suppressed: 0 })
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)

  const pending = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests],
  )
  const selected =
    requests.find((r) => r.id === selectedId) ?? pending[0] ?? requests[0] ?? null

  const refresh = () => {
    setRequests(listParkingRequests())
    setStats({
      overlays: loadApprovedOverlays().length,
      suppressed: loadSuppressedFeatureIds().size,
    })
  }

  useEffect(() => {
    refresh()
    void Promise.all([loadParkingPolygons(), loadStreetParking()])
      .then(([poly, street]) => {
        setOfficialSpots([
          ...preciseCollectionToSpots(poly),
          ...streetCollectionToSpots(street),
        ])
      })
      .catch(() => {
        /* offline / missing data */
      })
  }, [])

  useEffect(() => {
    if (!selected && pending[0]) setSelectedId(pending[0].id)
  }, [pending, selected])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = new MapLibreMap({
      container: mapEl.current,
      style: SATELLITE_STYLE,
      center: [24.7536, 59.437],
      zoom: 16,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right')
    mapRef.current = map
    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected) return
    map.flyTo({ center: [selected.lng, selected.lat], zoom: 17.5, essential: true })
    if (!markerRef.current) {
      markerRef.current = new Marker({ color: '#FF3B30' })
        .setLngLat([selected.lng, selected.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([selected.lng, selected.lat])
    }
  }, [selected])

  const dbHit = selected
    ? officialDbLookup(selected.targetFeatureId, officialSpots)
    : null

  const onApprove = () => {
    if (!selected || selected.status !== 'pending') return
    const res = approveParkingRequest(selected.id)
    setToast(res.message)
    refresh()
  }

  const onReject = () => {
    if (!selected || selected.status !== 'pending') return
    const res = rejectParkingRequest(selected.id)
    setToast(res.message)
    refresh()
  }

  return (
    <div className="flex h-dvh flex-col bg-[#0B1220] text-[#F5F5F7]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/15"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kaart
          </a>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Shield className="h-4 w-4 text-[#22C55E]" />
              ParkVibe Admin / Review
            </p>
            <p className="text-[11px] text-white/55">
              {pending.length} ootel · overlay {stats.overlays} · suppressed {stats.suppressed}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/15"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Värskenda
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-b border-white/10 lg:border-r lg:border-b-0">
          <div className="space-y-2 p-3">
            {requests.length === 0 ? (
              <p className="rounded-xl bg-white/5 px-3 py-4 text-center text-xs text-white/60">
                Ootel päringuid pole. Kasuta kaardil “+” või “Teavita veast”.
              </p>
            ) : (
              requests.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    selected?.id === r.id
                      ? 'bg-[#22C55E]/20 ring-1 ring-[#22C55E]/50'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                        r.type === 'PROPOSE_NEW'
                          ? 'bg-[#22C55E]/25 text-[#86EFAC]'
                          : 'bg-[#FF3B30]/25 text-[#FCA5A5]'
                      }`}
                    >
                      {r.type}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        r.status === 'pending'
                          ? 'text-amber-300'
                          : r.status === 'approved'
                            ? 'text-emerald-300'
                            : 'text-white/40'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[13px] font-semibold">
                    {r.type === 'PROPOSE_NEW' ? r.name : r.targetName || r.targetFeatureId}
                  </p>
                  <p className="truncate text-[10px] text-white/45">
                    {new Date(r.createdAt).toLocaleString('et-EE')}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="relative min-h-[240px] flex-1">
            <div ref={mapEl} className="absolute inset-0" />
            <div className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
              <Satellite className="h-3 w-3" />
              Satellite lookup
            </div>
          </div>

          {selected ? (
            <div className="space-y-3 border-t border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">
                    {selected.type === 'PROPOSE_NEW'
                      ? selected.name
                      : selected.targetName || 'Vea teade'}
                  </p>
                  <p className="text-[11px] text-white/55">
                    {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)} · {selected.type}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=18/${selected.lat}/${selected.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-white/15"
                  >
                    OSM <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=map&center=${selected.lat},${selected.lng}&zoom=19`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-white/15"
                  >
                    Google <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-white/5 px-3 py-2.5 text-[12px]">
                  <p className="text-[10px] font-bold tracking-wide text-white/40 uppercase">
                    Päring
                  </p>
                  {selected.type === 'PROPOSE_NEW' ? (
                    <p className="mt-1 leading-snug">
                      {selected.proposedType} · {selected.proposedKind}
                      {selected.address ? ` · ${selected.address}` : ''}
                      {selected.timeLimit ? ` · ${selected.timeLimit}` : ''}
                    </p>
                  ) : (
                    <p className="mt-1 leading-snug">
                      Põhjus: {reasonLabel(selected.reason)}
                      <br />
                      ID: <span className="font-mono text-[11px]">{selected.targetFeatureId}</span>
                    </p>
                  )}
                  {selected.note ? (
                    <p className="mt-1 text-white/70">{selected.note}</p>
                  ) : null}
                </div>
                <div className="rounded-xl bg-white/5 px-3 py-2.5 text-[12px]">
                  <p className="text-[10px] font-bold tracking-wide text-white/40 uppercase">
                    Ametlik andmebaas
                  </p>
                  {selected.type === 'REPORT_INVALID' ? (
                    dbHit ? (
                      <p className="mt-1 leading-snug text-amber-200">
                        Leitud aktiivses kihis: {dbHit.name} · {dbHit.layer} ·{' '}
                        {dbHit.zone_code}
                      </p>
                    ) : (
                      <p className="mt-1 leading-snug text-white/55">
                        ID ei leitud praeguses polygon/street kihis (võib olla juba eemaldatud).
                      </p>
                    )
                  ) : (
                    <p className="mt-1 leading-snug text-white/55">
                      Uus ettepanek — satelliit + OSM kontroll enne kinnitamist. Kinnitamisel
                      lisandub kohalikku overlay kihti (mitte production GeoJSON).
                    </p>
                  )}
                </div>
              </div>

              {selected.status === 'pending' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onApprove}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#22C55E] py-2.5 text-sm font-bold text-white"
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={onReject}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#FF3B30] py-2.5 text-sm font-bold text-white"
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              ) : (
                <p className="text-center text-xs text-white/45">
                  Staatus: {selected.status} · ootel: {listPendingParkingRequests().length}
                </p>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {toast ? (
        <div className="fixed right-4 bottom-4 z-50 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#1C1C1E] shadow-lg">
          {toast}
          <button
            type="button"
            className="ml-2 text-[#8E8E93]"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}
