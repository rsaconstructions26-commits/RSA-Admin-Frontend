/**
 * Item B: "data doesn't go to the next field and gets stuck".
 *
 * None of the forms handled Enter at all, so pressing it either submitted a
 * half-filled form or appeared to do nothing, and staff on a phone keyboard
 * (whose "next" key sends Enter) had no way to move between fields without
 * tapping each one. This moves focus to the next control instead, the way a
 * data-entry form is expected to behave, and only submits when the last field
 * is reached or the user actually presses the submit button.
 *
 * Attach to the <form>, not to each input:
 *     <form onKeyDown={advanceOnEnter}>
 *
 * Deliberately left alone: textareas (Enter means newline), buttons, and
 * anything that opts out with data-enter-submit.
 */
const FOCUSABLE =
  'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[type=submit], [role=combobox], .rsa-select-trigger, .date-field-box';

export function advanceOnEnter(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;

  const el = e.target;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea') return;
  if (tag === 'button') return;
  if (el.dataset && el.dataset.enterSubmit === 'true') return;

  const form = e.currentTarget;
  const fields = Array.from(form.querySelectorAll(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === el
  );
  const i = fields.indexOf(el);
  if (i === -1) return;

  const next = fields[i + 1];
  // Last field: let the browser submit the form as usual.
  if (!next) return;

  e.preventDefault();
  next.focus();
  if (typeof next.select === 'function' && next.type !== 'date') {
    try {
      next.select();
    } catch {
      /* not all inputs support select() */
    }
  }
}

export default advanceOnEnter;
