import api from './api';

export type TxKind = 'PAYMENT' | 'CREDIT';
export type TxStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED';
export interface TxRow {
  id: string; kind: TxKind; type: string; description: string; detail: string;
  component: string; componentLabel: string; amount: number | null; currency: string | null; creditChange: number | null;
  method: string | null; methodLabel: string; status: TxStatus; statusLabel: string; date: string; transactionId: string;
  receiptNumber: string | null; receiptAvailable: boolean; statementAvailable?: boolean;
}
export interface TxSummary {
  money: { totalPaid: number; successfulCount: number; pendingCount: number; failedCount: number; refundedAmount: number; currency: string };
  credits: { earned: number; grantedByAdmin: number; used: number; balance: number };
}
export interface TxList { success: boolean; items: TxRow[]; pagination: { page: number; limit: number; total: number; pages: number }; summary: TxSummary }
export interface TxDetail extends TxRow {
  purpose?: string;
  student?: { name: string; email: string; phone: string; standard: string; studentId: string; accountType: string };
  payment?: { razorpayOrderId: string | null; razorpayPaymentId: string | null; verifiedAt: string | null; paymentMethod: string; failureNote: string | null };
  credit?: { source: string; reason: string | null; relatedTitle: string | null; balanceAfter: number; moneyReceived: number };
}
export interface TxQuery {
  tab: 'all' | 'payments' | 'credits'; type: string; status: string; component: string; method: string; search: string;
  range: '' | 'current_month' | 'previous_month' | 'custom'; from: string; to: string; page: number; limit: number;
}

export const message = (e: any, fallback: string): string => e?.response?.data?.message || fallback;

/** Error bodies of a blob request arrive as a Blob: read the server's message out of it. */
const blobError = async (e: any, fallback: string): Promise<string> => {
  const data = e?.response?.data;
  if (data instanceof Blob) { try { return JSON.parse(await data.text()).message || fallback; } catch { return fallback; } }
  return message(e, fallback);
};

export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
const filenameOf = (cd: string | undefined, fallback: string) => (/filename="?([^";]+)"?/i.exec(cd || '') || [])[1] || fallback;

const params = (q: TxQuery) => ({
  tab: q.tab, page: q.page, limit: q.limit,
  ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}), ...(q.component ? { component: q.component } : {}),
  ...(q.method ? { method: q.method } : {}), ...(q.search ? { search: q.search } : {}),
  ...(q.range === 'custom' ? { ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) } : q.range ? { range: q.range } : {}),
});

export const transactionsApi = {
  list: async (q: TxQuery, signal?: AbortSignal): Promise<TxList> => (await api.get('/student-transactions', { params: params(q), signal })).data,
  detail: async (id: string): Promise<TxDetail> => (await api.get(`/student-transactions/${encodeURIComponent(id)}`)).data.transaction,
  /** Downloads a PDF the server generated from the stored record. Resolves only after the file was actually received. */
  download: async (path: string, init?: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ included?: number; excluded?: number }> => {
    try {
      const r = await api.request({ url: path, method: init?.method || 'GET', data: init?.body, responseType: 'blob' });
      saveBlob(r.data, filenameOf(r.headers['content-disposition'], 'LearnIQ_Receipt.pdf'));
      return { included: Number(r.headers['x-receipts-included']) || undefined, excluded: Number(r.headers['x-receipts-excluded']) || 0 };
    } catch (e: any) { throw new Error(await blobError(e, "We couldn't generate your receipt right now. Your verified payment remains recorded. Please try again.")); }
  },
  receipt: (id: string) => transactionsApi.download(`/student-transactions/${encodeURIComponent(id)}/receipt`),
  statement: (id: string) => transactionsApi.download(`/student-transactions/${encodeURIComponent(id)}/statement`),
  bulk: (ids: string[]) => transactionsApi.download('/student-transactions/receipts', { method: 'POST', body: { ids } }),
};
