// uuid.js — Generador de UUID v4 válido en contextos NO seguros.
//
// crypto.randomUUID() es SecureContext-only → en http://<IP-LAN> (no localhost, no
// https) es `undefined` y lanzaría TypeError. crypto.getRandomValues() SÍ está
// disponible en contexto inseguro, así que ahí construimos el v4 a partir de 16
// bytes aleatorios con el formato RFC 4122. Sin Math.random y sin dependencias.
export function uuidv4() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  // Fallback (contexto inseguro): 16 bytes CSPRNG → UUID v4 con version/variant fijos.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante 10xx
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
