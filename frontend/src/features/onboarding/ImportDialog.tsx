import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CheckCircle2, FileSpreadsheet, HelpCircle, Loader2, Sparkles, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { useGeneratePlan } from '@/api/queries'
import type { ColumnGuess, ConfirmResponse, UploadJob } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Dialog } from '@/components/ui/Overlay'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

const STEPS = ['Файл', 'Сопоставление', 'Проверка'] as const

const ENTITY_LABEL: Record<string, string> = {
  task: 'Задачи',
  engineer: 'Инженеры',
  dependency: 'Зависимости',
  team_history: 'История команд',
  role_requirement: 'Требования ролей',
  tasks: 'Задачи',
  engineers: 'Инженеры',
  dependencies: 'Зависимости',
  role_requirements: 'Требования ролей',
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [result, setResult] = useState<ConfirmResponse | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const qc = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    if (!open) {
      setJobId(null)
      setResult(null)
      setAnswers({})
    }
  }, [open])

  const upload = useMutation({ mutationFn: api.uploadFile, onSuccess: (job) => setJobId(job.job_id) })
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
    // Пока пайплайн работает — опрашиваем раз в 800 мс (контракт: 500–1000 мс)
    refetchInterval: (q) => (q.state.data && ['uploaded', 'mapping'].includes(q.state.data.status) ? 800 : false),
  })
  const answer = useMutation({
    mutationFn: () => api.answerJob(jobId!, answers),
    onSuccess: (data) => qc.setQueryData(['job', jobId], data),
  })
  const confirm = useMutation({
    mutationFn: () => api.confirmJob(jobId!),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries()
    },
    onError: (e) => toast({ tone: 'error', title: 'Импорт не выполнен', description: e.message }),
  })

  const data = job.data ?? upload.data
  const step = result ? 3 : !data ? 0 : data.status === 'ready' ? 2 : 1

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Загрузка данных"
      description="Датасет в формате xlsx, csv или json. Данные попадут в базу только после вашего подтверждения."
      className="max-w-2xl"
      footer={
        <Footer
          step={step}
          data={data}
          answers={answers}
          onClose={onClose}
          onAnswer={() => answer.mutate()}
          answering={answer.isPending}
          onConfirm={() => confirm.mutate()}
          confirming={confirm.isPending}
          onRestart={() => {
            upload.reset()
            setJobId(null)
          }}
        />
      }
    >
      {step < 3 && <Stepper current={step} />}

      {step === 0 && <DropZone onFile={(f) => upload.mutate(f)} loading={upload.isPending} error={upload.error} />}

      {step === 1 && data && (
        data.status === 'failed' ? (
          <div className="flex items-start gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> Пайплайн не смог разобрать файл. Попробуйте другой файл или заполните данные вручную.
          </div>
        ) : ['uploaded', 'mapping'].includes(data.status) ? (
          <Analyzing filename={data.filename} />
        ) : (
          <Mapping job={data} answers={answers} setAnswers={setAnswers} />
        )
      )}

      {step === 2 && data && <Preview job={data} />}

      {step === 3 && result && <Done result={result} onClose={onClose} />}
    </Dialog>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition',
              i < current ? 'bg-ok text-white' : i === current ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-subtle',
            )}
          >
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn('text-[13px] font-medium', i > current && 'text-subtle')}>{label}</span>
          {i < STEPS.length - 1 && <span className={cn('h-px flex-1', i < current ? 'bg-ok' : 'bg-border')} />}
        </li>
      ))}
    </ol>
  )
}

function DropZone({ onFile, loading, error }: { onFile: (f: File) => void; loading: boolean; error: Error | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <button
        type="button"
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
        className={cn(
          'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
          over ? 'border-accent bg-accent-soft' : 'border-border hover:border-accent/50 hover:bg-surface-2/60',
        )}
      >
        {loading ? <Loader2 className="size-8 animate-spin text-accent" /> : <UploadCloud className="size-8 text-accent" />}
        <p className="mt-3 text-sm font-semibold">{loading ? 'Загружаем…' : 'Перетащите файл или нажмите, чтобы выбрать'}</p>
        <p className="mt-1 text-xs text-muted">xlsx, csv, json · формат датасета распознаётся автоматически</p>
      </button>
      <input ref={input} type="file" accept=".xlsx,.csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-danger">
          <AlertCircle className="size-4" /> {error.message}
        </p>
      )}
    </>
  )
}

function Analyzing({ filename }: { filename: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div className="relative grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Sparkles className="size-6 animate-pulse" />
      </div>
      <p className="mt-4 text-sm font-semibold">AI-агент разбирает файл</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <FileSpreadsheet className="size-3.5" /> {filename}
      </p>
      <p className="mt-3 max-w-sm text-xs text-subtle">Определяем сущности и сопоставляем колонки с полями. Если что-то неоднозначно — спросим.</p>
    </div>
  )
}

function Confidence({ level }: { level: ColumnGuess['confidence'] }) {
  if (level === 'high') return <CheckCircle2 className="size-4 text-ok" aria-label="уверенно" />
  if (level === 'medium') return <CheckCircle2 className="size-4 text-warn" aria-label="вероятно" />
  return <HelpCircle className="size-4 text-danger" aria-label="неуверенно" />
}

function Mapping({ job, answers, setAnswers }: { job: UploadJob; answers: Record<string, string>; setAnswers: (a: Record<string, string>) => void }) {
  return (
    <div className="space-y-4">
      {job.questions.length > 0 && (
        <div className="space-y-3 rounded-xl border border-warn/30 bg-warn-soft p-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-warn">
            <HelpCircle className="size-4" /> Нужно уточнить ({job.questions.length})
          </p>
          {job.questions.map((q) => (
            <div key={q.context_column}>
              <p className="mb-1.5 text-[13px]">{q.question}</p>
              <Select
                value={answers[q.context_column] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.context_column]: e.target.value })}
                options={q.options.map((o) => ({ value: o, label: o }))}
                placeholder="Выберите вариант"
              />
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Колонка файла</th>
              <th className="px-3 py-2 font-medium">Поле сервиса</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {job.column_guesses.map((g) => (
              <tr key={g.column}>
                <td className="px-3 py-2 font-medium">{g.column}</td>
                <td className="px-3 py-2">
                  <span className="text-muted">{ENTITY_LABEL[g.entity] ?? g.entity} · </span>
                  <span className="font-mono text-xs">{g.field}</span>
                </td>
                <td className="px-3 py-2">
                  <Confidence level={g.confidence} />
                </td>
              </tr>
            ))}
            {job.unmapped.map((c) => (
              <tr key={c} className="text-subtle">
                <td className="px-3 py-2">{c}</td>
                <td className="px-3 py-2 text-xs">не используется</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Preview({ job }: { job: UploadJob }) {
  return (
    <div>
      <p className="text-sm text-muted">
        Сопоставление готово. Вот что сервис поймёт из <span className="font-medium text-fg">{job.filename}</span>:
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(job.preview_counts).map(([entity, n]) => (
          <div key={entity} className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">{ENTITY_LABEL[entity] ?? entity}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{n}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-subtle">Записи, созданные вручную (source=manual), при импорте не перезаписываются.</p>
    </div>
  )
}

function Done({ result, onClose }: { result: ConfirmResponse; onClose: () => void }) {
  const generate = useGeneratePlan()
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok">
        <CheckCircle2 className="size-6" />
      </div>
      <p className="mt-3 text-base font-semibold">Данные загружены</p>
      <p className="mt-1 text-sm text-muted">
        {Object.entries(result.counts)
          .map(([k, v]) => `${ENTITY_LABEL[k] ?? k}: ${v}`)
          .join(' · ')}
      </p>
      <Button
        variant="primary"
        className="mt-5"
        loading={generate.isPending}
        onClick={async () => {
          await generate.mutateAsync()
          onClose()
          navigate('/plan')
        }}
      >
        Сгенерировать план
      </Button>
    </div>
  )
}

interface FooterProps {
  step: number
  data?: UploadJob
  answers: Record<string, string>
  onClose: () => void
  onAnswer: () => void
  answering: boolean
  onConfirm: () => void
  confirming: boolean
  onRestart: () => void
}

function Footer({ step, data, answers, onClose, onAnswer, answering, onConfirm, confirming, onRestart }: FooterProps) {
  if (step === 3) return <Button onClick={onClose}>Закрыть</Button>
  const unanswered = data?.questions.some((q) => !answers[q.context_column]) ?? false
  return (
    <>
      {step > 0 && (
        <Button variant="ghost" className="mr-auto" onClick={onRestart}>
          Выбрать другой файл
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Отмена
      </Button>
      {step === 1 && data?.status === 'questions' && (
        <Button variant="primary" onClick={onAnswer} loading={answering} disabled={unanswered}>
          Применить ответы
        </Button>
      )}
      {step === 2 && (
        <Button variant="primary" onClick={onConfirm} loading={confirming}>
          Подтвердить импорт
        </Button>
      )}
    </>
  )
}
