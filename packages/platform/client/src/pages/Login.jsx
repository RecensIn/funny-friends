import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, AlertCircle, ArrowLeft, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login: useAuthLogin } = useAuth();

  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
      if (user) {
        const from = location.state?.from || '/';
        if (user.role === 'ADMIN') {
          navigate('/admin');
        } else if (user.role === 'OPERATOR') {
          navigate('/operator/dashboard');
        } else {
          navigate(from);
        }
      }
  }, [user, navigate, location]);

  // Check if setup is needed
  useEffect(() => {
    fetch(`${API_URL}/api/setup/status`)
      .then(res => res.json())
      .then(data => {
        if (data.needsSetup) {
          setNeedsSetup(true);
        }
      })
      .catch(() => { });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await useAuthLogin(credentials.username, credentials.password);

      if (result.success) {
        // Navigate based on role (returned from API via context)
        if (result.user?.redirectTo) {
          navigate(result.user.redirectTo);
        } else {
          navigate('/');
        }
      } else {
        if (result.details?.needsSetup) {
          navigate('/system-setup');
          return;
        }

        setError(result.error || 'Login failed. Please check your credentials.');
      }
    } catch (e) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (needsSetup) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-violet-900 via-slate-900 to-black opacity-60"></div>

        <div className="relative z-10 bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-violet-600 to-pink-600 rounded-xl sm:rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <Sparkles className="text-white" size={28} />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mb-2">System Setup Required</h1>
          <p className="text-slate-500 mb-6 text-sm sm:text-base">
            This is a fresh installation. Please create the first admin user to get started.
          </p>
          <button
            onClick={() => navigate('/system-setup')}
            className="w-full py-3 sm:py-4 bg-gradient-to-r from-violet-600 to-pink-600 text-white rounded-xl font-bold text-base sm:text-lg hover:shadow-lg transition-all"
          >
            Start Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-violet-900 via-slate-900 to-black opacity-60"></div>

      <div className="relative z-10 w-full max-w-md">
        <button
          onClick={() => navigate('/')}
          className="absolute -top-10 sm:-top-12 left-0 text-white/70 hover:text-white flex items-center gap-2 transition-colors text-sm sm:text-base"
        >
          <ArrowLeft size={18} />
          Back to Home
        </button>

        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-violet-600 to-pink-600 rounded-xl sm:rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg">
              <Lock className="text-white" size={28} />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">Welcome Back</h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">
              Sign in to access your games and manage sessions
            </p>
          </div>

          {error && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                  className="w-full pl-11 sm:pl-12 pr-4 py-3 sm:py-3.5 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-violet-500 focus:bg-white outline-none transition-all text-sm sm:text-base"
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                  className="w-full pl-11 sm:pl-12 pr-11 sm:pr-12 py-3 sm:py-3.5 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-slate-900 focus:border-violet-500 focus:bg-white outline-none transition-all text-sm sm:text-base"
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 sm:py-4 bg-gradient-to-r from-violet-600 to-pink-600 text-white rounded-xl font-bold text-base sm:text-lg hover:shadow-lg hover:shadow-violet-500/30 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span className="text-sm sm:text-base">Signing in...</span>
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-slate-100 text-center">
            <p className="text-slate-500 text-xs sm:text-sm">
              Don't have an account? Contact your administrator for access.
            </p>
          </div>

          <div className="mt-3 sm:mt-4 text-center">
            <button
              onClick={() => navigate('/', { state: { showViewer: true } })}
              className="text-violet-600 font-bold text-xs sm:text-sm hover:text-violet-700 transition-colors"
            >
              Watch as Guest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
