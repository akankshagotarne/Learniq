/**
 * Which on-device models an exam's proctoring policy actually needs. Pure (no imports) so it is unit-tested.
 *
 *   face model   FaceLandmarker  - needed only for face-visibility and/or multiple-face monitoring
 *   phone model  ObjectDetector  - needed only for mobile-phone detection
 *   wasm runtime - needed whenever either model is
 *
 * A policy with none of those three features needs no download at all (camera, fullscreen and tab monitoring still apply).
 * Nothing here relaxes a rule: a feature that is switched on always gets its model, and the exam cannot start without it.
 */
export interface PlanPolicy {
  cameraRequired: boolean;
  faceMonitoring: boolean;
  multiFaceMonitoring: boolean;
  phoneDetection: boolean;
}

export interface MonitoringPlan {
  face: boolean;
  phone: boolean;
  /** true when any model has to be downloaded and started before the exam can begin */
  detector: boolean;
  /** approximate decoded size of what will be downloaded the first time, in MB (for the screen label only) */
  approxMb: number;
}

/** Measured decoded sizes of the files in MB (wasm: SIMD build 11.76, no-SIMD 10.96; face_landmarker.task 3.76; efficientdet_lite0.tflite 4.60). */
export const ASSET_MB = { wasm: 11.8, face: 3.8, phone: 4.6 } as const;

export const monitoringPlan = (p: PlanPolicy): MonitoringPlan => {
  const face = p.cameraRequired && (p.faceMonitoring || p.multiFaceMonitoring);
  const phone = p.cameraRequired && p.phoneDetection;
  const detector = face || phone;
  const approxMb = detector ? Math.round(ASSET_MB.wasm + (face ? ASSET_MB.face : 0) + (phone ? ASSET_MB.phone : 0)) : 0;
  return { face, phone, detector, approxMb };
};
