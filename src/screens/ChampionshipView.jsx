import { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
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
import { buildTeams, combinedRoster, mockStandings, mockScorers, mockMatches, formatForTeamCount, chunkByCounts, playerLabel, CURRENT_USER_NAME, TEAM_DESIGNS, DEFAULT_DESIGN } from '../data/championshipTeamsMock';
import { CHAMPIONSHIP_BASE_PRICE, CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS, mockPublishDelay, soles } from '../data/championshipCheckoutMock';
import { buildFixture, visualCapacity, realTeamCapacity } from '../data/championshipFixtures';
import { formatDateLabel } from '../utils/format';
import { supabase } from '../lib/supabase';
import RosterAvatar from '../components/championship/RosterAvatar';
import { PlayerModal } from './GameDetail';   // MISMO perfil público que el roster de Match (sin duplicar)
import { validateCoverImage, uploadChampionshipCover, getChampionshipCoverUrl, deleteChampionshipCover } from '../utils/championshipCoverImage';
import { getChampionshipPublic, getChampionshipRegistrationKey, verifyChampionshipAccess, updateChampionshipPrivacy, publishChampionshipRpc, updateChampionshipCover, joinChampionshipWithoutTeam, joinChampionshipTeam, leaveChampionship, deleteChampionshipTeam, getChampionshipRegistrationState } from '../services/championshipService';

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

// Usuario actual (mock). Mismo id que se usa en los rosters ('you'); futuro: currentUser.id de Supabase.
const CURRENT_USER_ID = 'you';

const CARD = { background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 16, padding: 16, marginBottom: 12 };
const H = { fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2 };

function Seg({ active, onClick, children }) {
  return (
    <button onClick={onClick} className="pressable" style={{
      flex: 1, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? BLUE : '#fff', color: active ? '#fff' : TEXT, fontSize: 13.5, fontWeight: 700,
      WebkitTapHighlightColor: 'transparent', outline: 'none', boxShadow: active ? 'none' : `inset 0 0 0 1px ${HAIR}`,
    }}>{children}</button>
  );
}

export default function ChampionshipView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Rol AlGrass GLOBAL (misma fuente que el backend _is_algrass_staff: tabla user_roles), cacheado en
  // localStorage y disponible sin llamar a get_championship_registration_state. Se usa solo para gatear la
  // carga del estado en pending_publish y evitar el 400 esperado de la RPC para usuarios no autorizados.
  const { isAlGrassStaff, isAlGrassAdmin } = useGlobalRoles();
  const amAlgrassRole = isAlGrassStaff || isAlGrassAdmin;
  const nav = location.state || null;
  const { id: routeId } = useParams();
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
  useEffect(() => {
    if (!isRealMode) return;
    let alive = true;
    if (!cachedReal?.realRow) setRealLoading(true);   // con caché de vuelta: refetch en background, sin skeleton
    setRealError(false); setOwnerKey(null);
    // Detalle por SUPERFICIE PÚBLICA (sin registration_key). La clave real solo se pide si soy el owner.
    getChampionshipPublic({ championshipId: realId }).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { setRealError(true); setRealLoading(false); return; }
      setRealRow(data); setRealLoading(false);
      if (user?.id && data.owner_user_id === user.id) {
        getChampionshipRegistrationKey({ championshipId: realId }).then(({ data: k }) => { if (alive) setOwnerKey(k || ''); });
      }
    });
    return () => { alive = false; };
  }, [realId]); // eslint-disable-line

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
  const maxTeams = isLiga ? 999 : (group ? group.max : 8);     // Liga: sin límite (crear equipo permanente)
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
  const [resultsView, setResultsView] = useState(restore?.resultsView ?? 'tabla'); // 'tabla' | 'llave' | 'partidos'
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
  // Contacto del organizador: SOLO el owner. La RPC valida owner (gating real); el hook solo consulta si amOwner.
  const organizerPhone = useChampionshipOrganizerPhone(realId, amOwner);
  // Grant de acceso por clave (Fase 7), separado por actor:
  //   LOGUEADO → persistente por uid: champ_access_<uid>_<id> en localStorage. Dura mientras siga ESA sesión;
  //     se limpia en logout/cambio de uid vía clearUserScopedCache (prefijo champ_access_). Refresh del mismo
  //     uid NO lo borra. Un usuario nuevo nunca hereda el de otro (la key incluye su uid).
  //   ANÓNIMO → NO se persiste: solo verifiedGrant en memoria (vive dentro del flujo actual; al salir/reabrir
  //     se vuelve a pedir la clave). La continuidad anónimo→login se puentea con champ_access_resume (abajo).
  const grantKey = (realId && user?.id) ? ('champ_access_' + user.id + '_' + realId) : null;
  const persistentGrant = () => { try { return !!grantKey && localStorage.getItem(grantKey) === '1'; } catch { return false; } };
  const [verifiedGrant, setVerifiedGrant] = useState(false);
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
  const [selectedPlayer, setSelectedPlayer] = useState(null);   // fila del roster → PlayerModal (perfil público de Match)
  function loadRegState() {
    // Estado de inscripciones visible en registration_open/closed; y en pending_publish para owner/AlGrass
    // (crean/gestionan equipos antes de publicar, sin membership). El backend autoriza (owner/AlGrass); un
    // jugador normal en pending recibe error y regState queda null. Fase 10/11.
    const st = realRow?.status;
    // pending_publish: la RPC solo autoriza owner/AlGrass; llamarla como usuario normal genera un 400
    // esperado. Se gatea con señales ya disponibles en frontend (amOwner + rol AlGrass global).
    const canLoad = st === 'registration_open' || st === 'registration_closed'
      || (st === 'pending_publish' && (amOwner || amAlgrassRole));
    if (!isRealMode || !user?.id || !canLoad) return;
    // NO se resetea regState a null: se mantiene el último estado conocido visible mientras llega el fresco
    // (evita flash/salto del roster). Solo se reemplaza con los datos nuevos cuando responde el backend.
    getChampionshipRegistrationState({ championshipId: realId })
      .then(({ data, error }) => { if (!error && data) { setRegState(data); setRegFresh(true); } });
  }
  // Gate como booleano DERIVADO (mismo criterio que loadRegState): abierto/cerrado → true por status;
  // pending → true solo owner/AlGrass. Depender de ESTE booleano (no de amOwner/amAlgrassRole crudos) evita
  // el doble fetch: al resolverse roles/owner async, el booleano ya está en true y no cambia → no re-dispara;
  // en open/closed ni depende de roles. user?.id sigue en deps → refetch legítimo al cambiar de sesión;
  // realRow?.status también → refetch legítimo ante un cambio REAL de estado.
  const canLoadRegState = isRealMode && !!user?.id && (
    realRow?.status === 'registration_open' || realRow?.status === 'registration_closed'
    || (realRow?.status === 'pending_publish' && (amOwner || amAlgrassRole))
  );
  useEffect(() => { loadRegState(); }, [isRealMode, realId, user?.id, realRow?.status, canLoadRegState]); // eslint-disable-line
  // Gate visible = real + fila cargada + NO owner + NO miembro + sin grant (local ni recién verificado).
  const gateOpen = isRealMode && !!realRow && !amOwner && !amMember && !verifiedGrant && !persistentGrant();
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
      // Logueado → grant persistente asociado a su uid. Anónimo → solo memoria (verifiedGrant), no localStorage.
      if (user?.id && grantKey) { try { localStorage.setItem(grantKey, '1'); } catch {} }
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
  const publishEnabled = isRealMode
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
    if (isRealMode) {
      // REAL: publica en DB (pending_publish → registration_open + published_at). NO escribe status en CV.
      if (!publishEnabled) return;
      setPublishing(true); setPrivacyError('');
      const { data, error } = await publishChampionshipRpc({ championshipId: realId });
      if (error || !data) { setPublishing(false); setPrivacyError('No se pudo publicar. Intenta de nuevo.'); return; }
      navigate('/championships', { state: { publishedChampionship: data.id } }); // DB ya dice registration_open
      return;
    }
    // Demo/preview legacy (cv.championship): mock local aislado.
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

  // ── Compartir (mock): Web Share API si existe, si no copia al portapapeles. Privado → incluye clave. ──
  function shareChampionship() {
    const msg = `${name}\nLas inscripciones están abiertas.\nClave de acceso: ${accessCode}`;
    if (navigator.share) navigator.share({ title: name, text: msg }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(msg).then(flashCopied).catch(() => {});
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
  const visualCap = (isCreated && !isLiga) ? visualCapacity(group ? group.max : maxTeams) : null;
  const canCreateTeam = isLiga ? teams.length < maxTeams
    : isCreated ? teams.length < visualCap
    : teams.length < maxTeams;
  const emptySlots = isLiga ? (canCreateTeam ? 1 : 0)
    : isCreated ? Math.max(0, visualCap - teams.length)
    : Math.max(0, maxTeams - teams.length);
  // Capacidad de cupos para Inscripciones REAL: Torneo → tramos del tope contratado real (group.max de
  // format_config); Liga → un único "+". Hoy todos los cupos están vacíos (no hay equipos reales aún).
  const realSlotCount = isRealMode ? (isLiga ? 1 : realTeamCapacity(group?.max)) : 0;
  // Inscripciones reales (Fase 9): equipos/roster/membership desde regState. Slots libres = capacidad − equipos.
  const regTeams = regState?.teams || [];
  const regPlayers = regState?.players || [];
  const regTeamCount = regState?.team_count ?? regTeams.length;
  const regPlayerCount = regState?.player_count ?? 0;
  const myMembership = regState?.current_user_membership || null;
  // Organizadores reales (Fase 13): owner siempre; host solo si está puesto y es
  // otra persona —eso lo decide la RPC, aquí no se vuelve a comparar—.
  const regOrganizers = regState?.organizers || null;
  const emptyRealSlots = Math.max(0, realSlotCount - regTeamCount);
  const designOf = (id) => TEAM_DESIGNS.find(d => d.id === id) || DEFAULT_DESIGN;

  // ── Header del campeonato REAL. Estados especiales primero; publicado → título por ETAPA:
  //    registration_open = "Inscripciones abiertas"; closed/in_progress/completed = "Calendario y resultados". ──
  const realHeaderTitle =
    champ?.status === 'payment_validation' ? 'Validando pago'
    : champ?.status === 'pending_publish' ? 'Pendiente a publicar'
    : champ?.status === 'registration_open' ? 'Inscripciones abiertas'
    : (champ?.status === 'registration_closed' || champ?.status === 'in_progress' || champ?.status === 'completed') ? 'Calendario y resultados'
    : 'Tu campeonato';   // fallback (p.ej. canceled: solo visible al owner)
  // Inscripciones deshabilitadas mientras el campeonato aún no está publicado (pending_publish).
  const inscriptionsDisabled = isRealMode && champ?.status === 'pending_publish';
  // Permisos por estado (Fase 10): crear/sin-equipo solo en open; unirse a equipo y salir en open/closed.
  const canCreate = isRealMode && champ?.status === 'registration_open';
  const canJoinTeam = isRealMode && (champ?.status === 'registration_open' || champ?.status === 'registration_closed');
  const canLeave = canJoinTeam;
  // Área de crear/sin-equipo: visible+activa en registration_open; visible+deshabilitada en pending_publish.
  const showCreateArea = canCreate || inscriptionsDisabled;
  // PAGADOR y AlGrass pueden crear equipos ya en pending_publish (sin membership). Bloqueado para el resto.
  const amAlgrass = !!regState?.is_algrass;
  const createLocked = inscriptionsDisabled && !(amOwner || amAlgrass);

  // Fecha completa "Mié 16 Sep 2026" (reutiliza formatDateLabel; sin el prefijo "Hoy,/Mañana,").
  const dateFull = organizeState?.dateKey ? formatDateLabel(organizeState.dateKey).replace(/^(Hoy|Mañana),\s*/, '') : (summary.dateLabel || null);
  // Horario "inicio → final": reutiliza slotLabel ("6:00 pm – 8:00 pm") como "6:00 PM a 8:00 PM".
  const timeRange = summary.slotLabel ? summary.slotLabel.replace(/\s*–\s*/, ' a ').replace(/\b([ap])m\b/gi, s => s.toUpperCase()) : null;

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
  const closeLine = (isCreated && champ?.status === 'registration_open')
    ? (champ.registrationClosesAt?.label ? `Cierre de inscripciones: ${champ.registrationClosesAt.label}` : 'Cierre de inscripciones por definir')
    : null;

  // Scroll del contenedor propio: entrada principal (desde Perfil/Campeonatos/Crear) → arriba.
  // Volver desde ChampionshipTeam (cvReturn sin `from`) → restaura la posición guardada al entrar al equipo.
  const scrollRef = useRef(null);
  const isTeamReturn = cvReturn && !nav?.from; // regreso desde ChampionshipTeam (no es navegación principal)
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTop = isTeamReturn ? (restore?.scrollTop || 0) : 0;
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
      writeCV({ ...cv, summary, organizeState, name, coverTheme, demo, resultsView, matchFilterId, joinedNoTeam, teams, scrollTop: scrollRef.current?.scrollTop ?? 0, championship: { ...(cv.championship || {}), realId, teams, realRow, regState } });
      return;
    }
    writeCV({ summary, organizeState, name, coverTheme, accessCode, resultsPublic, demo, resultsView, matchFilterId, joinedNoTeam, teams, scrollTop: scrollRef.current?.scrollTop ?? 0, contactRequest, championship: isCreated ? { ...champ, teams } : champ });
  }
  function goToNewTeam() {
    // REAL: Crear equipo exige login (anon → /auth → vuelve). Autenticado → builder REAL (nombre+diseño)
    // que persiste con save_championship_team (teamId null → CREATE). No inscribe al creador. No usa CV.
    if (isRealMode) {
      if (champ?.status === 'pending_publish' && !amOwner && !amAlgrass) return;   // pre-publicación: crear solo owner/AlGrass
      if (!requireAuth('newTeam')) return;
      // Estar inscrito NO bloquea crear equipos (crear ≠ membership). Solo limita la capacidad global.
      if ((regState?.team_count ?? 0) >= realSlotCount) { flashToast('Los cupos están completos.'); return; }
      persistCV();   // guarda scroll + caché (realRow/regState) para volver ya renderizado
      // champStatus + regSnapshot → tras crear, ChampionshipTeam evalúa canJoin/canDeleteTeam con el estado y
      // owner/is_algrass reales (sin quedar en null), y muestra CTA/Eliminar de forma estable.
      navigate('/championships/team', { state: { teamMode: 'new', realChampionship: true, champId: realId, summary, organizeState, champStatus: champ?.status, regSnapshot: regState } });
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
  function openTeamReal(t) {
    persistCV();   // guarda scroll + caché (realRow/regState) para volver ya renderizado, sin flash del top
    // regSnapshot: estado ya conocido (teams/roster/membership/owner/is_algrass) → ChampionshipTeam pinta la
    // estructura real en el primer render (sin flash) y luego refresca por RPC (backend = fuente de verdad).
    navigate('/championships/team', { state: { realChampionship: true, teamMode: 'existing', champId: realId, teamId: t.id, champStatus: champ?.status, regSnapshot: regState } });
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
    if (c.kind === 'team') joinTeamReal(c.teamId);
    else joinNoTeamReal();
  }
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
    // Puente anónimo→login del GRANT de clave: al volver autenticado a ESTE campeonato, se promueve el acceso
    // a un grant persistente del uid (sin re-pedir la clave). Si el login se canceló, se descarta el puente.
    let g; try { g = sessionStorage.getItem('champ_access_resume'); } catch {}
    if (g) {
      try { sessionStorage.removeItem('champ_access_resume'); } catch {}
      if (user?.id && g === realId) { try { localStorage.setItem('champ_access_' + user.id + '_' + realId, '1'); } catch {} setVerifiedGrant(true); }
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
  if (isRealMode && (realLoading || realError || !champ)) {
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
          {/* Compartir en el header — mismo icono/tamaño/posición que Partidos. Solo owner + publicado. */}
          {isOwner && isCreated && champ?.status === 'registration_open' && (
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
            {/* Acciones (top-right) — SOLO owner. Jugador: portada en lectura, sin acciones. */}
            {isOwner && (
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
          </div>

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
              value={complies ? (dateFull || 'Pendiente por confirmar') : 'Pendiente por confirmar'}
              sub={complies ? (timeRange || null) : null}
              action={amOwner ? <OrganizerContactButton phone={organizerPhone} /> : undefined}
            />
            <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
            {/* BLOQUE 2 — Venue + dirección · Google Maps. Gate = checkoutReady (complies && !courtCustom):
                solo con CANCHA REAL confirmada. Si el usuario eligió "contactarme"/"no encuentro" (courtCustom)
                → NO cancha real → "Pendiente por confirmar" + SIN botón Maps (no inventar dirección). */}
            {(() => {
              // Nombre + dirección CLICKEABLES/subrayados → abren el detalle del venue (reutiliza /venue).
              // El botón Google (action) se mantiene EXACTAMENTE igual. Solo con venue real (checkoutReady).
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
            <ResumenRow icon="grid" value={complies ? (summary.courtNames?.length ? `Canchas: ${summary.courtNames.join(', ')}` : (summary.configLabel || 'Cancha por confirmar')) : 'Cancha por confirmar'} />
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
              Cada equipo juega por lo menos 3 partidos y los finalistas hasta 5. El cronograma se organizará de acuerdo a la cantidad de equipos que se registren.
            </div>
          </div>

          {/* ── ZONA DE CARDS ── (más espacio inferior en pending sin clave: el aviso amarillo + CTA no debe
              cubrir el holder de jugadores) */}
          <div style={{ padding: `10px 16px calc(${isPendingPublish && (isRealMode ? !savedPrivacy.key : !accessCode.trim()) ? 118 : 84}px + env(safe-area-inset-bottom))` }}>
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
              {/* Clave de acceso — MISMO layout siempre; publicado = cerrada (click copia) + "Editar" la abre */}
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>Resultados públicos</div>
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

            {isRealMode ? (
              /* ── Campeonato REAL/materializado — CERO datos competitivos mock. Solo shell real + estados
                     vacíos limpios hasta conectar backend de inscripciones/fixture/resultados. ── */
              (champ?.status === 'in_progress' || champ?.status === 'completed') ? (
                /* in_progress/completed → membership CONGELADA. Calendario/Resultados aún sin backend → vacío. */
                <div style={CARD}>
                  <div style={H}>Calendario y resultados</div>
                  <div style={{ fontSize: 13, color: SUB, lineHeight: 1.5, marginTop: 8 }}>El calendario, la tabla de posiciones y los resultados estarán disponibles cuando el torneo se ponga en marcha.</div>
                </div>
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
                  {/* Indicador "Inscripciones cerradas" (registration_closed): solo unirse a equipo existente / salir. */}
                  {champ?.status === 'registration_closed' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', padding: '10px 14px', background: SOFT, border: `1px solid ${HAIR}`, borderRadius: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: SUB, flexShrink: 0 }} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Inscripciones cerradas</div>
                      <div style={{ fontSize: 12, color: SUB }}>· solo puedes unirte a un equipo existente</div>
                    </div>
                  )}
                  {/* CARD 1 — equipos reales (unirse / tu equipo / borrar propio) + CTAs según estado. */}
                  <div style={CARD}>
                    <div style={H}>Inscripciones</div>
                    <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 4, marginBottom: 12 }}>
                      {myMembership ? 'Estás inscrito. Puedes cambiar de equipo o salir mientras las inscripciones sigan abiertas.'
                        : canJoinTeam ? (regTeams.length ? 'Toca un equipo para unirte.' : 'Aún no hay equipos.') + (canCreate ? ' También puedes crear el tuyo o unirte sin equipo.' : '')
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
                      {showCreateArea && Array.from({ length: emptyRealSlots }, (_, i) => (
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
                    {showCreateArea && (() => { const createDisabled = emptyRealSlots === 0 || createLocked; return (
                      <button onClick={createDisabled ? undefined : createNewTeam} disabled={createDisabled} className={createDisabled ? undefined : 'pressable'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, background: createDisabled ? '#E8E8EC' : BLUE, color: createDisabled ? '#9A9AA0' : '#fff', border: 'none', borderRadius: 14, cursor: createDisabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', marginBottom: 12 }}>
                        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke={createDisabled ? '#9A9AA0' : '#fff'} strokeWidth="2" strokeLinecap="round" /></svg>
                        {emptyRealSlots === 0 && !createLocked ? 'Cupos completos' : 'Crear un equipo'}
                      </button>
                    ); })()}
                    {/* Unirme sin equipo — TOGGLE (solo registration_open). En lista → "Estás en la lista" (check)
                        → tocar de nuevo sale directo (sin confirmación). En un equipo → tocar pide confirmación
                        de cambio (requestNoTeam). Salir del equipo se hace desde la pantalla del equipo. */}
                    {(canCreate || inscriptionsDisabled) && (() => { const inList = !!myMembership && !myMembership.team_id; const joinDisabled = regBusy || (inscriptionsDisabled && !amOwner); return (
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
                    {regOrganizers?.owner && (
                      <>
                        <div style={{ ...H, marginBottom: 8 }}>Organizadores</div>
                        <OrganizerRow person={regOrganizers.owner} role="Organizador" first onSelect={setSelectedPlayer} />
                        <OrganizerRow person={regOrganizers.host} role="Host" onSelect={setSelectedPlayer} />
                        <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
                      </>
                    )}
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={H}>Jugadores</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{regPlayerCount} {regPlayerCount === 1 ? 'inscrito' : 'inscritos'}</div>
                    </div>
                    {regPlayers.length > 0 ? regPlayers.map((p, i) => (
                      <button key={p.user_id} onClick={() => setSelectedPlayer({ user_id: p.user_id, name: p.full_name })} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}`, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                        <div style={{ width: 18, fontSize: 12, color: SUB, flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
                        <RosterAvatar path={p.avatar_path} hue={p.avatar_hue} name={p.full_name || 'Jugador'} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Jugador'}</div>
                        {p.team_id
                          ? (() => { const t = regTeams.find(x => x.id === p.team_id); return (
                              // Escudo pequeño del equipo (mismo Shield/patrón que la grilla; name="" → sin inicial) + nombre.
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, minWidth: 0, maxWidth: '45%' }}>
                                <Shield color={t?.color || '#5B6470'} design={designOf(t?.design)} name="" size={14} />
                                <span style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team_name}</span>
                              </span>
                            ); })()
                          : <span style={{ fontSize: 12, color: '#C7C7CC', flexShrink: 0 }}>Sin equipo</span>}
                      </button>
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
                    <Seg active={demo === 'resultados'} onClick={() => setDemo('resultados')}>Resultados</Seg>
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
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
          {/* CTA inferior por estado. Creado: Validando pago (disabled) · Publicar (según clave) ·
              publicado/cerrado → sin CTA (solo TabBar). Preview: solicitud enviada · Crear/Contactarme. */}
          {paymentValidating ? (
            <button disabled style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54, background: '#E4E4EA', color: '#9A9AA2', border: 'none', borderRadius: 18, cursor: 'not-allowed', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2 }}>Validando pago</button>
          ) : isPendingPublish ? (() => {
            const canPublish = publishEnabled;
            // Ayuda contextual: falta clave guardada vs cambios sin guardar (REAL). Demo: solo clave local.
            const hint = isRealMode
              ? (!savedPrivacy.key ? 'Configura una clave de acceso y pulsa Guardar'
                : privacyDirty ? 'Guarda los cambios de privacidad para publicar.' : null)
              : (!accessCode.trim() ? 'Configura una clave de acceso y pulsa Guardar' : null);
            return (
              <>
                {hint && <div style={{ pointerEvents: 'none', textAlign: 'center', marginBottom: 8, fontSize: 12, fontWeight: 700, color: TEXT, background: '#FFF7EA', border: `1px solid ${ORANGE}66`, borderRadius: 8, padding: '7px 10px' }}>{hint}</div>}
                <button onClick={publishChampionship} disabled={!canPublish || publishing} className={(canPublish && !publishing) ? 'pressable' : undefined} style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 54, background: canPublish ? ORANGE : '#E4E4EA', color: canPublish ? '#1B1B1F' : '#9A9AA2', border: 'none', borderRadius: 18, boxShadow: canPublish ? '0 6px 18px rgba(245,165,36,0.40)' : 'none', cursor: (canPublish && !publishing) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent' }}>
                  {publishing && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
                  {publishing ? 'Publicando…' : 'Publicar campeonato'}
                </button>
              </>
            );
          })() : champ ? null : contactRequest?.status === 'pending' ? (
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
          const isToTeam = confirmChange.kind === 'team';
          return (
            <div className="sheet-overlay" onClick={() => setConfirmChange(null)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
              <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{isToTeam ? 'Cambiar de equipo' : '¿Continuar sin equipo?'}</div>
                <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>
                  {currentTeamName
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
          <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap', maxWidth: '84%', textAlign: 'center' }}>{toast}</div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Shield color={p.team.color} design={p.team.design} size={16} />
                <span style={{ fontSize: 12, color: SUB }}>{p.team.name}</span>
              </div>
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
function Resultados({ view, setView, teams, standings, scorers, matches, venueName, openTeam, filter, onFilter, isLiga, real = false, organizers = null }) {
  const innerRef = useRef(null);
  const [minH, setMinH] = useState(0);
  // Re-mide también al filtrar → minH conserva el MÁXIMO; filtrar (más corto) nunca reduce la altura.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    setMinH(prev => (h > prev ? h : prev));
  }, [view, teams, filter]);

  // Todo deriva del nº de equipos actual (reacciona si se crean equipos): grupos + semifinales.
  // Liga: SIEMPRE un único grupo (todos contra todos), sin semifinales — solo Final + 3.º/4.º.
  const teamCount = teams.length;
  const cfg = isLiga
    ? { groupSizes: [teamCount], gamesPerTeam: [Math.max(0, teamCount - 1)], hasSemifinals: false, hasFinal: true, hasThirdPlace: true }
    : formatForTeamCount(teamCount);
  // Campeonato REAL: SIN datos ficticios → Tabla en 0 con equipos reales, sin goleadores.
  // (Demo previa mantiene el mock.) Partidos conserva su mock en ambos como referencia visual.
  const zeroRow = (t) => ({ team: t, pj: 0, g: 0, e: 0, p: 0, pts: 0, gf: 0, gc: 0, dg: 0, results: [] });
  const displayStandings = real ? teams.map(zeroRow) : standings;
  const displayScorers = real ? [] : scorers;
  const groups = chunkByCounts(displayStandings, cfg.groupSizes);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Seg active={view === 'tabla'} onClick={() => setView('tabla')}>Tabla</Seg>
        <Seg active={view === 'llave'} onClick={() => setView('llave')}>Llave</Seg>
        <Seg active={view === 'partidos'} onClick={() => setView('partidos')}>Partidos</Seg>
      </div>
      <div style={{ minHeight: minH }}>
        <div ref={innerRef}>
          {view === 'tabla' && (real && teamCount === 0
            ? <div style={CARD}><div style={H}>Tabla de posiciones</div><div style={{ fontSize: 13, color: SUB, marginTop: 8 }}>Aún no hay equipos inscritos.</div></div>
            : <TablaMock groups={groups} cfg={cfg} openTeam={openTeam} isLiga={isLiga} />)}
          {view === 'llave' && <LlaveMock teams={teams} cfg={cfg} openTeam={openTeam} real={real} />}
          {view === 'partidos' && <PartidosMock matches={matches} venueName={venueName} filter={filter} onFilter={onFilter} />}

          {/* Organizador — mismo componente que Inscripciones, JUSTO encima de Goleadores (misma vista) */}
          {view !== 'partidos' && organizers && (
            <div style={CARD}><OrganizersBlock organizers={organizers} divider={false} /></div>
          )}

          {/* Goleadores: visible en Tabla/Llave, oculto en Partidos (§13.6) */}
          {view !== 'partidos' && (
            <div style={CARD}>
              <div style={H}>Goleadores</div>
              <div style={{ marginTop: 6 }}>
                {displayScorers.length === 0 ? (
                  <div style={{ fontSize: 13, color: SUB }}>Aún no hay goles registrados.</div>
                ) : displayScorers.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                    <div style={{ width: 16, fontSize: 12, color: SUB, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                    <PlayerAvatar name={p.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT }}>{playerLabel(p)}</div>
                    <Shield color={p.team.color} design={p.team.design} size={14} />
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, minWidth: 16, textAlign: 'right' }}>{p.goals}</div>
                  </div>
                ))}
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
function FormDots({ results }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '0 8px' }}>
      {(results || []).map((r, i) => (
        <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, background: FORM_COLORS[r] || '#C7C7CC', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{FORM_SYMBOL[r] || '–'}</span>
      ))}
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
              <Shield color={r.team.color} design={r.team.design} name={r.team.name} size={20} />
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
function TablaMock({ groups, cfg, openTeam, isLiga }) {
  return (
    <div style={CARD}>
      {groups.map((rows, i) => (
        <GroupTable
          key={i}
          label={isLiga ? 'Tabla de posiciones' : `Grupo ${i + 1}`}
          sub={isLiga ? `Todos contra todos · ${cfg.groupSizes[i]} equipos` : `${cfg.groupSizes[i]} equipos · ${cfg.gamesPerTeam[i]} partidos por equipo`}
          rows={rows} openTeam={openTeam} />
      ))}
    </div>
  );
}

// Escudo de slot. Equipo real → clicable (openTeam). Silueta punteada "a definir" → NO clicable.
// pending: en el campeonato REAL, los slots vacíos muestran además el texto gris "Por definir".
function Slot({ team, size = 44, onTeam, pending = false }) {
  const shield = team ? <Shield color={team.color} design={team.design} name={team.name} size={size} /> : <Shield dashed size={size} />;
  if (team && onTeam) {
    return <button onClick={() => onTeam(team)} className="pressable" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'block' }}>{shield}</button>;
  }
  if (!team && pending) {
    return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>{shield}<span style={{ fontSize: 10, color: '#B0B0B8', whiteSpace: 'nowrap' }}>Por definir</span></div>;
  }
  return shield;
}
const BRK_LABEL = { fontSize: 11, fontWeight: 800, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6, textAlign: 'center' };

// Enfrentamiento horizontal (Final / 3.º-4.º): [escudo] VS [escudo] con su label encima.
function VsPair({ a, b, label, size = 44, onTeam, pending = false }) {
  return (
    <div style={{ textAlign: 'center' }}>
      {label && <div style={BRK_LABEL}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 10 }}>
        <Slot team={a} size={size} onTeam={onTeam} pending={pending} /><span style={{ fontSize: 11, fontWeight: 700, color: SUB, marginTop: size / 2 - 6 }}>VS</span><Slot team={b} size={size} onTeam={onTeam} pending={pending} />
      </div>
    </div>
  );
}

// Semifinal vertical (una por lado): "Semifinal" + [A] VS [B].
function SemiCol({ a, b, size = 40, onTeam, pending = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={BRK_LABEL}>Semifinal</div>
      <Slot team={a} size={size} onTeam={onTeam} pending={pending} />
      <span style={{ fontSize: 11, fontWeight: 700, color: SUB, margin: '3px 0' }}>VS</span>
      <Slot team={b} size={size} onTeam={onTeam} pending={pending} />
    </div>
  );
}

// Estructura derivada de cfg. CON semifinales (8/12/16): semifinal izquierda + Final/3.º centrados +
// semifinal derecha (sin partido intermedio). SIN semifinales: solo Final + 3.º/4.º.
function LlaveMock({ teams, cfg, openTeam, real = false }) {
  // Campeonato REAL: NO se decide quién clasifica → todos los slots vacíos (grises, "Por definir").
  const t = (i) => real ? null : (teams[i] || null);

  // Centro: Final + 3.º/4.º. Con semis, los finalistas son "a definir" (dashed, no clicables).
  const center = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <VsPair label="Final" a={cfg.hasSemifinals ? null : t(0)} b={cfg.hasSemifinals ? null : t(1)} onTeam={openTeam} pending={real} />
      {cfg.hasThirdPlace && <VsPair label="3.º y 4.º puesto" a={cfg.hasSemifinals ? null : t(2)} b={cfg.hasSemifinals ? null : t(3)} onTeam={openTeam} pending={real} />}
    </div>
  );

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={H}>Llave del torneo</div>
        <div style={{ fontSize: 12, color: SUB }}>{teams.length} equipos</div>
      </div>

      {cfg.hasSemifinals ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
          <SemiCol a={t(0)} b={t(1)} onTeam={openTeam} pending={real} />
          {center}
          <SemiCol a={t(2)} b={t(3)} onTeam={openTeam} pending={real} />
        </div>
      ) : center}

      <div style={{ fontSize: 11.5, color: SUB, marginTop: 14, textAlign: 'center' }}>{real ? 'Los clasificados se definirán con los resultados.' : 'Cuadro eliminatorio de ejemplo.'}</div>
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
    <button onClick={() => onFilter(team)} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 0', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <Shield color={team.color} design={team.design} name={team.name} size={22} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
      {score != null && <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{score}</span>}
    </button>
  );
}

// Un partido = un holder. Sin "VS" (los dos equipos apilados ya comunican el enfrentamiento).
function MatchCard({ m, onFilter }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 14, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TeamLine team={m.a} score={m.played ? m.sa : null} onFilter={onFilter} />
        <TeamLine team={m.b} score={m.played ? m.sb : null} onFilter={onFilter} />
      </div>
      <div style={{ flexShrink: 0, maxWidth: '44%', textAlign: 'right', paddingTop: 3 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.venue}</div>
        <div style={{ fontSize: 12, color: SUB }}>Cancha {m.court}</div>
        <div style={{ fontSize: 12, color: BLUE, whiteSpace: 'nowrap' }}>{m.dateLabel}</div>
        <div style={{ fontSize: 12, color: SUB }}>{m.time}</div>
      </div>
    </div>
  );
}

const SEC_LABEL = { fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 };

function PartidosMock({ matches, venueName, filter, onFilter }) {
  const all = matches.map(m => ({ ...m, venue: venueName }));
  const shown = filter ? all.filter(m => m.a.id === filter.id || m.b.id === filter.id) : all;
  const upcoming = shown.filter(m => !m.played);
  const played = shown.filter(m => m.played);
  return (
    <div>
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
      {upcoming.length ? upcoming.map(m => <MatchCard key={m.id} m={m} onFilter={onFilter} />) : <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8 }}>Sin próximos partidos.</div>}

      <div style={{ ...SEC_LABEL, marginTop: 14 }}>Pasados</div>
      {played.length ? played.map(m => <MatchCard key={m.id} m={m} onFilter={onFilter} />) : <div style={{ fontSize: 12.5, color: SUB }}>Sin partidos jugados.</div>}
    </div>
  );
}
