import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Send, Download, RotateCcw, CheckSquare, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminReferralApi, GrantBatch, GrantStudent, newRequestId, ReferralSettings } from '../../services/referrals';
import { olympiadErrorMessage } from '../../services/olympiad';
import { formatISTDateTime } from '../../utils/olympiadFormat';
import { Busy, ErrorBox, Field, Modal, Pager, StatusPill, selectCls, useDebounced, useNarrow } from './adminBits';

const PAGE = 15;
const MIN_REASON = 3;

interface Draft { ids: string[]; names: Record<string, string>; credits: number; reason: string; note: string }

/**
 * "Send Exam Credits": pick one or many students, choose credits, give a reason, confirm. The request id is created when the confirmation
 * opens and kept for the whole operation, so a double click, a timeout or "Retry failed" can never grant twice.
 */
const SendCredits: React.FC<{ settings: ReferralSettings | null; onChanged: () => void }> = ({ settings, onChanged }) => {
  const narrow = useNarrow();
  const maxBulk = settings?.maxBulkSize ?? 200;
  const maxCredits = settings?.maxCreditsPerStudent ?? 20;

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim());
  const [standard, setStandard] = useState('all');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ rows: GrantStudent[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Map<string, string>>(new Map());   // id -> name (kept across pages and filters)
  const [credits, setCredits] = useState('1');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [fieldErr, setFieldErr] = useState<{ credits?: string; reason?: string; students?: string }>({});
  const [selecting, setSelecting] = useState(false);

  const [confirm, setConfirm] = useState<{ draft: Draft; requestId: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [outcome, setOutcome] = useState<{ batch: GrantBatch; draft: Draft; requestId: string; already: boolean } | null>(null);
  const [submitError, setSubmitError] = useState('');

  const [history, setHistory] = useState<{ rows: GrantBatch[]; total: number; page: number } | null>(null);
  const [openBatch, setOpenBatch] = useState<GrantBatch | null>(null);

  useEffect(() => { setPage(1); }, [search, standard]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await adminReferralApi.students({ q: search, standard, page, limit: PAGE }); setList({ rows: r.students, total: r.total }); }
    catch (err) { setError(olympiadErrorMessage(err, 'We could not load the students.')); }
    finally { setLoading(false); }
  }, [search, standard, page]);
  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async (p = 1) => {
    try { const r = await adminReferralApi.batches(p); setHistory({ rows: r.batches, total: r.total, page: p }); } catch { /* history is secondary */ }
  }, []);
  useEffect(() => { void loadHistory(1); }, [loadHistory]);

  const toggle = (s: GrantStudent) => setSelected(prev => { const n = new Map(prev); if (n.has(s.id)) n.delete(s.id); else n.set(s.id, s.name); return n; });
  const pageIds = list?.rows.map(r => r.id) || [];
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const togglePage = () => setSelected(prev => {
    const n = new Map(prev);
    if (allOnPage) pageIds.forEach(id => n.delete(id)); else list?.rows.forEach(r => n.set(r.id, r.name));
    return n;
  });
  const selectAllMatching = async () => {
    setSelecting(true);
    try {
      const r = await adminReferralApi.allStudentIds({ q: search, standard });
      const names = new Map<string, string>(selected);
      // names for ids we have not seen are fetched lazily on the confirmation (the server reports names per outcome)
      r.ids.forEach(id => { if (!names.has(id)) names.set(id, ''); });
      setSelected(names);
      if (r.truncated) toast(`Only the first ${r.cap} of ${r.total} matching students were selected (the limit for one operation).`);
      else toast.success(`${r.ids.length} student${r.ids.length === 1 ? '' : 's'} selected.`);
    } catch (err) { toast.error(olympiadErrorMessage(err, 'Could not select the students.')); }
    finally { setSelecting(false); }
  };

  const review = () => {
    const errs: typeof fieldErr = {};
    const n = Number(credits);
    if (!Number.isInteger(n) || n < 1 || n > maxCredits) errs.credits = `Enter a whole number from 1 to ${maxCredits}.`;
    if (reason.trim().length < MIN_REASON) errs.reason = 'A reason is required (at least 3 characters).';
    if (selected.size === 0) errs.students = 'Select at least one student.';
    if (selected.size > maxBulk) errs.students = `You can select at most ${maxBulk} students for one operation.`;
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setSubmitError('');
    setConfirm({ requestId: newRequestId(), draft: { ids: [...selected.keys()], names: Object.fromEntries(selected), credits: n, reason: reason.trim(), note: note.trim() } });
  };

  const submit = async (d: Draft, requestId: string) => {
    if (submitLock.current) return;       // double click / Enter twice
    submitLock.current = true; setSubmitting(true); setSubmitError('');
    try {
      const r = await adminReferralApi.grant({ studentIds: d.ids, credits: d.credits, reason: d.reason, note: d.note || undefined, requestId });
      setConfirm(null); setOutcome({ batch: r.batch, draft: d, requestId, already: r.alreadyProcessed });
      if (r.batch.status === 'COMPLETED') { setSelected(new Map()); setReason(''); setNote(''); setCredits('1'); }
      onChanged(); void load(); void loadHistory(1);
    } catch (err) {
      // the request id is kept: pressing the button again retries the SAME operation (the server never grants twice)
      setSubmitError(olympiadErrorMessage(err, 'The operation could not be completed. You can safely try again.'));
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const retryFailed = () => { if (outcome) void submit(outcome.draft, outcome.requestId); };
  const total = useMemo(() => (confirm ? confirm.draft.ids.length * confirm.draft.credits : 0), [confirm]);
  const nameFor = (d: Draft, id: string) => d.names[id] || 'Selected student';

  const rows = list?.rows || [];
  return (
    <div data-testid="send-credits">
      <p className="text-sm text-text-secondary mb-4">Give exam credits to one student or to many at once. 1 credit lets a student open one paid Olympiad exam without paying. Every grant is recorded with your name, the reason and a batch ID.</p>

      {outcome && (
        <section className="card-soft rounded-card border border-border-subtle p-4 mb-5" aria-live="polite" data-testid="grant-result">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-heading font-bold text-text-primary flex items-center gap-2">Operation result <StatusPill value={outcome.batch.status} /></h3>
              <p className="text-xs text-text-secondary mt-0.5">Batch ID <span className="font-mono font-semibold" data-testid="batch-id">{outcome.batch.batchId}</span>{outcome.already ? ' · this request had already been processed' : ''}</p>
            </div>
            <button onClick={() => setOutcome(null)} aria-label="Dismiss result" className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-surface-alt"><X className="w-4 h-4" aria-hidden /></button>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mt-3">
            {[['Requested', outcome.batch.requested], ['Granted', outcome.batch.granted], ['Skipped', outcome.batch.skipped], ['Failed', outcome.batch.failed], ['Credits issued', outcome.batch.totalCredits]].map(([k, v]) => (
              <div key={String(k)}><dt className="text-[11px] text-text-muted">{k}</dt><dd className="font-heading font-bold text-text-primary" data-testid={`result-${String(k).toLowerCase().replace(' ', '-')}`}>{v}</dd></div>
            ))}
          </dl>
          {(outcome.batch.failed > 0 || outcome.batch.skipped > 0) && (
            <ul className="mt-3 max-h-48 overflow-y-auto divide-y divide-border-subtle text-xs border border-border-subtle rounded-xl" data-testid="result-issues">
              {outcome.batch.results.filter(r => r.status === 'FAILED' || r.status === 'SKIPPED').map((r, i) => (
                <li key={`${r.studentId}-${i}`} className="px-3 py-2 flex items-center justify-between gap-2"><span className="min-w-0 break-words">{r.studentName || r.studentId || 'Unknown'} — {r.message}</span><StatusPill value={r.status} /></li>
              ))}
            </ul>
          )}
          {submitError && <p role="alert" className="text-xs text-[#9D174D] mt-3">{submitError}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {outcome.batch.failed > 0 && <button onClick={retryFailed} disabled={submitting} className="btn-primary inline-flex items-center gap-2 text-xs min-h-[40px]" data-testid="retry-failed">{submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RotateCcw className="w-3.5 h-3.5" aria-hidden />} Retry failed students</button>}
            <button onClick={() => void adminReferralApi.exportBatch(outcome.batch.batchId).catch(() => toast.error('Could not download the report.'))} className="btn-outline inline-flex items-center gap-2 text-xs min-h-[40px]" data-testid="export-batch"><Download className="w-3.5 h-3.5" aria-hidden /> Download report (CSV)</button>
          </div>
          {outcome.batch.failed > 0 && <p className="text-[11px] text-text-muted mt-2">Retrying uses the same operation: students who were already granted are not granted again.</p>}
        </section>
      )}

      <section className="card-soft rounded-card border border-border-subtle p-4 mb-5">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Credits per student">
            <input type="number" inputMode="numeric" min={1} max={maxCredits} step={1} value={credits} onChange={e => { setCredits(e.target.value); setFieldErr(p => ({ ...p, credits: undefined })); }} className={selectCls} aria-invalid={!!fieldErr.credits} data-testid="credits-input" />
            {fieldErr.credits && <span role="alert" className="text-[11px] text-[#9D174D]" data-testid="credits-error">{fieldErr.credits}</span>}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason (shown to the team; required)">
              <input value={reason} maxLength={500} onChange={e => { setReason(e.target.value); setFieldErr(p => ({ ...p, reason: undefined })); }} placeholder="e.g. Scholarship winners, festival offer, support resolution" className={selectCls} aria-invalid={!!fieldErr.reason} data-testid="reason-input" />
              {fieldErr.reason && <span role="alert" className="text-[11px] text-[#9D174D]" data-testid="reason-error">{fieldErr.reason}</span>}
            </Field>
          </div>
        </div>
        <div className="mt-3"><Field label="Internal note (optional, not shown to students)"><input value={note} maxLength={500} onChange={e => setNote(e.target.value)} className={selectCls} data-testid="note-input" /></Field></div>
      </section>

      <section aria-label="Choose students">
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name, email, phone or student ID" className={`${selectCls} pl-9`} aria-label="Search students" data-testid="student-search" />
          </div>
          <select className={`${selectCls} sm:w-40`} value={standard} onChange={e => setStandard(e.target.value)} aria-label="Standard filter" data-testid="standard-filter">
            <option value="all">All standards</option>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Std {n}</option>)}<option value="99">Others</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <span className="font-semibold text-text-primary" data-testid="selected-count">{selected.size} selected</span>
          <button onClick={togglePage} disabled={!rows.length} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50" data-testid="select-page">{allOnPage ? 'Unselect this page' : 'Select this page'}</button>
          <button onClick={selectAllMatching} disabled={!list?.total || selecting} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50 inline-flex items-center gap-1" data-testid="select-all-matching">{selecting ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <CheckSquare className="w-3 h-3" aria-hidden />} Select all {list?.total ?? 0} matching{(list?.total ?? 0) > maxBulk ? ` (max ${maxBulk})` : ''}</button>
          {selected.size > 0 && <button onClick={() => setSelected(new Map())} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface" data-testid="clear-selection">Clear selection</button>}
        </div>
        {fieldErr.students && <p role="alert" className="text-xs text-[#9D174D] mb-2" data-testid="students-error">{fieldErr.students}</p>}
        {error && <ErrorBox message={error} onRetry={load} />}

        <div className={`card-soft rounded-card border border-border-subtle overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {!list ? <Busy /> : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-text-secondary" data-testid="students-empty">No students match your search.</div>
          ) : narrow ? (
            <ul className="divide-y divide-border-subtle" data-testid="students-list">
              {rows.map(s => (
                <li key={s.id} className="p-3 flex items-start gap-3" data-testid="student-row">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s)} aria-label={`Select ${s.name}`} className="mt-1 w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-sm"><p className="font-semibold text-text-primary break-words">{s.name}</p><p className="text-xs text-text-secondary break-all">{s.email || s.phone || '—'}</p><p className="text-xs text-text-muted">{s.standard ? `Std ${s.standard === 99 ? 'Others' : s.standard}` : 'No standard'} · {s.credits} credit{s.credits === 1 ? '' : 's'}</p></div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]" data-testid="students-table">
                <thead className="bg-surface-alt border-b border-border-subtle"><tr>
                  <th className="px-3 py-2 w-10"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select all students on this page" className="w-4 h-4" /></th>
                  {['Student', 'Email / phone', 'Standard', 'Credits', 'Status'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.id} className="border-b border-border-subtle last:border-0" data-testid="student-row">
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s)} aria-label={`Select ${s.name}`} className="w-4 h-4" /></td>
                      <td className="px-3 py-2 font-semibold text-text-primary">{s.name}</td>
                      <td className="px-3 py-2 text-xs text-text-secondary break-all">{s.email || '—'}<br />{s.phone || ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.standard ? (s.standard === 99 ? 'Others' : `Std ${s.standard}`) : '—'}</td>
                      <td className="px-3 py-2">{s.credits}</td>
                      <td className="px-3 py-2"><StatusPill value={s.status === 'Active' ? 'COMPLETED' : 'SKIPPED'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {list && <Pager page={page} limit={PAGE} total={list.total} loading={loading} onPage={setPage} />}
        <div className="mt-4 flex justify-end">
          <button onClick={review} className="btn-primary inline-flex items-center gap-2 min-h-[44px]" data-testid="review-grant"><Send className="w-4 h-4" aria-hidden /> Review &amp; send{selected.size ? ` to ${selected.size}` : ''}</button>
        </div>
      </section>

      <section className="mt-8" aria-label="Recent credit operations">
        <h3 className="font-heading font-bold text-text-primary mb-2">Recent operations</h3>
        <div className="card-soft rounded-card border border-border-subtle overflow-x-auto">
          {!history || history.rows.length === 0 ? <div className="p-6 text-center text-sm text-text-secondary" data-testid="history-empty">No credits have been sent yet.</div> : (
            <table className="w-full text-sm min-w-[620px]" data-testid="history-table">
              <thead className="bg-surface-alt border-b border-border-subtle"><tr>{['Batch ID', 'When', 'By', 'Students', 'Credits', 'Status', ''].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{history.rows.map(b => (
                <tr key={b.batchId} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{b.batchId}</td><td className="px-3 py-2 text-xs whitespace-nowrap">{formatISTDateTime(b.createdAt)}</td><td className="px-3 py-2 text-xs">{b.admin || '—'}</td>
                  <td className="px-3 py-2">{b.granted}/{b.requested}</td><td className="px-3 py-2">{b.totalCredits}</td><td className="px-3 py-2"><StatusPill value={b.status} /></td>
                  <td className="px-3 py-2"><button className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => adminReferralApi.batch(b.batchId).then(setOpenBatch).catch(err => toast.error(olympiadErrorMessage(err)))}>Details</button></td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
        {history && history.total > 10 && <Pager page={history.page} limit={10} total={history.total} onPage={p => void loadHistory(p)} />}
      </section>

      {confirm && (
        <Modal title="Confirm credit grant" onClose={() => setConfirm(null)} locked={submitting} testId="confirm-dialog">
          <p className="text-sm text-text-secondary">You are about to give exam credits. Please check the details.</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm my-4" data-testid="confirm-details">
            <div><dt className="text-xs text-text-muted">Students</dt><dd className="font-bold text-text-primary" data-testid="confirm-count">{confirm.draft.ids.length}</dd></div>
            <div><dt className="text-xs text-text-muted">Credits per student</dt><dd className="font-bold text-text-primary" data-testid="confirm-each">{confirm.draft.credits}</dd></div>
            <div><dt className="text-xs text-text-muted">Total credits</dt><dd className="font-bold text-text-primary" data-testid="confirm-total">{total}</dd></div>
            <div><dt className="text-xs text-text-muted">Reason</dt><dd className="text-text-primary break-words">{confirm.draft.reason}</dd></div>
          </dl>
          {confirm.draft.ids.length <= 5 && <p className="text-xs text-text-secondary mb-3 break-words">{confirm.draft.ids.map(id => nameFor(confirm.draft, id)).join(', ')}</p>}
          <p className="text-[11px] text-text-muted mb-3">Each student is notified. This cannot be undone in one click; a mistaken grant is corrected with a recorded adjustment.</p>
          {submitError && <p role="alert" className="text-xs text-[#9D174D] mb-3" data-testid="confirm-error">{submitError}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button onClick={() => setConfirm(null)} disabled={submitting} className="btn-outline min-h-[44px]" data-testid="confirm-cancel">Cancel</button>
            <button onClick={() => void submit(confirm.draft, confirm.requestId)} disabled={submitting} className="btn-primary min-h-[44px] inline-flex items-center justify-center gap-2" data-testid="confirm-send">{submitting ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Sending…</> : submitError ? 'Try again' : `Send ${total} credit${total === 1 ? '' : 's'}`}</button>
          </div>
        </Modal>
      )}

      {openBatch && (
        <Modal title={`Operation ${openBatch.batchId}`} onClose={() => setOpenBatch(null)} wide testId="batch-dialog">
          <p className="text-xs text-text-secondary mb-3">{formatISTDateTime(openBatch.createdAt)} · by {openBatch.admin || '—'} · {openBatch.creditsPerStudent} credit(s) each · reason: {openBatch.reason}</p>
          <div className="max-h-80 overflow-y-auto border border-border-subtle rounded-xl">
            <ul className="divide-y divide-border-subtle text-sm">{openBatch.results.map((r, i) => <li key={`${r.studentId}-${i}`} className="px-3 py-2 flex items-center justify-between gap-2"><span className="min-w-0 break-words">{r.studentName || r.studentId}<span className="block text-[11px] text-text-muted">{r.message}</span></span><StatusPill value={r.status} /></li>)}</ul>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => void adminReferralApi.exportBatch(openBatch.batchId).catch(() => toast.error('Could not download the report.'))} className="btn-outline inline-flex items-center gap-2 min-h-[40px] text-xs"><Download className="w-3.5 h-3.5" aria-hidden /> CSV</button>
            <button onClick={() => setOpenBatch(null)} className="btn-primary min-h-[40px] text-xs">Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SendCredits;
