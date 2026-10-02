import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastState } from '../components/Toast'
import {
  enqueueOfflineAction,
  isBrowserOnline,
  registerOfflineProcessor,
  type QueuedAction,
} from '../lib/offlineQueue'
import {
  activeSessionFromDetails,
  checkParkingStatus,
  formatHourlyRate,
  formatSessionFeedbackDetail,
  formatSessionInstant,
  isActiveSessionStatus,
  listActiveParkingSessions,
  outcomeToResponse,
  sessionHourlyRate,
  sessionStartIso,
  startParkingSession,
  stopParkingSession,
  type ActiveParkingSession,
  type ParkingSessionDetails,
  type SessionOutcome,
} from '../lib/parkingSession'
import { parkingQueryKeys, queryClient } from '../lib/queryClient'
import {
  loadActiveSession,
  loadCarNumber,
  loadTimerState,
  prepaidSecondsRemaining,
  saveActiveSession,
  saveCarNumber,
  saveTimerState,
  type TimerMode,
} from '../lib/storage'
import type { ParkingSpot } from '../types'

const SYNC_THROTTLE_MS = 15_000
const DEFAULT_TIMER_LABEL = 'Määra aeg või vali kellaga koht'

export type SessionNotice = {
  kind: 'success' | 'error' | 'info' | 'loading'
  text: string
} | null

export type SessionAction = 'start' | 'stop' | 'status' | 'extend' | null

type SessionSnapshot = {
  activeSession: ActiveParkingSession | null
  timerSeconds: number
  timerRunning: boolean
  timerMode: TimerMode
  timerLabel: string
  timerOpen: boolean
  endsAt: string | null
}

export function useParkingSession(selected: ParkingSpot | null) {
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerMode, setTimerMode] = useState<TimerMode>('elapsed')
  const [timerLabel, setTimerLabel] = useState(DEFAULT_TIMER_LABEL)
  const [timerOpen, setTimerOpen] = useState(false)
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [carNumber, setCarNumber] = useState('')
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionAction, setSessionAction] = useState<SessionAction>(null)
  const [activeSession, setActiveSession] = useState<ActiveParkingSession | null>(
    null,
  )
  const [sessionNotice, setSessionNotice] = useState<SessionNotice>(null)
  const [sessionsOverviewOpen, setSessionsOverviewOpen] = useState(false)
  const [activeSessionsList, setActiveSessionsList] = useState<
    ParkingSessionDetails[]
  >([])
  const [activeSessionsCount, setActiveSessionsCount] = useState<
    number | undefined
  >()
  const [activeSessionsMessage, setActiveSessionsMessage] = useState<
    string | undefined
  >()
  const [toast, setToast] = useState<ToastState>(null)
  /** Small persistent notice when status sync fails (never clears the session). */
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null)

  const sessionSnapshotRef = useRef<SessionSnapshot | null>(null)
  const lastSyncAtRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const notFoundToastShownRef = useRef(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const dismissToast = useCallback(() => setToast(null), [])

  const persistActive = useCallback((session: ActiveParkingSession | null) => {
    setActiveSession(session)
    saveActiveSession(session)
  }, [])

  const persistTimer = useCallback(
    (mode: TimerMode, nextEndsAt: string | null) => {
      setTimerMode(mode)
      setEndsAt(nextEndsAt)
      saveTimerState(
        mode === 'prepaid' && nextEndsAt
          ? { mode: 'prepaid', endsAt: nextEndsAt }
          : { mode, endsAt: nextEndsAt },
      )
    },
    [],
  )

  const clearLocalSession = useCallback(
    (label = DEFAULT_TIMER_LABEL) => {
      persistActive(null)
      setTimerRunning(false)
      setTimerSeconds(0)
      persistTimer('elapsed', null)
      setTimerLabel(label)
      notFoundToastShownRef.current = false
    },
    [persistActive, persistTimer],
  )

  const startElapsedTimer = useCallback(
    (startedAt?: string, label?: string) => {
      const iso = startedAt || new Date().toISOString()
      const startMs = Date.parse(iso)
      persistTimer('elapsed', null)
      setTimerSeconds(
        Number.isFinite(startMs)
          ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
          : 0,
      )
      setTimerRunning(true)
      setTimerOpen(true)
      if (label) setTimerLabel(label)
    },
    [persistTimer],
  )

  const showSessionFeedback = useCallback(
    (
      kind: 'success' | 'error' | 'info' | 'loading',
      title: string,
      detail?: string,
    ) => {
      const text = detail ? `${title} — ${detail}` : title
      setSessionNotice({ kind, text })
      setToast({ kind, title, detail })
    },
    [],
  )

  const clearSessionFeedback = useCallback(() => {
    setSessionNotice(null)
    setToast(null)
  }, [])

  const captureSessionSnapshot = useCallback(() => {
    sessionSnapshotRef.current = {
      activeSession,
      timerSeconds,
      timerRunning,
      timerMode,
      timerLabel,
      timerOpen,
      endsAt,
    }
  }, [
    activeSession,
    timerSeconds,
    timerRunning,
    timerMode,
    timerLabel,
    timerOpen,
    endsAt,
  ])

  const rollbackSessionSnapshot = useCallback(() => {
    const snap = sessionSnapshotRef.current
    if (!snap) return
    persistActive(snap.activeSession)
    setTimerSeconds(snap.timerSeconds)
    setTimerRunning(snap.timerRunning)
    persistTimer(snap.timerMode, snap.endsAt)
    setTimerLabel(snap.timerLabel)
    setTimerOpen(snap.timerOpen)
    sessionSnapshotRef.current = null
  }, [persistActive, persistTimer])

  const applyActiveDetails = useCallback(
    (
      details: ParkingSessionDetails,
      fallback?: Partial<ActiveParkingSession>,
    ) => {
      const synced = activeSessionFromDetails(details, {
        carNumber: fallback?.carNumber,
        zone: fallback?.zone,
        spotName: fallback?.spotName ?? selectedRef.current?.name,
        hourlyRate: fallback?.hourlyRate,
        startedAt: fallback?.startedAt,
        status: fallback?.status,
      })
      if (!synced) return null
      persistActive(synced)
      const rateLabel = formatHourlyRate(synced.hourlyRate)
      setTimerLabel(
        `Sessioon: ${synced.spotName ?? synced.zone} · ${synced.carNumber}${
          rateLabel ? ` · ${rateLabel}` : ''
        }`,
      )
      setTimerOpen(true)
      if (synced.carNumber !== carNumber.trim().toUpperCase()) {
        setCarNumber(synced.carNumber)
        saveCarNumber(synced.carNumber)
      }
      setConnectionNotice(null)
      return synced
    },
    [carNumber, persistActive],
  )

  /**
   * Server-authoritative status sync for a local session.
   * ACTIVE → sync; NOT_FOUND → clear + one info toast; ERROR → keep local + notice.
   */
  const syncLocalSessionFromServer = useCallback(
    async (opts?: { force?: boolean }) => {
      const local = loadActiveSession()
      if (!local?.carNumber) return

      const now = Date.now()
      if (
        !opts?.force &&
        (syncInFlightRef.current || now - lastSyncAtRef.current < SYNC_THROTTLE_MS)
      ) {
        return
      }
      syncInFlightRef.current = true
      lastSyncAtRef.current = now

      try {
        const outcome = await checkParkingStatus({ carNumber: local.carNumber })

        if (outcome.kind === 'ACTIVE') {
          const synced = applyActiveDetails(outcome.details, local)
          if (synced && timerMode === 'elapsed') {
            startElapsedTimer(
              synced.startedAt || local.startedAt,
              `Sessioon: ${synced.spotName ?? synced.zone} · ${synced.carNumber}${
                formatHourlyRate(synced.hourlyRate)
                  ? ` · ${formatHourlyRate(synced.hourlyRate)}`
                  : ''
              }`,
            )
          }
          return
        }

        if (outcome.kind === 'NOT_FOUND') {
          clearLocalSession()
          setTimerOpen(false)
          if (!notFoundToastShownRef.current) {
            notFoundToastShownRef.current = true
            setToast({
              kind: 'info',
              title: 'Aktiivset parkimist pole',
              detail: outcome.message || 'Kohalik sessioon eemaldati',
            })
            setSessionNotice({
              kind: 'info',
              text: outcome.message
                ? `Aktiivset parkimist pole — ${outcome.message}`
                : 'Aktiivset parkimist pole',
            })
          }
          return
        }

        // ERROR — keep local state
        setConnectionNotice('Ühendus puudub')
        setSessionNotice({
          kind: 'info',
          text: `Ühendus puudub — ${outcome.message}`,
        })
      } finally {
        syncInFlightRef.current = false
      }
    },
    [applyActiveDetails, clearLocalSession, startElapsedTimer, timerMode],
  )

  // Boot: restore local session + timer; then sync with server
  useEffect(() => {
    setCarNumber(loadCarNumber())
    const saved = loadActiveSession()
    const timer = loadTimerState()

    if (saved) {
      setActiveSession(saved)
      setTimerOpen(true)
      if (timer?.mode === 'prepaid' && timer.endsAt) {
        const remaining = prepaidSecondsRemaining(timer.endsAt)
        persistTimer('prepaid', timer.endsAt)
        setTimerSeconds(remaining)
        setTimerRunning(remaining > 0)
        setTimerLabel(
          remaining > 0
            ? `Ettemaks · ${saved.carNumber}`
            : 'Aeg läbi! Liiguta autot või pikenda',
        )
      } else {
        persistTimer('elapsed', null)
        setTimerRunning(true)
        setTimerLabel(
          `Sessioon: ${saved.spotName ?? saved.zone} · ${saved.carNumber}`,
        )
        if (saved.startedAt) {
          const startMs = Date.parse(saved.startedAt)
          if (Number.isFinite(startMs)) {
            setTimerSeconds(
              Math.max(0, Math.floor((Date.now() - startMs) / 1000)),
            )
          }
        }
      }
      void syncLocalSessionFromServer({ force: true })
    } else if (timer) {
      saveTimerState(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, [])

  // Focus / visibility sync (throttled ≤1 / 15s)
  useEffect(() => {
    const onFocus = () => {
      void syncLocalSessionFromServer()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncLocalSessionFromServer()
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [syncLocalSessionFromServer])

  // Mode 1 — live duration: tick UP from session startTime
  useEffect(() => {
    if (timerMode !== 'elapsed' || !activeSession?.startedAt) return
    const startMs = Date.parse(activeSession.startedAt)
    if (!Number.isFinite(startMs)) return
    const tick = () => {
      setTimerSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerMode, activeSession?.startedAt])

  // Mode 2 — prepaid: count DOWN from absolute endsAt
  useEffect(() => {
    if (timerMode !== 'prepaid' || !timerRunning || !endsAt) return
    const tick = () => {
      const remaining = prepaidSecondsRemaining(endsAt)
      setTimerSeconds(remaining)
      if (remaining <= 0) {
        setTimerRunning(false)
        setTimerLabel('Aeg läbi! Liiguta autot või pikenda')
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerMode, timerRunning, endsAt])

  const handleCarNumberChange = useCallback((value: string) => {
    setCarNumber(value)
    saveCarNumber(value)
  }, [])

  const beginParkingSession = useCallback(async () => {
    if (!selected) return
    const zone = selected.zone_code
    const plate = carNumber.trim()
    if (!plate) {
      showSessionFeedback('error', 'Sisesta auto number')
      return
    }
    if (activeSession) {
      showSessionFeedback(
        'error',
        'Sessioon juba käib',
        `Lõpeta enne ${activeSession.carNumber} · ${activeSession.zone}`,
      )
      return
    }

    captureSessionSnapshot()
    const optimisticStartedAt = new Date().toISOString()
    const hourlyRate =
      selected.price_per_hour > 0 ? selected.price_per_hour : undefined
    const rateLabel = formatHourlyRate(hourlyRate)
    persistActive({
      carNumber: plate.toUpperCase(),
      zone,
      spotName: selected.name,
      startedAt: optimisticStartedAt,
      status: 'ACTIVE',
      hourlyRate,
    })
    startElapsedTimer(
      optimisticStartedAt,
      `Sessioon: ${selected.name} · ${plate.toUpperCase()}${
        rateLabel ? ` · ${rateLabel}` : ''
      }`,
    )
    setSessionAction('start')
    setSessionLoading(true)
    // Loading only — success toast after server ACTIVE
    showSessionFeedback('loading', 'Alustan parkimist…', `${plate} · ${zone}`)

    if (!isBrowserOnline()) {
      enqueueOfflineAction('session_start', { carNumber: plate, zone })
      setSessionLoading(false)
      setSessionAction(null)
      showSessionFeedback(
        'info',
        'Offline — salvestatud järjekorda',
        'Saadetakse ühenduse taastudes',
      )
      return
    }

    const outcome = await startParkingSession({ carNumber: plate, zone })

    setSessionLoading(false)
    setSessionAction(null)

    if (outcome.kind === 'ACTIVE') {
      const details = outcome.details
      const startedAt = sessionStartIso(details) || optimisticStartedAt
      const status = String(details.status ?? 'ACTIVE')
      const serverRate = sessionHourlyRate(details) ?? hourlyRate
      const resolvedZone = String(details.zone ?? zone)
      const resolvedPlate = String(details.carNumber ?? plate).toUpperCase()
      persistActive({
        carNumber: resolvedPlate,
        zone: resolvedZone,
        spotName: selected.name,
        startedAt,
        status,
        hourlyRate: serverRate,
      })
      if (resolvedPlate !== carNumber.trim().toUpperCase()) {
        setCarNumber(resolvedPlate)
        saveCarNumber(resolvedPlate)
      }
      const serverRateLabel = formatHourlyRate(serverRate)
      setTimerLabel(
        `Sessioon: ${selected.name} · ${resolvedPlate}${
          serverRateLabel ? ` · ${serverRateLabel}` : ''
        }`,
      )
      startElapsedTimer(
        startedAt,
        `Sessioon: ${selected.name} · ${resolvedPlate}${
          serverRateLabel ? ` · ${serverRateLabel}` : ''
        }`,
      )
      sessionSnapshotRef.current = null
      setConnectionNotice(null)
      showSessionFeedback(
        'success',
        'Parkimine alanud',
        formatSessionFeedbackDetail(outcome, [
          details.sessionId ? `ID ${details.sessionId}` : null,
        ]),
      )
      void queryClient.invalidateQueries({ queryKey: parkingQueryKeys.sessions })
      return
    }

    rollbackSessionSnapshot()
    showSessionFeedback(
      'error',
      'Sessiooni ei alustatud',
      outcome.message,
    )
  }, [
    selected,
    carNumber,
    activeSession,
    captureSessionSnapshot,
    persistActive,
    startElapsedTimer,
    showSessionFeedback,
    rollbackSessionSnapshot,
  ])

  const endParkingSession = useCallback(async () => {
    const session = activeSession
    if (!session) {
      clearLocalSession()
      clearSessionFeedback()
      return
    }

    captureSessionSnapshot()
    clearLocalSession()
    clearSessionFeedback()
    setSessionAction('stop')
    setSessionLoading(true)

    if (!isBrowserOnline()) {
      enqueueOfflineAction('session_stop', {
        carNumber: session.carNumber,
        zone: session.zone,
      })
      setSessionLoading(false)
      setSessionAction(null)
      sessionSnapshotRef.current = null
      setToast({
        kind: 'info',
        title: 'Offline — lõpetamine järjekorras',
        detail: 'Saadetakse ühenduse taastudes',
      })
      return
    }

    const outcome = await stopParkingSession({
      carNumber: session.carNumber,
      zone: session.zone,
    })

    setSessionLoading(false)
    setSessionAction(null)

    if (outcome.kind === 'NOT_FOUND') {
      // Success or already stopped — local state already cleared
      sessionSnapshotRef.current = null
      setConnectionNotice(null)
      setToast({
        kind: 'success',
        title: 'Parkimine lõpetatud',
      })
      void queryClient.invalidateQueries({ queryKey: parkingQueryKeys.sessions })
      return
    }

    // ACTIVE (stop did not clear) or ERROR — restore previous session
    rollbackSessionSnapshot()
    setToast({
      kind: 'error',
      title: 'Lõpetamine ebaõnnestus',
      detail: outcome.message || 'Proovi uuesti',
    })
  }, [
    activeSession,
    clearLocalSession,
    clearSessionFeedback,
    captureSessionSnapshot,
    rollbackSessionSnapshot,
  ])

  const loadActiveSessionsOverview = useCallback(async () => {
    setSessionLoading(true)
    setSessionAction('status')
    if (activeSessionsList.length === 0) {
      setSessionsOverviewOpen(true)
    }

    const cached = queryClient.getQueryData<{
      success: boolean
      activeSessions?: ParkingSessionDetails[]
      count?: number
      message?: string
    }>(parkingQueryKeys.sessions)
    if (cached?.success && cached.activeSessions) {
      setActiveSessionsList(cached.activeSessions)
      setActiveSessionsCount(cached.count ?? cached.activeSessions.length)
      setActiveSessionsMessage(cached.message)
      setSessionsOverviewOpen(true)
    }

    const outcome = await queryClient.fetchQuery({
      queryKey: parkingQueryKeys.sessions,
      queryFn: async () => {
        const o = await listActiveParkingSessions()
        return outcomeToResponse(o)
      },
      staleTime: 15_000,
    })

    setSessionLoading(false)
    setSessionAction(null)

    // Re-derive outcome-ish from cached response for UI
    const list = outcome.activeSessions ?? []
    if (!outcome.success && list.length === 0) {
      if (activeSessionsList.length === 0) {
        showSessionFeedback(
          'error',
          'Sessioonide nimekiri ebaõnnestus',
          outcome.message,
        )
      } else {
        setToast({
          kind: 'error',
          title: 'Värskendus ebaõnnestus',
          detail: outcome.message,
        })
      }
      return
    }

    const count = outcome.count ?? list.length
    setActiveSessionsList(list)
    setActiveSessionsCount(count)
    setActiveSessionsMessage(outcome.message)
    setSessionsOverviewOpen(true)

    const plate = (carNumber.trim() || activeSession?.carNumber || '').toUpperCase()
    if (plate) {
      const activeMine = list.find(
        (s) =>
          String(s.carNumber ?? '').toUpperCase() === plate &&
          isActiveSessionStatus(s),
      )
      if (activeMine) {
        applyActiveDetails(activeMine, {
          carNumber: plate,
          spotName: activeSession?.spotName ?? selectedRef.current?.name,
        })
      }
    }

    showSessionFeedback(
      'success',
      'Aktiivsed sessioonid',
      formatSessionFeedbackDetail({
        kind: 'NOT_FOUND',
        message: outcome.message || 'Aktiivseid sessioone pole',
        activeSessions: list,
        count,
      }),
    )
  }, [
    activeSessionsList.length,
    carNumber,
    activeSession,
    showSessionFeedback,
    applyActiveDetails,
  ])

  /**
   * Status ONLY — show exactly what the server said.
   * No local "taimer jätkub" fallback when server did not confirm ACTIVE.
   */
  const refreshParkingStatus = useCallback(async () => {
    const plate = (carNumber.trim() || activeSession?.carNumber || '').trim()

    if (!plate) {
      await loadActiveSessionsOverview()
      return
    }

    const timerWasRunning = timerRunning
    const timerModeBefore = timerMode

    setSessionLoading(true)
    setSessionAction('status')
    showSessionFeedback('loading', 'Kontrollin parkimise staatust…', plate)

    try {
      const outcome = await checkParkingStatus({ carNumber: plate })

      if (outcome.kind === 'ACTIVE') {
        const synced = applyActiveDetails(outcome.details, {
          carNumber: plate,
          zone: activeSession?.zone || selectedRef.current?.zone_code,
          spotName: activeSession?.spotName ?? selectedRef.current?.name,
          hourlyRate: activeSession?.hourlyRate,
          startedAt: activeSession?.startedAt,
          status: activeSession?.status,
        })
        if (synced && !timerWasRunning) {
          if (timerModeBefore === 'elapsed' || !timerModeBefore) {
            startElapsedTimer(synced.startedAt || activeSession?.startedAt)
          }
        }
        showSessionFeedback(
          'success',
          'Aktiivne parkimine',
          formatSessionFeedbackDetail(outcome),
        )
        return
      }

      if (outcome.kind === 'NOT_FOUND') {
        if (activeSession) {
          clearLocalSession()
          setTimerOpen(false)
        }
        showSessionFeedback(
          'info',
          'Aktiivset parkimist pole',
          outcome.message || 'Sellel autol pole aktiivset parkimist',
        )
        return
      }

      // ERROR — keep local state; show server/error message only
      setConnectionNotice('Ühendus puudub')
      showSessionFeedback('error', 'Staatuse päring ebaõnnestus', outcome.message)
    } catch (err) {
      setConnectionNotice('Ühendus puudub')
      showSessionFeedback(
        'error',
        'Staatuse päring ebaõnnestus',
        err instanceof Error ? err.message : 'Võrgu viga',
      )
    } finally {
      setSessionLoading(false)
      setSessionAction(null)
      if (timerWasRunning) {
        setTimerRunning(true)
        setTimerMode(timerModeBefore)
      }
    }
  }, [
    carNumber,
    activeSession,
    timerRunning,
    timerMode,
    loadActiveSessionsOverview,
    showSessionFeedback,
    applyActiveDetails,
    startElapsedTimer,
    clearLocalSession,
  ])

  /**
   * Local prepaid countdown only.
   * TODO: server "extend" action is not implemented on n8n — do not call webhook.
   */
  const addPrepaidMinutes = useCallback(
    (minutes: number) => {
      if (minutes <= 0) return

      const baseMs =
        timerMode === 'prepaid' && endsAt
          ? Math.max(Date.parse(endsAt), Date.now())
          : Date.now()
      const nextEndsAt = new Date(baseMs + minutes * 60 * 1000).toISOString()
      persistTimer('prepaid', nextEndsAt)
      setTimerSeconds(prepaidSecondsRemaining(nextEndsAt))
      setTimerRunning(true)
      setTimerOpen(true)
      setTimerLabel(
        activeSession
          ? `Ettemaks +${minutes} min · ${activeSession.carNumber}`
          : `Ettemaks +${minutes} min`,
      )

      // TODO: n8n has no "extend" action — prepaid time is local-only until the
      // webhook gains a real extend branch. Do not enqueue or POST extend.
      showSessionFeedback(
        'info',
        `Lisatud ${minutes} min`,
        activeSession
          ? `Kohalik taimer · ${activeSession.carNumber}`
          : 'Kohalik taimer (sessioon puudub)',
      )
    },
    [
      timerMode,
      endsAt,
      activeSession,
      persistTimer,
      showSessionFeedback,
    ],
  )

  const adoptListedSession = useCallback(
    (details: ParkingSessionDetails) => {
      const synced = applyActiveDetails(details, {
        spotName: activeSession?.spotName ?? selectedRef.current?.name,
      })
      if (!synced) return
      startElapsedTimer(
        synced.startedAt,
        `Sessioon: ${synced.zone} · ${synced.carNumber}${
          formatHourlyRate(synced.hourlyRate)
            ? ` · ${formatHourlyRate(synced.hourlyRate)}`
            : ''
        }`,
      )
      setSessionsOverviewOpen(false)
      showSessionFeedback(
        'success',
        'Sessioon valitud',
        `${synced.carNumber} · ${synced.zone}${
          formatHourlyRate(synced.hourlyRate)
            ? ` · ${formatHourlyRate(synced.hourlyRate)}`
            : ''
        }`,
      )
    },
    [activeSession, applyActiveDetails, startElapsedTimer, showSessionFeedback],
  )

  // Offline queue processor — drains FIFO on reconnect
  useEffect(() => {
    registerOfflineProcessor(async (action: QueuedAction) => {
      if (action.type === 'session_start') {
        const plate = String(action.payload.carNumber ?? '')
        const zone = String(action.payload.zone ?? '')
        if (!plate || !zone) return true
        const outcome = await startParkingSession({ carNumber: plate, zone })
        return outcome.kind === 'ACTIVE'
      }
      if (action.type === 'session_stop') {
        const plate = String(action.payload.carNumber ?? '')
        const zone = String(action.payload.zone ?? '')
        if (!plate || !zone) return true
        const outcome = await stopParkingSession({ carNumber: plate, zone })
        return outcome.kind === 'NOT_FOUND' || outcome.kind === 'ACTIVE'
      }
      if (action.type === 'session_extend') {
        // TODO: server has no extend — drop stale queued extends
        return true
      }
      return true
    })
  }, [])

  return {
    carNumber,
    handleCarNumberChange,
    timerSeconds,
    timerRunning,
    timerMode,
    timerLabel,
    timerOpen,
    setTimerOpen,
    sessionLoading,
    sessionAction,
    activeSession,
    sessionNotice,
    sessionsOverviewOpen,
    setSessionsOverviewOpen,
    activeSessionsList,
    activeSessionsCount,
    activeSessionsMessage,
    toast,
    setToast,
    dismissToast,
    connectionNotice,
    beginParkingSession,
    endParkingSession,
    refreshParkingStatus,
    loadActiveSessionsOverview,
    addPrepaidMinutes,
    adoptListedSession,
    formatHourlyRate,
    formatSessionInstant,
  }
}

/** Re-export for App convenience */
export type { SessionOutcome }
