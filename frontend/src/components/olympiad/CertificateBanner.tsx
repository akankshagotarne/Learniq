import React from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { OlympiadCertificate, OlympiadResultSummary } from '../../types/olympiad';
import CertificatePair from './CertificatePair';

interface Props {
  examId: string;
  result: OlympiadResultSummary;
  certificate: OlympiadCertificate | null;
  participation: OlympiadCertificate | null;
  releaseAt?: string | null;
  onCertificates: (c: { certificate: OlympiadCertificate | null; participation: OlympiadCertificate | null }) => void;
}

const PASS_MARK = 60;

/**
 * Official outcome on the result page + the two certificates. The outcome is shown honestly (pass or below the pass mark, never
 * altered), but a certificate is NOT tied to it: every student who submitted receives the Result and the Participation certificate.
 */
const CertificateBanner: React.FC<Props> = ({ examId, result, certificate, participation, releaseAt, onCertificates }) => {
  const passed = result.passed ?? result.percentage >= PASS_MARK;
  return (
    <div className="mb-6" data-testid={passed ? 'certificate-pass' : 'certificate-below-pass'}>
      <div className="card-soft rounded-2xl p-4 sm:p-5 mb-4 flex items-start gap-3">
        <span className={`p-2 rounded-xl flex-shrink-0 ${passed ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-surface-alt text-text-secondary'}`}>{passed ? <CheckCircle2 className="w-5 h-5" /> : <Info className="w-5 h-5" />}</span>
        <div className="min-w-0">
          <h2 className="font-heading font-bold text-lg text-text-primary">{passed ? 'Congratulations! 🎉' : 'Thank you for taking part!'}</h2>
          <p className="text-sm text-text-secondary mt-1">
            {passed ? 'You have successfully passed the LearnIQ All India Olympiad Test 2026.' : `Your score is below the ${result.passPercentage ?? PASS_MARK}% pass mark, but your effort counts. Both your certificates are ready below.`}
          </p>
          <dl className="grid grid-cols-3 gap-3 mt-3 text-xs">
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Percentage</dt><dd className="font-bold text-text-primary text-base">{result.percentage}%</dd></div>
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Grade</dt><dd className="font-bold text-text-primary text-base" data-testid="certificate-grade">{certificate?.grade ?? result.grade ?? '—'}</dd></div>
            <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle"><dt className="text-text-muted">Result</dt><dd className={`font-bold text-base ${passed ? 'text-[#16A34A]' : 'text-[#E1447A]'}`}>{passed ? 'PASS' : 'Below pass mark'}</dd></div>
          </dl>
        </div>
      </div>
      <CertificatePair examId={examId} released releaseAt={releaseAt} certificate={certificate} participation={participation} onChange={onCertificates} />
    </div>
  );
};

export default CertificateBanner;
