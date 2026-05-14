import { supabase } from '../lib/supabase';

const ROSTER_KEY = 'pichanga_game_rosters';

export async function testConnection() {
  const result = await supabase.from('games').select('*');
  console.log(result.data);
}

// Convierte "HH:MM:SS" (Postgres time) → { time: "H:MM", ampm: "AM"|"PM" }
function parseTime(t) {
  if (!t) return { time: '', ampm: 'AM' };
  const [hStr, mStr] = t.split(':');
  const h24 = parseInt(hStr, 10);
  const m   = (mStr || '00').padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12  = h24 % 12 || 12;
  return { time: `${h12}:${m}`, ampm };
}

const GAME_SELECT = `
  id,
  type,
  date_key,
  time,
  price_per_person,
  current_players,
  game_amenities:amenities,
  fields:field_id (
    name,
    format,
    players_per_team,
    field_amenities:amenities,
    venues:venue_id (
      name,
      city,
      address,
      venue_amenities:amenities
    )
  )
`;

function mapGame(g) {
  const { time, ampm } = parseTime(g.time);
  const field     = g.fields;
  const venue     = field?.venues;
  const openSpots = Math.max(0, (field?.players_per_team ?? 0) * 2 - (g.current_players ?? 0));
  return {
    id:        g.id,
    type:      g.type                             ?? '',
    city:      venue?.city                        ?? '',
    dateKey:   g.date_key                         ?? '',
    time,
    ampm,
    field:     venue?.name                        ?? '',
    fieldName: field?.name                        ?? '',
    address:   venue?.address                     ?? '',
    format:    field?.format                      ?? '',
    price:     g.price_per_person                 ?? 0,
    openSpots,
    filmed:    g.game_amenities?.filmed           ?? false,
    womenOnly: g.game_amenities?.women_only       ?? false,
    master45:  g.game_amenities?.master_45        ?? false,
    covered:   field?.field_amenities?.covered    ?? false,
    parking:   venue?.venue_amenities?.parking    ?? false,
    showers:   venue?.venue_amenities?.showers    ?? false,
  };
}

export async function getGameById(gameId) {
  if (!supabase || !gameId) return null;
  const { data, error } = await supabase
    .from('games')
    .select(GAME_SELECT)
    .eq('id', gameId)
    .single();
  if (error) { console.error('[getGameById]', error); return null; }
  return mapGame(data);
}

export async function getGames() {
  const { data, error } = await supabase
    .from('games')
    .select(GAME_SELECT)
    .eq('type', 'match');

  console.log('[getGames] raw data:', data, '| error:', error);
  if (error) { console.error('getGames:', error); return []; }

  const mapped = data.map(mapGame);

  console.log('[getGames] mapped result:', mapped.length, 'games', mapped[0] ?? '(empty)');
  return mapped;
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
