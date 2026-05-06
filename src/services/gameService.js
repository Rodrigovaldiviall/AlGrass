import { supabase } from '../lib/supabaseClient';

const ROSTER_KEY = 'pichanga_game_rosters';

export async function testConnection() {
  const result = await supabase.from('games').select('*');
  console.log(result.data);
}

function formatTime(t) {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr.padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export async function getGames() {
  const { data, error } = await supabase.from('games').select(`
    id,
    date_key,
    time,
    type,
    status,
    price_per_person,
    price_total,
    current_players,
    amenities,

    fields:field_id (
      name,
      format,
      players_per_team,
      amenities,
      venues:venue_id (
        name,
        address,
        amenities
      )
    )
  `);
  console.log(JSON.stringify(data, null, 2));
  if (error) { console.error(error); return []; }
  return data.map(g => {
    const maxPlayers = (g.fields?.players_per_team || 0) * 2;

    return {
      id: g.id,

      // tiempo
      date: g.date_key,
      time: g.time,

      // tipo
      type: g.type,
      status: g.status,

      // venue
      venueName: g.fields?.venues?.name,
      venueAddress: g.fields?.venues?.address,

      // field
      fieldName: g.fields?.name,
      format: g.fields?.format,

      // jugadores
      maxPlayers,
      currentPlayers: g.current_players || 0,

      // precios
      pricePerPlayer: g.price_per_person,
      priceTotal: g.price_total,

      // amenities separadas
      venueAmenities: g.fields?.venues?.amenities || {},
      fieldAmenities: g.fields?.amenities || {},
      gameAmenities: g.amenities || {},
    };
  });
}

function readRosters() {
  try { return JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}'); } catch { return {}; }
}
function writeRosters(r) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(r)); } catch {}
}

export function getRoster(gameId) {
  return readRosters()[gameId] || null;
}

export function getActivePlayers(gameId) {
  return getRoster(gameId)?.players || [];
}

export function calculateAvailableSpots(gameId, originalOpenSpots, isBooked, isTitularCanceled) {
  const guestCount = getActivePlayers(gameId).length;
  const titularSlot = (isBooked && !isTitularCanceled) ? 1 : 0;
  return Math.max(0, originalOpenSpots - titularSlot - guestCount);
}

export function validateDuplicate(gameId, playerId) {
  return getActivePlayers(gameId).some(p => p.id === playerId);
}

export function createRoster(gameId, players, meta = {}) {
  const rosters = readRosters();
  rosters[gameId] = {
    players: players.map(p => ({ id: p.id, name: p.name, hue: p.hue || 0, code: p.code || '' })),
    ...meta,
  };
  writeRosters(rosters);
}

export function addPlayers(gameId, newPlayers, adderCode = '') {
  const rosters = readRosters();
  const existing = rosters[gameId]?.players || [];
  const existingIds = new Set(existing.map(p => p.id));
  const deduped = newPlayers.filter(p => !existingIds.has(p.id));
  rosters[gameId] = {
    ...(rosters[gameId] || {}),
    players: [...existing, ...deduped.map(p => ({ id: p.id, name: p.name, hue: p.hue || 0, code: p.code || '', addedByCode: adderCode }))],
  };
  writeRosters(rosters);
  return deduped.length;
}

export function removePlayers(gameId, playerIds) {
  const toRemove = new Set(playerIds);
  const rosters = readRosters();
  if (!rosters[gameId]) return;
  rosters[gameId].players = (rosters[gameId].players || []).filter(p => !toRemove.has(p.id));
  if (!rosters[gameId].players.length && !rosters[gameId].titularCanceled) {
    delete rosters[gameId];
  }
  writeRosters(rosters);
}

export function setTitularCanceled(gameId, titularCode, paymentBreakdown) {
  const rosters = readRosters();
  if (!rosters[gameId]) return;
  rosters[gameId] = {
    ...rosters[gameId],
    titularCanceled: true,
    ...(titularCode ? { titularCode } : {}),
    ...(paymentBreakdown ? { paymentBreakdown } : {}),
  };
  writeRosters(rosters);
}

export function deleteRoster(gameId) {
  const rosters = readRosters();
  delete rosters[gameId];
  writeRosters(rosters);
}
