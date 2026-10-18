/**
 * The student's profile photo for a certificate.
 *
 * Source: the existing ProfilePhoto collection (one document per user, written by the profile-photo upload — see
 * models/ProfilePhoto.js). It is looked up by the certificate's OWN student id, re-checked against the document's owner, and read
 * straight from the database as bytes: there is no URL, signed link or cache to expire, so the PDF always embeds the student's
 * CURRENT photo and stays complete when downloaded later. Certificates are rendered on demand, so a changed photo appears on the
 * next download without touching the certificate record, its number or its QR code.
 *
 * It NEVER throws: a missing, unsupported, corrupt or slow photo returns null and the certificate is produced without a photo.
 */
const MAX_BYTES = 1024 * 1024;        // stored photos are <= 512 KB; anything bigger is not a profile photo
const MIN_SIDE = 48;                  // below this the picture is too small to print
const MAX_SIDE = 12000;
const TIMEOUT_MS = 4000;

/** The REAL bytes decide the type. pdfkit embeds JPEG and PNG; WebP (also accepted by the profile upload) is not supported. */
const inspectImage = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) { // JPEG: find the start-of-frame marker for the size
    // a usable JPEG has image data (start-of-scan) and is not cut off (end-of-image): pdfkit embeds the bytes as they are
    if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9 || buf.indexOf(Buffer.from([0xff, 0xda])) < 0) return null;
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('photo lookup timed out')), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/**
 * @param {string|ObjectId} studentId  the certificate's student (cert.student)
 * @param {object} [opts]  { model, timeoutMs, log } — injectable for tests
 * @returns {Promise<{buffer:Buffer,type:string,width:number,height:number}|null>}
 */
const loadStudentPhoto = async (studentId, { model, timeoutMs = TIMEOUT_MS, log = console.warn } = {}) => {
  try {
    if (!studentId) return null;
    const Model = model || require('../models/ProfilePhoto').ProfilePhoto;
    const row = await withTimeout(Model.findOne({ user: studentId }), timeoutMs);
    if (!row || !row.data) return null; // the student never uploaded a photo: the normal photo-free certificate
    if (String(row.user) !== String(studentId)) return null; // never use a photo that does not belong to this student
    const buffer = Buffer.isBuffer(row.data) ? row.data : (row.data.buffer ? Buffer.from(row.data.buffer) : null);
    if (!buffer || buffer.length > MAX_BYTES) return null;
    const info = inspectImage(buffer);
    if (!info || info.width < MIN_SIDE || info.height < MIN_SIDE || info.width > MAX_SIDE || info.height > MAX_SIDE) {
      log(`[certificate] profile photo of student ${String(studentId)} cannot be embedded (${info ? 'size' : 'format'}); issuing the certificate without a photo`);
      return null;
    }
    return { buffer, ...info };
  } catch (e) {
    log(`[certificate] profile photo of student ${String(studentId)} unavailable (${e && e.message}); issuing the certificate without a photo`);
    return null;
  }
};

module.exports = { loadStudentPhoto, inspectImage, MAX_BYTES, TIMEOUT_MS };
