// Selector de equipo para asignar/cambiar un lado (home|away) de un partido de la LLAVE. Presentacional: el
// padre controla la selección (selectedId/onSelect) y el guardado (onSave). Muestra los equipos del campeonato
// con escudo + nombre + abreviatura (getTeamAbbreviation). Excluye el equipo del OTRO lado del mismo match
// (excludeTeamId) para no permitir el mismo equipo en ambos lados. NO agrega al tocar: primero seleccionar,
// luego Guardar (mismo patrón que "Agregar jugador").
import { TEXT, SUB, HAIR, BLUE, DANGER } from '../../constants';
import Shield, { getTeamAbbreviation } from './Shield';

export default function TeamPickerSheet({
  open, title = 'Selecciona un equipo', teams = [], excludeTeamId = null, selectedId = null,
  busy = false, error = '', designOf, conflicts = {}, onSelect, onCancel, onSave,
}) {
  if (!open) return null;
  const list = (teams || []).filter(t => t && t.id && t.id !== excludeTeamId);
  const selConflict = selectedId ? conflicts[selectedId] : null;   // no se puede guardar un equipo en conflicto
  return (
    <div className="sheet-overlay" onClick={busy ? undefined : onCancel} style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', padding: '0 12px calc(16px + env(safe-area-inset-bottom))' }}>
      <div className="sheet-panel no-sb" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, padding: 18, boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, letterSpacing: -0.2 }}>{title}</div>
        <div className="no-sb" style={{ flex: 1, minHeight: 80, maxHeight: '52vh', overflowY: 'auto', marginTop: 12 }}>
          {list.length === 0 ? (
            <div style={{ fontSize: 13, color: SUB, padding: '10px 2px' }}>No hay equipos disponibles.</div>
          ) : list.map(t => {
            const conflict = conflicts[t.id] || null;   // "HH:MM–HH:MM" del partido solapado, si lo hay
            const sel = selectedId === t.id;
            const design = designOf ? designOf(t.design) : t.design;
            // Equipo ocupado: VISIBLE pero deshabilitado (no seleccionable), con el motivo. No se oculta.
            return (
              <button key={t.id} onClick={conflict ? undefined : () => onSelect(t.id)} disabled={!!conflict} className={conflict ? undefined : 'pressable'} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '8px 8px', borderRadius: 12, border: sel ? `1.5px solid ${BLUE}` : '1.5px solid transparent', background: sel ? '#EAF1FD' : 'transparent', cursor: conflict ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: conflict ? 0.55 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <Shield color={t.color || '#5B6470'} design={design} name={t.name} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name || 'Equipo'}</div>
                  {conflict
                    ? <div style={{ fontSize: 12, color: DANGER, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>No disponible · juega {conflict}</div>
                    : <div style={{ fontSize: 12, color: SUB }}>{getTeamAbbreviation(t.name)}</div>}
                </div>
                {sel && !conflict && <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}><path d="M3.5 9.5l3.5 3.5 7-8" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            );
          })}
        </div>
        {error && <div style={{ fontSize: 12.5, color: DANGER, lineHeight: 1.4, marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={busy ? undefined : onCancel} disabled={busy} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: `1.5px solid ${HAIR}`, background: '#fff', color: TEXT, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, outline: 'none' }}>Cancelar</button>
          <button onClick={(!selectedId || busy || selConflict) ? undefined : onSave} disabled={!selectedId || busy || !!selConflict} className="pressable" style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', background: (!selectedId || busy || selConflict) ? '#E8E8EC' : BLUE, color: (!selectedId || busy || selConflict) ? '#9A9AA0' : '#fff', cursor: (!selectedId || busy || selConflict) ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, outline: 'none' }}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
