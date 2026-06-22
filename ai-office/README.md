# AI Office — правила и процесс

Единая структура для агентов в этом репозитории.

| Тип | Назначение |
|-----|------------|
| **`.mdc`** | Жёсткие инструкции для агента (роли, запреты). Подхватываются Cursor из `.cursor/rules/` (симлинк на `ai-office/` рекомендуется). |
| **`.md`** | Процесс, шаблоны, справка. |

## Навигация (от `ai-office/`)

- Вход задач: [`task-intake.md`](task-intake.md)
- Глобальные правила: [`global/`](global/)
- Роли: [`agents/`](agents/)
- Процесс: [`process/`](process/) · шаблоны: [`templates/`](templates/) · чеклисты: [`checklists/`](checklists/) · политики: [`policies/`](policies/)

**Маршрутизация:** официальная постановка и итоги для пользователя — через **Team Lead**; исполнение — Programmer / Tester / Quant (см. [`global/handoff-contracts.mdc`](global/handoff-contracts.mdc)).

**Канон офиса** — этот каталог `ai-office/`; при расхождении с копиями в `docs/templates/` ориентир — `ai-office/`.
