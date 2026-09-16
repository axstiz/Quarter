import { ArrowRight, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Field'

/** Заглушка стр. 0: auth — change 005, сейчас все ручки открыты. */
export function LoginPage() {
  const navigate = useNavigate()
  const enter = (e?: React.FormEvent) => {
    e?.preventDefault()
    navigate('/plan')
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0b0e1f] p-10 text-white lg:flex lg:flex-col">
        <StarField />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-white/10">
            <Sparkles className="size-4" />
          </div>
          <span className="font-semibold">Квартал</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">Выполнимый план квартала и живая карта компетенций</h1>
          <p className="mt-3 text-white/60">6 спринтов с учётом velocity, часов ролей и зависимостей. Пересчёт по факту раз в 2 недели. Bus Factor — прямо в плане.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={enter} className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Вход</h2>
          <p className="mt-1 text-sm text-muted">Для тимлидов, ресурсных менеджеров и CTO</p>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Email</Label>
              <Input type="email" placeholder="lead@company.ru" autoComplete="email" />
            </div>
            <div>
              <Label hint="авторизация — change 005">Пароль</Label>
              <Input type="password" placeholder="••••••••" autoComplete="current-password" />
            </div>
          </div>
          <Button variant="primary" type="submit" className="mt-6 w-full">
            Войти
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-border" /> или <span className="h-px flex-1 bg-border" />
          </div>
          <Button type="button" className="w-full" onClick={() => enter()} icon={<ArrowRight className="size-4" />}>
            Войти как демо-пользователь
          </Button>
        </form>
      </div>
    </div>
  )
}

function StarField() {
  const stars = Array.from({ length: 70 }, (_, i) => ({
    x: (i * 137.5) % 100,
    y: (i * 61.8) % 100,
    r: ((i * 7) % 3) * 0.5 + 0.6,
    o: ((i * 13) % 10) / 14 + 0.2,
  }))
  return (
    <svg className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <radialGradient id="nebula" cx="70%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#6d63ff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#6d63ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#nebula)" />
      {stars.map((s, i) => (
        <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="white" opacity={s.o} />
      ))}
    </svg>
  )
}
