# Политика веток и pull request / merge request

Цель: изолировать работу по **задаче** в отдельной ветке, интегрировать в основную линию только через **прозрачный PR/MR** и согласованный процесс (см. [`approval-policy.md`](approval-policy.md)).

## Ветка на задачу

- Каждая **Task** из спецификации (EPIC → Story → Task) выполняется в **отдельной ветке**, ответвлённой от **целевой базовой ветки** (по умолчанию `main`; если в репозитории договорён другой поток — Team Lead фиксирует это в задаче).
- Не смешивать в одной ветке несколько несвязанных задач без явного решения Team Lead.

## Именование веток

**По умолчанию в этом репозитории** — префиксы по типу работы:

```text
feature/<short-name>
fix/<short-name>
hotfix/<short-name>
refactor/<short-name>
research/<short-name>
```

Примеры: `feature/intake-validation`, `fix/worker-redis-reconnect`, `hotfix/xml-escape-mis`.

**Допустимая альтернатива** — привязка к идентификатору задачи в постановке / трекере:

```text
task/<task-id>-<kebab-case-short-slug>
```

Примеры: `task/story-08-audio-retention`, `task/STORY-12-fix-logging`.  
`<task-id>` задаёт **Team Lead** в спеке; суффикс — краткая суть (латиница, дефисы).

Принцип неизменен: **одна задача — одна ветка**; префикс выбирается по смыслу задачи или по договорённости с Team Lead.

## Ограничения для Programmer

- **Не коммитить напрямую** в `main` / `master` (и в защищённые ветки релиза), кроме случаев, когда Team Lead явно описал иной процесс для конкретного репозитория (редко).
- Вся реализация — в ветке задачи; обновления базовой ветки — через **rebase/merge из `main` по договорённости команды** или инструкции Team Lead.

## Pull Request / Merge Request

- **PR/MR** в базовую ветку открывается (или доводится до готовности), когда работа **готова к проверке по процессу**: выполнен handoff **Programmer → Tester**, зафиксирован **QA PASS** (sign-off тестировщика) по [`ai-office/checklists/qa-checklist.md`](../checklists/qa-checklist.md).
- В описании PR указывать: ссылку на задачу/спеку, кратко что сделано, как проверялось (по возможности).
- **Слияние** в `main` — только после выполнения [`approval-policy.md`](approval-policy.md): задокументированный **QA PASS** (sign-off Tester) и **утверждение merge** от Team Lead (не путать с ролью тестировщика в GitHub UI).

## Защита веток (рекомендация для репозитория)

- Включить защиту `main`: запрет прямого push, обязательный PR, обязательное approve от ответственных (в идеале — Team Lead или правило, согласованное с ним).
- CI/проверки — по политике проекта; Team Lead задаёт, что обязательно для merge.

## Связанные документы

- [`approval-policy.md`](approval-policy.md) — кто и когда approve, merge, релиз.
- [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc) — контракты ролей.
- [`ai-office/templates/programmer-handoff-template.md`](../templates/programmer-handoff-template.md) — handoff программиста.
