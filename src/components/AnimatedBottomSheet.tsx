import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent,
} from 'react'

const CLOSE_MS = 200
/** Drag past this (px) to dismiss the sheet. */
const SWIPE_DISMISS_PX = 72

/** Open / close helpers for info side panels (left desktop, bottom mobile). */
export function useSheetClose(onClose: () => void) {
  const [exiting, setExiting] = useState(false)
  const closedRef = useRef(false)

  const requestClose = useCallback(() => {
    if (exiting || closedRef.current) return
    setExiting(true)
  }, [exiting])

  useEffect(() => {
    if (!exiting) return
    const t = window.setTimeout(() => {
      closedRef.current = true
      onClose()
    }, CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [exiting, onClose])

  return {
    exiting,
    requestClose,
    sheetClassName: exiting ? 'info-panel-out' : 'info-panel-in',
  }
}

/**
 * Swipe-down-to-dismiss for mobile bottom sheets.
 * Attach handlers to the drag handle (not the scroll body) so list scroll stays intact.
 */
export function useSheetSwipe(requestClose: () => void) {
  const startY = useRef(0)
  const [dragY, setDragY] = useState(0)
  const dragging = useRef(false)

  const onTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    dragging.current = true
    startY.current = t.clientY
    setDragY(0)
  }, [])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!dragging.current) return
    const t = e.touches[0]
    if (!t) return
    const dy = t.clientY - startY.current
    setDragY(dy > 0 ? dy : 0)
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    setDragY((y) => {
      if (y >= SWIPE_DISMISS_PX) requestClose()
      return 0
    })
  }, [requestClose])

  const onTouchCancel = useCallback(() => {
    dragging.current = false
    setDragY(0)
  }, [])

  return {
    dragY,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
    } as const,
  }
}
