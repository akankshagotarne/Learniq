import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, PartyPopper } from 'lucide-react';
import { OlympiadCompletion } from '../../types/olympiad';

/**
 * Shown after the backend has PERSISTED the submission. It carries no marks of any kind: the result is stored for
 * administrators and stays hidden until it is officially published. "Selected" is displayed only when the backend says so.
 */
const TestCompletionScreen: React.FC<{ completion?: OlympiadCompletion | null }> = ({ completion }) => {
  const examOnly = completion?.interviewIncluded === false; // Exam Only event: no interview text, date or eligibility at all
  const selected = completion ? completion.interviewSelected : true;
  const date = completion?.interviewDate || '18 October 2026';
  // "tomorrow" only when the interview really is the day after the submission (IST); otherwise a neutral wording
  const istDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const tomorrow = !completion?.interviewOpensAt || !completion.submittedAt
    || istDay(completion.interviewOpensAt) === istDay(new Date(new Date(completion.submittedAt).getTime() + 86400000).toISOString());
  return (
    <div className="card-soft rounded-2xl p-6 sm:p-10 border border-[#6C63F2]/30 text-center max-w-xl mx-auto relative overflow-hidden" data-testid="test-completion">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
      <div className="w-16 h-16 mx-auto rounded-2xl bg-[#4ADE9A]/15 text-[#16A34A] flex items-center justify-center mb-4" aria-hidden="true"><PartyPopper className="w-8 h-8" /></div>
      <h1 className="font-heading font-bold text-2xl sm:text-3xl text-text-primary">🎉 Congratulations!</h1>
      <h2 className="font-heading font-semibold text-lg sm:text-xl text-text-primary mt-2">Your Test Has Been Completed Successfully!</h2>
      {examOnly ? (
        <p className="mt-5 text-sm text-text-secondary leading-relaxed" data-testid="completion-exam-only">Your test has been submitted successfully. Your result will be available once it is officially published.</p>
      ) : selected ? (
        <>
          <p className="mt-5 text-base sm:text-lg font-bold text-[#6C63F2]" data-testid="completion-selected">{tomorrow ? 'You are selected for tomorrow\'s interview!' : 'You are selected for the upcoming interview!'}</p>
          <p className="mt-3 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#6C63F2]/10 text-text-primary font-semibold text-sm sm:text-base" data-testid="completion-date">
            <CalendarDays className="w-4 h-4 text-[#6C63F2]" aria-hidden="true" /> 📅 Interview Date: {date}
          </p>
          <p className="mt-5 text-sm text-text-secondary leading-relaxed">Thank you for participating in the LearnIQ test. Please stay tuned for further interview instructions and get ready for the next stage.</p>
        </>
      ) : (
        <p className="mt-5 text-sm text-text-secondary leading-relaxed" data-testid="completion-pending">Your test has been submitted successfully. Please wait for confirmation of your interview eligibility.</p>
      )}
      <p className="mt-5 text-sm font-semibold text-text-primary">We wish you all the best!</p>
      <p className="text-sm text-text-secondary">— Team LearnIQ</p>
      <Link to="/student/exams" className="btn-primary inline-flex items-center justify-center min-h-[44px] px-6 mt-6 rounded-xl text-sm font-bold">Back to Exams</Link>
    </div>
  );
};

export default TestCompletionScreen;
