import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/endpoints'
import { getRole, type AuthRole } from '@/api/auth'
import type { AdviceReport } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { ErrorAlert } from '@/components/ui/States'

const KIND_LABEL: Record<string, { label: string; tone: 'plan' | 'shift' | 'over' | 'done' }> = {
  task_move: { label: 'Перенос задачи', tone: 'shift' },
  staffing_shift: { label: 'Кадровый сдвиг', tone: 'plan' },
  initiative_rescue: { label: 'Спасение инициативы', tone: 'over' },
  sprint_priority: { label: 'Приоритеты спринта', tone: 'done' },
}

/**
 * Панель советов AI-советника (change 015, consumer 021 §5): одноразовый прогон
 * GET /plans/{id}/advice. comment — весь контекст прогона в одном комментарии (≤ 500),
 * никогда не сохраняется; поле очищается после каждого запроса. reader — просмотр без поля.
 */
export function AdvicePanelContent({ planId }: { planId: string }) {
  const role: AuthRole | null = getRole()
  const canComment = role === 'editor' || role === 'admin'
  const [comment, setComment] = useState('')
  const [report, setReport] = useState<AdviceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchAdvice = () => {
    setLoading(true)
    setError(null)
    api.getAdvice(planId, comment.trim() || undefined)
      .then(setReport)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setComment('')) // не персистентно: текст нигде не хранится
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
        Одноразовые советы по текущей версии плана: риски, KPI, оптимизация, кадровые предложения.
        Применение — только человеком через существующие действия (пересчёт, приоритеты, закрепления).
      </p>

      {canComment ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="advice-comment" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Что важно учесть</label>
          <Textarea
            id="advice-comment"
            rows={3}
            maxLength={500}
            value={comment}
            placeholder="Например: ENG-405 заболел до конца спринта"
            onChange={(e) => setComment(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
            Совет одноразовый: весь контекст — в одном комментарии ({comment.length}/500); дозапрос/диалог недоступны,
            советы перегенерируются заново с новым комментарием. Текст не сохраняется.
          </span>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>
          Поле комментария доступно редактору и администратору; наблюдатель получает советы без контекста.
        </p>
      )}

      <div>
        <Button variant="primary" icon={<Sparkles />} loading={loading} onClick={fetchAdvice}>
          Получить советы
        </Button>
      </div>

      {error && <ErrorAlert error={error} onRetry={fetchAdvice} />}
      {report && !error && (
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Режим: {report.mode === 'llm' ? 'LLM (GigaChat)' : 'fallback-отчёты ядра (ключ GigaChat не задан)'}
            {report.comment_considered && ' · комментарий учтён в этом прогоне'}
          </span>
          {report.advice.length === 0 && <p className="muted" style={{ margin: 0 }}>Советов нет: рисков и предложений ядра не нашлось.</p>}
          {report.advice.map((a, i) => {
            const kind = KIND_LABEL[a.kind] ?? { label: a.kind, tone: 'shift' as const }
            return (
              <div className="block" key={i} style={{ padding: 'var(--s-4)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={kind.tone}>{kind.label}</Badge>
                  {a.affected_task_ids.length > 0 && <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{a.affected_task_ids.join(', ')}</span>}
                  {a.affected_engineers.length > 0 && <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>люди: {a.affected_engineers.join(', ')}</span>}
                </div>
                <p style={{ margin: 0 }}>{a.message}</p>
                <dl className="advice-facts" style={{ margin: 0, display: 'grid', gap: 4, fontSize: 'var(--text-xs)' }}>
                  <div style={{ display: 'flex', gap: 6 }}><dt className="muted" style={{ minWidth: 150 }}>На чём основан:</dt><dd style={{ margin: 0 }}>{a.numeric_basis}</dd></div>
                  <div style={{ display: 'flex', gap: 6 }}><dt className="muted" style={{ minWidth: 150 }}>Ожидаемый эффект:</dt><dd style={{ margin: 0 }}>{a.expected_effect}</dd></div>
                </dl>
              </div>
            )
          })}
        </div>
      )}
      {loading && !report && (
        <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 className="spin" aria-hidden style={{ width: 14, height: 14 }} /> Собираем сводку состояния плана…
        </p>
      )}
    </div>
  )
}
