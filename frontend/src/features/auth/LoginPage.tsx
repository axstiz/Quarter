import { motion } from 'motion/react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { t } from '@/lib/motion'

/** Заглушка стр. 0: авторизация появится в change 005, API сейчас открыт. */
export function LoginPage() {
  const navigate = useNavigate()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    navigate('/plan')
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-4)' }}>
      <motion.form
        onSubmit={submit}
        className="block"
        style={{ width: 'min(380px, 100%)', padding: 'var(--s-6)', display: 'grid', gap: 'var(--s-4)' }}
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
        <Field label="Email">
          <Input type="email" name="email" autoComplete="email" spellCheck={false} placeholder="lead@company.ru" />
        </Field>
        <Field label="Пароль">
          <Input type="password" name="password" autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary">
          Войти
        </Button>
        <Button onClick={() => navigate('/plan')}>Войти как демо-пользователь</Button>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', textAlign: 'center' }}>
          Авторизация пока не подключена
        </p>
      </motion.form>
    </main>
  )
}
