import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Users, Eye, Shield, Heart, Gamepad2, Clock, ArrowRight, Construction, HelpCircle, Play, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

const Welcome = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [selectedGame, setSelectedGame] = useState(null);
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Fetch available games
    useEffect(() => {
        fetch(`${API_URL}/api/v2/games`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setGames(data.games);
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    // Redirect logged-in users to their dashboard
    useEffect(() => {
        if (user) {
            if (user.role === 'ADMIN') {
                navigate('/admin');
            } else if (user.role === 'OPERATOR') {
                navigate('/operator/dashboard');
            }
            // PLAYER and GUEST stay on Welcome page to select games
        }
    }, [user, navigate]);

    const handleGameSelect = (game) => {
        if (game.status === 'coming-soon') return;
        
        if (user) {
            // User is logged in, check permissions
            if (user.role === 'ADMIN' || user.role === 'OPERATOR') {
                navigate(`/sessions/new?game=${game.code}`);
            } else {
                // For players/viewers, show join dialog
                setSelectedGame(game);
            }
        } else {
            // Guest - show options
            setSelectedGame(game);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
                <div className="text-white text-center">
                    <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-sm sm:text-base">Loading games...</p>
                </div>
            </div>
        );
    }

    if (selectedGame) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-violet-900 via-slate-900 to-black opacity-60"></div>
                
                <div className="relative z-10 max-w-lg w-full">
                    <button 
                        onClick={() => setSelectedGame(null)}
                        className="mb-4 sm:mb-6 text-white/70 hover:text-white flex items-center gap-2 transition-colors text-sm sm:text-base"
                    >
                        <ArrowRight className="rotate-180" size={18} />
                        Back to Games
                    </button>

                    <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8">
                        <div className="text-center mb-6 sm:mb-8">
                            <div className={`w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br ${selectedGame.color} rounded-xl sm:rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-xl`}>
                                <span className="text-3xl sm:text-4xl">{selectedGame.icon}</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">{selectedGame.name}</h1>
                            <p className="text-slate-500 text-sm sm:text-base">{selectedGame.description}</p>
                        </div>

                        <div className="space-y-3 sm:space-y-4">
                            {user?.role === 'ADMIN' || user?.role === 'OPERATOR' ? (
                                <button
                                    onClick={() => navigate(`/sessions/new?game=${selectedGame.code}`)}
                                    className="w-full py-3 sm:py-4 bg-gradient-to-r from-violet-600 to-pink-600 text-white rounded-xl font-bold text-base sm:text-lg hover:shadow-lg transition-all flex items-center justify-center gap-2"
                                >
                                    <Gamepad2 size={18} />
                                    Create New Session
                                </button>
                            ) : null}
                            
                            <button
                                onClick={() => navigate('/login')}
                                className="w-full py-3 sm:py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl font-bold text-base sm:text-lg hover:shadow-lg transition-all flex items-center justify-center gap-2"
                            >
                                <Eye size={18} />
                                Sign In to Watch
                            </button>

                            {!user && (
                                <button
                                    onClick={() => navigate('/login')}
                                    className="w-full py-3 sm:py-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-base sm:text-lg hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                                >
                                    <Shield size={18} />
                                    Sign In to Play
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Header */}
            <header className="border-b border-white/10 sticky top-0 z-50 bg-slate-900/95 backdrop-blur">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16 sm:h-20">
                        {/* Logo */}
                        <div className="flex items-center gap-2 sm:gap-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/30 flex-shrink-0">
                                <Heart size={20} className="sm:w-7 sm:h-7 text-white" />
                            </div>
                            <div className="hidden sm:block">
                                <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
                                    Funny <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-pink-400">Friends</span>
                                </h1>
                                <p className="text-xs lg:text-sm text-slate-400">Play games with friends, securely and for fun!</p>
                            </div>
                            <div className="sm:hidden">
                                <h1 className="text-lg font-black text-white">
                                    Funny <span className="text-violet-400">Friends</span>
                                </h1>
                            </div>
                        </div>
                        
                        {/* Desktop Navigation */}
                        <div className="hidden md:flex items-center gap-3 sm:gap-4">
                            <button
                                onClick={() => navigate('/help')}
                                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all text-sm"
                            >
                                <HelpCircle size={16} />
                                <span className="hidden lg:inline">Help</span>
                            </button>
                            <button
                                onClick={() => navigate('/login')}
                                className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-violet-500/20 text-sm"
                            >
                                <Shield size={16} />
                                Sign In
                            </button>
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden p-2 text-white hover:bg-white/10 rounded-xl transition-colors"
                        >
                            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                    </div>

                    {/* Mobile Menu */}
                    {mobileMenuOpen && (
                        <div className="md:hidden py-4 border-t border-white/10">
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => {
                                        navigate('/help');
                                        setMobileMenuOpen(false);
                                    }}
                                    className="flex items-center gap-3 px-4 py-3 text-white font-medium hover:bg-white/10 rounded-xl transition-colors"
                                >
                                    <HelpCircle size={20} />
                                    Help
                                </button>
                                <button
                                    onClick={() => {
                                        navigate('/login');
                                        setMobileMenuOpen(false);
                                    }}
                                    className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-600 to-pink-600 text-white font-bold rounded-xl transition-colors"
                                >
                                    <Shield size={20} />
                                    Sign In
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
                {/* Hero Section */}
                <div className="text-center mb-10 sm:mb-16">
                    <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-violet-500/20 rounded-full mb-4 sm:mb-6">
                        <Sparkles size={14} className="sm:w-4 sm:h-4 text-violet-400" />
                        <span className="text-violet-300 text-xs sm:text-sm font-medium">Choose Your Game</span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white mb-4 sm:mb-6">
                        Let's Play!
                    </h2>
                    <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto px-4">
                        Select a game to start playing with your friends.
                        Sign in to create and manage game sessions.
                    </p>
                </div>

                {/* Games Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 max-w-5xl mx-auto">
                    {games.map((game) => (
                        <div
                            key={game.code}
                            onClick={() => handleGameSelect(game)}
                            className={`group relative overflow-hidden rounded-2xl sm:rounded-3xl transition-all duration-300 hover:-translate-y-1 sm:hover:-translate-y-2 cursor-pointer ${
                                game.status === 'coming-soon' ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                        >
                            <div className={`absolute inset-0 bg-gradient-to-br ${game.color} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
                            
                            <div className="relative bg-slate-800/50 backdrop-blur border border-white/10 rounded-2xl sm:rounded-3xl p-5 sm:p-6 lg:p-8 h-full flex flex-col">
                                {game.status === 'coming-soon' && (
                                    <div className="absolute top-3 right-3 sm:top-4 sm:right-4 px-2 sm:px-3 py-0.5 sm:py-1 bg-orange-500/20 text-orange-400 text-xs font-bold rounded-full flex items-center gap-1">
                                        <Construction size={10} className="sm:w-3 sm:h-3" />
                                        <span className="hidden sm:inline">Coming Soon</span>
                                        <span className="sm:hidden">Soon</span>
                                    </div>
                                )}
                                
                                <div className={`w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 bg-gradient-to-br ${game.color} rounded-xl sm:rounded-2xl mb-4 sm:mb-6 flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform duration-300`}>
                                    <span className="text-2xl sm:text-3xl lg:text-4xl text-white">{game.icon}</span>
                                </div>
                                
                                <h3 className="text-lg sm:text-xl lg:text-2xl font-black text-white mb-2 sm:mb-3">{game.name}</h3>
                                <p className="text-slate-400 text-sm sm:text-base mb-4 sm:mb-6 flex-grow">{game.description}</p>
                                
                                <div className="flex items-center gap-4 text-xs sm:text-sm text-slate-500 mb-4 sm:mb-6">
                                    <span className="flex items-center gap-1">
                                        <Users size={12} className="sm:w-3.5 sm:h-3.5" /> {game.minPlayers}-{game.maxPlayers} players
                                    </span>
                                </div>
                                
                                <div className="pt-4 sm:pt-6 border-t border-white/10">
                                    {game.status === 'active' ? (
                                        <button className="w-full py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 group-hover:gap-3 text-sm sm:text-base">
                                            {user ? (
                                                <><Play size={16} /> <span className="hidden sm:inline">Play Now</span><span className="sm:hidden">Play</span></>
                                            ) : (
                                                <><Eye size={16} /> <span className="hidden sm:inline">Watch / Join</span><span className="sm:hidden">Join</span></>
                                            )}
                                            <ArrowRight size={16} />
                                        </button>
                                    ) : (
                                        <button disabled className="w-full py-2.5 sm:py-3 bg-white/5 text-white/50 font-bold rounded-xl cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base">
                                            <Construction size={16} /> Coming Soon
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* CTA Section */}
                {!user && (
                    <div className="mt-10 sm:mt-16 text-center px-4">
                        <div className="inline-flex flex-col items-center gap-4 p-6 sm:p-8 bg-white/5 rounded-2xl sm:rounded-3xl border border-white/10">
                            <p className="text-slate-400 text-sm sm:text-base">Want to create your own game sessions?</p>
                            <button
                                onClick={() => navigate('/login')}
                                className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-violet-600 to-pink-600 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-violet-500/30 transition-all flex items-center gap-2 text-sm sm:text-base"
                            >
                                <Shield size={18} />
                                Sign In as Operator
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default Welcome;
