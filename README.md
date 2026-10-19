# Usage Metering and Quota Service

A backend service that other applications call to track unit consumption and decide
whether their users may perform an action. Each account has a shared plan, each user
has an individual plan, and both apply to every request.

**Stack:** TypeScript · Express 5 · PostgreSQL 17 · Drizzle ORM · Docker Compose

> Work in progress. See [docs/plan.md](docs/plan.md) for the roadmap.

## Documentation

- [Database design](docs/database-design.md)
- [Architecture and conventions](docs/architecture.md)
- [Implementation plan](docs/plan.md)

## Run it

```bash
docker compose up --build
```

This starts PostgreSQL and the API, applies migrations and seeds the predefined
plans. The API listens on http://localhost:3000 (`GET /health`); Postgres is
exposed on port 5433. The admin key for `POST /accounts` defaults to
`dev-admin-key-change-me-0123456789` (override with `ADMIN_API_KEY`).

## Local development

```bash
cp .env.example .env
docker compose up -d --wait db
npm install
npm run dev
npm test
```
