import I from '../icons';
import { TEXT, HAIR } from '../constants';

// Chips de amenities reutilizables. Recibe un array [{ kind, label }] (mismo formato
// que g.chips en GameDetail / FieldDetail) y los renderiza con el estilo existente.

const _ParkingIcon = (c = TEXT) => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
    <path d="M3 2v9M3 2h3c1.3 0 2.5 1.1 2.5 2.5S7.3 7 6 7H3" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const _ShowerIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M1.5 4.5h10M3 4.5V3c0-.8.7-1.5 1.5-1.5h4C9.3 1.5 10 2.2 10 3v1.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3 8v.8M6.5 7.5v.8M10 8v.8M4.5 10.5v.8M8 10v.8" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const _StarIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5l1.5 3.2 3.5.5-2.5 2.4.6 3.5L7 9.4l-3.1 1.7.6-3.5L2 5.2l3.5-.5L7 1.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);
const CHIP_ICON = {
  format:    I.twoPeople,
  filmed:    I.camera,
  covered:   I.roof,
  women:     I.female,
  spots:     I.plus,
  master45:  _StarIcon,
  parking:   _ParkingIcon,
  showers:   _ShowerIcon,
  suplentes: I.sub,
};

function Chip({ kind, label, icon: iconProp }) {
  // Soporta dos formatos de chip: { kind, label } (GameDetail/FieldDetail) y { label, icon } (RentalDetail).
  const icon = kind ? CHIP_ICON[kind] : (typeof iconProp === 'function' ? iconProp : null);
  const isSubs = kind === 'suplentes';
  return (
    <div style={{
      flex: '0 0 auto', height: isSubs ? 'auto' : 28, padding: isSubs ? '4px 10px' : '0 10px',
      borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      color: TEXT, fontSize: 'var(--gd-is, 12px)', fontWeight: 500,
      whiteSpace: isSubs ? 'normal' : 'nowrap',
    }}>
      {icon ? icon(TEXT) : null}
      {isSubs
        ? <span style={{ lineHeight: 1.2, textAlign: 'center' }}>Con<br/>suplentes</span>
        : <span>{label}</span>
      }
    </div>
  );
}

export default function AmenityChips({ chips = [] }) {
  if (!chips.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {chips.map((c, i) => <Chip key={i} kind={c.kind} label={c.label} icon={c.icon} />)}
    </div>
  );
}
