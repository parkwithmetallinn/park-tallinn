import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { Marker, Polygon, Popup, Tooltip, useMap } from 'react-leaflet'
import { distanceMeters, formatDistance } from '../lib/geo'
import { TYPE_COLORS } from '../lib/parking'
import type { PaidZone, ParkingSpot } from '../types'

function pinIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin" style="background-color:${color}">${label}</div>`,
    iconSize: [88, 28],
    iconAnchor: [44, 14],
  })
}

function userIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:16px;height:16px">
      <div class="user-pulse"></div>
      <div style="width:16px;height:16px;border-radius:9999px;background:#0E7490;border:3px solid #fff;box-shadow:0 0 10px rgba(0,0,0,.25);position:relative;z-index:1"></div>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

function ZoomControl() {
  const map = useMap()
  useEffect(() => {
    const ctrl = L.control.zoom({ position: 'topright' })
    ctrl.addTo(map)
    return () => {
      ctrl.remove()
    }
  }, [map])
  return null
}

export function MapLayers({
  spots,
  zones,
  userLocation,
  onNavigate,
  distanceFrom,
}: {
  spots: ParkingSpot[]
  zones: PaidZone[]
  userLocation: [number, number]
  dark: boolean
  onNavigate: (spot: ParkingSpot) => void
  distanceFrom: [number, number]
}) {
  const userMarkerIcon = useMemo(() => userIcon(), [])

  return (
    <>
      <ZoomControl />
      {zones.map((zone) => (
        <Polygon
          key={zone.name}
          positions={zone.coords}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: 0.16,
            weight: 2,
            dashArray: '5 5',
          }}
        >
          <Tooltip sticky>
            <strong>{zone.name}</strong>
            <br />
            {zone.note}
          </Tooltip>
        </Polygon>
      ))}

      {spots.map((spot) => {
        const color = TYPE_COLORS[spot.type]
        const dist = formatDistance(
          distanceMeters(distanceFrom[0], distanceFrom[1], spot.lat, spot.lng),
        )
        return (
          <Marker
            key={spot.id}
            position={[spot.lat, spot.lng]}
            icon={pinIcon(color, spot.badge)}
          >
            <Popup>
              <div className="min-w-[230px] space-y-2.5 rounded-2xl border border-ink/10 bg-paper p-3.5 text-ink shadow-xl">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white uppercase"
                    style={{ backgroundColor: color }}
                  >
                    {spot.badge}
                  </span>
                  <span className="rounded-lg border border-sea/20 bg-sea/10 px-2 py-0.5 text-xs font-bold text-sea">
                    {dist}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm leading-tight font-bold">{spot.name}</h4>
                  <p className="mt-0.5 text-xs text-ink-soft">{spot.address}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-moss">
                    {spot.kind === 'street' ? 'Tänavaäärne' : 'Avalik parkla'} · {spot.timeLimit}
                  </p>
                </div>
                <p className="rounded-xl border border-ink/5 bg-paper-2 p-2 text-xs text-ink-soft">
                  {spot.desc}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(spot)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-moss py-2 text-xs font-bold text-white shadow transition hover:bg-moss-deep"
                >
                  Navigeeri
                </button>
              </div>
            </Popup>
          </Marker>
        )
      })}

      <Marker position={userLocation} icon={userMarkerIcon}>
        <Tooltip direction="top">Sinu asukoht</Tooltip>
      </Marker>
    </>
  )
}
