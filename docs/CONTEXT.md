# Funny Friends — Application Context for Development

_Last updated: 2025-06-23_

## What This Is

A card game ledger app (NOT online gaming). Operators create sessions, enter player names, and use the UI to track round-by-round scores/actions for physical card games. Two game types: Teen Patti (3-card poker-style betting) and Rummy (points-based round tracking).

**Live URL:** https://funny-friends.onrender.com  
**GitHub:** https://github.com/RecensIn/funny-friends

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 7, React Router 7, Tailwind CSS 4, Lucide icons |
| Backend | Express 5, Socket.io 4, Prisma 6 (PostgreSQL), JWT, bcrypt |
| State | React Context (Auth + Toast), no Redux/Zustand |
| Testing | Vitest (32 tests) |
| Deployment | Render (Blueprint `render.yaml`), Docker Compose for local |
| Monorepo | Turborepo + npm workspaces |

---

## Architecture

```
packages/
  shared/          — JSDoc types, shared config, utility functions
  platform/
    client/        — React SPA (port 5173 dev)
      pages/
        Welcome.jsx, Login.jsx, Setup.jsx, SessionSetup.jsx, GameSession.jsx,
        admin/{AdminControlPanel, AdminDashboard, UserManagement, Permissions, Sessions, Settings}
        operator/{OperatorControlPanel, Dashboard, Sessions, Games, Profile}
      hooks/useGameSocket.js  — all socket.io + API fetch logic for GameSession
      context/AuthContext.jsx  — auth state, socket singleton, authenticatedFetch
      context/ToastContext.jsx — toast notification system
    server/        — Express + Socket.io (port 3000/10000 dev/prod)
      server.js   — ~350 lines (was 2834 before refactor)
      routes/     — auth.js, games.js, sessions.js, admin.js, players.js, profile.js, helpers.js
      socket/     — index.js (all Socket.io logic extracted)
      game/       — GameManager.js (Teen Patti 849 lines), rummy/GameManager.js (Rummy 465 lines)
      controllers/auth.controller.js — unified login/session/logout
      middleware/security.js — bcrypt, CSP, CSRF, rate-limit, device fingerprinting
      prisma/schema.prisma — 10 models
      tests/      — auth.test.js (10), game-manager.test.js (12), rummy-ledger.test.js (10)
```

---

## Database Models (Prisma)

```
User — id, username, password, role (ADMIN|OPERATOR|PLAYER|GUEST), isActive,
       failedLoginAttempts, lockedUntil, lastPasswordChange,
       -> Player? (1:1), -> UserSession[], -> UserGamePermission[]

GameType — id (uuid), code ("teen-patti"|"rummy"), name, description, icon, color,
           maxPlayers, minPlayers, isActive
           -> GameSession[], -> UserGamePermission[]

GameSession — id, name (unique), gameTypeId (FK), createdBy (Int, no FK yet),
              totalRounds, targetScore, gameLimitType (rounds|points),
              currentRound, isActive, status, snapshot (JSON), roundHistory (JSON),
              lastActivityAt
              -> GameHand[], Player[], PlayerAddRequest[]

Player — id, name, sessionBalance (Int), score (Int), seatPosition, status,
         userId (FK unique, optional), sessionId (FK)
         @@unique([name, sessionId])

UserGamePermission — userId (FK cascade), gameTypeId (FK cascade), canCreate, canManage
                     @@unique([userId, gameTypeId])

GameHand — id, winner, potSize, logs (JSON), sessionId (FK cascade)

PlayerAddRequest — sessionId (FK cascade), playerName, status (PENDING|APPROVED|DECLINED)

LoginAttempt — username, ipAddress, userAgent, success, reason

UserSession — userId (FK cascade), token (unique JWT session ID), ipAddress,
              userAgent, deviceInfo, isValid, expiresAt
```

---

## API Endpoints

### Auth
- `GET /api/setup/status` — check if first-run setup needed
- `POST /api/auth/setup` — create first admin (rate limited, requires ADMIN_SETUP_KEY)
- `POST /api/auth/login` — legacy login (deprecated, use v2)
- `POST /api/v2/auth/login` — unified login, returns role-based dashboard + CSRF
- `GET /api/v2/auth/me` — session check with dashboard data
- `POST /api/v2/auth/logout` — invalidate session
- `POST /api/auth/logout-all` — invalidate all sessions (requires auth)
- `POST /api/setup/reset` — wipe all data (requires admin + setup key)

### Games
- `GET /api/gametypes` — all game types (auth required)
- `GET /api/v2/games` — games filtered by role/permissions
- `GET /api/v2/sessions` — sessions filtered by role

### Sessions
- `GET /api/sessions/:name/players` — players in session (auth + access check)
- `GET /api/sessions/active` — in-memory active sessions (public)
- `POST /api/sessions` — create session (auth required, permission-checked)
- `POST /api/games/hand` — legacy hand save (backward compat)

### Admin
- `GET /api/admin/sessions` — all sessions (operator+, filtered by role)
- `GET /api/admin/users` — user list (admin only)
- `GET /api/admin/users/:id` — single user with permissions
- `POST /api/admin/users` — create user (with game permissions for operators)
- `PUT /api/admin/users/:id` — update user (username, role, isActive, permissions)
- `DELETE /api/admin/users/:id` — delete user with cascade
- `POST /api/admin/users/:id/toggle` — toggle user active status
- `PUT /api/admin/users/:id/permissions` — set game permissions via full array
- `POST /api/admin/sessions/:name/end` — end session (operator+)
- `GET /api/admin/sessions/:name` — session details with hands/players
- `DELETE /api/admin/sessions/:name` — delete session cascade (admin only)
- `PUT /api/admin/games/:id` — toggle game active status

### Players
- `POST /api/sessions/:name/player-requests` — operator requests player addition
- `GET /api/sessions/:name/player-requests` — view pending requests
- `GET /api/admin/player-requests` — all pending requests (admin only)
- `POST /api/admin/player-requests/:id/resolve` — approve/deny request
- `POST /api/admin/sessions/:name/approve-all-players` — bulk approve

### Profile
- `GET /api/user/profile` — current user profile
- `PUT /api/user/profile` — update username (CSRF protected)
- `PUT /api/user/password` — change password (CSRF protected, invalidates other sessions)

### Socket.io Events
**Client -> Server:**
- `join_session` — operator/viewer joins game room, initializes GameManager
- `game_action` — dispatches to GameManager (BET, FOLD, SEEN, SIDE_SHOW, SHOW, etc.)
- `end_session` — operator ends session
- `request_access` — viewer access request (rate-limited)
- `resolve_access` — operator approves/denies viewer
- `leave_session` — leave room
- `disconnect` — cleanup viewer state

**Server -> Client:**
- `game_update` — full public state broadcast every state change
- `session_ended` — final results with standings, round history
- `viewer_requested` — new viewer access request
- `access_granted` / `access_denied` — viewer resolution
- `error_message` — validation errors
- `session_ended_confirm` — acknowledgment to operator

---

## Key Design Decisions

1. **Server is monolithic** — routes split into modules but all share Express app. No distributed architecture.
2. **In-memory game state** — GameManager lives in `activeSessions` Map. Crash recovery via PostgreSQL `snapshot` column (JSON).
3. **No database-driven auth** — JWT in httpOnly cookie. Session validation against `UserSession` table. CSRF tokens in-memory (Map).
4. **db push on startup** — Production server runs `prisma db push --accept-data-loss` on every boot. Ensures schema is always in sync. Additive, no actual data loss.
5. **Role system**: ADMIN (full access) → OPERATOR (create/manage sessions for permitted games) → PLAYER (join sessions) → GUEST (view only)
6. **GameManager base class** — EventEmitter pattern. `state_change` → `game_update` broadcast. `hand_complete` → DB persistence. `session_ended` → cleanup.

---

## Known Issues & Future Work

- [ ] **No FK on GameSession.createdBy** — declared as `Int` in schema, no relation to User. Orphaned creator references possible if user deleted.
- [ ] **GameHand.logs double-encoding risk** — legacy `POST /api/games/hand` still uses `JSON.stringify`. Socket handler uses raw objects.
- [ ] **No Redis** — CSRF tokens and rate-limit state lost on server restart. Redis service in docker-compose but commented out.
- [ ] **Viewer access** — `request_access` and `resolve_access` handled via socket events. No persistence. Viewers lose access on reconnect.
- [ ] **GameSession blank page** — ErrorBoundary added but underlying state sync timing may still cause flicker. Socket connects before API session fetch completes.
- [ ] **Permissions management** — not fully functional, pending UI updates similar to UserManagement.
- [ ] **PlatformSettings** — danger zone reset works but some sections are info-only.
- [ ] **No TypeScript** — JSDoc only. Game state shapes drift between client/server.
- [ ] **No CI/CD** — relies on Render auto-deploy. No pre-merge checks.
- [ ] **No e2e tests** — only unit tests for auth and game logic. No UI/API integration tests.
- [ ] **Login endpoint duplication** — `/api/auth/login` (legacy) and `/api/v2/auth/login` both exist. Legacy should be removed once client migration confirmed.
- [ ] **OperatorSessions fetches ALL sessions** — uses admin endpoint, relies on backend filtering instead of dedicated operator endpoint.

---

## Local Development

```bash
# Start PostgreSQL
docker-compose up -d

# Install deps
npm install

# Start dev (client:5173 + server:3000)
npm run dev

# Tests
cd packages/platform/server && npm test

# Database management
npm run db:generate   # regenerate Prisma client
npm run db:push       # sync schema to DB
npm run db:seed       # seed game types
npm run db:studio     # open Prisma Studio GUI
```

## Environment Variables

```
DATABASE_URL=postgresql://...    # PostgreSQL connection
JWT_SECRET=<random>              # JWT signing key
ADMIN_SETUP_KEY=<random>         # First-run admin setup key
CLIENT_URL=https://...           # CORS origin
PORT=3000                        # Server port (Render uses 10000)
NODE_ENV=production|development
```

## Render Deployment

`render.yaml` defines two services: `funny-friends-db` (PostgreSQL pserv) and `funny-friends` (Node web service).
- **Build:** `npm install && npm run db:generate && npm run build:client`
- **Pre-deploy:** `prisma db push --accept-data-loss && node scripts/seed-games.js`
- **Start:** `npm start` → `node packages/platform/server/server.js`
- Server serves React build from `../client/dist/` in production
- SPA fallback: `/*` → `index.html` for client-side routing

## Database Init Flow on Render

1. Render boots PostgreSQL container
2. Pre-deploy runs `prisma db push` first time → creates all tables
3. Server starts → always runs `prisma db push --accept-data-loss` on boot (safety net)
4. If no game types exist → auto-seeds Teen Patti + Rummy game types
5. First admin created via `/system-setup` page with `ADMIN_SETUP_KEY`