import React, { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Clock, Loader2, UserCheck, Video, XCircle } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import InterviewRoomView from '../../components/interview/InterviewRoomView';
import { studentStatusHint, studentStatusLabel, statusTone } from '../../components/interview/interviewLabels';
import { interviewApi, interviewErrorMessage, ROOM_STATUSES } from '../../services/interview';
import { useInterviewLive } from '../../hooks/useInterviewLive';
import InterviewCompletionScreen from '../../components/interview/InterviewCompletionScreen';

type Detail = Awaited<ReturnType<typeof interviewApi.detail>>;

/** Student waiting room + live interview. Every state shown here comes from the backend; the page never decides eligibility. */
const StudentInterviewPage: React.FC = () => {
  const { interviewId = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ released: boolean; announcePassed: boolean } | null>(null);

  const load = useCallback(async () => {
    try { setData(await interviewApi.detail(interviewId)); setLoadError(null); }
    catch (e) { setLoadError(interviewErrorMessage(e, 'Could not load this interview.')); }
  }, [interviewId]);
  React.useEffect(() => { load(); }, [load]);
  useInterviewLive(load, { pollMs: 6000 });

  const status = data?.interview.status;
  React.useEffect(() => { // a finished interview: ask the server whether the results are out (never decided in the browser)
    if (status !== 'COMPLETED') return;
    interviewApi.results().then((r) => setOutcome({ released: r.released, announcePassed: r.announcePassed })).catch(() => setOutcome({ released: false, announcePassed: false }));
  }, [status]);
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); }
    catch (e) { toast.error(interviewErrorMessage(e)); await load(); }
    finally { setBusy(false); }
  };

  const open = status && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(status);
  const inRoom = !!status && ROOM_STATUSES.includes(status);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
          <Link to="/student/exams" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand-primary mb-4 min-h-[44px]">
            <ArrowLeft className="w-4 h-4" /> Back to Exams
          </Link>

          {loadError && !data && (
            <div className="card-soft p-5 rounded-2xl" role="alert"><p className="text-sm text-text-secondary">{loadError}</p>
              <button type="button" onClick={load} className="btn-primary mt-3 min-h-[44px] px-4 rounded-xl text-sm font-bold">Try again</button></div>
          )}
          {!data && !loadError && <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading your interview…</div>}

          {data && (
            <div className="space-y-5">
              <div>
                <h1 className="font-heading font-bold text-2xl text-text-primary">Teacher Interview</h1>
                <p className="text-text-secondary text-sm mt-1">{data.exam?.title}</p>
              </div>

              <div className="card-soft p-5 rounded-2xl border border-border-subtle" data-testid="interview-status-card">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusTone(status)}`} data-testid="interview-status">{studentStatusLabel(status)}</span>
                  {data.teacher && open && <span className="text-xs text-text-muted flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> {data.teacher.name}</span>}
                </div>
                <p className="text-sm text-text-secondary mt-3" role="status" aria-live="polite" data-testid="interview-hint">
                  {status === 'CANCELLED' && data.interview.endReason === 'TEACHER_CLOSED_BEFORE_START'
                    ? 'Your teacher closed this session before you joined. You can request the interview again from the Exams page.'
                    : studentStatusHint(status)}
                </p>

                {status === 'ASSIGNED' && (
                  <button type="button" disabled={busy} onClick={() => act(() => interviewApi.joinRequest(interviewId))}
                    className="btn-primary mt-4 min-h-[44px] px-5 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-70" data-testid="interview-join">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} Join Interview
                  </button>
                )}
                {(status === 'REQUESTED' || status === 'ASSIGNED' || status === 'WAITING_FOR_APPROVAL') && (
                  <button type="button" disabled={busy} onClick={() => act(() => interviewApi.cancel(interviewId), 'Interview request cancelled.')}
                    className="mt-4 ml-0 sm:ml-3 min-h-[44px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold text-text-primary inline-flex items-center gap-2" data-testid="interview-cancel">
                    <XCircle className="w-4 h-4" /> Cancel request
                  </button>
                )}
                {(status === 'REQUESTED' || status === 'WAITING_FOR_APPROVAL') && <p className="text-[11px] text-text-muted mt-3 flex items-center gap-1"><Clock className="w-3 h-3" /> This page updates by itself.</p>}
                {status === 'COMPLETED' && outcome?.released && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-[#15803D] dark:text-[#4ADE9A] flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Interview completed.</p>
                    <Link to="/student/interview-results" className="btn-primary min-h-[44px] px-5 rounded-xl text-sm font-bold inline-flex items-center gap-2" data-testid="view-results">View Interview Results</Link>
                  </div>
                )}
                {(status === 'CANCELLED' || status === 'FAILED') && (
                  <Link to="/student/exams" className="btn-primary mt-4 min-h-[44px] px-5 rounded-xl text-sm font-bold inline-flex items-center gap-2" data-testid="request-again">Request Interview Again</Link>
                )}
              </div>

              {status === 'COMPLETED' && outcome && !outcome.released && <InterviewCompletionScreen announcePassed={outcome.announcePassed} />}

              {inRoom && (
                <InterviewRoomView interviewId={interviewId} role="student" peerLabel={data.teacher?.name || 'Teacher'} onEnded={load} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default StudentInterviewPage;
