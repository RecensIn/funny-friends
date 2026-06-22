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

// Expose shared state to routes via app.locals
app.locals.activeSessions = activeSessions;
app.locals.sessionLoaders = sessionLoaders;
app.locals.pendingViewerRequests = pendingViewerRequests;
app.locals.approvedViewers = approvedViewers;
app.locals.io = null; // Set after io is created

const isDev = process.env.NODE_ENV !== 'production';

// --- SNAPSHOT PERSISTENCE (used by orphan cleanup) ---
// Socket module has its own saveSnapshot/clearSnapshot for runtime use
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

    for (const [name, manager] of activeSessions.entries()) {
      const isInactive = !manager.isActive || manager.gameState?.phase === 'ENDED';
      if (isInactive) {
        isDev && console.log(`[CLEANUP] Removing inactive manager from memory: ${name}`);
        activeSessions.delete(name);
        clearSnapshot(name).catch(() => {});
        continue;
      }

      const dbSession = await prisma.gameSession.findUnique({
        where: { name },
        select: { isActive: false, lastActivityAt: true }
      });
      if (!dbSession || !dbSession.isActive) {
        isDev && console.log(`[CLEANUP] Removing stale session from memory: ${name}`);
        activeSessions.delete(name);
        clearSnapshot(name).catch(() => {});
      } else if (dbSession.lastActivityAt) {
        const lastActivity = new Date(dbSession.lastActivityAt).getTime();
        if (now - lastActivity > STALE_SESSION_MS) {
          isDev && console.log(`[CLEANUP] Session ${name} stale for ${Math.round((now - lastActivity) / 60000)}min, cleaning up`);
          activeSessions.delete(name);
          clearSnapshot(name).catch(() => {});
        }
      }
    }

    for (const [sessionName, requests] of pendingViewerRequests.entries()) {
      const filtered = requests.filter(r => now - r.timestamp < STALE_VIEWER_MS);
      if (filtered.length === 0) {
        pendingViewerRequests.delete(sessionName);
      } else if (filtered.length !== requests.length) {
        pendingViewerRequests.set(sessionName, filtered);
      }
    }

    for (const sessionName of approvedViewers.keys()) {
      if (!activeSessions.has(sessionName)) {
        approvedViewers.delete(sessionName);
      }
    }
  } catch (e) {
    console.error('[ERROR] Orphaned session cleanup failed:', e);
  }
}, 15 * 60 * 1000); // Run every 15 minutes

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
  skipSuccessfulRequests: true,
});

app.use(limiter);
// authLimiter is applied to login routes in the auth route module
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV === 'production' && origin.includes('onrender.com')) {
      return callback(null, true);
    }
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

app.locals.io = io;

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

// --- MOUNT ROUTE MODULES ---
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

// --- SOCKET.IO ---
const { register: registerSocketHandlers } = require('./socket');
registerSocketHandlers(io, { activeSessions, sessionLoaders, pendingViewerRequests, approvedViewers });

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
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;

// Initialize database before starting server
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
          execSync('npx prisma migrate deploy', {
            cwd: __dirname,
            stdio: 'inherit'
          });
        } else {
          execSync('npx prisma db push', {
            cwd: __dirname,
            stdio: 'inherit'
          });
        }

        console.log('[INFO] Database schema created successfully');
        console.log('[INFO] Seeding database...');
        execSync('node scripts/seed-games.js', {
          cwd: __dirname,
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: process.env.NODE_ENV }
        });
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
          execSync('npx prisma migrate deploy', {
            cwd: __dirname,
            stdio: 'inherit'
          });
        } else {
          execSync('npx prisma db push', {
            cwd: __dirname,
            stdio: 'inherit'
          });
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
