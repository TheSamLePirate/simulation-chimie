import type { EngineStatus } from './engineStatus'

interface StatusDescriptor {
  text: string
  tone: 'pending' | 'ok' | 'error'
}

const DESCRIPTORS: Record<EngineStatus, StatusDescriptor> = {
  initializing: { text: 'Initialisation du moteur…', tone: 'pending' },
  running: { text: 'WebGPU actif', tone: 'ok' },
  unsupported: { text: 'WebGPU indisponible sur ce navigateur', tone: 'error' },
  error: { text: 'Échec d’initialisation WebGPU', tone: 'error' },
}

export function EngineStatusBadge({ status }: { status: EngineStatus }) {
  const { text, tone } = DESCRIPTORS[status]
  return (
    <div className="status-badge" data-tone={tone} data-testid="engine-status" role="status">
      <span className="status-badge__dot" />
      {text}
    </div>
  )
}
