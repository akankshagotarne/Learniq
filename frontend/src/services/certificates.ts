import api from './api';
import {
  AdminCertificateList, AdminCertificateQuery, CertificateVerification, OlympiadCertificate,
} from '../types/olympiad';

/**
 * Certificates API client. The browser never sends a percentage, grade, name or certificate number:
 * the server derives every value from the official stored exam result.
 */

/** A PDF request that fails comes back as a Blob — turn its JSON body back into a normal error message. */
const readableError = async (err: any) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { err.response.data = JSON.parse(await data.text()); } catch { /* not JSON — keep the generic message */ }
  }
  return err;
};

const fetchPdf = async (certificateNumber: string, inline: boolean): Promise<Blob> => {
  try {
    const res = await api.get(`/certificates/${encodeURIComponent(certificateNumber)}/download`, {
      params: inline ? { disposition: 'inline' } : undefined,
      responseType: 'blob',
    });
    return res.data as Blob;
  } catch (err) {
    throw await readableError(err);
  }
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** Open the certificate PDF in a new tab. The tab is opened inside the click so pop-up blockers allow it. */
export const viewCertificate = async (certificateNumber: string): Promise<void> => {
  const tab = window.open('', '_blank');
  try {
    const blob = await fetchPdf(certificateNumber, true);
    if (!tab) { saveBlob(blob, `LearnIQ-Certificate-${certificateNumber}.pdf`); return; } // pop-up blocked → download instead
    const url = URL.createObjectURL(blob);
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
};

export const downloadCertificate = async (certificateNumber: string): Promise<void> => {
  const blob = await fetchPdf(certificateNumber, false);
  saveBlob(blob, `LearnIQ-Certificate-${certificateNumber}.pdf`);
};

export const certificatesApi = {
  /** Public — no login. Resolves with the verification result; a 404 means "no such certificate". */
  verify: async (certificateNumber: string): Promise<CertificateVerification | null> => {
    try {
      const { data } = await api.get(`/certificates/verify/${encodeURIComponent(certificateNumber)}`);
      return data as CertificateVerification;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },

  mine: async (): Promise<OlympiadCertificate[]> => (await api.get('/certificates/mine')).data.certificates || [],

  /** Only the exam id is sent; the server checks the stored result and issues (or returns) the certificate. */
  generate: async (examId: string): Promise<OlympiadCertificate> => (await api.post('/certificates/generate', { examId })).data.certificate,

  // admin
  adminList: async (query: AdminCertificateQuery = {}): Promise<AdminCertificateList> => {
    const params: Record<string, string | number> = {};
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== 'all') params[k] = v as string | number; });
    return (await api.get('/certificates/admin/list', { params })).data as AdminCertificateList;
  },
  adminRevoke: async (certificateNumber: string, reason?: string): Promise<OlympiadCertificate> =>
    (await api.post(`/certificates/admin/${encodeURIComponent(certificateNumber)}/revoke`, { reason })).data.certificate,
  adminReinstate: async (certificateNumber: string): Promise<OlympiadCertificate> =>
    (await api.post(`/certificates/admin/${encodeURIComponent(certificateNumber)}/reinstate`)).data.certificate,
};
