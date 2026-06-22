import { useState } from 'react'
import { CanvasHost } from '../ui/CanvasHost'
import { EngineStatusBadge } from '../ui/EngineStatusBadge'
import type { EngineStatus } from '../ui/engineStatus'

export function App() {
  const [status, setStatus] = useState<EngineStatus>('initializing')

  return (
    <div className="app">
      <CanvasHost onStatus={setStatus} />

      <header className="app__header">
        <h1 className="app__title">Dynamique-Chimie</h1>
        <p className="app__subtitle">Simulateur de dynamique moléculaire — temps réel</p>
      </header>

      <EngineStatusBadge status={status} />
    </div>
  )
}
