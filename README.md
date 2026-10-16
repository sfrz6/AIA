# ITPF Competition System

Official competition management and scoring for International Tent Pegging
Federation championships.

The system runs a three day championship end to end: reusable championship
templates, the permanent country and rider registry, championship squads, entry
orders confirmed before every run, scoring, run confirmation, audited
corrections of confirmed results, individual and country standings, printed
round sheets for the manual referee, and a public results area.

Scoring reproduces the federation's existing Excel workbook exactly. The mapping
from every workbook formula to the implementation, and every inconsistency found
in that workbook, is recorded in [SCORING_AUDIT.md](SCORING_AUDIT.md).

---

## Contents

- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Neon and Vercel](#neon-and-vercel)
- [Commands](#commands)
- [Testing](#testing)
- [The permission model](#the-permission-model)
- [Scoring model in brief](#scoring-model-in-brief)
- [Branding and languages](#branding-and-languages)
- [Security notes](#security-notes)
- [Designed for Version 2](#designed-for-version-2)

---

## Architecture

A modular monolith on Next.js, deliberately not a set of services. Business
logic lives in plain TypeScript modules that know nothing about React or HTTP,
which is what makes the scoring engine testable against the workbook.

| Layer | Location | Responsibility |
| --- | --- | --- |
| Domain | `src/domain/` | Pure logic: scoring, standings, entry orders, results aggregation, permissions. No database, no React. |
| Database | `src/db/` | Drizzle schema, migrations, connection factory. |
| Services | `src/server/services/` | Data access and transactional workflows. Accept an explicit executor so they compose inside one transaction. |
| Actions | `src/server/actions/` | Server actions: authorize, validate with Zod, call a service in a transaction, return a tagged result. |
| Interface | `src/app/`, `src/components/` | Server components load data, client components own interaction. |

```
src/
  domain/
    scoring/        time penalties, the run scoring engine, standings, tie-breaks
    results/        aggregation of confirmed runs into day and overall totals
    entry-order/    inheritance, validation and the split into scoring units
    permissions/    the capability model
  db/
    schema/         identity, registry, templates, championships, scoring
    migrations/     generated SQL, applied in order
  server/
    services/       runs, results, championships, templates, users, registry, audit
    actions/        the server action surface
  lib/
    auth/           password hashing, sessions, authorization guards
    i18n/           dictionaries and the locale runtime
    countries/      ISO registry seed data and flag resolution
  components/
    ui/             the design system primitives
    common/         logo, flags, formatting, shared labels
    layout/         application shell, theme and locale controls
```

### Principles worth knowing before changing anything

- **The scoring engine is pure.** `scoreRun` takes data and returns data. The
  same function computes the live preview in the browser and the official result
  on the server, so what the operator sees while typing is what gets stored.
- **Scores are decimal, never floating point.** `7.4 - 6.4` is
  `1.0000000000000009` in IEEE-754, which would overcharge a rider half a point.
  Every scoring value goes through `decimal.js` and a PostgreSQL `NUMERIC`
  column.
- **Templates are snapshotted, never referenced.** Creating a championship
  copies the whole structure. Editing or archiving a template afterwards cannot
  change a championship that already exists.
- **Only confirmed runs are official.** `loadConfirmedRuns` is the single
  function that filters on `status = 'CONFIRMED'`, and it is the only path into
  the results engine.
- **Standings are never stored.** They are recomputed from the stored scores on
  every read, so a correction propagates everywhere the moment it commits.
- **Authorization is server side.** Hiding a button is a convenience. Every
  protected action re-checks the capability after validating its input.
- **A squad is either complete or empty, never half picked.** A country can be
  added to a championship with its four active riders and one reserve decided
  on the spot, or with none at all, to be filled in later from the
  Participants page. Either state is valid; anything in between is refused,
  because it has no sensible meaning for the entry order screen.
- **The country start list order is editable until the competition actually
  starts.** `hasChampionshipStarted` checks the championship's first run, not
  each country's own first run, because the start list is a property of the
  whole competition. `reorderChampionshipCountries` moves every row to a
  disjoint negative range before writing the final order, because the unique
  index on `(championship, order)` is checked per statement, not deferred to
  the end of the transaction.

---

## Local setup

Requirements: Node.js 20.9 or newer, and a PostgreSQL 16 or newer database.

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`, then:

```bash
npm run db:migrate
npm run db:seed
npm run db:bootstrap-admin
npm run dev
```

The application is on <http://localhost:3000>. Sign in with the administrator
you just created, then change that password and remove
`BOOTSTRAP_ADMIN_PASSWORD` from the environment.

### Demo data

Building a championship by hand takes a while, so there is a command that
creates one to explore: the full three day structure from the reference
workbook, four countries, twenty riders, and the opening Individual Lance run
already scored and confirmed.

```bash
npm run db:seed-demo
```

Everything it creates is prefixed `Demo:`. To start over:

```bash
npm run db:reset        # empties every table, asks for confirmation first
npm run db:seed
npm run db:bootstrap-admin
```

A local PostgreSQL via Docker, if you need one:

```bash
docker run -d --name itpf-postgres -e POSTGRES_USER=itpf -e POSTGRES_PASSWORD=itpf_dev -e POSTGRES_DB=itpf -p 5437:5432 postgres:17-alpine
```

---

## Environment variables

See `.env.example` for the authoritative list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `DATABASE_DRIVER` | no | `neon` or `pg`. Auto-detected from the host name when empty. |
| `SESSION_SECRET` | yes | At least 32 random characters, used to sign session cookies. |
| `BOOTSTRAP_ADMIN_NAME` | no | Read once by `db:bootstrap-admin`, which otherwise prompts. |
| `BOOTSTRAP_ADMIN_USERNAME` | no | As above. |
| `BOOTSTRAP_ADMIN_PASSWORD` | no | As above. Remove it after the first sign in. |
| `TEST_DATABASE_URL` | no | Database for the integration tests, which truncate every table. |
| `E2E_DATABASE_URL` | no | Database for the Playwright suite, which also truncates every table. |

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Never point `TEST_DATABASE_URL` or `E2E_DATABASE_URL` at a database that holds
real competition data. Both suites wipe their target before running.

---

## Database

Migrations are generated from the Drizzle schema and applied in order.

```bash
npm run db:generate     # after changing src/db/schema, writes SQL to src/db/migrations
npm run db:migrate      # apply pending migrations to DATABASE_URL
npm run db:migrate -- --test   # apply them to TEST_DATABASE_URL instead
npm run db:seed         # seed the ISO country registry, safe to repeat
```

`db:seed` is idempotent: an existing country keeps its identity and only its
display names refresh, so championship history is never orphaned.

### Where the integrity rules actually live

The database enforces the rules that matter, not only the forms:

- a rider appears at most once per squad, and at most once per run
- an active rider holds a starting position of 1 to 4, a reserve holds none
- a score is 0, 2, 4 or 6, or not recorded
- a run is confirmed if and only if it carries a confirmation timestamp
- a correction carries a non-empty reason
- a championship day is 1, 2 or 3

---

## Neon and Vercel

### Neon

1. Create a project at <https://console.neon.tech> and copy the pooled
   connection string.
2. Set `DATABASE_URL` to it, including `?sslmode=require`.
3. Leave `DATABASE_DRIVER` empty; a Neon host selects the serverless driver
   automatically.
4. Run `npm run db:migrate` and `npm run db:seed` against it once, from your own
   machine, before the first deployment.

### Vercel

1. Import the repository.
2. Add `DATABASE_URL` and `SESSION_SECRET` as environment variables for every
   environment you deploy.
3. Deploy. The build runs `next build`, which type-checks the whole project.
4. Create the first administrator by running `npm run db:bootstrap-admin`
   locally against the production `DATABASE_URL`, once, then clear
   `BOOTSTRAP_ADMIN_PASSWORD` from your shell history and environment.

Nothing is written to the local filesystem at runtime, and the database pool is
cached per serverless instance, so the application is serverless-friendly as it
stands. Migrations are deliberately not run during the build: a schema change
should be an explicit, observed step.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Production build, including a full type check. |
| `npm start` | Serve the production build. |
| `npm run lint` | ESLint over the whole project. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Unit and integration tests. |
| `npm run test:watch` | The same, in watch mode. |
| `npm run test:e2e` | Playwright, building and starting the app first. |
| `npm run db:generate` | Generate a migration from the schema. |
| `npm run db:migrate` | Apply migrations. |
| `npm run db:seed` | Seed the country registry. |
| `npm run db:seed-demo` | Create a championship to explore, with one run already confirmed. |
| `npm run db:bootstrap-admin` | Create the first administrator. |
| `npm run db:reset` | Empty every table on a local or test database. |

---

## Testing

Scoring accuracy is the priority, so it is tested first and hardest.

| Suite | Location | Needs a database |
| --- | --- | --- |
| Excel parity | `tests/time-penalty.parity.test.ts` | no |
| Scoring engine | `tests/scoring-engine.test.ts` | no |
| Standings and tie-breaks | `tests/standings.test.ts` | no |
| Entry orders | `tests/entry-order.test.ts` | no |
| Results aggregation | `tests/results-engine.test.ts` | no |
| Workflow integration | `tests/integration/` | yes, `TEST_DATABASE_URL` |
| Critical path end to end | `e2e/critical-path.spec.ts` | yes, `E2E_DATABASE_URL` |

The parity suite is the important one. `tests/fixtures/time-penalty.excel.json`
holds generated fixtures produced by a literal transcription of the workbook's
penalty formula, including each event's own cap constants, evaluated in exact
decimal arithmetic. The tests assert that the implementation returns the same
value for every one of them. Regenerate the fixtures from the workbook rather
than editing expected values by hand.

Integration tests are skipped when `TEST_DATABASE_URL` is unset, so `npm test`
still works without a database. They run against real PostgreSQL on purpose,
because much of what they verify is enforced by constraints and transactions.

The end to end suite drives the real interface through the whole competition
workflow: sign in, build a template, create a championship with two squads,
confirm the entry orders, open the round sheet, score the run, confirm it, read
the standings, correct a confirmed score with a reason, see the standings
recalculate, check the audit log, publish, and read the public page as an
anonymous visitor. It also checks that an operator without the capability cannot
reach user management, by URL as well as by menu.

```bash
npm test
npm run test:e2e
```

---

## The permission model

There are two kinds of account.

**Administrators** hold every capability implicitly and are the only accounts
that can create users, deactivate or reactivate them, or change permissions.

**Everyone else** holds exactly the capabilities granted to them:

| Capability | Allows |
| --- | --- |
| `MANAGE_TEMPLATES` | Create, edit, duplicate and archive championship templates. |
| `CREATE_CHAMPIONSHIP` | Run the creation wizard. |
| `EDIT_CHAMPIONSHIP` | Change a championship's name, location, organizer and status. |
| `MANAGE_CHAMPIONSHIP_COUNTRIES` | Add or remove participating countries. |
| `MANAGE_RIDERS` | Maintain the rider registry and championship squads. |
| `MANAGE_ENTRY_ORDERS` | Record each country's entry order decision before a run. |
| `ENTER_SCORES` | Start a run and record scores and times. |
| `CONFIRM_RUNS` | Publish a run into the official standings. |
| `EDIT_CONFIRMED_RESULTS` | Correct a confirmed run, with a mandatory reason. |
| `MANAGE_TIE_BREAKS` | Record a round of draws. |
| `PRINT_ROUND_SHEETS` | Open and print the round sheet. |
| `VIEW_INTERNAL_RESULTS` | See standings before they are published. |
| `MANAGE_PUBLIC_RESULTS` | Publish or hide the public results page. |

This maps onto how a competition is actually staffed: one person fills in the
championship and its participants, another operates the scoring screen, a third
confirms the runs.

**Users are never deleted.** Deactivation keeps the row so audit entries keep
resolving, blocks sign in, and revokes any open session immediately. The system
also refuses any change that would leave it without an active administrator, and
nobody can deactivate or demote their own account.

---

## Scoring model in brief

The full treatment is in [SCORING_AUDIT.md](SCORING_AUDIT.md). In summary:

A referee awards 0, 2, 4 or 6 points per target. Every event charges half a
point for each **started** second over its time limit, capped at the maximum
score the scoring unit could have earned, and never pushing a score below zero.

```
excess  = max(0, time - limit)
penalty = -min(0.5 * ceil(excess), maxUnitPoints, rawPoints)
```

Who carries the penalty differs by event, and this is the structural rule that
matters most:

| Events | Scoring unit | Penalty charged to |
| --- | --- | --- |
| Individual Lance, Individual Sword | one rider | the rider |
| Rings and Peg, Lemons and Peg | one rider, three targets | the rider |
| Pair Lance, Pair Sword | two riders, entry positions 1 and 2, then 3 and 4 | the country |
| Team Lance, Team Sword | four riders | the country |
| Relay Lance, Relay Sword | four riders | the country |

So a rider's individual total is net of their own time faults but carries their
**raw** points from pair, team and relay events; the country total is the sum of
its riders' totals plus those shared faults.

Equal totals share a rank and the next rank is skipped. A tie is either resolved
by a recorded round of draws at a reduced peg size, or reported as a tie. It is
never resolved by storage order.

Run counts, peg sizes and time limits are template data, not code. Nothing
assumes that Individual Lance has two runs or that run 1 is 6 cm.

---

## Branding and languages

The two supplied federation logos are used unmodified, in
`public/brand/`: `itpf-logo-light.webp` for light backgrounds and
`itpf-logo-dark.png` for dark ones. The originals remain in `logos/`. Both are
rendered and swapped with CSS rather than JavaScript, so the correct one is on
screen at first paint and the theme never flashes.

The palette is derived from the logo: the teal of the horse mark (`#00718F`) and
the gold of the lance and wordmark (`#8D744A`) over a cool near-navy neutral
ramp. Light and dark themes both follow the system preference by default.

Country flags are rendered from the ISO 3166-1 alpha-2 code, as local SVG files
under `public/flags/`. No external image URL is stored against a country.

The interface is fully translated into English and Arabic, with right to left
layout for Arabic. `src/lib/i18n/dictionaries/en.ts` is the source of truth, and
`ar.ts` is typed against it, so a missing or renamed key fails the type check
rather than silently falling back. The locale lives in a cookie, which keeps
every route working in both languages without duplicating the route tree.

---

## Security notes

- Passwords are hashed with bcrypt at cost 12. A sign in attempt against an
  unknown user still performs one comparison, so neither the message nor the
  response time reveals which accounts exist.
- Sessions are opaque random tokens. The database stores only a SHA-256 of the
  token, and the cookie carries an HMAC signature, so a forged identifier is
  rejected before any lookup. Cookies are HTTP-only, `SameSite=Lax`, and secure
  in production.
- A deactivated user is rejected at the next request and their sessions are
  removed.
- Every server action authorizes on the server after validating its input with
  Zod. Identifiers from the browser are checked to belong to the run,
  championship or country being acted on; they are never trusted.
- Runs carry a version. Saving against a stale version is refused with a
  conflict message rather than silently overwriting a colleague's work.
- Confirmation, correction and recalculation run inside a single transaction, so
  a failure leaves no partial result and no orphaned audit entry.
- Audit entries record the actor, action, entity, timestamp, reason where one is
  required, and the before and after values. They never contain password hashes
  or session identifiers.
- `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and a
  restrictive `Permissions-Policy` are set for every response.
- The application root is marked `noindex`; only the public results pages opt
  into indexing.

---

## Designed for Version 2

Version 1 deliberately does not implement historical rankings, cumulative
points, rider profiles or country profiles. The data model is already shaped for
them:

- A **country** is a permanent entity with a stable identity.
- A **rider** belongs permanently to a country and keeps one identity across
  championships. There is no team entity that owns riders.
- Active or reserve is a property of a **participation**, not of a rider, so the
  same rider can be active in one championship and reserve in the next.
- Every score references a participation, which references the permanent rider.
  No score is ever matched by name or by row position.
- Results are derived, so a future ranking system reads the same confirmed data
  rather than a cached number.

Adding cumulative rankings later means adding tables and routes, not rewriting
the model.
