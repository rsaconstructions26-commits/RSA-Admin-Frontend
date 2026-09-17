import React from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';

/**
 * Two-option segmented toggle for the language.
 *
 * This replaces a dropdown that was being given the old `.lang-select` styling
 * meant for a native <select>: the pill padding/border landed on the wrapper
 * while the trigger button drew its own box inside it, which is the
 * "box inside the circle" on the login card. A language switch with exactly
 * two options should not be a dropdown anyway - one tap instead of two.
 */
export default function LanguageToggle({ className = '' }) {
  const { language, setLanguage } = useLanguage();
  const OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'ta', label: 'தமிழ்' },
  ];

  return (
    <div className={`lang-toggle ${className}`.trim()} role="group" aria-label="Language">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`lang-toggle-option${language === o.value ? ' is-active' : ''}`}
          aria-pressed={language === o.value}
          onClick={() => setLanguage(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
