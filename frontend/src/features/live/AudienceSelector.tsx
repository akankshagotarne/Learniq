import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, ShieldCheck, Users, X } from 'lucide-react';
import api from '../../services/api';
import {
  Audience, AudienceChoice, CHOICES, DEFAULT_AUDIENCE, Selections, StudentMode, TeacherMode, audienceFor, choiceOf, clone, standardName, summarizeAudience, toggle, validateAudience,
} from './audience';

interface StandardRow { value: number; label: string; studentCount: number }
interface PersonRow { id: string; name: string; sub: string }

const asStudent = (r: any): PersonRow => ({ id: r.id, name: r.name, sub: [r.standardLabel, r.hint].filter(Boolean).join(' · ') });
const asTeacher = (r: any): PersonRow => ({ id: r.id, name: r.name, sub: [(r.subjects || []).join(', '), r.qualification].filter(Boolean).join(' · ') });

/** Search + multi-select for students or teachers. Server-side search (never the whole table), selected people shown as removable chips. */
const PeoplePicker: React.FC<{ kind: 'student' | 'teacher'; selected: string[]; names: Record<string, PersonRow>; onChange: (ids: string[], seen: PersonRow[]) => void; idPrefix: string }> = ({ kind, selected, names, onChange, idPrefix }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [hint, setHint] = useState('');
  const seq = useRef(0);
  const noun = kind === 'student' ? 'students' : 'teachers';

  const run = useCallback(async (query: string) => {
    const mine = ++seq.current;
    if (kind === 'student' && query.trim().length < 2) { setRows([]); setHint('Type at least 2 letters of a name (or the last 4 digits of a phone number).'); setState('idle'); return; }
    setState('loading'); setHint('');
    try {
      const r = await api.get(`/teacher/live-audience/${noun}`, { params: { q: query.trim() || undefined, limit: 20 } });
      if (mine !== seq.current) return;
      setRows((kind === 'student' ? r.data.students : r.data.teachers).map(kind === 'student' ? asStudent : asTeacher));
      setState('idle');
    } catch (e: any) {
      if (mine !== seq.current) return;
      setState('error'); setHint(e?.response?.status === 401 ? 'Your session has expired. Please sign in again.' : `The ${noun} could not be loaded. Please try again.`);
    }
  }, [kind, noun]);

  useEffect(() => { const t = window.setTimeout(() => run(q), 300); return () => window.clearTimeout(t); }, [q, run]);

  const flip = (row: PersonRow) => onChange(toggle(selected, row.id), [row]);
  return (
    <div className="space-y-2" data-testid={`picker-${kind}`}>
      <div className="relative">
        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
        <input id={`${idPrefix}-search`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'student' ? 'Search students by name' : 'Search teachers by name'} aria-label={`Search ${noun}`}
          className="input-field !pl-9 !py-2.5 !text-base sm:!text-sm w-full" autoComplete="off" />
        {state === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-text-muted absolute right-3 top-1/2 -translate-y-1/2" aria-label="Searching" />}
      </div>
      {(hint || (state === 'idle' && rows.length === 0 && (kind === 'teacher' || q.trim().length >= 2))) && (
        <p role={state === 'error' ? 'alert' : 'status'} className={`text-xs ${state === 'error' ? 'text-rose-600' : 'text-text-muted'}`}>{hint || `No ${noun} match "${q.trim()}".`}</p>
      )}
      {rows.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-border-subtle divide-y divide-border-subtle bg-surface" aria-label={`${noun} found`}>
          {rows.map((r) => {
            const on = selected.includes(r.id);
            return (
              <li key={r.id}>
                <label className="flex items-center gap-3 px-3 min-h-[48px] cursor-pointer hover:bg-surface-alt">
                  <input type="checkbox" checked={on} onChange={() => flip(r)} className="w-5 h-5 accent-brand-primary flex-shrink-0" />
                  <span className="min-w-0"><span className="block text-sm font-medium text-text-primary truncate">{r.name}</span>{r.sub && <span className="block text-[11px] text-text-muted truncate">{r.sub}</span>}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs font-semibold text-text-secondary" data-testid={`${kind}-count`}>{selected.length} {kind}{selected.length === 1 ? '' : 's'} selected</p>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${noun}`}>
          {selected.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1 min-h-[32px] rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium max-w-full">
              <span className="truncate">{names[id]?.name || 'Selected person'}</span>
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id), [])} aria-label={`Remove ${names[id]?.name || 'person'}`} className="w-7 h-7 inline-flex items-center justify-center rounded-full hover:bg-brand-primary/20"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Standards as touch-friendly checkboxes with Select all / Clear selection (list comes from the server, never a hardcoded 1-10). */
const StandardsPicker: React.FC<{ standards: StandardRow[]; selected: number[]; onChange: (v: number[]) => void; idPrefix: string }> = ({ standards, selected, onChange, idPrefix }) => (
  <div className="space-y-2" data-testid="standards-picker">
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => onChange(standards.map((s) => s.value))} className="min-h-[40px] px-3 rounded-xl border border-border-subtle bg-surface text-xs font-semibold text-text-secondary">Select all</button>
      <button type="button" onClick={() => onChange([])} className="min-h-[40px] px-3 rounded-xl border border-border-subtle bg-surface text-xs font-semibold text-text-secondary">Clear selection</button>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {standards.map((s) => {
        const on = selected.includes(s.value);
        return (
          <label key={s.value} className={`flex items-center gap-2 rounded-xl border px-3 min-h-[44px] cursor-pointer ${on ? 'border-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface'}`}>
            <input id={`${idPrefix}-std-${s.value}`} type="checkbox" checked={on} onChange={() => onChange(toggle(selected, s.value))} className="w-5 h-5 accent-brand-primary flex-shrink-0" />
            <span className="text-sm text-text-primary">{s.label}</span>
          </label>
        );
      })}
    </div>
    <p className="text-xs font-semibold text-text-secondary" data-testid="standards-selected">{selected.length ? `Selected: ${[...selected].sort((a, b) => a - b).map(standardName).join(', ')}` : 'No standard selected yet.'}</p>
  </div>
);

/**
 * "Who can join this meeting?" - the audience of a live class (who may ENTER; what they see afterwards is the visibility setting below it).
 * Works on a draft: every change is reported through onChange and only saved with the rest of the meeting settings.
 */
export const AudienceSelector: React.FC<{ value: Audience | undefined; onChange: (a: Audience) => void; disabled?: boolean; idPrefix?: string }> = ({ value, onChange, disabled, idPrefix = 'aud' }) => {
  const legacy = !value;
  const [standards, setStandards] = useState<StandardRow[] | null>(null);
  const [stdError, setStdError] = useState('');
  const [names, setNames] = useState<Record<string, PersonRow>>({});
  const audience = value || DEFAULT_AUDIENCE;
  // selections survive switching between choices (only the chosen mode is saved)
  const [sel, setSel] = useState<Selections>({ standards: audience.students.standards, studentIds: audience.students.studentIds, teacherIds: audience.teachers.teacherIds });
  const choice = choiceOf(audience);
  const error = validateAudience(value);

  useEffect(() => {
    let live = true;
    api.get('/teacher/live-audience/standards').then((r) => { if (live) setStandards(r.data.standards || []); }).catch(() => { if (live) setStdError('The standards could not be loaded. Close this window and open it again.'); });
    return () => { live = false; };
  }, []);

  // names for people who were selected earlier (the saved selection survives a refresh)
  useEffect(() => {
    const sIds = audience.students.studentIds; const tIds = audience.teachers.teacherIds;
    const missing = [...sIds, ...tIds].filter((id) => !names[id]);
    if (!missing.length) return;
    let live = true;
    api.post('/teacher/live-audience/resolve', { studentIds: sIds, teacherIds: tIds }).then((r) => {
      if (!live) return;
      setNames((n) => ({ ...n, ...Object.fromEntries([...(r.data.students || []).map(asStudent), ...(r.data.teachers || []).map(asTeacher)].map((p: PersonRow) => [p.id, p])) }));
    }).catch(() => { /* chips fall back to a neutral label */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience.students.studentIds.join(','), audience.teachers.teacherIds.join(',')]);

  const emit = (c: AudienceChoice, s: Selections, studentMode?: StudentMode, teacherMode?: TeacherMode) => {
    let next = audienceFor(c, s, value);
    if (c === 'both') {
      const sm = studentMode || (audience.students.mode === 'none' ? 'all' : audience.students.mode);
      const tm = teacherMode || (audience.teachers.mode === 'none' ? 'all' : audience.teachers.mode);
      const b = clone(next);
      b.students = { mode: sm, standards: sm === 'standard' ? s.standards.slice(0, 1) : sm === 'standards' ? [...s.standards] : [], studentIds: sm === 'students' ? [...s.studentIds] : [] };
      b.teachers = { mode: tm, teacherIds: tm === 'selected' ? [...s.teacherIds] : [] };
      next = b;
    }
    onChange(next);
  };
  const setSelections = (patch: Partial<Selections>, remember?: PersonRow[]) => {
    const s = { ...sel, ...patch }; setSel(s);
    if (remember && remember.length) setNames((n) => ({ ...n, ...Object.fromEntries(remember.map((p) => [p.id, p])) }));
    emit(choice, s, audience.students.mode === 'none' ? undefined : audience.students.mode, audience.teachers.mode === 'none' ? undefined : audience.teachers.mode);
  };

  const stdOptions = standards || [];
  const studentControls = (mode: StudentMode) => (
    <div className="space-y-2 mt-2">
      {mode === 'standard' && (
        <div>
          <label htmlFor={`${idPrefix}-one`} className="block text-xs font-semibold text-text-secondary mb-1">Standard</label>
          <select id={`${idPrefix}-one`} value={sel.standards[0] ?? ''} disabled={disabled || !standards} onChange={(e) => setSelections({ standards: e.target.value === '' ? [] : [Number(e.target.value)] })} className="input-field !py-2.5 !text-base sm:!text-sm">
            <option value="">Select a standard…</option>
            {stdOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}
      {mode === 'standards' && <StandardsPicker standards={stdOptions} selected={sel.standards} onChange={(v) => setSelections({ standards: v })} idPrefix={idPrefix} />}
      {mode === 'students' && <PeoplePicker kind="student" selected={sel.studentIds} names={names} idPrefix={`${idPrefix}-s`} onChange={(ids, seen) => setSelections({ studentIds: ids }, seen)} />}
    </div>
  );
  const teacherControls = (
    <div className="mt-2"><PeoplePicker kind="teacher" selected={sel.teacherIds} names={names} idPrefix={`${idPrefix}-t`} onChange={(ids, seen) => setSelections({ teacherIds: ids }, seen)} /></div>
  );

  const summary = summarizeAudience(value);
  return (
    <fieldset disabled={disabled} className="space-y-2 min-w-0" data-testid="audience-selector">
      <legend className="flex items-center gap-1.5 text-sm font-semibold text-text-primary mb-0.5"><Users className="w-4 h-4 text-brand-primary" />Who can join this meeting?</legend>
      <p className="text-xs text-text-secondary">Choose your audience. This decides who is allowed in; what people can see once inside is set under &ldquo;Who can see whom&rdquo;.</p>
      {legacy && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-xs" data-testid="audience-legacy">
          This class was created before audiences existed, so it stays open to all signed-in students and approved teachers.
          <button type="button" onClick={() => onChange(clone(DEFAULT_AUDIENCE))} className="ml-1 font-semibold underline min-h-[32px]">Choose an audience</button>
        </div>
      )}
      {!legacy && CHOICES.map((c) => {
        const on = choice === c.value;
        return (
          <div key={c.value} className={`rounded-2xl border-2 px-3 py-2.5 transition-colors ${on ? 'border-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface hover:border-brand-primary/40'}`}>
            <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
              <input type="radio" name={`${idPrefix}-audience`} value={c.value} checked={on} onChange={() => emit(c.value, sel)} className="mt-1 w-5 h-5 accent-brand-primary flex-shrink-0" />
              <span className="min-w-0"><span className="block text-sm font-semibold text-text-primary">{c.label}</span><span className="block text-xs text-text-secondary">{c.hint}</span></span>
            </label>
            {on && c.value === 'one_standard' && studentControls('standard')}
            {on && c.value === 'multi_standards' && studentControls('standards')}
            {on && c.value === 'students' && studentControls('students')}
            {on && c.value === 'selected_teachers' && teacherControls}
            {on && c.value === 'both' && (
              <div className="mt-2 space-y-4">
                <div data-testid="both-students">
                  <label htmlFor={`${idPrefix}-both-students`} className="block text-xs font-semibold text-text-secondary mb-1">Student audience</label>
                  <select id={`${idPrefix}-both-students`} value={audience.students.mode} onChange={(e) => emit('both', sel, e.target.value as StudentMode, audience.teachers.mode)} className="input-field !py-2.5 !text-base sm:!text-sm">
                    <option value="all">All students — all standards</option><option value="standard">One specific standard</option><option value="standards">Multiple selected standards</option><option value="students">Selected individual students</option>
                  </select>
                  {studentControls(audience.students.mode)}
                </div>
                <div data-testid="both-teachers">
                  <label htmlFor={`${idPrefix}-both-teachers`} className="block text-xs font-semibold text-text-secondary mb-1">Teacher audience</label>
                  <select id={`${idPrefix}-both-teachers`} value={audience.teachers.mode} onChange={(e) => emit('both', sel, audience.students.mode, e.target.value as TeacherMode)} className="input-field !py-2.5 !text-base sm:!text-sm">
                    <option value="all">All eligible teachers</option><option value="selected">Selected teachers</option>
                  </select>
                  {audience.teachers.mode === 'selected' && teacherControls}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {stdError && <p role="alert" className="text-xs text-rose-600">{stdError}</p>}
      {error && <p role="alert" className="text-sm font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" data-testid="audience-error">{error}</p>}
      <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-3 py-2.5 text-xs text-text-secondary space-y-0.5" data-testid="audience-summary" aria-live="polite">
        <p className="flex items-center gap-1.5 font-semibold text-text-primary"><ShieldCheck className="w-4 h-4 text-brand-primary" />Meeting access summary</p>
        <p><span className="font-semibold">Students:</span> {summary.students}</p>
        <p><span className="font-semibold">Teachers:</span> {summary.teachers}</p>
        <p><span className="font-semibold">Access control:</span> {summary.access}</p>
        {value && <p className="flex items-center gap-1 text-emerald-700"><Check className="w-3.5 h-3.5" />Teachers who join are attendees only: they do not become hosts.</p>}
      </div>
    </fieldset>
  );
};

export default AudienceSelector;
