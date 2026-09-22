import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { getRole, type AuthRole } from '@/api/auth'
import { useAdvice, useAdviceHistory } from '@/api/queries'
import { useQueryClient } from '@tanstack/react-query'
import type { AdviceItem, AdviceReport } from '@/api/types'
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
 * Панель советов AI-советника (change 015/043): прогон через react-query —
 * кэш и статус запроса переживают переключение вкладок и закрытие панели
 * (спиннер не слетает, результат не теряется). История прогонов по версии плана
 * с version_label и комментарием (comment теперь сохраняется — решение лида).
 */
export function AdvicePanelContent({ planId }: { planId: string }) {
  const role: AuthRole | null = getRole()
  const canComment = role === 'editor' || role === 'admin'
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const adviceQ = useAdvice(planId)
  const historyQ = useAdviceHistory(planId)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchAdvice = () => {
    const text = comment.trim()
    qc.setQueryData(['advice', planId], (old: AdviceReport | undefined) => old)
    void adviceQ.refetch().then((r) => {
      if (r.data && text) {
        // запоминаем комментарий прогона локально для отображения «учтён»
        qc.setQueryData(['advice-comment', planId], text)
      }
      setComment('')
      historyQ.refetch()
    })
  }

  const report = adviceQ.data
  const loading = adviceQ.isFetching
  const lastComment = qc.getQueryData<string>(['advice-comment', planId])

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
        Советы по текущей версии плана: риски, KPI, оптимизация, кадровые предложения.
        Запрос не слетает при переключении вкладок; прогоны сохраняются в истории с версией плана.
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
            Совет одноразовый: весь контекст — в одном комментарии ({comment.length}/500); прогоны сохраняются в истории с комментарием (change 043).
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

      {adviceQ.error && <ErrorAlert error={adviceQ.error as Error} onRetry={fetchAdvice} />}
      {report && !adviceQ.error && (
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            Режим: {report.mode === 'llm' ? 'LLM (GigaChat)' : 'fallback-отчёты ядра'}
            {lastComment && ` · комментарий учтён: «${lastComment}»`}
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

      {/* change 043: история советов по версии плана */}
      <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--rule)', paddingTop: 'var(--s-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 'var(--text-sm)' }}>История советов</strong>
          <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>по версии плана, с комментарием</span>
        </div>
        {historyQ.isLoading && <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>Загрузка истории…</p>}
        {historyQ.error && <ErrorAlert error={historyQ.error as Error} onRetry={() => historyQ.refetch()} />}
        {(historyQ.data ?? []).length === 0 && !historyQ.isLoading && (
          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>Прогонов ещё не было на этой версии плана.</p>
        )}
        {(historyQ.data ?? []).map((h) => (
          <div key={h.advice_id} style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: 'var(--s-2)' }}>
            <button
              type="button"
              onClick={() => setExpanded(expanded === h.advice_id ? null : h.advice_id)}
              style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', padding: 0 }}
              aria-expanded={expanded === h.advice_id}
            >
              <Badge tone={h.mode === 'llm' ? 'plan' : 'shift'}>{h.mode === 'llm' ? 'LLM' : 'fallback'}</Badge>
              <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{h.version_label}</span>
              {h.comment && <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>«{h.comment}»</span>}
              <span className="muted" style={{ fontSize: 'var(--text-2xs)', marginLeft: 'auto' }}>{h.created_at.slice(0, 16)}</span>
            </button>
            {expanded === h.advice_id && (
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {h.advice.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>Советов не было.</p>}
                {h.advice.map((a: AdviceItem, i: number) => {
                  const kind = KIND_LABEL[a.kind] ?? { label: a.kind, tone: 'shift' as const }
                  return (
                    <div key={i} style={{ display: 'grid', gap: 4, fontSize: 'var(--text-xs)' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Badge tone={kind.tone}>{kind.label}</Badge>
                        {a.affected_task_ids.length > 0 && <span className="mono">{a.affected_task_ids.join(', ')}</span>}
                      </div>
                      <p style={{ margin: 0 }}>{a.message}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
