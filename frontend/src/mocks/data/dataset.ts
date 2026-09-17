// Снято с ответов реального бэкенда (GET /tasks, /engineers, /dependencies, /teams/{id}, POST /data/upload)
// + приоритеты по правилам импортёра (заказчик → 10, остальные → 100 + номер строки).
// Только для мок-режима.
import type { ColumnGuess, Dependency, Engineer, TeamHistory } from '../../api/types'
import type { MockTask } from '../types'

export const TASKS: MockTask[] = [
 {
  "task_id": "ONK-2475",
  "parent_id": "BR-151",
  "team_id": "Team-L",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "Done",
  "estimation_sp": 7.0,
  "estimated_hh": 276.0,
  "role_hours": {
   "Аналитик": 50.0,
   "Дизайнер": 8.0,
   "Разработчик Java": 50.0,
   "Разработчик Java Script": 40.0,
   "Руководитель проекта": 46.0,
   "Тестировщик": 50.0,
   "Тестировщик (Автотестирование)": 12.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "ANL-3041"
   }
  ],
  "priority": 10
 },
 {
  "task_id": "ASUKD-5222",
  "parent_id": "BR-151",
  "team_id": "Team-K",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "Done",
  "estimation_sp": 7.0,
  "estimated_hh": 192.0,
  "role_hours": {
   "Аналитик": 32.0,
   "Разработчик Java": 54.0,
   "Руководитель проекта": 9.0,
   "Специалист поддержки": 3.0,
   "Тестировщик": 74.0,
   "Тестировщик (Автотестирование)": 20.0
  },
  "blocks": [
   [
    "ASUKD-5222",
    "QA-9022"
   ]
  ],
  "blocked_by": [
   {
    "blocking_task_id": "KP-3898"
   }
  ],
  "priority": 10
 },
 {
  "task_id": "KP-3898",
  "parent_id": "BR-151",
  "team_id": "Team-Platform",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "InProgress",
  "estimation_sp": 6.0,
  "estimated_hh": 194.0,
  "role_hours": {
   "Аналитик": 32.0,
   "ДевОпс": 3.0,
   "Разработчик Android": 30.0,
   "Разработчик Java": 30.0,
   "Руководитель проекта": 9.0,
   "Тестировщик": 8.0,
   "Тестировщик (Автотестирование)": 82.0
  },
  "blocks": [
   [
    "KP-3898",
    "ASUKD-5222"
   ]
  ],
  "blocked_by": [],
  "priority": 102
 },
 {
  "task_id": "ONK-2914",
  "parent_id": "BR-151",
  "team_id": "Team-L",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 240.0,
  "role_hours": {
   "Аналитик": 16.0,
   "Разработчик Java": 120.0,
   "Разработчик Java Script": 20.0,
   "Руководитель проекта": 40.0,
   "Тестировщик": 24.0,
   "Тестировщик (Автотестирование)": 20.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 103
 },
 {
  "task_id": "ASUKD-5918",
  "parent_id": "BR-151",
  "team_id": "Team-K",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 192.0,
  "role_hours": {
   "Аналитик": 32.0,
   "Разработчик Java": 54.0,
   "Руководитель проекта": 9.0,
   "Специалист поддержки": 3.0,
   "Тестировщик": 74.0,
   "Тестировщик (Автотестирование)": 20.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 104
 },
 {
  "task_id": "KP-0000",
  "parent_id": "BR-151",
  "team_id": "Team-Platform",
  "summary": "Модернизация фискального ядра (Проект Ф-22)",
  "status": "ToDo",
  "estimation_sp": 4.0,
  "estimated_hh": 30.0,
  "role_hours": {
   "Тестировщик (Автотестирование)": 30.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 105
 },
 {
  "task_id": "MOB-7011",
  "parent_id": "BR-152",
  "team_id": "Team-L",
  "summary": "Редизайн личного кабинета и UI-кита",
  "status": "InProgress",
  "estimation_sp": 5.0,
  "estimated_hh": 180.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Дизайнер": 35.0,
   "Разработчик Android": 30.0,
   "Разработчик iOS": 30.0,
   "Разработчик Java Script": 40.0
  },
  "blocks": [
   [
    "MOB-7011",
    "MOB-7012"
   ]
  ],
  "blocked_by": [],
  "priority": 106
 },
 {
  "task_id": "MOB-7012",
  "parent_id": "BR-152",
  "team_id": "Team-Platform",
  "summary": "Реализация мобильного виджета доставки",
  "status": "ToDo",
  "estimation_sp": 11.0,
  "estimated_hh": 210.0,
  "role_hours": {
   "Аналитик": 10.0,
   "Разработчик Android": 100.0,
   "Разработчик iOS": 100.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "MOB-7011"
   }
  ],
  "priority": 107
 },
 {
  "task_id": "MOB-7013",
  "parent_id": "BR-152",
  "team_id": "Team-L",
  "summary": "Адаптация UI под планшетные версии",
  "status": "ToDo",
  "estimation_sp": 4.0,
  "estimated_hh": 120.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Разработчик Android": 30.0,
   "Разработчик iOS": 40.0,
   "Разработчик Java": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 108
 },
 {
  "task_id": "ANL-3041",
  "parent_id": "BR-153",
  "team_id": "Team-L",
  "summary": "Анализ узких мест интеграционного шлюза",
  "status": "Done",
  "estimation_sp": 4.0,
  "estimated_hh": 80.0,
  "role_hours": {
   "Аналитик": 80.0
  },
  "blocks": [
   [
    "ANL-3041",
    "ONK-2475"
   ]
  ],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "QA-9022",
  "parent_id": "BR-153",
  "team_id": "Team-K",
  "summary": "Автоматизация регрессионных тестов API",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 120.0,
  "role_hours": {
   "Тестировщик": 40.0,
   "Тестировщик (Автотестирование)": 80.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "ASUKD-5222"
   }
  ],
  "priority": 110
 },
 {
  "task_id": "ANL-3042",
  "parent_id": "BR-153",
  "team_id": "Team-L",
  "summary": "Проектирование очередей отказоустойчивости",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 90.0,
  "role_hours": {
   "Аналитик 1С": 10.0,
   "Разработчик 1С": 50.0,
   "Разработчик BigData": 10.0,
   "Специалист поддержки 1С": 2.0,
   "Тестировщик": 18.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 111
 },
 {
  "task_id": "MP-101",
  "parent_id": "BR-155",
  "team_id": "Team-L",
  "summary": "Проектирование схемы данных шлюза маркетплейсов",
  "status": "Done",
  "estimation_sp": 4.0,
  "estimated_hh": 64.0,
  "role_hours": {
   "Аналитик": 32.0,
   "Архитектор решений": 32.0
  },
  "blocks": [
   [
    "MP-101",
    "AI-302"
   ],
   [
    "MP-101",
    "MP-102"
   ]
  ],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "MP-102",
  "parent_id": "BR-155",
  "team_id": "Team-K",
  "summary": "Разработка API-коннекторов к витринам (Проект МП)",
  "status": "InProgress",
  "estimation_sp": 9.0,
  "estimated_hh": 186.0,
  "role_hours": {
   "Аналитик": 16.0,
   "Разработчик Java": 120.0,
   "Тестировщик": 30.0,
   "Тестировщик (Автотестирование)": 20.0
  },
  "blocks": [
   [
    "MP-102",
    "MP-103"
   ]
  ],
  "blocked_by": [
   {
    "blocking_task_id": "DB-202"
   },
   {
    "blocking_task_id": "MP-101"
   }
  ],
  "priority": 113
 },
 {
  "task_id": "MP-103",
  "parent_id": "BR-155",
  "team_id": "Team-K",
  "summary": "Сквозное тестирование сценариев синхронизации",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 114.0,
  "role_hours": {
   "Тестировщик": 54.0,
   "Тестировщик (Автотестирование)": 60.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "MP-102"
   }
  ],
  "priority": 114
 },
 {
  "task_id": "DB-201",
  "parent_id": "BR-156",
  "team_id": "Team-Platform",
  "summary": "Аудит хранимых процедур и подготовка схемы миграции",
  "status": "Done",
  "estimation_sp": 6.0,
  "estimated_hh": 96.0,
  "role_hours": {
   "Архитектор 1С": 32.0,
   "Архитектор решений": 32.0,
   "Разработчик Java": 32.0
  },
  "blocks": [
   [
    "DB-201",
    "DB-202"
   ]
  ],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "DB-202",
  "parent_id": "BR-156",
  "team_id": "Team-Platform",
  "summary": "Перенос логики и рефакторинг сервисов (Проект СУБД)",
  "status": "InProgress",
  "estimation_sp": 8.0,
  "estimated_hh": 324.0,
  "role_hours": {
   "Архитектор решений": 32.0,
   "ДевОпс": 32.0,
   "Разработчик .net": 130.0,
   "Разработчик Java": 130.0
  },
  "blocks": [
   [
    "DB-202",
    "MP-102"
   ],
   [
    "DB-202",
    "DB-203"
   ]
  ],
  "blocked_by": [
   {
    "blocking_task_id": "DB-201"
   }
  ],
  "priority": 116
 },
 {
  "task_id": "DB-203",
  "parent_id": "BR-156",
  "team_id": "Team-Platform",
  "summary": "Развертывание отказоустойчивого кластера и CI/CD",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 80.0,
  "role_hours": {
   "ДевОпс": 40.0,
   "Разработчик Java": 32.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "DB-202"
   }
  ],
  "priority": 117
 },
 {
  "task_id": "AI-301",
  "parent_id": "BR-157",
  "team_id": "Team-L",
  "summary": "Разметка датасета диалогов и пилотное обучение LLM",
  "status": "Done",
  "estimation_sp": 6.0,
  "estimated_hh": 150.0,
  "role_hours": {
   "Аналитик Big Data": 50.0,
   "Разработчик Big Data": 50.0,
   "Руководитель BigData": 50.0
  },
  "blocks": [
   [
    "AI-301",
    "AI-302"
   ]
  ],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "AI-302",
  "parent_id": "BR-157",
  "team_id": "Team-L",
  "summary": "Интеграция ИИ-модели с витриной оператора КЦ",
  "status": "ToDo",
  "estimation_sp": 9.0,
  "estimated_hh": 216.0,
  "role_hours": {
   "Аналитик Big Data": 16.0,
   "Разработчик Big Data": 20.0,
   "Разработчик Java Script": 100.0,
   "Руководитель BigData": 40.0,
   "Тестировщик": 40.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "MP-101"
   },
   {
    "blocking_task_id": "AI-301"
   }
  ],
  "priority": 119
 },
 {
  "task_id": "AI-303",
  "parent_id": "BR-157",
  "team_id": "Team-L",
  "summary": "Сбор обратной связи и дообучение классификатора",
  "status": "ToDo",
  "estimation_sp": 4.0,
  "estimated_hh": 100.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Архитектор решений": 30.0,
   "Разработчик Java": 15.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 15.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 120
 },
 {
  "task_id": "SRV-4011",
  "parent_id": "BR-158",
  "team_id": "Team-Alpha",
  "summary": "Оптимизация логистических маршрутов (Проект Оптима)",
  "status": "InProgress",
  "estimation_sp": 6.0,
  "estimated_hh": 160.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 10.0
  },
  "blocks": [
   [
    "SRV-4011",
    "SRV-4012"
   ],
   [
    "SRV-4011",
    "SRV-4019"
   ]
  ],
  "blocked_by": [],
  "priority": 121
 },
 {
  "task_id": "SRV-4012",
  "parent_id": "BR-158",
  "team_id": "Team-Alpha",
  "summary": "Внедрение модуля динамического ценообразования",
  "status": "ToDo",
  "estimation_sp": 13.0,
  "estimated_hh": 240.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Аналитик Big Data": 35.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Дизайнер": 35.0,
   "Разработчик Big Data": 40.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 10.0
  },
  "blocks": [],
  "blocked_by": [
   {
    "blocking_task_id": "SRV-4011"
   }
  ],
  "priority": 122
 },
 {
  "task_id": "SRV-4010",
  "parent_id": "BR-158",
  "team_id": "Team-Alpha",
  "summary": "Геокодирование адресов и картография",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 110.0,
  "role_hours": {
   "Аналитик": 10.0,
   "Аналитик Big Data": 10.0,
   "Архитектор решений": 10.0,
   "ДевОпс": 2.0,
   "Дизайнер": 15.0,
   "Разработчик Big Data": 20.0,
   "Разработчик Java": 20.0,
   "Руководитель проекта": 10.0,
   "Тестировщик": 3.0,
   "Тестировщик (Автотестирование)": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 123
 },
 {
  "task_id": "SRV-4021",
  "parent_id": "BR-159",
  "team_id": "Team-Beta",
  "summary": "Шлюз транзакционных и сервисных сообщений",
  "status": "Done",
  "estimation_sp": 5.0,
  "estimated_hh": 110.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 20.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "SRV-4022",
  "parent_id": "BR-159",
  "team_id": "Team-Beta",
  "summary": "Настройка каскадных правил отправки (SMS/Push)",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 130.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 8.0,
   "ДевОпс": 8.0,
   "Разработчик Java": 48.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 6.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 125
 },
 {
  "task_id": "SRV-4023",
  "parent_id": "BR-159",
  "team_id": "Team-Beta",
  "summary": "Подключение резервных SMS-провайдеров",
  "status": "ToDo",
  "estimation_sp": 3.0,
  "estimated_hh": 70.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Аналитик Big Data": 20.0,
   "Дизайнер": 10.0,
   "Разработчик Big Data": 10.0,
   "Руководитель проекта": 5.0,
   "Тестировщик": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 126
 },
 {
  "task_id": "SRV-4031",
  "parent_id": "BR-160",
  "team_id": "Team-Beta",
  "summary": "Кабинет мерчанта: загрузка товарных матриц",
  "status": "ToDo",
  "estimation_sp": 13.0,
  "estimated_hh": 340.0,
  "role_hours": {
   "Аналитик": 80.0,
   "Архитектор решений": 30.0,
   "ДевОпс": 30.0,
   "Дизайнер": 30.0,
   "Разработчик Java": 80.0,
   "Руководитель проекта": 20.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 30.0,
   "Тестировщик (Автотестирование)": 30.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 127
 },
 {
  "task_id": "SRV-4032",
  "parent_id": "BR-160",
  "team_id": "Team-Beta",
  "summary": "Интеграция ЛК с финансовым биллингом компании",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 180.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Разработчик Java": 80.0,
   "Руководитель проекта": 20.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 128
 },
 {
  "task_id": "SRV-4033",
  "parent_id": "BR-160",
  "team_id": "Team-Beta",
  "summary": "Генерация закрывающих документов для юрлиц",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 120.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Архитектор решений": 10.0,
   "ДевОпс": 10.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 15.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 129
 },
 {
  "task_id": "SRV-4041",
  "parent_id": "BR-161",
  "team_id": "Team-Delta",
  "summary": "ЕСИА-авторизация и проверка учетных записей",
  "status": "InProgress",
  "estimation_sp": 6.0,
  "estimated_hh": 220.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Аналитик Big Data": 8.0,
   "Дизайнер": 20.0,
   "Разработчик Big Data": 100.0,
   "Руководитель проекта": 7.0,
   "Руководитель BigData": 3.0,
   "Тестировщик": 42.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 130
 },
 {
  "task_id": "SRV-4042",
  "parent_id": "BR-161",
  "team_id": "Team-Delta",
  "summary": "Подключение коннекторов СМЭВ 3.0",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 150.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Архитектор решений": 10.0,
   "ДевОпс": 10.0,
   "Разработчик Java": 70.0,
   "Руководитель проекта": 20.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 131
 },
 {
  "task_id": "SRV-4043",
  "parent_id": "BR-161",
  "team_id": "Team-Delta",
  "summary": "Проектирование витрины регламентированных справок",
  "status": "ToDo",
  "estimation_sp": 4.0,
  "estimated_hh": 90.0,
  "role_hours": {
   "Аналитик": 10.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 40.0,
   "Руководитель проекта": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 132
 },
 {
  "task_id": "SRV-4051",
  "parent_id": "BR-162",
  "team_id": "Team-Delta",
  "summary": "Архитектура шины обмена кадровыми документами",
  "status": "ToDo",
  "estimation_sp": 5.0,
  "estimated_hh": 130.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 8.0,
   "ДевОпс": 8.0,
   "Разработчик Java": 48.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 6.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 133
 },
 {
  "task_id": "SRV-4052",
  "parent_id": "BR-162",
  "team_id": "Team-Delta",
  "summary": "Внедрение КЭП (Квалифицированной ЭЦП) инженеров",
  "status": "ToDo",
  "estimation_sp": 5.0,
  "estimated_hh": 160.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Архитектор решений": 15.0,
   "ДевОпс": 15.0,
   "Разработчик Java": 75.0,
   "Руководитель проекта": 15.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 134
 },
 {
  "task_id": "SRV-4061",
  "parent_id": "BR-163",
  "team_id": "Team-Platform",
  "summary": "Сбор логов производительности ядра и СУБД",
  "status": "Done",
  "estimation_sp": 3.0,
  "estimated_hh": 90.0,
  "role_hours": {
   "Аналитик": 10.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 40.0,
   "Руководитель проекта": 10.0,
   "Тестировщик": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 10
 },
 {
  "task_id": "SRV-4062",
  "parent_id": "BR-163",
  "team_id": "Team-Platform",
  "summary": "Визуализация дашбордов Grafana / Prometheus",
  "status": "ToDo",
  "estimation_sp": 6.0,
  "estimated_hh": 140.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 5.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 136
 },
 {
  "task_id": "SRV-4063",
  "parent_id": "BR-163",
  "team_id": "Team-Platform",
  "summary": "Настройка алертинга критических сбоев",
  "status": "ToDo",
  "estimation_sp": 4.0,
  "estimated_hh": 100.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Архитектор решений": 5.0,
   "ДевОпс": 5.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 15.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 137
 },
 {
  "task_id": "SRV-4071",
  "parent_id": "BR-164",
  "team_id": "Team-K",
  "summary": "Анализ медленных запросов платежного шлюза",
  "status": "ToDo",
  "estimation_sp": 9.0,
  "estimated_hh": 180.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Дизайнер": 10.0,
   "Разработчик Java": 40.0,
   "Разработчик Java Script": 10.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 138
 },
 {
  "task_id": "SRV-4072",
  "parent_id": "BR-164",
  "team_id": "Team-K",
  "summary": "Перевод эквайринга на асинхронную обработку",
  "status": "ToDo",
  "estimation_sp": 7.0,
  "estimated_hh": 210.0,
  "role_hours": {
   "Аналитик": 25.0,
   "Архитектор решений": 5.0,
   "ДевОпс": 10.0,
   "Дизайнер": 15.0,
   "Разработчик Java": 70.0,
   "Разработчик Java Script": 20.0,
   "Руководитель проекта": 40.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 139
 },
 {
  "task_id": "SRV-4081",
  "parent_id": "BR-165",
  "team_id": "Team-Alpha",
  "summary": "Витрина данных коммерческой аналитики",
  "status": "ToDo",
  "estimation_sp": 5.0,
  "estimated_hh": 140.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 10.0,
   "ДевОпс": 10.0,
   "Разработчик Java": 50.0,
   "Руководитель проекта": 15.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 140
 },
 {
  "task_id": "SRV-4082",
  "parent_id": "BR-165",
  "team_id": "Team-Alpha",
  "summary": "Оптимизация витрин и агрегатов ClickHouse",
  "status": "ToDo",
  "estimation_sp": 5.0,
  "estimated_hh": 190.0,
  "role_hours": {
   "Аналитик": 30.0,
   "Архитектор 1С": 3.0,
   "Архитектор решений": 10.0,
   "ДевОпс": 10.0,
   "Разработчик 1С": 57.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 15.0,
   "Специалист поддержки 1С": 10.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 141
 },
 {
  "task_id": "SRV-4091",
  "parent_id": "BR-166",
  "team_id": "Team-Alpha",
  "summary": "Проектирование витрины \"Программа лояльности\"",
  "status": "ToDo",
  "estimation_sp": 9.0,
  "estimated_hh": 120.0,
  "role_hours": {
   "Аналитик": 20.0,
   "Архитектор решений": 12.0,
   "ДевОпс": 17.0,
   "Разработчик Java": 55.0,
   "Руководитель проекта": 10.0,
   "Специалист поддержки": 1.0,
   "Тестировщик": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 142
 },
 {
  "task_id": "SRV-4092",
  "parent_id": "BR-166",
  "team_id": "Team-Alpha",
  "summary": "Реализация процессинга бонусных баллов",
  "status": "ToDo",
  "estimation_sp": 9.0,
  "estimated_hh": 240.0,
  "role_hours": {
   "Аналитик": 45.0,
   "Архитектор решений": 5.0,
   "ДевОпс": 10.0,
   "Дизайнер": 15.0,
   "Разработчик Java": 80.0,
   "Разработчик Java Script": 20.0,
   "Руководитель проекта": 40.0,
   "Специалист поддержки": 10.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 5.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 143
 },
 {
  "task_id": "SRV-4093",
  "parent_id": "BR-166",
  "team_id": "Team-K",
  "summary": "Интеграция лояльности с кассовым ПО",
  "status": "ToDo",
  "estimation_sp": 5.0,
  "estimated_hh": 160.0,
  "role_hours": {
   "Аналитик": 40.0,
   "Архитектор решений": 20.0,
   "ДевОпс": 20.0,
   "Разработчик Java": 40.0,
   "Руководитель проекта": 20.0,
   "Тестировщик": 10.0,
   "Тестировщик (Автотестирование)": 10.0
  },
  "blocks": [],
  "blocked_by": [],
  "priority": 144
 }
]

export const ENGINEERS: Engineer[] = [
 {
  "engineer_id": "ENG-401",
  "team_id": "Team-L",
  "role": "Разработчик Java",
  "grade": "Middle",
  "skills_declared": "Java, Spring Boot, PostgreSQL, Hibernate, Apache Kafka",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-402",
  "team_id": "Team-L",
  "role": "Разработчик Java",
  "grade": "Middle",
  "skills_declared": "Java, Spring Cloud, PostgreSQL, Docker, Liquibase",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-403",
  "team_id": "Team-L",
  "role": "Разработчик Java",
  "grade": "Senior",
  "skills_declared": "Java, Spring Framework, PostgreSQL, RabbitMQ, Microservices Архитектура",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-404",
  "team_id": "Team-L",
  "role": "Аналитик",
  "grade": "Senior",
  "skills_declared": "SQL, JSON, XML, REST API, SOAP, Power BI, Confluence, BPMN, UML",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-405",
  "team_id": "Team-L",
  "role": "Дизайнер",
  "grade": "Senior",
  "skills_declared": "Figma, Adobe Illustrator, UX/UI, HTML/CSS, A/B testing, CJM",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-405",
  "team_id": "Team-Alpha",
  "role": "Дизайнер",
  "grade": "Senior",
  "skills_declared": "Figma, Adobe Illustrator, UX/UI, HTML/CSS, A/B testing, CJM",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-406",
  "team_id": "Team-L",
  "role": "Разработчик Java Script",
  "grade": "Junior",
  "skills_declared": "JavaScript, React, REST API, GraphQL, HTML/CSS, Git",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-406",
  "team_id": "Team-Beta",
  "role": "Разработчик Java Script",
  "grade": "Junior",
  "skills_declared": "JavaScript, React, REST API, GraphQL, HTML/CSS, Git",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-407",
  "team_id": "Team-L",
  "role": "Разработчик Java Script",
  "grade": "Middle",
  "skills_declared": "JavaScript, TypeScript, Vue.js, Angular, REST API, GraphQL, WebSocket",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-408",
  "team_id": "Team-L",
  "role": "Тестировщик",
  "grade": "Middle",
  "skills_declared": "Usability, REST API, SQL, DevTools, Regression/Smoke/Functional testing, Postman",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-409",
  "team_id": "Team-L",
  "role": "Тестировщик",
  "grade": "Junior",
  "skills_declared": "Usability, REST API, Ручное тестирование, Снифферы трафика (Charles)",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-410",
  "team_id": "Team-L",
  "role": "Тестировщик (Автотестирование)",
  "grade": "Senior",
  "skills_declared": "Java, Selenium WebDriver, Playwright, Pytest, JUnit, SQL, Postman, CI/CD",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-411",
  "team_id": "Team-K",
  "role": "Тестировщик",
  "grade": "Middle",
  "skills_declared": "Usability, REST API, SQL, DevTools, Regression/Smoke/Functional testing",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-412",
  "team_id": "Team-K",
  "role": "Тестировщик",
  "grade": "Senior",
  "skills_declared": "Usability, REST API, Тестирование безопасности, Нагрузочное тестирование (JMeter)",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-413",
  "team_id": "Team-K",
  "role": "Тестировщик (Автотестирование)",
  "grade": "Middle",
  "skills_declared": "Java, Selenium WebDriver, Playwright, Pytest, JUnit, GitLab CI, SQL, Postman",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-414",
  "team_id": "Team-K",
  "role": "Разработчик Java",
  "grade": "Senior",
  "skills_declared": "Java, Core Spring, PostgreSQL, gRPC, ElasticSearch, Архитектура БД",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-415",
  "team_id": "Team-Platform",
  "role": "Тестировщик",
  "grade": "Middle",
  "skills_declared": "Usability, REST API, SQL, DevTools, Интеграционное тестирование",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-416",
  "team_id": "Team-Platform",
  "role": "Разработчик IOS",
  "grade": "Middle",
  "skills_declared": "Swift, SwiftUI, UIKit, MVC, MVVM, ARKit, CoreLocation, SQLite, CocoaPods",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-417",
  "team_id": "Team-Platform",
  "role": "Разработчик Android",
  "grade": "Middle",
  "skills_declared": "Kotlin, Java, Android SDK, Gradle, Jetpack Compose, Material Design, Dependency Injection, Room, SQLite",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-418",
  "team_id": "Team-Platform",
  "role": "Архитектор решений",
  "grade": "Senior",
  "skills_declared": "TOGAF, Архитектура ПО, Микросервисы, Проектирование интеграций, REST/gRPC",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-419",
  "team_id": "Team-Platform",
  "role": "Девопс",
  "grade": "Senior",
  "skills_declared": "Linux, Docker, Kubernetes, CI/CD (GitLab, Jenkins), Ansible, Terraform, Prometheus",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-419",
  "team_id": "Team-K",
  "role": "Девопс",
  "grade": "Senior",
  "skills_declared": "Linux, Docker, Kubernetes, CI/CD (GitLab, Jenkins), Ansible, Terraform, Prometheus",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-420",
  "team_id": "Team-Platform",
  "role": "Разработчик .net",
  "grade": "Senior",
  "skills_declared": "C#, .NET Core, ASP.NET, Entity Framework, MS SQL, LINQ, Microservices",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-421",
  "team_id": "Team-L",
  "role": "Аналитик Big Data",
  "grade": "Senior",
  "skills_declared": "Python, SQL, Hadoop, Spark, Математическая статистика, BI инструменты",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-422",
  "team_id": "Team-L",
  "role": "Разработчик Big Data",
  "grade": "Senior",
  "skills_declared": "Python, PySpark, Scala, Hadoop, Hive, Airflow, Оптимизация ETL",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-423",
  "team_id": "Team-L",
  "role": "Руководитель BigData",
  "grade": "Senior",
  "skills_declared": "Управление Data-командами, Agile/Scrum, Продуктовые метрики ИИ, Роадмапы",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-424",
  "team_id": "Team-Alpha",
  "role": "Разработчик Java",
  "grade": "Senior",
  "skills_declared": "Java, Spring Boot, Микросервисы, PostgreSQL, Kafka, CI/CD",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-425",
  "team_id": "Team-Alpha",
  "role": "Аналитик",
  "grade": "Middle",
  "skills_declared": "Системный анализ, REST API, SQL, BPMN, UML, Confluence",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-426",
  "team_id": "Team-Alpha",
  "role": "Аналитик Big Data",
  "grade": "Middle",
  "skills_declared": "Python, SQL, Tableau, Математический анализ, Pandas",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-426",
  "team_id": "Team-Delta",
  "role": "Аналитик Big Data",
  "grade": "Middle",
  "skills_declared": "Python, SQL, Tableau, Математический анализ, Pandas",
  "capacity_rate": 0.5
 },
 {
  "engineer_id": "ENG-427",
  "team_id": "Team-Beta",
  "role": "Разработчик Java",
  "grade": "Middle",
  "skills_declared": "Java, Core, Spring Core, Hibernate, MS SQL, Git",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-428",
  "team_id": "Team-Beta",
  "role": "Аналитик",
  "grade": "Senior",
  "skills_declared": "Бизнес-анализ, Сбор требований, ТЗ, UML, REST/SOAP интеграции",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-429",
  "team_id": "Team-Delta",
  "role": "Разработчик Java",
  "grade": "Senior",
  "skills_declared": "Java, Spring Boot, Архитектура ИТ-систем, gRPC, Docker, Kubernetes",
  "capacity_rate": 1.0
 },
 {
  "engineer_id": "ENG-430",
  "team_id": "Team-Delta",
  "role": "Тестировщик",
  "grade": "Middle",
  "skills_declared": "Функциональное тестирование, Регресс, Postman, SQL, Jira",
  "capacity_rate": 1.0
 }
]

export const TEAM_HISTORY: TeamHistory[] = [
 {
  "team_id": "Team-L",
  "snapshot_date": "2026-05-04",
  "velocity_achieved": 8.0,
  "planned_sp": 12.0
 },
 {
  "team_id": "Team-L",
  "snapshot_date": "2026-05-18",
  "velocity_achieved": 12.0,
  "planned_sp": 12.0
 },
 {
  "team_id": "Team-Alpha",
  "snapshot_date": "2026-04-15",
  "velocity_achieved": 15.0,
  "planned_sp": 15.0
 },
 {
  "team_id": "Team-Alpha",
  "snapshot_date": "2026-04-29",
  "velocity_achieved": 12.0,
  "planned_sp": 15.0
 },
 {
  "team_id": "Team-Beta",
  "snapshot_date": "2026-04-15",
  "velocity_achieved": 10.0,
  "planned_sp": 12.0
 },
 {
  "team_id": "Team-Beta",
  "snapshot_date": "2026-04-29",
  "velocity_achieved": 11.0,
  "planned_sp": 12.0
 },
 {
  "team_id": "Team-K",
  "snapshot_date": "2025-12-16",
  "velocity_achieved": 14.0,
  "planned_sp": 17.0
 },
 {
  "team_id": "Team-K",
  "snapshot_date": "2025-12-30",
  "velocity_achieved": 18.0,
  "planned_sp": 17.0
 },
 {
  "team_id": "Team-Platform",
  "snapshot_date": "2025-12-02",
  "velocity_achieved": 8.0,
  "planned_sp": 10.0
 },
 {
  "team_id": "Team-Platform",
  "snapshot_date": "2025-12-16",
  "velocity_achieved": 10.0,
  "planned_sp": 10.0
 },
 {
  "team_id": "Team-Delta",
  "snapshot_date": "2026-04-15",
  "velocity_achieved": 9.0,
  "planned_sp": 10.0
 },
 {
  "team_id": "Team-Delta",
  "snapshot_date": "2026-04-29",
  "velocity_achieved": 10.0,
  "planned_sp": 10.0
 }
]

export const DEPENDENCIES: Dependency[] = [
 {
  "blocking_task_id": "KP-3898",
  "blocked_task_id": "ASUKD-5222"
 },
 {
  "blocking_task_id": "ANL-3041",
  "blocked_task_id": "ONK-2475"
 },
 {
  "blocking_task_id": "MOB-7011",
  "blocked_task_id": "MOB-7012"
 },
 {
  "blocking_task_id": "ASUKD-5222",
  "blocked_task_id": "QA-9022"
 },
 {
  "blocking_task_id": "DB-202",
  "blocked_task_id": "MP-102"
 },
 {
  "blocking_task_id": "MP-101",
  "blocked_task_id": "AI-302"
 },
 {
  "blocking_task_id": "SRV-4011",
  "blocked_task_id": "SRV-4012"
 },
 {
  "blocking_task_id": "SRV-4013",
  "blocked_task_id": "SRV-4014"
 },
 {
  "blocking_task_id": "SRV-4015",
  "blocked_task_id": "SRV-4016"
 },
 {
  "blocking_task_id": "MP-101",
  "blocked_task_id": "MP-102"
 },
 {
  "blocking_task_id": "MP-102",
  "blocked_task_id": "MP-103"
 },
 {
  "blocking_task_id": "DB-201",
  "blocked_task_id": "DB-202"
 },
 {
  "blocking_task_id": "DB-202",
  "blocked_task_id": "DB-203"
 },
 {
  "blocking_task_id": "AI-301",
  "blocked_task_id": "AI-302"
 },
 {
  "blocking_task_id": "SRV-4011",
  "blocked_task_id": "SRV-4019"
 }
]

export const DATASET_COLUMN_GUESSES: ColumnGuess[] = [
 {
  "column": "Номер инициативы",
  "entity": "task",
  "field": "parent_id",
  "confidence": "high"
 },
 {
  "column": "task_id",
  "entity": "task",
  "field": "task_id",
  "confidence": "high"
 },
 {
  "column": "parent_id",
  "entity": "task",
  "field": "parent_id",
  "confidence": "high"
 },
 {
  "column": "summary",
  "entity": "task",
  "field": "summary",
  "confidence": "high"
 },
 {
  "column": "team_id",
  "entity": "task",
  "field": "team_id",
  "confidence": "high"
 },
 {
  "column": "status",
  "entity": "task",
  "field": "status",
  "confidence": "high"
 },
 {
  "column": "rung",
  "entity": "task",
  "field": "rank",
  "confidence": "high"
 },
 {
  "column": "spent_time",
  "entity": "task",
  "field": "spent_time",
  "confidence": "high"
 },
 {
  "column": "estimation_sp",
  "entity": "task",
  "field": "estimation_sp",
  "confidence": "high"
 },
 {
  "column": "created_at",
  "entity": "task",
  "field": "created_at",
  "confidence": "high"
 },
 {
  "column": "planned_start",
  "entity": "task",
  "field": "planned_start",
  "confidence": "high"
 },
 {
  "column": "planned_end",
  "entity": "task",
  "field": "planned_end",
  "confidence": "high"
 },
 {
  "column": "actual_start",
  "entity": "task",
  "field": "actual_start",
  "confidence": "high"
 },
 {
  "column": "actual_end",
  "entity": "task",
  "field": "actual_end",
  "confidence": "high"
 },
 {
  "column": "estimated_hh",
  "entity": "task",
  "field": "estimated_hh",
  "confidence": "high"
 },
 {
  "column": "плановый результат",
  "entity": "task",
  "field": "planned_result",
  "confidence": "high"
 },
 {
  "column": "будет включено в спринт",
  "entity": "task",
  "field": "planned_in_sprint",
  "confidence": "high"
 },
 {
  "column": "заказчик",
  "entity": "task",
  "field": "customer_result",
  "confidence": "high"
 },
 {
  "column": "исполнитель",
  "entity": "task",
  "field": "performer_result",
  "confidence": "high"
 },
 {
  "column": "итоговый результат",
  "entity": "task",
  "field": "final_result",
  "confidence": "high"
 }
]

export const DATASET_UNMAPPED: string[] = []

export const DATASET_PREVIEW_COUNTS: Record<string, number> = {
 "task": 115,
 "engineer": 57,
 "role_requirement": 23,
 "dependency": 16,
 "team_history": 12
}

export const DATASET_CONFIRM_COUNTS: Record<string, number> = {
 "tasks": 45,
 "dependencies": 15,
 "role_requirements": 307,
 "engineers": 34,
 "team_history": 12
}

export const BUS_FACTOR_METHODOLOGY: string = "Bus Factor = число носителей компетенции (роли или заявленного навыка) в области расчёта (компания или команда); инженер, работающий в двух командах по 0.5 ставки, считается носителем в обеих. Риск отмечается при factor ≤ 1. Расчёт по профилям engineers_profiles; грейд не влияет. Ограничение методики: навыки заявлены декларативно и проверяются по строке skills_declared (без учёта уровня владения)."

