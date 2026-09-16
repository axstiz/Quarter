import { createContext, useContext, useState, type ReactNode } from 'react'
import { ImportDialog } from '@/features/onboarding/ImportDialog'

const Ctx = createContext<() => void>(() => {})

/** Модалка импорта открывается из любого места (сайдбар, пустое состояние, ошибка 400). */
export function ImportProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Ctx.Provider value={() => setOpen(true)}>
      {children}
      <ImportDialog open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  )
}

export const useOpenImport = () => useContext(Ctx)
