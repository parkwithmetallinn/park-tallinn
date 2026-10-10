/**
 * Left parking-lot detail panel (desktop rail / mobile sheet).
 * Owns the crowd-report modal opened from "Teata muust".
 * One-tap "Täis" is handled by the parent via onMarkFull (no modal).
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
  sessionLoading?: boolean
  sessionAction?: 'start' | 'stop' | 'status' | 'extend' | null
  activeSession?: ActiveParkingSession | null
  sessionNotice?: {
    kind: 'success' | 'error' | 'info' | 'loading'
    text: string
  } | null
  priceEstimate?: string | null
  routeSummary?: PanelRouteSummary | null
  onClearRoute?: () => void
  dark?: boolean
  onClose: () => void
  onBackToList?: () => void
  onStartSession: () => void
  onStopSession: () => void
  onCheckStatus: () => void
  onExtendMinutes?: (minutes: number) => void
  onReportInvalid?: () => void
  alternatives?: AlternativeParking[]
  noAlternatives?: boolean
  isFull?: boolean
  communityReportLabel?: string | null
  reportCooldownActive?: boolean
  onFindAnother?: () => void
  onMarkFull?: () => void
  onWidenRadius?: () => void
  onSelectAlternative?: (spot: ParkingSpot) => void
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
        onMarkFull={onMarkFull}
        onReportOther={() => setCrowdOpen({ initialStatus: 'free' })}
        onReportInvalid={() => setCrowdOpen({ initialStatus: 'free' })}
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
