# AgencyOS

AgencyOS is a comprehensive, modular agency management platform for creative, design, and digital marketing agencies.

## Status

**Stage 1: Planning — Complete (PR #1 under review)**
**Stage 2: Phase 0 — Foundation & Infrastructure — Complete**
**Stage 3: Phase 1 — CRM Stabilization — Complete (PR #13)**

No production deployment yet. Phase 0 + Phase 1 run on local Docker Compose only. No paid infrastructure is provisioned.

## Documentation

All Stage 1 planning deliverables are in `/docs/`:

| #   | Document                                                                        |
| --- | ------------------------------------------------------------------------------- |
| 1   | [Product Blueprint](docs/01_PRODUCT_BLUEPRINT.md)                               |
| 2   | [Architecture Proposal](docs/02_ARCHITECTURE_PROPOSAL.md)                       |
| 3   | [UI/UX Blueprint](docs/03_UI_UX_BLUEPRINT.md)                                   |
| 4   | [Database & Permission Strategy](docs/04_DATABASE_PERMISSION_STRATEGY.md)       |
| 5   | [Phased Development Roadmap](docs/05_PHASED_ROADMAP.md)                         |
| 6   | [Risks & Open Questions](docs/06_RISKS_OPEN_QUESTIONS.md)                       |
| 7   | [Requirements Traceability Matrix](docs/07_REQUIREMENTS_TRACEABILITY_MATRIX.md) |

Architecture Decision Records are in `/docs/ADR/`.

## Getting Started (Phase 0 — Local Development Only)

### Prerequisites

- Node.js 22+
- Docker and Docker Compose (for PostgreSQL)

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your values (no real secrets required for local dev)
# Use .env.example for the A Agent Docker Compose defaults; do not commit .env.local.

# Generate Prisma client (requires network access to prisma binaries)
npx prisma generate

# Start local development stack (A Agent: Next.js on port 3001, PostgreSQL on host 5433)
docker compose -p agencyos-a up

# The app runs at http://localhost:3001
# PostgreSQL is available at localhost:5433 (mapped to container port 5432)
# Ports are configurable via POSTGRES_HOST_PORT, POSTGRES_INTERNAL_PORT, and APP_PORT env vars.
# CI and local development both serve the app on port 3001. Port 3000 is reserved for a different project.
```

### Database

The schema is already established via existing migrations. Do not reinitialize migrations.

```bash
# Push schema changes to local database (safe on established schema)
npx prisma db push

# Open Prisma Studio
npx prisma studio

# Create a new migration only when schema changes are needed
npx prisma migrate dev --name <migration_name>
```

### Testing

```bash
npm test           # Run vitest
npm run lint       # Run ESLint
npx tsc --noEmit   # TypeScript type check
```

### Architecture

- **Framework:** Next.js 16 (App Router), TypeScript strict
- **Styling:** Tailwind CSS with AgencyOS design tokens
- **Database:** PostgreSQL (Prisma ORM)
- **Authentication:** Better Auth (self-hosted)
- **Background jobs:** pg-boss (PostgreSQL-backed)
- **Testing:** Vitest + React Testing Library + Playwright (planned)

## Branch Strategy

- `arena/56716fe0-agencyos-arena` — main development branch (PR #1 target)
- `arena/0f30cd20-agencyos-arena` — Phase 1 stabilization branch (lead duplicate detection, org isolation, audit consistency)
- `feature/phase-0-foundation` — Phase 0 implementation branch
- No direct commits to `main`; all changes via pull request

## License

Proprietary — AgencyOS
