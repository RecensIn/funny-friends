const jwt = require('jsonwebtoken');

let TeenPattiGameManager = null;
let RummyGameManager = null;
try { TeenPattiGameManager = require('../game/GameManager'); } catch (e) { /* optional */ }
try { RummyGameManager = require('../game/rummy/GameManager'); } catch (e) { /* optional */ }

const prisma = require('../db');
const SECRET = process.env.JWT_SECRET;
const isDev = process.env.NODE_ENV !== 'production';

async function saveSnapshot(sessionName, manager) {
  if (!manager || !manager.getSnapshot) return;
  try {
    const snapshot = manager.getSnapshot();
    await prisma.gameSession.update({
      where: { name: sessionName },
      data: { snapshot: snapshot, lastActivityAt: new Date() }
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

async function initializeGameManager(sessionName, activeSessions, sessionLoaders, io, approvedViewers) {
  if (activeSessions.has(sessionName)) return activeSessions.get(sessionName);
  if (sessionLoaders.has(sessionName)) return await sessionLoaders.get(sessionName);

  const loadPromise = (async () => {
    try {
      const dbSession = await prisma.gameSession.findUnique({ where: { name: sessionName } });
      if (!dbSession || !dbSession.isActive) return null;

      const dbPlayers = await prisma.player.findMany({ where: { sessionId: dbSession.id } });
      const initialPlayers = dbPlayers.map(p => ({
        id: p.id, name: p.name, sessionBalance: p.sessionBalance, seat: p.seatPosition
      }));

      const gameType = await prisma.gameType.findUnique({ where: { id: dbSession.gameTypeId }, select: { code: true } });

      const gameConfig = {
        sessionId: dbSession.id, sessionName: sessionName,
        gameLimitType: dbSession.gameLimitType || 'rounds',
        totalRounds: dbSession.totalRounds, targetScore: dbSession.targetScore
      };

      let newManager;
      if (gameType?.code === 'rummy' && RummyGameManager) {
        newManager = new RummyGameManager(gameConfig);
      } else {
        newManager = TeenPattiGameManager ? new TeenPattiGameManager(gameConfig) : new (require('../game/GameManager'))(gameConfig);
      }

      newManager.currentRound = dbSession.currentRound || 1;
      newManager.setPlayers(initialPlayers);

      if (dbSession.snapshot) {
        try {
          const snapshot = typeof dbSession.snapshot === 'string' ? JSON.parse(dbSession.snapshot) : dbSession.snapshot;
          if (snapshot.gameState && snapshot.gameState.phase !== 'SETUP' && snapshot.gameState.phase !== 'ENDED') {
            newManager.restoreSnapshot(snapshot);
          }
        } catch (e) { console.error(`[ERROR] Failed to restore snapshot for ${sessionName}:`, e); }
      }

      newManager.on('state_change', (state) => {
        io.to(sessionName).emit('game_update', state);
        const approved = approvedViewers.get(sessionName);
        if (approved) {
          approved.forEach(socketId => {
            const viewerSocket = io.sockets.sockets.get(socketId);
            if (viewerSocket) viewerSocket.emit('game_update', state);
          });
        }
        saveSnapshot(sessionName, newManager).catch(err => console.error(`[ERROR] Snapshot save failed for ${sessionName}:`, err.message));
      });

      newManager.on('hand_complete', async (summary) => {
        try {
          await prisma.$transaction(async (tx) => {
            const session = await tx.gameSession.findUnique({ where: { name: sessionName } });
            if (!session) return;
            await tx.gameHand.create({
              data: {
                winner: summary.winner?.name || 'N/A', potSize: summary.pot,
                logs: { round: summary.currentRound, netChanges: summary.netChanges, standings: summary.playerStandings },
                sessionId: session.id
              }
            });
            if (summary.netChanges) {
              for (const [playerId, change] of Object.entries(summary.netChanges)) {
                await tx.player.update({ where: { id: parseInt(playerId) }, data: { sessionBalance: { increment: change } } });
              }
            }
            await tx.gameSession.update({ where: { id: session.id }, data: { currentRound: summary.currentRound + 1 } });
          });
        } catch (e) { console.error('[ERROR] Failed to save hand persistence:', e); }
        io.to(sessionName).emit('game_update', { type: 'HAND_COMPLETE', ...summary });
        clearSnapshot(sessionName).catch(() => {});
      });

      newManager.on('round_complete', async (summary) => {
        try {
          await prisma.$transaction(async (tx) => {
            const session = await tx.gameSession.findUnique({ where: { name: sessionName } });
            if (!session) return;
            await tx.gameHand.create({
              data: {
                winner: summary.winner?.name || 'N/A', potSize: 0,
                logs: { round: summary.round, leaderboard: summary.leaderboard, eliminated: summary.eliminated },
                sessionId: session.id
              }
            });
            if (summary.leaderboard) {
              for (const player of summary.leaderboard) {
                await tx.player.updateMany({
                  where: { sessionId: session.id, name: player.name },
                  data: { score: player.totalScore }
                });
              }
            }
            await tx.gameSession.update({ where: { id: session.id }, data: { currentRound: summary.round + 1 } });
          });
        } catch (e) { console.error('[ERROR] Failed to save round persistence:', e); }
        io.to(sessionName).emit('game_update', { type: 'ROUND_COMPLETE', ...summary });
        clearSnapshot(sessionName).catch(() => {});
      });

      newManager.on('session_ended', async (data) => {
        try {
          await prisma.gameSession.update({ where: { name: sessionName }, data: { isActive: false } });
        } catch (e) { console.error('[ERROR] Failed to mark session as complete:', e); }
        io.to(sessionName).emit('session_ended', data);
        activeSessions.delete(sessionName);
        clearSnapshot(sessionName).catch(() => {});
      });

      activeSessions.set(sessionName, newManager);
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

function register(io, { activeSessions, sessionLoaders, pendingViewerRequests, approvedViewers }) {
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
    if (!token && socket.handshake.headers.authorization?.startsWith('Bearer '))
      token = socket.handshake.headers.authorization.substring(7);
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

  const viewerRequestLimits = new Map();
  const VIEWER_REQUEST_WINDOW_MS = 60 * 1000;
  const VIEWER_REQUEST_MAX = 3;

  io.on('connection', (socket) => {
    const isOperatorOrAdmin = () => socket.user.role === 'OPERATOR' || socket.user.role === 'ADMIN';

    socket.on('join_session', async ({ sessionName, role }) => {
      socket.join(sessionName);
      if (role === 'OPERATOR') {
        if (!isOperatorOrAdmin()) return socket.emit('error_message', 'Unauthorized');
        let manager = activeSessions.get(sessionName);
        if (!manager) {
          try { manager = await initializeGameManager(sessionName, activeSessions, sessionLoaders, io, approvedViewers); }
          catch (e) { return socket.emit('error_message', 'Failed to join session'); }
          if (!manager) {
            try {
              const dbSession = await prisma.gameSession.findUnique({ where: { name: sessionName } });
              if (dbSession) {
                const endedSessionPlayers = await prisma.player.findMany({ where: { sessionId: dbSession.id } });
                return socket.emit('session_ended', {
                  reason: 'SESSION_COMPLETE', finalRound: dbSession.currentRound, totalRounds: dbSession.totalRounds,
                  finalPlayers: endedSessionPlayers.map(p => ({ id: p.id, name: p.name, sessionBalance: p.sessionBalance, score: p.score || p.sessionBalance, seat: p.seatPosition, status: p.status || 'PLAYING' }))
                });
              }
            } catch (e) { /* ignore */ }
            return socket.emit('error_message', 'Session not found or inactive');
          }
        }
        if (manager) {
          socket.emit('game_update', manager.getPublicState());
          const pending = pendingViewerRequests.get(sessionName);
          if (pending?.length > 0) pending.forEach(req => socket.emit('viewer_requested', { socketId: req.socketId, name: req.name }));
        }
      } else {
        const manager = activeSessions.get(sessionName);
        if (manager) socket.emit('game_update', manager.getPublicState());
      }
    });

    socket.on('game_action', (action) => {
      if (!action || typeof action !== 'object') return socket.emit('error_message', 'Invalid action format');
      if (!isOperatorOrAdmin()) return socket.emit('error_message', 'Unauthorized');
      const manager = activeSessions.get(action.sessionName);
      if (!manager) return socket.emit('error_message', 'Session not found or inactive');

      const specialHandlers = {
        'START_ROUND': () => manager.startRound(),
        'START_GAME': () => manager.startRound(),
        'NEXT_ROUND': () => manager.startRound(),
        'END_SESSION': () => { manager.endSession(); activeSessions.delete(action.sessionName); return { success: true }; },
        'CANCEL_SIDE_SHOW': () => manager.cancelSideShow ? manager.cancelSideShow() : { success: false, error: 'Not supported' },
        'CANCEL_SHOW': () => manager.cancelShow ? manager.cancelShow() : { success: false, error: 'Not supported' },
        'DRAW_CARD': () => {
          if (!manager.drawCard) return { success: false, error: 'Not supported' };
          const result = manager.drawCard(socket.user.id, action.source);
          if (result.success) socket.emit('player_hand', manager.getPlayerHand(socket.user.id));
          return result;
        },
        'REMOVE_PLAYER': () => manager.removePlayer ? manager.removePlayer(action.playerId) : { success: false, error: 'Not supported' }
      };

      let result;
      if (specialHandlers[action.type]) {
        result = specialHandlers[action.type]();
      } else if (manager.handleAction) {
        const normalizedAction = { ...action };
        if (action.type === 'RECORD_DROP' && !action.dropType) normalizedAction.dropType = 'initial';
        result = manager.handleAction(normalizedAction);
      } else {
        result = { success: false, error: 'Game manager does not support this action' };
      }
      if (result && !result.success) socket.emit('error_message', result.error);
    });

    socket.on('end_session', async ({ sessionName }) => {
      if (!isOperatorOrAdmin()) return socket.emit('error_message', 'Unauthorized to end session');
      try {
        const session = await prisma.gameSession.findUnique({ where: { name: sessionName } });
        if (!session) return socket.emit('error_message', 'Session not found');
        await prisma.gameSession.update({ where: { id: session.id }, data: { isActive: false } });
        const manager = activeSessions.get(sessionName);
        if (manager) {
          manager.endSession();
        } else {
          const dbPlayers = await prisma.player.findMany({ where: { sessionId: session.id } });
          const finalPlayers = dbPlayers.map(p => ({ id: p.id, name: p.name, sessionBalance: p.sessionBalance, score: p.score, status: p.status }));
          const overallWinner = finalPlayers.length > 0 ? [...finalPlayers].sort((a, b) => (b.sessionBalance || 0) - (a.sessionBalance || 0))[0] : null;
          io.to(sessionName).emit('session_ended', { reason: 'OPERATOR_ENDED', finalRound: session.currentRound, totalRounds: session.totalRounds, finalPlayers, overallWinner, roundHistory: [] });
        }
        socket.emit('session_ended_confirm', { success: true, message: 'Session ended successfully' });
      } catch (e) { socket.emit('error_message', 'Failed to end session: ' + e.message); }
    });

    socket.on('request_access', async ({ sessionName, name }) => {
      if (!sessionName || !name) return socket.emit('error_message', 'Session name and viewer name are required');
      const now = Date.now();
      const limit = viewerRequestLimits.get(socket.id);
      if (limit) {
        if (now > limit.resetTime) viewerRequestLimits.set(socket.id, { count: 1, resetTime: now + VIEWER_REQUEST_WINDOW_MS });
        else if (limit.count >= VIEWER_REQUEST_MAX) return socket.emit('error_message', 'Too many access requests. Please wait a minute.');
        else limit.count++;
      } else {
        viewerRequestLimits.set(socket.id, { count: 1, resetTime: now + VIEWER_REQUEST_WINDOW_MS });
      }
      try {
        const session = await prisma.gameSession.findUnique({ where: { name: sessionName }, select: { id: true, isActive: true } });
        if (!session) return socket.emit('error_message', 'Session not found');
        if (!session.isActive) return socket.emit('error_message', 'This session has ended');
      } catch (e) { return socket.emit('error_message', 'Failed to validate session'); }
      const trimmedName = name.trim();
      if (trimmedName.length < 2) return socket.emit('error_message', 'Name must be at least 2 characters');
      if (trimmedName.length > 30) return socket.emit('error_message', 'Name must be less than 30 characters');
      const lowerName = trimmedName.toLowerCase();
      if (['admin', 'operator', 'system', 'moderator', 'support'].some(w => lowerName.includes(w)))
        return socket.emit('error_message', 'Please choose a different name');

      if (!pendingViewerRequests.has(sessionName)) pendingViewerRequests.set(sessionName, []);
      const requests = pendingViewerRequests.get(sessionName);
      if (requests.find(r => r.socketId === socket.id)) return;
      requests.push({ socketId: socket.id, name: trimmedName, timestamp: Date.now() });
      socket.to(sessionName).emit('viewer_requested', { socketId: socket.id, name: trimmedName });
    });

    socket.on('resolve_access', ({ sessionName, viewerId, approved }) => {
      if (!isOperatorOrAdmin()) return socket.emit('error_message', 'Only operators can approve viewers');
      const requests = pendingViewerRequests.get(sessionName) || [];
      const idx = requests.findIndex(r => r.socketId === viewerId);
      if (idx === -1) return socket.emit('error_message', 'Viewer request not found');
      const request = requests[idx];
      requests.splice(idx, 1);
      const viewerSocket = io.sockets.sockets.get(viewerId);
      if (approved) {
        if (!approvedViewers.has(sessionName)) approvedViewers.set(sessionName, new Set());
        approvedViewers.get(sessionName).add(viewerId);
        if (viewerSocket) { viewerSocket.emit('access_granted'); viewerSocket.join(sessionName); }
        const manager = activeSessions.get(sessionName);
        if (manager && viewerSocket) viewerSocket.emit('game_update', manager.getPublicState());
      } else {
        if (viewerSocket) viewerSocket.emit('access_denied');
      }
    });

    socket.on('leave_session', ({ sessionName }) => {
      if (sessionName) socket.leave(sessionName);
    });

    socket.on('disconnect', () => {
      for (const [sessionName, requests] of pendingViewerRequests.entries()) {
        const idx = requests.findIndex(r => r.socketId === socket.id);
        if (idx !== -1) { requests.splice(idx, 1); if (requests.length === 0) pendingViewerRequests.delete(sessionName); }
      }
      for (const [sessionName, viewers] of approvedViewers.entries()) {
        if (viewers.has(socket.id)) { viewers.delete(socket.id); if (viewers.size === 0) approvedViewers.delete(sessionName); }
      }
      viewerRequestLimits.delete(socket.id);
    });
  });
}

module.exports = { register, initializeGameManager, saveSnapshot, clearSnapshot };