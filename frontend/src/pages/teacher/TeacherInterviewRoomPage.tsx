import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Loader2, PhoneOff, ShieldCheck, ShieldX, Undo2, UserRound } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import InterviewRoomView from '../../components/interview/InterviewRoomView';
import InterviewEvaluationForm from '../../components/interview/InterviewEvaluationForm';
import { staffStatusLabel, statusTone } from '../../components/interview/interviewLabels';
import { interviewApi, interviewErrorMessage, ROOM_STATUSES } from '../../services/interview';
import { useInterviewLive } from '../../hooks/useInterviewLive';

type Detail = Awaited<ReturnType<typeof interviewApi.detail>>;

/** Teacher side of ONE interview: wait for the student, approve them explicitly, run the call, complete it. */
const TeacherInterviewRoomPage: React.FC = () => {
  const { interviewId = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = useCallback(async () => {
    try { setData(await interviewApi.detail(interviewId)); setLoadError(null); }
    catch (e) { setLoadError(interviewErrorMessage(e, 'Could not load this interview.')); }
  }, [interviewId]);
  useEffect(() => { load(); }, [load]);
  useInterviewLive(load, { pollMs: 6000 });

  const status = data?.interview.status;
  const mine = data?.role === 'teacher';
  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); }
    catch (e) { toast.error(interviewErrorMessage(e)); await load(); }
    finally { setBusy(false); }
  };
  const inRoom = mine && !!status && ROOM_STATUSES.includes(status);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
          <Link to="/teacher/interview" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand-primary mb-4 min-h-[44px]"><ArrowLeft className="w-4 h-4" /> Back to Interview</Link>

          {loadError && !data && <div className="card-soft p-5 rounded-2xl" role="alert"><p className="text-sm text-text-secondary">{loadError}</p><button type="button" onClick={load} className="btn-primary mt-3 min-h-[44px] px-4 rounded-xl text-sm font-bold">Try again</button></div>}
          {!data && !loadError && <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

          {data && (
            <div className="space-y-5">
              <div className="card-soft p-5 rounded-2xl border border-border-subtle">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="font-heading font-bold text-xl text-text-primary flex items-center gap-2"><UserRound className="w-5 h-5 text-brand-primary" aria-hidden="true" /> {data.student?.name || 'Student'}</h1>
                    <p className="text-sm text-text-secondary mt-1">{data.exam?.title}{data.student?.standard ? ` · Standard ${data.student.standard}` : ''}</p>
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusTone(status)}`} data-testid="interview-status">{staffStatusLabel(status)}</span>
                </div>

                {!mine && <p className="text-sm text-text-secondary mt-3">This interview belongs to {data.teacher?.name || 'another teacher'}. You can only view its status.</p>}

                {mine && status === 'ASSIGNED' && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-text-secondary">Waiting for the student to join. They will need your approval to enter.</p>
                    <button type="button" disabled={busy} onClick={() => run(() => interviewApi.release(interviewId), 'Student released back to the queue.')} className="min-h-[44px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center gap-2"><Undo2 className="w-4 h-4" /> Release student</button>
                  </div>
                )}
                {mine && status === 'WAITING_FOR_APPROVAL' && (
                  <div className="mt-4 p-4 rounded-xl bg-[#FFC24B]/10 border border-[#FFC24B]/40" data-testid="approval-box">
                    <p className="text-sm font-medium text-text-primary">{data.student?.name} is waiting to enter the interview.</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button type="button" disabled={busy} onClick={() => run(() => interviewApi.approve(interviewId))} className="btn-primary min-h-[44px] px-5 rounded-xl text-sm font-bold inline-flex items-center gap-2" data-testid="approve"><ShieldCheck className="w-4 h-4" /> Approve &amp; start</button>
                      <button type="button" disabled={busy} onClick={() => run(() => interviewApi.rejectJoin(interviewId), 'Request declined.')} className="min-h-[44px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center gap-2" data-testid="reject"><ShieldX className="w-4 h-4" /> Not now</button>
                    </div>
                  </div>
                )}
                {status === 'COMPLETED' && <p className="mt-3 text-sm text-[#15803D] dark:text-[#4ADE9A] flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Interview completed.</p>}
                {(status === 'CANCELLED' || status === 'FAILED') && <p className="mt-3 text-sm text-text-secondary">This interview is {status === 'CANCELLED' ? 'cancelled' : 'closed'}.</p>}
              </div>

              {mine && (status === 'EVALUATION_PENDING' || status === 'COMPLETED') && (
                <InterviewEvaluationForm
                  key={status} interviewId={interviewId} studentName={data.student?.name || 'Student'} standard={data.student?.standard}
                  teacherName={data.teacher?.name} statusLabel={staffStatusLabel(status)} onSubmitted={load}
                />
              )}

              {inRoom && (
                <>
                  <InterviewRoomView
                    interviewId={interviewId} role="teacher" peerLabel={data.student?.name || 'Student'} onEnded={load}
                    actions={<button type="button" onClick={() => setConfirmEnd(true)} className="min-h-[44px] px-4 rounded-xl bg-[#E1447A] text-white text-sm font-bold inline-flex items-center gap-2" data-testid="end-interview"><PhoneOff className="w-4 h-4" /> End Interview &amp; Evaluate</button>}
                  />
                  {confirmEnd && (
                    <div className="card-soft p-4 rounded-2xl border border-[#E1447A]/30" role="dialog" aria-label="End interview and evaluate">
                      <p className="text-sm font-medium text-text-primary">End the video call and open the evaluation form?</p>
                      <p className="text-xs text-text-muted mt-1">The call closes for both of you. The interview is completed only after you submit the evaluation.</p>
                      <div className="mt-3 flex flex-col-reverse sm:flex-row gap-3">
                        <button type="button" onClick={() => setConfirmEnd(false)} className="min-h-[48px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold">Keep going</button>
                        <button type="button" disabled={busy} onClick={() => run(async () => { await interviewApi.end(interviewId); setConfirmEnd(false); })} className="btn-primary min-h-[48px] px-5 rounded-xl text-sm font-bold" data-testid="confirm-end">End &amp; Evaluate</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TeacherInterviewRoomPage;
