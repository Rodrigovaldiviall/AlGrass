// Action sheet de GESTIÓN de un jugador (Owner/Host/AlGrass), COMPARTIDO por ChampionshipView (roster general)
// y ChampionshipTeam (roster del equipo). UI pura: el padre pasa los handlers y hace el refresh (loadRegState/
// loadRState) y la llamada a manage_championship_player. No decide permisos (el padre solo lo monta si procede).
//
// Toda acción pide CONFIRMACIÓN ("¿Estás seguro?") antes de ejecutarse: mover, dejar sin equipo y quitar son
// cambios de inscripción que no deben dispararse en un solo tap.
import { useState } from 'react';
import { TEXT, SUB, HAIR, SOFT, RED } from '../../constants';
import Shield from './Shield';

// props:
//  player   { user_id, name, team_id }  — jugador objetivo (team_id null = sin equipo)
//  teams    [{ id, name, color, design }]  — equipos del campeonato (para "Mover a")
//  designOf (id) => designObject  — resolutor de diseño de la pantalla que lo monta
//  busy     boolean  — deshabilita acciones mientras hay una mutación en curso
//  onMove(teamId) / onNoTeam() / onRemove() / onClose()
export default function PlayerActionSheet({ player, teams = [], designOf, busy = false, onMove, onNoTeam, onRemove, onClose }) {
  // pending = { text, danger, run } → confirmación de la acción elegida (2º paso). El reset al cambiar de
  // jugador lo garantiza el `key={player.user_id}` que ponen los padres (remonta el componente).
  const [pending, setPending] = useState(null);
  if (!player) return null;

  const name = player.name || 'Jugador';
  const others = teams.filter(t => t.id !== player.team_id);
  const btn = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 46, borderRadius: 12, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, WebkitTapHighlightColor: 'transparent', outline: 'none', opacity: busy ? 0.7 : 1 };

  return (
    <div className="sheet-overlay" onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: 16, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
        {pending ? (
          /* ── 2º paso: CONFIRMACIÓN de la acción elegida ── */
          <>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>¿Estás seguro?</div>
            <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5, marginTop: 8, marginBottom: 16 }}>{pending.text}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPending(null)} disabled={busy} className="pressable" style={{ ...btn, flex: 1, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT }}>Cancelar</button>
              <button onClick={() => pending.run()} disabled={busy} className="pressable" style={{ ...btn, flex: 1, border: pending.danger ? '1px solid #F3C0C0' : 'none', background: pending.danger ? '#fff' : TEXT, color: pending.danger ? RED : '#fff' }}>Confirmar</button>
            </div>
          </>
        ) : (
          /* ── 1er paso: elegir acción ── */
          <>
            <div style={{ fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.2, marginBottom: 2 }}>{name}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginBottom: 12 }}>Gestionar inscripción</div>
            {others.map(t => (
              <button key={t.id} onClick={() => setPending({ text: `Vas a mover a ${name} a ${t.name}.`, run: () => onMove(t.id) })} disabled={busy} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', marginBottom: 8, borderRadius: 12, border: `1px solid ${HAIR}`, background: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, color: TEXT, textAlign: 'left', opacity: busy ? 0.7 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <Shield color={t.color || '#5B6470'} design={designOf ? designOf(t.design) : t.design} name="" size={22} />
                Mover a {t.name}
              </button>
            ))}
            {player.team_id && (
              <button onClick={() => setPending({ text: `Vas a dejar a ${name} sin equipo.`, run: () => onNoTeam() })} disabled={busy} className="pressable" style={{ ...btn, border: `1px solid ${HAIR}`, background: '#fff', color: TEXT, marginBottom: 8 }}>Dejar sin equipo</button>
            )}
            <button onClick={() => setPending({ text: `Vas a quitar a ${name} del campeonato. Perderá su inscripción.`, danger: true, run: () => onRemove() })} disabled={busy} className="pressable" style={{ ...btn, border: '1px solid #F3C0C0', background: '#fff', color: RED, marginBottom: 8 }}>Quitar del campeonato</button>
            <button onClick={() => onClose()} disabled={busy} className="pressable" style={{ ...btn, border: 'none', background: SOFT, color: TEXT, marginTop: 4 }}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}
