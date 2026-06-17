import I from '../icons';
import { SUB } from '../constants';
import { requiredPlayers } from '../utils/deriveGameState';

const ParkingIcon = (c = SUB) => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
    <path d="M3 2v9M3 2h3c1.3 0 2.5 1.1 2.5 2.5S7.3 7 6 7H3" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/**
 * Fila secundaria de metadata de partido: format · 90' oficial · Con suplentes · amenities.
 * Renders as a fragment — el padre controla gap, fontSize base y color.
 * Props: format, totalSpots, durationMin, womenOnly, parking, covered, filmed
 */
export function GameMetaLine({ format, totalSpots, durationMin, womenOnly, parking, covered, filmed }) {
  const hasSubs   = (totalSpots ?? 0) > requiredPlayers(format);
  const is90min   = durationMin === 90;
  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 13, fontWeight: 500 }}>
        {I.twoPeople(SUB)}<span>{format}</span>
      </span>
      {is90min && (
        <span style={{ flexShrink: 0, lineHeight: 1.2, textAlign: 'center' }}>90'<br/>oficial</span>
      )}
      {hasSubs && (
        is90min
          ? <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>{I.sub(SUB)}</span>
          : <span style={{ flexShrink: 0, lineHeight: 1.2, textAlign: 'center' }}>Con<br/>suplentes</span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, overflow: 'hidden' }}>
        {womenOnly ? (
          <>
            {I.female(SUB)}{!hasSubs && !is90min && <span style={{ whiteSpace: 'nowrap' }}>Femenino</span>}
            {parking && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{ParkingIcon()}</span>}
            {covered && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{I.roof(SUB)}</span>}
          </>
        ) : parking ? (
          <>
            {ParkingIcon()}{!hasSubs && <span style={{ whiteSpace: 'nowrap' }}>Est.</span>}
            {covered && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{I.roof(SUB)}</span>}
          </>
        ) : covered ? (
          <>{I.roof(SUB)}{!hasSubs && <span style={{ whiteSpace: 'nowrap' }}>Cubierta</span>}</>
        ) : null}
      </span>
      {filmed && (
        <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
          {I.camera(SUB)}
        </span>
      )}
    </>
  );
}
