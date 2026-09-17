import React from 'react';
import {
  PORTAL_LABEL,
  clearSession,
  portalLabelFor,
  portalUrlFor,
} from '../../portalSession.js';

/**
 * Rendered instead of the portal UI when the signed-in account belongs to
 * the other portal (e.g. an admin account reached the Manager portal, or
 * vice versa - see portalSession.js's roleBelongsHere()).
 *
 * Behaviour (2026-09-17): this used to stop and show a "Wrong portal" error
 * with a button the user had to click. That was surprising for the normal
 * case - switching portals from the mobile shell, or an account simply
 * having the wrong role for the site it landed on is not something the
 * user did wrong. So this now clears the mismatched session and forwards
 * the browser straight to the correct portal automatically, the same way
 * the mobile handoff (portalSession.js: consumeMobileHandoff) already
 * self-heals a crossed deployment. Nothing is shown but a brief loading
 * state while the redirect happens.
 *
 * The only time this still surfaces an error is when the target portal's
 * URL is not configured in this build (VITE_ADMIN_PORTAL_URL /
 * VITE_MANAGER_PORTAL_URL missing) - there is nowhere to send the user, so
 * we say so instead of failing silently.
 */
export default function WrongPortalNotice({ role, belongsTo }) {
  const targetUrl = portalUrlFor(belongsTo);
  const targetLabel = portalLabelFor(belongsTo);

  React.useEffect(() => {
    if (!targetUrl) return undefined;
    // This portal should not keep a session it is refusing to render.
    clearSession();
    window.location.replace(targetUrl);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUrl]);

  if (targetUrl) {
    return <div className="page-loading">Loading...</div>;
  }

  // Config error only: the correct portal's URL isn't set, so we cannot
  // forward automatically. This is a build/deploy problem, not a user one.
  return (
    <div className="login-screen">
      <div className="login-card" style={{ textAlign: 'center', gap: '12px' }}>
        <h1>Portal not configured</h1>
        <div className="alert alert-error" style={{ textAlign: 'left' }}>
          This account{role ? <> (role: <strong>{role}</strong>)</> : null} belongs
          to the <strong>{targetLabel}</strong>, but this build of the{' '}
          <strong>{PORTAL_LABEL}</strong> does not have that portal's address
          configured, so it cannot be opened automatically. Set{' '}
          <code>VITE_ADMIN_PORTAL_URL</code> and{' '}
          <code>VITE_MANAGER_PORTAL_URL</code> for this site and redeploy.
        </div>

        <button
          type="button"
          className="btn"
          onClick={() => {
            clearSession();
            window.location.href = '/login';
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
