import { useCallback } from 'react'
import { useSearchParams, type SetURLSearchParams } from 'react-router-dom'

/*
 * React Router не складывает функциональные обновления setSearchParams: второй вызов подряд
 * берёт старый URL и затирает первый. Поэтому все изменения за один тик копим и применяем
 * одной навигацией — «закрыть панель», «сбросить фильтры» и т.п. меняют несколько параметров сразу.
 */
let pending: Map<string, string | null> | null = null

function schedule(setParams: SetURLSearchParams, name: string, value: string | null) {
  if (!pending) {
    pending = new Map()
    queueMicrotask(() => {
      const patch = pending!
      pending = null
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of patch) {
            if (v === null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    })
  }
  pending.set(name, value)
}

/** Состояние в query-параметре: выбранная задача, вкладка, фильтры. Ссылкой можно поделиться, «Назад» работает. */
export function useParam(name: string): [string | null, (value: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const set = useCallback((value: string | null) => schedule(setParams, name, value), [setParams, name])
  return [params.get(name), set]
}
