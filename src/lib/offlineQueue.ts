/**
 * Offline write-action queue — persists across reloads and drains FIFO on reconnect.
 */

export type QueuedActionType =
  | 'session_start'
  | 'session_stop'
  | 'session_extend'
  | 'parking_request'

export type QueuedAction = {
  id: string
  type: QueuedActionType
  createdAt: string
  payload: Record<string, unknown>
  attempts: number
}

const QUEUE_KEY = 'parkvibe_offline_action_queue'
const MAX_ATTEMPTS = 5

type Processor = (action: QueuedAction) => Promise<boolean>

let processor: Processor | null = null
let draining = false

function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedAction[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    /* quota */
  }
}

export function getOfflineQueue(): QueuedAction[] {
  return readQueue()
}

export function offlineQueueLength(): number {
  return readQueue().length
}

export function enqueueOfflineAction(
  type: QueuedActionType,
  payload: Record<string, unknown>,
): QueuedAction {
  const action: QueuedAction = {
    id: `oq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    createdAt: new Date().toISOString(),
    payload,
    attempts: 0,
  }
  const q = readQueue()
  q.push(action)
  writeQueue(q)
  window.dispatchEvent(new CustomEvent('parkvibe:queue-changed'))
  return action
}

export function registerOfflineProcessor(fn: Processor) {
  processor = fn
}

export async function drainOfflineQueue(): Promise<{
  processed: number
  remaining: number
}> {
  if (draining || !processor) {
    return { processed: 0, remaining: offlineQueueLength() }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, remaining: offlineQueueLength() }
  }

  draining = true
  let processed = 0
  try {
    let queue = readQueue()
    while (queue.length > 0) {
      if (!navigator.onLine) break
      const [head, ...rest] = queue
      head.attempts += 1
      let ok = false
      try {
        ok = await processor(head)
      } catch {
        ok = false
      }
      if (ok) {
        processed++
        queue = rest
        writeQueue(queue)
        window.dispatchEvent(new CustomEvent('parkvibe:queue-changed'))
      } else if (head.attempts >= MAX_ATTEMPTS) {
        // Drop poison pills so the queue can continue
        queue = rest
        writeQueue(queue)
        window.dispatchEvent(new CustomEvent('parkvibe:queue-changed'))
      } else {
        queue = [head, ...rest]
        writeQueue(queue)
        break
      }
    }
  } finally {
    draining = false
  }
  return { processed, remaining: offlineQueueLength() }
}

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
