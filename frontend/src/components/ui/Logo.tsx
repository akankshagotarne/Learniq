import React from 'react';
import { Link } from 'react-router-dom';

const Logo: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({ size = 'md', className = '' }) => {
  const sizes = {
    sm: { icon: 24, text: 'text-lg' },
    md: { icon: 32, text: 'text-2xl' },
    lg: { icon: 48, text: 'text-4xl' },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Logo Icon */}
      <div className="relative flex items-center justify-center" style={{ width: s.icon, height: s.icon }}>
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-lg opacity-20 blur-sm" />
        <svg width={s.icon} height={s.icon} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Brain/neural node design */}
          <defs>
            <linearGradient id="logoGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6C63FF" />
              <stop offset="100%" stopColor="#FF6584" />
            </linearGradient>
            <linearGradient id="logoGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#43C6AC" />
              <stop offset="100%" stopColor="#6C63FF" />
            </linearGradient>
          </defs>
          {/* Book shape */}
          <rect x="6" y="12" width="22" height="28" rx="3" fill="url(#logoGrad1)" opacity="0.9" />
          <rect x="10" y="8" width="22" height="28" rx="3" fill="url(#logoGrad2)" opacity="0.7" />
          {/* Spark / intelligence symbol */}
          <path d="M26 20 L32 14 L30 22 L38 18 L32 26 L36 34 L28 28 L24 36 L22 28 L14 32 L18 24 L10 28 L16 20 L10 14 L18 18 Z"
            fill="white" opacity="0.0" />
          {/* Lightning bolt for IQ */}
          <path d="M27 4 L20 22 H26 L19 44 L36 20 H30 L37 4 Z"
            fill="url(#logoGrad1)" stroke="white" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Logo Text */}
      <div className="flex items-baseline gap-0">
        <span className={`font-display font-bold ${s.text} bg-gradient-to-r from-primary-400 to-primary-300 bg-clip-text text-transparent`}>
          Learn
        </span>
        <span className={`font-display font-black ${s.text} bg-gradient-to-r from-secondary-400 to-accent-400 bg-clip-text text-transparent`}>
          iq
        </span>
      </div>
    </div>
  );
};

export const LogoLink: React.FC<{ to?: string; size?: 'sm' | 'md' | 'lg' }> = ({ to = '/', size = 'md' }) => (
  <Link to={to}>
    <Logo size={size} />
  </Link>
);

export default Logo;
