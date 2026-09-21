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

test('router: онбординг — первый экран', () => {
  const router = read('src/app/router.tsx')
  assert.match(router, /to="\/workspaces" replace/)
  assert.match(router, /path: '\/workspaces'/)
  assert.equal(read('src/features/auth/LoginPage.tsx').includes("navigate('/workspaces'"), true)
})

test('024: admin-экраны участников/прав сняты с UI', () => {
  assert.equal(existsSync(join(root, 'src/features/workspace/PeoplePage.tsx')), false)
  assert.equal(existsSync(join(root, 'src/features/workspace/PermissionsPage.tsx')), false)
  const router = read('src/app/router.tsx')
  assert.doesNotMatch(router, /workspace\/people/)
  assert.doesNotMatch(router, /'\/permissions'/)
  const layout = read('src/app/Layout.tsx')
  assert.doesNotMatch(layout, /ADMIN_NAV/)
  assert.doesNotMatch(layout, /роль:/)
})

test('024: вход — одна кнопка администратора', () => {
  const login = read('src/features/auth/LoginPage.tsx')
  assert.match(login, /Войти как администратор/)
  assert.match(login, /demoLogin\('admin'\)/)
  assert.doesNotMatch(login, /type="email"|type="password"|<Input/)
  assert.doesNotMatch(login, /Наблюдатель|Редактор/)
})

test('endpoints: ручки workspace и советы; участников/прав на фронте нет', () => {
  const endpoints = read('src/api/endpoints.ts')
  for (const re of [/listWorkspaces/, /createWorkspace/, /getAdvice/]) {
    assert.match(endpoints, re)
  }
  assert.doesNotMatch(endpoints, /listMembers|removeMember|getPermissionsMatrix|getAuditLog/)
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
  ]) {
    assert.match(mocks, re)
  }
})

test('Layout: селектор компании, admin-навигации нет', () => {
  const layout = read('src/app/Layout.tsx')
  assert.match(layout, /WorkspaceSwitcher/)
  assert.match(layout, /Сменить пространство/)
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

test('рабочее пространство: бейджей ролей нет (024)', () => {
  const ws = read('src/features/workspace/WorkspaceSelectPage.tsx')
  assert.doesNotMatch(ws, /ROLE_LABEL|role === 'reader'|Наблюдатель/)
  assert.match(ws, /Создать рабочее пространство/)
})
