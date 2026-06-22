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
    const dbPlayers = await prisma.player.findMany({ where: { sessionId: session.id } });
    const finalPlayers = dbPlayers.map(p => ({
      id: p.id, name: p.name, sessionBalance: p.sessionBalance, score: p.score, status: p.status
    }));
    const sorted = [...finalPlayers].sort((a, b) => (b.sessionBalance || 0) - (a.sessionBalance || 0));
    io.to(name).emit('session_ended', {
      reason: 'ADMIN_ENDED',
      finalRound: session.currentRound,
      totalRounds: session.totalRounds,
      overallWinner: sorted[0] || null,
      finalWinner: sorted[0] || null,
      finalPlayers,
      leaderboard: finalPlayers,
      roundHistory: []
    });
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