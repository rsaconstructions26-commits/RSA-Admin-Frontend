import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { consumeMobileHandoff } from './portalSession.js';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { ViewportProvider } from './context/ViewportContext.jsx';
import './styles/app.css';
import './styles/print.css';

// --- RSA mobile app SSO handoff --------------------------------------------
// The RSA mobile app (Capacitor WebView shell) signs a user in once against
// the shared backend, works out whether the account is an admin/staff
// account or a manager account, then navigates its WebView straight to the
// matching portal with the session carried in a URL *hash* fragment - never
// sent to any server, never logged, and invisible to a normal browser visit.
//
// The logic now lives in portalSession.js so the Admin and Manager copies
// cannot drift apart. The important change from the previous inline version:
// the session is written to localStorage ONLY if it actually belongs to this
// portal. A session for the other portal is forwarded there instead of being
// accepted here, which is what used to let admin credentials open the
// Manager portal. See portalSession.js for the full explanation.
//
// This must run before ReactDOM.createRoot(...).render(...) below, because
// AuthProvider reads localStorage in its useState initialiser. Note that ES
// module imports are hoisted and all run first regardless of where this call
// sits in the file - that is fine, because none of those imports read
// localStorage at import time; only rendering does.
const handoff = consumeMobileHandoff();

// When the session was for the other portal, portalSession has already
// called location.replace() to forward it. Mounting React on a document
// that is being navigated away from just causes a flash of the login
// screen, so skip it.
if (handoff.status !== 'redirecting') {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <ViewportProvider>
          <ThemeProvider>
            <LanguageProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </LanguageProvider>
          </ThemeProvider>
        </ViewportProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}
