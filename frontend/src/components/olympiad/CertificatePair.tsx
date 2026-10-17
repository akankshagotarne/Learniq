import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Award, Clock, Loader2, RefreshCw, Users } from 'lucide-react';
import { OlympiadCertificate } from '../../types/olympiad';
import { certificatesApi } from '../../services/certificates';
import { olympiadErrorMessage } from '../../services/olympiad';
import CertificateActions from './CertificateActions';
import { releaseNotice } from './certificateRelease';

interface Props {
  examId: string;
  released: boolean;
  releaseAt?: string | null;
  certificate: OlympiadCertificate | null;
  participation: OlympiadCertificate | null;
  onChange?: (c: { certificate: OlympiadCertificate | null; participation: OlympiadCertificate | null }) => void;
}

/**
 * The two certificates of one submitted exam, as two distinct cards: Result (percentage + grade) and Participation.
 * Every student who submitted gets both, at any score. Before the official release neither is offered (one notice).
 */
const CertificatePair: React.FC<Props> = ({ examId, released, releaseAt, certificate, participation, onChange }) => {
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await certificatesApi.generate(examId);
      onChange?.({ certificate: r.certificate, participation: r.participationCertificate });
      if (r.pending) toast('Your certificates are still being prepared. Please check again shortly.');
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Your certificates could not be prepared yet. Please try again in a moment.'));
    } finally { setBusy(false); }
  };

  const card = (kind: 'RESULT' | 'PARTICIPATION', cert: OlympiadCertificate | null) => {
    const isResult = kind === 'RESULT';
    return (
      <div className="card-soft rounded-2xl p-5 border border-[#FFC24B]/40 flex flex-col" data-testid={isResult ? 'certificate-card-result' : 'certificate-card-participation'}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`p-1.5 rounded-lg ${isResult ? 'bg-[#FFC24B]/15 text-[#D97706]' : 'bg-[#EDE9FE] text-[#6C63F2]'}`}>{isResult ? <Award className="w-4 h-4" /> : <Users className="w-4 h-4" />}</span>
          <h3 className="font-heading font-bold text-sm text-text-primary">{isResult ? 'Result Certificate' : 'Participation Certificate'}</h3>
        </div>
        <p className="text-xs text-text-secondary">{isResult ? 'Your percentage and grade for this examination.' : 'Recognises your participation in the LearnIQ Test & Interview.'}</p>
        {!released ? (
          <p className="mt-4 text-xs text-text-secondary flex items-start gap-1.5" data-testid="certificate-unreleased"><Clock className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#D97706]" /> {releaseNotice(releaseAt)}</p>
        ) : cert ? (
          <>
            <p className="text-xs text-text-secondary mt-3">
              {isResult && <>{cert.percentage}%{cert.grade ? ` · Grade ${cert.grade}` : ''} · </>}Issued {cert.issueDateLabel}
            </p>
            <p className="text-[11px] text-text-muted mt-1">Certificate No. <span className="font-mono font-semibold text-text-secondary">{cert.certificateNumber}</span></p>
            <div className="mt-4"><CertificateActions certificate={cert} compact /></div>
          </>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-xs text-text-secondary" data-testid="certificate-preparing">Your certificate is being prepared.</p>
            <button onClick={() => void refresh()} disabled={busy} className="btn-outline text-xs py-2 px-3 rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check again
            </button>
          </div>
        )}
      </div>
    );
  };

  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="certificate-pair">{card('RESULT', certificate)}{card('PARTICIPATION', participation)}</div>;
};

export default CertificatePair;
