# User Module — Agent Prompts

> **Stack context:** NestJS · GraphQL (Apollo/code-first) · PostgreSQL · TypeORM · Passport · JWT + Refresh Tokens · Argon2 · class-validator · class-transformer
>
> **Folder convention:** Everything lives under `src/user/`. No separate `auth/` module — authentication is a *capability* of the user resource, not a separate domain.

---

## 1 — Entity

```
Create a TypeORM entity `User` at `src/user/entities/user.entity.ts`.

Columns:
- id            — UUID, auto-generated primary key
- firstName     — string, not nullable
- lastName      — string, not nullable
- email         — string, unique, not nullable
- password      — string, not nullable (hashed, never exposed via GraphQL)
- phone         — string, nullable, unique
- role          — enum UserRole { ADMIN, STAFF, USER }, default USER
- isActive      — boolean, default true
- isVerified    — boolean, default false
- lastLoginAt   — timestamp, nullable
- refreshToken  — string, nullable (hashed, never exposed via GraphQL)
- createdAt     — auto-generated timestamp
- updatedAt     — auto-updated timestamp

Requirements:
- Use @ObjectType() so the entity doubles as the GraphQL type.
- Exclude `password` and `refreshToken` from the GraphQL schema entirely — do NOT add @Field() on them.
- Create and export the `UserRole` enum, registered with GraphQL via registerEnumType().
- Add a @BeforeInsert() hook that lowercases `email`.
```

---

## 2 — DTOs / Inputs

```
Create the following input and object-type files inside `src/user/dto/`:

a) `create-user.input.ts`
   - firstName  (string, @IsNotEmpty)
   - lastName   (string, @IsNotEmpty)
   - email      (string, @IsEmail)
   - password   (string, @MinLength(8), @Matches regex for at least 1 uppercase, 1 number, 1 special char)
   - phone      (string, optional, @IsPhoneNumber)

b) `update-user.input.ts`
   - Extend PartialType(CreateUserInput) but OMIT email and password.
   - Add an `id` field (UUID, required).

c) `login.input.ts`
   - email    (string, @IsEmail)
   - password (string, @IsNotEmpty)

d) `auth-response.type.ts`  — GraphQL ObjectType, NOT an input
   - accessToken  (string)
   - refreshToken (string)
   - user         (User entity reference)

e) `change-password.input.ts`
   - currentPassword (string)
   - newPassword     (string, same validation as create password)

f) `paginated-users-response.type.ts`
   - items      (User[])
   - totalCount (Int)
   - hasMore    (Boolean)

All inputs must use class-validator decorators.
All GraphQL types/inputs use code-first decorators (@InputType, @ObjectType, @Field).
```

---

## 3 — Service

```
Create `src/user/user.service.ts` with the following methods.
Inject: TypeORM InjectRepository(User), JwtService, ConfigService.

Password hashing: use argon2 (import * as argon2 from 'argon2').

Methods:

a) create(input: CreateUserInput): Promise<User>
   - Check for existing user by email → ConflictException.
   - Hash password with argon2.
   - Save and return user.

b) findAll(skip: number, take: number): Promise<PaginatedUsersResponse>
   - Return paginated users with totalCount and hasMore.

c) findById(id: string): Promise<User>
   - Throw NotFoundException if missing.

d) findByEmail(email: string): Promise<User | null>
   - Internal lookup, no exception.

e) update(id: string, input: UpdateUserInput): Promise<User>
   - Merge and save. Throw NotFoundException if missing.

f) remove(id: string): Promise<boolean>
   - Soft approach: set isActive = false. Return true on success.

g) login(input: LoginInput): Promise<AuthResponse>
   - Find user by email → UnauthorizedException if not found.
   - Verify password with argon2 → UnauthorizedException on mismatch.
   - Generate access + refresh token pair (see helper methods below).
   - Hash the refresh token, store it on the user row.
   - Update lastLoginAt.
   - Return { accessToken, refreshToken, user }.

h) refreshTokens(userId: string, refreshToken: string): Promise<AuthResponse>
   - Find user, compare hashed refreshToken → ForbiddenException on mismatch.
   - Rotate: generate new token pair, hash and store new refresh token.
   - Return new AuthResponse.

i) logout(userId: string): Promise<boolean>
   - Nullify refreshToken on the user row. Return true.

j) changePassword(userId: string, input: ChangePasswordInput): Promise<boolean>
   - Verify currentPassword → UnauthorizedException on mismatch.
   - Hash newPassword, save. Nullify refreshToken to force re-login. Return true.

Private helpers:
- generateTokens(userId: string, email: string, role: UserRole)
    → returns { accessToken, refreshToken }
    - accessToken:  sign with JWT_ACCESS_SECRET, expiresIn from config (default 15m).
    - refreshToken: sign with JWT_REFRESH_SECRET, expiresIn from config (default 7d).
```

---

## 4 — Guards & Strategies

```
Create the following inside `src/user/guards/` and `src/user/strategies/`:

a) `strategies/jwt-access.strategy.ts`
   - Extends PassportStrategy(Strategy, 'jwt-access').
   - Reads token from Authorization Bearer header.
   - Validates with JWT_ACCESS_SECRET from ConfigService.
   - validate() returns { userId, email, role } from token payload.

b) `strategies/jwt-refresh.strategy.ts`
   - Extends PassportStrategy(Strategy, 'jwt-refresh').
   - Reads token from Authorization Bearer header.
   - Validates with JWT_REFRESH_SECRET.
   - validate() returns { userId, email, role, refreshToken } — attach raw token from request.

c) `guards/gql-auth.guard.ts`
   - Extends AuthGuard('jwt-access').
   - Override getRequest() to extract request from GqlExecutionContext (GraphQL context).

d) `guards/gql-refresh.guard.ts`
   - Same pattern but uses 'jwt-refresh'.

e) `guards/roles.guard.ts`
   - CanActivate guard that reads @Roles() metadata and checks against request.user.role.

f) `decorators/current-user.decorator.ts`
   - Custom param decorator that extracts the user from GqlExecutionContext.
   - Usage: @CurrentUser() user: JwtPayload

g) `decorators/roles.decorator.ts`
   - SetMetadata-based decorator. Usage: @Roles(UserRole.ADMIN)

Create a type/interface `JwtPayload` at `src/user/types/jwt-payload.type.ts`:
   - userId: string
   - email: string
   - role: UserRole
```

---

## 5 — Resolver

```
Create `src/user/user.resolver.ts`.

Public mutations (no guard):
- signup(input: CreateUserInput): AuthResponse
    → calls service.create(), then service.login() to return tokens immediately.
- login(input: LoginInput): AuthResponse
- refreshTokens(): AuthResponse
    → use GqlRefreshGuard + @CurrentUser() to get userId + refreshToken.

Authenticated queries (GqlAuthGuard):
- me(): User
    → @CurrentUser() userId → service.findById()
- users(skip: Int = 0, take: Int = 25): PaginatedUsersResponse
    → restrict to ADMIN role with @Roles(UserRole.ADMIN) + RolesGuard.
- user(id: ID!): User
    → restrict to ADMIN.

Authenticated mutations (GqlAuthGuard):
- updateUser(input: UpdateUserInput): User
    → allow self-update OR admin. Check userId match or role.
- changePassword(input: ChangePasswordInput): Boolean
    → calls service.changePassword() with current user's id.
- logout(): Boolean
    → calls service.logout() with current user's id.
- removeUser(id: ID!): Boolean
    → ADMIN only.

All resolvers must return proper GraphQL types.
Use @UseGuards() at method level, not class level, so public endpoints stay open.
```

---

## 6 — Module

```
Create `src/user/user.module.ts`.

Imports:
- TypeOrmModule.forFeature([User])
- JwtModule.register({}) — empty config; secrets are strategy-level.
- PassportModule.register({ defaultStrategy: 'jwt-access' })

Providers:
- UserService
- UserResolver
- JwtAccessStrategy
- JwtRefreshStrategy
- RolesGuard

Exports:
- UserService (other modules may need to look up users)
```

---

## 7 — Environment & Config

```
Ensure the following env vars are documented and loaded via ConfigService:

JWT_ACCESS_SECRET=<random-256-bit-string>
JWT_REFRESH_SECRET=<different-random-256-bit-string>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

Add these to the project's .env.example with placeholder values and comments.
Do NOT commit real secrets.
```

---

## 8 — Folder Structure (reference)

```
src/user/
├── decorators/
│   ├── current-user.decorator.ts
│   └── roles.decorator.ts
├── dto/
│   ├── auth-response.type.ts
│   ├── change-password.input.ts
│   ├── create-user.input.ts
│   ├── login.input.ts
│   ├── paginated-users-response.type.ts
│   └── update-user.input.ts
├── entities/
│   └── user.entity.ts
├── guards/
│   ├── gql-auth.guard.ts
│   ├── gql-refresh.guard.ts
│   └── roles.guard.ts
├── strategies/
│   ├── jwt-access.strategy.ts
│   └── jwt-refresh.strategy.ts
├── types/
│   └── jwt-payload.type.ts
├── user.module.ts
├── user.resolver.ts
└── user.service.ts
```

---

## Execution Order

Feed these prompts to your agent in this order to avoid forward-reference issues:

1. **Entity** — everything depends on the User shape.
2. **DTOs / Inputs** — service and resolver signatures need these.
3. **Types** (`JwtPayload`) — strategies and decorators reference this.
4. **Decorators** — guards and resolver use `@CurrentUser()` and `@Roles()`.
5. **Strategies** — guards wrap these.
6. **Guards** — resolver applies these.
7. **Service** — core logic, depends on entity + DTOs + JWT.
8. **Resolver** — orchestrates service + guards + decorators.
9. **Module** — wires everything together.
10. **Env / Config** — verify secrets are loadable.

---

## Notes for the Agent

- Use **code-first** GraphQL throughout. No `.graphql` schema files.
- Never expose `password` or `refreshToken` in any GraphQL response.
- Every password operation must use **argon2**, not bcrypt.
- Token rotation is mandatory on refresh — never reuse a refresh token.
- All validation happens at the **input layer** via class-validator, not inside the service.
- Import paths should use relative imports within the module, not barrel files.
- write docs after implementation
