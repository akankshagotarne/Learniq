import React, { useState } from 'react';
import { ChevronDown, Eye, Info } from 'lucide-react';
import { DEFAULT_CONFIG, MeetingConfig, VISIBILITY_MODES } from './types';
import AudienceSelector from './AudienceSelector';
import { summarizeAudience, validateAudience } from './audience';

type Patch = Partial<MeetingConfig>;
const who = (label: string, value: string, onChange: (v: any) => void, options: [string, string][], id: string, hint?: string) => (
  <div>
    <label htmlFor={id} className="block text-xs font-semibold text-text-secondary mb-1">{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="input-field !py-2.5 !text-base sm:!text-sm">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
  </div>
);
const Toggle: React.FC<{ id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ id, label, hint, checked, disabled, onChange }) => (
  <label htmlFor={id} className={`flex items-start gap-3 py-2 min-h-[44px] ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-5 h-5 accent-brand-primary flex-shrink-0" />
    <span className="min-w-0"><span className="block text-sm font-medium text-text-primary">{label}</span>{hint && <span className="block text-[11px] text-text-muted">{hint}</span>}</span>
  </label>
);

/** Plain-language summary of what a configuration means for students. */
export const summarize = (c: MeetingConfig): string => {
  const mode = VISIBILITY_MODES.find((m) => m.value === c.mode)?.label || c.mode;
  const video = c.videoPublish === 'everyone' ? 'students may use video' : c.videoPublish === 'host_only' ? 'only the teacher uses video' : 'video for selected students';
  const audio = c.audioPublish === 'everyone' ? (c.studentSelfUnmute ? 'students may unmute themselves' : 'the teacher unmutes students') : c.audioPublish === 'host_only' ? 'only the teacher speaks' : 'selected students may speak';
  const chat = c.chatMode === 'everyone' ? 'chat open' : c.chatMode === 'host_only' ? 'teacher-only chat' : 'chat off';
  return `${mode} · ${video} · ${audio} · ${chat} · ${c.requireApproval ? 'teacher approves entry' : 'open entry'}`;
};

/** The Meeting Setup / Participant Visibility form. Basic choices first, "Advanced" is expandable. Used when creating a class and live in the class. */
export const MeetingSettingsForm: React.FC<{ value: MeetingConfig; onChange: (patch: Patch) => void; disabled?: boolean; idPrefix?: string; showAudience?: boolean }> = ({ value, onChange, disabled, idPrefix = 'ms', showAudience = true }) => {
  const [advanced, setAdvanced] = useState(false);
  const cfg = { ...DEFAULT_CONFIG, ...value };
  const modeDefinesVisibility = cfg.mode === 'everyone' || cfg.mode === 'host_only';
  return (
    <div className="space-y-4" data-testid="meeting-settings">
      {showAudience ? (
        <AudienceSelector value={cfg.audience} onChange={(audience) => onChange({ audience })} disabled={disabled} idPrefix={`${idPrefix}-aud`} />
      ) : (
        <p className="text-xs text-text-secondary bg-surface-alt border border-border-subtle rounded-xl px-3 py-2" data-testid="audience-readonly"><span className="font-semibold text-text-primary">Who can join:</span> {summarizeAudience(cfg.audience).students}; {summarizeAudience(cfg.audience).teachers}. Only the host edits this.</p>
      )}
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="flex items-center gap-1.5 text-sm font-semibold text-text-primary mb-1"><Eye className="w-4 h-4 text-brand-primary" />Who can see whom</legend>
        {VISIBILITY_MODES.map((m) => {
          const on = cfg.mode === m.value;
          return (
            <label key={m.value} className={`flex items-start gap-3 rounded-2xl border-2 px-3 py-2.5 min-h-[52px] cursor-pointer transition-colors ${on ? 'border-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface hover:border-brand-primary/40'}`}>
              <input type="radio" name={`${idPrefix}-mode`} value={m.value} checked={on} onChange={() => onChange({ mode: m.value })} className="mt-1 w-5 h-5 accent-brand-primary flex-shrink-0" />
              <span className="min-w-0"><span className="block text-sm font-semibold text-text-primary">{m.label}</span><span className="block text-xs text-text-secondary">{m.hint}</span></span>
            </label>
          );
        })}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {who('Layout', cfg.layout, (v) => onChange({ layout: v }), [['speaker', 'Speaker (teacher large)'], ['gallery', 'Gallery (equal tiles)']], `${idPrefix}-layout`)}
        {who('Chat', cfg.chatMode, (v) => onChange({ chatMode: v }), [['everyone', 'Everyone can chat'], ['host_only', 'Only the teacher'], ['off', 'Chat off']], `${idPrefix}-chat`)}
      </div>
      <Toggle id={`${idPrefix}-approval`} label="Teacher approves each student" hint="Students wait in a lobby until you let them in." checked={cfg.requireApproval} disabled={disabled} onChange={(v) => onChange({ requireApproval: v })} />

      <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex items-center gap-1.5 text-sm font-semibold text-brand-primary min-h-[44px]">
        <ChevronDown className={`w-4 h-4 transition-transform ${advanced ? 'rotate-180' : ''}`} />Advanced settings
      </button>
      {advanced && (
        <div className="space-y-3 rounded-2xl border border-border-subtle p-3 bg-surface-alt" data-testid="advanced-settings">
          <div className="grid gap-3 sm:grid-cols-2">
            {who('Who can turn on video', cfg.videoPublish, (v) => onChange({ videoPublish: v }), [['everyone', 'Everyone'], ['host_and_selected', 'Teacher + selected students'], ['host_only', 'Only the teacher']], `${idPrefix}-video`)}
            {who('Who can speak', cfg.audioPublish, (v) => onChange({ audioPublish: v }), [['everyone', 'Everyone'], ['host_and_selected', 'Teacher + selected students'], ['host_only', 'Only the teacher']], `${idPrefix}-audio`)}
            {who('Who can share the screen', cfg.screenShare, (v) => onChange({ screenShare: v }), [['host_only', 'Only the teacher'], ['host_and_presenters', 'Teacher + presenters I choose']], `${idPrefix}-screen`)}
          </div>
          <Toggle id={`${idPrefix}-unmute`} label="Students can unmute themselves" hint="Off: students stay muted until you allow them." checked={cfg.studentSelfUnmute} disabled={disabled} onChange={(v) => onChange({ studentSelfUnmute: v })} />
          <Toggle id={`${idPrefix}-select`} label="Teacher can select students to show" hint="Needed for “Host and selected students”." checked={cfg.hostCanSelectStudents} disabled={disabled} onChange={(v) => onChange({ hostCanSelectStudents: v })} />
          <Toggle id={`${idPrefix}-see`} label="Students can see each other" hint={modeDefinesVisibility ? 'Set by the visibility option above.' : 'Applies to Presentation focus and Spotlight.'} checked={cfg.studentsSeeEachOther} disabled={disabled || modeDefinesVisibility} onChange={(v) => onChange({ studentsSeeEachOther: v })} />
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-text-secondary bg-brand-primary/5 border border-brand-primary/20 rounded-xl px-3 py-2" data-testid="settings-summary"><Info className="w-4 h-4 text-brand-primary flex-shrink-0 mt-0.5" /><span>{summarize(cfg)}</span></p>
    </div>
  );
};

/** In-meeting settings (host): edit a draft, apply it in one step; a conflicting change made by someone else is shown, never overwritten silently. */
export const MeetingSettingsPanel: React.FC<{
  config: MeetingConfig; onApply: (patch: Partial<MeetingConfig>, expectedVersion: number) => Promise<{ ok: boolean; code?: string; message?: string; config?: MeetingConfig }>;
  onRevert: () => Promise<{ ok: boolean; message?: string }>; onClose: () => void; showAudience?: boolean;
}> = ({ config, onApply, onRevert, onClose, showAudience = true }) => {
  const [draft, setDraft] = useState<MeetingConfig>(config);
  const [base, setBase] = useState(config.configVersion);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const working = React.useRef(false); // our own apply / revert in flight: its broadcast is not "someone else's change"
  const baseRef = React.useRef(base); baseRef.current = base;
  const liveCfg = React.useRef(config); liveCfg.current = config;
  // Someone else changed the settings while this panel is open? Judged a moment later from the LATEST values, so our own apply (whose
  // broadcast and acknowledgement can arrive in either order) is never mistaken for another person's change.
  React.useEffect(() => {
    if (config.configVersion === base) return undefined;
    const t = window.setTimeout(() => {
      if (working.current || liveCfg.current.configVersion === baseRef.current) return;
      setMsg({ text: 'These settings were just changed by someone else. The latest values are shown - review them and apply again.', bad: true });
      setDraft(liveCfg.current); setBase(liveCfg.current.configVersion);
    }, 400);
    return () => window.clearTimeout(t);
  }, [config, base]);
  const apply = async () => {
    const problem = showAudience ? validateAudience(draft.audience) : null;
    if (problem) { setMsg({ text: problem, bad: true }); return; }
    setBusy(true); setMsg(null); working.current = true;
    const { info, selectedUserIds, presenterUserIds, spotlightUserId, locked, configVersion, audienceLegacy, audienceSummary, ...patch } = draft as any;
    if (!showAudience) delete patch.audience;
    const r = await onApply(patch, base);
    working.current = false; setBusy(false);
    if (r.ok) { if (r.config) { setDraft(r.config); setBase(r.config.configVersion); } setMsg({ text: 'Settings applied for everyone in the class.', bad: false }); }
    else { setMsg({ text: r.message || 'The settings were not changed.', bad: true }); if (r.config) { setDraft(r.config); setBase(r.config.configVersion); } }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" data-testid="settings-panel">
      <div role="dialog" aria-modal="true" aria-label="Meeting settings" className="w-full sm:max-w-xl max-h-[100dvh] sm:max-h-[92dvh] overflow-y-auto bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border-subtle pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 bg-surface border-b border-border-subtle"><h2 className="font-heading font-bold text-text-primary">Meeting settings</h2><button aria-label="Close settings" onClick={onClose} className="w-11 h-11 -mr-2 inline-flex items-center justify-center text-text-muted">✕</button></div>
        <div className="p-4 space-y-4">
          <MeetingSettingsForm value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} disabled={busy} idPrefix="live" showAudience={showAudience} />
          {msg && <p role={msg.bad ? 'alert' : 'status'} className={`text-xs rounded-xl px-3 py-2 border ${msg.bad ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>{msg.text}</p>}
          <div className="flex gap-2">
            <button onClick={apply} disabled={busy || (showAudience && !!validateAudience(draft.audience))} className="btn-primary flex-1 min-h-[48px]" data-testid="settings-apply">{busy ? 'Applying…' : 'Apply to class'}</button>
            <button onClick={async () => { setBusy(true); working.current = true; const r: any = await onRevert(); working.current = false; setBusy(false); if (r.ok && r.config) { setDraft(r.config); setBase(r.config.configVersion); } setMsg(r.ok ? { text: 'Went back to the previous layout.', bad: false } : { text: r.message || 'Nothing to go back to.', bad: true }); }} disabled={busy} className="btn-outline min-h-[48px]">Previous layout</button>
          </div>
        </div>
      </div>
    </div>
  );
};
