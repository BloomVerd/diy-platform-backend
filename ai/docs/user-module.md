# User Module

The user module handles all user management and authentication. Everything lives under `src/user/` — authentication is a capability of the user resource, not a separate domain.

## Folder Structure

```
src/user/
├── decorators/
│   ├── current-user.decorator.ts   — extracts user from GQL context
│   └── roles.decorator.ts          — @Roles() metadata decorator
├── dto/
│   ├── auth-response.type.ts       — { accessToken, refreshToken, user }
│   ├── change-password.input.ts
│   ├── create-user.input.ts
│   ├── login.input.ts
│   ├── paginated-users-response.type.ts
│   └── update-user.input.ts
├── entities/
│   └── user.entity.ts              — TypeORM entity + GraphQL ObjectType
├── guards/
│   ├── gql-auth.guard.ts           — access token guard for GraphQL
│   ├── gql-refresh.guard.ts        — refresh token guard for GraphQL
│   └── roles.guard.ts              — role-based access control
├── strategies/
│   ├── jwt-access.strategy.ts      — validates access tokens
│   └── jwt-refresh.strategy.ts     — validates refresh tokens
├── types/
│   └── jwt-payload.type.ts         — { userId, email, role }
├── user.module.ts
├── user.resolver.ts
└── user.service.ts
```

## Entity

The `User` entity doubles as the GraphQL `ObjectType`. Key design decisions:

- `password` and `refreshToken` have no `@Field()` — they are never exposed via GraphQL
- `@BeforeInsert()` lowercases email for consistent lookups
- `role` uses a PostgreSQL enum with values: `ADMIN`, `STAFF`, `USER`
- Soft delete via `isActive` flag (no TypeORM soft delete)

## Authentication Flow

### Signup
1. Client sends `signup(input: CreateUserInput)` mutation
2. Service creates user with argon2-hashed password
3. Immediately logs in and returns `AuthResponse` (access + refresh tokens)

### Login
1. Client sends `login(input: LoginInput)` mutation
2. Service verifies email exists and password matches (argon2)
3. Generates access token (short-lived, 15m default) and refresh token (long-lived, 7d default)
4. Hashes refresh token with argon2 and stores hash on user row
5. Returns `AuthResponse`

### Token Refresh
1. Client sends `refreshTokens` mutation with refresh token in `Authorization: Bearer <token>` header
2. `GqlRefreshGuard` validates the token signature against `JWT_REFRESH_SECRET`
3. Service verifies the raw token matches the stored hash
4. Generates a new token pair (rotation — old refresh token is invalidated)
5. Returns new `AuthResponse`

### Logout
1. Client sends `logout` mutation with access token
2. Service nullifies `refreshToken` on the user row
3. Existing access tokens remain valid until they expire (stateless)

### Password Change
1. Client sends `changePassword(input)` with access token
2. Service verifies `currentPassword` against stored hash
3. Hashes `newPassword`, saves, and nullifies `refreshToken` (forces re-login on all devices)

## Authorization

Two mechanisms work together:

- **`GqlAuthGuard`** — verifies the access token is valid. Applied per-method with `@UseGuards(GqlAuthGuard)`.
- **`RolesGuard` + `@Roles()`** — checks the user's role against required roles. Always used after `GqlAuthGuard`.

### Public endpoints (no guard)
- `signup`, `login`, `refreshTokens`

### Authenticated endpoints
- `me` — any authenticated user
- `updateUser` — self or admin
- `changePassword`, `logout` — self only

### Admin-only endpoints
- `users` (paginated list), `user` (by ID), `removeUser`

## Password Hashing

All password operations use **argon2** (not bcrypt). The `HashHelper` in `src/shared/` uses bcrypt and is not used by this module.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_ACCESS_SECRET` | — | Secret for signing access tokens (required) |
| `JWT_REFRESH_SECRET` | — | Secret for signing refresh tokens (required, must differ from access) |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token TTL |

## GraphQL API

### Mutations

```graphql
# Public
signup(input: CreateUserInput!): AuthResponse!
login(input: LoginInput!): AuthResponse!
refreshTokens: AuthResponse!           # requires refresh token in header

# Authenticated
updateUser(input: UpdateUserInput!): User!
changePassword(input: ChangePasswordInput!): Boolean!
logout: Boolean!
removeUser(id: String!): Boolean!       # admin only
```

### Queries

```graphql
# Authenticated
me: User!

# Admin only
users(skip: Int = 0, take: Int = 25): PaginatedUsersResponse!
user(id: String!): User!
```
