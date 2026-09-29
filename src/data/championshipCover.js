// Paleta de PORTADA de Campeonatos. cover_theme se persiste como hex CRUDO en DB (no un token).
// El azul de portada se hizo más profundo/saturado (#0B5FD0) para NO confundirse con el azul de
// marca (#3F5FE0) del holder de Inscripciones. El azul legacy (#0EA5E9, cyan) se remapea SOLO a
// nivel VISUAL con coverColor(): no cambia el valor guardado en DB.
export const COVER_BLUE = '#0B5FD0';   // azul de portada nuevo (deep azure)
const LEGACY_COVER_BLUE = '#0EA5E9';   // cyan anterior (persistido en campeonatos ya creados)

// Paleta seleccionable (rojo, azul, verde, ámbar, morado). Solo cambió la tonalidad del azul.
export const COVER_THEMES = ['#E24A4A', COVER_BLUE, '#2E9E5B', '#F5A524', '#8E44AD'];

// Color a PINTAR para un cover_theme dado. Remapea el azul legacy al nuevo sin tocar el dato en DB.
export function coverColor(hex) {
  return hex === LEGACY_COVER_BLUE ? COVER_BLUE : hex;
}

// Theme ALEATORIO de la paleta existente (para el default de un campeonato NUEVO). Reutiliza COVER_THEMES;
// no crea themes nuevos. Puede repetirse entre campeonatos. Llamar una sola vez al iniciar la creación.
export function randomCoverTheme() {
  return COVER_THEMES[Math.floor(Math.random() * COVER_THEMES.length)];
}
