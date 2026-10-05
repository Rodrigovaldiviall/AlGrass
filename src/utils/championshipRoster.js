// ── Gestión de roster (Owner/Host/AlGrass) — lógica COMPARTIDA entre ChampionshipView y ChampionshipTeam ──
// Espejo de las ventanas del backend (Phase 21 `_champ_can_manage_roster`): la UI solo evita ofrecer acciones
// que el backend rechazaría; la autorización real vive en la RPC. Una sola fuente para no divergir.

// Fase efectiva: in_progress se desdobla por live_started_at (Fase 21). El resto = el status tal cual.
export function effPhaseOf(status, liveStartedAt) {
  if (status === 'in_progress') return liveStartedAt != null ? 'in_progress_live' : 'in_progress_prelive';
  return status;
}

// Ventanas por acción para owner/host/AlGrass. Devuelve booleanos. Nunca payment_validation ni canceled.
export function rosterWindows(effPhase, { amOwner = false, amHost = false, amAlgrass = false, isPrivate = false } = {}) {
  const alg = amAlgrass && ['pending_publish', 'registration_open', 'registration_closed', 'in_progress_prelive', 'in_progress_live', 'completed'].includes(effPhase);
  const oh = (arr) => (amOwner || amHost) && arr.includes(effPhase);
  return {
    // Mover / asignar / quitar inscritos (y self). Es la condición del botón ⋮.
    canAdminMove:   alg || oh(['registration_open', 'registration_closed', 'in_progress_prelive', 'in_progress_live']),
    canAdminEdit:   alg || oh(['pending_publish', 'registration_open', 'registration_closed', 'in_progress_prelive', 'in_progress_live']),
    canAdminCreate: alg || oh(['pending_publish', 'registration_open', 'registration_closed']),
    // Agregar tercero NUEVO (Fase 29): host o AlGrass, y además el OWNER en campeonatos PRIVADos (mismo rango
    // que host: RO/RC/PRE/LIVE, NO pending_publish, NO completed). Espejo del helper backend
    // _champ_can_manage_roster('add_player'). En campeonatos públicos el owner NO entra (solo host/AlGrass).
    canAdminAddNew: (amAlgrass || amHost || (amOwner && isPrivate)) && ['registration_open', 'registration_closed', 'in_progress_prelive', 'in_progress_live'].includes(effPhase),
  };
}
