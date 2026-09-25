import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keeps chrome (filters, timer) alive if the MapLibre/WebGL surface fails. */
export class MapErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MapView failed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-paper-2 p-6 text-center">
          <p className="text-sm font-bold text-ink">Kaarti ei õnnestunud laadida</p>
          <p className="max-w-sm text-xs text-ink-soft">
            Brauser vajab WebGL2 tuge (3D kaart). Proovi teist brauserit või uuenda graafikadraivereid.
          </p>
          <p className="mt-2 font-mono text-[10px] text-clay">{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
