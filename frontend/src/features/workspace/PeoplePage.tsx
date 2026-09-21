import { useQuery } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/endpoints'
import { getRole, getWorkspaceId, type AuthRole } from '@/api/auth'
import { keys, useRemoveMember, useWorkspaces } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { toast } from 'sonner'

const ROLE_LABEL: Record<AuthRole, string> = { reader: 'Наблюдатель', editor: 'Редактор', admin: 'Администратор' }

function useMembers(wsId: string) {
  return useQuery({ queryKey: keys.members(wsId), queryFn: () => api.listMembers(wsId), enabled: !!wsId })
}

/** Участники workspace (change 008): список с ролями; admin удаляет. Приглашение по ссылке/email — change 023. */
export function PeoplePage() {
  const wsId = getWorkspaceId()
  const role = getRole()
  const isAdmin = role === 'admin'
  const workspaces = useWorkspaces()
  const members = useMembers(wsId)
  const remove = useRemoveMember(wsId)
  const [removing, setRemoving] = useState<{ user_id: string; role: string } | null>(null)

  const wsName = workspaces.data?.find((w) => w.id === wsId)?.name ?? wsId

  return (
    <div className="content" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>Участники</h1>
          <div className="page-head__sub">{wsName} · роль пользователя в списке — роль в этом пространстве</div>
        </div>
      </div>

      {isAdmin && (
        <div className="callout" data-tone="plan" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="callout__title"><UserPlus aria-hidden /> Приглашение</div>
          <p style={{ margin: 0 }}>
            Приглашение по email/ссылке появится вместе с change 023. Пока участника добавляет администратор
            на бэке: <span className="mono">POST /workspaces/{wsId}/members</span>.
          </p>
        </div>
      )}

      {members.error ? (
        <ErrorAlert error={members.error} onRetry={() => members.refetch()} />
      ) : members.isLoading ? (
        <SkeletonRows rows={4} cols={2} />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              {isAdmin && <th aria-label="Действия" />}
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((m) => (
              <tr key={m.user_id}>
                <td className="mono">{m.user_id}</td>
                <td><Badge tone={m.role === 'admin' ? 'plan' : undefined}>{ROLE_LABEL[m.role] ?? m.role}</Badge></td>
                {isAdmin && (
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Удалить ${m.user_id}`} onClick={() => setRemoving(m)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Удалить участника?"
        description={`${removing?.user_id} потеряет доступ к «${wsName}» при следующем запросе (при повторном добавлении роль нужно выдать заново).`}
        confirmLabel="Удалить"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          remove.mutate(removing.user_id, {
            onSuccess: () => {
              setRemoving(null)
              toast.success('Участник удалён')
            },
            onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
          })
        }}
      />
    </div>
  )
}
