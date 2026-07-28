// ============================================================================
// sharedLink — módulo PURO (sin React) · único dueño del `sharedLinkContext`.
// ============================================================================
// Responsable exclusivamente del contexto de un Shared Link. No conoce
// componentes, hooks, navegación ni estado de React. Ningún otro archivo debe
// leer/escribir directamente el localStorage del `sharedLinkContext`: toda
// interacción pasa por esta API.
//
// Convive con el sistema actual: además del contexto, mantiene el ESPEJO
// `pending_game_referral:<gameId>` exactamente como hoy, para que el checkout y
// la lógica de Referral/Captain R1 sigan funcionando sin cambios.
//
// Forma del contexto (extensible; `version` habilita evolución de esquema):
//   { version, source, gameId, referral, params, city, capturedAt }
// ============================================================================

const CTX_KEY        = 'algr_shared_link_ctx';
const REFERRAL_KEY   = (gameId) => `pending_game_referral:${gameId}`;
const SCHEMA_VERSION = 1;

// Allowlist de parámetros que marcan una "entrada externa hacia un partido".
// PRIVADO: la detección se encapsula en detectExternalEntry(); nadie fuera del
// módulo debe conocer cómo se detecta. ÚNICO punto extensible: 'qr', 'utm_*', etc.
const SHARED_PARAMS = ['ref'];

// ── helpers internos de storage (tolerantes a modo privado / cuota) ──────────
function readRaw() {
  try { return JSON.parse(localStorage.getItem(CTX_KEY)); } catch { return null; }
}
function writeRaw(ctx) {
  try { localStorage.setItem(CTX_KEY, JSON.stringify(ctx)); } catch {}
}

// Ruta de partido → gameId | null (sin depender de React Router).
function parseGameId(pathname = '') {
  const m = /^\/game\/([^/?#]+)/.exec(pathname || '');
  return m ? decodeURIComponent(m[1]) : null;
}

// `source` derivado de qué params reconocidos llegaron (para analítica futura).
function deriveSource(params) {
  if (params && params.ref) return 'referral_share';
  return 'deep_link';
}

// ── Detección (PURA) — la consume el Bootstrap; no navega ni toca red. ───────
// Devuelve { gameId, referral, params, source } o null.
// `isInitialLoad`: true en la carga inicial de documento (cubre deep links sin
// params). Sin params reconocidos y sin carga inicial ⇒ navegación interna ⇒ null.
export function detectExternalEntry(pathname, search, { isInitialLoad = false } = {}) {
  const gameId = parseGameId(pathname);
  if (!gameId) return null;
  const sp = new URLSearchParams(search || '');
  const params = {};
  for (const key of SHARED_PARAMS) {
    const v = sp.get(key);
    if (v != null) params[key] = v;
  }
  const hasRecognized = Object.keys(params).length > 0;
  if (!hasRecognized && !isInitialLoad) return null;
  return { gameId, referral: params.ref ?? null, params, source: deriveSource(params) };
}

// ── API del contexto ─────────────────────────────────────────────────────────

// capture(entry): crea/reemplaza el contexto y mantiene el espejo de referral.
// Reemplaza cualquier contexto previo (cada entrada externa es la sesión activa).
export function capture({ gameId, referral = null, params = {}, source = 'deep_link' } = {}) {
  if (!gameId) return null;
  const ctx = {
    version:    SCHEMA_VERSION,
    source,
    gameId,
    referral:   referral ?? null,
    params:     params ?? {},
    city:       null,                       // la resuelve/cachea el Orchestrator
    capturedAt: new Date().toISOString(),   // solo dato; sin expiración aún
  };
  writeRaw(ctx);
  // Espejo de compatibilidad: idéntico a lo que hoy escribe GameDetail. Solo si
  // hay referral; nunca se borra aquí (lo consume el checkout como hoy).
  if (ctx.referral) { try { localStorage.setItem(REFERRAL_KEY(gameId), ctx.referral); } catch {} }
  return ctx;
}

// replace(entry): reemplazo explícito por una nueva entrada externa. En Etapa 1
// es equivalente a capture() (toda entrada externa reemplaza).
export function replace(entry) {
  return capture(entry);
}

// read(): contexto actual o null.
export function read() {
  return readRaw();
}

// getReferral(gameId): referral persistido del Shared Link de ese partido (fuente de
// verdad para el checkout), o null. Encapsula la lectura del espejo pending_game_referral
// para que nadie fuera del módulo acceda a esa clave directamente.
export function getReferral(gameId) {
  try { return localStorage.getItem(REFERRAL_KEY(gameId)); } catch { return null; }
}

// setCity(city): cachea la ciudad ya resuelta dentro del contexto.
export function setCity(city) {
  const ctx = readRaw();
  if (!ctx) return null;
  ctx.city = city ?? null;
  writeRaw(ctx);
  return ctx;
}

// clearIfGame(gameId): elimina el contexto SOLO si corresponde a ese gameId
// (se conectará en Etapa 2 tras inscripción exitosa). NO toca el espejo
// pending_game_referral (ese lo limpia el checkout como hoy).
export function clearIfGame(gameId) {
  const ctx = readRaw();
  if (ctx && ctx.gameId === gameId) {
    try { localStorage.removeItem(CTX_KEY); } catch {}
    return true;
  }
  return false;
}
