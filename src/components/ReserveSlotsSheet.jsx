import { useState, useEffect, useRef } from 'react';
import { useSheetPull } from '../hooks/useSheetPull';
import { shareOrCopy } from '../utils/share';
import { TEXT, SUB, HAIR, SOFT, DANGER, ORANGE, BLUE } from '../constants';

// ============================================================================
// ReserveSlotsSheet — UX "Reserva de cupos" (extraída de GameDetail, modelo V6).
// ============================================================================
// Componente PRESENTACIONAL + stepper. Recibe los datos ya resueltos por el
// backend V6 (get_slot_reservation) y delega el guardado en onAccept (que el
// padre conecta a reserve_slots). NO contiene lógica de negocio: la validación
// definitiva de capacidad vive en reserve_slots().
//
// Props:
//   inscritos        — reserved_slots_used (fijo, del backend).
//   reservedInitial  — reserved_slots_total confirmado por el backend.
//   publicAvailable  — cupos públicos disponibles (pool, del backend; no se recalcula).
//   shareLink        — link real de la reserva (para copiar/compartir).
//   onAccept(total)  — Promise<boolean>: éxito → cerrar; fallo → alerta + restaurar.
//   onClose()        — cierre.
//
// Stepper V6:
//   −  baja de uno en uno hasta 0 (puede quedar por debajo de `inscritos`).
//   +  sube de uno en uno; se deshabilita cuando (reservados − inscritos) >= publicAvailable
//      (evita seleccionar valores que reserve_slots rechazaría). La validación final es del backend.
// ============================================================================
export default function ReserveSlotsSheet({ inscritos = 0, reservedInitial = 0, publicAvailable = 0, poolPublico = 0, shareLink = '', releaseHours = 48, onAccept, onConfirmed, onClose }) {
  const [open, setOpen] = useState(false);
  const [reservados, setReservados] = useState(reservedInitial);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [errorExpired, setErrorExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }
  const { rootRef, dragY, dragging } = useSheetPull({ onClose: dismiss });

  // Cambios pendientes mientras el contador difiera del valor confirmado por el backend.
  const dirty = reservados !== reservedInitial;

  async function handleAccept() {
    if (saving) return;                       // anti-doble-envío
    // Snapshot ANTES del await: onAccept refetchea slotRes y muta las props
    // (reservedInitial), lo que falsearía el cálculo si se leyera después.
    const cur     = Math.max(reservedInitial - inscritos, 0);
    const next    = Math.max(reservados - inscritos, 0);
    const total   = reservados;
    const created = reservedInitial === 0;    // 0 → >0 = nueva reserva (no modificación)
    setSaving(true); setError(false); setErrorExpired(false);
    const ok = await onAccept?.(total);       // → reserve_slots (fuente de verdad V6)
    setSaving(false);
    // onAccept devuelve: true (ok) | 'expired' (SLOT_RESERVATION_EXPIRED) | false (otro error).
    if (ok !== true) { failReservation(ok === 'expired'); return; }
    onConfirmed?.({ generatedNew: next > cur, total, remaining: next, created });
    dismiss();
  }
  function failReservation(expired = false) {
    setReservados(reservedInitial); // restaurar al último valor confirmado
    setError(true);                 // mostrar el recuadro de alerta
    setErrorExpired(expired);       // expirada → mensaje específico; si no, el de capacidad
  }

  function flashCopied() { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  function copyLink() { navigator.clipboard?.writeText(shareLink).then(flashCopied).catch(() => {}); }
  function shareLinkAction() { shareOrCopy({ url: shareLink, title: 'AlGrass', onCopied: flashCopied }); }

  // Reglas del stepper V6 (deshabilitado también mientras se guarda).
  const decDisabled = reservados <= 0 || saving;
  const incDisabled = (reservados - inscritos) >= publicAvailable || saving;
  function dec() { if (decDisabled) return; setError(false); setReservados(r => (r > 0 ? r - 1 : r)); }
  function inc() { if (incDisabled) return; setError(false); setReservados(r => r + 1); }

  // "Y cupos disponibles" del indicador visual (max(total - inscritos, 0)).
  const disponibles = Math.max(reservados - inscritos, 0);

  // Resalte breve del contador "cupos disponibles" cada vez que su valor cambia,
  // para guiar la vista al usar + / −. Solo efecto visual; no toca ningún cálculo.
  const [dispFlash, setDispFlash] = useState(false);
  const prevDispRef = useRef(disponibles);
  useEffect(() => {
    if (prevDispRef.current === disponibles) return;
    prevDispRef.current = disponibles;
    setDispFlash(true);
    const t = setTimeout(() => setDispFlash(false), 400);
    return () => clearTimeout(t);
  }, [disponibles]);

  // Previsualización visual de la disponibilidad pública si se guardara el total actual.
  // NO consulta ni escribe: es puro cálculo local. Al cerrar sin guardar el componente
  // se desmonta y reabre con poolPublico real; al fallar reserve_slots (GAME_FULL) se
  // restaura reservados=reservedInitial → el texto vuelve al valor real.
  const poolPreview = Math.max(poolPublico - (reservados - reservedInitial), 0);

  // Derivados de la barra (previsualización del total elegido).
  const scaleMax  = Math.max(reservados, inscritos, 1);
  const boxPct    = (reservados / scaleMax) * 100;                          // capacidad reservada (rectángulo hueco)
  const solidPct  = (Math.min(inscritos, reservados) / scaleMax) * 100;     // inscritos cubiertos por los cupos (azul sólido)
  const excessPct = (Math.max(inscritos - reservados, 0) / scaleMax) * 100; // inscritos que exceden los cupos (azul rayado)

  const stepBtn = (onClick, disabled, plus) => (
    <button onClick={onClick} disabled={disabled}
      style={{ width: 32, height: 32, borderRadius: '50%', border: `1.6px solid ${disabled ? '#D6D6DC' : BLUE}`, background: 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, opacity: disabled ? 0.5 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d={plus ? 'M8 4v8M4 8h8' : 'M4 8h8'} stroke={disabled ? '#9A9AA0' : BLUE} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    </button>
  );

  return (
    <div className="sheet-overlay" onClick={() => { if (!saving) dismiss(); }} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" ref={rootRef} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? `translateY(${dragY}px)` : 'translateY(100%)', transition: dragging ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, textAlign: 'center', letterSpacing: -0.2 }}>
            Reserva de cupos
          </div>
          <button className="pressable" onClick={shareLinkAction} aria-label="Compartir" style={{ position: 'absolute', top: '50%', right: 6, transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', background: SOFT, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v11M12 3L8 7M12 3l4 4" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 11v8a1 1 0 001 1h10a1 1 0 001-1v-8" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Mensaje fijo — siempre visible, no cambia al aumentar/disminuir cupos.
            Reutiliza el lenguaje visual de las alertas de la app (recuadro con fondo tenue). */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, padding: '10px 12px', borderRadius: 12, background: SOFT, border: `1px solid ${HAIR}` }}>
          <span style={{ fontSize: 15, lineHeight: 1.3, flexShrink: 0 }}>🔒</span>
          <div style={{ flex: 1, fontSize: 12.5, color: TEXT, fontWeight: 600, lineHeight: 1.45 }}>
            Exclusivos para tu grupo hasta {releaseHours}h antes del partido, incluso si alguien cancela. Compártelo.
          </div>
        </div>

        {/* Inscritos / Disponibles */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ fontSize: 15, color: TEXT }}><b style={{ fontWeight: 700 }}>{inscritos}</b> amigos inscritos</div>
          <div style={{ fontSize: 15, color: dispFlash ? BLUE : TEXT, transform: dispFlash ? 'scale(1.12)' : 'scale(1)', transformOrigin: 'right center', transition: 'color 0.2s ease, transform 0.2s ease' }}><b style={{ fontWeight: 700 }}>{disponibles}</b> cupos disponibles</div>
        </div>

        {/* Barra */}
        <div style={{ position: 'relative', height: 30, marginBottom: 20 }}>
          {reservados === 0 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 4, transform: 'translateY(-50%)', background: HAIR, borderRadius: 2 }} />
          ) : (
            <>
              {/* Relleno azul SÓLIDO: inscritos cubiertos por los cupos (dentro del rectángulo). */}
              <div style={{ position: 'absolute', left: 0, top: 2, height: 26, width: `${solidPct}%`, background: BLUE, borderRadius: 6 }} />
              {/* Excedente RAYADO: inscritos que exceden los cupos (a la derecha del rectángulo). */}
              {excessPct > 0 && (
                <div style={{ position: 'absolute', left: `${boxPct}%`, top: 2, height: 26, width: `${excessPct}%`,
                  background: `repeating-linear-gradient(45deg, ${BLUE} 0, ${BLUE} 5px, ${BLUE}59 5px, ${BLUE}59 10px)`,
                  borderTopRightRadius: 6, borderBottomRightRadius: 6 }} />
              )}
              {/* Rectángulo HUECO (solo borde): capacidad de cupos reservados. Encima, enmarca el relleno. */}
              <div style={{ position: 'absolute', left: 0, top: 0, height: 30, width: `${boxPct}%`, border: '1.5px solid #1B1B1F', borderRadius: 7, boxSizing: 'border-box' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: 30, width: `${boxPct}%`, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT }}>{inscritos}/{reservados}</span>
              </div>
            </>
          )}
        </div>

        {/* Stepper — centrado, con la etiqueta debajo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
            {stepBtn(dec, decDisabled, false)}
            <span style={{ minWidth: 22, textAlign: 'center', fontSize: 16, fontWeight: 700, color: TEXT }}>{reservados}</span>
            {stepBtn(inc, incDisabled, true)}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Cupos reservados</div>
        </div>

        {/* Cupos públicos disponibles (valor del backend; la UI no lo recalcula) */}
        <div style={{ fontSize: 13, color: SUB, textAlign: 'center' }}>
          Solo quedan {poolPreview} cupos públicos disponibles
        </div>

        {/* Link para compartir — fila completa táctil; toca cualquier parte para copiar */}
        <div className="pressable" onClick={copyLink} style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, background: SOFT, border: `1px solid ${HAIR}`, borderRadius: 12, padding: '11px 14px', cursor: 'pointer' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shareLink}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <rect x="9" y="9" width="11" height="11" rx="2" stroke={SUB} strokeWidth="1.7"/>
            <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" stroke={SUB} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Recuadro de alerta de validación (mismo lenguaje visual de error de la app) */}
        {error && (
          <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-start', background: '#FCEAEB', border: `1px solid ${DANGER}33`, borderRadius: 14, padding: '12px 14px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" stroke={DANGER} strokeWidth="1.8"/>
              <path d="M15 9l-6 6M9 9l6 6" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: DANGER, letterSpacing: -0.1 }}>{errorExpired ? 'No se logró realizar la reserva.' : 'No se logró actualizar la reserva.'}</div>
              <div style={{ fontSize: 13, color: TEXT, marginTop: 3, lineHeight: 1.4 }}>
                {errorExpired
                  ? `No es posible realizar reservas antes de ${releaseHours} horas antes del partido.`
                  : 'Ya no existen suficientes cupos públicos disponibles. Inténtalo nuevamente.'}
              </div>
            </div>
          </div>
        )}

        {/* Aceptar: única acción que guarda (vía onAccept → reserve_slots). Visible siempre;
            deshabilitado mientras no haya cambios. */}
        <button onClick={(dirty && !saving) ? handleAccept : undefined} disabled={!dirty || saving}
          style={{ marginTop: 16, width: '100%', height: 46, borderRadius: 14, background: dirty ? ORANGE : SOFT, color: dirty ? '#1B1B1F' : '#9A9AA0', border: 'none', cursor: (dirty && !saving) ? 'pointer' : 'default', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', letterSpacing: -0.1, WebkitTapHighlightColor: 'transparent', outline: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {saving && <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(27,27,31,0.2)', borderTop: '2.5px solid #1B1B1F', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
          {saving ? 'Guardando…' : 'Aceptar'}
        </button>
      </div>
      {copied && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          ¡Link copiado!
        </div>
      )}
    </div>
  );
}
