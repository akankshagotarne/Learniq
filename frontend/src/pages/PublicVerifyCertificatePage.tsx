import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { AffiliationLine, LogoLink } from '../components/ui/Logo';
import { certificatesApi } from '../services/certificates';
import { CertificateVerification } from '../types/olympiad';

type State =
  | { kind: 'loading' }
  | { kind: 'found'; data: CertificateVerification }
  | { kind: 'missing' }
  | { kind: 'error' };

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 py-3 border-b border-border-subtle last:border-0">
    <dt className="text-xs text-text-muted">{label}</dt>
    <dd className="text-sm font-semibold text-text-primary sm:text-right break-words">{value}</dd>
  </div>
);

/** Public page opened by the QR code on a certificate. No login; everything comes from the backend. */
const PublicVerifyCertificatePage: React.FC = () => {
  const { certificateNumber = '' } = useParams<{ certificateNumber: string }>();
  const [search] = useSearchParams();
  const tag = search.get('t'); // integrity tag printed in the QR code
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    certificatesApi.verify(certificateNumber, tag)
      .then(data => { if (!cancelled) setState(data ? { kind: 'found', data } : { kind: 'missing' }); })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [certificateNumber, tag]);

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4 relative overflow-hidden transition-colors">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#FFC24B]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="inline-block mb-1"><LogoLink size="lg" /></div>
          <AffiliationLine className="text-xs mb-2" />
          <p className="text-text-secondary text-sm flex items-center justify-center gap-1.5"><ShieldCheck className="w-4 h-4 text-brand-primary" /> Certificate Verification</p>
        </div>

        <div className="card-soft p-6 sm:p-8 rounded-card border border-border-subtle shadow-soft" data-testid="verify-card">
          {state.kind === 'loading' && (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin text-brand-primary" /> Checking certificate…
            </div>
          )}

          {state.kind === 'found' && state.data.valid && (
            <>
              <div className="text-center mb-5">
                <div className="w-14 h-14 rounded-full bg-[#DCFCE7] border border-[#86EFAC] flex items-center justify-center mx-auto mb-3"><CheckCircle2 className="w-7 h-7 text-[#16A34A]" /></div>
                <h1 className="font-heading text-xl font-bold text-[#16A34A]" data-testid="verify-status">✓ Certificate Valid</h1>
              </div>
              <dl>
                <Row label="Certificate No." value={<span className="font-mono">{state.data.certificateNumber}</span>} />
                <Row label="Student" value={state.data.studentName} />
                <Row label="Standard" value={state.data.standardLabel} />
                <Row label="Examination" value={state.data.examName} />
                <Row label="Certificate type" value={state.data.type === 'PARTICIPATION' ? 'Participation' : 'Result'} />
                {state.data.type === 'PARTICIPATION' ? (
                  <>
                    <Row label="Test status" value="Participated" />
                    <Row label="Interview status" value={state.data.interviewStatus ?? '—'} />
                    <Row label="Overall remarks" value={<span className="text-[#16A34A]">Active Participant</span>} />
                  </>
                ) : (
                  <>
                    <Row label="Test score" value={state.data.scoreLabel ?? `${state.data.percentage}%`} />
                    <Row label="Interview status" value={state.data.interviewStatus ?? '—'} />
                    <Row label="Overall result" value={<span className="text-[#16A34A]">{state.data.resultLabel ?? state.data.result}{state.data.grade ? ` / ${state.data.grade}` : ''}</span>} />
                  </>
                )}
                <Row label="Date of Issue" value={state.data.issueDateLabel} />
              </dl>
            </>
          )}

          {state.kind === 'found' && !state.data.valid && state.data.status === 'PENDING' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FEF3C7] border border-[#FCD34D] flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-7 h-7 text-[#D97706]" /></div>
              <h1 className="font-heading text-xl font-bold text-text-primary" data-testid="verify-status">Certificate not issued yet</h1>
              <p className="text-sm text-text-secondary mt-2">{state.data.message || 'Results have not been officially published yet. This certificate cannot be verified until the declaration.'}</p>
              <div className="mt-5 p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Certificate Number</p>
                <p className="font-mono font-semibold text-text-primary">{state.data.certificateNumber}</p>
              </div>
            </div>
          )}

          {state.kind === 'found' && !state.data.valid && state.data.status === 'INVALID' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FFE4EC] border border-[#F9A8C0] flex items-center justify-center mx-auto mb-3"><XCircle className="w-7 h-7 text-[#E1447A]" /></div>
              <h1 className="font-heading text-xl font-bold text-[#E1447A]" data-testid="verify-status">✕ Certificate Invalid</h1>
              <p className="text-sm text-text-secondary mt-2">{state.data.message || 'This certificate could not be verified.'}</p>
            </div>
          )}

          {state.kind === 'found' && !state.data.valid && state.data.status === 'REVOKED' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FFE4EC] border border-[#F9A8C0] flex items-center justify-center mx-auto mb-3"><XCircle className="w-7 h-7 text-[#E1447A]" /></div>
              <h1 className="font-heading text-xl font-bold text-[#E1447A]" data-testid="verify-status">✕ Certificate Revoked</h1>
              <p className="text-sm text-text-secondary mt-2">This certificate is no longer valid.</p>
              <div className="mt-5 p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Certificate Number</p>
                <p className="font-mono font-semibold text-text-primary">{state.data.certificateNumber}</p>
              </div>
            </div>
          )}

          {state.kind === 'missing' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FEF3C7] border border-[#FCD34D] flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-7 h-7 text-[#D97706]" /></div>
              <h1 className="font-heading text-xl font-bold text-text-primary" data-testid="verify-status">Certificate not found</h1>
              <p className="text-sm text-text-secondary mt-2">We could not find a LearnIQ certificate with the number <span className="font-mono font-semibold">{certificateNumber}</span>. Please check the number and try again.</p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#FEF3C7] border border-[#FCD34D] flex items-center justify-center mx-auto mb-3"><AlertTriangle className="w-7 h-7 text-[#D97706]" /></div>
              <h1 className="font-heading text-lg font-bold text-text-primary" data-testid="verify-status">Verification unavailable</h1>
              <p className="text-sm text-text-secondary mt-2">We could not reach the server just now. Please try again in a moment.</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-5">
          LearnIQ Test &amp; Interview · <Link to="/" className="underline hover:text-brand-primary">learniq</Link>
        </p>
      </div>
    </div>
  );
};

export default PublicVerifyCertificatePage;
