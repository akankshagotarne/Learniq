import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Star, BookOpen, Clock, Users, Play, Lock, FileText, CheckCircle,
  Award, ChevronDown, ChevronUp, Download, AlertCircle, Sparkles, Check
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course, Lecture, Note } from '../types';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { loadRazorpayScript } from '../utils/razorpay';
import { generateCourseNotes } from '../utils/generateCourseNotes';
import { getCourseThumbnail, getTeacherPhoto } from '../utils/courseImage';

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
    }).catch(() => {
      navigate('/courses');
    }).finally(() => setLoading(false));
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

  const handleDownloadNotes = () => {
    if (!course) return;
    const chapters = (course.syllabus && course.syllabus.length > 0)
      ? course.syllabus
      : (lectures.length > 0 ? lectures.map(l => l.title) : ['1. Course Introduction', '2. Core Principles', '3. Advanced Concepts', '4. Chapter Review']);

    const teacherObj = course.teacher as any;
    generateCourseNotes({
      courseTitle: course.title,
      courseStandard: course.standard,
      courseSubject: course.subject,
      teacherName: teacherObj?.name || 'Assigned Subject Specialist',
      teacherQualification: teacherObj?.qualification || 'Senior Maharashtra State Board Specialist',
      chapters,
      isFlagged: course.isFlagged,
    });
    toast.success('Downloaded course notes & syllabus PDF! 📄');
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
                    src={getCourseThumbnail(course)}
                    alt={course.title}
                    className="w-full aspect-video object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = getCourseThumbnail(course); }}
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

                    <button
                      onClick={handleDownloadNotes}
                      className="w-full mt-3.5 py-2.5 px-3 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/25 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Syllabus & Notes (PDF)</span>
                    </button>

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
                <div className="card-soft p-6 sm:p-7 rounded-2xl border border-border-subtle">
                  <div className="flex items-center justify-between gap-3 mb-5">
                    <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-xs font-semibold px-3 py-1 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Assigned Subject Faculty</span>
                    </span>
                    <span className="text-xs text-text-muted font-medium">Maharashtra State Board Mentor</span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                    <img
                      src={getTeacherPhoto(teacher, course.subject)}
                      alt={teacher.name}
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-brand-primary/30 flex-shrink-0 shadow-sm bg-surface-alt"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = getTeacherPhoto(null, course.subject);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-heading text-text-primary font-bold text-xl">{teacher.name}</h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent-mint/15 text-accent-mint border border-accent-mint/30">
                          <Check className="w-3 h-3" /> Verified Faculty
                        </span>
                      </div>

                      {teacher.qualification && (
                        <p className="text-brand-primary font-semibold text-xs sm:text-sm mt-0.5">{teacher.qualification}</p>
                      )}
                      {teacher.experience && (
                        <p className="text-text-secondary text-xs mt-1 font-medium">📅 {teacher.experience} of classroom & board exam mentorship</p>
                      )}
                      {teacher.bio && (
                        <p className="text-text-secondary text-xs sm:text-sm leading-relaxed mt-2.5">{teacher.bio}</p>
                      )}

                      <div className="flex flex-wrap gap-1.5 mt-4">
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

              {/* Official Syllabus Blueprint */}
              <div className="card-soft p-6 sm:p-7 rounded-2xl border border-border-subtle">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="font-heading text-lg font-bold text-text-primary flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-brand-primary" />
                      <span>Official Syllabus Outline (SSC Pattern)</span>
                    </h2>
                    <p className="text-text-secondary text-xs mt-0.5">
                      Maharashtra State Board (Balbharati / MSCERT) English Medium Curriculum
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadNotes}
                    className="btn-outline text-xs py-1.5 px-3 flex items-center gap-1.5 font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>
                </div>

                {course.isFlagged && (
                  <div className="mb-4 p-3.5 rounded-xl bg-accent-amber/10 border border-accent-amber/30 flex items-start gap-3 text-xs text-accent-amber leading-relaxed">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Curriculum Verification Notice</p>
                      <p className="mt-0.5 text-text-secondary">
                        {course.flagReason || 'Some chapter titles for this course are sourced from syllabus outlines and are marked with placeholders pending final textbook scan spot-checks.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-2.5 pt-2 max-h-96 overflow-y-auto pr-1">
                  {((course.syllabus && course.syllabus.length > 0) ? course.syllabus : (lectures.length > 0 ? lectures.map(l => l.title) : [])).map((chap, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2.5 p-2.5 rounded-xl bg-surface-alt border border-border-subtle/70 text-xs"
                    >
                      <span className="w-5 h-5 rounded-md bg-brand-primary/10 text-brand-primary font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                        {idx + 1}
                      </span>
                      <span className="text-text-primary font-medium leading-relaxed">
                        {chap}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lecture List */}
              <div className="card-soft p-6 sm:p-7 rounded-2xl border border-border-subtle">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="font-heading text-lg font-bold text-text-primary">
                      Course Video Lessons <span className="text-text-muted text-sm font-normal">({lectures.length} lessons in syllabus order)</span>
                    </h2>
                    <p className="text-text-secondary text-xs mt-0.5">Stream recorded lesson breakdowns with active notes</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {displayedLectures.map((lecture, index) => {
                    const isFree = lecture.isFree;
                    const canAccess = isFree || isEnrolled || user?.role === 'teacher' || user?.role === 'admin';

                    return (
                      <div
                        key={lecture._id}
                        className={`flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl border transition-all ${
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
                                <FileText className="w-3 h-3 text-accent-amber" /> Chapter Notes
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex-shrink-0">
                          {isFree ? (
                            <span className="badge-free text-xs">FREE PREVIEW</span>
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
                    className="w-full mt-4 py-3 text-sm text-brand-primary hover:text-brand-primary-hover font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {showAllLectures ? <><ChevronUp className="w-4 h-4" /> Show Less</> : <><ChevronDown className="w-4 h-4" /> Show All {lectures.length} Lessons</>}
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

                <button
                  onClick={handleDownloadNotes}
                  className="w-full mt-3 py-2 px-3 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/25 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Syllabus & Notes (PDF)</span>
                </button>
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

