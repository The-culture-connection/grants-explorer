# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── grants-explorer/    # React + Vite grants explorer web app
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/grants-explorer` (`@workspace/grants-explorer`)

React + Vite web app. Multi-page tool for grant discovery, algorithm testing, and ML audit workflows.

**Routes:**
- `/` — Home: 11-source live grant explorer with tabs per source, keyword search, result cards
- `/algorithm` — Algorithm Testing Center: V2 Hybrid / V3 RankFix scorer toggle + compare mode (V2 vs V1 or V3 vs V2), 8-dimension breakdown, org/opportunity profiling display
- `/indexing` — Indexing Tool: full-result ingestion from all 11 sources into PostgreSQL, per-source pagination control, record inspector, algorithm integration view
- `/audit` — Algorithm Audit: V1 Keyword / V2 Hybrid / V3 RankFix scorer toggle; Verbose Log tab with full methodology trace; Database Sweep analytics (elimination funnel, histogram, source breakdown, dimension averages, risk patterns); comparison lab, failure analysis, weight editor, keyword audit, eligibility audit, gold-standard eval set builder

**Source classification:**
- Active opportunity sources (8): simpler_grants, grants_gov, sam_gov, sbir, threesixtygiving, california_grants, world_bank, ted_eu
- Historical/intelligence sources excluded from ranking (3): usaspending, nih_reporter, nsf_awards

**Audit library** (`src/lib/audit/`):
- `types.ts` — WeightConfig, AlgorithmVariant (with `isV2?` flag), FeedbackLabel, EvalLabel, ScoreTrace, ALGORITHM_VARIANTS (includes `v2_current`), DEFAULT_WEIGHTS
- `scoreTrace.ts` — `buildScoreTrace()`, `runVariantScoring()` — weight-configurable scoring with human-readable audit trail
- `metrics.ts` — `computeAuditMetrics()` — precision@5, precision@10, recall, score distribution, by-source counts
- `comparison.ts` — `runComparison()` (multi-V1-variant table) + `runV1vsV2Comparison()` (V1 vs V2 rank-delta table with V2ScoreTrace per row)
- `recommendations.ts` — `generateRecommendations()`, `classifyFailureCases()` — behavior-driven improvement suggestions
- `keywords.ts` — `extractKeywordAudit()`, `expandWithSynonyms()`, SYNONYM_GROUPS, STOPWORDS

**V2 scoring library** (`src/lib/v2/`):
- `types.ts` — V2OrgProfile, V2OppProfile, V2ScoreTrace, V2Dimensions, V2Penalty interfaces
- `taxonomy.ts` — SECTOR_FAMILIES, ACTIVITY_KEYWORDS, POPULATION_KEYWORDS, V2_SYNONYM_GROUPS lookup tables
- `orgProfile.ts` — `buildOrganizationProfile()` — classifies org into orgClass + capacityBand from OrgProfile
- `oppProfile.ts` — `buildOpportunityProfile()`, `classifyOpportunityType()` — classifies opp into 8 opportunity types + complexityBand + geographyScope
- `scoring.ts` — 8 dimension scorers (eligibilityFit, domainFit, activityFit, populationFit, geographyFit, organizationTypeFit, capacityFit, fundingFit) + semantic boost + penalty engine
- `matcherV2.ts` — `scoreMatchV2()`, `getTopMatchesV2()`, `compareV1V2()` — returns V2ScoreTrace with finalScore, dimensions, semanticBoost, penaltyTotal, orgProfile, oppProfile, reasons
- `matcherHybrid.ts` — `scoreMatchHybrid()`, `getTopMatchesHybrid()` — 8-dimension Hybrid Final V2 scorer (primary production scorer)

**V3 RankFix library** (`src/lib/v3/`) — active development, specificity-first algorithm:
- `types.ts` — V3ScoreTrace, V3Dimensions (9 dimensions), V3SubSignals, V3Penalty; V3_DIMENSION_MAXES (conceptFit/28, conceptCentrality/12, activityFit/10, populationFit/8, targetApplicantFit/12, eligibility/10, geographyFit/7, capacityFit/7, fundingFit/6)
- `phrases.ts` — HIGH_VALUE_PHRASES list (~100 phrases), `computePhrasePriorityScore()`, `computeConceptCentrality()`, `computeGenericityPenalty()`, `computeWeakSpecificityPenalty()`, `extractHighValuePhrases()`, GENERIC_TERMS set
- `eligibility.ts` — `passesStrictEligibility()` (binary gate with hard exclusions: 501c3, sb-only, gov-only, nonprofit-only), `inferIntendedApplicant()`
- `population.ts` — 4-tier specificity tiers, `computePopulationSpecificity()`, `computePopulationMismatchPenalty()`, `normalizePopulationTags()`
- `targetApplicant.ts` — `computeTargetApplicantFit()` (intended-recipient classification with mismatch penalties)
- `matcherV3.ts` — `scoreMatchV3()`, `getTopMatchesV3()` — integrates all V3 modules + reuses V2 geo/capacity/funding/semantic-boost functions

**Audit library** (`src/lib/audit/`):
- `sweep.ts` — `runHybridSweep()` (V2 full-pool sweep), `runV3Sweep()` (V3 full-pool sweep), `computeV1SweepStats()`; returns `SweepStats` with elimination funnel, histogram, source breakdown, dimension averages, risk patterns

**Algorithm library** (`src/lib/algorithm/`):
- `types.ts` — OrgProfile, NormalizedOpportunity, MatchResult, ScoreBreakdown
- `matcher.ts` — `scoreMatch()`, `getTopMatches()`, `passesEligibility()`, individual scorers (mission, eligibility, geo, funding, maturity)
- `sources.ts` — SOURCE_CONFIGS, `isActiveOpportunitySource()`
- `mockData.ts` — MOCK_ORGANIZATIONS (3 sample orgs for testing)

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health`; `src/routes/grants.ts` exposes 8 grant API proxy endpoints
- Grant endpoints: `/api/grants/grantsgov`, `/api/grants/sbir`, `/api/grants/threesixtygiving`, `/api/grants/cagrants`, `/api/grants/usaspending`, `/api/grants/nih`, `/api/grants/nsf`, `/api/grants/worldbank`
- All grant endpoints accept `?keyword=` and `?rows=` query params
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec. Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
