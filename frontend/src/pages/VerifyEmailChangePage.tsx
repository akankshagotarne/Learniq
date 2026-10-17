import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { apiError, verifyEmailChange } from '../services/profileService';

/** Opened from the link in the confirmation e-mail. The token is the proof; the e-mail changes only here. */
const VerifyEmailChangePage: React.FC = () => {
  const { token = '' } = useParams();
  const [state, setState] = useState<{ phase: 'working' | 'ok' | 'fail'; message: string }>({ phase: 'working', message: '' });
  useEffect(() => {
    let cancelled = false;
    verifyEmailChange(token)
      .then((r) => { if (!cancelled) setState({ phase: 'ok', message: r.message }); })
      .catch((e) => { if (!cancelled) setState({ phase: 'fail', message: apiError(e, 'This link could not be verified.').message }); });
    return () => { cancelled = true; };
  }, [token]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="card-soft w-full max-w-md p-8 text-center" role="status">
        {state.phase === 'working' && <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-brand-primary" aria-hidden="true" />}
        {state.phase === 'ok' && <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[#16A34A]" aria-hidden="true" />}
        {state.phase === 'fail' && <XCircle className="mx-auto mb-3 h-10 w-10 text-[#E1447A]" aria-hidden="true" />}
        <h1 className="font-heading text-xl font-bold text-text-primary">{state.phase === 'working' ? 'Confirming your e-mail…' : state.phase === 'ok' ? 'E-mail updated' : 'Could not confirm'}</h1>
        {state.message && <p className="mt-2 text-sm text-text-secondary">{state.message}</p>}
        {state.phase !== 'working' && <Link to="/login" className="mt-6 inline-block rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-white">Go to login</Link>}
      </div>
    </div>
  );
};
export default VerifyEmailChangePage;
