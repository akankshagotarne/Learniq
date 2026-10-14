import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Eye, Loader2, Save, Send } from 'lucide-react';
import { Criterion, EvaluationView, interviewApi, interviewErrorMessage } from '../../services/interview';

interface Props {
  interviewId: string;
  studentName: string;
  standard?: number | null;
  teacherName?: string;
  statusLabel: string;
  /** called after the backend accepted the final submission (the interview is then COMPLETED) */
  onSubmitted: () => void;
}

const SCORES = Array.from({ length: 11 }, (_, i) => i); // whole numbers 0-10

const ScorePicker: React.FC<{ c: Criterion; value: number | null; onChange: (n: number) => void; disabled?: boolean }> = ({ c, value, onChange, disabled }) => (
  <div role="radiogroup" aria-label={`${c.label}, score out of ${c.max}`} className="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
    {SCORES.map((n) => {
      const on = value === n;
      return (
        <button
          key={n} type="button" role="radio" aria-checked={on} aria-label={`${n} out of ${c.max}`} disabled={disabled}
          onClick={() => onChange(n)} data-testid={`score-${c.key}-${n}`}
          className={`min-h-[44px] rounded-lg text-sm font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-60 ${on ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-primary border-border-subtle hover:border-brand-primary'}`}
        >{n}</button>
      );
    })}
  </div>
);

/**
 * Teacher's interview evaluation: five criteria, 0-10 each. The totals shown here are only a convenience - the backend
 * validates every score and computes the real total/percentage, and ignores anything the browser sends as a total.
 */
const InterviewEvaluationForm: React.FC<Props> = ({ interviewId, studentName, standard, teacherName, statusLabel, onSubmitted }) => {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [maxMarks, setMaxMarks] = useState(50);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [remarks, setRemarks] = useState('');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [locked, setLocked] = useState<EvaluationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const submittingRef = useRef(false); // blocks double clicks even before React re-renders

  const load = async () => {
    setLoading(true);
    try {
      const d = await interviewApi.getEvaluation(interviewId);
      setCriteria(d.criteria); setMaxMarks(d.maxMarks);
      const ev = d.evaluation;
      if (ev) {
        setScores(Object.fromEntries(ev.scores.map((x) => [x.key, x.score])));
        setRemarks(ev.remarks); setStrengths(ev.strengths); setImprovements(ev.improvements);
        if (ev.state === 'SUBMITTED') setLocked(ev);
      }
      setLoadError(null);
    } catch (e) { setLoadError(interviewErrorMessage(e, 'Could not load the evaluation form.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [interviewId]);

  const total = useMemo(() => criteria.reduce((sum, c) => sum + (Number.isInteger(scores[c.key]) ? (scores[c.key] as number) : 0), 0), [criteria, scores]);
  const scored = criteria.filter((c) => Number.isInteger(scores[c.key])).length;
  const complete = criteria.length > 0 && scored === criteria.length;
  const percentage = Math.round((total * 10000) / maxMarks) / 100;
  const payload = () => ({ scores, remarks, strengths, improvements }); // no total: the server computes it

  const saveDraft = async () => {
    setSaving(true);
    try { await interviewApi.saveDraft(interviewId, payload()); setSavedAt(new Date()); toast.success('Draft saved.'); }
    catch (e) { toast.error(interviewErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      await interviewApi.submitEvaluation(interviewId, payload());
      toast.success('Evaluation submitted. The interview is completed.');
      setConfirm(false);
      onSubmitted();
    } catch (e) {
      setConfirm(false); // everything typed stays on screen so the teacher can retry
      toast.error(`${interviewErrorMessage(e)} Your marks are still here - you can try again.`);
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  const tryPreview = () => { setShowErrors(true); setPreview(true); };
  const trySubmit = () => { setShowErrors(true); if (complete) setConfirm(true); else toast.error('Please give a score for every criterion first.'); };

  if (loading) return <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading evaluation…</div>;
  if (loadError) return <div className="card-soft p-4 rounded-2xl text-sm" role="alert">{loadError} <button type="button" className="underline ml-2" onClick={load}>Retry</button></div>;

  const ro = !!locked;
  return (
    <section className="card-soft rounded-2xl border border-border-subtle p-4 sm:p-6" aria-labelledby="eval-title" data-testid="evaluation-form">
      <h2 id="eval-title" className="font-heading font-bold text-lg text-text-primary">LearnIQ — Student Interview Evaluation</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div><dt className="text-[11px] text-text-muted">Student</dt><dd className="text-text-primary font-medium break-words">{studentName}</dd></div>
        <div><dt className="text-[11px] text-text-muted">Standard</dt><dd className="text-text-primary font-medium">{standard ?? '—'}</dd></div>
        <div><dt className="text-[11px] text-text-muted">Teacher</dt><dd className="text-text-primary font-medium break-words">{teacherName || 'You'}</dd></div>
        <div><dt className="text-[11px] text-text-muted">Interview status</dt><dd className="text-text-primary font-medium">{statusLabel}</dd></div>
      </dl>

      {ro && <p className="mt-4 p-3 rounded-xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30 text-sm text-text-primary flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#15803D]" aria-hidden="true" /> This evaluation was submitted and is locked. Only an administrator can correct it.</p>}

      <ol className="mt-5 space-y-3">
        {criteria.map((c, i) => {
          const missing = showErrors && !Number.isInteger(scores[c.key]);
          return (
            <li key={c.key} className={`rounded-xl border p-3 sm:p-4 ${missing ? 'border-[#E1447A]' : 'border-border-subtle'}`} data-testid={`criterion-${c.key}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary"><span className="text-text-muted mr-1">{i + 1}.</span>{c.label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{c.description}</p>
                </div>
                <p className="font-heading font-bold text-xl text-text-primary whitespace-nowrap" aria-live="polite">
                  {Number.isInteger(scores[c.key]) ? scores[c.key] : '–'}<span className="text-sm text-text-muted font-normal"> / {c.max}</span>
                </p>
              </div>
              <ScorePicker c={c} value={Number.isInteger(scores[c.key]) ? (scores[c.key] as number) : null} disabled={ro} onChange={(n) => setScores((s) => ({ ...s, [c.key]: n }))} />
              {missing && <p className="text-xs text-[#E1447A] mt-2" role="alert">Please choose a score from 0 to {c.max}.</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 p-4 rounded-xl bg-[#09ACEF]/10 border border-[#09ACEF]/30 flex flex-wrap items-center gap-x-8 gap-y-2" aria-live="polite" data-testid="eval-totals">
        <div><p className="text-[11px] text-text-muted">Total</p><p className="font-heading font-bold text-2xl text-text-primary" data-testid="eval-total">{total} / {maxMarks}</p></div>
        <div><p className="text-[11px] text-text-muted">Percentage</p><p className="font-heading font-bold text-2xl text-brand-primary" data-testid="eval-percentage">{percentage}%</p></div>
        {!complete && !ro && <p className="text-xs text-text-muted">{scored} of {criteria.length} criteria scored</p>}
      </div>

      <div className="mt-5 grid gap-4">
        {([['remarks', "Teacher's Remarks", remarks, setRemarks], ['strengths', 'Strengths', strengths, setStrengths], ['improvements', 'Areas for Improvement', improvements, setImprovements]] as const).map(([id, label, val, set]) => (
          <div key={id}>
            <label htmlFor={`ev-${id}`} className="text-sm font-medium text-text-primary">{label} <span className="text-text-muted font-normal">(optional)</span></label>
            <textarea id={`ev-${id}`} value={val} onChange={(e) => set(e.target.value)} readOnly={ro} maxLength={1500} rows={3} className="input-field mt-1.5 w-full" />
          </div>
        ))}
      </div>

      {preview && (
        <div className="mt-5 p-4 rounded-xl border border-brand-primary/40 bg-brand-primary/5" data-testid="eval-preview">
          <p className="font-semibold text-sm text-text-primary mb-2">Preview — this is what the student will see</p>
          <ul className="text-sm text-text-secondary space-y-1">{criteria.map((c) => <li key={c.key}>{c.label}: <b className="text-text-primary">{Number.isInteger(scores[c.key]) ? scores[c.key] : '—'}/{c.max}</b></li>)}</ul>
          <p className="text-sm mt-2 text-text-primary">Total <b>{total}/{maxMarks}</b> · <b>{percentage}%</b></p>
          {remarks && <p className="text-sm mt-2 whitespace-pre-wrap break-words"><b>Remarks:</b> {remarks}</p>}
          {strengths && <p className="text-sm mt-1 whitespace-pre-wrap break-words"><b>Strengths:</b> {strengths}</p>}
          {improvements && <p className="text-sm mt-1 whitespace-pre-wrap break-words"><b>Improve:</b> {improvements}</p>}
          <button type="button" onClick={() => setPreview(false)} className="mt-3 text-xs underline min-h-[44px]">Close preview</button>
        </div>
      )}

      {!ro && (
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:flex-wrap gap-3 sm:items-center">
          <button type="button" onClick={saveDraft} disabled={saving || submitting} className="min-h-[48px] px-5 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60" data-testid="save-draft">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Draft
          </button>
          <button type="button" onClick={tryPreview} className="min-h-[48px] px-5 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center justify-center gap-2" data-testid="preview-eval"><Eye className="w-4 h-4" /> Preview Evaluation</button>
          <button type="button" onClick={trySubmit} disabled={submitting} className="btn-primary min-h-[48px] px-6 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60" data-testid="submit-eval"><Send className="w-4 h-4" /> Submit Evaluation</button>
          {savedAt && <span className="text-[11px] text-text-muted">Draft saved at {savedAt.toLocaleTimeString()}</span>}
        </div>
      )}
      {!ro && <p className="text-[11px] text-text-muted mt-2">Submitting finalises the interview results for the student.</p>}

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 shadow-xl">
            <h3 id="confirm-title" className="font-heading font-bold text-lg text-text-primary">Submit interview evaluation?</h3>
            <p className="text-sm text-text-secondary mt-2">Please check your marks and feedback. After submission, the interview will be marked completed and the final results will be saved.</p>
            <p className="text-sm text-text-primary mt-3 font-semibold">Total: {total}/{maxMarks} ({percentage}%)</p>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button type="button" onClick={() => setConfirm(false)} disabled={submitting} className="min-h-[48px] px-5 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold" data-testid="go-back-review">Go Back and Review</button>
              <button type="button" onClick={submit} disabled={submitting} className="btn-primary min-h-[48px] px-5 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60" data-testid="confirm-submit">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Confirm Submission
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default InterviewEvaluationForm;
