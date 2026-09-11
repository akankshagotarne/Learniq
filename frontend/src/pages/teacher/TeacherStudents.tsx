import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, ChevronRight, Mail, Phone, Award, BookOpen, HelpCircle } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';

interface StudentInfo {
  student: { _id: string; name: string; email: string; phone?: string; currentStandard?: number; avatar?: string; createdAt: string };
  courses: { course: any; completion: number }[];
}

const TeacherStudents: React.FC = () => {
  const [students, setStudents] = useState<StudentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [studentDetail, setStudentDetail] = useState<any>(null);

  useEffect(() => {
    api.get('/teacher/students').then(r => setStudents(r.data.students || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const fetchStudentDetail = async (id: string) => {
    try {
      const res = await api.get(`/teacher/students/${id}`);
      setStudentDetail(res.data);
      setSelectedStudent(res.data.student);
    } catch {}
  };

  const filtered = students.filter(s =>
    !search || s.student.name?.toLowerCase().includes(search.toLowerCase()) || s.student.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">My Students</h1>
            <p className="text-text-secondary text-sm mt-1">Students enrolled in your courses</p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search students..."
                className="input-field pl-9"
              />
            </div>
            <span className="text-text-secondary text-sm font-medium">{filtered.length} students</span>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Student List */}
            <div className={`${selectedStudent ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-20 rounded-card" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-soft p-12 text-center">
                  <p className="text-text-secondary">No students found.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map(({ student, courses }) => (
                    <div
                      key={student._id}
                      onClick={() => fetchStudentDetail(student._id)}
                      className={`card-soft p-4 cursor-pointer hover:-translate-y-0.5 transition-all ${
                        selectedStudent?._id === student._id ? 'border-brand-primary ring-2 ring-brand-primary/20 bg-[#EDE9FE]/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={student.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name || 'S')}&background=6C63F2&color=fff&size=48`}
                          alt={student.name}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary font-semibold text-sm font-heading">{student.name}</p>
                          <p className="text-text-secondary text-xs truncate">{student.email}</p>
                          <p className="text-text-muted text-xs mt-0.5">Standard {student.currentStandard} • {courses.length} course{courses.length !== 1 ? 's' : ''}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Student Detail */}
            {selectedStudent && studentDetail && (
              <div className="lg:col-span-2 space-y-4 animate-slide-up">
                <div className="card-soft p-6">
                  <div className="flex items-start gap-4 mb-6">
                    <img
                      src={selectedStudent.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedStudent.name)}&background=6C63F2&color=fff&size=80`}
                      alt={selectedStudent.name}
                      className="w-16 h-16 rounded-2xl object-cover shadow-soft"
                    />
                    <div>
                      <h3 className="text-text-primary font-bold text-xl font-heading">{selectedStudent.name}</h3>
                      <div className="flex items-center gap-1.5 text-text-secondary text-sm mt-1">
                        <Mail className="w-3.5 h-3.5 text-text-muted" /> {selectedStudent.email}
                      </div>
                      {selectedStudent.phone && (
                        <div className="flex items-center gap-1.5 text-text-secondary text-sm mt-0.5">
                          <Phone className="w-3.5 h-3.5 text-text-muted" /> {selectedStudent.phone}
                        </div>
                      )}
                      <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EDE9FE] text-[#6C63F2]">
                        Standard {selectedStudent.currentStandard}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {[
                      { label: 'Courses', value: studentDetail.stats?.coursesEnrolled || 0, icon: BookOpen, color: 'text-brand-primary' },
                      { label: 'Quizzes', value: studentDetail.stats?.quizzesTaken || 0, icon: HelpCircle, color: 'text-accent-amber' },
                      { label: 'Avg Score', value: `${studentDetail.stats?.avgQuizScore || 0}%`, icon: Award, color: 'text-accent-mint' },
                      { label: 'Live Classes', value: studentDetail.stats?.liveClassesAttended || 0, icon: null, color: 'text-[#E1447A]' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center p-3.5 bg-surface-alt rounded-xl border border-border-subtle">
                        <p className={`text-xl font-bold font-heading ${color}`}>{value}</p>
                        <p className="text-text-secondary text-xs mt-0.5 font-medium">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Quiz Attempts */}
                  {studentDetail.quizAttempts?.length > 0 && (
                    <div>
                      <h4 className="text-text-primary font-semibold text-sm mb-3 font-heading">Recent Quiz Results</h4>
                      <div className="space-y-2">
                        {studentDetail.quizAttempts.slice(0, 5).map((a: any) => (
                          <div key={a._id} className="flex items-center gap-3 p-3 bg-surface-alt rounded-xl border border-border-subtle">
                            <div className="flex-1 min-w-0">
                              <p className="text-text-primary font-medium text-sm truncate font-heading">{a.quiz?.title || 'Quiz'}</p>
                              <p className="text-text-muted text-xs">{a.quiz?.subject}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${a.percentage >= 60 ? 'text-[#16A34A]' : 'text-[#E1447A]'}`}>{a.score}/{a.totalMarks}</p>
                              <p className="text-text-muted text-xs">{a.percentage}%</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeacherStudents;
