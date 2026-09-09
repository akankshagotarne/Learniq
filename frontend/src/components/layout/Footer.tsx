import React from 'react';
import { Link } from 'react-router-dom';
import { LogoLink } from '../ui/Logo';
import { Mail, Phone, MapPin } from 'lucide-react';
import { LinkedinIcon, TwitterIcon, InstagramIcon, YoutubeIcon } from '../ui/SocialIcons';

const Footer: React.FC = () => {
  return (
    <footer className="bg-surface border-t border-border-subtle pt-16 pb-8 transition-colors duration-200">
      <div className="page-container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div className="lg:col-span-2">
            <LogoLink size="md" />
            <p className="text-text-secondary text-sm leading-relaxed mt-4 max-w-sm">
              Learniq connects passionate teachers with eager students through live classes, recorded lectures,
              interactive quizzes, and personalized learning experiences. Learn Smarter. Grow Better.
            </p>
            <div className="flex items-center gap-4 mt-6">
              {[
                { icon: LinkedinIcon, href: '#', label: 'LinkedIn' },
                { icon: TwitterIcon, href: '#', label: 'Twitter' },
                { icon: InstagramIcon, href: '#', label: 'Instagram' },
                { icon: YoutubeIcon, href: '#', label: 'YouTube' },
              ].map(({ icon: Icon, href, label }) => (
                <a key={label} href={href} aria-label={label}
                  className="p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-secondary hover:text-brand-primary hover:bg-surface hover:border-brand-primary/30 transition-all duration-200 shadow-sm">
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-heading font-semibold text-text-primary mb-4 text-base">Quick Links</h4>
            <ul className="space-y-2.5">
              {[
                { label: 'Home', href: '/' },
                { label: 'Courses', href: '/courses' },
                { label: 'Live Classes', href: '/live-sessions' },
                { label: 'About Learniq', href: '/about' },
                { label: 'Contact', href: '/contact' },
              ].map(link => (
                <li key={link.label}>
                  <Link to={link.href} className="text-text-secondary hover:text-brand-primary text-sm transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support & Contact */}
          <div>
            <h4 className="font-heading font-semibold text-text-primary mb-4 text-base">Support</h4>
            <ul className="space-y-2.5 mb-6">
              {[
                { label: 'Help Center', href: '#' },
                { label: 'Privacy Policy', href: '#' },
                { label: 'Terms of Service', href: '#' },
                { label: 'Refund Policy', href: '#' },
              ].map(link => (
                <li key={link.label}>
                  <a href={link.href} className="text-text-secondary hover:text-brand-primary text-sm transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <a href="mailto:hello@learniq.in" className="flex items-center gap-2 text-text-secondary hover:text-brand-primary text-xs transition-colors">
                <Mail className="w-3.5 h-3.5 text-brand-primary" /> hello@learniq.in
              </a>
              <a href="tel:+919876543210" className="flex items-center gap-2 text-text-secondary hover:text-brand-primary text-xs transition-colors">
                <Phone className="w-3.5 h-3.5 text-accent-mint" /> +91 98765 43210
              </a>
              <p className="flex items-start gap-2 text-text-muted text-xs">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-brand-secondary" /> Baner, Pune, Maharashtra
              </p>
            </div>
          </div>
        </div>

        {/* Standards */}
        <div className="border-t border-border-subtle pt-8 pb-4">
          <p className="text-text-secondary text-xs font-medium mb-3">Classes available for:</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(std => (
              <Link
                key={std}
                to={`/courses?standard=${std}`}
                className="px-3 py-1.5 text-xs bg-surface-alt border border-border-subtle rounded-full text-text-secondary hover:text-brand-primary hover:border-brand-primary/40 hover:bg-surface transition-all font-medium"
              >
                Std {std}
              </Link>
            ))}
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-border-subtle pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-text-muted text-xs">
            © 2024 Learniq Technologies Pvt. Ltd. All rights reserved.
          </p>
          <p className="text-text-muted text-xs">
            Made with ❤️ for India's students
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

