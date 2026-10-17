import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react';
import CertificatePair from '../../components/olympiad/CertificatePair';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import { olympiadApi, olympiadErrorMessage } from '../../services/olympiad';
import { OlympiadExam, isResultReleased } from '../../types/olympiad';

/** Student Dashboard → My Results → Certificates */
const StudentCertificatesPage: React.FC = () => {
  const [exams, setExams] = useState<OlympiadExam[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    olympiadApi.completed()
      .then(list => { if (!cancelled) setExams(list); })
      .catch(err => { if (!cancelled) { setExams([]); toast.error(olympiadErrorMessage(err, 'Could not load your results.')); } });
    return () => { cancelled = true; };
  }, []);


  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
          <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">My Results</p>
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2">
            <Award className="w-6 h-6 text-[#FFC24B]" /> Results &amp; Certificates
          </h1>
          <p className="text-text-secondary text-sm mt-1 mb-6">Every student who completes an Olympiad receives a Result Certificate and a Participation Certificate once the official results are published.</p>

          {exams === null ? (
            <div className="flex items-center justify-center gap-3 py-24 text-sm text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin text-brand-primary" /> Loading…
            </div>
          ) : exams.length === 0 ? (
            <div className="card-soft p-10 text-center text-sm text-text-secondary">
              You have not completed an Olympiad yet. Your results and certificates will appear here.
            </div>
          ) : (
            <>
              <h2 className="font-heading font-bold text-lg text-text-primary mb-3">Certificates</h2>
              <div className="space-y-6 mb-8">
                {exams.map(e => (
                  <section key={e._id} data-testid="certificate-exam">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#EDE9FE] text-[#6C63F2]">Standard {e.standard}</span>
                      <h3 className="font-heading font-bold text-sm text-text-primary">{e.title}</h3>
                    </div>
                    <CertificatePair
                      examId={e._id}
                      released={isResultReleased(e.result)}
                      releaseAt={e.resultsReleaseAt}
                      certificate={e.certificate ?? null}
                      participation={e.participationCertificate ?? null}
                      onChange={c => setExams(list => (list || []).map(x => (x._id === e._id ? { ...x, certificate: c.certificate, participationCertificate: c.participation } : x)))}
                    />
                  </section>
                ))}
              </div>

              <h2 className="font-heading font-bold text-lg text-text-primary mb-3">My Results</h2>
              <div className="card-soft rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead className="bg-surface-alt text-text-muted">
                      <tr className="text-left">
                        <th className="p-3 font-semibold">Examination</th>
                        <th className="p-3 font-semibold">Percentage</th>
                        <th className="p-3 font-semibold">Grade</th>
                        <th className="p-3 font-semibold">Result</th>
                        <th className="p-3 font-semibold">Certificate</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {(exams || []).map(e0 => {
                        const e = { ...e0, result: isResultReleased(e0.result) ? e0.result : null }; // unpublished results show no marks, outcome or grade
                        const passed = e.result?.passed ?? (e.result ? e.result.percentage >= 60 : false);
                        return (
                          <tr key={e._id} className="border-t border-border-subtle">
                            <td className="p-3"><p className="font-semibold text-text-primary">{e.title}</p><p className="text-text-muted">Standard {e.standard}</p></td>
                            <td className="p-3 text-text-primary font-semibold">{e.result?.percentage ?? '—'}%</td>
                            <td className="p-3 text-text-secondary">{e.result?.grade ?? '—'}</td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${passed ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FFE4EC] text-[#E1447A]'}`}>
                                {passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />} {!e.result ? 'Awaiting results' : passed ? 'PASS' : 'Below pass mark'}
                              </span>
                            </td>
                            <td className="p-3 text-text-secondary">
                              {e.certificate ? (e.certificate.status === 'REVOKED' ? 'Revoked' : e.certificate.certificateNumber) : e.result ? 'Being prepared' : 'After results'}
                            </td>
                            <td className="p-3 text-right">
                              <Link to={`/student/olympiad/${e._id}/result`} className="inline-flex items-center gap-0.5 font-semibold text-brand-primary">
                                View result <ChevronRight className="w-3.5 h-3.5" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default StudentCertificatesPage;
