import { motion } from 'motion/react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { demoLogin, login, type AuthRole } from '@/api/auth'
import { t } from '@/lib/motion'

const ROLES: { role: AuthRole; label: string; hint: string }[] = [
  { role: 'reader', label: 'Наблюдатель', hint: 'только просмотр' },
  { role: 'editor', label: 'Редактор', hint: 'план, факты, приоритеты' },
  { role: 'admin', label: 'Администратор', hint: 'подтверждение отмен, права' },
]

/** Вход: демо-роли (3 кнопки) или email/пароль (/auth/login). 401 просроченной сессии редиректит сюда. */
export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<AuthRole | 'login' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy('login')
    try {
      await login(email.trim().toLowerCase(), password)
      navigate('/plan', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Вход не удался')
    } finally {
      setBusy(null)
    }
  }

  const demo = async (role: AuthRole) => {
    setError(null)
    setBusy(role)
    try {
      await demoLogin(role)
      navigate('/plan', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Демо-вход не удался')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)' }}>
      <motion.form
        onSubmit={(e) => { void submit(e) }}
        className="block"
        style={{ width: 'min(420px, 100%)', padding: 'var(--s-6)', display: 'grid', gap: 'var(--s-4)' }}
        initial={{ opacity: 0, transform: 'translateY(8px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)', transition: t.base }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/favicon.svg" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
          <div>
            <h1 style={{ fontSize: 'var(--text-xl)' }}>Вход в Квартал</h1>
            <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>для тимлидов, ресурсных менеджеров и CTO</div>
          </div>
        </div>
        {params.get('expired') && (
          <p className="callout" data-tone="shift" style={{ margin: 0 }}>
            Сессия истекла — войдите заново.
          </p>
        )}
        {error && <p className="callout" data-tone="over" style={{ margin: 0 }}>{error}</p>}
        <Field label="Email">
          <Input type="email" name="email" autoComplete="email" spellCheck={false} placeholder="lead@company.ru"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Пароль">
          <Input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy === 'login'}>
          Войти
        </Button>
        <div style={{ display: 'grid', gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
          <div className="muted" style={{ fontSize: 'var(--text-xs)', textAlign: 'center' }}>или демо-вход</div>
          {ROLES.map(({ role, label, hint }) => (
            <Button key={role} variant="secondary" loading={busy === role} disabled={busy !== null && busy !== role}
              onClick={() => { void demo(role) }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                {label}
                <small className="muted" style={{ fontSize: 'var(--text-2xs)', fontWeight: 400 }}>{hint}</small>
              </span>
            </Button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 'var(--text-2xs)', textAlign: 'center' }}>
          Роли checking side сервера; недоступные действия скрыты или отключены
        </p>
      </motion.form>
    </main>
  )
}
