import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Award, Ban, Download, Eye, Loader2, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { certificatesApi, downloadCertificate, viewCertificate } from '../../services/certificates';
import { olympiadErrorMessage } from '../../services/olympiad';
import { AdminCertificateList, OlympiadCertificate } from '../../types/olympiad';

interface ExamOption { _id: string; title: string; standard: number }

const GRADES = ['A+', 'A', 'B+', 'B'];
const gradeStyle: Record<string, string> = {
  'A+': 'bg-[#FEF3C7] text-[#B45309]',
  A: 'bg-[#DCFCE7] text-[#16A34A]',
  'B+': 'bg-[#E0F2FE] text-[#0284C7]',
  B: 'bg-[#EDE9FE] text-[#6C63F2]',
};
const selectCls = 'px-3 py-2 bg-surface border border-border-subtle rounded-xl text-xs text-text-primary';

/**
 * Admin → Olympiad → Certificates. Search and filter every issued certificate, open / download it, and revoke or
 * reinstate it (a revoked certificate is never deleted — its QR page then reports it as revoked).
 * `examId` pins the list to one exam (when an exam is selected above); otherwise all exams are listed.
 */
const AdminCertificatesPanel: React.FC<{ examId?: string; exams: ExamOption[] }> = ({ examId, exams }) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [standard, setStandard] = useState('all');
  const [exam, setExam] = useState('all');
  const [grade, setGrade] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminCertificateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<OlympiadCertificate | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // any filter change starts again from page 1
  useEffect(() => { setPage(1); }, [debouncedSearch, standard, exam, grade, status, from, to, examId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    certificatesApi.adminList({
      search: debouncedSearch, standard, exam: examId || exam, grade, status, from, to, page, limit: 20,
    })
      .then(res => { if (!cancelled) setData(res); })
      .catch(err => { if (!cancelled) { setFailed(true); toast.error(olympiadErrorMessage(err, 'Could not load certificates.')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedSearch, standard, exam, grade, status, from, to, page, examId, reload]);

  const run = useCallback(async (key: string, job: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await job();
      if (success) toast.success(success);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Something went wrong. Please try again.'));
    } finally {
      setBusy(null);
    }
  }, []);

  const confirmRevoke = async () => {
    if (!revoking) return;
    const target = revoking;
    await run(`revoke:${target.certificateNumber}`, async () => {
      await certificatesApi.adminRevoke(target.certificateNumber, reason.trim() || undefined);
      setRevoking(null); setReason(''); setReload(k => k + 1);
    }, 'Certificate revoked.');
  };

  const clearFilters = () => { setSearch(''); setStandard('all'); setExam('all'); setGrade('all'); setStatus('all'); setFrom(''); setTo(''); };
  const rows = data?.certificates || [];

  return (
    <div data-testid="admin-certificates">
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1 font-semibold text-text-primary"><Award className="w-4 h-4 text-[#FFC24B]" /> Certificates</span>
        {data && (
          <span>
            <b className="text-text-primary">{data.summary.valid}</b> valid · <b className="text-text-primary">{data.summary.revoked}</b> revoked · <b className="text-text-primary">{data.summary.total}</b> total issued
          </span>
        )}
      </div>

      {/* Search + filters */}
      <div className="card-soft rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search certificate number or student name"
              aria-label="Search certificates"
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border-subtle rounded-xl text-xs text-text-primary"
            />
          </div>
          <select value={standard} onChange={e => setStandard(e.target.value)} aria-label="Filter by standard" className={selectCls}>
            <option value="all">All standards</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={String(n)}>Standard {n}</option>)}
          </select>
          {!examId && (
            <select value={exam} onChange={e => setExam(e.target.value)} aria-label="Filter by exam" className={`${selectCls} max-w-[200px]`}>
              <option value="all">All exams</option>
              {exams.map(x => <option key={x._id} value={x._id}>Std {x.standard} — {x.title}</option>)}
            </select>
          )}
          <select value={grade} onChange={e => setGrade(e.target.value)} aria-label="Filter by grade" className={selectCls}>
            <option value="all">All grades</option>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" className={selectCls}>
            <option value="all">All statuses</option>
            <option value="VALID">Valid</option>
            <option value="REVOKED">Revoked</option>
          </select>
          <label className="flex items-center gap-1 text-[11px] text-text-muted">From
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Issued from" className={selectCls} />
          </label>
          <label className="flex items-center gap-1 text-[11px] text-text-muted">To
            <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Issued to" className={selectCls} />
          </label>
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-semibold py-2 px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary">
            <RotateCcw className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      </div>

      <div className="card-soft rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[980px]">
            <thead className="bg-surface-alt text-text-muted">
              <tr className="text-left">
                <th className="p-3 font-semibold">Certificate No.</th>
                <th className="p-3 font-semibold">Student</th>
                <th className="p-3 font-semibold">Std</th>
                <th className="p-3 font-semibold">Exam</th>
                <th className="p-3 font-semibold">%</th>
                <th className="p-3 font-semibold">Grade</th>
                <th className="p-3 font-semibold">Result</th>
                <th className="p-3 font-semibold">Issued</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr><td colSpan={10} className="p-6 text-center text-text-muted">Loading…</td></tr>
              ) : failed ? (
                <tr><td colSpan={10} className="p-6 text-center text-[#E1447A]">Could not load certificates. <button className="underline font-semibold" onClick={() => setReload(k => k + 1)}>Try again</button></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="p-6 text-center text-text-muted">No certificates match.</td></tr>
              ) : rows.map(c => (
                <tr key={c.certificateNumber} className="border-t border-border-subtle" data-testid="admin-certificate-row">
                  <td className="p-3 font-mono text-text-primary whitespace-nowrap">{c.certificateNumber}</td>
                  <td className="p-3 font-semibold text-text-primary">{c.studentName}</td>
                  <td className="p-3 text-text-secondary whitespace-nowrap">{c.standardLabel}</td>
                  <td className="p-3 text-text-secondary max-w-[180px] truncate" title={c.examName}>{c.examName}</td>
                  <td className="p-3 text-text-primary font-semibold">{c.percentage}%</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${gradeStyle[c.grade] || ''}`}>{c.grade}</span></td>
                  <td className="p-3 text-[#16A34A] font-semibold">{c.result}</td>
                  <td className="p-3 text-text-secondary whitespace-nowrap">{c.issueDateLabel}</td>
                  <td className="p-3">
                    <span
                      title={c.status === 'REVOKED' ? (c.revokeReason || 'Revoked by an admin') : undefined}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.status === 'VALID' ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FFE4EC] text-[#E1447A]'}`}
                    >{c.status === 'VALID' ? 'Valid' : 'Revoked'}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button title="View certificate" aria-label={`View ${c.certificateNumber}`} disabled={busy !== null}
                        onClick={() => void run(`view:${c.certificateNumber}`, () => viewCertificate(c.certificateNumber))}
                        className="p-1.5 rounded-lg border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50">
                        {busy === `view:${c.certificateNumber}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button title="Download certificate" aria-label={`Download ${c.certificateNumber}`} disabled={busy !== null}
                        onClick={() => void run(`dl:${c.certificateNumber}`, () => downloadCertificate(c.certificateNumber))}
                        className="p-1.5 rounded-lg border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50">
                        {busy === `dl:${c.certificateNumber}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </button>
                      {c.status === 'VALID' ? (
                        <button title="Revoke certificate" aria-label={`Revoke ${c.certificateNumber}`} disabled={busy !== null}
                          onClick={() => { setReason(''); setRevoking(c); }}
                          className="p-1.5 rounded-lg border border-[#F9A8C0] bg-[#FFE4EC] text-[#E1447A] disabled:opacity-50">
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button title="Reinstate certificate" aria-label={`Reinstate ${c.certificateNumber}`} disabled={busy !== null}
                          onClick={() => void run(`re:${c.certificateNumber}`, async () => { await certificatesApi.adminReinstate(c.certificateNumber); setReload(k => k + 1); }, 'Certificate reinstated.')}
                          className="p-1.5 rounded-lg border border-[#86EFAC] bg-[#DCFCE7] text-[#16A34A] disabled:opacity-50">
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-border-subtle text-xs text-text-secondary">
            <span>Page {data.page} of {data.pages} · {data.total} certificates</span>
            <div className="flex gap-2">
              <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-50">Previous</button>
              <button disabled={page >= data.pages || loading} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {revoking && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Revoke certificate">
          <div className="card-soft rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <h3 className="font-heading font-bold text-lg text-text-primary">Revoke certificate?</h3>
            <p className="text-sm text-text-secondary mt-1">
              <span className="font-mono font-semibold">{revoking.certificateNumber}</span> ({revoking.studentName}) will show <b>Certificate Revoked</b> when its QR code is scanned, and the student can no longer download it. The record is kept, and you can reinstate it later.
            </p>
            <label className="block text-xs text-text-muted mt-4 mb-1" htmlFor="revoke-reason">Reason (optional, visible to admins only)</label>
            <textarea id="revoke-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={3}
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-xl text-sm text-text-primary" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRevoking(null)} className="px-4 py-2 rounded-xl text-xs font-semibold border border-border-subtle bg-surface-alt text-text-primary">Cancel</button>
              <button onClick={() => void confirmRevoke()} disabled={busy !== null}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#E1447A] text-white disabled:opacity-60 inline-flex items-center gap-1.5">
                {busy?.startsWith('revoke:') && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Revoke certificate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCertificatesPanel;
