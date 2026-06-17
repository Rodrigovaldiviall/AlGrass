import { TEXT, SUB } from './constants';

const I = {
  back: (c = '#fff') => (
    <svg width="11" height="20" viewBox="0 0 11 20" fill="none">
      <path d="M10 1L1 10l9 9" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  filtersBig: (c = TEXT) => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M2 5h16M5 10h10M8 15h4" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  plus: (c = TEXT) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1.5v11M1.5 7h11" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  camera: (c = TEXT) => (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
      <rect x="1.5" y="4.5" width="9" height="7" rx="2" stroke={c} strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M10.5 7l4-2.2v6.4L10.5 9z" stroke={c} strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  twoPeople: (c = TEXT) => (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <circle cx="6" cy="4" r="2.4" stroke={c} strokeWidth="1.5"/>
      <path d="M1.5 13c0-2.3 2-4 4.5-4s4.5 1.7 4.5 4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="13" cy="5" r="2" stroke={c} strokeWidth="1.5"/>
      <path d="M11 13c0-1.9 1.6-3.3 3.5-3.3S18 11.1 18 13" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  roof: (c = TEXT) => (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
      <path d="M1 8L7 2l6 6" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 8v3h9V8" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  female: (c = TEXT) => (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
      <circle cx="6" cy="5" r="3.6" stroke={c} strokeWidth="1.6"/>
      <path d="M6 8.6V15M3.6 12.5h4.8" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  pin: (c = SUB) => (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
      <path d="M5 1.2c2 0 3.5 1.5 3.5 3.4 0 2.5-3.5 6-3.5 6S1.5 7.1 1.5 4.6C1.5 2.7 3 1.2 5 1.2z" stroke={c} strokeWidth="1.2"/>
      <circle cx="5" cy="4.7" r="1.1" stroke={c} strokeWidth="1.2"/>
    </svg>
  ),
  chev: (c = '#C7C7CC') => (
    <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
      <path d="M1 1l6 5.5L1 12" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  search: (c) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke={c} strokeWidth="1.8"/>
      <path d="M16 16l4.5 4.5" stroke={c} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  fields: (c) => (
    <svg width="26" height="24" viewBox="0 0 26 24" fill="none">
      <rect x="2" y="5" width="22" height="14" rx="1.2" stroke={c} strokeWidth="1.6"/>
      <path d="M13 5v14" stroke={c} strokeWidth="1.6"/>
      <circle cx="13" cy="12" r="2" stroke={c} strokeWidth="1.6"/>
      <path d="M2 9h3v6H2M24 9h-3v6h3" stroke={c} strokeWidth="1.6"/>
    </svg>
  ),
  bell: (c) => (
    <svg width="22" height="24" viewBox="0 0 22 24" fill="none">
      <path d="M11 3.2c-3.3 0-6 2.7-6 6V13l-2 3.2h16L17 13V9.2c0-3.3-2.7-6-6-6z" stroke={c} strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M9 19.2c.3 1 1.1 1.6 2 1.6s1.7-.6 2-1.6" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  profile: (c) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9.5" stroke={c} strokeWidth="1.6"/>
      <circle cx="12" cy="10" r="3.2" stroke={c} strokeWidth="1.6"/>
      <path d="M5.5 19.5c1.4-2.7 3.8-4 6.5-4s5.1 1.3 6.5 4" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  share: (c = '#fff') => (
    <svg width="23" height="26" viewBox="0 0 18 20" fill="none">
      <path d="M9 1v12M5 5l4-4 4 4" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 9v8.5C2 18.3 2.7 19 3.5 19h11c.8 0 1.5-.7 1.5-1.5V9" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  cal: (c = SUB) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3.5" width="12" height="11" rx="1.5" stroke={c} strokeWidth="1.4"/>
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke={c} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  fieldIcon: (c = SUB) => (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
      <rect x="1" y="2" width="14" height="10" rx="1" stroke={c} strokeWidth="1.3"/>
      <path d="M8 2v10" stroke={c} strokeWidth="1.3"/>
      <circle cx="8" cy="7" r="1.4" stroke={c} strokeWidth="1.3"/>
      <path d="M1 5h2v4H1M15 5h-2v4h2" stroke={c} strokeWidth="1.3"/>
    </svg>
  ),
  sub: (c = TEXT) => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="5" cy="3.5" r="2" stroke={c} strokeWidth="1.3"/>
      <path d="M1 11c0-2.2 1.8-4 4-4" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="9.5" cy="8" r="1.5" stroke={c} strokeWidth="1.3"/>
      <path d="M7 12c0-1.4 1.1-2.5 2.5-2.5S12 10.6 12 12" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  joinIcon: (c = '#1B1B1F') => (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <circle cx="6" cy="4" r="2.5" stroke={c} strokeWidth="1.6"/>
      <path d="M1.5 13c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M13.5 5.5v3M12 7h3" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  arrowUp: (c = '#3F5FE0') => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 10V2M2 5.5L6 1.5l4 4" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

export default I;
