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