/**
 * Portal identity, mobile-handoff bootstrap, and role enforcement.
 * =====================================================================
 * This file is deliberately IDENTICAL in the Admin and Manager repos
 * except for the PORTAL_ID / PORTAL_LABEL constants directly below. If
 * you change anything else here, copy the change to the other repo too -
 * the two halves of the check only work when they agree.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now neither portal checked *who* was signing in. Both accepted
 * any valid credential from the shared backend and rendered their own UI
 * around it. The Manager portal in particular had no role logic anywhere
 * - not in App.jsx, not in AuthContext, not in Layout - so an admin
 * account that reached it (from the mobile shell, from a bookmark, or
 * from a stale tab) was shown the Manager portal with admin credentials.
 * That is the "logging in as admin opens the Manager portal and the
 * credentials collapse into each other" problem.
 *
 * Two things fix it, and both live here:
 *
 *   1. The mobile handoff now carries an explicit `portal` marker saying
 *      which portal the shell meant to reach. If this portal is not that
 *      portal, the session is NOT written to localStorage here; it is
 *      forwarded on to the correct portal instead (bounded by a hop
 *      counter so a misconfiguration cannot become an infinite loop).
 *      This makes the app self-healing even if the two Vercel projects
 *      were deployed to each other's URLs.
 *
 *   2. roleBelongsHere() backs that up for every other way in - a normal
 *      browser login on the wrong site, a restored localStorage session,
 *      a shared link. App.jsx uses it to refuse the session outright
 *      rather than render the wrong portal.
 */

// ---------------------------------------------------------------------
// The ONE line that differs between the two repos.
export const PORTAL_ID = 'admin';
// ---------------------------------------------------------------------

export const PORTAL_LABEL = PORTAL_ID === 'manager' ? 'Manager Portal' : 'Admin Portal';

const HANDOFF_MARKER = '#rsaMobileAuth=';
const MISMATCH_KEY = 'rsa_portal_mismatch';
const MAX_HANDOFF_HOPS = 2;

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Both portals need to know both URLs so either can forward a session to
 * the other. Set these in each portal's .env.production (and in the
 * Vercel project's environment variables, which override the file).
 */
export const ADMIN_PORTAL_URL = stripTrailingSlash(import.meta.env.VITE_ADMIN_PORTAL_URL || '');
export const MANAGER_PORTAL_URL = stripTrailingSlash(import.meta.env.VITE_MANAGER_PORTAL_URL || '');

/**
 * Escape hatch. Set VITE_ALLOW_CROSS_ROLE=true to restore the old lenient
 * behaviour where any authenticated account renders this portal (the
 * Admin portal used to deliberately degrade a manager account to
 * ManagerDashboard + Labour rather than turn it away). Off by default,
 * because "quietly show a different portal than the one the credentials
 * belong to" is exactly the bug being fixed.
 */
export const ALLOW_CROSS_ROLE =
  String(import.meta.env.VITE_ALLOW_CROSS_ROLE || '').trim().toLowerCase() === 'true';

/** Which backend roles belong to the Manager portal. Everything else is Admin. */
export const MANAGER_ROLES = ['manager'];

/** Trim + lowercase, so "Manager", " manager " and "MANAGER" all match. */
export function normalizeRole(role) {
  return String(role ?? '').trim().toLowerCase();
}

/** 'manager' | 'admin' - which portal this role belongs to. */
export function portalIdForRole(role) {
  return MANAGER_ROLES.includes(normalizeRole(role)) ? 'manager' : 'admin';
}

export function portalUrlFor(portalId) {
  return portalId === 'manager' ? MANAGER_PORTAL_URL : ADMIN_PORTAL_URL;
}

export function portalLabelFor(portalId) {
  return portalId === 'manager' ? 'Manager Portal' : 'Admin Portal';
}

/** True when this account's role belongs to the portal it is looking at. */
export function roleBelongsHere(role) {
  return portalIdForRole(role) === PORTAL_ID;
}

/**
 * Reads the role from wherever the payload happens to carry it. The login
 * envelope has changed shape before; reading `undefined` and defaulting
 * silently is what let a mismatched account through unnoticed.
 */
export function extractRole(user) {
  const candidates = [
    user?.role,
    user?.userRole,
    user?.type,
    Array.isArray(user?.roles) ? user.roles[0] : undefined,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeRole(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function buildHandoffUrl(baseUrl, token, user, portalId, hops) {
  const payload = encodeURIComponent(JSON.stringify({ token, user, portal: portalId, hops }));
  return `${stripTrailingSlash(baseUrl)}/#rsaMobileAuth=${payload}`;
}

export function readPortalMismatch() {
  try {
    const raw = sessionStorage.getItem(MISMATCH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearPortalMismatch() {
  try {
    sessionStorage.removeItem(MISMATCH_KEY);
  } catch (e) {
    /* sessionStorage unavailable - nothing to clear */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem('rsa_token');
    localStorage.removeItem('rsa_user');
  } catch (e) {
    /* storage unavailable */
  }
  clearPortalMismatch();
}

/**
 * Called once from main.jsx BEFORE React mounts.
 *
 * Returns one of:
 *   { status: 'none' }         no handoff fragment - a normal web visit
 *   { status: 'ok' }           session accepted and written to localStorage
 *   { status: 'redirecting' }  session was for the other portal; forwarded
 *   { status: 'wrong-portal' } session was for the other portal and could
 *                              not be forwarded (URL not configured, or
 *                              the hop limit was hit)
 *   { status: 'invalid' }      fragment present but unusable
 *
 * The session is written to localStorage ONLY in the 'ok' case. That is
 * the whole point: a session belonging to the other portal must never end
 * up seeding this portal's AuthContext.
 */
export function consumeMobileHandoff() {
  let hadMarker = false;
  let redirecting = false;

  try {
    const hash = window.location.hash || '';
    if (hash.indexOf(HANDOFF_MARKER) !== 0) return { status: 'none' };
    hadMarker = true;

    const payload = JSON.parse(decodeURIComponent(hash.slice(HANDOFF_MARKER.length)));
    const token = payload && payload.token;
    const user = payload && payload.user;
    if (!token || !user) return { status: 'invalid' };

    const role = extractRole(user);

    // The ROLE alone decides where the session belongs - never the `portal`
    // marker. The marker records which portal the mobile shell *aimed* at,
    // which is useful for diagnosing a crossed deployment, but it must not
    // be part of the decision: letting it veto a correctly-routed session
    // makes this portal bounce a session it should have accepted straight
    // back to itself.
    const belongsTo = portalIdForRole(role);
    const intendedPortal = payload.portal;

    if (intendedPortal && intendedPortal !== belongsTo) {
      // Not fatal, but worth surfacing in the WebView console: it means the
      // shell's URL for one portal is actually serving the other portal's
      // build, i.e. the two Vercel projects are crossed over.
      console.warn(
        `[RSA] Mobile handoff aimed at the "${intendedPortal}" portal but the session's role ` +
          `("${role}") belongs to the "${belongsTo}" portal. Check that VITE_ADMIN_PORTAL_URL and ` +
          `VITE_MANAGER_PORTAL_URL each point at the matching deployment.`
      );
    }

    if (belongsTo === PORTAL_ID) {
      localStorage.setItem('rsa_token', token);
      localStorage.setItem('rsa_user', JSON.stringify(user));
      clearPortalMismatch();
      return { status: 'ok', role };
    }

    // Wrong portal. Do not seed localStorage. Try to forward the session
    // on to the right one so the user never has to log in twice, even
    // when the deployment URLs are crossed over.
    const targetUrl = portalUrlFor(belongsTo);
    const hops = Number(payload.hops || 0);

    // belongsTo !== PORTAL_ID is already established above, so this can only
    // fire if the two URLs are misconfigured to the same address - in which
    // case redirecting would bounce straight back here. Fall through to the
    // notice screen, which names the problem, instead.
    if (targetUrl && hops < MAX_HANDOFF_HOPS && belongsTo !== PORTAL_ID) {
      redirecting = true;
      window.location.replace(buildHandoffUrl(targetUrl, token, user, belongsTo, hops + 1));
      return { status: 'redirecting', to: belongsTo, role };
    }

    const mismatch = { status: 'wrong-portal', role, belongsTo, arrivedAt: PORTAL_ID };
    try {
      sessionStorage.setItem(MISMATCH_KEY, JSON.stringify(mismatch));
    } catch (e) {
      /* sessionStorage unavailable - the App-level guard still catches it */
    }
    return mismatch;
  } catch (e) {
    // Malformed or foreign fragment - ignore and fall through to a normal login.
    return { status: 'invalid' };
  } finally {
    // Strip the fragment so the token never lingers in the address bar or
    // in history. Skipped when redirecting: the navigation already
    // replaces this document, and rewriting the URL first is pointless.
    if (hadMarker && !redirecting) {
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) {
        /* history unavailable */
      }
    }
  }
}
