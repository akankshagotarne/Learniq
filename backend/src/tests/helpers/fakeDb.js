/**
 * Minimal in-memory stand-in for the Mongoose models used by the Olympiad controller.
 * Lets the test-suite run without a MongoDB server. It emulates:
 *   - equality / $in / $nin / $gt / $gte / $lt / $lte / $exists / $ne filters
 *   - $set (incl. dotted paths) / $unset updates
 *   - `select: false` hidden fields (answer key!) and '+field' opt-in
 *   - the unique / partial-unique indexes declared in models/Olympiad.js (throws code 11000)
 *   - a tiny $match / $group aggregation
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
        case '$ne': return !eq(v, arg);
        default: throw new Error(`fakeDb: unsupported operator ${op}`);
      }
    });
  }
  return eq(v, cond);
};
const matches = (doc, filter = {}) => Object.entries(filter).every(([k, c]) => matchCond(getPath(doc, k), c));

const applyUpdate = (doc, update) => {
  for (const [op, spec] of Object.entries(update)) {
    if (op === '$set') Object.entries(spec).forEach(([k, v]) => setPath(doc, k, clone(v)));
    else if (op === '$unset') Object.keys(spec).forEach((k) => unsetPath(doc, k));
    else throw new Error(`fakeDb: unsupported update operator ${op}`);
  }
  doc.updatedAt = new Date();
};

const dupError = (msg) => Object.assign(new Error(`E11000 duplicate key error: ${msg}`), { code: 11000 });

class Query {
  constructor(model, filter, single) {
    this.model = model; this.filter = filter; this.single = single;
    this._sort = null; this._select = null; this._limit = null; this._populate = [];
  }
  sort(s) { this._sort = s; return this; }
  select(s) { this._select = s; return this; }
  limit(n) { this._limit = n; return this; }
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
      if (opts.upsert) throw new Error('fakeDb: upsert not supported');
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

  async updateOne(filter, update) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const next = clone(doc);
    applyUpdate(next, update);
    this.checkUnique(next);
    Object.keys(doc).forEach((k) => delete doc[k]);
    Object.assign(doc, next);
    return { matchedCount: 1, modifiedCount: 1 };
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
          const key = String(getPath(d, idSpec.slice(1)));
          if (!groups.has(key)) groups.set(key, { _id: getPath(d, idSpec.slice(1)), rows: [] });
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

  return { registry, OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt, User, Notification };
};

module.exports = { createFakeDb };
