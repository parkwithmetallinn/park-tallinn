/** Ambient types for the Vercel-style /api/reports handler. */
declare function handler(
  req: {
    method?: string
    headers?: Record<string, string | string[] | undefined>
    body?: unknown
    socket?: { remoteAddress?: string }
  },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void
      end: (body?: unknown) => void
    }
    setHeader: (name: string, value: string) => void
    statusCode?: number
    json?: (body: unknown) => void
    end?: (body?: unknown) => void
  },
): Promise<void>

export default handler
