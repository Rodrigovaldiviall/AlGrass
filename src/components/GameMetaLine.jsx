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
      {(() => {
        // Prioridad de renderizado: Femenino → Filmado → Parking → Techado → resto.
        // El primero presente muestra icono + texto (según espacio); los demás, solo icono.
        const items = [];
        if (womenOnly) items.push({ icon: I.female(SUB), text: 'Femenino', showText: !hasSubs && !is90min });
        if (filmed)    items.push({ icon: I.camera(SUB), text: 'Filmado',  showText: !hasSubs });
        if (parking)   items.push({ icon: ParkingIcon(), text: 'Est.',     showText: !hasSubs });
        if (covered)   items.push({ icon: I.roof(SUB),   text: 'Cubierta', showText: !hasSubs });
        if (!items.length) return null;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, overflow: 'hidden' }}>
            {items.map((it, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {it.icon}
                {i === 0 && it.showText && <span style={{ whiteSpace: 'nowrap' }}>{it.text}</span>}
              </span>
            ))}
          </span>
        );
      })()}
    </>
  );
}
