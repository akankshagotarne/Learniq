import React, { useId } from 'react';
import { CheckCircle2, ClipboardCheck, Video } from 'lucide-react';

export type ExaminationMode = 'EXAM_ONLY' | 'EXAM_INTERVIEW';

const OPTIONS: { mode: ExaminationMode; title: string; summary: string; bullets: string[]; Icon: typeof Video }[] = [
  {
    mode: 'EXAM_ONLY', title: 'Exam Only', summary: 'Conduct an examination without an interview.', Icon: ClipboardCheck,
    bullets: ['Examination registration and payment', 'Examination scheduling', 'Examination submission', 'Results and certificates'],
  },
  {
    mode: 'EXAM_INTERVIEW', title: 'Exam + Interview', summary: 'Conduct an examination followed by an interview.', Icon: Video,
    bullets: ['Examination registration and payment', 'Separate interview payment, as configured', 'Interview scheduling', 'Teacher-led interviews', 'Interview marks and final results'],
  },
];

/**
 * "Examination Configuration": the event-level choice between Exam Only and Exam + Interview, as two selectable cards (one radio group).
 * Presentational only: the server stores and enforces the choice.
 */
const ExaminationConfiguration: React.FC<{ value: ExaminationMode; onChange: (m: ExaminationMode) => void; disabled?: boolean; error?: string }> = ({ value, onChange, disabled, error }) => {
  const name = useId();
  return (
    <fieldset className="space-y-2" data-testid="exam-config" disabled={disabled}>
      <legend className="block text-[11px] font-semibold text-text-muted mb-1">Examination Configuration</legend>
      <div role="radiogroup" aria-label="Examination Configuration" className="grid sm:grid-cols-2 gap-3">
        {OPTIONS.map(({ mode, title, summary, bullets, Icon }) => {
          const selected = value === mode;
          return (
            <label
              key={mode}
              data-testid={`exam-config-${mode === 'EXAM_ONLY' ? 'exam-only' : 'exam-interview'}`}
              data-selected={selected ? 'true' : 'false'}
              className={`min-w-0 rounded-xl border-2 p-3 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-brand-primary ${selected ? 'border-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface hover:bg-surface-alt'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input type="radio" name={name} className="sr-only" checked={selected} onChange={() => onChange(mode)} aria-label={title} />
              <span className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2 font-heading font-bold text-sm text-text-primary"><Icon className="w-4 h-4 text-brand-primary" aria-hidden="true" /> {title}</span>
                {selected && <CheckCircle2 className="w-4 h-4 text-brand-primary flex-shrink-0" aria-hidden="true" />}
              </span>
              <span className="block text-xs text-text-secondary mt-1">{summary}</span>
              <ul className="mt-2 space-y-0.5 text-[11px] text-text-muted list-disc pl-4">{bullets.map(b => <li key={b}>{b}</li>)}</ul>
            </label>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-600 mt-1" role="alert">{error}</p>}
    </fieldset>
  );
};

export default ExaminationConfiguration;
