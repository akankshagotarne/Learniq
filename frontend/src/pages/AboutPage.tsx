import React, { useEffect, useState } from 'react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Mail, Phone, MapPin, Target, Eye, Heart } from 'lucide-react';

interface CompanyData {
  name: string; tagline: string; mission: string; vision: string; about: string;
  email: string; phone: string; address: string; founded: string;
  founders: { name: string; role: string; description: string; photo: string }[];
  team: { name: string; role: string; department: string; description: string; photo: string }[];
  socialLinks: { linkedin: string; twitter: string; instagram: string; youtube: string };
}

const AboutPage: React.FC = () => {
  const [company, setCompany] = useState<CompanyData | null>(null);

  useEffect(() => {
    api.get('/admin/company').then(r => setCompany(r.data.company)).catch(() => {});
  }, []);

  const c = company || {
    name: 'Learniq',
    tagline: 'Learn Smarter. Grow Better.',
    mission: 'To make quality education accessible to every student across India.',
    vision: 'A future where every child has access to world-class education.',
    about: 'Learniq is an innovative EdTech platform founded in 2024, dedicated to transforming how students from Standard 1 to 10 learn and grow.',
    email: 'hello@learniq.in',
    phone: '+91 98765 43210',
    address: 'Baner, Pune, Maharashtra',
    founded: '2024',
    founders: [
      { name: 'Arjun Mehta', role: 'Founder & CEO', description: 'Former IIT Bombay graduate with 8 years in EdTech.', photo: 'https://ui-avatars.com/api/?name=Arjun+Mehta&background=6C63FF&color=fff&size=200' },
      { name: 'Priyanka Sharma', role: 'Co-Founder & CTO', description: 'Full-stack engineer and former Google India engineer.', photo: 'https://ui-avatars.com/api/?name=Priyanka+Sharma&background=FF6584&color=fff&size=200' },
    ],
    team: [
      { name: 'Nikhil Desai', role: 'Head of Product', department: 'Product', description: 'Crafts user experiences students love.', photo: 'https://ui-avatars.com/api/?name=Nikhil+Desai&background=43C6AC&color=fff&size=200' },
      { name: 'Sunita Rao', role: 'Head of Academics', department: 'Education', description: 'Curriculum design expert.', photo: 'https://ui-avatars.com/api/?name=Sunita+Rao&background=F7971E&color=fff&size=200' },
      { name: 'Vikram Joshi', role: 'Lead Engineer', department: 'Engineering', description: 'Backend systems architect.', photo: 'https://ui-avatars.com/api/?name=Vikram+Joshi&background=4776E6&color=fff&size=200' },
      { name: 'Meena Patel', role: 'UX Designer', department: 'Design', description: 'Creates beautiful interfaces.', photo: 'https://ui-avatars.com/api/?name=Meena+Patel&background=FF416C&color=fff&size=200' },
    ],
    socialLinks: { linkedin: '#', twitter: '#', instagram: '#', youtube: '#' },
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="pt-20 bg-dark-900">
        {/* Hero */}
        <div className="relative py-24 overflow-hidden">
          <div className="absolute inset-0">
            <div className="absolute top-10 left-10 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-72 h-72 bg-secondary-500/10 rounded-full blur-3xl" />
          </div>
          <div className="page-container relative z-10 text-center">
            <span className="badge-primary mb-4 inline-block text-sm">Est. {c.founded}</span>
            <h1 className="font-display font-black text-4xl md:text-6xl text-white mb-4">
              About <span className="gradient-text">Learniq</span>
            </h1>
            <p className="text-white/60 text-xl max-w-2xl mx-auto">{c.tagline}</p>
          </div>
        </div>

        {/* Mission & Vision */}
        <div className="page-container pb-16">
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Target className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-white font-bold text-lg mb-3">Our Mission</h3>
              <p className="text-white/50 text-sm leading-relaxed">{c.mission}</p>
            </div>
            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-to-br from-secondary-500 to-secondary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Eye className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-white font-bold text-lg mb-3">Our Vision</h3>
              <p className="text-white/50 text-sm leading-relaxed">{c.vision}</p>
            </div>
            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-to-br from-accent-500 to-accent-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Heart className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-white font-bold text-lg mb-3">Our Values</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Quality education for all. Innovation in learning. Empowering teachers and students across India.
              </p>
            </div>
          </div>

          {/* About Text */}
          <div className="glass-card p-8 mb-16">
            <h2 className="font-display font-bold text-2xl text-white mb-4">Who We Are</h2>
            <p className="text-white/60 leading-relaxed">{c.about}</p>
          </div>

          {/* Founders */}
          <div className="mb-16">
            <h2 className="font-display font-bold text-2xl text-white mb-8 text-center">
              Meet Our <span className="gradient-text">Founders</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {c.founders.map(founder => (
                <div key={founder.name} className="glass-card p-6 text-center">
                  <img
                    src={founder.photo}
                    alt={founder.name}
                    className="w-24 h-24 rounded-full object-cover mx-auto mb-4 border-2 border-primary-500/30"
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(founder.name)}&background=6C63FF&color=fff&size=200`; }}
                  />
                  <h3 className="text-white font-bold text-lg">{founder.name}</h3>
                  <p className="text-primary-400 text-sm mb-3">{founder.role}</p>
                  <p className="text-white/50 text-sm">{founder.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Team */}
          <div className="mb-16">
            <h2 className="font-display font-bold text-2xl text-white mb-8 text-center">
              Our <span className="gradient-text">Core Team</span>
            </h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
              {c.team.map(member => (
                <div key={member.name} className="glass-card-hover p-5 text-center">
                  <img
                    src={member.photo}
                    alt={member.name}
                    className="w-16 h-16 rounded-full object-cover mx-auto mb-3 border border-white/20"
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=6C63FF&color=fff&size=200`; }}
                  />
                  <h3 className="text-white font-semibold text-sm">{member.name}</h3>
                  <p className="text-primary-400 text-xs mb-1">{member.role}</p>
                  <span className="badge bg-white/10 text-white/40 text-xs">{member.department}</span>
                  <p className="text-white/40 text-xs mt-2">{member.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="glass-card p-8">
            <h2 className="font-display font-bold text-2xl text-white mb-6 text-center">Get In Touch</h2>
            <div className="grid md:grid-cols-3 gap-6 text-center">
              <a href={`mailto:${c.email}`} className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                <div className="w-10 h-10 bg-primary-500/20 rounded-xl flex items-center justify-center">
                  <Mail className="w-5 h-5 text-primary-400" />
                </div>
                <span className="text-white text-sm">{c.email}</span>
              </a>
              <a href={`tel:${c.phone}`} className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                <div className="w-10 h-10 bg-secondary-500/20 rounded-xl flex items-center justify-center">
                  <Phone className="w-5 h-5 text-secondary-400" />
                </div>
                <span className="text-white text-sm">{c.phone}</span>
              </a>
              <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl">
                <div className="w-10 h-10 bg-accent-500/20 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-accent-400" />
                </div>
                <span className="text-white text-sm text-center">{c.address}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default AboutPage;
