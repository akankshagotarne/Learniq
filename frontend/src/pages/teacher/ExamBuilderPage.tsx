import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ClipboardList, Plus, Trash2, ArrowUp, ArrowDown, Check,
  Save, Globe, ChevronLeft, HelpCircle, AlertCircle, Clock,
  Award, Sparkles, BookOpen, Layers
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { ExamQuestion } from '../../types';
import toast from 'react-hot-toast';

const SUBJECT_OPTIONS = [
  'Mathematics',
  'Science',
  'English',
  'Social Science',
  'History',
  'Geography',
  'Hindi',
  'Marathi',
  'Physics',
  'Chemistry',
  'Biology',
];

const ExamBuilderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  // Basic Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [standard, setStandard] = useState<number>(10);
  const [subject, setSubject] = useState('Mathematics');
  const [chapter, setChapter] = useState('');

  // Rules & Timing
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [negativeMarking, setNegativeMarking] = useState(false);
  const [negativeMarkValue, setNegativeMarkValue] = useState<number>(0.25);
  const [passingMarks, setPassingMarks] = useState<number>(0);
  const [attemptLimit, setAttemptLimit] = useState<number>(1);
  const [scheduledStart, setScheduledStart] = useState<string>('');
  const [scheduledEnd, setScheduledEnd] = useState<string>('');

  // Questions
  const [questions, setQuestions] = useState<ExamQuestion[]>([
    {
      type: 'mcq',
      question: '',
      options: ['', '', '', ''],
      correctAnswer: 0,
      marks: 1,
      explanation: '',
      order: 0,
    },
  ]);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEditing) {
      fetchExistingExam();
    }
  }, [id]);

  const fetchExistingExam = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/teacher/exams/${id}`);
      const e = res.data.exam;
      setTitle(e.title || '');
      setDescription(e.description || '');
      setInstructions(e.instructions || '');
      setStandard(e.standard || 10);
      setSubject(e.subject || 'Mathematics');
      setChapter(e.chapter || '');
      setDurationMinutes(e.durationMinutes || 30);
      setNegativeMarking(Boolean(e.negativeMarking));
      setNegativeMarkValue(e.negativeMarkValue || 0.25);
      setPassingMarks(e.passingMarks || 0);
      setAttemptLimit(e.attemptLimit ?? 1);
      setScheduledStart(e.scheduledStart ? e.scheduledStart.substring(0, 16) : '');
      setScheduledEnd(e.scheduledEnd ? e.scheduledEnd.substring(0, 16) : '');

      if (e.questions && e.questions.length > 0) {
        setQuestions(e.questions);
      }
    } catch (err: any) {
      toast.error('Failed to load exam for editing.');
      navigate('/teacher/exams');
    } finally {
      setLoading(false);
    }
  };

  // Add Question
  const handleAddQuestion = () => {
    setQuestions(prev => [
      ...prev,
      {
        type: 'mcq',
        question: '',
        options: ['', '', '', ''],
        correctAnswer: 0,
        marks: 1,
        explanation: '',
        order: prev.length,
      },
    ]);
  };

  // Delete Question
  const handleDeleteQuestion = (index: number) => {
    if (questions.length === 1) {
      toast.error('An exam must have at least one question.');
      return;
    }
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  // Move Question
  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === questions.length - 1) return;

    setQuestions(prev => {
      const copy = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // Update specific question field
  const handleUpdateQuestion = (index: number, field: keyof ExamQuestion, value: any) => {
    setQuestions(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // Update option text
  const handleUpdateOption = (qIndex: number, optIndex: number, text: string) => {
    setQuestions(prev => {
      const copy = [...prev];
      const newOptions = [...copy[qIndex].options];
      newOptions[optIndex] = text;
      copy[qIndex] = { ...copy[qIndex], options: newOptions };
      return copy;
    });
  };

  // Save Exam (as draft or published)
  const handleSave = async (publishImmediate = false) => {
    if (!title.trim()) {
      toast.error('Please provide an exam title.');
      return;
    }

    if (durationMinutes <= 0) {
      toast.error('Exam duration must be at least 1 minute.');
      return;
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        toast.error(`Question ${i + 1} has empty text.`);
        return;
      }
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].trim()) {
          toast.error(`Question ${i + 1}, Option ${String.fromCharCode(65 + j)} is empty.`);
          return;
        }
      }
      if (q.correctAnswer === undefined || q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
        toast.error(`Question ${i + 1} has no correct answer selected.`);
        return;
      }
    }

    setSaving(true);
    const payload = {
      title,
      description,
      instructions,
      standard,
      subject,
      chapter,
      durationMinutes,
      negativeMarking,
      negativeMarkValue: negativeMarking ? negativeMarkValue : 0.25,
      passingMarks,
      attemptLimit,
      scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
      scheduledEnd: scheduledEnd ? new Date(scheduledEnd).toISOString() : null,
      questions,
    };

    try {
      let savedExamId = id;
      if (isEditing) {
        await api.put(`/exams/${id}`, payload);
      } else {
        const res = await api.post('/exams', payload);
        savedExamId = res.data.exam._id;
      }

      if (publishImmediate && savedExamId) {
        await api.put(`/exams/${savedExamId}/publish`);
      }

      toast.success(
        publishImmediate
          ? 'Exam saved and published successfully!'
          : 'Exam saved as draft successfully!'
      );
      navigate('/teacher/exams');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save exam.');
    } finally {
      setSaving(false);
    }
  };

  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-muted text-sm">Loading exam details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
          {/* Top Bar Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
            <div>
              <Link
                to="/teacher/exams"
                className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-2 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back to Exams
              </Link>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">
                {isEditing ? 'Edit Examination' : 'Author New Examination'}
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Configure parameters, author MCQ questions, and set scoring rules
              </p>
            </div>

            {/* Top Action Buttons */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="btn-secondary text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 font-bold"
              >
                <Save className="w-3.5 h-3.5" /> Save Draft
              </button>

              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving}
                className="btn-primary text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 font-bold shadow-md shadow-brand-primary/20"
              >
                <Globe className="w-3.5 h-3.5" /> Publish Exam
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card-soft p-3 rounded-xl border border-border-subtle text-center bg-surface">
              <span className="text-[10px] text-text-muted block">Total Questions</span>
              <span className="text-lg font-bold text-text-primary">{questions.length}</span>
            </div>
            <div className="card-soft p-3 rounded-xl border border-border-subtle text-center bg-surface">
              <span className="text-[10px] text-text-muted block">Total Marks</span>
              <span className="text-lg font-bold text-[#FFC24B]">{totalMarks}</span>
            </div>
            <div className="card-soft p-3 rounded-xl border border-border-subtle text-center bg-surface">
              <span className="text-[10px] text-text-muted block">Duration</span>
              <span className="text-lg font-bold text-brand-primary">{durationMinutes} mins</span>
            </div>
          </div>

          {/* SECTION 1: Basic Information */}
          <div className="card-soft p-6 rounded-2xl border border-border-subtle bg-surface space-y-4">
            <h3 className="font-heading font-bold text-base text-text-primary flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-brand-primary" /> Basic Information
            </h3>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Exam Title <span className="text-[#E1447A]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Chapter 4: Quadratic Equations Assessment"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-text-primary block mb-1">Standard / Grade</label>
                  <select
                    value={standard}
                    onChange={e => setStandard(parseInt(e.target.value))}
                    className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    {[...Array(10)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Standard {i + 1}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-text-primary block mb-1">Subject</label>
                  <select
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    {SUBJECT_OPTIONS.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-text-primary block mb-1">Chapter / Unit</label>
                  <input
                    type="text"
                    placeholder="e.g. Quadratic Equations"
                    value={chapter}
                    onChange={e => setChapter(e.target.value)}
                    className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Brief synopsis of topics covered..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">Student Instructions</label>
                <textarea
                  rows={2}
                  placeholder="Special instructions displayed before the exam begins..."
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Rules, Timing & Scoring */}
          <div className="card-soft p-6 rounded-2xl border border-border-subtle bg-surface space-y-4">
            <h3 className="font-heading font-bold text-base text-text-primary flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#5AC8FA]" /> Rules, Timing & Scoring
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Duration (Minutes) <span className="text-[#E1447A]">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={e => setDurationMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">Passing Marks</label>
                <input
                  type="number"
                  min={0}
                  value={passingMarks}
                  onChange={e => setPassingMarks(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">Attempt Limit</label>
                <select
                  value={attemptLimit}
                  onChange={e => setAttemptLimit(parseInt(e.target.value))}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value={1}>1 Attempt (Strict)</option>
                  <option value={2}>2 Attempts</option>
                  <option value={3}>3 Attempts</option>
                  <option value={0}>Unlimited Attempts</option>
                </select>
              </div>
            </div>

            {/* Negative Marking Row */}
            <div className="p-4 rounded-xl bg-surface-alt border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="negMarkToggle"
                  checked={negativeMarking}
                  onChange={e => setNegativeMarking(e.target.checked)}
                  className="w-4 h-4 text-brand-primary rounded focus:ring-brand-primary cursor-pointer"
                />
                <label htmlFor="negMarkToggle" className="cursor-pointer">
                  <span className="font-bold text-text-primary block">Enable Negative Marking</span>
                  <span className="text-text-muted text-[11px]">
                    Deduct marks for incorrect answers. Unanswered questions remain unaffected.
                  </span>
                </label>
              </div>

              {negativeMarking && (
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <span className="text-text-secondary font-medium">Deduct per wrong answer:</span>
                  <select
                    value={negativeMarkValue}
                    onChange={e => setNegativeMarkValue(parseFloat(e.target.value))}
                    className="p-1.5 bg-surface border border-border-subtle rounded-lg text-text-primary font-bold focus:outline-none focus:border-brand-primary"
                  >
                    <option value={0.25}>-0.25 Marks</option>
                    <option value={0.5}>-0.50 Marks</option>
                    <option value={1.0}>-1.00 Marks</option>
                  </select>
                </div>
              )}
            </div>

            {/* Scheduling Window */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Scheduled Start (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={e => setScheduledStart(e.target.value)}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Scheduled Deadline / Expiry (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={e => setScheduledEnd(e.target.value)}
                  className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: Questions Authoring */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-bold text-lg text-text-primary flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-brand-primary" /> Questions ({questions.length})
              </h3>

              <button
                type="button"
                onClick={handleAddQuestion}
                className="btn-primary text-xs py-2 px-3.5 rounded-xl flex items-center gap-1.5 font-bold"
              >
                <Plus className="w-3.5 h-3.5" /> Add Question
              </button>
            </div>

            {questions.map((q, qIndex) => (
              <div
                key={qIndex}
                className="card-soft p-5 sm:p-6 rounded-2xl border border-border-subtle bg-surface space-y-4 relative"
              >
                {/* Question Header with Order, Reorder buttons and Delete */}
                <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-xl bg-brand-primary/10 text-brand-primary font-bold text-xs flex items-center justify-center">
                      {qIndex + 1}
                    </span>
                    <span className="font-heading font-bold text-xs text-text-primary">
                      Question {qIndex + 1}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-text-muted font-medium">Marks:</span>
                      <input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={q.marks}
                        onChange={e => handleUpdateQuestion(qIndex, 'marks', parseFloat(e.target.value) || 1)}
                        className="w-16 p-1 bg-surface-alt border border-border-subtle rounded-lg text-center font-bold text-text-primary"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleMoveQuestion(qIndex, 'up')}
                      disabled={qIndex === 0}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30"
                      title="Move up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveQuestion(qIndex, 'down')}
                      disabled={qIndex === questions.length - 1}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30"
                      title="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteQuestion(qIndex)}
                      className="p-1.5 rounded-lg text-[#E1447A] hover:bg-[#E1447A]/10 transition-colors"
                      title="Delete question"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Question Prompt */}
                <div className="text-xs">
                  <label className="font-bold text-text-primary block mb-1">
                    Question Text <span className="text-[#E1447A]">*</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter question text here..."
                    value={q.question}
                    onChange={e => handleUpdateQuestion(qIndex, 'question', e.target.value)}
                    className="w-full p-2.5 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>

                {/* 4 Options with Radio to mark correct answer */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between text-text-muted font-bold text-[11px] mb-1">
                    <span>Options (Mark the radio button next to the correct answer)</span>
                    <span className="text-brand-primary">
                      Selected Correct: Option {String.fromCharCode(65 + q.correctAnswer)}
                    </span>
                  </div>

                  {q.options.map((opt, optIndex) => {
                    const isCorrect = q.correctAnswer === optIndex;

                    return (
                      <div
                        key={optIndex}
                        className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${
                          isCorrect
                            ? 'border-[#4ADE9A] bg-[#4ADE9A]/5 ring-1 ring-[#4ADE9A]'
                            : 'border-border-subtle bg-surface-alt'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`correct_${qIndex}`}
                          checked={isCorrect}
                          onChange={() => handleUpdateQuestion(qIndex, 'correctAnswer', optIndex)}
                          className="w-4 h-4 text-brand-primary focus:ring-brand-primary cursor-pointer ml-1"
                        />

                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isCorrect
                              ? 'bg-[#4ADE9A] text-white'
                              : 'bg-surface text-text-secondary border border-border-subtle'
                          }`}
                        >
                          {String.fromCharCode(65 + optIndex)}
                        </span>

                        <input
                          type="text"
                          placeholder={`Option ${String.fromCharCode(65 + optIndex)} text...`}
                          value={opt}
                          onChange={e => handleUpdateOption(qIndex, optIndex, e.target.value)}
                          className="flex-1 p-1.5 bg-transparent border-none text-text-primary focus:outline-none text-xs"
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Explanation */}
                <div className="text-xs pt-1">
                  <label className="font-semibold text-text-secondary block mb-1">
                    Solution Explanation (Optional — shown to students after submission)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Formula used: b^2 - 4ac..."
                    value={q.explanation || ''}
                    onChange={e => handleUpdateQuestion(qIndex, 'explanation', e.target.value)}
                    className="w-full p-2 bg-surface-alt border border-border-subtle rounded-xl text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>
            ))}

            {/* Bottom Add Question Button */}
            <button
              type="button"
              onClick={handleAddQuestion}
              className="w-full py-4 rounded-2xl border-2 border-dashed border-border-subtle hover:border-brand-primary/50 text-text-secondary hover:text-brand-primary text-xs font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4" /> Add Another Question
            </button>
          </div>

          {/* Bottom Save CTA Bar */}
          <div className="pt-4 border-t border-border-subtle flex items-center justify-end gap-3">
            <Link to="/teacher/exams" className="btn-secondary text-xs py-2.5 px-4 rounded-xl font-medium">
              Cancel
            </Link>

            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="btn-secondary text-xs py-2.5 px-5 rounded-xl font-bold flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" /> Save as Draft
            </button>

            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="btn-primary text-xs py-2.5 px-6 rounded-xl font-bold flex items-center gap-1.5 shadow-lg shadow-brand-primary/20"
            >
              <Globe className="w-4 h-4" /> Publish Examination
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ExamBuilderPage;
