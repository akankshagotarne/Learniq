import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Search, Menu, X, ChevronDown, LogOut, User, Settings, BookOpen, Home } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LogoLink } from '../ui/Logo';
import api from '../../services/api';
import { Notification } from '../../types';

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (user) {
      api.get('/notifications').then(r => setNotifications(r.data.notifications || [])).catch(() => {});
    }
  }, [user]);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`/courses?search=${encodeURIComponent(searchQuery)}`);
  };

  const getDashboardPath = () => {
    if (!user) return '/';
    if (user.role === 'admin') return '/admin';
    if (user.role === 'teacher') return '/teacher';
    return '/student';
  };

  const navLinks = [
    { label: 'Home', href: '/', icon: Home },
    { label: 'Courses', href: '/courses', icon: BookOpen },
    { label: 'Live Classes', href: '/live-sessions', icon: null },
    { label: 'About', href: '/about', icon: null },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled ? 'bg-dark-800/90 backdrop-blur-xl border-b border-white/10 shadow-lg' : 'bg-transparent'
    }`}>
      <div className="page-container">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <LogoLink size="md" />

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.label}
                to={link.href}
                className="px-4 py-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg text-sm font-medium transition-all duration-200"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-3">
            {/* Search */}
            <form onSubmit={handleSearch} className="hidden md:flex items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search courses..."
                  className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-white placeholder-white/40
                    focus:outline-none focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 w-48 focus:w-64 transition-all"
                />
              </div>
            </form>

            {user ? (
              <>
                {/* Notifications */}
                <div className="relative">
                  <button
                    onClick={() => { setShowNotifs(!showNotifs); setIsProfileOpen(false); }}
                    className="relative p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
                  >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-secondary-500 rounded-full flex items-center justify-center text-xs font-bold text-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifs && (
                    <div className="absolute right-0 top-12 w-80 glass-card py-2 shadow-2xl animate-slide-down z-50">
                      <div className="px-4 py-2 border-b border-white/10">
                        <p className="text-sm font-semibold text-white">Notifications</p>
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="text-white/40 text-sm text-center py-6">No notifications</p>
                        ) : (
                          notifications.slice(0, 10).map(n => (
                            <div key={n._id} className={`px-4 py-3 hover:bg-white/5 cursor-pointer transition-all ${!n.isRead ? 'bg-primary-500/5' : ''}`}>
                              <p className="text-sm font-medium text-white">{n.title}</p>
                              <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-xs text-white/30 mt-1">{new Date(n.createdAt).toLocaleDateString()}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Profile */}
                <div className="relative">
                  <button
                    onClick={() => { setIsProfileOpen(!isProfileOpen); setShowNotifs(false); }}
                    className="flex items-center gap-2 p-1.5 hover:bg-white/10 rounded-full transition-all"
                  >
                    <img
                      src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6C63FF&color=fff&size=40`}
                      alt={user.name}
                      className="w-8 h-8 rounded-full object-cover border border-white/20"
                    />
                    <ChevronDown className="w-4 h-4 text-white/50 hidden sm:block" />
                  </button>

                  {isProfileOpen && (
                    <div className="absolute right-0 top-12 w-56 glass-card py-2 shadow-2xl animate-slide-down z-50">
                      <div className="px-4 py-3 border-b border-white/10">
                        <p className="text-sm font-semibold text-white">{user.name}</p>
                        <p className="text-xs text-white/50 capitalize">{user.role}</p>
                      </div>
                      <Link
                        to={getDashboardPath()}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-all"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        <User className="w-4 h-4" /> Dashboard
                      </Link>
                      <Link
                        to="/profile"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-all"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        <Settings className="w-4 h-4" /> Profile Settings
                      </Link>
                      <hr className="border-white/10 my-1" />
                      <button
                        onClick={logout}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
                      >
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link to="/login" className="text-sm font-medium text-white/70 hover:text-white px-4 py-2 transition-all">
                  Log In
                </Link>
                <Link to="/register" className="btn-primary text-sm py-2 px-5">
                  Get Started
                </Link>
              </div>
            )}

            {/* Mobile menu */}
            <button
              className="lg:hidden p-2 text-white/70 hover:text-white transition-all"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
            >
              {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileOpen && (
          <div className="lg:hidden glass-card mx-0 mt-2 mb-4 py-4 animate-slide-down">
            {navLinks.map(link => (
              <Link
                key={link.label}
                to={link.href}
                className="flex items-center gap-2 px-5 py-3 text-white/70 hover:text-white hover:bg-white/10 transition-all text-sm"
                onClick={() => setIsMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="px-5 pt-3 border-t border-white/10 mt-2">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search courses..."
                  className="input-field text-sm py-2"
                />
                <button type="submit" className="btn-primary py-2 px-3"><Search className="w-4 h-4" /></button>
              </form>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
