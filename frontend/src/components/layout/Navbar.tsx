import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Search, Menu, X, ChevronDown, LogOut, User, Settings, BookOpen, Home } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LogoLink } from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';
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
    { label: 'Contact', href: '/contact', icon: null },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      isScrolled
        ? 'bg-white/95 dark:bg-[#1B1C2E]/95 backdrop-blur-xl border-b border-[#E7E7F2] dark:border-[#2E2F4A] shadow-[0_4px_20px_rgba(34,36,58,0.06)]'
        : 'bg-white/80 dark:bg-[#12121F]/80 backdrop-blur-md border-b border-[#E7E7F2]/60 dark:border-[#2E2F4A]/40'
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
                className="px-4 py-2 text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl text-sm font-medium transition-all duration-200"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Search */}
            <form onSubmit={handleSearch} className="hidden md:flex items-center">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A0A3C0]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search courses..."
                  className="pl-9 pr-4 py-2 bg-[#F1F1FA] dark:bg-[#242540] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-full text-sm text-[#22243A] dark:text-[#F4F4FA] placeholder-[#A0A3C0]
                    focus:outline-none focus:bg-white dark:focus:bg-[#1B1C2E] focus:border-[#6C63F2] focus:ring-2 focus:ring-[#6C63F2]/20 w-44 focus:w-60 transition-all"
                />
              </div>
            </form>

            {/* Theme Toggle Button */}
            <ThemeToggle />

            {user ? (
              <>
                {/* Notifications */}
                <div className="relative">
                  <button
                    onClick={() => { setShowNotifs(!showNotifs); setIsProfileOpen(false); }}
                    className="relative p-2 text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
                    aria-label="Notifications"
                  >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#FF8FA3] rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifs && (
                    <div className="absolute right-0 top-12 w-80 bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl py-2 shadow-xl animate-slide-down z-50">
                      <div className="px-4 py-2 border-b border-[#E7E7F2] dark:border-[#2E2F4A] flex items-center justify-between">
                        <p className="text-sm font-semibold text-[#22243A] dark:text-[#F4F4FA]">Notifications</p>
                        {unreadCount > 0 && <span className="badge-primary text-[10px]">{unreadCount} new</span>}
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-[#E7E7F2] dark:divide-[#2E2F4A]">
                        {notifications.length === 0 ? (
                          <p className="text-[#A0A3C0] text-sm text-center py-6">No notifications</p>
                        ) : (
                          notifications.slice(0, 10).map(n => (
                            <div key={n._id} className={`px-4 py-3 hover:bg-[#F1F1FA] dark:hover:bg-[#242540] cursor-pointer transition-all ${!n.isRead ? 'bg-[#EDE9FE]/40 dark:bg-[#6C63F2]/10' : ''}`}>
                              <p className="text-sm font-medium text-[#22243A] dark:text-[#F4F4FA]">{n.title}</p>
                              <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-[10px] text-[#A0A3C0] mt-1">{new Date(n.createdAt).toLocaleDateString()}</p>
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
                    className="flex items-center gap-2 p-1.5 hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
                  >
                    <img
                      src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6C63F2&color=fff&size=40`}
                      alt={user.name}
                      className="w-8 h-8 rounded-full object-cover border border-[#E7E7F2] dark:border-[#2E2F4A]"
                    />
                    <ChevronDown className="w-4 h-4 text-[#6B6E8C] hidden sm:block" />
                  </button>

                  {isProfileOpen && (
                    <div className="absolute right-0 top-12 w-56 bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl py-2 shadow-xl animate-slide-down z-50">
                      <div className="px-4 py-3 border-b border-[#E7E7F2] dark:border-[#2E2F4A]">
                        <p className="text-sm font-semibold text-[#22243A] dark:text-[#F4F4FA]">{user.name}</p>
                        <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] capitalize">{user.role}</p>
                      </div>
                      <Link
                        to={getDashboardPath()}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] transition-all"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        <User className="w-4 h-4 text-[#6C63F2]" /> Dashboard
                      </Link>
                      <Link
                        to="/student/standard"
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] transition-all"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        <Settings className="w-4 h-4 text-[#6C63F2]" /> Change Standard
                      </Link>
                      <hr className="border-[#E7E7F2] dark:border-[#2E2F4A] my-1" />
                      <button
                        onClick={logout}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#E1447A] hover:bg-[#FFE4EC] dark:hover:bg-[#E1447A]/10 transition-all font-medium"
                      >
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="hidden lg:flex items-center gap-2">
                <Link to="/login" className="text-sm font-medium text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] px-3.5 py-2 hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all">
                  Log In
                </Link>
                <Link to="/register" className="btn-primary text-sm py-2 px-4 shadow-sm">
                  Get Started
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              className="lg:hidden p-2 text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] rounded-xl transition-all"
              onClick={() => setIsMobileOpen(!isMobileOpen)}
            >
              {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileOpen && (
          <div className="lg:hidden bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl mx-0 mt-2 mb-4 p-4 shadow-xl animate-slide-down">
            {navLinks.map(link => (
              <Link
                key={link.label}
                to={link.href}
                className="flex items-center gap-2.5 px-4 py-2.5 text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all text-sm font-medium"
                onClick={() => setIsMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 border-t border-[#E7E7F2] dark:border-[#2E2F4A] mt-2">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search courses..."
                  className="input-field text-sm py-2 flex-1"
                />
                <button type="submit" className="btn-primary py-2 px-3"><Search className="w-4 h-4" /></button>
              </form>
            </div>

            {!user && (
              <div className="flex items-center gap-2 pt-3 border-t border-[#E7E7F2] dark:border-[#2E2F4A] mt-2">
                <Link
                  to="/login"
                  className="flex-1 text-center text-sm font-medium text-[#6B6E8C] hover:text-[#22243A] dark:text-[#A6A8C4] dark:hover:text-[#F4F4FA] px-3.5 py-2.5 hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
                  onClick={() => setIsMobileOpen(false)}
                >
                  Log In
                </Link>
                <Link
                  to="/register"
                  className="flex-1 btn-primary text-sm py-2.5 px-4 text-center shadow-sm"
                  onClick={() => setIsMobileOpen(false)}
                >
                  Get Started
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
