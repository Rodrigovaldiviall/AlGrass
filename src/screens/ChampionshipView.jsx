import { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGlobalRoles } from '../hooks/useGlobalRoles';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, RED } from '../constants';
import Shield from '../components/championship/Shield';
import PlayerAvatar from '../components/championship/PlayerAvatar';
import MapsLinkButton from '../components/MapsLinkButton';
import { useChampionshipOrganizerPhone } from '../hooks/useChampionshipOrganizerPhone';
import OrganizerContactButton from '../components/OrganizerContactButton';
import TabBar from '../components/TabBar';
import ConfirmExitDialog from '../components/ConfirmExitDialog';
import I from '../icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';   // antena "En vivo" (mismo icono que Games/Profile)
import { buildTeams, combinedRoster, mockStandings, mockScorers, mockMatches, formatForTeamCount, chunkByCounts, playerLabel, CURRENT_USER_NAME, TEAM_DESIGNS, DEFAULT_DESIGN, designFromColor } from '../data/championshipTeamsMock';
import { CHAMPIONSHIP_BASE_PRICE, CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS, mockPublishDelay, soles } from '../data/championshipCheckoutMock';
import { buildFixture, visualCapacity, realTeamCapacity } from '../data/championshipFixtures';
import { formatDateLabel } from '../utils/format';
import { supabase } from '../lib/supabase';
import RosterAvatar from '../components/championship/RosterAvatar';
import PlayerActionSheet from '../components/championship/PlayerActionSheet';
import MatchDetailModal from '../components/championship/MatchDetailModal';
import VenuePickerSheet from '../components/championship/VenuePickerSheet';
import { effPhaseOf, rosterWindows } from '../utils/championshipRoster';
import { PlayerModal } from './GameDetail';   // MISMO perfil público que el roster de Match (sin duplicar)
import { validateCoverImage, uploadChampionshipCover, getChampionshipCoverUrl, deleteChampionshipCover } from '../utils/championshipCoverImage';
import { getChampionshipPublic, getChampionshipRegistrationKey, verifyChampionshipAccess, updateChampionshipPrivacy, publishChampionshipRpc, updateChampionshipCover, joinChampionshipWithoutTeam, joinChampionshipTeam, leaveChampionship, deleteChampionshipTeam, getChampionshipRegistrationState, getChampionshipCompetition, manageChampionshipPlayer, saveChampionshipMatchResult, setChampionshipMatchTeam, toggleChampionshipLive, setChampionshipChampion, getChampionshipOrder, cancelChampionshipContract, getChampionshipPaymentDetail, getChampionshipPublicPricing, joinChampionshipTeamWithToken } from '../services/championshipService';
import TeamPickerSheet from '../components/championship/TeamPickerSheet';
import { slotTeamConflicts } from '../utils/championshipFixture';

// Temas de PORTADA (independientes de la paleta de equipos). Default rojo; el azul es un tono
// claramente distinto al azul de marca (#3F5FE0) para que portada y header no se confundan.
import { COVER_THEMES, coverColor, randomCoverTheme } from '../data/championshipCover';
import { getVenueById } from '../services/venueService';

// Mismo mapa de etiquetas de amenities que ChampionshipOrganize (para chips { kind, label } en /venue).
const AMENITY_LABEL = { parking: 'Estacionamiento', showers: 'Duchas', covered: 'Techado' };

// Estado de ChampionshipView persistido en sessionStorage para conservarlo en el viaje a/desde
// ChampionshipTeam (sin Context/Redux/Supabase; session state compatible con la arquitectura actual).
const CV_KEY = 'championship_view_state';
// Intención de acción protegida (checkout/contacto) pendiente de login. Se fija justo antes de ir a
// /auth y se consume al regresar autenticado a esta pantalla para reanudar EXACTAMENTE la acción.
const AUTH_RESUME_KEY = 'championship_auth_resume';
function readCV() { try { return JSON.parse(sessionStorage.getItem(CV_KEY)); } catch { return null; } }
function writeCV(o) { try { sessionStorage.setItem(CV_KEY, JSON.stringify(o)); } catch {} }

// ── Cache TEMPORAL del acceso por clave (sessionStorage) — SOLO para no volver a PEDIR la clave dentro de 15 min.
// NO es autoridad: la entrada guarda la clave introducida para REVALIDARLA en silencio con verify_championship_access
// al reentrar (si el owner la cambió, el backend rechaza y se limpia). Prefijo 'champ_access_' → clearUserScopedCache
// (AuthContext) la borra en logout/cambio de uid, también en sessionStorage. Key por uid+campeonato (nunca entre
// usuarios). Solo logueados escriben; anon nunca. (Nota: la clave es un código de invitación, no una contraseña.)
const KEY_ACCESS_TTL_MS = 15 * 60 * 1000;
const keyAccessId = (uid, cid) => `champ_access_key_${uid}_${cid}`;
function readKeyAccess(uid, cid) {
  if (!uid || !cid) return null;
  try { const o = JSON.parse(sessionStorage.getItem(keyAccessId(uid, cid))); return (o && o.key && typeof o.expiresAt === 'number' && o.expiresAt > Date.now()) ? o : null; } catch { return null; }
}
function writeKeyAccess(uid, cid, key) {
  if (!uid || !cid || !key) return;
  try { sessionStorage.setItem(keyAccessId(uid, cid), JSON.stringify({ key, expiresAt: Date.now() + KEY_ACCESS_TTL_MS })); } catch {}
}
function clearKeyAccess(uid, cid) { if (!uid || !cid) return; try { sessionStorage.removeItem(keyAccessId(uid, cid)); } catch {} }
// Rango 24h "HH:mm – HH:mm" a partir de start_time ("HH:MM[:SS]") + duration_min. NO se guarda end_time: se
// deriva en presentación (envuelve medianoche). Sin start → ''; sin duración válida → solo la hora de inicio.
function matchTimeRange(startTime, durationMin) {
  if (!startTime) return '';
  const [h, m] = String(startTime).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const startMin = (h || 0) * 60 + (m || 0);
  const fmt = (mins) => { const t = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const start = fmt(startMin);
  return (durationMin > 0) ? `${start} – ${fmt(startMin + durationMin)}` : start;
}

// Usuario actual (mock). Mismo id que se usa en los rosters ('you'); futuro: currentUser.id de Supabase.
const CURRENT_USER_ID = 'you';

const CARD = { background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 16, padding: 16, marginBottom: 12 };
const H = { fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2 };

function Seg({ active, onClick, disabled = false, children }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={disabled ? undefined : 'pressable'} style={{
      flex: 1, height: 36, borderRadius: 10, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
      background: active ? BLUE : '#fff', color: disabled ? '#B0B0B8' : (active ? '#fff' : TEXT), fontSize: 13.5, fontWeight: 700,
      opacity: disabled ? 0.65 : 1,
      WebkitTapHighlightColor: 'transparent', outline: 'none', boxShadow: active ? 'none' : `inset 0 0 0 1px ${HAIR}`,
    }}>{children}</button>
  );
}

export default function ChampionshipView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, oauthInitPending } = useAuth();
  // ── INSTRUMENTACIÓN TEMPORAL (solo DEV) — diagnóstico de skeleton infinito. Prefijo [CHAMP_LOAD].
  //    QUITAR tras capturar la causa. No cambia comportamiento. ──────────────────────────────────
  const DBG = import.meta.env.DEV;
  const clog = (...a) => { if (DBG) console.log('[CHAMP_LOAD]', ...a); };
  const skelDbgRef = useRef(null);
  const instIdRef = useRef(Math.random().toString(36).slice(2, 7));   // id de ESTA instancia montada (detecta remontes)
  const prevDepsRef = useRef({ realId: Symbol('init') });             // deps previas del effect principal
  // Rol AlGrass GLOBAL (misma fuente que el backend _is_algrass_staff: tabla user_roles), cacheado en
  // localStorage y disponible sin llamar a get_championship_registration_state. Se usa solo para gatear la
  // carga del estado en pending_publish y evitar el 400 esperado de la RPC para usuarios no autorizados.
  const { isAlGrassStaff, isAlGrassAdmin } = useGlobalRoles();
  const amAlgrassRole = isAlGrassStaff || isAlGrassAdmin;
  const nav = location.state || null;
  const { id: routeId } = useParams();
  // Deep-link a un EQUIPO: /championships/view/:id?team=<teamId>. Se reenvía a ChampionshipTeam en cuanto el
  // acceso está resuelto (tras el gate de clave si aplica). Reutiliza gate/acceso/auth de esta pantalla.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepTeamId = searchParams.get('team');
  const deepFwdRef = useRef(false);
  const realId = routeId || null;              // /championships/view/:id → campeonato REAL (DB = fuente de verdad)
  const isRealMode = !!realId;
  const persisted = readCV();
  const cvReturn = !!nav?.cvReturn;          // true = volvimos desde ChampionshipTeam
  // Regreso desde /auth (login/registro): esta pantalla se remonta sin location.state, así que
  // restauramos TODO desde persisted igual que cvReturn para volver EXACTAMENTE al estado previo.
  // Se captura una sola vez al montar (la bandera se consume después) para no perder el restore.
  const [authResuming] = useState(() => { try { return !!sessionStorage.getItem(AUTH_RESUME_KEY); } catch { return false; } });
  const restore = (cvReturn || authResuming) ? persisted : null;
  // Caché de vuelta desde ChampionshipTeam: si el CV guardó la fila real (realRow) y el estado de
  // inscripciones (regState) de ESTE mismo campeonato, se usan como estado INICIAL para pintar la pantalla
  // ya renderizada (sin skeleton fullscreen ni flash del top) y luego refrescar en segundo plano.
  const cachedReal = (restore && isRealMode && restore.championship?.realId === realId) ? restore.championship : null;
  const realRowToChamp = (row) => ({ status: row.status, createdByUserId: row.owner_user_id, registrationKey: '', publishedAt: row.published_at || null, privacy: row.privacy || 'private', realId: row.id });

  // ── Campeonato REAL: se carga desde DB por ID. DB es la ÚNICA fuente de identidad/status/privacidad/owner.
  //    El CV NO decide qué campeonato real se muestra (solo cachea contenido mock entre navegaciones). ──
  const [realRow, setRealRow] = useState(cachedReal?.realRow ?? null);
  const [realLoading, setRealLoading] = useState(isRealMode && !cachedReal?.realRow);
  const [realError, setRealError] = useState(false);
  const [ownerKey, setOwnerKey] = useState(null);   // clave real (SOLO owner); null = aún no cargada / no-owner
  // [CHAMP_LOAD] INSTANCE: effect []→ corre UNA vez por MONTAJE. Si ves unmounted/mounted repetidos con inst
  // distinto = REMONTE externo. Si NO cambia el inst pero hay cleanup/main-effect-start = StrictMode o realId.
  useEffect(() => { clog('INSTANCE mounted', { inst: instIdRef.current, championshipId: realId }); return () => clog('INSTANCE unmounted', { inst: instIdRef.current, championshipId: realId }); }, []); // eslint-disable-line
  // [CHAMP_LOAD] 1 · montaje / cambio de championshipId
  useEffect(() => { clog('mount/id', { inst: instIdRef.current, championshipId: realId, userId: user?.id || null, authLoading: oauthInitPending, isRealMode, realLoading, realError, hasChamp: !!champ }); }, [realId]); // eslint-disable-line
  useEffect(() => {
    clog('effect deps changed', { inst: instIdRef.current, realId: [prevDepsRef.current.realId, realId] });
    prevDepsRef.current = { realId };
    clog('main effect start', { championshipId: realId, hasUser: !!user, userId: user?.id || null, authLoading: oauthInitPending, isRealMode });
    if (!isRealMode) { clog('main early return: not real mode'); return; }
    let alive = true;
    if (!cachedReal?.realRow) setRealLoading(true);   // con caché de vuelta: refetch en background, sin skeleton
    setRealError(false); setOwnerKey(null);
    // Detalle por SUPERFICIE PÚBLICA (sin registration_key). La clave real solo se pide si soy el owner.
    clog('public request start', { championshipId: realId });
    getChampionshipPublic({ championshipId: realId }).then(({ data, error }) => {
      if (!alive) { clog('response ignored stale', { championshipId: realId }); return; }
      if (error || !data) { clog('public request error', { error: error?.message || error || null, dataNull: !data }); setRealError(true); setRealLoading(false); return; }
      clog('public request success', { championshipId: data?.id ?? null, status: data?.status ?? null, dataNull: !data });
      setRealRow(data); setRealLoading(false);
      if (user?.id && data.owner_user_id === user.id) {
        getChampionshipRegistrationKey({ championshipId: realId }).then(({ data: k }) => { if (alive) setOwnerKey(k || ''); }).catch(() => {});
      }
    }).catch((e) => { clog('public request error (reject)', { message: String(e?.message || e) }); if (alive) { setRealError(true); setRealLoading(false); } });   // promesa rechazada (red/throw) → nunca dejar el skeleton colgado
    return () => { alive = false; clog('cleanup', { championshipId: realId }); };
  }, [realId]); // eslint-disable-line

  // Refresco puntual de la fila real (tras cancelar): re-lee la superficie pública y reemplaza realRow.
  // El effect que sincroniza `champ` desde realRow refleja el nuevo status (p.ej. 'canceled') sin remount.
  const refreshReal = () => {
    if (!isRealMode || !realId) return;
    getChampionshipPublic({ championshipId: realId }).then(({ data, error }) => {
      if (!error && data) setRealRow(data);
    });
  };

  // Precios públicos (inscripción individual pagada). is_public = order_id null + public_individual_price.
  // publicPricing queda SIEMPRE con championship_id = realId tras resolver (éxito o error → centinela privado).
  // Así "resuelto" se deriva comparando ese id con realId, sin setState síncrono en el effect (evita lint) y
  // cubriendo el cambio de realId sin remontar.
  const [publicPricing, setPublicPricing] = useState(null);
  useEffect(() => {
    if (!isRealMode || !realId) return;
    let alive = true;
    const fallback = { championship_id: realId, is_public: false, public_individual_price: null, public_team_price: null };
    clog('pricing start', { championshipId: realId });
    getChampionshipPublicPricing({ championshipId: realId })
      .then(({ data, error }) => { if (!alive) return; if (error || !data) clog('pricing error', { error: error?.message || error || null, dataNull: !data }); else clog('pricing success', { is_public: data?.is_public ?? null }); setPublicPricing((error || !data) ? fallback : data); clog('pricing settle'); })
      .catch((e) => { clog('pricing error (reject)', { message: String(e?.message || e) }); if (alive) { setPublicPricing(fallback); clog('pricing settle'); } });
    return () => { alive = false; };
  }, [realId]); // eslint-disable-line
  // Tipo público/privado YA resuelto para ESTE campeonato (o no aplica por no ser real).
  const pricingResolved = !isRealMode || (publicPricing?.championship_id === realId);
  const publicUnitPrice = Number(publicPricing?.public_individual_price) || 0;
  const publicPaid = pricingResolved && !!publicPricing?.is_public && publicUnitPrice > 0;
  // Público de AlGrass (criterio estructural): NO tiene clave de acceso (ni para publicar ni para entrar).
  const isPublicChamp = isRealMode && pricingResolved && !!publicPricing?.is_public;

  // Owner: cuando llega la clave real (RPC owner-only), hidrata clave/saved para mostrar/editar/publicar.
  useEffect(() => {
    if (!isRealMode || ownerKey == null) return;
    setAccessCode(ownerKey);
    setSavedPrivacy(prev => ({ ...prev, key: ownerKey }));
    setChamp(prev => prev ? { ...prev, registrationKey: ownerKey } : prev);
  }, [ownerKey]); // eslint-disable-line

  // Origen de navegación (Profile / Championships) para que "Atrás" vuelva al lugar correcto. Se pasa por
  // location.state y se persiste MÍNIMO en sessionStorage (clave propia, NO championship_view_state) para
  // sobrevivir a un refresh del detalle. Sin origen conocido → fallback a /championships.
  const BACK_ORIGIN_KEY = 'championship_back_origin';
  useEffect(() => {
    if (!isRealMode) return;
    const o = nav?.championshipOrigin;
    if (o) { try { sessionStorage.setItem(BACK_ORIGIN_KEY, o); } catch {} }
  }, [isRealMode]); // eslint-disable-line
  const readBackOrigin = () => nav?.championshipOrigin || (() => { try { return sessionStorage.getItem(BACK_ORIGIN_KEY); } catch { return null; } })();
  const goToOrigin = () => {
    if (readBackOrigin() === 'profile') { try { sessionStorage.setItem('pf_back', '1'); } catch {} navigate('/profile'); return; }
    navigate('/championships'); // 'championships' o fallback
  };

  // Preview/demo: summary/organizeState del nav/CV. REAL: del snapshot format_config de la fila de DB.
  const summary = isRealMode ? (realRow?.format_config?.summary ?? {}) : (nav?.summary ?? persisted?.summary ?? {});
  const organizeState = isRealMode ? (realRow?.format_config?.organizeState ?? null) : (nav?.organizeState ?? persisted?.organizeState ?? null);

  const complies = !!summary.complies;
  const isLiga = summary.mode === 'liga';       // Liga = un solo grupo, todos contra todos
  // Campeonato "creado": REAL → existe fila de DB; preview/demo (legacy checkout) → cv.championship.
  const rawChamp = isRealMode ? null : (cvReturn ? (persisted?.championship ?? null) : null);
  const isCreated = isRealMode ? !!realRow : !!rawChamp;   // true = campeonato del owner (no demo)
  const group = summary.group || null; // { min, max }
  // Capacidad AUTORITATIVA de equipos del backend (get_championship_public.team_capacity, misma que valida la
  // inscripción). En campeonato REAL manda ESTA → refleja cambios de tramo hechos en Admin al refetch. Fallback
  // (demo/preview o RPC antigua sin el campo) → tramo derivado del summary.
  const realTeamCap = (isRealMode && Number.isFinite(realRow?.team_capacity)) ? realRow.team_capacity : null;
  const maxTeams = isLiga ? 999 : (realTeamCap ?? (group ? group.max : 8));     // Liga: sin límite (crear equipo permanente)
  // Demo (Torneo): 2 equipos de prueba hechos; los slots restantes hasta la capacidad (maxTeams) se
  // muestran como escudos grises "crear equipo" (p.ej. 4 equipos → 2 hechos + 2 en gris). Liga: 6 mock.
  const initialTeams = isLiga ? 6 : Math.min(2, group ? group.max : 4);
  // Badge de portada: Liga muestra su cantidad tentativa (equipos/personas); demás, el rango del grupo.
  const leagueEst = summary.leagueEstimate || null;
  const coverBadge = isLiga
    ? (leagueEst?.quantity ? `${leagueEst.quantity} ${leagueEst.type === 'people' ? 'personas' : 'equipos'}` : 'Liga')
    : (group ? `${group.min}–${group.max} equipos` : null);

  const [name, setName] = useState(restore?.name ?? summary.name ?? 'Copa AlGrass');
  // Creación NUEVA (no real, sin restore) → default ALEATORIO de la paleta, elegido UNA vez (initializer lazy;
  // no cambia en re-render). Al volver dentro del flujo (restore) se conserva el elegido; real → lo pisa la
  // hidratación con realRow.cover_theme. Si el usuario cambia el theme, manda su elección.
  const [coverTheme, setCoverTheme] = useState(() => restore?.coverTheme ?? (isRealMode ? COVER_THEMES[0] : randomCoverTheme()));
  const [coverEditMode, setCoverEditMode] = useState(false);      // portada en edición (paleta + nombre editable)
  const [confirmExit, setConfirmExit] = useState(false);          // X (solo demo) = salir del flujo → confirmación
  const [coverSnap, setCoverSnap] = useState(null);               // snapshot para Cancelar (name+coverTheme)
  const [savingCover, setSavingCover] = useState(false);          // guardado REAL de portada (RPC) en curso
  const [coverImagePath, setCoverImagePath] = useState(cachedReal?.realRow?.cover_image_path ?? null);     // foto opcional (path Storage) del campeonato real
  const [coverBusy, setCoverBusy] = useState(false);              // subida/eliminación de foto en curso
  const coverFileRef = useRef(null);
  // Clave de acceso = ÚNICA fuente de la clave. En campeonato real se pre-carga con la generada en checkout.
  const [accessCode, setAccessCode] = useState(restore?.accessCode ?? rawChamp?.registrationKey ?? '');
  const [resultsPublic, setResultsPublic] = useState(restore?.resultsPublic ?? true);
  // REAL: valores YA guardados en DB (fuente para dirty/publicar). Se sincronizan al cargar y al guardar.
  const [savedPrivacy, setSavedPrivacy] = useState({ key: '', resultsPublic: true });
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [privacyError, setPrivacyError] = useState('');
  const [keyEditing, setKeyEditing] = useState(false);            // tras publicar: la clave abre solo al pulsar "Editar"
  const [toast, setToast] = useState('');                         // toast breve ("Copiado" / avisos de inscripción)
  const [demo, setDemo] = useState(restore?.demo ?? 'inscripciones');    // 'inscripciones' | 'resultados'
  const [resultsView, setResultsView] = useState(restore?.resultsView ?? 'partidos'); // 'partidos' | 'tabla' | 'llave'
  const [matchFilterId, setMatchFilterId] = useState(restore?.matchFilterId ?? null); // filtro de Partidos (id o null)
  const [joinedNoTeam, setJoinedNoTeam] = useState(restore?.joinedNoTeam ?? false);
  // Campeonato REAL → equipos reales (empiezan []). Demo → equipos mock (buildTeams).
  // rawChamp es null en modo REAL; al volver con caché, realRow (y por tanto isCreated) ya es true en el
  // primer render, así que se accede con ?. (real → teams []; la hidratación real hace setTeams([])).
  const [teams, setTeams] = useState(() => (isCreated ? (rawChamp?.teams ?? []) : (restore?.teams ?? buildTeams(initialTeams))));
  // Solicitud mock "Contáctame para organizarlo" (persistida en cv). Solo se conserva al volver (cvReturn).
  const contactRequest = cvReturn ? (persisted?.contactRequest ?? null) : null;

  // Estado del campeonato (mock, distinto de contactRequest): pending_publish → registration_open.
  // Lo crea el checkout al confirmar el pago; se conserva al volver (cvReturn).
  // Ownership CENTRALIZADO (futuro Supabase: champ.created_by_user_id === currentUser.id). Por ahora:
  //  - demo (no creado) → owner (organizador que arma la demo);
  //  - creado → owner si el creador guardado coincide con el usuario actual (fallback true si aún no hay campo);
  //  - nav.viewerRole === 'player' fuerza la vista de jugador (para la futura entrada como participante).
  const isOwner = nav?.viewerRole === 'player'
    ? false
    : isRealMode
      ? (!realRow || realRow.owner_user_id == null || realRow.owner_user_id === user?.id)
      : (!isCreated || rawChamp?.createdByUserId == null || rawChamp.createdByUserId === CURRENT_USER_ID);

  // ── ACCESO (Fase 7). Campeonato publicado → cualquiera ve la card; ENTRAR exige autorización.
  //   Owner (owner_user_id === auth.uid()) → bypass sin clave. Visitante/no-owner → validar la clave EN
  //   SERVIDOR (verify_championship_access) y guardar un GRANT LOCAL (localStorage, sin la clave real).
  //   OJO: results_public/privacy NO son gate aquí (semántica futura de Calendario/Resultados).
  const amOwner = isRealMode && !!user?.id && !!realRow && realRow.owner_user_id === user.id;
  const amMember = isRealMode && !!realRow?.is_member;   // inscrito → bypass de clave (validado en backend)
  // Host asignado (Fase 28): organizador operativo → bypass de clave, igual que owner/miembro. Señal
  // AUTORITATIVA del backend (get_championship_public.is_host, fuente championships.host_user_id), disponible
  // junto a realRow (sin depender de regState) → el gate no parpadea antes de resolver.
  const amHostAccess = isRealMode && !!realRow?.is_host;
  // Contacto del organizador: SOLO el owner. La RPC valida owner (gating real); el hook solo consulta si amOwner.
  const organizerPhone = useChampionshipOrganizerPhone(realId, amOwner);
  // Acceso por clave (Fase 7):
  //   LOGUEADO → cache TEMPORAL (sessionStorage, 15 min) de la clave introducida, SOLO para no volver a PEDIRLA.
  //     NO es autoridad: al reentrar se REVALIDA en silencio con verify_championship_access; si el owner cambió la
  //     clave, el backend rechaza → se borra el cache y se pide de nuevo. Prefijo champ_access_ → lo limpia
  //     clearUserScopedCache en logout/cambio de uid. Key por uid+campeonato (nunca compartida entre usuarios).
  //   ANÓNIMO → NO se cachea nada: solo verifiedGrant en memoria del flujo actual (al salir/recargar pide clave).
  //   El TTL de 15 min NO se extiende por navegar; solo una nueva validación correcta (submitGate) lo renueva.
  const [verifiedGrant, setVerifiedGrant] = useState(() => cachedReal?.accessOk === true);
  const [keyRevalidating, setKeyRevalidating] = useState(false);   // revalidación silenciosa en curso
  const [keyRevalDone, setKeyRevalDone] = useState(false);         // ya se resolvió (éxito o fallo) en este montaje
  const [gateKey, setGateKey] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateChecking, setGateChecking] = useState(false);
  // ── Inscripciones reales (Fase 9): estado (teams/players/membership). Se carga en registration_open. ──
  const [regState, setRegState] = useState(cachedReal?.regState ?? null);
  // regFresh = el estado ya fue confirmado por el backend en ESTE mount. En el retorno, regState arranca del
  // snapshot cacheado (roster visible sin flash), pero "Tu equipo"/check NO se muestran hasta confirmar la
  // membership real → evita el indicador provisional que aparece y desaparece si el snapshot está stale.
  const [regFresh, setRegFresh] = useState(false);
  const [regBusy, setRegBusy] = useState(false);   // "Unirme sin equipo" en curso
  const [venueBusy, setVenueBusy] = useState(false);   // resolviendo el venue real antes de abrir /venue
  const [venueReal, setVenueReal] = useState(null);    // venue PERMANENTE (tabla venues) por summary.venueId
  const [selectedVenueIdx, setSelectedVenueIdx] = useState(0);   // Fase 38: venue mostrado en multi-venue (solo vista)
  const [venuePickerOpen, setVenuePickerOpen] = useState(false); // Fase 38: selector de sede (multi-venue)
  // Fase 38 — Venues OPERATIVOS reales (multi-venue), DERIVADOS por get_championship_public desde la reserva
  // física (championship_reservation_games → games → fields → venues). Solo lectura/visualización: NO escribe DB,
  // NO filtra fixture. 1 venue (o vacío en demo/legacy) → comportamiento single-venue INTACTO (summary + /venue).
  // Deben declararse DESPUÉS de selectedVenueIdx (dependen de él) para evitar la temporal dead zone.
  const venuesReal = isRealMode ? (Array.isArray(realRow?.venues) ? realRow.venues : []) : [];
  const isMultiVenue = venuesReal.length > 1;
  const selectedVenue = isMultiVenue ? (venuesReal[selectedVenueIdx] || venuesReal[0]) : null;
  // Venue FÍSICO a mostrar (single o multi), derivado de la reserva real (get_championship_public.venues[]).
  // Fuente autoritativa común a App y Admin: existe aunque format_config.summary esté mínimo (Admin).
  const displayVenue = venuesReal[selectedVenueIdx] || venuesReal[0] || null;
  const [selectedPlayer, setSelectedPlayer] = useState(null);   // fila del roster → PlayerModal (perfil público de Match)
  // Asignar equipo a un slot VACÍO de la llave (Fase 31). { matchId, side, otherTeamId } | null.
  const [bracketAssign, setBracketAssign] = useState(null);     // { matchId, side, otherTeamId, uat }
  const [bracketSel, setBracketSel] = useState(null);           // team_id seleccionado en el picker
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketErr, setBracketErr] = useState('');
  const [bracketConflicts, setBracketConflicts] = useState({}); // { teamId: "HH:MM–HH:MM" } equipos ocupados
  const [liveBusy, setLiveBusy] = useState(false);              // toggle EN VIVO en curso (evita doble click)
  // Selección de CAMPEÓN (Fase 36): selector de equipo (TeamPickerSheet) + guardado por RPC.
  const [champPickOpen, setChampPickOpen] = useState(false);
  const [champSel, setChampSel] = useState(null);
  const [champBusy, setChampBusy] = useState(false);
  const [champErr, setChampErr] = useState('');
  // Gestión Owner/Host (Fase 23): subvista admin (Inscripciones/Calendario), modo edición del roster y el
  // action sheet del jugador. NO cambian status ni lifecycle; es navegación/gestión interna de la pantalla.
  const [adminView, setAdminView] = useState(restore?.adminView ?? null);   // 'inscripciones' | 'resultados' | null
  const [playerAction, setPlayerAction] = useState(null);       // { user_id, name, team_id } → action sheet (⋮)
  // Match abierto en el detalle (id) | null. Al volver de /venue (cvReturn/authResuming) se SIEMBRA desde la
  // caché de retorno (persistCV guardó el match abierto antes de navegar) para reabrir el MISMO modal.
  const [matchDetailId, setMatchDetailId] = useState(restore?.matchDetailId ?? null);
  const [matchSaving, setMatchSaving] = useState(false);        // guardado de resultado en curso
  function loadRegState() {
    // Estado de inscripciones visible en registration_open/closed; y en pending_publish para owner/AlGrass
    // (crean/gestionan equipos antes de publicar, sin membership). El backend autoriza (owner/AlGrass); un
    // jugador normal en pending recibe error y regState queda null. Fase 10/11.
    const st = realRow?.status;
    // pending_publish: la RPC solo autoriza owner/AlGrass; llamarla como usuario normal genera un 400
    // esperado. Se gatea con señales ya disponibles en frontend (amOwner + rol AlGrass global).
    // in_progress/completed: la RPC es legible para cualquier autenticado (estados públicos) → se carga para
    // alimentar la subvista Inscripciones de gestión (managers) y detectar host. Fase 23.
    // Lectura PÚBLICA (Fase 30): los 4 estados publicados son legibles por CUALQUIERA (incl. anónimo) — mismo
    // gate público del backend. pending_publish sigue restringido a owner/AlGrass (requiere sesión). Así un
    // anónimo puede MIRAR inscripciones/equipos/jugadores en RO/RC/PRE/LIVE sin login (login solo en acciones).
    const canLoad = st === 'registration_open' || st === 'registration_closed'
      || st === 'in_progress' || st === 'completed'
      || ((st === 'pending_publish' || st === 'payment_validation') && (amOwner || amAlgrassRole));
    if (!isRealMode || !canLoad) return;
    // NO se resetea regState a null: se mantiene el último estado conocido visible mientras llega el fresco
    // (evita flash/salto del roster). Solo se reemplaza con los datos nuevos cuando responde el backend.
    clog('reg state start', { championshipId: realId, status: st });
    getChampionshipRegistrationState({ championshipId: realId })
      .then(({ data, error }) => { if (error) clog('reg state error', { error: error?.message || error || null }); else clog('reg state success', { dataNull: !data }); if (!error && data) { setRegState(data); setRegFresh(true); } clog('reg state settle'); })
      .catch((e) => { clog('reg state error (reject)', { message: String(e?.message || e) }); });
  }
  // Gate como booleano DERIVADO (mismo criterio que loadRegState): abierto/cerrado → true por status;
  // pending → true solo owner/AlGrass. Depender de ESTE booleano (no de amOwner/amAlgrassRole crudos) evita
  // el doble fetch: al resolverse roles/owner async, el booleano ya está en true y no cambia → no re-dispara;
  // en open/closed ni depende de roles. user?.id sigue en deps → refetch legítimo al cambiar de sesión;
  // realRow?.status también → refetch legítimo ante un cambio REAL de estado.
  const canLoadRegState = isRealMode && (
    realRow?.status === 'registration_open' || realRow?.status === 'registration_closed'
    || realRow?.status === 'in_progress' || realRow?.status === 'completed'
    || ((realRow?.status === 'pending_publish' || realRow?.status === 'payment_validation') && (amOwner || amAlgrassRole))
  );
  useEffect(() => { loadRegState(); }, [isRealMode, realId, user?.id, realRow?.status, canLoadRegState]); // eslint-disable-line
  // Lectura PÚBLICA (sin clave) SOLO en fase COMPETITIVA/histórica (in_progress pre-live+live, completed) cuando
  // results_public=true. En inscripción (registration_open/closed) SIEMPRE se pide clave (results_public NO la
  // salta). Es solo lectura: el viewer público no es owner/host/miembro → no ve controles de gestión y el backend
  // rechaza cualquier acción. Owner/host/AlGrass/miembro/grant entran como hoy, independientemente de results_public.
  const publicReadOk = isRealMode && !!realRow
    && (realRow.status === 'in_progress' || realRow.status === 'completed')
    && realRow.results_public === true;
  // ¿Se necesita clave? real + fila + NO owner/host/miembro + NO lectura pública (results_public en fase competitiva).
  const needsKey = isRealMode && !!realRow && !amOwner && !amHostAccess && !amMember && !publicReadOk && !isPublicChamp;
  // Cache TEMPORAL de clave (solo logueado): si hay entrada NO expirada, hay que revalidarla en silencio antes de
  // dejar entrar. Mientras se revalida (o falta hacerlo), NO se muestra el gate (se muestra carga) → sin flash.
  const cachedKeyEntry = (needsKey && !verifiedGrant && user?.id) ? readKeyAccess(user.id, realId) : null;
  const awaitingKeyReval = !!cachedKeyEntry && !keyRevalDone;
  // Gate visible = se necesita clave, sin grant en memoria, y NO hay revalidación pendiente/en curso del cache.
  // No renderizar el gate de clave hasta saber si el campeonato es público (evita el flash en públicos).
  // Privado: cuando pricingResolved=true el comportamiento es idéntico al actual.
  const gateOpen = needsKey && !verifiedGrant && !awaitingKeyReval && !keyRevalidating && pricingResolved;
  // Revalidación SILENCIOSA del cache: autoridad = backend (verify_championship_access), nunca el cache. Éxito →
  // entra sin pedir clave (sin renovar TTL). Fallo (clave cambiada/expirada) → borra el cache y muestra el gate.
  useEffect(() => {
    if (!awaitingKeyReval || keyRevalidating || keyRevalDone) return;
    const entry = readKeyAccess(user.id, realId);
    if (!entry) { setKeyRevalDone(true); return; }
    setKeyRevalidating(true);
    verifyChampionshipAccess({ championshipId: realId, registrationKey: entry.key }).then(({ data, error }) => {
      setKeyRevalidating(false); setKeyRevalDone(true);
      if (!error && data === true) setVerifiedGrant(true);          // clave sigue válida → acceso, sin renovar TTL
      else clearKeyAccess(user.id, realId);                          // clave cambió/inválida → limpiar → pedir de nuevo
    }).catch(() => {
      // Promesa RECHAZADA (red/throw): sin este catch, keyRevalidating quedaba en true y el skeleton (que depende
      // de awaitingKeyReval/keyRevalidating) no se limpiaba nunca → skeleton infinito hasta refrescar. Al marcar
      // done+idle, la pantalla cae al gate de clave (pedir de nuevo), que es el fallback correcto.
      setKeyRevalidating(false); setKeyRevalDone(true);
    });
  }, [awaitingKeyReval, keyRevalidating, keyRevalDone, realId, user?.id]); // eslint-disable-line
  async function submitGate() {
    if (gateChecking) return;
    const typed = gateKey.trim();
    if (!typed) { setGateError('Ingresa la clave de acceso.'); return; }
    setGateChecking(true); setGateError('');
    const { data, error } = await verifyChampionshipAccess({ championshipId: realId, registrationKey: typed });
    setGateChecking(false);
    if (error) { setGateError('No pudimos validar la clave. Intenta de nuevo.'); return; }
    if (data === true) {
      setVerifiedGrant(true); setGateKey('');
      // Logueado → cache TEMPORAL (sessionStorage, 15 min) de la clave para no volver a pedirla (se revalida al
      // reentrar). Anónimo → solo memoria (verifiedGrant): NO se cachea nada.
      if (user?.id) writeKeyAccess(user.id, realId, typed);
      return;
    }
    setGateError('Clave incorrecta.');
  }
  const [champ, setChamp] = useState(cachedReal?.realRow ? realRowToChamp(cachedReal.realRow) : rawChamp);
  // REAL: writeChamp SOLO actualiza estado local (override de sesión). NO reescribe el campeonato real en
  // el CV (DB es la fuente de verdad; las mutaciones reales llegarán con RPC en FASE 3). Demo/preview: CV.
  function writeChamp(next) { setChamp(next); if (isRealMode) return; const cv = readCV() || {}; cv.championship = next; writeCV(cv); }
  // REAL: al llegar la fila de DB hidratamos el estado local desde columnas reales (status/clave/resultados/
  // nombre/portada/owner). El contenido interno (equipos/fixture) sigue MOCK montado en el shell real
  // (FASE 1/2); al volver de Team se conserva desde la caché de CV (cv.championship.teams), no la identidad.
  useEffect(() => {
    if (!isRealMode || !realRow) return;
    const base = {
      status: realRow.status,
      createdByUserId: realRow.owner_user_id,
      registrationKey: '',   // la clave real NO viaja en la superficie pública; el owner la hidrata aparte
      publishedAt: realRow.published_at || null,
      privacy: realRow.privacy || 'private',
      realId: realRow.id,
    };
    // REAL/materializado: CERO datos competitivos mock. Equipos/fixture reales aún no tienen backend
    // → teams vacío y sin fixture (nada de buildTeams/buildFixture/cv.teams). El shell/status son reales.
    setChamp(base);
    setTeams([]);
    // Resultados desde DB. La CLAVE no está en la superficie pública: el owner la hidrata en su effect
    // (ownerKey); el visitante no-owner nunca la recibe (Privacidad es owner-only).
    setAccessCode('');
    setResultsPublic(realRow.results_public !== false);
    setSavedPrivacy({ key: '', resultsPublic: realRow.results_public !== false });
    setPrivacyError('');
    setName(realRow.name || 'Copa AlGrass');
    setCoverTheme(realRow.cover_theme || COVER_THEMES[0]);
    setCoverImagePath(realRow.cover_image_path || null);   // foto opcional (path); null = solo color
  }, [isRealMode, realRow]); // eslint-disable-line
  // Publicar: loading (bloquea doble click) → publica → navega al LISTADO; confirmación + highlight allí.
  // Estructurado como operación real: loading → [request (mock: espera) ] → success → navegación.
  const [publishing, setPublishing] = useState(false);
  // Privacidad REAL: dirty = lo escrito difiere de lo guardado en DB. Publicar exige clave GUARDADA
  // (no solo tecleada) + sin cambios pendientes. En demo/preview basta la clave local (mock legacy).
  const privacyDirty = isRealMode && (accessCode.trim() !== (savedPrivacy.key || '') || resultsPublic !== savedPrivacy.resultsPublic);
  const publishEnabled = isPublicChamp
    ? (!savingPrivacy && !publishing)   // público: SIN clave; publica directo
    : isRealMode
    ? (!!savedPrivacy.key && !privacyDirty && !savingPrivacy && !publishing)
    : (!!accessCode.trim() && !publishing);
  // Guardar privacidad REAL en DB (update_championship_privacy). Success → saved* sincronizado con DB.
  async function saveChampionshipPrivacy() {
    if (!isRealMode || savingPrivacy || !privacyDirty) return;
    setSavingPrivacy(true); setPrivacyError('');
    const { data, error } = await updateChampionshipPrivacy({ championshipId: realId, registrationKey: accessCode.trim(), resultsPublic });
    setSavingPrivacy(false);
    if (error || !data) { setPrivacyError('No se pudo guardar. Intenta de nuevo.'); return; }
    const key = data.registration_key || '';
    setSavedPrivacy({ key, resultsPublic: data.results_public !== false });
    setAccessCode(key); setResultsPublic(data.results_public !== false);
    setChamp(prev => prev ? { ...prev, registrationKey: key } : prev);
    flashToast('Guardado');
  }
  async function publishChampionship() {
    if (publishing) return;                          // evita doble publicación
    if (!champ || champ.status !== 'pending_publish') return;
    // REAL: el owner publica su campeonato (pending_publish → registration_open) vía publish_championship.
    // Es la ÚNICA transición de lifecycle propia del owner; el backend valida owner + estado + clave. (AlGrass
    // puede hacer lo mismo desde Admin con set_championship_status, pero eso NO reemplaza este flujo del owner.)
    if (isRealMode) {
      if (!publishEnabled) return;                     // exige clave GUARDADA + sin cambios pendientes
      setPublishing(true); setPrivacyError('');
      const { data, error } = await publishChampionshipRpc({ championshipId: realId });
      if (error || !data) { setPublishing(false); setPrivacyError('No se pudo publicar. Intenta de nuevo.'); return; }
      navigate('/championships', { state: { publishedChampionship: data.id } });   // DB ya dice registration_open
      return;
    }
    // Demo/preview legacy (cv.championship): mock local aislado. Sigue igual: no
    // toca la base, solo el mock de la pantalla.
    if (!accessCode.trim()) return;
    const key = accessCode.trim();
    setPublishing(true);
    await mockPublishDelay();                         // mock aislado
    const seededTeams = buildTeams(4);
    writeChamp({ ...champ, registrationKey: key, status: 'registration_open', publishedAt: new Date().toISOString(), teams: seededTeams });
    navigate('/championships', { state: { publishedChampionship: key } });
  }
  // Herramientas TEMPORALES del mock (futuro: cierre automático por fecha). Conservan teams/players/config.
  // Cerrar: SORTEA equipos (una sola vez) y GENERA el fixture default (championshipFixtures) → persiste
  // teamDraw + fixture en cv.championship. Si no hay plantilla para esa cantidad, NO cierra (estado controlado).
  function closeRegistration() {
    if (champ?.status !== 'registration_open') return;
    const fx = buildFixture(teams.length, teams.map(t => t.id)); // Math.random UNA vez, aquí (no en render)
    if (!fx) { flashToast(`Aún no hay una plantilla de fixture para ${teams.length} equipos.`); return; }
    writeChamp({ ...champ, teams, status: 'registration_closed', teamDraw: fx.teamDraw, fixture: { count: fx.count, groups: fx.groups, matches: fx.matches } });
  }
  // Reabrir: conserva equipos/jugadores, vuelve a registration_open e INVALIDA teamDraw + fixture
  // (un nuevo Cerrar hará un nuevo sorteo y nuevo fixture).
  function reopenRegistration() {
    if (champ?.status !== 'registration_closed') return;
    const { teamDraw, fixture, ...rest } = champ; // descarta sorteo + fixture
    writeChamp({ ...rest, teams, status: 'registration_open' });
  }
  // TEMPORAL (mock): simula la aprobación de la transferencia por AlGrass → habilita publicar.
  // Futuro: lo hará Admin al validar el comprobante (payment_validation → pending_publish + materialización).
  function approvePaymentMock() { if (champ?.status === 'payment_validation') writeChamp({ ...champ, status: 'pending_publish' }); }
  const paymentValidating = isCreated && champ?.status === 'payment_validation'; // "Validando pago"
  const isPendingPublish = isCreated && champ?.status === 'pending_publish';      // → CTA inferior "Publicar"
  // TabBar visible en estados publicados (browsable); pre-publicación (validando/pendiente) usa CTA inferior.
  const tabBarVisible = isCreated && !paymentValidating && !isPendingPublish;
  // "Gestionar mi reserva" (patrón Match) SOLO para el OWNER REAL (campo autoritativo owner_user_id, vía amOwner).
  // Aparece en validando/pendiente (encima del CTA existente) y en publicado (único botón, flotando sobre TabBar).
  const showManageCTA = isRealMode && amOwner && isCreated;
  const [manageOpen, setManageOpen] = useState(false);   // hoja "Gestionar mi reserva" (menú → detalles/cancelar)
  // Botón "Gestionar mi reserva" (mismo look que el CTA secundario de Match). stacked=true → margen inferior
  // porque va ENCIMA del botón de estado (validando/publicar); stacked=false → único (publicado).
  const manageCTAButton = (stacked) => (
    <button onClick={() => setManageOpen(true)} className="pressable" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 54, background: '#fff', color: TEXT, border: `1.5px solid ${HAIR}`, borderRadius: 18, boxShadow: '0 6px 18px rgba(0,0,0,0.10)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', marginBottom: stacked ? 10 : 0 }}>
      Gestionar mi reserva
    </button>
  );

  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800); };
  const flashCopied = () => flashToast('Copiado');

  // Regla mock: un jugador (user_id 'you') solo puede tener UNA inscripción — en un equipo O sin equipo.
  // Cambiar de inscripción NO se bloquea: se confirma y se MUEVE (retira la anterior, deja una sola).
  const youTeam = () => teams.find(t => (t.players || []).some(p => p.id === 'you')) || null;
  const [confirmMove, setConfirmMove] = useState(null); // { fromName } | null (pasar a "sin equipo")
  function toggleNoTeam() {
    if (joinedNoTeam) { setJoinedNoTeam(false); return; } // salir de "sin equipo" (sin inscripción)
    if (isRealMode) { joinNoTeamReal(); return; }         // REAL: inscripción por RPC (Fase 9)
    if (isCreated) {
      const t = youTeam();
      if (t) { setConfirmMove({ fromName: t.name }); return; } // ya en un equipo → confirmar el cambio
    }
    commitJoinNoTeam();
  }
  function commitJoinNoTeam() {
    const cleaned = teams.map(t => ({ ...t, players: (t.players || []).filter(p => p.id !== 'you') })); // retira de todo equipo
    setTeams(cleaned);
    setJoinedNoTeam(true);
    if (isCreated) { const cv = readCV() || {}; cv.joinedNoTeam = true; cv.championship = { ...(champ || {}), teams: cleaned }; writeCV(cv); setChamp(cv.championship); }
    setConfirmMove(null);
  }

  // ── Portada: ÚNICA entrada de edición ("Editar portada") → paleta + nombre editable EN la portada ──
  function startEditCover() { setCoverSnap({ name, coverTheme }); setCoverEditMode(true); }
  function cancelCover() { if (coverSnap) { setName(coverSnap.name); setCoverTheme(coverSnap.coverTheme); } setCoverEditMode(false); }
  // REAL: persiste nombre + cover_theme (HEX crudo) en DB vía RPC (Fase 6); el color ya cambió visualmente
  // al pulsar el swatch. Demo/preview: guarda en CV como antes. Error → mantiene edición para reintentar.
  async function saveCover() {
    if (!isRealMode) { const cv = readCV() || {}; cv.name = name; cv.coverTheme = coverTheme; writeCV(cv); setCoverEditMode(false); return; }
    if (savingCover) return;
    setSavingCover(true);
    const { data, error } = await updateChampionshipCover({ championshipId: realId, name: (name.trim() || 'Copa AlGrass'), coverTheme });
    setSavingCover(false);
    if (error || !data) { flashToast('No se pudo guardar la portada.'); return; }
    setName(data.name || name);
    setCoverTheme(data.cover_theme || coverTheme);   // valor confirmado por DB (HEX crudo)
    setCoverEditMode(false);
    flashToast('Portada actualizada');
  }
  // URL pública de la foto (derivada del path; nunca se guarda la URL en DB). null = sin foto → color.
  // Variante transformada ~900px (cubre DPR alto en el shell angosto) en vez del master 1600px. Mismo aspecto
  // visual (background-image, cover, height fijo); solo baja los bytes descargados. El master no cambia.
  const coverImageUrl = useMemo(() => (isRealMode ? getChampionshipCoverUrl(supabase, coverImagePath, { width: 900, quality: 78 }) : null), [isRealMode, coverImagePath]);
  // Subir/cambiar foto (REAL, owner): valida → sube (uuid nuevo) → persiste path vía RPC → borra la anterior.
  // Si falla el upload, no toca DB. Si el upload va pero la persistencia falla, borra el objeto huérfano.
  async function onPickCoverFile(file) {
    if (!file || coverBusy || !isRealMode) return;
    const invalid = validateCoverImage(file);
    if (invalid) { flashToast(invalid); return; }
    setCoverBusy(true);
    const up = await uploadChampionshipCover(supabase, { userId: user?.id, championshipId: realId, file });
    if (up.error) { setCoverBusy(false); flashToast(up.error); return; }
    const prevPath = coverImagePath;
    const { data, error } = await updateChampionshipCover({ championshipId: realId, name: (name.trim() || 'Copa AlGrass'), coverTheme, coverImagePath: up.path, setCoverImage: true });
    if (error || !data) { await deleteChampionshipCover(supabase, up.path); setCoverBusy(false); flashToast('No se pudo guardar la foto.'); return; }
    setCoverImagePath(data.cover_image_path || up.path);
    if (prevPath && prevPath !== (data.cover_image_path || up.path)) await deleteChampionshipCover(supabase, prevPath); // borrar anterior TRAS confirmar
    setCoverBusy(false);
    flashToast('Foto actualizada');
  }
  // Eliminar foto (REAL, owner): persiste cover_image_path=null → borra el objeto anterior → vuelve a color.
  async function removeCoverImage() {
    if (coverBusy || !isRealMode || !coverImagePath) return;
    setCoverBusy(true);
    const prevPath = coverImagePath;
    const { data, error } = await updateChampionshipCover({ championshipId: realId, name: (name.trim() || 'Copa AlGrass'), coverTheme, coverImagePath: null, setCoverImage: true });
    if (error || !data) { setCoverBusy(false); flashToast('No se pudo quitar la foto.'); return; }
    setCoverImagePath(null);
    await deleteChampionshipCover(supabase, prevPath);
    setCoverBusy(false);
    flashToast('Foto eliminada');
  }

  // ── Privacidad: tras publicar la CLAVE se muestra cerrada (copiable); "Editar" la abre. El resto
  //    (Resultados públicos) no cambia. pending_publish/demo siguen totalmente editables. ──
  const privacyLocked = isCreated && !!champ && champ.status !== 'pending_publish'; // publicado/cerrado
  const keyLocked = privacyLocked && !keyEditing;                                   // clave cerrada = copiar al click
  // Persiste privacidad en cv al vuelo (solo cuando está publicado; demo/pending persisten al navegar).
  function persistPrivacy(nextKey, nextPub) {
    const key = nextKey ?? accessCode, pub = nextPub ?? resultsPublic;
    if (isRealMode) {   // REAL: solo estado local de sesión (FASE 1/2 — sin RPC de update aún); no convertir CV en fuente
      setChamp(prev => prev ? { ...prev, registrationKey: key.trim() } : prev);
      return;
    }
    const cv = readCV() || {};
    cv.accessCode = key; cv.resultsPublic = pub;
    cv.championship = { ...(champ || {}), registrationKey: key.trim() }; // clave = única fuente
    writeCV(cv); setChamp(cv.championship);
  }
  function copyKey() { if (accessCode) navigator.clipboard?.writeText(accessCode).then(flashCopied).catch(() => {}); }

  // ── Compartir: enlace PÚBLICO del campeonato (no la clave ni una ruta temporal). Web Share API si existe;
  //    si no, copia la URL al portapapeles. Mismo patrón que Compartir de equipo (deep-link a /championships/view/:id). ──
  function shareChampionship() {
    const url = (isRealMode && realId) ? `${window.location.origin}/championships/view/${realId}` : window.location.href;
    if (navigator.share) { navigator.share({ title: name, text: `${name} en AlGrass`, url }).catch(() => {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(flashCopied).catch(() => {});
  }

  const you = joinedNoTeam ? { id: 'you', name: CURRENT_USER_NAME, team: null } : null;
  // Campeonato REAL: sin pool mock "sin equipo"; roster = jugadores reales de equipos + quien se una.
  const roster = useMemo(() => combinedRoster(teams, you, !isCreated), [teams, joinedNoTeam]);
  const standings = useMemo(() => mockStandings(teams), [teams]);
  const scorers = useMemo(() => mockScorers(teams), [teams]);
  const matches = useMemo(() => mockMatches(teams), [teams]);

  // Capacidad VISUAL de slots (Torneo REAL): del rango contratado (group.max) → 6/8/12/16. Los equipos
  // reales se colocan por la izquierda y el resto son placeholders grises. NO afecta teams.length ni el
  // fixture (que usa el nº real al cerrar). Liga: un único "+" permanente. Demo: rango del grupo (min→max).
  const visualCap = (isCreated && !isLiga) ? (realTeamCap ?? visualCapacity(group ? group.max : maxTeams)) : null;
  const canCreateTeam = isLiga ? teams.length < maxTeams
    : isCreated ? teams.length < visualCap
    : teams.length < maxTeams;
  const emptySlots = isLiga ? (canCreateTeam ? 1 : 0)
    : isCreated ? Math.max(0, visualCap - teams.length)
    : Math.max(0, maxTeams - teams.length);
  // Capacidad de cupos para Inscripciones REAL: Torneo → tramos del tope contratado real (group.max de
  // format_config); Liga → un único "+". Hoy todos los cupos están vacíos (no hay equipos reales aún).
  const realSlotCount = isRealMode ? (realTeamCap ?? (isLiga ? 1 : realTeamCapacity(group?.max))) : 0;
  // Inscripciones reales (Fase 9): equipos/roster/membership desde regState. Slots libres = capacidad − equipos.
  const regTeams = regState?.teams || [];
  const regPlayers = regState?.players || [];
  const regTeamCount = regState?.team_count ?? regTeams.length;
  const regPlayerCount = regState?.player_count ?? 0;
  const myMembership = regState?.current_user_membership || null;
  // Participación del usuario (derivada de regState; el backend sigue siendo la autoridad final). En PÚBLICO
  // pagado, "sin equipo" SIEMPRE es pagado (el alta gratis sin equipo está cerrada) → paid_individual. Permite
  // gatear los CTA ANTES de abrir el checkout, evitando el "La disponibilidad cambió" tras entrar.
  const myChampPart = () => {
    const mem = myMembership;
    if (!mem) return 'none';
    if (!mem.team_id) return 'paid_individual';
    const t = regTeams.find(x => x.id === mem.team_id);
    return (t && user?.id && t.created_by_user_id === user.id) ? 'team_owner' : 'free_member';
  };
  // Organizadores reales (Fase 13): owner siempre; host solo si está puesto y es
  // otra persona —eso lo decide la RPC, aquí no se vuelve a comparar—.
  const regOrganizers = regState?.organizers || null;
  const emptyRealSlots = Math.max(0, realSlotCount - regTeamCount);
  // design llega como ID (texto). Si el ID está en el catálogo → su template (tema exacto guardado). Si NO está
  // (catálogo desalineado) → sólido con el COLOR guardado del equipo (refleja el tema, no el azul por defecto).
  const designOf = (id, color) => TEAM_DESIGNS.find(d => d.id === id) || (color ? designFromColor(color) : DEFAULT_DESIGN);
  // Normaliza un equipo del backend (championship_teams) a la MISMA representación visual que Inscripciones:
  // design llega como ID (texto) → se resuelve a objeto con designOf (igual que el grid de Inscripciones), y
  // color cae al gris por defecto si viniera vacío. Así un mismo championship_team.id se ve idéntico en
  // Inscripciones, Tabla, Partidos, Llave y Goleadores (Shield espera el OBJETO de diseño, no el id).
  const teamView = (t) => t ? { ...t, color: t.color || '#5B6470', design: designOf(t.design, t.color) } : t;

  // ── Header del campeonato REAL. Estados especiales primero; publicado → título por ETAPA:
  //    registration_open = "Inscripciones abiertas"; closed/in_progress/completed = "Calendario y resultados". ──
  const realHeaderTitle =
    champ?.status === 'payment_validation' ? 'Validando pago'
    : champ?.status === 'pending_publish' ? 'Pendiente a publicar'
    : champ?.status === 'registration_open' ? 'Inscripciones abiertas'
    : champ?.status === 'registration_closed' ? 'Equipos confirmados'
    : (champ?.status === 'in_progress' || champ?.status === 'completed') ? 'Calendario y resultados'
    : 'Tu campeonato';   // fallback (p.ej. canceled: solo visible al owner)
  // EN VIVO (Fase 21): ÚNICA marca = status in_progress + live_started_at != null. fixture_published_at NO
  // decide esto. Tolerante a que Phase 21 aún no esté aplicada (columna ausente → undefined → NO live).
  const isLive = isRealMode && champ?.status === 'in_progress' && realRow?.live_started_at != null;
  // Inscripciones deshabilitadas mientras el campeonato aún no está publicado (pending_publish).
  const inscriptionsDisabled = isRealMode && champ?.status === 'pending_publish';
  // payment_validation (Validando pago): se reutiliza TODA la UX de inscripción (escudos/holder/organizador/
  // botones) pero con "Crear equipo" y "Unirme sin equipo" SIEMPRE deshabilitados (incl. owner). Al aprobarse
  // el pago el estado real cambia y la fase recupera su comportamiento normal (no se toca ningún otro estado).
  const pvReal = isRealMode && champ?.status === 'payment_validation';
  // Permisos por estado (Fase 10): crear/sin-equipo solo en open; unirse a equipo y salir en open/closed.
  const canCreate = isRealMode && champ?.status === 'registration_open';
  // Roster CONGELADO (Fase 17): el jugador normal solo muta membership en registration_open. Desde
  // registration_closed en adelante, Inscripciones queda en modo LECTURA (espejo del gate del backend).
  const canJoinTeam = isRealMode && champ?.status === 'registration_open';
  const canLeave = canJoinTeam;
  // Área de crear/sin-equipo: visible+activa en registration_open; visible+deshabilitada en pending_publish y
  // payment_validation (misma UX de inscripción, botones inertes).
  const showCreateArea = canCreate || inscriptionsDisabled || pvReal;
  // PAGADOR y AlGrass pueden crear equipos ya en pending_publish (sin membership). Bloqueado para el resto.
  const amAlgrass = !!regState?.is_algrass;
  // pvReal → bloqueado para TODOS (incl. owner/AlGrass): aún no hay pago aprobado.
  const createLocked = (inscriptionsDisabled && !(amOwner || amAlgrass)) || pvReal;
  // ── Gestión Owner/Host/AlGrass (Fase 23). amHost: el actor es el host del campeonato (organizers.host del
  //    estado real). amManager = quien puede gestionar roster. Fase efectiva (in_progress desdoblado por
  //    live_started_at, Fase 21) para reflejar en la UI las MISMAS ventanas del backend (que igual valida). ──
  const amHost = isRealMode && !!user?.id && !!regState?.organizers?.host && regState.organizers.host.user_id === user.id;
  const amManager = amOwner || amHost || amAlgrass;
  // Orden de la lista de Jugadores (solo presentación): TÚ primero (si estás inscrito). Para host/owner: luego
  // los SIN equipo (alfabético) y después los CON equipo (alfabético). Para el resto: todos alfabético.
  // Cálculo plano (sort barato): no useMemo para no atarse a la identidad de regPlayers.
  const sortedRegPlayers = (() => {
    const arr = [...(regPlayers || [])];
    const you = (p) => (p.user_id === user?.id ? 1 : 0);
    const alpha = (a, b) => (a.full_name || '').localeCompare(b.full_name || '');
    if (amOwner || amHost) {
      return arr.sort((a, b) => (you(b) - you(a)) || ((a.team_id ? 1 : 0) - (b.team_id ? 1 : 0)) || alpha(a, b));
    }
    return arr.sort((a, b) => (you(b) - you(a)) || alpha(a, b));
  })();
  // Editar PORTADA (Fase 25): owner, host o AlGrass (jugador normal NO). El backend valida igual (update_championship_cover).
  const canEditCover = amOwner || amHost || amAlgrass;
  // Ventanas de gestión de roster: MISMA lógica compartida que ChampionshipTeam (util championshipRoster).
  const effPhase = effPhaseOf(champ?.status, realRow?.live_started_at);
  const champIsPrivate = ((realRow?.privacy ?? champ?.privacy) || 'private') === 'private';
  const { canAdminMove, canAdminEdit, canAdminCreate, canAdminAddNew } = rosterWindows(effPhase, { amOwner, amHost, amAlgrass, isPrivate: champIsPrivate }); // eslint-disable-line no-unused-vars
  // Edición de RESULTADOS (Fase 24, helper separado): host en in_progress; AlGrass en in_progress+completed.
  // Owner/player NUNCA. Espejo de _champ_can_manage_results; el backend valida igual.
  const canManageResults = (amAlgrass && (champ?.status === 'in_progress' || champ?.status === 'completed'))
    || (amHost && champ?.status === 'in_progress');
  // Asignar/cambiar equipos de slots de la LLAVE (Fase 31): host/AlGrass y SOLO in_progress (PRE-LIVE/LIVE) —
  // ventana estricta (excluye completed incluso para AlGrass). Espejo del guard del backend; el backend valida.
  // Host: se usa amHostAccess (realRow.is_host, de host_user_id) porque está SIEMPRE cargado en la superficie
  // de Resultados/Llave (con el shell), a diferencia de amHost que depende de regState (puede no estar aún).
  const canAssignSlot = (amHostAccess || amHost || amAlgrass) && champ?.status === 'in_progress';
  // Toggle EN VIVO (Fase 34): host (realRow.is_host, autoritativo) o AlGrass, SOLO en in_progress. Owner puro/jugador NO.
  const canToggleLive = (amHostAccess || amAlgrass) && champ?.status === 'in_progress';
  // Definir/cambiar campeón (Fase 36): host in_progress; AlGrass in_progress+completed. Espejo de _champ_can_manage_results.
  const canSetChampion = (amHostAccess && champ?.status === 'in_progress')
    || (amAlgrass && (champ?.status === 'in_progress' || champ?.status === 'completed'));
  // SELF (Fase 35): el Host NUNCA se inscribe como jugador (aunque sea owner; el rol Host tiene prioridad) →
  // oculta las acciones SELF (unirse sin equipo). Conserva su gestión operativa (equipos/terceros). Espejo del backend.
  const hostBlocksSelf = amHost;
  // Crear equipo desde la subvista Inscripciones (managers) donde la fase lo permita (canAdminCreate).
  // Complementa showCreateArea (solo open/pending para el jugador normal). Ya NO depende de un modo Editar.
  const showCreateAdmin = amManager && canAdminCreate;
  // (managerTabs / effAdminView / showResults / hasFixture se derivan MÁS ABAJO, tras cargar `competition`.)

  // Fecha completa "Mié 16 Sep 2026" (reutiliza formatDateLabel; sin el prefijo "Hoy,/Mañana,").
  const dateFull = organizeState?.dateKey ? formatDateLabel(organizeState.dateKey).replace(/^(Hoy|Mañana),\s*/, '') : (summary.dateLabel || null);
  // Fase 40 — Rango del RESUMEN desde la RESERVA FÍSICA (get_championship_public.reservation_games[]), NO matches.
  // Se ordena por date_key+time; primera = [0], última = [n-1]. Multi-día → "PRIMERA a ÚLTIMA"; un día → fecha
  // única; sin reserva (demo/preview) → fallback dateFull / slotLabel. El backend ya viene ordenado; se reordena
  // por robustez sin mutar el original.
  const _fmtDK = (dk) => formatDateLabel(dk).replace(/^(Hoy|Mañana),\s*/, '');
  const _resGames = (isRealMode && Array.isArray(realRow?.reservation_games))
    ? [...realRow.reservation_games].sort((a, b) => (a.date_key === b.date_key ? String(a.time).localeCompare(String(b.time)) : String(a.date_key).localeCompare(String(b.date_key))))
    : [];
  const _resFirst = _resGames[0] || null;
  const _resLast = _resGames[_resGames.length - 1] || null;
  // Señal de datos FÍSICOS reales (reserva/venue) — fuente autoritativa común a App y Admin. Permite mostrar
  // fecha/sede/canchas aunque falte summary.complies (Admin escribe un format_config.summary mínimo).
  const hasPhysicalReservation = !!_resFirst;
  const dateRangeFull = _resFirst
    ? (_resFirst.date_key !== _resLast.date_key ? `${_fmtDK(_resFirst.date_key)} a ${_fmtDK(_resLast.date_key)}` : _fmtDK(_resFirst.date_key))
    : dateFull;
  // Horario: hora de inicio de la PRIMERA reserva → fin (time + duration_min) de la ÚLTIMA reserva.
  const _addMin = (t, d) => { const [h, m] = String(t).split(':').map(Number); const tot = (h * 60 + m) + (d || 0); return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`; };
  const timeRange = (_resFirst && _resLast)
    ? `${_resFirst.time} a ${_addMin(_resLast.time, _resLast.duration_min)}`
    : (summary.slotLabel ? summary.slotLabel.replace(/\s*–\s*/, ' a ').replace(/\b([ap])m\b/gi, s => s.toUpperCase()) : null);
  // Cierre de inscripciones (INFORMATIVO): realRow.registration_closes_at (timestamptz UTC) → día-calendario en
  // America/Lima (en-CA, independiente del navegador) → formato estándar "Jue 29 Oct 2026". NO impone bloqueo:
  // el cierre efectivo depende del ESTADO (registration_closed), no del reloj. NULL → sin etiqueta → sin franja.
  const regClosesLabel = (() => {
    const ts = isRealMode ? realRow?.registration_closes_at : null;
    if (!ts) return null;
    try {
      const dk = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null;
      return formatDateLabel(dk).replace(/^(Hoy|Mañana),\s*/, '');
    } catch { return null; }
  })();

  // Partidos del campeonato REAL: desde el fixture PERSISTIDO (cv.championship.fixture), no mock.
  // Sin marcador/ganador/goles. Participantes de fases dependientes (semis/final/3.º) → "Por definir".
  const realMatches = useMemo(() => {
    if (!isCreated || !champ?.fixture?.matches) return [];
    const byId = Object.fromEntries(teams.map(t => [t.id, t]));
    const TBD = { tbd: true, name: 'Por definir' };
    return champ.fixture.matches.map((m, i) => ({
      id: 'fx' + i,
      a: m.phase === 'group' ? (byId[m.aId] || TBD) : TBD,
      b: m.phase === 'group' ? (byId[m.bId] || TBD) : TBD,
      played: false, sa: null, sb: null,
      court: m.court, time: m.time,
      dateLabel: dateFull || summary.dateLabel || '',
      phase: m.phase, label: m.label,
    }));
  }, [isCreated, champ, teams, dateFull]); // eslint-disable-line

  // ── Competición REAL (Fase 16): lectura ÚNICA de get_championship_competition → { matches, standings,
  //    scorers } YA calculados/resueltos por el backend. Se carga SOLO en in_progress/completed (única
  //    superficie de Calendario/Resultados). Separada de get_championship_registration_state (Inscripciones).
  const [competition, setCompetition] = useState(cachedReal?.competition ?? null);
  // Gate DERIVADO (mismo criterio que el fetch) → depender de ESTE booleano evita el doble fetch al resolverse
  // user/rol async (igual patrón que canLoadRegState). in_progress/completed son estados PÚBLICOS del gate del
  // backend → cualquiera (incl. anónimo, Fase 30) puede leer Calendario/Resultados sin login.
  const canLoadCompetition = isRealMode && (
    realRow?.status === 'in_progress' || realRow?.status === 'completed'
    // Managers en open/closed: se carga para detectar si YA hay fixture (habilita el tab Resultados). Requiere
    // sesión (amManager). Owner/AlGrass/host resuelven amManager sin bloquear la carga.
    || (!!user?.id && amManager && (realRow?.status === 'registration_open' || realRow?.status === 'registration_closed'))
  );
  // Carga/refresco de competición (reutilizable: montaje + tras guardar un resultado). NO resetea a null:
  // mantiene lo último conocido mientras llega lo fresco (evita flash).
  function loadCompetition() {
    if (!canLoadCompetition) return;
    getChampionshipCompetition({ championshipId: realId })
      .then(({ data, error }) => { if (!error && data) setCompetition(data); });
  }
  useEffect(() => { loadCompetition(); }, [isRealMode, realId, user?.id, realRow?.status, canLoadCompetition]); // eslint-disable-line
  // Refetch al reenfocar/volver (p.ej. tras "Cambiar equipo" en ChampionshipTeam) → la llave refleja el cambio.
  useEffect(() => {
    if (!isRealMode) return;
    const refetch = () => { if (!document.hidden) loadCompetition(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => { window.removeEventListener('focus', refetch); document.removeEventListener('visibilitychange', refetch); };
  }, [isRealMode, realId, canLoadCompetition]); // eslint-disable-line

  // ── Deep-link a EQUIPO (?team=): reenvío a ChampionshipTeam en cuanto el acceso está resuelto (NO gateOpen).
  //    Si el campeonato pide clave, primero se muestra el gate existente; al validarla, gateOpen pasa a false y
  //    este effect reenvía al MISMO equipo. Mismo estado que openTeamReal (regSnapshot/champStatus/champLive).
  //    replace:true → volver atrás desde el equipo no re-dispara el reenvío. Compartir NO bypassa permisos. ──
  useEffect(() => {
    if (deepFwdRef.current || !deepTeamId) return;
    if (!isRealMode || !realRow || gateOpen) return;   // gate primero; sin fila real, esperar
    deepFwdRef.current = true;
    persistCV();
    navigate('/championships/team', { replace: true, state: {
      realChampionship: true, teamMode: 'existing', champId: realId, teamId: deepTeamId,
      champStatus: realRow.status, champLive: realRow.live_started_at ?? null, regSnapshot: regState,
      championshipOrigin: readBackOrigin() || 'championships', isPublic: isPublicChamp,
      openSecretJoin: searchParams.get('join') === 'secret',   // intención tras login → abre modal de clave 1 vez
    } });
  }, [deepTeamId, isRealMode, realRow, gateOpen]); // eslint-disable-line

  // Adapters: re-mapean la RPC a la MISMA shape que ya consumen los presentacionales (Tabla/Llave/Partidos/
  // Goleadores). NO recalculan nada — standings/scorers vienen derivados del backend; solo renombran campos.
  const compTeamById = useMemo(() => {
    const m = {};
    (competition?.standings || []).forEach(s => { if (s.team) m[s.team.id] = teamView(s.team); });
    (competition?.matches || []).forEach(x => { if (x.home_team) m[x.home_team.id] = teamView(x.home_team); if (x.away_team) m[x.away_team.id] = teamView(x.away_team); });
    return m;
  }, [competition]);
  // Resolvedor ÚNICO de equipo por id (para escudos): prioriza la competición (MISMA fuente/objeto que la Tabla)
  // y cae a regTeams (regState) si aún no hay competición cargada. Así Tabla, Goleadores y Jugadores muestran
  // EXACTAMENTE el mismo tema/diseño para un mismo equipo (evita divergencias por regState desincronizado).
  const teamViewById = (id) => {
    if (!id) return null;
    if (compTeamById[id]) return compTeamById[id];
    const r = regTeams.find(t => t.id === id);
    return r ? teamView(r) : null;
  };
  // Equipos reales (para cfg/Llave/contador), únicos, en el orden del standings del backend.
  const compTeams = useMemo(() => {
    const seen = new Set(); const out = [];
    (competition?.standings || []).forEach(s => { const t = s.team ? teamView(s.team) : { id: s.team_id, name: 'Equipo', color: '#5B6470', design: DEFAULT_DESIGN }; if (t.id && !seen.has(t.id)) { seen.add(t.id); out.push(t); } });
    return out;
  }, [competition]);
  // Tabla: agrupada por group_code respetando el orden YA ordenado del backend (group_code, PTS, DG, GF).
  const compGroups = useMemo(() => {
    const order = []; const byCode = new Map();
    (competition?.standings || []).forEach(s => {
      const code = s.group_code ?? '';
      if (!byCode.has(code)) { byCode.set(code, []); order.push(code); }
      byCode.get(code).push({ team: s.team ? teamView(s.team) : { id: s.team_id, name: 'Equipo', color: '#5B6470', design: DEFAULT_DESIGN }, pj: s.pj, g: s.pg, e: s.pe, p: s.pp, gf: s.gf, gc: s.gc, dg: s.dg, pts: s.pts, results: teamLast5(competition?.matches, s.team_id) });
    });
    return order.map((code, i) => ({ code, label: isLiga ? 'Tabla de posiciones' : (code ? `Grupo ${code}` : `Grupo ${i + 1}`), rows: byCode.get(code) }));
  }, [competition, isLiga]);
  // Goleadores: LISTA COMPLETA de jugadores CON equipo (roster real de regState.players) + su total de goles.
  // Los goles salen del backend (competition.scorers ya cuenta SOLO los del equipo ACTUAL del jugador) → map por
  // user_id; quien no marcó → 0 (NO se ocultan). NO recalcula goles ni reagrupa; NO consulta por jugador.
  // Orden: usuario actual primero, luego alfabético por nombre (MISMO criterio que el roster de Inscripciones).
  const compScorers = useMemo(() => {
    const goalsBy = {};
    (competition?.scorers || []).forEach(s => { if (s.player_user_id) goalsBy[s.player_user_id] = s.goals || 0; });
    const teamOf = (tid) => teamViewById(tid) || { name: '—', color: '#5B6470', design: DEFAULT_DESIGN };
    const list = (regPlayers || [])
      .filter(p => p.team_id)   // SOLO jugadores con equipo (team_id null → no pertenece a ninguno)
      .map(p => ({
        id: p.user_id, name: p.full_name || 'Jugador', avatar_path: p.avatar_path, avatar_hue: p.avatar_hue,
        team: teamOf(p.team_id), goals: goalsBy[p.user_id] || 0,
      }));
    // Orden: TÚ primero (si estás inscrito), luego por MÁS goles (desc); desempate alfabético.
    return list.sort((a, b) =>
      ((b.id === user?.id ? 1 : 0) - (a.id === user?.id ? 1 : 0))
      || ((b.goals || 0) - (a.goals || 0))
      || (a.name || '').localeCompare(b.name || ''));
  }, [competition, compTeamById, regPlayers, regTeams, user?.id]);
  // Partidos: shape de MatchCard (a/b equipos o {tbd}; played; sa/sb; court/venue; fecha/hora formateadas).
  const compMatches = useMemo(() => (competition?.matches || []).map(m => {
    const played = m.home_score != null && m.away_score != null;
    return {
      id: m.id,
      a: m.home_team ? teamView(m.home_team) : { tbd: true }, b: m.away_team ? teamView(m.away_team) : { tbd: true },
      played, sa: m.home_score, sb: m.away_score,
      court: (m.field_name || '').replace(/^cancha\s*/i, '') || '—',
      venue: m.venue_name || '',
      dateLabel: m.date_key ? formatDateLabel(m.date_key).replace(/^(Hoy|Mañana),\s*/, '') : '',
      date_key: m.date_key || null,   // crudo → agrupar "Próximos" por día (subtítulo de fecha)
      time: matchTimeRange(m.start_time, m.duration_min),
      stage: m.stage,
    };
  }), [competition]);
  // Llave: estructura DERIVADA de los propios partidos de eliminación (no de cfg): semifinal(es)/final/3.º.
  const compBracket = useMemo(() => {
    const ms = competition?.matches || [];
    const semis = ms.filter(m => m.stage === 'semifinal').sort((a, b) => (a.match_order ?? 0) - (b.match_order ?? 0));
    const final = ms.find(m => m.stage === 'final') || null;
    const third = ms.find(m => m.stage === 'third_place') || null;
    // sa/sb = marcador YA existente del match (chequeo explícito de null; 0 válido). mid = id del match (para
    // asignar equipos a sus slots). Solo se transportan datos existentes, no se deriva nada nuevo.
    const pair = (m) => ({ a: m?.home_team ? teamView(m.home_team) : null, b: m?.away_team ? teamView(m.away_team) : null, sa: m?.home_score ?? null, sb: m?.away_score ?? null, mid: m?.id ?? null });
    return { hasSemifinals: semis.length > 0, hasThirdPlace: !!third, semis: [pair(semis[0]), pair(semis[1])], final: pair(final), third: pair(third) };
  }, [competition]);
  const comp = useMemo(() => ({ teams: compTeams, teamCount: compTeams.length, groups: compGroups, scorers: compScorers, matches: compMatches, bracket: compBracket }), [compTeams, compGroups, compScorers, compMatches, compBracket]);
  // Campeón OFICIAL (Fase 36): EXCLUSIVAMENTE championships.champion_team_id (dato manual, NO inferido de la
  // final). NULL → sin campeón. Se resuelve el equipo desde los datos ya cargados (compTeams/regTeams).
  const championTeamId = realRow?.champion_team_id || null;
  const champion = useMemo(() => {
    if (!championTeamId) return null;
    const raw = (regTeams || []).find(x => x.id === championTeamId);
    const t = compTeamById[championTeamId] || (raw ? teamView(raw) : null);
    return t ? { id: championTeamId, team: t } : null;
  }, [championTeamId, compTeamById, regTeams]);

  // ── Subvista Owner/Host/AlGrass (Fase 23 rework): selector [Inscripciones | Resultados] desde pending_publish
  //    en adelante. hasFixture = ¿existe calendario? (competition.matches, dato existente); Resultados solo se
  //    habilita con fixture. Cambiar de tab NO toca status/live_started_at/fixture_published_at. ──
  const hasFixture = (competition?.matches?.length || 0) > 0;
  const managerTabs = amManager && ['pending_publish', 'registration_open', 'registration_closed', 'in_progress', 'completed'].includes(champ?.status);
  const defaultAdminView = ((champ?.status === 'in_progress' || champ?.status === 'completed') && hasFixture) ? 'resultados' : 'inscripciones';
  const _wantAdminView = adminView ?? defaultAdminView;
  const effAdminView = managerTabs ? ((_wantAdminView === 'resultados' && hasFixture) ? 'resultados' : 'inscripciones') : null;
  // Superficie: managers deciden por el selector (Resultados solo con fixture); jugador normal, por status.
  const showResults = managerTabs ? (effAdminView === 'resultados') : (champ?.status === 'in_progress' || champ?.status === 'completed');

  // Organizadores del campeonato. Principal = usuario que pagó/creó (NO se deriva de games.host_user_id).
  // AlGrass = organizador opcional que Admin podrá asignar (mock: null). No es info privada (owner+jugadores).
  const organizers = {
    principal: { userId: champ?.createdByUserId ?? CURRENT_USER_ID, name: CURRENT_USER_NAME },
    algrass: null, // futuro Admin: { userId, name }; mientras null → solo se muestra el principal
  };
  // "Comunícate con el organizador": respeta el MISMO setting global de Partidos ("Contacto dentro del
  // partido": Host / AlGrass). Mock del setting + teléfonos (futuro: app_settings + perfil del organizador).
  const CONTACT_MODE = 'host';                        // mock del setting global (Host | AlGrass)
  const ALGRASS_OPERATIONAL_PHONE = '51987654321';   // mock de app_settings.algrass_operational_phone
  const principalPhone = '51987000111';              // mock del teléfono del organizador principal
  // Modo Host → organizador PRINCIPAL del campeonato (no el host de una cancha). Modo AlGrass → nº operacional.
  const organizerContactPhone = CONTACT_MODE === 'algrass' ? ALGRASS_OPERATIONAL_PHONE : principalPhone;

  // Fecha concreta de cierre — SOLO campeonato real ya publicado; usa el dato ya calculado (no recalcula).
  // Aviso anterior de "Cierre de inscripciones" eliminado: lo sustituye la franja amarilla informativa bajo la
  // portada (regClosesLabel, con registration_closes_at real). Se mantiene null para no duplicar el mensaje.
  const closeLine = null;

  // Scroll del contenedor propio: entrada principal (desde Perfil/Campeonatos/Crear) → arriba.
  // Volver desde ChampionshipTeam (cvReturn sin `from`) O desde /auth (authResuming) → restaura la posición
  // guardada por persistCV. En ambos casos `restore` trae scrollTop; sin caché de vuelta → 0 (navegación nueva).
  const scrollRef = useRef(null);
  const isTeamReturn = cvReturn && !nav?.from; // regreso desde ChampionshipTeam (no es navegación principal)
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTop = (isTeamReturn || authResuming) ? (restore?.scrollTop || 0) : 0;
  }, []); // eslint-disable-line

  // Consumo ÚNICO del match reabierto: tras sembrarlo, se limpia del CV para que no se reabra en remounts
  // posteriores sin persistCV. persistCV lo volverá a guardar si el modal sigue abierto al navegar de nuevo.
  useEffect(() => {
    if (restore?.matchDetailId == null) return;
    const cv = readCV(); if (cv && cv.matchDetailId != null) { cv.matchDetailId = null; writeCV(cv); }
  }, []); // eslint-disable-line

  // Guarda TODO el estado antes de ir a ChampionshipTeam (session state, sin persistencia real).
  // Guarda scrollTop del contenedor para restaurar la posición al volver del equipo (Team-return).
  function persistCV() {
    // REAL: el CV es SOLO caché de contenido mock (teams) e UI para el viaje a Team; identidad/status
    // viven en DB (no se persiste el campeonato real como fuente de verdad). Demo/preview: CV completo.
    if (isRealMode) {
      // REAL: el CV NO guarda clave/resultsPublic/status/privacy (todo eso vive en DB). Solo cachea el
      // contenido mock (teams) e UI para el viaje a Team; identidad/status se re-leen por refetch.
      const cv = readCV() || {};
      // REAL: además del scrollTop, se cachea realRow + regState para pintar la vuelta ya renderizada
      // (sin skeleton) y refrescar en background. Se re-leen igual por refetch (fuente de verdad = DB).
      // accessOk = ¿el actor estaba AUTORIZADO al salir a Team? (owner/miembro/clave verificada/grant persistente).
      // Al volver (cvReturn) siembra verifiedGrant y evita re-gatear pese a cambios de membership. No persiste
      // acceso indebido: solo captura la autorización REAL vigente en ese instante.
      writeCV({ ...cv, summary, organizeState, name, coverTheme, adminView, demo, resultsView, matchFilterId, matchDetailId, joinedNoTeam, teams, scrollTop: scrollRef.current?.scrollTop ?? 0, championship: { ...(cv.championship || {}), realId, teams, realRow, regState, competition, accessOk: (amOwner || amHostAccess || amMember || verifiedGrant) } });
      return;
    }
    writeCV({ summary, organizeState, name, coverTheme, accessCode, resultsPublic, demo, resultsView, matchFilterId, matchDetailId, joinedNoTeam, teams, scrollTop: scrollRef.current?.scrollTop ?? 0, contactRequest, championship: isCreated ? { ...champ, teams } : champ });
  }
  function goToNewTeam() {
    // REAL: Crear equipo exige login (anon → /auth → vuelve). Autenticado → builder REAL (nombre+diseño)
    // que persiste con save_championship_team (teamId null → CREATE). No inscribe al creador. No usa CV.
    if (isRealMode) {
      if (champ?.status === 'payment_validation') return;   // Validando pago: crear equipo bloqueado para todos
      if (champ?.status === 'pending_publish' && !amOwner && !amAlgrass) return;   // pre-publicación: crear solo owner/AlGrass
      if (!requireAuth('newTeam')) return;
      // Estar inscrito NO bloquea crear equipos (crear ≠ membership). Solo limita la capacidad global.
      if ((regState?.team_count ?? 0) >= realSlotCount) { flashToast('Los cupos están completos.'); return; }
      // PÚBLICO pagado + registration_open → checkout de equipo ("Crear equipo · S/X"). El equipo NO se
      // crea hasta confirmar el pago; no usa el builder demo que persiste al "Guardar".
      const teamPrice = Number(publicPricing?.public_team_price) || 0;
      if (isPublicChamp && teamPrice > 0 && champ?.status === 'registration_open') {
        // Gating según participación conocida (el backend bloquea igual; aquí evitamos abrir el checkout en vano).
        const part = myChampPart();
        if (part === 'paid_individual' || part === 'team_owner') { flashToast('No es posible realizar esta acción porque ya estás inscrito en este campeonato.'); return; }
        if (part === 'free_member') { flashToast('Ya perteneces a un equipo en este campeonato.'); return; }   // gratuito: sin mensaje de cancelación
        navigate('/championships/team-checkout', { state: { championshipId: realId, championshipName: name, unitPrice: teamPrice } });
        return;
      }
      persistCV();   // guarda scroll + caché (realRow/regState) para volver ya renderizado
      // champStatus + regSnapshot → tras crear, ChampionshipTeam evalúa canJoin/canDeleteTeam con el estado y
      // owner/is_algrass reales (sin quedar en null), y muestra CTA/Eliminar de forma estable.
      navigate('/championships/team', { state: { teamMode: 'new', realChampionship: true, champId: realId, summary, organizeState, champStatus: champ?.status, regSnapshot: regState, champTeamCapacity: realTeamCap } });
      return;
    }
    if (!canCreateTeam) return;
    persistCV();
    navigate('/championships/team', { state: { teamMode: 'new', summary, organizeState, maxTeams, champTeams: isCreated, champId: isRealMode ? realId : undefined } });
  }
  // REAL: inscribirse sin equipo → RPC (join_championship_without_team) → refetch del estado.
  // SET membership a "sin equipo" (insert o cambio desde un team → NULL). Confirmación en la UI antes.
  async function joinNoTeamReal() {
    if (regBusy) return;
    if (champ?.status === 'payment_validation') return;                 // Validando pago: inscribirse bloqueado
    if (champ?.status === 'pending_publish' && !amOwner) return;        // pending: solo el owner puede inscribirse
    if (!requireAuth('join')) return;                                   // anon → login → vuelve
    setRegBusy(true);
    const { error } = await joinChampionshipWithoutTeam({ championshipId: realId });
    setRegBusy(false);
    if (error) { flashToast(/REGISTRATION_CLOSED|NOT_OPEN/.test(error.message || '') ? 'Las inscripciones no están disponibles.' : 'No se pudo inscribir. Intenta de nuevo.'); loadRegState(); return; }
    flashToast('Te inscribiste sin equipo');
    loadRegState();
  }
  // ── Flujo de INSCRIPCIÓN/CAMBIO con confirmación (Fase 10). Sin inscribir → acción directa; ya inscrito
  //    en otra opción → confirmación antes de cambiar (membership única, cambiable). ──
  const [confirmChange, setConfirmChange] = useState(null);   // { kind:'team'|'noteam', teamId?, teamName? }
  // Abrir la pantalla de detalle del equipo real (membership se gestiona DENTRO). Siempre clicable.
  function openTeamReal(t, bracketCtx = null) {
    persistCV();   // guarda scroll + caché (realRow/regState) para volver ya renderizado, sin flash del top
    // fromBracket: si se entró desde un SLOT de la llave, se lleva match_id + side (+ el equipo del otro lado)
    // para habilitar "Cambiar equipo" SOLO en ese contexto. Sin contexto de llave → null (entrada normal).
    let fromBracket = null;
    if (bracketCtx?.matchId && bracketCtx?.side) {
      const m = (competition?.matches || []).find(x => x.id === bracketCtx.matchId);
      const otherTeamId = m ? (bracketCtx.side === 'home' ? m.away_team_id : m.home_team_id) : null;
      fromBracket = { matchId: bracketCtx.matchId, side: bracketCtx.side, otherTeamId };
    }
    // regSnapshot: estado ya conocido (teams/roster/membership/owner/is_algrass) → ChampionshipTeam pinta la
    // estructura real en el primer render (sin flash) y luego refresca por RPC (backend = fuente de verdad).
    navigate('/championships/team', { state: { realChampionship: true, teamMode: 'existing', champId: realId, teamId: t.id, champStatus: champ?.status, champLive: realRow?.live_started_at ?? null, regSnapshot: regState, fromBracket, isPublic: isPublicChamp } });
  }
  // Abrir el selector de equipo para un slot VACÍO de la llave (host/AlGrass en in_progress). Toma el equipo del
  // otro lado para excluirlo y el actual (si lo hubiera) como preselección. NO asigna al tocar: se confirma con Guardar.
  function openBracketAssign({ matchId, side }) {
    const m = (competition?.matches || []).find(x => x.id === matchId);
    const otherTeamId = m ? (side === 'home' ? m.away_team_id : m.home_team_id) : null;
    const currentTeamId = m ? (side === 'home' ? m.home_team_id : m.away_team_id) : null;
    setBracketConflicts(slotTeamConflicts(competition?.matches || [], matchId));   // equipos ocupados a esa hora
    setBracketSel(currentTeamId || null); setBracketErr('');
    setBracketAssign({ matchId, side, otherTeamId, uat: m?.updated_at ?? null });
  }
  async function saveBracketAssign() {
    if (bracketBusy || !bracketAssign || !bracketSel) return;
    setBracketBusy(true); setBracketErr('');
    const { error } = await setChampionshipMatchTeam({ matchId: bracketAssign.matchId, side: bracketAssign.side, teamId: bracketSel, updatedAt: bracketAssign.uat });
    setBracketBusy(false);
    if (error) {
      const m = String(error.message || '');
      setBracketErr(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para asignar equipos.'
        : /INVALID_PHASE/.test(m) ? 'Solo puedes asignar equipos con el campeonato en juego.'
        : /MATCH_HAS_RESULT/.test(m) ? 'El partido ya tiene resultado; no se puede cambiar el equipo.'
        : /SAME_TEAM/.test(m) ? 'Ese equipo ya está en el otro lado del partido.'
        : /TEAM_TIME_OVERLAP/.test(m) ? 'Ese equipo ya juega otro partido a esa hora.'
        : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo no es válido.'
        : /CONCURRENT_UPDATE/.test(m) ? 'Alguien actualizó el partido; vuelve a intentar.'
        : 'No se pudo asignar el equipo.');
      return;
    }
    setBracketAssign(null); setBracketSel(null); setBracketConflicts({});
    loadCompetition();   // refresca la llave → el slot ya muestra el equipo asignado
  }
  // Alternar EN VIVO (Fase 34): host/AlGrass en in_progress. Guarda en backend y refresca SOLO realRow (sin
  // recargar la app); el indicador reacciona a realRow.live_started_at. Doble click bloqueado con liveBusy.
  async function toggleLive() {
    if (liveBusy || !canToggleLive) return;
    setLiveBusy(true);
    const { data, error } = await toggleChampionshipLive({ championshipId: realId, live: !isLive });
    setLiveBusy(false);
    if (error || !data) {
      const m = String(error?.message || '');
      flashToast(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso.' : /INVALID_PHASE/.test(m) ? 'Solo disponible con el campeonato en juego.' : 'No se pudo cambiar el estado en vivo.');
      return;   // sin cambiar realRow → el indicador conserva su estado visual
    }
    setRealRow(prev => (prev ? { ...prev, status: data.status, live_started_at: data.live_started_at } : prev));
  }
  // Guardar campeón OFICIAL (Fase 36): host/AlGrass. Guarda por RPC y refresca solo realRow.champion_team_id.
  function openChampPick() { setChampSel(championTeamId || null); setChampErr(''); setChampPickOpen(true); }
  async function saveChampion() {
    if (champBusy || !champSel) return;
    setChampBusy(true); setChampErr('');
    const { data, error } = await setChampionshipChampion({ championshipId: realId, teamId: champSel });
    setChampBusy(false);
    if (error || !data) {
      const m = String(error?.message || '');
      setChampErr(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para definir el campeón.'
        : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo no es válido.'
        : 'No se pudo guardar el campeón.');
      return;
    }
    setChampPickOpen(false); setChampSel(null);
    setRealRow(prev => (prev ? { ...prev, champion_team_id: data.champion_team_id } : prev));
  }
  // Quitar campeón (Fase 36): limpia champion_team_id (p_team_id null) → el slot vuelve a "Seleccionar campeón".
  async function clearChampion() {
    if (champBusy) return;
    setChampBusy(true);
    const { data, error } = await setChampionshipChampion({ championshipId: realId, teamId: null });
    setChampBusy(false);
    if (error || !data) { flashToast('No se pudo quitar el campeón.'); return; }
    setRealRow(prev => (prev ? { ...prev, champion_team_id: data.champion_team_id } : prev));
  }
  function requestJoinTeam(t) {
    if (regBusy) return;
    if (myMembership?.team_id === t.id) return;                          // ya es tu equipo → no-op
    if (myMembership) { setConfirmChange({ kind: 'team', teamId: t.id, teamName: t.name }); return; } // cambio → confirmar
    if (!requireAuth('join')) return;
    joinTeamReal(t.id);                                                  // no inscrito → directo
  }
  function requestNoTeam() {
    if (regBusy) return;
    if (myMembership && !myMembership.team_id) { flashToast('Ya estás inscrito sin equipo.'); return; } // no-op
    if (myMembership) { setConfirmChange({ kind: 'noteam' }); return; }  // desde un team → confirmar
    if (!requireAuth('join')) return;
    joinNoTeamReal();                                                    // no inscrito → directo
  }
  function confirmChangeGo() {
    const c = confirmChange; setConfirmChange(null);
    if (!c) return;
    if (c.kind === 'token') joinByToken(c.token, true);   // cambio A→B confirmado (deep-link)
    else if (c.kind === 'joinpaid') navigate('/championships/join', { state: { championshipId: realId, championshipName: name, unitPrice: publicUnitPrice } });  // free_member → checkout individual (team→null al confirmar)
    else if (c.kind === 'team') joinTeamReal(c.teamId);
    else joinNoTeamReal();
  }

  // ── Deep-link de invitación por TOKEN de equipo (público pagado) ──
  // Limpia ?jt= de la URL sin remontar (replace). El backend es la autoridad del join.
  const clearJt = () => { const sp = new URLSearchParams(searchParams); sp.delete('jt'); setSearchParams(sp, { replace: true }); };
  const jtDoneRef = useRef(false);
  async function joinByToken(token, confirmChange) {
    const { error } = await joinChampionshipTeamWithToken({ token, confirmChange });
    if (error) {
      const m = String(error.message || '');
      if (/CONFIRM_TEAM_CHANGE_REQUIRED/.test(m)) { setConfirmChange({ kind: 'token', token }); return; }  // NO limpiar: espera decisión
      clearJt();
      if (/PAID_REGISTRATION_MUST_CANCEL_FIRST/.test(m)) flashToast('Primero debes cancelar tu inscripción actual.');
      else if (/NOT_OPEN/.test(m)) flashToast('Las inscripciones están cerradas.');
      else if (/INVALID_LINK/.test(m)) flashToast('El enlace de invitación no es válido.');
      else flashToast('No se pudo unir al equipo. Intenta de nuevo.');
      return;
    }
    clearJt();
    flashToast('Te uniste al equipo');
    loadRegState(); refreshReal();   // refresco autoritativo (participación + roster + fila real)
  }
  // Al abrir /championships/view/:id?jt=TOKEN: si anon → /auth conservando la URL completa (vuelve y reintenta);
  // si autenticado → join por token una sola vez por mount (jtDoneRef). 'already' = éxito idempotente (sin error).
  useEffect(() => {
    const token = searchParams.get('jt');
    if (!token || !isRealMode || jtDoneRef.current) return;
    if (!user) { persistCV(); navigate('/auth', { state: { backPath: location.pathname + location.search } }); return; }
    jtDoneRef.current = true;
    joinByToken(token, false);
  }, [searchParams, isRealMode, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // REAL: unirse a un equipo EXISTENTE (registration_open/closed). Requiere no estar ya inscrito.
  // SET membership al equipo (insert o cambio directo). La confirmación de cambio se maneja en la UI antes.
  async function joinTeamReal(teamId) {
    if (regBusy) return;
    if (!requireAuth('join')) return;
    setRegBusy(true);
    const { error } = await joinChampionshipTeam({ championshipId: realId, teamId });
    setRegBusy(false);
    if (error) { const m = String(error.message || ''); flashToast(/REGISTRATION_CLOSED|NOT_OPEN/.test(m) ? 'Las inscripciones no están disponibles.' : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo ya no existe.' : 'No se pudo unir. Intenta de nuevo.'); loadRegState(); return; }
    flashToast('Listo');
    loadRegState();
  }
  // REAL: salir/desinscribirse (DELETE de la membership). registration_open/closed.
  async function leaveReal() {
    if (regBusy) return;
    setRegBusy(true);
    const { error } = await leaveChampionship({ championshipId: realId });
    setRegBusy(false);
    if (error) { flashToast(/NOT_OPEN/.test(error.message || '') ? 'No puedes salir en este estado.' : 'No se pudo salir. Intenta de nuevo.'); loadRegState(); return; }
    flashToast('Saliste del campeonato');
    loadRegState();
  }
  // Gestión ADMINISTRATIVA de un jugador (Fase 23) vía manage_championship_player. Mueve a equipo (teamId),
  // deja sin equipo (teamId=null) o elimina la inscripción (remove). El backend valida rol+fase; aquí solo se
  // ofrecen las acciones permitidas (canAdminMove). Funciona también sobre uno mismo (backend lo trata como self).
  async function doManagePlayer({ teamId = null, remove = false }) {
    if (regBusy || !playerAction) return;
    setRegBusy(true);
    const { error } = await manageChampionshipPlayer({ championshipId: realId, userId: playerAction.user_id, teamId, remove });
    setRegBusy(false);
    if (error) { const m = String(error.message || ''); flashToast(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para esta acción.' : /NOT_OPEN/.test(m) ? 'No disponible en esta fase.' : 'No se pudo actualizar el roster.'); return; }
    setPlayerAction(null);
    flashToast('Roster actualizado');
    loadRegState();
  }
  // Guardar resultado + goleadores de un partido (Fase 24) en UNA llamada. El backend valida permiso/fase.
  // Éxito → recarga competición (marcador/goles/tabla/goleadores) y cierra el detalle.
  async function doSaveMatchResult({ homeScore, awayScore, goals }) {
    if (matchSaving || !matchDetailId) return;
    setMatchSaving(true);
    const { error } = await saveChampionshipMatchResult({ matchId: matchDetailId, homeScore, awayScore, goals });
    setMatchSaving(false);
    if (error) { const m = String(error.message || ''); flashToast(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para editar resultados.' : /NOT_OPEN/.test(m) ? 'No disponible en esta fase.' : /PLAYER_NOT_IN_TEAM|TEAM_NOT_IN_MATCH/.test(m) ? 'Datos de goles inválidos.' : 'No se pudo guardar el resultado.'); return; }
    setMatchDetailId(null);
    flashToast('Resultado guardado');
    loadCompetition();
  }
  // REAL: borrar un equipo propio (solo registration_open; reglas de vacíos las valida el backend).
  async function deleteTeamReal(teamId) {
    if (regBusy) return;
    setRegBusy(true);
    const { error } = await deleteChampionshipTeam({ championshipId: realId, teamId });
    setRegBusy(false);
    if (error) { const m = String(error.message || ''); flashToast(/TEAM_HAS_PLAYERS/.test(m) ? 'No puedes borrar un equipo con jugadores.' : /NOT_AUTHORIZED/.test(m) ? 'Solo el creador puede borrar el equipo.' : /NOT_OPEN/.test(m) ? 'Solo puedes borrar en inscripciones abiertas.' : 'No se pudo borrar el equipo.'); loadRegState(); return; }
    flashToast('Equipo eliminado');
    loadRegState();
  }
  function goToExistingTeam(team) { persistCV(); navigate('/championships/team', { state: { teamMode: 'existing', team, summary, organizeState, champTeams: isCreated, champId: isRealMode ? realId : undefined } }); }
  const createNewTeam = goToNewTeam;         // "+" y "Crear equipo" (Inscripciones) → modo NEW
  const openExistingTeam = goToExistingTeam; // escudo real en Inscripciones → modo EXISTING
  const openTeam = goToExistingTeam;         // equipo en Tabla/Llave → modo EXISTING (Partidos NO usa esto)

  // "Atrás": REAL → vuelve al ORIGEN (Profile/Championships) conservando su scroll; legacy CV → listado;
  // demo (Crear campeonato) → vuelve a Crear campeonato.
  const goBack = () => {
    if (isRealMode) return goToOrigin();
    return isCreated
      ? navigate('/championships')
      : navigate('/championships/organize', organizeState ? { state: { organizeState } } : undefined);
  };

  // Checkout habilitado solo con formato+cancha+horario resueltos y SIN personalización de cancha.
  // (El caso pendiente/personalizado tendrá "Contáctame para organizarlo", aún no construido.)
  const checkoutReady = complies && !summary.courtCustom;
  // Gate de auth SOLO en la acción final. Sin sesión: persistimos el estado (persistCV) + la intención,
  // y vamos al mismo /auth (patrón backPath) que el resto de acciones protegidas. Con sesión: intacto.
  function requireAuth(action) {
    if (user) { try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {} return true; }
    persistCV();
    try { sessionStorage.setItem(AUTH_RESUME_KEY, action); } catch {}
    // Continuidad anónimo→login: si el anónimo ya validó la clave (verifiedGrant), puentea el acceso por el
    // round-trip de /auth para NO re-pedir la clave al volver autenticado (se promueve a grant de su uid).
    if (verifiedGrant && realId) { try { sessionStorage.setItem('champ_access_resume', realId); } catch {} }
    // Real: volver al MISMO campeonato tras login (conserva el grant de acceso local). Creación: vista sin id.
    navigate('/auth', { state: { backPath: isRealMode ? ('/championships/view/' + realId) : '/championships/view' } });
    return false;
  }
  // Abre el detalle del VENUE reutilizando /venue (VenueDetail). La FOTO y el MAPA reales (cover/lat/lng) NO
  // viajan en el summary persistido → se resuelven desde la fuente PERMANENTE (tabla venues vía getVenueById),
  // por summary.venueId. NO depende del inventario/rentals activos: funciona aunque los games ya estén
  // completed/vencidos. Se navega DESPUÉS de resolver (sin flash de placeholders). Fallback de texto si no hay
  // venueId o el venue fue eliminado. backPath + backState → al volver, cvReturn restaura scroll/cache.
  // Carga ÚNICA del venue permanente (para lat/lng del botón Maps y para el detalle). Fuente de verdad de la
  // ubicación = lat/lng reales. Se reutiliza en openVenueDetail (sin consulta paralela).
  useEffect(() => {
    let alive = true;
    if (!summary?.venueId) { setVenueReal(null); return; }
    getVenueById(summary.venueId).then(v => { if (alive) setVenueReal(v); });
    return () => { alive = false; };
  }, [summary?.venueId]); // eslint-disable-line
  async function openVenueDetail() {
    if (venueBusy) return;
    if (!(summary?.venueName || summary?.venueAddress)) return;
    const backPath = isRealMode ? ('/championships/view/' + realId) : '/championships/view';
    const go = (venue) => { persistCV(); navigate('/venue', { state: { backPath, backState: { cvReturn: true }, venue } }); };
    // Fallback desde el summary (solo texto): campeonatos antiguos sin venueId o venue ya inexistente.
    const fallbackVenue = {
      venueName: summary.venueName, name: summary.venueName,
      address: summary.venueAddress || undefined, district: summary.venueDistrict || undefined,
      city: summary.city || undefined,
      chips: (summary.venueAmenities || []).map(label => ({ label })),
    };
    if (!summary.venueId) { go(fallbackVenue); return; }
    let v = venueReal;                          // reutiliza la carga única; solo consulta si aún no llegó
    if (!v) { setVenueBusy(true); v = await getVenueById(summary.venueId); setVenueBusy(false); if (v) setVenueReal(v); }
    if (!v) { go(fallbackVenue); return; }   // venue eliminado → fallback (no romper)
    // Mismo shape que Organize (foto/lat/lng/chips reales del venue), desde la tabla venues.
    go({
      venueName: v.name, name: v.name,
      address: v.address || undefined, district: v.district || undefined, city: v.city || undefined,
      lat: v.lat ?? undefined, lng: v.lng ?? undefined,
      venueCoverPath: v.cover_image_path ?? undefined,
      venueCoverVersion: v.cover_updated_at ? new Date(v.cover_updated_at).getTime() : undefined,
      chips: Object.entries(v.amenities || {}).filter(([k, val]) => val === true && AMENITY_LABEL[k]).map(([k]) => ({ kind: k, label: AMENITY_LABEL[k] })),
    });
  }
  // Fase 38 — Abrir la ficha /venue desde una entrada derivada de venues[] (mismo shape que openVenueDetail,
  // pero con los datos que ya vienen de get_championship_public: sin consulta extra a getVenueById).
  function venueStateFromEntry(v) {
    if (!v) return null;
    return {
      venueName: v.venue_name, name: v.venue_name,
      address: v.venue_address || undefined, district: v.district || undefined, city: v.city || undefined,
      lat: v.lat ?? undefined, lng: v.lng ?? undefined,
      venueCoverPath: v.cover_image_path ?? undefined,
      venueCoverVersion: v.cover_updated_at ? new Date(v.cover_updated_at).getTime() : undefined,
      chips: Object.entries(v.amenities || {}).filter(([k, val]) => val === true && AMENITY_LABEL[k]).map(([k]) => ({ kind: k, label: AMENITY_LABEL[k] })),
    };
  }
  function goVenueState(venueState) {
    if (!venueState) return;
    const backPath = isRealMode ? ('/championships/view/' + realId) : '/championships/view';
    persistCV();
    navigate('/venue', { state: { backPath, backState: { cvReturn: true }, venue: venueState } });
  }
  // El match tiene UNA sede concreta (game_id → field_id): se resuelve el venue por field_id dentro de venues[].
  function venueEntryForField(fieldId) {
    if (!fieldId) return null;
    return venuesReal.find(v => (v.fields || []).some(f => f.field_id === fieldId)) || null;
  }
  function goToCheckout() {
    if (!checkoutReady) return;
    if (!requireAuth('checkout')) return;
    persistCV();
    navigate('/championships/checkout', { state: { summary, organizeState, championshipName: name, coverTheme } });
  }
  // Formato/cancha pendientes → "Contáctame para organizarlo" (flujo mock de contacto, no checkout).
  function goToContact() {
    if (!requireAuth('contact')) return;
    persistCV();
    navigate('/championships/contact', { state: { summary, organizeState, championshipName: name } });
  }

  // Reanudación tras login/registro: al regresar autenticado con una intención pendiente, se ejecuta
  // la MISMA acción final (checkout/contacto) con el estado ya restaurado (restore=persisted). Si el
  // usuario canceló el login (vuelve sin sesión), se descarta la intención para no reanudar luego.
  useEffect(() => {
    // Puente anónimo→login del acceso por clave: el anónimo YA validó la clave (verifiedGrant) antes de ir a login;
    // al volver autenticado a ESTE campeonato se conserva el acceso en memoria del flujo actual (sin re-pedir la
    // clave). NO se cachea en sessionStorage porque aquí no tenemos la clave introducida (solo el id); si sale y
    // vuelve más tarde, se le pedirá de nuevo. Si el login se canceló, se descarta el puente.
    let g; try { g = sessionStorage.getItem('champ_access_resume'); } catch {}
    if (g) {
      try { sessionStorage.removeItem('champ_access_resume'); } catch {}
      if (user?.id && g === realId) setVerifiedGrant(true);
    }
    let pending; try { pending = sessionStorage.getItem(AUTH_RESUME_KEY); } catch {}
    if (!pending) return;
    if (!user) { try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {} return; }
    try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {}
    if (pending === 'checkout') goToCheckout();
    else if (pending === 'contact') goToContact();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // REAL: mientras carga (o hidrata) mostramos loading; NUNCA caemos a demo ni a "Crear campeonato".
  // Si falla el fetch → error explícito, sin usar el CV como fallback (no mostrar otro campeonato).
  if (DBG) {
    const snap = `${realId}|${realLoading}|${realError}|${!!champ}|${awaitingKeyReval}|${keyRevalidating}|${keyRevalDone}|${pricingResolved}|${isPublicChamp}|${oauthInitPending}|${!!user}`;
    if (skelDbgRef.current !== snap) {
      skelDbgRef.current = snap;
      console.log('[CHAMP_LOAD] skeleton'
        + '\n  inst=' + instIdRef.current
        + '\n  id=' + realId
        + '\n  loading=' + realLoading
        + '\n  error=' + realError
        + '\n  champ=' + (!!champ)
        + '\n  awaitingKeyReval=' + awaitingKeyReval
        + '\n  keyRevalidating=' + keyRevalidating
        + '\n  keyRevalDone=' + keyRevalDone
        + '\n  pricingResolved=' + pricingResolved
        + '\n  isPublicChamp=' + isPublicChamp
        + '\n  authLoading=' + oauthInitPending
        + '\n  hasUser=' + (!!user));
    }
  }
  if (isRealMode && (realLoading || realError || !champ || awaitingKeyReval || keyRevalidating)) {
    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
        <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
          <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button onClick={goToOrigin} aria-label="Atrás" style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Tu campeonato</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          {realError ? (
            <div style={{ color: SUB, fontSize: 14, lineHeight: 1.5 }}>
              No pudimos cargar el campeonato.
              <div><button onClick={() => navigate('/championships')} className="pressable" style={{ marginTop: 14, height: 44, padding: '0 20px', borderRadius: 12, border: 'none', background: ORANGE, color: '#1B1B1F', fontFamily: 'inherit', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Volver a campeonatos</button></div>
            </div>
          ) : (
            <span style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid #E4E4EA', borderTop: `3px solid ${BLUE}`, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
          )}
        </div>
        <TabBar />
      </div>
    );
  }

  // Gate de acceso: visitante no-owner sin grant → pantalla de clave (NO se muestran datos internos ni
  // controles). Owner nunca la ve. La card/listado siguen siendo públicos (la clave se pide al ENTRAR).
  if (gateOpen) {
    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
        <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
          <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button onClick={goToOrigin} aria-label="Atrás" style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Acceso al campeonato</div>
            {/* Compartir el enlace público — visible también en el gate (anon sin clave puede compartir). */}
            <button className="pressable" onClick={shareChampionship} aria-label="Compartir" style={{ position: 'absolute', right: 0, width: 30, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
              {I.share('#fff')}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 20px', maxWidth: 420, width: '100%', margin: '0 auto' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="10.5" width="16" height="10.5" rx="2.4" stroke={BLUE} strokeWidth="1.8" /><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" /></svg>
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: TEXT, textAlign: 'center', letterSpacing: -0.3 }}>{name}</div>
          <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5, textAlign: 'center', marginTop: 8 }}>Este campeonato es privado. Ingresa la clave de acceso que te compartió el organizador para entrar.</div>
          <input value={gateKey} onChange={e => { setGateKey(e.target.value); if (gateError) setGateError(''); }} onKeyDown={e => { if (e.key === 'Enter') submitGate(); }} placeholder="Clave de acceso" maxLength={24} autoFocus style={{ width: '100%', height: 48, borderRadius: 12, border: `1px solid ${gateError ? RED : HAIR}`, padding: '0 14px', fontSize: 16, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', letterSpacing: 1, marginTop: 20, textAlign: 'center' }} />
          {gateError && <div style={{ fontSize: 12.5, color: RED, textAlign: 'center', marginTop: 8 }}>{gateError}</div>}
          <button onClick={submitGate} disabled={gateChecking} className={gateChecking ? undefined : 'pressable'} style={{ marginTop: 16, width: '100%', height: 52, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: gateChecking ? 'default' : 'pointer', opacity: gateChecking ? 0.7 : 1, fontFamily: 'inherit', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            {gateChecking && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.25)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
            {gateChecking ? 'Validando…' : 'Entrar'}
          </button>
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header (sin TabBar en esta pantalla) */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={goBack} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{isRealMode ? realHeaderTitle : isCreated && champ?.status === 'registration_open' ? 'Inscripciones abiertas' : isCreated && champ?.status === 'registration_closed' ? 'Calendario y resultados' : 'Ver mi campeonato'}</div>
          {/* Compartir — SOLO en campeonato REAL (todo actor, toda fase); comparte el enlace PÚBLICO. En "Crear/Ver
              mi campeonato" (demo/preview, sin campeonato real) NUNCA se muestra: no hay URL pública que compartir. */}
          {isRealMode && (
            <button className="pressable" onClick={shareChampionship} aria-label="Compartir" style={{ position: 'absolute', right: 0, width: 30, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
              {I.share('#fff')}
            </button>
          )}
          {/* Demo (previa de Crear campeonato, root del flujo): X = SALIR → listado. La flecha izquierda
              vuelve un nivel (a Crear un campeonato). El campeonato REAL no lleva X (es pantalla principal). */}
          {!isCreated && (
            <button onClick={() => setConfirmExit(true)} aria-label="Salir" style={{ position: 'absolute', right: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={scrollRef} className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* ── Portada — nombre editable SOLO en coverEditMode; una única entrada ("Editar portada") ── */}
          <div style={{ position: 'relative', height: 180, background: coverColor(coverTheme), overflow: 'hidden' }}>
            {/* REAL con foto → imagen del bucket público; si no, queda el cover_theme de fondo. */}
            {coverImageUrl && <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${coverImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }} />
            {/* Acciones (top-right) — owner/host/AlGrass. Jugador: portada en lectura, sin acciones. */}
            {canEditCover && (
              <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 8 }}>
                {coverEditMode ? (
                  <>
                    <button onClick={cancelCover} disabled={savingCover} className="pressable" style={coverPill}>Cancelar</button>
                    <button onClick={saveCover} disabled={savingCover} className="pressable" style={{ ...coverPill, background: ORANGE, color: '#1B1B1F', opacity: savingCover ? 0.7 : 1 }}>{savingCover ? 'Guardando…' : 'Guardar'}</button>
                  </>
                ) : (
                  <button onClick={startEditCover} className="pressable" style={coverPill}>Editar portada</button>
                )}
              </div>
            )}
            {/* Nombre: mismo lugar/jerarquía en lectura y edición (input in situ SOLO owner en edición) */}
            {coverEditMode && isOwner ? (
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del campeonato" maxLength={40} style={{ position: 'absolute', left: 16, right: 120, bottom: 14, background: 'transparent', border: 'none', borderBottom: '1.5px solid rgba(255,255,255,0.6)', outline: 'none', color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: -0.4, fontFamily: 'inherit', textShadow: '0 1px 4px rgba(0,0,0,0.4)', padding: 0 }} />
            ) : (
              <div style={{ position: 'absolute', left: 16, right: 120, bottom: 14, color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: -0.4, fontFamily: 'inherit', textShadow: '0 1px 4px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            )}
            {coverBadge && (
              <div style={{ position: 'absolute', right: 12, bottom: 14, padding: '5px 11px', borderRadius: 999, background: 'rgba(0,0,0,0.42)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{coverBadge}</div>
            )}
            {/* "Ahora" (EN VIVO) SOBRE la portada, ENCIMA del contador de equipos.
                · Host/AlGrass en in_progress (canToggleLive): CLICABLE → alterna PRE-LIVE↔LIVE (toggle_championship_live).
                  OFF (pre-live) = chip tenue; ON (live) = chip rojo.
                · Resto: solo se muestra en LIVE, no clicable (lectura). */}
            {(isLive || canToggleLive) && (
              canToggleLive ? (
                <button onClick={liveBusy ? undefined : toggleLive} disabled={liveBusy} className="pressable"
                  style={{ position: 'absolute', right: 12, bottom: coverBadge ? 44 : 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, border: isLive ? 'none' : '1px solid rgba(255,255,255,0.7)', background: isLive ? RED : 'rgba(0,0,0,0.42)', color: '#fff', fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', cursor: liveBusy ? 'default' : 'pointer', opacity: liveBusy ? 0.7 : 1, boxShadow: isLive ? '0 2px 8px rgba(0,0,0,0.28)' : 'none', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <FontAwesomeIcon icon={faTowerBroadcast} style={{ fontSize: 12 }} />
                  {isLive ? 'Ahora' : 'Poner en vivo'}
                </button>
              ) : (
                <div style={{ position: 'absolute', right: 12, bottom: coverBadge ? 44 : 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: RED, color: '#fff', fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.28)' }}>
                  <FontAwesomeIcon icon={faTowerBroadcast} style={{ fontSize: 12 }} />
                  Ahora
                </div>
              )
            )}
          </div>

          {/* Franja amarilla ÚNICA bajo la portada (los dos mensajes son mutuamente excluyentes, mismo contenedor):
              · registration_open + hay fecha prevista → "Cierre de inscripciones de equipos: {fecha}" (informativo).
              · registration_closed → "Puedes inscribirte pero ya no crear equipos" (SIEMPRE, incluso con fecha NULL;
                a todos los jugadores, sin depender de inscripción/equipo/rol). Otras etapas → nada.
              Coherencia: en RC unirse a un equipo existente está permitido (ChampionshipTeam.selfJoinOk incluye
              registration_closed, espejo del backend join_championship_team) y crear equipos está bloqueado. */}
          {isRealMode && (() => {
            const msg =
              champ?.status === 'registration_open'
                ? (regClosesLabel
                    ? <>Cierre de inscripciones de equipos: <span style={{ fontWeight: 800 }}>{regClosesLabel}</span></>
                    : null)
                : champ?.status === 'registration_closed'
                ? 'Puedes inscribirte pero ya no crear equipos'
                : null;
            if (!msg) return null;
            return (
              <div style={{ background: '#FFF7EA', borderBottom: `1px solid ${ORANGE}66`, padding: '10px 16px', fontSize: 13, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {msg}
              </div>
            );
          })()}

          {/* Paleta — solo en edición; sin input de nombre separado (el nombre se edita EN la portada) */}
          {coverEditMode && (
            <div style={{ background: '#fff', borderBottom: `1px solid ${HAIR}`, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {COVER_THEMES.map(c => (
                  <button key={c} onClick={() => setCoverTheme(c)} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', boxShadow: coverTheme === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none', outline: 'none', WebkitTapHighlightColor: 'transparent', padding: 0 }} />
                ))}
                {/* Foto opcional (SOLO real). Preview/demo: sin Storage → botón oculto. */}
                {isRealMode && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {coverImagePath && <button onClick={removeCoverImage} disabled={coverBusy} className="pressable" style={{ display: 'flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', cursor: coverBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: RED, opacity: coverBusy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Quitar foto</button>}
                    <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0] || null; if (coverFileRef.current) coverFileRef.current.value = ''; onPickCoverFile(f); }} />
                    <button onClick={() => coverFileRef.current?.click()} disabled={coverBusy} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', cursor: coverBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: TEXT, opacity: coverBusy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke={TEXT} strokeWidth="1.6" /><circle cx="12" cy="13" r="3.2" stroke={TEXT} strokeWidth="1.6" /><path d="M8 6l1.5-2h5L16 6" stroke={TEXT} strokeWidth="1.6" strokeLinejoin="round" /></svg>
                      {coverBusy ? 'Subiendo…' : (coverImagePath ? 'Cambiar foto' : 'Foto')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ZONA ABIERTA (mismo patrón que GameDetail: sin card, padding '18px 16px', hairline
                superior, título 16/700). Fecha/Venue/Cancha + amenities. ── */}
          <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
            {/* BLOQUE 1 — Fecha (completa) + horario (inicio → final). "Comunícate con el organizador"
                (OrganizerContactButton global) se OCULTA SOLO en esta vista; intacto en GameDetail/RentalDetail. */}
            <ResumenRow
              icon="cal"
              value={(complies || hasPhysicalReservation) ? (dateRangeFull || 'Pendiente por confirmar') : 'Pendiente por confirmar'}
              sub={(complies || hasPhysicalReservation) ? (timeRange || null) : null}
              action={amOwner ? <OrganizerContactButton phone={organizerPhone} /> : undefined}
            />
            <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
            {/* BLOQUE 2 — Venue + dirección · Google Maps. Gate = checkoutReady (complies && !courtCustom):
                solo con CANCHA REAL confirmada. Si el usuario eligió "contactarme"/"no encuentro" (courtCustom)
                → NO cancha real → "Pendiente por confirmar" + SIN botón Maps (no inventar dirección). */}
            {(() => {
              // MULTI-VENUE (Fase 38): el bloque muestra el venue SELECCIONADO; tocar sede/dirección NO abre la
              // ficha /venue, abre el SELECTOR de sedes (elegir qué venue se visualiza). Al elegir otro venue se
              // actualiza nombre/dirección/canchas y el enlace de mapa (todo local, sin tocar fixture ni DB).
              if (isMultiVenue) {
                const vAddr = `${selectedVenue.venue_address ?? ''}${selectedVenue.district ? (selectedVenue.venue_address ? ' · ' : '') + selectedVenue.district : ''}`;
                const openPicker = () => setVenuePickerOpen(true);
                const linkStyle = { textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
                return (
                  <ResumenRow
                    icon="pin"
                    value={<span role="button" onClick={openPicker} style={linkStyle}>{selectedVenue.venue_name || 'Sede'}</span>}
                    sub={vAddr ? <span role="button" onClick={openPicker} style={linkStyle}>{vAddr}</span> : undefined}
                    action={<MapsLinkButton lat={selectedVenue.lat ?? null} lng={selectedVenue.lng ?? null} address={[selectedVenue.venue_name, selectedVenue.venue_address, selectedVenue.district]} down />}
                  />
                );
              }
              // SINGLE-VENUE FÍSICO (App y Admin): datos reales de venues[0] (nombre/dirección/ciudad). Nombre y
              // dirección → ficha /venue con el shape ya disponible (venueStateFromEntry), sin consulta extra.
              if (displayVenue) {
                const vAddr = `${displayVenue.venue_address ?? ''}${displayVenue.district ? (displayVenue.venue_address ? ' · ' : '') + displayVenue.district : ''}`;
                const open = () => goVenueState(venueStateFromEntry(displayVenue));
                const linkStyle = { textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
                return (
                  <ResumenRow
                    icon="pin"
                    value={<span role="button" onClick={open} style={linkStyle}>{displayVenue.venue_name || 'Sede'}</span>}
                    sub={vAddr ? <span role="button" onClick={open} style={linkStyle}>{vAddr}</span> : undefined}
                    action={<MapsLinkButton lat={displayVenue.lat ?? null} lng={displayVenue.lng ?? null} address={[displayVenue.venue_name, displayVenue.venue_address, displayVenue.district]} down />}
                  />
                );
              }
              // FALLBACK HISTÓRICO (sin datos físicos): summary. Comportamiento INTACTO.
              const venueClickable = checkoutReady && (summary.venueName || summary.venueAddress);
              const addrText = `${summary.venueAddress ?? ''}${summary.venueDistrict ? ' · ' + summary.venueDistrict : ''}`;
              const linkStyle = { textDecoration: 'underline', textUnderlineOffset: 2, cursor: venueBusy ? 'default' : 'pointer', opacity: venueBusy ? 0.55 : 1, WebkitTapHighlightColor: 'transparent' };
              return (
                <ResumenRow
                  icon="pin"
                  value={venueClickable
                    ? <span role="button" onClick={openVenueDetail} style={linkStyle}>{summary.venueName || 'Pendiente por confirmar'}</span>
                    : (checkoutReady ? (summary.venueName || 'Pendiente por confirmar') : 'Pendiente por confirmar')}
                  sub={venueClickable && addrText
                    ? <span role="button" onClick={openVenueDetail} style={linkStyle}>{addrText}</span>
                    : (checkoutReady ? addrText : 'Te contactaremos para coordinar la sede y el horario.')}
                  action={checkoutReady && (summary.venueAddress || summary.venueName) ? <MapsLinkButton lat={venueReal?.lat ?? null} lng={venueReal?.lng ?? null} address={[summary.venueName, summary.venueAddress, summary.venueDistrict]} down /> : undefined}
                />
              );
            })()}
            <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
            {/* BLOQUE 3 — SOLO "X canchas · X horas" (sin segunda línea) */}
            {displayVenue ? (() => {
              // FÍSICO (single o multi): canchas del venue mostrado (fields de esa sede en la reserva física).
              const names = (displayVenue.fields || []).map(f => f.field_name).filter(Boolean);
              return <ResumenRow icon="grid" value={names.length ? `Canchas: ${names.join(', ')}` : 'Cancha por confirmar'} />;
            })() : (
              <ResumenRow icon="grid" value={complies ? (summary.courtNames?.length ? `Canchas: ${summary.courtNames.join(', ')}` : (summary.configLabel || 'Cancha por confirmar')) : 'Cancha por confirmar'} />
            )}
            {/* Amenities — 7v7 (píldora con icono de dos personas de Partidos) + Aire libre + amenities del venue */}
            {complies && !summary.courtCustom && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                <span style={{ ...amenityChip, gap: 5 }}>{I.twoPeople(TEXT)}{summary.formatLabel || '7v7'}</span>
                {summary.venueAmenities?.map(a => <span key={a} style={amenityChip}>{a}</span>)}
              </div>
            )}
          </div>

          {/* Descripción — misma sección abierta (título + copy), sin card */}
          <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.1, marginBottom: 10 }}>Descripción</div>
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.5 }}>
              {(champ?.status === 'in_progress' || champ?.status === 'completed')
                ? 'Cada equipo juega por lo menos 3 partidos y los finalistas hasta 5. Puedes consultar y filtrar tus partidos, ver fechas, ubicaciones, resultados y goleadores.'
                : 'Cada equipo juega por lo menos 3 partidos y los finalistas hasta 5. El cronograma se organizará de acuerdo a la cantidad de equipos que se registren.'}
            </div>
          </div>

          {/* ── ZONA DE CARDS ── (más espacio inferior en pending sin clave: el aviso amarillo + CTA no debe
              cubrir el holder de jugadores) */}
          <div style={{ padding: `10px 16px calc(${
            paymentValidating ? (showManageCTA ? 140 : 84)
            : isPendingPublish ? ((isRealMode ? !savedPrivacy.key : !accessCode.trim()) ? (showManageCTA ? 174 : 118) : (showManageCTA ? 140 : 84))
            : 84
          }px + env(safe-area-inset-bottom))` }}>
            {/* "Validando pago" — transferencia enviada, esperando validación de AlGrass. Publicar bloqueado. */}
            {isOwner && paymentValidating && (
              <div style={{ ...CARD, background: '#FFF7EA', border: `1px solid ${ORANGE}55` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, letterSpacing: -0.1 }}>Validando pago</div>
                </div>
                <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 6 }}>Estamos validando tu transferencia. Podrás publicar el campeonato cuando el pago esté confirmado.</div>
                {/* REAL: el status lo cambia Admin en DB (approve_championship_transfer); al reentrar/refrescar
                    se refetch por ID y se lee el nuevo status. La herramienta mock solo queda en demo/preview. */}
                {!isRealMode && <OwnerPhaseTool label="Simular aprobación de pago (mock)" note="Herramienta temporal — futuro: lo hará Admin al validar el comprobante." onClick={approvePaymentMock} />}
              </div>
            )}
            {/* ── Privacidad — EXCLUSIVA del owner. Jugador: NO se renderiza (desaparece por completo). ──
                Publicado (registration_open/closed/…): fondo secundario muy suave (segundo plano). ── */}
            {/* Solo campeonato REAL creado: en la previa de "Crear campeonato" (demo) NO se muestra Privacidad. */}
            {isOwner && isCreated && (
            <div style={{ ...CARD, background: privacyLocked ? '#F7F7F9' : '#fff' }}>
              <div style={H}>Privacidad</div>
              {/* Clave de acceso — SOLO PRIVADOS. En público de AlGrass NO existe clave: se oculta por completo. */}
              {!isPublicChamp && (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>Configura clave de acceso</div>
                {privacyLocked && (
                  <button onClick={() => { if (!isRealMode && keyEditing) persistPrivacy(); setKeyEditing(v => !v); }} className="pressable" style={{ background: 'none', border: 'none', cursor: 'pointer', color: BLUE, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{keyEditing ? 'Listo' : 'Editar'}</button>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 2, marginBottom: 8 }}>Con esta clave podrán acceder tus jugadores.</div>
              {keyLocked ? (
                /* Clave cerrada → click copia y muestra "Copiado" (no edita) */
                <button onClick={copyKey} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 42, borderRadius: 10, border: `1px solid ${HAIR}`, background: SOFT, padding: '0 12px', cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accessCode || '—'}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="9" y="9" width="11" height="11" rx="2" stroke={SUB} strokeWidth="1.7" /><path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" stroke={SUB} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ) : (
                <input value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Ej. PICHANGA2026" maxLength={24} style={{ width: '100%', height: 42, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', letterSpacing: 1 }} />
              )}
              <div style={{ fontSize: 12, color: SUB, marginTop: 6 }}>Comparte este código con tus invitados para que se inscriban.</div>
              <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
              </>)}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>Calendario y resultados públicos</div>
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginTop: 2 }}>Cualquier usuario puede ver Calendario y resultados. Ideal para que cualquiera siga tu torneo. Desactívalo para que solo lo vean los inscritos.</div>
                </div>
                <button onClick={() => { const next = !resultsPublic; setResultsPublic(next); if (!isRealMode && privacyLocked) persistPrivacy(undefined, next); }} style={{ width: 44, height: 26, borderRadius: 999, border: 'none', background: resultsPublic ? BLUE : '#E5E5EA', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0, transition: 'background .2s ease', outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ position: 'absolute', top: 2, left: resultsPublic ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left .2s ease' }} />
                </button>
              </div>
              {/* Guardar (REAL): persiste clave + resultados en DB (update_championship_privacy). disabled
                  sin cambios o guardando; success sincroniza saved* → habilita Publicar. NO sale de la pantalla. */}
              {isRealMode && isOwner && (
                <>
                  <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
                  <button onClick={saveChampionshipPrivacy} disabled={!privacyDirty || savingPrivacy} className={(privacyDirty && !savingPrivacy) ? 'pressable' : undefined} style={{ width: '100%', height: 46, borderRadius: 12, border: 'none', background: (privacyDirty && !savingPrivacy) ? BLUE : '#E8E8EC', color: (privacyDirty && !savingPrivacy) ? '#fff' : '#9A9AA0', cursor: (privacyDirty && !savingPrivacy) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    {savingPrivacy && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)', borderTop: '2.5px solid #fff', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
                    {savingPrivacy ? 'Guardando…' : 'Guardar'}
                  </button>
                  {privacyError && <div style={{ fontSize: 12, color: RED, textAlign: 'center', marginTop: 8 }}>{privacyError}</div>}
                </>
              )}
              {/* Publicar se movió al CTA inferior (no se duplica aquí). Solo la nota de cierre. */}
              {isPendingPublish && (
                <>
                  <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
                  <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>Las inscripciones cierran {CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS} días antes del campeonato. Configura la clave y publica desde el botón inferior.</div>
                </>
              )}
            </div>
            )}

            {/* Holder de CAMPEÓN — ARRIBA del selector y del contenido (no rompe la continuidad selector↔contenido).
                Visible SIEMPRE que la Final tenga ganador (info pública), independiente del tab. Diseño limpio:
                fondo claro, borde sutil, sombra muy suave y un acento dorado mínimo (no bloque amarillo). Todo
                clickeable → ChampionshipTeam del campeón (openTeamReal SIN fromBracket → no activa edición de slot). */}
            {champion && (
              <button onClick={() => openTeamReal(champion.team)} className="pressable" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '12px 14px', borderRadius: 16, border: `1px solid ${HAIR}`, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <Shield color={champion.team.color} design={champion.team.design} name={champion.team.name} size={46} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#B8860B', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span aria-hidden="true">🏆</span> Campeón <span aria-hidden="true" style={{ fontSize: 10 }}>🎉</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{champion.team.name}</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>¡Felicitaciones, campeones!</div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: '#C7C7CC' }}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}

            {/* Selector de subvista Owner/Host/AlGrass (Fase 23): SOLO navegación interna; NO cambia status.
                Visible en in_progress/completed (donde conviven Inscripciones y Calendario). El jugador normal
                NO lo ve (managerTabs=false) y sigue viendo la superficie por status. */}
            {/* Aviso (organizador) ENCIMA del selector: recuerda que solo el organizador navega entre
                Inscripciones/Resultados para editar. El título refleja el estado: "Inscripciones cerradas" en
                registration_closed; "Calendario y resultados" con el calendario publicado (in_progress/completed).
                Solo presentación; el jugador normal no lo ve. */}
            {isRealMode && managerTabs && ['registration_closed', 'in_progress', 'completed'].includes(champ?.status) && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 12px', padding: '12px 14px', background: '#FFF7EA', border: `1px solid ${ORANGE}66`, borderRadius: 12 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="1.8" /><path d="M12 11v5" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.1" fill={ORANGE} /></svg>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, lineHeight: 1.45 }}>{champ?.status === 'registration_closed' ? 'Equipos confirmados' : 'Calendario y resultados'}</div>
                  <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45, marginTop: 3 }}>Solo tú como organizador podrás navegar entre inscripciones y resultados para editar.</div>
                </div>
              </div>
            )}
            {isRealMode && managerTabs && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Seg active={effAdminView === 'inscripciones'} onClick={() => setAdminView('inscripciones')}>Inscripciones</Seg>
                <Seg active={effAdminView === 'resultados'} disabled={!hasFixture} onClick={() => setAdminView('resultados')}>Calendario</Seg>
              </div>
            )}

            {isRealMode ? (
              /* ── Campeonato REAL/materializado — CERO datos competitivos mock. Solo shell real + estados
                     vacíos limpios hasta conectar backend de inscripciones/fixture/resultados. ── */
              showResults ? (
                /* in_progress/completed → Calendario/Resultados REAL (Fase 16): Tabla/Llave/Partidos + Goleadores
                   desde get_championship_competition (datos YA calculados por el backend; sin recálculo aquí).
                   El estado LIVE se indica con "Ahora" SOBRE la portada (arriba), no aquí. */
                <>
                  <Resultados view={resultsView} setView={setResultsView} teams={comp.teams} standings={[]} scorers={[]} matches={[]} venueName={summary.venueName || 'AlGrass Arena'} openTeam={openTeamReal} filter={comp.teams.find(t => t.id === matchFilterId) || null} onFilter={team => setMatchFilterId(team ? team.id : null)} onOpenMatch={setMatchDetailId} isLiga={isLiga} real={true} comp={comp} meId={user?.id} onSelectPlayer={setSelectedPlayer} realOrganizers={regOrganizers} onAssignSlot={openBracketAssign} canAssignSlot={canAssignSlot} championTeamId={championTeamId} canSetChampion={canSetChampion} onSetChampion={openChampPick} onClearChampion={clearChampion} />
                </>
              ) : (
                /* pending_publish / payment_validation / registration_open → Inscripciones REAL.
                   SIN equipos/jugadores mock: solo la GRILLA DE CAPACIDAD (slots vacíos = cupos), derivada
                   del tope real contratado. Cada slot "+" es el acceso a Crear equipo (misma regla actual). */
                /* Mismo patrón que el componente Inscripciones (demo/legacy): CARD 1 = grilla + Crear equipo
                   + Unirme sin equipo (juntos). CARD 2 = SOLO el roster. */
                <>
                  {/* Aviso RESALTADO SOLO en pending_publish: las inscripciones aún no están habilitadas. */}
                  {inscriptionsDisabled && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 12px', padding: '12px 14px', background: '#FFF7EA', border: `1px solid ${ORANGE}66`, borderRadius: 12 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="1.8" /><path d="M12 11v5" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.1" fill={ORANGE} /></svg>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, lineHeight: 1.45 }}>Crea equipos que solo tú podrás editar.</div>
                    </div>
                  )}
                  {/* registration_closed: holder AMARILLO (MISMO patrón que el aviso de pending_publish) para el
                      JUGADOR NORMAL (versión informativa). El organizador ve su propio aviso encima del selector
                      (no se duplica aquí). Es solo presentación: NO cambia las acciones permitidas. */}
                  {champ?.status === 'registration_closed' && !amManager && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 12px', padding: '12px 14px', background: '#FFF7EA', border: `1px solid ${ORANGE}66`, borderRadius: 12 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" stroke={ORANGE} strokeWidth="1.8" /><path d="M12 11v5" stroke={ORANGE} strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.1" fill={ORANGE} /></svg>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, lineHeight: 1.45 }}>Equipos confirmados</div>
                        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.45, marginTop: 3 }}>Aún puedes inscribirte o cambiar de equipo, pero ya no es posible crear nuevos equipos.</div>
                      </div>
                    </div>
                  )}
                  {/* CARD 1 — equipos reales (unirse / tu equipo / borrar propio) + CTAs según estado. */}
                  <div style={CARD}>
                    <div style={H}>Inscripciones</div>
                    <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 4, marginBottom: 12 }}>
                      {myMembership
                        ? (canJoinTeam ? 'Estás inscrito. Puedes cambiar de equipo o salir mientras las inscripciones sigan abiertas.'
                                       : 'Estás inscrito.')
                        : canJoinTeam ? (regTeams.length ? 'Toca un equipo para unirte.' : 'Aún no hay equipos.') + (canCreate ? ' También puedes crear el tuyo o unirte sin equipo.' : '')
                        : champ?.status === 'registration_closed' ? 'Inscríbete a un equipo.'
                        : 'Selecciona un cupo para sumarte o crea tu propio equipo.'}
                    </div>

                    {/* Equipos reales: unirse (no inscrito), "Tu equipo" (inscrito), borrar (creador). + slots solo si se puede crear. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                      {regTeams.map(t => {
                        // "Tu equipo"/check solo con membership CONFIRMADA por el backend (no desde el snapshot):
                        // así no aparece un indicador provisional que luego desaparece si el snapshot está stale.
                        const mine = regFresh && myMembership?.team_id === t.id;
                        return (
                          /* Escudo + nombre + check si es mi equipo. Toca → pantalla del equipo (join/leave/editar/borrar allí). */
                          <button key={t.id} onClick={() => openTeamReal(t)} className="pressable" aria-label={t.name} style={{ width: 66, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                            <div style={{ position: 'relative' }}>
                              <Shield color={t.color || '#5B6470'} design={designOf(t.design)} name={t.name} size={60} />
                              {mine && <div style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%', background: GREEN, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
                            </div>
                            <span style={{ maxWidth: 66, fontSize: 11, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                          </button>
                        );
                      })}
                      {(showCreateArea || showCreateAdmin) && Array.from({ length: emptyRealSlots }, (_, i) => (
                        <button key={`cap${i}`} onClick={createLocked ? undefined : createNewTeam} disabled={createLocked} className={createLocked ? undefined : 'pressable'} aria-label="Crear equipo" style={{ width: 66, border: 'none', background: 'transparent', cursor: createLocked ? 'not-allowed' : 'pointer', opacity: createLocked ? 0.5 : 1, padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          <div style={{ position: 'relative', width: 60 }}>
                            <Shield dashed size={60} />
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                              <span style={{ fontSize: 26, lineHeight: 1, color: '#C7C7CC', fontWeight: 300, marginTop: -6 }}>+</span>
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: 'transparent' }}>.</span>
                        </button>
                      ))}
                    </div>

                    {/* Crear un equipo (open enabled / pending disabled) — visible con o sin membership. */}
                    {(showCreateArea || showCreateAdmin) && (() => { const createDisabled = emptyRealSlots === 0 || createLocked; return (
                      <button onClick={createDisabled ? undefined : createNewTeam} disabled={createDisabled} className={createDisabled ? undefined : 'pressable'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, background: createDisabled ? '#E8E8EC' : BLUE, color: createDisabled ? '#9A9AA0' : '#fff', border: 'none', borderRadius: 14, cursor: createDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', marginBottom: 12 }}>
                        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke={createDisabled ? '#9A9AA0' : '#fff'} strokeWidth="2" strokeLinecap="round" /></svg>
                        {emptyRealSlots === 0 && !createLocked ? 'Cupos completos' : 'Crear un equipo'}
                      </button>
                    ); })()}
                    {/* Unirme sin equipo — TOGGLE (solo registration_open). En lista → "Estás en la lista" (check)
                        → tocar de nuevo sale directo (sin confirmación). En un equipo → tocar pide confirmación
                        de cambio (requestNoTeam). Salir del equipo se hace desde la pantalla del equipo. */}
                    {(canCreate || inscriptionsDisabled || pvReal) && !hostBlocksSelf && (() => { const inList = !!myMembership && !myMembership.team_id; const joinDisabled = regBusy || (inscriptionsDisabled && !amOwner) || pvReal;
                      // PÚBLICO: "Unirme sin equipo" es inscripción individual PAGADA → checkout (no el toggle gratis).
                      // Público por EQUIPOS (sin precio individual) → NO hay inscripción individual: ni gratis ni de
                      // pago. Participar es creando/uniéndose a un equipo (por clave/token). Sin este corte, el toggle
                      // gratis quedaba expuesto y join_championship_without_team no lo bloquea en team-only público.
                      if (isPublicChamp) {
                        if (publicUnitPrice <= 0) return null;
                        if (inList) return (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 46, borderRadius: 14, background: '#D7F0DD', color: '#1F6B36', fontFamily: 'inherit', fontSize: 15, fontWeight: 700 }}>
                            <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1F6B36' }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                            Inscrito sin equipo
                          </div>
                        );
                        const joinPaid = () => { if (!user?.id) { navigate('/auth', { state: { backPath: '/championships/view/' + realId } }); return; } const part = myChampPart(); if (part === 'team_owner') { flashToast('No es posible realizar esta acción porque ya estás inscrito en este campeonato.'); return; } if (part === 'free_member') { setConfirmChange({ kind: 'joinpaid' }); return; } navigate('/championships/join', { state: { championshipId: realId, championshipName: name, unitPrice: publicUnitPrice } }); };
                        return (
                          <>
                            <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 8 }}>Inscríbete individualmente, con o sin invitados.</div>
                            <button onClick={joinDisabled ? undefined : joinPaid} disabled={joinDisabled} className={joinDisabled ? undefined : 'pressable'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 46, borderRadius: 14, border: 'none', cursor: joinDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, background: joinDisabled ? '#E8E8EC' : ORANGE, color: joinDisabled ? '#9A9AA0' : '#1B1B1F', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                              {`Unirme sin equipo · ${soles(publicUnitPrice)}`}
                            </button>
                          </>
                        );
                      }
                      return (
                      <>
                        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 8 }}>¿No tienes equipo todavía? Únete a la lista general y luego te acomodamos.</div>
                        <button onClick={joinDisabled ? undefined : (inList ? leaveReal : requestNoTeam)} disabled={joinDisabled} className={joinDisabled ? undefined : 'pressable'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 46, borderRadius: 14, border: 'none', cursor: joinDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, background: inList ? '#D7F0DD' : '#fff', color: inList ? '#1F6B36' : (joinDisabled ? '#9A9AA0' : TEXT), opacity: regBusy ? 0.7 : 1, boxShadow: inList ? 'none' : `inset 0 0 0 1px ${HAIR}`, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                          {inList && <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1F6B36' }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
                          {regBusy ? '…' : (inList ? 'Estás en la lista sin equipo' : 'Unirme sin equipo')}
                        </button>
                      </>
                    ); })()}
                  </div>

                  {/* CARD 2 — ORGANIZADORES + ROSTER real ("Jugadores"). Con datos → filas reales
                      (usuario actual primero). Sin jugadores → contador 0 + mensaje de empty state. */}
                  <div style={CARD}>
                    {/* Organizadores arriba, en el MISMO holder que el roster y separados por una
                        línea. Si el owner o el host además están inscritos, siguen saliendo también
                        abajo: son dos listas que responden a dos preguntas distintas —quién manda y
                        quién juega—, y quitar a alguien de una por estar en la otra las falsearía. */}
                    <RealOrganizers organizers={regOrganizers} onSelect={setSelectedPlayer} divider />
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={H}>Jugadores</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{regPlayerCount} {regPlayerCount === 1 ? 'inscrito' : 'inscritos'}</div>
                    </div>
                    {/* Gestión directa (Fase 23 rework): sin modo Editar global. Cada jugador se gestiona desde su ⋮. */}
                    {amManager && canAdminMove && (
                      <div style={{ fontSize: 12, color: SUB, lineHeight: 1.45, marginBottom: 8 }}>
                        Puedes organizar a los jugadores desde ⋮ junto a cada nombre.
                      </div>
                    )}
                    {sortedRegPlayers.length > 0 ? sortedRegPlayers.map((p, i) => (
                      <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                        {/* Nombre/avatar → PlayerModal (perfil). NO se mezcla con la gestión (⋮). */}
                        <button onClick={() => setSelectedPlayer({ user_id: p.user_id, name: p.full_name })} className="pressable" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                          <div style={{ width: 18, fontSize: 12, color: SUB, flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
                          <RosterAvatar path={p.avatar_path} hue={p.avatar_hue} name={p.full_name || 'Jugador'} />
                          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(p.full_name || 'Jugador') + (p.user_id === user?.id ? ' (tú)' : '')}</div>
                        </button>
                        {p.team_id
                          ? (() => { const t = teamViewById(p.team_id); return (
                              // Escudo con SIGLAS dentro (MISMA fuente/resolución que la Tabla, size 28); sin siglas fuera.
                              <Shield color={t?.color || '#5B6470'} design={t?.design || DEFAULT_DESIGN} name={p.team_name} size={28} />
                            ); })()
                          : <span style={{ fontSize: 12, color: '#C7C7CC', flexShrink: 0 }}>Sin equipo</span>}
                        {/* ⋮ gestión — SOLO managers con acción de roster posible (canAdminMove). Backend valida igual. */}
                        {amManager && canAdminMove && (
                          <button onClick={() => setPlayerAction({ user_id: p.user_id, name: p.full_name, team_id: p.team_id })} className="pressable" aria-label="Gestionar jugador" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, fontSize: 18, fontWeight: 800, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>⋮</button>
                        )}
                      </div>
                    )) : (
                      <div style={{ fontSize: 13, color: SUB, lineHeight: 1.4 }}>Todavía no hay jugadores inscritos.</div>
                    )}
                  </div>
                </>
              )
            ) : isCreated ? (
              /* ── Campeonato "creado" LEGACY por CV (preview post-checkout, mock) — se conserva intacto ── */
              champ?.status === 'registration_closed' ? (
                <>
                  <Resultados view={resultsView} setView={setResultsView} teams={teams} standings={standings} scorers={scorers} matches={realMatches} venueName={summary.venueName || 'AlGrass Arena'} openTeam={openTeam} filter={teams.find(t => t.id === matchFilterId) || null} onFilter={team => setMatchFilterId(team ? team.id : null)} isLiga={isLiga} real={isCreated} organizers={organizers} />
                  {isOwner && <OwnerPhaseTool label="Reabrir inscripciones" note="Herramienta temporal para probar el flujo." onClick={reopenRegistration} />}
                </>
              ) : (
                <>
                  <Inscripciones teams={teams} emptySlots={emptySlots} canCreate={canCreateTeam} onCreate={createNewTeam} onOpenTeam={openExistingTeam} roster={roster} joined={joinedNoTeam} onToggleJoin={toggleNoTeam} count={roster.length} closeLine={closeLine} organizers={organizers} />
                  {isOwner && champ?.status === 'registration_open' && <OwnerPhaseTool label="Cerrar inscripciones" note="Herramienta temporal para probar el flujo." onClick={closeRegistration} />}
                </>
              )
            ) : (
              /* ── Demostración previa: Modo demostración (Inscripciones/Resultados) ── */
              <>
                {/* ── Modo demostración ── */}
                <div style={CARD}>
                  <div style={H}>Modo demostración</div>
                  <div style={{ display: 'flex', gap: 8, margin: '10px 0 8px' }}>
                    <Seg active={demo === 'inscripciones'} onClick={() => setDemo('inscripciones')}>Inscripciones</Seg>
                    <Seg active={demo === 'resultados'} onClick={() => setDemo('resultados')}>Calendario</Seg>
                  </div>
                  <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>
                    {demo === 'inscripciones'
                      ? 'Así se organizan solos tus jugadores: pueden crear su propio equipo o anotarse sin equipo y los acomodas después.'
                      : 'Así se ve la llave del torneo una vez armada, con los equipos inscritos ubicados en el cuadro eliminatorio.'}
                  </div>
                </div>

                {/* ── Contenido según modo ── */}
                {demo === 'inscripciones'
                  ? <Inscripciones teams={teams} emptySlots={emptySlots} canCreate={canCreateTeam} onCreate={createNewTeam} onOpenTeam={openExistingTeam} roster={roster} joined={joinedNoTeam} onToggleJoin={toggleNoTeam} count={roster.length} organizers={null} />
                  : <Resultados view={resultsView} setView={setResultsView} teams={teams} standings={standings} scorers={scorers} matches={matches} venueName={summary.venueName || 'AlGrass Arena'} openTeam={openTeam} filter={teams.find(t => t.id === matchFilterId) || null} onFilter={team => setMatchFilterId(team ? team.id : null)} isLiga={isLiga} real={false} />}
              </>
            )}
          </div>
        </div>

        {/* CTA flotante (sin TabBar; respeta safe-area inferior). Tres estados:
            solicitud enviada (pending) · precio→checkout · contáctame→contacto. */}
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: tabBarVisible ? '12px' : 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
          {/* CTA inferior por estado. Creado: Validando pago (disabled) · Publicar (según clave) ·
              publicado/cerrado → solo "Gestionar mi reserva" (owner). Preview: solicitud enviada · Crear/Contactarme.
              OWNER: "Gestionar mi reserva" (patrón Match) ENCIMA del CTA de estado; publicado → único botón. */}
          {paymentValidating ? (
            <>
              {showManageCTA && manageCTAButton(true)}
              <button disabled style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54, background: '#E4E4EA', color: '#9A9AA2', border: 'none', borderRadius: 18, cursor: 'not-allowed', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2 }}>Validando pago</button>
            </>
          ) : isPendingPublish ? (() => {
            const canPublish = publishEnabled;
            // Ayuda contextual: falta clave guardada vs cambios sin guardar (REAL). Demo: solo clave local.
            const hint = isPublicChamp
              ? null   // público: no hay clave que configurar → sin ayuda de clave
              : isRealMode
              ? (!savedPrivacy.key ? 'Configura una clave de acceso y pulsa Guardar'
                : privacyDirty ? 'Guarda los cambios de privacidad para publicar.' : null)
              : (!accessCode.trim() ? 'Configura una clave de acceso y pulsa Guardar' : null);
            // REAL y demo comparten el mismo CTA "Publicar campeonato". En REAL, publishEnabled exige clave
            // GUARDADA (sin cambios pendientes) → sin clave: botón deshabilitado + hint; con clave: habilitado.
            // Al pulsar, publishChampionship llama publish_championship (owner + pending_publish → registration_open).
            return (
              <>
                {/* El aviso va ENCIMA de los dos botones: entre ellos dejaba un hueco y
                    separaba «Gestionar mi reserva» de «Publicar campeonato». */}
                {hint && <div style={{ pointerEvents: 'none', textAlign: 'center', marginBottom: 8, fontSize: 12, fontWeight: 700, color: TEXT, background: '#FFF7EA', border: `1px solid ${ORANGE}66`, borderRadius: 8, padding: '7px 10px' }}>{hint}</div>}
                {showManageCTA && manageCTAButton(true)}
                <button onClick={publishChampionship} disabled={!canPublish || publishing} className={(canPublish && !publishing) ? 'pressable' : undefined} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 54, background: canPublish ? ORANGE : '#E4E4EA', color: canPublish ? '#1B1B1F' : '#9A9AA2', border: 'none', borderRadius: 18, boxShadow: canPublish ? '0 6px 18px rgba(245,165,36,0.40)' : 'none', cursor: (canPublish && !publishing) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent' }}>
                  {publishing && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
                  {publishing ? 'Publicando…' : 'Publicar campeonato'}
                </button>
              </>
            );
          })() : champ ? (showManageCTA ? manageCTAButton(false) : null) : contactRequest?.status === 'pending' ? (
            <div style={{ pointerEvents: 'auto', background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 16, padding: '12px 14px', boxShadow: '0 6px 18px rgba(0,0,0,0.10)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#EAF8EF', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>Solicitud enviada</div>
                <div style={{ fontSize: 12, color: SUB, lineHeight: 1.4, marginTop: 1 }}>Estamos organizando los detalles pendientes y nos pondremos en contacto contigo.</div>
              </div>
            </div>
          ) : (
            <button onClick={checkoutReady ? goToCheckout : goToContact} className="pressable" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54, background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18, boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent' }}>
              {checkoutReady ? 'Crear campeonato' : 'Contactarme para organizarlo'}
            </button>
          )}
        </div>

        {/* Confirmación: pasar de un equipo a "sin equipo" (mueve la inscripción, no duplica) */}
        {confirmMove && (
          <div className="sheet-overlay" onClick={() => setConfirmMove(null)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
            <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>¿Quieres continuar sin equipo?</div>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>Actualmente estás inscrito en {confirmMove.fromName}. Si continúas, dejarás el equipo y quedarás inscrito sin equipo.</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={() => setConfirmMove(null)} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>
                <button onClick={commitJoinNoTeam} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Continuar sin equipo</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmación REAL (Fase 10): cambiar de equipo o pasar a sin equipo estando ya inscrito. */}
        {confirmChange && (() => {
          const currentTeamName = myMembership?.team_id ? (regTeams.find(t => t.id === myMembership.team_id)?.name || 'tu equipo') : null;
          const isToken = confirmChange.kind === 'token';
          const isToTeam = confirmChange.kind === 'team' || isToken;
          return (
            <div className="sheet-overlay" onClick={() => setConfirmChange(null)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
              <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{isToTeam ? 'Cambiar de equipo' : '¿Continuar sin equipo?'}</div>
                <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>
                  {isToken
                    ? (currentTeamName ? `Ya perteneces a ${currentTeamName}. ¿Quieres cambiarte a este equipo?` : '¿Quieres cambiarte a este equipo?')
                    : currentTeamName
                    ? (isToTeam ? `Ya estás inscrito en ${currentTeamName}. ¿Quieres cambiarte a ${confirmChange.teamName}?` : `Ya estás inscrito en ${currentTeamName}. Si continúas, dejarás el equipo y quedarás inscrito sin equipo.`)
                    : (isToTeam ? `¿Quieres unirte a ${confirmChange.teamName}?` : '¿Quieres continuar sin equipo?')}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                  <button onClick={() => setConfirmChange(null)} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>
                  <button onClick={confirmChangeGo} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{isToTeam ? 'Cambiarme' : 'Continuar sin equipo'}</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Toast breve — copiar clave / compartir fallback / avisos de inscripción única */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '10px 18px', borderRadius: 16, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'normal', maxWidth: '84%', width: 'max-content', lineHeight: 1.35, textAlign: 'center' }}>{toast}</div>
        )}
      </div>

      {/* Campeonato REAL = parte de la navegación principal → BottomNav (mismo TabBar de la app).
          Demo (Crear campeonato) NO es pantalla principal → sin TabBar. */}
      {/* TabBar en publicado/cerrado (browsable). Pre-publicación (validando/pendiente) usa el CTA inferior. */}
      {isCreated && !paymentValidating && !isPendingPublish && <TabBar />}
      {confirmExit && (
        <ConfirmExitDialog onCancel={() => setConfirmExit(false)} onConfirm={() => navigate('/championships')} />
      )}
      {/* Perfil público del jugador — MISMO PlayerModal que el roster de Match (privacidad/avatar iguales). */}
      {selectedPlayer && <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
      {/* "Gestionar mi reserva" (owner) — patrón Match: menú → Ver detalles del pago / Cancelar reserva. */}
      {manageOpen && <OwnerManageSheet onClose={() => setManageOpen(false)} championshipId={realId} status={realRow?.status} onExtrasCanceled={refreshReal} onFullCanceled={(amount) => navigate('/profile', { replace: true, state: { champConfirm: 'canceled', champCanceledAmount: amount } })} />}
      {/* Selector de equipo para un slot VACÍO de la llave (host/AlGrass en in_progress). Excluye el equipo del
          otro lado del mismo partido. Guardar → set_championship_match_team → refresca la llave. */}
      <TeamPickerSheet
        open={!!bracketAssign}
        title="Asignar equipo al partido"
        teams={compTeams}
        excludeTeamId={bracketAssign?.otherTeamId || null}
        selectedId={bracketSel}
        busy={bracketBusy}
        error={bracketErr}
        designOf={designOf}
        conflicts={bracketConflicts}
        onSelect={setBracketSel}
        onCancel={() => { if (!bracketBusy) { setBracketAssign(null); setBracketSel(null); setBracketErr(''); setBracketConflicts({}); } }}
        onSave={saveBracketAssign}
      />
      {/* Selector de CAMPEÓN oficial (Fase 36): host/AlGrass. Equipos del campeonato; Guardar → set_championship_champion. */}
      <TeamPickerSheet
        open={champPickOpen}
        title="Seleccionar campeón"
        teams={compTeams}
        selectedId={champSel}
        busy={champBusy}
        error={champErr}
        designOf={designOf}
        onSelect={setChampSel}
        onCancel={() => { if (!champBusy) { setChampPickOpen(false); setChampSel(null); setChampErr(''); } }}
        onSave={saveChampion}
      />

      {/* Action sheet de GESTIÓN del jugador (⋮) — componente COMPARTIDO con ChampionshipTeam. manage_championship_player. */}
      <PlayerActionSheet
        key={playerAction?.user_id || 'none'}
        player={playerAction} teams={regTeams} designOf={designOf} busy={regBusy}
        onMove={(teamId) => doManagePlayer({ teamId })}
        onNoTeam={() => doManagePlayer({ teamId: null })}
        onRemove={() => doManagePlayer({ remove: true })}
        onClose={() => setPlayerAction(null)}
      />

      {/* Detalle OPERATIVO del partido (Fase 24). Datos desde competition.matches + roster desde regState.players
          (sin RPC de lectura nueva). Editable solo si canManageResults; guarda vía save_championship_match_result. */}
      {(() => {
        const dm = matchDetailId ? (competition?.matches || []).find(x => x.id === matchDetailId) : null;
        if (!dm) return null;
        const homeRoster = regPlayers.filter(p => dm.home_team_id && p.team_id === dm.home_team_id);
        const awayRoster = regPlayers.filter(p => dm.away_team_id && p.team_id === dm.away_team_id);
        // Objetivo 3: el match tiene UNA sede concreta (field_id) → tocar el holder abre la ficha /venue directa
        // (NO el selector), aunque el campeonato tenga varios venues. Se resuelve por field_id dentro de venues[].
        const dmVenueEntry = venueEntryForField(dm.field_id);
        return (
          <MatchDetailModal
            key={dm.id}
            match={dm}
            home={dm.home_team ? teamView(dm.home_team) : null}
            away={dm.away_team ? teamView(dm.away_team) : null}
            homeRoster={homeRoster} awayRoster={awayRoster} existingGoals={dm.goals || []}
            venue={dm.venue_name} court={(dm.field_name || '').replace(/^cancha\s*/i, '') || null}
            dateLabel={dm.date_key ? formatDateLabel(dm.date_key).replace(/^(Hoy|Mañana),\s*/, '') : null}
            timeRange={matchTimeRange(dm.start_time, dm.duration_min)} durationMin={dm.duration_min}
            canEdit={canManageResults} busy={matchSaving} designOf={designOf}
            onOpenVenue={dmVenueEntry ? () => goVenueState(venueStateFromEntry(dmVenueEntry)) : undefined}
            onClose={() => setMatchDetailId(null)} onSave={doSaveMatchResult}
          />
        );
      })()}

      {/* Selector de SEDE (Fase 38, multi-venue): solo cambia el venue mostrado en el bloque de sede/dirección. */}
      <VenuePickerSheet
        open={venuePickerOpen}
        venues={venuesReal}
        selectedIndex={selectedVenueIdx}
        onSelect={(i) => { setSelectedVenueIdx(i); setVenuePickerOpen(false); }}
        onCancel={() => setVenuePickerOpen(false)}
      />
    </div>
  );
}

const pill = { padding: '6px 12px', borderRadius: 999, background: '#EEF2FF', color: BLUE, fontSize: 12.5, fontWeight: 700 };
// Pastilla de acción sobre la portada (Editar portada / Compartir / Guardar / Cancelar).
const coverPill = { padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' };
// Cápsula de amenity — mismos valores que el Chip de GameDetail (altura 28, borde HAIR, #fff, 12/500).
const amenityChip = { flex: '0 0 auto', height: 28, padding: '0 10px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', display: 'inline-flex', alignItems: 'center', color: TEXT, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' };

// ── Fila de organizador ───────────────────────────────────────────────────────
// Es una fila de roster con otra etiqueta: mismo RosterAvatar, mismo gesto y el
// MISMO PlayerModal que abren los jugadores. Un organizador no es una clase
// aparte de persona, así que se mira su perfil igual que el de cualquiera.
function OrganizerRow({ person, role, first, onSelect }) {
  if (!person) return null;
  const name = person.full_name || 'Organizador';
  return (
    <button
      onClick={() => onSelect({ user_id: person.user_id, name: person.full_name })}
      className="pressable"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: first ? 'none' : `1px solid ${HAIR}`, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}
    >
      <RosterAvatar path={person.avatar_path} hue={person.avatar_hue} name={name} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      <span style={{ fontSize: 12, color: SUB, flexShrink: 0 }}>{role}</span>
    </button>
  );
}

// ── "Gestionar mi reserva" (owner) — hoja inferior con el MISMO patrón que Match: un menú de acciones
//    (filas con chevron) que al tocar morfa al sub-paso dentro del mismo contenedor.
//    · "Ver detalles del pago": desglose CONGELADO del checkout, leído de la order real
//      (orders.financial_snapshot vía getChampionshipOrder). No recalcula importes. Visible SIEMPRE (owner).
//    · "Cancelar reserva" (SOLO pending_publish): conceptos reales de get_championship_payment_detail →
//      cancelar el campeonato COMPLETO o extras sueltos vía cancel_championship_contract (scope full/extras).
//      Patrón UX de cancelación de Games (select → processing → done). Full → salir a Perfil; extras → quedarse.
// Fila de "Detalles del pago": etiqueta + valor (mismo lenguaje visual que el resumen del checkout).
function PayRow({ label, value, valueColor, last = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 2px', borderBottom: last ? 'none' : `1px solid ${HAIR}` }}>
      <span style={{ fontSize: 13.5, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: valueColor || TEXT, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

// Fila de concepto que puede estar DEVUELTO: tachada + badge "Devuelto"; su importe no cuenta al vigente.
function PayDetailRow({ label, amount, refunded = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 2px', borderBottom: `1px solid ${HAIR}` }}>
      <span style={{ fontSize: 13.5, color: SUB, textDecoration: refunded ? 'line-through' : 'none' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
        {refunded && <span style={{ fontSize: 11, fontWeight: 700, color: GREEN }}>Devuelto</span>}
        <span style={{ fontSize: 14, fontWeight: 700, color: refunded ? SUB : TEXT, textDecoration: refunded ? 'line-through' : 'none' }}>{soles(amount)}</span>
      </span>
    </div>
  );
}

function OwnerManageSheet({ onClose, championshipId, status, onExtrasCanceled, onFullCanceled }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('menu');   // 'menu' | 'payment' | 'cancel'
  const canCancel = status === 'pending_publish';   // cancelar SOLO antes de publicar (regla del backend)

  // ── Detalles del pago: order REAL (desglose CONGELADO del checkout; no se recalcula nada) ──
  const [order, setOrder] = useState(undefined);    // undefined=cargando · null=error · obj=ok
  useEffect(() => {
    let alive = true;
    getChampionshipOrder({ championshipId }).then(({ data, error }) => { if (alive) setOrder(error ? null : data); });
    return () => { alive = false; };
  }, [championshipId]);
  const fs      = order?.financial_snapshot || {};
  const bruto   = order ? Number(order.amount_total) : null;
  const credito = order ? Number(fs.credit_applied ?? 0) : 0;
  const externo = order ? Number(fs.external_amount ?? (bruto - credito)) : null;
  const extrasFs = Array.isArray(fs.extras) ? fs.extras : [];
  const metodo = (() => {
    if (!order) return '—';
    const p = order.payment_provider;
    if (p === 'credit') return 'Crédito';
    if (p === 'gateway') return 'Pasarela';
    const kind = order.claim_composition?.kind || '';
    if (/transfer/.test(kind)) return 'Transferencia';
    if (/gateway/.test(kind)) return 'Pasarela';
    return '—';
  })();
  const estado = (() => {
    const s = order?.status;
    return s === 'pending' ? 'Pendiente' : s === 'validation' ? 'Validando pago' : s === 'confirmed' ? 'Pagado'
      : s === 'failed' ? 'Rechazado' : s === 'expired' ? 'Expirado' : (s || '—');
  })();

  // ── Cancelación (conceptos reales con lo devuelto de cada uno). Mismo patrón UX que Games:
  //    select → processing → done. "Campeonato completo" o extras sueltos (mutuamente excluyentes). ──
  // FUENTE ÚNICA de reembolsos: get_championship_payment_detail (items con refunded/settled). Alimenta
  // por igual: "Devuelto" en Detalles, deshabilitado en Cancelar y exclusión del Total a cancelar. Solo es
  // válida para el owner en pending_publish (fuera de ahí no hay cancelaciones parciales posibles).
  const [detail, setDetail] = useState(undefined);   // undefined=cargando/no-aplica · null=error · obj=ok
  const [cstep, setCstep]   = useState('select');     // 'select' | 'processing' | 'done'
  const [fullSel, setFullSel] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [cErr, setCErr]       = useState(null);
  const [doneInfo, setDoneInfo] = useState({ amount: 0, full: false });
  useEffect(() => {
    if (!canCancel) return;   // solo pending_publish: fuera de ahí la RPC no aplica (y no hay refunds parciales)
    let alive = true;
    getChampionshipPaymentDetail({ championshipId }).then(({ data, error }) => { if (alive) setDetail(error ? null : data); });
    return () => { alive = false; };
  }, [championshipId, canCancel]);
  const items   = Array.isArray(detail?.items) ? detail.items : [];
  const courts  = items.filter(i => i.kind === 'court' || i.kind === 'courts');
  const feeItem = items.find(i => i.kind === 'fee') || null;
  const extras  = items.filter(i => i.kind === 'extra');
  const isRefunded = (it) => !!it.refunded || !!it.settled_by || it.cancelable === false;
  const refundedExtraCodes = new Set(extras.filter(isRefunded).map(e => e.code));
  const refundedTotal  = Number(detail?.refunded_total ?? 0);
  const remainingTotal = detail ? Number(detail.remaining_total ?? 0) : null;   // vigente (backend; no recalcula)
  const cancelableCodes = extras.filter(e => !isRefunded(e)).map(e => e.code);
  const extraName = (code) => (extrasFs.find(e => e.code === code)?.name) || (code === 'referee' ? 'Árbitro' : code);
  const extraAmt  = (code) => Number(extras.find(e => e.code === code)?.amount ?? 0);
  // "Campeonato completo" = marca TODOS los extras cancelables y cancela también canchas + fee.
  const pickFull = () => { const next = !fullSel; setFullSel(next); setChecked(next ? new Set(cancelableCodes) : new Set()); };
  const toggleExtra = (code) => {
    setFullSel(false);   // cualquier extra individual desmarca "Campeonato completo"
    setChecked(prev => { const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  };
  const canConfirm = fullSel || checked.size > 0;
  // Total a cancelar: full → todo lo vigente (canchas+fee+extras no devueltos = remaining_total del backend);
  // extras → suma de los extras marcados. Nunca incluye lo ya reembolsado.
  const totalToCancel = fullSel ? (remainingTotal ?? 0) : [...checked].reduce((s, c) => s + extraAmt(c), 0);

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  const dismiss = () => { if (cstep === 'processing') return; setOpen(false); setTimeout(onClose, 220); };
  const goMenu = () => { setStep('menu'); setCstep('select'); setCErr(null); };

  async function doCancel() {
    if (cstep === 'processing' || !canConfirm) return;
    const isFull = fullSel;
    setCErr(null); setCstep('processing');
    const { data, error } = await (isFull
      ? cancelChampionshipContract({ championshipId, scope: 'full', reason: 'Cancelado por el organizador' })
      : cancelChampionshipContract({ championshipId, scope: 'extras', codes: [...checked] }));
    if (error) {
      setCstep('select');
      const m = error.message || '';
      setCErr(/NOT_CANCELABLE|BLOCKED_FIXTURE/.test(m) ? 'Este campeonato ya no se puede cancelar.'
        : /ALREADY_REFUNDED/.test(m) ? 'Ese extra ya fue devuelto.'
        : 'No pudimos procesar la cancelación. Inténtalo de nuevo.');
      return;
    }
    const amount = Number(data?.refunded_total) || 0;
    // FULL → navega a Perfil YA; el overlay de éxito se muestra SOBRE Perfil (mismo mecanismo que el checkout
    // de campeonato), sin pasar por el done del sheet → nunca se ve el Championship cancelado de fondo.
    if (isFull) { onFullCanceled?.(amount); return; }
    // EXTRAS → éxito DENTRO del mismo sheet, con botón final (sin auto-cierre); al pulsarlo refresca y se queda.
    setDoneInfo({ amount, full: false });
    setCstep('done');
  }

  const chevron = (c) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 4px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' };
  const showBack = step !== 'menu' && cstep === 'select';
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottom: `1px solid ${HAIR}` }}>
            {showBack && (
              <button onClick={goMenu} aria-label="Atrás" style={{ width: 24, height: 22, marginLeft: -4, display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, outline: 'none' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke={TEXT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
            <span style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>
              {step === 'payment' ? 'Detalles del pago' : step === 'cancel' ? 'Cancelar reserva' : 'Gestionar mi reserva'}
            </span>
          </div>
        </div>
        <div className="no-sb" style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '4px 16px calc(16px + env(safe-area-inset-bottom))' }}>
          {step === 'menu' && (
            <>
              <button onClick={() => setStep('payment')} className="pressable" style={{ ...rowStyle, borderBottom: canCancel ? `1px solid ${HAIR}` : 'none' }}>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: TEXT }}>Ver detalles del pago</span>
                {chevron('#C7C7CC')}
              </button>
              {/* Cancelar reserva: SOLO en pending_publish (pago confirmado y aún sin publicar). */}
              {canCancel && (
                <button onClick={() => setStep('cancel')} className="pressable" style={rowStyle}>
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: RED }}>Cancelar reserva</span>
                  {chevron(RED + '80')}
                </button>
              )}
            </>
          )}

          {/* ── Detalles del pago: MISMO desglose conceptual/visual del checkout (datos congelados) ── */}
          {step === 'payment' && (
            <div style={{ padding: '6px 0 6px' }}>
              {order === undefined ? (
                <div style={{ fontSize: 13, color: SUB, padding: '18px 2px', textAlign: 'center' }}>Cargando detalles…</div>
              ) : order === null ? (
                <div style={{ fontSize: 13, color: SUB, padding: '18px 2px', textAlign: 'center' }}>No pudimos cargar los detalles del pago.</div>
              ) : (
                <>
                  {/* Contrato ORIGINAL (financial_snapshot). Los extras ya devueltos no desaparecen: se tachan
                      y se marcan "Devuelto" (fuente: get_championship_payment_detail), y salen del total vigente. */}
                  {/* Orden: 1) Canchas · 2) Organización AlGrass · 3) árbitro / resto de extras. */}
                  <PayRow label={`Alquiler Canchas${fs.rental_count ? ` · ${fs.rental_count} ${fs.rental_count === 1 ? 'cancha' : 'canchas'}` : ''}${fs.service_court_hours != null ? ` · ${fs.service_court_hours} ${fs.service_court_hours === 1 ? 'hora' : 'horas'}` : ''}`} value={soles(fs.court_amount ?? 0)} />
                  <PayRow label="Organización AlGrass" value={soles(fs.algrass_fee_amount ?? 0)} />
                  {Number(fs.referee_amount) > 0 && (
                    <PayDetailRow label={`Árbitro${fs.service_court_hours != null ? ` × ${fs.service_court_hours} ${fs.service_court_hours === 1 ? 'hora' : 'horas'}` : ''}`} amount={fs.referee_amount} refunded={refundedExtraCodes.has('referee')} />
                  )}
                  {extrasFs.map(x => (
                    <PayDetailRow key={x.code} label={`${x.name || x.code}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`} amount={x.amount} refunded={refundedExtraCodes.has(x.code)} />
                  ))}
                  <PayRow label="Total contratado" value={soles(bruto)} valueColor={TEXT} />
                  {credito > 0 && <PayRow label="Crédito aplicado" value={`− ${soles(credito)}`} valueColor={GREEN} />}
                  <PayRow label="Importe externo" value={soles(externo)} />
                  {refundedTotal > 0 && (
                    <>
                      <PayRow label="Devuelto" value={`− ${soles(refundedTotal)}`} valueColor={GREEN} />
                      <PayRow label="Total vigente" value={soles(remainingTotal ?? (bruto - refundedTotal))} valueColor={TEXT} />
                    </>
                  )}
                  <PayRow label="Método de pago" value={metodo} />
                  <PayRow label="Estado del pago" value={estado} last />
                </>
              )}
            </div>
          )}

          {/* ── Cancelar: Campeonato completo (todo) · Canchas (informativas) · Extras (seleccionables) ── */}
          {step === 'cancel' && cstep === 'select' && (
            <div style={{ padding: '10px 0 6px' }}>
              {detail === undefined ? (
                <div style={{ fontSize: 13, color: SUB, padding: '18px 2px', textAlign: 'center' }}>Cargando…</div>
              ) : detail === null ? (
                <div style={{ fontSize: 13, color: SUB, padding: '18px 2px', textAlign: 'center' }}>No pudimos cargar los conceptos.</div>
              ) : (
                <>
                  {/* Campeonato completo = master: marca TODOS los extras cancelables y cancela también
                      canchas + Organización AlGrass. Al marcar un extra suelto, "Campeonato completo" se desmarca. */}
                  <button onClick={pickFull} className="pressable" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px', borderRadius: 12, border: `1.5px solid ${fullSel ? RED : HAIR}`, background: fullSel ? '#FDF1F1' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.8px solid ${fullSel ? RED : '#C7C7CC'}`, background: fullSel ? RED : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {fullSel && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: TEXT }}>Campeonato completo</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: SUB, marginTop: 1 }}>Cancela canchas, Organización AlGrass y todos los extras. Devolución del 100% en crédito.</span>
                    </span>
                  </button>

                  {/* Canchas — informativas, SIN checkbox (no se cancelan individualmente desde el App) */}
                  {courts.length > 0 && (
                    <>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', margin: '16px 2px 6px' }}>Canchas</div>
                      {courts.map((c, i) => (
                        <div key={c.game_id || `court${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 2px', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                          <span style={{ fontSize: 13.5, color: fullSel ? TEXT : SUB }}>Cancha {courts.length > 1 ? i + 1 : ''}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                            {fullSel && <span style={{ fontSize: 11, fontWeight: 700, color: RED }}>Se cancela</span>}
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>{soles(c.amount)}</span>
                          </span>
                        </div>
                      ))}
                      <div style={{ fontSize: 11.5, color: SUB, marginTop: 4 }}>Las canchas no se cancelan por separado.</div>
                    </>
                  )}

                  {/* Organización AlGrass (fee) — fila separada, informativa, SIN checkbox */}
                  {(feeItem || fs.algrass_fee_amount != null) && (
                    <>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', margin: '16px 2px 6px' }}>Organización</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 2px' }}>
                        <span style={{ fontSize: 13.5, color: fullSel ? TEXT : SUB }}>Organización AlGrass</span>
                        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                          {fullSel && <span style={{ fontSize: 11, fontWeight: 700, color: RED }}>Se cancela</span>}
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>{soles(Number(feeItem?.amount ?? fs.algrass_fee_amount ?? 0))}</span>
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: SUB, marginTop: 4 }}>El fee no se cancela por separado.</div>
                    </>
                  )}

                  {/* Extras — SÍ seleccionables individualmente (los ya devueltos quedan deshabilitados) */}
                  {extras.length > 0 && (
                    <>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', margin: '16px 2px 6px' }}>Extras</div>
                      {extras.map((e, i) => {
                        const refunded = isRefunded(e);
                        const on = checked.has(e.code);
                        return (
                          <button key={e.code || `extra${i}`} onClick={refunded ? undefined : () => toggleExtra(e.code)} disabled={refunded}
                            className={refunded ? undefined : 'pressable'}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}`, background: 'transparent', border: 'none', cursor: refunded ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left', opacity: refunded ? 0.55 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                            <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.6px solid ${on ? RED : '#C7C7CC'}`, background: on ? RED : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {on && <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, textDecoration: refunded ? 'line-through' : 'none' }}>{extraName(e.code)}</span>
                            {refunded && <span style={{ fontSize: 11.5, fontWeight: 700, color: GREEN }}>Devuelto</span>}
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: refunded ? SUB : TEXT, textDecoration: refunded ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>{soles(e.amount)}</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {cErr && <div style={{ fontSize: 12.5, color: RED, marginTop: 12 }}>{cErr}</div>}
                  {/* Total a cancelar — MISMO patrón que la cancelación de Match con invitados (fila sobre el CTA). */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, paddingTop: 12, borderTop: `1px solid ${HAIR}` }}>
                    <span style={{ fontSize: 14, color: SUB }}>Total a cancelar</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, whiteSpace: 'nowrap' }}>{soles(totalToCancel)}</span>
                  </div>
                  <button onClick={doCancel} disabled={!canConfirm} className={canConfirm ? 'pressable' : undefined}
                    style={{ marginTop: 12, width: '100%', height: 50, borderRadius: 14, background: canConfirm ? RED : '#E8E8EC', color: canConfirm ? '#fff' : '#9A9AA0', border: 'none', cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 800, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    {fullSel ? 'Cancelar campeonato completo' : checked.size > 0 ? `Cancelar ${checked.size} extra${checked.size === 1 ? '' : 's'}` : 'Selecciona qué cancelar'}
                  </button>
                </>
              )}
            </div>
          )}
          {step === 'cancel' && cstep === 'processing' && (
            <div style={{ padding: '48px 24px calc(48px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', border: `4px solid ${SOFT}`, borderTop: `4px solid ${BLUE}`, animation: 'spin 0.9s linear infinite' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Procesando...</div>
            </div>
          )}
          {step === 'cancel' && cstep === 'done' && (
            <div style={{ padding: '40px 24px calc(40px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>Extras cancelados</div>
              {doneInfo.amount > 0 ? (
                <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
                  Se generó un crédito de <strong style={{ color: GREEN }}>{soles(doneInfo.amount)}</strong> en tu perfil.
                </div>
              ) : (
                <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>Cancelación procesada.</div>
              )}
              {/* Botón final (igual que Games): sin auto-cierre. Al pulsar → refresca y se queda en ChampionshipView. */}
              <button onClick={() => { onExtrasCanceled?.(); dismiss(); }} className="pressable" style={{ marginTop: 8, width: '100%', height: 50, borderRadius: 14, background: BLUE, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Aceptar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Organizadores REALES (owner + host desde regState.organizers). MISMO patrón/orden/badges/avatares que
//    usa Inscripciones: owner ("Organizador") + host ("AlGrass") con OrganizerRow y el MISMO PlayerModal.
//    Se reutiliza tal cual en Inscripciones (con divisor, arriba del roster) y en Resultados (encima de Goleadores).
function RealOrganizers({ organizers, onSelect, divider = false }) {
  if (!organizers?.owner) return null;
  return (
    <>
      <div style={{ ...H, marginBottom: 8 }}>Organizadores</div>
      <OrganizerRow person={organizers.owner} role="Organizador" first onSelect={onSelect} />
      <OrganizerRow person={organizers.host} role="AlGrass" onSelect={onSelect} />
      {divider && <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />}
    </>
  );
}

function ResumenRow({ icon, value, sub, action }) {
  const ic = (c) => icon === 'cal'
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4.5" width="18" height="16" rx="2" stroke={c} strokeWidth="1.6" /><path d="M3 9h18M8 2.5v4M16 2.5v4" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
    : icon === 'pin'
      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" stroke={c} strokeWidth="1.6" /></svg>
      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.5" stroke={c} strokeWidth="1.6" /></svg>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flexShrink: 0, color: SUB }}>{ic(SUB)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: TEXT }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{sub}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

// ── Herramienta TEMPORAL del owner (cerrar/reabrir inscripciones en el mock) — botón discreto ──
function OwnerPhaseTool({ label, note, onClick }) {
  return (
    <div style={{ marginTop: 4, textAlign: 'center' }}>
      <button onClick={onClick} className="pressable" style={{ height: 40, padding: '0 16px', borderRadius: 12, border: `1px solid ${HAIR}`, background: '#fff', color: SUB, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{label}</button>
      {note && <div style={{ fontSize: 11.5, color: '#B0B0B8', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

// ── Organizadores (§ organizador principal + AlGrass opcional). Info pública (owner + jugadores).
//    Principal = usuario que pagó (solo foto + nombre). AlGrass opcional = "(AlGrass)" junto al nombre.
function OrganizersBlock({ organizers, divider = true }) {
  if (!organizers) return null;
  const row = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 };
  const nm = { fontSize: 14, fontWeight: 600, color: TEXT };
  return (
    <>
      <div style={H}>{organizers.algrass ? 'Organizadores' : 'Organizador'}</div>
      <div style={row}><PlayerAvatar name={organizers.principal.name} size={40} /><div style={nm}>{organizers.principal.name}</div></div>
      {organizers.algrass && (
        <div style={row}><PlayerAvatar name={organizers.algrass.name} size={40} /><div style={nm}>{organizers.algrass.name} <span style={{ fontWeight: 600, color: SUB }}>(AlGrass)</span></div></div>
      )}
      {divider && <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />}
    </>
  );
}

// ── Inscripciones (§8.1) ──────────────────────────────────────────────────────
function Inscripciones({ teams, emptySlots, canCreate, onCreate, onOpenTeam, roster, joined, onToggleJoin, count, closeLine, organizers }) {
  return (
    <>
      <div style={CARD}>
        <div style={H}>Inscripciones</div>
        {closeLine && <div style={{ fontSize: 12.5, color: SUB, fontWeight: 600, marginTop: 6 }}>{closeLine}</div>}
        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 4, marginBottom: 12 }}>Selecciona un equipo para sumarte o crea tu propio equipo e invita a tus amigos.</div>

        {/* Grilla: equipos reales (escudo con iniciales + nombre debajo; click → entrar/ver)
            + slots grises "+" (click → crear equipo). El escudo mantiene su tamaño (60). */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          {teams.map(t => (
            <button key={t.id} onClick={() => onOpenTeam(t)} className="pressable" style={{ width: 64, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Shield color={t.color} design={t.design} name={t.name} size={60} />
              <span style={{ maxWidth: 64, fontSize: 11, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            </button>
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <button key={`slot${i}`} onClick={onCreate} className="pressable" aria-label="Crear equipo" style={{ width: 64, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ position: 'relative', width: 60 }}>
                <Shield dashed size={60} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 26, lineHeight: 1, color: '#C7C7CC', fontWeight: 300, marginTop: -6 }}>+</span>
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'transparent' }}>.</span>
            </button>
          ))}
        </div>

        <button onClick={onCreate} disabled={!canCreate} className={canCreate ? 'pressable' : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, background: canCreate ? BLUE : '#E8E8EC', color: canCreate ? '#fff' : '#9A9AA0', border: 'none', borderRadius: 14, cursor: canCreate ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', marginBottom: 12 }}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke={canCreate ? '#fff' : '#9A9AA0'} strokeWidth="2" strokeLinecap="round" /></svg>
          Crear equipo
        </button>

        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 8 }}>¿No tienes equipo todavía? Únete a la lista general y luego te acomodamos.</div>
        <button onClick={onToggleJoin} className="pressable" style={{ width: '100%', height: 46, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', background: joined ? '#D7F0DD' : '#fff', color: joined ? '#1F6B36' : TEXT, boxShadow: joined ? 'none' : `inset 0 0 0 1px ${HAIR}` }}>
          {joined ? 'Estás en la lista sin equipo' : 'Unirme sin equipo'}
        </button>
      </div>

      {/* Organizador(es) + Jugadores en el MISMO holder, separados por una línea. */}
      <div style={CARD}>
        <OrganizersBlock organizers={organizers} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={H}>Jugadores</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{count} inscritos</div>
        </div>
        {roster.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
            <div style={{ width: 18, fontSize: 12, color: SUB, flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
            <PlayerAvatar name={p.name} size={34} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT }}>{playerLabel(p)}</div>
            {p.team ? (
              <Shield color={p.team.color} design={p.team.design} name={p.team.name} size={28} />
            ) : (
              <span style={{ fontSize: 12, color: '#C7C7CC', flexShrink: 0 }}>Sin equipo</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Resultados (§13) — MOCK visual ────────────────────────────────────────────
// El área swappable reserva `minHeight` = máximo alto MEDIDO entre vistas → cambiar de vista no
// acorta el documento (evita el clamp de scrollTop / salto). Sin scrollTo.
function Resultados({ view, setView, teams, standings, scorers, matches, venueName, openTeam, filter, onFilter, onOpenMatch, isLiga, real = false, organizers = null, comp = null, meId = null, onSelectPlayer = null, realOrganizers = null, onAssignSlot = null, canAssignSlot = false, championTeamId = null, canSetChampion = false, onSetChampion = null, onClearChampion = null }) {
  const innerRef = useRef(null);
  const [minH, setMinH] = useState(0);
  // Re-mide también al filtrar → minH conserva el MÁXIMO; filtrar (más corto) nunca reduce la altura.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    setMinH(prev => (h > prev ? h : prev));
  }, [view, teams, filter, comp]);

  // Todo deriva del nº de equipos actual (reacciona si se crean equipos): grupos + semifinales.
  // Liga: SIEMPRE un único grupo (todos contra todos), sin semifinales — solo Final + 3.º/4.º.
  // comp (Fase 16) = datos REALES ya calculados por el backend → se usan tal cual (sin recálculo/zero/mock).
  const useComp = !!comp;
  const teamCount = useComp ? comp.teamCount : teams.length;
  const cfg = isLiga
    ? { groupSizes: [teamCount], gamesPerTeam: [Math.max(0, teamCount - 1)], hasSemifinals: false, hasFinal: true, hasThirdPlace: true }
    : formatForTeamCount(teamCount);
  // Campeonato REAL sin backend (preview legacy): Tabla en 0 con equipos reales, sin goleadores.
  // (Demo previa mantiene el mock.) Partidos conserva su mock en ambos como referencia visual.
  const zeroRow = (t) => ({ team: t, pj: 0, g: 0, e: 0, p: 0, pts: 0, gf: 0, gc: 0, dg: 0, results: [] });
  const displayStandings = real ? teams.map(zeroRow) : standings;
  const displayScorers = useComp ? comp.scorers : (real ? [] : scorers);
  // Nº de goleador = RANK real por goles (1 = más goles), independiente del pin "tú-primero". Así, si TÚ eres el
  // máximo goleador el 1 es tuyo; si no, sigues arriba pero el 1 recae en el máximo goleador (fila siguiente).
  const scorerRankById = new Map();
  [...displayScorers].sort((a, b) => (b.goals || 0) - (a.goals || 0)).forEach((p, idx) => scorerRankById.set(p.id, idx + 1));
  const groups = useComp ? comp.groups.map(g => g.rows) : chunkByCounts(displayStandings, cfg.groupSizes);
  const groupLabels = useComp ? comp.groups.map(g => g.label) : null;
  const displayMatches = useComp ? comp.matches : matches;
  const bracketTeams = useComp ? comp.teams : teams;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Seg active={view === 'partidos'} onClick={() => setView('partidos')}>Partidos</Seg>
        <Seg active={view === 'tabla'} onClick={() => setView('tabla')}>Tabla</Seg>
        <Seg active={view === 'llave'} onClick={() => setView('llave')}>Llave</Seg>
      </div>
      <div style={{ minHeight: minH }}>
        <div ref={innerRef}>
          {view === 'tabla' && ((useComp ? comp.groups.length === 0 : (real && teamCount === 0))
            ? <div style={CARD}><div style={H}>Tabla de posiciones</div><div style={{ fontSize: 13, color: SUB, marginTop: 8 }}>Aún no hay equipos inscritos.</div></div>
            : <TablaMock groups={groups} cfg={cfg} openTeam={openTeam} isLiga={isLiga} groupLabels={groupLabels} />)}
          {view === 'llave' && <LlaveMock teams={bracketTeams} cfg={cfg} openTeam={openTeam} real={real || useComp} bracket={useComp ? comp.bracket : null} onAssignSlot={onAssignSlot} canAssignSlot={canAssignSlot} championTeamId={championTeamId} canSetChampion={canSetChampion} onSetChampion={onSetChampion} onClearChampion={onClearChampion} />}
          {view === 'partidos' && <PartidosMock matches={displayMatches} venueName={venueName} filter={filter} onFilter={onFilter} onOpenMatch={onOpenMatch} />}

          {/* Goleadores: visible en Tabla/Llave, oculto en Partidos (§13.6). Organizadores + Goleadores comparten
              el MISMO holder separados por una línea, igual que Organizadores + Jugadores en Inscripciones.
              Real (regState.organizers): owner + host con OrganizerRow. Demo/legacy: OrganizersBlock (mock). */}
          {view !== 'partidos' && (
            <div style={CARD}>
              {realOrganizers?.owner
                ? <RealOrganizers organizers={realOrganizers} onSelect={onSelectPlayer} divider />
                : (organizers && <OrganizersBlock organizers={organizers} divider />)}
              <div style={H}>Goleadores</div>
              <div style={{ marginTop: 6 }}>
                {displayScorers.length === 0 ? (
                  <div style={{ fontSize: 13, color: SUB }}>{useComp ? 'Aún no hay jugadores en equipos.' : 'Aún no hay goles registrados.'}</div>
                ) : displayScorers.map((p, i) => {
                  // Lista de jugadores (NO ranking por goles): avatar + nombre/equipo a la izquierda, goles a la derecha.
                  // Real (useComp): fila CLICABLE → PlayerModal (perfil público) y "(tú)" tras el nombre propio.
                  const clickable = useComp && !!onSelectPlayer;
                  const label = (meId && p.id === meId) ? `${p.name || 'Jugador'} (tú)` : playerLabel(p);
                  const inner = (
                    <>
                      {/* Nº = rank real por goles (1 = más goles); "tú" sigue arriba aunque no seas el nº 1. */}
                      <div style={{ width: 18, fontSize: 12, color: SUB, flexShrink: 0, textAlign: 'right' }}>{scorerRankById.get(p.id) ?? (i + 1)}</div>
                      {useComp ? <RosterAvatar path={p.avatar_path} hue={p.avatar_hue} name={p.name} size={34} /> : <PlayerAvatar name={p.name} size={34} />}
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                      {/* Escudo del equipo con SIGLAS dentro (mismo componente/escala que Tabla), a la derecha del
                          nombre y antes de los goles. Sin nombre/siglas por fuera. */}
                      {p.team && <Shield color={p.team.color || '#5B6470'} design={p.team.design} name={p.team.name} size={28} />}
                      <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, minWidth: 16, textAlign: 'right', flexShrink: 0 }}>{p.goals}</div>
                    </>
                  );
                  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` };
                  return clickable ? (
                    <button key={p.id} onClick={() => onSelectPlayer({ user_id: p.id, name: p.name })} className="pressable" style={{ ...rowStyle, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{inner}</button>
                  ) : (
                    <div key={p.id} style={rowStyle}>{inner}</div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const FORM_COLORS = { w: GREEN, l: RED, d: '#C7C7CC' };
const FORM_SYMBOL = { w: '✓', l: '×', d: '–' };
// Últimos 5 (derivado, NO en DB): partidos de GRUPO jugados (ambos scores no null; 0 válido) de ese equipo,
// ordenados cronológicamente (date_key → start_time → match_order), resultado desde la perspectiva del equipo,
// y solo los ÚLTIMOS 5 (antiguo→reciente dentro de esos 5). Semi/final/third NO cuentan.
function teamLast5(matches, teamId) {
  if (!teamId) return [];
  const mine = (matches || []).filter(m =>
    m.stage === 'group'
    && m.home_score != null && m.away_score != null
    && (m.home_team_id === teamId || m.away_team_id === teamId));
  mine.sort((a, b) =>
    (a.date_key || '').localeCompare(b.date_key || '')
    || (a.start_time || '').localeCompare(b.start_time || '')
    || ((a.match_order ?? 0) - (b.match_order ?? 0)));
  const res = mine.map(m => {
    const isHome = m.home_team_id === teamId;
    const gf = isHome ? m.home_score : m.away_score;
    const gc = isHome ? m.away_score : m.home_score;
    return gf > gc ? 'w' : (gf === gc ? 'd' : 'l');
  });
  return res.slice(-5);   // solo los últimos 5, conservando orden antiguo→reciente
}
function FormDots({ results }) {
  const arr = results || [];
  // SIEMPRE 5 posiciones: con resultado → dot de color (✓/–/×); vacío → placeholder neutro y discreto.
  return (
    <div style={{ display: 'flex', gap: 4, padding: '0 8px' }}>
      {Array.from({ length: 5 }, (_, i) => {
        const r = arr[i];
        return r
          ? <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, background: FORM_COLORS[r] || '#C7C7CC', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{FORM_SYMBOL[r] || '–'}</span>
          : <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: `1px solid ${HAIR}`, boxSizing: 'border-box' }} />;
      })}
    </div>
  );
}

// Una tabla por grupo. Layout: Equipo FIJO a la izquierda | estadísticas centrales con scroll
// horizontal (PJ G E P GF GC DG Partidos) | Ptos FIJO a la derecha. Primera vista (128px central) =
// PJ G E P; GF/GC/DG/Partidos se descubren al deslizar. Encabezado compacto del grupo arriba.
function GroupTable({ label, sub, rows, openTeam }) {
  const COLS = [['PJ', 'pj'], ['G', 'g'], ['E', 'e'], ['P', 'p'], ['GF', 'gf'], ['GC', 'gc'], ['DG', 'dg']];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 1, marginBottom: 6 }}>{sub}</div>
      <div style={{ display: 'flex', borderTop: `1px solid ${HAIR}` }}>
        {/* Equipo (fijo izquierda) — solo el equipo es clicable (openTeam), no las estadísticas */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 30, display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: SUB }}>Equipo</div>
          {rows.map(r => (
            <button key={r.team.id} onClick={() => openTeam(r.team)} className="pressable" style={{ height: 40, width: '100%', display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', paddingLeft: 0, paddingTop: 0, paddingBottom: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <Shield color={r.team.color} design={r.team.design} name={r.team.name} size={28} />
              <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.team.name}</span>
            </button>
          ))}
        </div>
        {/* Central (scroll horizontal) — solo esta zona hace overflow-x */}
        <div className="no-sb" style={{ flex: '0 0 128px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: 'max-content' }}>
            <div style={{ display: 'flex', height: 30, alignItems: 'center' }}>
              {COLS.map(([c]) => <div key={c} style={{ width: 32, textAlign: 'center', fontSize: 11, fontWeight: 700, color: SUB }}>{c}</div>)}
              <div style={{ padding: '0 6px', fontSize: 11, fontWeight: 700, color: SUB }}>Partidos</div>
            </div>
            {rows.map(r => (
              <div key={r.team.id} style={{ display: 'flex', height: 40, alignItems: 'center' }}>
                {COLS.map(([c, k]) => <div key={k} style={{ width: 32, textAlign: 'center', fontSize: 13, fontWeight: k === 'dg' ? 700 : 400, color: TEXT }}>{r[k]}</div>)}
                <div style={{ paddingLeft: 6 }}><FormDots results={r.results} /></div>
              </div>
            ))}
          </div>
        </div>
        {/* Ptos (fijo derecha, siempre visible) */}
        <div style={{ flex: '0 0 46px', borderLeft: `1px solid ${HAIR}` }}>
          <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: BLUE }}>Ptos</div>
          {rows.map(r => (
            <div key={r.team.id} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: BLUE }}>{r.pts}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Header y "N partidos por equipo" derivan de cfg (groupSizes + gamesPerTeam) por grupo.
function TablaMock({ groups, cfg, openTeam, isLiga, groupLabels = null }) {
  return (
    <div style={CARD}>
      {groups.map((rows, i) => (
        <GroupTable
          key={i}
          label={groupLabels ? groupLabels[i] : (isLiga ? 'Tabla de posiciones' : `Grupo ${i + 1}`)}
          sub={groupLabels ? `${rows.length} ${rows.length === 1 ? 'equipo' : 'equipos'}` : (isLiga ? `Todos contra todos · ${cfg.groupSizes[i]} equipos` : `${cfg.groupSizes[i]} equipos · ${cfg.gamesPerTeam[i]} partidos por equipo`)}
          rows={rows} openTeam={openTeam} />
      ))}
    </div>
  );
}

// Escudo de slot. Equipo real → clicable (openTeam). Silueta punteada "a definir" → NO clicable.
// pending: en el campeonato REAL, los slots vacíos muestran además el texto gris "Por definir".
function Slot({ team, size = 44, onTeam, pending = false, matchId = null, side = null, onAssign = null, canAssign = false }) {
  const shield = team ? <Shield color={team.color} design={team.design} name={team.name} size={size} /> : <Shield dashed size={size} />;
  if (team && onTeam) {
    // Con equipo: tocar entra al equipo (lleva contexto de llave matchId+side si existe → habilita "Cambiar equipo").
    return <button onClick={() => onTeam(team, matchId && side ? { matchId, side } : null)} className="pressable" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'block' }}>{shield}</button>;
  }
  if (!team && canAssign && matchId && side && onAssign) {
    // Slot VACÍO + actor autorizado: el placeholder gris es clickeable → abre el selector de equipos.
    return (
      <button onClick={() => onAssign({ matchId, side })} className="pressable" aria-label="Asignar equipo" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        {shield}<span style={{ fontSize: 10, fontWeight: 700, color: BLUE, whiteSpace: 'nowrap' }}>Asignar</span>
      </button>
    );
  }
  if (!team && pending) {
    return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>{shield}<span style={{ fontSize: 10, color: '#B0B0B8', whiteSpace: 'nowrap' }}>Por definir</span></div>;
  }
  return shield;
}
const BRK_LABEL = { fontSize: 11, fontWeight: 800, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6, textAlign: 'center' };

// Enfrentamiento horizontal (Final / 3.º-4.º): [escudo] VS [escudo] con su label encima.
function VsPair({ a, b, label, size = 44, onTeam, pending = false, sa = null, sb = null, matchId = null, onAssign = null, canAssign = false }) {
  // Centro: con resultado → marcador HORIZONTAL "X - Y" (0 válido, chequeo explícito de null); sin resultado → VS.
  const hasScore = sa != null && sb != null;
  return (
    <div style={{ textAlign: 'center' }}>
      {label && <div style={BRK_LABEL}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 10 }}>
        <Slot team={a} size={size} onTeam={onTeam} pending={pending} matchId={matchId} side="home" onAssign={onAssign} canAssign={canAssign} />
        <span style={{ fontSize: hasScore ? 13 : 11, fontWeight: 800, color: hasScore ? TEXT : SUB, marginTop: size / 2 - 6, padding: hasScore ? 0 : '6px 0', whiteSpace: 'nowrap' }}>{hasScore ? `${sa} - ${sb}` : 'VS'}</span>
        <Slot team={b} size={size} onTeam={onTeam} pending={pending} matchId={matchId} side="away" onAssign={onAssign} canAssign={canAssign} />
      </div>
    </div>
  );
}

// Semifinal vertical (una por lado): "Semifinal" + [A] VS [B].
function SemiCol({ a, b, size = 40, onTeam, pending = false, sa = null, sb = null, matchId = null, onAssign = null, canAssign = false }) {
  // Centro (entre A arriba y B abajo): con resultado → marcador VERTICAL (home arriba, away abajo; 0 válido,
  // chequeo explícito de null); sin resultado → VS.
  const hasScore = sa != null && sb != null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={BRK_LABEL}>Semifinal</div>
      <Slot team={a} size={size} onTeam={onTeam} pending={pending} matchId={matchId} side="home" onAssign={onAssign} canAssign={canAssign} />
      {/* Centro compacto: con resultado → marcador vertical (home/away); sin resultado → "VS" en una línea
          (estado original, sin relleno vertical). */}
      {hasScore ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '3px 0', lineHeight: 1.15 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{sa}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: SUB }}>-</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{sb}</span>
        </div>
      ) : (
        <span style={{ fontSize: 11, fontWeight: 700, color: SUB, padding: '6px 0' }}>VS</span>
      )}
      <Slot team={b} size={size} onTeam={onTeam} pending={pending} matchId={matchId} side="away" onAssign={onAssign} canAssign={canAssign} />
    </div>
  );
}

// Estructura derivada de cfg. CON semifinales (8/12/16): semifinal izquierda + Final/3.º centrados +
// semifinal derecha (sin partido intermedio). SIN semifinales: solo Final + 3.º/4.º.
function LlaveMock({ teams, cfg, openTeam, real = false, bracket = null, onAssignSlot = null, canAssignSlot = false, championTeamId = null, canSetChampion = false, onSetChampion = null, onClearChampion = null }) {
  // bracket (Fase 16) = cuadro REAL derivado de los partidos de eliminación. Sin bracket: preview legacy
  // (real → todos "Por definir"; demo → teams mock). Con bracket: se pintan los equipos reales por fase.
  const useReal = !!bracket;
  const t = (i) => real ? null : (teams[i] || null);
  const hasSemis = useReal ? bracket.hasSemifinals : cfg.hasSemifinals;
  const hasThird = useReal ? bracket.hasThirdPlace : cfg.hasThirdPlace;
  const finalA = useReal ? bracket.final.a : (cfg.hasSemifinals ? null : t(0));
  const finalB = useReal ? bracket.final.b : (cfg.hasSemifinals ? null : t(1));
  const thirdA = useReal ? bracket.third.a : (cfg.hasSemifinals ? null : t(2));
  const thirdB = useReal ? bracket.third.b : (cfg.hasSemifinals ? null : t(3));
  // Campeón OFICIAL: se resuelve por champion_team_id contra los equipos del campeonato (teams). NO de la final.
  const championTeam = championTeamId ? (teams || []).find(x => x.id === championTeamId) || null : null;

  // Centro: Final + 3.º/4.º. Con semis (y sin bracket real), los finalistas son "a definir" (dashed).
  const center = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <VsPair label="Final" a={finalA} b={finalB} sa={useReal ? bracket.final.sa : null} sb={useReal ? bracket.final.sb : null} matchId={useReal ? bracket.final.mid : null} onAssign={onAssignSlot} canAssign={canAssignSlot} onTeam={openTeam} pending={real || useReal} />
      {hasThird && <VsPair label="3.º y 4.º puesto" a={thirdA} b={thirdB} sa={useReal ? bracket.third.sa : null} sb={useReal ? bracket.third.sb : null} matchId={useReal ? bracket.third.mid : null} onAssign={onAssignSlot} canAssign={canAssignSlot} onTeam={openTeam} pending={real || useReal} />}
    </div>
  );

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={H}>Llave del torneo</div>
        <div style={{ fontSize: 12, color: SUB }}>{teams.length} equipos</div>
      </div>

      {hasSemis ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <SemiCol a={useReal ? bracket.semis[0].a : t(0)} b={useReal ? bracket.semis[0].b : t(1)} sa={useReal ? bracket.semis[0].sa : null} sb={useReal ? bracket.semis[0].sb : null} matchId={useReal ? bracket.semis[0].mid : null} onAssign={onAssignSlot} canAssign={canAssignSlot} onTeam={openTeam} pending={real || useReal} />
          {center}
          <SemiCol a={useReal ? bracket.semis[1].a : t(2)} b={useReal ? bracket.semis[1].b : t(3)} sa={useReal ? bracket.semis[1].sa : null} sb={useReal ? bracket.semis[1].sb : null} matchId={useReal ? bracket.semis[1].mid : null} onAssign={onAssignSlot} canAssign={canAssignSlot} onTeam={openTeam} pending={real || useReal} />
        </div>
      ) : center}

      {/* CAMPEÓN del torneo (Fase 36) — DEBAJO de Final/3.º, pieza separada. Fuente ÚNICA: champion_team_id (NO
          se infiere de la final). Con campeón → equipo + "Campeón" (+ "Cambiar campeón" si autorizado). Sin
          campeón → placeholder "Seleccionar campeón" SOLO para Host/AlGrass; jugador/owner-no-host/anon no lo ven. */}
      {useReal && (championTeam || canSetChampion) && (
        <>
          <div style={{ height: 1, background: HAIR, margin: '16px 0 12px' }} />
          {championTeam ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <Shield color={championTeam.color} design={championTeam.design} name={championTeam.name} size={46} />
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#B8860B', display: 'flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true">🏆</span> Campeón</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{championTeam.name}</div>
              {canSetChampion && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
                  <button onClick={onSetChampion} className="pressable" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: BLUE, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '2px 6px', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cambiar campeón</button>
                  <button onClick={onClearChampion || undefined} className="pressable" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: SUB, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '2px 6px', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Quitar campeón</button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={onSetChampion} className="pressable" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <Shield dashed size={46} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: BLUE }}>Seleccionar campeón</span>
            </button>
          )}
        </>
      )}

      <div style={{ fontSize: 11.5, color: SUB, marginTop: 14, textAlign: 'center' }}>{useReal ? 'Cuadro eliminatorio.' : real ? 'Los clasificados se definirán con los resultados.' : 'Cuadro eliminatorio de ejemplo.'}</div>
    </div>
  );
}

// Fila de equipo dentro de la tarjeta — clicable independientemente (filtra Partidos por ese equipo).
// Participante "Por definir" (fases dependientes de resultados) → gris, sin escudo, no clicable.
function TeamLine({ team, score, onFilter }) {
  if (team?.tbd) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
        <Shield dashed size={22} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: '#B0B0B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Por definir</span>
      </div>
    );
  }
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onFilter(team); }} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 0', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <Shield color={team.color} design={team.design} name={team.name} size={22} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
      {score != null && <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{score}</span>}
    </button>
  );
}

// Un partido = un holder. Sin "VS" (los dos equipos apilados ya comunican el enfrentamiento).
function MatchCard({ m, onFilter, onOpenMatch }) {
  // Interacciones separadas: tocar un EQUIPO (TeamLine) filtra; tocar el BLOQUE de info (derecha) abre el
  // detalle del partido. onOpenMatch solo existe en la superficie real (Fase 24); en mock/demo es undefined.
  const info = (
    <>
      <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.venue}</div>
      <div style={{ fontSize: 12, color: SUB }}>Cancha {m.court}</div>
      <div style={{ fontSize: 12, color: BLUE, whiteSpace: 'nowrap' }}>{m.dateLabel}</div>
      <div style={{ fontSize: 12, color: SUB }}>{m.time}</div>
    </>
  );
  // Marcador por FILA (no centrado). Chequeo EXPLÍCITO de null (0 es resultado real): ambos null → "-" en cada
  // fila; ambos presentes → el número de cada equipo pegado a la derecha. Solo presentación (no toca datos/permisos).
  const hasScore = m.sa != null && m.sb != null;
  return (
    <div data-match-card style={{ display: 'flex', alignItems: 'stretch', gap: 12, background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 14, padding: '10px 12px', marginBottom: 8 }}>
      {/* Columna IZQUIERDA: fila local / fila visitante, nombre a la izquierda y score pegado a la derecha.
          Tocar el equipo filtra. null/null → "-" en cada fila; con resultado → número (0 válido). */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <TeamLine team={m.a} score={hasScore ? m.sa : '-'} onFilter={onFilter} />
        <TeamLine team={m.b} score={hasScore ? m.sb : '-'} onFilter={onFilter} />
      </div>
      {/* Divisor VERTICAL sutil entre columnas (gris/neutro). */}
      <div style={{ width: 1, background: HAIR, flexShrink: 0, alignSelf: 'stretch' }} />
      {/* Columna DERECHA: datos del partido (venue/cancha/fecha/hora), en ese orden vertical. Tocar abre detalle. */}
      {onOpenMatch
        ? <button type="button" onClick={(e) => { e.stopPropagation(); onOpenMatch(m.id); }} aria-label="Detalle del partido" className="pressable" style={{ flexShrink: 0, maxWidth: '44%', minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{info}</button>
        : <div style={{ flexShrink: 0, maxWidth: '44%', minWidth: 0, textAlign: 'left' }}>{info}</div>}
    </div>
  );
}

const SEC_LABEL = { fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 };
// Subtítulo de fecha por grupo de día dentro de "Próximos" (campeonato multi-día).
const DATE_SUB = { fontSize: 13, fontWeight: 700, color: TEXT, letterSpacing: -0.1, margin: '10px 0 6px' };

function PartidosMock({ matches, venueName, filter, onFilter, onOpenMatch }) {
  // Real (Fase 16): cada partido trae su propio venue (m.venue); mock/demo no → cae al venueName general.
  const all = matches.map(m => ({ ...m, venue: m.venue || venueName }));
  const shown = filter ? all.filter(m => m.a.id === filter.id || m.b.id === filter.id) : all;
  const upcoming = shown.filter(m => !m.played);
  const played = shown.filter(m => m.played);

  // Scroll SOLO al CAMBIAR el filtro de equipo: si tras filtrar ningún partido filtrado queda visible en el
  // viewport (los del equipo estaban más arriba), llevar la vista al primer partido filtrado; si aún se ve
  // alguno, no mover nada. Reutiliza el contenedor scrolleable existente (ancestro .no-sb de ChampionshipView).
  // NO corre en montaje/restore/cambio de pestaña (didMountRef), ni al abrir match / live / rerender (dep = filter.id).
  const rootRef = useRef(null);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }   // salta montaje/restore/cambio de tab
    if (!filter || !rootRef.current) return;                            // quitar filtro → no reposicionar
    // Ancestro scrolleable real (el mismo scrollRef de ChampionshipView).
    let sc = rootRef.current.parentElement;
    while (sc) { const oy = getComputedStyle(sc).overflowY; if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement; }
    if (!sc) return;
    requestAnimationFrame(() => {
      const cards = rootRef.current?.querySelectorAll('[data-match-card]');
      if (!cards || !cards.length) return;
      const cRect = sc.getBoundingClientRect();
      // ¿algún partido filtrado sigue intersectando el viewport actual? → no mover.
      const anyVisible = Array.from(cards).some(el => { const r = el.getBoundingClientRect(); return r.bottom > cRect.top && r.top < cRect.bottom; });
      if (anyVisible) return;
      // Ninguno visible → subir hasta el primero (mismo patrón de scroll existente; no top absoluto).
      const first = rootRef.current.querySelector('[data-match-card]');
      if (!first) return;
      const r = first.getBoundingClientRect();
      sc.scrollTo({ top: Math.max(0, sc.scrollTop + (r.top - cRect.top) - 12), behavior: 'smooth' });
    });
  }, [filter?.id]); // eslint-disable-line

  return (
    <div ref={rootRef}>
      {/* Filtro activo por equipo (chip compacto con ×) */}
      {filter && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 6px 0 12px', borderRadius: 999, background: BLUE, color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {filter.name}
            <button onClick={() => onFilter(null)} aria-label="Quitar filtro" style={{ width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontSize: 13, lineHeight: 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>×</button>
          </span>
        </div>
      )}

      <div style={SEC_LABEL}>Próximos</div>
      {upcoming.length ? (() => {
        // Subtítulo de fecha por día: hoy → "Hoy", mañana → "Mañana", resto → "Sáb 18 May 2026". Misma lógica
        // de fecha que el detalle de match (formatDateLabel); hoy/mañana se detectan por su prefijo.
        const daySubtitle = (dk) => { const full = formatDateLabel(dk); if (full.startsWith('Hoy,')) return 'Hoy'; if (full.startsWith('Mañana,')) return 'Mañana'; return full; };
        // Agrupar preservando el orden ya cronológico de la lista (backend: date_key → start_time → match_order).
        const groups = [];
        upcoming.forEach(m => { const k = m.date_key || ''; const last = groups[groups.length - 1]; if (last && last.k === k) last.items.push(m); else groups.push({ k, items: [m] }); });
        return groups.map((g, gi) => (
          <div key={g.k || `g${gi}`}>
            {g.k && <div style={DATE_SUB}>{daySubtitle(g.k)}</div>}
            {g.items.map(m => <MatchCard key={m.id} m={m} onFilter={onFilter} onOpenMatch={onOpenMatch} />)}
          </div>
        ));
      })() : <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8 }}>Sin próximos partidos.</div>}

      <div style={{ ...SEC_LABEL, marginTop: 14 }}>Pasados</div>
      {played.length ? played.map(m => <MatchCard key={m.id} m={m} onFilter={onFilter} onOpenMatch={onOpenMatch} />) : <div style={{ fontSize: 12.5, color: SUB }}>Sin partidos jugados.</div>}
    </div>
  );
}
