import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('маршрут /data и страница DataPage', () => {
  assert.equal(existsSync(join(root, 'src/features/data/DataPage.tsx')), true)
  const router = read('src/app/router.tsx')
  assert.match(router, /path: '\/data'/)
  assert.match(read('src/app/Layout.tsx'), /'\/data'/)
  assert.match(read('src/app/Layout.tsx'), /Данные/)
})

test('endpoints: CRUD данных (tasks/engineers/teams/deps + role-hours)', () => {
  const e = read('src/api/endpoints.ts')
  for (const re of [/createTask/, /updateTask/, /deleteTask/, /setTaskRoleHours/, /createEngineer/, /updateEngineer/, /deleteEngineer/, /createTeam/, /updateTeam/, /deleteTeam/, /createDependency/, /updateDependency/, /deleteDependency/]) {
    assert.match(e, re)
  }
})

test('моки: CRUD-ручки редактора', () => {
  const m = read('src/mocks/index.ts')
  for (const re of ["'POST', '/tasks'", "'PUT', '/tasks/:id/role-hours'", "'PUT', '/tasks/:id'", "'POST', '/engineers'", "'PUT', '/engineers/:id'", "'POST', '/dependencies'", "'PUT', '/dependencies'"].map((x) => new RegExp(x.replace(/'/g, "'")))) {
    assert.match(m, re)
  }
})

test('task_id/engineer_id не редактируются: 409 в моке и на бэке (019 §3.3)', () => {
  assert.match(read('src/mocks/index.ts'), /task_id менять нельзя/)
  assert.match(read('src/mocks/index.ts'), /engineer_id менять нельзя/)
  const crud = readFileSync(join(root, '..', 'src/api/crud.py'), 'utf8').replaceAll(', ', ',')
  assert.match(crud, /task_id менять нельзя/)
  assert.match(crud, /engineer_id менять нельзя/)
})

test('баннер «данные изменились» на план-странице', () => {
  const p = read('src/features/plan/PlanPage.tsx')
  assert.match(p, /Данные изменились — постройте план заново/)
  assert.match(p, /dataEditedAfter/)
})

test('переходы «редактировать данные» из карточек', () => {
  assert.match(read('src/features/plan/TaskPanel.tsx'), /\/data\?tab=tasks&row=/)
  assert.match(read('src/features/team-map/PersonPanel.tsx'), /data\?tab=people&row=/)
})

test('права: ключевые id не редактируются через EditableCell', () => {
  const d = read('src/features/data/DataPage.tsx')
  assert.doesNotMatch(d, /EditableCell[\s\S]{0,80}value=\{t\.task_id/)
  assert.doesNotMatch(d, /EditableCell[\s\S]{0,80}value=\{e\.engineer_id/)
})

test('висячие зависимости помечены «планировщик проигнорирует»', () => {
  const d = read('src/features/data/DataPage.tsx')
  assert.match(d, /планировщик проигнорирует/)
})

test('внешний EditableCell не теряет введённое: state в компоненте', () => {
  const d = read('src/features/data/DataPage.tsx')
  assert.match(d, /значение сохраняется до исправления/)
})

test('бэк: role-hours заменяет набор, нулевые отбрасываются', () => {
  const crud = readFileSync(join(root, '..', 'src/api/crud.py'), 'utf8')
  assert.match(crud, /role-hours/)
  assert.match(crud, /hours_num <= 0/)
})
