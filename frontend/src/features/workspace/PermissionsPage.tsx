import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getRole } from '@/api/auth'
import { useAuditLog, usePermissionsMatrix, useUpdateRolePermission } from '@/api/queries'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { formatDateTime } from '@/lib/format'
import { useParam } from '@/lib/useParam'

/** Человекочитаемые названия действий (клюки — permissions из матрицы бэка). */
const PERMISSION_LABEL: Record<string, string> = {
  import_data: 'Импорт данных',
  crud_tasks: 'Задачи: создание/правка',
  crud_engineers: 'Люди и команды: правка',
  edit_priority: 'Приоритеты',
  cancel_request: 'Запрос отмены задачи',
  confirm_cancel: 'Подтверждение отмены',
  sprint_facts: 'Факты спринта',
  recompute: 'Пересчёт плана',
  plans_generate: 'Построение плана',
  plans_optimize: 'Оптимизация плана',
  plans_optimize_staffing: 'Переносы людей (оптимизация)',
  workspace_admin: 'Настройки workspace',
  members_admin: 'Управление участниками',
}

const ROLES = ['admin', 'editor', 'reader'] as const
const ROLE_LABEL = { admin: 'Админ', editor: 'Редактор', reader: 'Наблюдатель' } as const

/** Матрица прав + аудит (change 009, UI 021): admin — правка с подтверждением, остальным — тихий отказ. */
export function PermissionsPage() {
  const [view] = useParam('view')
  const role = getRole()
  const tab = view === 'audit' ? 'audit' : 'matrix'
  return (
    <div className="content" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Права и аудит</h1>
          <div className="page-head__sub">действие × роль в текущем workspace; инвариант 009: права администратора неотчуждаемы</div>
        </div>
      </div>
      <Tabs
        current={tab}
        items={[
          { value: 'matrix', label: 'Матрица прав' },
          { value: 'audit', label: 'Журнал аудита' },
        ]}
      />
      {tab === 'matrix' ? <Matrix readOnly={role !== 'admin'} /> : <Audit />}
    </div>
  )
}

function Matrix({ readOnly }: { readOnly: boolean }) {
  const matrix = usePermissionsMatrix()
  const update = useUpdateRolePermission()
  const [pending, setPending] = useState<{ role: string; permission: string; enabled: boolean } | null>(null)

  if (matrix.error) return <ErrorAlert error={matrix.error} onRetry={() => matrix.refetch()} />
  if (matrix.isLoading) return <SkeletonRows rows={8} cols={4} />

  const entries = Object.entries(matrix.data?.matrix ?? {})

  const apply = () => {
    if (!pending) return
    update.mutate(pending, {
      onSuccess: () => toast.success('Право обновлено', { description: `${PERMISSION_LABEL[pending.permission] ?? pending.permission}: ${ROLE_LABEL[pending.role as keyof typeof ROLE_LABEL]}` }),
      onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
    })
    setPending(null)
  }

  return (
    <>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>Действие</th>
            {ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>)}
          </tr>
        </thead>
        <tbody>
          {entries.map(([permission, byRole]) => (
            <tr key={permission}>
              <td>{PERMISSION_LABEL[permission] ?? permission}</td>
              {ROLES.map((r) => {
                const enabled = byRole[r]
                const fixed = r === 'admin' // инвариант 009: права админа неотчуждаемы
                return (
                  <td key={r} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={fixed || readOnly}
                      aria-label={`${PERMISSION_LABEL[permission] ?? permission} — ${ROLE_LABEL[r]}`}
                      onChange={(e) => {
                        if (e.target.checked) {
                          update.mutate({ role: r, permission, enabled: true }, { onError: (err) => toast.error(errorTitle(err), { description: errorHint(err) }) })
                        } else {
                          setPending({ role: r, permission, enabled: false })
                        }
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {readOnly && <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>Правка доступна администратору. Попытка правки без роли — 403 (тихий отказ).</p>}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title="Отключить право?"
        description={`«${PERMISSION_LABEL[pending?.permission ?? ''] ?? pending?.permission}» перестанет быть доступно роли «${ROLE_LABEL[pending?.role as keyof typeof ROLE_LABEL] ?? pending?.role}». Инвариант 009: у администратора право сохранится в любом случае, критичные для админ-механик действия отключить нельзя.`}
        confirmLabel="Отключить"
        loading={update.isPending}
        onConfirm={apply}
      />
    </>
  )
}

function Audit() {
  const audit = useAuditLog()
  // 403 не-admin — тихий отказ: тост с причиной, экран не перебрасывает
  useEffect(() => {
    if (audit.error) toast.error(errorTitle(audit.error), { description: errorHint(audit.error) })
  }, [audit.error])
  if (audit.error) return <p className="muted">Журнал недоступен: нет права на просмотр аудита.</p>
  if (audit.isLoading) return <SkeletonRows rows={6} cols={3} />

  const rows = audit.data ?? []
  return rows.length ? (
    <table className="table table--compact">
      <thead>
        <tr>
          <th>Когда</th>
          <th>Кто</th>
          <th>Действие</th>
          <th>Цель</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.created_at)}</td>
            <td className="mono">{e.actor_id}</td>
            <td>{e.action}</td>
            <td className="mono">{e.target}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="muted">Пока пусто: записи появляются при правке прав и управлении участниками.</p>
  )
}
