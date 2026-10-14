import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * Where a teacher whose account is NOT approved (any more) lands. The decision comes from the backend user object
 * (role + isApproved from GET /auth/me); every teacher API refuses an unapproved account as well, so this page is only the explanation.
 */
const PendingApprovalPage: React.FC = () => {
  const { user, isLoading, logout } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!(user.role === 'teacher' && user.isApproved !== true)) {
    return <Navigate to={user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/student'} replace />;
  }
  const rejected = user.approvalStatus === 'REJECTED';
  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-md card-soft p-8 rounded-card border border-border-subtle shadow-soft text-center" data-testid="pending-approval">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#FEF3C7] dark:bg-[#3D2C0C] flex items-center justify-center"><Clock className="w-7 h-7 text-[#D97706]" aria-hidden /></div>
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">{rejected ? 'Registration not approved' : 'Waiting for admin approval'}</h1>
        <p className="text-text-secondary text-sm mb-6">
          {rejected
            ? 'Your teacher registration was not approved. Please contact LearnIQ support if you think this is a mistake.'
            : 'Your account is awaiting admin approval. You will be able to log in after your registration is approved.'}
        </p>
        <button type="button" onClick={() => void logout()} className="btn-primary w-full py-3 text-base">Log out</button>
        <Link to="/" className="block text-center text-xs text-text-secondary hover:text-text-primary mt-3">Back to home</Link>
      </div>
    </div>
  );
};

export default PendingApprovalPage;
