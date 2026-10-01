import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, DANGER } from '../constants';
import Shield, { DesignSwatch } from '../components/championship/Shield';
import PlayerAvatar from '../components/championship/PlayerAvatar';
import RosterAvatar from '../components/championship/RosterAvatar';
import { PlayerModal } from './GameDetail';   // MISMO perfil público que el roster de Inscripciones (sin duplicar)
import { TEAM_DESIGNS, DEFAULT_DESIGN, teamDesign, sameDesign, withinTeamNameWordLimit, playerLabel, CURRENT_USER_NAME } from '../data/championshipTeamsMock';
import { saveChampionshipTeam, getChampionshipRegistrationState, joinChampionshipTeam, leaveChampionship, deleteChampionshipTeam, manageChampionshipPlayer, setChampionshipMatchTeam, getChampionshipCompetition } from '../services/championshipService';
import { searchUsers } from '../services/reservationService';   // MISMA búsqueda pública (users_public) que invitaciones de Match
import PlayerActionSheet from '../components/championship/PlayerActionSheet';
import TeamPickerSheet from '../components/championship/TeamPickerSheet';
import { slotTeamConflicts } from '../utils/championshipFixture';
import { effPhaseOf, rosterWindows } from '../utils/championshipRoster';

const designById = (id) => TEAM_DESIGNS.find(d => d.id === id) || DEFAULT_DESIGN;

// Mismo session-state que ChampionshipView (mismo key). Sin persistencia real.
const CV_KEY = 'championship_view_state';
function readCV() { try { return JSON.parse(sessionStorage.getItem(CV_KEY)); } catch { return null; } }
function writeCV(o) { try { sessionStorage.setItem(CV_KEY, JSON.stringify(o)); } catch {} }

// Pantalla única de Equipo para dos entradas: mode 'new' | 'existing'.
export default function ChampionshipTeam() {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = location.state || {};
  const mode = nav.teamMode === 'existing' ? 'existing' : 'new';
  const team = nav.team || null;
  const summary = nav.summary || {};
  const organizeState = nav.organizeState || null;
  // Campeonato REAL: id para volver a su ruta (/championships/view/:id) y no caer a la vista sin id.
  const champId = nav.champId || null;
  const viewPath = champId ? '/championships/view/' + champId : '/championships/view';
  // Campeonato REAL creando equipo: solo nombre+diseño; persiste por RPC (inscribe al creador). Sin invitar
  // jugadores (no hay backend de invitaciones aún) → se ocultan la lista de jugadores y el CTA "Únete".
  const realNew = !!nav.realChampionship && !!champId && nav.teamMode === 'new';
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // Tope de equipos para crear (NEW): override opcional del nav (Liga usa uno alto, sin límite real).
  // Capacidad: override explícito (demo) → team_capacity REAL del campeonato (App/Admin) → summary.group → 8.
  // No asumir 8 cuando existe capacidad real (Admin no escribe summary.group).
  const maxTeams = nav.maxTeams ?? (Number.isFinite(nav.champTeamCapacity) ? nav.champTeamCapacity : (summary.group ? summary.group.max : 8));

  // Campeonato REAL: los equipos viven en cv.championship.teams (no en cv.teams demo). Encapsulado.
  const champTeams = !!nav.champTeams;
  const getTeams = (cv) => champTeams ? ((cv.championship && cv.championship.teams) || []) : (cv.teams || []);
  const putTeams = (cv, arr) => { if (champTeams) cv.championship = { ...(cv.championship || {}), teams: arr }; else cv.teams = arr; };

  const canJoin = true;
  const CURRENT_USER = 'you'; // usuario mock actual
  // DEMO: toda entrada actual es la demostración del organizador (permite configurar para enseñar la
  // UX). En INSCRIPCIÓN REAL (futuro) DEMO_MODE será false y regirán managerUserId/canManage.
  const DEMO_MODE = true;
  const initConfigured = mode === 'existing' ? !!team?.configured : false;

  // DRAFT local de nombre/diseño (editar en vivo NO persiste; en EDIT solo "Guardar" aplica).
  const [name, setName] = useState(mode === 'existing' ? (team?.name || '') : '');
  const [design, setDesign] = useState(mode === 'existing' ? teamDesign(team) : DEFAULT_DESIGN);
  const [players, setPlayers] = useState(mode === 'existing' ? [...(team?.players || [])] : []);
  const [origName, setOrigName] = useState(team?.name || '');
  const [origDesign, setOrigDesign] = useState(mode === 'existing' ? teamDesign(team) : DEFAULT_DESIGN);
  const [savedOnce, setSavedOnce] = useState(initConfigured); // equipo mock ya configurado/guardado
  // NEW y equipo mock NO configurado → arrancan en EDIT (configuración). Configurado → VIEW.
  const [editing, setEditing] = useState(mode === 'new' || (mode === 'existing' && !initConfigured));
  const [confirmJoin, setConfirmJoin] = useState(null);       // { kind:'switchTeam'|'fromNoTeam', fromName? } | null

  // ── REAL: pantalla de detalle de un equipo materializado (Fase 10/11). Reutiliza este mismo componente
  //    (Shield/DesignSwatch/roster/CTA/confirm) con datos y RPCs reales, sin crear pantalla paralela. ──
  const { user } = useAuth();
  const teamId = nav.teamId || null;
  const realExisting = !!nav.realChampionship && !!champId && !!teamId && mode === 'existing';
  const champStatus = nav.champStatus || null;
  // Validando pago: crear equipo NO está permitido (ni por navegación directa/back). Se vuelve al detalle.
  useEffect(() => {
    if (realNew && champStatus === 'payment_validation') navigate(viewPath, { replace: true });
  }, [realNew, champStatus]); // eslint-disable-line
  const champLive = nav.champLive ?? null;   // live_started_at del campeonato (Fase 21) para la fase efectiva
  // Snapshot ya conocido desde ChampionshipView (teams/roster/membership/owner/is_algrass): estado INICIAL de
  // rState para pintar la estructura real en el primer render (sin flash). loadRState lo refresca en background.
  const regSnapshot = nav.regSnapshot || null;
  // Contexto de LLAVE (Fase 31): si se entró desde un slot concreto → { matchId, side, otherTeamId }. Habilita
  // "Cambiar equipo" SOLO en ese caso (no en entradas normales desde Inscripciones). null → sin opción de cambio.
  const fromBracket = nav.fromBracket || null;
  const snapTeam = (regSnapshot?.teams || []).find(x => x.id === teamId) || null;
  const [rState, setRState] = useState(regSnapshot);
  const [rEditing, setREditing] = useState(false);
  const [rEditSource, setREditSource] = useState(null);       // 'auto' (entrada a team vacío) | 'manual' (botón Editar)
  const autoEditDone = useRef(false);                          // el auto-open ocurre 1 vez por MOUNT (no tras Guardar)
  const rDirty = useRef(false);                                // el usuario editó nombre/diseño localmente (no pisar con refetch)
  const [rName, setRName] = useState(snapTeam?.name || '');
  const [rDesign, setRDesign] = useState(designById(snapTeam?.design));
  const [rBusy, setRBusy] = useState(false);
  const [rConfirm, setRConfirm] = useState(null);             // { fromName } | null (cambio desde otra membership)
  const [rDelConfirm, setRDelConfirm] = useState(false);      // modal de confirmación de "Eliminar equipo"
  const [rSelectedPlayer, setRSelectedPlayer] = useState(null);  // fila del roster → PlayerModal (perfil público)
  const [rPlayerAction, setRPlayerAction] = useState(null);      // fila del roster → ⋮ gestión (action sheet compartido)
  const [rCopied, setRCopied] = useState(false);                 // "Enlace copiado" (fallback de Compartir)
  const [rErr, setRErr] = useState('');
  // Agregar jugador NUEVO (Fase 29): búsqueda de usuarios existentes de AlGrass → seleccionar → Guardar.
  const [rAddOpen, setRAddOpen] = useState(false);
  const [rAddQuery, setRAddQuery] = useState('');
  const [rAddResults, setRAddResults] = useState([]);
  const [rAddSearching, setRAddSearching] = useState(false);
  const [rAddSelected, setRAddSelected] = useState(null);        // { id, name, code, ... } | null
  const [rAddBusy, setRAddBusy] = useState(false);
  const [rAddErr, setRAddErr] = useState('');
  // "Cambiar equipo" del slot de la llave (Fase 31): selector reutilizado (TeamPickerSheet).
  const [rChangeOpen, setRChangeOpen] = useState(false);
  const [rChangeSel, setRChangeSel] = useState(null);
  const [rChangeBusy, setRChangeBusy] = useState(false);
  const [rChangeErr, setRChangeErr] = useState('');
  // Goles por jugador (Fase 32): derivados de competition.scorers (in_progress/completed). No columna/tabla nueva.
  const [rGoalsBy, setRGoalsBy] = useState({});
  const [rMatches, setRMatches] = useState([]);   // matches de la competición (para conflictos de horario + updated_at)
  const showGoals = champStatus === 'in_progress' || champStatus === 'completed';
  function loadRState() {
    if (!realExisting) return;
    getChampionshipRegistrationState({ championshipId: champId }).then(({ data, error }) => {
      if (error || !data) return;
      setRState(data);
      const t = (data.teams || []).find(x => x.id === teamId);
      // Sincroniza nombre/diseño con el dato fresco SALVO que el usuario esté en edición manual o tenga
      // cambios locales pendientes (rDirty): así un snapshot viejo se corrige, sin pisar lo que se está editando.
      if (t) { const keep = rEditSource === 'manual' || rDirty.current; setRName(prev => (keep ? prev : (t.name || ''))); setRDesign(prev => (keep ? prev : designById(t.design))); }
    });
  }
  useEffect(() => { if (realExisting) loadRState(); }, [realExisting, champId, teamId]); // eslint-disable-line
  // Goles totales por jugador desde competition.scorers (mismo dato que Goleadores). Solo in_progress/completed;
  // fases anteriores no muestran goles. Mapa por user_id; ausente → 0. Sin fetch por jugador.
  useEffect(() => {
    if (!realExisting || !showGoals) return;
    let alive = true;
    getChampionshipCompetition({ championshipId: champId }).then(({ data, error }) => {
      if (!alive || error || !data) return;
      const map = {};
      (data.scorers || []).forEach(s => { if (s.player_user_id) map[s.player_user_id] = s.goals || 0; });
      setRGoalsBy(map);
      setRMatches(data.matches || []);   // para conflictos de horario + updated_at de "Cambiar equipo"
    });
    return () => { alive = false; };
  }, [realExisting, champId, showGoals]);
  // Bug fix: los permisos de editar/borrar dependen del roster ACTUAL (player_count del state real). Si el
  // roster cambia fuera de esta pantalla (otro jugador sale y el team vuelve a 0), refetch al reenfocar para
  // que Eliminar reaparezca. Sin flags históricos: siempre se recalcula desde el estado real actualizado.
  useEffect(() => {
    if (!realExisting) return;
    const refetch = () => { if (!document.hidden) loadRState(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => { window.removeEventListener('focus', refetch); document.removeEventListener('visibilitychange', refetch); };
  }, [realExisting, champId, teamId]); // eslint-disable-line
  // Búsqueda de usuarios para "Agregar jugador" (debounce 300ms). Reutiliza searchUsers (users_public: solo campos
  // públicos). Excluye a los YA inscritos en ESTE campeonato (cualquier equipo) para no ofrecer duplicados.
  useEffect(() => {
    if (!rAddOpen) return;
    const q = rAddQuery.trim();
    const excludeIds = (rState?.players || []).map(p => p.user_id).filter(Boolean);
    let alive = true;
    const t = setTimeout(() => {
      if (!q) { setRAddResults([]); setRAddSearching(false); return; }
      setRAddSearching(true);
      searchUsers(q, { limit: 20, excludeIds }).then(rows => { if (alive) { setRAddResults(rows || []); setRAddSearching(false); } });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [rAddOpen, rAddQuery, rState]);
  // Equipo VACÍO + autorizado → modo edición DIRECTO (sin pulsar "Editar"), UNA sola vez por MOUNT: el guard
  // por ref evita reabrir edición tras pulsar Guardar (rState cambia por el refetch). Al salir y volver, el
  // componente se remonta → autoEditDone vuelve a false → auto-open otra vez si sigue vacío. Con jugadores → lectura.
  useLayoutEffect(() => {
    if (!realExisting || !rState || autoEditDone.current) return;
    const t = (rState.teams || []).find(x => x.id === teamId);
    if ((t?.player_count ?? 0) !== 0) return;
    const isAdmin = rState.owner_user_id === user?.id || !!rState.is_algrass;
    const priv = !!t.creator_is_privileged;
    // Vacío NORMAL: en open lo edita CUALQUIERA. Vacío PRIVILEGIADO: solo owner/AlGrass. Pending: solo owner/AlGrass.
    if (priv && !isAdmin) return;
    if (champStatus === 'registration_open' || (champStatus === 'pending_publish' && isAdmin)) {
      autoEditDone.current = true;         // marca el auto-open de ESTE mount → no se repite tras Guardar
      setREditSource('auto'); setREditing(true);
    }
  }, [realExisting, rState, teamId, user?.id, champStatus]); // eslint-disable-line
  // Snapshot stale (pc=0 → backend pc=1): si la auto-edición se abrió por un snapshot VACÍO y el dato fresco
  // muestra jugadores, se cierra (el team ya no es editable así). NO cierra una edición MANUAL del usuario.
  useEffect(() => {
    if (!realExisting || !rState || rEditSource !== 'auto') return;
    const t = (rState.teams || []).find(x => x.id === teamId);
    if ((t?.player_count ?? 0) >= 1) { setREditing(false); setREditSource(null); rDirty.current = false; }
  }, [realExisting, rState, teamId, rEditSource]); // eslint-disable-line

  // ── PERMISOS REALES (se CONSERVAN para la inscripción real; NO usa createdByMe) ──
  // Responsable = jugador MÁS ANTIGUO presente (con "Únete" prepend, queda al FINAL). Vacío → null.
  const managerUserId = players.length ? players[players.length - 1].id : null;
  const canManage = players.length === 0 || managerUserId === CURRENT_USER;
  // En DEMO permitimos gestionar para enseñar la UX; en real regirá canManage.
  const allowManage = DEMO_MODE || canManage;

  const firstConfig = mode === 'existing' && !savedOnce; // primera configuración de un equipo mock
  const canEdit = mode === 'new' || (editing && allowManage);
  const joined = players.some(p => p.id === CURRENT_USER);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0;                        // no crear/guardar sin nombre válido
  const dirty = trimmed !== origName || !sameDesign(design, origDesign);  // cambios respecto a lo guardado
  // Guardar: NEW siempre; primera config mock siempre; EDIT posterior solo si hubo cambios.
  const showSave = mode === 'new' || (editing && (firstConfig || dirty));
  // Cancelar: solo en EXISTING que entró a EDIT por el lápiz (no en primera config ni en NEW).
  const showCancel = mode === 'existing' && editing && !firstConfig;
  const canDelete = mode === 'existing' && !editing && allowManage;

  const onNameChange = (e) => { const v = e.target.value; if (withinTeamNameWordLimit(v)) setName(v); };

  const thisTeamName = () => (name.trim() || team?.name || 'este equipo');

  // Persiste en cv los players de ESTE equipo (solo EXISTING). Reutilizado por unir/salir.
  const persistThisTeam = (next) => {
    if (mode !== 'existing') return;
    const cv = readCV() || {}; const arr = getTeams(cv);
    const idx = arr.findIndex(t => t.id === team?.id);
    if (idx >= 0) { arr[idx] = { ...arr[idx], players: next }; putTeams(cv, arr); writeCV(cv); }
  };

  // Une a ESTE equipo retirando cualquier OTRA inscripción (otro equipo o "sin equipo") → una sola.
  const commitJoinTeam = () => {
    const next = [{ id: 'you', name: CURRENT_USER_NAME }, ...players.filter(p => p.id !== CURRENT_USER)];
    setPlayers(next);
    if (champTeams) {
      const cv = readCV() || {};
      let arr = getTeams(cv).map(t => (t.id === team?.id ? t : { ...t, players: (t.players || []).filter(p => p.id !== CURRENT_USER) }));
      cv.joinedNoTeam = false; // retira "sin equipo"
      if (mode === 'existing') { const idx = arr.findIndex(t => t.id === team?.id); if (idx >= 0) arr[idx] = { ...arr[idx], players: next }; }
      putTeams(cv, arr); writeCV(cv);
    } else {
      persistThisTeam(next);
    }
    setConfirmJoin(null);
  };

  // Únete/Salir. Cambiar de inscripción NO se bloquea: se confirma y se MUEVE (una sola inscripción).
  const toggleJoin = () => {
    if (joined) { // salir de ESTE equipo → sin inscripción
      const next = players.filter(p => p.id !== CURRENT_USER);
      setPlayers(next); persistThisTeam(next);
      return;
    }
    if (champTeams) { // unirse a ESTE equipo teniendo posiblemente otra inscripción
      const cv = readCV() || {};
      const otherTeam = getTeams(cv).find(t => t.id !== team?.id && (t.players || []).some(p => p.id === CURRENT_USER));
      if (otherTeam) { setConfirmJoin({ kind: 'switchTeam', fromName: otherTeam.name }); return; }
      if (cv.joinedNoTeam) { setConfirmJoin({ kind: 'fromNoTeam' }); return; }
    }
    commitJoinTeam();
  };

  const back = () => navigate(viewPath, { state: { summary, organizeState, cvReturn: true } });

  const save = async () => {
    if (!canSave) return;
    // REAL: crear equipo en DB (RPC) e inscribir al creador. NO escribe CV. Vuelve al campeonato → refetch.
    if (realNew) {
      if (creating) return;
      setCreating(true); setCreateError('');
      const { data, error } = await saveChampionshipTeam({ championshipId: champId, teamId: null, name: trimmed, color: design.colors[0], design: design.id });
      setCreating(false);
      if (error) {
        const m = String(error.message || '');
        setCreateError(
          /ALREADY_ENROLLED/.test(m) ? 'Ya estás inscrito en este campeonato.'
          : /CAPACITY_FULL/.test(m) ? 'Los cupos están completos.'
          : /NOT_OPEN|REGISTRATION_CLOSED/.test(m) ? 'Las inscripciones no están abiertas.'
          : 'No se pudo crear el equipo. Intenta de nuevo.'
        );
        return;
      }
      // Crear ≠ inscribirse: NO se crea membership. Permanecer en ESTA pantalla → realNew se convierte en el
      // team EXISTENTE recién creado, en LECTURA. Snapshot sintético (pc=0) para render inmediato; loadRState
      // confirma los datos reales. autoEditDone evita el auto-edit inmediato (al reentrar luego, sí aplica).
      const newId = data?.team_id;
      autoEditDone.current = true;
      rDirty.current = false;
      setREditing(false); setREditSource(null);
      setRName(trimmed); setRDesign(design);
      // creator_is_privileged CIERTO: el creador es el usuario actual; sabemos si es owner (owner_user_id del
      // snapshot) o AlGrass (is_algrass). Así canDeleteTeam se evalúa correcto desde el primer frame.
      setRState(prev => ({ ...(prev || {}),
        teams: [{ id: newId, name: trimmed, color: design.colors[0], design: design.id, created_by_user_id: user?.id,
                  creator_is_privileged: (prev?.owner_user_id === user?.id) || !!prev?.is_algrass, player_count: 0, is_captain: false }],
        players: [], current_user_membership: (prev && prev.current_user_membership) || null,
        owner_user_id: prev?.owner_user_id, is_algrass: prev?.is_algrass }));
      navigate('/championships/team', { replace: true, state: { realChampionship: true, teamMode: 'existing', champId, teamId: newId, champStatus } });
      return;
    }
    const cv = readCV() || {}; const arr = getTeams(cv);
    if (mode === 'new') {
      if (arr.length < maxTeams) arr.push({ id: 'tnew' + arr.length, name: trimmed, design, color: design.colors[0], players, configured: true });
      putTeams(cv, arr); writeCV(cv);
      navigate(viewPath, { state: { summary, organizeState, cvReturn: true } });
    } else {
      const idx = arr.findIndex(t => t.id === team?.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], name: trimmed, design, color: design.colors[0], players, configured: true };
      putTeams(cv, arr); writeCV(cv);
      setOrigName(trimmed); setOrigDesign(design); setSavedOnce(true); setEditing(false); // aplica, sale de EDIT y queda en VIEW
    }
  };

  const deleteTeam = () => {
    const cv = readCV() || {}; putTeams(cv, getTeams(cv).filter(t => t.id !== team?.id)); writeCV(cv);
    navigate(viewPath, { state: { summary, organizeState, cvReturn: true } });
  };

  // Cancelar EDIT (EXISTING vía lápiz): descarta el draft, restaura originales y vuelve a VIEW (sin mover scroll).
  const cancel = () => { setName(origName); setDesign(origDesign); setEditing(false); };

  // ── REAL: derivados + handlers de la pantalla de equipo materializado. ──
  if (realExisting) {
    const rt = (rState?.teams || []).find(x => x.id === teamId) || null;
    const roster = (rState?.players || []).filter(p => p.team_id === teamId);
    const myMem = rState?.current_user_membership || null;
    const st = champStatus;
    const isOpen = st === 'registration_open';
    const amCreator = !!rt && rt.created_by_user_id === user?.id;
    const amOwner = !!rState && rState.owner_user_id === user?.id;      // pagador del campeonato
    const amAlgrass = !!rState?.is_algrass;                             // back-office AlGrass
    const amAdmin = amOwner || amAlgrass;
    // Gestión de roster (Fase 23): host desde organizers; canAdminMove = MISMA lógica compartida (championshipRoster).
    const amHost = !!rState?.organizers?.host && rState.organizers.host.user_id === user?.id;
    const { canAdminMove, canAdminEdit, canAdminAddNew } = rosterWindows(effPhaseOf(st, champLive), { amOwner, amHost, amAlgrass });
    const joinedHere = myMem?.team_id === teamId;
    // SELF (Fase 35): Host puro NUNCA se inscribe. Owner: join/cambiar en RO/RC/PRE/LIVE; salir solo RO.
    // Player: join/cambiar en RO/RC/PRE (no LIVE); salir solo RO. Espejo del backend (join_championship_team/leave).
    const effP = effPhaseOf(st, champLive);
    // El Host NUNCA hace SELF, aunque además sea owner (el rol Host tiene prioridad). Espejo del backend (Fase 35).
    const selfJoinOk = !amHost && (
      ['registration_open', 'registration_closed', 'in_progress_prelive'].includes(effP)
      || (effP === 'in_progress_live' && amOwner)
      || (st === 'pending_publish' && amOwner)
    );
    const selfLeaveOk = !amHost && (isOpen || (st === 'pending_publish' && amOwner));
    // Botón "Únete al equipo" ↔ "En el equipo": si ya está en ESTE equipo → salir (selfLeaveOk); si no → unir/cambiar.
    const canJoin = joinedHere ? selfLeaveOk : selfJoinOk;
    const pc = rt?.player_count ?? 0;                                   // roster ACTUAL (del state real)
    const captain = roster.find(p => p.is_captain) || null;            // capitán DINÁMICO (miembro más antiguo)
    const amCaptain = !!captain && captain.user_id === user?.id;
    // Team creado por owner/AlGrass → estructura PROTEGIDA (DELETE solo owner/AlGrass). Es propiedad del ORIGEN
    // del team, no del actor. Se usa el flag del backend Y, como defensa, la comparación local con owner_user_id
    // (created_by === owner) por si el flag no llegara: así el botón nunca se muestra al jugador normal.
    const creatorPrivileged = !!rt?.creator_is_privileged
      || (!!rt?.created_by_user_id && !!rState?.owner_user_id && rt.created_by_user_id === rState.owner_user_id);
    // Edición COMPLETA (nombre+color+diseño): equipo VACÍO → cualquier usuario si lo creó un jugador normal;
    // si lo creó owner/AlGrass, solo owner/AlGrass. Con jugadores → SOLO el capitán. Válida en open (o pending
    // si owner/AlGrass). ADEMÁS: owner/host/AlGrass en su ventana edit_team (canAdminEdit, Phase 33) → también
    // completa (nombre+color+diseño), no solo nombre — espejo de save_championship_team (v_can_edit). Sin cambiar
    // quién/cuándo puede editar: solo se habilita el selector de diseño donde el backend ya permite editar.
    const canEditFull = (((pc === 0 && (!creatorPrivileged || amAdmin)) || (pc >= 1 && amCaptain))
      && (isOpen || (st === 'pending_publish' && amAdmin)))
      || canAdminEdit;
    // Rename ADMIN (solo nombre): owner/host/AlGrass, cuando no aplica FULL. CUALQUIER fase (Fase 26).
    const canRenameAdmin = (amOwner || amHost || amAlgrass) && !canEditFull;
    const canEditName = canEditFull || canRenameAdmin;                 // muestra el lápiz
    const editNameOnly = canEditName && !canEditFull;                  // editor sin selector de diseño
    // Borrar (espejo EXACTO del backend delete_championship_team → _champ_can_manage_roster('delete_team')):
    //   SOLO roster ACTUAL = 0 y autorización POR ESTADO:
    //   registration_open → team normal cualquiera / team privilegiado solo owner/host/AlGrass.
    //   pending_publish y registration_closed → owner/host/AlGrass. in_progress/completed → nadie.
    const canDeleteTeam = pc === 0 && (
      isOpen ? (amAdmin || amHost || !creatorPrivileged)
        : (st === 'pending_publish' || st === 'registration_closed') ? (amAdmin || amHost)
        : false
    );
    const rTrim = rName.trim();

    const rBack = () => navigate(viewPath, { state: { cvReturn: true } });
    const rReload = () => loadRState();
    async function rDoJoin() { setRBusy(true); setRErr(''); const { error } = await joinChampionshipTeam({ championshipId: champId, teamId }); setRBusy(false); if (error) { const m = String(error.message || ''); setRErr(/REGISTRATION_CLOSED|NOT_OPEN/.test(m) ? 'Las inscripciones no están disponibles.' : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo ya no existe.' : 'No se pudo unir.'); rReload(); return; } rReload(); }
    async function rDoLeave() { setRBusy(true); setRErr(''); const { error } = await leaveChampionship({ championshipId: champId }); setRBusy(false); if (error) { setRErr(/NOT_OPEN/.test(error.message || '') ? 'No puedes salir en este estado.' : 'No se pudo salir.'); rReload(); return; } rReload(); }
    // Gestión ADMINISTRATIVA de un jugador (Fase 23) vía manage_championship_player: mover a equipo (teamId),
    // dejar sin equipo (teamId=null) o quitar (remove). El backend valida rol+fase. Refresca con loadRState:
    // si el jugador sale de ESTE equipo, desaparece del roster; si se mueve, se ve al volver a ChampionshipView.
    async function rDoManagePlayer({ teamId: destTeamId = null, remove = false }) {
      if (rBusy || !rPlayerAction) return;
      setRBusy(true); setRErr('');
      const { error } = await manageChampionshipPlayer({ championshipId: champId, userId: rPlayerAction.user_id, teamId: destTeamId, remove });
      setRBusy(false);
      if (error) { const m = String(error.message || ''); setRErr(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para esta acción.' : /NOT_OPEN/.test(m) ? 'No disponible en esta fase.' : 'No se pudo actualizar el roster.'); return; }
      setRPlayerAction(null);
      rReload();
    }
    // Agregar jugador NUEVO al equipo actual: reutiliza manage_championship_player (acción add_player; host/AlGrass;
    // owner NUNCA; el backend valida rol+fase). Inserta membership DIRECTO con team_id (sin pasar por team_id=null).
    function rOpenAdd() { setRAddOpen(true); setRAddQuery(''); setRAddResults([]); setRAddSelected(null); setRAddErr(''); }
    function rCloseAdd() { if (rAddBusy) return; setRAddOpen(false); setRAddQuery(''); setRAddResults([]); setRAddSelected(null); setRAddErr(''); }
    async function rDoAddPlayer() {
      if (rAddBusy || !rAddSelected) return;
      setRAddBusy(true); setRAddErr('');
      const { error } = await manageChampionshipPlayer({ championshipId: champId, userId: rAddSelected.id, teamId, remove: false });
      setRAddBusy(false);
      if (error) {
        const m = String(error.message || '');
        setRAddErr(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para agregar jugadores.'
          : /NOT_OPEN|INVALID_PHASE/.test(m) ? 'No disponible en esta fase.'
          : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo ya no existe.'
          : /INVALID_INPUT|USER_NOT_FOUND|ALREADY/.test(m) ? 'Ese usuario ya no está disponible o ya está inscrito.'
          : 'No se pudo agregar al jugador.');
        return;
      }
      setRAddOpen(false); setRAddQuery(''); setRAddResults([]); setRAddSelected(null);
      rReload();
    }
    // "Cambiar equipo" del slot de la llave: reemplaza SOLO ese lado (fromBracket.side) del match por el equipo
    // elegido (set_championship_match_team). El backend valida rol/fase/duplicado/resultado. Al guardar, vuelve
    // a la vista, que refresca la competición al reenfocar → la llave refleja el cambio.
    // Conflictos de horario y testigo de concurrencia del partido objetivo (desde la competición ya cargada).
    const rChangeConflicts = fromBracket?.matchId ? slotTeamConflicts(rMatches, fromBracket.matchId) : {};
    const rChangeUat = (rMatches.find(m => m.id === fromBracket?.matchId) || {}).updated_at ?? null;
    async function rDoChangeTeam() {
      if (rChangeBusy || !rChangeSel || !fromBracket?.matchId || !fromBracket?.side) return;
      setRChangeBusy(true); setRChangeErr('');
      const { error } = await setChampionshipMatchTeam({ matchId: fromBracket.matchId, side: fromBracket.side, teamId: rChangeSel, updatedAt: rChangeUat });
      setRChangeBusy(false);
      if (error) {
        const m = String(error.message || '');
        setRChangeErr(/NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para cambiar el equipo.'
          : /INVALID_PHASE/.test(m) ? 'Solo puedes cambiar el equipo con el campeonato en juego.'
          : /MATCH_HAS_RESULT/.test(m) ? 'El partido ya tiene resultado; no se puede cambiar el equipo.'
          : /SAME_TEAM/.test(m) ? 'Ese equipo ya está en el otro lado del partido.'
          : /TEAM_TIME_OVERLAP/.test(m) ? 'Ese equipo ya juega otro partido a esa hora.'
          : /TEAM_NOT_FOUND/.test(m) ? 'Ese equipo no es válido.'
          : /CONCURRENT_UPDATE/.test(m) ? 'Alguien actualizó el partido; vuelve a intentar.'
          : 'No se pudo cambiar el equipo.');
        return;
      }
      setRChangeOpen(false);
      rBack();   // vuelve a la Llave (la vista refetchea la competición al reenfocar)
    }
    // Ruta RELATIVA del equipo (deep-link) — backPath de retorno tras /auth. Debe ser relativa: <Navigate to>
    // de react-router espera una ruta, no una URL absoluta (con origin rompía el retorno → caía en la portada).
    const teamReturnPath = `/championships/view/${champId}?team=${teamId}`;
    // URL ABSOLUTA (con origin) — SOLO para Compartir (Web Share/portapapeles), no para navegación interna.
    const teamShareUrl = `${window.location.origin}${teamReturnPath}`;
    function rToggleJoin() {
      if (rBusy || !canJoin) return;
      // Anónimo → /auth reutilizando backPath (mecanismo real de retorno). Vuelve a ESTE equipo (deep-link ?team=)
      // y puede completar "Unirme" ya autenticado. No se navega a Home/listado/ChampionshipView genérico.
      if (!user) { navigate('/auth', { state: { backPath: teamReturnPath } }); return; }
      if (joinedHere) { rDoLeave(); return; }                          // salir de ESTE equipo (sin confirmación)
      if (myMem) { setRConfirm({ fromName: myMem.team_id ? ((rState.teams.find(x => x.id === myMem.team_id)?.name) || 'tu equipo') : null }); return; } // cambio → confirmar
      rDoJoin();                                                        // no inscrito → directo
    }
    // Compartir el equipo: Web Share API si existe; si no, copiar al portapapeles (mismo patrón que ChampionshipView).
    function shareTeam() {
      const title = rt?.name || 'Equipo';
      const text = `Únete a ${title} en AlGrass`;
      if (navigator.share) { navigator.share({ title, text, url: teamShareUrl }).catch(() => {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(teamShareUrl).then(() => { setRCopied(true); setTimeout(() => setRCopied(false), 1800); }).catch(() => {});
    }
    async function rSave() {
      if (rBusy || !rTrim) return;
      setRBusy(true); setRErr('');
      const { error } = await saveChampionshipTeam({ championshipId: champId, teamId, name: rTrim, color: rDesign.colors[0], design: rDesign.id });
      setRBusy(false);
      if (error) { const m = String(error.message || ''); setRErr(/TEAM_HAS_PLAYERS/.test(m) ? 'No puedes editar: el equipo ya tiene jugadores.' : /NOT_AUTHORIZED/.test(m) ? 'No tienes permiso para editar este equipo.' : /NOT_OPEN|REGISTRATION_CLOSED/.test(m) ? 'Las inscripciones no están abiertas.' : 'No se pudo guardar.'); rReload(); return; }
      setREditing(false); setREditSource(null); rDirty.current = false; rReload();
    }
    async function rDelete() {
      if (rBusy) return;
      setRBusy(true); setRErr('');
      const { error } = await deleteChampionshipTeam({ championshipId: champId, teamId });
      setRBusy(false);
      // La UI nunca es fuente de verdad: si el backend rechaza (roster ya no está vacío, o protección), refetch
      // para recalcular player_count/canDelete y que el botón desaparezca según el estado real.
      // Error: NO cerrar en silencio ni asumir borrado. Cierra el modal para que el mensaje sea visible y
      // refetch (rReload) recalcula canDeleteTeam/roster (p.ej. si ya tiene jugadores, el botón desaparece).
      if (error) { const m = String(error.message || ''); setRDelConfirm(false); setRErr(/TEAM_HAS_PLAYERS/.test(m) ? 'Ya no puedes borrar: el equipo tiene jugadores.' : /NOT_AUTHORIZED/.test(m) ? 'Solo el organizador o AlGrass pueden borrar este equipo.' : 'No se pudo borrar.'); rReload(); return; }
      // Éxito: cierra modal y vuelve al campeonato → ChampionshipView refetch (teams/roster; los "sin equipo"
      // aparecen ahí). No requiere refresh manual.
      setRDelConfirm(false);
      navigate(viewPath, { state: { cvReturn: true } });
    }

    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
        <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
          <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button onClick={rBack} aria-label="Atrás" style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Equipo</div>
            {/* Compartir el equipo (deep-link) — solo fuera de edición; misma posición que otros headers. */}
            {!rEditing && (
              <button onClick={shareTeam} aria-label="Compartir equipo" className="pressable" style={{ position: 'absolute', right: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3v13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 7l4-4 4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
            {rEditing && (
              <div style={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
                {/* "Cancelar" solo en edición MANUAL (botón Editar). En la auto-edición de entrada de un team
                    vacío no hay nada que cancelar → solo "Guardar". */}
                {rEditSource === 'manual' && <button onClick={() => { setREditing(false); setREditSource(null); rDirty.current = false; setRName(rt?.name || ''); setRDesign(designById(rt?.design)); setRErr(''); }} style={{ background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.82)', outline: 'none' }}>Cancelar</button>}
                <button onClick={rTrim && !rBusy ? rSave : undefined} disabled={!rTrim || rBusy} style={{ background: 'transparent', border: 'none', padding: '4px 0', cursor: (rTrim && !rBusy) ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: (rTrim && !rBusy) ? '#fff' : 'rgba(255,255,255,0.45)', outline: 'none' }}>{rBusy ? 'Guardando…' : 'Guardar'}</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '18px 16px calc(84px + env(safe-area-inset-bottom))' }}>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <Shield color={rEditing ? rDesign.colors[0] : (rt?.color || rDesign.colors[0])} design={rEditing ? rDesign : designById(rt?.design)} name={rEditing ? rName : (rt?.name || '')} size={120} />
              {!rEditing && canEditName && (
                <button onClick={() => { setREditSource('manual'); setREditing(true); }} aria-label="Editar equipo" className="pressable" style={{ position: 'absolute', top: 6, left: 'calc(50% + 64px)', width: 34, height: 34, borderRadius: '50%', background: '#fff', border: `1px solid ${HAIR}`, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, outline: 'none' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke={BLUE} strokeWidth="1.7" strokeLinejoin="round" /><path d="M13.5 6.5l4 4" stroke={BLUE} strokeWidth="1.7" strokeLinecap="round" /></svg>
                </button>
              )}
            </div>

            {rEditing ? (
              <>
                {!editNameOnly && (
                  <>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 8 }}>Diseño del escudo</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                      {TEAM_DESIGNS.map(d => (
                        <button key={d.id} onClick={() => { rDirty.current = true; setRDesign(d); }} style={{ width: 32, height: 32, borderRadius: '50%', background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', outline: 'none', boxShadow: sameDesign(rDesign, d) ? `0 0 0 2px #fff, 0 0 0 4px ${BLUE}` : 'none' }}>
                          <DesignSwatch design={d} size={32} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 6 }}>Nombre del equipo</div>
                <input value={rName} onChange={e => { if (withinTeamNameWordLimit(e.target.value)) { rDirty.current = true; setRName(e.target.value); } }} placeholder="Nombre del equipo" maxLength={40} style={{ width: '100%', height: 44, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }} />
              </>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3, marginBottom: 20 }}>{rt?.name || 'Equipo'}</div>
            )}

            {rErr && <div style={{ fontSize: 12.5, color: DANGER, lineHeight: 1.4, marginBottom: 10, textAlign: 'center' }}>{rErr}</div>}

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>Jugadores</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{roster.length} {roster.length === 1 ? 'inscrito' : 'inscritos'}</div>
            </div>
            {roster.length === 0 ? (
              <div style={{ fontSize: 13, color: SUB, marginBottom: 16 }}>Aún no hay jugadores en este equipo.</div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {roster.map((p, i) => (
                  // Fila: nombre/avatar → perfil público (PlayerModal); ⋮ → gestión (action sheet compartido), separados.
                  // Avatar/foto y nombre desde rState.players (ya cargado) → CERO queries por jugador.
                  <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                    <button onClick={() => setRSelectedPlayer({ user_id: p.user_id, name: p.full_name })} className="pressable" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <div style={{ width: 18, textAlign: 'right', fontSize: 13, fontWeight: 700, color: SUB, flexShrink: 0 }}>{i < 7 ? i + 1 : '-'}</div>
                      <RosterAvatar path={p.avatar_path} hue={p.avatar_hue} name={p.full_name || 'Jugador'} size={34} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Jugador'}</div>
                    </button>
                    {p.is_captain && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: BLUE, background: '#EAF1FD', borderRadius: 8, padding: '2px 8px' }}>Capitán</span>}
                    {/* Goles totales (Fase 32) — orden: Capitán · goles · ⋮. Solo in_progress/completed. 0 se muestra. */}
                    {showGoals && <span style={{ flexShrink: 0, fontSize: 15, fontWeight: 800, color: TEXT, minWidth: 16, textAlign: 'right' }}>{rGoalsBy[p.user_id] || 0}</span>}
                    {/* ⋮ gestión — SOLO managers con acción de roster posible (canAdminMove). Backend valida igual. */}
                    {canAdminMove && (
                      <button onClick={() => setRPlayerAction({ user_id: p.user_id, name: p.full_name, team_id: teamId })} className="pressable" aria-label="Gestionar jugador" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, fontSize: 18, fontWeight: 800, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>⋮</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Cambiar equipo del SLOT de la llave (Fase 31) — SOLO si se entró desde un slot concreto
                (fromBracket) y el actor es host/AlGrass con el campeonato en juego. Reemplaza solo ese lado. */}
            {!!fromBracket?.matchId && (amHost || amAlgrass) && champStatus === 'in_progress' && (
              <button onClick={() => { setRChangeSel(teamId); setRChangeErr(''); setRChangeOpen(true); }} className="pressable" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: BLUE, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, marginBottom: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M4 8a6 6 0 0110-3M16 12a6 6 0 01-10 3" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" /><path d="M14 3v3h-3M6 17v-3h3" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Cambiar equipo
              </button>
            )}

            {/* Agregar jugador NUEVO (Fase 29) — SOLO Host/AlGrass en fase válida (canAdminAddNew). Owner/jugador
                normal no lo ven. El backend valida igual (add_player). Abre un modal de búsqueda + selección. */}
            {canAdminAddNew && (
              <button onClick={rOpenAdd} className="pressable" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 46, borderRadius: 14, border: `1.5px dashed ${HAIR}`, background: '#fff', color: BLUE, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, marginBottom: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke={BLUE} strokeWidth="2" strokeLinecap="round" /></svg>
                Agregar jugador
              </button>
            )}

            {/* "Eliminar equipo" depende SOLO de canDeleteTeam (roster=0 + permisos), NO de estar editando:
                debe convivir con el auto-edit del team vacío (Guardar + Únete + empty state). */}
            {canDeleteTeam && (
              // NUNCA borra en un tap: abre confirmación explícita (setRDelConfirm). La RPC se llama tras confirmar.
              <button onClick={() => setRDelConfirm(true)} disabled={rBusy} className="pressable" style={{ width: '100%', height: 46, borderRadius: 14, border: '1px solid #F3C0C0', background: '#fff', color: DANGER, cursor: rBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, marginTop: 8, opacity: rBusy ? 0.7 : 1, outline: 'none' }}>Eliminar equipo</button>
            )}
          </div>

          {/* CTA de pertenencia: Únete al equipo ↔ En el equipo. Depende SOLO de canJoin (estado permite
              join/leave), NO de estar editando: editar el team y unirse son acciones independientes. */}
          {canJoin && (
            <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
              <button onClick={rBusy ? undefined : rToggleJoin} disabled={rBusy} className="pressable" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 54, borderRadius: 18, border: 'none', cursor: rBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, outline: 'none', background: joinedHere ? '#D7F0DD' : ORANGE, color: joinedHere ? '#1F6B36' : '#1B1B1F', opacity: rBusy ? 0.75 : 1, boxShadow: joinedHere ? 'none' : '0 6px 18px rgba(245,165,36,0.40)' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: joinedHere ? 'none' : '2px solid #1B1B1F', background: joinedHere ? '#1F6B36' : 'transparent' }}>
                  {joinedHere && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                {rBusy ? '…' : (joinedHere ? 'En el equipo' : 'Únete al equipo')}
              </button>
            </div>
          )}
        </div>

        {rConfirm && (
          <div className="sheet-overlay" onClick={() => setRConfirm(null)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
            <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{rConfirm.fromName ? '¿Cambiar de equipo?' : '¿Unirte a este equipo?'}</div>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>{rConfirm.fromName ? `Ya estás inscrito en ${rConfirm.fromName}. Si continúas, pasarás a ${rt?.name || 'este equipo'}.` : `Estás inscrito sin equipo. Si continúas, pasarás a ${rt?.name || 'este equipo'}.`}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={() => setRConfirm(null)} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cancelar</button>
                <button onClick={() => { setRConfirm(null); rDoJoin(); }} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, outline: 'none' }}>{rConfirm.fromName ? 'Cambiarme' : 'Unirme'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmación OBLIGATORIA de "Eliminar equipo" (nunca borra en un tap). Mismo sheet que rConfirm.
            En este flujo el backend SOLO borra equipos VACÍOS (rechaza con jugadores), así que ningún jugador
            queda sin equipo → texto secundario acorde. El botón destructivo conserva el estilo peligroso. */}
        {rDelConfirm && (
          <div className="sheet-overlay" onClick={() => !rBusy && setRDelConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
            <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>¿Estás seguro de que quieres eliminar este equipo?</div>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>Esta acción no se puede deshacer.</div>
              {rErr && <div style={{ fontSize: 12.5, color: DANGER, lineHeight: 1.4, marginTop: 10 }}>{rErr}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={() => !rBusy && setRDelConfirm(false)} disabled={rBusy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: rBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cancelar</button>
                <button onClick={rBusy ? undefined : rDelete} disabled={rBusy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: '1px solid #F3C0C0', background: '#fff', color: DANGER, cursor: rBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, opacity: rBusy ? 0.7 : 1, outline: 'none' }}>{rBusy ? 'Eliminando…' : 'Eliminar equipo'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal "Agregar jugador": buscar por nombre/@user_code → seleccionar UNO → Guardar. No agrega al tocar
            un resultado (solo selecciona). El backend valida rol/fase/duplicado; el botón oculto no es seguridad. */}
        {rAddOpen && (
          <div className="sheet-overlay" onClick={rCloseAdd} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 12px calc(16px + env(safe-area-inset-bottom))' }}>
            <div className="sheet-panel no-sb" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, padding: 18, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>Agregar jugador</div>
              <div style={{ fontSize: 13, color: SUB, lineHeight: 1.45, marginTop: 4 }}>Busca por nombre o @usuario y selecciónalo para sumarlo a {rt?.name || 'este equipo'}.</div>
              <input value={rAddQuery} onChange={e => { setRAddQuery(e.target.value); setRAddSelected(null); }} placeholder="Buscar jugador…" autoFocus style={{ width: '100%', height: 44, borderRadius: 12, border: `1px solid ${HAIR}`, padding: '0 14px', marginTop: 12, fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' }} />
              <div className="no-sb" style={{ flex: 1, minHeight: 80, maxHeight: '42vh', overflowY: 'auto', marginTop: 10 }}>
                {rAddSearching ? (
                  <div style={{ fontSize: 13, color: SUB, padding: '10px 2px' }}>Buscando…</div>
                ) : rAddQuery.trim() && rAddResults.length === 0 ? (
                  <div style={{ fontSize: 13, color: SUB, padding: '10px 2px' }}>Sin resultados. Solo aparecen usuarios de AlGrass aún no inscritos.</div>
                ) : rAddResults.map(u => {
                  const sel = rAddSelected?.id === u.id;
                  return (
                    <button key={u.id} onClick={() => setRAddSelected(u)} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 8px', borderRadius: 12, border: sel ? `1.5px solid ${BLUE}` : '1.5px solid transparent', background: sel ? '#EAF1FD' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <RosterAvatar path={u.avatarPath} hue={u.hue} name={u.name || 'Jugador'} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name || 'Jugador'}</div>
                        {u.code && <div style={{ fontSize: 12, color: SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.code}</div>}
                      </div>
                      {sel && <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}><path d="M3.5 9.5l3.5 3.5 7-8" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </button>
                  );
                })}
              </div>
              {rAddErr && <div style={{ fontSize: 12.5, color: DANGER, lineHeight: 1.4, marginTop: 8 }}>{rAddErr}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={rCloseAdd} disabled={rAddBusy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: rAddBusy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cancelar</button>
                <button onClick={(!rAddSelected || rAddBusy) ? undefined : rDoAddPlayer} disabled={!rAddSelected || rAddBusy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: (!rAddSelected || rAddBusy) ? '#E8E8EC' : BLUE, color: (!rAddSelected || rAddBusy) ? '#9A9AA0' : '#fff', cursor: (!rAddSelected || rAddBusy) ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, outline: 'none' }}>{rAddBusy ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Selector para "Cambiar equipo" del slot de la llave. Excluye el equipo del OTRO lado del match. */}
        <TeamPickerSheet
          open={rChangeOpen}
          title="Cambiar equipo del partido"
          teams={rState?.teams || []}
          excludeTeamId={fromBracket?.otherTeamId || null}
          selectedId={rChangeSel}
          busy={rChangeBusy}
          error={rChangeErr}
          designOf={designById}
          conflicts={rChangeConflicts}
          onSelect={setRChangeSel}
          onCancel={() => { if (!rChangeBusy) { setRChangeOpen(false); setRChangeErr(''); } }}
          onSave={rDoChangeTeam}
        />

        {/* Perfil público del jugador — MISMO PlayerModal que el roster de Inscripciones. Se carga SOLO al pulsar. */}
        {rSelectedPlayer && <PlayerModal player={rSelectedPlayer} onClose={() => setRSelectedPlayer(null)} />}
        {rCopied && (
          <div style={{ position: 'fixed', left: '50%', bottom: 'calc(90px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 260, background: '#1B1B1F', color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 999, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>Enlace copiado</div>
        )}
        {/* Action sheet de gestión (⋮) — MISMO componente que ChampionshipView. teams desde rState (excluye el actual). */}
        <PlayerActionSheet
          key={rPlayerAction?.user_id || 'none'}
          player={rPlayerAction} teams={rState?.teams || []} designOf={designById} busy={rBusy}
          onMove={(destId) => rDoManagePlayer({ teamId: destId })}
          onNoTeam={() => rDoManagePlayer({ teamId: null })}
          onRemove={() => rDoManagePlayer({ remove: true })}
          onClose={() => setRPlayerAction(null)}
        />
      </div>
    );
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header compacto 44px (sin TabBar) */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={back} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1 }} />
          {(showCancel || showSave) && (
            <div style={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
              {showCancel && <button onClick={cancel} style={{ background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.82)', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>}
              {showSave && <button onClick={canSave ? save : undefined} disabled={!canSave} style={{ background: 'transparent', border: 'none', padding: '4px 0', cursor: canSave ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: canSave ? '#fff' : 'rgba(255,255,255,0.45)', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Guardar</button>}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '18px 16px calc(84px + env(safe-area-inset-bottom))' }}>
          {/* Escudo grande (iniciales, no nombre completo) */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <Shield design={design} name={name} size={120} />
            {mode === 'existing' && !editing && allowManage && (
              <button onClick={() => setEditing(true)} aria-label="Editar equipo" className="pressable" style={{ position: 'absolute', top: 6, left: 'calc(50% + 64px)', width: 34, height: 34, borderRadius: '50%', background: '#fff', border: `1px solid ${HAIR}`, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke={BLUE} strokeWidth="1.7" strokeLinejoin="round" /><path d="M13.5 6.5l4 4" stroke={BLUE} strokeWidth="1.7" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>

          {canEdit ? (
            <>
              {/* EDIT: 10 diseños (5 sólidos + 5 patrones) + input de nombre (escudo actualiza en vivo) */}
              <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 8 }}>Diseño del escudo</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                {TEAM_DESIGNS.map(d => (
                  <button key={d.id} onClick={() => setDesign(d)} style={{
                    width: 32, height: 32, borderRadius: '50%', background: 'transparent', border: 'none', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', outline: 'none', WebkitTapHighlightColor: 'transparent',
                    boxShadow: sameDesign(design, d) ? `0 0 0 2px #fff, 0 0 0 4px ${BLUE}` : 'none',
                  }}>
                    <DesignSwatch design={d} size={32} />
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB, marginBottom: 6 }}>Nombre del equipo</div>
              <input
                value={name}
                onChange={onNameChange}
                placeholder="Nombre del equipo"
                maxLength={40}
                style={{ width: '100%', height: 44, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
              />
            </>
          ) : (
            /* VIEW: solo el nombre debajo del escudo (sin paleta ni input) */
            <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3, marginBottom: 20 }}>{name || 'Equipo'}</div>
          )}

          {/* REAL: aviso de que al crear el equipo quedas inscrito como su primer jugador. */}
          {realNew && (
            <>
              <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginBottom: 8 }}>Crea tu equipo y dale a guardar, luego tú y tus amigos podrán unirse.</div>
              {createError && <div style={{ fontSize: 12.5, color: DANGER, lineHeight: 1.4, marginBottom: 8 }}>{createError}</div>}
            </>
          )}

          {/* Jugadores — 1..7 numerados; a partir del 8, "-" (no revelar titular por posición) */}
          {!realNew && <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2, marginBottom: 8 }}>Jugadores</div>}
          {realNew ? null : players.length === 0 ? (
            <div style={{ fontSize: 13, color: SUB, marginBottom: 16 }}>Aún no hay jugadores en este equipo.</div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                  <div style={{ width: 18, textAlign: 'right', fontSize: 13, fontWeight: 700, color: SUB, flexShrink: 0 }}>{i < 7 ? i + 1 : '-'}</div>
                  <PlayerAvatar name={p.name} size={34} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT }}>{playerLabel(p)}</div>
                </div>
              ))}
            </div>
          )}

          {canDelete && (
            <button onClick={deleteTeam} className="pressable" style={{ width: '100%', height: 46, borderRadius: 14, border: '1px solid #F3C0C0', background: '#fff', color: DANGER, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, marginTop: 8, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Eliminar equipo</button>
          )}
        </div>

        {/* CTA flotante inferior = pertenencia al equipo. En realNew se muestra DESHABILITADO (crear ≠ unirse):
            deja claro que son acciones distintas; se habilita tras crear (ya como team existente). */}
        {(canJoin || realNew) && (
          <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
            <button onClick={realNew ? undefined : toggleJoin} disabled={realNew} className={realNew ? undefined : 'pressable'} style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              width: '100%', height: 54, borderRadius: 18, border: 'none', cursor: realNew ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', outline: 'none',
              background: realNew ? '#E8E8EC' : (joined ? '#D7F0DD' : ORANGE), color: realNew ? '#9A9AA0' : (joined ? '#1F6B36' : '#1B1B1F'),
              boxShadow: (realNew || joined) ? 'none' : '0 6px 18px rgba(245,165,36,0.40)',
            }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: (!realNew && joined) ? 'none' : `2px solid ${realNew ? '#9A9AA0' : '#1B1B1F'}`, background: (!realNew && joined) ? '#1F6B36' : 'transparent' }}>
                {!realNew && joined && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              {(!realNew && joined) ? 'En el equipo' : 'Únete al equipo'}
            </button>
          </div>
        )}
      </div>

      {/* Confirmación de CAMBIO de inscripción (de otro equipo / de "sin equipo") → mueve, una sola */}
      {confirmJoin && (
        <div className="sheet-overlay" onClick={() => setConfirmJoin(null)} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{confirmJoin.kind === 'switchTeam' ? '¿Quieres cambiar de equipo?' : '¿Quieres unirte a este equipo?'}</div>
            <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, marginTop: 8 }}>{confirmJoin.kind === 'switchTeam'
              ? `Ya estás inscrito en ${confirmJoin.fromName}. Si continúas, dejarás ese equipo y pasarás a ${thisTeamName()}.`
              : `Actualmente estás inscrito sin equipo. Si continúas, pasarás a formar parte de ${thisTeamName()}.`}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setConfirmJoin(null)} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cancelar</button>
              <button onClick={commitJoinTeam} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: ORANGE, color: '#1B1B1F', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>{confirmJoin.kind === 'switchTeam' ? 'Cambiar de equipo' : 'Unirme al equipo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
