// Server-side decision: may THIS user receive the video / file URLs of a lecture?
//   free lecture                      -> everyone (public preview)
//   admin                             -> yes
//   the teacher who owns the lecture  -> yes
//   a user enrolled in the course     -> yes (enrollment is only created by a verified payment or a free enroll)
//   everyone else (incl. logged out)  -> no: the URLs are REMOVED from the response, the frontend cannot reveal them.
const { Enrollment } = require('../models/index');
const { signMediaUrl } = require('./mediaAccess');

const idOf = (v) => (v && v._id ? String(v._id) : String(v));

const createAccessChecker = async (user, { EnrollmentModel = Enrollment } = {}) => {
  const active = user && user.isActive !== false ? user : null; // a deactivated account is treated as logged out
  if (active && active.role === 'admin') return () => true;

  let enrolledCourseIds = new Set();
  if (active && active.role !== 'teacher') {
    const ids = await EnrollmentModel.find({ student: active._id }).distinct('course');
    enrolledCourseIds = new Set(ids.map(idOf));
  }

  // courseTeacher (optional) lets callers that already loaded the course pass its owner
  return (lecture, courseTeacher) => {
    if (lecture.isFree) return true;
    if (!active) return false;
    if (active.role === 'teacher') {
      return idOf(lecture.teacher) === idOf(active._id) || (courseTeacher != null && idOf(courseTeacher) === idOf(active._id));
    }
    return enrolledCourseIds.has(idOf(lecture.course));
  };
};

const plain = (doc) => (typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc });

// Lecture as sent to the client: media URLs only when allowed, and signed. videoPath (internal disk path) is never sent.
const toClientLecture = (lecture, allowed) => {
  const obj = plain(lecture);
  delete obj.videoPath;
  if (allowed) {
    if (obj.videoUrl) obj.videoUrl = signMediaUrl(obj.videoUrl);
  } else {
    delete obj.videoUrl;
  }
  obj.hasAccess = !!allowed;
  return obj;
};

// Note as sent to the client: the file link only for users who can see the lecture (or when the note itself is free).
const toClientNote = (note, lectureAllowed) => {
  const obj = plain(note);
  delete obj.filePath;
  if (lectureAllowed || obj.isFree) {
    if (obj.fileUrl) obj.fileUrl = signMediaUrl(obj.fileUrl);
  } else {
    delete obj.fileUrl;
  }
  return obj;
};

module.exports = { createAccessChecker, toClientLecture, toClientNote, idOf };
