import React, { useEffect, useState } from 'react';
import {
  BookOpen, Plus, Search, Video, FileText, Star, Users, Layers,
  Globe, Lock, Edit3, X, UploadCloud, CheckCircle2, PlayCircle,
  ChevronDown, ChevronUp, Clock, IndianRupee, Archive, ArchiveRestore,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Course, Lecture } from '../../types';
import toast from 'react-hot-toast';
import { ALL_SUBJECTS } from '../../constants/olympiadSubjects';

const SUBJECTS = ALL_SUBJECTS;
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

const getSubjectBadgeClass = (subject: string) => {
  const s = (subject || '').toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('hindi') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const levelColor: Record<string, string> = {
  Beginner: 'bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A]',
  Intermediate: 'bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B]',
  Advanced: 'bg-[#E1447A]/15 text-[#E1447A]',
};

const emptyCourseForm = {
  title: '', description: '', subject: 'Mathematics', standard: '10',
  level: 'Beginner', language: 'English', isFree: true, price: '',
};

const emptyLectureForm = { title: '', description: '', order: '1', isFree: false, price: '', videoDuration: '' };

const TeacherCourses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [standardFilter, setStandardFilter] = useState('All');
  const [subjectFilter, setSubjectFilter] = useState('All');

  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  // Create / edit course modal
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const [savingCourse, setSavingCourse] = useState(false);

  // Add lecture modal
  const [lectureModalCourse, setLectureModalCourse] = useState<Course | null>(null);
  const [lectureForm, setLectureForm] = useState(emptyLectureForm);
  const [lectureVideo, setLectureVideo] = useState<File | null>(null);
  const [lectureUploadPct, setLectureUploadPct] = useState(0);
  const [savingLecture, setSavingLecture] = useState(false);

  // Add notes modal
  const [notesModalLecture, setNotesModalLecture] = useState<Lecture | null>(null);
  const [notesFile, setNotesFile] = useState<File | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [coursesRes, lecturesRes] = await Promise.all([
        api.get('/teacher/courses'),
        api.get('/teacher/lectures'),
      ]);
      setCourses(coursesRes.data.courses || []);
      setLectures(lecturesRes.data.lectures || []);
    } catch (err) {
      console.error('Failed to load courses', err);
      toast.error('Failed to load your courses.');
    } finally {
      setLoading(false);
    }
  };

  // ── Course create / edit ──────────────────────────────────────────────
  const openCreateCourse = () => {
    setEditingCourseId(null);
    setCourseForm(emptyCourseForm);
    setShowCourseModal(true);
  };

  const openEditCourse = (course: Course) => {
    setEditingCourseId(course._id);
    setCourseForm({
      title: course.title,
      description: course.description,
      subject: course.subject,
      standard: String(course.standard),
      level: course.level || 'Beginner',
      language: course.language || 'English',
      isFree: course.isFree,
      price: course.price ? String(course.price) : '',
    });
    setShowCourseModal(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseForm.title.trim() || !courseForm.description.trim()) {
      toast.error('Please fill in the title and description.');
      return;
    }
    setSavingCourse(true);
    try {
      const payload = {
        title: courseForm.title.trim(),
        description: courseForm.description.trim(),
        subject: courseForm.subject,
        standard: parseInt(courseForm.standard, 10),
        level: courseForm.level,
        language: courseForm.language,
        isFree: courseForm.isFree,
        price: courseForm.isFree ? 0 : parseFloat(courseForm.price) || 0,
      };

      if (editingCourseId) {
        const res = await api.put(`/teacher/courses/${editingCourseId}`, payload);
        setCourses(prev => prev.map(c => (c._id === editingCourseId ? res.data.course : c)));
        toast.success('Course updated!');
      } else {
        const res = await api.post('/teacher/courses', payload);
        setCourses(prev => [res.data.course, ...prev]);
        toast.success('Course created! Add some lectures to get it going.');
      }
      setShowCourseModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save course');
    } finally {
      setSavingCourse(false);
    }
  };

  const handleToggleActive = async (course: Course) => {
    try {
      const res = await api.put(`/teacher/courses/${course._id}`, { isActive: !course.isActive });
      setCourses(prev => prev.map(c => (c._id === course._id ? res.data.course : c)));
      toast.success(res.data.course.isActive ? 'Course unarchived — visible to students again.' : 'Course archived — hidden from students.');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update course');
    }
  };

  // ── Lecture create ────────────────────────────────────────────────────
  const openAddLecture = (course: Course) => {
    setLectureModalCourse(course);
    const courseLectures = lectures.filter(l => getCourseId(l) === course._id);
    setLectureForm({ ...emptyLectureForm, order: String(courseLectures.length + 1) });
    setLectureVideo(null);
    setLectureUploadPct(0);
  };

  const handleAddLecture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lectureModalCourse) return;
    if (!lectureForm.title.trim()) {
      toast.error('Please give the lecture a title.');
      return;
    }
    if (!lectureVideo) {
      toast.error('Please choose a video file to upload.');
      return;
    }

    const fd = new FormData();
    fd.append('title', lectureForm.title.trim());
    fd.append('description', lectureForm.description.trim());
    fd.append('course', lectureModalCourse._id);
    fd.append('standard', String(lectureModalCourse.standard));
    fd.append('subject', lectureModalCourse.subject);
    fd.append('order', lectureForm.order || '1');
    fd.append('isFree', String(lectureForm.isFree));
    fd.append('price', lectureForm.isFree ? '0' : (lectureForm.price || '0'));
    if (lectureForm.videoDuration.trim()) fd.append('videoDuration', lectureForm.videoDuration.trim());
    fd.append('video', lectureVideo);

    setSavingLecture(true);
    setLectureUploadPct(0);
    try {
      const res = await api.post('/teacher/lectures', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          if (evt.total) setLectureUploadPct(Math.round((evt.loaded * 100) / evt.total));
        },
      });
      setLectures(prev => [res.data.lecture, ...prev]);
      setCourses(prev => prev.map(c => (c._id === lectureModalCourse._id ? { ...c, totalLectures: (c.totalLectures || 0) + 1 } : c)));
      toast.success('Lecture uploaded!');
      setExpandedCourseId(lectureModalCourse._id);
      setLectureModalCourse(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to upload lecture');
    } finally {
      setSavingLecture(false);
    }
  };

  // ── Notes (PDF) upload ────────────────────────────────────────────────
  const handleAddNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notesModalLecture || !notesFile) {
      toast.error('Please choose a PDF file.');
      return;
    }
    const courseObj = notesModalLecture.course as any;
    const fd = new FormData();
    fd.append('title', `${notesModalLecture.title} — Notes`);
    fd.append('lecture', notesModalLecture._id);
    fd.append('course', typeof courseObj === 'string' ? courseObj : courseObj?._id);
    fd.append('standard', String(notesModalLecture.standard));
    fd.append('subject', notesModalLecture.subject);
    fd.append('isFree', String(notesModalLecture.isFree));
    fd.append('price', String(notesModalLecture.price || 0));
    fd.append('pdf', notesFile);

    setSavingNotes(true);
    try {
      await api.post('/teacher/notes', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setLectures(prev => prev.map(l => (l._id === notesModalLecture._id ? { ...l, hasNotes: true } : l)));
      toast.success('Notes attached to lecture!');
      setNotesModalLecture(null);
      setNotesFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to upload notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const getCourseId = (l: Lecture) => (typeof l.course === 'string' ? l.course : l.course?._id);

  const filteredCourses = courses.filter(c => {
    const matchesSearch = c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.subject.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStd = standardFilter === 'All' || String(c.standard) === standardFilter;
    const matchesSubject = subjectFilter === 'All' || c.subject === subjectFilter;
    return matchesSearch && matchesStd && matchesSubject;
  });

  const totalLectureCount = courses.reduce((sum, c) => sum + (c.totalLectures || 0), 0);
  const totalEnrolled = courses.reduce((sum, c) => sum + (c.enrolledCount || 0), 0);
  const activeCount = courses.filter(c => c.isActive).length;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="p-2 rounded-xl bg-[#6C63F2]/10 text-brand-primary">
                  <BookOpen className="w-5 h-5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                  Course Management
                </span>
              </div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">My Courses</h1>
              <p className="text-text-secondary text-sm mt-1">
                Create courses, upload video lectures, and attach study notes for your students
              </p>
            </div>

            <button onClick={openCreateCourse} className="btn-primary self-start sm:self-auto py-2.5 px-5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand-primary/20">
              <Plus className="w-4 h-4" /> Create New Course
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center font-bold">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Total Courses</p>
                <p className="text-xl font-heading font-bold text-text-primary">{courses.length}</p>
              </div>
            </div>
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#5AC8FA]/15 text-[#5AC8FA] flex items-center justify-center font-bold">
                <Video className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Total Lectures</p>
                <p className="text-xl font-heading font-bold text-text-primary">{totalLectureCount}</p>
              </div>
            </div>
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Enrolled Students</p>
                <p className="text-xl font-heading font-bold text-text-primary">{totalEnrolled}</p>
              </div>
            </div>
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Live / Archived</p>
                <p className="text-xl font-heading font-bold text-text-primary">{activeCount} / {courses.length - activeCount}</p>
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface mb-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search your courses by title or subject..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <select value={standardFilter} onChange={e => setStandardFilter(e.target.value)}
                className="px-3 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-primary">
                <option value="All">All Standards</option>
                {[...Array(10)].map((_, i) => <option key={i + 1} value={String(i + 1)}>Std {i + 1}</option>)}
              </select>
              <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}
                className="px-3 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-primary">
                <option value="All">All Subjects</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Courses List */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => <div key={i} className="card-soft h-56 rounded-2xl animate-pulse bg-surface-alt" />)}
            </div>
          ) : filteredCourses.length === 0 ? (
            <div className="card-soft p-12 text-center max-w-md mx-auto my-8 bg-surface">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center mb-4">
                <BookOpen className="w-7 h-7" />
              </div>
              <h3 className="font-heading font-bold text-lg text-text-primary mb-1">
                {courses.length === 0 ? 'No courses yet' : 'No courses match your filters'}
              </h3>
              <p className="text-xs text-text-secondary mb-5">
                {courses.length === 0
                  ? "You haven't uploaded any courses or lectures yet. Create your first course to get started."
                  : 'Try a different search term or clear your filters.'}
              </p>
              {courses.length === 0 ? (
                <button onClick={openCreateCourse} className="btn-primary text-xs py-2.5 px-4 inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Create Your First Course
                </button>
              ) : (
                <button onClick={() => { setSearchQuery(''); setStandardFilter('All'); setSubjectFilter('All'); }} className="btn-secondary text-xs py-2 px-4">
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredCourses.map(course => {
                const courseLectures = lectures.filter(l => getCourseId(l) === course._id);
                const isExpanded = expandedCourseId === course._id;

                return (
                  <div key={course._id} className="card-soft rounded-2xl border border-border-subtle bg-surface overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="badge-primary text-[10px] py-0 px-2">Std {course.standard}</span>
                          <span className={`${getSubjectBadgeClass(course.subject)} text-[10px] font-semibold px-2 py-0.5 rounded-full`}>{course.subject}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${levelColor[course.level] || levelColor.Beginner}`}>{course.level}</span>
                        </div>
                        {!course.isActive && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-alt text-text-muted border border-border-subtle flex items-center gap-1 flex-shrink-0">
                            <Archive className="w-3 h-3" /> Archived
                          </span>
                        )}
                      </div>

                      <h3 className="font-heading font-bold text-base text-text-primary line-clamp-1">{course.title}</h3>
                      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{course.description}</p>

                      <div className="grid grid-cols-3 gap-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Video className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
                          <span>{courseLectures.length} Lectures</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Users className="w-3.5 h-3.5 text-[#4ADE9A] flex-shrink-0" />
                          <span>{course.enrolledCount || 0} Enrolled</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Star className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
                          <span>{(course.rating || 0).toFixed(1)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mb-4">
                        {course.isFree ? (
                          <span className="text-[11px] font-bold text-[#16A34A] dark:text-[#4ADE9A] flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Free Course
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-text-primary flex items-center gap-0.5">
                            <IndianRupee className="w-3 h-3" /> {course.price}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => openAddLecture(course)} className="btn-primary text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold">
                          <UploadCloud className="w-3.5 h-3.5" /> Add Lecture
                        </button>
                        <button onClick={() => openEditCourse(course)} className="btn-secondary text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold">
                          <Edit3 className="w-3.5 h-3.5 text-[#5AC8FA]" /> Edit Course
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-subtle">
                        <button
                          onClick={() => handleToggleActive(course)}
                          className="text-[11px] text-text-muted hover:text-text-primary p-1.5 rounded-lg transition-colors flex items-center gap-1"
                        >
                          {course.isActive ? (
                            <><Archive className="w-3.5 h-3.5" /> Archive</>
                          ) : (
                            <><ArchiveRestore className="w-3.5 h-3.5" /> Unarchive</>
                          )}
                        </button>
                        <button
                          onClick={() => setExpandedCourseId(isExpanded ? null : course._id)}
                          className="text-[11px] font-bold text-brand-primary hover:opacity-80 p-1.5 rounded-lg transition-colors flex items-center gap-1"
                        >
                          {isExpanded ? <>Hide Lectures <ChevronUp className="w-3.5 h-3.5" /></> : <>View Lectures <ChevronDown className="w-3.5 h-3.5" /></>}
                        </button>
                      </div>
                    </div>

                    {/* Lecture list (expanded) */}
                    {isExpanded && (
                      <div className="bg-surface-alt border-t border-border-subtle p-4">
                        {courseLectures.length === 0 ? (
                          <div className="text-center py-6">
                            <PlayCircle className="w-8 h-8 text-text-muted mx-auto mb-2" />
                            <p className="text-xs text-text-secondary mb-3">No lectures uploaded for this course yet.</p>
                            <button onClick={() => openAddLecture(course)} className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5">
                              <Plus className="w-3.5 h-3.5" /> Upload First Lecture
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {courseLectures
                              .slice()
                              .sort((a, b) => a.order - b.order)
                              .map(lecture => (
                                <div key={lecture._id} className="flex items-center gap-3 p-2.5 bg-surface rounded-xl border border-border-subtle">
                                  <div className="w-8 h-8 rounded-lg bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center flex-shrink-0 text-xs font-bold">
                                    {lecture.order}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-text-primary truncate">{lecture.title}</p>
                                    <div className="flex items-center gap-2 text-[10px] text-text-muted mt-0.5">
                                      <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {lecture.videoDuration || '0:00'}</span>
                                      <span>•</span>
                                      <span>{lecture.isFree ? 'Free' : `₹${lecture.price}`}</span>
                                      {lecture.hasNotes && (
                                        <>
                                          <span>•</span>
                                          <span className="flex items-center gap-0.5 text-[#16A34A] dark:text-[#4ADE9A]"><FileText className="w-3 h-3" /> Notes attached</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {!lecture.hasNotes && (
                                    <button
                                      onClick={() => { setNotesModalLecture(lecture); setNotesFile(null); }}
                                      title="Attach PDF notes to this lecture"
                                      className="flex-shrink-0 text-[10px] font-bold text-brand-primary hover:bg-brand-primary/10 px-2 py-1.5 rounded-lg flex items-center gap-1"
                                    >
                                      <FileText className="w-3.5 h-3.5" /> Add Notes
                                    </button>
                                  )}
                                </div>
                              ))}
                            <button onClick={() => openAddLecture(course)} className="w-full btn-secondary text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold mt-2">
                              <Plus className="w-3.5 h-3.5" /> Add Another Lecture
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Create / Edit Course Modal */}
      {showCourseModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-xl p-6 w-full max-w-lg animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-text-primary font-bold text-xl font-heading">
                {editingCourseId ? 'Edit Course' : 'Create New Course'}
              </h2>
              <button onClick={() => setShowCourseModal(false)} className="text-text-muted hover:text-text-primary p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCourse} className="space-y-4">
              <div>
                <label className="input-label">Course Title</label>
                <input type="text" value={courseForm.title} onChange={e => setCourseForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., Complete Algebra Foundations" className="input-field" required />
              </div>
              <div>
                <label className="input-label">Description</label>
                <textarea value={courseForm.description} onChange={e => setCourseForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What will students learn in this course?" className="input-field" rows={3} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Standard</label>
                  <select value={courseForm.standard} onChange={e => setCourseForm(p => ({ ...p, standard: e.target.value }))} className="input-field">
                    {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>Standard {i + 1}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label">Subject</label>
                  <select value={courseForm.subject} onChange={e => setCourseForm(p => ({ ...p, subject: e.target.value }))} className="input-field">
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Level</label>
                  <select value={courseForm.level} onChange={e => setCourseForm(p => ({ ...p, level: e.target.value }))} className="input-field">
                    {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="input-label">Language</label>
                  <input type="text" value={courseForm.language} onChange={e => setCourseForm(p => ({ ...p, language: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div>
                <label className="input-label">Pricing</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setCourseForm(p => ({ ...p, isFree: true }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${courseForm.isFree ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-secondary border-border-subtle'}`}>
                    Free
                  </button>
                  <button type="button" onClick={() => setCourseForm(p => ({ ...p, isFree: false }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!courseForm.isFree ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-secondary border-border-subtle'}`}>
                    Paid
                  </button>
                </div>
                {!courseForm.isFree && (
                  <input type="number" min="0" value={courseForm.price} onChange={e => setCourseForm(p => ({ ...p, price: e.target.value }))}
                    placeholder="Price in ₹" className="input-field mt-2" required />
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={savingCourse} className="btn-primary flex-1">
                  {savingCourse ? 'Saving...' : editingCourseId ? 'Save Changes' : 'Create Course'}
                </button>
                <button type="button" onClick={() => setShowCourseModal(false)} className="btn-outline flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Lecture Modal */}
      {lectureModalCourse && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-xl p-6 w-full max-w-lg animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-text-primary font-bold text-xl font-heading">Add Lecture</h2>
              <button onClick={() => !savingLecture && setLectureModalCourse(null)} className="text-text-muted hover:text-text-primary p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-5">to <span className="font-semibold text-text-primary">{lectureModalCourse.title}</span></p>
            <form onSubmit={handleAddLecture} className="space-y-4">
              <div>
                <label className="input-label">Lecture Title</label>
                <input type="text" value={lectureForm.title} onChange={e => setLectureForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., Introduction to Linear Equations" className="input-field" required />
              </div>
              <div>
                <label className="input-label">Description (optional)</label>
                <textarea value={lectureForm.description} onChange={e => setLectureForm(p => ({ ...p, description: e.target.value }))}
                  className="input-field" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Lecture Order</label>
                  <input type="number" min="1" value={lectureForm.order} onChange={e => setLectureForm(p => ({ ...p, order: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="input-label">Duration (optional)</label>
                  <input type="text" value={lectureForm.videoDuration} onChange={e => setLectureForm(p => ({ ...p, videoDuration: e.target.value }))}
                    placeholder="e.g., 12:30" className="input-field" />
                </div>
              </div>
              <div>
                <label className="input-label">Video File</label>
                <label className="flex items-center gap-2 border border-dashed border-border-subtle rounded-xl px-4 py-3 cursor-pointer hover:border-brand-primary transition-colors bg-surface-alt">
                  <UploadCloud className="w-4 h-4 text-brand-primary flex-shrink-0" />
                  <span className="text-xs text-text-secondary truncate">
                    {lectureVideo ? lectureVideo.name : 'Choose an MP4 / WebM video (up to 500MB)'}
                  </span>
                  <input type="file" accept="video/mp4,video/webm,video/quicktime,video/mpeg" className="hidden"
                    onChange={e => setLectureVideo(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div>
                <label className="input-label">Pricing</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setLectureForm(p => ({ ...p, isFree: true }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${lectureForm.isFree ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-secondary border-border-subtle'}`}>
                    Free Preview
                  </button>
                  <button type="button" onClick={() => setLectureForm(p => ({ ...p, isFree: false }))}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!lectureForm.isFree ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-secondary border-border-subtle'}`}>
                    Paid
                  </button>
                </div>
              </div>

              {savingLecture && (
                <div>
                  <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden">
                    <div className="h-full bg-brand-primary transition-all" style={{ width: `${lectureUploadPct}%` }} />
                  </div>
                  <p className="text-[10px] text-text-muted mt-1">Uploading video... {lectureUploadPct}%</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={savingLecture} className="btn-primary flex-1">
                  {savingLecture ? 'Uploading...' : 'Upload Lecture'}
                </button>
                <button type="button" disabled={savingLecture} onClick={() => setLectureModalCourse(null)} className="btn-outline flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Notes Modal */}
      {notesModalLecture && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-xl p-6 w-full max-w-md animate-slide-up">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-text-primary font-bold text-xl font-heading">Attach Notes</h2>
              <button onClick={() => !savingNotes && setNotesModalLecture(null)} className="text-text-muted hover:text-text-primary p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-text-secondary mb-5">for <span className="font-semibold text-text-primary">{notesModalLecture.title}</span></p>
            <form onSubmit={handleAddNotes} className="space-y-4">
              <div>
                <label className="input-label">PDF Notes</label>
                <label className="flex items-center gap-2 border border-dashed border-border-subtle rounded-xl px-4 py-3 cursor-pointer hover:border-brand-primary transition-colors bg-surface-alt">
                  <FileText className="w-4 h-4 text-brand-primary flex-shrink-0" />
                  <span className="text-xs text-text-secondary truncate">
                    {notesFile ? notesFile.name : 'Choose a PDF file (up to 50MB)'}
                  </span>
                  <input type="file" accept="application/pdf" className="hidden"
                    onChange={e => setNotesFile(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={savingNotes} className="btn-primary flex-1">
                  {savingNotes ? 'Uploading...' : 'Attach Notes'}
                </button>
                <button type="button" disabled={savingNotes} onClick={() => setNotesModalLecture(null)} className="btn-outline flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherCourses;
