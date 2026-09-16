import type { Decision } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { DECISION_META } from '@/lib/decision'

export function DecisionBadge({ decision, className }: { decision: Decision; className?: string }) {
  const meta = DECISION_META[decision]
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.label}
    </Badge>
  )
}
