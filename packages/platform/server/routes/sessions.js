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