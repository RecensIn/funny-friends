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
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [showSessionSummary, setShowSessionSummary] = useState(false);

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
        setRoundSummaryData({
          winner: state.winner, pot: state.pot, netChanges: state.netChanges,
          currentRound: state.currentRound, isSessionOver: state.isSessionOver,
          eliminated: state.eliminated, remainingPlayers: state.remainingPlayers
        });
        if (!state.isSessionOver) { setShowRoundSummary(true); }
        if (state.players) setPlayers(state.players);
      } else if (state.type === 'ROUND_COMPLETE') {
        setRoundSummaryData({
          winner: state.winner, leaderboard: state.leaderboard, round: state.round,
          isSessionOver: state.isSessionOver, finalWinner: state.finalWinner,
          eliminated: state.eliminated, remainingPlayers: state.remainingPlayers
        });
        if (!state.isSessionOver) { setShowRoundSummary(true); }
        if (state.leaderboard) setPlayers(state.leaderboard);
      } else if (state.type === 'SESSION_ENDED' || state.reason) {
        setSessionSummaryData(state);
        setShowSessionSummary(true);
        if (state.finalPlayers) { setPlayers(state.finalPlayers); setGamePlayers(state.finalPlayers); }
        if (state.leaderboard) setPlayers(state.leaderboard);
        setGameState({ phase: 'ENDED', currentRound: state.finalRound, totalRounds: state.totalRounds, players: state.finalPlayers || state.leaderboard || state.players || [], overallWinner: state.overallWinner || state.finalWinner, roundHistory: state.roundHistory || [], ...state });
        setSessionStatus('ended');
      } else {
        setGameState(state);
        if (state.players?.length > 0) setPlayers(state.players);
        if (state.gamePlayers) setGamePlayers(state.gamePlayers);
        if (state.phase) setSessionStatus(state.phase.toLowerCase());
        if (state.recoveredFromCrash) toast.info('Session was recovered from server restart. Hands were reset for security. You may continue or start a new round.');
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
      setShowSessionSummary(true);
      setSessionStatus('ended');
      setGameState(prev => ({ ...prev, phase: 'ENDED', currentRound: data.finalRound, totalRounds: data.totalRounds, players: data.finalPlayers || data.leaderboard || data.players || [], overallWinner: data.overallWinner || data.finalWinner, roundHistory: data.roundHistory || [], ...data }));
      if (data.finalPlayers) { setPlayers(data.finalPlayers); setGamePlayers(data.finalPlayers); }
      if (data.leaderboard) setPlayers(data.leaderboard);
    };

    const onError = (message) => toast.error(message);
    const onSessionEndedConfirm = (data) => { if (data.success) toast.success(data.message); };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('game_update', onGameUpdate);
    socket.on('hand_update', onHandUpdate);
    socket.on('viewer_requested', onViewerRequested);
    socket.on('session_ended', onSessionEnded);
    socket.on('session_ended_confirm', onSessionEndedConfirm);
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
      socket.off('session_ended_confirm', onSessionEndedConfirm);
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

  const resolveViewerRequest = useCallback((socketId, approved) => {
    socket.emit('resolve_access', {
      sessionName: decodeURIComponent(sessionName),
      viewerId: socketId,
      approved
    });
    setViewerRequests(prev => prev.filter(r => r.socketId !== socketId));
  }, [socket, sessionName]);

  return {
    session, gameState, setGameState, players, setPlayers, gamePlayers, setGamePlayers,
    loading, error, isConnected, sessionStatus,
    viewerRequests, setViewerRequests,
    roundSummaryData, setRoundSummaryData,
    sessionSummaryData, setSessionSummaryData,
    showRoundSummary, setShowRoundSummary,
    showSessionSummary, setShowSessionSummary,
    playerHand, setPlayerHand, sendGameAction, resolveViewerRequest
  };
}
