import { useEffect, useRef, useState } from 'react'

const CLOSE_MS = 200

/** Open / close helpers for info side panels (left desktop, bottom mobile). */
export function useSheetClose(onClose: () => void) {
  const [exiting, setExiting] = useState(false)
  const closedRef = useRef(false)

  const requestClose = () => {
    if (exiting || closedRef.current) return
    setExiting(true)
  }

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
