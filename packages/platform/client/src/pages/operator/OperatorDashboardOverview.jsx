import React, { useState, useEffect } from 'react';
import { Users, Gamepad2, Activity, Shield, Plus, Play, Eye, Clock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../../config';

const OperatorDashboardOverview = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    activeSessions: 0,
    totalSessions: 0,
    totalPlayers: 0,
    availableGames: 0
  });
  const [activeSessions, setActiveSessions] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [sessionsRes, gamesRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/sessions`, { credentials: 'include' }),
        fetch(`${API_URL}/api/gametypes`, { credentials: 'include' })
      ]);

      const sessions = sessionsRes.ok ? await sessionsRes.json() : [];
      const games = gamesRes.ok ? await gamesRes.json() : [];

      const active = sessions.filter(s => s.isActive);
      const ended = sessions.filter(s => !s.isActive);
      const totalPlayers = sessions.reduce((sum, s) => sum + (s.playerCount || 0), 0);

      setStats({
        activeSessions: active.length,
        totalSessions: sessions.length,
        totalPlayers,
        availableGames: games.filter(g => g.isActive).length
      });

      setActiveSessions(active);
      setRecentSessions(
        [...active, ...ended]
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 5)
      );
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { title: 'Active Sessions', value: stats.activeSessions, icon: Gamepad2, color: 'emerald', description: 'Currently running' },
    { title: 'Total Sessions', value: stats.totalSessions, icon: Activity, color: 'blue', description: 'All time' },
    { title: 'Total Players', value: stats.totalPlayers, icon: Users, color: 'violet', description: 'Across all sessions' },
    { title: 'Available Games', value: stats.availableGames, icon: Shield, color: 'orange', description: 'Games you can host' }
  ];

  const colorClasses = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    violet:  { bg: 'bg-violet-500/10',  text: 'text-violet-400' },
    orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-400' }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasSessions = stats.totalSessions > 0;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-violet-600 to-violet-800 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold mb-2">Welcome, Operator!</h3>
            <p className="text-violet-100">
              Manage your game sessions and track player activity from this control panel.
            </p>
          </div>
          <button
            onClick={() => navigate('/sessions/new')}
            className="hidden md:flex items-center gap-2 px-6 py-3 bg-white text-violet-600 rounded-xl font-bold hover:bg-slate-100 transition-colors"
          >
            <Plus size={20} />
            Create Session
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div
            key={index}
            className="card p-6 hover:border-slate-600 hover:shadow-lg transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-xl ${colorClasses[stat.color].bg}`}>
                <stat.icon size={24} className={colorClasses[stat.color].text} />
              </div>
            </div>
            <h4 className="text-2xl font-bold text-slate-50 mb-1">{stat.value}</h4>
            <p className="text-sm font-medium text-slate-300">{stat.title}</p>
            <p className="text-xs text-slate-500 mt-1">{stat.description}</p>
          </div>
        ))}
      </div>

      {/* Main Content: Active Sessions + Contextual Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Sessions */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-50">Active Sessions</h3>
            <button
              onClick={() => navigate('/operator/sessions')}
              className="text-sm text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
            >
              View All
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="card-body">
            {activeSessions.length === 0 ? (
              <div className="text-center py-8">
                <Gamepad2 size={48} className="mx-auto text-slate-600 mb-4" />
                <p className="text-slate-400 mb-4">No active sessions right now</p>
                <button
                  onClick={() => navigate('/sessions/new')}
                  className="btn btn-primary"
                >
                  <Plus size={18} className="inline mr-1" />
                  Create Session
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-4 bg-slate-900 rounded-lg hover:bg-slate-700 transition-colors border border-slate-700"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-violet-700 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Gamepad2 size={20} className="text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-200 truncate">{session.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>{session.gameType?.name || 'Unknown'}</span>
                          <span>·</span>
                          <span>Round {session.currentRound}/{session.totalRounds}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            {session.playerCount || 0}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/game/${session.name}`)}
                      className="btn btn-primary btn-sm flex items-center gap-1.5 flex-shrink-0 ml-3"
                    >
                      <Play size={14} />
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contextual Panel: replaces Quick Start Guide */}
        {!hasSessions ? (
          <div className="card p-6 text-center">
            <div className="mb-6">
              <div className="w-20 h-20 bg-violet-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Gamepad2 size={40} className="text-violet-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-50 mb-2">Get Started</h3>
              <p className="text-slate-400 max-w-sm mx-auto">
                Create your first session to start tracking scores, managing players, and running games.
              </p>
            </div>
            <button
              onClick={() => navigate('/sessions/new')}
              className="btn btn-primary btn-lg flex items-center gap-2 mx-auto"
            >
              <Plus size={20} />
              Create Your First Session
            </button>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              {[
                { step: '1', label: 'Create Session', desc: 'Pick a game' },
                { step: '2', label: 'Add Players', desc: 'Invite friends' },
                { step: '3', label: 'Track Scores', desc: 'Record rounds' }
              ].map((item) => (
                <div key={item.step}>
                  <div className="w-8 h-8 bg-violet-500/10 text-violet-400 rounded-full flex items-center justify-center font-bold text-sm mx-auto mb-2">
                    {item.step}
                  </div>
                  <p className="text-sm font-medium text-slate-200">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h3 className="text-lg font-bold text-slate-50">Recent Activity</h3>
            </div>
            <div className="card-body">
              {recentSessions.length === 0 ? (
                <div className="text-center py-8">
                  <Activity size={48} className="mx-auto text-slate-600 mb-4" />
                  <p className="text-slate-400">No recent sessions</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-4 bg-slate-900 rounded-lg hover:bg-slate-700 transition-colors border border-slate-700"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${session.isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-200 truncate">{session.name}</p>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>{session.gameType?.name || 'Unknown'}</span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Users size={12} />
                              {session.playerCount || 0}
                            </span>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {new Date(session.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <span className={`badge ${session.isActive ? 'badge-success' : 'badge-info'}`}>
                          {session.isActive ? 'Active' : 'Ended'}
                        </span>
                        <button
                          onClick={() => navigate(`/game/${session.name}`)}
                          className="btn btn-ghost btn-sm flex items-center gap-1"
                        >
                          {session.isActive ? <Play size={14} /> : <Eye size={14} />}
                          {session.isActive ? 'Join' : 'View'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-slate-700">
                <button
                  onClick={() => navigate('/operator/sessions')}
                  className="btn btn-secondary w-full flex items-center justify-center gap-2"
                >
                  View All Sessions
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Create Button */}
      <button
        onClick={() => navigate('/sessions/new')}
        className="md:hidden fixed bottom-6 right-6 w-14 h-14 bg-violet-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-violet-700 transition-colors"
      >
        <Plus size={24} />
      </button>
    </div>
  );
};

export default OperatorDashboardOverview;