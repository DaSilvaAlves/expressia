---
name: Expressia (codename meu-jarvis) project context
description: Product naming, market scope, and stack constraints that affect every QA review in this repo
type: project
---

Product is **Expressia** (UI-facing brand) with codename `meu-jarvis` (used in package names, repo, code).

**Why:** This dual-naming is enforced — `@meu-jarvis/web`, `@meu-jarvis/db` in `package.json`, but `<h1>Expressia</h1>` in UI strings, `lang="pt-PT"`, "Expressia" in metadata. Mixing the two (e.g., "meu-jarvis" in UI copy) is a PT-PT compliance failure.

**How to apply:** When doing QA Compliance check #6 (PT-PT), grep for:
- `Brasil|PT-BR|CPLP|R\$|BRL|NF-e|você` in `apps/` and `packages/db/src/` — must be zero
- Codename `meu-jarvis` should appear ONLY in `package.json` `name` fields and workspace deps (`"@meu-jarvis/db": "workspace:*"`)
- "Expressia" should appear in `layout.tsx` metadata, `page.tsx` UI strings, `vercel.json` if present
- `<html lang="...">` MUST be `"pt-PT"` (not `"pt"` or `"pt-BR"`)

**Market scope:** PT-PT only (Portugal). No Brasil, no CPLP. Currency EUR. Data residency UE (Vercel `fra1` Frankfurt). This is a constitutional constraint — story PRDs include CON3/CON4 explicitly.

**Stack (locked in PRD/Architecture §2):**
- Next.js 15.x App Router, React 19, TypeScript 5.5+ strict
- pnpm 9.x workspaces, Turbo 2.x, Vitest 2.x, Node 20 LTS
- Supabase (eu-central-1), Drizzle ORM in `packages/db/`
- Tailwind 4.x is in spec but @dev (Story 1.1) used Tailwind 3.4 with documented justification (4.x still alpha) — this is an accepted exception to track when squad/design-system stories arrive.
