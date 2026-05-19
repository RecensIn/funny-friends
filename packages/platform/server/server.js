// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
// Try to load GameManagers, fallback to null if not available
let TeenPattiGameManager = null;
let RummyGameManager = null;

try {
  TeenPattiGameManager = require('./game/GameManager');
  console.log('[INFO] Teen Patti game manager loaded');
} catch (e) {
  console.log('[INFO] Teen Patti game not available:', e.message);
}

try {
  RummyGameManager = require('./game/rummy/GameManager');
  console.log('[INFO] Rummy game manager loaded');
} catch (e) {
  console.log('[INFO] Rummy game not available:', e.message);
}
const {
  SECURITY_CONFIG,
  validatePasswordStrength,
  generateCSRFToken,
  generateDeviceFingerprint,
  checkAccountLockout,
  sanitizeInput,
  getSecureCookieOptions,
  generateSecureRandom,
  hashPassword,
  comparePassword,
} = require('./utils/security');

// Import Auth Controller
const authController = require('./controllers/auth.controller');

const app = express();
const server = http.createServer(app);

// Trust proxy for rate limiting (required when behind Render's load balancer)
app.set('trust proxy', 1);

// Setup Prisma Client (Centralized in db.js)
const prisma = require('./db');

// --- IN-MEMORY STATE MANAGEMENT ---
// These must be declared BEFORE any route handlers that use them
const activeSessions = new Map(); // sessionName -> GameManager
const sessionLoaders = new Map(); // Track ongoing session loads to prevent race conditions
const pendingViewerRequests = new Map(); // sessionName -> [{ socketId, name, timestamp }]
const approvedViewers = new Map(); // sessionName -> Set of socket IDs

// Export prisma for use in controllers
// module.exports moved to end of file

// --- SNAPSHOT PERSISTENCE HELPER ---
async function saveSnapshot(sessionName, manager) {
  if (!manager || !manager.getSnapshot) return;
  try {
    const snapshot = manager.getSnapshot();
    await prisma.gameSession.update({
      where: { name: sessionName },
      data: {
        snapshot: snapshot,
        lastActivityAt: new Date()
      }
    });
  } catch (e) {
    console.error(`[ERROR] Failed to save snapshot for ${sessionName}:`, e.message);
  }
}

async function clearSnapshot(sessionName) {
  try {
    await prisma.gameSession.update({
      where: { name: sessionName },
      data: { snapshot: null }
    });
  } catch (e) {
    console.error(`[ERROR] Failed to clear snapshot for ${sessionName}:`, e.message);
  }
}

// --- ORPHANED SESSION CLEANUP ---
setInterval(async () => {
  try {
    const now = Date.now();
    const STALE_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours
    const STALE_VIEWER_MS = 60 * 60 * 1000; // 1 hour

    // Clean up activeSessions entries for sessions that are no longer active in DB
    for (const [name, manager] of activeSessions.entries()) {
      // Check if manager has been inactive for too long
      const isInactive = !manager.isActive || manager.gameState?.phase === 'ENDED';
      if (isInactive) {
        console.log(`[CLEANUP] Removing inactive manager from memory: ${name}`);
        activeSessions.delete(name);
        clearSnapshot(name).catch(() => {});
        continue;
      }

      // Check DB for stale sessions
      const dbSession = await prisma.gameSession.findUnique({
        where: { name },
        select: { isActive: false, lastActivityAt: true }
      });
      if (!dbSession || !dbSession.isActive) {
        console.log(`[CLEANUP] Removing stale session from memory: ${name}`);
        activeSessions.delete(name);
        clearSnapshot(name).catch(() => {});
      } else if (dbSession.lastActivityAt) {
        const lastActivity = new Date(dbSession.lastActivityAt).getTime();
        if (now - lastActivity > STALE_SESSION_MS) {
          console.log(`[CLEANUP] Session ${name} stale for ${Math.round((now - lastActivity) / 60000)}min, cleaning up`);
          activeSessions.delete(name);
          clearSnapshot(name).catch(() => {});
        }
      }
    }

    // Clean up old pending viewer requests
    for (const [sessionName, requests] of pendingViewerRequests.entries()) {
      const filtered = requests.filter(r => now - r.timestamp < STALE_VIEWER_MS);
      if (filtered.length === 0) {
        pendingViewerRequests.delete(sessionName);
      } else if (filtered.length !== requests.length) {
        pendingViewerRequests.set(sessionName, filtered);
      }
    }

    // Clean up approved viewers for sessions no longer in activeSessions
    for (const sessionName of approvedViewers.keys()) {
      if (!activeSessions.has(sessionName)) {
        approvedViewers.delete(sessionName);
      }
    }
  } catch (e) {
    console.error('[ERROR] Orphaned session cleanup failed:', e);
  }
}, 15 * 60 * 1000); // Run every 15 minutes

// ALLOW CONNECTION FROM ANYWHERE (For simplicity)
// ALLOW CONNECTION FROM ANYWHERE (For simplicity)
const CLIENT_URL = process.env.CLIENT_URL || "https://teen-patti-client.onrender.com";
const ALLOWED_ORIGINS = [
  CLIENT_URL,
  "https://funny-friends.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174"
];

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
  max: SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// IP-based auth rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: SECURITY_CONFIG.AUTH_RATE_LIMIT_MAX,
  message: { error: 'Too many login attempts from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// Username-based rate limiting (in-memory with TTL)
const usernameAttempts = new Map();
const USERNAME_LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function checkUsernameRateLimit(username) {
  const now = Date.now();
  const attempts = usernameAttempts.get(username);

  if (!attempts) {
    usernameAttempts.set(username, { count: 1, firstAttempt: now });
    return { limited: false };
  }

  // Reset if window has passed
  if (now - attempts.firstAttempt > USERNAME_LOCKOUT_DURATION) {
    usernameAttempts.set(username, { count: 1, firstAttempt: now });
    return { limited: false };
  }

  // Check if limit reached
  if (attempts.count >= SECURITY_CONFIG.AUTH_RATE_LIMIT_MAX) {
    const remainingTime = Math.ceil((USERNAME_LOCKOUT_DURATION - (now - attempts.firstAttempt)) / 1000 / 60);
    return {
      limited: true,
      remainingMinutes: remainingTime,
      message: `Too many attempts for this username. Please try again in ${remainingTime} minutes.`
    };
  }

  // Increment counter
  attempts.count++;
  return { limited: false };
}

// Clean up old username attempts periodically
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of usernameAttempts.entries()) {
    if (now - data.firstAttempt > USERNAME_LOCKOUT_DURATION) {
      usernameAttempts.delete(username);
    }
  }
}, 60 * 60 * 1000); // Clean every hour

app.use(limiter);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) return callback(null, true);

    // Allow same-origin requests (for static files)
    if (process.env.NODE_ENV === 'production' && origin.includes('onrender.com')) {
      return callback(null, true);
    }

    // Check against allowed origins list
    if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      callback(null, true);
    } else {
      console.error(`CORS rejected origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// DEBUG MIDDLEWARE (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    console.log("Cookies:", req.cookies);
    console.log("Origin:", req.headers.origin);
    next();
  });
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost'))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }
});

// Input validation schemas
const loginSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128)
});

const setupSchema = z.object({
  setupKey: z.string().min(10),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128)
});

// CSRF Token storage (in production, use Redis)
const csrfTokens = new Map();

// Clean up expired CSRF tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of csrfTokens.entries()) {
    if (now > data.expiresAt) {
      csrfTokens.delete(token);
    }
  }
}, 60 * 60 * 1000); // Clean every hour

const sessionSchema = z.object({
  name: z.string().min(3).max(100),
  totalRounds: z.number().int().min(1).max(50),
  players: z.array(z.object({
    name: z.string().min(1).max(50),
    seatPosition: z.number().int().min(1).max(6).optional()
  })).min(2).max(6)
});

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Helper to get user from Token (Cookie or Header)
const getUserFromRequest = (req) => {
  let token = req.cookies.token;
  console.log('[DEBUG] getUserFromRequest - Cookie token exists:', !!token);
  
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
      console.log('[DEBUG] getUserFromRequest - Using Bearer token from header');
    }
  }
  
  if (!token) {
    console.log('[DEBUG] getUserFromRequest - No token found');
    return null;
  }
  
  try {
    const decoded = jwt.verify(token, SECRET, {
      issuer: SECURITY_CONFIG.JWT_ISSUER,
      audience: SECURITY_CONFIG.JWT_AUDIENCE,
    });
    console.log('[DEBUG] getUserFromRequest - Token decoded successfully:', { id: decoded.id, role: decoded.role });
    return decoded;
  } catch (e) {
    console.log('[DEBUG] getUserFromRequest - Token verification failed:', e.message);
    return null;
  }
};

// Check if setup is needed
app.get('/api/setup/status', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    res.json({
      needsSetup: userCount === 0,
      userCount: userCount
    });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// Standardized API Response Helpers
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

// Async handler wrapper to reduce try-catch boilerplate
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Authorization middleware
const requireAuth = async (req, res, next) => {
  const decoded = getUserFromRequest(req);
  console.log('[DEBUG] requireAuth - decoded:', decoded);
  
  if (!decoded) {
    console.log('[DEBUG] requireAuth - No decoded token found');
    return ApiResponse.unauthorized(res);
  }

  try {
    // Single query to validate session and update timestamp
    const session = await prisma.userSession.updateMany({
      where: {
        token: decoded.sessionId,
        isValid: true,
        expiresAt: { gt: new Date() }
      },
      data: { lastUsedAt: new Date() }
    });

    if (session.count === 0) {
      console.log('[DEBUG] requireAuth - Session not found or expired');
      return ApiResponse.unauthorized(res, 'Session expired or invalidated');
    }

    req.user = decoded;
    console.log('[DEBUG] requireAuth - User set:', req.user);
    next();
  } catch (e) {
    console.error('[ERROR] Session validation failed:', e);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {
      console.log('[DEBUG] requireAdmin - req.user:', req.user);
      if (!req.user) {
        console.log('[DEBUG] requireAdmin - No user in request');
        return ApiResponse.forbidden(res, 'Admin access required - Not authenticated');
      }
      if (req.user.role !== 'ADMIN') {
        console.log(`[DEBUG] requireAdmin - User role '${req.user.role}' is not ADMIN`);
        return ApiResponse.forbidden(res, 'Admin access required - Insufficient permissions');
      }
      next();
    });
  } catch (e) {
    console.error('[ERROR] requireAdmin middleware error:', e);
    return ApiResponse.forbidden(res, 'Admin access required');
  }
};

const requireOperator = async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {
      if (!req.user || (req.user.role !== 'OPERATOR' && req.user.role !== 'ADMIN')) {
        return ApiResponse.forbidden(res, 'Operator access required');
      }
      next();
    });
  } catch (e) {
    return ApiResponse.forbidden(res, 'Operator access required');
  }
};

// 1. SETUP API - Optimized with transactions and parallel operations
app.post('/api/auth/setup', authLimiter, asyncHandler(async (req, res) => {
  const clientIp = req.ip;
  const userAgent = req.headers['user-agent'];
  const isProduction = process.env.NODE_ENV === 'production';

  // Check if already initialized
  const existingUser = await prisma.user.findFirst({ select: { id: true } });
  if (existingUser) {
    return ApiResponse.error(res, 'System already initialized', 400);
  }

  // Validate input
  let setupData;
  try {
    setupData = setupSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ApiResponse.error(res, 'Invalid input', 400, error.errors);
    }
    throw error;
  }

  const { setupKey, username, password } = setupData;

  // Validate setup key
  const configuredKey = process.env.ADMIN_SETUP_KEY;

  if (!configuredKey) {
    console.error('[CRITICAL] ADMIN_SETUP_KEY is not set in environment variables!');
    return ApiResponse.error(res, 'System configuration error', 500);
  }

  // Debug logging (Masked for security)
  const receivedKeySafe = setupKey ? `${setupKey.substring(0, 3)}...${setupKey.slice(-3)}` : 'undefined';
  const configuredKeySafe = `${configuredKey.substring(0, 3)}...${configuredKey.slice(-3)}`;
  console.log(`[DEBUG] Setup execution - Received: ${receivedKeySafe}, Expected: ${configuredKeySafe}, Match: ${setupKey.trim() === configuredKey.trim()}`);

  if (!setupKey || setupKey.trim() !== configuredKey.trim()) {
    // Log failure and return (fire and forget)
    prisma.loginAttempt.create({
      data: {
        username: 'SETUP_ATTEMPT',
        ipAddress: clientIp,
        userAgent,
        success: false,
        reason: 'Invalid setup key'
      }
    }).catch(() => { });

    return ApiResponse.error(res, 'Invalid setup key', 401);
  }

  // Validate password strength
  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) {
    return ApiResponse.error(res, 'Password does not meet security requirements', 400, passwordCheck.errors);
  }

  // Hash password and prepare data
  const hashedPassword = await hashPassword(password);
  const sessionId = generateSecureRandom(32);
  const expiresAt = new Date(Date.now() + SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);

  // Use interactive transaction for atomic user + session creation with correct FK
  const { admin, session } = await prisma.$transaction(async (tx) => {
    // 1. Create User
    const newAdmin = await tx.user.create({
      data: {
        username,
        password: hashedPassword,
        role: 'ADMIN',
        lastPasswordChange: new Date(),
        failedLoginAttempts: 0
      }
    });

    // 2. Create Session linked to the new User
    const newSession = await tx.userSession.create({
      data: {
        id: sessionId,
        userId: newAdmin.id, // Use real ID from created user
        token: sessionId,
        ipAddress: clientIp,
        userAgent,
        deviceInfo: generateDeviceFingerprint(req),
        expiresAt
      }
    });

    return { admin: newAdmin, session: newSession };
  });

  // ... rest of setup logic ...



  // Generate JWT
  const token = jwt.sign(
    {
      id: admin.id,
      role: admin.role,
      sessionId,
      iat: Math.floor(Date.now() / 1000)
    },
    SECRET,
    {
      expiresIn: `${SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS}h`,
      issuer: SECURITY_CONFIG.JWT_ISSUER,
      audience: SECURITY_CONFIG.JWT_AUDIENCE
    }
  );

  // Set cookie and log success (parallel)
  res.cookie('token', token, getSecureCookieOptions(
    isProduction,
    SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000
  ));

  // Fire and forget logging
  prisma.loginAttempt.create({
    data: {
      username,
      ipAddress: clientIp,
      userAgent,
      success: true
    }
  }).catch(() => { });

  return ApiResponse.success(res, {
    user: { id: admin.id, username: admin.username, role: admin.role }
  }, 201);
}));

// 2. RESET API - Clears database for re-setup (Requires Admin Key)
app.post('/api/setup/reset', requireAdmin, asyncHandler(async (req, res) => {
  const { setupKey } = req.body;
  const configuredKey = process.env.ADMIN_SETUP_KEY;

  if (!configuredKey) {
    return ApiResponse.error(res, 'System configuration error', 500);
  }

  if (!setupKey || setupKey.trim() !== configuredKey.trim()) {
    return ApiResponse.error(res, 'Invalid setup key', 401);
  }

  // Delete all data in reverse dependency order
  await prisma.$transaction([
    prisma.loginAttempt.deleteMany(),
    prisma.playerAddRequest.deleteMany(),
    prisma.gameHand.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameSession.deleteMany(),
    prisma.userSession.deleteMany(),
    prisma.userGamePermission.deleteMany(),
    prisma.user.deleteMany(),
    prisma.gameType.deleteMany() // Optional: Wipe game types too for total reset
  ]);

  console.log('[SYSTEM] Database reset by administrator');
  return ApiResponse.success(res, { message: 'System reset successfully' });
}));

// 2. LOGIN API - Optimized with early returns, transactions, and parallel ops
app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const clientIp = req.ip;
  const userAgent = req.headers['user-agent'];
  const isProduction = process.env.NODE_ENV === 'production';

  // Check username-based rate limiting (prevents brute force on same username from different IPs)
  const rateLimitCheck = checkUsernameRateLimit(req.body.username);
  if (rateLimitCheck.limited) {
    return ApiResponse.locked(res, rateLimitCheck.message, rateLimitCheck.remainingMinutes);
  }

  // Check if setup is needed (single query)
  const firstUser = await prisma.user.findFirst({ select: { id: true } });
  if (!firstUser) {
    return ApiResponse.error(res, 'System not initialized', 400, {
      needsSetup: true,
      message: 'Please complete system setup first'
    });
  }

  // Validate input
  let loginData;
  try {
    loginData = loginSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ApiResponse.error(res, 'Invalid input', 400, error.errors);
    }
    throw error;
  }

  const { username, password } = loginData;

  // Fetch user with all security fields in single query
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      password: true,
      role: true,
      failedLoginAttempts: true,
      lockedUntil: true
    }
  });

  // Handle non-existent user (same timing as existing user to prevent timing attacks)
  if (!user) {
    // Perform dummy bcrypt comparison to maintain consistent timing
    await comparePassword(password, '$2a$12$abcdefghijklmnopqrstuvwxycdefghijklmnopqrstu');

    // Fire and forget logging
    prisma.loginAttempt.create({
      data: {
        username,
        ipAddress: clientIp,
        userAgent,
        success: false,
        reason: 'Invalid credentials'
      }
    }).catch(() => { });

    return ApiResponse.error(res, 'Invalid credentials', 401);
  }

  // Check account lockout
  const lockoutStatus = checkAccountLockout(user);
  if (lockoutStatus.locked) {
    prisma.loginAttempt.create({
      data: {
        username,
        ipAddress: clientIp,
        userAgent,
        success: false,
        reason: `Account locked for ${lockoutStatus.remainingMinutes} minutes`
      }
    }).catch(() => { });

    return ApiResponse.locked(res,
      `Too many failed attempts. Please try again in ${lockoutStatus.remainingMinutes} minutes.`,
      lockoutStatus.remainingMinutes
    );
  }

  // Validate credentials
  const validCredentials = await comparePassword(password, user.password);

  if (!validCredentials) {
    // Increment failed attempts
    const newFailedAttempts = user.failedLoginAttempts + 1;
    const shouldLock = newFailedAttempts >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS;

    const updateData = {
      failedLoginAttempts: newFailedAttempts,
      ...(shouldLock && {
        lockedUntil: new Date(Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000)
      })
    };

    // Update user and log failure in parallel
    await Promise.all([
      prisma.user.update({
        where: { id: user.id },
        data: updateData
      }),
      prisma.loginAttempt.create({
        data: {
          username,
          ipAddress: clientIp,
          userAgent,
          success: false,
          reason: shouldLock ? 'Account locked' : 'Invalid credentials'
        }
      })
    ]);

    if (shouldLock) {
      return ApiResponse.locked(res,
        `Too many failed attempts. Account locked for ${SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES} minutes.`,
        SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES
      );
    }

    return ApiResponse.error(res, 'Invalid credentials', 401);
  }

  // === SUCCESS PATH ===
  // Clean up expired sessions and reset failed attempts in parallel
  const sessionId = generateSecureRandom(32);
  const expiresAt = new Date(Date.now() + SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);

  const [, session] = await Promise.all([
    // Reset failed attempts and cleanup old sessions
    prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null
        }
      }),
      // Invalidate expired sessions for this user
      prisma.userSession.updateMany({
        where: {
          userId: user.id,
          expiresAt: { lt: new Date() }
        },
        data: { isValid: false }
      })
    ]),

    // Create new session
    prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        token: sessionId,
        ipAddress: clientIp,
        userAgent,
        deviceInfo: generateDeviceFingerprint(req),
        expiresAt
      }
    })
  ]);

  // Generate JWT and CSRF token
  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      sessionId,
      iat: Math.floor(Date.now() / 1000)
    },
    SECRET,
    {
      expiresIn: `${SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS}h`,
      issuer: SECURITY_CONFIG.JWT_ISSUER,
      audience: SECURITY_CONFIG.JWT_AUDIENCE
    }
  );

  const csrfToken = generateCSRFToken();
  csrfTokens.set(csrfToken, {
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY_MS
  });

  // Set cookie
  res.cookie('token', token, getSecureCookieOptions(
    isProduction,
    SECURITY_CONFIG.SESSION_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000
  ));

  // Log success (fire and forget)
  prisma.loginAttempt.create({
    data: {
      username,
      ipAddress: clientIp,
      userAgent,
      success: true
    }
  }).catch(() => { });

  // Clear username rate limit on success
  usernameAttempts.delete(username);

  // Fetch user permissions
  const permissions = await prisma.userGamePermission.findMany({
    where: { userId: user.id },
    include: { gameType: true }
  });

  return ApiResponse.success(res, {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: permissions.map(p => ({
        gameType: p.gameType.code,
        canCreate: p.canCreate,
        canManage: p.canManage
      }))
    },
    csrfToken
  });
}));

// 1.5 CHECK SESSION API - Optimized with single query
app.get('/api/auth/me', asyncHandler(async (req, res) => {
  const decoded = getUserFromRequest(req);
  if (!decoded) return res.json({ user: null });

  // Single query to validate session and get user data
  const sessionWithUser = await prisma.userSession.findFirst({
    where: {
      token: decoded.sessionId,
      isValid: true,
      expiresAt: { gt: new Date() },
      userId: decoded.id
    },
    include: {
      user: {
        select: { id: true, username: true, role: true, lockedUntil: true }
      }
    }
  });

  if (!sessionWithUser || !sessionWithUser.user) {
    return res.json({ user: null });
  }

  // Check if account is locked
  const lockoutStatus = checkAccountLockout(sessionWithUser.user);
  if (lockoutStatus.locked) {
    return res.json({ user: null });
  }

  // Fetch user permissions
  const permissions = await prisma.userGamePermission.findMany({
    where: { userId: sessionWithUser.user.id },
    include: { gameType: true }
  });

  return ApiResponse.success(res, {
    user: {
      id: sessionWithUser.user.id,
      role: sessionWithUser.user.role,
      username: sessionWithUser.user.username,
      permissions: permissions.map(p => ({
        gameType: p.gameType.code,
        canCreate: p.canCreate,
        canManage: p.canManage
      }))
    }
  });
}));

// LOGOUT API - Optimized single operation
app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const decoded = getUserFromRequest(req);

  if (decoded?.sessionId) {
    // Single operation to invalidate session
    await prisma.userSession.updateMany({
      where: { token: decoded.sessionId },
      data: { isValid: false }
    });
  }

  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/'
  });

  return ApiResponse.success(res, { message: 'Logged out successfully' });
}));

// LOGOUT ALL SESSIONS API - Optimized
app.post('/api/auth/logout-all', requireAuth, asyncHandler(async (req, res) => {
  const result = await prisma.userSession.updateMany({
    where: {
      userId: req.user.id,
      isValid: true
    },
    data: { isValid: false }
  });

  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/'
  });

  return ApiResponse.success(res, {
    message: 'Logged out from all devices',
    sessionsInvalidated: result.count
  });
}));

// ============ UNIFIED AUTH API (v2) ============
// New simplified authentication endpoints with role-based routing

// POST /api/v2/auth/login - Unified login for all user types
app.post('/api/v2/auth/login', authLimiter, asyncHandler(async (req, res) => {
  await authController.handleLogin(req, res);
}));

// GET /api/v2/auth/me - Check current session with dashboard data
app.get('/api/v2/auth/me', asyncHandler(async (req, res) => {
  await authController.checkSession(req, res);
}));

// POST /api/v2/auth/logout - Unified logout
app.post('/api/v2/auth/logout', asyncHandler(async (req, res) => {
  await authController.handleLogout(req, res);
}));

// GET /api/gametypes - Get all game types (for admin user management)
app.get('/api/gametypes', requireAuth, asyncHandler(async (req, res) => {
  const gameTypes = await prisma.gameType.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      maxPlayers: true,
      minPlayers: true,
      isActive: true
    }
  });
  res.json(gameTypes);
}));

// GET /api/v2/games - Get available games for current user
app.get('/api/v2/games', requireAuth, asyncHandler(async (req, res) => {
  const user = req.user;

  let games;
  if (user.role === 'ADMIN') {
    // Admin can see all active games with full permissions
    const allGames = await prisma.gameType.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        icon: true,
        color: true,
        maxPlayers: true,
        minPlayers: true,
        status: true
      }
    });
    
    games = allGames.map(game => ({
      ...game,
      canCreate: true,
      canManage: true
    }));
  } else if (user.role === 'OPERATOR') {
    // Get games user has permission to manage
    const userWithPermissions = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        allowedGames: {
          include: { gameType: true }
        }
      }
    });

    games = userWithPermissions?.allowedGames.map(ag => ({
      id: ag.gameType.id,
      code: ag.gameType.code,
      name: ag.gameType.name,
      description: ag.gameType.description,
      icon: ag.gameType.icon,
      color: ag.gameType.color,
      maxPlayers: ag.gameType.maxPlayers,
      minPlayers: ag.gameType.minPlayers,
      canCreate: ag.canCreate,
      canManage: ag.canManage
    })) || [];
  } else {
    // Public games for guests/viewers
    games = await prisma.gameType.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        icon: true,
        color: true,
        maxPlayers: true,
        minPlayers: true,
        status: true
      }
    });
  }

  ApiResponse.success(res, { games });
}));

// GET /api/v2/sessions - Get sessions based on user role
app.get('/api/v2/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { role, id: userId } = req.user;

  let sessions;
  if (role === 'ADMIN') {
    // Admin sees all sessions (active and ended)
    sessions = await prisma.gameSession.findMany({
      include: {
        gameType: true,
        _count: { select: { players: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100 // Limit to recent 100 sessions for performance
    });
  } else if (role === 'OPERATOR') {
    // Operator sees their own sessions (all)
    sessions = await prisma.gameSession.findMany({
      where: { createdBy: userId },
      include: {
        gameType: true,
        _count: { select: { players: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
  } else {
    // Players see sessions they are part of
    const playerSessions = await prisma.player.findMany({
      where: { userId },
      include: {
        session: {
          include: {
            gameType: true,
            _count: { select: { players: true } }
          }
        }
      }
    });
    sessions = playerSessions.map(p => p.session);
  }

  ApiResponse.success(res, {
    sessions: sessions.map(s => ({
      id: s.id,
      name: s.name,
      gameType: s.gameType.name,
      gameCode: s.gameType.code,
      currentRound: s.currentRound,
      totalRounds: s.totalRounds,
      targetScore: s.targetScore,
      gameLimitType: s.gameLimitType,
      playerCount: s._count?.players || 0,
      isActive: s.isActive,
      status: s.status,
      createdAt: s.createdAt
    }))
  });
}));

// CSRF PROTECTION
// Get CSRF token (requires authentication)
app.get('/api/csrf-token', requireAuth, (req, res) => {
  const csrfToken = generateCSRFToken();
  csrfTokens.set(csrfToken, {
    userId: req.user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY_MS
  });
  res.json({ csrfToken });
});

// GET /api/sessions/:name/players - Get players for a session
app.get('/api/sessions/:name/players', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.params;
  
  try {
    // Find session
    const session = await prisma.gameSession.findUnique({
      where: { name: decodeURIComponent(name) },
      include: {
        players: true
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Check if user has access (admin, operator who created it, or player in session)
    const hasAccess = 
      req.user.role === 'ADMIN' ||
      session.createdBy === req.user.id ||
      session.players.some(p => p.userId === req.user.id);
    
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({
      success: true,
      players: session.players.map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seatPosition,
        sessionBalance: p.sessionBalance,
        score: p.score,
        status: p.status || 'PLAYING'
      }))
    });
  } catch (error) {
    console.error('Error fetching session players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
}));

// CSRF validation middleware for state-changing operations
const requireCSRF = (req, res, next) => {
  const csrfToken = req.headers['x-csrf-token'] || req.body?._csrf;

  if (!csrfToken) {
    return res.status(403).json({ error: 'CSRF token required' });
  }

  const tokenData = csrfTokens.get(csrfToken);

  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  if (Date.now() > tokenData.expiresAt) {
    csrfTokens.delete(csrfToken);
    return res.status(403).json({ error: 'CSRF token expired' });
  }

  // Verify token belongs to current user
  if (tokenData.userId !== req.user.id) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }

  // Delete token after use (one-time use)
  csrfTokens.delete(csrfToken);

  next();
};

// PROFILE API - Get user profile
app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, role: true, createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PROFILE API - Update username (CSRF protected)
app.put('/api/user/profile', requireAuth, requireCSRF, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    // Check if username is already taken
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser && existingUser.id !== req.user.id) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { username },
      select: { id: true, username: true, role: true, createdAt: true }
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PROFILE API - Change password (CSRF protected)
app.put('/api/user/password', requireAuth, requireCSRF, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate new password strength
    const passwordCheck = validatePasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: 'Password does not meet security requirements',
        details: passwordCheck.errors
      });
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and track change
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        password: hashedPassword,
        lastPasswordChange: new Date()
      }
    });

    // Invalidate all other sessions (force re-login on other devices)
    await prisma.userSession.updateMany({
      where: {
        userId: req.user.id,
        isValid: true,
        token: { not: req.user.sessionId } // Keep current session
      },
      data: { isValid: false }
    });

    res.json({
      success: true,
      message: 'Password updated successfully. Other sessions have been logged out for security.'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// 2. SAVE GAME API (requires authentication)
app.post('/api/games/hand', requireAuth, async (req, res) => {
  const { winner, pot, logs, netChanges, sessionName } = req.body;

  try {
    const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Save Hand History (stringify logs for SQLite)
    await prisma.gameHand.create({
      data: {
        winner: winner.name,
        potSize: pot,
        logs: JSON.stringify(logs || []),
        sessionId: session.id
      }
    });

    // Update Player Balances and Link to Session
    for (const [playerId, change] of Object.entries(netChanges)) {
      const pid = parseInt(playerId);
      await prisma.player.upsert({
        where: { id: pid },
        update: {
          sessionBalance: { increment: change },
          sessionId: session.id
        },
        create: {
          id: pid,
          name: "Unknown",
          sessionBalance: change,
          sessionId: session.id
        }
      });
    }

    // Get current round from session - GameManager handles round increment
    const currentRound = session.currentRound;
    const isSessionOver = currentRound >= session.totalRounds;

    if (isSessionOver) {
      await prisma.gameSession.update({
        where: { id: session.id },
        data: { isActive: false }
      });
      // We will emit session_ended AFTER the hand summary is shown or handled, 
      // but to be safe we emit it here too so the state is consistent.
      io.to(sessionName).emit('session_ended', { reason: 'MAX_ROUNDS_REACHED' });
      if (activeSessions.has(sessionName)) {
        activeSessions.delete(sessionName);
      }
    }

    // Broadcast update
    io.to(sessionName).emit('game_update', {
      type: 'HAND_COMPLETE',
      winner,
      pot,
      netChanges,
      currentRound,
      isSessionOver
    });
    res.json({ success: true, currentRound, isSessionOver });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to save hand" });
  }
});

// 2.5 ACTIVE SESSIONS API (For Landing Page)
app.get('/api/sessions/active', (req, res) => {
  const activeList = [];
  activeSessions.forEach((session, name) => {
    activeList.push({
      name: name,
      currentRound: session.currentRound,
      totalRounds: session.totalRounds,
      playerCount: session.gameState?.players?.length || 0
    });
  });
  res.json(activeList);
});

// 3. ADMIN API (requires admin authentication)
app.get('/api/admin/sessions', requireOperator, async (req, res) => {
  // Filter sessions: Admins see all, Operators see only their own
  const whereClause = req.user.role === 'ADMIN' ? {} : { createdBy: req.user.id };
  
  const sessions = await prisma.gameSession.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { hands: true } } }
  });
  res.json(sessions);
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, createdAt: true }
  });
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, allowedGames } = req.body;

    // Validate Role
    const validRoles = ['ADMIN', 'OPERATOR', 'PLAYER', 'GUEST'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Validate password strength
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        error: "Password does not meet security requirements",
        details: passwordCheck.errors
      });
    }

    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashed,
        role,
        lastPasswordChange: new Date()
      }
    });

    // If creating a PLAYER, also create a Player entry linked to this user
    if (role === 'PLAYER') {
      await prisma.player.create({
        data: {
          name: username,
          userId: user.id
        }
      });
    }

    // A1 FIX: If creating an OPERATOR, automatically grant permissions for all active games
    if (role === 'OPERATOR') {
      try {
        const allGames = await prisma.gameType.findMany({
          where: { isActive: true }
        });
        
        if (allGames.length > 0) {
          await prisma.userGamePermission.createMany({
            data: allGames.map(game => ({
              userId: user.id,
              gameTypeId: game.id,
              canCreate: true,
              canManage: true
            }))
          });
          console.log(`[DEBUG] Auto-granted permissions for ${allGames.length} games to operator ${user.username}`);
        }
      } catch (permError) {
        console.error('[ERROR] Failed to create game permissions:', permError);
      }
    }

    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: "User likely exists or invalid data" });
  }
});

// GET user's game permissions
app.get('/api/admin/users/:id/permissions', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const permissions = await prisma.userGamePermission.findMany({
      where: { userId: parseInt(id) }
    });
    res.json(permissions);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

// UPDATE user's game permissions
app.put('/api/admin/users/:id/permissions', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body; // Array of { gameTypeId, canCreate, canManage }
    
    // Delete existing permissions
    await prisma.userGamePermission.deleteMany({
      where: { userId: parseInt(id) }
    });
    
    // Create new permissions
    if (permissions && permissions.length > 0) {
      await prisma.userGamePermission.createMany({
        data: permissions.map(p => ({
          userId: parseInt(id),
          gameTypeId: p.gameTypeId,
          canCreate: p.canCreate || false,
          canManage: p.canManage || false
        }))
      });
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Prevent deleting self
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }

    // Delete associated player first if exists
    await prisma.player.deleteMany({ where: { userId: parseInt(id) } });
    await prisma.user.delete({ where: { id: parseInt(id) } });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

app.post('/api/admin/sessions/:name/end', requireOperator, async (req, res) => {
  const { name } = req.params;
  try {
    const session = await prisma.gameSession.findUnique({ where: { name } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Operators can only end their own sessions, Admins can end any
    if (req.user.role !== 'ADMIN' && session.createdBy !== req.user.id) {
      return res.status(403).json({ error: "Access denied. You can only end your own sessions." });
    }

    await prisma.gameSession.update({
      where: { id: session.id },
      data: { isActive: false }
    });

    if (activeSessions.has(name)) {
      activeSessions.delete(name);
    }
    
    clearSnapshot(name).catch(() => {});

    io.to(name).emit('session_ended', { reason: 'ADMIN_ENDED' });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Get session details with hands
app.get('/api/admin/sessions/:name', requireOperator, async (req, res) => {
  const { name } = req.params;
  try {
    const session = await prisma.gameSession.findUnique({
      where: { name },
      include: {
        hands: {
          orderBy: { createdAt: 'desc' }
        },
        players: true
      }
    });

    if (!session) return res.status(404).json({ error: "Session not found" });

    // Operators can only view their own sessions, Admins can view all
    if (req.user.role !== 'ADMIN' && session.createdBy !== req.user.id) {
      return res.status(403).json({ error: "Access denied. You can only view your own sessions." });
    }

    res.json(session);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch session details" });
  }
});

// Delete session and all related data
app.delete('/api/admin/sessions/:name', requireAdmin, async (req, res) => {
  const { name } = req.params;
  try {
    const session = await prisma.gameSession.findUnique({ where: { name } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Delete related data first
    await prisma.playerAddRequest.deleteMany({ where: { sessionId: session.id } });
    await prisma.gameHand.deleteMany({ where: { sessionId: session.id } });
    await prisma.player.deleteMany({ where: { sessionId: session.id } });

    // Delete the session
    await prisma.gameSession.delete({ where: { id: session.id } });

    // Remove from active sessions if present
    if (activeSessions.has(name)) {
      activeSessions.delete(name);
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

// --- PLAYER ADDITION REQUESTS API ---

// Operator: Request to add new players to a session
app.post('/api/sessions/:name/player-requests', requireOperator, async (req, res) => {
  const { name } = req.params;
  const { playerNames } = req.body;

  try {
    const session = await prisma.gameSession.findUnique({ where: { name } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.isActive) return res.status(400).json({ error: "Session is not active" });

    // Get current player count
    const currentPlayerCount = await prisma.player.count({ where: { sessionId: session.id } });
    const pendingRequests = await prisma.playerAddRequest.count({
      where: { sessionId: session.id, status: 'PENDING' }
    });

    // Check if adding these players would exceed max (let's say 17 max players)
    if (currentPlayerCount + pendingRequests + playerNames.length > 17) {
      return res.status(400).json({ error: "Too many players. Maximum 17 players allowed per session." });
    }

    // Create requests for each player
    const requests = await Promise.all(
      playerNames.map(playerName =>
        prisma.playerAddRequest.create({
          data: {
            sessionId: session.id,
            playerName: playerName.trim(),
            requestedBy: req.user.role
          }
        })
      )
    );

    res.json({ success: true, requests, message: `Requested to add ${playerNames.length} player(s)` });
  } catch (e) {
    console.error('[ERROR] Failed to create player requests:', e);
    res.status(500).json({ error: "Failed to create player requests" });
  }
});

// Get all pending player add requests (for Admin)
app.get('/api/admin/player-requests', requireAdmin, async (req, res) => {
  try {
    const requests = await prisma.playerAddRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        session: {
          select: { name: true, currentRound: true, totalRounds: true, isActive: true }
        }
      },
      orderBy: { requestedAt: 'desc' }
    });
    res.json(requests);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch player requests" });
  }
});

// Get player add requests for a specific session (for Operator)
app.get('/api/sessions/:name/player-requests', requireOperator, async (req, res) => {
  const { name } = req.params;
  try {
    const session = await prisma.gameSession.findUnique({ where: { name } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const requests = await prisma.playerAddRequest.findMany({
      where: { sessionId: session.id },
      orderBy: { requestedAt: 'desc' }
    });
    res.json(requests);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch player requests" });
  }
});

// Admin: Approve or decline player add requests
app.post('/api/admin/player-requests/:id/resolve', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;

  try {
    const request = await prisma.playerAddRequest.findUnique({
      where: { id: parseInt(id) },
      include: { session: true }
    });

    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== 'PENDING') return res.status(400).json({ error: "Request already resolved" });

    // Update request status
    await prisma.playerAddRequest.update({
      where: { id: parseInt(id) },
      data: {
        status: approved ? 'APPROVED' : 'DECLINED',
        resolvedAt: new Date(),
        resolvedBy: req.user.role
      }
    });

    if (approved) {
      // Get current max seat position
      const currentPlayers = await prisma.player.findMany({
        where: { sessionId: request.sessionId },
        orderBy: { seatPosition: 'desc' },
        take: 1
      });

      const nextSeat = currentPlayers.length > 0 ? (currentPlayers[0].seatPosition || 0) + 1 : 1;

      // Create the new player
      const newPlayer = await prisma.player.create({
        data: {
          name: request.playerName,
          sessionId: request.sessionId,
          seatPosition: nextSeat,
          sessionBalance: 0
        }
      });

      // Add player to active GameManager if session is active
      const manager = activeSessions.get(request.session.name);
      if (manager) {
        const newPlayerData = {
          id: newPlayer.id,
          name: newPlayer.name,
          seat: newPlayer.seatPosition,
          sessionBalance: 0,
          status: 'BLIND',
          folded: false,
          invested: 0
        };
        
        manager.gameState.players.push(newPlayerData);

        // E1 FIX: Synchronize gamePlayers with players
        // If game is in SETUP phase, also add to gamePlayers for next round
        // If game is ACTIVE, player will be included in next round via startRound
        if (manager.gameState.phase === 'SETUP') {
          // In SETUP phase, new player should be part of next hand
          // Only add if not already in gamePlayers (safety check)
          const existsInGamePlayers = manager.gameState.gamePlayers.some(p => p.id === newPlayer.id);
          if (!existsInGamePlayers) {
            manager.gameState.gamePlayers.push({
              ...newPlayerData,
              hand: null // Will be dealt when round starts
            });
          }
        }

        // Emit update to all clients
        io.to(request.session.name).emit('game_update', manager.getPublicState());
      }

      res.json({
        success: true,
        message: `Player "${request.playerName}" added to session`,
        player: newPlayer
      });
    } else {
      res.json({
        success: true,
        message: `Request to add "${request.playerName}" declined`
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to resolve player request" });
  }
});

// Admin: Bulk approve player requests for a session
app.post('/api/admin/sessions/:name/approve-all-players', requireAdmin, async (req, res) => {
  const { name } = req.params;

  try {
    const session = await prisma.gameSession.findUnique({ where: { name } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Get all pending requests
    const pendingRequests = await prisma.playerAddRequest.findMany({
      where: { sessionId: session.id, status: 'PENDING' }
    });

    if (pendingRequests.length === 0) {
      return res.json({ success: true, message: "No pending requests" });
    }

    // Get current max seat position
    const currentPlayers = await prisma.player.findMany({
      where: { sessionId: session.id },
      orderBy: { seatPosition: 'desc' },
      take: 1
    });

    let nextSeat = currentPlayers.length > 0 ? (currentPlayers[0].seatPosition || 0) + 1 : 1;
    const addedPlayers = [];

    // Process each request
    for (const request of pendingRequests) {
      // Update request
      await prisma.playerAddRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          resolvedAt: new Date(),
          resolvedBy: req.user.role
        }
      });

      // Create player
      const newPlayer = await prisma.player.create({
        data: {
          name: request.playerName,
          sessionId: session.id,
          seatPosition: nextSeat++,
          sessionBalance: 0
        }
      });

      addedPlayers.push(newPlayer);
    }

    // Update GameManager
    const manager = activeSessions.get(name);
    if (manager) {
      for (const player of addedPlayers) {
        const newPlayerData = {
          id: player.id,
          name: player.name,
          seat: player.seatPosition,
          sessionBalance: 0,
          status: 'BLIND',
          folded: false,
          invested: 0
        };
        
        manager.gameState.players.push(newPlayerData);
        
        // E1 FIX: Synchronize gamePlayers with players in SETUP phase
        if (manager.gameState.phase === 'SETUP') {
          const existsInGamePlayers = manager.gameState.gamePlayers.some(p => p.id === player.id);
          if (!existsInGamePlayers) {
            manager.gameState.gamePlayers.push({
              ...newPlayerData,
              hand: null
            });
          }
        }
      }
      io.to(name).emit('game_update', manager.getPublicState());
    }

    res.json({
      success: true,
      message: `Added ${addedPlayers.length} player(s) to session`,
      players: addedPlayers
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to approve players" });
  }
});

app.post('/api/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { name, totalRounds, targetScore, gameLimitType, players, gameCode } = req.body; // players: [{ userId, seat, name }]

  // 1. Validate Input
  if (!name) {
    return res.status(400).json({ error: "Session name is required" });
  }

  // Validate game-specific configuration
  const limitType = gameLimitType || 'rounds';
  if (limitType === 'rounds' && !totalRounds) {
    return res.status(400).json({ error: "Total rounds is required for this game type" });
  }
  if (limitType === 'points' && !targetScore) {
    return res.status(400).json({ error: "Target score is required for this game type" });
  }

  // 2. Get Game Type
  const gameTypeCode = gameCode || 'teen-patti';
  const gameType = await prisma.gameType.findUnique({
    where: { code: gameTypeCode }
  });

  if (!gameType) {
    return res.status(400).json({ error: "Invalid game type" });
  }

  // C2 FIX: Check if user has permission to create sessions for this game
  // Admins can always create, others need explicit permission
  if (req.user.role !== 'ADMIN') {
    const userPermission = await prisma.userGamePermission.findFirst({
      where: {
        userId: req.user.id,
        gameTypeId: gameType.id,
        canCreate: true
      }
    });
    
    if (!userPermission) {
      return res.status(403).json({ 
        error: "Access denied", 
        message: "You don't have permission to create sessions for this game" 
      });
    }
  }

  // 3. Create or Join Session
  let session = await prisma.gameSession.findUnique({ where: { name } });

  if (session) {
    if (!session.isActive) {
      return res.status(400).json({ error: "Session name already used and finished." });
    }
    // If active, return existing (rejoin) - logic continues below
  } else {
    // Create new session with game-specific configuration
    const sessionData = {
      name,
      isActive: true,
      gameTypeId: gameType.id,
      createdBy: req.user.id,
      status: 'waiting',
      isPublic: false,
      gameLimitType: limitType
    };

    // Add game-specific configuration
    if (limitType === 'points') {
      sessionData.targetScore = parseInt(targetScore);
    } else {
      sessionData.totalRounds = parseInt(totalRounds);
    }

    session = await prisma.gameSession.create({
      data: sessionData
    });

    // Create Initial Players if provided
    if (players && players.length > 0) {
      for (const p of players) {
        // D1 FIX: Always create new player record for each session
        // Removed upsert to allow same user to be player in multiple sessions
        if (p.userId) {
          // Registered user player
          await prisma.player.create({
            data: { 
              name: p.name, 
              userId: p.userId, 
              sessionId: session.id, 
              seatPosition: p.seat, 
              sessionBalance: 0 
            }
          });
        } else {
          // Guest player - create new entry
          await prisma.player.create({
            data: {
              name: p.name,
              sessionId: session.id,
              seatPosition: p.seat,
              sessionBalance: 0
            }
          });
        }
      }
    }
  }

  res.json({ success: true, session });
  
  // Auto-initialize GameManager after session creation
  // This ensures the game is ready immediately without waiting for operator to join via socket
  try {
    await initializeGameManager(session.name);
    console.log(`[DEBUG] Auto-initialized GameManager for session: ${session.name}`);
  } catch (error) {
    console.error(`[ERROR] Failed to auto-initialize GameManager for ${session.name}:`, error);
    // Don't fail the request - game can still be initialized lazily when operator joins
  }
}));

// 5. REAL-TIME SOCKET

// Note: In-memory state Maps (activeSessions, sessionLoaders, etc.) are declared at top of file

// --- GAME MANAGER INITIALIZATION ---
async function initializeGameManager(sessionName) {
  // Check if already initialized
  if (activeSessions.has(sessionName)) {
    console.log(`[DEBUG] GameManager already exists for ${sessionName}`);
    return activeSessions.get(sessionName);
  }
  
  // Check if currently loading
  if (sessionLoaders.has(sessionName)) {
    console.log(`[DEBUG] GameManager ${sessionName} is loading, waiting...`);
    return await sessionLoaders.get(sessionName);
  }
  
  // Start loading process
  const loadPromise = (async () => {
    try {
      console.log(`[DEBUG] Auto-initializing GameManager for ${sessionName}`);
      const dbSession = await prisma.gameSession.findUnique({ where: { name: sessionName } });
      
      if (!dbSession || !dbSession.isActive) {
        console.log(`[DEBUG] Session ${sessionName} not found or inactive`);
        return null;
      }
      
      const dbPlayers = await prisma.player.findMany({ where: { sessionId: dbSession.id } });
      const initialPlayers = dbPlayers.map(p => ({
        id: p.id,
        name: p.name,
        sessionBalance: p.sessionBalance,
        seat: p.seatPosition
      }));
      
      // Get game type to determine which GameManager to use
      const gameType = await prisma.gameType.findUnique({ 
        where: { id: dbSession.gameTypeId },
        select: { code: true }
      });
      
      // Prepare game configuration
      const gameConfig = {
        sessionId: dbSession.id,
        sessionName: sessionName,
        gameLimitType: dbSession.gameLimitType || 'rounds',
        totalRounds: dbSession.totalRounds,
        targetScore: dbSession.targetScore
      };
      
      let newManager;
      if (gameType?.code === 'rummy' && RummyGameManager) {
        newManager = new RummyGameManager(gameConfig);
      } else {
        // Default to Teen Patti (or stub GameManager)
        newManager = TeenPattiGameManager ? new TeenPattiGameManager(gameConfig) : new (require('./game/GameManager'))(gameConfig);
      }
      
      newManager.currentRound = dbSession.currentRound || 1;
      newManager.setPlayers(initialPlayers);
      
      // Restore snapshot if available (crash recovery)
      if (dbSession.snapshot) {
        try {
          const snapshot = typeof dbSession.snapshot === 'string' ? JSON.parse(dbSession.snapshot) : dbSession.snapshot;
          if (snapshot.gameState && snapshot.gameState.phase !== 'SETUP' && snapshot.gameState.phase !== 'ENDED') {
            newManager.restoreSnapshot(snapshot);
            console.log(`[DEBUG] Restored active game state for ${sessionName} from snapshot (phase: ${snapshot.gameState.phase})`);
          }
        } catch (e) {
          console.error(`[ERROR] Failed to restore snapshot for ${sessionName}:`, e);
        }
      }
      
      // Hook up events
      newManager.on('state_change', (state) => {
        io.to(sessionName).emit('game_update', state);
        
        // Also emit to approved viewers
        const approved = approvedViewers.get(sessionName);
        if (approved) {
          approved.forEach(socketId => {
            const viewerSocket = io.sockets.sockets.get(socketId);
            if (viewerSocket) {
              viewerSocket.emit('game_update', state);
            }
          });
        }
        
        // Persist snapshot for crash recovery
        saveSnapshot(sessionName, newManager);
      });
      
      newManager.on('hand_complete', async (summary) => {
        try {
          const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
          if (session) {
            await prisma.gameHand.create({
              data: {
                winner: summary.winner?.name || 'N/A',
                potSize: summary.pot,
                logs: JSON.stringify(summary.logs || []),
                sessionId: session.id
              }
            });
            
            if (summary.netChanges) {
              for (const [playerId, change] of Object.entries(summary.netChanges)) {
                const pid = parseInt(playerId);
                await prisma.player.update({
                  where: { id: pid },
                  data: { sessionBalance: { increment: change } }
                });
              }
            }
            
            await prisma.gameSession.update({
              where: { id: session.id },
              data: { currentRound: summary.currentRound }
            });
          }
        } catch (e) {
          console.error('[ERROR] Failed to save hand persistence:', e);
        }
        
        io.to(sessionName).emit('game_update', { type: 'HAND_COMPLETE', ...summary });
        
        // Clear snapshot since hand is complete
        clearSnapshot(sessionName);
      });
      
      // Rummy uses round_complete instead of hand_complete
      newManager.on('round_complete', async (summary) => {
        try {
          const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
          if (session) {
            await prisma.gameHand.create({
              data: {
                winner: summary.winner?.name || 'N/A',
                potSize: 0,
                logs: JSON.stringify(summary.leaderboard || []),
                sessionId: session.id
              }
            });
            
            // Update player scores - Rummy uses 'score' field
            if (summary.leaderboard) {
              for (const player of summary.leaderboard) {
                await prisma.player.updateMany({
                  where: { 
                    sessionId: session.id,
                    name: player.name
                  },
                  data: { 
                    score: player.totalScore 
                  }
                });
              }
            }
            
            await prisma.gameSession.update({
              where: { id: session.id },
              data: { currentRound: summary.round }
            });
          }
        } catch (e) {
          console.error('[ERROR] Failed to save round persistence:', e);
        }
        
        io.to(sessionName).emit('game_update', { type: 'ROUND_COMPLETE', ...summary });
        
        // Clear snapshot since round is complete
        clearSnapshot(sessionName);
      });
      
      newManager.on('session_ended', async (data) => {
        try {
          await prisma.gameSession.update({
            where: { name: sessionName },
            data: { isActive: false }
          });
          console.log(`[DEBUG] Session ${sessionName} marked as complete`);
        } catch (e) {
          console.error('[ERROR] Failed to mark session as complete:', e);
        }
        
        io.to(sessionName).emit('session_ended', data);
        activeSessions.delete(sessionName);
        
        // Clear snapshot since session has ended
        clearSnapshot(sessionName);
      });
      
      activeSessions.set(sessionName, newManager);
      console.log(`[DEBUG] GameManager initialized for ${sessionName} with ${initialPlayers.length} players`);
      return newManager;
      
    } catch (e) {
      console.error(`[ERROR] Failed to initialize GameManager for ${sessionName}:`, e);
      throw e;
    } finally {
      sessionLoaders.delete(sessionName);
    }
  })();
  
  sessionLoaders.set(sessionName, loadPromise);
  return await loadPromise;
}

// --- SOCKET MIDDLEWARE ---
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  let token = null;

  // 1. Try to get token from cookies
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    token = cookies.token;
  }

  // 2. Try to get token from socket auth (Client sends it here)
  if (!token && socket.handshake.auth && socket.handshake.auth.token) {
    token = socket.handshake.auth.token;
  }

  // 3. Try to get token from Authorization header
  if (!token && socket.handshake.headers.authorization) {
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
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

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} (Role: ${socket.user.role})`);

  const isOperatorOrAdmin = () => socket.user.role === 'OPERATOR' || socket.user.role === 'ADMIN';

  // Create/Join Session (Operator)
  socket.on('join_session', async ({ sessionName, role }) => {
    console.log('[DEBUG] join_session called:', sessionName, 'role:', role, 'socket user:', socket.user.role);
    socket.join(sessionName);

    // Operator Logic: Initialize Manager
    if (role === 'OPERATOR') {
      if (!isOperatorOrAdmin()) {
        console.log('[DEBUG] Operator join unauthorized');
        return socket.emit('error_message', "Unauthorized");
      }

      let manager = activeSessions.get(sessionName);

      if (!manager) {
        try {
          manager = await initializeGameManager(sessionName);
        } catch (e) {
          console.error(`[ERROR] Failed to initialize session ${sessionName}:`, e);
          return socket.emit('error_message', "Failed to join session");
        }
        
        if (!manager) {
          // Session is ended or not found - fetch final state from DB
          try {
            const dbSession = await prisma.gameSession.findUnique({ where: { name: sessionName } });
            if (dbSession) {
              const endedSessionPlayers = await prisma.player.findMany({ where: { sessionId: dbSession.id } });
              const finalPlayersList = endedSessionPlayers.map(p => ({
                id: p.id,
                name: p.name,
                sessionBalance: p.sessionBalance,
                score: p.score || p.sessionBalance,
                seat: p.seatPosition,
                status: p.status || 'PLAYING'
              }));
              return socket.emit('session_ended', { 
                reason: 'SESSION_COMPLETE',
                finalRound: dbSession.currentRound,
                totalRounds: dbSession.totalRounds,
                finalPlayers: finalPlayersList
              });
            }
          } catch (e) {
            console.error('[ERROR] Failed to load ended session:', e);
          }
          return socket.emit('error_message', "Session not found or inactive");
        }
      }

      // Send current state
      if (manager) {
        const state = manager.getPublicState();
        console.log('[DEBUG] Sending game_update to operator. Phase:', state.phase, 'Players:', state.players?.length || 0, 'gamePlayers:', state.gamePlayers?.length || 0);
        socket.emit('game_update', state);
        
        // D1 FIX: Send pending viewer requests to reconnected operators
        const pendingRequests = pendingViewerRequests.get(sessionName);
        if (pendingRequests && pendingRequests.length > 0) {
          console.log(`[DEBUG] Sending ${pendingRequests.length} pending viewer requests to reconnected operator`);
          pendingRequests.forEach(req => {
            socket.emit('viewer_requested', {
              socketId: req.socketId,
              name: req.name
            });
          });
        }
      }
    } else {
      // Viewer/Player Join
      const manager = activeSessions.get(sessionName);
      if (manager) {
        socket.emit('game_update', manager.getPublicState());
      }
    }
  });

  // Game Actions - Refactored with clean dispatch
  socket.on('game_action', (action) => {
    if (!action || typeof action !== 'object') {
      return socket.emit('error_message', 'Invalid action format');
    }
    
    console.log('[DEBUG] game_action received:', action.type, 'for session:', action.sessionName);
    
    if (!isOperatorOrAdmin()) {
      console.log('[DEBUG] Unauthorized - user role:', socket.user.role);
      return socket.emit('error_message', 'Unauthorized');
    }

    const manager = activeSessions.get(action.sessionName);
    if (!manager) {
      return socket.emit('error_message', 'Session not found or inactive');
    }

    // Special actions that bypass generic handleAction
    const specialHandlers = {
      'START_ROUND': () => manager.startRound(),
      'START_GAME': () => manager.startRound(),
      'NEXT_ROUND': () => manager.startRound(),
      'END_SESSION': () => {
        manager.endSession();
        activeSessions.delete(action.sessionName);
        return { success: true };
      },
      'CANCEL_SIDE_SHOW': () => manager.cancelSideShow 
        ? manager.cancelSideShow() 
        : { success: false, error: 'Not supported' },
      'CANCEL_SHOW': () => manager.cancelShow 
        ? manager.cancelShow() 
        : { success: false, error: 'Not supported' },
      'DRAW_CARD': () => {
        if (!manager.drawCard) return { success: false, error: 'Not supported' };
        const result = manager.drawCard(socket.user.id, action.source);
        if (result.success) {
          const handData = manager.getPlayerHand(socket.user.id);
          socket.emit('player_hand', handData);
        }
        return result;
      },
      'REMOVE_PLAYER': () => {
        if (!manager.removePlayer) return { success: false, error: 'Not supported' };
        return manager.removePlayer(action.playerId);
      }
    };

    let result;
    if (specialHandlers[action.type]) {
      result = specialHandlers[action.type]();
    } else if (manager.handleAction) {
      // Normalize legacy actions
      const normalizedAction = { ...action };
      if (action.type === 'RECORD_DROP' && !action.dropType) {
        normalizedAction.dropType = 'initial';
      }
      console.log(`[DEBUG] Passing ${action.type} to manager.handleAction`);
      result = manager.handleAction(normalizedAction);
    } else {
      result = { success: false, error: 'Game manager does not support this action' };
    }

    if (result && !result.success) {
      socket.emit('error_message', result.error);
    }
  });

  // End Session
  socket.on('end_session', async ({ sessionName }) => {
    if (!isOperatorOrAdmin()) {
      socket.emit('error_message', 'Unauthorized to end session');
      return;
    }

    try {
      // Find session in database
      const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
      if (!session) {
        socket.emit('error_message', 'Session not found');
        return;
      }

      // Update session to inactive
      await prisma.gameSession.update({
        where: { id: session.id },
        data: { isActive: false }
      });

      // Get final round info from manager if available
      const manager = activeSessions.get(sessionName);
      let finalRound = session.currentRound;
      let totalRounds = session.totalRounds;
      let finalPlayers = [];

      if (manager) {
        finalRound = manager.currentRound;
        totalRounds = manager.totalRounds;
        // Get players from manager
        const state = manager.getPublicState();
        finalPlayers = state.players || state.gamePlayers || [];
        // Call endSession if available (for proper cleanup)
        if (manager.endSession) {
          manager.endSession();
        }
        activeSessions.delete(sessionName);
        clearSnapshot(sessionName).catch(() => {});
      } else {
        // Fetch players from database if manager not in memory
        const dbPlayers = await prisma.player.findMany({ where: { sessionId: session.id } });
        finalPlayers = dbPlayers.map(p => ({
          id: p.id,
          name: p.name,
          sessionBalance: p.sessionBalance,
          score: p.score,
          status: p.status
        }));
      }

      // Notify all clients
      io.to(sessionName).emit('session_ended', {
        reason: 'OPERATOR_ENDED',
        finalRound,
        totalRounds,
        finalPlayers
      });

      // Confirm to operator
      socket.emit('session_ended_confirm', { success: true, message: 'Session ended successfully' });

      console.log(`[DEBUG] Session ${sessionName} manually ended by operator`);
    } catch (e) {
      console.error('[ERROR] Failed to end session:', e);
      socket.emit('error_message', 'Failed to end session: ' + e.message);
    }
  });

  // Viewer Access Control
  socket.on('request_access', async ({ sessionName, name }) => {
    if (!sessionName || !name) {
      socket.emit('error_message', 'Session name and viewer name are required');
      return;
    }

    // Rate limiting per socket
    const now = Date.now();
    const limit = viewerRequestLimits.get(socket.id);
    if (limit) {
      if (now > limit.resetTime) {
        viewerRequestLimits.set(socket.id, { count: 1, resetTime: now + VIEWER_REQUEST_WINDOW_MS });
      } else if (limit.count >= VIEWER_REQUEST_MAX) {
        socket.emit('error_message', 'Too many access requests. Please wait a minute.');
        return;
      } else {
        limit.count++;
      }
    } else {
      viewerRequestLimits.set(socket.id, { count: 1, resetTime: now + VIEWER_REQUEST_WINDOW_MS });
    }

    // D2 FIX: Validate that session exists and is active
    try {
      const session = await prisma.gameSession.findUnique({ 
        where: { name: sessionName },
        select: { id: true, isActive: true }
      });
      
      if (!session) {
        socket.emit('error_message', 'Session not found');
        return;
      }
      
      if (!session.isActive) {
        socket.emit('error_message', 'This session has ended');
        return;
      }
    } catch (e) {
      console.error('[ERROR] Failed to validate session:', e);
      socket.emit('error_message', 'Failed to validate session');
      return;
    }

    // D3 FIX: Validate viewer name (server-side)
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      socket.emit('error_message', 'Name must be at least 2 characters');
      return;
    }
    if (trimmedName.length > 30) {
      socket.emit('error_message', 'Name must be less than 30 characters');
      return;
    }
    // Basic profanity/reserved word filter
    const inappropriateWords = ['admin', 'operator', 'system', 'moderator', 'support'];
    const lowerName = trimmedName.toLowerCase();
    if (inappropriateWords.some(word => lowerName.includes(word))) {
      socket.emit('error_message', 'Please choose a different name');
      return;
    }

    // Initialize pending requests for this session
    if (!pendingViewerRequests.has(sessionName)) {
      pendingViewerRequests.set(sessionName, []);
    }

    // Check if already requested
    const requests = pendingViewerRequests.get(sessionName);
    if (requests.find(r => r.socketId === socket.id)) {
      return; // Already requested
    }

    // Add to pending requests
    requests.push({
      socketId: socket.id,
      name: trimmedName,
      timestamp: Date.now()
    });

    // Notify operators in the session
    socket.to(sessionName).emit('viewer_requested', {
      socketId: socket.id,
      name: trimmedName
    });

    console.log(`[DEBUG] Viewer ${trimmedName} (${socket.id}) requested access to ${sessionName}`);
  });

  socket.on('resolve_access', ({ sessionName, viewerId, approved }) => {
    if (!isOperatorOrAdmin()) {
      socket.emit('error_message', 'Only operators can approve viewers');
      return;
    }

    // Find and remove from pending
    const requests = pendingViewerRequests.get(sessionName) || [];
    const requestIndex = requests.findIndex(r => r.socketId === viewerId);
    
    if (requestIndex === -1) {
      socket.emit('error_message', 'Viewer request not found');
      return;
    }

    const request = requests[requestIndex];
    requests.splice(requestIndex, 1);

    // Get viewer socket
    const viewerSocket = io.sockets.sockets.get(viewerId);
    
    if (approved) {
      // Add to approved viewers
      if (!approvedViewers.has(sessionName)) {
        approvedViewers.set(sessionName, new Set());
      }
      approvedViewers.get(sessionName).add(viewerId);

      // Notify viewer
      if (viewerSocket) {
        viewerSocket.emit('access_granted');
        viewerSocket.join(sessionName);
      }

      // Send current game state to viewer
      const manager = activeSessions.get(sessionName);
      if (manager && viewerSocket) {
        viewerSocket.emit('game_update', manager.getPublicState());
      }

      console.log(`[DEBUG] Viewer ${request.name} (${viewerId}) approved for ${sessionName}`);
    } else {
      // Notify viewer of denial
      if (viewerSocket) {
        viewerSocket.emit('access_denied');
      }
      console.log(`[DEBUG] Viewer ${request.name} (${viewerId}) denied for ${sessionName}`);
    }
  });

  const viewerRequestLimits = new Map(); // socketId -> { count, resetTime }
  const VIEWER_REQUEST_WINDOW_MS = 60 * 1000; // 1 minute
  const VIEWER_REQUEST_MAX = 3; // max 3 requests per minute

  // ... existing code ...

  socket.on('leave_session', ({ sessionName }) => {
    if (sessionName) {
      socket.leave(sessionName);
      console.log(`[DEBUG] Socket ${socket.id} left session ${sessionName}`);
    }
  });

  socket.on('disconnect', () => {
    // Cleanup viewer requests
    for (const [sessionName, requests] of pendingViewerRequests.entries()) {
      const index = requests.findIndex(r => r.socketId === socket.id);
      if (index !== -1) {
        requests.splice(index, 1);
        if (requests.length === 0) {
          pendingViewerRequests.delete(sessionName);
        }
      }
    }

    // Cleanup approved viewers
    for (const [sessionName, viewers] of approvedViewers.entries()) {
      if (viewers.has(socket.id)) {
        viewers.delete(socket.id);
        if (viewers.size === 0) {
          approvedViewers.delete(sessionName);
        }
      }
    }

    // Cleanup rate limit tracking
    viewerRequestLimits.delete(socket.id);
  });
});

// API 404 handler - must be before static files
app.use('/api/{*path}', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../client/dist')));

  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Initialize database before starting server
async function initializeDatabase() {
  try {
    console.log('[INFO] Checking database initialization...');
    
    // Check if we can connect to the database
    await prisma.$connect();
    console.log('[INFO] Database connection successful');
    
    // Try to query the database to see if tables exist
    try {
      await prisma.$queryRaw`SELECT 1 FROM "User" LIMIT 1`;
      console.log('[INFO] Database tables already exist');
    } catch (e) {
      if (e.code === 'P2021' || e.message.includes('does not exist')) {
        console.log('[INFO] Database tables not found. Running db push...');
        const { execSync } = require('child_process');
        execSync('npx prisma db push --accept-data-loss', {
          cwd: __dirname,
          stdio: 'inherit'
        });
        console.log('[INFO] Database schema pushed successfully');
        
        // Seed the database using execSync to avoid process.exit() issues
        console.log('[INFO] Seeding database...');
        execSync('node scripts/seed-games.js', {
          cwd: __dirname,
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'production' }
        });
        console.log('[INFO] Database seeded successfully');
      } else {
        throw e;
      }
    }
    
    // Check if schema is up to date (new columns exist)
    try {
      await prisma.gameSession.findFirst({ select: { snapshot: true, lastActivityAt: true } });
      console.log('[INFO] Database schema is up to date');
    } catch (schemaError) {
      if (schemaError.code === 'P2022' || schemaError.code === 'P2021') {
        console.log('[INFO] Database schema needs update for new columns. Running db push...');
        const { execSync } = require('child_process');
        execSync('npx prisma db push --accept-data-loss', {
          cwd: __dirname,
          stdio: 'inherit'
        });
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

// Start server after database initialization
initializeDatabase().then(() => {
  const httpServer = server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("NODE_ENV:", process.env.NODE_ENV);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    httpServer.close(() => {
      console.log('Server closed');
      prisma.$disconnect().then(() => {
        console.log('Database disconnected');
        process.exit(0);
      });
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    httpServer.close(() => {
      console.log('Server closed');
      prisma.$disconnect().then(() => {
        console.log('Database disconnected');
        process.exit(0);
      });
    });
  });
}).catch(err => {
  console.error('[ERROR] Failed to start server:', err);
  process.exit(1);
});

// Export app instance and other components for use in other modules
module.exports = { prisma, app, server, io };
