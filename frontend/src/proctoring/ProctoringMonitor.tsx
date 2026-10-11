/**
 * In-exam proctoring overlays: ONE warning dialog at a time, and blocking screens when mandatory monitoring stops
 * (fullscreen left, camera lost). The camera / status card is NOT here: it is the in-flow ProctoringPanel that the exam
 * page places in its own layout slot, so it can never cover the question, the options or the navigation.
 */
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Camera, Maximize2 } from 'lucide-react';
import { ProctoringController } from './useProctoring';
import { ProctoringPolicy } from './types';

const tone = {
  warning: 'border-[#FFC24B]/60 bg-[#FFF8E6] dark:bg-[#3D2C0C] text-[#7A4D00] dark:text-[#FFC24B]',
  danger: 'border-[#E1447A]/50 bg-[#FFE4EC] dark:bg-[#3D1825] text-[#9F1D4F] dark:text-[#FF8FA3]',
  info: 'border-[#6C63F2]/40 bg-[#EEF0FF] dark:bg-[#1E1B4B] text-[#3730A3] dark:text-[#C7D2FE]',
};

const ProctoringMonitor: React.FC<{ ctl: ProctoringController; policy: ProctoringPolicy }> = ({ ctl, policy }) => {
  const { warning, blocking, error } = ctl;
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (warning) okRef.current?.focus(); }, [warning]);

  return (
    <>
      {/* one warning at a time */}
      {warning && !blocking && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/40" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="pw-title" aria-describedby="pw-msg" className={`w-full max-w-md rounded-2xl border p-5 shadow-soft ${tone[warning.tone]}`} data-testid="proctoring-warning">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" aria-hidden />
              <div className="min-w-0">
                <h2 id="pw-title" className="font-heading font-bold text-base">{warning.title}</h2>
                <p id="pw-msg" className="text-sm mt-1 break-words" data-testid="proctoring-warning-text">{warning.message}</p>
                {warning.counter && <p className="text-xs font-semibold mt-2" data-testid="proctoring-warning-counter">{warning.counter}</p>}
              </div>
            </div>
            <button ref={okRef} type="button" onClick={ctl.dismissWarning} className="btn-primary w-full mt-4 py-2.5">I understand</button>
          </div>
        </div>
      )}

      {/* mandatory monitoring stopped: block the exam until it is restored */}
      {blocking && (
        <div className="fixed inset-0 z-[60] bg-page/95 backdrop-blur-sm flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="pb-title" data-testid={`proctoring-block-${blocking}`}>
          <div className="card-soft rounded-2xl border border-border-subtle p-6 max-w-md w-full text-center">
            {blocking === 'fullscreen' ? <Maximize2 className="w-10 h-10 mx-auto text-brand-primary" aria-hidden /> : <Camera className="w-10 h-10 mx-auto text-[#E1447A]" aria-hidden />}
            <h2 id="pb-title" className="font-heading font-bold text-lg text-text-primary mt-3">
              {blocking === 'fullscreen' ? 'Return to fullscreen to continue' : 'Camera disconnected'}
            </h2>
            <p className="text-sm text-text-secondary mt-2">
              {blocking === 'fullscreen'
                ? (policy.switchAction === 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH'
                  ? `Fullscreen mode was exited. Return within ${Math.round(policy.fullscreenGraceMs / 1000)} seconds or the exam will be submitted automatically. Your action has been recorded.`
                  : 'Fullscreen mode was exited. Return to the examination interface immediately. Your action has been recorded.')
                : `Your camera has stopped working. Reconnect your camera${policy.cameraFailureAction === 'AUTO_SUBMIT_AFTER_GRACE' ? ` within ${Math.round(policy.cameraGraceMs / 1000)} seconds` : ''} to continue. The timer keeps running.`}
            </p>
            {error && <p role="alert" className="text-xs text-[#E1447A] mt-3">{error}</p>}
            <button type="button" onClick={blocking === 'fullscreen' ? ctl.returnToFullscreen : ctl.reconnectCamera} className="btn-primary w-full mt-5 py-3" data-testid="proctoring-block-action">
              {blocking === 'fullscreen' ? 'Return to fullscreen' : 'Reconnect camera'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ProctoringMonitor;
