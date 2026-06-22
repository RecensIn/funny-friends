import React, { useState, useEffect } from 'react';
import { useNavigate, NavLink, Outlet } from 'react-router-dom';
import { 
  LayoutDashboard, Users, Settings, Gamepad2, Shield, 
  Bell, LogOut, Menu, X, ChevronRight, Activity,
  UserCog, Key, BarChart3, Database
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const AdminControlPanel = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) {
        setSidebarOpen(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') {
      navigate('/');
    }
  }, [user, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const menuItems = [
    { 
      path: '/admin/dashboard', 
      label: 'Dashboard', 
      icon: LayoutDashboard,
      description: 'Overview & Analytics'
    },
    { 
      path: '/admin/users', 
      label: 'User Management', 
      icon: Users,
      description: 'Manage all users'
    },
    { 
      path: '/admin/permissions', 
      label: 'Permissions', 
      icon: Shield,
      description: 'Game access control'
    },
    { 
      path: '/admin/games', 
      label: 'Games & Sessions', 
      icon: Gamepad2,
      description: 'Manage game sessions'
    },
    { 
      path: '/admin/settings', 
      label: 'Platform Settings', 
      icon: Settings,
      description: 'System configuration'
    },
    { 
      path: '/admin/monitoring', 
      label: 'Monitoring', 
      icon: Activity,
      description: 'System health & logs'
    },
  ];

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && isMobile && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
          ${isMobile ? 'fixed' : 'relative'}
          w-72 bg-slate-800 border-r border-slate-700 transition-transform duration-300 flex flex-col
          h-full z-50 lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="p-4 sm:p-6 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-violet-500 to-violet-700 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield size={18} className="sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-base sm:text-lg leading-tight text-slate-50 truncate">Admin Panel</h1>
              <p className="text-xs text-slate-400">Control Center</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 sm:py-6 px-2 sm:px-3 space-y-1 overflow-y-auto" role="navigation" aria-label="Admin navigation">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => isMobile && setSidebarOpen(false)}
              aria-current="page"
              className={({ isActive }) => `
                flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800
                ${isActive 
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25' 
                  : 'text-slate-400 hover:bg-slate-700 hover:text-slate-100'
                }
              `}
            >
              <item.icon size={18} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{item.label}</p>
                <p className="text-xs text-slate-500 truncate hidden sm:block">{item.description}</p>
              </div>
            </NavLink>
          ))}
        </nav>

        {/* User Profile */}
        <div className="p-3 sm:p-4 border-t border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-200 truncate">{user?.username}</p>
              <p className="text-xs text-violet-400">Administrator</p>
            </div>
          </div>
          
          <button
            onClick={handleLogout}
            className="mt-3 w-full flex items-center gap-2 px-3 sm:px-4 py-2 text-slate-400 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors text-sm"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sign Out</span>
            <span className="sm:hidden">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Header */}
        <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-30">
          <div className="flex items-center justify-between px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <Menu size={20} className="text-slate-400" />
              </button>
              
              <div>
                <h2 className="text-base sm:text-lg lg:text-xl font-bold text-slate-50">Administrator Control Panel</h2>
                <p className="text-xs sm:text-sm text-slate-400 hidden sm:block">Manage users, permissions, and platform settings</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {/* Notifications */}
              <button className="relative p-2 hover:bg-slate-700 rounded-lg transition-colors">
                <Bell size={20} className="text-slate-400" />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>

              {/* Quick Actions */}
              <button 
                onClick={() => navigate('/sessions/new')}
                className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors text-sm"
              >
                Create Session
              </button>
              {/* Mobile create button */}
              <button 
                onClick={() => navigate('/sessions/new')}
                className="sm:hidden p-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
              >
                <Gamepad2 size={20} />
              </button>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 bg-slate-900">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminControlPanel;
