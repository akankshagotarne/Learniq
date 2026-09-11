import React from 'react';
import { Link } from 'react-router-dom';

const Logo: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({ size = 'md', className = '' }) => {
  const sizes = {
    sm: { icon: 28, text: 'text-xl' },
    md: { icon: 38, text: 'text-3xl' },
    lg: { icon: 56, text: 'text-5xl' },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Logo Icon */}
      <img
        src="/assets/brand/logo-bolt.png"
        alt="LearnIQ"
        width={s.icon}
        height={s.icon}
        style={{ width: s.icon, height: s.icon }}
        className="object-contain flex-shrink-0 drop-shadow-[0_2px_6px_rgba(139,3,237,0.35)]"
      />

      {/* Logo Text */}
      <div className="flex items-baseline gap-0.5">
        <span className={`font-display font-extrabold ${s.text} text-text-primary tracking-tight`}>
          Learn
        </span>
        <span
          className={`font-display font-black ${s.text} bg-clip-text text-transparent tracking-tight`}
          style={{ backgroundImage: 'linear-gradient(90deg, #8B03ED 0%, #09ACEF 100%)' }}
        >
          IQ
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
