// ── AttendanceBadge — estado de asistencia derivado de checked_in_at + timing ──
// Compartido por Match (game_players.checked_in_at, por jugador) y Rental
// (games.booker_checked_in_at, un único booker). Agnóstico a la fuente: recibe un
// timestamp `checkedInAt` + los handlers. Extraído de GameDetail SIN cambios de lógica.
import { SUB, GREEN, ORANGE, BLUE } from '../constants';
import { deriveAttendance } from '../utils/deriveGameState';

function ResetBtn({ onReset }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onReset(); }}
      style={{
        flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
        border: 'none', background: 'rgba(0,0,0,0.08)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', outline: 'none', padding: 0,
        WebkitTapHighlightColor: 'transparent',
      }}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke={SUB} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

export default function AttendanceBadge({ checkedInAt, gameStart, isPast, canMark, onMark, canReset, onReset, attendedOnly = false }) {
  const att = deriveAttendance(checkedInAt, gameStart, isPast);
  if (att) {
    // attendedOnly (p.ej. Rental): colapsa a_tiempo/tarde en un único "Asistió",
    // sin puntualidad. 'ausente' se mantiene igual. Match no pasa la prop → intacto.
    if (attendedOnly && (att.status === 'a_tiempo' || att.status === 'tarde')) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5l2.5 2.5 5.5-5.5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap' }}>Asistió</span>
          {canReset && <ResetBtn onReset={onReset} />}
        </div>
      );
    }
    if (att.status === 'a_tiempo') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5l2.5 2.5 5.5-5.5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap' }}>A tiempo</span>
          {canReset && <ResetBtn onReset={onReset} />}
        </div>
      );
    }
    if (att.status === 'tarde') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, whiteSpace: 'nowrap' }}>
            {att.minsLate} min tarde
          </span>
          {canReset && <ResetBtn onReset={onReset} />}
        </div>
      );
    }
    return (
      <span style={{ fontSize: 11, fontWeight: 600, color: SUB, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Ausente
      </span>
    );
  }
  if (!canMark) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); onMark(); }}
      style={{
        flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999,
        border: 'none', background: BLUE,
        fontSize: 12, fontWeight: 700, color: '#fff',
        cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
        boxShadow: '0 2px 8px rgba(0,123,255,0.35)',
      }}>
      Asistencia
    </button>
  );
}
