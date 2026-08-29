# SQL and API code generation

Run both pinned generators from the repository root:

```sh
make generate
```

`make generate-check` regenerates and fails when committed output is stale. CI runs that check before server validation.

## sqlc

sqlc is the default for stable, statically analyzable application queries. Configuration lives in `server/sqlc.yaml`, named queries live under `server/internal/database/queries`, and generated Go remains private under `server/internal/database/sqlc`.

The ordered files in `server/internal/database/migrations` are sqlc's schema input. They remain immutable migration history and continue to be executed by Aldus's `PRAGMA user_version` migration runner; sqlc does not run or replace migrations.

The reading-progress and Representation-state reads, revision reads, and upserts use sqlc. Their authorization-sensitive alignment validation remains handwritten inside the same transaction.

Existing authentication, catalog, ingestion, alignment-job, resolver, and fixture SQL remains handwritten in this bounded pass:

- authentication bootstrap and session operations are security-sensitive multi-step transactions with explicit race/error behavior;
- catalog and ingestion queries combine actor-dependent, non-revealing authorization with surrounding filesystem or transaction work;
- alignment jobs combine bounded worker ownership, conditional state transitions, artifact validation, and bulk segment insertion;
- locator resolution uses specialized range/ordering expressions and custom domain scans;
- fixture and migration SQL is setup/maintenance code rather than reusable application queries.

Move an existing exception when that package is otherwise being changed and sqlc makes the complete operation smaller or safer. Do not create generated queries merely to eliminate every SQL string.

## Tygo

Only intentionally public structs in `server/internal/api/contracts` feed Tygo. Database-generated sqlc models and internal store types are not API contracts. Tygo writes the committed, generated TypeScript file to `app/src/generated/api.ts`; edit the Go contract and regenerate rather than editing that file.

The Expo API client imports the generated contracts directly and calls `/api/v1`. API v1 is additions-only while a released client depends on it: preserve released request fields explicitly, add response fields as optional client inputs, and keep strict unknown-field rejection for fields that were never released. The server's unversioned `/api` mount is a permanent v1 alias for installed clients, not a moving "latest" route.

A breaking route, field type, meaning, status, or authentication change belongs in a future API version while v1 remains mounted. Do not bump the API version for ordinary server releases or additive endpoints.
