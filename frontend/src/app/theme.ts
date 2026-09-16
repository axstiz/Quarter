import { useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'theme'

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage недоступен */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function initTheme() {
  document.documentElement.dataset.theme = read()
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* storage недоступен */
    }
    setTheme(next)
  }
  return { theme, toggle }
}
