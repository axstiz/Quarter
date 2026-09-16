// Цвета семейств ролей. Проверены на контраст на светлом и тёмном фоне.
const FAMILIES: [RegExp, string, string][] = [
  [/разработчик|developer/i, '#4f7cff', 'Разработка'],
  [/аналитик/i, '#12a37f', 'Аналитика'],
  [/тестировщик|qa/i, '#e0a100', 'Тестирование'],
  [/архитектор/i, '#a55cf0', 'Архитектура'],
  [/девопс|devops/i, '#ef6a3a', 'DevOps'],
  [/руководитель|менеджер/i, '#e2477d', 'Управление'],
  [/дизайнер/i, '#22a7c9', 'Дизайн'],
  [/поддержк/i, '#8a94a6', 'Поддержка'],
]

export function roleFamily(role: string): { color: string; label: string } {
  const hit = FAMILIES.find(([re]) => re.test(role))
  return hit ? { color: hit[1], label: hit[2] } : { color: '#8a94a6', label: 'Другое' }
}

export const ROLE_LEGEND = FAMILIES.map(([, color, label]) => ({ color, label }))
