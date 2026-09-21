import { motion } from 'motion/react'
import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { demoLogin } from '@/api/auth'
import { t } from '@/lib/motion'

/**
 * Вход (change 024): единственное действие — «Войти как администратор»
 * (/auth/demo-login, role=admin). Выбор ролей и email/пароль из UI убраны —
 * серверная ролевая модель и JWT-ручки сохранены, но фронтом не используются.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const demo = async () => {
    setError(null)
    setBusy(true)
    try {
      await demoLogin('admin')
      navigate('/workspaces', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Демо-вход не удался')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)' }}>
      <motion.div
        className="block"
        style={{ width: 'min(420px, 100%)', padding: 'var(--s-6)', display: 'grid', gap: 'var(--s-4)' }}
        initial={{ opacity: 0, transform: 'translateY(8px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)', transition: t.base }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/favicon.svg" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
          <div>
            <h1 style={{ fontSize: 'var(--text-xl)' }}>Вход в Квартал</h1>
            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>планирование команд в рабочих пространствах</div>
          </div>
        </div>
        {error && <p className="callout" data-tone="over" style={{ margin: 0 }}>{error}</p>}
        <Button variant="primary" icon={<LogIn />} loading={busy} onClick={() => { void demo() }}>
          Войти как администратор
        </Button>
        <p className="muted" style={{ fontSize: 'var(--text-2xs)', textAlign: 'center', margin: 0 }}>
          Демо-профиль администратора: полный доступ к данным и планам в ваших рабочих пространствах
        </p>
      </motion.div>
    </main>
  )
}
