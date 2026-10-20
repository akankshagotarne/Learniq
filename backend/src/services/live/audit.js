/** Append-only audit of administrator access / actions on live classes (and rejected attempts to use admin-only operations). */
const record = async (models, log, { action, actor, role, room, session, target, mcqId, outcome = 'SUCCESS', reason, detail }) => {
  try {
    await models.LiveAdminAudit.create({
      action, actor: actor.id, actorName: actor.name, actorRole: role || actor.role,
      session: (room && room.sessionId) || (session && session._id) || undefined, sessionCode: room ? room.code : session ? session.sessionCode : undefined,
      targetUser: target && target.userId ? target.userId : undefined, targetName: target && target.name ? String(target.name).slice(0, 120) : undefined,
      mcq: mcqId || undefined, outcome, reason: reason ? String(reason).slice(0, 300) : undefined, detail, at: new Date(),
    });
  } catch (err) { (log || console).error('[Live] audit write failed:', err && err.message); }
};
module.exports = { record };
