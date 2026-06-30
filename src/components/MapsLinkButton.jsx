import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import { TEXT, SUB, HAIR, BLUE } from '../constants';
import { googleMapsUrl } from '../utils/maps';
import logo from '../assets/logo.webp';

// Icono de enlace externo + menú de acciones (mismo estilo/animación que "Comunícate con el organizador").
// Única opción: Google Maps. Tap fuera → cierra sin acción.
export default function MapsLinkButton({ lat = null, lng = null, address = '', down = false }) {
  const [open, setOpen]   = useState(false);
  const [hover, setHover] = useState(false);
  const url = googleMapsUrl({ lat, lng, address });
  return (
    <div style={{ position: 'relative', flexShrink: 0, marginRight: 24 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label="Abrir en mapas"
        style={{ width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
        <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ fontSize: 17, color: hover ? BLUE : SUB, transition: 'color .15s ease' }} />
      </button>
      {open && (
        <>
          <div onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', right: 0, ...(down ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }), zIndex: 100, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: `1px solid ${HAIR}`, overflow: 'hidden', minWidth: 168 }}>
            <a href={url} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '13px 16px', textDecoration: 'none' }}>
              <img src={logo} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Google Maps</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}
