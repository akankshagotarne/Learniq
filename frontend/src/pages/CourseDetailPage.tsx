import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Star, BookOpen, Clock, Users, Play, Lock, FileText, CheckCircle, Award, ChevronDown, ChevronUp } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course, Lecture, Note } from '../types';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { loadRazorpayScript } from '../utils/razorpay';

const getSubjectBadge = (subject: string) => {
  const lower = subject.toLowerCase();
  if (lower.includes('marathi') || lower.includes('english') || lower.includes('language') || lower.includes('hindi')) {
    return 'badge-subject-languages';
  }
  if (lower.includes('science') || lower.includes('environ') || lower.includes('evs')) {
    return 'badge-subject-science';
  }
  if (lower.includes('math')) {
    return 'badge-subject-math';
  }
  return 'bg-[#EDE9FE] text-[#6C63F2] dark:bg-[#2E2856] dark:text-[#B69CF2]';
};

const CourseDetailPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [showAllLectures, setShowAllLectures] = useState(false);

  useEffect(() => {
    api.get(`/courses/${id}`).then(r => {
      setCourse(r.data.course);
      setLectures(r.data.lectures || []);
      setIsEnrolled(r.data.isEnrolled || false);
    }).catch(() => navigate('/courses')).finally(() => setLoading(false));
  }, [id, navigate]);

  const handleEnroll = async () => {
    if (!user) { navigate('/login'); return; }
    if (course?.isFree) {
      setEnrolling(true);
      try {
        await api.post(`/courses/${id}/enroll`);
        setIsEnrolled(true);
        toast.success('Enrolled successfully!');
      } catch (e: any) {
        toast.error(e.response?.data?.message || 'Enrollment failed');
      } finally {
        setEnrolling(false);
      }
      return;
    }

    // Real Razorpay Checkout flow for paid courses
    setEnrolling(true);
    try {
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded) {
        toast.error('Failed to load Razorpay payment gateway. Please check your internet connection.');
        setEnrolling(false);
        return;
      }

      const orderRes = await api.post('/payments/create-order', {
        type: 'course',
        itemId: id,
      });

      if (!orderRes.data.success || !orderRes.data.order) {
        toast.error(orderRes.data.message || 'Failed to create payment order.');
        setEnrolling(false);
        return;
      }

      const { order, paymentId, keyId } = orderRes.data;

      const options = {
        key: keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'Learniq',
        description: `Enrollment: ${course?.title}`,
        order_id: order.id,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        theme: {
          color: '#6C63F2',
        },
        handler: async function (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) {
          try {
            toast.loading('Verifying payment with bank...', { id: 'verify-toast' });
            const verifyRes = await api.post('/payments/verify', {
              paymentId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });

            if (verifyRes.data.success) {
              toast.success('Payment verified successfully! 🎉', { id: 'verify-toast' });
              setIsEnrolled(true);
              navigate(`/payment?success=true&type=course&id=${id}&paymentId=${response.razorpay_payment_id}&txnId=${response.razorpay_order_id}&amount=${order.amount / 100}`);
            } else {
              toast.error(verifyRes.data.message || 'Payment signature verification failed.', { id: 'verify-toast' });
            }
          } catch (verifyErr: any) {
            console.error('Verification error:', verifyErr);
            toast.error(
              verifyErr.response?.data?.message || 'Payment verification failed. Please contact support.',
              { id: 'verify-toast' }
            );
          } finally {
            setEnrolling(false);
          }
        },
        modal: {
          ondismiss: function () {
            setEnrolling(false);
            toast('Payment cancelled. You have not been charged.');
          },
        },
      };

      const razorpayInstance = new (window as any).Razorpay(options);

      razorpayInstance.on('payment.failed', function (response: any) {
        console.error('Razorpay payment failed:', response.error);
        toast.error(response.error?.description || 'Payment was declined or failed.');
        setEnrolling(false);
      });

      razorpayInstance.open();
    } catch (err: any) {
      console.error('Order creation error:', err);
      toast.error(err.response?.data?.message || 'Failed to start payment. Please try again.');
      setEnrolling(false);
    }
  };

  const displayedLectures = showAllLectures ? lectures : lectures.slice(0, 5);

  if (loading) {
    return (
      <div className="min-h-screen bg-page">
        <Navbar />
        <div className="pt-24 page-container py-8">
          <div className="card-soft h-64 rounded-2xl mb-8 animate-pulse bg-surface-alt" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {[...Array(5)].map((_, i) => <div key={i} className="card-soft h-16 rounded-xl animate-pulse bg-surface-alt" />)}
            </div>
            <div className="card-soft h-80 rounded-2xl animate-pulse bg-surface-alt" />
          </div>
        </div>
      </div>
    );
  }

  if (!course) return null;

  const teacher = course.teacher as any;

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <Navbar />
      <div className="pt-20 flex-1">
        {/* Hero */}
        <div className="bg-surface border-b border-border-subtle py-10 transition-colors">
          <div className="page-container">
            <div className="grid lg:grid-cols-3 gap-8 items-start">
              <div className="lg:col-span-2">
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className={`badge ${getSubjectBadge(course.subject)} font-medium`}>{course.subject}</span>
                  <span className="badge bg-surface-alt border border-border-subtle text-text-secondary font-medium">Standard {course.standard}</span>
                  <span className="badge bg-surface-alt border border-border-subtle text-text-secondary font-medium">{course.level}</span>
                  {course.isFree ? <span className="badge-free">FREE</span> : <span className="badge-paid">₹{course.price}</span>}
                </div>
                <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary mb-4 leading-tight">{course.title}</h1>
                <p className="text-text-secondary text-sm leading-relaxed mb-6">{course.description}</p>

                <div className="flex flex-wrap items-center gap-6 text-sm text-text-secondary">
                  <div className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <Star className="w-4 h-4 text-accent-amber fill-accent-amber" />
                    <span>{course.rating || '4.8'}</span>
                    <span className="text-text-muted font-normal">({course.totalRatings || 24} ratings)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-accent-mint" /> {course.enrolledCount} students
                  </div>
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-brand-primary" /> {course.totalLectures} lectures
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-accent-sky" /> {course.duration}
                  </div>
                </div>
              </div>

              {/* Course Card - desktop */}
              <div className="hidden lg:block">
                <div className="bg-surface border border-border-subtle rounded-card overflow-hidden shadow-soft sticky top-24 transition-colors">
                  <img
                    src={course.thumbnail || `https://picsum.photos/seed/${course.subject}/400/225`}
                    alt={course.title}
                    className="w-full aspect-video object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/400/225'; }}
                  />
                  <div className="p-6">
                    {course.isFree ? (
                      <p className="text-2xl font-heading font-bold text-accent-mint mb-4">Free</p>
                    ) : (
                      <p className="text-2xl font-heading font-bold text-text-primary mb-4">₹{course.price}</p>
                    )}

                    {isEnrolled ? (
                      <Link to={`/courses/${id}/lecture/${lectures[0]?._id}`} className="btn-primary w-full text-center py-3 flex items-center justify-center gap-2">
                        <Play className="w-4 h-4" /> Continue Learning
                      </Link>
                    ) : (
                      <button onClick={handleEnroll} disabled={enrolling} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
                        {enrolling ? (
                          <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enrolling...</>
                        ) : course.isFree ? (
                          <><CheckCircle className="w-4 h-4" /> Enroll Free</>
                        ) : (
                          <>Buy Now — ₹{course.price}</>
                        )}
                      </button>
                    )}
                    <p className="text-text-muted text-xs text-center mt-3">30-day money-back guarantee</p>

                    <div className="mt-5 pt-4 border-t border-border-subtle space-y-2.5 text-xs text-text-secondary">
                      <div className="flex items-center gap-2.5"><BookOpen className="w-4 h-4 text-brand-primary" /> {course.totalLectures} comprehensive lectures</div>
                      <div className="flex items-center gap-2.5"><Clock className="w-4 h-4 text-accent-sky" /> {course.duration} total duration</div>
                      <div className="flex items-center gap-2.5"><FileText className="w-4 h-4 text-accent-amber" /> Downloadable notes & summaries</div>
                      <div className="flex items-center gap-2.5"><Award className="w-4 h-4 text-accent-mint" /> Certificate on completion</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="page-container py-8">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              {/* Teacher Profile */}
              {teacher && (
                <div className="card-soft p-6">
                  <h2 className="font-heading text-lg font-bold text-text-primary mb-5">About Your Teacher</h2>
                  <div className="flex items-start gap-5">
                    <img
                      src={teacher.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name || 'T')}&background=6C63F2&color=fff&size=80`}
                      alt={teacher.name}
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-brand-primary/30 flex-shrink-0 shadow-sm"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-heading text-text-primary font-semibold text-lg">{teacher.name}</h3>
                      {teacher.qualification && <p className="text-brand-primary font-medium text-sm mb-1">{teacher.qualification}</p>}
                      {teacher.experience && <p className="text-text-secondary text-xs mb-2 font-medium">📅 {teacher.experience} experience</p>}
                      {teacher.bio && <p className="text-text-secondary text-sm leading-relaxed">{teacher.bio}</p>}
                      <div className="flex flex-wrap gap-2 mt-4">
                        {teacher.subjects?.map((s: string) => (
                          <span key={s} className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-xs font-medium">{s}</span>
                        ))}
                        {teacher.standards?.map((s: number) => (
                          <span key={s} className="badge bg-surface-alt border border-border-subtle text-text-secondary text-xs font-medium">Std {s}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Lecture List */}
              <div className="card-soft p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-heading text-lg font-bold text-text-primary">
                    Course Content <span className="text-text-muted text-sm font-normal">({course.totalLectures} lectures)</span>
                  </h2>
                </div>

                <div className="space-y-2.5">
                  {displayedLectures.map((lecture, index) => {
                    const isFree = lecture.isFree;
                    const canAccess = isFree || isEnrolled || user?.role === 'teacher' || user?.role === 'admin';

                    return (
                      <div
                        key={lecture._id}
                        className={`flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                          canAccess
                            ? 'border-border-subtle bg-surface-alt hover:bg-surface hover:border-brand-primary/40 hover:shadow-soft cursor-pointer'
                            : 'border-border-subtle/60 bg-surface-alt/40 opacity-70'
                        }`}
                        onClick={() => canAccess && navigate(`/courses/${id}/lecture/${lecture._id}`)}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          isFree
                            ? 'bg-accent-mint/15 text-accent-mint'
                            : 'bg-brand-primary/10 text-brand-primary'
                        }`}>
                          {canAccess ? <Play className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-text-muted" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{lecture.title}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-text-muted text-xs flex items-center gap-1 font-medium">
                              <Clock className="w-3 h-3" /> {lecture.videoDuration}
                            </span>
                            {lecture.hasNotes && (
                              <span className="text-text-muted text-xs flex items-center gap-1 font-medium">
                                <FileText className="w-3 h-3 text-accent-amber" /> Notes
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex-shrink-0">
                          {isFree ? (
                            <span className="badge-free text-xs">FREE</span>
                          ) : !isEnrolled ? (
                            <span className="text-text-secondary text-xs font-semibold">₹{lecture.price}</span>
                          ) : (
                            <CheckCircle className="w-4 h-4 text-accent-mint" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lectures.length > 5 && (
                  <button
                    onClick={() => setShowAllLectures(!showAllLectures)}
                    className="w-full mt-4 py-3 text-sm text-brand-primary hover:text-brand-primary-hover font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {showAllLectures ? <><ChevronUp className="w-4 h-4" /> Show Less</> : <><ChevronDown className="w-4 h-4" /> Show All {lectures.length} Lectures</>}
                  </button>
                )}
              </div>
            </div>

            {/* Mobile CTA */}
            <div className="lg:hidden">
              <div className="card-soft p-5">
                {course.isFree ? (
                  <p className="text-2xl font-heading font-bold text-accent-mint mb-4">Free</p>
                ) : (
                  <p className="text-2xl font-heading font-bold text-text-primary mb-4">₹{course.price}</p>
                )}
                {isEnrolled ? (
                  <Link to={`/courses/${id}/lecture/${lectures[0]?._id}`} className="btn-primary w-full text-center py-3 block">
                    Continue Learning
                  </Link>
                ) : (
                  <button onClick={handleEnroll} disabled={enrolling} className="btn-primary w-full py-3">
                    {course.isFree ? 'Enroll Free' : `Buy Now — ₹${course.price}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default CourseDetailPage;

