import type { MessageTree } from './types'

type LeafPaths<T, P extends string = ''> = T extends string
  ? P
  : {
      [K in keyof T & string]: LeafPaths<
        T[K],
        P extends '' ? K : `${P}.${K}`
      >
    }[keyof T & string]

export type MessageKey = LeafPaths<MessageTree>

/** Flatten nested message tree to dot-path → string. */
export function flattenMessages(
  tree: MessageTree,
  prefix = '',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      out[path] = v
    } else if (v && typeof v === 'object') {
      Object.assign(out, flattenMessages(v as unknown as MessageTree, path))
    }
  }
  return out
}

export function getMessageAt(
  tree: MessageTree,
  key: string,
): string | undefined {
  const parts = key.split('.')
  let cur: unknown = tree
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}
