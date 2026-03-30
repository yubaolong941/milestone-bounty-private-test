# bounty-pay

Milestone Pay is a Next.js foundation for AI delivery and bounty settlement scenarios, covering task publishing, claim binding, code review, budget locking, payment execution, and audit trail.

## Why this repository is ready for delivery

- New-contributor-friendly entry point: this README + [Project Reference](/Users/fergus/WLFIAgent/milestone-bounty-pay/docs/README.md)
- Single maintained documentation source: [Project Reference](/Users/fergus/WLFIAgent/milestone-bounty-pay/docs/README.md)
- Setup, environment, architecture, database, demo, ops, and testing are all consolidated there
- Engineering quality gates: `lint`, `typecheck`, `test`, `build`
- Automated pipeline: GitHub Actions CI, runs `npm run ci` by default

## Tech Stack

- Next.js 14
- React 18
- TypeScript 5
- Tailwind CSS
- MySQL
- Vitest

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Default access URL: [http://localhost:3000](http://localhost:3000).

If you only want to verify the engineering foundation without connecting external systems, use:

```bash
npm run verify
```

## Standard Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm run start` | Start production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run unit tests |
| `npm run verify` | Run lint + typecheck + test sequentially |
| `npm run ci` | Run verify + build sequentially |
| `npm run db:verify` | Verify MySQL connectivity |
| `npm run infer:smoke` | Verify AI inference gateway connectivity |
| `npm run demo:github` | Preview GitHub webhook demo events |
| `npm run demo:github:send` | Send demo events to local webhook |

## Repository Structure

```text
src/app/                 Next.js pages and API routes
src/components/          Frontend business components
src/lib/                 Business logic, adapters, data access
scripts/                 Local verification and demo scripts
sql/                     Initialization and migration scripts
docs/                    Delivery docs, runbooks, environment notes
tests/                   Basic unit tests
.github/workflows/       CI workflows
```

## Recommended Reading Order

1. [Project Reference](/Users/fergus/WLFIAgent/milestone-bounty-pay/docs/README.md)

## Delivery Constraints

- `.env.local` is for local use only; do not commit real keys, tokens, or wallet private keys.
- Run `npm run verify` at least once before any demo.
- Use `npm run ci` as the minimum local acceptance standard before submitting a PR.
