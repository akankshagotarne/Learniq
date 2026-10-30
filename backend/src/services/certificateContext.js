const { OlympiadExam, OlympiadAttempt } = require('../models/Olympiad');
const { TeacherInterview, InterviewEvaluation } = require('../models/TeacherInterview');
const svc = require('./certificateService');
const { releaseInstant } = require('./resultsRelease');
const { formatScore } = require('./certificateCompletionPdf');

/**
 * Everything printed on / verified for a certificate, assembled on the server from the AUTHORITATIVE records:
 *
 *   Certificate (number, name snapshot, grade, status)  ·  OlympiadAttempt (score / total marks)  ·  OlympiadExam
 *   (publication time)  ·  TeacherInterview + submitted InterviewEvaluation (interview status)
 *
 * The certificate's student / exam / attempt ids are cross-checked against each other; inconsistent data is an explicit
 * error (CertificateDataError) — a wrong certificate is never produced silently. Nothing here writes to the database.
 */
class CertificateDataError extends Error {
  constructor(message, code) { super(message); this.code = code; this.status = 409; }
}

const sameId = (a, b) => String(a && a._id ? a._id : a) === String(b && b._id ? b._id : b);

/**
 * The date of issue is the moment the certificate was actually made available: the exam's official results publication,
 * or — for a certificate created after that (late evaluation) — its own creation instant. The three dates (exam day,
 * publication, issue) stay separate in the data; only the issue date is printed.
 */
const effectiveIssueDate = (cert, exam) => {
  const created = new Date(cert.issueDate);
  const at = releaseInstant(exam);
  const published = at ? new Date(at) : null;
  return published && published > created ? published : created;
};

/** An interview counts as COMPLETED only with a COMPLETED record AND a SUBMITTED teacher evaluation. */
const interviewFor = async (studentId, examId) => {
  const interviews = await TeacherInterview.find({ student: studentId, exam: examId, status: 'COMPLETED' });
  for (const iv of interviews) {
    const ev = await InterviewEvaluation.findOne({ interview: iv._id });
    if (ev && ev.state === 'SUBMITTED' && sameId(ev.student, studentId)) {
      return { completed: true, completedAt: iv.completedAt || ev.submittedAt || null };
    }
  }
  return { completed: false, completedAt: null };
};

/** After an admin cleared the student's exam records the attempt is gone; the frozen figures on the certificate are used instead. */
const frozenFigures = (cert) => {
  const f = cert && cert.recordSnapshot;
  return f && Number.isFinite(Number(f.score)) && Number(f.totalMarks) > 0 && f.score !== null && f.totalMarks !== null ? f : null;
};

/** Interview wording for the participation certificate, from the real interview records (never assumed). */
const participationInterview = async (studentId, examId) => {
  const rows = await TeacherInterview.find({ student: studentId, exam: examId });
  if (rows.some((iv) => iv.status === 'COMPLETED')) return { status: 'Participated', completed: true };
  if (rows.some((iv) => !['CANCELLED', 'FAILED', 'COMPLETED'].includes(iv.status))) return { status: 'Pending', completed: false };
  return { status: 'Not Participated', completed: false };
};

/** Participation certificate: facts only (test taken, interview status) - no marks, grade or pass/fail anywhere. */
const buildParticipationContext = async (cert) => {
  const exam = await OlympiadExam.findById(cert.exam);
  if (!exam) throw new CertificateDataError('The records behind this certificate could not be found.', 'CERTIFICATE_RECORDS_MISSING');
  const attempt = await OlympiadAttempt.findById(cert.attempt);
  // the attempt may be gone after an admin cleared the student's records (the certificate stays valid); if it is there it must match
  if (attempt && (!sameId(attempt.student, cert.student) || !sameId(attempt.exam, cert.exam))) {
    throw new CertificateDataError('This certificate does not match its examination record.', 'CERTIFICATE_DATA_MISMATCH');
  }
  // Exam Only event: there is no interview to report on
  const iv = (await require('./interviewPolicy').enabledForExam(exam)) ? await participationInterview(cert.student, cert.exam) : { status: 'Not Applicable', completed: false };
  const issueDate = effectiveIssueDate(cert, exam);
  return {
    kind: 'PARTICIPATION',
    certificateNumber: cert.certificateNumber, studentName: cert.studentName, examName: cert.examName,
    standard: cert.standard, standardLabel: svc.ordinal(cert.standard),
    testStatus: 'Participated', interview: { completed: iv.completed }, interviewStatus: iv.status, overallRemarks: 'Active Participant',
    issueDate, issueDateLabel: svc.formatIssueDate(issueDate),
    published: require('./resultsRelease').isReleased(exam),
    verifyUrl: svc.verificationUrl(cert),
  };
};

const buildContext = async (cert) => {
  if (svc.typeOf(cert) === svc.TYPES.PARTICIPATION) return buildParticipationContext(cert);
  const frozen = frozenFigures(cert);
  if (frozen) {
    const exam = await OlympiadExam.findById(cert.exam);
    if (!exam) throw new CertificateDataError('The records behind this certificate could not be found.', 'CERTIFICATE_RECORDS_MISSING');
    // the certificate shows what was issued, whether or not the attempt still exists
    const included = await require('./interviewPolicy').enabledForExam(exam);
    return contextFrom(cert, exam, Number(frozen.score), Number(frozen.totalMarks), included ? { completed: Boolean(frozen.interviewCompleted), completedAt: frozen.interviewCompletedAt || null } : { completed: false, completedAt: null, applicable: false });
  }
  const [attempt, exam] = await Promise.all([OlympiadAttempt.findById(cert.attempt), OlympiadExam.findById(cert.exam)]);
  if (!attempt || !exam) throw new CertificateDataError('The records behind this certificate could not be found.', 'CERTIFICATE_RECORDS_MISSING');
  if (!sameId(attempt.student, cert.student) || !sameId(attempt.exam, cert.exam)) {
    throw new CertificateDataError('This certificate does not match its examination record.', 'CERTIFICATE_DATA_MISMATCH');
  }
  if (attempt.status !== 'COMPLETED') throw new CertificateDataError('The examination behind this certificate is not completed.', 'CERTIFICATE_DATA_MISMATCH');

  const score = Number(attempt.score);
  const totalMarks = Number(attempt.totalMarks) > 0 ? Number(attempt.totalMarks) : Number(exam.totalMarks);
  if (!Number.isFinite(score) || !(totalMarks > 0) || score < 0 || score > totalMarks) {
    throw new CertificateDataError('The score for this certificate is not available.', 'CERTIFICATE_SCORE_MISSING');
  }
  // the stored percentage on the certificate must agree with the marks it is printed next to
  if (Math.abs((score / totalMarks) * 100 - Number(cert.percentage)) > 0.51) {
    throw new CertificateDataError('This certificate does not match its score record.', 'CERTIFICATE_DATA_MISMATCH');
  }
  const grade0 = svc.gradeFor(cert.percentage); // null below the pass mark: the certificate then carries no grade either
  if (grade0 !== (cert.grade || null)) throw new CertificateDataError('This certificate does not match the grading rules.', 'CERTIFICATE_DATA_MISMATCH');

  const included = await require('./interviewPolicy').enabledForExam(exam);
  const interview = included ? await interviewFor(cert.student, cert.exam) : { completed: false, completedAt: null, applicable: false };
  return contextFrom(cert, exam, score, totalMarks, interview, true);
};

const contextFrom = (cert, exam, score, totalMarks, interview, checked = false) => {
  if (!checked) {
    if (!Number.isFinite(score) || !(totalMarks > 0) || score < 0 || score > totalMarks || Math.abs((score / totalMarks) * 100 - Number(cert.percentage)) > 0.51) {
      throw new CertificateDataError('This certificate does not match its score record.', 'CERTIFICATE_DATA_MISMATCH');
    }
    const g = svc.gradeFor(cert.percentage);
    if (g !== (cert.grade || null)) throw new CertificateDataError('This certificate does not match the grading rules.', 'CERTIFICATE_DATA_MISMATCH');
  }
  const grade = svc.gradeFor(cert.percentage);
  const issueDate = effectiveIssueDate(cert, exam);
  return {
    certificateNumber: cert.certificateNumber,
    studentName: cert.studentName,
    examName: cert.examName,
    standard: cert.standard,
    standardLabel: svc.ordinal(cert.standard),
    score, totalMarks,
    scoreLabel: `${formatScore(score)}/${formatScore(totalMarks)}`,
    percentage: cert.percentage,
    grade,
    result: grade ? 'PASS' : 'BELOW_PASS',
    resultLabel: grade ? 'Pass' : 'Below pass mark',
    interview,
    interviewStatus: interview.applicable === false ? 'Not applicable' : interview.completed ? 'Completed' : 'Not completed',
    issueDate,
    issueDateLabel: svc.formatIssueDate(issueDate),
    kind: 'RESULT',
    published: require('./resultsRelease').isReleased(exam),
    verifyUrl: svc.verificationUrl(cert),
  };
};

/** "Nikhil Reddy Patil" → "Nikhil R. P." — enough to recognise the holder, not enough to identify a stranger. */
const maskName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return [parts[0], ...parts.slice(1).map((p) => `${[...p][0].toUpperCase()}.`)].join(' ');
};

/**
 * buildContext() plus the student's photo, for RENDERING only. The photo bytes are kept out of buildContext() on purpose: that
 * object also feeds the public verification page, which must never carry a photo.
 */
const buildPdfContext = async (cert, { photoLoader = require('./certificatePhoto').loadStudentPhoto } = {}) => {
  const ctx = await buildContext(cert);
  const photo = await photoLoader(cert.student);
  return photo ? { ...ctx, photo } : ctx;
};

module.exports = { buildContext, buildPdfContext, participationInterview, effectiveIssueDate, interviewFor, maskName, CertificateDataError };
