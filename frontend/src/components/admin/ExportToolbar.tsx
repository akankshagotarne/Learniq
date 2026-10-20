import React, { useCallback, useRef, useState } from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

/**
 * Shared "Download PDF" / "Download Excel (.xlsx)" buttons for every admin student list.
 * The file is built by the server from the SAME filters the list uses (`params`), so it holds every matching record - not just the
 * page on screen. While a file is being prepared both buttons are locked, which also stops repeated clicks creating duplicate downloads.
 */
export type ExportFormat = 'pdf' | 'xlsx';
export type ExportParams = Record<string, string | number | boolean | null | undefined>;

const clean = (p: ExportParams) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all'));

/** The error body of a failed blob request is a Blob too - read the server's message out of it. */
const messageOf = async (err: any, fallback: string): Promise<string> => {
  try {
    const data = err?.response?.data;
    if (data instanceof Blob) { const j = JSON.parse(await data.text()); if (j?.message) return String(j.message); }
    else if (data?.message) return String(data.message);
  } catch { /* fall through */ }
  if (err?.code === 'ECONNABORTED') return 'The export took too long. Narrow the filters and try again.';
  if (err?.response?.status === 401) return 'Your session has expired. Please sign in again.';
  if (err?.response?.status === 403) return 'You do not have permission to export this list.';
  if (!err?.response) return 'Network problem - the file was not downloaded. Please check your connection and try again.';
  return fallback;
};

export const downloadExport = async (section: string, format: ExportFormat, params: ExportParams = {}): Promise<{ count: number | null; name: string }> => {
  const res = await api.get(`/admin/exports/${encodeURIComponent(section)}`, { params: { ...clean(params), format }, responseType: 'blob', timeout: 120000 });
  const cd = String(res.headers?.['content-disposition'] || '');
  const name = /filename="?([^";]+)"?/i.exec(cd)?.[1] || `learniq-${section}.${format}`;
  const count = Number(res.headers?.['x-record-count']);
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
  return { count: Number.isFinite(count) ? count : null, name };
};

interface Props {
  section: string;
  params?: ExportParams;
  disabled?: boolean;
  /** shown on the buttons' tooltip, e.g. "Standard 10 students" */
  scopeLabel?: string;
  className?: string;
}

const ExportToolbar: React.FC<Props> = ({ section, params = {}, disabled, scopeLabel, className = '' }) => {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const lock = useRef(false);

  const run = useCallback(async (format: ExportFormat) => {
    if (lock.current) return; // ignore a second click while the first file is still being prepared
    lock.current = true; setBusy(format);
    const id = toast.loading(`Preparing ${format === 'pdf' ? 'PDF' : 'Excel'} file…`);
    try {
      const { count } = await downloadExport(section, format, params);
      toast.success(count === null ? 'Download started.' : `Downloaded ${count} record${count === 1 ? '' : 's'}.`, { id });
    } catch (err) {
      toast.error(await messageOf(err, 'The file could not be created. Please try again.'), { id });
    } finally { lock.current = false; setBusy(null); }
  }, [section, params]);

  const base = 'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 rounded-xl text-xs font-semibold border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label="Download this list" data-testid="export-toolbar" aria-busy={busy !== null}>
      <button type="button" className={base} disabled={disabled || busy !== null} onClick={() => void run('pdf')} data-testid="export-pdf" title={scopeLabel ? `Download PDF - ${scopeLabel}` : 'Download PDF of the current results'}>
        {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileText className="w-3.5 h-3.5 text-[#E1447A]" aria-hidden />} Download PDF
      </button>
      <button type="button" className={base} disabled={disabled || busy !== null} onClick={() => void run('xlsx')} data-testid="export-xlsx" title={scopeLabel ? `Download Excel - ${scopeLabel}` : 'Download Excel of the current results'}>
        {busy === 'xlsx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileSpreadsheet className="w-3.5 h-3.5 text-[#16A34A]" aria-hidden />} Download Excel (.xlsx)
      </button>
      <span className="sr-only" role="status">{busy ? 'Preparing your file' : ''}</span>
    </div>
  );
};

export default ExportToolbar;
