import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { TEXT, SUB, HAIR, WHATSAPP_NUMBER, WHATSAPP_DISPLAY, SUPPORT_EMAIL } from '../constants';

const EmailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="20" height="16" rx="3" stroke={SUB} strokeWidth="1.6"/>
    <path d="M2 7l10 7 10-7" stroke={SUB} strokeWidth="1.6" strokeLinejoin="round"/>
  </svg>
);

export function SupportMenu({ onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 46, right: 0, zIndex: 41,
        background: '#fff', borderRadius: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16)', border: `1px solid ${HAIR}`,
        minWidth: 252, padding: '6px 0', overflow: 'hidden',
      }}>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
          <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 24, color: '#25D366', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{WHATSAPP_DISPLAY}</div>
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
