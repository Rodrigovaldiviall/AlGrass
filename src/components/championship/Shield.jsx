// Escudo (SVG) del .md §18. Muestra las INICIALES del equipo (centralizadas aquí).
// `dashed` = silueta punteada (slot sin equipo). `name` vacío → sin texto (escudos pequeños).
const PATH = 'M50 4 L92 20 V56 C92 88 72 104 50 112 C28 104 8 88 8 56 V20 Z';

// Iniciales: trim → separar por espacios (ignora múltiples) → 1ª letra de cada palabra →
// mayúscula → máximo 4 (regla futura: nombre de equipo = máx 4 palabras).
export function teamInitials(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 4).toUpperCase();
}

export default function Shield({ color = '#5B6470', name, size = 68, dashed = false }) {
  if (dashed) {
    return (
      <svg viewBox="0 0 100 112" width={size} height={size * 1.12} style={{ display: 'block', flexShrink: 0 }}>
        <path d={PATH} fill="none" stroke="#C7C7CC" strokeWidth="3" strokeDasharray="6 5" />
      </svg>
    );
  }
  const ini = teamInitials(name);
  const fs = ini.length <= 2 ? 32 : ini.length === 3 ? 26 : 21; // que 4 iniciales quepan sin agrandar el escudo
  return (
    <svg viewBox="0 0 100 112" width={size} height={size * 1.12} style={{ display: 'block', flexShrink: 0 }}>
      <path d={PATH} fill={color} />
      {ini && (
        <text x="50" y="62" textAnchor="middle" fill="#fff" fontWeight="800" fontSize={fs} style={{ letterSpacing: -0.5 }}>{ini}</text>
      )}
    </svg>
  );
}
