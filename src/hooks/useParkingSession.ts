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
  extendParkingSession,
  formatHourlyRate,
  formatSessionFeedbackDetail,
  formatSessionInstant,
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
  loadTimerState,
  prepaidSecondsRemaining,
  saveActiveSession,
  saveTimerState,
  type TimerMode,
} from '../lib/storage'

/** Internal marker stored on ActiveParkingSession — never a user license plate. */
const LOCAL_SESSION_ID = 'KOHALIK'
import { canStartParkingSession } from '../data/zones'
import { fetchPriceQuote } from '../lib/priceQuoteApi'
import type { ParkingSpot } from '../types'

const SYNC_THROTTLE_MS = 15_000
const DEFAULT_TIMER_LABEL = 'Määra aeg või vali kellaga koht'
/** Fire local reminder when prepaid remaining ≤ this many seconds. */
const REMINDER_THRESHOLD_SEC = 10 * 60

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
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionAction, setSessionAction] = useState<SessionAction>(null)
  const [activeSession, setActiveSession] = useState<ActiveParkingSession | null>(
    null,
  )
  const [sessionNotice, setSessionNotice] = useState<SessionNotice>(null)
  const [toast, setToast] = useState<ToastState>(null)
  /** Small persistent notice when status sync fails (never clears the session). */
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null)
  /** Live price estimate while a paid-zone session is active (hinnang, mitte arve). */
  const [priceEstimate, setPriceEstimate] = useState<string | null>(null)

  const sessionSnapshotRef = useRef<SessionSnapshot | null>(null)
  const lastSyncAtRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const notFoundToastShownRef = useRef(false)
  /** endsAt for which the 10-min reminder already fired (re-arm on new endsAt). */
  const reminderFiredForEndsAtRef = useRef<string | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const dismissToast = useCallback(() => setToast(null), [])

  const maybeFirePrepaidReminder = useCallback(
    (currentEndsAt: string | null, remainingSec: number) => {
      if (!currentEndsAt) return
      if (remainingSec <= 0 || remainingSec > REMINDER_THRESHOLD_SEC) return
      if (reminderFiredForEndsAtRef.current === currentEndsAt) return
      reminderFiredForEndsAtRef.current = currentEndsAt

      setToast({
        kind: 'info',
        title: 'Parkimisaeg lõpeb peagi',
        detail: 'Jäänud umbes 10 minutit',
      })

      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification('Parkimisaeg lõpeb peagi', {
            body: 'Jäänud umbes 10 minutit',
            tag: `parking-reminder-${currentEndsAt}`,
          })
        } catch {
          /* Notification constructor can throw on some platforms */
        }
      }
    },
    [],
  )

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
      setPriceEstimate(null)
      setTimerRunning(false)
      setTimerSeconds(0)
      persistTimer('elapsed', null)
      setTimerLabel(label)
      notFoundToastShownRef.current = false
    },
    [persistActive, persistTimer],
  )

  const refreshPriceEstimate = useCallback(async (session: ActiveParkingSession) => {
    const startTime = session.startedAt
    if (!startTime || !session.zone) {
      setPriceEstimate(null)
      return
    }
    const view = await fetchPriceQuote({
      zone: session.zone,
      startTime,
      endTime: new Date().toISOString(),
      startMarked: true,
    })
    if (view.ok) {
      setPriceEstimate(view.label)
    } else {
      setPriceEstimate(view.message)
    }
  }, [])

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
        `Sessioon: ${synced.spotName ?? synced.zone}${
          rateLabel ? ` · ${rateLabel}` : ''
        }`,
      )
      setTimerOpen(true)
      setConnectionNotice(null)
      return synced
    },
    [persistActive],
  )

  /**
   * Server-authoritative status sync for a local session.
   * ACTIVE → sync; NOT_FOUND → clear + one info toast; ERROR → keep local + notice.
   */
  const syncLocalSessionFromServer = useCallback(
    async (opts?: { force?: boolean }) => {
      const local = loadActiveSession()
      if (!local?.zone) return

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
        const outcome = await checkParkingStatus({
          carNumber: LOCAL_SESSION_ID,
        })

        if (outcome.kind === 'ACTIVE') {
          const synced = applyActiveDetails(outcome.details, local)
          if (synced && timerMode === 'elapsed') {
            startElapsedTimer(
              synced.startedAt || local.startedAt,
              `Sessioon: ${synced.spotName ?? synced.zone}${
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
            ? `Ettemaks · ${saved.spotName ?? saved.zone}`
            : 'Aeg läbi! Liiguta autot või pikenda',
        )
      } else {
        persistTimer('elapsed', null)
        setTimerRunning(true)
        setTimerLabel(
          `Sessioon: ${saved.spotName ?? saved.zone}`,
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

  // Focus / visibility sync (throttled ≤1 / 15s) + prepaid reminder recompute
  useEffect(() => {
    const onFocus = () => {
      void syncLocalSessionFromServer()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      void syncLocalSessionFromServer()
      // Mobile browsers throttle timers — recompute remaining from absolute endsAt
      if (timerMode === 'prepaid' && endsAt) {
        const remaining = prepaidSecondsRemaining(endsAt)
        setTimerSeconds(remaining)
        if (remaining <= 0) {
          setTimerRunning(false)
          setTimerLabel('Aeg läbi! Liiguta autot või pikenda')
        } else {
          setTimerRunning(true)
        }
        maybeFirePrepaidReminder(endsAt, remaining)
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [
    syncLocalSessionFromServer,
    timerMode,
    endsAt,
    maybeFirePrepaidReminder,
  ])

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

  // Mode 2 — prepaid: count DOWN from absolute endsAt + 10-min reminder
  useEffect(() => {
    if (timerMode !== 'prepaid' || !timerRunning || !endsAt) return
    const tick = () => {
      const remaining = prepaidSecondsRemaining(endsAt)
      setTimerSeconds(remaining)
      maybeFirePrepaidReminder(endsAt, remaining)
      if (remaining <= 0) {
        setTimerRunning(false)
        setTimerLabel('Aeg läbi! Liiguta autot või pikenda')
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerMode, timerRunning, endsAt, maybeFirePrepaidReminder])

  // Live price estimate while a session is active
  useEffect(() => {
    if (!activeSession?.startedAt || !activeSession.zone) {
      setPriceEstimate(null)
      return
    }
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await refreshPriceEstimate(activeSession)
    }
    void run()
    const id = window.setInterval(() => {
      void run()
    }, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [activeSession, refreshPriceEstimate])

  const beginParkingSession = useCallback(async () => {
    if (!selected) return
    const zone = selected.zone_code
    if (!canStartParkingSession(selected)) {
      showSessionFeedback(
        'info',
        'Sessiooni ei alustata',
        selected.type === 'pr' || selected.layer === 'park_ride'
          ? 'Pargi & reisi'
          : selected.type === 'timed' || selected.layer === 'timed'
            ? 'Kellaga koht'
            : 'Tasuta koht',
      )
      return
    }
    if (activeSession) {
      showSessionFeedback(
        'error',
        'Sessioon juba käib',
        `Lõpeta enne · ${activeSession.zone}`,
      )
      return
    }

    captureSessionSnapshot()
    const optimisticStartedAt = new Date().toISOString()
    const hourlyRate =
      selected.price_per_hour > 0 ? selected.price_per_hour : undefined
    const rateLabel = formatHourlyRate(hourlyRate)
    const spotLabel = selected.name || zone
    persistActive({
      carNumber: LOCAL_SESSION_ID,
      zone,
      spotName: selected.name,
      startedAt: optimisticStartedAt,
      status: 'ACTIVE',
      hourlyRate,
    })
    startElapsedTimer(
      optimisticStartedAt,
      `Sessioon: ${spotLabel}${rateLabel ? ` · ${rateLabel}` : ''}`,
    )
    setSessionAction('start')
    setSessionLoading(true)
    showSessionFeedback('loading', 'Alustan parkimist…', zone)

    if (!isBrowserOnline()) {
      enqueueOfflineAction('session_start', {
        carNumber: LOCAL_SESSION_ID,
        zone,
      })
      setSessionLoading(false)
      setSessionAction(null)
      showSessionFeedback(
        'info',
        'Offline — salvestatud järjekorda',
        'Saadetakse ühenduse taastudes',
      )
      return
    }

    const outcome = await startParkingSession({
      carNumber: LOCAL_SESSION_ID,
      zone,
    })

    setSessionLoading(false)
    setSessionAction(null)

    if (outcome.kind === 'ACTIVE') {
      const details = outcome.details
      const startedAt = sessionStartIso(details) || optimisticStartedAt
      const status = String(details.status ?? 'ACTIVE')
      const serverRate = sessionHourlyRate(details) ?? hourlyRate
      const resolvedZone = String(details.zone ?? zone)
      persistActive({
        carNumber: LOCAL_SESSION_ID,
        zone: resolvedZone,
        spotName: selected.name,
        startedAt,
        status,
        hourlyRate: serverRate,
      })
      const serverRateLabel = formatHourlyRate(serverRate)
      const label = `Sessioon: ${spotLabel}${
        serverRateLabel ? ` · ${serverRateLabel}` : ''
      }`
      setTimerLabel(label)
      startElapsedTimer(startedAt, label)
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

    const stopStartedAt = session.startedAt
    const stopZone = session.zone
    const stopEndIso = new Date().toISOString()

    captureSessionSnapshot()
    clearLocalSession()
    clearSessionFeedback()
    setSessionAction('stop')
    setSessionLoading(true)

    if (!isBrowserOnline()) {
      enqueueOfflineAction('session_stop', {
        carNumber: LOCAL_SESSION_ID,
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
      carNumber: LOCAL_SESSION_ID,
      zone: session.zone,
    })

    setSessionLoading(false)
    setSessionAction(null)

    if (outcome.kind === 'NOT_FOUND') {
      // Success or already stopped — local state already cleared
      sessionSnapshotRef.current = null
      setConnectionNotice(null)
      let detail: string | undefined
      if (stopStartedAt && stopZone) {
        const finalQuote = await fetchPriceQuote({
          zone: stopZone,
          startTime: stopStartedAt,
          endTime: stopEndIso,
          startMarked: true,
        })
        detail = finalQuote.ok
          ? `Lõpphind: ${finalQuote.label}`
          : finalQuote.message
      }
      setToast({
        kind: 'success',
        title: 'Parkimine lõpetatud',
        detail,
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

  /**
   * Status ONLY — show exactly what the server said.
   * No local "taimer jätkub" fallback when server did not confirm ACTIVE.
   * License plate is never collected or sent.
   */
  const refreshParkingStatus = useCallback(async () => {
    if (!activeSession && !selectedRef.current) {
      showSessionFeedback('info', 'Vali parkla või alusta sessiooni')
      return
    }

    const timerWasRunning = timerRunning
    const timerModeBefore = timerMode

    setSessionLoading(true)
    setSessionAction('status')
    showSessionFeedback('loading', 'Kontrollin parkimise staatust…')

    try {
      const outcome = await checkParkingStatus({
        carNumber: LOCAL_SESSION_ID,
      })

      if (outcome.kind === 'ACTIVE') {
        const synced = applyActiveDetails(outcome.details, {
          carNumber: LOCAL_SESSION_ID,
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
          outcome.message || 'Aktiivset parkimist ei leitud',
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
    activeSession,
    timerRunning,
    timerMode,
    showSessionFeedback,
    applyActiveDetails,
    startElapsedTimer,
    clearLocalSession,
  ])

  /**
   * Prepaid countdown from absolute endsAt + server extend when a session is active.
   * Offline queue stores endsAt (not minutes). NOT_FOUND → neutral toast, keep local.
   */
  const addPrepaidMinutes = useCallback(
    async (minutes: number) => {
      if (minutes <= 0) return

      const baseMs =
        timerMode === 'prepaid' && endsAt
          ? Math.max(Date.parse(endsAt) || 0, Date.now())
          : Date.now()
      const nextEndsAt = new Date(baseMs + minutes * 60 * 1000).toISOString()
      persistTimer('prepaid', nextEndsAt)
      setTimerSeconds(prepaidSecondsRemaining(nextEndsAt))
      setTimerRunning(true)
      setTimerOpen(true)
      setTimerLabel(
        activeSession
          ? `Ettemaks +${minutes} min · ${activeSession.spotName ?? activeSession.zone}`
          : `Ettemaks +${minutes} min`,
      )

      if (!activeSession) {
        showSessionFeedback(
          'info',
          `Lisatud ${minutes} min`,
          'Kohalik taimer (sessioon puudub)',
        )
        return
      }

      if (!isBrowserOnline()) {
        enqueueOfflineAction('session_extend', {
          carNumber: LOCAL_SESSION_ID,
          endsAt: nextEndsAt,
        })
        showSessionFeedback(
          'info',
          `Lisatud ${minutes} min`,
          'Offline — pikendus järjekorras',
        )
        return
      }

      setSessionAction('extend')
      setSessionLoading(true)
      const outcome = await extendParkingSession({
        carNumber: LOCAL_SESSION_ID,
        endsAt: nextEndsAt,
      })
      setSessionLoading(false)
      setSessionAction(null)

      if (outcome.kind === 'ACTIVE') {
        showSessionFeedback(
          'success',
          `Lisatud ${minutes} min`,
          formatSessionFeedbackDetail(outcome),
        )
        return
      }

      if (outcome.kind === 'NOT_FOUND') {
        // Neutral — local timer already updated and stays
        setToast({
          kind: 'info',
          title: 'Serveris aktiivset sessiooni pole',
          detail: outcome.message || 'Kohalik taimer jätkub',
        })
        return
      }

      setToast({
        kind: 'error',
        title: 'Pikendamine ebaõnnestus',
        detail: outcome.message || 'Kohalik taimer jätkub',
      })
    },
    [
      timerMode,
      endsAt,
      activeSession,
      persistTimer,
      showSessionFeedback,
    ],
  )

  // Offline queue processor — drains FIFO on reconnect
  useEffect(() => {
    registerOfflineProcessor(async (action: QueuedAction) => {
      if (action.type === 'session_start') {
        const zone = String(action.payload.zone ?? '')
        if (!zone) return true
        const outcome = await startParkingSession({
          carNumber: LOCAL_SESSION_ID,
          zone,
        })
        return outcome.kind === 'ACTIVE'
      }
      if (action.type === 'session_stop') {
        const zone = String(action.payload.zone ?? '')
        if (!zone) return true
        const outcome = await stopParkingSession({
          carNumber: LOCAL_SESSION_ID,
          zone,
        })
        return outcome.kind === 'NOT_FOUND' || outcome.kind === 'ACTIVE'
      }
      if (action.type === 'session_extend') {
        const queuedEndsAt = String(action.payload.endsAt ?? '')
        if (!queuedEndsAt) return true
        const ms = Date.parse(queuedEndsAt)
        const now = Date.now()
        // Drop stale / out-of-range queued extends (server requires 1 min–24 h)
        if (
          !Number.isFinite(ms) ||
          ms < now + 60_000 ||
          ms > now + 24 * 60 * 60 * 1000
        ) {
          return true
        }
        const outcome = await extendParkingSession({
          carNumber: LOCAL_SESSION_ID,
          endsAt: queuedEndsAt,
        })
        return outcome.kind === 'ACTIVE' || outcome.kind === 'NOT_FOUND'
      }
      return true
    })
  }, [])

  return {
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
    priceEstimate,
    toast,
    setToast,
    dismissToast,
    connectionNotice,
    beginParkingSession,
    endParkingSession,
    refreshParkingStatus,
    addPrepaidMinutes,
    formatHourlyRate,
    formatSessionInstant,
  }
}

/** Re-export for App convenience */
export type { SessionOutcome }
