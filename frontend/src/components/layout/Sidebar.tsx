import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, BookOpen, Play, FileText, HelpCircle, ClipboardList,
  Users, BarChart2, Bell, User, LogOut, ChevronLeft, ChevronRight,
  Layers, CreditCard, Settings, Building2, Radio, MessageCircle, GraduationCap,
  Menu, X, Trophy, Award
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LogoLink } from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';
import { COURSES_ENABLED } from '../../constants/features';

interface NavItem {
  label: string;
  href: string;
  icon: React.FC<any>;
  badge?: string;
  /** course screens — hidden while COURSES_ENABLED is false */
  courses?: boolean;
}

const studentNav: NavItem[] = [
  { label: 'Dashboard', href: '/student', icon: Home },
  { label: 'My Courses', href: '/student/my-courses', icon: GraduationCap, courses: true },
  { label: 'My Standard', href: '/student/standard', icon: Layers },
  { label: 'Courses', href: '/courses', icon: BookOpen, courses: true },
  { label: 'Live Classes', href: '/live-sessions', icon: Radio },
  { label: 'Exams', href: '/student/exams', icon: ClipboardList },
  { label: 'Results & Certificates', href: '/student/certificates', icon: Award },
  { label: 'Progress', href: '/student/progress', icon: BarChart2 },
  { label: 'Help & Support', href: '/help-support', icon: HelpCircle },
];

const teacherNav: NavItem[] = [
  { label: 'Dashboard', href: '/teacher', icon: Home },
  { label: 'My Courses', href: '/teacher/courses', icon: BookOpen, courses: true },
  { label: 'Live Sessions', href: '/teacher/live', icon: Radio },
  { label: 'Students', href: '/teacher/students', icon: Users },
  { label: 'Student Questions', href: '/teacher/doubts', icon: MessageCircle },
  { label: 'Exams', href: '/teacher/exams', icon: ClipboardList },
  { label: 'Help & Support', href: '/help-support', icon: HelpCircle },
];

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Home },
  { label: 'Students', href: '/admin/students', icon: Users },
  { label: 'Teachers', href: '/admin/teachers', icon: Users },
  { label: 'Courses', href: '/admin/courses', icon: BookOpen, courses: true },
  { label: 'Live Sessions', href: '/admin/live', icon: Radio },
  { label: 'Payments', href: '/admin/payments', icon: CreditCard },
  { label: 'Olympiad', href: '/admin/olympiad', icon: Trophy },
  { label: 'Help & Support', href: '/admin/support', icon: HelpCircle },
  { label: 'About Page', href: '/about', icon: Building2 },
];

const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Page content is offset by the sidebar width (lg:ml-[var(--sidebar-w)]), so it follows the collapsed state
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '4rem' : '16rem');
  }, [collapsed]);

  // Mobile drawer: Escape closes it, the page behind does not scroll, focus moves into it and back to the menu button
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      menuBtnRef.current?.focus();
    };
  }, [mobileOpen]);

  // The drawer is for small screens only: close it if the window grows past the lg breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => { if (mq.matches) setMobileOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!user) return null;

  const navItems = (user.role === 'student' ? studentNav : user.role === 'teacher' ? teacherNav : adminNav)
    .filter(item => COURSES_ENABLED || !item.courses);
  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile top bar - only shown below md, gives access to the drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white/95 dark:bg-[#1B1C2E]/95 backdrop-blur-xl border-b border-[#E7E7F2] dark:border-[#2E2F4A] z-40 flex items-center justify-between px-4">
        <LogoLink size="sm" />
        <button
          ref={menuBtnRef}
          onClick={() => setMobileOpen(true)}
          className="w-11 h-11 -mr-2 inline-flex items-center justify-center text-[#6B6E8C] dark:text-[#A6A8C4] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Backdrop behind the mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40"
          onClick={closeMobile}
        />
      )}

      {/* When the drawer is closed on a phone it is also `invisible`, so its links are not reachable by keyboard / screen reader */}
      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={`fixed left-0 top-0 h-full max-w-[85vw] bg-white dark:bg-[#1B1C2E] border-r border-[#E7E7F2] dark:border-[#2E2F4A] z-50 flex flex-col shadow-[0_4px_20px_rgba(34,36,58,0.04)]
        duration-300 transform
        ${mobileOpen ? 'translate-x-0 visible transition-transform' : '-translate-x-full invisible transition-[transform,visibility]'} lg:translate-x-0 lg:visible
        w-64 ${collapsed ? 'lg:w-16' : 'lg:w-64'}`}
      >
        {/* Top Header / Logo */}
        <div className={`flex items-center h-16 px-4 border-b border-[#E7E7F2] dark:border-[#2E2F4A] justify-between ${collapsed ? 'lg:justify-center' : ''}`}>
          { !(collapsed) && <span className="hidden lg:block"><LogoLink size="sm" /></span>}
          <span className="lg:hidden font-heading font-bold text-[#22243A] dark:text-[#F4F4FA]">Menu</span>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:inline-flex p-1.5 text-[#A0A3C0] hover:text-[#22243A] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
            aria-label="Toggle sidebar collapse"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <button
            ref={closeBtnRef}
            onClick={closeMobile}
            className="lg:hidden w-10 h-10 -mr-2 inline-flex items-center justify-center text-[#A0A3C0] hover:text-[#22243A] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User Info Card */}
        {!collapsed && (
          <div className="p-4 border-b border-[#E7E7F2] dark:border-[#2E2F4A]">
            <div className="flex items-center gap-3 p-3 bg-[#F8F8FC] dark:bg-[#242540]/60 border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl">
              <img
                src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6C63F2&color=fff&size=48`}
                alt={user.name}
                className="w-10 h-10 rounded-full object-cover border-2 border-white dark:border-[#1B1C2E] shadow-sm flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#22243A] dark:text-[#F4F4FA] truncate">{user.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="badge-primary text-[10px] py-0 px-2 capitalize">{user.role}</span>
                  {user.role === 'student' && user.currentStandard && (
                    <span className="text-[11px] text-[#6B6E8C] dark:text-[#A6A8C4] font-medium">Std {user.currentStandard}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map(item => {
            const isActive = location.pathname === item.href ||
              (item.href !== '/student' && item.href !== '/teacher' && item.href !== '/admin' && location.pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                to={item.href}
                title={collapsed ? item.label : undefined}
                onClick={closeMobile}
                className={`sidebar-item ${isActive ? 'active' : ''} ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Area: Theme Toggle & Logout */}
        <div className="p-3 border-t border-[#E7E7F2] dark:border-[#2E2F4A] space-y-2">
          {!collapsed && (
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] font-medium">Theme Mode</span>
              <ThemeToggle />
            </div>
          )}

          <button
            onClick={() => { closeMobile(); logout(); }}
            title={collapsed ? 'Logout' : undefined}
            className={`sidebar-item w-full text-[#E1447A] hover:bg-[#FFE4EC] dark:hover:bg-[#E1447A]/10 transition-all font-medium ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className={collapsed ? 'lg:hidden' : ''}>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
