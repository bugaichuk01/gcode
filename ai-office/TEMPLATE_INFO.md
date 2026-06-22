# AI Office — template bundle

- **Version:** v1.0  
- **Description:** Portable copy of the AI Office rule set (global contracts, roles, process, templates, checklists, policies, optional domain commands). Drop the `ai-office/` folder into any repository root and wire Cursor rules to it.

## How to use

1. Extract or copy the `ai-office/` directory to the **root** of your target repository.
2. Copy **`ai-office/AGENTS_TEMPLATE.md`** to the repository **root** as **`AGENTS.md`** (Cursor discovers `AGENTS.md` at root; the template is the canonical starter text). Alternatively use the **`AGENTS.md`** bundled at the **root of `ai-office-template.zip`** next to `ai-office/`.
3. Point Cursor at the rules: symlink `.cursor/rules/ai-office` → `../../ai-office` (adjust if `.cursor` lives elsewhere), or use your editor’s equivalent to load `ai-office/**/*.mdc`.
4. Adjust **`AGENTS.md`** for project-specific links (e.g. extra `docs/` paths, CI, optional commands).
5. Keep `ai-office/task-intake.md` as the canonical intake; align `docs/` templates with it if you keep duplicates.
6. Enable branch protection and CI to match `ai-office/policies/` as appropriate for your host (GitHub/GitLab).

## What you can customize

- **`docs/`** and project-specific templates outside `ai-office/` — keep `ai-office/` as the canonical office rules.
- **Domain commands** under `ai-office/commands/` — add only when your product needs scripted workflows; keep paths and names aligned with this repository.
- **Team names** (Туся / Пуся / …) — optional localization; do not change routing rules without updating `global/handoff-contracts.mdc` consistently.
- **Task intake table** — add or remove columns for your stack; keep EPIC → Story → Task hierarchy.

## What not to change

- Do not strip **User → Team Lead → internal roles → Team Lead → User** routing or merge/QA order without a deliberate project decision and updates across `global/`, `agents/`, and `policies/`.
