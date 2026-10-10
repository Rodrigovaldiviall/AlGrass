import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { useState, useEffect } from 'react';
import { TEXT, SUB, HAIR, SUPPORT_EMAIL } from '../constants';
import { fetchSupportPhone } from '../services/organizerContact';

const EmailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="20" height="16" rx="3" stroke={SUB} strokeWidth="1.6"/>
    <path d="M2 7l10 7 10-7" stroke={SUB} strokeWidth="1.6" strokeLinejoin="round"/>
  </svg>
);

export function SupportMenu({ onClose }) {
  // Teléfono de soporte = app_settings.algrass_operational_phone (null mientras carga / si no se puede leer).
  const [phone, setPhone] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchSupportPhone().then(p => { if (alive) setPhone(p); });
    return () => { alive = false; };
  }, []);
  const display = phone ? `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`.trim() : '';
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 46, right: 0, zIndex: 41,
        background: '#fff', borderRadius: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16)', border: `1px solid ${HAIR}`,
        minWidth: 252, padding: '6px 0', overflow: 'hidden',
      }}>
        <a href={phone ? `https://wa.me/${phone}` : undefined} target="_blank" rel="noreferrer" onClick={phone ? onClose : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none', opacity: phone ? 1 : 0.5 }}>
          <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 24, color: '#25D366', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{display || '\u00A0'}</div>
          </div>
        </a>
        <div style={{ height: 1, background: HAIR, margin: '0 16px' }} />
        <a href={`mailto:${SUPPORT_EMAIL}`} onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
          <EmailIcon />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>Email</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{SUPPORT_EMAIL}</div>
          </div>
        </a>
      </div>
    </>
  );
}
