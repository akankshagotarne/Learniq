import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Star, BookOpen, Clock, Users, Play, Lock, FileText, CheckCircle, Award, ChevronDown, ChevronUp } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course, Lecture, Note } from '../types';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

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
    } else {
      // Payment flow
      navigate(`/payment?type=course&id=${id}&amount=${course?.price}`);
    }
  };

  const displayedLectures = showAllLectures ? lectures : lectures.slice(0, 5);

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="pt-20 page-container py-8">
          <div className="skeleton h-64 rounded-2xl mb-8" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
            <div className="skeleton h-80 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!course) return null;

  const teacher = course.teacher as any;

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="pt-20 bg-dark-900 min-h-screen">
        {/* Hero */}
        <div className="bg-dark-800 border-b border-white/10 py-10">
          <div className="page-container">
            <div className="grid lg:grid-cols-3 gap-8 items-start">
              <div className="lg:col-span-2">
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="badge-primary">{course.subject}</span>
                  <span className="badge bg-dark-700/60 text-white/60">Standard {course.standard}</span>
                  <span className="badge bg-dark-700/60 text-white/60">{course.level}</span>
                  {course.isFree ? <span className="badge-free">FREE</span> : <span className="badge-paid">₹{course.price}</span>}
                </div>
                <h1 className="font-display font-bold text-2xl md:text-3xl text-white mb-4">{course.title}</h1>
                <p className="text-white/60 text-sm leading-relaxed mb-6">{course.description}</p>

                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    <span className="text-white font-semibold">{course.rating}</span>
                    <span className="text-white/40">({course.totalRatings} ratings)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-white/60">
                    <Users className="w-4 h-4" /> {course.enrolledCount} students
                  </div>
                  <div className="flex items-center gap-1.5 text-white/60">
                    <BookOpen className="w-4 h-4" /> {course.totalLectures} lectures
                  </div>
                  <div className="flex items-center gap-1.5 text-white/60">
                    <Clock className="w-4 h-4" /> {course.duration}
                  </div>
                </div>
              </div>

              {/* Course Card - desktop */}
              <div className="hidden lg:block">
                <div className="glass-card overflow-hidden sticky top-24">
                  <img
                    src={course.thumbnail || `https://picsum.photos/seed/${course.subject}/400/225`}
                    alt={course.title}
                    className="w-full aspect-video object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/400/225'; }}
                  />
                  <div className="p-5">
                    {course.isFree ? (
                      <p className="text-2xl font-bold text-accent-400 mb-4">Free</p>
                    ) : (
                      <p className="text-2xl font-bold text-white mb-4">₹{course.price}</p>
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
                    <p className="text-white/30 text-xs text-center mt-3">30-day money-back guarantee</p>

                    <div className="mt-4 space-y-2 text-sm text-white/50">
                      <div className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> {course.totalLectures} lectures</div>
                      <div className="flex items-center gap-2"><Clock className="w-4 h-4" /> {course.duration} total</div>
                      <div className="flex items-center gap-2"><FileText className="w-4 h-4" /> Downloadable notes</div>
                      <div className="flex items-center gap-2"><Award className="w-4 h-4" /> Certificate on completion</div>
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
                <div className="glass-card p-6">
                  <h2 className="text-lg font-bold text-white mb-5">About Your Teacher</h2>
                  <div className="flex items-start gap-4">
                    <img
                      src={teacher.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name || 'T')}&background=6C63FF&color=fff&size=80`}
                      alt={teacher.name}
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-primary-500/30 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-semibold text-lg">{teacher.name}</h3>
                      {teacher.qualification && <p className="text-primary-400 text-sm mb-1">{teacher.qualification}</p>}
                      {teacher.experience && <p className="text-white/50 text-sm mb-2">📅 {teacher.experience} experience</p>}
                      {teacher.bio && <p className="text-white/60 text-sm leading-relaxed">{teacher.bio}</p>}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {teacher.subjects?.map((s: string) => <span key={s} className="badge-primary text-xs">{s}</span>)}
                        {teacher.standards?.map((s: number) => <span key={s} className="badge bg-white/10 text-white/50 text-xs">Std {s}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Lecture List */}
              <div className="glass-card p-6">
                <h2 className="text-lg font-bold text-white mb-5">
                  Course Content <span className="text-white/40 text-base font-normal">({course.totalLectures} lectures)</span>
                </h2>

                <div className="space-y-2">
                  {displayedLectures.map((lecture, index) => {
                    const isFree = lecture.isFree;
                    const canAccess = isFree || isEnrolled || user?.role === 'teacher' || user?.role === 'admin';

                    return (
                      <div key={lecture._id} className={`flex items-center gap-3 p-4 rounded-xl border transition-all
                        ${canAccess ? 'border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer' : 'border-white/5 bg-white/[0.02] opacity-60'}`}
                        onClick={() => canAccess && navigate(`/courses/${id}/lecture/${lecture._id}`)}>

                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold
                          ${isFree ? 'bg-accent-500/20 text-accent-400' : 'bg-white/10 text-white/60'}`}>
                          {canAccess ? (isFree ? <Play className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />) : <Lock className="w-3.5 h-3.5" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{lecture.title}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-white/40 text-xs flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {lecture.videoDuration}
                            </span>
                            {lecture.hasNotes && <span className="text-white/40 text-xs flex items-center gap-1"><FileText className="w-3 h-3" /> Notes</span>}
                          </div>
                        </div>

                        <div className="flex-shrink-0">
                          {isFree ? (
                            <span className="badge-free text-xs">FREE</span>
                          ) : !isEnrolled ? (
                            <span className="text-white/40 text-xs">₹{lecture.price}</span>
                          ) : (
                            <CheckCircle className="w-4 h-4 text-accent-400" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lectures.length > 5 && (
                  <button
                    onClick={() => setShowAllLectures(!showAllLectures)}
                    className="w-full mt-4 py-3 text-sm text-primary-400 hover:text-primary-300 flex items-center justify-center gap-2 transition-colors"
                  >
                    {showAllLectures ? <><ChevronUp className="w-4 h-4" /> Show Less</> : <><ChevronDown className="w-4 h-4" /> Show All {lectures.length} Lectures</>}
                  </button>
                )}
              </div>
            </div>

            {/* Mobile CTA */}
            <div className="lg:hidden">
              <div className="glass-card p-5">
                {course.isFree ? (
                  <p className="text-2xl font-bold text-accent-400 mb-4">Free</p>
                ) : (
                  <p className="text-2xl font-bold text-white mb-4">₹{course.price}</p>
                )}
                {isEnrolled ? (
                  <Link to={`/courses/${id}/lecture/${lectures[0]?._id}`} className="btn-primary w-full text-center py-3 block text-center">
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
