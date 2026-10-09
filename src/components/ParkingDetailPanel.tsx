/**
 * Left parking-lot detail panel (desktop rail / mobile sheet).
 * Owns the crowd-report modal opened from "Parkla on täis" / "Teavita veast".
 * Session form lives inside this panel when a lot is selected —
 * exclusive of the floating clock FAB modal (`ParkingSessionModal`).
 * Star toggle saves the lot to localStorage favorites (`parkvibe_favorites`).
 *
 * Mobile: renders as a bottom sheet (z-30) with solid panel + dim backdrop
 * via InfoSidePanelShell — FABs / filter chips are faded by App when open.
 */

import { useState } from 'react'
import { useFavorites } from '../hooks/useFavorites'
import {
  CrowdReportModal,
  type CrowdStatusType,
} from './CrowdReportModal'
import {
  ParkingBottomSheet,
  type PanelRouteSummary,
} from './ParkingBottomSheet'
import type { AlternativeParking } from '../lib/alternatives'
import type { ActiveParkingSession } from '../lib/parkingSession'
import type { ParkingSpot } from '../types'

export type { PanelRouteSummary }

type CrowdOpen = {
  initialStatus: CrowdStatusType
} | null

export function ParkingDetailPanel({
  spot,
  onMarkFull,
  onReportInvalid: _onReportInvalid,
  onCrowdReportSuccess,
  ...rest
}: {
  spot: ParkingSpot
  distanceLabel?: string | null
  carNumber: string
  onCarNumberChange: (value: string) => void
  sessionLoading?: boolean
  sessionAction?: 'start' | 'stop' | 'status' | 'extend' | null
  activeSession?: ActiveParkingSession | null
  sessionNotice?: {
    kind: 'success' | 'error' | 'info' | 'loading'
    text: string
  } | null
  routeSummary?: PanelRouteSummary | null
  onClearRoute?: () => void
  dark?: boolean
  onClose: () => void
  onBackToList?: () => void
  onStartSession: () => void
  onStopSession: () => void
  onCheckStatus: () => void
  onExtendMinutes?: (minutes: number) => void
  /** Legacy ReportModal path — crowd modal replaces this entry point. */
  onReportInvalid?: () => void
  alternatives?: AlternativeParking[]
  noAlternatives?: boolean
  isFull?: boolean
  onFindAnother?: () => void
  onMarkFull?: () => void
  onWidenRadius?: () => void
  onSelectAlternative?: (spot: ParkingSpot) => void
  /** Toast + local full-mark after successful crowd submit. */
  onCrowdReportSuccess?: (payload: {
    statusType: CrowdStatusType
    comment: string
    message: string
  }) => void
}) {
  void _onReportInvalid
  const [crowdOpen, setCrowdOpen] = useState<CrowdOpen>(null)
  const { isFavorite, toggleFavorite } = useFavorites()
  const favorited = isFavorite(spot.id)

  return (
    <div data-testid="parking-detail-panel" className="contents">
      <ParkingBottomSheet
        spot={spot}
        {...rest}
        isFavorite={favorited}
        onToggleFavorite={() => toggleFavorite(spot.id)}
        onMarkFull={
          onMarkFull || onCrowdReportSuccess
            ? () => setCrowdOpen({ initialStatus: 'full' })
            : undefined
        }
        onReportInvalid={() =>
          setCrowdOpen({ initialStatus: 'prices' })
        }
      />

      {crowdOpen ? (
        <CrowdReportModal
          spot={spot}
          dark={rest.dark}
          initialStatus={crowdOpen.initialStatus}
          onClose={() => setCrowdOpen(null)}
          onSuccess={(payload) => {
            onCrowdReportSuccess?.(payload)
          }}
        />
      ) : null}
    </div>
  )
}
