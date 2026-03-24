# SmartHire Backend

AI-powered Applicant Tracking System (ATS) backend built with NestJS. Handles resume ingestion, async AI processing, semantic candidate search, and full HR team management.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Database Migrations](#database-migrations)
- [Seeding](#seeding)
- [API Overview](#api-overview)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | NestJS (TypeScript) |
| Primary DB | PostgreSQL + TypeORM |
| Vector DB | Qdrant |
| Message Queue | RabbitMQ |
| File Storage | AWS S3 |
| AI — Resume Parsing | Google Gemini (primary) / OpenAI GPT-4o (fallback) |
| AI — Embeddings | Gemini `embedding-2-preview` (768d) / OpenAI `text-embedding-3-large` |
| Auth | JWT + Refresh Tokens (bcrypt, Passport) |
| Validation | class-validator + class-transformer |
| Security | Helmet, @nestjs/throttler |
| Docs | Swagger (OpenAPI) at `/api/docs` |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- RabbitMQ 3.12+
- Qdrant (Docker recommended)
- AWS account with S3 bucket
- Google Gemini API key **or** OpenAI API key

**Quick infrastructure setup with Docker:**

```bash
# PostgreSQL
docker run -d --name smarthire-pg \
  -e POSTGRES_USER=smarthire \
  -e POSTGRES_PASSWORD=smarthire \
  -e POSTGRES_DB=smarthire \
  -p 5432:5432 postgres:15

# RabbitMQ
docker run -d --name smarthire-mq \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management

# Qdrant
docker run -d --name smarthire-qdrant \
  -p 6333:6333 \
  qdrant/qdrant
```

---

## Environment Variables

Create a `.env` file in the backend root:

```env
# App
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=smarthire
DB_PASSWORD=smarthire
DB_NAME=smarthire
DB_SSL=false
DB_LOGGING=false

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-chars
JWT_REFRESH_EXPIRES_IN=7d

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_EXCHANGE=smarthire
RABBITMQ_QUEUE=smarthire.applications
RABBITMQ_DLQ=smarthire.applications.dlq
RABBITMQ_RETRY_ATTEMPTS=3
RABBITMQ_RETRY_DELAY=5000

# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=candidates
# QDRANT_API_KEY=          # optional, for cloud Qdrant

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=smarthire-resumes

# AI — at least one required
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-2-preview
EMBEDDING_DIMENSIONS=768

# OPENAI_API_KEY=your-openai-key   # fallback if no Gemini
```

---

## Installation

```bash
npm install
```

---

## Running the App

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm start
```

The API is available at `http://localhost:3000/api/v1`.
Swagger docs at `http://localhost:3000/api/docs`.

---

## Database Migrations

```bash
# Run pending migrations
npm run migration:run

# Generate a new migration from entity changes
npm run migration:generate -- --name=MigrationName

# Revert last migration
npm run migration:revert
```

---

## Seeding

```bash
# Create the initial admin user
npm run seed:admin
```

Default admin credentials: `admin@smarthire.com` / `Admin@123456`
**Change immediately after first login.**

---

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/applications` | Public | Submit application + resume |
| GET | `/api/v1/applications` | JWT | List applications (paginated) |
| GET | `/api/v1/applications/:id` | JWT | Get application detail |
| GET | `/api/v1/applications/:id/resume-url` | JWT | Get signed S3 URL |
| POST | `/api/v1/auth/login` | Public | Login |
| POST | `/api/v1/auth/refresh` | Public | Refresh access token |
| POST | `/api/v1/auth/logout` | JWT | Logout |
| POST | `/api/v1/search` | JWT | Semantic candidate search |
| GET | `/api/v1/users` | JWT | List users |
| POST | `/api/v1/users` | JWT (Admin) | Create HR/recruiter user |
| PUT | `/api/v1/users/:id` | JWT | Update user |
| GET | `/api/v1/audit` | JWT | Audit log |
| GET | `/api/v1/admin/stats` | JWT (Admin) | System statistics |

Full interactive documentation: `http://localhost:3000/api/docs`

---

## Testing

```bash
# Unit tests
npm test

# With coverage report
npm run test:cov

# Watch mode
npm run test:watch
```

Test files follow the `*.spec.ts` convention and live alongside the source files they test.

---

## Project Structure

```
src/
├── common/              # Guards, decorators, interceptors, filters
├── config/              # Environment config (registerAs pattern)
├── database/            # Entities, migrations, seeds
└── modules/
    ├── auth/            # JWT auth + refresh token rotation
    ├── users/           # HR/recruiter user management
    ├── applications/    # Resume submission + S3 storage
    ├── queue/           # RabbitMQ producer/consumer + retry logic
    ├── ai/              # Resume parsing + embedding generation
    ├── embeddings/      # Qdrant vector DB client
    ├── search/          # Semantic search orchestration
    ├── audit/           # Immutable audit trail
    └── admin/           # Admin statistics + management
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a full deep-dive.
