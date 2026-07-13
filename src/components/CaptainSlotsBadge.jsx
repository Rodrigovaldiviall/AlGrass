// Indicador secundario de "reserva de cupos" del sistema de capitanes.
// Reutiliza el MISMO escudo de Capitán de la app como fondo del badge y muestra
// dentro la fracción reserved_slots_used / reserved_slots_total (no remaining).
// Colores de la insignia: Capitán → azul, Capitán Gold → dorado.
export default function CaptainSlotsBadge({ used = 0, total = 0, gold = false, size = 28 }) {
  // captain → rojo, captain_gold → dorado (mismo criterio que el icono del avatar).
  const color = gold ? '#F5B301' : '#E5383B';
  return (
    <div style={{ position: 'relative', width: size, height: size, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
        <path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 8.8-4.1-1.2-7-4.6-7-8.8V6l7-3z" fill={color} stroke={color} strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 2, fontSize: size * 0.32, fontWeight: 800, color: '#fff', letterSpacing: -0.4, lineHeight: 1, whiteSpace: 'nowrap' }}>
        {used}/{total}
      </span>
    </div>
  );
}
