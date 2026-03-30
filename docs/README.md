# tomo Project Reference

This is the only maintained document under `docs/`.

Its purpose is to keep the current project state, architecture, flow, setup, operations, database, demo, reporting, and testing guidance in one place. If any separate document used to exist, treat this file as the latest source of truth.

## 1. What This Project Is

`tomo` is a task-to-payment platform facade. It is not a loose collection of pages. It is meant to present one auditable main flow:

```text
Requirement Binding -> Publish Task -> Claim -> Deliver -> Verify -> Review -> Finance -> Payout -> Evidence Export
```

The project serves three kinds of usage at the same time:

- internal operations and delivery orchestration
- external collaborator claim / delivery / payout visibility
- client, leadership, and audit facing evidence output

## 2. Current Product Entry Points

- `/`
  public-facing product landing entry
- `/login`
  role-based login entry
- `/staff`
  internal console for admin, operations, reviewer, and finance
- `/external`
  external collaborator portal

## 3. Current Golden Path

### 3.1 Company Onboarding

```text
Internal user login
-> create company
-> switch active company
-> configure members
-> configure repositories
-> bind company wallet
-> publish first external task
```

### 3.2 Delivery to Payment

```text
Requirement binding
-> internal task intake
-> publish as external bounty
-> claim by GitHub identity
-> wallet binding
-> PR / commit delivery
-> AI / CI / manual review
-> finance approval
-> payout execution
-> audit / export
```

### 3.3 Third-Party Integration Responsibility Split

- `Lark`
  requirement reference only, optional, not a hard gate for AI scoring
- `Meegle`
  business status and upstream requirement intake
- `GitHub`
  execution facts such as issues, PRs, comments, merge state, and review state
- `Platform`
  binding, orchestration, permission, settlement, payout, notification, and audit

## 4. Current Architecture Baseline

### 4.1 Main Domain Objects

- `TaskBounty`
  current execution object in the platform
- `RequirementBinding`
  unified requirement binding around Meegle / Lark / GitHub
- `SettlementCase`
  settlement ownership, allocation, payout, failure, and retry state
- `WorkflowEvent`
  event input, idempotency, replay, and dead-letter support
- `PayoutAttempt`
  explicit payout execution records and防重 context
- `TreasuryFunding`
  platform custody funding records

### 4.2 Current Architectural Direction

The project has already moved away from scattered direct state mutation and toward:

- workflow-driven state transitions
- settlement domain separation
- requirement binding unification
- onboarding state modeling
- connectivity health modeling
- workflow event persistence

The direction is correct. The current codebase is no longer in the earlier “demo-only patchwork” stage.

## 5. Role Views

### 5.1 Admin / Platform Owner

Primary concern:

- overall platform health
- blockers affecting demos or clients
- audit readiness

Main pages:

- `/staff`
- health
- audit
- exports

### 5.2 Operations

Primary concern:

- task intake
- publish / review / payout closure
- blocker tracking

Main pages:

- `/staff`
- task flow
- manual review
- notifications

### 5.3 Reviewer

Primary concern:

- approval / rejection decisions
- evidence sufficiency
- PR / CI / AI gate outcomes

Main pages:

- `/staff`
- review queue
- task details

### 5.4 Finance

Primary concern:

- payout readiness
- failure retry
- treasury and ledger closure

Main pages:

- `/staff`
- settlement queue
- payment history
- treasury funding history

### 5.5 External Collaborator

Primary concern:

- what can be claimed
- what is under review
- whether payout is ready or blocked

Main page:

- `/external`

## 6. Environment and Startup

### 6.1 Basic Requirements

- Node.js 20.x
- npm 10.x
- MySQL 8.x or compatible instance
- optional browser wallet extension

### 6.2 Install

```bash
npm install
cp .env.example .env.local
```

### 6.3 Minimum Startup Variables

For page-level startup:

```env
RUNTIME_DATA_BACKEND=file
SESSION_SECRET=replace_with_a_long_random_secret
```

For MySQL-backed runtime:

```env
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DATABASE=...
RUNTIME_DATA_BACKEND=mysql
SESSION_SECRET=...
```

### 6.4 Common Important Variables

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `RUNTIME_DATA_BACKEND`
- `SESSION_SECRET`
- `INFER_API_KEY` or `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `AI_MODEL`
- `WLFI_NETWORK`
- `GITHUB_TOKEN`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`
- `MEEGLE_MCP_TOKEN`
- `APP_BASE_URL`

### 6.6 GitHub App Integration (recommended)

This project supports two GitHub auth modes for repository sync / issue / PR operations:

- PAT mode: set `GITHUB_TOKEN` or per-repo `tokenRef`
- GitHub App mode: set GitHub App variables and use `tokenRef=ghapp:<installationId>`

Recommended setup flow:

1. Configure app variables in `.env.local`:

```env
GITHUB_APP_SLUG=your-github-app-slug
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_BASE64=...   # preferred
# or
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

2. In Integration Setup, click "Connect via GitHub App" to install the app and get `installationId`.
3. Create repo config with `tokenRef` set to `ghapp:<installationId>`.
4. Run repo "Test connection". The backend will mint installation access tokens automatically.

Notes:

- `ghapp:<installationId>` now works in repo connection testing and GitHub issue sync.
- Installation tokens are cached server-side and auto-refreshed before expiry.

### 6.5 Start Commands

```bash
npm run dev
```

Recommended engineering verification:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Or:

```bash
npm run ci
```

## 7. Database Initialization

The SQL directory has been simplified to a single canonical initialization script:

- `sql/001_wlfi_init_schema.sql`

This script is generated from the current live MySQL schema and is now the only maintained initialization source.

### 7.1 Current `wlfi_*` Tables

- `wlfi_companies`
- `wlfi_company_wallets`
- `wlfi_company_memberships`
- `wlfi_recipient_profiles`
- `wlfi_audit_logs`
- `wlfi_repo_configs`
- `wlfi_internal_member_bindings`
- `wlfi_integration_health_states`
- `wlfi_notifications`
- `wlfi_wallet_identity_bindings`
- `wlfi_task_claims`
- `wlfi_task_bounties`
- `wlfi_payments`
- `wlfi_requirement_bindings`
- `wlfi_treasury_fundings`
- `wlfi_settlement_cases`
- `wlfi_payout_attempts`
- `wlfi_workflow_events`

### 7.2 Init Commands

```bash
npm run db:verify
npm run db:migrate
```

`npm run db:migrate:access-control` also now just executes the SQL files currently present in `sql/`.

## 8. Settlement and Treasury Rules

### 8.1 Custody Model

The current platform model is:

- company funds the tomo custody wallet first
- platform records treasury funding
- settlement ownership moves into `SettlementCase`
- after review and finance approval, payout is executed from the platform custody side toward the recipient wallet

### 8.2 Important Constraints

- payout does not rely on `bounty:$xx` labels anymore as the primary settlement authority
- payout execution uses explicit payout context and idempotency control
- recipient final wallet is frozen into the settlement domain before payout
- finance approval and payout execution are now separate responsibilities

### 8.3 Escrow / Lock

The codebase keeps escrow-oriented concepts and compatibility layers, but current settlement authority is centered on:

- treasury funding
- settlement case
- payout attempt

## 9. Requirement Binding Rules

The current rule is:

- Lark is optional reference material
- Meegle is the upstream business source
- GitHub is execution fact source
- requirement binding is unified inside the platform

### 9.1 Requirement Binding Minimum Elements

- `requirementId`
- title
- upstream reference
- acceptance criteria snapshot
- summary snapshot
- company context
- GitHub issue linkage when applicable

### 9.2 Important Boundary

AI requirement scoring should not be blocked by inability to read a Lark document. Lark is now treated as optional supporting reference, not as a hard dependency of the scoring path.

## 10. Demo and Presentation

### 10.1 What To Demo

For a short walkthrough, the recommended story is:

1. open `/`
2. open `/login`
3. open `/staff`
4. explain task -> review -> payout -> audit in one screen family
5. open `/external`
6. show collaborator-side transparency

### 10.2 Demo Support Commands

```bash
npm run demo:github
npm run demo:github:send
npm run infer:smoke
```

### 10.3 Demo Principles

- show one main flow, not disconnected modules
- speak in terms of trust, closure, and evidence
- do not over-explain internal implementation details first
- keep scenario controllable

## 11. Operations and Incident Handling

### 11.1 Where To Look First

Recommended order:

1. `/staff`
2. notifications / alerts
3. health
4. settlement / payment history
5. audit trail

### 11.2 Common Incident Types

- payment failure
- manual review backlog
- finance backlog
- integration health degradation
- binding mismatch

### 11.3 Incident Handling Principles

- first determine whether client-facing trust is affected
- then identify current owner
- then identify whether retry is automatic or manual
- then supplement audit evidence
- then sync externally if needed

## 12. Reporting and Exports

Current supported export directions include:

- operations daily report
- client summary
- weekly report
- KPI-style CSV
- audit CSV
- payment ledger CSV

These are management and evidence outputs, not just internal debug views.

## 13. Scheduled Sync

The project supports scheduled sync for Meegle and GitHub issue intake.

Commands:

```bash
npm run meegle:sync
npm run meegle:sync:watch
```

Useful variables:

- `SYNC_BASE_URL`
- `MEEGLE_SYNC_INTERVAL_SECONDS`
- `GITHUB_INTERNAL_REPO_FULL_NAME`

## 14. Testing Strategy

The project testing direction has already been formalized around high coverage for core business code.

### 14.1 Main Goal

- drive core business code to `90%` coverage

### 14.2 Current Recommended Split

- Role A
  workflow / auth / onboarding / permissions / connectivity
- Role B
  database / repositories / settlement / payout / treasury
- Role C
  tasks API / config API / dashboard and interaction components

### 14.3 Priority

- first test infrastructure
- then pure logic domains
- then repository and database layer
- then API routes
- then critical UI interaction
- finally CI gate enforcement

## 15. Current Source of Truth Rules

To avoid future drift, use the following rules:

- `docs/README.md` is the only maintained document
- if a new document is needed temporarily, it should be merged back here after decisions settle
- if code and this document conflict, code plus live schema win first, then this document must be updated

## 16. Quick Takeover Checklist

If someone new takes over the project, they should be able to answer these questions quickly:

- What is the one main flow?
- Where do internal users work?
- Where do external collaborators work?
- How does onboarding progress?
- How does payout authority work?
- What is the current database initialization script?
- Which tables are live?
- How are Meegle / Lark / GitHub divided?
- How do incidents get handled?
- How will testing be organized to reach high coverage?
