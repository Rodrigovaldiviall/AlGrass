import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faCommentSms } from '@fortawesome/free-solid-svg-icons';
import { TEXT, SUB, HAIR, BLUE } from '../constants';

// ── "Comunícate con el organizador" — pieza ÚNICA reutilizable ────────────────
// CTA de contacto (WhatsApp + SMS) del ORGANIZADOR de un game (GameDetail/RentalDetail).
//
// Recibe un teléfono YA RESUELTO vía `phone` (dígitos, con código de país); NO sabe
// cómo se obtuvo (host vs algrass) — la resolución vive en
// src/services/organizerContact.js (app_settings + RPC get_game_host_contact).
//
// SIN placeholder: si `phone` es null/'' o inválido, el CTA queda DESHABILITADO
// (atenuado, no abre el menú). Ya NO usa WHATSAPP_NUMBER como fallback.
//
// NO la usan FieldDetail (nivel venue) ni SupportMenu (Soporte AlGrass).

function formatPhone(d) {
  return d.length >= 11
    ? `+${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
    : `+${d}`;
}

export default function OrganizerContactButton({ phone = null }) {
  const [open, setOpen] = useState(false);
  const ph = String(phone || '').replace(/[^0-9]/g, '');   // teléfono resuelto (dígitos)
  const available = ph.length >= 8;                        // sin teléfono válido → deshabilitado
  const displayPhone = formatPhone(ph);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        className="pressable"
        disabled={!available}
        onClick={() => { if (available) setOpen(v => !v); }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: available ? 'pointer' : 'default', opacity: available ? 1 : 0.4, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none', padding: '2px 0' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: SUB }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 11, color: SUB, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>
          Comunícate con<br />el organizador
        </span>
      </button>
      {open && available && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 100, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: `1px solid ${HAIR}`, overflow: 'hidden', minWidth: 252 }}>
            <a className="pressable" href={`https://wa.me/${ph}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none', borderBottom: `1px solid ${HAIR}` }}>
              <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 22, color: '#25D366', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPhone}</div>
              </div>
            </a>
            <a className="pressable" href={`sms:+${ph}`} onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
              <FontAwesomeIcon icon={faCommentSms} style={{ fontSize: 22, color: BLUE, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>SMS</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}
