import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Download, X } from 'lucide-react';
import { transactionsApi } from '../../services/studentTransactions';

interface Props { id: string; toastId: string; component: 'EXAM' | 'INTERVIEW' | 'PACKAGE'; title: string; amount: number | null; currency: string }

const Body: React.FC<Props> = ({ id, toastId, component, title, amount, currency }) => {
  const [busy, setBusy] = useState(false);
  const label = component === 'INTERVIEW' ? 'Interview' : component === 'EXAM' ? 'Exam' : 'Exam & Interview';
  const download = async () => {
    setBusy(true);
    try { await transactionsApi.receipt(id); toast.success('Receipt downloaded.'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div role="status" data-testid="payment-success" className="w-[min(92vw,22rem)] rounded-2xl bg-surface text-text-primary shadow-xl border border-border p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Payment Successful!</p>
          <p className="text-sm text-text-secondary">{label} — {title}</p>
          {amount !== null && <p className="text-sm font-semibold mt-0.5">₹{Number(amount).toFixed(2)} {currency !== 'INR' ? currency : ''}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/student/payments" data-testid="success-view-receipt" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">View Receipt</a>
            <button type="button" onClick={download} disabled={busy} data-testid="success-download-receipt" className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"><Download className="w-3.5 h-3.5" />Download Receipt (PDF)</button>
          </div>
        </div>
        <button type="button" onClick={() => toast.dismiss(toastId)} aria-label="Dismiss" className="p-1"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

/** Shown ONLY after the backend verified the payment; the ids come from the server's verify response. */
export const showPaymentSuccess = (res: { transaction?: { id: string; amount: number; currency: string }; component?: string }, title: string, fallback: string) => {
  if (!res?.transaction?.id) { toast.success(fallback, { id: 'oly-verify' }); return; }
  toast.dismiss('oly-verify');
  const comp = res.component === 'INTERVIEW' ? 'INTERVIEW' : res.component === 'EXAM' ? 'EXAM' : 'PACKAGE';
  toast.custom((t) => <Body id={res.transaction!.id} toastId={t.id} component={comp} title={title} amount={res.transaction!.amount} currency={res.transaction!.currency} />, { duration: 15000 });
};
