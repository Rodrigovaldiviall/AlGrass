// Mock 100% frontend para la lista de Campeonatos (B1). Sin Supabase ni lógica de negocio.
// Reemplazable/ampliable cuando conectemos backend. Los campos reflejan la UX del .md §3.
//
//   status:       'open'    → sección "Activos" (inscripciones abiertas)
//                 'results' → sección "Históricos" (resultados)
//   visibility:   'public' | 'private'  (private ⇒ candado en la portada)
//   resultsPublic: si los resultados son visibles para externos (histórico privado)
//   daysAgo:      antigüedad del histórico (para filtrar ≤14 días y el "Hace N días")
//   coverTheme:   color de portada de la tarjeta

export const LIST_CHAMPIONSHIPS = [
  { id: 't1', name: 'Copa Barrio Cayma',                teams: 8,  format: 'Fútbol 7', status: 'open',    visibility: 'public',  resultsPublic: true,  daysAgo: null, coverTheme: '#3F5FE0', dateLabel: '18 oct', venueName: 'Arena Cayma' },
  { id: 't2', name: 'Liga Interna Acme Corp',           teams: 12, format: 'Fútbol 7', status: 'open',    visibility: 'private', resultsPublic: true,  daysAgo: null, coverTheme: '#1F6B36', dateLabel: '25 oct', venueName: 'Complejo Acme' },
  { id: 't3', name: 'Pichanga de Verano Surco',         teams: 5,  format: 'Fútbol 5', status: 'results', visibility: 'public',  resultsPublic: true,  daysAgo: 2,    coverTheme: '#C0392B', dateLabel: '13 sep', venueName: 'Arena Surco' },
  { id: 't4', name: 'Copa Aniversario Constructora Vega', teams: 10, format: 'Fútbol 7', status: 'results', visibility: 'private', resultsPublic: true, daysAgo: 6,    coverTheme: '#8E44AD', dateLabel: '09 sep', venueName: 'Estadio Vega' },
];
