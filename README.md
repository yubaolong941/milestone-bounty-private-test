# Milestone Pay

Milestone Pay is a Next.js foundation for AI delivery and bounty settlement
workflows. It connects task publishing, claim binding, code review, budget
locking, payout execution, and audit evidence into one reviewable flow.

The project is intentionally small enough to run locally, while still showing
the operational pieces a bounty platform needs: internal staff views, external
collaborator views, GitHub integration points, settlement records, and evidence
exports.

## Main Flow

```text
Requirement Binding
-> Publish Task
-> Claim
-> Deliver
-> Verify
-> Review
-> Finance Approval
-> Payout
-> Evidence Export
```

## Product Entry Points

| Route | Purpose |
| --- | --- |
| `/` | Public product entry and overview |
| `/login` | Role-based login entry |
| `/staff` | Internal operations, review, finance, and audit console |
| `/external` | External collaborator task and payout visibility |

## What Is Included

- Task and bounty lifecycle pages.
- Internal and external workflow surfaces.
- GitHub issue, PR, webhook, and demo event scripts.
- MySQL-backed runtime option with SQL initialization scripts.
- File-backed runtime option for local demos without a database.
- Settlement, payout retry, audit, and reporting helpers.
- Vitest, ESLint, TypeScript, and build verification scripts.

## Tech Stack

- Next.js 14
- React 18
- TypeScript 5
- Tailwind CSS
- MySQL 8 compatible storage
- Vitest

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For the lightest local setup, keep `RUNTIME_DATA_BACKEND=file` in
`.env.local`. Use `RUNTIME_DATA_BACKEND=mysql` only when a MySQL instance is
available and the `MYSQL_*` variables are configured.

## Environment Setup

Minimum variables for a local file-backed run:

```env
RUNTIME_DATA_BACKEND=file
SESSION_SECRET=replace_with_a_long_random_secret
APP_BASE_URL=http://localhost:3000
```

Minimum variables for a MySQL-backed run:

```env
RUNTIME_DATA_BACKEND=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=milestone_pay
MYSQL_PASSWORD=replace_me
MYSQL_DATABASE=milestone_pay
SESSION_SECRET=replace_with_a_long_random_secret
```

Optional integrations are configured through `.env.example`, including GitHub
PAT mode, GitHub App mode, Meegle sync, inference smoke tests, and BSC USD1
treasury settings.

## Standard Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local development |
| `npm run build` | Build the production app |
| `npm run start` | Start the production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run unit tests |
| `npm run verify` | Run lint, typecheck, and tests |
| `npm run ci` | Run verify and production build |
| `npm run db:verify` | Verify MySQL connectivity |
| `npm run db:migrate` | Apply SQL initialization and migrations |
| `npm run infer:smoke` | Verify inference gateway connectivity |
| `npm run demo:github` | Preview GitHub webhook demo events |
| `npm run demo:github:send` | Send demo events to the local webhook |
| `npm run meegle:sync` | Run one Meegle sync cycle |
| `npm run meegle:sync:watch` | Run Meegle sync continuously |

## Repository Structure

```text
src/app/                 Next.js pages and API routes
src/components/          Frontend business components
src/lib/                 Business logic, adapters, data access
scripts/                 Local verification and demo scripts
sql/                     Initialization and migration scripts
docs/                    Project reference and runbook notes
tests/                   Unit and integration-oriented tests
.github/workflows/       CI workflows
```

## Verification Checklist

Use this checklist before submitting changes or presenting a demo:

1. Install dependencies with `npm install`.
2. Create `.env.local` from `.env.example`.
3. Choose `RUNTIME_DATA_BACKEND=file` for local-only verification or configure
   MySQL and run `npm run db:verify`.
4. Run `npm run lint`.
5. Run `npm run typecheck`.
6. Run `npm run test`.
7. Run `npm run build` for production readiness.
8. Capture any failing command output in the PR description if the failure is
   unrelated to the submitted change.

## Documentation

The detailed project reference is maintained in [docs/README.md](docs/README.md).
Use it for architecture, roles, settlement rules, database initialization,
incident handling, reporting, and takeover notes.

Recommended reading order:

1. This README.
2. [Project Reference](docs/README.md).
3. `.env.example`.
4. `package.json` scripts.
5. `sql/001_wlfi_init_schema.sql`.

## Delivery Constraints

- Do not commit `.env.local`, private keys, webhook secrets, wallet private
  keys, or real payout operator credentials.
- Keep README and docs links repository-relative so they work on GitHub and in
  local clones.
- Prefer small PRs that state the affected flow, verification commands, and any
  known unrelated failures.
- Use `npm run ci` as the minimum local acceptance standard when code changes
  affect runtime behavior.
