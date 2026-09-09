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
      { name: 'Arjun Mehta', role: 'Founder & CEO', description: 'Former IIT Bombay graduate with 8 years in EdTech.', photo: 'https://ui-avatars.com/api/?name=Arjun+Mehta&background=6C63F2&color=fff&size=200' },
      { name: 'Priyanka Sharma', role: 'Co-Founder & CTO', description: 'Full-stack engineer and former Google India engineer.', photo: 'https://ui-avatars.com/api/?name=Priyanka+Sharma&background=FF8FA3&color=fff&size=200' },
    ],
    team: [
      { name: 'Nikhil Desai', role: 'Head of Product', department: 'Product', description: 'Crafts user experiences students love.', photo: 'https://ui-avatars.com/api/?name=Nikhil+Desai&background=4ADE9A&color=fff&size=200' },
      { name: 'Sunita Rao', role: 'Head of Academics', department: 'Education', description: 'Curriculum design expert.', photo: 'https://ui-avatars.com/api/?name=Sunita+Rao&background=FFC24B&color=fff&size=200' },
      { name: 'Vikram Joshi', role: 'Lead Engineer', department: 'Engineering', description: 'Backend systems architect.', photo: 'https://ui-avatars.com/api/?name=Vikram+Joshi&background=5AC8FA&color=fff&size=200' },
      { name: 'Meena Patel', role: 'UX Designer', department: 'Design', description: 'Creates beautiful interfaces.', photo: 'https://ui-avatars.com/api/?name=Meena+Patel&background=B69CF2&color=fff&size=200' },
    ],
    socialLinks: { linkedin: '#', twitter: '#', instagram: '#', youtube: '#' },
  };

  return (
    <div className="min-h-screen bg-page flex flex-col transition-colors">
      <Navbar />
      <div className="pt-20 flex-1">
        {/* Hero */}
        <div className="relative py-20 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-10 left-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
            <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#FF8FA3]/10 rounded-full blur-3xl" />
          </div>
          <div className="page-container relative z-10 text-center">
            <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 mb-4 inline-block text-xs font-semibold px-3 py-1">
              Est. {c.founded}
            </span>
            <h1 className="font-heading font-black text-4xl md:text-5xl lg:text-6xl text-text-primary mb-4">
              About <span className="text-gradient">Learniq</span>
            </h1>
            <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto font-medium">{c.tagline}</p>
          </div>
        </div>

        {/* Mission & Vision */}
        <div className="page-container pb-16">
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <div className="card-soft p-6 text-center">
              <div className="w-12 h-12 bg-brand-primary/10 text-brand-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xs">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="font-heading text-text-primary font-bold text-lg mb-2">Our Mission</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{c.mission}</p>
            </div>
            <div className="card-soft p-6 text-center">
              <div className="w-12 h-12 bg-brand-secondary/15 text-brand-secondary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xs">
                <Eye className="w-6 h-6" />
              </div>
              <h3 className="font-heading text-text-primary font-bold text-lg mb-2">Our Vision</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{c.vision}</p>
            </div>
            <div className="card-soft p-6 text-center">
              <div className="w-12 h-12 bg-accent-mint/15 text-accent-mint rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xs">
                <Heart className="w-6 h-6" />
              </div>
              <h3 className="font-heading text-text-primary font-bold text-lg mb-2">Our Values</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Quality education for all. Innovation in learning. Empowering teachers and students across India.
              </p>
            </div>
          </div>

          {/* About Text */}
          <div className="card-soft p-8 mb-16">
            <h2 className="font-heading font-bold text-2xl text-text-primary mb-4">Who We Are</h2>
            <p className="text-text-secondary leading-relaxed text-base">{c.about}</p>
          </div>

          {/* Founders */}
          <div className="mb-16">
            <h2 className="font-heading font-bold text-2xl md:text-3xl text-text-primary mb-8 text-center">
              Meet Our <span className="text-gradient">Founders</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {c.founders.map(founder => (
                <div key={founder.name} className="card-soft p-6 text-center">
                  <img
                    src={founder.photo}
                    alt={founder.name}
                    className="w-24 h-24 rounded-full object-cover mx-auto mb-4 border-2 border-brand-primary/30 shadow-sm"
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(founder.name)}&background=6C63F2&color=fff&size=200`; }}
                  />
                  <h3 className="font-heading text-text-primary font-bold text-lg">{founder.name}</h3>
                  <p className="text-brand-primary text-xs font-semibold mb-2">{founder.role}</p>
                  <p className="text-text-secondary text-sm leading-relaxed">{founder.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Team */}
          <div className="mb-16">
            <h2 className="font-heading font-bold text-2xl md:text-3xl text-text-primary mb-8 text-center">
              Our <span className="text-gradient">Core Team</span>
            </h2>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
              {c.team.map(member => (
                <div key={member.name} className="card-soft p-5 text-center hover:shadow-soft-hover transition-all">
                  <img
                    src={member.photo}
                    alt={member.name}
                    className="w-16 h-16 rounded-full object-cover mx-auto mb-3 border border-border-subtle shadow-xs"
                    onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=6C63F2&color=fff&size=200`; }}
                  />
                  <h3 className="font-heading text-text-primary font-semibold text-sm">{member.name}</h3>
                  <p className="text-brand-primary text-xs mb-2 font-medium">{member.role}</p>
                  <span className="badge bg-surface-alt border border-border-subtle text-text-secondary text-[11px] font-medium">{member.department}</span>
                  <p className="text-text-secondary text-xs mt-2 leading-relaxed">{member.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="card-soft p-8">
            <h2 className="font-heading font-bold text-2xl text-text-primary mb-6 text-center">Get In Touch</h2>
            <div className="grid md:grid-cols-3 gap-6 text-center">
              <a href={`mailto:${c.email}`} className="flex flex-col items-center gap-2 p-5 bg-surface-alt border border-border-subtle rounded-xl hover:bg-surface transition-all">
                <div className="w-10 h-10 bg-brand-primary/10 rounded-xl flex items-center justify-center text-brand-primary">
                  <Mail className="w-5 h-5" />
                </div>
                <span className="text-text-primary text-sm font-medium">{c.email}</span>
              </a>
              <a href={`tel:${c.phone}`} className="flex flex-col items-center gap-2 p-5 bg-surface-alt border border-border-subtle rounded-xl hover:bg-surface transition-all">
                <div className="w-10 h-10 bg-accent-mint/15 rounded-xl flex items-center justify-center text-accent-mint">
                  <Phone className="w-5 h-5" />
                </div>
                <span className="text-text-primary text-sm font-medium">{c.phone}</span>
              </a>
              <div className="flex flex-col items-center gap-2 p-5 bg-surface-alt border border-border-subtle rounded-xl">
                <div className="w-10 h-10 bg-brand-secondary/15 rounded-xl flex items-center justify-center text-brand-secondary">
                  <MapPin className="w-5 h-5" />
                </div>
                <span className="text-text-primary text-sm font-medium text-center">{c.address}</span>
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

