// Detalle OPERATIVO de un partido de campeonato: enfrentamiento simétrico (escudo arriba + nombre abajo),
// datos (venue/cancha/fecha/rango horario/duración), marcador editable y goleadores por jugador (steppers).
// UI: estado LOCAL mientras se edita; Guardar/Cancelar. El padre pasa canEdit, rosters, goles existentes y
// onSave (que llama save_championship_match_result). Marcador y goles NO tienen que cuadrar (info adicional).
import { useState, useMemo } from 'react';
import { TEXT, SUB, HAIR, SOFT, BLUE } from '../../constants';
import Shield from './Shield';
import RosterAvatar from './RosterAvatar';

function TeamHead({ team, align, designOf }) {
  const items = align === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: items, gap: 6 }}>
      {team ? <Shield color={team.color || '#5B6470'} design={designOf ? designOf(team.design) : team.design} name={team.name} size={56} /> : <Shield dashed size={56} />}
      <div style={{ fontSize: 13, fontWeight: 700, color: team ? TEXT : '#B0B0B8', textAlign: align, lineHeight: 1.25, width: '100%', wordBreak: 'break-word' }}>{team?.name || 'Por definir'}</div>
    </div>
  );
}

function Stepper({ value, onDec, onInc, disabled }) {
  const b = { width: 26, height: 26, borderRadius: 8, border: `1px solid ${HAIR}`, background: '#fff', cursor: disabled ? 'default' : 'pointer', fontSize: 16, fontWeight: 800, color: disabled ? '#C7C7CC' : TEXT, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button onClick={disabled ? undefined : onDec} disabled={disabled} className={disabled ? undefined : 'pressable'} style={b}>−</button>
      <span style={{ minWidth: 14, textAlign: 'center', fontSize: 14, fontWeight: 800, color: TEXT }}>{value}</span>
      <button onClick={disabled ? undefined : onInc} disabled={disabled} className={disabled ? undefined : 'pressable'} style={b}>+</button>
    </span>
  );
}

// player rows: name pegado al lado exterior; stepper hacia el CENTRO. side = 'left' | 'right'.
function RosterCol({ players, side, goalsMap, setGoal, canEdit }) {
  const outer = side === 'left' ? 'flex-start' : 'flex-end';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {players.length === 0 && <div style={{ fontSize: 12, color: SUB, textAlign: side }}>Sin jugadores.</div>}
      {players.map(p => {
        const g = goalsMap[p.user_id] || 0;
        const name = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <RosterAvatar path={p.avatar_path} hue={p.avatar_hue} name={p.full_name || 'Jugador'} size={24} />
            <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Jugador'}</span>
          </span>
        );
        const ctrl = canEdit
          ? <Stepper value={g} onDec={() => setGoal(p.user_id, Math.max(0, g - 1))} onInc={() => setGoal(p.user_id, g + 1)} />
          : <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: g > 0 ? BLUE : '#C7C7CC', minWidth: 16, textAlign: 'center' }}>{g}</span>;
        return (
          <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexDirection: side === 'left' ? 'row' : 'row-reverse' }}>
            <div style={{ minWidth: 0, flex: 1, display: 'flex', justifyContent: outer, overflow: 'hidden' }}>{name}</div>
            {ctrl}
          </div>
        );
      })}
    </div>
  );
}

export default function MatchDetailModal({
  match, home, away, homeRoster = [], awayRoster = [], existingGoals = [],
  venue, court, dateLabel, timeRange, durationMin, canEdit = false, busy = false, designOf, onClose, onSave,
}) {
  // Estado local del marcador (string para permitir vacío) y de los goles por jugador.
  const [hs, setHs] = useState(match?.home_score != null ? String(match.home_score) : '');
  const [as, setAs] = useState(match?.away_score != null ? String(match.away_score) : '');
  const [goalsMap, setGoalsMap] = useState(() => {
    const m = {};
    (existingGoals || []).forEach(x => { if (x.player_user_id) m[x.player_user_id] = x.goals || 0; });
    return m;
  });
  const teamOf = useMemo(() => {
    const m = {};
    homeRoster.forEach(p => { m[p.user_id] = home?.id; });
    awayRoster.forEach(p => { m[p.user_id] = away?.id; });
    return m;
  }, [homeRoster, awayRoster, home, away]);

  if (!match) return null;
  const bothTeams = !!home && !!away;
  const setGoal = (uid, v) => setGoalsMap(prev => ({ ...prev, [uid]: v }));
  const clampInt = (s) => { if (s === '' || s == null) return null; const n = parseInt(s, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const scoreText = (a, b) => (a != null && b != null) ? `${a} - ${b}` : 'VS';

  function handleSave() {
    let h = clampInt(hs), a = clampInt(as);
    if ((h === null) !== (a === null)) { h = h ?? 0; a = a ?? 0; }   // uno lleno y otro vacío → 0 el vacío
    const goals = Object.entries(goalsMap)
      .map(([user_id, goals]) => ({ user_id, team_id: teamOf[user_id], goals }))
      .filter(x => x.team_id && x.goals > 0);
    onSave({ homeScore: h, awayScore: a, goals });
  }

  return (
    <div className="sheet-overlay" onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 12px calc(16px + env(safe-area-inset-bottom))' }}>
      <div className="sheet-panel no-sb" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 20, padding: 16, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
        {/* Enfrentamiento simétrico: escudo arriba + nombre abajo; centro VS o marcador. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <TeamHead team={home} align="left" designOf={designOf} />
          <div style={{ flexShrink: 0, minWidth: 84, paddingTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {canEdit && bothTeams ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input inputMode="numeric" value={hs} onChange={e => setHs(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} style={{ width: 34, height: 38, textAlign: 'center', fontSize: 18, fontWeight: 800, color: TEXT, border: `1px solid ${HAIR}`, borderRadius: 10, outline: 'none', fontFamily: 'inherit' }} />
                <span style={{ fontSize: 18, fontWeight: 800, color: SUB }}>-</span>
                <input inputMode="numeric" value={as} onChange={e => setAs(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} style={{ width: 34, height: 38, textAlign: 'center', fontSize: 18, fontWeight: 800, color: TEXT, border: `1px solid ${HAIR}`, borderRadius: 10, outline: 'none', fontFamily: 'inherit' }} />
              </div>
            ) : (
              <div style={{ fontSize: 22, fontWeight: 800, color: TEXT }}>{scoreText(match.home_score, match.away_score)}</div>
            )}
          </div>
          <TeamHead team={away} align="right" designOf={designOf} />
        </div>

        {/* Datos del partido */}
        <div style={{ marginTop: 14, padding: '10px 12px', background: SOFT, borderRadius: 12, fontSize: 12.5, color: TEXT, lineHeight: 1.7 }}>
          <div><span style={{ color: SUB }}>Sede:</span> {venue || 'Por definir'}</div>
          <div><span style={{ color: SUB }}>Cancha:</span> {court || 'Por definir'}</div>
          <div><span style={{ color: SUB }}>Fecha:</span> {dateLabel || 'Por definir'}</div>
          <div><span style={{ color: SUB }}>Hora:</span> {timeRange || 'Por definir'}{durationMin ? ` · ${durationMin} min` : ''}</div>
        </div>

        {/* Roster en dos columnas (local izquierda / visitante derecha) con goles al centro */}
        <div style={{ marginTop: 14, display: 'flex', gap: 12 }}>
          <RosterCol players={homeRoster} side="left" goalsMap={goalsMap} setGoal={setGoal} canEdit={canEdit && bothTeams} />
          <div style={{ width: 1, background: HAIR, flexShrink: 0 }} />
          <RosterCol players={awayRoster} side="right" goalsMap={goalsMap} setGoal={setGoal} canEdit={canEdit && bothTeams} />
        </div>

        {canEdit && !bothTeams && (
          <div style={{ marginTop: 12, fontSize: 12, color: SUB, textAlign: 'center' }}>Aún no hay ambos equipos asignados; no se puede cargar resultado.</div>
        )}

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {canEdit ? (
            <>
              <button onClick={() => onClose()} disabled={busy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cancelar</button>
              <button onClick={busy ? undefined : handleSave} disabled={busy || !bothTeams} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: (busy || !bothTeams) ? '#E8E8EC' : BLUE, color: (busy || !bothTeams) ? '#9A9AA0' : '#fff', cursor: (busy || !bothTeams) ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, outline: 'none' }}>{busy ? 'Guardando…' : 'Guardar'}</button>
            </>
          ) : (
            <button onClick={() => onClose()} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: SOFT, color: TEXT, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cerrar</button>
          )}
        </div>
      </div>
    </div>
  );
}
