import { useState } from 'react'

type Theme = 'light' | 'dark'

const systemTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

/** Тема по системе; ручной выбор запоминается. localStorage может быть недоступен — не падаем. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || systemTheme())
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const apply = () => {
      document.documentElement.dataset.theme = next
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (document.startViewTransition && !reduce) document.startViewTransition(apply)
    else apply()
    try {
      localStorage.setItem('theme', next)
    } catch {
      /* приватный режим */
    }
    setTheme(next)
  }
  return { theme, toggle }
}
