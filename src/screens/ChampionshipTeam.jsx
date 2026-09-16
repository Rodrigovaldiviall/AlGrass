import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, DANGER } from '../constants';
import Shield, { DesignSwatch } from '../components/championship/Shield';
import PlayerAvatar from '../components/championship/PlayerAvatar';
import { TEAM_DESIGNS, DEFAULT_DESIGN, teamDesign, sameDesign, withinTeamNameWordLimit, playerLabel, CURRENT_USER_NAME } from '../data/championshipTeamsMock';

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
  // Tope de equipos para crear (NEW): override opcional del nav (Liga usa uno alto, sin límite real).
  const maxTeams = nav.maxTeams ?? (summary.group ? summary.group.max : 8);

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

  const back = () => navigate('/championships/view', { state: { summary, organizeState, cvReturn: true } });

  const save = () => {
    if (!canSave) return;
    const cv = readCV() || {}; const arr = getTeams(cv);
    if (mode === 'new') {
      if (arr.length < maxTeams) arr.push({ id: 'tnew' + arr.length, name: trimmed, design, color: design.colors[0], players, configured: true });
      putTeams(cv, arr); writeCV(cv);
      navigate('/championships/view', { state: { summary, organizeState, cvReturn: true } });
    } else {
      const idx = arr.findIndex(t => t.id === team?.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], name: trimmed, design, color: design.colors[0], players, configured: true };
      putTeams(cv, arr); writeCV(cv);
      setOrigName(trimmed); setOrigDesign(design); setSavedOnce(true); setEditing(false); // aplica, sale de EDIT y queda en VIEW
    }
  };

  const deleteTeam = () => {
    const cv = readCV() || {}; putTeams(cv, getTeams(cv).filter(t => t.id !== team?.id)); writeCV(cv);
    navigate('/championships/view', { state: { summary, organizeState, cvReturn: true } });
  };

  // Cancelar EDIT (EXISTING vía lápiz): descarta el draft, restaura originales y vuelve a VIEW (sin mover scroll).
  const cancel = () => { setName(origName); setDesign(origDesign); setEditing(false); };

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

          {/* Jugadores — 1..7 numerados; a partir del 8, "-" (no revelar titular por posición) */}
          <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2, marginBottom: 8 }}>Jugadores</div>
          {players.length === 0 ? (
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

        {/* CTA flotante inferior = pertenencia al equipo (siempre; también en NEW). Sin holder,
            respeta safe-area inferior, no hay TabBar. Guardar vive en el header. */}
        {canJoin && (
          <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
            <button onClick={toggleJoin} className="pressable" style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              width: '100%', height: 54, borderRadius: 18, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', outline: 'none',
              background: joined ? '#D7F0DD' : ORANGE, color: joined ? '#1F6B36' : '#1B1B1F',
              boxShadow: joined ? 'none' : '0 6px 18px rgba(245,165,36,0.40)',
            }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: joined ? 'none' : '2px solid #1B1B1F', background: joined ? '#1F6B36' : 'transparent' }}>
                {joined && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              {joined ? 'En el equipo' : 'Únete al equipo'}
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
