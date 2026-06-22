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