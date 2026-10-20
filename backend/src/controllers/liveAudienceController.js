/**
 * Lookups the "Who can join this meeting?" selector needs. Deliberately narrow: a teacher gets names, standards and a masked identifier,
 * never email addresses, phone numbers, points, or anything else from a profile. Student search is server-side and paged so the browser
 * never loads the whole student table.
 */
const User = require('../models/User');
const identity = require('../services/identity');
const { STUDENT_STANDARDS, standardLabel } = require('../constants/standards');

const MAX_Q = 60;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const maskPhone = (u) => { const d = String(u.phone || '').replace(/\D/g, ''); return d.length >= 4 ? `ends ${d.slice(-4)}` : ''; };
const cleanQ = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_Q) : '');
const asLimit = (v) => Math.min(25, Math.max(1, parseInt(v, 10) || 20));

const studentView = (u) => ({ id: String(u._id), name: u.name, standard: u.currentStandard ?? null, standardLabel: standardLabel(u.currentStandard), hint: maskPhone(u) });
const teacherView = (u) => ({ id: String(u._id), name: u.name, subjects: (u.subjects || []).slice(0, 4), qualification: u.qualification || '', experience: u.experience || '' });

// GET /api/teacher/live-audience/standards  - the supported standards, with how many active students each has
const standards = async (req, res) => {
  try {
    const rows = await User.aggregate([
      { $match: { role: 'student', isActive: { $ne: false }, currentStandard: { $in: [...STUDENT_STANDARDS] } } },
      { $group: { _id: '$currentStandard', count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    res.json({ success: true, standards: STUDENT_STANDARDS.map((v) => ({ value: v, label: standardLabel(v), studentCount: counts[v] || 0 })) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'The standards could not be loaded.' });
  }
};

// GET /api/teacher/live-audience/students?q=&standard=&limit=
const searchStudents = async (req, res) => {
  try {
    const q = cleanQ(req.query.q);
    const std = req.query.standard !== undefined && req.query.standard !== '' ? Number(req.query.standard) : null;
    if (std !== null && !STUDENT_STANDARDS.includes(std)) return res.status(400).json({ success: false, message: 'That standard is not supported.' });
    if (q.length < 2 && std === null) return res.json({ success: true, students: [], hint: 'Type at least 2 letters of a name.' });
    const filter = { role: 'student', isActive: { $ne: false } };
    if (std !== null) filter.currentStandard = std;
    if (q) {
      const or = [{ name: { $regex: escapeRe(q), $options: 'i' } }];
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 4 && digits.length === q.replace(/[\s+()-]/g, '').length) or.push({ phoneNormalized: { $regex: `${escapeRe(digits)}$` } });
      filter.$or = or;
    }
    const rows = await User.find(filter).select('name currentStandard phone').sort({ name: 1 }).limit(asLimit(req.query.limit)).lean();
    res.json({ success: true, students: rows.map(studentView) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Students could not be searched. Please try again.' });
  }
};

// GET /api/teacher/live-audience/teachers?q=   - only approved, active teachers (never the caller)
const searchTeachers = async (req, res) => {
  try {
    const q = cleanQ(req.query.q);
    const filter = { role: 'teacher', isActive: { $ne: false }, isApproved: true, _id: { $ne: req.user._id } };
    if (q) filter.name = { $regex: escapeRe(q), $options: 'i' };
    const rows = await User.find(filter).select('name subjects qualification experience approvalStatus isApproved').sort({ name: 1 }).limit(asLimit(req.query.limit)).lean();
    res.json({ success: true, teachers: rows.filter((u) => identity.approvalStatusOf(u) === 'APPROVED').map(teacherView) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Teachers could not be searched. Please try again.' });
  }
};

// POST /api/teacher/live-audience/resolve { studentIds, teacherIds }  - names for people already selected (so a saved selection survives a refresh)
const resolve = async (req, res) => {
  try {
    const pick = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => OBJECT_ID.test(x)))].slice(0, 500) : []);
    const sIds = pick(req.body && req.body.studentIds);
    const tIds = pick(req.body && req.body.teacherIds);
    const [students, teachers] = await Promise.all([
      sIds.length ? User.find({ _id: { $in: sIds }, role: 'student' }).select('name currentStandard phone').lean() : [],
      tIds.length ? User.find({ _id: { $in: tIds }, role: 'teacher' }).select('name subjects qualification experience').lean() : [],
    ]);
    res.json({ success: true, students: students.map(studentView), teachers: teachers.map(teacherView) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'The selection could not be loaded.' });
  }
};

module.exports = { standards, searchStudents, searchTeachers, resolve };
