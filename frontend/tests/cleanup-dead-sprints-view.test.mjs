import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const sources = walk(src).filter((p) => /\.(ts|tsx|css)$/.test(p))
const code = sources.filter((p) => /\.(ts|tsx)$/.test(p)).map((p) => [p, readFileSync(p, 'utf8')])
const styles = sources.filter((p) => p.endsWith('.css')).map((p) => [p, readFileSync(p, 'utf8')])

test('мёртвый вид SprintsView.tsx удалён', () => {
  assert.equal(existsSync(join(src, 'features/plan/SprintsView.tsx')), false)
})

test('ни один модуль не импортирует SprintsView', () => {
  const offenders = code.filter(([, text]) => /SprintsView/.test(text)).map(([p]) => p)
  assert.deepEqual(offenders, [])
})

test('fmtSp живёт в TaskPanel.tsx (единственном пользователе)', () => {
  const taskPanel = readFileSync(join(src, 'features/plan/TaskPanel.tsx'), 'utf8')
  assert.match(taskPanel, /const fmtSp\s*=|function fmtSp/)
  assert.doesNotMatch(taskPanel, /import\s*\{[^}]*fmtSp[^}]*\}\s*from/)
})

test('неиспользуемый компонент Group.tsx удалён', () => {
  assert.equal(existsSync(join(src, 'components/ui/Group.tsx')), false)
  const offenders = code.filter(([, text]) => /components\/ui\/Group/.test(text)).map(([p]) => p)
  assert.deepEqual(offenders, [])
})

test('CSS-хвосты вида (.groups, .group__*) вычищены', () => {
  const offenders = styles.filter(([, text]) => /\.groups\b|\.group__|\.group\[|\.group\s*\{/.test(text)).map(([p]) => p)
  assert.deepEqual(offenders, [])
})
