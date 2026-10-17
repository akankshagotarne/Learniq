import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarClock, Loader2, Pencil, RefreshCw, Search } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { Modal } from '../../components/engineering/ui';
import ProctoringSettings, { policyPayload } from '../../proctoring/ProctoringSettings';
import { proctoringApi, errorMessage as proctoringError } from '../../proctoring/api';
import { DEFAULT_PROCTORING_POLICY, ProctoringPolicy } from '../../proctoring/types';
import { olympiadErrorMessage } from '../../services/olympiad';
import { examManagementApi, AuditRow, ManagedExam, ManagementList, SavePayload } from '../../services/olympiadExamManagement';
import { describeShift, deriveStatus, ExamStatus, formatIST, fromISTInput, toISTInput, validateSchedule } from '../../utils/examSchedule';

const STATUS_LABEL: Record<ExamStatus, string> = { draft: 'Unpublished', upcoming: 'Upcoming', live: 'Live', closed: 'Closed' };
const STATUS_CLS: Record<ExamStatus, string> = {
  draft: 'bg-gray-100 text-gray-700', upcoming: 'bg-blue-50 text-blue-700', live: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-700',
};
const inputCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted mb-1';
const errCls = 'text-xs text-red-600 mt-1';

const StatusBadge: React.FC<{ status: ExamStatus }> = ({ status }) => (
  <span data-testid="status-badge" className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
);

/** Phones get a stacked card per record instead of a table. */
const useIsNarrow = (maxWidth = 767) => {
  const query = `(max-width: ${maxWidth}px)`;
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
};

// ───────────────────────── edit dialog ─────────────────────────
const EditDialog: React.FC<{ examId: string; onClose: () => void; onSaved: () => void }> = ({ examId, onClose, onSaved }) => {
  const [exam, setExam] = useState<ManagedExam | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [serverNow, setServerNow] = useState<Date>(new Date());
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [instructions, setInstructions] = useState('');
  const [startInput, setStartInput] = useState(''); const [endInput, setEndInput] = useState(''); const [duration, setDuration] = useState('');
  const [isPublished, setIsPublished] = useState(true); const [accessEnabled, setAccessEnabled] = useState(true);
  const [confirmActive, setConfirmActive] = useState(false); const [confirmPast, setConfirmPast] = useState(false);
  const [saving, setSaving] = useState(false); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState(''); const [stale, setStale] = useState(false);
  const [proc, setProc] = useState<ProctoringPolicy>(DEFAULT_PROCTORING_POLICY); const [procSaving, setProcSaving] = useState(false);
  const procLoaded = useRef(false);

  const fill = useCallback((e: ManagedExam) => {
    setExam(e); setTitle(e.title); setDescription(e.description || ''); setInstructions((e.instructions || []).join('\n'));
    setStartInput(toISTInput(e.startDate)); setEndInput(toISTInput(e.endDate)); setDuration(String(e.durationMinutes));
    setIsPublished(e.isPublished); setAccessEnabled(e.accessEnabled); setConfirmActive(false); setConfirmPast(false);
    if (!procLoaded.current) { procLoaded.current = true; setProc({ ...DEFAULT_PROCTORING_POLICY, ...(e.proctoring || {}) }); }
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const r = await examManagementApi.get(examId);
      setServerNow(new Date(r.serverNow)); setAudit(r.audit || []); fill(r.exam);
    } catch (err) { setLoadError(olympiadErrorMessage(err, 'Could not load this exam.')); }
  }, [examId, fill]);
  useEffect(() => { void load(); }, [load]);

  const scheduleErrors = useMemo(() => (exam ? validateSchedule({ startInput, endInput, duration }, exam.maxDurationMinutes || 600) : {}), [exam, startInput, endInput, duration]);
  const startIso = !scheduleErrors.startDate ? fromISTInput(startInput) : null;
  const endIso = !scheduleErrors.endDate && !scheduleErrors.startDate ? fromISTInput(endInput) : null;
  // the inputs have minute precision: an untouched field must count as unchanged even if the stored instant has seconds
  const endShift = exam && endIso ? (endInput === toISTInput(exam.endDate) ? describeShift(endIso, endIso) : describeShift(exam.endDate, endIso)) : null;
  const startShift = exam && startIso ? (startInput === toISTInput(exam.startDate) ? describeShift(startIso, startIso) : describeShift(exam.startDate, startIso)) : null;
  const durationChanged = !!exam && !scheduleErrors.durationMinutes && Number(duration) !== exam.durationMinutes;
  const scheduleChanged = !!exam && (endShift?.kind !== 'same' && !!endShift || startShift?.kind !== 'same' && !!startShift || durationChanged || isPublished !== exam.isPublished || accessEnabled !== exam.accessEnabled);
  const running = exam?.counts?.startedNotSubmitted || 0;
  const closesInPast = !!endIso && endShift?.kind !== 'same' && new Date(endIso) <= serverNow;
  const previewStatus = exam && startIso && endIso ? deriveStatus({ isPublished, startDate: startIso, endDate: endIso }, serverNow) : null;

  const payload = (): SavePayload => {
    if (!exam) return {};
    const p: SavePayload = { expectedUpdatedAt: exam.updatedAt };
    if (title.trim() !== exam.title) p.title = title.trim();
    if (description.trim() !== (exam.description || '')) p.description = description.trim();
    const lines = instructions.split('\n').map(l => l.trim()).filter(Boolean);
    if (JSON.stringify(lines) !== JSON.stringify(exam.instructions || [])) p.instructions = lines;
    if (startShift && startShift.kind !== 'same') p.startDate = fromISTInput(startInput);
    if (endShift && endShift.kind !== 'same') p.endDate = fromISTInput(endInput);
    if (durationChanged) p.durationMinutes = Number(duration);
    if (isPublished !== exam.isPublished) p.isPublished = isPublished;
    if (accessEnabled !== exam.accessEnabled) p.accessEnabled = accessEnabled;
    if (confirmActive) p.confirmActiveAttempts = true;
    if (confirmPast) p.confirmPast = true;
    return p;
  };
  const hasChanges = useMemo(() => {
    if (!exam) return false;
    const lines = instructions.split('\n').map(l => l.trim()).filter(Boolean);
    return title.trim() !== exam.title || description.trim() !== (exam.description || '') || JSON.stringify(lines) !== JSON.stringify(exam.instructions || []) || scheduleChanged;
  }, [exam, title, description, instructions, scheduleChanged]);
  const needsConfirm = (scheduleChanged && running > 0 && !confirmActive) || (closesInPast && !confirmPast);
  const hasLocalErrors = Object.keys(scheduleErrors).length > 0 || title.trim().length < 3;

  const save = async () => {
    if (!exam || saving) return;
    setFieldErrors({}); setFormError(''); setStale(false);
    if (hasLocalErrors) { setFieldErrors({ ...scheduleErrors, ...(title.trim().length < 3 ? { title: 'The title must be 3-160 characters.' } : {}) }); return; }
    setSaving(true);
    try {
      const r = await examManagementApi.save(exam._id, payload());
      toast.success(r.changed.length ? `Saved.${r.summary?.length ? ` ${r.summary.join(' ')}` : ''}` : (r.message || 'Nothing to save.'));
      fill(r.exam); void load(); onSaved();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'STALE_EXAM') { setStale(true); setFormError(data.message); }
      else if (data?.errors) { setFieldErrors(data.errors); setFormError(data.message || 'Please correct the highlighted fields.'); }
      else setFormError(olympiadErrorMessage(err, 'Could not save the exam.')); // the typed values stay in the form
    } finally { setSaving(false); }
  };

  const saveProctoring = async () => {
    if (!exam) return;
    setProcSaving(true);
    try {
      const saved = await proctoringApi.updateOlympiadPolicy(exam._id, policyPayload(proc) || {});
      toast.success('Proctoring settings saved for this exam. They apply to attempts started from now on.');
      setProc(p => ({ ...p, ...saved })); onSaved();
    } catch (err) { toast.error(proctoringError(err, 'Could not save the proctoring settings.')); } finally { setProcSaving(false); }
  };

  return (
    <Modal title={exam ? `Edit exam · ${exam.title}` : 'Edit exam'} onClose={onClose} wide>
      {loadError && <div role="alert" className="text-sm text-red-600 mb-3">{loadError} <button type="button" className="underline" onClick={() => void load()}>Retry</button></div>}
      {!exam && !loadError && <div className="flex items-center gap-2 text-sm text-text-secondary py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {exam && (
        <div className="space-y-6" data-testid="edit-dialog">
          <section className="space-y-3">
            <h3 className="font-heading font-bold text-sm text-text-primary">Basic information</h3>
            <label className="block"><span className={labelCls}>Exam title</span>
              <input className={inputCls} value={title} maxLength={160} onChange={e => setTitle(e.target.value)} data-testid="f-title" />
              {fieldErrors.title && <p className={errCls}>{fieldErrors.title}</p>}</label>
            <label className="block"><span className={labelCls}>Description</span>
              <textarea className={inputCls} rows={2} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} />
              {fieldErrors.description && <p className={errCls}>{fieldErrors.description}</p>}</label>
            <label className="block"><span className={labelCls}>Instructions (one per line)</span>
              <textarea className={inputCls} rows={4} value={instructions} onChange={e => setInstructions(e.target.value)} />
              {fieldErrors.instructions && <p className={errCls}>{fieldErrors.instructions}</p>}</label>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} data-testid="f-published" /> Published (visible to students)</label>
              <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={accessEnabled} onChange={e => setAccessEnabled(e.target.checked)} /> Access enabled</label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="font-heading font-bold text-sm text-text-primary flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Schedule <span className="text-[11px] font-normal text-text-muted">(all times are IST)</span></h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block min-w-0"><span className={labelCls}>Start date &amp; time (IST)</span>
                <input type="datetime-local" className={inputCls} value={startInput} onChange={e => setStartInput(e.target.value)} data-testid="f-start" />
                {(fieldErrors.startDate || scheduleErrors.startDate) && <p className={errCls}>{fieldErrors.startDate || scheduleErrors.startDate}</p>}</label>
              <label className="block min-w-0"><span className={labelCls}>Closing date &amp; time (IST)</span>
                <input type="datetime-local" className={inputCls} value={endInput} onChange={e => setEndInput(e.target.value)} data-testid="f-end" />
                {(fieldErrors.endDate || scheduleErrors.endDate) && <p className={errCls} data-testid="end-error">{fieldErrors.endDate || scheduleErrors.endDate}</p>}</label>
              <label className="block min-w-0"><span className={labelCls}>Duration (minutes)</span>
                <input inputMode="numeric" className={inputCls} value={duration} onChange={e => setDuration(e.target.value)} data-testid="f-duration" />
                {(fieldErrors.durationMinutes || scheduleErrors.durationMinutes) && <p className={errCls}>{fieldErrors.durationMinutes || scheduleErrors.durationMinutes}</p>}</label>
            </div>
            <p className="text-xs text-text-muted">Total questions: {exam.totalQuestions} · Total marks: {exam.totalMarks} (set by the question bank, not editable here). The status is worked out from this schedule.</p>

            <div className="rounded-xl border border-border-subtle bg-surface-alt p-3 text-sm space-y-1" data-testid="schedule-summary" aria-live="polite">
              <p><span className="text-text-muted">Current closing time:</span> <strong>{exam.endDateIST}</strong></p>
              <p><span className="text-text-muted">New closing time:</span> <strong>{endIso ? formatIST(endIso) : '—'}</strong></p>
              {endShift && <p data-testid="shift-text" className={endShift.kind === 'reduced' ? 'text-amber-700 font-semibold' : endShift.kind === 'extended' ? 'text-emerald-700 font-semibold' : 'text-text-muted'}>{endShift.text}{endShift.kind === 'reduced' ? ' (this is a reduction)' : ''}</p>}
              {startShift && startShift.kind !== 'same' && <p>Start time: {startShift.text.toLowerCase()} — now <strong>{formatIST(startIso)}</strong></p>}
              {durationChanged && <p>Duration: {exam.durationMinutes} → <strong>{duration} minutes</strong> (new attempts only)</p>}
              {previewStatus && <p className="pt-1 border-t border-border-subtle mt-1" data-testid="final-schedule">Final schedule: opens <strong>{formatIST(startIso)}</strong>, closes <strong>{formatIST(endIso)}</strong>, {duration || '—'} min → status <StatusBadge status={previewStatus} /></p>}
            </div>

            <div className="text-xs text-text-secondary">Students: {exam.counts?.registered ?? 0} registered · {running} started and not submitted · {exam.counts?.submitted ?? 0} submitted</div>
            {scheduleChanged && running > 0 && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="active-warning">
                <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{running} student{running === 1 ? ' has' : 's have'} started this exam and not submitted. Their running attempts keep their own timer and are never ended, shortened or extended by this change. New students follow the new settings.</span></p>
                <label className="flex items-center gap-2 mt-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={confirmActive} onChange={e => setConfirmActive(e.target.checked)} data-testid="confirm-active" /> I understand and want to apply this change</label>
              </div>
            )}
            {closesInPast && (
              <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="past-warning">
                This closing time is already in the past, so the exam closes for new students immediately.
                <label className="flex items-center gap-2 mt-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={confirmPast} onChange={e => setConfirmPast(e.target.checked)} data-testid="confirm-past" /> Close it now</label>
              </div>
            )}
          </section>

          {(formError || stale) && (
            <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="form-error">
              {formError}{stale && <> <button type="button" className="underline font-semibold" onClick={() => void load()}>Reload latest values</button></>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 sticky bottom-0 bg-surface py-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm px-4 py-2 min-h-[44px]">Cancel</button>
            <button type="button" onClick={save} disabled={saving || !hasChanges || needsConfirm || hasLocalErrors} className="btn-primary text-sm px-5 py-2 min-h-[44px] disabled:opacity-50" data-testid="save-exam">
              {saving ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span> : 'Save changes'}
            </button>
          </div>

          <section className="space-y-3 border-t border-border-subtle pt-5">
            <h3 className="font-heading font-bold text-sm text-text-primary">Online proctoring (this exam only)</h3>
            <ProctoringSettings value={proc} onChange={setProc} />
            <button type="button" disabled={procSaving} onClick={saveProctoring} className="btn-primary text-xs px-4 py-2 disabled:opacity-50">{procSaving ? 'Saving…' : 'Save proctoring settings'}</button>
          </section>

          {audit.length > 0 && (
            <section className="border-t border-border-subtle pt-4">
              <h3 className="font-heading font-bold text-sm text-text-primary mb-2">Recent changes</h3>
              <ul className="text-xs text-text-secondary space-y-1">
                {audit.slice(0, 8).map((a, i) => <li key={i}>{formatIST(a.at)} · {a.by || 'Admin'} · {a.success ? a.field : `refused (${a.note || 'rejected'})`}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
};

// ───────────────────────── page ─────────────────────────
const AdminOlympiadExamManagement: React.FC = () => {
  const [standard, setStandard] = useState('all'); const [status, setStatus] = useState('all'); const [examId, setExamId] = useState('all');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [data, setData] = useState<ManagementList | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [reloadKey, setReloadKey] = useState(0);
  const narrow = useIsNarrow();

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => {
    const ctrl = new AbortController(); let live = true;
    setLoading(true); setError('');
    examManagementApi.list({ standard, status, search, examId }, ctrl.signal)
      .then(r => { if (live) setData(r); })
      .catch(err => { if (live && !ctrl.signal.aborted && err?.code !== 'ERR_CANCELED') setError(olympiadErrorMessage(err, 'Could not load the exams.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; ctrl.abort(); };
  }, [standard, status, search, examId, reloadKey]);

  const reload = () => setReloadKey(k => k + 1);
  const exams = data?.exams || [];
  const options = (data?.options || []).filter(o => standard === 'all' || String(o.standard) === standard);

  const EditBtn = (e: ManagedExam) => (
    <button type="button" onClick={() => setEditing(e._id)} className="btn-primary text-xs px-3 py-2 min-h-[40px] inline-flex items-center gap-1.5" data-testid={`edit-${e._id}`}><Pencil className="w-3.5 h-3.5" /> Edit Exam</button>
  );

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[80rem] mx-auto">
          <div className="mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin · Olympiad</p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2" data-testid="page-title"><CalendarClock className="w-6 h-6 text-brand-primary" aria-hidden /> Olympiad Exam Management</h1>
              <p className="text-text-secondary text-sm mt-1">Change the schedule, duration and settings of any Olympiad exam. All times are in IST. BE Engineering is managed under Admin &rsaquo; Engineering.</p>
            </div>
            <button type="button" onClick={reload} className="btn-secondary text-sm px-3 py-2 min-h-[40px] inline-flex items-center gap-2 self-start"><RefreshCw className="w-4 h-4" /> Refresh</button>
          </div>

          <div className="card-soft p-4 rounded-2xl grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
            <label className="block min-w-0"><span className={labelCls}>Standard</span>
              <select className={inputCls} value={standard} onChange={e => { setStandard(e.target.value); setExamId('all'); }} data-testid="flt-standard">
                <option value="all">All standards</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>Standard {i + 1}</option>)}
              </select></label>
            <label className="block min-w-0"><span className={labelCls}>Exam</span>
              <select className={inputCls} value={examId} onChange={e => setExamId(e.target.value)} data-testid="flt-exam">
                <option value="all">All exams</option>{options.map(o => <option key={o._id} value={o._id}>{o.title}</option>)}
              </select></label>
            <label className="block min-w-0"><span className={labelCls}>Status</span>
              <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)} data-testid="flt-status">
                <option value="all">All statuses</option><option value="live">Live</option><option value="upcoming">Upcoming</option><option value="closed">Closed</option><option value="draft">Unpublished</option>
              </select></label>
            <label className="block min-w-0"><span className={labelCls}>Search</span>
              <span className="relative block"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
                <input className={`${inputCls} pl-9`} placeholder="Exam name" value={searchInput} onChange={e => setSearchInput(e.target.value)} data-testid="flt-search" /></span></label>
          </div>

          {error && <div role="alert" className="text-sm text-red-600 mb-3">{error} <button type="button" className="underline" onClick={reload}>Retry</button></div>}
          {loading && !data && <div className="flex items-center gap-2 text-sm text-text-secondary py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading exams…</div>}
          {data && exams.length === 0 && !loading && <p className="text-sm text-text-secondary py-10 text-center" data-testid="empty">No Olympiad exams match these filters.</p>}

          {exams.length > 0 && !narrow && (
            <div className="card-soft rounded-2xl overflow-x-auto" data-testid="exam-table">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border-subtle">
                  <th className="p-3">Exam</th><th className="p-3">Std</th><th className="p-3">Status</th><th className="p-3">Starts (IST)</th><th className="p-3">Closes (IST)</th><th className="p-3">Duration</th><th className="p-3">Marks / Qs</th><th className="p-3">Last updated</th><th className="p-3" />
                </tr></thead>
                <tbody>{exams.map(e => (
                  <tr key={e._id} className="border-b border-border-subtle last:border-0" data-testid="exam-row">
                    <td className="p-3 font-semibold text-text-primary min-w-[14rem]">{e.title}</td><td className="p-3">{e.standard}</td>
                    <td className="p-3"><StatusBadge status={e.status} /></td><td className="p-3 whitespace-nowrap">{e.startDateIST}</td><td className="p-3 whitespace-nowrap" data-testid="row-end">{e.endDateIST}</td>
                    <td className="p-3 whitespace-nowrap">{e.durationMinutes} min</td><td className="p-3 whitespace-nowrap">{e.totalMarks} / {e.totalQuestions}</td><td className="p-3 whitespace-nowrap">{e.updatedAtIST || '—'}</td><td className="p-3">{EditBtn(e)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {exams.length > 0 && narrow && (
            <div className="space-y-3" data-testid="exam-cards">{exams.map(e => (
              <div key={e._id} className="card-soft p-4 rounded-2xl space-y-1.5 text-sm" data-testid="exam-row">
                <div className="flex items-start justify-between gap-2"><p className="font-heading font-bold text-text-primary break-words min-w-0">{e.title}</p><StatusBadge status={e.status} /></div>
                <p className="text-text-secondary">Standard {e.standard} · {e.durationMinutes} min · {e.totalMarks} marks / {e.totalQuestions} questions</p>
                <p className="text-text-secondary">Starts {e.startDateIST}</p><p className="text-text-secondary" data-testid="row-end">Closes {e.endDateIST}</p>
                <p className="text-xs text-text-muted">Updated {e.updatedAtIST || '—'}</p>{EditBtn(e)}
              </div>))}</div>
          )}
        </div>
      </main>
      {editing && <EditDialog examId={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
};

export default AdminOlympiadExamManagement;
