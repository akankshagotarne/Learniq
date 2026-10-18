# Certificate of Completion — LearnIQ Test & Interview

* **Rendering** — `backend/src/services/certificateCompletionPdf.js` (PDFKit, vector A4 landscape, embedded fonts, real brand
  bolt/wordmark and the four approved signatures in `backend/assets/certificate/completion/`). PDFs are rendered on every
  download from the stored records and are never stored, so a template change reaches every certificate immediately
  (including the 18 Oct 6 PM declaration). The previous artwork renderer (`certificatePdf.js`) is kept untouched but unused.
* **Data** — `services/certificateContext.js` builds the printed values from `Certificate` + `OlympiadAttempt` (score / total)
  + `OlympiadExam` + `TeacherInterview` / `InterviewEvaluation`, cross-checks student / exam / attempt ids and the percentage,
  and fails with 409 on any inconsistency. Interview status is "Completed" only for a COMPLETED interview with a SUBMITTED evaluation.
* **Issue date** — the exam's results-publication instant (or the certificate's own creation instant if later). Stored records
  are not rewritten; exam day, publication and issue date stay separate.
* **QR** — `https://<site>/verify-certificate/<number>?t=<16-hex HMAC of the number>`; site = `CERTIFICATE_VERIFY_BASE_URL`,
  else `CLIENT_URL`, else (non-HTTPS/localhost) `https://www.learniq.study`. Error correction M.
* **Public verify** — `GET /api/certificates/verify/:number[?t=]` (read-only, rate-limited, no-store):
  `VALID` · `REVOKED` · `PENDING` (results not published) · `INVALID` (unknown number, or `code: MISMATCH` for a wrong tag).
  The name is privacy-masked ("Nikhil R.").
* **Tests** — `npm run test:certificates` (QR is decoded from the rendered PDF with jsQR; needs poppler, else those tests skip).
* **Student photo** — `services/certificatePhoto.js` reads the student's CURRENT photo from the existing `ProfilePhoto` collection
  (by the certificate's own `student` id, re-checked against the photo's owner), validates it (real JPEG/PNG signature, size,
  not truncated; WebP is not embeddable by PDFKit) and the renderer crops it "cover"-style into a 3:4 framed portrait at the top
  right; the QR code then sits in a small framed card at the left (reference layout). With no usable photo the certificate is the
  normal photo-free design (QR in the right-hand frame). A missing / unsupported / corrupt / slow photo never blocks a certificate.
  The photo is only added by `buildPdfContext()` (rendering) - never by `buildContext()` (public verification). Because PDFs are
  rendered on every download, a new profile photo shows on the next download; no certificate is regenerated, re-numbered or stored.
* **Founder signature** — one shared asset, `assets/certificate/completion/sig-raut.png` (transparent PNG processed from the
  handwritten original: background removed with a soft alpha ramp, paper specks dropped, 3x upscaled). It is mandatory: if it
  cannot be read the PDF fails (and is retried by the release sweeper) rather than printing a blank signature.
