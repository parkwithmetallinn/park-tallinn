/// <reference types="vite/client" />

declare module '*.geojson' {
  const value: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      id?: string | number
      properties: Record<string, unknown>
    }>
  }
  export default value
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
