/**
 * "Rodrigo Valdivia Llerena" → "Rodrigo V."
 * Solo para displays compactos/listados. El nombre completo debe mostrarse en contextos de detalle.
 */
export function abbreviateName(name) {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}
