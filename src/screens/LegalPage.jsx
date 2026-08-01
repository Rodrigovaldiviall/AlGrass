import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB } from '../constants';
import I from '../icons';

// Página legal (Política de Privacidad / Términos del Servicio). Una sola pantalla
// parametrizada por `type`; sirve TANTO a la app (enlace desde los modales de Configuración)
// COMO a la web pública (https://algrass.com/privacy, /terms) — el rewrite SPA de Vercel
// entrega index.html y React Router renderiza esta misma ruta.
// Contenido legal: placeholder por ahora (se rellenará después).
export default function LegalPage({ type }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isTerms = type === 'terms';
  const title = isTerms ? 'Términos del Servicio' : 'Política de Privacidad';

  // Desde la app hubo navegación SPA (key ≠ 'default') → volver atrás (a Configuración).
  // Abierta directamente desde la web pública (carga inicial, key 'default') → volver a la home.
  const goBack = () => { if (location.key !== 'default') navigate(-1); else navigate('/'); };

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={goBack}
          aria-label="Regresar"
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          {I.back('#fff')}
        </button>
        <span style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{title}</span>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px 40px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT, letterSpacing: -0.5, margin: '0 0 14px' }}>{title}</h1>
        <p style={{ fontSize: 14.5, color: SUB, lineHeight: 1.65, margin: 0 }}>
          El contenido completo de {isTerms ? 'los Términos del Servicio' : 'la Política de Privacidad'} se
          añadirá aquí próximamente.
        </p>
      </div>
    </div>
  );
}
