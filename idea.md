You are a senior full-stack software engineer, software architect, UI/UX engineer, database designer, and QA engineer.

I want you to build a production-quality, end-to-end web application for managing and scoring official Tent Pegging competitions.

This is not a prototype, student project, demo, or throwaway MVP.

I want professional engineering quality, professional UI/UX, strong data integrity, accurate scoring, maintainable architecture, secure authorization, comprehensive validation, tests, and a codebase that can scale to future versions without requiring a rewrite.

The application will later be deployed on Vercel and use Neon PostgreSQL as its production database.

Do not rush directly into coding.

First inspect the repository, the supplied Excel workbook, and the logos. Understand the domain and scoring model. Then design the architecture and data model. After that, implement the complete application.

IMPORTANT WRITING RULE:
Do not use the Unicode em dash character anywhere in the application, user-facing copy, documentation, comments, generated sample data, or README. Do not use "—". Use commas, colons, parentheses, or normal hyphens instead.

==================================================
1. PRODUCT PURPOSE
==================================================

The system is an official Tent Pegging Competition Management and Scoring System.

Version 1 focuses on:

1. Competition templates
2. Creating competitions
3. Countries and rider management
4. Competition participants
5. Rider entry order management
6. Scoring
7. Run confirmation
8. Editing confirmed scores with audit history
9. Individual and country/team results
10. Printing round sheets for the paper referee
11. Public competition results
12. User management and granular permissions

Do NOT implement historical rankings or cumulative rider/country rankings in Version 1.

However, the architecture and database MUST be designed so that history, rider profiles, country profiles, historical results, statistics, and ranking systems can be added later without rebuilding the application.

==================================================
2. TECHNOLOGY AND ARCHITECTURE
==================================================

Build this using a modern production-ready stack suitable for Vercel and Neon.

Preferred direction:

- Next.js with App Router
- TypeScript with strict mode
- PostgreSQL on Neon
- A mature type-safe ORM compatible with Neon, preferably Drizzle ORM unless the existing repository already uses another strong solution
- Tailwind CSS
- shadcn/ui or equivalent high-quality accessible component system
- Zod for server-side and client-side validation
- React Hook Form where appropriate
- Secure credentials-based authentication
- Secure HTTP-only sessions/cookies
- A robust authorization layer
- Vitest or equivalent for unit/integration tests
- Playwright for critical end-to-end workflows

Use current stable versions that are compatible with each other. Do not use experimental technology just because it is newer.

The application must be serverless-friendly and Vercel-compatible.

Do not depend on local filesystem persistence at runtime.

All important application state must be stored in PostgreSQL.

Use proper database migrations.

Provide an `.env.example`.

Provide a secure method to bootstrap the first administrator. Never hardcode production credentials.

Use a modular architecture.

Business logic, especially scoring logic, must NOT be spread across React components.

The scoring engine should be its own testable domain module.

Example conceptual separation:

- authentication
- authorization
- users
- countries
- riders
- templates
- championships
- championship participants
- entry orders
- scoring engine
- run management
- results engine
- audit logs
- printing
- public results

Do not overengineer with unnecessary microservices. This should be a clean modular monolith suitable for Vercel.

==================================================
3. ITPF BRANDING AND UI
==================================================

There is a folder called:

/logos

It contains two supplied ITPF logos:

- one intended for light backgrounds
- one intended for dark backgrounds

Inspect the actual files and use the correct one for each theme.

Do not redraw, recolor, distort, replace, or generate a new ITPF logo.

Use the supplied original logo files.

Design the application colors around the visual identity of the ITPF logo.

The visual language should primarily use colors derived from the logo, including the appropriate combinations of:

- teal / turquoise
- blue
- gold
- dark navy / black
- white
- subtle neutral backgrounds

The design should feel like official federation software.

It should feel:

- professional
- authoritative
- modern
- clean
- easy to operate under competition conditions
- visually calm
- not flashy
- not like a generic admin template
- not like a student project

Avoid excessive gradients, giant rounded cards, unnecessary animations, decorative clutter, or startup-style marketing UI.

The scoring interface is operational software. Clarity and speed are more important than decoration.

Support:

- Light mode
- Dark mode

Use the appropriate ITPF logo automatically.

Make the interface responsive.

It must work very well on:

- desktop
- laptop
- tablet
- mobile

Scoring will most likely be performed on laptop/tablet, so optimize those views carefully.

Use proper loading states, empty states, validation states, confirmation dialogs, success feedback, and error feedback.

Do not invent unnecessary dashboard statistics or features that were not requested.

==================================================
4. LANGUAGE SUPPORT
==================================================

Design the codebase for English and Arabic.

Support:

- English LTR
- Arabic RTL

The architecture must support proper localization.

Do not hardcode important interface strings throughout components.

Use a proper localization structure.

==================================================
5. USERS AND PERMISSIONS
==================================================

There is an Admin user.

Only Admin users can:

- create users
- deactivate users
- reactivate users
- manage user permissions

Non-admin users must NEVER be able to manage users, even if they manipulate client-side requests.

Enforce this server-side.

Do not permanently delete users when deactivated.

A deactivated user must remain in the database because historical actions and audit logs must still reference that user.

A user should have at least:

- id
- name
- login identifier
- password hash / authentication identity
- active status
- createdAt
- updatedAt

Use granular capability-based permissions for non-admin users.

Examples of permissions:

- manage templates
- create championship
- edit championship information
- manage championship countries
- manage championship riders
- manage entry orders
- enter scores
- confirm runs
- edit confirmed results
- print round sheets
- view internal results
- manage public results if required

Some users may only be allowed to fill championship data and participants.

Another user may only be responsible for scoring.

Another user may have broader operational permissions.

Do not rely only on hiding buttons.

Every protected action must be authorized on the server.

Admin should have full access.

Protect against accidentally leaving the system with no usable administrator.

==================================================
6. COUNTRY REGISTRY
==================================================

Countries are permanent entities in the system.

Use standard ISO country information.

Each country should have at least:

- internal id
- ISO alpha-2 code
- name
- createdAt

Show the country's flag next to the country name throughout the system where appropriate.

Examples:

- country selectors
- championship participants
- scoring screens
- results
- public results

Use a reliable ISO-based flag solution.

Do not manually store random external image URLs for flags.

Country identity must be persistent because Version 2 will later use countries for historical results and rankings.

==================================================
7. RIDER REGISTRY
==================================================

This is a VERY IMPORTANT architecture decision.

DO NOT permanently save riders inside teams.

There is no permanent Team entity that owns riders.

A rider permanently belongs to a COUNTRY.

Structure conceptually:

Country
  -> Riders

For example:

Oman
  -> Rider A
  -> Rider B
  -> Rider C
  -> Rider D
  -> Rider E
  -> Rider F
  -> etc.

When adding a rider, ONLY ask for:

- Rider Name

The country is already known from the page/context where the rider is being added.

Do not require date of birth, federation number, phone, email, passport number, or other information in Version 1.

Keep the model extensible so more rider attributes can be added later.

Every rider MUST have a stable internal ID.

Never use the rider name as the database identity.

This is critical for Version 2 because historical results and ranking points will eventually accumulate against the same rider identity.

==================================================
8. CHAMPIONSHIP TEMPLATE SYSTEM
==================================================

Before creating a championship, the Admin can create reusable Championship Templates.

A championship in this system consists of exactly 3 competition days.

A template defines the STRUCTURE of the championship.

Template:

Day 1
  -> Events
     -> Runs

Day 2
  -> Events
     -> Runs

Day 3
  -> Events
     -> Runs

The Admin should be able to configure what events are held on each day.

Examples of known Tent Pegging event types from the supplied Excel system include:

- Individual Lance
- Pair Lance
- Team Lance
- Individual Sword
- Pair Sword
- Team Sword
- Rings and Peg Lance
- Lemon and Peg Sword
- Relay Lance
- Relay Sword

Do not assume that every template must contain all of them.

The Admin selects which events belong to Day 1, Day 2, and Day 3.

The Admin should also determine:

- event order within the day
- number of runs for the event
- peg size in centimeters for each run

Example:

Individual Lance
  Run 1: 6 cm
  Run 2: 4 cm

Another future template may use a different number of runs or different peg sizes.

Therefore:

DO NOT hardcode:
"Individual Lance always has two runs"

DO NOT hardcode:
"Run 1 is always 6 cm"

The template defines this.

The scoring RULE TYPE for each event should remain tied to the correct Tent Pegging event scoring logic.

Keep scoring rules modular and configurable internally so they can be extended later.

Do not expose arbitrary competition configuration options simply because they are technically possible. Only expose settings required by this specification and settings verified from the Excel model.

Templates should support:

- create
- edit
- duplicate
- archive/deactivate if useful

Existing championships must NEVER change when their source template is later edited.

When creating a championship from a template, create a SNAPSHOT/COPY of the template structure into the championship.

Do not leave a live mutable dependency between an existing championship and the template.

==================================================
9. CREATE CHAMPIONSHIP
==================================================

Creating a championship should be simple.

The user:

1. Selects an existing championship template
2. Enters championship information
3. Selects participating countries
4. Selects riders for each country

Championship information should include only clearly useful competition data such as:

- championship name
- start date
- location
- organizer if required

Avoid unnecessary fields.

Because a championship lasts 3 days, derive the competition dates appropriately from the start date where suitable, while keeping the data model flexible.

==================================================
10. SELECTING RIDERS FOR A CHAMPIONSHIP
==================================================

After selecting a country, show the riders already registered under that country.

The user selects the riders participating in this championship.

If a rider does not exist:

- click Add Rider
- enter only Rider Name
- save the rider under that country
- make the rider immediately available for selection

For the current competition model:

Each country has:

- 4 active riders
- 1 reserve rider

The fifth rider is a reserve.

Do not model the reserve as a permanent property of the rider.

A rider may be active in one championship and reserve in another.

Store active/reserve status as championship participation data.

There should be no permanent fixed team roster.

The selected riders belong to the championship participation for that country.

==================================================
11. ENTRY ORDER / "CHANGE OF ENTRIES"
==================================================

This is a critical real-world workflow.

Rider entry order can change between runs.

The official change request happens on PAPER outside the system.

DO NOT create an online request workflow.

DO NOT upload or scan the paper.

Before each run, the scoring operator must review every participating country's entry order.

For every country, require an explicit decision:

- No Change
- Change Entry Order

If "No Change" is selected:

Use the last confirmed valid entry order.

If "Change Entry Order" is selected:

Allow the operator to rearrange the active riders according to the official paper request received before the run.

The system must not automatically assume "No Change".

The operator must explicitly confirm each country's entry status.

For the first run, there must be a clearly defined initial active rider order.

After every participating country has been reviewed and confirmed, the run becomes ready.

The order stored for a run must be an immutable historical snapshot of the confirmed order used for that run.

Future changes must not rewrite the previous run's entry order.

The system must support the reserve rider correctly.

Keep substitution/order logic modular because additional detailed federation rules may be confirmed later.

Do not invent restrictions that are not supported by the workbook or specification.

==================================================
12. PRINT ROUND SHEET
==================================================

There are two referees:

- electronic referee / scoring operator
- paper/manual referee

Therefore every run needs a professional printable round sheet.

After entry orders are confirmed for the run, provide:

Print Round Sheet

The printed sheet must use EXACTLY the same confirmed rider order as the electronic scoring screen.

The print layout should include appropriate information such as:

- ITPF logo
- championship name
- date/day
- event
- run number
- peg size
- participating country
- country flag if print-friendly
- rider names in correct entry order
- required scoring fields
- time fields where required
- appropriate result fields matching the event
- clear space for manual recording

Base the actual scoring columns on the relevant event and Excel scoring structure.

Do not invent unnecessary fields.

Provide excellent print CSS.

Target clean A4 printing.

Allow printing the current run for all countries in a sensible official format.

The printed version must look like an official competition document, not a screenshot of the web UI.

==================================================
13. RUN WORKFLOW
==================================================

Design a clear run state machine.

Conceptually:

1. Entry order pending
2. Entry order confirmed / ready
3. In progress
4. Review
5. Confirmed

Do not overcomplicate the UI with technical state names.

Before a run starts:

- all countries' entry order decisions must be completed
- the print sheet should be available

During the run:

- operator enters the required score/time data
- calculated fields update correctly

At the end:

- show a clear review screen
- operator presses Confirm Run

Confirm Run is the boundary that publishes the run into official cumulative results.

The workflow should naturally lead to the next run.

==================================================
14. EDITING A CONFIRMED RUN
==================================================

Confirmed scores MAY need to be corrected later.

Do NOT make confirmation irreversible.

Provide a controlled:

Edit Confirmed Result

workflow.

Editing a confirmed score requires:

- appropriate permission
- a mandatory reason for the change

Store:

- old values
- new values
- reason
- user who made the change
- timestamp

Never overwrite confirmed historical data without traceability.

Use a revision/audit model.

After a correction:

- recalculate all affected results
- recalculate rankings
- update public results
- preserve the full history of the modification

Use a database transaction for critical update and recalculation operations.

==================================================
15. EXCEL WORKBOOK IS THE SCORING REFERENCE
==================================================

A supplied `.xlsm` Excel workbook contains the existing Tent Pegging scoring system.

Locate and inspect the workbook before implementing scoring.

Treat the workbook as the PRIMARY reference for current scoring behavior.

This workbook contains 24 sheets including concepts such as:

- Main Page
- M. List
- IL
- PL day 1
- Team day 1
- T.Team (1)
- Ind Result (1)
- SUM DAY1
- IS
- PS day 2
- Team day 2
- Ind Result (2)
- T.Team (2)
- SUM DAY2
- Rings Peg Day 3
- Lemon Peg Day 3
- Relay (L)
- Relay (S)
- Ind Result (3)
- T.Team (3)
- SUM DAY3
- T Ind
- Team Total
- SUMMARY

Inspect:

- formulas
- repeated formula patterns
- hidden rows/columns if present
- validation rules
- workbook relationships
- scoring totals
- time penalties
- event totals
- individual totals
- team/country totals
- ranking logic
- tie handling
- VBA/macros where they help explain intended workflow

Do NOT depend on Excel at runtime.

Do NOT execute Excel to calculate scores in production.

Reimplement the scoring logic cleanly in TypeScript.

Create a dedicated scoring engine.

The scoring engine should use pure functions wherever practical.

Use precise decimal arithmetic.

Do not use unsafe JavaScript floating point arithmetic for scoring calculations if it can cause precision errors.

Store scores and times using appropriate PostgreSQL NUMERIC/DECIMAL types.

Known patterns in the workbook include:

- event-specific time thresholds
- penalties applied in 0.5 point increments
- maximum event-specific penalty caps
- penalties that must not reduce the relevant score below zero
- separate individual contribution and team/event penalty concepts
- individual day totals
- team/country totals
- overall championship totals
- ranking calculations
- tie-break logic

These MUST be verified from the workbook and reproduced accurately.

Do not simply copy spreadsheet formulas into React components.

Translate them into readable domain functions with meaningful names.

Examples conceptually:

calculateTimePenalty(...)
calculateIndividualRunScore(...)
calculatePairScore(...)
calculateTeamScore(...)
calculateRelayScore(...)
calculateRingsAndPegScore(...)
calculateLemonAndPegScore(...)
calculateDayIndividualTotal(...)
calculateCountryTotal(...)
calculateStandings(...)
resolveTieBreak(...)

The names may differ, but separation should be this clear.

IMPORTANT:

The workbook may contain old spreadsheet quirks, inconsistent references, or accidental formula anomalies.

Do not silently reproduce an obvious spreadsheet mistake.

When a formula appears inconsistent:

1. compare it with equivalent rows
2. compare it with the same pattern in similar event sheets
3. derive the intended scoring behavior only when the pattern is unambiguous
4. document the discrepancy
5. add a test for the resolved behavior

Create a document such as:

SCORING_AUDIT.md

It should map the implemented scoring logic to the Excel workbook and mention any spreadsheet anomalies discovered.

If a rule cannot be determined safely from the workbook, do not invent a sporting rule silently.

Keep that rule isolated/configurable and clearly report the ambiguity.

==================================================
16. ACTIVE RIDERS AND SCORING IDENTITY
==================================================

The system must not use names to match scores.

All score records must reference real internal rider IDs.

The workbook uses names/lookups in places because it is Excel.

The web system must improve on this.

Use:

countryId
riderId
championshipId
eventId
runId
participationId

and other proper foreign keys.

Current business rule:

- 4 active riders
- 1 reserve rider

The reserve is not automatically scored as a fifth active rider.

The current active set and entry order are determined for the relevant run according to the confirmed entry order.

For event-specific participation behavior such as individual, pair, team, and relay, verify the workbook carefully and isolate those rules in the domain layer.

Do not let a UI row position become the rider identity.

==================================================
17. RESULTS ENGINE
==================================================

Calculate results from stored confirmed scoring data.

Do not store manually edited ranking numbers.

The system must be able to derive:

- per-run results
- event totals
- day individual results
- day country/team results where applicable
- cumulative individual results
- cumulative country/team results
- final standings

Only CONFIRMED runs should affect official public standings.

Unconfirmed work-in-progress scores must not leak into official public results.

If a confirmed result is edited through the controlled correction workflow, recompute all affected standings.

Use deterministic result calculations.

==================================================
18. TIES AND TIE-BREAKS
==================================================

Inspect the Excel SUMMARY and related sheets for tie handling and "Round of Draws" / tie-break behavior.

Implement the supported tie logic as an isolated module.

Do not fake tie resolution by arbitrary database ordering.

If competitors or countries remain tied according to the official logic, present that state correctly until the required tie-break data is entered.

Tie-break data must be auditable just like other scoring data.

==================================================
19. PUBLIC RESULTS PAGE
==================================================

Create a public results area that requires no login.

This is NOT a second-by-second live scoring feed.

The audience should only see official results after a run is confirmed.

During an active run, unconfirmed inputs must remain private.

After Confirm Run:

- official standings update
- public results reflect the newly confirmed run

Public results should include, as appropriate:

- championship identity
- ITPF branding
- location and dates
- current competition day
- last confirmed event/run
- individual standings
- country/team standings
- day results
- overall results

Show country flags next to country names.

Make public results excellent on mobile.

The page should be visually attractive but still official and easy to read.

Do not implement historical country pages or historical rider profiles yet.

However, structure routes, database relationships, and identities so Version 2 can later add:

- clickable countries
- country history
- rider profiles
- rider history
- previous championships
- cumulative points
- rankings
- statistics
- audience exploration of the sport

WITHOUT rebuilding the Version 1 data model.

==================================================
20. VERSION 2 SCALABILITY REQUIREMENT
==================================================

Version 2 will eventually add historical official competitions and cumulative rankings.

This is NOT part of the current implementation.

But Version 1 must be designed correctly for it.

Future concept:

Country
  -> permanent Rider Registry
  -> Championship Participations
  -> Results over time
  -> Historical statistics
  -> Ranking points

A rider must remain the same Rider entity across championships.

A country must remain the same Country entity across championships.

A championship result should permanently reference those entities.

This future requirement is one of the main reasons riders are stored under countries rather than permanent teams.

Do not create a database architecture that will force a future rewrite.

==================================================
21. AUDITABILITY
==================================================

This system may be used for official competition results.

Auditability matters.

Create an Audit Log system for important actions such as:

- championship creation/editing
- template changes
- rider participation changes
- entry order confirmation/change
- run confirmation
- confirmed score edits
- result corrections
- user activation/deactivation
- permission changes

Audit records should identify:

- actor
- action
- entity type
- entity id
- timestamp
- relevant before/after data where appropriate
- reason where required

Do not expose sensitive security information in audit records.

==================================================
22. CONCURRENCY AND DATA INTEGRITY
==================================================

Assume more than one authorized user may have the application open.

Protect against accidental overwrite of scoring data.

Use appropriate:

- transactions
- unique constraints
- foreign keys
- validation
- optimistic concurrency/version checks where useful

If User A is editing a score and User B changed it after User A loaded the page, do not silently overwrite newer data.

Show an understandable conflict message.

Critical operations such as confirming a run must be atomic.

==================================================
23. SECURITY
==================================================

Follow professional security practices.

At minimum:

- secure password hashing
- secure session handling
- HTTP-only cookies
- production secure cookie settings
- CSRF protection where applicable
- server-side authorization
- input validation
- output escaping
- no sensitive information exposed to the browser
- no hardcoded secrets
- safe error messages
- protected admin operations
- inactive users cannot authenticate
- database constraints in addition to UI validation

Do not trust IDs or permission values supplied by the client.

==================================================
24. DATABASE DESIGN
==================================================

Design a normalized relational model suitable for PostgreSQL.

Expected concepts will likely include entities similar to:

User
Permission
UserPermission / RolePermission
Country
Rider
ChampionshipTemplate
TemplateDay
TemplateEvent
TemplateRun
Championship
ChampionshipDay
ChampionshipEvent
ChampionshipRun
ChampionshipCountry
ChampionshipRider
RunEntryOrder
RunEntryOrderItem
Score
ScoreComponent where useful
ScoreRevision
RunConfirmation
AuditLog

These are conceptual suggestions, not mandatory table names.

Improve the model if there is a cleaner professional design.

Do not create a permanent Team table that permanently owns riders.

Make template data and championship snapshot data clearly separate.

Use constraints to prevent invalid duplicate relationships.

Use timestamps consistently.

==================================================
25. UX DETAILS
==================================================

Make common workflows require minimal clicks.

Examples:

Adding a rider:

Country -> Add Rider -> Rider Name -> Save

Creating a championship:

Select Template
-> Championship Details
-> Countries
-> Riders
-> Review
-> Create

Before a run:

Open Run
-> review each country's entry order
-> No Change or Change Entry Order
-> confirm all countries
-> Print Round Sheet
-> Start Run

After a run:

Review Scores
-> Confirm Run
-> move to next run

Confirmed correction:

Open confirmed run
-> Edit Confirmed Result
-> change value
-> mandatory reason
-> save
-> recalculate standings
-> preserve revision

Use clear progress indicators in long workflows.

Do not make the scoring operator navigate through unnecessary settings while a competition is running.

==================================================
26. PROFESSIONAL CODE QUALITY
==================================================

I want this codebase to look like it was built by an expert engineering team.

Requirements:

- TypeScript strict mode
- meaningful names
- small focused modules
- no giant components
- no giant service files
- no duplicated scoring formulas
- no business logic embedded in UI components
- no `any` unless there is a strong documented reason
- no dead code
- no unused dependencies
- no placeholder code
- no TODO implementation gaps in required Version 1 functionality
- no fake API responses in production flows
- no mocked production database
- sensible comments only where logic needs explanation
- consistent formatting
- clean error handling
- accessible UI
- database indexes for common queries
- proper migration history

Avoid premature abstraction, but do not produce tightly coupled code.

==================================================
27. TESTING REQUIREMENTS
==================================================

Testing is NOT optional.

The most important area is scoring accuracy.

Create comprehensive unit tests for every scoring event based on the Excel workbook.

Include:

- normal values
- zero score
- exact time threshold
- just above threshold
- penalty increments
- maximum penalty
- penalty cannot make score negative
- decimal/half-point values
- multi-run totals
- individual totals
- country/team totals
- ranking
- ties
- tie-break behavior

Create regression fixtures that represent Excel-equivalent calculations.

Where practical, create a fixture table showing:

Input
Expected Excel result
Application result

and make tests assert parity.

Also test:

- template copying/snapshot behavior
- rider stored under country
- 4 active + 1 reserve championship roster
- entry order inheritance
- entry order changes
- previous run entry orders remain unchanged
- unauthorized user restrictions
- Admin-only user management
- deactivated user login blocked
- Confirm Run behavior
- confirmed score correction requires reason
- audit log creation
- public results ignore unconfirmed runs
- public results update after confirmation

Create Playwright end-to-end tests for at least the critical happy path:

1. Admin login
2. Create template
3. Create championship
4. Select countries
5. Add/select riders
6. Configure initial active/reserve riders
7. Confirm entry order
8. Enter scores
9. Confirm run
10. Verify standings
11. Edit a confirmed score with reason
12. Verify recalculation and audit
13. Verify public results

==================================================
28. FINAL CODE REVIEW IS REQUIRED
==================================================

After implementation, do NOT immediately declare the project finished.

Perform a complete engineering review.

Review:

- scoring formulas
- all workbook parity logic
- database relationships
- migration correctness
- authorization
- Admin-only operations
- confirmed score edit flow
- audit logs
- run state transitions
- result recalculation
- concurrency risks
- print output
- country/rider relationships
- future scalability
- responsive UI
- dark/light logos
- RTL/LTR behavior
- accessibility
- error handling
- deployment compatibility

Then run:

- dependency install
- database generation/migrations as appropriate
- lint
- typecheck
- unit tests
- integration tests
- Playwright critical tests
- production build

Fix ALL errors.

Do not leave known failing tests.

Do not suppress TypeScript errors to make the build pass.

Do not disable ESLint rules just to hide problems.

Do not catch and ignore runtime errors.

Search the codebase for incomplete placeholders and remove/fix them.

Perform a second focused review specifically for scoring.

A tiny scoring error is unacceptable.

==================================================
29. EXCEL SCORING AUDIT
==================================================

Before final completion, provide:

SCORING_AUDIT.md

It should explain:

- each supported event
- source Excel sheet(s)
- how raw points are calculated
- how time penalties are calculated
- penalty caps
- how individual contribution works
- how team/country contribution works
- run totals
- event totals
- day totals
- overall totals
- ranking logic
- tie logic
- any suspicious or inconsistent Excel formulas found
- how those inconsistencies were resolved

This document is for engineering verification, not for normal application users.

==================================================
30. DOCUMENTATION
==================================================

Create a professional README containing:

- project overview
- architecture overview
- local setup
- environment variables
- database setup
- Neon setup
- migration commands
- seed/bootstrap Admin instructions
- development commands
- test commands
- production build
- Vercel deployment instructions
- logo location
- important security notes

Also explain the permission model.

Do not include fake production secrets.

==================================================
31. WHAT NOT TO BUILD YET
==================================================

Do NOT implement these Version 2 features now:

- historical championship importing
- PDF historical result importing
- cumulative rider ranking
- cumulative country ranking
- all-time statistics
- historical country pages
- historical rider pages

Only make Version 1 architecture ready for them.

Do not add unrelated features just because they sound useful.

Keep Version 1 focused.

==================================================
32. DEFINITION OF DONE
==================================================

The project is done only when:

- the complete Version 1 workflow works end-to-end
- application uses the supplied ITPF branding
- both themes work correctly
- country flags work correctly
- Admin/user permissions work securely
- riders are permanently stored under countries
- championship rider selection works
- 4 active + 1 reserve works
- templates work
- templates have exactly 3 competition days
- events/runs can be configured through templates
- peg size is stored per run
- entry order can be confirmed or changed before every run
- paper uploads are NOT required
- round sheets print professionally
- scoring matches the supplied Excel logic
- run confirmation works
- confirmed results can be corrected with mandatory reason
- revisions are auditable
- results recalculate correctly
- public results expose only confirmed results
- individual standings work
- country/team standings work
- ties are handled according to the scoring model
- responsive UI works
- English and Arabic architecture works
- no em dash characters are used
- tests pass
- lint passes
- typecheck passes
- production build passes
- no known scoring bug remains
- no critical TODO remains
- application is ready for Vercel + Neon deployment

==================================================
33. IMPLEMENTATION PROCESS
==================================================

Work in this order:

PHASE 1: DISCOVERY
- inspect repository
- inspect `/logos`
- inspect Excel workbook thoroughly
- identify scoring model
- identify any existing code worth preserving

PHASE 2: DESIGN
- architecture
- database schema
- scoring domain model
- permissions model
- run state model
- UI information architecture

PHASE 3: FOUNDATION
- project configuration
- database
- authentication
- authorization
- theme
- localization
- shared UI

PHASE 4: CORE DATA
- countries
- riders
- users
- permissions
- templates
- championships
- championship participants

PHASE 5: COMPETITION OPERATIONS
- entry order
- printing
- scoring
- run states
- confirmation
- confirmed edits
- audit history

PHASE 6: RESULTS
- scoring aggregation
- standings
- tie logic
- public results

PHASE 7: QA
- Excel parity testing
- unit tests
- integration tests
- E2E tests
- manual review
- security review
- code review

PHASE 8: FINAL VERIFICATION
- lint
- typecheck
- tests
- production build
- inspect the application end-to-end
- fix all discovered issues

Do not skip discovery of the Excel workbook.

Do not replace the Excel rules with generic Tent Pegging rules from memory or the internet.

For Version 1 scoring, the supplied workbook is the primary reference.

At the same time, do not blindly copy obvious broken spreadsheet references. Audit the intent carefully and document anomalies.

==================================================
34. FINAL EXPECTATION
==================================================

I expect a complete working product, not only generated files.

Make sensible professional engineering decisions when the specification does not dictate implementation details.

Do not simplify required workflows merely to finish faster.

Do not add unrelated complexity.

Prioritize, in this order:

1. Scoring correctness
2. Data integrity
3. Official competition workflow
4. Security and permissions
5. Auditability
6. Reliability
7. Usability during a real competition
8. Maintainability
9. Scalability for Version 2
10. Visual polish

When you believe the implementation is complete, challenge your own work.

Act as a second senior engineer reviewing the system.

Look for calculation mistakes, race conditions, authorization bypasses, missing validations, accidental data mutation, incorrect rider identity handling, wrong totals, incorrect ranking behavior, broken printing, and deployment problems.

Fix those issues before presenting the final result.

The application will first be tested in parallel with the existing Excel system during a real Tent Pegging competition, so score parity and operational reliability are critical.