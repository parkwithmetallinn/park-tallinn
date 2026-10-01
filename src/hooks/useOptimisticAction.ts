import { useCallback, useRef, useState } from 'react'

/**
 * Run an async action with an immediate optimistic UI patch and automatic
 * rollback + error callback if the request fails.
 */
export function useOptimisticAction() {
  const [pending, setPending] = useState(false)
  const snapshotRef = useRef<(() => void) | null>(null)

  const run = useCallback(
    async <T,>(opts: {
      /** Capture previous UI so we can roll back. */
      snapshot: () => () => void
      /** Apply optimistic client state immediately. */
      optimistic: () => void
      /** Network / backend work. Throw or return { ok:false } to rollback. */
      action: () => Promise<T>
      /** Decide if result is success (default: truthy / ok!==false). */
      isSuccess?: (result: T) => boolean
      onSuccess?: (result: T) => void
      onError?: (error: unknown) => void
    }): Promise<T | undefined> => {
      if (pending) return undefined
      const rollback = opts.snapshot()
      snapshotRef.current = rollback
      opts.optimistic()
      setPending(true)
      try {
        const result = await opts.action()
        const ok = opts.isSuccess
          ? opts.isSuccess(result)
          : Boolean(result) &&
            !(
              typeof result === 'object' &&
              result !== null &&
              'ok' in result &&
              (result as { ok: unknown }).ok === false
            ) &&
            !(
              typeof result === 'object' &&
              result !== null &&
              'success' in result &&
              (result as { success: unknown }).success === false
            )
        if (!ok) {
          rollback()
          opts.onError?.(result)
          return result
        }
        opts.onSuccess?.(result)
        return result
      } catch (err) {
        rollback()
        opts.onError?.(err)
        return undefined
      } finally {
        setPending(false)
        snapshotRef.current = null
      }
    },
    [pending],
  )

  return { run, pending }
}
