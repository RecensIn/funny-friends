import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Gamepad2, Activity, Shield, Clock,
  Server, CheckCircle, XCircle, Play, ChevronRight,
  UserPlus
} from 'lucide-react';
import { API_URL } from '../../config';

const AdminDashboardOverview = () => {
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    totalUsers: 0,
    activeOperators: 0,
    activeSessions: 0,
    totalSessions: 0,
    totalGameTypes: 0
  });
  const [sessions, setSessions] = useState([]);
  const [recentUsers, setRecentUsers] = useState([]);
  const [health, setHealth] = useState({ ok: false, checking: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [usersRes, sessionsRes, gamesRes, healthRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/api/v2/sessions`, { credentials: 'include' }),
        fetch(`${API_URL}/api/gametypes`, { credentials: 'include' }),
        fetch(`${API_URL}/api/setup/status`)
      ]);

      let users = [];
      let rawSessions = [];
      let games = [];

      if (usersRes.ok) users = await usersRes.json();
      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        rawSessions = data.sessions || [];
      }
      if (gamesRes.ok) games = await gamesRes.json();

      const operatorCount = users.filter(u => u.role === 'OPERATOR').length;
      const active = rawSessions.filter(s => s.isActive);
      const activeGames = games.filter(g => g.isActive);

      setStats({
        totalUsers: users.length,
        activeOperators: operatorCount,
        activeSessions: active.length,
        totalSessions: rawSessions.length,
        totalGameTypes: activeGames.length
      });

      setSessions(rawSessions);

      // Recent users: newest 5 by createdAt
      const sorted = [...users].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      setRecentUsers(sorted.slice(0, 5));

      // Health: if /api/setup/status responds, server is up
      setHealth({ ok: healthRes.ok, checking: false });
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setHealth({ ok: false, checking: false });
    } finally {
      setLoading(false);
    }
  };

  const activeSessions = sessions.filter(s => s.isActive);

  const statCards = [
    {
      title: 'Total Users',
      value: stats.totalUsers,
      icon: Users,
      color: 'from-blue-500 to-blue-700',
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      description: 'Registered accounts'
    },
    {
      title: 'Active Operators',
      value: stats.activeOperators,
      icon: Shield,
      color: 'from-purple-500 to-purple-700',
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      description: 'Approved operators'
    },
    {
      title: 'Active Sessions',
      value: `${stats.activeSessions}/${stats.totalSessions}`,
      icon: Gamepad2,
      color: 'from-green-500 to-green-700',
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      description: 'Currently running'
    },
    {
      title: 'Game Types',
      value: stats.totalGameTypes,
      icon: Activity,
      color: 'from-orange-500 to-orange-700',
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      description: 'Available games'
    }
  ];

  const quickActions = [
    { label: 'Create New User', path: '/admin/users', color: 'bg-blue-500 hover:bg-blue-600' },
    { label: 'Manage Permissions', path: '/admin/permissions', color: 'bg-purple-500 hover:bg-purple-600' },
    { label: 'View All Sessions', path: '/admin/games', color: 'bg-green-500 hover:bg-green-600' },
    { label: 'Platform Settings', path: '/admin/settings', color: 'bg-orange-500 hover:bg-orange-600' }
  ];

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  };

  const roleBadge = (role) => {
    const map = {
      ADMIN: 'bg-red-500/10 text-red-400',
      OPERATOR: 'bg-purple-500/10 text-purple-400',
      PLAYER: 'bg-blue-500/10 text-blue-400',
      GUEST: 'bg-slate-500/10 text-slate-400'
    };
    return map[role] || 'bg-slate-500/10 text-slate-400';
  };

  const renderSessionProgress = (session) => {
    if (session.gameLimitType === 'rounds' && session.totalRounds) {
      return `Round ${session.currentRound || 0}/${session.totalRounds}`;
    }
    if (session.gameLimitType === 'points' && session.targetScore) {
      return `Target: ${session.targetScore} pts`;
    }
    return `Round ${session.currentRound || 0}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-6">
        <h3 className="text-2xl font-bold text-white mb-2">Admin Control Panel</h3>
        <p className="text-purple-100">
          Manage users, sessions, permissions, and system settings.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div
            key={index}
            className="card bg-slate-800 border-slate-700 hover:border-slate-600 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-xl ${stat.bg}`}>
                <stat.icon size={24} className={stat.text} />
              </div>
            </div>
            <h4 className="text-2xl font-bold text-slate-50 mb-1">{stat.value}</h4>
            <p className="text-sm font-medium text-slate-300">{stat.title}</p>
            <p className="text-xs text-slate-500 mt-1">{stat.description}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="card bg-slate-800 border-slate-700">
        <h3 className="text-lg font-bold text-slate-50 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickActions.map((action, index) => (
            <button
              key={index}
              onClick={() => navigate(action.path)}
              className={`${action.color} text-white p-4 rounded-xl font-medium transition-colors text-left`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Sessions + Recent Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Sessions */}
        <div className="card bg-slate-800 border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-50">
              Active Sessions
              <span className="ml-2 text-sm font-normal text-slate-400">
                ({activeSessions.length})
              </span>
            </h3>
            <button
              onClick={() => navigate('/admin/games')}
              className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
            >
              View all <ChevronRight size={14} />
            </button>
          </div>

          {activeSessions.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Gamepad2 className="mx-auto mb-3 opacity-30" size={32} />
              <p>No active sessions</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.slice(0, 5).map((session) => (
                <button
                  key={session.id}
                  onClick={() => navigate(`/game/${encodeURIComponent(session.name)}`)}
                  className="w-full flex items-center gap-4 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-700 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Play size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-50 truncate">
                      {session.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {session.gameType} &middot; {session.playerCount || 0} players
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="badge badge-success text-xs">
                      {renderSessionProgress(session)}
                    </span>
                  </div>
                </button>
              ))}
              {activeSessions.length > 5 && (
                <button
                  onClick={() => navigate('/admin/games')}
                  className="w-full text-center text-sm text-slate-400 hover:text-slate-300 py-2 transition-colors"
                >
                  +{activeSessions.length - 5} more active sessions
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent Users */}
        <div className="card bg-slate-800 border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-50">Recent Users</h3>
            <button
              onClick={() => navigate('/admin/users')}
              className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
            >
              Manage <ChevronRight size={14} />
            </button>
          </div>

          {recentUsers.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Users className="mx-auto mb-3 opacity-30" size={32} />
              <p>No users found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 py-2.5 border-b border-slate-700 last:border-0"
                >
                  <div className="w-9 h-9 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <UserPlus size={14} className="text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-50 truncate">
                      {user.username}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(user.createdAt)}
                    </p>
                  </div>
                  <span className={`badge text-xs ${roleBadge(user.role)}`}>
                    {user.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* System Health */}
      <div className="card bg-slate-800 border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-50">System Health</h3>
          <span className={`flex items-center gap-2 text-sm font-medium ${health.ok ? 'text-green-400' : 'text-red-400'}`}>
            <div className={`w-2 h-2 rounded-full ${health.checking ? 'bg-yellow-500 animate-pulse' : health.ok ? 'bg-green-500' : 'bg-red-500'}`} />
            {health.checking ? 'Checking...' : health.ok ? 'All Systems Operational' : 'Service Unreachable'}
          </span>
        </div>

        {health.ok && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'API Server', icon: Server, ok: true },
              { label: 'Database', icon: Server, ok: true },
              { label: 'Active Sessions', icon: Play, ok: stats.activeSessions >= 0 },
              { label: 'Users Online', icon: Users, ok: stats.totalUsers >= 0 }
            ].map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg"
              >
                <item.icon size={18} className="text-slate-400" />
                <div className="flex-1">
                  <p className="text-sm text-slate-300">{item.label}</p>
                </div>
                {item.ok ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <XCircle size={16} className="text-red-400" />
                )}
              </div>
            ))}
          </div>
        )}

        {!health.ok && !health.checking && (
          <div className="text-center py-6 text-slate-500">
            <XCircle className="mx-auto mb-2 text-red-400" size={32} />
            <p>Unable to reach API server</p>
            <p className="text-xs mt-1">Check server status and network connectivity</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboardOverview;