import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, RED } from '../constants';
import Shield from '../components/championship/Shield';
import PlayerAvatar from '../components/championship/PlayerAvatar';
import { buildTeams, combinedRoster, mockStandings, mockScorers, mockMatches, formatForTeamCount, chunkByCounts } from '../data/championshipTeamsMock';

// Temas de PORTADA (independientes de la paleta de equipos). Default rojo; el azul es un tono
// claramente distinto al azul de marca (#3F5FE0) para que portada y header no se confundan.
const COVER_THEMES = ['#E24A4A', '#0EA5E9', '#2E9E5B', '#F5A524', '#8E44AD'];

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
  const summary = location.state?.summary || {};
  const organizeState = location.state?.organizeState || null;

  const complies = !!summary.complies;
  const group = summary.group || null; // { min, max }
  const maxTeams = group ? group.max : 8;       // tope del rango (8 para 7–8)
  const initialTeams = group ? group.min : 4;   // la DEMO arranca poblada (7 para 7–8)

  const [name, setName] = useState(summary.name || 'Copa AlGrass');
  const [coverTheme, setCoverTheme] = useState(COVER_THEMES[0]); // default rojo
  const [coverPanel, setCoverPanel] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [resultsPublic, setResultsPublic] = useState(true);
  const [demo, setDemo] = useState('inscripciones');    // 'inscripciones' | 'resultados'
  const [resultsView, setResultsView] = useState('tabla'); // 'tabla' | 'llave' | 'partidos'
  const [joinedNoTeam, setJoinedNoTeam] = useState(false);
  const [teams, setTeams] = useState(() => buildTeams(initialTeams));

  const you = joinedNoTeam ? { id: 'you', name: 'Tú', team: null } : null;
  const roster = useMemo(() => combinedRoster(teams, you), [teams, joinedNoTeam]);
  const standings = useMemo(() => mockStandings(teams), [teams]);
  const scorers = useMemo(() => mockScorers(teams), [teams]);
  const matches = useMemo(() => mockMatches(teams), [teams]);

  // Regla ÚNICA: slots grises = maxTeams − equipos actuales; no se puede superar maxTeams.
  const emptySlots = Math.max(0, maxTeams - teams.length);
  const canCreateTeam = teams.length < maxTeams;
  // "+" y "Crear equipo" comparten handler. openExistingTeam es una acción DISTINTA (entrar/ver).
  // Futuro (siguiente bloque): público → pedir clave al unirse; privado → flujo privado. Entrar ≠ configurar.
  const createNewTeam = () => { if (!canCreateTeam) return; setTeams(list => [...list, buildTeams(list.length + 1)[list.length]]); };
  const openExistingTeam = (_team) => { /* siguiente bloque: entrar/ver ese equipo (no configurar por defecto) */ };

  const goBack = () => navigate('/championships/organize', organizeState ? { state: { organizeState } } : undefined);

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header (sin TabBar en esta pantalla) */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 12, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={goBack} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Ver mi campeonato</div>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* ── Portada editable ── */}
          <div style={{ position: 'relative', height: 180, background: coverTheme, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }} />
            <button onClick={() => setCoverPanel(v => !v)} className="pressable" style={{ position: 'absolute', top: 10, right: 12, padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.35)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Editar portada</button>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nombre del campeonato"
              maxLength={40}
              style={{ position: 'absolute', left: 16, right: 120, bottom: 14, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: -0.4, fontFamily: 'inherit', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
            />
            {group && (
              <div style={{ position: 'absolute', right: 12, bottom: 14, padding: '5px 11px', borderRadius: 999, background: 'rgba(0,0,0,0.42)', color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{group.min}–{group.max} equipos</div>
            )}
          </div>

          {/* Panel de edición de portada (mock) */}
          {coverPanel && (
            <div style={{ background: '#fff', borderBottom: `1px solid ${HAIR}`, padding: '14px 16px' }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del campeonato" maxLength={40} style={{ width: '100%', height: 42, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
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

          <div style={{ padding: '14px 16px calc(84px + env(safe-area-inset-bottom))' }}>
            {/* ── Resumen de reserva ── */}
            <div style={CARD}>
              <ResumenRow icon="cal" value={complies ? (summary.dateLabel || 'Pendiente por confirmar') : 'Pendiente por confirmar'} sub="Fase de grupos" />
              <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
              <ResumenRow icon="pin" value={complies ? (summary.venueName || 'Pendiente por confirmar') : 'Pendiente por confirmar'} sub={complies ? `${summary.venueAddress ?? ''}${summary.venueDistrict ? ' · ' + summary.venueDistrict : ''}` : 'Te contactaremos para coordinar la sede y el horario.'} />
              <div style={{ height: 1, background: HAIR, margin: '10px 0' }} />
              <ResumenRow icon="grid" value={complies ? (summary.configLabel || 'Cancha por confirmar') : 'Cancha por confirmar'} sub={`${summary.formatLabel || '7v7'} · Aire libre`} />
            </div>

            {/* ── Amenities del venue (solo si hay venue con disponibilidad y amenities) ── */}
            {complies && !summary.courtCustom && summary.venueAmenities?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {summary.venueAmenities.map(a => <span key={a} style={pill}>{a}</span>)}
              </div>
            )}

            {/* ── Descripción (copy informativo/mock, sin lógica de fixture) ── */}
            <div style={CARD}>
              <div style={H}>Descripción</div>
              <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.55, marginTop: 6 }}>
                Cada equipo juega por lo menos 3 partidos y los finalistas hasta 5. El cronograma se organizará de acuerdo a la cantidad de equipos que se registren.
              </div>
            </div>

            {/* ── Privacidad (modo demostración del organizador) ── */}
            <div style={CARD}>
              <div style={H}>Privacidad</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginTop: 10 }}>Configura clave de acceso</div>
              <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 2, marginBottom: 8 }}>Con esta clave podrán acceder tus jugadores para organizarse.</div>
              <input value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Ej. PICHANGA2026" maxLength={24} style={{ width: '100%', height: 42, borderRadius: 10, border: `1px solid ${HAIR}`, padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box', letterSpacing: 1 }} />
              <div style={{ fontSize: 12, color: SUB, marginTop: 6 }}>Comparte este código con tus invitados para que se inscriban.</div>
              <div style={{ height: 1, background: HAIR, margin: '14px 0' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT }}>Resultados públicos</div>
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginTop: 2 }}>Cualquiera con el enlace puede ver la llave y los resultados — ideal para que más gente siga tu torneo. Desactívalo para que solo lo vean los inscritos.</div>
                </div>
                <button onClick={() => setResultsPublic(v => !v)} style={{ width: 44, height: 26, borderRadius: 999, border: 'none', background: resultsPublic ? BLUE : '#E5E5EA', cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0, transition: 'background .2s ease', outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ position: 'absolute', top: 2, left: resultsPublic ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left .2s ease' }} />
                </button>
              </div>
            </div>

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
              ? <Inscripciones teams={teams} emptySlots={emptySlots} canCreate={canCreateTeam} onCreate={createNewTeam} onOpenTeam={openExistingTeam} roster={roster} joined={joinedNoTeam} onToggleJoin={() => setJoinedNoTeam(v => !v)} count={roster.length} />
              : <Resultados view={resultsView} setView={setResultsView} teams={teams} standings={standings} scorers={scorers} matches={matches} venueName={summary.venueName || 'AlGrass Arena'} />}
          </div>
        </div>

        {/* CTA flotante (sin TabBar; respeta safe-area inferior) */}
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', pointerEvents: 'none' }}>
          <button onClick={() => { /* siguiente paso pendiente (pago/habilitación) */ }} className="pressable" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54, background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18, boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent' }}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

const pill = { padding: '6px 12px', borderRadius: 999, background: '#EEF2FF', color: BLUE, fontSize: 12.5, fontWeight: 700 };

function ResumenRow({ icon, value, sub }) {
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
    </div>
  );
}

// ── Inscripciones (§8.1) ──────────────────────────────────────────────────────
function Inscripciones({ teams, emptySlots, canCreate, onCreate, onOpenTeam, roster, joined, onToggleJoin, count }) {
  return (
    <>
      <div style={CARD}>
        <div style={H}>Inscripciones</div>
        <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 4, marginBottom: 12 }}>Selecciona un equipo para sumarte o crea tu propio equipo e invita a tus amigos.</div>

        {/* Grilla: equipos reales (escudo con iniciales + nombre debajo; click → entrar/ver)
            + slots grises "+" (click → crear equipo). El escudo mantiene su tamaño (60). */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          {teams.map(t => (
            <button key={t.id} onClick={() => onOpenTeam(t)} className="pressable" style={{ width: 64, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Shield color={t.color} name={t.name} size={60} />
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

      {/* Roster combinado — "sin equipo" NO muestra escudo, solo "Sin equipo" */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={H}>Jugadores</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>{count} inscritos</div>
        </div>
        {roster.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
            <div style={{ width: 18, fontSize: 12, color: SUB, flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
            <PlayerAvatar name={p.name} size={34} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}</div>
            {p.team ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Shield color={p.team.color} size={16} />
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
function Resultados({ view, setView, teams, standings, scorers, matches, venueName }) {
  const innerRef = useRef(null);
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    setMinH(prev => (h > prev ? h : prev));
  }, [view, teams]);

  // Todo deriva del nº de equipos actual (reacciona si se crean equipos): grupos + semifinales.
  const teamCount = teams.length;
  const cfg = formatForTeamCount(teamCount);
  const groups = chunkByCounts(standings, cfg.groupSizes);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Seg active={view === 'tabla'} onClick={() => setView('tabla')}>Tabla</Seg>
        <Seg active={view === 'llave'} onClick={() => setView('llave')}>Llave</Seg>
        <Seg active={view === 'partidos'} onClick={() => setView('partidos')}>Partidos</Seg>
      </div>
      <div style={{ minHeight: minH }}>
        <div ref={innerRef}>
          {view === 'tabla' && <TablaMock groups={groups} cfg={cfg} />}
          {view === 'llave' && <LlaveMock teams={teams} cfg={cfg} />}
          {view === 'partidos' && <PartidosMock matches={matches} venueName={venueName} />}

          {/* Goleadores: visible en Tabla/Llave, oculto en Partidos (§13.6) */}
          {view !== 'partidos' && (
            <div style={CARD}>
              <div style={H}>Goleadores</div>
              <div style={{ marginTop: 6 }}>
                {scorers.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${HAIR}` }}>
                    <div style={{ width: 16, fontSize: 12, color: SUB, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                    <PlayerAvatar name={p.name} size={30} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT }}>{p.name}</div>
                    <Shield color={p.team.color} size={14} />
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
function GroupTable({ label, sub, rows }) {
  const COLS = [['PJ', 'pj'], ['G', 'g'], ['E', 'e'], ['P', 'p'], ['GF', 'gf'], ['GC', 'gc'], ['DG', 'dg']];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 1, marginBottom: 6 }}>{sub}</div>
      <div style={{ display: 'flex', borderTop: `1px solid ${HAIR}` }}>
        {/* Equipo (fijo izquierda) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 30, display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: SUB }}>Equipo</div>
          {rows.map(r => (
            <div key={r.team.id} style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8 }}>
              <Shield color={r.team.color} name={r.team.name} size={20} />
              <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.team.name}</span>
            </div>
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
function TablaMock({ groups, cfg }) {
  return (
    <div style={CARD}>
      {groups.map((rows, i) => (
        <GroupTable key={i} label={`Grupo ${i + 1}`} sub={`${cfg.groupSizes[i]} equipos · ${cfg.gamesPerTeam[i]} partidos por equipo`} rows={rows} />
      ))}
    </div>
  );
}

// Escudo de slot (equipo mock o silueta punteada "a definir").
function Slot({ team, size = 44 }) {
  return team ? <Shield color={team.color} name={team.name} size={size} /> : <Shield dashed size={size} />;
}
const BRK_LABEL = { fontSize: 11, fontWeight: 800, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6, textAlign: 'center' };

// Enfrentamiento horizontal (Final / 3.º-4.º): [escudo] VS [escudo] con su label encima.
function VsPair({ a, b, label, size = 44 }) {
  return (
    <div style={{ textAlign: 'center' }}>
      {label && <div style={BRK_LABEL}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Slot team={a} size={size} /><span style={{ fontSize: 11, fontWeight: 700, color: SUB }}>VS</span><Slot team={b} size={size} />
      </div>
    </div>
  );
}

// Semifinal vertical (una por lado): "Semifinal" + [A] VS [B].
function SemiCol({ a, b, size = 40 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={BRK_LABEL}>Semifinal</div>
      <Slot team={a} size={size} />
      <span style={{ fontSize: 11, fontWeight: 700, color: SUB, margin: '3px 0' }}>VS</span>
      <Slot team={b} size={size} />
    </div>
  );
}

// Estructura derivada de cfg. CON semifinales (8/12/16): semifinal izquierda + Final/3.º centrados +
// semifinal derecha (sin partido intermedio). SIN semifinales: solo Final + 3.º/4.º.
function LlaveMock({ teams, cfg }) {
  const t = (i) => teams[i] || null;

  // Centro: Final + 3.º/4.º. Con semis, los finalistas son "a definir" (dashed).
  const center = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <VsPair label="Final" a={cfg.hasSemifinals ? null : t(0)} b={cfg.hasSemifinals ? null : t(1)} />
      {cfg.hasThirdPlace && <VsPair label="3.º y 4.º puesto" a={cfg.hasSemifinals ? null : t(2)} b={cfg.hasSemifinals ? null : t(3)} />}
    </div>
  );

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={H}>Llave del torneo</div>
        <div style={{ fontSize: 12, color: SUB }}>{teams.length} equipos</div>
      </div>

      {cfg.hasSemifinals ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <SemiCol a={t(0)} b={t(1)} />
          {center}
          <SemiCol a={t(2)} b={t(3)} />
        </div>
      ) : center}

      <div style={{ fontSize: 11.5, color: SUB, marginTop: 14, textAlign: 'center' }}>Cuadro eliminatorio de ejemplo.</div>
    </div>
  );
}

function TeamLine({ team, score }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Shield color={team.color} size={22} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</span>
      {score != null && <span style={{ fontSize: 15, fontWeight: 800, color: TEXT, flexShrink: 0, minWidth: 14, textAlign: 'right' }}>{score}</span>}
    </div>
  );
}

function MatchCard({ m }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${HAIR}` }}>
      {/* Izquierda: equipos en vertical (prioridad visual) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <TeamLine team={m.a} score={m.done ? m.sa : null} />
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SUB, letterSpacing: 0.5, margin: '3px 0 3px 30px' }}>VS</div>
        <TeamLine team={m.b} score={m.done ? m.sb : null} />
      </div>
      {/* Derecha: info operativa compacta (venue · cancha · fecha/hora) */}
      <div style={{ flexShrink: 0, maxWidth: '40%', textAlign: 'right' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.venue}</div>
        <div style={{ fontSize: 12, color: SUB }}>Cancha {m.court}</div>
        <div style={{ fontSize: 11.5, color: SUB, whiteSpace: 'nowrap' }}>{m.day} · {m.time}</div>
      </div>
    </div>
  );
}

function PartidosMock({ matches, venueName }) {
  const enrich = matches.map(m => ({ ...m, venue: venueName }));
  const played = enrich.filter(m => m.done);
  const upcoming = enrich.filter(m => !m.done);
  return (
    <div style={CARD}>
      <div style={H}>Próximos partidos</div>
      {upcoming.length ? upcoming.map((m, i) => <MatchCard key={'u' + i} m={m} />) : <div style={{ fontSize: 12.5, color: SUB, marginTop: 6 }}>Sin partidos programados por ahora.</div>}
      <div style={{ fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 14, marginBottom: 2 }}>Partidos jugados</div>
      {played.length ? played.map((m, i) => <MatchCard key={'p' + i} m={m} />) : <div style={{ fontSize: 12.5, color: SUB, marginTop: 6 }}>Todavía no se ha jugado ningún partido.</div>}
    </div>
  );
}
