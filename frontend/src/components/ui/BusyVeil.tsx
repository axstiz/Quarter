import { Loader2 } from 'lucide-react'

/** change 034: полноэкранная вуаль «идёт перестройка» — блокирует страницу. */
export function BusyVeil({ active, status }: { active: boolean; status: string | null }) {
  return (
    <div
      className="busy-veil"
      role="status"
      aria-live="polite"
      data-active={active || undefined}
    >
      {active ? (
        <div className="busy-veil__card" data-testid="busy-veil">
          <Loader2 className="spin" aria-hidden />
          <span>{status ?? 'Идёт перестройка…'}</span>
        </div>
      ) : null}
    </div>
  )
}
