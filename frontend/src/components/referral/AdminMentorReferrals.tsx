import React, { useCallback, useEffect, useState } from 'react';
import { Users, BadgeCheck, Hourglass, UserCheck } from 'lucide-react';
import { Busy, ErrorBox, Modal, Pager, selectCls, useDebounced } from './adminBits';
import { adminMentorApi, AdminMentorDetail, AdminMentorOverview, AdminMentorRow } from '../../services/mentorReferrals';
import { formatISTDate, formatISTDateTime } from '../../utils/olympiadFormat';

const LIMIT = 15;
const std = (n: number | null) => (n === null || n === undefined ? '—' : n === 99 ? 'Others' : `Std ${n}`);
const STANDARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const M: React.FC<{ icon: React.ElementType; label: string; value: number; id: string }> = ({ icon: Icon, label, value, id }) => (
  <div className="card-soft rounded-card border border-border-subtle p-4" data-testid={`mmetric-${id}`}>
    <Icon className="w-5 h-5 text-brand-primary" aria-hidden /><p className="mt-2 text-2xl font-heading font-bold text-text-primary" data-testid={`mmetric-${id}-value`}>{value}</p><p className="text-xs font-semibold text-text-secondary">{label}</p>
  </div>
);
const Pill: React.FC<{ v: string }> = ({ v }) => <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${v === 'SUCCESSFUL' ? 'bg-[#E6F8EE] text-[#117A43] border-[#9BE0BA]' : 'bg-[#FFF4DD] text-[#8A5A00] border-[#F5D58A]'}`}>{v.charAt(0) + v.slice(1).toLowerCase()}</span>;

const Detail: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [d, setD] = useState<AdminMentorDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminMentorApi.detail(id).then(setD).catch(() => setErr('Could not load this referral.')); }, [id]);
  return (
    <Modal title="Mentor referral details" onClose={onClose} wide testId="mentor-dialog">
      {err && <ErrorBox message={err} />}{!d && !err && <Busy />}
      {d && <div className="space-y-3 text-sm">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {[['Mentor', `${d.mentor.name} (${d.mentorId})`], ['Mentor referral code', d.mentorCode], ['Referred student', `${d.referredName} (${d.referredId})`], ['Standard/Class', std(d.standard)],
            ['Registration date', formatISTDateTime(d.registeredAt)], ['Referral status', d.status.charAt(0) + d.status.slice(1).toLowerCase()], ['Successful on', d.successfulAt ? formatISTDateTime(d.successfulAt) : '—']].map(([k, v]) => <div key={k}><dt className="text-[11px] text-text-secondary">{k}</dt><dd className="font-medium text-text-primary break-all">{v}</dd></div>)}
        </dl>
        <div><p className="text-xs font-semibold mb-1">Status history</p><ul className="space-y-1">{d.timeline.map((e, i) => <li key={i} className="text-xs text-text-secondary">{formatISTDateTime(e.at)} · {e.event.replace(/_/g, ' ').toLowerCase()}{e.byName ? ` · ${e.byName}` : ''}{e.reason ? ` · ${e.reason}` : ''}</li>)}</ul></div>
      </div>}
    </Modal>
  );
};

const AdminMentorReferrals: React.FC = () => {
  const [ov, setOv] = useState<AdminMentorOverview | null>(null);
  const [ovErr, setOvErr] = useState('');
  const [f, setF] = useState({ q: '', status: '', standard: '', from: '', to: '' });
  const q = useDebounced(f.q);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminMentorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF(p => ({ ...p, [k]: e.target.value })); setPage(1); };

  const loadOv = useCallback(() => { setOvErr(''); adminMentorApi.overview().then(setOv).catch(() => setOvErr('Could not load the overview.')); }, []);
  const load = useCallback(() => {
    setLoading(true); setErr('');
    adminMentorApi.list({ status: f.status, standard: f.standard, from: f.from, to: f.to, q, page, limit: LIMIT }).then(r => { setRows(r.referrals); setTotal(r.total); }).catch(() => setErr('Could not load mentor referrals.')).finally(() => setLoading(false));
  }, [f.status, f.standard, f.from, f.to, q, page]);
  useEffect(loadOv, [loadOv]); useEffect(load, [load]);

  return (
    <div data-testid="admin-mentor-referrals">
      <h2 className="font-heading font-semibold text-xl text-text-primary">Mentor Referrals</h2>
      <p className="text-sm text-text-secondary mt-1">Track which students were referred by each teacher or mentor.</p>
      <p className="text-xs text-text-muted mt-1 mb-4">Tracking only. Mentors never receive exam credits, money or any other reward from this programme.</p>
      {ovErr && <ErrorBox message={ovErr} onRetry={loadOv} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <M id="total" icon={Users} label="Total Student Referrals" value={ov?.metrics.totalReferrals ?? 0} />
        <M id="successful" icon={BadgeCheck} label="Successful Student Referrals" value={ov?.metrics.successful ?? 0} />
        <M id="pending" icon={Hourglass} label="Pending Student Referrals" value={ov?.metrics.pending ?? 0} />
        <M id="mentors" icon={UserCheck} label="Participating Mentors" value={ov?.metrics.participatingMentors ?? 0} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <input aria-label="Search mentor, referral code or student name/ID" placeholder="Search mentor, referral code or student name/ID" value={f.q} onChange={set('q')} className={`${selectCls} col-span-2 lg:col-span-4`} data-testid="mm-search" />
        <select aria-label="Referral Status" value={f.status} onChange={set('status')} className={selectCls} data-testid="mm-status"><option value="">All statuses</option><option value="PENDING">Pending</option><option value="SUCCESSFUL">Successful</option></select>
        <select aria-label="Student Standard" value={f.standard} onChange={set('standard')} className={selectCls} data-testid="mm-standard"><option value="">Student Standard</option>{STANDARDS.map(n => <option key={n} value={n}>Std {n}</option>)}<option value="99">Others</option></select>
        <label className="text-[11px] text-text-secondary">Registration Date From<input type="date" value={f.from} onChange={set('from')} className={selectCls} /></label>
        <label className="text-[11px] text-text-secondary">Registration Date To<input type="date" value={f.to} onChange={set('to')} className={selectCls} /></label>
      </div>
      {err && <ErrorBox message={err} onRetry={load} />}
      {loading ? <Busy /> : !err && rows.length === 0 ? <p className="text-center text-sm text-text-muted py-12" data-testid="mm-empty">No mentor referrals found.</p> : !err && (
        <div className="overflow-x-auto rounded-card border border-border-subtle">
          <table className="w-full text-sm min-w-[820px]"><thead className="bg-surface-alt text-left text-[11px] uppercase text-text-secondary"><tr>{['#', 'Mentor Name', 'Mentor ID / Referral Code', 'Referred Student Name', 'Student ID', 'Standard/Class', 'Registration Date', 'Referral Status', 'Actions'].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.id} className="border-t border-border-subtle" data-testid="mm-row">
                <td className="px-3 py-2">{(page - 1) * LIMIT + i + 1}</td>
                <td className="px-3 py-2 font-medium">{r.mentorName}</td>
                <td className="px-3 py-2"><p className="font-mono text-[11px]">{r.mentorCode}</p><p className="text-[10px] text-text-muted font-mono">{r.mentorId.slice(-8)}</p></td>
                <td className="px-3 py-2 font-medium">{r.referredName}</td><td className="px-3 py-2 font-mono text-[11px]">{r.referredId.slice(-8)}</td>
                <td className="px-3 py-2">{std(r.standard)}</td><td className="px-3 py-2 whitespace-nowrap">{formatISTDate(r.registeredAt)}</td>
                <td className="px-3 py-2"><Pill v={r.status} /></td>
                <td className="px-3 py-2"><button onClick={() => setOpen(r.id)} className="text-xs font-semibold text-brand-primary" data-testid="mm-view">View Details</button></td>
              </tr>))}</tbody></table>
        </div>
      )}
      <Pager page={page} limit={LIMIT} total={total} loading={loading} onPage={setPage} />
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
export default AdminMentorReferrals;
