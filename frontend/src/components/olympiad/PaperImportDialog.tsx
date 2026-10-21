import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Modal } from '../engineering/ui';
import { olympiadErrorMessage } from '../../services/olympiad';
import { eventsApi, OlympiadEventRow, PaperImportReport } from '../../services/olympiadEvents';

/**
 * Admin > Olympiad events > "Import question papers": a READ-ONLY preview first (what would be inserted / updated / needs review),
 * then an explicit "Import now". Safe to repeat: the server updates in place and never duplicates. Answer keys never reach this screen.
 */
const PaperImportDialog: React.FC<{ event: OlympiadEventRow; onClose: () => void; onDone: () => void }> = ({ event, onClose, onDone }) => {
  const [report, setReport] = useState<PaperImportReport | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [applied, setApplied] = useState(false);
  const [durations, setDurations] = useState(false);

  useEffect(() => {
    eventsApi.paperPreview(event._id).then(setReport).catch(e => setErr(olympiadErrorMessage(e, 'Could not prepare the preview.')));
  }, [event._id]);

  const run = async () => {
    setBusy(true); setErr('');
    try { const r = await eventsApi.paperApply(event._id, durations); setReport(r); setApplied(true); toast.success('Question papers imported.'); onDone(); }
    catch (e) { setErr(olympiadErrorMessage(e, 'The import did not complete. Nothing was changed for a paper with problems.')); } finally { setBusy(false); }
  };
  const s = report?.summary;
  const durationDiffs = report?.rows.filter(r => r.durationInPdf && r.durationNow && r.durationInPdf !== r.durationNow) || [];

  return (
    <Modal title={`Import question papers · ${event.name}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm" data-testid="paper-import">
        {!report && !err && <div className="flex items-center gap-2 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Reading the papers…</div>}
        {err && <div role="alert" className="text-red-600">{err}</div>}
        {report && s && (<>
          <p className="text-xs text-text-muted">{applied ? 'Import finished.' : 'Preview only — nothing has been changed yet.'} Standards 1–10 are imported into this event&apos;s own exams. Re-running updates in place and never duplicates.</p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="paper-import-summary">
            {[['Questions found', s.found], [applied ? 'Inserted' : 'To insert', s.inserted], [applied ? 'Updated' : 'To update', s.updated], ['Unchanged', s.unchanged],
              ['Duplicates avoided', s.duplicatesAvoided], ['Needs review', s.manualReview], ['Completed by LearnIQ', s.completed], ['Images linked', s.imagesAssociated], ['Papers locked', s.locked]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-surface-alt border border-border-subtle p-2"><dt className="text-[11px] text-text-muted">{k}</dt><dd className="font-bold text-text-primary">{String(v)}</dd></div>))}
          </dl>
          <div className="overflow-x-auto"><table className="w-full text-xs min-w-[520px]"><thead><tr className="text-left text-text-muted"><th className="py-1 pr-2">Std</th><th>Found</th><th>Insert</th><th>Update</th><th>Same</th><th>Review</th><th>Note</th></tr></thead>
            <tbody>{report.rows.map(r => (
              <tr key={r.standard} className="border-t border-border-subtle align-top"><td className="py-1 pr-2 font-semibold">{r.standard}</td><td>{r.found}/{r.expected}</td><td>{r.inserted}</td><td>{r.updated}</td><td>{r.unchanged}</td><td>{r.review.length}</td>
                <td>{r.problems.length ? <span className="text-red-600">{r.problems.join(' ')}</span> : r.locked ? <span className="text-amber-800">{r.lockedReason}</span> : !r.examExists && !applied ? 'Exam will be created' : r.warnings.length ? `${r.warnings.length} source note(s)` : ''}</td></tr>))}</tbody></table></div>
          {report.rows.some(r => r.review.length) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-3" role="status" data-testid="paper-import-review">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Needs your decision — the source paper itself is incomplete</p>
              <ul className="list-disc pl-5 mt-1 text-xs">{report.rows.flatMap(r => r.review.map(x => <li key={`${r.standard}-${x.question}`}>Standard {r.standard}, question {x.question}: {x.issue}</li>))}</ul>
              <p className="text-xs mt-1">The event cannot be published while an item is open, unless you publish with an explicit acknowledgement.</p>
            </div>)}
          {report.rows.some(r => r.completions.length) && (
            <div className="rounded-xl border border-sky-300 bg-sky-50 text-sky-900 p-3" data-testid="paper-import-completions">
              <p className="font-semibold">Completed by LearnIQ — not text from the source PDF</p>
              <ul className="list-disc pl-5 mt-1 text-xs">{report.rows.flatMap(r => r.completions.map(x => <li key={`c${r.standard}-${x.question}`}>Standard {r.standard}, question {x.question} ({x.kind === 'authored-completion' ? 'missing options and answer line authored' : 'duplicate wrong option replaced'}): {x.basis}</li>))}</ul>
              <p className="text-xs mt-1">These are recorded corrections, not open items; they do not block publishing.</p>
            </div>)}
          {report.readiness && (
            report.readiness.ready
              ? <p className="flex items-center gap-1.5 text-emerald-700 text-xs" data-testid="paper-readiness"><CheckCircle2 className="w-4 h-4" /> All {report.readiness.standards.length} papers pass the completeness checks ({report.readiness.standards.map(r => `Std ${r.standard}: ${r.count}`).join(', ')}).</p>
              : <div className="rounded-xl border border-red-300 bg-red-50 text-red-800 p-3 text-xs" role="alert" data-testid="paper-readiness"><p className="font-semibold">Not ready to publish</p><ul className="list-disc pl-5">{report.readiness.standards.filter(r => !r.ok).flatMap(r => r.issues.map(x => <li key={`i${r.standard}-${x.question}-${x.issue}`}>Standard {r.standard}{x.question ? `, question ${x.question}` : ''}: {x.issue}</li>))}</ul></div>)}
          {report.rows.some(r => r.warnings.length) && <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Source notes ({s.sourceWarnings})</summary><ul className="list-disc pl-5 mt-1">{report.rows.flatMap(r => r.warnings.map(x => <li key={`w${r.standard}-${x.question}`}>Standard {r.standard}, question {x.question}: {x.issue}</li>))}</ul></details>}
          <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Event settings applied with the import</summary>
            <ul className="list-disc pl-5 mt-1">{report.settings.map(x => <li key={x.field}>{x.field}: {String(x.target)} {x.changed ? '' : '(already set)'}</li>)}</ul></details>
          {durationDiffs.length > 0 && !applied && (
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={durations} onChange={e => setDurations(e.target.checked)} className="mt-0.5" />
              <span>Also use the exam duration printed in the PDFs ({durationDiffs.map(r => `Std ${r.standard}: ${r.durationNow} → ${r.durationInPdf} min`).join(', ')}). Left unchecked, each exam keeps its configured duration.</span></label>)}
          {applied && <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="w-4 h-4" /> Done. Publishing the event is a separate step.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-sm px-4 py-2 min-h-[44px]" onClick={onClose}>{applied ? 'Close' : 'Cancel'}</button>
            {!applied && <button type="button" className="btn-primary text-sm px-5 py-2 min-h-[44px] disabled:opacity-50" disabled={busy || !report.canApply} onClick={run} data-testid="paper-import-apply">{busy ? 'Importing…' : 'Import now'}</button>}
          </div>
        </>)}
      </div>
    </Modal>
  );
};

export default PaperImportDialog;
