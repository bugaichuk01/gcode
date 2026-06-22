# Agent Project Office

This repository uses **`ai-office/`** for Cursor rules (via symlink `.cursor/rules/ai-office` → `ai-office/`) and process docs.

- **`.mdc`** — hard agent instructions (roles, prohibitions, mandatory actions).
- **`.md`** — process description, templates, reference (`ai-office/process/`, `ai-office/templates/`).

## Rules (`ai-office/`)

| Path | Purpose |
|------|---------|
| **`ai-office/global/global-standards.mdc`** | Always on. Stack policy, **intake only through Team Lead**, config, logging, EPIC→Story→Task, Definition of Done. |
| **`ai-office/global/handoff-contracts.mdc`** | Always on. Valid handoffs; **single user-facing entry — Team Lead**. |
| **`ai-office/global/security-baseline.mdc`** | Always on. Secrets, exposure, logging safety. |
| **`ai-office/commands/`** | Optional domain commands (if present; e.g. version-clone helpers — not global standards). |
| **`ai-office/agents/team-lead/role.mdc`** | Team Lead — **only user-facing role**; specs; routes Programmer/Tester/Quant; final review. |
| **`ai-office/agents/programmer/role.mdc`** | Programmer — implements tasks from Team Lead only; hands off to Tester. |
| **`ai-office/agents/tester/role.mdc`** | Tester — QA gate; receives from Programmer; hands to Team Lead after checklist. |
| **`ai-office/agents/quant/role.mdc`** | Quant — **not user-facing**; analysis assigned by Team Lead; results to TL. |

## Workflow

1. **New work** → **`ai-office/task-intake.md`** → invoke **Team Lead** (`ai-office/agents/team-lead/role.mdc`) for EPIC → Stories → Tasks.
2. **Implementation** → Team Lead → **Programmer**; handoffs → **`ai-office/templates/programmer-handoff-template.md`**.
3. **QA** → **Tester** → **`ai-office/checklists/qa-checklist.md`**, **`ai-office/templates/tester-report-template.md`**.
4. **Before deploy** → **`ai-office/checklists/release-checklist.md`**, **`ai-office/checklists/review-checklist.md`** (and project security docs if you maintain them outside `ai-office/`).
5. **Git** → **`ai-office/policies/branch-and-pr-policy.md`**, **`ai-office/policies/approval-policy.md`**, **`ai-office/policies/deployment-policy.md`**.

## Docs

| Path | Use |
|------|-----|
| `ai-office/task-intake.md` | Canonical task intake. |
| `ai-office/README.md` | Index of the office layout. |
| `ai-office/policies/` | Branch/PR, approval, deployment. |

## Quick reference

- **Official work** goes through **Team Lead** only (`ai-office/global/handoff-contracts.mdc`). **Programmer**, **Tester**, **Quant** are internal — they **must not** deliver final work or status to the **end user**.
- Work: **EPIC → Story → Task** before coding (per global standards).
- **Docker compose** only when the task/stack includes Docker (`ai-office/global/global-standards.mdc`); config via **env**; no secrets in Git.
