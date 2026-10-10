# Proctoring models (served from this site - no third-party request at exam time)

| File | Used for | Origin / licence |
|---|---|---|
| `face_landmarker.task` | face presence + face count (`FaceLandmarker`, numFaces 4) | Google MediaPipe Face Landmarker model, Apache-2.0 |
| `efficientdet_lite0.tflite` | phone detection: COCO class **"cell phone"** only (`ObjectDetector` with a category allow-list) | Google MediaPipe EfficientDet-Lite0 (int8) object detector, Apache-2.0 |

Runtime: `@mediapipe/tasks-vision` (Apache-2.0); its WebAssembly is bundled by Vite from `node_modules`.

These copies were taken from an npm package because Google's model storage was not reachable from the build environment.
Before relying on them in production, replace them with the official downloads and check the hashes match:

- https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite

SHA-256 of the files committed here:
- face_landmarker.task      64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
- efficientdet_lite0.tflite 0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb
