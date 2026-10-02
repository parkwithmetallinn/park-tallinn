/// <reference types="vite/client" />

declare module '*.geojson' {
  const value: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      id?: string | number
      properties: Record<string, unknown>
      geometry: {
        type: string
        coordinates: unknown
      }
    }>
  }
  export default value
}

interface ImportMetaEnv {
  readonly VITE_N8N_WEBHOOK_URL: string
  readonly VITE_N8N_API_KEY: string
  /** @deprecated use VITE_N8N_WEBHOOK_URL */
  readonly VITE_PARKING_WEBHOOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
