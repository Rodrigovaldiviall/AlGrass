// Primitivas presentacionales del checkout, compartidas por Partidos (ConfirmReservation)
// y Campeonatos (ChampionshipCheckout). Extraídas VERBATIM desde ConfirmReservation para
// reutilizar exactamente el mismo lenguaje visual sin duplicar estilos. Puras (sin Supabase).
import { useState } from 'react';
import { TEXT, SUB, HAIR, ORANGE } from '../../constants';

export function CtaButton({ onPress, disabled, children }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onPress}
      disabled={!!disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: '100%', height: 54, borderRadius: 18,
        background: disabled ? '#E8E8EC' : ORANGE,
        color: disabled ? '#9A9AA0' : '#1B1B1F',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
        boxShadow: disabled ? 'none' : (pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)'),
        transform: !disabled && pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'transform .12s ease, box-shadow .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
      }}>
      {children}
    </button>
  );
}

export function TopBar({ title, onCancel, rightNode }) {
  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
      paddingBottom: 8, paddingLeft: 16, paddingRight: 16, background: '#fff',
    }}>
      <div style={{ height: 36, display: 'flex', alignItems: 'center', position: 'relative' }}>
        <button
          onClick={onCancel}
          style={{ padding: '6px 4px 6px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: TEXT, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          Cancelar
        </button>
        <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>{title}</span>
        </div>
        {rightNode && <div style={{ marginLeft: 'auto' }}>{rightNode}</div>}
      </div>
    </div>
  );
}

export function MethodRow({ active, onSelect, accentColor, icon, label, children, reverseExpand = false, rowRef }) {
  const contentBlock = active && children ? (
    <div style={{
      padding: '4px 14px 14px',
      ...(reverseExpand ? { borderBottom: `1px solid ${HAIR}` } : { borderTop: `1px solid ${HAIR}` }),
    }}>
      {children}
    </div>
  ) : null;
  return (
    <div style={{ marginBottom: 10, borderRadius: 14, border: `1.5px solid ${active ? accentColor : HAIR}` }}>
      {reverseExpand && contentBlock}
      <button
        ref={rowRef}
        onClick={onSelect}
        style={{ width: '100%', height: 52, padding: '0 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit' }}>
        {icon}
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: -0.1, textAlign: 'left' }}>{label}</span>
        <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${active ? accentColor : '#C7C7CC'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor }} />}
        </div>
      </button>
      {!reverseExpand && contentBlock}
    </div>
  );
}
