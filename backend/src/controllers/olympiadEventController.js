const svc = require('../services/olympiadEvents');

/**
 * Admin > Olympiad events. Role enforcement is on the route (protect + authorize('admin')); every field is validated and
 * allow-listed in services/olympiadEvents.js. Teachers and students can never reach these handlers.
 */
const handler = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof svc.EventError) return res.status(err.status).json({ success: false, message: err.message, code: err.code, ...err.extra });
    console.error('[olympiad-events] unexpected error:', err && err.message);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again in a moment.' });
  }
};
const noStore = (res) => res.set('Cache-Control', 'no-store');

// GET /api/olympiad/admin/events?search=&standard=&status=&from=&to=
const list = handler(async (req, res) => {
  const now = new Date();
  const events = await svc.listEvents(req.query, now);
  noStore(res);
  res.json({ success: true, events, serverNow: now.toISOString() });
});

// GET /api/olympiad/admin/events/options  (the shared selector: real events only + the sensible default)
const options = handler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await svc.eventOptions()), serverNow: new Date().toISOString() });
});

// GET /api/olympiad/admin/events/migration-report  (READ-ONLY: what the legacy migration would associate / flag)
const migrationReport = handler(async (req, res) => {
  noStore(res);
  res.json({ success: true, readOnly: true, ...(await svc.planLegacy()) });
});

// GET /api/olympiad/admin/events/:id
const detail = handler(async (req, res) => {
  noStore(res);
  res.json({ success: true, ...(await svc.eventDetail(req.params.id)), serverNow: new Date().toISOString() });
});

// POST /api/olympiad/admin/events
const create = handler(async (req, res) => {
  const data = await svc.createEvent(req.body, req.user);
  noStore(res);
  res.status(201).json({ success: true, message: 'Olympiad event created.', ...data });
});

// PATCH /api/olympiad/admin/events/:id
const update = handler(async (req, res) => {
  const data = await svc.updateEvent(req.params.id, req.body, req.user);
  noStore(res);
  res.json({ success: true, ...data });
});

const action = (fn, message) => handler(async (req, res) => {
  const data = await fn(req);
  noStore(res);
  res.json({ success: true, message, ...data });
});
const publish = action((req) => svc.publishEvent(req.params.id, req.user), 'Event published. Students can now see it.');
const unpublish = action((req) => svc.unpublishEvent(req.params.id, req.user), 'Event moved back to draft.');
const cancel = action((req) => svc.cancelEvent(req.params.id, req.body, req.user), 'Event cancelled. All records are kept; students can no longer register or start.');

// DELETE /api/olympiad/admin/events/:id  (an unused draft only)
const remove = handler(async (req, res) => {
  const data = await svc.deleteEvent(req.params.id, req.user);
  noStore(res);
  res.json({ success: true, message: 'Draft event deleted.', ...data });
});

module.exports = { list, options, migrationReport, detail, create, update, publish, unpublish, cancel, remove };
