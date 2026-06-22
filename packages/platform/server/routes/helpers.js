const jwt = require('jsonwebtoken');
const prisma = require('../db');
const {
  SECURITY_CONFIG, generateCSRFToken,
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
      success: false, error: 'Account locked', message, remainingMinutes
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
    if (parts.length === 2 && parts[0] === 'Bearer') token = parts[1];
  }
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET, {
      issuer: SECURITY_CONFIG.JWT_ISSUER,
      audience: SECURITY_CONFIG.JWT_AUDIENCE,
    });
  } catch (e) { return null; }
};

const requireAuth = async (req, res, next) => {
  const decoded = getUserFromRequest(req);
  if (!decoded) return ApiResponse.unauthorized(res);
  try {
    const session = await prisma.userSession.updateMany({
      where: { token: decoded.sessionId, isValid: true, expiresAt: { gt: new Date() } },
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
    if (!req.user || req.user.role !== 'ADMIN') return ApiResponse.forbidden(res, 'Admin access required');
    next();
  });
};

const requireOperator = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || (req.user.role !== 'OPERATOR' && req.user.role !== 'ADMIN'))
      return ApiResponse.forbidden(res, 'Operator access required');
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

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of csrfTokens.entries()) {
    if (now > data.expiresAt) csrfTokens.delete(token);
  }
}, 60 * 60 * 1000);

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
  return { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'strict' : 'lax', path: '/' };
}

module.exports = {
  ApiResponse, asyncHandler, requireAuth, requireAdmin, requireOperator, requireCSRF,
  getUserFromRequest, csrfTokens, usernameAttempts, checkUsernameRateLimit, clearCookieOptions, prisma, SECRET
};