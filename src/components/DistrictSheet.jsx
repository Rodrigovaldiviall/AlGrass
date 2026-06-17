import { useState, useEffect } from 'react';
import { BLUE, TEXT, SUB, HAIR } from '../constants';
import { useSheetPull } from '../hooks/useSheetPull';

const EASE = 'transform .28s cubic-bezier(0.32,0.72,0,1)';

// Filtro de distritos: multi-select. La ciudad es informativa (no editable).
// selected = [] significa "todos los distritos".
export default function DistrictSheet({ city, districts, selected, onToggle, onClear, onClose }) {
  const [visible, setVisible] = useState(false);                 // entrada/salida (slide)
  useEffect(() => { const r = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(r); }, []);
  const startExit = () => setVisible(false);                      // anima salida; onClose real al terminar
  const { rootRef, scrollRef, dragY, dragging } = useSheetPull({ onClose: startExit });
  return (
    <>
      <div onClick={startExit} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div ref={rootRef}
        onTransitionEnd={(e) => { if (e.propertyName === 'transform' && !visible) onClose(); }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
          background: '#fff', borderRadius: '20px 20px 0 0',
          padding: '14px 20px calc(env(safe-area-inset-bottom) + 24px)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          maxHeight: '72%', display: 'flex', flexDirection: 'column',
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : EASE,
          willChange: 'transform',
        }}>
        <div>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E0E0E6', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Distritos</div>
            {selected.length > 0 && (
              <button onClick={onClear} style={{
                padding: '4px 0', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: BLUE, fontFamily: 'inherit',
                outline: 'none', WebkitTapHighlightColor: 'transparent',
              }}>Limpiar</button>
            )}
          </div>
          <div style={{ fontSize: 13, color: SUB, marginTop: 2, paddingBottom: 12, marginBottom: 4, borderBottom: `1px solid ${HAIR}` }}>{city}</div>
        </div>
        <div ref={scrollRef} className="no-sb" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column' }}>
          {districts.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: SUB, fontSize: 14 }}>
              No hay distritos disponibles.
            </div>
          ) : districts.map(d => {
            const on = selected.includes(d);
            return (
              <button key={d} onClick={() => onToggle(d)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${HAIR}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  border: `1.5px solid ${on ? BLUE : HAIR}`, background: on ? BLUE : '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5L9.8 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </span>
                <span style={{ fontSize: 15, color: TEXT, fontWeight: 500 }}>{d}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
