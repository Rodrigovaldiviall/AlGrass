import { useSheetSnap } from '../hooks/useSheetSnap';

const EASE = 'transform .32s cubic-bezier(0.32,0.72,0,1)';
const CLOSED = 2; // último snap = cerrado

// BottomSheet de venue compartido por PickupGames y Fields.
// index: 0=100% · 1=40% · 2=cerrado (controlado por el padre).
// onSettle(i): el drag eligió el snap i. onClosed(): la sheet terminó de bajar a cerrado.
// onRequestClose(): botón ✕ → el padre pone index=CLOSED para animar el cierre.
export default function VenueBottomSheet({ venueName, index, onSettle, onClosed, onRequestClose, children }) {
  const { rootRef, scrollRef, offset, dragging } = useSheetSnap({ index, onSettle });

  return (
    <div
      ref={rootRef}
      onTransitionEnd={(e) => { if (e.propertyName === 'transform' && !dragging && index === CLOSED) onClosed(); }}
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: '100%',
        background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
        transform: offset == null ? 'translateY(100%)' : `translateY(${offset}px)`,
        transition: dragging ? 'none' : EASE,
        display: 'flex', flexDirection: 'column',
        willChange: 'transform',
      }}>
      {/* Header: grabber + chip + ✕ (zona de agarre; el drag nace aquí o en la lista) */}
      <div style={{ flexShrink: 0, padding: '6px 0 4px', touchAction: 'none' }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: '#D0D0D6', margin: '0 auto 6px' }} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
            padding: '4px 6px 4px 10px', borderRadius: 999,
            background: 'rgba(245,200,66,0.22)', border: '1px solid rgba(212,150,10,0.35)',
            color: '#7A5A06', fontSize: 12.5, fontWeight: 600,
          }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{venueName}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRequestClose(); }}
              style={{
                flexShrink: 0, width: 16, height: 16, borderRadius: '50%', border: 'none',
                background: 'rgba(212,150,10,0.25)', color: '#7A5A06', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                fontSize: 10, lineHeight: 1, WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>✕</button>
          </div>
        </div>
      </div>
      {/* Lista scrolleable */}
      <div ref={scrollRef} className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', paddingTop: 0, paddingBottom: 8 }}>
        {children}
      </div>
    </div>
  );
}
