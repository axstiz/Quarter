import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Каждый var(--x) в исходниках определён в tokens.css. Иначе срабатывает хардкод-фолбэк
// (var(--surface, #fff)) и тёмная тема молча не применяется — так было с вуалью оптимизации.

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const tokens = readFileSync(join(src, 'styles/tokens.css'), 'utf8')
const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))

/** Локальные переменные компонентов: задаются в правилах/inline-style рядом с использованием. */
const LOCAL = new Set(['--c', '--bg', '--tone', '--lg-c'])

test('все var(--x) определены в tokens.css (кроме локальных --c/--bg/--tone/--lg-c)', () => {
  const missing = []
  for (const path of walk(src).filter((p) => /\.(ts|tsx|css)$/.test(p))) {
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (!defined.has(m[1]) && !LOCAL.has(m[1])) missing.push(`${relative(root, path)}: ${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [])
})

test('локальные переменные действительно где-то задаются', () => {
  const all = walk(src).filter((p) => /\.(ts|tsx|css)$/.test(p)).map((p) => readFileSync(p, 'utf8')).join('\n')
  for (const name of LOCAL) assert.ok(all.includes(`'${name}'`) || new RegExp(`${name}\\s*:`).test(all), `${name} нигде не задан`)
})
