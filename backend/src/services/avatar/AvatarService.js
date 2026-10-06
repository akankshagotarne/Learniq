/**
 * Provider-neutral avatar API. The rest of LearnIQ only knows this interface, so HeyGen can be replaced by another
 * provider later by adding a file next to liveAvatarProvider.js and returning it from `providerFor`.
 *
 *   startAvatarSession(cfg, opts)  -> { provider, sessionToken, sessionId }   (server: mint a short-lived token)
 *   getAvatarSessionToken          -> same as startAvatarSession (alias kept for readability at call sites)
 *   sendTextToAvatar               -> runs in the BROWSER (SDK `session.repeat(text)`); see frontend/hooks/useLiveAvatar.ts
 *   stopAvatarSession              -> runs in the BROWSER (SDK `session.stop()`); the provider-side max_session_duration is the backstop
 */
const liveAvatar = require('./liveAvatarProvider');

const providerFor = (cfg) => {
  switch (cfg.avatar.provider) {
    case 'heygen-liveavatar':
    default:
      return liveAvatar;
  }
};

const startAvatarSession = async (cfg, opts) => {
  const { sessionToken, sessionId } = await providerFor(cfg).createSessionToken(cfg, opts);
  return { provider: cfg.avatar.provider, sessionToken, sessionId };
};

module.exports = { startAvatarSession, getAvatarSessionToken: startAvatarSession, providerFor };
