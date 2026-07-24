import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { detectExternalEntry, capture } from '../lib/sharedLink';

// ============================================================================
// SharedLinkBootstrap — observa la navegación y, ante una ENTRADA EXTERNA hacia
// un partido, captura el contexto del Shared Link. Nada más.
//
// No navega · no hace red · no muta estado React · no toca localStorage · no
// conoce cómo se detecta ni cómo se almacena (todo eso vive en lib/sharedLink).
// Solo pregunta "¿hay entrada externa?" y, si la hay, captura. Render null.
// ============================================================================
export default function SharedLinkBootstrap() {
  const location = useLocation();
  const firstRef = useRef(true); // primer evento de location = carga inicial de documento

  useEffect(() => {
    const isInitialLoad = firstRef.current;
    firstRef.current = false;
    const entry = detectExternalEntry(location.pathname, location.search, { isInitialLoad });
    if (entry) capture(entry);
  }, [location.pathname, location.search]);

  return null;
}
