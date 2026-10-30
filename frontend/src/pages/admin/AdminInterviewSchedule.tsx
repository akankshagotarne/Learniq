import React, { useCallback, useEffect, useState } from 'react';
import EventSelector from '../../components/olympiad/EventSelector';
import { useOlympiadEvent } from '../../hooks/useOlympiadEvent';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Trash2, Send } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { AdminScheduleData, interviewApi, interviewErrorMessage, ReminderOverview } from '../../services/interview';

const input = 'w-full min-h-[44px] rounded-xl border border-border-subtle bg-surface-alt px-3 text-sm text-text-primary';
const fmt = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

/** Admin: when the interviews happen (per exam, or per student with a teacher) and whether reminders really go out. All times are IST. */
const AdminInterviewSchedule: React.FC = () => {
  const ev = useOlympiadEvent({ interviewOnly: true });
  const [data, setData] = useState<AdminScheduleData | null>(null);
  const [rem, setRem] = useState<ReminderOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [examIds, setExamIds] = useState<string[]>([]);
  const [date, setDate] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState(''); const [note, setNote] = useState('');
  const [slotExam, setSlotExam] = useState(''); const [slotStudent, setSlotStudent] = useState(''); const [slotWhen, setSlotWhen] = useState(''); const [slotTeacher, setSlotTeacher] = useState(''); const [slotMin, setSlotMin] = useState('20');

  const load = useCallback(async () => {
    if (ev.loading) return;
    try { const [d, r] = await Promise.all([interviewApi.adminSchedule(ev.eventId || undefined), interviewApi.adminReminders()]); setData(d); setRem(r); setError(null); }
    catch (e) { setError(interviewErrorMessage(e, 'Could not load the schedule.')); }
  }, [ev.eventId, ev.loading]);
  useEffect(() => { setExamIds([]); setSlotExam(''); load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(interviewErrorMessage(e)); } finally { setBusy(null); }
  };
  const toggle = (id: string) => setExamIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const students = (data?.submitted || []).filter((s) => s.exam === slotExam);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
          <Link to="/admin/interviews" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary mb-4"><ArrowLeft className="w-4 h-4" /> Interviews</Link>
          <h1 className="font-heading font-bold text-2xl text-text-primary">Interview schedule &amp; reminders</h1>
          <p className="text-sm text-text-secondary mb-3">All times are Indian Standard Time (IST). Students see only what you set here. The schedule belongs to the selected Olympiad event.</p>
          <div className="mb-5 max-w-md"><EventSelector value={ev.eventId} options={ev.options} onChange={ev.setEvent} loading={ev.loading} error={ev.error} /></div>

          {error && <div className="card-soft p-4 rounded-xl text-sm mb-4" role="alert">{error}</div>}
          {!data && !error && <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

          {rem && (
            <section className={`rounded-2xl border p-4 mb-6 ${rem.automated ? 'border-[#4ADE9A]/50 bg-[#4ADE9A]/10' : 'border-[#FFC24B]/60 bg-[#FFC24B]/15'}`} data-testid="reminder-status" role="status">
              <h2 className="font-heading font-bold text-base text-text-primary">
                {rem.automated ? `Automatic reminders are ON (${rem.provider.activeChannel === 'sms' ? 'SMS' : 'WhatsApp'}, ${rem.provider.leadMinutes} min before)` : 'Automatic reminders are OFF'}
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                {rem.automated
                  ? 'A reminder is marked Sent only after the message provider accepted it.'
                  : 'No WhatsApp/SMS provider is configured on the server, so nothing is sent automatically. Please share the schedule in your WhatsApp group yourself. Voice-call reminders are not available.'}
              </p>
              <p className="text-xs text-text-muted mt-2" data-testid="reminder-counts">
                Pending {rem.counts.PENDING} · Sent {rem.counts.SENT} · Failed {rem.counts.FAILED} · Expired {rem.counts.EXPIRED} · Cancelled {rem.counts.CANCELLED}
              </p>
              {rem.automated && <button type="button" disabled={busy === 'run'} onClick={() => run('run', async () => { const r = await interviewApi.adminRunReminders(); toast(`Sent ${r.sent}, failed ${r.failed}, retrying ${r.retrying}`); }, 'Reminder check finished.')} className="mt-3 min-h-[44px] px-4 rounded-xl bg-surface border border-border-subtle text-sm font-semibold inline-flex items-center gap-2"><Send className="w-4 h-4" /> Check now</button>}
              {rem.attention.length > 0 && (
                <ul className="mt-3 text-xs space-y-1" data-testid="reminder-attention">
                  {rem.attention.map((a) => <li key={a._id}><b>{a.student}</b> – {a.status} ({fmt(a.startAt)}){a.lastError ? `: ${a.lastError}` : ''}</li>)}
                </ul>
              )}
            </section>
          )}

          {data && (
            <>
              <section className="card-soft rounded-2xl p-4 sm:p-5 mb-6 border border-border-subtle" aria-labelledby="gen-h">
                <h2 id="gen-h" className="font-heading font-bold text-lg text-text-primary mb-1">Interview day for a whole standard</h2>
                <p className="text-xs text-text-secondary mb-3">Students of the chosen standards are told the date (and the time, if you add one). Leave the time empty when the exact time is shared in the WhatsApp group.</p>
                <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Standards">
                  {data.exams.map((e) => (
                    <label key={e._id} className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold inline-flex items-center gap-2 cursor-pointer ${examIds.includes(e._id) ? 'border-brand-primary bg-brand-primary/10' : 'border-border-subtle bg-surface-alt'}`}>
                      <input type="checkbox" checked={examIds.includes(e._id)} onChange={() => toggle(e._id)} data-testid={`std-${e.standard}`} /> Std {e.standard}
                      {e.schedule && <span className="text-[11px] font-normal text-text-muted">· set</span>}
                    </label>
                  ))}
                  <button type="button" className="min-h-[44px] px-3 rounded-xl text-sm underline" onClick={() => setExamIds(examIds.length === data.exams.length ? [] : data.exams.map((e) => e._id))}>{examIds.length === data.exams.length ? 'Clear all' : 'Select all'}</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="text-xs font-semibold text-text-secondary">Date<input type="date" min={data.today} className={input} value={date} onChange={(e) => setDate(e.target.value)} data-testid="sched-date" /></label>
                  <label className="text-xs font-semibold text-text-secondary">From (optional)<input type="time" className={input} value={start} onChange={(e) => setStart(e.target.value)} data-testid="sched-start" /></label>
                  <label className="text-xs font-semibold text-text-secondary">Until (optional)<input type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} data-testid="sched-end" /></label>
                  <label className="text-xs font-semibold text-text-secondary">Note<input className={input} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                </div>
                <button type="button" disabled={busy === 'sched' || !examIds.length || !date} data-testid="sched-save"
                  onClick={() => run('sched', () => interviewApi.adminSetSchedule({ eventId: ev.eventId || undefined, examIds, interviewDate: date, startTime: start || undefined, endTime: end || undefined, note: note || undefined }), 'Schedule saved.')}
                  className="mt-3 btn-primary min-h-[44px] px-5 text-sm disabled:opacity-50">{busy === 'sched' ? 'Saving…' : 'Save schedule'}</button>
                <ul className="mt-4 divide-y divide-border-subtle text-sm" data-testid="sched-list">
                  {data.exams.filter((e) => e.schedule).map((e) => (
                    <li key={e._id} className="py-2 flex items-center justify-between gap-3">
                      <span><b>Std {e.standard}</b> – {e.schedule!.interviewDate}{e.schedule!.startTime ? `, ${e.schedule!.startTime}${e.schedule!.endTime ? `–${e.schedule!.endTime}` : ''} IST` : ' (time shared on WhatsApp)'}</span>
                      <button type="button" aria-label={`Remove schedule for standard ${e.standard}`} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-border-subtle" onClick={() => run(`del${e._id}`, () => interviewApi.adminClearSchedule(e._id), 'Schedule removed.')}><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                  {!data.exams.some((e) => e.schedule) && <li className="py-2 text-text-muted">No interview day is set yet. Students are told the schedule will be shared soon in the WhatsApp group.</li>}
                </ul>
              </section>

              <section className="card-soft rounded-2xl p-4 sm:p-5 border border-border-subtle" aria-labelledby="slot-h">
                <h2 id="slot-h" className="font-heading font-bold text-lg text-text-primary mb-1">Exact time for one student</h2>
                <p className="text-xs text-text-secondary mb-3">Only students who have submitted the exam. A teacher cannot have two interviews at the same time.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-xs font-semibold text-text-secondary">Standard
                    <select className={input} value={slotExam} onChange={(e) => { setSlotExam(e.target.value); setSlotStudent(''); }} data-testid="slot-exam">
                      <option value="">Choose…</option>{data.exams.map((e) => <option key={e._id} value={e._id}>Std {e.standard}</option>)}
                    </select></label>
                  <label className="text-xs font-semibold text-text-secondary">Student
                    <select className={input} value={slotStudent} onChange={(e) => setSlotStudent(e.target.value)} data-testid="slot-student">
                      <option value="">Choose…</option>{students.map((s) => <option key={s.student} value={s.student}>{s.studentName}</option>)}
                    </select></label>
                  <label className="text-xs font-semibold text-text-secondary">Teacher
                    <select className={input} value={slotTeacher} onChange={(e) => setSlotTeacher(e.target.value)} data-testid="slot-teacher">
                      <option value="">Any teacher</option>{data.teachers.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                    </select></label>
                  <label className="text-xs font-semibold text-text-secondary">Date &amp; time (IST)<input type="datetime-local" className={input} value={slotWhen} onChange={(e) => setSlotWhen(e.target.value)} data-testid="slot-when" /></label>
                  <label className="text-xs font-semibold text-text-secondary">Minutes<input type="number" min={5} max={240} className={input} value={slotMin} onChange={(e) => setSlotMin(e.target.value)} /></label>
                </div>
                <button type="button" disabled={busy === 'slot' || !slotExam || !slotStudent || !slotWhen} data-testid="slot-save"
                  onClick={() => run('slot', async () => {
                    const r = await interviewApi.adminSetSlot({ studentId: slotStudent, examId: slotExam, startAt: `${slotWhen}:00+05:30`, durationMinutes: Number(slotMin) || 20, teacherId: slotTeacher || undefined });
                    if (r.reminderNote === 'NO_PHONE') toast('Saved. This student has no phone number, so no reminder was queued.');
                  }, 'Interview time saved.')}
                  className="mt-3 btn-primary min-h-[44px] px-5 text-sm disabled:opacity-50">{busy === 'slot' ? 'Saving…' : 'Save time'}</button>
                <ul className="mt-4 divide-y divide-border-subtle text-sm" data-testid="slot-list">
                  {data.slots.map((s) => (
                    <li key={s._id} className="py-2 flex items-center justify-between gap-3">
                      <span><b>{s.studentName}</b> – {fmt(s.startAt)} IST{s.teacherName ? ` · ${s.teacherName}` : ''}</span>
                      <button type="button" aria-label={`Cancel interview time for ${s.studentName}`} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-border-subtle" onClick={() => run(`c${s._id}`, () => interviewApi.adminCancelSlot(s._id), 'Interview time cancelled.')}><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                  {!data.slots.length && <li className="py-2 text-text-muted">No individual times set.</li>}
                </ul>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminInterviewSchedule;
