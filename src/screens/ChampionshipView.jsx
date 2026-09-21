import { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, RED } from '../constants';
import Shield from '../components/championship/Shield';
import PlayerAvatar from '../components/championship/PlayerAvatar';
import MapsLinkButton from '../components/MapsLinkButton';
import OrganizerContactButton from '../components/OrganizerContactButton';
import TabBar from '../components/TabBar';
import I from '../icons';
import { buildTeams, combinedRoster, mockStandings, mockScorers, mockMatches, formatForTeamCount, chunkByCounts, playerLabel, CURRENT_USER_NAME } from '../data/championshipTeamsMock';
import { CHAMPIONSHIP_BASE_PRICE, CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS, mockPublishDelay, soles } from '../data/championshipCheckoutMock';
import { buildFixture, visualCapacity } from '../data/championshipFixtures';
import { formatDateLabel } from '../utils/format';

// Temas de PORTADA (independientes de la paleta de equipos). Default rojo; el azul es un tono
// claramente distinto al azul de marca (#3F5FE0) para que portada y header no se confundan.
const COVER_THEMES = ['#E24A4A', '#0EA5E9', '#2E9E5B', '#F5A524', '#8E44AD'];

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
  const nav = location.state || null;
  const persisted = readCV();
  const cvReturn = !!nav?.cvReturn;          // true = volvimos desde ChampionshipTeam
  // Regreso desde /auth (login/registro): esta pantalla se remonta sin location.state, así que
  // restauramos TODO desde persisted igual que cvReturn para volver EXACTAMENTE al estado previo.
  // Se captura una sola vez al montar (la bandera se consume después) para no perder el restore.
  const [authResuming] = useState(() => { try { return !!sessionStorage.getItem(AUTH_RESUME_KEY); } catch { return false; } });
  const restore = (cvReturn || authResuming) ? persisted : null;

  const summary = nav?.summary ?? persisted?.summary ?? {};
  const organizeState = nav?.organizeState ?? persisted?.organizeState ?? null;

  const complies = !!summary.complies;
  const isLiga = summary.mode === 'liga';       // Liga = un solo grupo, todos contra todos
  // Campeonato REAL creado/pagado (se entra desde Perfil) vs demostración previa. Distinción por cv.championship.
  const rawChamp = cvReturn ? (persisted?.championship ?? null) : null;
  const isCreated = !!rawChamp;                 // true = campeonato real del owner (no demo)
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
  const [coverTheme, setCoverTheme] = useState(restore?.coverTheme ?? COVER_THEMES[0]); // default rojo
  const [coverEditMode, setCoverEditMode] = useState(false);      // portada en edición (paleta + nombre editable)
  const [coverSnap, setCoverSnap] = useState(null);               // snapshot para Cancelar (name+coverTheme)
  // Clave de acceso = ÚNICA fuente de la clave. En campeonato real se pre-carga con la generada en checkout.
  const [accessCode, setAccessCode] = useState(restore?.accessCode ?? rawChamp?.registrationKey ?? '');
  const [resultsPublic, setResultsPublic] = useState(restore?.resultsPublic ?? true);
  const [keyEditing, setKeyEditing] = useState(false);            // tras publicar: la clave abre solo al pulsar "Editar"
  const [toast, setToast] = useState('');                         // toast breve ("Copiado" / avisos de inscripción)
  const [demo, setDemo] = useState(restore?.demo ?? 'inscripciones');    // 'inscripciones' | 'resultados'
  const [resultsView, setResultsView] = useState(restore?.resultsView ?? 'tabla'); // 'tabla' | 'llave' | 'partidos'
  const [matchFilterId, setMatchFilterId] = useState(restore?.matchFilterId ?? null); // filtro de Partidos (id o null)
  const [joinedNoTeam, setJoinedNoTeam] = useState(restore?.joinedNoTeam ?? false);
  // Campeonato REAL → equipos reales (empiezan []). Demo → equipos mock (buildTeams).
  const [teams, setTeams] = useState(() => (isCreated ? (rawChamp.teams ?? []) : (restore?.teams ?? buildTeams(initialTeams))));
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
    : (!isCreated || rawChamp?.createdByUserId == null || rawChamp.createdByUserId === CURRENT_USER_ID);
  const [champ, setChamp] = useState(rawChamp);
  function writeChamp(next) { setChamp(next); const cv = readCV() || {}; cv.championship = next; writeCV(cv); }
  // Publicar: loading (bloquea doble click) → publica → navega al LISTADO; confirmación + highlight allí.
  // Estructurado como operación real: loading → [request (mock: espera) ] → success → navegación.
  const [publishing, setPublishing] = useState(false);
  async function publishChampionship() {
    if (publishing) return;                          // evita doble publicación
    if (!champ || champ.status !== 'pending_publish') return;
    if (!accessCode.trim()) return;                  // sin clave no se publica
    const key = accessCode.trim();
    setPublishing(true);
    await mockPublishDelay();                         // mock aislado (retirar al conectar Supabase)
    // MOCK: al publicar el campeonato arranca SIEMPRE con 4 equipos ya creados (para probar el flujo).
    const seededTeams = buildTeams(4);
    writeChamp({ ...champ, registrationKey: key, status: 'registration_open', publishedAt: new Date().toISOString(), teams: seededTeams });
    navigate('/championships', { state: { publishedChampionship: key } }); // key = id estable (mock)
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

  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800); };
  const flashCopied = () => flashToast('Copiado');

  // Regla mock: un jugador (user_id 'you') solo puede tener UNA inscripción — en un equipo O sin equipo.
  // Cambiar de inscripción NO se bloquea: se confirma y se MUEVE (retira la anterior, deja una sola).
  const youTeam = () => teams.find(t => (t.players || []).some(p => p.id === 'you')) || null;
  const [confirmMove, setConfirmMove] = useState(null); // { fromName } | null (pasar a "sin equipo")
  function toggleNoTeam() {
    if (joinedNoTeam) { setJoinedNoTeam(false); return; } // salir de "sin equipo" (sin inscripción)
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
  function saveCover() { const cv = readCV() || {}; cv.name = name; cv.coverTheme = coverTheme; writeCV(cv); setCoverEditMode(false); }

  // ── Privacidad: tras publicar la CLAVE se muestra cerrada (copiable); "Editar" la abre. El resto
  //    (Resultados públicos) no cambia. pending_publish/demo siguen totalmente editables. ──
  const privacyLocked = isCreated && !!champ && champ.status !== 'pending_publish'; // publicado/cerrado
  const keyLocked = privacyLocked && !keyEditing;                                   // clave cerrada = copiar al click
  // Persiste privacidad en cv al vuelo (solo cuando está publicado; demo/pending persisten al navegar).
  function persistPrivacy(nextKey, nextPub) {
    const key = nextKey ?? accessCode, pub = nextPub ?? resultsPublic;
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
    // Campeonato REAL: los equipos viven en championship.teams (no en cv.teams demo).
    writeCV({ summary, organizeState, name, coverTheme, accessCode, resultsPublic, demo, resultsView, matchFilterId, joinedNoTeam, teams, scrollTop: scrollRef.current?.scrollTop ?? 0, contactRequest, championship: isCreated ? { ...champ, teams } : champ });
  }
  function goToNewTeam() { if (!canCreateTeam) return; persistCV(); navigate('/championships/team', { state: { teamMode: 'new', summary, organizeState, maxTeams, champTeams: isCreated } }); }
  function goToExistingTeam(team) { persistCV(); navigate('/championships/team', { state: { teamMode: 'existing', team, summary, organizeState, champTeams: isCreated } }); }
  const createNewTeam = goToNewTeam;         // "+" y "Crear equipo" (Inscripciones) → modo NEW
  const openExistingTeam = goToExistingTeam; // escudo real en Inscripciones → modo EXISTING
  const openTeam = goToExistingTeam;         // equipo en Tabla/Llave → modo EXISTING (Partidos NO usa esto)

  // "Atrás" del campeonato REAL → siempre al listado /championships (es pantalla principal; Atrás no
  // cambia entre fases). Demo (Crear campeonato) → vuelve a Crear campeonato.
  const goBack = () => isCreated
    ? navigate('/championships')
    : navigate('/championships/organize', organizeState ? { state: { organizeState } } : undefined);

  // Checkout habilitado solo con formato+cancha+horario resueltos y SIN personalización de cancha.
  // (El caso pendiente/personalizado tendrá "Contáctame para organizarlo", aún no construido.)
  const checkoutReady = complies && !summary.courtCustom;
  // Gate de auth SOLO en la acción final. Sin sesión: persistimos el estado (persistCV) + la intención,
  // y vamos al mismo /auth (patrón backPath) que el resto de acciones protegidas. Con sesión: intacto.
  function requireAuth(action) {
    if (user) { try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {} return true; }
    persistCV();
    try { sessionStorage.setItem(AUTH_RESUME_KEY, action); } catch {}
    navigate('/auth', { state: { backPath: '/championships/view' } });
    return false;
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
    let pending; try { pending = sessionStorage.getItem(AUTH_RESUME_KEY); } catch {}
    if (!pending) return;
    if (!user) { try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {} return; }
    try { sessionStorage.removeItem(AUTH_RESUME_KEY); } catch {}
    if (pending === 'checkout') goToCheckout();
    else if (pending === 'contact') goToContact();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header (sin TabBar en esta pantalla) */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={goBack} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{isCreated && champ?.status === 'registration_open' ? 'Inscripciones abiertas' : isCreated && champ?.status === 'registration_closed' ? 'Calendario y resultados' : 'Ver mi campeonato'}</div>
          {/* Compartir en el header — mismo icono/tamaño/posición que Partidos. Solo owner + publicado. */}
          {isOwner && isCreated && champ?.status === 'registration_open' && (
            <button className="pressable" onClick={shareChampionship} aria-label="Compartir" style={{ position: 'absolute', right: 0, width: 30, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
              {I.share('#fff')}
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={scrollRef} className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* ── Portada — nombre editable SOLO en coverEditMode; una única entrada ("Editar portada") ── */}
          <div style={{ position: 'relative', height: 180, background: coverTheme, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }} />
            {/* Acciones (top-right) — SOLO owner. Jugador: portada en lectura, sin acciones. */}
            {isOwner && (
              <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 8 }}>
                {coverEditMode ? (
                  <>
                    <button onClick={cancelCover} className="pressable" style={coverPill}>Cancelar</button>
                    <button onClick={saveCover} className="pressable" style={{ ...coverPill, background: ORANGE, color: '#1B1B1F' }}>Guardar</button>
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
                <button onClick={() => { /* mock: carga de imagen real pendiente (sin Storage) */ }} className="pressable" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: TEXT, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke={TEXT} strokeWidth="1.6" /><circle cx="12" cy="13" r="3.2" stroke={TEXT} strokeWidth="1.6" /><path d="M8 6l1.5-2h5L16 6" stroke={TEXT} strokeWidth="1.6" strokeLinejoin="round" /></svg>
                  Foto
                </button>
              </div>
            </div>
          )}

          {/* ── ZONA ABIERTA (mismo patrón que GameDetail: sin card, padding '18px 16px', hairline
                superior, título 16/700). Fecha/Venue/Cancha + amenities. ── */}
          <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
            {/* BLOQUE 1 — Fecha (completa) + horario (inicio → final) · derecha: Comunícate con el organizador (owner) */}
            <ResumenRow
              icon="cal"
              value={complies ? (dateFull || 'Pendiente por confirmar') : 'Pendiente por confirmar'}
              sub={complies ? (timeRange || null) : null}
              action={isOwner ? <OrganizerContactButton phone={organizerContactPhone} /> : undefined}
            />
            <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
            {/* BLOQUE 2 — Venue + dirección · derecha: icono de ubicación de Partidos (Google Maps) */}
            <ResumenRow
              icon="pin"
              value={complies ? (summary.venueName || 'Pendiente por confirmar') : 'Pendiente por confirmar'}
              sub={complies ? `${summary.venueAddress ?? ''}${summary.venueDistrict ? ' · ' + summary.venueDistrict : ''}` : 'Te contactaremos para coordinar la sede y el horario.'}
              action={complies && (summary.venueAddress || summary.venueName) ? <MapsLinkButton address={[summary.venueName, summary.venueAddress, summary.venueDistrict]} down /> : undefined}
            />
            <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
            {/* BLOQUE 3 — SOLO "X canchas · X horas" (sin segunda línea) */}
            <ResumenRow icon="grid" value={complies ? (summary.configLabel || 'Cancha por confirmar') : 'Cancha por confirmar'} />
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

          {/* ── ZONA DE CARDS ── */}
          <div style={{ padding: '10px 16px calc(84px + env(safe-area-inset-bottom))' }}>
            {/* "Validando pago" — transferencia enviada, esperando validación de AlGrass. Publicar bloqueado. */}
            {isOwner && paymentValidating && (
              <div style={{ ...CARD, background: '#FFF7EA', border: `1px solid ${ORANGE}55` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, letterSpacing: -0.1 }}>Validando pago</div>
                </div>
                <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 6 }}>Estamos validando tu transferencia. Podrás publicar el campeonato cuando el pago esté confirmado.</div>
                <OwnerPhaseTool label="Simular aprobación de pago (mock)" note="Herramienta temporal — futuro: lo hará Admin al validar el comprobante." onClick={approvePaymentMock} />
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
                  <button onClick={() => { if (keyEditing) persistPrivacy(); setKeyEditing(v => !v); }} className="pressable" style={{ background: 'none', border: 'none', cursor: 'pointer', color: BLUE, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{keyEditing ? 'Listo' : 'Editar'}</button>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 2, marginBottom: 8 }}>Con esta clave podrán acceder tus jugadores para organizarse.</div>
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
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginTop: 2 }}>Cualquiera con el enlace puede ver la llave y los resultados — ideal para que más gente siga tu torneo. Desactívalo para que solo lo vean los inscritos.</div>
                </div>
                <button onClick={() => { const next = !resultsPublic; setResultsPublic(next); if (privacyLocked) persistPrivacy(undefined, next); }} style={{ width: 44, height: 26, borderRadius: 999, border: 'none', background: resultsPublic ? BLUE : '#E5E5EA', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0, transition: 'background .2s ease', outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ position: 'absolute', top: 2, left: resultsPublic ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left .2s ease' }} />
                </button>
              </div>
              {/* Publicar campeonato — SOLO campeonato real pending_publish, al final del mismo holder */}
              {isCreated && champ?.status === 'pending_publish' && (() => {
                const canPublish = !!accessCode.trim();
                return (
                  <>
                    <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
                    <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 12 }}>Las inscripciones cierran {CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS} días antes del campeonato.</div>
                    <button onClick={publishChampionship} disabled={!canPublish || publishing} className={(canPublish && !publishing) ? 'pressable' : undefined} style={{ width: '100%', height: 50, borderRadius: 14, border: 'none', background: canPublish ? ORANGE : '#E4E4EA', color: canPublish ? '#1B1B1F' : '#9A9AA2', cursor: (canPublish && !publishing) ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      {publishing && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
                      {publishing ? 'Publicando…' : 'Publicar campeonato'}
                    </button>
                    {!canPublish && <div style={{ fontSize: 12, color: SUB, textAlign: 'center', marginTop: 8 }}>Configura una clave de acceso para publicar.</div>}
                  </>
                );
              })()}
            </div>
            )}

            {isCreated ? (
              /* ── Campeonato REAL creado — la vista depende del status ── */
              champ?.status === 'registration_closed' ? (
                /* Inscripciones cerradas → Resultados con los EQUIPOS REALES (mock solo en marcadores/fixture) */
                <>
                  <Resultados view={resultsView} setView={setResultsView} teams={teams} standings={standings} scorers={scorers} matches={realMatches} venueName={summary.venueName || 'AlGrass Arena'} openTeam={openTeam} filter={teams.find(t => t.id === matchFilterId) || null} onFilter={team => setMatchFilterId(team ? team.id : null)} isLiga={isLiga} real={isCreated} organizers={organizers} />
                  {isOwner && <OwnerPhaseTool label="Reabrir inscripciones" note="Herramienta temporal para probar el flujo." onClick={reopenRegistration} />}
                </>
              ) : (
                /* pending_publish / registration_open → Inscripciones (0 equipos/0 jugadores al inicio) */
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
          {champ ? null : contactRequest?.status === 'pending' ? (
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

        {/* Toast breve — copiar clave / compartir fallback / avisos de inscripción única */}
        {toast && (
          <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap', maxWidth: '84%', textAlign: 'center' }}>{toast}</div>
        )}
      </div>

      {/* Campeonato REAL = parte de la navegación principal → BottomNav (mismo TabBar de la app).
          Demo (Crear campeonato) NO es pantalla principal → sin TabBar. */}
      {isCreated && <TabBar />}
    </div>
  );
}

const pill = { padding: '6px 12px', borderRadius: 999, background: '#EEF2FF', color: BLUE, fontSize: 12.5, fontWeight: 700 };
// Pastilla de acción sobre la portada (Editar portada / Compartir / Guardar / Cancelar).
const coverPill = { padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' };
// Cápsula de amenity — mismos valores que el Chip de GameDetail (altura 28, borde HAIR, #fff, 12/500).
const amenityChip = { flex: '0 0 auto', height: 28, padding: '0 10px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', display: 'inline-flex', alignItems: 'center', color: TEXT, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' };

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
          {joined ? 'Estás en la lista' : 'Unirme sin equipo'}
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
