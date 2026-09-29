// ── Resolución del teléfono de "Comunícate con el organizador" ────────────────
// FUENTE ÚNICA de verdad: Supabase public.app_settings (fila id=1). NO se duplica en
// constants.js ni se cachea de forma persistente (así un cambio en Admin se refleja en
// la App sin deploy: la próxima lectura trae el valor nuevo).
//
//   mode = 'algrass' → app_settings.algrass_operational_phone  (NO se llama la RPC host)
//   mode = 'host'    → get_game_host_contact(game_id)          (teléfono del host)
//
// SIEMPRE devuelve dígitos válidos o null. null significa "no disponible" (cargando,
// error de config, RPC fallida o host sin teléfono) → el CTA se DESHABILITA. Nunca cae
// al placeholder 51999999999.
import { supabase } from '../lib/supabase';

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

// users.phone se guarda LOCAL (sin código de país; el prefijo no está en la BD).
// ASUNCIÓN Perú: a un número local de 8-9 dígitos se le antepone '51'. Un número que ya
// trae código de país (>=10 díg.) se usa tal cual. Menos de 8 díg. → no válido (null).
// (Ver auditoría: si se rechaza la asunción Perú, el modo host quedará deshabilitado
//  para teléfonos locales hasta que la BD almacene el número con código de país.)
function hostToWa(raw) {
  const d = digits(raw);
  if (!d) return null;
  if (d.length >= 10) return d;
  if (d.length === 8 || d.length === 9) return '51' + d;
  return null;
}

// Lee la config global. null si no se puede leer (→ CTA deshabilitado, nunca placeholder).
async function fetchConfig() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings')
    .select('organizer_contact_mode, algrass_operational_phone')
    .eq('id', 1)
    .single();
  if (error || !data) return null;
  return { mode: data.organizer_contact_mode, algrassPhone: data.algrass_operational_phone ?? null };
}

// Leads de tiempo configurables (MISMA fila app_settings id=1). Devuelve números o null.
// null = no se pudo leer → la acción dependiente queda CERRADA (sin default 60/15 en la App:
// los valores viven SOLO en Supabase, no como segunda fuente de verdad aquí).
export async function fetchAppTimings() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings')
    .select('free_invites_lead_min, attendance_lead_min, match_refund_cutoff_hours, captain_release_hours, captain_gold_release_hours')
    .eq('id', 1)
    .single();
  if (error || !data) return null;
  return {
    freeInvitesLeadMin:      data.free_invites_lead_min ?? null,
    attendanceLeadMin:       data.attendance_lead_min ?? null,
    matchRefundCutoffHours:  data.match_refund_cutoff_hours ?? null,   // solo para TEXTO del preview
    // Liberación de cupos R1 (capitán). null = no disponible → reservar cerrado. 0 es VÁLIDO
    // (se conserva tal cual, no se colapsa a null): expira en game_start.
    captainReleaseHours:     data.captain_release_hours ?? null,
    captainGoldReleaseHours: data.captain_gold_release_hours ?? null,
  };
}

// Estado de "Modo mantenimiento" (app_settings id=1) vía RPC pública get_maintenance_status()
// (anon + authenticated). Devuelve { error, mode, message }:
//   · error=true  → la RPC falló → el llamador debe FAIL OPEN (nunca cerrar la app por un fallo de red).
//   · error=false → mode/message válidos (mode=false si no hay fila).
// Tolera ambas formas de retorno (table → array; jsonb/composite → objeto).
export async function getMaintenanceStatus() {
  if (!supabase) return { error: true };
  try {
    const { data, error } = await supabase.rpc('get_maintenance_status');
    if (error) return { error: true };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { error: false, mode: false, message: '' };
    return { error: false, mode: row.maintenance_mode === true, message: row.maintenance_message ?? '' };
  } catch {
    return { error: true };
  }
}

async function fetchHostPhone(gameId) {
  if (!supabase || !gameId) return null;
  const { data, error } = await supabase.rpc('get_game_host_contact', { p_game_id: gameId });
  return error ? null : (data ?? null);   // RPC fallida → null
}

// Resuelve el teléfono (dígitos) del CTA para un game, o null si no hay uno seguro.
// Política EXPLÍCITA (coherente con get_championship_organizer_contact):
//   'algrass'                        → algrass_operational_phone.
//   'host' con teléfono de host      → ese teléfono.
//   'host' sin host / sin teléfono   → FALLBACK a algrass_operational_phone (CTA no queda inutilizado).
//   NULL / modo inesperado           → null (SIN fallback).
// get_game_host_contact NO cambia (sigue devolviendo el teléfono del host o null tras su gate de legitimidad).
export async function resolveOrganizerPhone(game) {
  const cfg = await fetchConfig();
  if (!cfg) return null;
  const algrass = () => { const d = digits(cfg.algrassPhone); return d.length >= 8 ? d : null; };  // Admin lo guarda con código de país
  if (cfg.mode === 'algrass') return algrass();
  if (cfg.mode === 'host') {
    const host = hostToWa(await fetchHostPhone(game?.id));
    return host || algrass();   // host ausente/sin teléfono → fallback AlGrass
  }
  return null;   // mode null/inesperado → sin contacto (sin fallback)
}

// Championship: teléfono del CTA resuelto EN SERVIDOR y OWNER-GATED (get_championship_organizer_contact
// valida auth.uid() = owner). La RPC ya respeta organizer_contact_mode (algrass → phone AlGrass; host →
// teléfono del host del campeonato). Aquí solo se aplica la MISMA normalización WhatsApp que el host de
// game/rental (hostToWa): el phone AlGrass ya trae código de país → intacto; el del host (local) → +51.
// Devuelve dígitos válidos o null (no-owner, sin host, host sin teléfono, RPC fallida) → CTA deshabilitado.
export async function resolveChampionshipOrganizerPhone(championshipId) {
  if (!supabase || !championshipId) return null;
  const { data, error } = await supabase.rpc('get_championship_organizer_contact', { p_championship_id: championshipId });
  if (error) return null;
  return hostToWa(data);
}
