import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, LogOut, Trophy, Users, Clock, Eye, Trash2, ChevronRight, X, ArrowLeft, Gamepad2, Activity, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

const OperatorDashboard = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const [mySessions, setMySessions] = useState([]);
    const [endedSessions, setEndedSessions] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessionDetails, setSessionDetails] = useState(null);
    const [showSessionModal, setShowSessionModal] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user || (user.role !== 'OPERATOR' && user.role !== 'ADMIN')) {
            navigate('/');
            return;
        }

        fetchSessions();
    }, [user, navigate]);

    const fetchSessions = async () => {
        setLoading(true);

        try {
            const res = await fetch(`${API_URL}/api/admin/sessions`, { 
                credentials: 'include'
            });
            
            if (res.ok) {
                const sessions = await res.json();
                const active = sessions.filter(s => s.isActive);
                const ended = sessions.filter(s => !s.isActive);
                setMySessions(active);
                setEndedSessions(ended);
            }
        } catch (e) {
            console.error('Failed to fetch sessions', e);
        } finally {
            setLoading(false);
        }
    };

    const handleViewSession = async (sessionName) => {
        try {
            const res = await fetch(`${API_URL}/api/admin/sessions/${sessionName}`, {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setSessionDetails(data);
                setSelectedSession(sessionName);
                setShowSessionModal(true);
            } else {
                alert('Failed to fetch session details');
            }
        } catch (e) {
            console.error(e);
            alert('Error fetching session details');
        }
    };

    const handleEndSession = async (sessionName) => {
        if (!confirm(`Are you sure you want to end session "${sessionName}"?`)) return;

        try {
            const res = await fetch(`${API_URL}/api/admin/sessions/${sessionName}/end`, {
                method: 'POST',
                credentials: 'include'
            });
            if (res.ok) {
                alert('Session ended');
                fetchSessions();
            } else {
                alert('Failed to end session');
            }
        } catch (e) {
            console.error(e);
            alert('Error ending session');
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    if (!user || (user.role !== 'OPERATOR' && user.role !== 'ADMIN')) {
        return null;
    }

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
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center">
                                    <Users className="text-white" size={20} />
                                </div>
                                <div>
                                    <h1 className="text-xl font-black text-slate-900">Operator Dashboard</h1>
                                    <p className="text-sm text-slate-500">Welcome back, {user.username}</p>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => navigate('/sessions/new')}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors"
                            >
                                <Plus size={18} /> New Game
                            </button>
                            <button 
                                onClick={handleLogout}
                                className="flex items-center gap-2 px-4 py-2 text-red-500 font-bold hover:bg-red-50 rounded-xl transition-colors"
                            >
                                <LogOut size={18} /> Logout
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Stats */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl p-6 text-white shadow-lg shadow-green-500/20">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-100 font-medium mb-1">Active Games</p>
                                <p className="text-3xl font-black">{mySessions.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <Activity size={24} className="text-white" />
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                            <span className="text-sm text-green-100">Currently running</span>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-500 font-medium mb-1">Game History</p>
                                <p className="text-3xl font-black text-slate-900">{endedSessions.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center">
                                <Clock className="text-slate-500" size={24} />
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-500 font-medium mb-1">Your Role</p>
                                <p className="text-3xl font-black text-slate-900">{user.role}</p>
                            </div>
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Users className="text-blue-600" size={24} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Active Games */}
                <div className="mb-12">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            Active Games
                        </h2>
                        {mySessions.length > 0 && (
                            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full">
                                {mySessions.length} running
                            </span>
                        )}
                    </div>
                    
                    {mySessions.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
                            <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Gamepad2 size={40} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No Active Games</h3>
                            <p className="text-slate-500 mb-6">Create a new game to get started</p>
                            <button 
                                onClick={() => navigate('/sessions/new')}
                                className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors"
                            >
                                Start New Game
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {mySessions.map(session => (
                                <div key={session.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:border-blue-300 transition-colors">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-900">{session.name}</h3>
                                            <p className="text-sm text-slate-500">
                                                Created {new Date(session.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <span className="px-3 py-1 bg-green-100 text-green-600 text-xs font-bold rounded-full flex items-center gap-1">
                                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                            LIVE
                                        </span>
                                    </div>
                                    
                                    <div className="flex items-center gap-6 text-sm text-slate-500 mb-6">
                                        <span className="flex items-center gap-1">
                                            <Users size={16} /> {session._count?.hands || 0} hands played
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Trophy size={16} /> Round {session.currentRound}/{session.totalRounds}
                                        </span>
                                    </div>
                                    
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => navigate(`/game/${session.name}`)}
                                            className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors"
                                        >
                                            Continue Game
                                        </button>
                                        <button 
                                            onClick={() => handleViewSession(session.name)}
                                            className="p-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                                            title="View Details"
                                        >
                                            <Eye size={20} />
                                        </button>
                                        <button 
                                            onClick={() => handleEndSession(session.name)}
                                            className="p-3 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-colors"
                                            title="End Game"
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Ended Games */}
                {endedSessions.length > 0 && (
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-2">
                            <Clock className="text-slate-400" size={24} />
                            Game History
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {endedSessions.map(session => (
                                <div key={session.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 opacity-75 hover:opacity-100 transition-opacity">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-900">{session.name}</h3>
                                            <p className="text-sm text-slate-500">
                                                Ended {new Date(session.createdAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <span className="px-3 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">
                                            ENDED
                                        </span>
                                    </div>
                                    
                                    <div className="flex items-center gap-6 text-sm text-slate-500 mb-6">
                                        <span className="flex items-center gap-1">
                                            <Users size={16} /> {session._count?.hands || 0} hands played
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <CheckCircle size={16} /> Completed
                                        </span>
                                    </div>
                                    
                                    <button 
                                        onClick={() => handleViewSession(session.name)}
                                        className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                                    >
                                        View Results <ChevronRight size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

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
                                className="p-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                <X size={24} className="text-slate-600" />
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto max-h-[60vh]">
                            {/* Players */}
                            <div className="mb-6">
                                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                    <Users size={20} className="text-blue-500" />
                                    Players ({sessionDetails.players?.length || 0})
                                </h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {sessionDetails.players?.map(player => (
                                        <div key={player.id} className="bg-slate-50 p-3 rounded-xl flex justify-between items-center border border-slate-100">
                                            <span className="font-medium text-slate-800">{player.name}</span>
                                            <span className={`text-xs px-2 py-1 rounded font-bold ${
                                                player.sessionBalance >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
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
                                    <Trophy size={20} className="text-yellow-500" /> 
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
        </div>
    );
};

export default OperatorDashboard;
