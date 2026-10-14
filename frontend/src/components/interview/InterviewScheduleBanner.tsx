import React from 'react';
import { PartyPopper, CalendarClock } from 'lucide-react';
import { ScheduleInfo } from '../../services/interview';

/** The congratulation after submitting. The wording comes from the backend, which only names a date/time that is really configured. */
const InterviewScheduleBanner: React.FC<{ info: ScheduleInfo }> = ({ info }) => (
  <section
    className="rounded-2xl border border-[#4ADE9A]/50 bg-[#4ADE9A]/10 p-4 sm:p-5 mb-6 flex gap-3"
    data-testid="interview-schedule-banner"
    aria-live="polite"
  >
    <span className="shrink-0 p-2 h-fit rounded-xl bg-[#4ADE9A]/20 text-[#16A34A]" aria-hidden="true"><PartyPopper className="w-5 h-5" /></span>
    <div className="min-w-0">
      <h2 className="font-heading font-bold text-base sm:text-lg text-text-primary" data-testid="schedule-headline">{info.headline}</h2>
      <p className="text-sm text-text-secondary mt-1" data-testid="schedule-detail">{info.detail}</p>
      {info.configured && info.when && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-text-primary" data-testid="schedule-when">
          <CalendarClock className="w-4 h-4" aria-hidden="true" /> Interview: {info.when}
        </p>
      )}
    </div>
  </section>
);

export default InterviewScheduleBanner;
