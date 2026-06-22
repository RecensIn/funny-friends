import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Plus, Users, Gamepad2, ArrowLeft, Trash2, 
  AlertCircle, CheckCircle, Hash, Target, Play
} from 'lucide-react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';

const PLAYER_LIMIT = 17;

const GameCard = ({ game, isSelected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full p-4 rounded-xl border-2 text-left transition-all duration-200 ${
      isSelected
        ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30'
        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'
    }`}
  >
    <div className="flex items-start gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 bg-gradient-to-br ${game.color}`}>
        <span>{game.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-50 text-sm">{game.name}</h3>
          {isSelected && <CheckCircle size={16} className="text-violet-400 flex-shrink-0" />}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{game.description}</p>
        <p className="text-xs text-slate-500 mt-1">{game.minPlayers}–{game.maxPlayers} players</p>
      </div>
    </div>
  </button>
);

const PlayerRow = ({ index, name, onChange, onRemove, canRemove }) => (
  <div className="flex items-center gap-2">
    <div className="w-8 h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs font-medium text-slate-300 flex-shrink-0">
      {index + 1}
    </div>
    <input
      type="text"
      value={name}
      onChange={(e) => onChange(index, e.target.value)}
      placeholder={`Player ${index + 1}`}
      className="input flex-1"
    />
    <button
      type="button"
      onClick={() => onRemove(index)}
      disabled={!canRemove}
      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
      aria-label={`Remove player ${index + 1}`}
    >
      <Trash2 size={16} />
    </button>
  </div>
);

const SessionSetup = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [sessionName, setSessionName] = useState('');
  const [totalRounds, setTotalRounds] = useState(10);
  const [targetScore, setTargetScore] = useState(100);
  const [players, setPlayers] = useState(['']);

  useEffect(() => {
    fetch(`${API_URL}/api/gametypes`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const active = data.filter(g => g.isActive);
        setGames(active);
        const gameCode = searchParams.get('game');
        if (gameCode) {
          const game = active.find(g => g.code === gameCode);
          if (game) setSelectedGame(game);
        }
      })
      .catch(() => {});
  }, [searchParams]);

  const handleAddPlayer = () => {
    if (players.length >= PLAYER_LIMIT) {
      setError(`Maximum ${PLAYER_LIMIT} players`);
      return;
    }
    setPlayers([...players, '']);
    setError('');
  };

  const handleRemovePlayer = (index) => {
    if (players.length <= 1) return;
    setPlayers(players.filter((_, i) => i !== index));
    setError('');
  };

  const handlePlayerChange = (index, value) => {
    const next = [...players];
    next[index] = value;
    setPlayers(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!sessionName.trim()) {
      setError('Session name is required');
      return;
    }
    if (!selectedGame) {
      setError('Select a game type');
      return;
    }

    const validPlayers = players.map(p => p.trim()).filter(Boolean);
    if (validPlayers.length < selectedGame.minPlayers) {
      setError(`Need at least ${selectedGame.minPlayers} players for ${selectedGame.name}`);
      return;
    }
    if (validPlayers.length > selectedGame.maxPlayers) {
      setError(`Maximum ${selectedGame.maxPlayers} players for ${selectedGame.name}`);
      return;
    }

    setLoading(true);

    try {
      const isRummy = selectedGame.code === 'rummy';
      const res = await fetch(`${API_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: sessionName.trim(),
          gameCode: selectedGame.code,
          ...(isRummy
            ? { targetScore: parseInt(targetScore), gameLimitType: 'points' }
            : { totalRounds: parseInt(totalRounds), gameLimitType: 'rounds' }
          ),
          players: validPlayers.map((name, i) => ({ name, seat: i + 1 }))
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        navigate(`/game/${encodeURIComponent(sessionName.trim())}`);
      } else {
        setError(data.error || data.message || 'Failed to create session');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const minPlayers = selectedGame?.minPlayers || 2;
  const validCount = players.map(p => p.trim()).filter(Boolean).length;
  const canSubmit = sessionName.trim() && selectedGame && validCount >= minPlayers && !loading;

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6 sm:mb-8">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-50">New Game Session</h1>
            <p className="text-sm text-slate-400">Set up a card game ledger session</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 alert alert-error">
            <AlertCircle size={18} className="flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="card">
            <div className="card-body space-y-4">
              <div className="form-group">
                <label htmlFor="session-name" className="form-label">Session Name</label>
                <input
                  id="session-name"
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="input"
                  placeholder="Friday Night Game, Monthly Tournament…"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Game Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {games.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      isSelected={selectedGame?.id === game.id}
                      onClick={() => setSelectedGame(game)}
                    />
                  ))}
                </div>
              </div>

              {selectedGame && (
                <div className="form-group pt-2 border-t border-slate-700">
                  {selectedGame.code === 'rummy' ? (
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Target size={20} className="text-orange-400" />
                      </div>
                      <div>
                        <label htmlFor="target-score" className="form-label">Target Points</label>
                        <p className="text-xs text-slate-500 mb-2">Player exceeding this score is eliminated</p>
                        <input
                          id="target-score"
                          type="number"
                          min="50" max="500" step="10"
                          value={targetScore}
                          onChange={(e) => setTargetScore(e.target.value)}
                          className="input w-28"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Hash size={20} className="text-emerald-400" />
                      </div>
                      <div>
                        <label htmlFor="total-rounds" className="form-label">Number of Rounds</label>
                        <p className="text-xs text-slate-500 mb-2">Session ends after this many rounds</p>
                        <input
                          id="total-rounds"
                          type="number"
                          min="1" max="50"
                          value={totalRounds}
                          onChange={(e) => setTotalRounds(e.target.value)}
                          className="input w-28"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-50 flex items-center gap-2">
                <Users size={18} className="text-violet-400" />
                Players
              </h2>
              <span className="badge badge-info">
                {validCount} / {selectedGame?.maxPlayers || '?'}
              </span>
            </div>
            <div className="card-body space-y-3">
              {players.map((name, index) => (
                <PlayerRow
                  key={index}
                  index={index}
                  name={name}
                  onChange={handlePlayerChange}
                  onRemove={handleRemovePlayer}
                  canRemove={players.length > 1}
                />
              ))}

              <button
                type="button"
                onClick={handleAddPlayer}
                disabled={players.length >= PLAYER_LIMIT}
                className="w-full py-2.5 border-2 border-dashed border-slate-600 rounded-xl text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors flex items-center justify-center gap-2 font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Add Player
              </button>

              {selectedGame && validCount < minPlayers && (
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertCircle size={12} />
                  Need at least {minPlayers} players
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="btn btn-outline"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn btn-primary btn-lg flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Play size={18} />
                  Create &amp; Start Session
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SessionSetup;
