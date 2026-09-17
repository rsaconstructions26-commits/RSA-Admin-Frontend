import React, { useMemo, useState } from 'react';

/**
 * Item: one reusable search box for every list/tab in the system.
 *
 * Deliberately dumb - it only tracks the typed text and renders a
 * consistently-styled, properly-aligned input with a search icon and a clear
 * ("x") button. Each page decides what to filter with `useSearch` below, so
 * this component never needs to know the shape of the data it's searching.
 */
export default function SearchBox({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <div className={`search-box ${className}`.trim()}>
      <svg className="search-box-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="search-box-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="search-box-clear"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Small helper hook: `useSearch(rows, fields)` returns [query, setQuery, filteredRows].
// `fields` is an array of either a key name or a function(row) -> string.
// Matching is case-insensitive substring, across all given fields OR'd together.
export function useSearch(rows, fields) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const list = rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) =>
      fields.some((f) => {
        const v = typeof f === 'function' ? f(row) : row?.[f];
        return String(v ?? '').toLowerCase().includes(q);
      })
    );
  }, [rows, query, fields]);
  return [query, setQuery, filtered];
}
