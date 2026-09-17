import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Item D: one calendar for the whole system.
 *
 * The portals were showing whatever native date picker the browser or Android
 * WebView happened to ship, which is why the same screen looked different on
 * every device and why the Manager portal never matched the Admin one. This is
 * a plain React calendar - Mon..Sun week, « ‹ Month YYYY › » navigation,
 * today outlined, the selected day filled.
 *
 * Item 1 (2026-09-15): the time picker is a compact Hour : Minute : Second +
 * AM/PM stepper, so any exact time of day can be set without a tall scrolling
 * list. Once a value is applied, the field that opened this picker shows the
 * chosen date (and time, down to the second, when one was set) as plain text
 * - see DateField.jsx's use of formatDisplay below.
 *
 * Values are exchanged as plain 'YYYY-MM-DD' strings when no time has been
 * picked, or 'YYYY-MM-DDTHH:mm:ss' once a time is chosen. Every existing
 * caller that reads only the first 10 characters (`.slice(0, 10)`) keeps
 * working unchanged, since the date portion never moves; callers that used
 * the older 'YYYY-MM-DDTHH:mm' (no seconds) shape still parse fine too.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const pad2 = (n) => String(n).padStart(2, '0');

// Kept for any older code still importing TIME_SLOTS; no longer used by the
// picker UI itself (superseded by the Hour/Minute/Second stepper below).
export const TIME_SLOTS = (() => {
  const slots = [];
  for (let mins = 9 * 60; mins <= 16 * 60 + 30; mins += 30) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h24 >= 12 ? 'PM' : 'AM';
    const h12 = ((h24 + 11) % 12) + 1;
    slots.push({
      value: `${pad2(h24)}:${pad2(m)}`,
      label: `${pad2(h12)}:${pad2(m)} ${suffix}`,
    });
  }
  return slots;
})();

export function toISO(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const m = pad2(dt.getMonth() + 1);
  const day = pad2(dt.getDate());
  return `${dt.getFullYear()}-${m}-${day}`;
}

/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm[:ss]' -> local Date, without the UTC shift `new Date(str)` causes. */
export function fromISO(s) {
  if (!s) return null;
  const [datePart] = String(s).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Pulls 'HH:mm:ss' (or 'HH:mm' if no seconds were stored) out of a value, or '' if no time was set. */
export function timeFromValue(s) {
  if (!s || String(s).indexOf('T') === -1) return '';
  const t = String(s).split('T')[1] || '';
  const m = t.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  return `${m[1]}:${m[2]}:${m[3] || '00'}`;
}

/** Display format used across the portals: 20-Aug-2026, or 20-Aug-2026 09:04:30 AM with a time. */
export function formatDisplay(s) {
  const d = fromISO(s);
  if (!d) return '';
  const datePart = `${pad2(d.getDate())}-${MONTHS[d.getMonth()].slice(0, 3)}-${d.getFullYear()}`;
  const time = timeFromValue(s);
  if (!time) return datePart;
  const [hh, mm, ss] = time.split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = ((hh + 11) % 12) + 1;
  return `${datePart} ${pad2(h12)}:${pad2(mm)}:${pad2(ss || 0)} ${suffix}`;
}

// Monday-first grid, always 6 rows so the popover never changes height as the
// user pages through months (a jumping panel is what made the old picker feel
// unstable on phones).
function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // JS: 0=Sun -> we want 0=Mon
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Splits a 24h 'HH:mm:ss' into a 12h { hour12, minute, second, period }. */
function splitTime(hhmmss) {
  const [hh, mm, ss] = (hhmmss || '09:00:00').split(':').map(Number);
  const h24 = hh || 0;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((h24 + 11) % 12) + 1;
  return { hour12, minute: mm || 0, second: ss || 0, period };
}

/** Joins a 12h { hour12, minute, second, period } back into a 24h 'HH:mm:ss' string. */
function joinTime({ hour12, minute, second, period }) {
  let h = clamp(hour12, 1, 12) % 12;
  if (period === 'PM') h += 12;
  return `${pad2(h)}:${pad2(clamp(minute, 0, 59))}:${pad2(clamp(second, 0, 59))}`;
}

/** Compact Hour : Minute : Second + AM/PM stepper. */
function TimeStepper({ time, onChange }) {
  const { hour12, minute, second, period } = splitTime(time);
  const set = (patch) => onChange(joinTime({ hour12, minute, second, period, ...patch }));
  const committedValue = (key) => (key === 'hour12' ? hour12 : key === 'minute' ? minute : second);

  // Item (2026-09-16): Hour couldn't be edited at all (Min/Sec worked) because
  // Hour's valid range is 1-12, not 0-59 - every keystroke commits straight
  // through set() -> onChange -> the parent's `time` string -> splitTime,
  // and joinTime always stores a fully-clamped 24h value. So the instant you
  // typed a leading "0" (needed for 09, 08, ...), it round-tripped through
  // joinTime's clamp(hour12, 1, 12) and came back as "1" before you could
  // type the second digit - the next digit then landed on "01" instead of
  // completing the number you were typing. Minute/Second have min 0, so a
  // leading "0" was never clamped away and the same round-trip looked fine.
  // `draft` holds the raw digits being typed for whichever field is
  // focused, so the field shows exactly what was typed (including a
  // transient "0") instead of the round-tripped/clamped committed value -
  // it's dropped on blur, when the field falls back to showing the
  // (by-then-valid) committed value.
  const [draft, setDraft] = useState({ key: null, digits: '' });

  const numberField = (key, max, min = 0) => {
    const isDraft = draft.key === key;
    return {
      value: isDraft ? draft.digits : pad2(committedValue(key)),
      onChange: (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(-2);
        setDraft({ key, digits });
        if (digits === '') return;
        const v = clamp(parseInt(digits, 10), min, max);
        set({ [key]: v });
      },
      // Item (2026-09-15): the field's value is always forced back to 2 padded
      // digits (e.g. "09"), so with maxLength=2 the browser refused to insert
      // any further keystroke unless the existing text was already selected -
      // from the user's side this simply looked like the Hour/Min/Sec boxes
      // couldn't be typed into at all. Auto-selecting the whole value on focus
      // (and on click, since a click alone doesn't always re-fire focus) means
      // the very next keystroke always replaces it instead of trying to insert.
      onFocus: (e) => e.target.select(),
      onClick: (e) => e.target.select(),
      onBlur: () => setDraft((d) => (d.key === key ? { key: null, digits: '' } : d)),
    };
  };

  return (
    <div className="rsa-dp-timestepper">
      <div className="rsa-dp-time-field">
        <label>Hour</label>
        {/* Item (2026-09-15): maxLength={2} was removed - the field's value is
            always forced back to 2 padded digits (e.g. "09"), so once it was
            already at that length the browser refused to insert ANY further
            keystroke (even with select-on-focus below fixing the *first*
            keystroke of an edit, every keystroke after that was silently
            swallowed once the value padded back to 2 chars) - from the
            user's side this looked like the box "got stuck" after one digit.
            onChange already takes just the last 2 typed digits itself, so no
            length cap is needed on the input for that to work correctly. */}
        <input className="rsa-dp-time-input" type="text" inputMode="numeric" {...numberField('hour12', 12, 1)} />
      </div>
      <div className="rsa-dp-time-colon">:</div>
      <div className="rsa-dp-time-field">
        <label>Min</label>
        <input className="rsa-dp-time-input" type="text" inputMode="numeric" {...numberField('minute', 59)} />
      </div>
      <div className="rsa-dp-time-colon">:</div>
      <div className="rsa-dp-time-field">
        <label>Sec</label>
        <input className="rsa-dp-time-input" type="text" inputMode="numeric" {...numberField('second', 59)} />
      </div>
      <div className="rsa-dp-ampm">
        <button type="button" className={`rsa-dp-ampm-btn ${period === 'AM' ? 'is-selected' : ''}`} onClick={() => set({ period: 'AM' })}>
          AM
        </button>
        <button type="button" className={`rsa-dp-ampm-btn ${period === 'PM' ? 'is-selected' : ''}`} onClick={() => set({ period: 'PM' })}>
          PM
        </button>
      </div>
      <button
        type="button"
        className="rsa-dp-btn rsa-dp-btn-ghost rsa-dp-now-btn"
        onClick={() => {
          const now = new Date();
          onChange(`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`);
        }}
      >
        Now
      </button>
    </div>
  );
}

export default function DatePicker({ value, onApply, onCancel, min, max, showTime = true }) {
  const selected = fromISO(value);
  const today = new Date();
  const [draft, setDraft] = useState(selected);
  const [cursor, setCursor] = useState(() => selected || today);
  const [time, setTime] = useState(() => timeFromValue(value) || (showTime ? '09:00:00' : ''));
  const rootRef = useRef(null);

  // Escape closes, and the first focusable control takes focus, so the whole
  // thing is usable from the keyboard on the web view.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    rootRef.current?.querySelector('button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const grid = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const minD = fromISO(min);
  const maxD = fromISO(max);

  const shift = (months, years = 0) =>
    setCursor((c) => new Date(c.getFullYear() + years, c.getMonth() + months, 1));

  const sameDay = (a, b) =>
    !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const disabled = (d) => (minD && d < minD) || (maxD && d > maxD);

  const combinedValue = () => {
    const iso = toISO(draft);
    if (!iso) return '';
    return showTime && time ? `${iso}T${time}` : iso;
  };

  const commit = () => onApply?.(combinedValue());

  return (
    <div className={`rsa-datepicker rsa-datepicker-v2 ${showTime ? 'has-time' : ''}`} ref={rootRef} role="dialog" aria-label="Choose a date and time">
      <div className="rsa-dp-calendar">
        <div className="rsa-dp-head">
          <button type="button" className="rsa-dp-nav" aria-label="Previous year" onClick={() => shift(0, -1)}>
            «
          </button>
          <button type="button" className="rsa-dp-nav" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <div className="rsa-dp-title" aria-live="polite">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <button type="button" className="rsa-dp-nav" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
          <button type="button" className="rsa-dp-nav" aria-label="Next year" onClick={() => shift(0, 1)}>
            »
          </button>
        </div>

        <div className="rsa-dp-weekdays">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="rsa-dp-grid">
          {grid.map((d) => {
            const outside = d.getMonth() !== cursor.getMonth();
            const cls = [
              'rsa-dp-day',
              outside ? 'is-outside' : '',
              sameDay(d, today) ? 'is-today' : '',
              sameDay(d, draft) ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                type="button"
                key={d.toISOString()}
                className={cls}
                disabled={disabled(d)}
                aria-current={sameDay(d, today) ? 'date' : undefined}
                aria-pressed={sameDay(d, draft)}
                onClick={() => setDraft(d)}
                onDoubleClick={() => (showTime ? null : onApply?.(toISO(d)))}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <div className="rsa-dp-shortcuts">
          <button type="button" className="rsa-dp-btn rsa-dp-btn-ghost" onClick={() => onApply?.('')}>
            Clear
          </button>
          <button
            type="button"
            className="rsa-dp-btn rsa-dp-btn-ghost"
            onClick={() => {
              setDraft(today);
              setCursor(today);
            }}
          >
            Today
          </button>
        </div>
      </div>

      {showTime && (
        <div className="rsa-dp-timepane rsa-dp-timepane-v2">
          <div className="rsa-dp-timepane-title">
            {draft ? `${FULL_WEEKDAYS[draft.getDay()]}, ${draft.getDate()} ${MONTHS[draft.getMonth()]} ${draft.getFullYear()}` : 'Pick a date'}
          </div>
          <TimeStepper time={time} onChange={setTime} />
        </div>
      )}

      <div className="rsa-dp-footer">
        {/* Item 4 (2026-09-15): the "Selected Date & Time" summary text that used
            to sit here was removed - the picker already shows the chosen day
            highlighted on the calendar and the chosen time in the stepper above,
            and once applied the field itself displays the value (see
            DateField.jsx), so this line was just repeating it inside the popover. */}
        <div className="rsa-dp-commit">
          <button type="button" className="rsa-dp-btn rsa-dp-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="rsa-dp-btn rsa-dp-btn-apply" onClick={commit} disabled={!draft}>
            ✓ Done
          </button>
        </div>
      </div>
    </div>
  );
}
