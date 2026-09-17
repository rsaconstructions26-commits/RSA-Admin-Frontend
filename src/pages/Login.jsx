import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import logoImg from '../logo/logoo2.png';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { t, language, setLanguage } = useLanguage();
  const [email, setEmail] = useState('admin@rsaconstruction.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      // A bare "Login failed" told nobody anything. The three cases below are
      // genuinely different problems and each needs a different action:
      //   401  - the credentials really are wrong
      //   5xx  - the API is up but broke (usually a bad/missing env var)
      //   none - the request never got a response at all. On Render's free
      //          tier the API sleeps after ~15 min idle and the first request
      //          times out while it wakes, which is what "Login failed" with
      //          no server message almost always is.
      const status = err.response?.status;
      const serverMessage = err.response?.data?.message;
      if (status === 401) {
        setError(serverMessage || 'That email and password do not match an account.');
      } else if (status === 403) {
        setError(serverMessage || 'This account is not allowed to sign in to this portal.');
      } else if (status >= 500) {
        setError(`Server error (${status}). ${serverMessage || 'Please try again in a moment.'}`);
      } else if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
        setError('The server did not respond in time. It may be waking up - press Sign In again in about 30 seconds.');
      } else {
        setError(
          'Could not reach the server. It may be asleep or offline - press Sign In again in about 30 seconds. ' +
            'If this keeps happening, check that the API is running.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-lang-tabs" role="group" aria-label="Language">
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            onClick={() => setLanguage('en')}
          >
            English
          </button>
          <button
            type="button"
            className={language === 'ta' ? 'active' : ''}
            onClick={() => setLanguage('ta')}
          >
            தமிழ்
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0', alignSelf: 'center' }}>
          <div style={{ width: '170px', height: '76px', overflow: 'hidden', position: 'relative' }}>
            <img 
              src={logoImg} 
              alt="RSA Logo" 
              style={{ 
                width: '170px', 
                height: 'auto', 
                position: 'absolute',
                top: 0,
                left: 0,
                filter: 'invert(1) hue-rotate(180deg)' 
              }} 
            />
          </div>
          <div style={{ 
            marginTop: '6px', 
            fontSize: '9.5px', 
            fontWeight: 'bold', 
            letterSpacing: '3.5px', 
            textTransform: 'uppercase', 
            textAlign: 'center', 
            color: '#ffffff',
            opacity: 0.95 
          }}>
            <div>CONSTRUCTION &amp;</div>
            <div style={{ marginTop: '2px' }}>BUILDING MATERIALS</div>
          </div>
        </div>
        <h1>{t('login.title')}</h1>
        <p className="login-sub">{t('login.subtitle')}</p>
        {error && <div className="alert alert-error">{error}</div>}
        <label>{t('login.email')}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="login-password">{t('login.password')}</label>
        {/* Eye toggle so a mistyped password can actually be checked before
            blaming the login. Present on both the Admin and Manager portals. */}
        <div className="password-field">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.2A9.6 9.6 0 0112 5c5 0 9 4.5 9 7 0 1-.7 2.3-1.9 3.5M6.3 6.9C4.2 8.3 3 10.2 3 12c0 2.5 4 7 9 7 1.4 0 2.7-.3 3.8-.9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            )}
          </button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
