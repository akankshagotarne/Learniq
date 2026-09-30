import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Award, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { OlympiadCertificate, OlympiadResultSummary } from '../../types/olympiad';
import { certificatesApi } from '../../services/certificates';
import { olympiadErrorMessage } from '../../services/olympiad';
import CertificateActions from './CertificateActions';

interface Props {
  examId: string;
  result: OlympiadResultSummary;
  certificate: OlympiadCertificate | null;
  onCertificate: (c: OlympiadCertificate) => void;
}

const PASS_MARK = 60;

/**
 * Pass / fail outcome on the result page. Everything shown comes from the server's official result:
 * a PASS shows the certificate buttons, a FAIL shows "Not Available" and never a download button.
 */
const CertificateBanner: React.FC<Props> = ({ examId, result, certificate, onCertificate }) => {
  const [retrying, setRetrying] = useState(false);
  const passed = result.passed ?? result.percentage >= PASS_MARK;

  if (!passed) {
    return (
      <div className="card-soft rounded-2xl p-6 mb-6 border border-[#E1447A]/30" data-testid="certificate-fail">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-xl bg-[#E1447A]/10 text-[#E1447A]"><XCircle className="w-5 h-5" /></span>
          <div className="flex-1">
            <h2 className="font-heading font-bold text-lg text-text-primary">Result: FAIL</h2>
            <p className="text-sm text-text-secondary mt-1">A minimum of {result.passPercentage ?? PASS_MARK}% is required to receive a certificate.</p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-xs">
              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Percentage</dt><dd className="font-bold text-text-primary text-base">{result.percentage}%</dd></div>
              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Result</dt><dd className="font-bold text-[#E1447A] text-base">FAIL</dd></div>
              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Certificate</dt><dd className="font-bold text-text-primary text-base">Not Available</dd></div>
            </dl>
          </div>
        </div>
      </div>
    );
  }

  const retry = async () => {
    setRetrying(true);
    try {
      onCertificate(await certificatesApi.generate(examId));
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Your certificate could not be prepared yet. Please try again in a moment.'));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="card-soft rounded-2xl p-6 mb-6 border border-[#4ADE9A]/40 relative overflow-hidden" data-testid="certificate-pass">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4ADE9A] to-[#FFC24B]" />
      <div className="flex items-start gap-3 mt-1">
        <span className="p-2 rounded-xl bg-[#FFC24B]/15 text-[#D97706]"><Award className="w-5 h-5" /></span>
        <div className="flex-1 min-w-0">
          <h2 className="font-heading font-bold text-xl text-text-primary">Congratulations! 🎉</h2>
          <p className="text-sm text-text-secondary mt-1">You have successfully passed the LearnIQ All India Olympiad Test 2026.</p>

          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-xs">
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Percentage</dt><dd className="font-bold text-text-primary text-base">{result.percentage}%</dd></div>
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Grade</dt><dd className="font-bold text-text-primary text-base" data-testid="certificate-grade">{certificate?.grade ?? result.grade ?? '—'}</dd></div>
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Result</dt><dd className="font-bold text-[#16A34A] text-base flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> PASS</dd></div>
          </dl>

          <div className="mt-5">
            {certificate ? (
              <>
                <p className="text-[11px] text-text-muted mb-2">Certificate No. <span className="font-mono font-semibold text-text-secondary">{certificate.certificateNumber}</span></p>
                <CertificateActions certificate={certificate} />
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-text-secondary">Your certificate is being prepared.</p>
                <button onClick={() => void retry()} disabled={retrying} className="btn-primary text-xs py-2 px-3 rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
                  {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Get my certificate
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CertificateBanner;
