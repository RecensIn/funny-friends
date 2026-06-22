import React, { useState, useEffect } from 'react';
import { 
  Server, Database, Shield, Key, Clock, Users, Gamepad2, 
  AlertTriangle, RefreshCw, CheckCircle, XCircle, Info,
  Activity, Globe
} from 'lucide-react';
import { API_URL } from '../../config';
import { useToast } from '../../context/ToastContext';

const getCSRFToken = async () => {
  try {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return data.csrfToken;
    }
  } catch (e) {
    console.error('Failed to get CSRF token:', e);
  }
  return null;
};

const PlatformSettings = () => {
  const toast = useToast();

  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);
  const [stats, setStats] = useState({ users: null, sessions: null, gameTypes: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const [resetKey, setResetKey] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    fetchHealth();
    fetchStats();
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_URL}/health`);
      const data = await res.json();
      setHealth(data);
      setHealthError(false);
    } catch (e) {
      setHealthError(true);
    }
  };

  const fetchStats = async () => {
    try {
      const [usersRes, sessionsRes, gamesRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/api/admin/sessions`, { credentials: 'include' }),
        fetch(`${API_URL}/api/gametypes`, { credentials: 'include' })
      ]);

      const users = usersRes.ok ? await usersRes.json() : [];
      const sessions = sessionsRes.ok ? await sessionsRes.json() : [];
      const games = gamesRes.ok ? await gamesRes.json() : [];

      setStats({
        users: users.length,
        sessions: sessions.length,
        activeSessions: sessions.filter(s => s.isActive).length,
        gameTypes: games.filter(g => g.isActive).length,
      });
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleReset = async () => {
    if (!resetKey.trim()) {
      toast.error('Setup key is required');
      return;
    }

    setResetLoading(true);
    try {
      const csrfToken = await getCSRFToken();
      const headers = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const res = await fetch(`${API_URL}/api/setup/reset`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ setupKey: resetKey.trim() }),
        credentials: 'include'
      });

      const data = await res.json();

      if (res.ok) {
        toast.success('System reset successfully');
        setResetKey('');
        setShowResetConfirm(false);
        fetchStats();
      } else {
        toast.error(data.error || 'Reset failed');
      }
    } catch (e) {
      toast.error('Network error during reset');
    } finally {
      setResetLoading(false);
    }
  };

  const formatUptime = (seconds) => {
    if (!seconds && seconds !== 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m || !parts.length) parts.push(`${m}m`);
    return parts.join(' ');
  };

  const configRows = [
    { label: 'Max Failed Login Attempts', value: '5', description: 'Attempts before account lockout' },
    { label: 'Account Lockout Duration', value: '30 minutes', description: 'Lockout cooldown period' },
    { label: 'Session Absolute Timeout', value: '8 hours', description: 'Maximum session lifetime' },
    { label: 'Session Idle Timeout', value: '30 minutes', description: 'Auto-logout after inactivity' },
    { label: 'Minimum Password Length', value: '8 characters', description: 'With uppercase, lowercase, number, special' },
    { label: 'JWT Access Token Expiry', value: '15 minutes', description: 'Short-lived access token rotation' },
    { label: 'JWT Refresh Token Expiry', value: '7 days', description: 'Longer-lived refresh token' },
    { label: 'Rate Limit (per IP)', value: '100 req / 15 min', description: 'General API rate limiting' },
    { label: 'CSRF Token Expiry', value: '24 hours', description: 'Token rotation window' },
  ];

  // Server-side session defaults (matches SECURITY_CONFIG in server/middleware/security.js)
  const sessionDefaults = [
    { label: 'Default Rounds', value: '3', description: 'Default number of rounds per game' },
    { label: 'Default Target Score', value: '100', description: 'Default win threshold' },
    { label: 'Max Players per Session', value: '10', description: 'Hard limit across all game types' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Platform Settings</h2>
          <p className="text-slate-500">System status, configuration, and administration</p>
        </div>
        <button
          onClick={() => { fetchHealth(); fetchStats(); setStatsLoading(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <RefreshCw size={20} />
          Refresh All
        </button>
      </div>

      {/* System Health */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Server size={20} className="text-purple-600" />
            System Health
          </h3>
          <p className="text-sm text-slate-500 mt-1">Server connectivity and runtime status</p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Server Status */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-50">
              <div className={`p-2 rounded-lg ${health ? 'bg-green-100' : 'bg-red-100'}`}>
                {health ? (
                  <CheckCircle size={20} className="text-green-600" />
                ) : healthError ? (
                  <XCircle size={20} className="text-red-600" />
                ) : (
                  <RefreshCw size={20} className="text-purple-600 animate-spin" />
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500">Server</p>
                <p className={`font-bold ${health ? 'text-green-600' : healthError ? 'text-red-600' : 'text-purple-600'}`}>
                  {health ? 'Online' : healthError ? 'Offline' : 'Checking...'}
                </p>
              </div>
            </div>

            {/* Uptime */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-50">
              <div className="p-2 rounded-lg bg-blue-100">
                <Clock size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Uptime</p>
                <p className="font-bold text-slate-900">{health ? formatUptime(health.uptime) : '—'}</p>
              </div>
            </div>

            {/* Last Health Check */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-50">
              <div className="p-2 rounded-lg bg-amber-100">
                <Activity size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Last Check</p>
                <p className="font-bold text-slate-900 text-sm">
                  {health ? new Date(health.timestamp).toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>

            {/* Environment */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-50">
              <div className="p-2 rounded-lg bg-purple-100">
                <Globe size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Environment</p>
                <p className="font-bold text-slate-900">{import.meta.env.MODE}</p>
              </div>
            </div>
          </div>

          {/* Endpoint Info */}
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Info size={14} />
              <span>API Endpoint:</span>
              <code className="px-2 py-0.5 bg-slate-200 rounded text-slate-700 font-mono">
                {API_URL || '(same origin)'}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* Session Configuration */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Shield size={20} className="text-purple-600" />
            Security Configuration
          </h3>
          <p className="text-sm text-slate-500 mt-1">Server-side security defaults (read-only)</p>
        </div>

        <div className="divide-y divide-slate-200">
          {configRows.map((row, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div className="flex-1">
                <p className="font-medium text-slate-900">{row.label}</p>
                <p className="text-sm text-slate-500">{row.description}</p>
              </div>
              <div className="text-right">
                <code className="px-3 py-1 bg-slate-100 rounded text-sm font-mono text-purple-700">
                  {row.value}
                </code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Session Defaults */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Key size={20} className="text-purple-600" />
            Session Defaults
          </h3>
          <p className="text-sm text-slate-500 mt-1">Default game session configuration</p>
        </div>

        <div className="divide-y divide-slate-200">
          {sessionDefaults.map((row, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div className="flex-1">
                <p className="font-medium text-slate-900">{row.label}</p>
                <p className="text-sm text-slate-500">{row.description}</p>
              </div>
              <div className="text-right">
                <code className="px-3 py-1 bg-slate-100 rounded text-sm font-mono text-purple-700">
                  {row.value}
                </code>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Database Statistics */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Database size={20} className="text-purple-600" />
            Database Statistics
          </h3>
          <p className="text-sm text-slate-500 mt-1">Live counts from the database</p>
        </div>

        <div className="p-6">
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="text-purple-500 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Users */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <Users size={20} className="text-blue-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Total Users</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {stats.users !== null ? stats.users : '—'}
                </p>
              </div>

              {/* Sessions */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <Gamepad2 size={20} className="text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Total Sessions</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {stats.sessions !== null ? stats.sessions : '—'}
                </p>
                {stats.activeSessions !== null && (
                  <p className="text-xs text-slate-500 mt-1">{stats.activeSessions} active</p>
                )}
              </div>

              {/* Game Types */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-purple-100">
                    <Activity size={20} className="text-purple-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Game Types</p>
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {stats.gameTypes !== null ? stats.gameTypes : '—'}
                </p>
              </div>

              {/* Total Players (sessions player sum) */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-amber-100">
                    <Server size={20} className="text-amber-600" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Health Status</p>
                </div>
                <p className={`text-lg font-bold ${health ? 'text-green-600' : 'text-red-600'}`}>
                  {health ? 'Healthy' : healthError ? 'Unreachable' : 'Checking...'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-red-200">
          <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
            <AlertTriangle size={20} />
            Danger Zone
          </h3>
          <p className="text-sm text-red-700 mt-1">Irreversible actions — proceed with caution</p>
        </div>

        <div className="p-6 space-y-4">
          {!showResetConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Reset All Data</p>
                <p className="text-sm text-slate-600">
                  Delete all users, sessions, games, and hand history. This action cannot be undone.
                </p>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Reset Data
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="font-medium text-red-900 mb-2">Confirm System Reset</p>
                <p className="text-sm text-red-700">
                  This will permanently delete all data. Enter the admin setup key to confirm.
                </p>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Setup Key
                  </label>
                  <input
                    type="password"
                    value={resetKey}
                    onChange={(e) => setResetKey(e.target.value)}
                    placeholder="Enter admin setup key..."
                    className="w-full px-4 py-2 border border-red-300 rounded-lg focus:ring-2 focus:ring-red-500 text-slate-900"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleReset}
                  disabled={resetLoading || !resetKey.trim()}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {resetLoading ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                  {resetLoading ? 'Resetting...' : 'Confirm Reset'}
                </button>
                <button
                  onClick={() => { setShowResetConfirm(false); setResetKey(''); }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformSettings;