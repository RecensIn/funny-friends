# Codebase Quality Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor 2834-line `server.js` monolith and 1463-line `GameSession.jsx` god component into maintainable modules; add test coverage; harden production DB init; fix bugs and duplication.

**Architecture:** Extract REST routes into `routes/` module files, Socket.io handlers into `socket/` module files, extract custom hooks and sub-components from GameSession. No behavior changes. Existing API contracts preserved exactly.

**Tech Stack:** Node.js + Express 5, React 19, Socket.io 4, Prisma 6, PostgreSQL, Vitest (new), JSDoc types (existing)

## Global Constraints

- Zero behavior changes — existing API contracts, socket events, UI behavior preserved exactly
- No new dependencies added beyond `vitest` for testing
- Follow existing patterns: `asyncHandler` wrapper, `ApiResponse` helper, Zod validation
- Server modules export Express Router instances
- Socket modules export a `register(io)` function
- Client components use existing hooks/context (`useAuth`, `useToast`)

---

## Phase 1: Server Monolith Split

### Task 1: Create route modules directory + shared helpers

**Files:**
- Create: `packages/platform/server/routes/helpers.js`
- Create: `packages/platform/server/routes/auth.js`
- Create: `packages/platform/server/routes/sessions.js`
- Create: `packages/platform/server/routes/games.js`
- Create: `packages/platform/server/routes/admin.js`
- Create: `packages/platform/server/routes/players.js`
- Create: `packages/platform/server/routes/profile.js`
- Modify: `packages/platform/server/server.js`

**Interfaces:**
- Produces: `helpers.js` exports `{ ApiResponse, asyncHandler, requireAuth, requireAdmin, requireOperator, requireCSRF, getUserFromRequest }`
- Consumes by all route modules: `helpers.js` exports
- Each route module exports: `(router) => void` — registers routes on an Express Router

- [ ] **Step 1: Create `packages/platform/server/routes/helpers.js`**

```javascript
// Shared route utilities — extracted from server.js
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const {
  SECURITY_CONFIG,
  generateCSRFToken,
} = require('../middleware/security');

const SECRET = process.env.JWT_SECRET;
const isDev = process.env.NODE_ENV !== 'production';

const csrfTokens = new Map();

const ApiResponse = {
  success: (res, data, statusCode = 200) => {
    res.status(statusCode).json({ success: true, ...data });
  },
  error: (res, message, statusCode = 400, details = null) => {
    const response = { success: false, error: message };
    if (details) response.details = details;
    res.status(statusCode).json(response);
  },
  unauthorized: (res, message = 'Unauthorized') => {
    res.status(401).json({ success: false, error: message });
  },
  forbidden: (res, message = 'Forbidden') => {
    res.status(403).json({ success: false, error: message });
  },
  locked: (res, message, remainingMinutes) => {
    res.status(423).json({
      success: false,
      error: 'Account locked',
      message,
      remainingMinutes
    });
  }
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const getUserFromRequest = (req) => {
  let token = req.cookies.token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET, {
      issuer: SECURITY_CONFIG.JWT_ISSUER,
      audience: SECURITY_CONFIG.JWT_AUDIENCE,
    });
  } catch (e) {
    return null;
  }
};

const requireAuth = async (req, res, next) => {
  const decoded = getUserFromRequest(req);
  if (!decoded) return ApiResponse.unauthorized(res);
  try {
    const session = await prisma.userSession.updateMany({
      where: {
        token: decoded.sessionId,
        isValid: true,
        expiresAt: { gt: new Date() }
      },
      data: { lastUsedAt: new Date() }
    });
    if (session.count === 0) return ApiResponse.unauthorized(res, 'Session expired or invalidated');
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const requireAdmin = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return ApiResponse.forbidden(res, 'Admin access required');
    }
    next();
  });
};

const requireOperator = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'OPERATOR' && req.user.role !== 'ADMIN')) {
      return ApiResponse.forbidden(res, 'Operator access required');
    }
    next();
  });
};

const requireCSRF = (req, res, next) => {
  const csrfToken = req.headers['x-csrf-token'] || req.body?._csrf;
  if (!csrfToken) return res.status(403).json({ error: 'CSRF token required' });
  const tokenData = csrfTokens.get(csrfToken);
  if (!tokenData) return res.status(403).json({ error: 'Invalid CSRF token' });
  if (Date.now() > tokenData.expiresAt) {
    csrfTokens.delete(csrfToken);
    return res.status(403).json({ error: 'CSRF token expired' });
  }
  if (tokenData.userId !== req.user.id) return res.status(403).json({ error: 'CSRF token mismatch' });
  csrfTokens.delete(csrfToken);
  next();
};

// Clean up expired CSRF tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of csrfTokens.entries()) {
    if (now > data.expiresAt) csrfTokens.delete(token);
  }
}, 60 * 60 * 1000);

// Clean up old username attempts
const usernameAttempts = new Map();
const USERNAME_LOCKOUT_DURATION = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [username, data] of usernameAttempts.entries()) {
    if (now - data.firstAttempt > USERNAME_LOCKOUT_DURATION) usernameAttempts.delete(username);
  }
}, 60 * 60 * 1000);

function checkUsernameRateLimit(username) {
  const now = Date.now();
  const attempts = usernameAttempts.get(username);
  if (!attempts) {
    usernameAttempts.set(username, { count: 1, firstAttempt: now });
    return { limited: false };
  }
  if (now - attempts.firstAttempt > USERNAME_LOCKOUT_DURATION) {
    usernameAttempts.set(username, { count: 1, firstAttempt: now });
    return { limited: false };
  }
  if (attempts.count >= SECURITY_CONFIG.AUTH_RATE_LIMIT_MAX) {
    const remainingTime = Math.ceil((USERNAME_LOCKOUT_DURATION - (now - attempts.firstAttempt)) / 1000 / 60);
    return { limited: true, remainingMinutes: remainingTime, message: `Too many attempts for this username. Please try again in ${remainingTime} minutes.` };
  }
  attempts.count++;
  return { limited: false };
}

function clearCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/'
  };
}

module.exports = {
  ApiResponse, asyncHandler, requireAuth, requireAdmin, requireOperator, requireCSRF,
  getUserFromRequest, csrfTokens, usernameAttempts, checkUsernameRateLimit, clearCookieOptions, prisma, SECRET
};
```

- [ ] **Step 2: Create `packages/platform/server/routes/auth.js`**

Move these endpoints from `server.js` into this file:
- Lines 387-398: `GET /api/setup/status`
- Lines 500-631: `POST /api/auth/setup`
- Lines 634-661: `POST /api/setup/reset`
- Lines 664-890: `POST /api/auth/login` (legacy — delete in Phase 5)
- Lines 893-940: `GET /api/auth/me` (legacy — delete in Phase 5)
- Lines 943-962: `POST /api/auth/logout`
- Lines 965-985: `POST /api/auth/logout-all`
- Lines 991-1003: `POST|GET /api/v2/auth/*`

```javascript
const { Router } = require('express');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  ApiResponse, asyncHandler, requireAuth, requireAdmin,
  csrfTokens, usernameAttempts, checkUsernameRateLimit, clearCookieOptions, prisma, SECRET
} = require('./helpers');
const {
  SECURITY_CONFIG, validatePasswordStrength, generateCSRFToken,
  generateDeviceFingerprint, checkAccountLockout, getSecureCookieOptions,
  generateSecureRandom, hashPassword, comparePassword
} = require('../middleware/security');
const authController = require('../controllers/auth.controller');

const router = Router();

const setupSchema = z.object({
  setupKey: z.string().min(10),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128)
});

// GET /api/setup/status
router.get('/api/setup/status', asyncHandler(async (req, res) => {
  const userCount = await prisma.user.count();
  res.json({ needsSetup: userCount === 0, userCount });
}));

// POST /api/auth/setup (rate limited via app-level middleware)
router.post('/api/auth/setup', asyncHandler(async (req, res) => {
  const clientIp = req.ip;
  const userAgent = req.headers['user-agent'];
  const isProduction = process.env.NODE_ENV === 'production';

  const existingUser = await prisma.user.findFirst({ select: { id: true } });
  if (existingUser) return ApiResponse.error(res, 'System already initialized', 400);

  let setupData;
  try { setupData = setupSchema.parse(req.body); }
  catch (error) { return error instanceof z.ZodError ? ApiResponse.error(res, 'Invalid input', 400, error.errors) : (() => { throw error; })(); }

  const { setupKey, username, password } = setupData;
  const configuredKey = process.env.ADMIN_SETUP_KEY;
  if (!configuredKey) return ApiResponse.error(res, 'System configuration error', 500);
  if (!setupKey || setupKey.trim() !== configuredKey.trim()) {
    prisma.loginAttempt.create({ data: { username: 'SETUP_ATTEMPT', ipAddress: clientIp, userAgent, success: false, reason: 'Invalid setup key' } }).catch(() => {});
    return ApiResponse.error(res, 'Invalid setup key', 401);
  }

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) return ApiResponse.error(res, 'Password does not meet security requirements', 400, passwordCheck.errors);

  const hashedPassword = await hashPassword(password);
  const sessionId = generateSecureRandom(32);
  const expiresAt = new Date(Date.now() + SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);

  const { admin, session } = await prisma.$transaction(async (tx) => {
    const newAdmin = await tx.user.create({
      data: { username, password: hashedPassword, role: 'ADMIN', lastPasswordChange: new Date(), failedLoginAttempts: 0 }
    });
    const newSession = await tx.userSession.create({
      data: { id: sessionId, userId: newAdmin.id, token: sessionId, ipAddress: clientIp, userAgent, deviceInfo: generateDeviceFingerprint(req), expiresAt }
    });
    return { admin: newAdmin, session: newSession };
  });

  const token = jwt.sign(
    { id: admin.id, role: admin.role, sessionId, iat: Math.floor(Date.now() / 1000) },
    SECRET,
    { expiresIn: `${SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS}h`, issuer: SECURITY_CONFIG.JWT_ISSUER, audience: SECURITY_CONFIG.JWT_AUDIENCE }
  );

  res.cookie('token', token, getSecureCookieOptions(isProduction, SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000));

  prisma.loginAttempt.create({ data: { username, ipAddress: clientIp, userAgent, success: true } }).catch(() => {});
  return ApiResponse.success(res, { user: { id: admin.id, username: admin.username, role: admin.role } }, 201);
}));

// POST /api/setup/reset
router.post('/api/setup/reset', requireAdmin, asyncHandler(async (req, res) => {
  const { setupKey } = req.body;
  const configuredKey = process.env.ADMIN_SETUP_KEY;
  if (!configuredKey) return ApiResponse.error(res, 'System configuration error', 500);
  if (!setupKey || setupKey.trim() !== configuredKey.trim()) return ApiResponse.error(res, 'Invalid setup key', 401);
  await prisma.$transaction([
    prisma.loginAttempt.deleteMany(), prisma.playerAddRequest.deleteMany(),
    prisma.gameHand.deleteMany(), prisma.player.deleteMany(),
    prisma.gameSession.deleteMany(), prisma.userSession.deleteMany(),
    prisma.userGamePermission.deleteMany(), prisma.user.deleteMany(),
    prisma.gameType.deleteMany()
  ]);
  return ApiResponse.success(res, { message: 'System reset successfully' });
}));

// POST /api/auth/login (legacy — keep for backward compat, replaced by v2)
router.post('/api/auth/login', asyncHandler(async (req, res) => {
  const clientIp = req.ip;
  const userAgent = req.headers['user-agent'];
  const isProduction = process.env.NODE_ENV === 'production';

  const rateLimitCheck = checkUsernameRateLimit(req.body.username);
  if (rateLimitCheck.limited) return ApiResponse.locked(res, rateLimitCheck.message, rateLimitCheck.remainingMinutes);

  const firstUser = await prisma.user.findFirst({ select: { id: true } });
  if (!firstUser) return ApiResponse.error(res, 'System not initialized', 400, { needsSetup: true });

  let loginData;
  try { loginData = loginSchema.parse(req.body); }
  catch (error) { return error instanceof z.ZodError ? ApiResponse.error(res, 'Invalid input', 400, error.errors) : (() => { throw error; })(); }

  const { username, password } = loginData;
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, password: true, role: true, failedLoginAttempts: true, lockedUntil: true }
  });

  if (!user) {
    await comparePassword(password, '$2a$12$abcdefghijklmnopqrstuvwxycdefghijklmnopqrstu');
    prisma.loginAttempt.create({ data: { username, ipAddress: clientIp, userAgent, success: false, reason: 'Invalid credentials' } }).catch(() => {});
    return ApiResponse.error(res, 'Invalid credentials', 401);
  }

  const lockoutStatus = checkAccountLockout(user);
  if (lockoutStatus.locked) {
    prisma.loginAttempt.create({ data: { username, ipAddress: clientIp, userAgent, success: false, reason: `Account locked for ${lockoutStatus.remainingMinutes} minutes` } }).catch(() => {});
    return ApiResponse.locked(res, `Too many failed attempts. Please try again in ${lockoutStatus.remainingMinutes} minutes.`, lockoutStatus.remainingMinutes);
  }

  const validCredentials = await comparePassword(password, user.password);
  if (!validCredentials) {
    const newFailedAttempts = user.failedLoginAttempts + 1;
    const shouldLock = newFailedAttempts >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS;
    await Promise.all([
      prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: newFailedAttempts, ...(shouldLock && { lockedUntil: new Date(Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000) }) } }),
      prisma.loginAttempt.create({ data: { username, ipAddress: clientIp, userAgent, success: false, reason: shouldLock ? 'Account locked' : 'Invalid credentials' } })
    ]);
    if (shouldLock) return ApiResponse.locked(res, `Too many failed attempts. Account locked for ${SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES} minutes.`, SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES);
    return ApiResponse.error(res, 'Invalid credentials', 401);
  }

  const sessionId = generateSecureRandom(32);
  const expiresAt = new Date(Date.now() + SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);

  await Promise.all([
    prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } }),
      prisma.userSession.updateMany({ where: { userId: user.id, expiresAt: { lt: new Date() } }, data: { isValid: false } })
    ]),
    prisma.userSession.create({ data: { id: sessionId, userId: user.id, token: sessionId, ipAddress: clientIp, userAgent, deviceInfo: generateDeviceFingerprint(req), expiresAt } })
  ]);

  const token = jwt.sign(
    { id: user.id, role: user.role, sessionId, iat: Math.floor(Date.now() / 1000) },
    SECRET, { expiresIn: `${SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS}h`, issuer: SECURITY_CONFIG.JWT_ISSUER, audience: SECURITY_CONFIG.JWT_AUDIENCE }
  );

  const csrfToken = generateCSRFToken();
  csrfTokens.set(csrfToken, { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY_MS });

  res.cookie('token', token, getSecureCookieOptions(isProduction, SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000));
  prisma.loginAttempt.create({ data: { username, ipAddress: clientIp, userAgent, success: true } }).catch(() => {});
  usernameAttempts.delete(username);

  const permissions = await prisma.userGamePermission.findMany({ where: { userId: user.id }, include: { gameType: true } });
  return ApiResponse.success(res, {
    user: { id: user.id, username: user.username, role: user.role, permissions: permissions.map(p => ({ gameType: p.gameType.code, canCreate: p.canCreate, canManage: p.canManage })) },
    csrfToken
  });
}));

// GET /api/auth/me (legacy)
router.get('/api/auth/me', asyncHandler(async (req, res) => {
  const { getUserFromRequest } = require('./helpers');
  const decoded = getUserFromRequest(req);
  if (!decoded) return res.json({ user: null });

  const sessionWithUser = await prisma.userSession.findFirst({
    where: { token: decoded.sessionId, isValid: true, expiresAt: { gt: new Date() }, userId: decoded.id },
    include: { user: { select: { id: true, username: true, role: true, lockedUntil: true } } }
  });
  if (!sessionWithUser?.user) return res.json({ user: null });

  const lockoutStatus = checkAccountLockout(sessionWithUser.user);
  if (lockoutStatus.locked) return res.json({ user: null });

  const permissions = await prisma.userGamePermission.findMany({ where: { userId: sessionWithUser.user.id }, include: { gameType: true } });
  return ApiResponse.success(res, { user: { id: sessionWithUser.user.id, role: sessionWithUser.user.role, username: sessionWithUser.user.username, permissions: permissions.map(p => ({ gameType: p.gameType.code, canCreate: p.canCreate, canManage: p.canManage })) } });
}));

// POST /api/auth/logout
router.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const { getUserFromRequest } = require('./helpers');
  const decoded = getUserFromRequest(req);
  if (decoded?.sessionId) {
    await prisma.userSession.updateMany({ where: { token: decoded.sessionId }, data: { isValid: false } });
  }
  res.clearCookie('token', clearCookieOptions());
  return ApiResponse.success(res, { message: 'Logged out successfully' });
}));

// POST /api/auth/logout-all
router.post('/api/auth/logout-all', requireAuth, asyncHandler(async (req, res) => {
  const result = await prisma.userSession.updateMany({ where: { userId: req.user.id, isValid: true }, data: { isValid: false } });
  res.clearCookie('token', clearCookieOptions());
  return ApiResponse.success(res, { message: 'Logged out from all devices', sessionsInvalidated: result.count });
}));

// POST /api/v2/auth/login
router.post('/api/v2/auth/login', asyncHandler(async (req, res) => { await authController.handleLogin(req, res); }));

// GET /api/v2/auth/me
router.get('/api/v2/auth/me', asyncHandler(async (req, res) => { await authController.checkSession(req, res); }));

// POST /api/v2/auth/logout
router.post('/api/v2/auth/logout', asyncHandler(async (req, res) => { await authController.handleLogout(req, res); }));

module.exports = router;
```

- [ ] **Step 3: Create `packages/platform/server/routes/games.js`**

Extract game types and session listing endpoints.

```javascript
const { Router } = require('express');
const { ApiResponse, asyncHandler, requireAuth, getUserFromRequest, prisma } = require('./helpers');
const router = Router();

// GET /api/gametypes
router.get('/api/gametypes', requireAuth, asyncHandler(async (req, res) => {
  const gameTypes = await prisma.gameType.findMany({
    select: { id: true, code: true, name: true, description: true, icon: true, color: true, maxPlayers: true, minPlayers: true, isActive: true }
  });
  res.json(gameTypes);
}));

// GET /api/v2/games
router.get('/api/v2/games', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user;
  let games;
  if (user.role === 'ADMIN') {
    const allGames = await prisma.gameType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, description: true, icon: true, color: true, maxPlayers: true, minPlayers: true, status: true } });
    games = allGames.map(game => ({ ...game, canCreate: true, canManage: true }));
  } else if (user.role === 'OPERATOR') {
    const userWithPermissions = await prisma.user.findUnique({ where: { id: user.id }, include: { allowedGames: { include: { gameType: true } } } });
    games = userWithPermissions?.allowedGames.map(ag => ({
      id: ag.gameType.id, code: ag.gameType.code, name: ag.gameType.name, description: ag.gameType.description,
      icon: ag.gameType.icon, color: ag.gameType.color, maxPlayers: ag.gameType.maxPlayers, minPlayers: ag.gameType.minPlayers,
      canCreate: ag.canCreate, canManage: ag.canManage
    })) || [];
  } else {
    games = await prisma.gameType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, description: true, icon: true, color: true, maxPlayers: true, minPlayers: true, status: true } });
  }
  ApiResponse.success(res, { games });
}));

// GET /api/v2/sessions
router.get('/api/v2/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { role, id: userId } = req.user;
  let sessions;
  if (role === 'ADMIN') {
    sessions = await prisma.gameSession.findMany({ include: { gameType: true, _count: { select: { players: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  } else if (role === 'OPERATOR') {
    sessions = await prisma.gameSession.findMany({ where: { createdBy: userId }, include: { gameType: true, _count: { select: { players: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  } else {
    const playerSessions = await prisma.player.findMany({ where: { userId }, include: { session: { include: { gameType: true, _count: { select: { players: true } } } } } });
    sessions = playerSessions.map(p => p.session);
  }
  ApiResponse.success(res, {
    sessions: sessions.map(s => ({ id: s.id, name: s.name, gameType: s.gameType.name, gameCode: s.gameType.code, currentRound: s.currentRound, totalRounds: s.totalRounds, targetScore: s.targetScore, gameLimitType: s.gameLimitType, playerCount: s._count?.players || 0, isActive: s.isActive, status: s.status, createdAt: s.createdAt }))
  });
}));

// GET /api/csrf-token
router.get('/api/csrf-token', requireAuth, (req, res) => {
  const { generateCSRFToken, SECURITY_CONFIG } = require('../middleware/security');
  const { csrfTokens } = require('./helpers');
  const csrfToken = generateCSRFToken();
  csrfTokens.set(csrfToken, { userId: req.user.id, createdAt: Date.now(), expiresAt: Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY_MS });
  res.json({ csrfToken });
});

module.exports = router;
```

- [ ] **Step 4: Create `packages/platform/server/routes/sessions.js`**

Extract session CRUD endpoints.

```javascript
const { Router } = require('express');
const { ApiResponse, asyncHandler, requireAuth, requireOperator, requireAdmin, prisma } = require('./helpers');
const router = Router();

// GET /api/sessions/:name/players
router.get('/api/sessions/:name/players', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name: decodeURIComponent(name) }, include: { players: true } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const hasAccess = req.user.role === 'ADMIN' || session.createdBy === req.user.id || session.players.some(p => p.userId === req.user.id);
  if (!hasAccess) return res.status(403).json({ error: 'Access denied' });
  res.json({ success: true, players: session.players.map(p => ({ id: p.id, name: p.name, seat: p.seatPosition, sessionBalance: p.sessionBalance, score: p.score, status: p.status || 'PLAYING' })) });
}));

// GET /api/sessions/active — in-memory active sessions
router.get('/api/sessions/active', (req, res) => {
  // activeSessions is passed via app.locals
  const activeSessions = req.app.locals.activeSessions;
  const activeList = [];
  activeSessions.forEach((session, name) => {
    activeList.push({ name, currentRound: session.currentRound, totalRounds: session.totalRounds, playerCount: session.gameState?.players?.length || 0 });
  });
  res.json(activeList);
});

// POST /api/sessions — create/join session
router.post('/api/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { name, totalRounds, targetScore, gameLimitType, players, gameCode } = req.body;
  if (!name) return res.status(400).json({ error: 'Session name is required' });
  const limitType = gameLimitType || 'rounds';
  if (limitType === 'rounds' && !totalRounds) return res.status(400).json({ error: 'Total rounds is required for this game type' });
  if (limitType === 'points' && !targetScore) return res.status(400).json({ error: 'Target score is required for this game type' });

  const gameTypeCode = gameCode || 'teen-patti';
  const gameType = await prisma.gameType.findUnique({ where: { code: gameTypeCode } });
  if (!gameType) return res.status(400).json({ error: 'Invalid game type' });

  if (req.user.role !== 'ADMIN') {
    const userPermission = await prisma.userGamePermission.findFirst({ where: { userId: req.user.id, gameTypeId: gameType.id, canCreate: true } });
    if (!userPermission) return res.status(403).json({ error: 'Access denied', message: "You don't have permission to create sessions for this game" });
  }

  let session = await prisma.gameSession.findUnique({ where: { name } });
  if (session) {
    if (!session.isActive) return res.status(400).json({ error: 'Session name already used and finished.' });
  } else {
    const sessionData = { name, isActive: true, gameTypeId: gameType.id, createdBy: req.user.id, status: 'waiting', isPublic: false, gameLimitType: limitType };
    if (limitType === 'points') sessionData.targetScore = parseInt(targetScore);
    else sessionData.totalRounds = parseInt(totalRounds);
    session = await prisma.gameSession.create({ data: sessionData });

    if (players?.length > 0) {
      for (const p of players) {
        await prisma.player.create({
          data: { name: p.name, userId: p.userId || null, sessionId: session.id, seatPosition: p.seat, sessionBalance: 0 }
        });
      }
    }
  }
  res.json({ success: true, session });
}));

// POST /api/games/hand — legacy hand save (kept for backward compat)
router.post('/api/games/hand', requireAuth, asyncHandler(async (req, res) => {
  const { winner, pot, logs, netChanges, sessionName } = req.body;
  const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  await prisma.gameHand.create({ data: { winner: winner.name, potSize: pot, logs: JSON.stringify(logs || []), sessionId: session.id } });

  for (const [playerId, change] of Object.entries(netChanges || {})) {
    const pid = parseInt(playerId);
    await prisma.player.upsert({ where: { id: pid }, update: { sessionBalance: { increment: change }, sessionId: session.id }, create: { id: pid, name: 'Unknown', sessionBalance: change, sessionId: session.id } });
  }

  const currentRound = session.currentRound;
  const isSessionOver = currentRound >= session.totalRounds;
  if (isSessionOver) {
    await prisma.gameSession.update({ where: { id: session.id }, data: { isActive: false } });
    req.app.locals.io.to(sessionName).emit('session_ended', { reason: 'MAX_ROUNDS_REACHED' });
    if (req.app.locals.activeSessions.has(sessionName)) req.app.locals.activeSessions.delete(sessionName);
  }

  req.app.locals.io.to(sessionName).emit('game_update', { type: 'HAND_COMPLETE', winner, pot, netChanges, currentRound, isSessionOver });
  res.json({ success: true, currentRound, isSessionOver });
}));

module.exports = router;
```

- [ ] **Step 5: Create `packages/platform/server/routes/admin.js`**

Extract admin/user management endpoints.

```javascript
const { Router } = require('express');
const { ApiResponse, asyncHandler, requireAdmin, requireOperator, prisma } = require('./helpers');
const { validatePasswordStrength, hashPassword } = require('../middleware/security');
const router = Router();

// GET /api/admin/sessions
router.get('/api/admin/sessions', requireOperator, asyncHandler(async (req, res) => {
  const whereClause = req.user.role === 'ADMIN' ? {} : { createdBy: req.user.id };
  const sessions = await prisma.gameSession.findMany({ where: whereClause, orderBy: { createdAt: 'desc' }, include: { _count: { select: { hands: true } } } });
  res.json(sessions);
}));

// GET /api/admin/users
router.get('/api/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, username: true, role: true, createdAt: true } });
  res.json(users);
}));

// POST /api/admin/users
router.post('/api/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const { username, password, role, allowedGames } = req.body;
  const validRoles = ['ADMIN', 'OPERATOR', 'PLAYER', 'GUEST'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordCheck.errors });

  const hashed = await hashPassword(password);
  const user = await prisma.user.create({ data: { username, password: hashed, role, lastPasswordChange: new Date() } });

  if (role === 'PLAYER') {
    await prisma.player.create({ data: { name: username, userId: user.id } });
  }

  if (role === 'OPERATOR') {
    try {
      const allGames = await prisma.gameType.findMany({ where: { isActive: true } });
      if (allGames.length > 0) {
        await prisma.userGamePermission.createMany({ data: allGames.map(game => ({ userId: user.id, gameTypeId: game.id, canCreate: true, canManage: true })) });
      }
    } catch (permError) { /* non-critical */ }
  }

  res.json({ success: true, user: { id: user.id, username: user.username } });
}));

// GET /api/admin/users/:id/permissions
router.get('/api/admin/users/:id/permissions', requireAdmin, asyncHandler(async (req, res) => {
  const permissions = await prisma.userGamePermission.findMany({ where: { userId: parseInt(req.params.id) } });
  res.json(permissions);
}));

// PUT /api/admin/users/:id/permissions
router.put('/api/admin/users/:id/permissions', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  await prisma.userGamePermission.deleteMany({ where: { userId: parseInt(id) } });
  if (permissions?.length > 0) {
    await prisma.userGamePermission.createMany({ data: permissions.map(p => ({ userId: parseInt(id), gameTypeId: p.gameTypeId, canCreate: p.canCreate || false, canManage: p.canManage || false })) });
  }
  res.json({ success: true });
}));

// DELETE /api/admin/users/:id
router.delete('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  await prisma.player.deleteMany({ where: { userId: parseInt(id) } });
  await prisma.user.delete({ where: { id: parseInt(id) } });
  res.json({ success: true });
}));

// POST /api/admin/sessions/:name/end
router.post('/api/admin/sessions/:name/end', requireOperator, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (req.user.role !== 'ADMIN' && session.createdBy !== req.user.id) return res.status(403).json({ error: 'Access denied. You can only end your own sessions.' });

  const activeSessions = req.app.locals.activeSessions;
  const io = req.app.locals.io;
  const manager = activeSessions.get(name);
  if (manager) {
    manager.endSession();
  } else {
    await prisma.gameSession.update({ where: { id: session.id }, data: { isActive: false } });
    activeSessions.delete(name);
    io.to(name).emit('session_ended', { reason: 'ADMIN_ENDED' });
  }
  res.json({ success: true });
}));

// GET /api/admin/sessions/:name
router.get('/api/admin/sessions/:name', requireOperator, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name }, include: { hands: { orderBy: { createdAt: 'desc' } }, players: true } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (req.user.role !== 'ADMIN' && session.createdBy !== req.user.id) return res.status(403).json({ error: 'Access denied. You can only view your own sessions.' });
  res.json(session);
}));

// DELETE /api/admin/sessions/:name
router.delete('/api/admin/sessions/:name', requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  await prisma.playerAddRequest.deleteMany({ where: { sessionId: session.id } });
  await prisma.gameHand.deleteMany({ where: { sessionId: session.id } });
  await prisma.player.deleteMany({ where: { sessionId: session.id } });
  await prisma.gameSession.delete({ where: { id: session.id } });
  if (req.app.locals.activeSessions.has(name)) req.app.locals.activeSessions.delete(name);
  res.json({ success: true });
}));

module.exports = router;
```

- [ ] **Step 6: Create `packages/platform/server/routes/players.js`**

Extract player add request endpoints.

```javascript
const { Router } = require('express');
const { ApiResponse, asyncHandler, requireOperator, requireAdmin, prisma } = require('./helpers');
const router = Router();

// POST /api/sessions/:name/player-requests
router.post('/api/sessions/:name/player-requests', requireOperator, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { playerNames } = req.body;
  const session = await prisma.gameSession.findUnique({ where: { name } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.isActive) return res.status(400).json({ error: 'Session is not active' });

  const currentPlayerCount = await prisma.player.count({ where: { sessionId: session.id } });
  const pendingRequests = await prisma.playerAddRequest.count({ where: { sessionId: session.id, status: 'PENDING' } });
  if (currentPlayerCount + pendingRequests + playerNames.length > 17) return res.status(400).json({ error: 'Too many players. Maximum 17 players allowed per session.' });

  const requests = await Promise.all(playerNames.map(playerName =>
    prisma.playerAddRequest.create({ data: { sessionId: session.id, playerName: playerName.trim(), requestedBy: req.user.role } })
  ));
  res.json({ success: true, requests, message: `Requested to add ${playerNames.length} player(s)` });
}));

// GET /api/admin/player-requests
router.get('/api/admin/player-requests', requireAdmin, asyncHandler(async (req, res) => {
  const requests = await prisma.playerAddRequest.findMany({ where: { status: 'PENDING' }, include: { session: { select: { name: true, currentRound: true, totalRounds: true, isActive: true } } }, orderBy: { requestedAt: 'desc' } });
  res.json(requests);
}));

// GET /api/sessions/:name/player-requests
router.get('/api/sessions/:name/player-requests', requireOperator, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const requests = await prisma.playerAddRequest.findMany({ where: { sessionId: session.id }, orderBy: { requestedAt: 'desc' } });
  res.json(requests);
}));

// POST /api/admin/player-requests/:id/resolve
router.post('/api/admin/player-requests/:id/resolve', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;
  const request = await prisma.playerAddRequest.findUnique({ where: { id: parseInt(id) }, include: { session: true } });
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'PENDING') return res.status(400).json({ error: 'Request already resolved' });

  await prisma.playerAddRequest.update({ where: { id: parseInt(id) }, data: { status: approved ? 'APPROVED' : 'DECLINED', resolvedAt: new Date(), resolvedBy: req.user.role } });

  if (approved) {
    const currentPlayers = await prisma.player.findMany({ where: { sessionId: request.sessionId }, orderBy: { seatPosition: 'desc' }, take: 1 });
    const nextSeat = currentPlayers.length > 0 ? (currentPlayers[0].seatPosition || 0) + 1 : 1;
    const newPlayer = await prisma.player.create({ data: { name: request.playerName, sessionId: request.sessionId, seatPosition: nextSeat, sessionBalance: 0 } });

    const activeSessions = req.app.locals.activeSessions;
    const io = req.app.locals.io;
    const manager = activeSessions.get(request.session.name);
    if (manager) {
      manager.addPlayer({ id: newPlayer.id, name: newPlayer.name, seat: newPlayer.seatPosition, sessionBalance: 0 });
      io.to(request.session.name).emit('game_update', manager.getPublicState());
    }
    res.json({ success: true, message: `Player "${request.playerName}" added to session`, player: newPlayer });
  } else {
    res.json({ success: true, message: `Request to add "${request.playerName}" declined` });
  }
}));

// POST /api/admin/sessions/:name/approve-all-players
router.post('/api/admin/sessions/:name/approve-all-players', requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const session = await prisma.gameSession.findUnique({ where: { name } });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const pendingRequests = await prisma.playerAddRequest.findMany({ where: { sessionId: session.id, status: 'PENDING' } });
  if (pendingRequests.length === 0) return res.json({ success: true, message: 'No pending requests' });

  const currentPlayers = await prisma.player.findMany({ where: { sessionId: session.id }, orderBy: { seatPosition: 'desc' }, take: 1 });
  let nextSeat = currentPlayers.length > 0 ? (currentPlayers[0].seatPosition || 0) + 1 : 1;
  const addedPlayers = [];

  for (const request of pendingRequests) {
    await prisma.playerAddRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: req.user.role } });
    const newPlayer = await prisma.player.create({ data: { name: request.playerName, sessionId: session.id, seatPosition: nextSeat++, sessionBalance: 0 } });
    addedPlayers.push(newPlayer);
  }

  const activeSessions = req.app.locals.activeSessions;
  const io = req.app.locals.io;
  const manager = activeSessions.get(name);
  if (manager) {
    for (const player of addedPlayers) {
      manager.addPlayer({ id: player.id, name: player.name, seat: player.seatPosition, sessionBalance: 0 });
    }
    io.to(name).emit('game_update', manager.getPublicState());
  }

  res.json({ success: true, message: `Added ${addedPlayers.length} player(s) to session`, players: addedPlayers });
}));

module.exports = router;
```

- [ ] **Step 7: Create `packages/platform/server/routes/profile.js`**

```javascript
const { Router } = require('express');
const { ApiResponse, asyncHandler, requireAuth, requireCSRF, prisma } = require('./helpers');
const { validatePasswordStrength, hashPassword, comparePassword } = require('../middleware/security');
const router = Router();

// GET /api/user/profile
router.get('/api/user/profile', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, username: true, role: true, createdAt: true } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
}));

// PUT /api/user/profile
router.put('/api/user/profile', requireAuth, requireCSRF, asyncHandler(async (req, res) => {
  const { username } = req.body;
  if (!username || username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser && existingUser.id !== req.user.id) return res.status(400).json({ error: 'Username already taken' });
  const updatedUser = await prisma.user.update({ where: { id: req.user.id }, data: { username }, select: { id: true, username: true, role: true, createdAt: true } });
  res.json({ success: true, user: updatedUser });
}));

// PUT /api/user/password
router.put('/api/user/password', requireAuth, requireCSRF, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid) return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordCheck.errors });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const isValidPassword = await comparePassword(currentPassword, user.password);
  if (!isValidPassword) return res.status(401).json({ error: 'Current password is incorrect' });

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: req.user.id }, data: { password: hashedPassword, lastPasswordChange: new Date() } });

  await prisma.userSession.updateMany({ where: { userId: req.user.id, isValid: true, token: { not: req.user.sessionId } }, data: { isValid: false } });
  res.json({ success: true, message: 'Password updated successfully. Other sessions have been logged out for security.' });
}));

module.exports = router;
```

- [ ] **Step 8: Refactor `packages/platform/server/server.js` to use route modules and socket module**

Remove all route handlers (lines 347-2051), keeping only:
- Package imports and config setup (lines 1-303)
- In-memory state Maps (lines 58-63)
- Snapshot helpers (lines 70-95)
- Orphan cleanup interval (lines 98-153)
- Rate limiting + middleware setup (lines 155-304)
- Socket.io setup and handlers (lines 292-303, 2053-2834)
- DB init + server start (lines 2738-2831)
- Module exports (line 2834)

Add route module mounting:
```javascript
// Mount route modules
const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const sessionsRoutes = require('./routes/sessions');
const adminRoutes = require('./routes/admin');
const playersRoutes = require('./routes/players');
const profileRoutes = require('./routes/profile');

app.use(authRoutes);
app.use(gamesRoutes);
app.use(sessionsRoutes);
app.use(adminRoutes);
app.use(playersRoutes);
app.use(profileRoutes);

// Expose shared state to routes via app.locals
app.locals.activeSessions = activeSessions;
app.locals.sessionLoaders = sessionLoaders;
app.locals.pendingViewerRequests = pendingViewerRequests;
app.locals.approvedViewers = approvedViewers;
app.locals.io = io;
app.locals.prisma = prisma;
```

- [ ] **Step 9: Extract Socket handlers to `packages/platform/server/socket/index.js`**

Move the `initializeGameManager` function and `io.on('connection', ...)` handler from `server.js` into this file. Export a `register(io)` function.

```javascript
// packages/platform/server/socket/index.js
const jwt = require('jsonwebtoken');
const prisma = require('../db');

let TeenPattiGameManager = null;
let RummyGameManager = null;
try { TeenPattiGameManager = require('../game/GameManager'); } catch (e) { /* optional */ }
try { RummyGameManager = require('../game/rummy/GameManager'); } catch (e) { /* optional */ }

const SECRET = process.env.JWT_SECRET;
const isDev = process.env.NODE_ENV !== 'production';

function register(io, { activeSessions, sessionLoaders, pendingViewerRequests, approvedViewers }) {
  // Socket auth middleware
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    let token = null;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [key, value] = c.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      token = cookies.token;
    }
    if (!token && socket.handshake.auth?.token) token = socket.handshake.auth.token;
    if (!token && socket.handshake.headers.authorization?.startsWith('Bearer ')) {
      token = socket.handshake.headers.authorization.substring(7);
    }
    if (token) {
      jwt.verify(token, SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.user = decoded;
        next();
      });
    } else {
      socket.user = { role: 'GUEST' };
      next();
    }
  });

  // ... rest of io.on('connection', ...) handler (copy from server.js lines 2322-2711)
  // Same exact code, but using parameters for the shared state maps
}

module.exports = { register };
```

In `server.js`, replace socket handling with:
```javascript
const { register: registerSocketHandlers } = require('./socket');
registerSocketHandlers(io, { activeSessions, sessionLoaders, pendingViewerRequests, approvedViewers });
```

- [ ] **Step 10: Verify server starts and all endpoints work**

Run: `npm run dev` in root
Expected: server boots, no import errors, all routes accessible

- [ ] **Step 11: Commit**

```bash
git add packages/platform/server/routes/ packages/platform/server/socket/ packages/platform/server/server.js
git commit -m "refactor: split server.js monolith into route and socket modules"
```

---

## Phase 2: Client Component Split

### Task 12: Extract `useGameSocket` custom hook from GameSession

**Files:**
- Create: `packages/platform/client/src/hooks/useGameSocket.js`
- Modify: `packages/platform/client/src/pages/GameSession.jsx`

**Interfaces:**
- Produces: `useGameSocket({ sessionName, user, isOperatorOrAdmin })` returns `{ isConnected, gameState, gamePlayers, players, viewerRequests, roundSummaryData, sessionSummaryData, playerHand, sessionStatus, sendGameAction }`
- Consumes: `useAuth`, `useToast`

- [ ] **Step 1: Create hook file**

```javascript
// packages/platform/client/src/hooks/useGameSocket.js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { API_URL } from '../config';

export function useGameSocket({ sessionName, user, isOperatorOrAdmin }) {
  const { socket } = useAuth();
  const toast = useToast();

  const [session, setSession] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [players, setPlayers] = useState([]);
  const [gamePlayers, setGamePlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('waiting');
  const [viewerRequests, setViewerRequests] = useState([]);
  const [roundSummaryData, setRoundSummaryData] = useState(null);
  const [sessionSummaryData, setSessionSummaryData] = useState(null);
  const [playerHand, setPlayerHand] = useState([]);

  // Fetch session details on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v2/sessions`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
        const data = await res.json();
        const decodedName = decodeURIComponent(sessionName);
        const sessionData = data.sessions?.find(s => s.name === decodedName);
        if (sessionData) {
          setSession(sessionData);
          setSessionStatus(sessionData.status || 'waiting');
          const playersRes = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(decodedName)}/players`, { credentials: 'include' });
          if (playersRes.ok) {
            const playersData = await playersRes.json();
            if (playersData.success?.players) setPlayers(playersData.players);
          }
        } else {
          setError('Session not found');
        }
      } catch (e) {
        setError('Failed to load session: ' + e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [sessionName]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;
    const decodedName = decodeURIComponent(sessionName);

    const joinSession = () => {
      socket.emit('join_session', { sessionName: decodedName, role: 'OPERATOR' });
    };

    const onConnect = () => { setIsConnected(true); setError(''); joinSession(); };
    const onDisconnect = () => { setIsConnected(false); };

    const onGameUpdate = (state) => {
      if (!state) return;
      if (state.type === 'HAND_COMPLETE') {
        setRoundSummaryData({ winner: state.winner, pot: state.pot, netChanges: state.netChanges, currentRound: state.currentRound, isSessionOver: state.isSessionOver, eliminated: state.eliminated, remainingPlayers: state.remainingPlayers });
        if (state.players) setPlayers(state.players);
      } else if (state.type === 'ROUND_COMPLETE') {
        setRoundSummaryData({ winner: state.winner, leaderboard: state.leaderboard, round: state.round, isSessionOver: state.isSessionOver, finalWinner: state.finalWinner, eliminated: state.eliminated, remainingPlayers: state.remainingPlayers });
        if (state.leaderboard) setPlayers(state.leaderboard);
      } else if (state.type === 'SESSION_ENDED' || state.reason) {
        setSessionSummaryData(state);
        if (state.finalPlayers) { setPlayers(state.finalPlayers); setGamePlayers(state.finalPlayers); }
        if (state.leaderboard) setPlayers(state.leaderboard);
        setGameState({ phase: 'ENDED', currentRound: state.finalRound, totalRounds: state.totalRounds, players: state.finalPlayers || state.leaderboard || state.players || [], overallWinner: state.overallWinner || state.finalWinner, roundHistory: state.roundHistory || [], ...state });
        setSessionStatus('ended');
      } else {
        setGameState(state);
        if (state.players?.length > 0) setPlayers(state.players);
        if (state.gamePlayers) setGamePlayers(state.gamePlayers);
        if (state.phase) setSessionStatus(state.phase.toLowerCase());
        if (state.recoveredFromCrash) toast.info('Session was recovered from server restart.');
      }
    };

    const onHandUpdate = (data) => {
      if (data.playerId === user?.id || isOperatorOrAdmin) setPlayerHand(data.hand || []);
    };

    const onViewerRequested = (req) => {
      if (isOperatorOrAdmin) setViewerRequests(prev => prev.find(r => r.socketId === req.socketId) ? prev : [...prev, req]);
    };

    const onSessionEnded = (data) => {
      setSessionSummaryData(data);
      setSessionStatus('ended');
      setGameState(prev => ({ ...prev, phase: 'ENDED', currentRound: data.finalRound, totalRounds: data.totalRounds, players: data.finalPlayers || data.leaderboard || data.players || [], overallWinner: data.overallWinner || data.finalWinner, roundHistory: data.roundHistory || [], ...data }));
      if (data.finalPlayers) { setPlayers(data.finalPlayers); setGamePlayers(data.finalPlayers); }
      if (data.leaderboard) setPlayers(data.leaderboard);
    };

    const onError = (message) => toast.error(message);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('game_update', onGameUpdate);
    socket.on('hand_update', onHandUpdate);
    socket.on('viewer_requested', onViewerRequested);
    socket.on('session_ended', onSessionEnded);
    socket.on('error_message', onError);

    if (!socket.connected) socket.connect();
    else joinSession();
    setIsConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('game_update', onGameUpdate);
      socket.off('hand_update', onHandUpdate);
      socket.off('viewer_requested', onViewerRequested);
      socket.off('session_ended', onSessionEnded);
      socket.off('error_message', onError);
      socket.emit('leave_session', { sessionName: decodedName });
    };
  }, [socket, sessionName, isOperatorOrAdmin, user]);

  const sendGameAction = useCallback((type, payload = {}) => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex || 0];
    socket.emit('game_action', {
      sessionName: decodeURIComponent(sessionName),
      type,
      playerId: activePlayer?.id,
      ...payload
    });
  }, [socket, sessionName, gamePlayers, gameState]);

  return {
    session, gameState, setGameState, players, setPlayers, gamePlayers, setGamePlayers,
    loading, error, isConnected, sessionStatus, viewerRequests, setViewerRequests,
    roundSummaryData, setRoundSummaryData, sessionSummaryData, setSessionSummaryData,
    playerHand, setPlayerHand, sendGameAction
  };
}
```

- [ ] **Step 2: Update `GameSession.jsx` to use the hook**

Replace lines 1-278 (all imports, state declarations, and both useEffects) with the hook import and a single call. Keep all action handlers (`handleStartGame`, `handleFold`, etc.) and the JSX identical.

```javascript
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { /* same icon imports */ } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGameSocket } from '../hooks/useGameSocket';

const GameSession = () => {
  const { sessionName } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOperatorOrAdmin = user?.role === 'OPERATOR' || user?.role === 'ADMIN';

  const {
    session, gameState, setGameState, players, setPlayers, gamePlayers, setGamePlayers,
    loading, error, isConnected, sessionStatus, viewerRequests, setViewerRequests,
    roundSummaryData, setRoundSummaryData, sessionSummaryData, setSessionSummaryData,
    playerHand, setPlayerHand, sendGameAction
  } = useGameSocket({ sessionName, user, isOperatorOrAdmin });

  // Local UI state (modals, inputs)
  const [showSideShowSelection, setShowSideShowSelection] = useState(false);
  const [sideShowConfirm, setSideShowConfirm] = useState(null);
  const [sideShowRequest, setSideShowRequest] = useState(null);
  const [showShowSelection, setShowShowSelection] = useState(false);
  const [showRequest, setShowRequest] = useState(null);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [showSessionSummary, setShowSessionSummary] = useState(false);
  const [newPlayerNames, setNewPlayerNames] = useState('');
  const [showPlayerRequestModal, setShowPlayerRequestModal] = useState(false);
  const [playerPoints, setPlayerPoints] = useState({});

  const isRummy = session?.gameCode === 'rummy';

  // ... keep ALL existing handlers (handleStartGame, handleFold, handleBet, etc.) exactly as-is ...
  // ... keep ALL JSX exactly as-is ...
};

export default GameSession;
```

Remove the `selectedCard`, `showDeclareModal`, `showResolveDeclareModal` states (they still exist from the hook's playerHand state — keep if used). Keep everything below line 278 (all handlers and JSX).

- [ ] **Step 3: Verify app builds and runs**

Run: `npm run build:client` in root
Expected: build succeeds, no import errors

- [ ] **Step 4: Commit**

```bash
git add packages/platform/client/src/hooks/ packages/platform/client/src/pages/GameSession.jsx
git commit -m "refactor: extract useGameSocket hook from GameSession component"
```

---

## Phase 3: Test Coverage

### Task 13: Setup Vitest

**Files:**
- Create: `packages/platform/server/vitest.config.js`
- Modify: `packages/platform/server/package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest --workspace=packages/platform/server
```

- [ ] **Step 2: Create vitest config**

```javascript
// packages/platform/server/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 3: Add test scripts to server package.json**

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### Task 14: Write auth tests

**Files:**
- Create: `packages/platform/server/tests/auth.test.js`

- [ ] **Step 1: Write tests for password validation**

```javascript
// packages/platform/server/tests/auth.test.js
import { describe, it, expect } from 'vitest';

const { validatePasswordStrength } = require('../middleware/security');

describe('validatePasswordStrength', () => {
  it('rejects short passwords', () => {
    const result = validatePasswordStrength('Ab1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('least 8 characters'))).toBe(true);
  });

  it('rejects password without uppercase', () => {
    const result = validatePasswordStrength('abcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
  });

  it('rejects password without special character', () => {
    const result = validatePasswordStrength('Abcdef12');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('special'))).toBe(true);
  });

  it('rejects password with sequential characters', () => {
    const result = validatePasswordStrength('Abcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sequential'))).toBe(true);
  });

  it('rejects password with repeated characters', () => {
    const result = validatePasswordStrength('Aaaabcdef1!');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('repeated'))).toBe(true);
  });

  it('accepts valid password', () => {
    const result = validatePasswordStrength('ValidP@ss1');
    expect(result.valid).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(validatePasswordStrength(null).valid).toBe(false);
    expect(validatePasswordStrength(undefined).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Write tests for account lockout**

```javascript
const { checkAccountLockout } = require('../middleware/security');

describe('checkAccountLockout', () => {
  it('returns not locked when lockedUntil is null', () => {
    const result = checkAccountLockout({ lockedUntil: null });
    expect(result.locked).toBe(false);
  });

  it('returns not locked when lock has expired', () => {
    const past = new Date(Date.now() - 60 * 1000);
    const result = checkAccountLockout({ lockedUntil: past });
    expect(result.locked).toBe(false);
  });

  it('returns locked with remaining minutes when lock is active', () => {
    const future = new Date(Date.now() + 30 * 60 * 1000);
    const result = checkAccountLockout({ lockedUntil: future });
    expect(result.locked).toBe(true);
    expect(result.remainingMinutes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test --workspace=packages/platform/server`
Expected: 8 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/platform/server/vitest.config.js packages/platform/server/tests/ packages/platform/server/package.json
git commit -m "test: add auth validation and lockout tests"
```

### Task 15: Write GameManager tests

**Files:**
- Create: `packages/platform/server/tests/game-manager.test.js`

- [ ] **Step 1: Write Teen Patti hand evaluation tests**

```javascript
// packages/platform/server/tests/game-manager.test.js
import { describe, it, expect } from 'vitest';

// Import the standalone functions directly
const { evaluateHand, compareHands } = require('../game/GameManager');
```

Wait — `GameManager.js` doesn't export `evaluateHand` and `compareHands` individually. They're module-scoped functions. We need to make them exportable without changing behavior. Add to `GameManager.js`:

```javascript
module.exports = GameManager;
module.exports.evaluateHand = evaluateHand;
module.exports.compareHands = compareHands;
module.exports.createDeck = createDeck;
module.exports.shuffleDeck = shuffleDeck;
```

Then tests:

```javascript
const { evaluateHand, compareHands, createDeck, shuffleDeck } = require('../game/GameManager');

describe('Teen Patti GameManager', () => {
  describe('evaluateHand', () => {
    it('detects Trail (three of a kind)', () => {
      const hand = [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: 'A', value: 14 },
        { suit: '♦', rank: 'A', value: 14 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(6); // TRAIL
    });

    it('detects Pure Sequence', () => {
      const hand = [
        { suit: '♥', rank: 'A', value: 14 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♥', rank: 'Q', value: 12 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(5); // PURE_SEQUENCE
    });

    it('detects Sequence (different suits)', () => {
      const hand = [
        { suit: '♠', rank: '5', value: 5 },
        { suit: '♥', rank: '4', value: 4 },
        { suit: '♦', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(4); // SEQUENCE
    });

    it('detects Color (same suit, no sequence)', () => {
      const hand = [
        { suit: '♣', rank: 'K', value: 13 },
        { suit: '♣', rank: '9', value: 9 },
        { suit: '♣', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(3); // COLOR
    });

    it('detects Pair', () => {
      const hand = [
        { suit: '♠', rank: 'J', value: 11 },
        { suit: '♥', rank: 'J', value: 11 },
        { suit: '♦', rank: '7', value: 7 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(2); // PAIR
    });

    it('detects high card', () => {
      const hand = [
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: '9', value: 9 },
        { suit: '♦', rank: '3', value: 3 },
      ];
      const result = evaluateHand(hand);
      expect(result.rank).toBe(1); // HIGH_CARD
    });
  });

  describe('compareHands', () => {
    it('Trail beats Sequence', () => {
      const trail = evaluateHand([
        { suit: '♠', rank: '2', value: 2 },
        { suit: '♥', rank: '2', value: 2 },
        { suit: '♦', rank: '2', value: 2 },
      ]);
      const sequence = evaluateHand([
        { suit: '♠', rank: 'A', value: 14 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♦', rank: 'Q', value: 12 },
      ]);
      expect(compareHands(trail, sequence)).toBeGreaterThan(0);
    });

    it('Higher Pair beats lower Pair', () => {
      const highPair = evaluateHand([
        { suit: '♠', rank: 'K', value: 13 },
        { suit: '♥', rank: 'K', value: 13 },
        { suit: '♦', rank: '3', value: 3 },
      ]);
      const lowPair = evaluateHand([
        { suit: '♠', rank: '5', value: 5 },
        { suit: '♥', rank: '5', value: 5 },
        { suit: '♦', rank: 'A', value: 14 },
      ]);
      expect(compareHands(highPair, lowPair)).toBeGreaterThan(0);
    });
  });

  describe('createDeck', () => {
    it('creates 52 unique cards', () => {
      const deck = createDeck();
      expect(deck.length).toBe(52);
      const keys = new Set(deck.map(c => `${c.suit}-${c.rank}`));
      expect(keys.size).toBe(52);
    });
  });

  describe('shuffleDeck', () => {
    it('returns same number of cards', () => {
      const deck = createDeck();
      const shuffled = shuffleDeck(deck);
      expect(shuffled.length).toBe(52);
    });

    it('does not mutate original deck', () => {
      const deck = createDeck();
      const original = [...deck];
      shuffleDeck(deck);
      expect(deck).toEqual(original);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test --workspace=packages/platform/server`
Expected: 17 tests pass (8 auth + 9 game)

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/game/GameManager.js packages/platform/server/tests/game-manager.test.js
git commit -m "test: add Teen Patti hand evaluation and deck tests"
```

### Task 16: Write Rummy Ledger tests

**Files:**
- Create: `packages/platform/server/tests/rummy-ledger.test.js`

- [ ] **Step 1: Write tests**

```javascript
// packages/platform/server/tests/rummy-ledger.test.js
import { describe, it, expect, beforeEach } from 'vitest';

const RummyLedger = require('../game/rummy/GameManager');

describe('RummyLedger', () => {
  let ledger;

  beforeEach(() => {
    ledger = new RummyLedger({ sessionId: 1, sessionName: 'test-rummy', gameLimitType: 'points', targetScore: 100, totalRounds: 10 });
    ledger.setPlayers([
      { id: 1, name: 'Alice', sessionBalance: 0, seat: 1 },
      { id: 2, name: 'Bob', sessionBalance: 0, seat: 2 },
      { id: 3, name: 'Charlie', sessionBalance: 0, seat: 3 },
    ]);
    ledger.currentRound = 1;
  });

  describe('startRound', () => {
    it('sets phase to ACTIVE and clears round scores', () => {
      ledger.startRound();
      const state = ledger.getPublicState();
      expect(state.phase).toBe('ACTIVE');
      expect(state.players.every(p => p.roundScore === 0)).toBe(true);
    });

    it('rejects start with less than 2 players', () => {
      ledger.setPlayers([{ id: 1, name: 'Alice', sessionBalance: 0, seat: 1 }]);
      const result = ledger.startRound();
      expect(result.success).toBe(false);
    });
  });

  describe('recordInitialDrop', () => {
    beforeEach(() => ledger.startRound());

    it('adds 20 points to player', () => {
      const result = ledger.recordInitialDrop(1);
      expect(result.success).toBe(true);
      expect(result.points).toBe(20);
      const player = ledger.gameState.players.find(p => p.id === 1);
      expect(player.score).toBe(20);
    });

    it('fails for non-existent player', () => {
      const result = ledger.recordInitialDrop(999);
      expect(result.success).toBe(false);
    });

    it('fails if no round in progress', () => {
      ledger.gameState.roundInProgress = false;
      const result = ledger.recordInitialDrop(1);
      expect(result.success).toBe(false);
    });
  });

  describe('recordValidShow', () => {
    beforeEach(() => ledger.startRound());

    it('declares rummy and enters completion phase', () => {
      const result = ledger.recordValidShow(1);
      expect(result.success).toBe(true);
      expect(ledger.gameState.roundCompletionPhase).toBe(true);
      expect(ledger.gameState.rummyDeclaredBy.id).toBe(1);
    });
  });

  describe('recordWrongShow', () => {
    beforeEach(() => ledger.startRound());

    it('adds 80 point penalty', () => {
      const result = ledger.recordWrongShow(1);
      expect(result.success).toBe(true);
      const player = ledger.gameState.players.find(p => p.id === 1);
      expect(player.score).toBe(80);
    });
  });

  describe('checkElimination', () => {
    it('eliminates player when score exceeds target', () => {
      ledger.startRound();
      const player = ledger.gameState.players.find(p => p.id === 1);
      player.score = 101;
      ledger.checkElimination(player);
      expect(player.status).toBe('ELIMINATED');
    });

    it('does not eliminate player at target score', () => {
      ledger.startRound();
      const player = ledger.gameState.players.find(p => p.id === 1);
      player.score = 100;
      ledger.checkElimination(player);
      expect(player.status).toBe('PLAYING');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test --workspace=packages/platform/server`
Expected: 27 tests pass (8 auth + 9 game + 10 rummy)

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/tests/rummy-ledger.test.js
git commit -m "test: add Rummy ledger action tests"
```

---

## Phase 4: Production Hardening

### Task 17: Fix production DB initialization

**Files:**
- Modify: `packages/platform/server/server.js` (lines 2741-2797)
- Modify: `packages/platform/server/scripts/seed-games.js`

**Problem:** `initializeDatabase()` calls `npx prisma db push --accept-data-loss` in production. This can silently drop columns/data.

**Fix:** In production, only run `prisma migrate deploy` (safe). Only use `db push` in dev.

- [ ] **Step 1: Update `initializeDatabase()`**

```javascript
// In server.js, replace initializeDatabase function (lines 2741-2797)
async function initializeDatabase() {
  try {
    console.log('[INFO] Checking database initialization...');
    await prisma.$connect();
    console.log('[INFO] Database connection successful');

    const isProduction = process.env.NODE_ENV === 'production';

    try {
      await prisma.$queryRaw`SELECT 1 FROM "User" LIMIT 1`;
      console.log('[INFO] Database tables already exist');
    } catch (e) {
      if (e.code === 'P2021' || e.message.includes('does not exist')) {
        console.log('[INFO] Database tables not found. Creating schema...');
        const { execSync } = require('child_process');

        if (isProduction) {
          // Production: use safe migration deployment
          execSync('npx prisma migrate deploy', { cwd: __dirname, stdio: 'inherit' });
        } else {
          // Development: use db push for rapid iteration
          execSync('npx prisma db push', { cwd: __dirname, stdio: 'inherit' });
        }

        console.log('[INFO] Database schema created successfully');
        console.log('[INFO] Seeding database...');
        execSync('node scripts/seed-games.js', { cwd: __dirname, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV } });
        console.log('[INFO] Database seeded successfully');
      } else {
        throw e;
      }
    }

    // Verify schema compatibility (new columns exist)
    try {
      await prisma.gameSession.findFirst({ select: { snapshot: true, lastActivityAt: true, roundHistory: true } });
      console.log('[INFO] Database schema is up to date');
    } catch (schemaError) {
      if (schemaError.code === 'P2022' || schemaError.code === 'P2021') {
        console.log('[INFO] Database schema needs update. Running migration...');
        const { execSync } = require('child_process');
        if (isProduction) {
          execSync('npx prisma migrate deploy', { cwd: __dirname, stdio: 'inherit' });
        } else {
          execSync('npx prisma db push', { cwd: __dirname, stdio: 'inherit' });
        }
        console.log('[INFO] Database schema updated successfully');
      } else {
        throw schemaError;
      }
    }
  } catch (error) {
    console.error('[ERROR] Database initialization failed:', error.message);
    console.error('[ERROR] Server will start but may not function properly');
  }
}
```

- [ ] **Step 2: Verify**

Check: `render.yaml` already has `npx prisma db push && node scripts/seed-games.js` as preDeployCommand — this is fine for Render because it's a managed migration step. The server startup code change only affects what happens when the server process itself boots.

Build locally: `npm run build`
Expected: builds without error

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/server.js
git commit -m "fix: use prisma migrate deploy in production, remove --accept-data-loss"
```

---

## Phase 5: Bug Fixes & Cleanup

### Task 18: Add `addPlayer`/`removePlayer` methods to Teen Patti GameManager

**Files:**
- Modify: `packages/platform/server/game/GameManager.js`

**Problem:** Server code directly mutates `manager.gameState.players.push()` and `manager.gameState.gamePlayers.push()` (server.js lines 1810, 1820). This bypasses GameManager logic and is fragile.

- [ ] **Step 1: Add methods to GameManager**

Find the `setPlayers` method in GameManager.js (~line 120). Add after it:

```javascript
addPlayer(player) {
    const exists = this.gameState.players.some(p => p.id === player.id);
    if (exists) return false;

    const newPlayer = {
        id: player.id,
        name: player.name,
        seat: player.seat || ((this.gameState.players.length || 0) + 1),
        sessionBalance: player.sessionBalance || 0,
        status: 'BLIND',
        folded: false,
        invested: 0
    };

    this.gameState.players.push(newPlayer);

    if (this.gameState.phase === 'SETUP') {
        const existsInGame = this.gameState.gamePlayers.some(p => p.id === player.id);
        if (!existsInGame) {
            this.gameState.gamePlayers.push({ ...newPlayer, hand: null });
        }
    }

    this.emit('state_change', this.getPublicState());
    return true;
}

removePlayer(playerId) {
    const playerIdx = this.gameState.players.findIndex(p => p.id === playerId);
    if (playerIdx === -1) return false;

    const player = this.gameState.players[playerIdx];

    if (this.gameState.phase === 'SETUP') {
        this.gameState.players.splice(playerIdx, 1);
        const gpIdx = this.gameState.gamePlayers.findIndex(p => p.id === playerId);
        if (gpIdx !== -1) this.gameState.gamePlayers.splice(gpIdx, 1);
        return true;
    }

    if (player.folded || player.status === 'FOLDED') return false;

    player.folded = true;
    player.status = 'LEFT';

    const remaining = this.gameState.players.filter(p => !p.folded && p.status !== 'LEFT');
    if (remaining.length <= 1) {
        const winner = remaining[0] || this.gameState.players.find(p => !p.folded && p.status !== 'LEFT');
        if (winner) {
            this.gameState.pot -= winner.invested;
            winner.sessionBalance += this.gameState.pot;
            this.emit('session_ended', {
                reason: 'PLAYER_LEFT',
                finalRound: this.currentRound,
                totalRounds: this.totalRounds,
                finalWinner: winner
            });
        }
        this.isActive = false;
        this.gameState.phase = 'ENDED';
    }

    this.emit('state_change', this.getPublicState());
    return true;
}
```

- [ ] **Step 2: Update server.js to use new methods**

In `routes/players.js` (created in Phase 1), the `resolve` and `approve-all` handlers already use `manager.addPlayer()`. Verify the path.

In `routes/admin.js`, the `end` handler should use `manager.endSession()` (already does).

Verify the `game_action` REMOVE_PLAYER handler in `socket/index.js` uses `manager.removePlayer()`.

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/game/GameManager.js
git commit -m "refactor: add addPlayer/removePlayer methods to GameManager"
```

### Task 19: Fix GameHand double-encoding bug

**Files:**
- Modify: `packages/platform/server/routes/sessions.js` (or `server.js` if Phase 1 not deployed)

**Problem:** `GameManager.js` saves logs as a string via `JSON.stringify({...})`, but `schema.prisma` has `GameHand.logs` as `Json`. PostgreSQL auto-parses JSON strings when storing to `Json` type — but with `JSON.stringify`, the column ends up with a double-encoded value (JSON string of a JSON string).

**Fix:** Store JavaScript objects directly into the `Json` column, not stringified.

- [ ] **Step 1: Fix hand_complete handler in socket/index.js**

Find the `hand_complete` event handler. Change:
```javascript
logs: JSON.stringify({
  round: summary.currentRound,
  netChanges: summary.netChanges,
  standings: summary.playerStandings
}),
```
To:
```javascript
logs: {
  round: summary.currentRound,
  netChanges: summary.netChanges,
  standings: summary.playerStandings
},
```

Also fix the legacy `POST /api/games/hand` endpoint in `routes/sessions.js`:
```javascript
// Before:
logs: JSON.stringify(logs || []),
// After:
logs: logs || [],
```

- [ ] **Step 2: Commit**

```bash
git add packages/platform/server/socket/index.js packages/platform/server/routes/sessions.js
git commit -m "fix: remove double JSON encoding on GameHand.logs column"
```

### Task 20: Add GameSession.createdBy FK relation

**Files:**
- Modify: `packages/platform/server/prisma/schema.prisma`

**Problem:** `GameSession.createdBy` is `Int` with no FK to `User`. Orphaned creator references possible.

- [ ] **Step 1: Add relation to schema**

```prisma
model GameSession {
  // ... existing fields ...
  createdBy   Int
  creator     User       @relation(fields: [createdBy], references: [id], onDelete: Restrict)
  // ... rest of model ...
}
```

- [ ] **Step 2: Generate migration**

```bash
npx prisma migrate dev --name add_createdBy_fk --schema=packages/platform/server/prisma/schema.prisma
```

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/prisma/
git commit -m "fix: add FK relation on GameSession.createdBy -> User"
```

### Task 21: Remove duplicate legacy login endpoint

**Files:**
- Modify: `packages/platform/server/routes/auth.js`
- Modify: `packages/platform/client/src/context/AuthContext.js`

**Problem:** Two login endpoints (`/api/auth/login` and `/api/v2/auth/login`) do the same thing. Legacy endpoint is dead code waiting to rot.

**Note:** This is a behavioral change — clients using old login must be updated first. Since AuthContext already uses `/api/v2/auth/login` (line 81 of AuthContext.jsx), this is safe.

- [ ] **Step 1: Check all client-side login calls**

```bash
rg "api/auth/login" --type jsx --type js
```

Expected: Only `AuthContext.jsx` uses `/api/v2/auth/login`. The legacy `/api/auth/login` is unused by the client.

- [ ] **Step 2: Remove legacy login and /api/auth/me from routes/auth.js**

Delete the `POST /api/auth/login` and `GET /api/auth/me` route handlers from `routes/auth.js`.

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/routes/auth.js
git commit -m "refactor: remove duplicate legacy login endpoint"
```

### Task 22: Cleanup minor issues

**Files:**
- Modify: `packages/platform/server/server.js`
- Modify: `packages/shared/src/types/index.js`

- [ ] **Step 1: Remove dead comments from server.js**

Remove:
- Line 155-156: duplicate "ALLOW CONNECTION FROM ANYWHERE" comment
- Line 2677: `// ... existing code ...` dead comment

- [ ] **Step 2: Fix JSDoc types in shared/src/types/index.js**

Update `User.id` from `string` to `number` (Prisma autoincrement Int).
Add `createdAt` and `lockedUntil` fields to match actual Prisma model.

```javascript
/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} role - 'ADMIN', 'OPERATOR', 'PLAYER', 'GUEST'
 * @property {string[]} allowedGames
 * @property {string} createdAt
 * @property {string|null} lockedUntil
 */
```

- [ ] **Step 3: Commit**

```bash
git add packages/platform/server/server.js packages/shared/src/types/index.js
git commit -m "chore: remove dead comments, fix JSDoc type definitions"
```

---

## Summary: File Changes by Phase

| Phase | Files Created | Files Modified |
|-------|--------------|----------------|
| 1: Server Split | 7 (`routes/helpers.js`, `routes/auth.js`, `routes/games.js`, `routes/sessions.js`, `routes/admin.js`, `routes/players.js`, `routes/profile.js`, `socket/index.js`) | 1 (`server.js`) |
| 2: Client Split | 1 (`hooks/useGameSocket.js`) | 1 (`GameSession.jsx`) |
| 3: Tests | 3 (`vitest.config.js`, `tests/auth.test.js`, `tests/game-manager.test.js`, `tests/rummy-ledger.test.js`) | 1 (`server/package.json`, `game/GameManager.js`) |
| 4: Production | 0 | 1 (`server.js`) |
| 5: Bug Fixes | 0 | 6 (`GameManager.js`, `routes/sessions.js`, `schema.prisma`, `routes/auth.js`, `server.js`, `shared/types/index.js`) |

**Total: 11 new files, 10 modified files**

## Rollback Strategy

Each phase is independently revertible:
- **Phase 1**: If route module breaks, revert to monolith server.js — API contracts identical
- **Phase 2**: If hook breaks GameSession, revert file — exact same JSX preserved
- **Phase 3**: Tests are additive — no production code changes in this phase
- **Phase 4**: If migration deploy fails, Render preDeployCommand still handles it
- **Phase 5**: Each commit targets a single concern — revert individually

## Verification Checklist

After each phase, verify:
1. `npm run build:client` succeeds
2. `npm test` passes (Phase 3+)
3. Server boots: `npm run dev` → no import errors, `/health` returns 200
4. Login flow works: POST `/api/v2/auth/login` → cookie + user data
5. Game session: create session → socket connects → actions dispatch

---

Plan complete. Execute phases 1-5 in order, verifying at each phase boundary.