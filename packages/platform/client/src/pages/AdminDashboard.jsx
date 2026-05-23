import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Gamepad2, Plus, Trash2, Eye, X, Heart, Activity, BarChart3, UserPlus, CheckCircle, AlertCircle, Clock, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

const AdminDashboard = () => {
    const navigate = useNavigate();
    const { logout, user } = useAuth();
    const [adminSessions, setAdminSessions] = useState([]);
    const [adminUsers, setAdminUsers] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessionDetails, setSessionDetails] = useState(null);
    const [showSessionModal, setShowSessionModal] = useState(false);
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [availableGames, setAvailableGames] = useState([]);
    const [newUser, setNewUser] = useState({ username: '', password: '', role: '', allowedGames: [] });
    const [createError, setCreateError] = useState('');
    const [createSuccess, setCreateSuccess] = useState('');
    const [playerRequests, setPlayerRequests] = useState([]);
    const [requestsLoading, setRequestsLoading] = useState(false);

    // System Reset
    const [showResetModal, setShowResetModal] = useState(false);
    const [setupKey, setSetupKey] = useState('');
    const [resetLoading, setResetLoading] = useState(false);

    const isAdmin = user?.role === 'ADMIN';

    useEffect(() => {
        if (!isAdmin) return;
        fetchGameTypes();
        fetchData();
    }, [isAdmin]);

    // Fetch games when create user modal opens (in case initial fetch failed)
    useEffect(() => {
        if (showCreateUserModal && availableGames.length === 0) {
            fetchGameTypes();
        }
    }, [showCreateUserModal]);

    const fetchGameTypes = async () => {
        try {
            const res = await fetch(`${API_URL}/api/gametypes`, { credentials: 'include' });
            if (res.ok) {
                const games = await res.json();
                setAvailableGames(games.filter(g => g.isActive));
                console.log('[Admin] Loaded', games.length, 'game types');
            } else {
                console.error('[Admin] Failed to fetch game types:', res.status);
            }
        } catch (e) {
            console.error('[Admin] Error fetching game types:', e);
        }
    };

    const handleResetDatabase = async (e) => {
        e.preventDefault();
        setResetLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/setup/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ setupKey }),
                credentials: 'include'
            });

            if (res.ok) {
                alert('System reset successful. Redirecting to setup...');
                await logout();
                navigate('/system-setup');
            } else {
                const data = await res.json();
                alert(data.error || 'Reset failed');
            }
        } catch (e) {
            console.error(e);
            alert('Error resetting system');
        } finally {
            setResetLoading(false);
            setShowResetModal(false);
            setSetupKey('');
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setCreateError('');
        setCreateSuccess('');

        if (!newUser.role) {
            setCreateError('Please select a role');
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/admin/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser),
                credentials: 'include'
            });

            if (res.ok) {
                setCreateSuccess('User created successfully!');
                setNewUser({ username: '', password: '', role: '', allowedGames: [] });
                fetchData();
                setTimeout(() => {
                    setShowCreateUserModal(false);
                    setCreateSuccess('');
                }, 1500);
            } else {
                const data = await res.json();
                setCreateError(data.error || 'Failed to create user');
            }
        } catch (e) {
            setCreateError('Error creating user');
        }
    };

    const toggleGameSelection = (gameId) => {
        setNewUser(prev => {
            const current = prev.allowedGames || [];
            if (current.includes(gameId)) {
                return { ...prev, allowedGames: current.filter(id => id !== gameId) };
            } else {
                return { ...prev, allowedGames: [...current, gameId] };
            }
        });
    };

    const handleApprovePlayerRequest = async (requestId) => {
        setRequestsLoading(true);
        try {
            // A2 FIX: Use correct endpoint with approved flag
            const res = await fetch(`${API_URL}/api/admin/player-requests/${requestId}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approved: true }),
                credentials: 'include'
            });
            if (res.ok) {
                setPlayerRequests(prev => prev.filter(r => r.id !== requestId));
                fetchData();
            } else {
                console.error('Failed to approve request');
            }
        } catch (e) {
            console.error('Error approving request:', e);
        } finally {
            setRequestsLoading(false);
        }
    };

    const handleDeclinePlayerRequest = async (requestId) => {
        setRequestsLoading(true);
        try {
            // A2 FIX: Use correct endpoint with approved flag
            const res = await fetch(`${API_URL}/api/admin/player-requests/${requestId}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approved: false }),
                credentials: 'include'
            });
            if (res.ok) {
                setPlayerRequests(prev => prev.filter(r => r.id !== requestId));
            } else {
                console.error('Failed to decline request');
            }
        } catch (e) {
            console.error('Error declining request:', e);
        } finally {
            setRequestsLoading(false);
        }
    };

    const handleApproveAllRequests = async (sessionName) => {
        setRequestsLoading(true);
        try {
            // A2 FIX: Use correct endpoint
            const res = await fetch(`${API_URL}/api/admin/sessions/${sessionName}/approve-all-players`, {
                method: 'POST',
                credentials: 'include'
            });
            if (res.ok) {
                setPlayerRequests(prev => prev.filter(r => r.session.name !== sessionName));
                fetchData();
            } else {
                console.error('Failed to approve all requests');
            }
        } catch (e) {
            console.error('Error approving all requests:', e);
        } finally {
            setRequestsLoading(false);
        }
    };

    const fetchData = async () => {
        try {
            const [sessionsRes, usersRes, requestsRes] = await Promise.all([
                fetch(`${API_URL}/api/admin/sessions`, { credentials: 'include' }),
                fetch(`${API_URL}/api/admin/users`, { credentials: 'include' }),
                fetch(`${API_URL}/api/admin/player-requests`, { credentials: 'include' })
            ]);

            if (sessionsRes.ok) {
                const sessions = await sessionsRes.json();
                setAdminSessions(sessions);
            }
            if (usersRes.ok) {
                const users = await usersRes.json();
                setAdminUsers(users);
            }
            if (requestsRes.ok) {
                const requests = await requestsRes.json();
                setPlayerRequests(requests);
            }
        } catch (e) {
            console.error('Failed to fetch data', e);
        }
    };

    const handleDeleteUser = async (userId) => {
        if (!confirm('Are you sure you want to delete this user?')) return;

        try {
            const res = await fetch(`${API_URL}/api/admin/users/${userId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (res.ok) {
                setAdminUsers(adminUsers.filter(u => u.id !== userId));
            } else {
                alert('Failed to delete user');
            }
        } catch (e) {
            alert('Error deleting user');
        }
    };

    const handleEndSession = async (sessionName) => {
        if (!confirm(`End session "${sessionName}"?`)) return;

        try {
            const res = await fetch(`${API_URL}/api/admin/sessions/${sessionName}/end`, {
                method: 'POST',
                credentials: 'include'
            });

            if (res.ok) {
                fetchData();
            } else {
                alert('Failed to end session');
            }
        } catch (e) {
            alert('Error ending session');
        }
    };

    const handleDeleteSession = async (sessionName) => {
        if (!confirm(`Permanently delete "${sessionName}"? This cannot be undone.`)) return;

        try {
            const res = await fetch(`${API_URL}/api/admin/sessions/${sessionName}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (res.ok) {
                fetchData();
            } else {
                alert('Failed to delete session');
            }
        } catch (e) {
            alert('Error deleting session');
        }
    };

    const handleViewSession = async (sessionName) => {
        try {
            const [sessionRes, requestsRes] = await Promise.all([
                fetch(`${API_URL}/api/admin/sessions/${sessionName}`, { credentials: 'include' }),
                fetch(`${API_URL}/api/sessions/${sessionName}/player-requests`, { credentials: 'include' })
            ]);

            if (sessionRes.ok) {
                const sessionData = await sessionRes.json();
                const requestsData = requestsRes.ok ? await requestsRes.json() : [];
                setSessionDetails({ ...sessionData, playerRequests: requestsData });
                setSelectedSession(sessionName);
                setShowSessionModal(true);
            }
        } catch (e) {
            alert('Error fetching session details');
        }
    };

    const activeSessions = adminSessions.filter(s => s.isActive);
    const endedSessions = adminSessions.filter(s => !s.isActive);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => navigate('/')}
                                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                <ArrowLeft className="text-slate-600" size={24} />
                            </button>
                            <div>
                                <h1 className="text-2xl font-black text-slate-900">Admin Dashboard</h1>
                                <p className="text-sm text-slate-500">System Administration Panel</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowCreateUserModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all"
                            >
                                <UserPlus size={18} /> Add User
                            </button>
                            <button
                                onClick={() => navigate('/sessions/new')}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all"
                            >
                                <Gamepad2 size={18} /> New Game
                            </button>
                            <button
                                onClick={() => { logout(); navigate('/'); }}
                                className="flex items-center gap-2 px-4 py-2 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-colors"
                            >
                                <Trash2 size={18} /> Logout
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg shadow-green-500/20">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-100 font-medium mb-1">System Status</p>
                                <p className="text-2xl font-black">Online</p>
                            </div>
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <Activity size={24} className="text-white" />
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                            <span className="text-sm text-green-100">All systems operational</span>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-500 font-medium mb-1">Active Games</p>
                                <p className="text-3xl font-black text-slate-900">{activeSessions.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                <Gamepad2 size={24} className="text-green-600" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-500 font-medium mb-1">Total Games</p>
                                <p className="text-3xl font-black text-slate-900">{adminSessions.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <BarChart3 size={24} className="text-blue-600" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-500 font-medium mb-1">Total Users</p>
                                <p className="text-3xl font-black text-slate-900">{adminUsers.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Users size={24} className="text-purple-600" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Player Addition Requests Section */}
                {playerRequests.length > 0 && (
                    <div className="mb-8">
                        <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-6 text-white shadow-lg shadow-orange-500/20">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                        <UserPlus size={24} className="text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black">Player Addition Requests</h2>
                                        <p className="text-orange-100">{playerRequests.length} pending request(s)</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                {/* Group requests by session */}
                                {Object.entries(
                                    playerRequests.reduce((acc, req) => {
                                        if (!acc[req.session.name]) acc[req.session.name] = [];
                                        acc[req.session.name].push(req);
                                        return acc;
                                    }, {})
                                ).map(([sessionName, requests]) => (
                                    <div key={sessionName} className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <span className="font-bold text-lg">{sessionName}</span>
                                                <span className="text-orange-100 text-sm ml-2">
                                                    Round {requests[0].session.currentRound}/{requests[0].session.totalRounds}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleApproveAllRequests(sessionName)}
                                                disabled={requestsLoading}
                                                className="px-4 py-2 bg-white text-orange-600 rounded-lg font-bold hover:bg-orange-50 transition-colors disabled:opacity-50"
                                            >
                                                Approve All ({requests.length})
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {requests.map(req => (
                                                <div key={req.id} className="flex items-center justify-between bg-white/10 rounded-lg p-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center font-bold">
                                                            {req.playerName[0].toUpperCase()}
                                                        </div>
                                                        <span className="font-medium">{req.playerName}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleApprovePlayerRequest(req.id)}
                                                            disabled={requestsLoading}
                                                            className="px-3 py-1.5 bg-green-500 hover:bg-green-600 rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                                                        >
                                                            Approve
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeclinePlayerRequest(req.id)}
                                                            disabled={requestsLoading}
                                                            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                                                        >
                                                            Decline
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Sessions Section */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Active Games */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                        <Gamepad2 size={20} className="text-green-600" />
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-900">Active Games</h2>
                                </div>
                                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full">
                                    {activeSessions.length}
                                </span>
                            </div>

                            {activeSessions.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">
                                    No active games running
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {activeSessions.map(session => (
                                        <div key={session.id} className="p-4 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="font-bold text-slate-900">{session.name}</h3>
                                                    <p className="text-sm text-slate-500">
                                                        Created {new Date(session.createdAt).toLocaleString()}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="px-3 py-1 bg-green-100 text-green-600 text-xs font-bold rounded-full">
                                                        LIVE
                                                    </span>
                                                    <button
                                                        onClick={() => handleViewSession(session.name)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="View"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleEndSession(session.name)}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="End"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Game History */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                                        <Clock size={20} className="text-slate-600" />
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-900">Game History</h2>
                                </div>
                                <span className="px-3 py-1 bg-slate-100 text-slate-700 text-sm font-bold rounded-full">
                                    {endedSessions.length}
                                </span>
                            </div>

                            {endedSessions.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">
                                    No completed games
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                                    {endedSessions.map(session => (
                                        <div key={session.id} className="p-4 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="font-bold text-slate-900">{session.name}</h3>
                                                    <p className="text-sm text-slate-500">
                                                        Ended {new Date(session.createdAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">
                                                        ENDED
                                                    </span>
                                                    <button
                                                        onClick={() => handleViewSession(session.name)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="View Results"
                                                    >
                                                        <Eye size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteSession(session.name)}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Users Section */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-6 border-b border-slate-100">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                        <Users size={20} className="text-purple-600" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-slate-900">User Management</h2>
                                        <p className="text-sm text-slate-500">{adminUsers.length} total users</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowCreateUserModal(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 transition-colors"
                                >
                                    <UserPlus size={18} />
                                    Add User
                                </button>
                            </div>
                        </div>

                        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                            {adminUsers.length === 0 ? (
                                <div className="p-8 text-center text-slate-500">
                                    <Users size={48} className="mx-auto mb-3 opacity-20" />
                                    <p>No users found</p>
                                    <p className="text-sm mt-1">Create your first user to get started</p>
                                </div>
                            ) : (
                                adminUsers.map(u => (
                                    <div key={u.id} className="p-4 hover:bg-slate-50 transition-colors">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                                                    u.role === 'ADMIN' ? 'bg-red-100 text-red-600' :
                                                    u.role === 'OPERATOR' ? 'bg-blue-100 text-blue-600' :
                                                    'bg-slate-200 text-slate-600'
                                                }`}>
                                                    {u.username[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-bold text-slate-900">{u.username}</p>
                                                        {u.id === user.id && (
                                                            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded font-medium">
                                                                You
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                                            u.role === 'ADMIN' ? 'bg-red-100 text-red-600' :
                                                            u.role === 'OPERATOR' ? 'bg-blue-100 text-blue-600' :
                                                            'bg-slate-100 text-slate-600'
                                                        }`}>
                                                            {u.role}
                                                        </span>
                                                        {u.createdAt && (
                                                            <span className="text-xs text-slate-400">
                                                                Created {new Date(u.createdAt).toLocaleDateString()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {u.id !== user.id && u.id !== 1 && (
                                                    <button
                                                        onClick={() => handleDeleteUser(u.id)}
                                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Delete User"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
                {/* Danger Zone */}
                <div className="bg-red-50 border-2 border-red-100 rounded-3xl p-6 md:p-8 mt-12">
                    <h2 className="text-xl font-bold text-red-800 flex items-center gap-2 mb-4">
                        <AlertCircle className="text-red-600" />
                        Danger Zone
                    </h2>
                    <p className="text-red-600/80 mb-6 max-w-2xl">
                        These actions are destructive and cannot be undone. Please be certain before proceeding.
                    </p>
                    <button
                        onClick={() => setShowResetModal(true)}
                        className="px-6 py-3 bg-white border-2 border-red-200 text-red-600 font-bold rounded-xl hover:bg-red-600 hover:text-white hover:border-red-600 transition-all shadow-sm"
                    >
                        Reset System Database
                    </button>
                </div>
            </main>

            {/* Create User Modal */}
            {showCreateUserModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <UserPlus size={24} className="text-blue-600" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-900">Add New User</h2>
                                    <p className="text-sm text-slate-500">Create operator or admin account</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowCreateUserModal(false)}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X size={24} className="text-slate-400" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateUser} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Username</label>
                                <input
                                    type="text"
                                    value={newUser.username}
                                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-blue-500 outline-none transition-all"
                                    placeholder="Enter username"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
                                <input
                                    type="password"
                                    value={newUser.password}
                                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-blue-500 outline-none transition-all"
                                    placeholder="Enter password"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Role</label>
                                <select
                                    value={newUser.role}
                                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-blue-500 outline-none transition-all"
                                    required
                                >
                                    <option value="">Select Role</option>
                                    <option value="OPERATOR">Operator</option>
                                    <option value="ADMIN">Admin</option>
                                </select>
                            </div>

                            {/* Game Access Selection */}
                            {(newUser.role === 'OPERATOR' || newUser.role === 'ADMIN') && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">
                                        Allowed Games 
                                        <span className="text-slate-400 font-normal text-xs ml-2">
                                            ({availableGames.length} available)
                                        </span>
                                    </label>
                                    {availableGames.length === 0 ? (
                                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
                                            <div className="flex items-center gap-2">
                                                <AlertCircle size={16} />
                                                <span>No games available. Please check game configuration.</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                                            {availableGames.map(game => (
                                                <div
                                                    key={game.id}
                                                    onClick={() => toggleGameSelection(game.id)}
                                                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-2 ${newUser.allowedGames?.includes(game.id)
                                                        ? 'border-blue-500 bg-blue-50'
                                                        : 'border-slate-200 hover:border-slate-300'
                                                        }`}
                                                >
                                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${newUser.allowedGames?.includes(game.id)
                                                        ? 'bg-blue-500 border-blue-500'
                                                        : 'border-slate-300 bg-white'
                                                        }`}>
                                                        {newUser.allowedGames?.includes(game.id) && <CheckCircle size={14} className="text-white" />}
                                                    </div>
                                                    <span className="font-bold text-sm text-slate-700">{game.name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {createError && (
                                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
                                    <AlertCircle size={16} />
                                    {createError}
                                </div>
                            )}

                            {createSuccess && (
                                <div className="flex items-center gap-2 p-3 bg-green-50 text-green-600 rounded-xl text-sm">
                                    <CheckCircle size={16} />
                                    {createSuccess}
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateUserModal(false)}
                                    className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors"
                                >
                                    Create User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Session Details Modal */}
            {showSessionModal && sessionDetails && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900">{sessionDetails.name}</h2>
                                <p className="text-sm text-slate-500">
                                    {new Date(sessionDetails.createdAt).toLocaleString()} • {sessionDetails.totalRounds} Rounds
                                </p>
                            </div>
                            <button
                                onClick={() => setShowSessionModal(false)}
                                className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X size={24} className="text-slate-600" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto max-h-[60vh]">
                            {/* Pending Player Requests */}
                            {sessionDetails.playerRequests?.filter(r => r.status === 'PENDING').length > 0 && (
                                <div className="mb-6">
                                    <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                        <UserPlus size={18} className="text-orange-500" />
                                        Pending Player Requests ({sessionDetails.playerRequests.filter(r => r.status === 'PENDING').length})
                                    </h3>
                                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                                        <div className="space-y-2">
                                            {sessionDetails.playerRequests
                                                .filter(r => r.status === 'PENDING')
                                                .map(request => (
                                                    <div key={request.id} className="flex items-center justify-between bg-white p-3 rounded-lg">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center font-bold">
                                                                {request.playerName[0].toUpperCase()}
                                                            </div>
                                                            <span className="font-medium text-slate-800">{request.playerName}</span>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleApprovePlayerRequest(request.id)}
                                                                disabled={requestsLoading}
                                                                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeclinePlayerRequest(request.id)}
                                                                disabled={requestsLoading}
                                                                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
                                                            >
                                                                Decline
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Players */}
                            <div className="mb-6">
                                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                    <Users size={18} className="text-blue-500" />
                                    Players ({sessionDetails.players?.length || 0})
                                </h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {sessionDetails.players?.map(player => (
                                        <div key={player.id} className="bg-slate-50 p-3 rounded-xl flex justify-between items-center border border-slate-100">
                                            <span className="font-medium text-slate-800">{player.name}</span>
                                            <span className={`text-xs px-2 py-1 rounded font-bold ${player.sessionBalance >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                }`}>
                                                {player.sessionBalance >= 0 ? '+' : ''}{player.sessionBalance}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Game Hands */}
                            <div>
                                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                    <Gamepad2 size={18} className="text-yellow-500" />
                                    Game Results ({sessionDetails.hands?.length || 0} hands)
                                </h3>

                                {sessionDetails.hands?.length === 0 ? (
                                    <p className="text-slate-500 text-center py-8">No hands recorded for this session</p>
                                ) : (
                                    <div className="space-y-3">
                                        {sessionDetails.hands?.map((hand, index) => (
                                            <div key={hand.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center gap-3">
                                                        <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">
                                                            #{sessionDetails.hands.length - index}
                                                        </span>
                                                        <span className="text-xs text-slate-400">
                                                            {new Date(hand.createdAt).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-xs text-slate-500 block">Pot</span>
                                                        <p className="font-bold text-green-600">{hand.potSize}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                                                    <Trophy size={16} className="text-yellow-500" />
                                                    <span className="font-bold text-slate-800">Winner: {hand.winner}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-center">
                            <button
                                onClick={() => setShowSessionModal(false)}
                                className="px-8 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-700 transition-colors flex items-center gap-2"
                            >
                                <X size={18} /> Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Reset Confirmation Modal */}
            {showResetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border-2 border-slate-100 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-slate-800">Confirm System Reset</h2>
                            <button onClick={() => setShowResetModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-start gap-3">
                            <AlertCircle className="shrink-0 mt-0.5" size={20} />
                            <p className="text-sm font-medium">
                                Warning: This will delete ALL users, game sessions, and player data permanently. The system will return to the initial setup state.
                            </p>
                        </div>

                        <form onSubmit={handleResetDatabase} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">
                                    Admin Setup Key
                                </label>
                                <input
                                    type="password"
                                    value={setupKey}
                                    onChange={(e) => setSetupKey(e.target.value)}
                                    placeholder="Enter setup key to confirm"
                                    className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-red-500 focus:bg-white outline-none transition-all"
                                    required
                                />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowResetModal(false)}
                                    className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={resetLoading || !setupKey}
                                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {resetLoading ? 'Resetting...' : 'Confirm Reset'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
