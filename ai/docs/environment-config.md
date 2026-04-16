# Environment Configuration

## How Environment Variables Are Loaded

Environment variables are loaded in two stages:

### Stage 1: Pre-bootstrap (main.ts)

Before the NestJS application bootstraps, `dotenv` loads the appropriate `.env` file based on the `STAGE` variable:

```
STAGE=development  →  .env.development.local
STAGE=production   →  .env
STAGE=<unset>      →  defaults to development → .env.development.local
```

This early loading is necessary because `createDatabase()` and `createKeyspace()` run before NestJS initializes, so `ConfigService` is not yet available. These functions must use `process.env` directly.

### Stage 2: NestJS ConfigModule (app.module.ts)

`ConfigModule.forRoot()` is configured with `isGlobal: true`, making `ConfigService` available to all modules without needing to import `ConfigModule` in each one.

The same `STAGE`-based logic determines which `.env` file to load.

## Using ConfigService vs process.env

| Context | Use | Reason |
|---------|-----|--------|
| Before `NestFactory.create()` | `process.env` | ConfigService doesn't exist yet |
| Inside modules, services, providers | `ConfigService` | Type-safe, testable, injectable |
| `data-source.ts` (TypeORM CLI) | `dotenv` + `process.env` | Runs outside NestJS context |

## NPM Scripts

The `start:dev` script automatically sets `STAGE=development`:

```
npm run start:dev  →  STAGE=development nest start --watch
```

For production, `STAGE` should be set in the deployment environment. If unset, the code defaults to `development`.

## Environment Files

| File | Purpose |
|------|---------|
| `.env` | Production/default configuration |
| `.env.development.local` | Local development configuration |
| `.env.test.local` | Test configuration |

All `.env` files are gitignored. Each developer maintains their own local copies.
