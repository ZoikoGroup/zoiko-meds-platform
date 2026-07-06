# zoiko-meds-platform

Monorepo for **ZoikoMeds** — Zoiko Group's Global Medicine Availability Infrastructure.
Contains the frontend and backend applications.

> ZoikoMeds is a governed, jurisdiction-aware platform that lets verified pharmacies
> share medicine **availability signals** and helps the public, clinicians, and
> institutions understand where medicines may be available — without becoming a
> pharmacy, marketplace, dispensing service, or medical-advice tool.

## Project Structure

```
zoiko-meds-platform/
├── frontend/   # Client-side application (UI) — Next.js (not yet scaffolded)
├── backend/    # Server-side API (NestJS + Prisma + PostgreSQL)
└── README.md
```

## Backend

NestJS + TypeScript API backed by PostgreSQL via Prisma. Service domains mirror
the platform architecture:

| Module        | Purpose |
|---------------|---------|
| `medibase`    | MediBase™ — governed medicine identity & normalization |
| `availability`| ZoikoAvail™ — availability confidence engine (no exact stock exposed) |
| `signal`      | ZoikoSignal™ — aggregated, anonymized shortage/access intelligence |
| `search`      | Public medicine search (MediBase + ZoikoAvail composition) |
| `pharmacy`    | Pharmacy verification & participation |
| `enterprise`  | Enterprise inquiry intake (briefings, API access, licensing) |
| `health`      | Health/readiness check |

### Local development (without Docker)

```bash
cd backend
npm install
cp .env.example .env          # then set DATABASE_URL to a running Postgres
npx prisma generate
npx prisma migrate dev        # create the schema
npm run start:dev             # http://localhost:4000/api
```

API docs (Swagger) are served at `http://localhost:4000/api/docs` in development.

### Run with Docker

The backend is dockerised with a multi-stage `Dockerfile` and a `docker-compose.yml`
that also provisions PostgreSQL.

```bash
cd backend
docker compose up --build
```

This starts:
- **db** — PostgreSQL 16 on `localhost:5432`
- **api** — the NestJS API on `http://localhost:4000/api` (runs `prisma migrate deploy` on start)

Build just the API image:

```bash
cd backend
docker build -t zoikomeds-api .
```

## Frontend

The `frontend/` directory is reserved for the Next.js client application
(not scaffolded yet).

## Getting Started

```bash
git clone https://github.com/ZoikoGroup/zoiko-meds-platform.git
cd zoiko-meds-platform/backend
docker compose up --build
```
