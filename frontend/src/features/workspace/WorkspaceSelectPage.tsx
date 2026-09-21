import { motion } from 'motion/react'
import { Building2, Check, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { canEdit, getRole, getWorkspaceId, type AuthRole } from '@/api/auth'
import { useCreateWorkspace, useSwitchWorkspace, useWorkspaces } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { t } from '@/lib/motion'

const ROLE_LABEL: Record<AuthRole, string> = { reader: 'Наблюдатель', editor: 'Редактор', admin: 'Администратор' }

/**
 * Онбординг-экран (change 021): первый экран после входа — всегда, включая случай
 * единственного default. Список «моих» пространств (название, роль, владелец),
 * активный помечен; создание нового (создатель — админ) открывает «чистый лист».
 */
export function WorkspaceSelectPage() {
  const navigate = useNavigate()
  const switchWs = useSwitchWorkspace()
  const workspaces = useWorkspaces()
  const create = useCreateWorkspace()
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)
  const role = getRole()
  const activeId = getWorkspaceId()
  const list = workspaces.data ?? []

  const enter = (id: string, wsRole?: AuthRole) => {
    switchWs(id, wsRole)
    // сброс URL-state контента: ?plan=/?task= чужого пространства не переезжают
    navigate('/plan', { replace: true })
  }

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(trimmed, {
      onSuccess: (ws) => {
        setName('')
        setConfirming(false)
        toast.success(`Рабочее пространство «${ws.name}» создано`, { description: 'Вы администратор. Данных нет — начните с импорта.' })
        enter(ws.id, 'admin')
      },
      onError: (err) => toast.error(errorTitle(err), { description: errorHint(err) }),
    })
  }

  return (
    <div className="content" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Выбор рабочего пространства</h1>
          <div className="page-head__sub">1 датасет ≈ 1 workspace: данные, план и права изолированы по компаниям</div>
        </div>
      </div>

      {workspaces.error ? (
        <ErrorAlert error={workspaces.error} onRetry={() => workspaces.refetch()} />
      ) : workspaces.isLoading ? (
        <SkeletonRows rows={3} cols={3} />
      ) : (
        <motion.div initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', transition: t.base }} style={{ display: 'grid', gap: 'var(--s-3)' }}>
          {list.map((ws) => {
            const active = ws.id === activeId
            return (
              <button key={ws.id} type="button" className="block ws-card" data-active={active || undefined}
                style={{ textAlign: 'left', cursor: 'pointer', padding: 'var(--s-4)', display: 'grid', gap: 6 }}
                onClick={() => enter(ws.id, ws.role)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Building2 aria-hidden style={{ width: 18, height: 18, color: 'var(--ink-3)', flexShrink: 0 }} />
                  <strong style={{ fontSize: 'var(--text-lg)' }}>{ws.name}</strong>
                  {active && <Badge tone="done"><Check aria-hidden style={{ width: 12, height: 12 }} /> активное</Badge>}
                  <span style={{ marginLeft: 'auto' }}><Badge tone={ws.role === 'admin' ? 'plan' : undefined}>{ROLE_LABEL[ws.role]}</Badge></span>
                </div>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  владелец: <span className="mono">{ws.created_by ?? '—'}</span>
                  {ws.id === 'default' && ' · базовое пространство'}
                </span>
              </button>
            )
          })}
        </motion.div>
      )}

      {canEdit(role) && (
        <div className="block" style={{ marginTop: 'var(--s-5)' }}>
          <div className="block__head">
            <h2>Создать рабочее пространство</h2>
            <span className="section__hint">чистый лист: данные не переносятся, вы становитесь админом</span>
          </div>
          {!confirming ? (
            <Button variant="secondary" icon={<Plus />} onClick={() => setConfirming(true)}>Создать рабочее пространство</Button>
          ) : (
            <form onSubmit={submitCreate} style={{ display: 'grid', gap: 'var(--s-3)', maxWidth: 420 }}>
              <Field label="Название">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Проект Альфа" autoFocus maxLength={80} />
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
                  Создать и открыть
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Отмена</Button>
              </div>
            </form>
          )}
        </div>
      )}
      {role === 'reader' && (
        <p className="muted" style={{ marginTop: 'var(--s-5)', fontSize: 'var(--text-sm)' }}>
          Наблюдатель видит только список доступных пространств. Создание и настройка — для редактора или администратора.
        </p>
      )}
    </div>
  )
}
