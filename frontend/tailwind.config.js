/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Spec design system tokens
        page: 'var(--bg-page)',
        surface: 'var(--bg-surface)',
        'surface-alt': 'var(--bg-surface-alt)',
        border: {
          subtle: 'var(--border-subtle)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        brand: {
          primary: 'var(--brand-primary)',
          'primary-hover': 'var(--brand-primary-hover)',
          secondary: 'var(--brand-secondary)',
        },
        accent: {
          mint: 'var(--accent-mint)',
          amber: 'var(--accent-amber)',
          sky: 'var(--accent-sky)',
          lilac: 'var(--accent-lilac)',
        },
        // Harmonized color scales
        primary: {
          50: '#f4f3ff',
          100: '#ebe9fe',
          200: '#d9d6fe',
          300: '#bdb6fd',
          400: '#9b8ffb',
          500: '#6C63F2', // Soft indigo / periwinkle
          600: '#5A52E0',
          700: '#4c42c9',
          800: '#3f36a5',
          900: '#352e84',
        },
        secondary: {
          50: '#fff1f4',
          100: '#ffe4ea',
          200: '#ffccd8',
          300: '#ffa2b8',
          400: '#ff8fa3', // Soft coral-pink
          500: '#f8587d',
          600: '#e53664',
          700: '#c1234f',
          800: '#a12046',
          900: '#871f3e',
        },
        dark: {
          900: '#12121F',
          800: '#1B1C2E',
          700: '#242540',
          600: '#2E2F4A',
          500: '#3B3D5E',
        },
      },
      fontFamily: {
        heading: ['Poppins', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        pill: '9999px',
        panel: '20px',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        'soft-hover': 'var(--shadow-soft-hover)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'bounce-in': 'bounceIn 0.6s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 3s ease-in-out infinite',
        'score-reveal': 'scoreReveal 0.8s ease-out',
        'float-reaction': 'floatReaction 2.8s ease-out forwards',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(20px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-20px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        bounceIn: { '0%': { transform: 'scale(0.8)', opacity: '0' }, '60%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        scoreReveal: { '0%': { transform: 'scale(0) rotateY(180deg)', opacity: '0' }, '100%': { transform: 'scale(1) rotateY(0)', opacity: '1' } },
        floatReaction: {
          '0%': { transform: 'translateY(0) translateX(0) scale(0.4)', opacity: '0' },
          '12%': { transform: 'translateY(-14px) translateX(0) scale(1.15)', opacity: '1' },
          '30%': { transform: 'translateY(-40px) translateX(-6px) scale(1)', opacity: '1' },
          '55%': { transform: 'translateY(-85px) translateX(6px) scale(1)', opacity: '1' },
          '80%': { transform: 'translateY(-130px) translateX(-4px) scale(1)', opacity: '0.9' },
          '100%': { transform: 'translateY(-170px) translateX(0) scale(1)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
