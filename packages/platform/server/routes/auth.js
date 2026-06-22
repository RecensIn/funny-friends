const { Router } = require('express');
const rateLimit = require('express-rate-limit');
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: SECURITY_CONFIG.AUTH_RATE_LIMIT_MAX,
  message: { error: 'Too many login attempts from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

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
router.post('/api/auth/setup', authLimiter, asyncHandler(async (req, res) => {
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
router.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
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
router.post('/api/v2/auth/login', authLimiter, asyncHandler(async (req, res) => { await authController.handleLogin(req, res); }));

// GET /api/v2/auth/me
router.get('/api/v2/auth/me', asyncHandler(async (req, res) => { await authController.checkSession(req, res); }));

// POST /api/v2/auth/logout
router.post('/api/v2/auth/logout', asyncHandler(async (req, res) => { await authController.handleLogout(req, res); }));

module.exports = router;