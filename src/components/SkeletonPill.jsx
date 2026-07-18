// Efecto de carga (skeleton) reutilizable: mismo pulse gris del badge de la lista.
// className por defecto 'game-status-pill' (comportamiento original de la lista);
// se puede sobreescribir className/style para adaptarlo (p. ej. barra de acción full-width).
export default function SkeletonPill({ className = 'game-status-pill', style }) {
  return (
    <div className={className} style={{
      height: 22, minWidth: 64, borderRadius: 999,
      background: '#E8E8EC',
      animation: 'pulse 1.4s ease-in-out infinite',
      flexShrink: 0,
      ...style,
    }} />
  );
}
