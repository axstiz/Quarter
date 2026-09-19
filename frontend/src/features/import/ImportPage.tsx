import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, FileSpreadsheet, HelpCircle, Loader2, UploadCloud } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/endpoints'
import { useGeneratePlan, usePlanVersions } from '@/api/queries'
import type { ConfirmResponse, UploadJob } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { ErrorAlert, errorHint, errorTitle } from '@/components/ui/States'
import { t } from '@/lib/motion'

const ENTITY: Record<string, string> = {
  task: 'Задачи', tasks: 'Задачи', engineer: 'Инженеры', engineers: 'Инженеры', dependency: 'Зависимости', dependencies: 'Зависимости',
  team_history: 'История команд', role_requirement: 'Требования ролей', role_requirements: 'Требования ролей',
}
const CONFIDENCE = { high: { label: 'уверенно', tone: 'done' }, medium: { label: 'вероятно', tone: 'shift' }, low: { label: 'проверьте', tone: 'over' } } as const
const STEPS = ['Файл', 'Сопоставление', 'Проверка']

/** Импорт в 3 шага: файл → сопоставление колонок → проверка. В базу ничего не пишется до «Импортировать». */
export function ImportPage() {
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ConfirmResponse | null>(null)

  const upload = useMutation({ mutationFn: api.uploadFile, onSuccess: (j) => setJobId(j.job_id) })
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId && !result,
    refetchInterval: (q) => (q.state.data && ['uploaded', 'mapping'].includes(q.state.data.status) ? 800 : false),
  })
  const answer = useMutation({
    mutationFn: () => api.answerJob(jobId!, answers),
    onSuccess: (j) => {
      qc.setQueryData(['job', jobId], j)
      setAnswers({})
    },
  })
  const confirm = useMutation({
    mutationFn: () => api.confirmJob(jobId!),
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries()
      toast.success('Данные импортированы')
    },
    onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
  })

  const demo = useMutation({
    mutationFn: api.importDemo,
    onSuccess: (r) => {
      setResult({ status: 'confirmed', counts: r.counts })
      qc.invalidateQueries()
      toast.success('Демо-датасет импортирован')
    },
    onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
  })

  const data: UploadJob | undefined = job.data ?? upload.data
  const step = result ? 3 : !data ? 0 : data.status === 'ready' ? 2 : 1
  const restart = () => {
    demo.reset()
    upload.reset()
    confirm.reset()
    setJobId(null)
    setAnswers({})
    setResult(null)
  }

  return (
    <div className="content" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <div>
          <h1>Загрузка данных</h1>
          <div className="page-head__sub">Задачи, инженеры, зависимости и история команд из xlsx, csv или json</div>
        </div>
      </div>

      <ol className="steps" aria-label="Шаги импорта" style={{ listStyle: 'none', padding: 0 }}>
        {STEPS.map((label, i) => (
          <li key={label} className="steps__item" data-state={i < step ? 'done' : i === step ? 'current' : 'todo'} aria-current={i === step ? 'step' : undefined}>
            {i > 0 && <span className="steps__line" aria-hidden />}
            <span className="steps__dot">{i < step ? '✓' : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step === 1 && data && ['uploaded', 'mapping'].includes(data.status) ? 'analyzing' : step}
          initial={{ opacity: 0, transform: 'translateX(12px)' }}
          animate={{ opacity: 1, transform: 'translateX(0px)', transition: t.base }}
          exit={{ opacity: 0, transform: 'translateX(-8px)', transition: t.fast }}
        >
          {result ? (
            <Done result={result} onRestart={restart} />
          ) : !data ? (
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              <div className="block demo-import">
                <div>
                  <h2>Датасет организаторов</h2>
                  <p className="muted">Задачи, инженеры, зависимости и история команд из условия задачи — без сопоставления колонок.</p>
                </div>
                <Button variant="primary" loading={demo.isPending} onClick={() => demo.mutate()}>
                  Импортировать демо-датасет
                </Button>
              </div>
              <div className="or-divider"><span>или свой файл</span></div>
              <Dropzone loading={upload.isPending} error={upload.error} onFile={(f) => upload.mutate(f)} />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <FileSpreadsheet aria-hidden style={{ width: 16, height: 16, color: 'var(--ink-3)' }} />
                <strong>{data.filename}</strong>
                <Button size="sm" variant="ghost" onClick={restart}>
                  Выбрать другой файл
                </Button>
              </div>

              {data.status === 'failed' && <ErrorAlert error={new Error('Не удалось разобрать файл. Проверьте формат или заполните данные вручную.')} />}
              {['uploaded', 'mapping'].includes(data.status) && (
                <div className="callout" data-tone="plan" role="status">
                  <div className="callout__title">
                    <Loader2 className="spin" aria-hidden /> Разбираем колонки файла
                  </div>
                  <p>Сопоставляем колонки с полями сервиса. Если что-то неоднозначно — спросим.</p>
                </div>
              )}

              {['questions', 'ready'].includes(data.status) && (
                <>
                  {data.questions.length > 0 && (
                    <div className="callout" data-tone="shift">
                      <div className="callout__title">
                        <HelpCircle aria-hidden /> Нужно уточнить: {data.questions.length}
                      </div>
                      {data.questions.map((q) => (
                        <Field key={q.context_column} label={q.question}>
                          <Select
                            value={answers[q.context_column] ?? ''}
                            onChange={(e) => setAnswers({ ...answers, [q.context_column]: e.target.value })}
                            options={[{ value: '', label: 'Выберите вариант' }, ...q.options.map((o) => ({ value: o, label: o }))]}
                          />
                        </Field>
                      ))}
                      <div>
                        <Button variant="primary" size="sm" loading={answer.isPending} disabled={data.questions.some((q) => !answers[q.context_column])} onClick={() => answer.mutate()}>
                          Применить ответы
                        </Button>
                      </div>
                      {answer.error && <ErrorAlert error={answer.error} />}
                    </div>
                  )}

                  <div className="block scroll-x">
                    <div className="block__head">
                      <h3>Сопоставление колонок</h3>
                      <span className="section__hint">{data.column_guesses.length} колонок распознано</span>
                    </div>
                    <table className="table table--compact">
                      <thead>
                        <tr>
                          <th>Колонка в файле</th>
                          <th>Поле сервиса</th>
                          <th>Уверенность</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.column_guesses.map((g) => (
                          <tr key={g.column}>
                            <td style={{ fontWeight: 500 }}>{g.column}</td>
                            <td>
                              <span className="muted">{ENTITY[g.entity] ?? g.entity} · </span>
                              <span className="mono">{g.field}</span>
                            </td>
                            <td>
                              <Badge tone={CONFIDENCE[g.confidence].tone}>{CONFIDENCE[g.confidence].label}</Badge>
                            </td>
                          </tr>
                        ))}
                        {data.unmapped.map((c) => (
                          <tr key={c}>
                            <td className="muted">{c}</td>
                            <td className="muted" colSpan={2}>
                              не используется
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="block">
                    <div className="block__head">
                      <h3>Будет импортировано</h3>
                      <span className="section__hint">ручные записи не перезаписываются</span>
                    </div>
                    <div className="block__body" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-6)' }}>
                      {Object.entries(data.preview_counts).map(([k, n]) => (
                        <div key={k} className="stat">
                          <span className="stat__label">{ENTITY[k] ?? k}</span>
                          <span className="stat__value">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Button variant="primary" loading={confirm.isPending} disabled={data.status !== 'ready'} onClick={() => confirm.mutate()}>
                      Импортировать
                    </Button>
                    {data.status !== 'ready' && <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>Сначала ответьте на вопросы выше</span>}
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Dropzone({ loading, error, onFile }: { loading: boolean; error: Error | null; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <button
        type="button"
        className="dropzone"
        style={{ width: '100%' }}
        data-over={over}
        disabled={loading}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
      >
        {loading ? <Loader2 className="spin" aria-hidden /> : <UploadCloud aria-hidden />}
        <strong>{loading ? 'Загружаем файл…' : 'Перетащите файл сюда или выберите на диске'}</strong>
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          xlsx, csv, json · формат датасета распознаётся автоматически
        </span>
      </button>
      <input ref={input} type="file" accept=".xlsx,.csv,.json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {error && <ErrorAlert error={error} />}
    </>
  )
}

function Done({ result, onRestart }: { result: ConfirmResponse; onRestart: () => void }) {
  const versions = usePlanVersions()
  const generate = useGeneratePlan()
  return (
    <div className="block">
      <div className="block__head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 aria-hidden style={{ width: 18, height: 18, color: 'var(--done)' }} /> Данные загружены
        </h2>
      </div>
      <div className="block__body" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-6)' }}>
        {Object.entries(result.counts).map(([k, n]) => (
          <div key={k} className="stat">
            <span className="stat__label">{ENTITY[k] ?? k}</span>
            <span className="stat__value">{n}</span>
          </div>
        ))}
      </div>
      <div className="block__body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--rule)' }}>
        {generate.isSuccess ? (
          <Link to="/plan" className="btn btn--primary" style={{ textDecoration: 'none' }}>
            <span className="btn__label">Открыть план</span>
          </Link>
        ) : (
          <Button
            variant="primary"
            loading={generate.isPending}
            onClick={() => generate.mutate(undefined, { onSuccess: () => toast.success('План построен'), onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }) })}
          >
            {versions.data?.length ? 'Построить новый план по этим данным' : 'Построить план'}
          </Button>
        )}
        <Button variant="ghost" onClick={onRestart}>
          Загрузить ещё файл
        </Button>
      </div>
    </div>
  )
}
