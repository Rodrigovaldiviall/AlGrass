// Selector de VENUE para el detalle de un campeonato MULTI-VENUE. Su ÚNICA función es elegir qué venue se
// muestra en el bloque de sede/dirección (visualización local, no escribe DB, no filtra fixture). Presentacional:
// el padre controla la lista (venues), el índice seleccionado (selectedIndex) y aplica en onSelect(index). Al
// tocar una fila se aplica y se cierra de inmediato (no hay "Guardar", el cambio es solo de vista).
import { TEXT, SUB, HAIR, BLUE } from '../../constants';

export default function VenuePickerSheet({ open, venues = [], selectedIndex = 0, onSelect, onCancel }) {
  if (!open) return null;
  return (
    <div className="sheet-overlay" onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 12px calc(16px + env(safe-area-inset-bottom))' }}>
      <div className="sheet-panel no-sb" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, padding: 18, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>Selecciona una sede</div>
        <div className="no-sb" style={{ flex: 1, minHeight: 80, maxHeight: '60vh', overflowY: 'auto', marginTop: 12 }}>
          {venues.map((v, i) => {
            const sel = i === selectedIndex;
            const addr = `${v.venue_address ?? ''}${v.district ? (v.venue_address ? ' · ' : '') + v.district : ''}`;
            return (
              <button key={v.venue_id || i} onClick={() => onSelect(i)} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 8px', borderRadius: 12, border: sel ? `1.5px solid ${BLUE}` : '1.5px solid transparent', background: sel ? '#EAF1FD' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.venue_name || 'Sede'}</div>
                  {addr && <div style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr}</div>}
                </div>
                {sel && <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}><path d="M3.5 9.5l3.5 3.5 7-8" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', marginTop: 14 }}>
          <button onClick={onCancel} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
