import React, { useState } from 'react';
import {
  Mail, Phone, MapPin, Clock, Send, MessageSquare,
  HelpCircle, CheckCircle2, ChevronDown, ChevronUp, Sparkles
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import toast from 'react-hot-toast';

const FAQS = [
  {
    q: 'How do the live interactive classes work?',
    a: 'Live classes happen directly inside your web browser. Students can see and hear expert teachers in real-time, ask doubts via live chat or voice, and participate in live pop-quizzes with instant leaderboards.'
  },
  {
    q: 'Which standards and boards does Learniq cover?',
    a: 'Learniq currently provides specialized curriculum content for Standard 1 through Standard 10, covering CBSE, ICSE, and State Board syllabuses for Mathematics, Science, English, Social Science, and Marathi/Hindi.'
  },
  {
    q: 'What if a student misses a scheduled live class?',
    a: 'Every single live session is recorded and made available immediately in your course dashboard along with teacher slides, handwritten notes, and timestamped bookmarks.'
  },
  {
    q: 'Are teachers verified and experienced?',
    a: 'Yes! Every teacher on Learniq undergoes a rigorous 4-step selection process, background verification, and demo evaluations. Most have 5+ years of classroom experience from top educational institutions.'
  },
  {
    q: 'Can parents monitor their child’s academic progress?',
    a: 'Absolutely. Parents receive detailed visual analytics including attendance, quiz scores, homework completion rates, and learning streak badges in the student progress dashboard.'
  }
];

const ContactPage: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    standard: '10',
    category: 'Admissions & Course Guidance',
    message: '',
  });

  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      toast.success('Thank you! Our academic counselor will reach out within 2 hours. ✨');
      setFormData({
        name: '',
        email: '',
        phone: '',
        standard: '10',
        category: 'Admissions & Course Guidance',
        message: '',
      });
    }, 800);
  };

  return (
    <div className="min-h-screen bg-dark-900 text-white flex flex-col">
      <Navbar />

      <main className="flex-1 pt-24 pb-16">
        {/* Header Hero */}
        <div className="page-container text-center max-w-3xl mb-16">
          <span className="badge-primary text-xs mb-3 inline-block">24/7 Academic Support</span>
          <h1 className="text-3xl sm:text-5xl font-display font-black text-white mb-4">
            We’re Here to Help You <span className="gradient-text">Learn & Grow</span>
          </h1>
          <p className="text-white/60 text-base sm:text-lg">
            Have questions about courses, standard selection, live tuition, or teacher onboarding? Reach out to our team anytime.
          </p>
        </div>

        {/* Contact Info Cards */}
        <div className="page-container max-w-6xl mb-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: Phone,
                title: 'Call Support',
                value: '+91 98765 43210',
                sub: 'Mon - Sat: 9 AM - 8 PM',
                action: 'tel:+919876543210'
              },
              {
                icon: Mail,
                title: 'Email Us',
                value: 'hello@learniq.in',
                sub: 'Quick response in 2 hours',
                action: 'mailto:hello@learniq.in'
              },
              {
                icon: MapPin,
                title: 'Headquarters',
                value: 'Baner Tech Hub',
                sub: 'Pune, Maharashtra 411045',
                action: 'https://maps.google.com'
              },
              {
                icon: Clock,
                title: 'Doubt Hours',
                value: 'Live 4 PM - 9 PM',
                sub: 'Daily teacher helpdesk',
                action: '/live-sessions'
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="glass-card p-6 rounded-2xl border border-white/10 hover:border-primary-500/40 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-primary-500/20 text-primary-400 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">{card.title}</h3>
                  <p className="text-sm font-semibold text-primary-300 mb-1">{card.value}</p>
                  <p className="text-xs text-white/40">{card.sub}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Form and FAQ Split */}
        <div className="page-container max-w-6xl grid lg:grid-cols-12 gap-10">
          {/* Left: Interactive Form */}
          <div className="lg:col-span-6">
            <div className="glass-card p-8 rounded-3xl border border-white/10 shadow-2xl">
              <h2 className="text-xl font-display font-bold text-white mb-2">Send Us a Message</h2>
              <p className="text-xs text-white/50 mb-6">
                Fill out the form below and one of our academic counselors will get back to you right away.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-white/70 block mb-1">Student / Parent Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Priya Sharma"
                    className="input-field text-sm"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/70 block mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="priya@example.com"
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/70 block mb-1">Phone / WhatsApp</label>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+91 98765 00000"
                      className="input-field text-sm"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/70 block mb-1">Standard / Grade</label>
                    <select
                      value={formData.standard}
                      onChange={e => setFormData({ ...formData, standard: e.target.value })}
                      className="input-field text-sm"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(std => (
                        <option key={std} value={std}>Standard {std}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/70 block mb-1">Inquiry Purpose</label>
                    <select
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className="input-field text-sm"
                    >
                      <option>Admissions & Guidance</option>
                      <option>Live Classes Question</option>
                      <option>Apply as a Teacher</option>
                      <option>Payment / Tech Support</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-white/70 block mb-1">Message / Question</label>
                  <textarea
                    rows={4}
                    required
                    value={formData.message}
                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Tell us about the subject or questions you need help with..."
                    className="input-field text-sm resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Sending message...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Request Free Counseling Callback</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right: FAQs */}
          <div className="lg:col-span-6 space-y-6">
            <div>
              <span className="badge-primary text-xs mb-2 inline-block">Frequently Asked Questions</span>
              <h2 className="text-xl font-display font-bold text-white mb-2">Got Questions? We’ve Got Answers</h2>
              <p className="text-xs text-white/50">
                Everything you need to know about the Learniq interactive learning platform.
              </p>
            </div>

            <div className="space-y-3">
              {FAQS.map((faq, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div
                    key={idx}
                    className="glass-card rounded-2xl border border-white/10 overflow-hidden transition-all"
                  >
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      className="w-full p-4 text-left flex items-center justify-between gap-3 text-sm font-semibold text-white hover:text-primary-300 transition-colors"
                    >
                      <span>{faq.q}</span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-primary-400 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" />
                      )}
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 text-xs text-white/60 leading-relaxed border-t border-white/5 pt-3 animate-fade-in">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default ContactPage;
