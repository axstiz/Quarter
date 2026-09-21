import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('ganttOverrides удалён и нигде не импортируется', () => {
  assert.equal(existsSync(join(root, 'src/lib/ganttOverrides.ts')), false)
  const offenders = ['src/features/plan/RolesView.tsx', 'src/features/plan/GanttView.tsx', 'src/lib/roleModel.ts', 'src/lib/planModel.ts']
    .filter((p) => read(p).includes('ganttOverrides'))
  assert.deepEqual(offenders, [])
})

test('client.ts шлёт X-Workspace-Id для не-default и в мок, и в fetch', () => {
  const client = read('src/api/client.ts')
  assert.match(client, /X-Workspace-Id/)
  assert.match(client, /handleMock<T>\(method, path, body, headers\)/)
})

test('auth.ts хранит активный workspace в сессии', () => {
  const auth = read('src/api/auth.ts')
  assert.match(auth, /getWorkspaceId/)
  assert.match(auth, /setWorkspace/)
  assert.match(auth, /workspaceId\?: string/)
})

test('router: онбординг — первый экран, есть маршруты workspace/permissions', () => {
  const router = read('src/app/router.tsx')
  assert.match(router, /to="\/workspaces" replace/)
  assert.match(router, /path: '\/workspaces'/)
  assert.match(router, /path: '\/workspace\/people'/)
  assert.match(router, /path: '\/permissions'/)
  assert.equal(read('src/features/auth/LoginPage.tsx').includes("navigate('/workspaces'"), true)
})

test('endpoints: ручки workspaces/permissions/advice', () => {
  const endpoints = read('src/api/endpoints.ts')
  for (const re of [/listWorkspaces/, /createWorkspace/, /listMembers/, /removeMember/, /getPermissionsMatrix/, /updateRolePermission/, /getAuditLog/, /getAdvice/]) {
    assert.match(endpoints, re)
  }
})

test('моки: workspace-ручки, права, аудит, советы, изоляция', () => {
  const mocks = read('src/mocks/index.ts')
  for (const re of [
    /'\/workspaces'/,
    /'\/workspaces\/:id\/members'/,
    /'\/permissions\/matrix'/,
    /'\/permissions\/roles\/:role'/,
    /'\/permissions\/audit'/,
    /'\/plans\/:id\/advice'/,
    /wsOf/,
    /Права администратора неотчуждаемы/,
    /Конфликт закрепления/,
  ]) {
    assert.match(mocks, re)
  }
})

test('Layout: селектор компании и admin-навигация', () => {
  const layout = read('src/app/Layout.tsx')
  assert.match(layout, /WorkspaceSwitcher/)
  assert.match(layout, /Сменить пространство/)
  assert.match(layout, /workspace\/people/)
  assert.match(layout, /'\/permissions'/)
})

test('ImportPage: подпись последствий и баннер пересборки плана', () => {
  const imp = read('src/features/import/ImportPage.tsx')
  assert.match(imp, /ручные правки \(source=manual\) останутся/)
  assert.match(imp, /Данные изменились — постройте план заново/)
})

test('PlanPage: панель советов и демо-импорт в чистом листе', () => {
  const plan = read('src/features/plan/PlanPage.tsx')
  assert.match(plan, /AdvicePanelContent/)
  assert.match(plan, /advicePanel/)
  assert.match(plan, /Импортировать демо-датасет/)
})

test('AdvicePanel: поле комментария одноразовое, ничего не персистится', () => {
  const advice = read('src/features/plan/AdvicePanel.tsx')
  assert.match(advice, /setComment\(''\)/)
  assert.doesNotMatch(advice, /localStorage/)
  assert.match(advice, /Совет одноразовый/)
  assert.match(advice, /maxLength=\{500\}/)
})

test('рабочее пространство доступно для reader только на просмотр', () => {
  const ws = read('src/features/workspace/WorkspaceSelectPage.tsx')
  assert.match(ws, /canEdit\(role\)/)
  assert.match(ws, /role === 'reader'/)
  const people = read('src/features/workspace/PeoplePage.tsx')
  assert.match(people, /isAdmin/)
})
