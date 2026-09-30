import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Eye, Loader2, ShieldX } from 'lucide-react';
import { OlympiadCertificate } from '../../types/olympiad';
import { downloadCertificate, viewCertificate } from '../../services/certificates';
import { olympiadErrorMessage } from '../../services/olympiad';

/** View / Download buttons for one certificate. A revoked certificate offers neither (the server refuses it as well). */
const CertificateActions: React.FC<{ certificate: OlympiadCertificate; compact?: boolean }> = ({ certificate, compact = false }) => {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null);

  if (certificate.status === 'REVOKED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-[#FFE4EC] text-[#E1447A]">
        <ShieldX className="w-4 h-4" /> Certificate revoked
      </span>
    );
  }

  const run = async (kind: 'view' | 'download') => {
    setBusy(kind);
    try {
      if (kind === 'view') await viewCertificate(certificate.certificateNumber);
      else await downloadCertificate(certificate.certificateNumber);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Could not open the certificate. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const pad = compact ? 'py-2 px-3 text-xs' : 'py-2.5 px-4 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => void run('view')}
        disabled={busy !== null}
        className={`btn-primary ${pad} rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60`}
      >
        {busy === 'view' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} View Certificate
      </button>
      <button
        onClick={() => void run('download')}
        disabled={busy !== null}
        className={`btn-outline ${pad} rounded-xl font-bold inline-flex items-center gap-1.5 disabled:opacity-60`}
      >
        {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download Certificate
      </button>
    </div>
  );
};

export default CertificateActions;
