// Registro central del "scrim de safe-area inferior" (iPhone PWA standalone).
//
// Solo efecto VISUAL: pinta el background de body para que la franja física inferior
// (que un backdrop `position:fixed` no alcanza en iOS standalone) continúe el overlay
// oscuro hasta el borde. Todo el gating a iPhone+PWA vive en index.css (regla `.ios-scrim-open`);
// aquí solo se gestiona la clase y las custom properties. En Safari/Android/desktop la clase
// existe pero la regla no aplica → sin cambio visual. No introduce DOM ni listeners: la franja
// es únicamente visual, nunca interactiva.
//
// Cada overlay activa/desactiva por un `id` estable, con su propio color y duración:
//   activateIosScrim('edit-profile', { color: '#7A7A7A', duration: '.22s' })
//   deactivateIosScrim('edit-profile')
//
// Concurrencia: los estados conectados son mutuamente excluyentes (rutas distintas:
// Perfil / ConfirmReservation / Settings; y dentro de ConfirmReservation, crédito vs
// pasarela nunca coexisten). No hace falta stack/prioridades: basta "último activo gana".
// El Map hace idempotente re-activar el mismo id y garantiza limpieza cuando queda vacío.

const active = new Map(); // id -> { color, duration }
const root = () => document.documentElement;

function apply() {
  const el = root();
  if (active.size === 0) {
    el.classList.remove('ios-scrim-open');
    el.style.removeProperty('--ios-scrim');
    return;
  }
  // Último insertado gana (excluyentes por diseño; ver nota de concurrencia arriba).
  let last;
  for (const v of active.values()) last = v;
  el.style.setProperty('--ios-scrim', last.color);
  el.style.setProperty('--ios-scrim-dur', last.duration);
  el.classList.add('ios-scrim-open');
}

export function activateIosScrim(id, { color = '#7A7A7A', duration = '.22s' } = {}) {
  active.set(id, { color, duration }); // idempotente: re-activar sobrescribe
  apply();
}

export function deactivateIosScrim(id) {
  const entry = active.get(id);
  if (!entry) return;
  active.delete(id);
  // Fade-OUT simétrico: la regla base (blanco) usa var(--ios-scrim-dur, .22s) para su transition,
  // así que fijamos la MISMA duración con la que entró ANTES de quitar la clase → salida instantánea
  // si entró con 0s (confirmación), o fade .22s si entró con .22s (Editar Perfil).
  if (active.size === 0) root().style.setProperty('--ios-scrim-dur', entry.duration);
  apply();
}
