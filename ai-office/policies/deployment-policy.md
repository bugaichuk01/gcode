# Политика выкладки (deploy / release execution)

Цель: зафиксировать **порядок действий** после merge в основную линию и согласовать его с политикой согласований.

## Обязательные ссылки

- Согласования и merge: [`approval-policy.md`](approval-policy.md) — PASS от Tester, approve от Team Lead, затем merge.
- Ветки и PR/MR: [`branch-and-pr-policy.md`](branch-and-pr-policy.md).
- Контракты ролей и user-facing: [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc).

## Выкладка

- **Deploy / release** в целевое окружение выполняется **после** approve Team Lead на интеграцию (или по явному релизному шагу из спеки задачи).
- Ориентир по проверкам: [`ai-office/checklists/release-checklist.md`](../checklists/release-checklist.md).
- **Итог пользователю** (что выкатили, ссылки) — **только Team Lead**, не Programmer/Tester/Quant.

## Краткая схема

```text
merge в main (по approval-policy)
    → deploy/release по спеке и release-checklist
    → отчёт пользователю (Team Lead)
```
