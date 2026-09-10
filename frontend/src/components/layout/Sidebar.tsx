import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, BookOpen, Play, FileText, HelpCircle, ClipboardList,
  Users, BarChart2, Bell, User, LogOut, ChevronLeft, ChevronRight,
  Layers, CreditCard, Settings, Building2, Radio
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LogoLink } from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';

interface NavItem {
  label: string;
  href: string;
  icon: React.FC<any>;
  badge?: string;
}

const studentNav: NavItem[] = [
  { label: 'Dashboard', href: '/student', icon: Home },
  { label: 'My Standard', href: '/student/standard', icon: Layers },
  { label: 'Courses', href: '/courses', icon: BookOpen },
  { label: 'Live Classes', href: '/live-sessions', icon: Radio },
  { label: 'Exams', href: '/student/exams', icon: ClipboardList },
  { label: 'Progress', href: '/student/progress', icon: BarChart2 },
];

const teacherNav: NavItem[] = [
  { label: 'Dashboard', href: '/teacher', icon: Home },
  { label: 'My Courses', href: '/teacher/courses', icon: BookOpen },
  { label: 'Live Sessions', href: '/teacher/live', icon: Radio },
  { label: 'Students', href: '/teacher/students', icon: Users },
  { label: 'Exams', href: '/teacher/exams', icon: ClipboardList },
];

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Home },
  { label: 'Students', href: '/admin/students', icon: Users },
  { label: 'Teachers', href: '/admin/teachers', icon: Users },
  { label: 'Courses', href: '/admin/courses', icon: BookOpen },
  { label: 'Live Sessions', href: '/admin/live', icon: Radio },
  { label: 'About Page', href: '/about', icon: Building2 },
];

const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) return null;

  const navItems = user.role === 'student' ? studentNav : user.role === 'teacher' ? teacherNav : adminNav;

  return (
    <aside className={`fixed left-0 top-0 h-full bg-white dark:bg-[#1B1C2E] border-r border-[#E7E7F2] dark:border-[#2E2F4A] z-40 transition-all duration-300 flex flex-col shadow-[0_4px_20px_rgba(34,36,58,0.04)] ${
      collapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Top Header / Logo */}
      <div className={`flex items-center h-16 px-4 border-b border-[#E7E7F2] dark:border-[#2E2F4A] ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && <LogoLink size="sm" />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 text-[#A0A3C0] hover:text-[#22243A] dark:hover:text-[#F4F4FA] hover:bg-[#F1F1FA] dark:hover:bg-[#242540] rounded-xl transition-all"
          aria-label="Toggle sidebar collapse"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
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
              className={`sidebar-item ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
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
          onClick={logout}
          title={collapsed ? 'Logout' : undefined}
          className={`sidebar-item w-full text-[#E1447A] hover:bg-[#FFE4EC] dark:hover:bg-[#E1447A]/10 transition-all font-medium ${collapsed ? 'justify-center px-2' : ''}`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
