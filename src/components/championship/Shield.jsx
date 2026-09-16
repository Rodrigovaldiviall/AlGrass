// Escudo (SVG) del .md §18. Muestra las INICIALES del equipo (centralizadas aquí).
// Soporta `design` {type,colors}: sólido o patrón (franjas, diagonal, damero, mitad/mitad),
// clip a la silueta. Compat: si no hay design, usa `color` como sólido.
// `dashed` = silueta punteada (slot sin equipo). `name` vacío → sin texto (escudos pequeños).
import { useId } from 'react';

const PATH = 'M50 4 L92 20 V56 C92 88 72 104 50 112 C28 104 8 88 8 56 V20 Z';

// Iniciales: trim → separar por espacios (ignora múltiples) → 1ª letra de cada palabra →
// mayúscula → máximo 4 (regla futura: nombre de equipo = máx 4 palabras).
export function teamInitials(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 4).toUpperCase();
}

// Capas de relleno del diseño en un lienzo w×h. Reutilizado por el escudo grande y por el swatch.
export function designLayers(design, w, h) {
  const cols = (design && design.colors && design.colors.length) ? design.colors : ['#5B6470'];
  const a = cols[0]; const b = cols[1] || cols[0];
  const type = (design && design.type) || 'solid';
  if (type === 'stripes') { // franjas verticales
    const n = 5, sw = w / n;
    return Array.from({ length: n }, (_, i) => <rect key={i} x={i * sw} y={-2} width={sw + 0.7} height={h + 4} fill={i % 2 ? b : a} />);
  }
  if (type === 'diagonal') { // franjas diagonales (45°)
    const band = w / 5, rects = []; let idx = 0;
    for (let y = -h; y < h * 2; y += band) { rects.push(<rect key={idx} x={-w} y={y} width={w * 3} height={band + 0.7} fill={idx % 2 ? b : a} />); idx++; }
    return [<rect key="bg" x={-2} y={-2} width={w + 4} height={h + 4} fill={a} />, <g key="g" transform={`rotate(45 ${w / 2} ${h / 2})`}>{rects}</g>];
  }
  if (type === 'checker') { // damero
    const nc = 5, nr = 5, cw = w / nc, ch = h / nr, out = [];
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) out.push(<rect key={r + '-' + c} x={c * cw} y={r * ch} width={cw + 0.5} height={ch + 0.5} fill={(r + c) % 2 ? b : a} />);
    return out;
  }
  if (type === 'split') { // mitad y mitad (izquierda/derecha)
    return [<rect key="l" x={-2} y={-2} width={w / 2 + 2} height={h + 4} fill={a} />, <rect key="r" x={w / 2} y={-2} width={w / 2 + 2} height={h + 4} fill={b} />];
  }
  return [<rect key="s" x={-2} y={-2} width={w + 4} height={h + 4} fill={a} />]; // solid
}

export default function Shield({ color = '#5B6470', design, name, size = 68, dashed = false }) {
  const rid = useId().replace(/[:]/g, '');
  if (dashed) {
    return (
      <svg viewBox="0 0 100 112" width={size} height={size * 1.12} style={{ display: 'block', flexShrink: 0 }}>
        <path d={PATH} fill="none" stroke="#C7C7CC" strokeWidth="3" strokeDasharray="6 5" />
      </svg>
    );
  }
  const d = design || { type: 'solid', colors: [color] };
  const ini = teamInitials(name);
  const fs = ini.length <= 2 ? 32 : ini.length === 3 ? 26 : 21; // que 4 iniciales quepan sin agrandar el escudo
  const cid = 'shc' + rid;
  return (
    <svg viewBox="0 0 100 112" width={size} height={size * 1.12} style={{ display: 'block', flexShrink: 0 }}>
      <defs><clipPath id={cid}><path d={PATH} /></clipPath></defs>
      <g clipPath={`url(#${cid})`}>{designLayers(d, 100, 112)}</g>
      <path d={PATH} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth="1.5" />
      {ini && (
        // Contorno oscuro (paint-order stroke) para legibilidad sobre cualquier color/patrón.
        <text x="50" y="62" textAnchor="middle" fill="#fff" stroke="rgba(17,19,26,0.60)" strokeWidth={ini.length <= 2 ? 3.6 : 2.8} paintOrder="stroke" strokeLinejoin="round" fontWeight="800" fontSize={fs} style={{ letterSpacing: -0.5 }}>{ini}</text>
      )}
    </svg>
  );
}

// Miniatura circular del diseño para el selector (muestra el patrón real).
export function DesignSwatch({ design, size = 32 }) {
  const rid = useId().replace(/[:]/g, '');
  const cid = 'swc' + rid;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block' }}>
      <defs><clipPath id={cid}><circle cx="50" cy="50" r="49" /></clipPath></defs>
      <g clipPath={`url(#${cid})`}>{designLayers(design, 100, 100)}</g>
      <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth="2" />
    </svg>
  );
}
