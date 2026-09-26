import { useEffect, useRef, useState } from 'react'

const CLOSE_MS = 280

/** Spring open / ease-out close helpers for bottom info sheets. */
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
    sheetClassName: exiting ? 'sheet-spring-out' : 'sheet-spring-in',
  }
}
