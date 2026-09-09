import React, { useEffect, useState } from 'react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Mail, Phone, MapPin, Target, Eye, Heart, Sparkles } from 'lucide-react';

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

          {/* Meet Our Founder & Mentor */}
          <div className="mb-20">
            <div className="text-center mb-10">
              <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 mb-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Leadership & Vision</span>
              </span>
              <h2 className="font-heading font-black text-3xl md:text-4xl text-text-primary mb-3">
                Meet Our <span className="text-gradient">Founder & Mentor</span>
              </h2>
              <p className="text-text-secondary text-sm md:text-base max-w-2xl mx-auto">
                Shaping student-centric education with deep academic rigor, holistic mentorship, and accessible digital learning.
              </p>
            </div>

            <div className="card-soft p-6 sm:p-8 lg:p-10 max-w-4xl mx-auto rounded-3xl border border-border-subtle shadow-soft hover:shadow-soft-hover transition-all">
              <div className="grid md:grid-cols-12 gap-8 items-center">
                {/* Founder Photo Column */}
                <div className="md:col-span-5 flex flex-col items-center text-center">
                  <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-br from-brand-primary to-brand-secondary rounded-2xl blur-sm opacity-30 group-hover:opacity-50 transition duration-300" />
                    <img
                      src="/assets/team/mayur-raut.jpg"
                      alt="Prof. Mayur Raut - Founder & Mentor"
                      className="relative w-56 h-72 sm:w-64 sm:h-80 object-cover object-top rounded-2xl shadow-md border-2 border-white dark:border-[#2E2F4A]"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Mayur+Raut&background=6C63F2&color=fff&size=400';
                      }}
                    />
                  </div>
                  <div className="mt-4">
                    <h3 className="font-heading text-xl font-bold text-text-primary">Prof. Mayur Raut</h3>
                    <p className="text-brand-primary text-xs font-semibold uppercase tracking-wider mt-1">Founder & Mentor</p>
                  </div>
                </div>

                {/* Founder Bio Column */}
                <div className="md:col-span-7 space-y-5 text-left">
                  <div>
                    <span className="badge bg-surface-alt text-brand-primary border border-border-subtle text-xs font-semibold px-2.5 py-0.5 mb-2 inline-block">
                      Academic Leadership & Pedagogy
                    </span>
                    <h4 className="font-heading text-2xl font-bold text-text-primary">
                      Empowering Learners from Standard 1 to 10
                    </h4>
                  </div>

                  <p className="text-text-secondary text-sm leading-relaxed">
                    With years of dedicated academic mentorship and a deep passion for student-centric pedagogy, Prof. Mayur Raut conceptualized Learniq to bridge the divide between conventional schooling and modern digital learning.
                  </p>

                  <p className="text-text-secondary text-sm leading-relaxed">
                    He guides the platform’s core educational framework, ensuring that lessons foster genuine conceptual clarity, analytical thinking, and lifelong curiosity. Under his mentorship, Learniq is built to deliver quality, supportive, and accessible education to every child across India.
                  </p>

                  {/* Pull-Quote */}
                  <div className="bg-surface-alt/70 border-l-4 border-brand-primary p-4 rounded-r-2xl space-y-2">
                    <p className="text-xs sm:text-sm italic text-text-primary font-medium leading-relaxed">
                      “True education goes beyond textbooks and exams—it is about igniting genuine curiosity in a young mind and nurturing the confidence to question, understand, and grow.”
                    </p>
                    <p className="text-[11px] font-semibold text-brand-primary">
                      — Prof. Mayur Raut
                    </p>
                  </div>

                  {/* Highlight Badges */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <span className="badge bg-brand-primary/10 text-brand-primary text-xs font-medium">
                      Student-First Pedagogy
                    </span>
                    <span className="badge bg-accent-mint/15 text-accent-mint text-xs font-medium">
                      Curriculum Innovation
                    </span>
                    <span className="badge bg-accent-sky/15 text-accent-sky text-xs font-medium">
                      Holistic Mentorship
                    </span>
                  </div>
                </div>
              </div>
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

