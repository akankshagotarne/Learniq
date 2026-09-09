import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, BookOpen, Play, FileText, HelpCircle, ClipboardList, Video,
  Users, BarChart2, Bell, User, LogOut, ChevronLeft, ChevronRight,
  Layers, CreditCard, Settings, Building2, Radio
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LogoLink } from '../ui/Logo';

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
  { label: 'Quizzes', href: '/student/quizzes', icon: HelpCircle },
  { label: 'Assignments', href: '/student/assignments', icon: ClipboardList },
  { label: 'Progress', href: '/student/progress', icon: BarChart2 },
  { label: 'Notifications', href: '/student/notifications', icon: Bell },
  { label: 'Profile', href: '/profile', icon: User },
];

const teacherNav: NavItem[] = [
  { label: 'Dashboard', href: '/teacher', icon: Home },
  { label: 'My Courses', href: '/teacher/courses', icon: BookOpen },
  { label: 'Lectures', href: '/teacher/lectures', icon: Play },
  { label: 'Students', href: '/teacher/students', icon: Users },
  { label: 'Quizzes', href: '/teacher/quizzes', icon: HelpCircle },
  { label: 'Assignments', href: '/teacher/assignments', icon: ClipboardList },
  { label: 'Live Sessions', href: '/teacher/live', icon: Radio },
  { label: 'Analytics', href: '/teacher/analytics', icon: BarChart2 },
  { label: 'Notifications', href: '/teacher/notifications', icon: Bell },
  { label: 'Profile', href: '/profile', icon: User },
];

const adminNav: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Home },
  { label: 'Students', href: '/admin/students', icon: Users },
  { label: 'Teachers', href: '/admin/teachers', icon: Users },
  { label: 'Courses', href: '/admin/courses', icon: BookOpen },
  { label: 'Live Sessions', href: '/admin/live', icon: Radio },
  { label: 'Payments', href: '/admin/payments', icon: CreditCard },
  { label: 'Analytics', href: '/admin/analytics', icon: BarChart2 },
  { label: 'Company', href: '/admin/company', icon: Building2 },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
];

const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) return null;

  const navItems = user.role === 'student' ? studentNav : user.role === 'teacher' ? teacherNav : adminNav;

  return (
    <aside className={`fixed left-0 top-0 h-full bg-dark-800 border-r border-white/10 z-40 transition-all duration-300 flex flex-col ${
      collapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Logo */}
      <div className={`flex items-center h-16 px-4 border-b border-white/10 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && <LogoLink size="sm" />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* User Info */}
      {!collapsed && (
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img
              src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6C63FF&color=fff&size=48`}
              alt={user.name}
              className="w-10 h-10 rounded-full object-cover border border-white/20 flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user.name}</p>
              <p className="text-xs text-white/50 capitalize">{user.role}</p>
              {user.role === 'student' && user.currentStandard && (
                <p className="text-xs text-primary-400">Standard {user.currentStandard}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        {navItems.map(item => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/student' && item.href !== '/teacher' && item.href !== '/admin' && location.pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              to={item.href}
              title={collapsed ? item.label : undefined}
              className={`sidebar-item mb-1 ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-4 border-t border-white/10">
        <button
          onClick={logout}
          title={collapsed ? 'Logout' : undefined}
          className={`sidebar-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10 ${collapsed ? 'justify-center px-2' : ''}`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
