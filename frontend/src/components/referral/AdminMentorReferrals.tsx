import React, { useCallback, useEffect, useState } from 'react';
import { Users, BadgeCheck, Hourglass, UserCheck, GraduationCap, ShieldQuestion } from 'lucide-react';
import { Busy, ErrorBox, Modal, Pager, selectCls, useDebounced } from './adminBits';
import { adminMentorApi, AdminMentorDetail, AdminMentorOverview, AdminMentorRow } from '../../services/mentorReferrals';
import { formatISTDate, formatISTDateTime } from '../../utils/olympiadFormat';

const LIMIT = 15;
const std = (n: number | null) => (n === null || n === undefined ? '—' : n === 99 ? 'Others' : `Std ${n}`);
const M: React.FC<{ icon: React.ElementType; label: string; value: number; id: string }> = ({ icon: Icon, label, value, id }) => (
  <div className="card-soft rounded-card border border-border-subtle p-4" data-testid={`mmetric-${id}`}>
    <Icon className="w-5 h-5 text-brand-primary" aria-hidden /><p className="mt-2 text-2xl font-heading font-bold text-text-primary" data-testid={`mmetric-${id}-value`}>{value}</p><p className="text-xs font-semibold text-text-secondary">{label}</p>
  </div>
);
const Pill: React.FC<{ v: string }> = ({ v }) => <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${v === 'SUCCESSFUL' || v === 'APPROVED' ? 'bg-[#E6F8EE] text-[#117A43] border-[#9BE0BA]' : v === 'REJECTED' ? 'bg-[#FFE4EC] text-[#9D174D] border-[#F9A8C0]' : 'bg-[#FFF4DD] text-[#8A5A00] border-[#F5D58A]'}`}>{v.charAt(0) + v.slice(1).toLowerCase()}</span>;

const Detail: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [d, setD] = useState<AdminMentorDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminMentorApi.detail(id).then(setD).catch(() => setErr('Could not load this referral.')); }, [id]);
  return (
    <Modal title="Mentor referral details" onClose={onClose} wide testId="mentor-dialog">
      {err && <ErrorBox message={err} />}{!d && !err && <Busy />}
      {d && <div className="space-y-3 text-sm">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {[['Mentor', `${d.mentor.name} (${d.mentorId})`], ['Mentor code', d.mentorCode], ['Referred', `${d.referred.name} (${d.referredId})`], ['Type', d.referredRole === 'teacher' ? 'Teacher' : 'Student'],
            ['Registered', formatISTDateTime(d.registeredAt)], ['Successful on', d.successfulAt ? formatISTDateTime(d.successfulAt) : '—'], ['Status', d.status], ['Account approval', d.approvalStatus || 'Not applicable']].map(([k, v]) => <div key={k}><dt className="text-[11px] text-text-secondary">{k}</dt><dd className="font-medium text-text-primary break-all">{v}</dd></div>)}
        </dl>
        <p className="text-xs text-text-secondary rounded-xl bg-surface-alt p-3">{d.reward}</p>
        <div><p className="text-xs font-semibold mb-1">Audit trail</p><ul className="space-y-1">{d.timeline.map((e, i) => <li key={i} className="text-xs text-text-secondary">{formatISTDateTime(e.at)} · {e.event.replace(/_/g, ' ').toLowerCase()}{e.byName ? ` · ${e.byName}` : ''}{e.reason ? ` · ${e.reason}` : ''}</li>)}</ul></div>
      </div>}
    </Modal>
  );
};

const AdminMentorReferrals: React.FC = () => {
  const [ov, setOv] = useState<AdminMentorOverview | null>(null);
  const [ovErr, setOvErr] = useState('');
  const [f, setF] = useState({ q: '', status: '', type: '', approval: '', standard: '', from: '', to: '' });
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
    adminMentorApi.list({ ...f, q, page, limit: LIMIT }).then(r => { setRows(r.referrals); setTotal(r.total); }).catch(() => setErr('Could not load mentor referrals.')).finally(() => setLoading(false));
  }, [f.status, f.type, f.approval, f.standard, f.from, f.to, q, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadOv, [loadOv]); useEffect(load, [load]);

  return (
    <div data-testid="admin-mentor-referrals">
      <p className="text-xs text-text-secondary mb-3">Tracking only. Mentors never receive exam credits, money or any other reward from this programme.</p>
      {ovErr && <ErrorBox message={ovErr} onRetry={loadOv} />}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <M id="total" icon={Users} label="Total referrals" value={ov?.metrics.totalReferrals ?? 0} />
        <M id="successful" icon={BadgeCheck} label="Successful" value={ov?.metrics.successful ?? 0} />
        <M id="pending" icon={Hourglass} label="Pending" value={ov?.metrics.pending ?? 0} />
        <M id="mentors" icon={UserCheck} label="Participating mentors" value={ov?.metrics.participatingMentors ?? 0} />
        <M id="students" icon={GraduationCap} label="Referred student accounts" value={ov?.metrics.referredStudents ?? 0} />
        <M id="awaiting" icon={ShieldQuestion} label="Referred teachers awaiting approval" value={ov?.metrics.teachersAwaitingApproval ?? 0} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <input aria-label="Search mentor, code or referred person" placeholder="Mentor / code / referred name or ID" value={f.q} onChange={set('q')} className={`${selectCls} col-span-2`} data-testid="mm-search" />
        <select aria-label="Status" value={f.status} onChange={set('status')} className={selectCls}><option value="">All statuses</option><option value="SUCCESSFUL">Successful</option><option value="PENDING">Pending</option></select>
        <select aria-label="User type" value={f.type} onChange={set('type')} className={selectCls}><option value="">All types</option><option value="student">Student</option><option value="teacher">Teacher</option></select>
        <select aria-label="Approval status" value={f.approval} onChange={set('approval')} className={selectCls}><option value="">Any approval</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select>
        <input aria-label="Standard" placeholder="Standard" inputMode="numeric" value={f.standard} onChange={set('standard')} className={selectCls} />
        <input aria-label="From date" type="date" value={f.from} onChange={set('from')} className={selectCls} /><input aria-label="To date" type="date" value={f.to} onChange={set('to')} className={selectCls} />
      </div>
      {err && <ErrorBox message={err} onRetry={load} />}
      {loading ? <Busy /> : !err && rows.length === 0 ? <p className="text-center text-sm text-text-muted py-12" data-testid="mm-empty">No mentor referrals found.</p> : !err && (
        <div className="overflow-x-auto rounded-card border border-border-subtle">
          <table className="w-full text-sm min-w-[860px]"><thead className="bg-surface-alt text-left text-[11px] uppercase text-text-secondary"><tr>{['Referral ID', 'Mentor', 'Referred', 'Std', 'Registered', 'Status', 'Account', 'Successful on', ''].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} className="border-t border-border-subtle" data-testid="mm-row">
                <td className="px-3 py-2 font-mono text-[11px]">{r.id.slice(-8)}</td>
                <td className="px-3 py-2"><p className="font-medium">{r.mentorName}</p><p className="text-[11px] text-text-muted font-mono">{r.mentorCode}</p></td>
                <td className="px-3 py-2"><p className="font-medium">{r.referredName}</p><p className="text-[11px] text-text-muted">{r.referredRole === 'teacher' ? 'Teacher' : 'Student'}</p></td>
                <td className="px-3 py-2">{std(r.standard)}</td><td className="px-3 py-2 whitespace-nowrap">{formatISTDate(r.registeredAt)}</td>
                <td className="px-3 py-2"><Pill v={r.status} /></td><td className="px-3 py-2"><Pill v={r.accountStatus} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{r.successfulAt ? formatISTDate(r.successfulAt) : '—'}</td>
                <td className="px-3 py-2"><button onClick={() => setOpen(r.id)} className="text-xs font-semibold text-brand-primary" data-testid="mm-view">View</button></td>
              </tr>))}</tbody></table>
        </div>
      )}
      <Pager page={page} limit={LIMIT} total={total} loading={loading} onPage={setPage} />
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
export default AdminMentorReferrals;
