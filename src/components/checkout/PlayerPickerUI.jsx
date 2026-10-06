// Primitivas VISUALES compartidas del checkout (Match ConfirmReservation ↔ campeonato
// público ChampionshipJoinCheckout). Capa de presentación PURA, sin lógica de games:
// Avatar (foto o iniciales) y PlayerRow (fila seleccionable del buscador). Extraídas tal
// cual de ConfirmReservation para reutilizar la MISMA UX sin duplicar JSX.
import { TEXT, SUB, ORANGE } from '../../constants';
import { getAvatarUrl } from '../../utils/avatar';
import { supabase } from '../../lib/supabase';

export function Avatar({ name, hue = 210, size = 44, avatarPath = null, avatarVersion = null }) {
  const imgSrc = avatarPath ? getAvatarUrl(supabase, avatarPath, avatarVersion) : null;
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
  if (imgSrc) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}>
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(160deg, hsl(${hue} 70% 62%), hsl(${(hue + 30) % 360} 65% 48%))`,
      color: '#fff', fontWeight: 700, fontSize: size * 0.36,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      letterSpacing: -0.2, flexShrink: 0,
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
    }}>
      {initials}
    </div>
  );
}

export function PlayerRow({ p, checked, onToggle, rostered = false }) {
  return (
    <button
      onClick={onToggle}
      style={{ width: '100%', textAlign: 'left', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
      <Avatar name={p.name} hue={p.hue} size={42} avatarPath={p.avatarPath ?? null} avatarVersion={p.avatarVersion ?? null} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, letterSpacing: -0.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{p.code}</div>
      </div>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        border: `1.6px solid ${checked ? ORANGE : '#C7C7CC'}`,
        background: checked ? ORANGE : (rostered ? '#E5E5EA' : '#fff'),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {checked && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
    </button>
  );
}
