/** Exam-level proctoring settings editor (teacher exam builder, admin Olympiad). The server validates everything again. */
import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { DEFAULT_PROCTORING_POLICY, ProctoringPolicy, SwitchAction, CameraFailureAction } from './types';

interface Props { value: Partial<ProctoringPolicy> | undefined; onChange: (p: ProctoringPolicy) => void; disabled?: boolean }

const Toggle: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }> = ({ label, hint, checked, onChange, disabled, testId }) => (
  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#6C63F2]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    <span className="min-w-0"><span className="text-sm text-text-primary">{label}</span>{hint && <span className="block text-xs text-text-muted">{hint}</span>}</span>
  </label>
);

const NumberField: React.FC<{ label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean; suffix?: string }> = ({ label, value, min, max, step = 1, onChange, disabled, suffix }) => (
  <label className="block min-w-0">
    <span className="text-xs font-semibold text-text-secondary">{label}</span>
    <span className="flex items-center gap-1.5 mt-1">
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        className="w-full min-w-0 bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary" />
      {suffix && <span className="text-xs text-text-muted flex-shrink-0">{suffix}</span>}
    </span>
  </label>
);

const ProctoringSettings: React.FC<Props> = ({ value, onChange, disabled }) => {
  const p: ProctoringPolicy = { ...DEFAULT_PROCTORING_POLICY, ...(value || {}) };
  const set = (patch: Partial<ProctoringPolicy>) => onChange({ ...p, ...patch });
  const off = disabled || !p.enabled;
  return (
    <div className="space-y-3" data-testid="proctoring-settings">
      <Toggle label="Enable online proctoring" hint="Camera, face and phone checks, fullscreen and tab monitoring. Students see these rules before they start." checked={p.enabled} onChange={(v) => set({ enabled: v })} disabled={disabled} testId="proctoring-enabled" />
      <div className={off ? 'opacity-60 pointer-events-none' : ''} aria-disabled={off}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Toggle label="Camera required" checked={p.cameraRequired} onChange={(v) => set({ cameraRequired: v })} disabled={off} />
          <Toggle label="Face visibility monitoring" checked={p.faceMonitoring} onChange={(v) => set({ faceMonitoring: v })} disabled={off || !p.cameraRequired} />
          <Toggle label="Multiple-face detection" checked={p.multiFaceMonitoring} onChange={(v) => set({ multiFaceMonitoring: v })} disabled={off || !p.cameraRequired} />
          <Toggle label="Mobile-phone detection" checked={p.phoneDetection} onChange={(v) => set({ phoneDetection: v })} disabled={off || !p.cameraRequired} />
          <Toggle label="Fullscreen required" checked={p.fullscreenRequired} onChange={(v) => set({ fullscreenRequired: v })} disabled={off} />
          <Toggle label="Desktop / laptop only" hint="Recommended for high-stakes exams - a phone cannot detect itself." checked={p.desktopRequired} onChange={(v) => set({ desktopRequired: v })} disabled={off} />
          <Toggle label="Strict mode" hint="Switching tabs or not returning to fullscreen submits the exam." checked={p.strictMode} onChange={(v) => set({ strictMode: v, switchAction: v ? 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH' : 'WARN_AND_REQUIRE_FULLSCREEN' })} disabled={off} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <NumberField label="Face-absence warnings" value={p.maxFaceAbsenceWarnings} min={1} max={20} onChange={(v) => set({ maxFaceAbsenceWarnings: v })} disabled={off} />
          <NumberField label="Multiple-face warnings" value={p.maxMultiFaceWarnings} min={1} max={10} onChange={(v) => set({ maxMultiFaceWarnings: v })} disabled={off} />
          <NumberField label="Phone warnings (then submit)" value={p.maxPhoneWarnings} min={0} max={10} onChange={(v) => set({ maxPhoneWarnings: v })} disabled={off} />
          <NumberField label="No face for" value={p.faceAbsenceThresholdMs / 1000} min={2} max={30} onChange={(v) => set({ faceAbsenceThresholdMs: v * 1000 })} disabled={off} suffix="s" />
          <NumberField label="Phone confidence" value={p.phoneConfidence} min={0.3} max={0.95} step={0.05} onChange={(v) => set({ phoneConfidence: Math.round(v * 100) / 100 })} disabled={off} />
          <NumberField label="Fullscreen return time" value={p.fullscreenGraceMs / 1000} min={3} max={60} onChange={(v) => set({ fullscreenGraceMs: v * 1000 })} disabled={off} suffix="s" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label className="block min-w-0"><span className="text-xs font-semibold text-text-secondary">Tab switch / fullscreen exit</span>
            <select value={p.switchAction} disabled={off} onChange={(e) => set({ switchAction: e.target.value as SwitchAction })} className="mt-1 w-full bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary">
              <option value="WARN">Warn and record</option>
              <option value="WARN_AND_REQUIRE_FULLSCREEN">Warn and block until back in fullscreen</option>
              <option value="AUTO_SUBMIT_ON_CONFIRMED_SWITCH">Submit automatically (strict)</option>
            </select>
          </label>
          <label className="block min-w-0"><span className="text-xs font-semibold text-text-secondary">If the camera stops</span>
            <select value={p.cameraFailureAction} disabled={off} onChange={(e) => set({ cameraFailureAction: e.target.value as CameraFailureAction })} className="mt-1 w-full bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary">
              <option value="BLOCK_UNTIL_RESTORED">Block the exam until it is reconnected</option>
              <option value="AUTO_SUBMIT_AFTER_GRACE">Submit if not reconnected within {Math.round(p.cameraGraceMs / 1000)} s</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-text-muted mt-3 flex gap-1.5"><ShieldCheck className="w-4 h-4 flex-shrink-0" aria-hidden />Detection runs in the student's browser; no video or photos are uploaded. Changes apply to attempts started after saving.</p>
      </div>
    </div>
  );
};

/** Only the fields the server accepts (no version). */
export const policyPayload = (p: Partial<ProctoringPolicy> | undefined) => {
  if (!p) return undefined;
  const { version, enabledAt, ...rest } = p as ProctoringPolicy & { enabledAt?: string };
  void version; void enabledAt;
  return rest;
};

export default ProctoringSettings;
