import React from 'react';
import { Megaphone } from 'lucide-react';

/**
 * Shown to the student once the interview has genuinely concluded AND the teacher's evaluation is final.
 * It never carries marks, remarks or selection: those appear only after the official release.
 * `announcePassed` (decided by the server) switches the wording to an honest "being finalised" message when 6 PM has passed
 * but the results have not been released yet.
 */
const InterviewCompletionScreen: React.FC<{ announcePassed?: boolean }> = ({ announcePassed }) => (
  <div className="card-soft rounded-2xl p-6 sm:p-10 border border-[#6C63F2]/30 text-center max-w-xl mx-auto relative overflow-hidden" data-testid="interview-completion">
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#8B03ED] to-[#09ACEF]" />
    <h1 className="font-heading font-bold text-2xl sm:text-3xl text-text-primary">🎉 Congratulations!</h1>
    <h2 className="font-heading font-semibold text-lg sm:text-xl text-text-primary mt-2">Your Interview Has Been Completed Successfully!</h2>
    <div className="mt-5 p-4 rounded-xl bg-[#FFC24B]/10 border border-[#FFC24B]/40">
      <p className="text-sm font-semibold text-text-primary flex items-center justify-center gap-2"><Megaphone className="w-4 h-4 text-[#B7791F]" aria-hidden="true" /> 📢 Results Announcement</p>
      {announcePassed ? (
        <p className="mt-2 text-sm text-text-secondary leading-relaxed" data-testid="announce-pending">Your results are being finalised and will appear on your LearnIQ dashboard as soon as they are published.</p>
      ) : (
        <p className="mt-2 text-base sm:text-lg font-bold text-text-primary" data-testid="announce-time">Your results will be declared today at 6:00 PM.</p>
      )}
      <p className="mt-2 text-sm text-text-secondary leading-relaxed">Please stay tuned and visit your LearnIQ dashboard after the announcement to check your results.</p>
    </div>
    <p className="mt-5 text-sm font-semibold text-text-primary">We wish you all the best!</p>
    <p className="text-sm text-text-secondary">— Team LearnIQ</p>
  </div>
);

export default InterviewCompletionScreen;
