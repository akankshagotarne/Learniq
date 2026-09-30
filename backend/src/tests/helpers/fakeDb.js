/**
 * Minimal in-memory stand-in for the Mongoose models used by the Olympiad controller.
 * Lets the test-suite run without a MongoDB server. It emulates:
 *   - equality / $in / $nin / $gt / $gte / $lt / $lte / $exists / $ne / $not / $regex filters (and `field: null` = missing-or-null, like MongoDB)
 *   - $set (incl. dotted paths) / $unset / $inc / $setOnInsert updates, upserts, updateOne / updateMany
 *   - `select: false` hidden fields (answer key!) and '+field' opt-in
 *   - the unique / partial-unique indexes declared in models/Olympiad.js (throws code 11000)
 *   - a tiny $match / $group aggregation (group _id may be '$field', $ifNull or $dateToString)
 * For full-fidelity runs set OLYMPIAD_TEST_MONGO_URI to use a real MongoDB instead.
 */
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Types;
const isOid = (v) => v instanceof ObjectId;
const isPlainObj = (v) => v && typeof v === 'object' && !isOid(v) && !(v instanceof Date) && !Array.isArray(v);

const clone = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (isOid(v)) return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = clone(v[k]);
  return o;
};
const val = (v) => (v instanceof Date ? v.getTime() : v);
const eq = (a, b) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (isOid(a) || isOid(b)) return String(a) === String(b);
  return a === b;
};
const getPath = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const setPath = (doc, path, value) => {
  const keys = path.split('.');
  let o = doc;
  keys.slice(0, -1).forEach((k) => { if (!isPlainObj(o[k])) o[k] = {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
};
const unsetPath = (doc, path) => {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) { if (!o) return; o = o[k]; }
  if (o) delete o[keys[keys.length - 1]];
};

const matchCond = (v, cond) => {
  if (isPlainObj(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$in': return arg.some((x) => eq(v, x));
        case '$nin': return !arg.some((x) => eq(v, x));
        case '$gt': return v != null && val(v) > val(arg);
        case '$gte': return v != null && val(v) >= val(arg);
        case '$lt': return v != null && val(v) < val(arg);
        case '$lte': return v != null && val(v) <= val(arg);
        case '$exists': return (v !== undefined) === arg;
        case '$ne': return arg === null ? v != null : !eq(v, arg);
        case '$not': return !matchCond(v, arg);
        case '$regex': return typeof v === 'string' && new RegExp(arg instanceof RegExp ? arg.source : arg, cond.$options || '').test(v);
        case '$options': return true; // consumed by $regex
        default: throw new Error(`fakeDb: unsupported operator ${op}`);
      }
    });
  }
  if (cond === null) return v == null; // MongoDB: { field: null } matches a missing field too
  return eq(v, cond);
};
const matches = (doc, filter = {}) => Object.entries(filter).every(([k, c]) => {
  if (k === '$or') return c.some((sub) => matches(doc, sub));
  if (k === '$and') return c.every((sub) => matches(doc, sub));
  return matchCond(getPath(doc, k), c);
});

/** the few aggregation expressions the services use: '$field', $ifNull, $dateToString('%Y-%m' | '%Y-%m-%d', timezone) */
const evalExpr = (doc, expr) => {
  if (typeof expr === 'string') return expr.startsWith('$') ? getPath(doc, expr.slice(1)) : expr;
  if (expr && expr.$ifNull) {
    for (const e of expr.$ifNull) { const v = evalExpr(doc, e); if (v != null) return v; }
    return null;
  }
  if (expr && expr.$dateToString) {
    const { format, date, timezone = 'UTC' } = expr.$dateToString;
    const d = evalExpr(doc, date);
    if (!(d instanceof Date)) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).map((p) => [p.type, p.value]));
    return format.replace('%Y', parts.year).replace('%m', parts.month).replace('%d', parts.day);
  }
  throw new Error(`fakeDb: unsupported expression ${JSON.stringify(expr)}`);
};

const applyUpdate = (doc, update, { inserting = false } = {}) => {
  for (const [op, spec] of Object.entries(update)) {
    if (op === '$set') Object.entries(spec).forEach(([k, v]) => setPath(doc, k, clone(v)));
    else if (op === '$unset') Object.keys(spec).forEach((k) => unsetPath(doc, k));
    else if (op === '$inc') Object.entries(spec).forEach(([k, n]) => setPath(doc, k, (Number(getPath(doc, k)) || 0) + n));
    else if (op === '$setOnInsert') { if (inserting) Object.entries(spec).forEach(([k, v]) => setPath(doc, k, clone(v))); }
    else throw new Error(`fakeDb: unsupported update operator ${op}`);
  }
  doc.updatedAt = new Date();
};

const dupError = (msg) => Object.assign(new Error(`E11000 duplicate key error: ${msg}`), { code: 11000 });

class Query {
  constructor(model, filter, single) {
    this.model = model; this.filter = filter; this.single = single;
    this._sort = null; this._select = null; this._limit = null; this._skip = 0; this._populate = [];
  }
  sort(s) { this._sort = s; return this; }
  select(s) { this._select = s; return this; }
  limit(n) { this._limit = n; return this; }
  skip(n) { this._skip = n; return this; }
  lean() { return this; }
  populate(path, fields) { this._populate.push({ path, fields }); return this; }
  then(res, rej) { return this.exec().then(res, rej); }
  catch(rej) { return this.exec().catch(rej); }

  async exec() {
    let rows = this.model.docs.filter((d) => matches(d, this.filter));
    if (this._sort) {
      const spec = typeof this._sort === 'string'
        ? Object.fromEntries(this._sort.split(/\s+/).filter(Boolean).map((k) => (k.startsWith('-') ? [k.slice(1), -1] : [k, 1])))
        : this._sort;
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of Object.entries(spec)) {
          const x = val(getPath(a, k)); const y = val(getPath(b, k));
          if (x < y) return -dir; if (x > y) return dir;
        }
        return 0;
      });
    }
    if (this.single) rows = rows.slice(0, 1);
    if (this._skip) rows = rows.slice(this._skip);
    if (this._limit) rows = rows.slice(0, this._limit);
    const out = rows.map((d) => {
      let doc = this.model.project(d, this._select);
      for (const { path, fields } of this._populate) {
        const ref = this.model.refs[path];
        const target = ref && this.model.registry[ref];
        if (target) {
          const found = target.docs.find((x) => eq(x._id, d[path]));
          doc[path] = found ? target.project(found, fields || null) : null;
        }
      }
      return doc;
    });
    return this.single ? (out[0] || null) : out;
  }
}

class FakeModel {
  constructor(name, { defaults = () => ({}), hidden = [], unique = [], refs = {}, registry }) {
    Object.assign(this, { name, defaults, hidden, unique, refs, registry, docs: [] });
    registry[name] = this;
  }

  project(doc, select) {
    const out = clone(doc);
    const tokens = (select || '').split(/\s+/).filter(Boolean);
    const plus = tokens.filter((t) => t.startsWith('+')).map((t) => t.slice(1));
    const minus = tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
    const include = tokens.filter((t) => !t.startsWith('+') && !t.startsWith('-'));
    if (include.length) {
      for (const k of Object.keys(out)) if (k !== '_id' && !include.includes(k) && !plus.includes(k)) delete out[k];
    }
    for (const h of this.hidden) if (!plus.includes(h) && !include.includes(h)) delete out[h];
    minus.forEach((m) => delete out[m]);
    return out;
  }

  checkUnique(candidate) {
    for (const u of this.unique) {
      if (u.where && !u.where(candidate)) continue;
      const clash = this.docs.find((d) =>
        !eq(d._id, candidate._id) && (!u.where || u.where(d)) &&
        u.fields.every((f) => getPath(d, f) !== undefined && eq(getPath(d, f), getPath(candidate, f))));
      if (clash && u.fields.every((f) => getPath(candidate, f) !== undefined)) throw dupError(`${this.name} ${u.fields.join('+')}`);
    }
  }

  async create(data) {
    const doc = clone({ ...this.defaults(), ...data });
    doc._id = doc._id || new ObjectId();
    doc.createdAt = doc.createdAt || new Date();
    doc.updatedAt = new Date();
    this.checkUnique(doc);
    this.docs.push(doc);
    return this.project(doc, null);
  }

  findOne(filter) { return new Query(this, filter, true); }
  find(filter) { return new Query(this, filter, false); }
  findById(id) { return new Query(this, { _id: id }, true); }

  async findOneAndUpdate(filter, update, opts = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) {
      if (opts.upsert) {
        const base = {};
        Object.entries(filter).forEach(([k, v]) => { if (!k.startsWith('$') && (v === null || typeof v !== 'object' || v instanceof ObjectId)) base[k] = v; });
        const fresh = { ...this.defaults(), ...base };
        applyUpdate(fresh, update, { inserting: true });
        return opts.new ? this.create(fresh) : (await this.create(fresh), null);
      }
      return null;
    }
    const before = this.project(doc, null);
    const next = clone(doc);
    applyUpdate(next, update);
    this.checkUnique(next);
    Object.keys(doc).forEach((k) => delete doc[k]);
    Object.assign(doc, next);
    return opts.new ? this.project(doc, null) : before;
  }

  async updateOne(filter, update, opts = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) {
      if (opts.upsert) {
        const created = await this.findOneAndUpdate(filter, update, { upsert: true, new: true });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: created._id };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }
    const next = clone(doc);
    applyUpdate(next, update);
    this.checkUnique(next);
    Object.keys(doc).forEach((k) => delete doc[k]);
    Object.assign(doc, next);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  async updateMany(filter, update) {
    let n = 0;
    for (const doc of this.docs.filter((d) => matches(d, filter))) {
      const next = clone(doc);
      applyUpdate(next, update);
      this.checkUnique(next);
      Object.keys(doc).forEach((k) => delete doc[k]);
      Object.assign(doc, next);
      n += 1;
    }
    return { matchedCount: n, modifiedCount: n };
  }

  async findByIdAndUpdate(id, update, opts = {}) { return this.findOneAndUpdate({ _id: id }, update, opts); }

  async bulkWrite(ops) {
    for (const op of ops) {
      if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne;
        await this.findOneAndUpdate(filter, update, { upsert: !!upsert });
      } else throw new Error('fakeDb: bulkWrite op not supported');
    }
    return { ok: 1 };
  }

  async deleteOne(filter) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  async countDocuments(filter = {}) { return this.docs.filter((d) => matches(d, filter)).length; }

  async distinct(field, filter = {}) {
    const out = [];
    for (const d of this.docs.filter((x) => matches(x, filter))) {
      const v = getPath(d, field);
      if (v !== undefined && !out.some((o) => eq(o, v))) out.push(v);
    }
    return out;
  }

  async aggregate(pipeline) {
    let rows = this.docs.map(clone);
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
      else if (stage.$group) {
        const { _id: idSpec, ...accs } = stage.$group;
        const groups = new Map();
        for (const d of rows) {
          const id = evalExpr(d, idSpec);
          const key = String(id);
          if (!groups.has(key)) groups.set(key, { _id: id, rows: [] });
          groups.get(key).rows.push(d);
        }
        rows = [...groups.values()].map(({ _id, rows: rs }) => {
          const g = { _id };
          for (const [name, spec] of Object.entries(accs)) {
            const [op, arg] = Object.entries(spec)[0];
            const nums = rs.map((r) => (typeof arg === 'number' ? arg : getPath(r, arg.slice(1))));
            if (op === '$sum') g[name] = nums.reduce((s, n) => s + n, 0);
            else if (op === '$avg') g[name] = nums.reduce((s, n) => s + n, 0) / nums.length;
            else if (op === '$max') g[name] = Math.max(...nums);
            else if (op === '$min') g[name] = Math.min(...nums);
            else throw new Error(`fakeDb: unsupported accumulator ${op}`);
          }
          return g;
        });
      } else throw new Error('fakeDb: unsupported pipeline stage');
    }
    return rows;
  }

  reset() { this.docs = []; }
}

const createFakeDb = () => {
  const registry = {};
  const uniqueSuccess = { fields: ['student', 'exam'], where: (d) => d.status === 'SUCCESS' };
  const uniquePending = { fields: ['exam', 'student'], where: (d) => d.status === 'PENDING' };

  const OlympiadExam = new FakeModel('OlympiadExam', {
    registry, unique: [{ fields: ['slug'] }],
    defaults: () => ({ examType: 'olympiad', isPublished: true, negativeMarking: false, negativeMarkValue: 0, currency: 'INR', sections: [], instructions: [] }),
  });
  const OlympiadQuestion = new FakeModel('OlympiadQuestion', {
    registry, hidden: ['correctAnswer', 'explanation'], unique: [{ fields: ['exam', 'questionNumber'] }],
    defaults: () => ({ marks: 1 }),
  });
  const OlympiadPayment = new FakeModel('OlympiadPayment', {
    registry, hidden: ['razorpaySignature'], refs: { student: 'User', exam: 'OlympiadExam' },
    unique: [uniqueSuccess, uniquePending, { fields: ['razorpayOrderId'] }],
    defaults: () => ({ currency: 'INR', status: 'PENDING' }),
  });
  const OlympiadAttempt = new FakeModel('OlympiadAttempt', {
    registry, refs: { student: 'User', exam: 'OlympiadExam' }, unique: [{ fields: ['student', 'exam'] }],
    defaults: () => ({
      status: 'IN_PROGRESS', responses: {}, score: 0, totalMarks: 0, percentage: 0, correctCount: 0, wrongCount: 0,
      unansweredCount: 0, attemptedCount: 0, accuracy: 0, timeTakenSeconds: 0, sectionResults: [],
    }),
  });
  const User = new FakeModel('User', {
    registry, hidden: ['password'], unique: [{ fields: ['email'] }],
    defaults: () => ({ role: 'student', isActive: true }),
  });
  const Notification = new FakeModel('Notification', { registry });
  // course / lecture / note payments (models/index.js → Payment)
  const Course = new FakeModel('Course', { registry, defaults: () => ({ enrolledCount: 0 }) });
  // NB: like the real schema there is NO unique index on (student, course) — a duplicate enrollment would be visible to tests
  const Enrollment = new FakeModel('Enrollment', { registry, refs: { student: 'User', course: 'Course' } });
  const Payment = new FakeModel('Payment', {
    registry, hidden: ['razorpaySignature'], refs: { student: 'User', course: 'Course' }, // schema: select:false
    defaults: () => ({ currency: 'INR', status: 'pending' }),
  });

  // certificates (models/Certificate.js) — same unique indexes as the real schema
  const Certificate = new FakeModel('Certificate', {
    registry, refs: { student: 'User', exam: 'OlympiadExam' },
    unique: [{ fields: ['certificateNumber'] }, { fields: ['student', 'exam'] }, { fields: ['attempt'] }, { fields: ['verificationToken'] }],
    defaults: () => ({ status: 'VALID', result: 'PASS' }),
  });
  const Counter = new FakeModel('Counter', { registry, defaults: () => ({ seq: 0 }) });

  return { registry, OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt, User, Notification, Payment, Course, Enrollment, Certificate, Counter };
};

module.exports = { createFakeDb };
