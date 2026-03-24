# SmartHire Backend — Architecture

This document explains every architectural decision in the SmartHire backend: what each service is, why it was chosen, and exactly how it fits into the data flow.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Data Flow — Applicant Submits Resume](#2-data-flow--applicant-submits-resume)
3. [Data Flow — HR Searches Candidates](#3-data-flow--hr-searches-candidates)
4. [Services & Infrastructure](#4-services--infrastructure)
   - [PostgreSQL — Primary Database](#41-postgresql--primary-database)
   - [AWS S3 — File Storage](#42-aws-s3--file-storage)
   - [RabbitMQ — Async Message Queue](#43-rabbitmq--async-message-queue)
   - [Google Gemini / OpenAI — AI Layer](#44-google-gemini--openai--ai-layer)
   - [Qdrant — Vector Database](#45-qdrant--vector-database)
5. [NestJS Module Map](#5-nestjs-module-map)
6. [Database Schema](#6-database-schema)
7. [Authentication Architecture](#7-authentication-architecture)
8. [Security Design](#8-security-design)
9. [Error Handling & Resilience](#9-error-handling--resilience)
10. [Key Design Decisions](#10-key-design-decisions)

---

## 1. High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│         React Frontend (Vite + TypeScript + TailwindCSS)            │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS (JWT in Authorization header)
┌────────────────────────────▼────────────────────────────────────────┐
│                       NESTJS API (Port 3000)                        │
│  Global prefix: /api/v1  │  Swagger docs: /api/docs                │
│                                                                     │
│  ┌──────────┐  ┌──────┐  ┌────────────┐  ┌────────┐  ┌───────┐   │
│  │   Auth   │  │Users │  │Applications│  │Search  │  │Admin  │   │
│  │ Module   │  │Module│  │  Module    │  │Module  │  │Module │   │
│  └──────────┘  └──────┘  └─────┬──────┘  └───┬────┘  └───────┘   │
│                                │              │                     │
│  ┌──────────┐  ┌──────────┐   │    ┌─────────┴──────┐             │
│  │  Queue   │  │    AI    │   │    │  Embeddings    │             │
│  │  Module  │  │  Module  │   │    │    Module      │             │
│  └────┬─────┘  └────┬─────┘   │    └────────┬───────┘             │
│       │             │         │             │                      │
└───────┼─────────────┼─────────┼─────────────┼──────────────────────┘
        │             │         │             │
        │             │         │             │
   ┌────▼────┐  ┌─────▼──┐ ┌───▼────┐  ┌────▼─────┐
   │RabbitMQ │  │Gemini/ │ │  AWS   │  │  Qdrant  │
   │  Queue  │  │OpenAI  │ │   S3   │  │ Vector DB│
   └────┬────┘  └────────┘ └────────┘  └──────────┘
        │
   ┌────▼──────────────────────────────────────────┐
   │              PostgreSQL Database               │
   │  users │ applications │ candidate_profiles    │
   │  refresh_tokens │ audit_logs                  │
   └───────────────────────────────────────────────┘
```

The fundamental principle: **PostgreSQL is the single source of truth**. Every other service (Qdrant, S3, RabbitMQ) is a derived or supporting system. If any of them is wiped and re-populated from PostgreSQL, the system remains fully consistent.

---

## 2. Data Flow — Applicant Submits Resume

```
Applicant (browser)
      │
      │  POST /api/v1/applications  (multipart/form-data)
      ▼
ApplicationsController
      │
      │  1. Validate file (MIME type: PDF/DOC/DOCX, max 10 MB)
      ▼
ApplicationsService.create()
      │
      │  2. Upload resume to S3 → get { key, contentType, size }
      ▼
StorageService.upload()  ──►  AWS S3 bucket
                              └─ stored as resumes/{uuid}.pdf
                              └─ AES-256 server-side encryption
      │
      │  3. Create ApplicationEntity in PostgreSQL
      │     status = PENDING
      ▼
PostgreSQL  (applications table)
      │
      │  4. Publish job message to RabbitMQ
      ▼
QueueService.publishApplicationJob(applicationId)
      │
      │  5. Return HTTP 201 to applicant immediately
      ▼
Applicant sees success screen

─────────────────────────────────── (async, separate process) ──────

QueueConsumer (background)
      │
      │  Receives message: { applicationId, attempt }
      ▼
AiPipelineService.processApplication(applicationId)
      │
      │  1. Fetch ApplicationEntity from PostgreSQL
      │  2. Download resume from S3
      │  3. Extract text (pdf-parse for PDF, mammoth for DOCX)
      │  4. Mark application status = PROCESSING
      │
      │  5. Parse resume text via AI
      ▼
AiService.parseResume(resumeText)
      │
      │  → Gemini API (primary) or OpenAI (fallback)
      │  → Returns structured JSON (ParsedResumeDto)
      │    { skills[], experience[], education[], currentTitle, ... }
      │
      │  6. Build embedding text from parsed profile
      │  7. Generate vector embedding
      ▼
AiService.generateEmbedding(text)
      │
      │  → 768-dimensional float vector (Gemini)
      │    or 3072d vector (OpenAI)
      │
      │  8. Upsert vector + metadata into Qdrant
      ▼
EmbeddingsService.upsert(applicationId, vector, payload)
      │
      │  Qdrant stores: { vector: float[768], payload: { applicationId, skills, ... } }
      │
      │  9. Save CandidateProfileEntity in PostgreSQL
      │     (skills, experience, education, qdrantPointId)
      │  10. Mark application status = COMPLETED
      ▼
PostgreSQL  (candidate_profiles + applications tables updated)

On failure:
      → Retry up to 3 times with exponential backoff (5s, 10s, 20s)
      → After max retries: status = FAILED, failureReason recorded
      → Message moved to Dead Letter Queue (DLQ) for inspection
```

---

## 3. Data Flow — HR Searches Candidates

```
HR User (browser)
      │
      │  POST /api/v1/search
      │  Body: { query: "senior TypeScript developer with 5+ years", limit: 10 }
      ▼
SearchController  (JWT guard + Roles guard)
      │
      ▼
SearchService.search(dto, userId)
      │
      │  1. Convert natural language query to embedding
      ▼
AiService.generateEmbedding(query, 'RETRIEVAL_QUERY')
      │
      │  → 768d vector representing the semantic meaning of the query
      │
      │  2. Search Qdrant for nearest-neighbour vectors
      ▼
EmbeddingsService.search(queryVector, limit, filters)
      │
      │  Qdrant returns top-N scored results:
      │  [{ applicationId, score: 0.92, payload: { skills, title, ... } }]
      │
      │  Score threshold: 0.3 (filters irrelevant results)
      │  Optional filters: minExperienceYears, requiredSkills
      │
      │  3. Fetch full candidate data from PostgreSQL
      │     (applications + candidate_profiles tables)
      │
      │  4. Map results: Qdrant score + PostgreSQL profile data
      │  5. Log search to audit trail
      ▼
AuditService.log(SEARCH_PERFORMED, userId, { query, resultsCount })
      │
      ▼
HTTP 200  [ranked SearchResultDto array]
      │
      ▼
HR User sees ranked candidates with scores
```

---

## 4. Services & Infrastructure

### 4.1 PostgreSQL — Primary Database

**Why PostgreSQL?**
PostgreSQL is the backbone of the system. It stores every piece of canonical data — users, job applications, parsed candidate profiles, refresh tokens, and the complete audit trail. It was chosen over alternatives for several reasons:

- **ACID compliance** — job application data must never be lost or corrupted. A resume submission is a critical write that needs full transaction guarantees.
- **JSONB columns** — the `candidate_profiles` table stores dynamic arrays (skills, experience, education) as JSONB. PostgreSQL indexes JSONB natively and supports complex queries against it without a separate document store.
- **TypeORM integration** — NestJS's TypeORM module gives entity-level abstraction while still allowing raw QueryBuilder for complex filtered queries.
- **Row-level locking** — prevents double-processing of the same application if a RabbitMQ message is accidentally delivered twice.

**What it stores:**

| Table | Purpose |
|-------|---------|
| `users` | HR team accounts (email, passwordHash, role, status) |
| `applications` | Every resume submission (S3 key, processing status, failure reason) |
| `candidate_profiles` | AI-extracted data (skills JSONB, experience JSONB, Qdrant point ID) |
| `refresh_tokens` | Active JWT refresh tokens (revocable, expiry tracked) |
| `audit_logs` | Immutable log of every sensitive action (login, search, download) |

**Key design choices:**
- `application.status` drives the entire pipeline state machine: `PENDING → PROCESSING → COMPLETED | FAILED`
- `candidate_profiles.qdrantPointId` links the PostgreSQL record to the Qdrant vector so it can be deleted when a profile is removed
- `candidate_profiles.isIndexed` acts as a circuit-breaker flag — if Qdrant is unavailable, records can be re-indexed later
- All UUIDs (not integer IDs) to prevent enumeration attacks

---

### 4.2 AWS S3 — File Storage

**Why S3?**
Resumes are binary files (PDF, DOCX) ranging from 50 KB to 10 MB. Storing them in PostgreSQL as BLOBs would balloon the database size, slow down backups, and create bottlenecks on every file read. S3 is the industry standard for binary file storage with virtually unlimited capacity.

**How it is used:**

1. **Upload** — when an application is submitted, the resume is streamed into S3 with a UUID-based key (`resumes/{uuid}.pdf`). The S3 key (not a URL) is stored in PostgreSQL.

2. **Server-side encryption** — every file is encrypted at rest with AES-256 (`ServerSideEncryption: 'AES256'`). This is mandatory; resumes contain PII.

3. **Signed URLs** — HR users never get a direct S3 URL. When they request to view a resume, the backend generates a pre-signed URL that expires in 3600 seconds (1 hour). This means:
   - The S3 bucket can have zero public access
   - Access is audited (every resume download is logged)
   - URLs expire and cannot be shared indefinitely

4. **Resume download for AI processing** — the AI pipeline downloads the raw file bytes from S3 (`getObject`), extracts text, then discards the bytes. The original file remains in S3 untouched.

**Security posture:**
- Bucket is private (no public access policy)
- IAM credentials scoped to only this bucket with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
- Signed URLs expire after 1 hour

---

### 4.3 RabbitMQ — Async Message Queue

**Why RabbitMQ?**
AI processing (text extraction + Gemini/OpenAI API calls) can take 5–30 seconds per resume. Doing this synchronously in the HTTP request would:
- Time out for large files or slow AI APIs
- Block the web server thread
- Give the applicant a poor experience (spinning for 30s)
- Have no retry capability on failure

RabbitMQ decouples submission from processing. The applicant gets a 201 response in milliseconds; the AI work happens in the background.

**Topology:**

```
Producer (ApplicationsService)
    │
    │  publish to exchange: smarthire
    │  routing key: application.process
    ▼
Exchange: smarthire  (direct)
    │
    ▼
Queue: smarthire.applications
    │  x-dead-letter-exchange → smarthire.dlx
    ▼
Consumer (QueueConsumer)
    │
    ├── success → ACK (message removed)
    │
    └── failure → NACK
              │
              │  attempts < 3: re-publish with exponential delay
              │  (5s, 10s, 20s)
              │
              └── attempts = 3 → move to DLQ
                       │
                       ▼
              Queue: smarthire.applications.dlq
              (manual inspection + replay)
```

**Retry strategy:**
- Max 3 attempts (configurable via `RABBITMQ_RETRY_ATTEMPTS`)
- Exponential backoff: `baseDelay × 2^(attempt-1)` — `5s, 10s, 20s`
- On max retries: `application.status = FAILED`, `failureReason` recorded in PostgreSQL
- Original applicant data is never lost — failure only means AI processing failed, not data loss

**Message format:**
```json
{ "applicationId": "uuid", "attempt": 1 }
```

**Idempotency:** If the same message is processed twice (RabbitMQ at-least-once delivery), the AI pipeline is safe to re-run — it overwrites the candidate profile rather than duplicating it.

---

### 4.4 Google Gemini / OpenAI — AI Layer

**Why two AI providers?**
Gemini is the primary provider for cost reasons (cheaper per token for both chat and embeddings). OpenAI is the fallback — if `GEMINI_API_KEY` is absent, the system automatically falls back to OpenAI. This makes the system portable and resilient to provider outages.

**Resume Parsing — what it does and why:**

Raw resume text is unstructured. An HR manager searching for "React developers with banking experience" cannot query raw text meaningfully. The AI converts unstructured text into a strict JSON schema:

```json
{
  "firstName": "Alice",
  "currentTitle": "Senior Frontend Engineer",
  "skills": ["React", "TypeScript", "Redux"],
  "experience": [
    { "company": "HSBC", "title": "UI Lead", "description": "...", "skills": ["React"] }
  ],
  "totalExperienceYears": 7
}
```

This structured data is stored in PostgreSQL (`candidate_profiles`) and is also used to build the embedding text.

**Key implementation details:**
- `responseMimeType: 'application/json'` forces Gemini to return only JSON, no markdown
- `temperature: 0.1` — near-zero temperature for deterministic extraction
- Resume text is truncated to 8000 chars (covers full multi-page resume)
- Output validation (`validateParsedResume`) ensures arrays are never null even if AI omits them
- Thought-token filtering: Gemini 2.5 Flash is a thinking model that may emit `thought: true` parts — these are skipped to find the actual content

**Embedding Generation — what it does and why:**

An embedding is a vector of floating point numbers that represents the semantic meaning of text. Similar meanings produce similar vectors. This is what enables searching by intent ("find someone who can lead a team") rather than just keyword matching.

The pipeline:
1. Build a text summary from the parsed profile: `"Role: Senior Engineer\nCompany: HSBC\nSkills: React, TypeScript\nUI Lead at HSBC: Led redesign of banking portal..."`
2. Send to Gemini embedding API → get 768-dimensional vector
3. Store vector in Qdrant

When an HR manager searches "React developer with banking experience", the search query goes through the same embedding step, producing a query vector. Qdrant then finds candidate vectors that are geometrically closest (cosine similarity) to the query vector.

**Task types:**
- `RETRIEVAL_DOCUMENT` — used when indexing candidate profiles (optimises for storage/retrieval)
- `RETRIEVAL_QUERY` — used for HR search queries (optimises for search accuracy)

---

### 4.5 Qdrant — Vector Database

**Why Qdrant and not pgvector?**
pgvector (PostgreSQL extension) can store vectors, but it has important limitations at scale:

| Concern | pgvector | Qdrant |
|---------|----------|--------|
| Index type | IVFFlat / HNSW (limited config) | HNSW (highly tunable) |
| Filter + vector search | Full table scan if filter applied first | Native filtered HNSW (efficient) |
| Scale | Degrades with millions of vectors | Designed for billions |
| Payload filtering | Limited | First-class feature |
| Dedicated performance | Shares resources with transactional DB | Isolated, purpose-built |

For a system expecting millions of resumes, Qdrant is the right choice. It also supports the skills/experience filters that HR managers need.

**How it is used:**

1. **Collection setup** — on startup, `EmbeddingsService.onModuleInit()` checks if the `candidates` collection exists. If not, it creates it with:
   - Vector size: 768 (Gemini) or 3072 (OpenAI) — must match `EMBEDDING_DIMENSIONS`
   - Distance metric: **Cosine** (best for semantic similarity of text embeddings)
   - Payload index on `applicationId` (for fast deletion by application)

2. **Upsert** — after AI processing, the candidate vector is stored:
   ```
   Point {
     id: uuid (qdrantPointId stored in PostgreSQL)
     vector: float[768]
     payload: {
       applicationId, email, firstName, lastName,
       skills, currentTitle, totalExperienceYears
     }
   }
   ```
   The payload in Qdrant is a lightweight copy of profile metadata — just enough to support filtering. The full profile lives in PostgreSQL.

3. **Search with filters** — when HR searches, Qdrant applies pre-filter conditions before performing ANN (approximate nearest neighbour) search:
   ```
   filter: {
     must: [
       { key: "totalExperienceYears", range: { gte: 5 } },
       { key: "skills", match: { any: ["React", "TypeScript"] } }
     ]
   }
   score_threshold: 0.3   ← eliminates irrelevant results
   ```

4. **Dimension mismatch guard** — if an existing collection has a different vector size than `EMBEDDING_DIMENSIONS`, the service throws a clear error with the fix command. This prevents silent corruption.

5. **Deletion** — when a candidate profile is removed, the Qdrant point is deleted by `qdrantPointId` (stored in PostgreSQL), keeping both databases in sync.

**Qdrant vs Elasticsearch:**
Qdrant was chosen over Elasticsearch because ES requires a BM25/TF-IDF keyword layer on top (complex setup) to achieve comparable semantic search, and its vector search performance at scale is inferior to dedicated HNSW-based systems like Qdrant.

---

## 5. NestJS Module Map

```
AppModule (root)
├── ConfigModule          env vars + Joi validation
├── ThrottlerModule       global rate limiting (100 req/60s)
├── DatabaseModule        TypeORM + PostgreSQL connection
│
├── AuthModule
│   ├── AuthService       login, refresh, logout, token rotation
│   ├── AuthController    POST /auth/login, /auth/refresh, /auth/logout
│   ├── JwtStrategy       validates Bearer tokens
│   └── LocalStrategy     email/password for login endpoint
│
├── UsersModule
│   ├── UsersService      CRUD for HR/recruiter accounts
│   └── UsersController   GET/POST/PUT /users
│
├── ApplicationsModule
│   ├── ApplicationsService   submit, findAll, findOne, status updates
│   ├── StorageService        AWS S3 upload/download/signed-url
│   └── ApplicationsController POST/GET /applications
│
├── QueueModule
│   ├── QueueService      RabbitMQ connection, publish, retry topology
│   └── QueueConsumer     consumes messages, calls AiPipelineService
│
├── AiModule
│   ├── AiService          parseResume, generateEmbedding, buildEmbeddingText
│   ├── AiPipelineService  orchestrates full processing flow
│   └── ResumeParserService  PDF/DOCX text extraction (pdf-parse, mammoth)
│
├── EmbeddingsModule
│   └── EmbeddingsService  Qdrant client: upsert, search, delete, ensureCollection
│
├── SearchModule
│   ├── SearchService      end-to-end semantic search orchestration
│   └── SearchController   POST /search
│
├── AuditModule
│   ├── AuditService      log() — never throws, AuditController
│   └── AuditController   GET /audit
│
└── AdminModule
    ├── AdminService      stats, reindex, cleanup operations
    └── AdminController   GET /admin/stats
```

**Cross-cutting concerns (common/):**

| Component | What it does |
|-----------|-------------|
| `JwtAuthGuard` | Validates JWT on all routes except `@Public()` |
| `RolesGuard` | Enforces `@Roles(UserRole.ADMIN)` decorators |
| `@Public()` | Marks route as unauthenticated (apply, login) |
| `@CurrentUser()` | Injects JWT payload into controller method parameter |
| `LoggingInterceptor` | Logs every HTTP request with method, path, duration |
| `ResponseInterceptor` | Wraps all responses in `{ data, statusCode, timestamp }` |
| `HttpExceptionFilter` | Standardises all error responses |

---

## 6. Database Schema

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│         users           │        │        applications          │
├─────────────────────────┤        ├──────────────────────────────┤
│ id          UUID PK     │        │ id            UUID PK        │
│ firstName   VARCHAR(100)│        │ firstName     VARCHAR(100)   │
│ lastName    VARCHAR(100)│        │ lastName      VARCHAR(100)   │
│ email       VARCHAR(255)│        │ email         VARCHAR(255)   │
│ passwordHash VARCHAR    │        │ phone         VARCHAR NULL   │
│ role        ENUM        │        │ linkedinUrl   VARCHAR NULL   │
│   ADMIN|HR|RECRUITER    │        │ resumeKey     VARCHAR        │
│ status      ENUM        │        │ resumeContentType VARCHAR    │
│   ACTIVE|INACTIVE|      │        │ resumeSize    BIGINT         │
│   SUSPENDED             │        │ status        ENUM           │
│ lastLoginAt TIMESTAMP   │        │   PENDING|PROCESSING|        │
│ createdAt   TIMESTAMP   │        │   COMPLETED|FAILED           │
│ updatedAt   TIMESTAMP   │        │ processingAttempts INT       │
└────────────┬────────────┘        │ failureReason  TEXT NULL     │
             │                     │ rawResumeText  TEXT NULL     │
             │ 1:N                 │ processedAt   TIMESTAMP NULL │
             ▼                     │ createdAt     TIMESTAMP      │
┌────────────────────────┐         │ updatedAt     TIMESTAMP      │
│     refresh_tokens     │         └──────────────┬───────────────┘
├────────────────────────┤                        │ 1:1
│ id        UUID PK      │                        ▼
│ token     VARCHAR(512) │         ┌──────────────────────────────┐
│ userId    UUID FK→users│         │     candidate_profiles       │
│ expiresAt TIMESTAMP    │         ├──────────────────────────────┤
│ revoked   BOOLEAN      │         │ id             UUID PK       │
│ ipAddress VARCHAR NULL │         │ applicationId  UUID FK UNIQUE│
│ userAgent VARCHAR NULL │         │ skills         JSONB         │
│ createdAt TIMESTAMP    │         │ experience     JSONB         │
└────────────────────────┘         │ education      JSONB         │
                                   │ certifications JSONB NULL    │
┌────────────────────────┐         │ languages      JSONB NULL    │
│      audit_logs        │         │ totalExperienceYears INT NULL│
├────────────────────────┤         │ currentTitle   VARCHAR NULL  │
│ id           UUID PK   │         │ currentCompany VARCHAR NULL  │
│ userId       UUID NULL │         │ summary        TEXT NULL     │
│ action       ENUM      │         │ qdrantPointId  UUID NULL     │
│ resourceId   UUID NULL │         │ isIndexed      BOOLEAN       │
│ resourceType VARCHAR   │         │ createdAt      TIMESTAMP     │
│ metadata     JSONB NULL│         │ updatedAt      TIMESTAMP     │
│ ipAddress    VARCHAR   │         └──────────────────────────────┘
│ userAgent    VARCHAR   │
│ createdAt    TIMESTAMP │  ← indexed for time-range queries
└────────────────────────┘
```

**JSONB schema for `experience` column:**
```json
[
  {
    "company": "string",
    "title": "string",
    "startDate": "YYYY-MM",
    "endDate": "YYYY-MM | null",
    "isCurrent": false,
    "description": "string",
    "skills": ["string"]
  }
]
```

**JSONB schema for `education` column:**
```json
[
  {
    "institution": "string",
    "degree": "string",
    "field": "string",
    "startDate": "YYYY-MM",
    "endDate": "YYYY-MM | null",
    "gpa": "number | null"
  }
]
```

---

## 7. Authentication Architecture

```
POST /auth/login
    │
    │  1. LocalStrategy validates email + bcrypt password
    │  2. AuthService.generateTokenPair()
    │     ├── accessToken: JWT (15m expiry, HS256, sub+email+role)
    │     └── refreshToken: UUID v4 (stored in refresh_tokens table)
    │
    ▼
Client stores both tokens

HTTP request with accessToken:
    │
    │  Authorization: Bearer <accessToken>
    ▼
JwtAuthGuard → JwtStrategy.validate()
    │
    │  Decodes JWT, checks signature + expiry
    │  Injects { sub, email, role } into request
    ▼
Controller receives @CurrentUser()

Access token expired:
    │
    │  POST /auth/refresh  { refreshToken: "uuid" }
    ▼
AuthService.refresh()
    │
    │  1. Find refresh token in DB (must not be revoked, not expired)
    │  2. Check user is still ACTIVE
    │  3. Revoke old refresh token (token rotation — prevents reuse)
    │  4. Issue new token pair
    ▼
Client updates stored tokens

Logout:
    │
    │  POST /auth/logout  { refreshToken }
    ▼
AuthService.logout()
    │  Marks specific refresh token as revoked
    │  All subsequent refresh attempts with that token fail
```

**Security properties:**
- Access tokens are stateless (15m TTL) — server doesn't need to check DB on every request
- Refresh tokens are stateful (stored in DB) — can be individually revoked on logout or suspicion
- Token rotation on every refresh — if a refresh token is stolen and used, the original holder's next refresh will fail (both tokens point to revoked record)
- `logoutAll()` revokes every refresh token for a user — used when account is suspended

---

## 8. Security Design

| Concern | Implementation |
|---------|----------------|
| Password storage | bcrypt, 12 rounds |
| JWT secret | Minimum 32-char secret via env var |
| Refresh token | UUID v4 stored hashed in DB, rotated on use |
| File upload | MIME type + size validation; files never served directly |
| S3 access | Private bucket + signed URLs (1-hour expiry) |
| Resume encryption | AES-256 server-side encryption on every S3 upload |
| Rate limiting | Throttler: 100 requests per 60 seconds per IP |
| HTTP security headers | Helmet middleware (HSTS, XSS protection, etc.) |
| CORS | Restricted to `CORS_ORIGIN` env var |
| Input validation | `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` |
| RBAC | `RolesGuard` + `@Roles()` decorator on every sensitive route |
| Audit trail | Every login, search, download, and user change is logged |

---

## 9. Error Handling & Resilience

**AI Pipeline:**
- If Gemini fails → retries up to 3 times via RabbitMQ retry logic
- If all retries exhausted → `application.status = FAILED` with reason stored; original data safe
- If AI returns malformed JSON → `validateParsedResume()` coerces missing arrays to `[]`
- If embedding is empty text → throws before calling API (prevents 400 from Gemini)

**Queue:**
- RabbitMQ messages are persistent (`durable: true, deliveryMode: 2`)
- Dead Letter Queue catches messages that fail all retries for manual replay
- Consumer uses `noAck: false` — explicit ACK/NACK per message

**Audit service:**
- `AuditService.log()` wraps its DB write in try/catch and never re-throws
- Audit failures are logged but cannot break business logic (application submission, search, etc.)

**Database:**
- TypeORM connection pooling (default 10 connections)
- All write operations use transactions where atomicity matters

**S3:**
- Upload failures throw `InternalServerErrorException` (no silent failure)
- Delete failures only warn (non-critical; orphaned files don't affect functionality)

---

## 10. Key Design Decisions

**Why not store embeddings in PostgreSQL (pgvector)?**
At millions of resumes, ANN (approximate nearest-neighbour) search in pgvector degrades significantly, and combining vector search with payload filtering requires workarounds. Qdrant is built exactly for this workload with native filtered HNSW indexing. The extra infrastructure cost is justified by search performance and accuracy at scale.

**Why RabbitMQ instead of Bull/Redis?**
Bull (Redis-backed) is simpler for small workloads but Redis is single-threaded and has weaker durability guarantees than RabbitMQ. For a system where losing an AI processing job means a missing candidate in the DB, RabbitMQ's persistent queues, explicit ACK, and dead-letter routing are critical.

**Why async AI processing instead of sync?**
A Gemini API call for resume parsing takes 2–10 seconds. A file with a slow connection might upload in 5–15 seconds. Combining these synchronously would create 15–25 second HTTP responses, causing timeouts and poor UX. Async processing means applicants get a sub-second confirmation while AI works in the background.

**Why JWT + Refresh Token rotation instead of sessions?**
Sessions require server-side storage (Redis or DB), adding infrastructure. JWTs are stateless and horizontally scalable. Refresh token rotation gives session-like revocability without the session store overhead.

**Why JSONB for skills/experience/education?**
These fields have variable-length arrays with nested objects. Normalising them into separate tables (e.g., `candidate_skills`, `candidate_experience`) would require complex joins for every read. JSONB keeps the profile in one row, supports GIN indexing for containment queries, and aligns with the way the AI returns the data.

**Why Qdrant stores only lightweight payload?**
Storing the full profile JSON in Qdrant would create a second writable copy of truth. Instead, Qdrant holds just the fields needed for filtering (`skills`, `totalExperienceYears`) and the `applicationId` pointer. All authoritative data lives in PostgreSQL, fetched after Qdrant returns matching IDs.
