# Политика согласований (approve) и выкладки

Цель: **merge в основную ветку**, **релиз** и **сообщение пользователю** происходят только после согласованной цепочки проверок. См. также [`branch-and-pr-policy.md`](branch-and-pr-policy.md).

**Термины:** **QA PASS / sign-off** — результат тестировщика по чек-листу; **approve merge** — процессное утверждение Team Lead на слияние. Тестировщик **не** заменяет Team Lead при утверждении merge.

## Цепочка обязательна

1. **Programmer → Tester:** формальный handoff по [`ai-office/templates/programmer-handoff-template.md`](../templates/programmer-handoff-template.md).
2. **Tester:** проверка по [`ai-office/checklists/qa-checklist.md`](../checklists/qa-checklist.md); итог — **PASS** или FAIL в [`ai-office/templates/tester-report-template.md`](../templates/tester-report-template.md).
3. **Team Lead:** **code review** и **approve** merge/релиза **только после PASS** от Tester.

## Правила approve

- **Team Lead не утверждает** (не даёт approve на merge и не считает работу принятой для интеграции) **без задокументированного PASS** от Tester по чек-листу для этой задачи/PR.
- При **FAIL** — возврат программисту по процессу доработки; повторный цикл Tester → при PASS → Team Lead.

## Merge в main

- **Merge PR/MR** в `main` (или целевую релизную ветку) — **после**:
  - PASS от Tester;
  - review и **approve** от Team Lead (и выполнения требований репозитория: CI, линтеры — если включены).

Кто физически нажимает «Merge» (Team Lead или доверенный мейнтейнер) — договорённость репозитория; **ответственность за соответствие этой политике** — у Team Lead.

## Deploy / release

- **Выкладка в окружение** (staging/production) и **релизные действия** — **после** approve Team Lead на интеграцию (merge в основную линию) или после явного релизного шага, описанного в спеке.
- Ориентир по чеклисту: [`ai-office/checklists/release-checklist.md`](../checklists/release-checklist.md); порядок выкладки — [`deployment-policy.md`](deployment-policy.md).
- Не релизить «мимо» approve, если задача шла по офисному процессу.

## Сообщение пользователю

- **Итог по задаче** (готово, что сделано, ссылки на PR/релиз) сообщает **только Team Lead** — в соответствии с [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc) (единый user-facing вход).

## Краткая схема

```text
ветка задачи → реализация (Programmer)
    → handoff → QA (Tester) → PASS
    → PR + review → approve (Team Lead)
    → merge → (deploy/release по спеке)
    → отчёт пользователю (Team Lead)
```
