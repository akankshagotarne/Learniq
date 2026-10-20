import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart2, Eye, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '../engineering/ui';
import { olympiadErrorMessage } from '../../services/olympiad';
import { CreateEventPayload, eventsApi, EventStatus, OlympiadEventRow, STATUS_CLS, STATUS_LABEL } from '../../services/olympiadEvents';
import { fromISTInput } from '../../utils/examSchedule';

const inputCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted mb-1';
const errCls = 'text-xs text-red-600 mt-1';

export const EventBadge: React.FC<{ status: EventStatus }> = ({ status }) => (
  <span data-testid="event-status" className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>
);

const errorsOf = (err: any): Record<string, string> => err?.response?.data?.errors || {};

// ───────────────────────── create ─────────────────────────
const CreateDialog: React.FC<{ events: OlympiadEventRow[]; onClose: () => void; onCreated: (e: OlympiadEventRow) => void }> = ({ events, onClose, onCreated }) => {
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [standards, setStandards] = useState<number[]>([]);
  const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [duration, setDuration] = useState('60'); const [fee, setFee] = useState('20');
  const [regOpen, setRegOpen] = useState(''); const [regClose, setRegClose] = useState('');
  const [copyFrom, setCopyFrom] = useState(''); const [copyQuestions, setCopyQuestions] = useState(false);
  const [saving, setSaving] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState('');

  const toggle = (n: number) => setStandards(s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n].sort((a, b) => a - b)));
  const submit = async () => {
    if (saving) return;
    const local: Record<string, string> = {};
    if (name.trim().length < 3) local.name = 'Enter an event name (at least 3 characters).';
    if (!standards.length) local.standards = 'Choose at least one standard.';
    if (!start) local.startDate = 'Choose when the exam opens.';
    if (!end) local.endDate = 'Choose when the exam closes.';
    if (start && end && fromISTInput(end) <= fromISTInput(start)) local.endDate = 'The closing time must be after the opening time.';
    if (!(Number(duration) > 0)) local.durationMinutes = 'Enter the duration in minutes.';
    if (!(Number(fee) > 0)) local.fee = 'Enter the registration fee.';
    setErrors(local); setFormError('');
    if (Object.keys(local).length) return;
    const body: CreateEventPayload = {
      name: name.trim(), standards, description: description.trim() || undefined,
      schedule: { startDate: fromISTInput(start), endDate: fromISTInput(end), durationMinutes: Number(duration), fee: Number(fee) },
      registrationOpensAt: regOpen ? fromISTInput(regOpen) : undefined, registrationClosesAt: regClose ? fromISTInput(regClose) : undefined,
      copyFromEventId: copyFrom || undefined, copyQuestions: !!copyFrom && copyQuestions,
    };
    setSaving(true);
    try { const r = await eventsApi.create(body); toast.success('Olympiad event created as a draft. Add questions, then publish it.'); onCreated(r.event); }
    catch (err: any) {
      const e = errorsOf(err);
      setErrors({ name: e.name || '', standards: e.standards || '', startDate: e['schedule.startDate'] || '', endDate: e['schedule.endDate'] || '', durationMinutes: e['schedule.durationMinutes'] || '', fee: e['schedule.fee'] || '', registrationClosesAt: e.registrationClosesAt || '' });
      setFormError(olympiadErrorMessage(err, 'Could not create the event.'));
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Create New Olympiad Exam" onClose={onClose} wide>
      <div className="space-y-4" data-testid="create-event">
        <p className="text-xs text-text-secondary rounded-xl bg-surface-alt border border-border-subtle p-3">This creates a brand-new Olympiad event with its own exams. Registrations, payments, results, certificates and interviews of any earlier event are not copied and are never changed. All times are IST.</p>
        <label className="block"><span className={labelCls}>Event name</span>
          <input className={inputCls} value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="LearnIQ Olympiad — 24 October 2026" data-testid="ev-name" />
          {errors.name && <p className={errCls}>{errors.name}</p>}</label>
        <label className="block"><span className={labelCls}>Description (optional)</span>
          <textarea className={inputCls} rows={2} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <div><span className={labelCls}>Standards included</span>
          <div className="flex flex-wrap gap-2">{Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <label key={n} className={`min-h-[40px] px-3 rounded-xl border text-sm font-semibold inline-flex items-center gap-2 cursor-pointer ${standards.includes(n) ? 'border-brand-primary bg-brand-primary/10' : 'border-border-subtle bg-surface-alt'}`}>
              <input type="checkbox" checked={standards.includes(n)} onChange={() => toggle(n)} data-testid={`ev-std-${n}`} /> Std {n}</label>))}
            <button type="button" className="text-xs underline px-2" onClick={() => setStandards(standards.length === 10 ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}>{standards.length === 10 ? 'Clear' : 'Select all'}</button></div>
          {errors.standards && <p className={errCls}>{errors.standards}</p>}</div>
        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block min-w-0 sm:col-span-2"><span className={labelCls}>Exam opens (IST)</span><input type="datetime-local" className={inputCls} value={start} onChange={e => setStart(e.target.value)} data-testid="ev-start" />{errors.startDate && <p className={errCls}>{errors.startDate}</p>}</label>
          <label className="block min-w-0 sm:col-span-2"><span className={labelCls}>Exam closes (IST)</span><input type="datetime-local" className={inputCls} value={end} onChange={e => setEnd(e.target.value)} data-testid="ev-end" />{errors.endDate && <p className={errCls}>{errors.endDate}</p>}</label>
          <label className="block min-w-0"><span className={labelCls}>Duration (min)</span><input inputMode="numeric" className={inputCls} value={duration} onChange={e => setDuration(e.target.value)} />{errors.durationMinutes && <p className={errCls}>{errors.durationMinutes}</p>}</label>
          <label className="block min-w-0"><span className={labelCls}>Fee (₹)</span><input inputMode="numeric" className={inputCls} value={fee} onChange={e => setFee(e.target.value)} />{errors.fee && <p className={errCls}>{errors.fee}</p>}</label>
          <label className="block min-w-0 sm:col-span-2"><span className={labelCls}>Registration opens (optional)</span><input type="datetime-local" className={inputCls} value={regOpen} onChange={e => setRegOpen(e.target.value)} /></label>
          <label className="block min-w-0 sm:col-span-2"><span className={labelCls}>Registration closes (optional)</span><input type="datetime-local" className={inputCls} value={regClose} onChange={e => setRegClose(e.target.value)} />{errors.registrationClosesAt && <p className={errCls}>{errors.registrationClosesAt}</p>}</label>
        </div>
        <div className="rounded-xl border border-border-subtle p-3 space-y-2">
          <label className="block"><span className={labelCls}>Copy settings from an earlier event (optional)</span>
            <select className={inputCls} value={copyFrom} onChange={e => { setCopyFrom(e.target.value); if (!e.target.value) setCopyQuestions(false); }} data-testid="ev-copy">
              <option value="">Start empty</option>{events.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}</select></label>
          {copyFrom && <label className="flex items-center gap-2 text-sm min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={copyQuestions} onChange={e => setCopyQuestions(e.target.checked)} /> Also copy the question bank (questions and answers only, never student records)</label>}
        </div>
        {formError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="create-error">{formError}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm px-4 py-2 min-h-[44px]">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary text-sm px-5 py-2 min-h-[44px] disabled:opacity-50" data-testid="ev-create">{saving ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Creating…</span> : 'Create event (as draft)'}</button>
        </div>
      </div>
    </Modal>
  );
};

// ───────────────────────── view / edit ─────────────────────────
const DetailDialog: React.FC<{ id: string; editable: boolean; onClose: () => void; onSaved: () => void }> = ({ id, editable, onClose, onSaved }) => {
  const [ev, setEv] = useState<OlympiadEventRow | null>(null); const [err, setErr] = useState('');
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [regOpen, setRegOpen] = useState(''); const [regClose, setRegClose] = useState('');
  const [saving, setSaving] = useState(false); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const toInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() + 330 * 60000).toISOString();
    return d.slice(0, 16);
  };
  useEffect(() => {
    eventsApi.detail(id).then(r => {
      setEv(r.event); setName(r.event.name); setDescription(r.event.description || '');
      setRegOpen(toInput(r.event.registrationOpensAt)); setRegClose(toInput(r.event.registrationClosesAt));
    }).catch(e => setErr(olympiadErrorMessage(e, 'Could not load this event.')));
  }, [id]);
  const locked = ev?.state === 'cancelled';
  const save = async () => {
    if (!ev || saving) return;
    setSaving(true); setFieldErrors({});
    const body: Record<string, unknown> = { expectedUpdatedAt: ev.updatedAt };
    if (name.trim() !== ev.name) body.name = name.trim();
    if (description.trim() !== (ev.description || '')) body.description = description.trim();
    if (regOpen !== toInput(ev.registrationOpensAt)) body.registrationOpensAt = regOpen ? fromISTInput(regOpen) : null;
    if (regClose !== toInput(ev.registrationClosesAt)) body.registrationClosesAt = regClose ? fromISTInput(regClose) : null;
    try {
      const r = await eventsApi.update(id, body);
      toast.success(r.changed.length ? 'Event updated.' : 'Nothing to save.'); onSaved(); onClose();
    } catch (e: any) { setFieldErrors(errorsOf(e)); setErr(olympiadErrorMessage(e, 'Could not save the event.')); } finally { setSaving(false); }
  };
  return (
    <Modal title={ev ? `${editable ? 'Edit' : 'View'} event · ${ev.name}` : 'Olympiad event'} onClose={onClose}>
      {!ev && !err && <div className="flex items-center gap-2 text-sm py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
      {ev && (
        <div className="space-y-3 text-sm" data-testid="event-detail">
          <p><EventBadge status={ev.status} /> {ev.isLegacy && <span className="text-xs text-text-muted ml-2">Original event (migrated)</span>}</p>
          {editable && !locked ? (<>
            <label className="block"><span className={labelCls}>Event name</span><input className={inputCls} value={name} onChange={e => setName(e.target.value)} />{fieldErrors.name && <p className={errCls}>{fieldErrors.name}</p>}</label>
            <label className="block"><span className={labelCls}>Description</span><textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label>
            <label className="block"><span className={labelCls}>Registration opens (IST)</span><input type="datetime-local" className={inputCls} value={regOpen} onChange={e => setRegOpen(e.target.value)} /></label>
            <label className="block"><span className={labelCls}>Registration closes (IST)</span><input type="datetime-local" className={inputCls} value={regClose} onChange={e => setRegClose(e.target.value)} />{fieldErrors.registrationClosesAt && <p className={errCls}>{fieldErrors.registrationClosesAt}</p>}</label>
            <p className="text-xs text-text-muted">To change an exam&apos;s own schedule, duration or settings use <strong>Manage Exams</strong>.</p>
          </>) : (<dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
            <dt className="text-text-muted">Name</dt><dd>{ev.name}</dd>
            {ev.description && (<><dt className="text-text-muted">Description</dt><dd>{ev.description}</dd></>)}
            <dt className="text-text-muted">Standards</dt><dd>{ev.standards.join(', ')}</dd>
            <dt className="text-text-muted">Opens</dt><dd>{ev.startDateIST}</dd><dt className="text-text-muted">Closes</dt><dd>{ev.endDateIST}</dd>
            <dt className="text-text-muted">Registration</dt><dd>{ev.registrationOpensAtIST || 'Open now'} → {ev.registrationClosesAtIST || 'until the exam closes'}</dd>
            {ev.cancelReason && (<><dt className="text-text-muted">Cancelled</dt><dd>{ev.cancelReason}</dd></>)}
            <dt className="text-text-muted">Registered</dt><dd>{String(ev.students ?? '—')}</dd><dt className="text-text-muted">Submitted</dt><dd>{String(ev.submissions ?? '—')}</dd>
          </dl>)}
          {err && <div role="alert" className="text-red-600 text-sm">{err}</div>}
          {editable && !locked && <div className="flex justify-end gap-2"><button type="button" className="btn-secondary text-sm px-4 py-2" onClick={onClose}>Cancel</button><button type="button" className="btn-primary text-sm px-5 py-2 disabled:opacity-50" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
          {locked && <p className="text-xs text-text-muted">A cancelled event cannot be edited. Its records are kept.</p>}
        </div>
      )}
      {!ev && err && <div role="alert" className="text-red-600 text-sm">{err}</div>}
    </Modal>
  );
};

// ───────────────────────── confirm ─────────────────────────
type Pending = { kind: 'publish' | 'unpublish' | 'cancel' | 'delete'; event: OlympiadEventRow } | null;
const ConfirmDialog: React.FC<{ pending: NonNullable<Pending>; onClose: () => void; onDone: () => void }> = ({ pending, onClose, onDone }) => {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const { kind, event } = pending;
  const text = {
    publish: `Publish "${event.name}"? Students will see its exams and can register.`,
    unpublish: `Move "${event.name}" back to draft? Possible only while nobody has registered.`,
    cancel: `Cancel "${event.name}"? Registration and new attempts stop. All existing registrations, payments, results and certificates are kept.`,
    delete: `Delete the draft "${event.name}"? Only an unused draft can be deleted; this cannot be undone.`,
  }[kind];
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (kind === 'publish') await eventsApi.publish(event._id);
      else if (kind === 'unpublish') await eventsApi.unpublish(event._id);
      else if (kind === 'cancel') await eventsApi.cancel(event._id, reason.trim());
      else await eventsApi.remove(event._id);
      toast.success({ publish: 'Event published.', unpublish: 'Event moved to draft.', cancel: 'Event cancelled.', delete: 'Draft deleted.' }[kind]); onDone();
    } catch (e) { setErr(olympiadErrorMessage(e, 'That did not work.')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Please confirm" onClose={onClose}>
      <div className="space-y-3 text-sm" data-testid="confirm-dialog">
        <p>{text}</p>
        {kind === 'cancel' && <label className="block"><span className={labelCls}>Reason (shown to admins)</span><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} data-testid="cancel-reason" /></label>}
        {err && <div role="alert" className="text-red-600">{err}</div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary text-sm px-4 py-2" onClick={onClose}>Back</button>
          <button type="button" disabled={busy || (kind === 'cancel' && reason.trim().length < 3)} onClick={go} className="btn-primary text-sm px-5 py-2 disabled:opacity-50" data-testid="confirm-go">{busy ? 'Working…' : 'Confirm'}</button></div>
      </div>
    </Modal>
  );
};

// ───────────────────────── panel ─────────────────────────
const EventsPanel: React.FC<{ selectedId: string; onSelect: (id: string) => void; onChanged: () => void }> = ({ selectedId, onSelect, onChanged }) => {
  const nav = useNavigate();
  const [events, setEvents] = useState<OlympiadEventRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [q, setQ] = useState(''); const [status, setStatus] = useState('all'); const [standard, setStandard] = useState('all');
  const [creating, setCreating] = useState(false); const [dialog, setDialog] = useState<{ id: string; editable: boolean } | null>(null); const [pending, setPending] = useState<Pending>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await eventsApi.list({ search: q, status, standard }); setEvents(r.events); }
    catch (e) { setError(olympiadErrorMessage(e, 'Could not load the Olympiad events.')); } finally { setLoading(false); }
  }, [q, status, standard]);
  useEffect(() => { void load(); }, [load]);
  const changed = () => { void load(); onChanged(); };
  const go = (path: string, id: string) => nav(`${path}?event=${id}`);

  return (
    <section className="mb-8" data-testid="events-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="font-heading font-bold text-lg text-text-primary">Olympiad events</h2>
        <button type="button" onClick={() => setCreating(true)} className="btn-primary text-sm px-4 py-2 min-h-[44px] inline-flex items-center gap-2" data-testid="create-event-btn"><Plus className="w-4 h-4" /> Create New Olympiad Exam</button>
      </div>
      <div className="card-soft p-3 rounded-2xl grid gap-3 sm:grid-cols-3 mb-3">
        <label className="block min-w-0"><span className={labelCls}>Search</span><span className="relative block"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden /><input className={`${inputCls} pl-9`} placeholder="Event name" value={search} onChange={e => setSearch(e.target.value)} /></span></label>
        <label className="block min-w-0"><span className={labelCls}>Status</span><select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option>{(Object.keys(STATUS_LABEL) as EventStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block min-w-0"><span className={labelCls}>Standard</span><select className={inputCls} value={standard} onChange={e => setStandard(e.target.value)}>
          <option value="all">All standards</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>Standard {i + 1}</option>)}</select></label>
      </div>
      {error && <div role="alert" className="text-sm text-red-600 mb-2">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></div>}
      {loading && !events.length && <div className="flex items-center gap-2 text-sm text-text-secondary py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading events…</div>}
      {!loading && !events.length && !error && <p className="text-sm text-text-secondary py-6 text-center" data-testid="no-events">No Olympiad events match. Use “Create New Olympiad Exam” to add one.</p>}
      <div className="space-y-3">
        {events.map(e => (
          <div key={e._id} className={`card-soft p-4 rounded-2xl text-sm border ${selectedId === e._id ? 'border-brand-primary' : 'border-transparent'}`} data-testid="event-row">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="font-heading font-bold text-text-primary break-words">{e.name}</p>
                <p className="text-xs text-text-muted">{e.examDateIST} · Std {e.standards.join(', ')}{e.isLegacy ? ' · original event' : ''}</p></div>
              <EventBadge status={e.status} />
            </div>
            <p className="text-xs text-text-secondary mt-2">Opens {e.startDateIST} · Closes {e.endDateIST} · Registration {e.registration === 'open' ? 'open' : e.registration === 'closed' ? 'closed' : 'not open yet'} · {e.examCount} exam{e.examCount === 1 ? '' : 's'}</p>
            <p className="text-xs text-text-secondary">Registered students {String(e.students ?? 0)} · Registrations {String(e.registrations ?? 0)} · Submitted {String(e.submissions ?? 0)}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px] inline-flex items-center gap-1.5" onClick={() => setDialog({ id: e._id, editable: false })}><Eye className="w-3.5 h-3.5" /> View</button>
              {e.state !== 'cancelled' && <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px]" onClick={() => setDialog({ id: e._id, editable: true })}>Edit</button>}
              <button type="button" className="btn-primary text-xs px-3 py-2 min-h-[40px]" onClick={() => { onSelect(e._id); document.getElementById('exam-list')?.scrollIntoView?.({ behavior: 'smooth' }); }}>Manage Exams</button>
              <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px] inline-flex items-center gap-1.5" onClick={() => go('/admin/olympiad/analytics', e._id)}><BarChart2 className="w-3.5 h-3.5" /> View Analytics</button>
              <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px]" onClick={() => go('/admin/olympiad', e._id)}>View Results</button>
              <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px]" onClick={() => go('/admin/olympiad', e._id)}>View Certificates</button>
              <span className="relative">
                <button type="button" className="btn-secondary text-xs px-3 py-2 min-h-[40px]" aria-haspopup="menu" onClick={() => setOpenMenu(openMenu === e._id ? null : e._id)}>More</button>
                {openMenu === e._id && (
                  <div role="menu" className="absolute z-20 right-0 mt-1 w-48 rounded-xl border border-border-subtle bg-surface shadow-lg p-1 text-left">
                    {e.state === 'draft' && <button role="menuitem" type="button" className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-surface-alt" data-testid="act-publish" onClick={() => { setOpenMenu(null); setPending({ kind: 'publish', event: e }); }}>Publish</button>}
                    {e.state === 'published' && !e.isLegacy && <button role="menuitem" type="button" className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-surface-alt" onClick={() => { setOpenMenu(null); setPending({ kind: 'unpublish', event: e }); }}>Move back to draft</button>}
                    {e.state !== 'cancelled' && <button role="menuitem" type="button" className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-surface-alt text-amber-800" data-testid="act-cancel" onClick={() => { setOpenMenu(null); setPending({ kind: 'cancel', event: e }); }}>Cancel event</button>}
                    {e.state === 'draft' && !e.isLegacy && <button role="menuitem" type="button" className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-surface-alt text-red-700 inline-flex items-center gap-1.5" data-testid="act-delete" onClick={() => { setOpenMenu(null); setPending({ kind: 'delete', event: e }); }}><Trash2 className="w-3 h-3" /> Delete draft</button>}
                  </div>)}
              </span>
            </div>
          </div>))}
      </div>
      {creating && <CreateDialog events={events} onClose={() => setCreating(false)} onCreated={ev => { setCreating(false); onSelect(ev._id); changed(); }} />}
      {dialog && <DetailDialog id={dialog.id} editable={dialog.editable} onClose={() => setDialog(null)} onSaved={changed} />}
      {pending && <ConfirmDialog pending={pending} onClose={() => setPending(null)} onDone={() => { setPending(null); changed(); }} />}
    </section>
  );
};
export default EventsPanel;
