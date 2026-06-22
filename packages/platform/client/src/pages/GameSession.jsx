import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Users, Play, Square, RotateCcw, 
  Clock, DollarSign, AlertCircle, Wifi, WifiOff,
  Eye, Trash2, ShieldAlert, Trophy, Edit3, X,
  Check, UserPlus, ArrowDown, ArrowUp, Star
} from 'lucide-react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useGameSocket } from '../hooks/useGameSocket';

const GameSession = () => {
  const { user } = useAuth();
  const { sessionName } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  
  const isOperatorOrAdmin = user?.role === 'OPERATOR' || user?.role === 'ADMIN';
  
  const {
    session, gameState, setGameState, players, setPlayers, gamePlayers, setGamePlayers,
    loading, error, isConnected, sessionStatus, viewerRequests, setViewerRequests,
    roundSummaryData, setRoundSummaryData, sessionSummaryData, setSessionSummaryData,
    showRoundSummary, setShowRoundSummary, showSessionSummary, setShowSessionSummary,
    playerHand, setPlayerHand, sendGameAction, resolveViewerRequest
  } = useGameSocket({ sessionName, user, isOperatorOrAdmin });
  
  const [showSideShowSelection, setShowSideShowSelection] = useState(false);
  const [showShowSelection, setShowShowSelection] = useState(false);
  const [sideShowConfirm, setSideShowConfirm] = useState(null);
  const [localShowRequest, setLocalShowRequest] = useState(null);
  const [newPlayerNames, setNewPlayerNames] = useState('');
  const [showPlayerRequestModal, setShowPlayerRequestModal] = useState(false);
  const [playerPoints, setPlayerPoints] = useState({});

  const sideShowRequest = gameState?.sideShowRequest || null;
  const showRequest = gameState?.showRequest || null;

  const isRummy = session?.gameCode === 'rummy';

  const handleStartGame = () => {
    sendGameAction('START_GAME');
  };

  const handleEndGame = () => {
    if (confirm('Are you sure you want to end this session?')) {
      sendGameAction('END_SESSION');
    }
  };

  const handleNextRound = () => {
    const isSessionOver = roundSummaryData?.isSessionOver;
    
    setShowRoundSummary(false);
    setRoundSummaryData(null);
    
    if (isSessionOver) {
      navigate('/operator/sessions');
    } else {
      sendGameAction('START_GAME');
    }
  };

  // Teen Patti Actions
  const handleFold = () => sendGameAction('FOLD');
  const handleSeen = () => sendGameAction('SEEN');
  const handleBet = (isDouble = false) => sendGameAction('BET', { isDouble });
  const handleCustomBid = () => {
    const amount = prompt(`Enter custom bid (Min ${gameState?.currentStake || 20}):`, gameState?.currentStake || 20);
    if (amount) sendGameAction('BET', { amount: parseInt(amount) });
  };
  const handleSideShow = () => setShowSideShowSelection(true);
  const handleSideShowSelect = (targetId) => {
    sendGameAction('SIDE_SHOW_REQUEST', { targetId });
    setShowSideShowSelection(false);
  };
  const handleShow = () => {
    const remaining = gamePlayers.filter(p => !p.folded);
    const blindPlayers = remaining.filter(p => p.status === 'BLIND');
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    
    if (activePlayer?.status === 'SEEN' && blindPlayers.length > 0 && blindPlayers.length <= 2) {
      setLocalShowRequest({ requester: activePlayer, blindPlayers });
      setShowShowSelection(true);
    } else if (remaining.length === 2) {
      sendGameAction('SHOW');
    } else {
      toast.info('Force Show only allowed when 1 or 2 blind players remain');
    }
  };
  const handleShowSelect = (targetId) => {
    sendGameAction('SHOW', { targetId });
    setShowShowSelection(false);
    setShowRequest(null);
  };

  // Rummy Ledger Actions
  const handleRecordInitialDrop = () => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    if (!activePlayer) {
      toast.error('No active player');
      return;
    }
    sendGameAction('RECORD_INITIAL_DROP', { playerId: activePlayer.id });
    toast.success(`${activePlayer.name} - Initial Drop (20 points)`);
  };

  const handleRecordMiddleDrop = () => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    if (!activePlayer) {
      toast.error('No active player');
      return;
    }
    sendGameAction('RECORD_MIDDLE_DROP', { playerId: activePlayer.id });
    toast.success(`${activePlayer.name} - Middle Drop (40 points)`);
  };

  const handleRecordValidShow = () => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    if (!activePlayer) {
      toast.error('No active player');
      return;
    }
    sendGameAction('RECORD_VALID_SHOW', { playerId: activePlayer.id });
    toast.success(`${activePlayer.name} - Valid Rummy Show (0 points)`);
  };

  const handleRecordWrongShow = () => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    if (!activePlayer) {
      toast.error('No active player');
      return;
    }
    sendGameAction('RECORD_WRONG_SHOW', { playerId: activePlayer.id });
    toast.success(`${activePlayer.name} - Wrong Show (80 points penalty)`);
  };

  const handleRecordCardPoints = (playerId, points) => {
    const pointsInt = parseInt(points);
    if (isNaN(pointsInt) || pointsInt < 0) {
      toast.error('Please enter valid points');
      return;
    }
    sendGameAction('RECORD_CARD_POINTS', { playerId, points: pointsInt });
    toast.success(`Recorded ${pointsInt} points`);
  };

  const handleEndRound = () => {
    sendGameAction('END_ROUND');
    toast.success('Round ended');
  };

  // Legacy Rummy Actions (kept for backward compatibility)
  const handleDrawCard = (source = 'draw') => {
    const activePlayer = gamePlayers[gameState?.activePlayerIndex];
    sendGameAction('DRAW_CARD', { source });
  };

  const handleDiscardCard = () => {
    if (!selectedCard) {
      toast.error('Please select a card to discard');
      return;
    }
    sendGameAction('DISCARD_CARD', { cardId: selectedCard });
    setSelectedCard(null);
  };

  const handleDeclareRummy = () => {
    sendGameAction('DECLARE_RUMMY');
    setShowDeclareModal(false);
  };

  const handleResolveDeclare = (winnerId) => {
    sendGameAction('RESOLVE_DECLARE', { winnerId });
    setShowResolveDeclareModal(false);
  };

  // Viewer actions — resolved through useGameSocket hook

  const handleRequestNewPlayers = async () => {
    const playerNames = newPlayerNames
      .split(/[\n,]/)
      .map(name => name.trim())
      .filter(name => name.length > 0);
    
    if (playerNames.length === 0) {
      toast.error('Please enter at least one player name');
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/api/sessions/${decodeURIComponent(sessionName)}/player-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerNames }),
        credentials: 'include'
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success(`Requested to add ${playerNames.length} player(s)`);
        setNewPlayerNames('');
        setShowPlayerRequestModal(false);
      } else {
        toast.error(data.error || 'Failed to submit request');
      }
    } catch (e) {
      toast.error('Error submitting request');
    }
  };

  const handleRemovePlayer = (playerId, playerName) => {
    if (!confirm(`Are you sure you want to remove ${playerName} from the game?`)) {
      return;
    }
    sendGameAction('REMOVE_PLAYER', { playerId });
    toast.info(`${playerName} has been removed from the game`);
  };

  const getPhaseBadgeColor = (phase) => {
    switch (phase?.toUpperCase()) {
      case 'ACTIVE':
      case 'PLAYING':
      case 'DRAW':
        return 'bg-green-500/20 text-green-400';
      case 'DISCARD':
        return 'bg-blue-500/20 text-blue-400';
      case 'SETUP':
      case 'WAITING':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'SHOWDOWN':
        return 'bg-purple-500/20 text-purple-400';
      case 'COMPLETED':
      case 'ENDED':
        return 'bg-slate-500/20 text-slate-400';
      default:
        return 'bg-yellow-500/20 text-yellow-400';
    }
  };

  const getCardDisplay = (card) => {
    const isJoker = card.isJoker || card.isWildJoker;
    const isRed = card.suit === '♥' || card.suit === '♦';
    
    if (isJoker) {
      return (
        <div className="w-12 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center text-2xl shadow-md">
          ★
        </div>
      );
    }
    
    return (
      <div className={`w-12 h-16 rounded-lg flex flex-col items-center justify-center text-xs font-bold shadow-md ${
        isRed ? 'bg-red-100 text-red-700' : 'bg-white text-slate-700'
      }`}>
        <span className="text-lg leading-none">{card.rank}</span>
        <span className="text-lg leading-none">{card.suit}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading session...</div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-red-400 flex items-center gap-2">
          <AlertCircle size={20} />
          {error}
        </div>
      </div>
    );
  }

  const currentPhase = gameState?.phase || sessionStatus?.toUpperCase() || 'SETUP';
  
  // Teen Patti specific
  const activePlayer = gamePlayers[gameState?.activePlayerIndex || 0];
  const isBlind = activePlayer?.status === 'BLIND';
  const currentStake = gameState?.currentStake || 20;
  const cost = isBlind ? currentStake / 2 : currentStake;
  const remainingPlayers = gamePlayers.filter(p => !p.folded);
  const blindPlayers = remainingPlayers.filter(p => p.status === 'BLIND');
  const canForceShow = activePlayer?.status === 'SEEN' && blindPlayers.length > 0 && blindPlayers.length <= 2;
  const canShow = remainingPlayers.length === 2;
  const seenPlayers = gamePlayers.filter(p => p.status === 'SEEN' && !p.folded && p.id !== activePlayer?.id);

  return (
    <div className="min-h-screen bg-slate-900 relative overflow-hidden">
      <div className={`absolute inset-0 ${isRummy ? 'bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-900 via-slate-900 to-black' : 'bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900 via-slate-900 to-black'} opacity-60`}></div>

      {/* Header */}
      <div className="relative z-10 bg-slate-900/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/operator/sessions')}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-slate-50">
                  {decodeURIComponent(sessionName)}
                </h1>
                <p className="text-slate-400 text-xs sm:text-sm">
                  {session?.gameName || session?.gameCode} • Round {gameState?.currentRound || 1} of {gameState?.totalRounds || session?.totalRounds || 10}
                  {isRummy && gameState?.targetScore && ` • Target: ${gameState.targetScore} pts`}
                  {!isRummy && gameState?.totalRounds && (
                    <span className="ml-2 text-yellow-400">
                      ({Math.max(0, (gameState?.totalRounds || 0) - (gameState?.currentRound || 0))} remaining)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Game Controls - End Round & End Session */}
              {currentPhase !== 'SETUP' && isOperatorOrAdmin && (
                <div className="flex items-center gap-2">
                  {isRummy && (
                    <button
                      onClick={handleEndRound}
                      className={`px-3 py-1.5 text-white text-sm font-bold rounded-lg flex items-center gap-1 ${
                        gameState?.roundCompletionPhase && gameState?.playersNeedingPoints === 0
                          ? 'bg-green-600 hover:bg-green-700 animate-pulse'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      <Trophy size={14} /> 
                      {gameState?.roundCompletionPhase 
                        ? `End Round ${gameState?.playersNeedingPoints > 0 ? `(${gameState.playersNeedingPoints} pending)` : '✓'}`
                        : 'End Round'
                      }
                    </button>
                  )}
                  <button
                    onClick={handleEndGame}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                    title="End the entire session"
                  >
                    <Square size={14} />
                    End Session
                  </button>
                </div>
              )}
              
              {/* Game Info Display */}
              {isRummy ? (
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <Star size={16} />
                  <span>Wild: {gameState?.wildJokerRank || '-'}</span>
                </div>
              ) : (
                <span className="text-xl font-bold text-yellow-500">
                  Pot: {gameState?.pot || 0}
                </span>
              )}
              
              {/* Connection Status */}
              {isConnected ? (
                <Wifi size={16} className="text-green-500" />
              ) : (
                <WifiOff size={16} className="text-red-500" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Current Turn Banner */}
      {currentPhase === 'ACTIVE' && activePlayer && !sideShowRequest && !showRequest && !isRummy && (
        <div className="bg-gradient-to-r from-yellow-600 to-amber-600 text-white px-4 py-2 text-center shadow-lg relative z-10">
          <div className="flex items-center justify-center gap-2">
            <span className="animate-pulse">●</span>
            <span className="font-bold">Current Turn:</span>
            <span className="text-xl font-black">{activePlayer.name}</span>
            <span className="text-sm opacity-80">({currentPhase})</span>
          </div>
        </div>
      )}
      
      {/* Rummy Round Completion Phase Banner */}
      {isRummy && gameState?.roundCompletionPhase && (
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-3 text-center shadow-lg relative z-10">
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="flex items-center gap-2">
              <span className="animate-pulse">●</span>
              <span className="font-bold text-lg">Round Completion Phase</span>
            </div>
            {gameState.playersNeedingPoints > 0 && (
              <div className="text-sm">
                Waiting for {gameState.playersNeedingPoints} player{gameState.playersNeedingPoints !== 1 ? 's' : ''} to add points
              </div>
            )}
            {gameState.playersNeedingPoints === 0 && (
              <div className="text-sm font-bold text-green-300">
                All points recorded! Click "End Round" to finish
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* SETUP PHASE */}
        {currentPhase === 'SETUP' && isOperatorOrAdmin && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-50 flex items-center gap-2">
                  <Users size={18} className="text-violet-400" />
                  Players ({players.length})
                </h2>
                <span className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-xs font-medium">
                  Round {gameState?.currentRound || 1}/{gameState?.totalRounds || session?.totalRounds || 10}
                </span>
              </div>
              
              {players.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-400 mb-2">No players yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {players.map((player, index) => (
                    <div 
                      key={player.id || index}
                      className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
                          {player.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-medium text-slate-50">{player.name}</div>
                          <div className="text-xs text-slate-400">Seat {player.seat || index + 1}</div>
                        </div>
                      </div>
                      {isOperatorOrAdmin && (
                        <button
                          onClick={() => handleRemovePlayer(player.id, player.name)}
                          className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-md transition-colors"
                          title="Remove player"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {players.length < 2 && (
                <div className="mt-4 text-center text-red-400 text-sm bg-red-500/10 p-2 rounded-lg">
                  Need at least 2 players to start
                </div>
              )}
            </div>

            {viewerRequests.length > 0 && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-50 mb-4 flex items-center gap-2">
                  <Eye size={18} className="text-blue-400" />
                  Access Requests
                </h2>
                <div className="space-y-2">
                  {viewerRequests.map((req) => (
                    <div key={req.socketId} className="flex items-center justify-between bg-slate-700/50 p-3 rounded-lg">
                      <span className="font-medium text-slate-50">{req.name}</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => resolveViewerRequest(req.socketId, true)}
                          className="p-1 px-3 bg-green-500/20 text-green-400 rounded-md text-sm font-medium hover:bg-green-500/30"
                        >
                          Accept
                        </button>
                        <button 
                          onClick={() => resolveViewerRequest(req.socketId, false)}
                          className="p-1 px-3 bg-red-500/20 text-red-400 rounded-md text-sm font-medium hover:bg-red-500/30"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleStartGame}
              disabled={players.length < 2}
              className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:from-green-500 hover:to-green-600 transition-all"
            >
              <Play size={20} />
              Start Round {gameState?.currentRound || 1}
            </button>
          </div>
        )}

        {/* ACTIVE GAME */}
        {currentPhase !== 'SETUP' && (
          <div className="space-y-6">

            {/* Players Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {gamePlayers.map((p, idx) => {
                const isActive = idx === gameState?.activePlayerIndex;
                
                if (isRummy) {
                  const isEliminated = p.status === 'ELIMINATED';
                  const currentPoints = playerPoints[p.id] || '';
                  
                  const handlePointsChange = (value) => {
                    setPlayerPoints(prev => ({ ...prev, [p.id]: value }));
                  };
                  
                  const handleRecordPoints = () => {
                    const points = parseInt(currentPoints);
                    if (isNaN(points) || points < 0) {
                      toast.error(`Please enter valid points for ${p.name}`);
                      return;
                    }
                    sendGameAction('RECORD_CARD_POINTS', { playerId: p.id, points });
                    setPlayerPoints(prev => ({ ...prev, [p.id]: '' }));
                    toast.success(`Recorded ${points} points for ${p.name}`);
                  };
                  
                  const setPredefinedPoints = (points) => {
                    setPlayerPoints(prev => ({ ...prev, [p.id]: points.toString() }));
                  };
                  
                  return (
                    <div 
                      key={p.id || idx} 
                      className={`relative p-4 rounded-2xl border-2 border-slate-700 bg-slate-800/50 transition-all ${
                        isEliminated ? 'opacity-50 grayscale' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex flex-col">
                          <span className="font-bold text-lg text-slate-100">{p.name}</span>
                          {isEliminated && <span className="text-xs text-red-400">ELIMINATED</span>}
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          p.score >= (gameState?.targetScore || 100) ? 'bg-red-500/30 text-red-400' : 'bg-green-500/30 text-green-400'
                        }`}>
                          {p.score} pts
                        </span>
                      </div>
                      
                      {/* Rummy Quick Actions - Set Points */}
                      {isOperatorOrAdmin && !isEliminated && currentPhase !== 'SETUP' && (
                        <div className="mt-3">
                          <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-bold">Actions</div>
                          <div className="grid grid-cols-4 gap-1">
                            <button
                              onClick={() => setPredefinedPoints(20)}
                              className={`py-1.5 px-1 text-[10px] font-bold rounded ${
                                currentPoints === '20' 
                                  ? 'bg-orange-600 text-white ring-2 ring-orange-400' 
                                  : 'bg-orange-600/30 text-orange-400 hover:bg-orange-600/50'
                              }`}
                            >
                              Initial
                              <div className="text-[8px] opacity-80">20</div>
                            </button>
                            <button
                              onClick={() => setPredefinedPoints(40)}
                              className={`py-1.5 px-1 text-[10px] font-bold rounded ${
                                currentPoints === '40' 
                                  ? 'bg-amber-600 text-white ring-2 ring-amber-400' 
                                  : 'bg-amber-600/30 text-amber-400 hover:bg-amber-600/50'
                              }`}
                            >
                              Middle
                              <div className="text-[8px] opacity-80">40</div>
                            </button>
                            <button
                              onClick={() => {
                                // Rummy declaration ends round
                                sendGameAction('RECORD_VALID_SHOW', { playerId: p.id });
                                toast.success(`${p.name} declares RUMMY! Round enters completion phase.`);
                              }}
                              className="py-1.5 px-1 text-[10px] font-bold rounded bg-green-600/80 text-white hover:bg-green-600"
                            >
                              Rummy
                              <div className="text-[8px] opacity-80">0 pts</div>
                            </button>
                            <button
                              onClick={() => {
                                // Wrong show ends round
                                sendGameAction('RECORD_WRONG_SHOW', { playerId: p.id });
                                toast.error(`${p.name} - Wrong Show! 80 point penalty. Round enters completion phase.`);
                              }}
                              className="py-1.5 px-1 text-[10px] font-bold rounded bg-red-600/80 text-white hover:bg-red-600"
                            >
                              Wrong
                              <div className="text-[8px] opacity-80">80 pts</div>
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {/* Card Points Input with Validation */}
                      {isOperatorOrAdmin && !isEliminated && currentPhase !== 'SETUP' && (
                        <div className="mt-3">
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="0"
                              max="200"
                              value={currentPoints}
                              placeholder="Enter points *"
                              className="flex-1 px-3 py-2 bg-slate-700 border-2 border-slate-600 rounded-lg text-white text-sm font-bold focus:border-orange-500 focus:outline-none"
                              onChange={(e) => handlePointsChange(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRecordPoints();
                                }
                              }}
                            />
                            <button
                              onClick={handleRecordPoints}
                              disabled={!currentPoints || parseInt(currentPoints) < 0}
                              className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-1 ${
                                currentPoints && parseInt(currentPoints) >= 0
                                  ? 'bg-violet-600 hover:bg-violet-700 text-white'
                                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                              }`}
                            >
                              <Check size={16} />
                              Add
                            </button>
                          </div>
                          {!currentPoints && (
                            <div className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                              <AlertCircle size={12} />
                              Points required - click a button above or enter manually
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                
                // Teen Patti display
                const isTPActive = idx === gameState?.activePlayerIndex;
                const isTarget = sideShowRequest?.target?.id === p.id;
                const isRequester = sideShowRequest?.requester?.id === p.id;

                return (
                  <div 
                    key={p.id || idx} 
                    className={`relative p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col justify-between min-h-[140px] ${
                      isTPActive ? 'border-yellow-500 bg-slate-800 shadow-[0_0_30px_rgba(234,179,8,0.3)] scale-[1.02] ring-2 ring-yellow-500/50' : 'border-slate-700 bg-slate-800/50'
                    } ${
                      p.folded ? 'opacity-40 grayscale border-slate-800' : ''
                    } ${
                      (isTarget || isRequester) ? 'ring-2 ring-blue-500 z-20' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col">
                        <span className={`font-bold text-lg ${isTPActive ? 'text-white' : 'text-slate-400'}`}>{p.name}</span>
                        <span className="text-xs text-slate-500">Seat {p.seat}</span>
                      </div>
                      {!p.folded && p.status !== 'LEFT' && (
                        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${
                          p.status === 'BLIND' ? 'bg-slate-700 text-slate-400' : 'bg-blue-900 text-blue-300'
                        }`}>
                          {p.status}
                        </span>
                      )}
                      {p.status === 'LEFT' && (
                        <span className="text-[10px] font-bold px-2 py-1 rounded uppercase bg-red-900 text-red-300">
                          LEFT
                        </span>
                      )}
                    </div>

                    <div className="mt-4">
                      <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Invested</div>
                      <div className="font-mono text-xl text-yellow-500/80">{p.invested}</div>
                    </div>

                    {isOperatorOrAdmin && currentPhase !== 'SETUP' && p.status !== 'LEFT' && (
                      <button
                        onClick={() => handleRemovePlayer(p.id, p.name)}
                        className="mt-3 w-full py-1.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                      >
                        <X size={12} /> Remove
                      </button>
                    )}

                    {isTPActive && !p.folded && (
                      <>
                        <div className="absolute -top-3 -right-3 w-6 h-6 bg-yellow-500 rounded-full animate-bounce shadow-lg"></div>
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                          Turn
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Teen Patti Controls */}
            {isOperatorOrAdmin && activePlayer && !sideShowRequest && !showRequest && !isRummy && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Active Turn</div>
                    <div className="text-2xl font-bold text-white flex items-center gap-2">
                      {activePlayer.name} 
                      <span className="text-sm bg-slate-700 px-2 py-1 rounded text-yellow-500 border border-yellow-500/20">
                        {activePlayer.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Current Chaal</div>
                    <div className="text-2xl font-mono text-yellow-500">{currentStake}</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 mb-3">
                  <button onClick={handleFold} className="col-span-1 bg-gradient-to-br from-red-500/10 to-red-900/20 border border-red-500/30 text-red-500 rounded-xl font-bold text-sm hover:bg-red-500/20 flex flex-col items-center justify-center gap-1 py-3">
                    <Trash2 size={20} /> PACK
                  </button>
                  <button onClick={handleSideShow} disabled={isBlind || seenPlayers.length === 0} className={`col-span-1 bg-gradient-to-br from-blue-500/10 to-blue-900/20 border border-blue-500/30 text-blue-400 rounded-xl font-bold text-sm flex flex-col items-center justify-center gap-1 py-3 ${(isBlind || seenPlayers.length === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-500/20'}`}>
                    <ShieldAlert size={20} /> <span>SIDE SHOW</span>
                  </button>
                  <button onClick={() => handleBet(false)} className="col-span-1 bg-gradient-to-b from-yellow-500 to-yellow-600 text-black rounded-xl font-black text-xl flex flex-col items-center justify-center py-3">
                    <span className="text-xs font-bold opacity-60">Chaal</span>
                    <span>{cost}</span>
                  </button>
                  <div className="col-span-1 grid grid-rows-2 gap-2">
                    <button onClick={() => handleBet(true)} className="bg-slate-700 text-green-400 rounded-lg text-xs font-bold">x2 Raise</button>
                    <button onClick={handleCustomBid} className="bg-slate-700 text-yellow-400 rounded-lg text-xs font-bold flex items-center justify-center gap-1"><Edit3 size={12} /> Custom</button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={handleSeen} disabled={!isBlind} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border ${isBlind ? 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10' : 'border-slate-700 text-slate-600 opacity-50 cursor-not-allowed'}`}>
                    <Eye size={16} /> SEE CARDS
                  </button>
                  <button onClick={handleShow} disabled={!canShow && !canForceShow} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border ${canShow || canForceShow ? 'bg-slate-700 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10' : 'border-slate-700 text-slate-600 opacity-50 cursor-not-allowed'}`}>
                    <Trophy size={16} /> {canForceShow ? 'FORCE SHOW' : 'SHOW'}
                  </button>
                </div>
              </div>
            )}

            {/* Overall Standings - Active Game HUD (bottom) */}
            {currentPhase !== 'SETUP' && gameState?.overallStandings && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                  {isRummy ? 'Leaderboard' : 'Overall Standings'} 
                  <span className="ml-2 text-slate-400 normal-case">
                    ({isRummy ? `${Math.max(0, (gameState?.totalRounds || 0) - (gameState?.currentRound || 0) + 1)} rounds remaining` : `${Math.max(0, (gameState?.totalRounds || 0) - (gameState?.currentRound || 0))} hands remaining`})
                  </span>
                </h3>
                <div className="space-y-1">
                  {gameState.overallStandings.slice(0, 5).map((player, index) => (
                    <div key={player.id} className={`flex justify-between items-center p-1.5 rounded text-sm ${index === 0 ? 'bg-yellow-500/10' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold text-xs ${index === 0 ? 'text-yellow-400' : 'text-slate-400'}`}>#{index + 1}</span>
                        <span className="text-slate-200">{player.name}</span>
                        {player.status === 'LEFT' && <span className="text-[10px] text-red-400">LEFT</span>}
                      </div>
                      <span className="font-bold text-white">{isRummy ? `${player.score || 0} pts` : `${player.sessionBalance || 0}`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ==================== MODALS ==================== */}

      {/* Teen Patti: Side Show Selection */}
      {showSideShowSelection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-sm w-full border border-slate-700">
            <h3 className="text-xl font-bold text-slate-50 mb-4 flex items-center gap-2">
              <ShieldAlert className="text-blue-400" /> Side Show
            </h3>
            <div className="space-y-2 mb-6 max-h-60 overflow-y-auto">
              {seenPlayers.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSideShowSelect(p.id)}
                  className="w-full p-3 bg-slate-700 hover:bg-blue-900/30 border border-slate-600 rounded-xl text-left flex justify-between items-center"
                >
                  <span className="font-bold text-slate-50">{p.name}</span>
                  <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded">SEEN</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowSideShowSelection(false)} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">Cancel</button>
          </div>
        </div>
      )}

      {/* Teen Patti: Side Show Resolve */}
      {sideShowRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full border border-slate-700">
            <div className="text-center mb-6">
              <ShieldAlert className="mx-auto text-blue-400 mb-2" size={48} />
              <h3 className="text-2xl font-black text-slate-50">Side Show</h3>
            </div>
            <div className="space-y-4 mb-6">
              <button onClick={() => setSideShowConfirm({ player: sideShowRequest.requester, role: 'Requester' })} className="w-full p-4 rounded-xl border-2 border-blue-500/30 bg-blue-900/20">
                <div className="flex justify-between"><span className="font-bold text-slate-50">{sideShowRequest.requester.name}</span><span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-1 rounded">Requester</span></div>
              </button>
              <div className="text-center text-slate-400 font-bold">VS</div>
              <button onClick={() => setSideShowConfirm({ player: sideShowRequest.target, role: 'Target' })} className="w-full p-4 rounded-xl border-2 border-purple-500/30 bg-purple-900/20">
                <div className="flex justify-between"><span className="font-bold text-slate-50">{sideShowRequest.target.name}</span><span className="text-xs bg-purple-500/30 text-purple-300 px-2 py-1 rounded">Target</span></div>
              </button>
            </div>
            <button onClick={() => sendGameAction('CANCEL_SIDE_SHOW')} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold flex items-center justify-center gap-2"><X size={18} /> Cancel</button>
          </div>
        </div>
      )}

      {/* Teen Patti: Side Show Confirm */}
      {sideShowConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-sm w-full border border-slate-700">
            <div className="text-center mb-4">
              <ShieldAlert className="mx-auto text-yellow-400 mb-2" size={40} />
              <h3 className="text-xl font-bold text-slate-50">Confirm Winner</h3>
              <p className="text-slate-400 text-sm mt-2">
                Are you sure <span className="font-bold text-yellow-400">{sideShowConfirm.player.name}</span> is the winner? Verify both players' cards carefully before confirming.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setSideShowConfirm(null)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-bold">
                Re-check
              </button>
              <button onClick={() => { sendGameAction('SIDE_SHOW_RESOLVE', { winnerId: sideShowConfirm.player.id }); setSideShowConfirm(null); }} className="flex-1 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2">
                <Check size={18} /> Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teen Patti: Show Resolve */}
      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full border border-slate-700">
            <div className="text-center mb-6">
              <Trophy className="mx-auto text-yellow-500 mb-2" size={48} />
              <h3 className="text-2xl font-black text-slate-50">{showRequest.isForceShow ? 'Force Show' : 'Show'}</h3>
            </div>
            <div className="space-y-4 mb-6">
              <button onClick={() => sendGameAction('SHOW_RESOLVE', { winnerId: showRequest.requester.id })} className="w-full p-4 rounded-xl border-2 border-blue-500/30 bg-blue-900/20">
                <div className="flex justify-between"><span className="font-bold text-slate-50">{showRequest.requester.name}</span><span className={`text-xs px-2 py-1 rounded ${showRequest.requester.status === 'SEEN' ? 'bg-blue-500/30 text-blue-300' : 'bg-slate-600'}`}>{showRequest.requester.status}</span></div>
              </button>
              <div className="text-center text-slate-400 font-bold">VS</div>
              <button onClick={() => sendGameAction('SHOW_RESOLVE', { winnerId: showRequest.target.id })} className="w-full p-4 rounded-xl border-2 border-purple-500/30 bg-purple-900/20">
                <div className="flex justify-between"><span className="font-bold text-slate-50">{showRequest.target.name}</span><span className={`text-xs px-2 py-1 rounded ${showRequest.target.status === 'SEEN' ? 'bg-blue-500/30 text-blue-300' : 'bg-slate-600'}`}>{showRequest.target.status}</span></div>
              </button>
            </div>
            <button onClick={() => sendGameAction('CANCEL_SHOW')} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold flex items-center justify-center gap-2"><X size={18} /> Cancel</button>
          </div>
        </div>
      )}

      {/* Rummy: Declare Rummy Modal */}
      {showDeclareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-sm w-full border border-slate-700">
            <h3 className="text-xl font-bold text-slate-50 mb-4 flex items-center gap-2">
              <Trophy className="text-yellow-400" /> Declare Rummy
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              Are you sure you want to declare Rummy? Make sure you have valid combinations.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeclareModal(false)} className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">Cancel</button>
              <button onClick={handleDeclareRummy} className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-bold">Declare!</button>
            </div>
          </div>
        </div>
      )}

      {/* Rummy: Resolve Declare Modal */}
      {showResolveDeclareModal && gameState?.declaredPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-8 rounded-2xl max-w-md w-full border border-slate-700">
            <div className="text-center mb-6">
              <Trophy className={`mx-auto mb-2 ${gameState.declaredValid ? 'text-green-500' : 'text-red-500'}`} size={48} />
              <h3 className="text-2xl font-black text-slate-50">
                {gameState.declaredValid ? 'Valid Declaration!' : 'Invalid Declaration'}
              </h3>
              <p className="text-slate-400 mt-2">
                {gameState.declaredPlayer.name} {gameState.declaredValid ? 'wins!' : 'gets penalty!'}
              </p>
            </div>
            
            {gameState.declaredValid ? (
              <div className="space-y-4 mb-6">
                <p className="text-slate-400 text-sm text-center">Select the winner:</p>
                {gamePlayers.filter(p => p.id !== gameState.declaredPlayer.id).map(p => (
                  <button 
                    key={p.id}
                    onClick={() => handleResolveDeclare(p.id)}
                    className="w-full p-4 rounded-xl border-2 border-green-500/30 bg-green-900/20 hover:bg-green-900/40"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-50">{p.name}</span>
                      <span className="text-xs bg-green-500/30 text-green-300 px-2 py-1 rounded">{p.score} pts</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-slate-400 text-sm text-center mb-4">Penalty will be applied to {gameState.declaredPlayer.name}</p>
                <button 
                  onClick={() => handleResolveDeclare(gameState.declaredPlayer.id)}
                  className="w-full py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-bold"
                >
                  Apply Penalty (80 pts)
                </button>
              </div>
            )}
            
            <button onClick={() => setShowResolveDeclareModal(false)} className="w-full py-3 bg-slate-700 text-slate-300 rounded-xl font-bold">Cancel</button>
          </div>
        </div>
      )}

      {/* Round Summary Modal */}
      {showRoundSummary && roundSummaryData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-lg w-full border border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-400 to-yellow-600"></div>
            <div className="text-center mb-4">
              <Trophy className="mx-auto text-yellow-500 mb-2" size={48} />
              <h2 className="text-2xl font-black text-slate-50 uppercase">
                {isRummy ? 'Round Complete!' : 'Hand Winner!'}
              </h2>
              <p className="text-xl font-bold text-blue-400">
                {roundSummaryData.winner?.name || 'No winner'}
              </p>
            </div>

            {/* Round info bar */}
            <div className="bg-blue-900/20 rounded-xl p-3 mb-4 border border-blue-500/30 text-center">
              <p className="text-blue-400 uppercase text-xs font-bold tracking-widest">Round {roundSummaryData.currentRound || roundSummaryData.round} of {roundSummaryData.totalRounds || gameState?.totalRounds || session?.totalRounds || 10}</p>
              {!isRummy && (
                <p className="text-yellow-400 text-sm font-bold mt-1">Pot: {roundSummaryData.pot || 0}</p>
              )}
            </div>

            {/* Overall Standings */}
            {roundSummaryData.playerStandings && !isRummy && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Overall Standings</h3>
                <div className="space-y-1">
                  {roundSummaryData.playerStandings.map((player, index) => (
                    <div key={player.id} className={`flex justify-between items-center p-2 rounded-lg ${index === 0 ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-slate-700/30'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${index === 0 ? 'text-yellow-400' : 'text-slate-400'}`}>#{index + 1}</span>
                        <span className="font-medium text-slate-50 text-sm">{player.name}</span>
                        {index === 0 && <span className="text-[10px] bg-yellow-500/30 text-yellow-400 px-1.5 py-0.5 rounded">LEADER</span>}
                      </div>
                      <span className="font-bold text-white text-sm">{player.sessionBalance}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rummy Leaderboard */}
            {isRummy && roundSummaryData.leaderboard && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Leaderboard</h3>
                <div className="space-y-1">
                  {roundSummaryData.leaderboard.map((player, index) => (
                    <div key={player.id} className={`flex justify-between items-center p-2 rounded-lg ${index === 0 && player.status !== 'ELIMINATED' ? 'bg-green-500/10 border border-green-500/30' : 'bg-slate-700/30'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-mono text-sm">#{index + 1}</span>
                        <span className="font-medium text-slate-50 text-sm">{player.name}</span>
                        {player.status === 'ELIMINATED' && (
                          <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">OUT</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-white text-sm">{player.totalScore} pts</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Teen Patti Net Changes */}
            {!isRummy && roundSummaryData.netChanges && Object.keys(roundSummaryData.netChanges).length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">This Hand</h3>
                <div className="space-y-1">
                  {Object.entries(roundSummaryData.netChanges).map(([playerId, change]) => {
                    const player = players.find(p => p.id === parseInt(playerId));
                    if (!player) return null;
                    return (
                      <div key={playerId} className="flex justify-between items-center bg-slate-700/30 p-2 rounded-lg">
                        <span className="font-medium text-slate-50 text-sm">{player.name}</span>
                        <span className={`font-bold text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {change >= 0 ? '+' : ''}{change}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Round History */}
            {roundSummaryData.roundHistory && roundSummaryData.roundHistory.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Round History</h3>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {roundSummaryData.roundHistory.map((rh, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-700/20 p-1.5 rounded text-xs">
                      <span className="text-slate-400">Round {rh.round}</span>
                      <span className="text-slate-300">{rh.winnerName || 'N/A'}</span>
                      {!isRummy && <span className="text-yellow-400">Pot: {rh.pot}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roundSummaryData.eliminated && roundSummaryData.eliminated.length > 0 && (
              <div className="mb-4 bg-red-900/20 rounded-xl p-3 border border-red-500/30">
                <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Eliminated</h3>
                <p className="text-red-300 text-sm">{roundSummaryData.eliminated.join(', ')}</p>
              </div>
            )}

            {/* Overall Winner Badge */}
            {roundSummaryData.overallWinner && !roundSummaryData.isSessionOver && (
              <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-center">
                <span className="text-xs text-yellow-400 uppercase tracking-widest">Overall Leader</span>
                <p className="text-lg font-bold text-yellow-400">{roundSummaryData.overallWinner.name} ({roundSummaryData.overallWinner.sessionBalance || roundSummaryData.overallWinner.score || 0})</p>
              </div>
            )}

            {!roundSummaryData.isSessionOver && (
              <div className="mb-3">
                <button 
                  onClick={() => setShowPlayerRequestModal(true)}
                  className="w-full py-2.5 bg-green-500/20 border-2 border-green-500/30 text-green-400 rounded-xl font-bold flex items-center justify-center gap-2 text-sm"
                >
                  <UserPlus size={18} /> Request New Players
                </button>
              </div>
            )}

            <button 
              onClick={handleNextRound} 
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-bold text-lg"
            >
              {roundSummaryData.isSessionOver ? 'View Final Results' : 'Next Round'}
            </button>
          </div>
        </div>
      )}

      {/* Session Ended Modal */}
      {showSessionSummary && sessionSummaryData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-slate-800 p-6 rounded-2xl max-w-2xl w-full border border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="text-center mb-6">
              <Trophy className="mx-auto text-yellow-500 mb-4" size={64} />
              <h2 className="text-3xl font-black text-slate-50 mb-2">Game Complete!</h2>
              <p className="text-slate-400">{decodeURIComponent(sessionName)}</p>
            </div>
            
            {/* Overall Winner */}
            {(sessionSummaryData.overallWinner || sessionSummaryData.finalWinner) && (
              <div className="bg-yellow-500/10 border-2 border-yellow-500/30 rounded-xl p-4 mb-6 text-center">
                <p className="text-yellow-400 text-xs uppercase tracking-widest font-bold mb-1">Overall Champion</p>
                <p className="text-2xl font-black text-yellow-400">
                  {(sessionSummaryData.overallWinner?.name || sessionSummaryData.finalWinner?.name || 'N/A')}
                </p>
                <p className="text-yellow-300 text-sm">
                  {isRummy ? `${sessionSummaryData.overallWinner?.totalScore || sessionSummaryData.finalWinner?.totalScore || sessionSummaryData.overallWinner?.score || sessionSummaryData.finalWinner?.score || 0} pts` : `${sessionSummaryData.overallWinner?.sessionBalance || sessionSummaryData.finalWinner?.sessionBalance || 0} chips`}
                </p>
              </div>
            )}
            
            <div className="bg-slate-700/50 rounded-xl p-4 mb-6 text-center">
              <p className="text-slate-400 text-sm">Final Round</p>
              <p className="text-2xl font-black text-slate-50">
                {sessionSummaryData.finalRound} / {sessionSummaryData.totalRounds}
              </p>
            </div>

            {/* Round History Table */}
            {sessionSummaryData.roundHistory && sessionSummaryData.roundHistory.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Round History</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="text-left py-2 px-2">Round</th>
                        <th className="text-left py-2 px-2">Winner</th>
                        {!isRummy && <th className="text-right py-2 px-2">Pot</th>}
                        <th className="text-right py-2 px-2">Leader</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionSummaryData.roundHistory.map((rh, idx) => (
                        <tr key={idx} className="border-b border-slate-700/50">
                          <td className="py-2 px-2 text-slate-300">{rh.round}</td>
                          <td className="py-2 px-2 text-slate-50 font-medium">{rh.winner?.name || rh.winnerName || 'N/A'}</td>
                          {!isRummy && <td className="py-2 px-2 text-right text-yellow-400">{rh.pot || '-'}</td>}
                          <td className="py-2 px-2 text-right text-slate-300">
                            {rh.playerStandings ? rh.playerStandings[0]?.name : (rh.leaderboard ? rh.leaderboard[0]?.name : '-')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Final Standings */}
            {(sessionSummaryData.finalPlayers || sessionSummaryData.leaderboard || sessionSummaryData.players) && (
              <div className="mb-6">
                <h3 className="text-lg font-bold text-slate-300 mb-3 text-center">Final Standings</h3>
                <div className="space-y-2">
                  {(sessionSummaryData.finalPlayers || sessionSummaryData.leaderboard || sessionSummaryData.players || [])
                    .sort((a, b) => {
                      if (isRummy) {
                        return (a.score || 0) - (b.score || 0);
                      }
                      return (b.sessionBalance || 0) - (a.sessionBalance || 0);
                    })
                    .map((player, index) => (
                    <div 
                      key={player.id} 
                      className={`flex justify-between items-center p-3 rounded-xl ${
                        index === 0 ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold ${
                          index === 0 ? 'text-yellow-400' : 'text-slate-400'
                        }`}>#{index + 1}</span>
                        <span className="font-bold text-slate-50">{player.name}</span>
                        {index === 0 && <span className="text-xs bg-yellow-500/30 text-yellow-400 px-2 py-0.5 rounded">WINNER</span>}
                        {player.status === 'ELIMINATED' && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">OUT</span>}
                        {player.status === 'LEFT' && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">LEFT</span>}
                      </div>
                      <span className="font-bold text-white">
                        {isRummy ? `${player.score || 0} pts` : `${player.sessionBalance || 0} chips`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button 
                onClick={() => setShowSessionSummary(false)} 
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold"
              >
                Close
              </button>
              <button 
                onClick={() => navigate('/operator/sessions')} 
                className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-bold"
              >
                Back to Sessions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameSession;
