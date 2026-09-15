import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, ORANGE } from '../constants';
import TabBar from '../components/TabBar';
import { LIST_CHAMPIONSHIPS } from '../data/championshipsMock';

const SCROLL_KEY = 'ch_list_scroll'; // mismo patrón que Partidos/Canchas (sessionStorage)

// ── Iconos locales (mínimos para B1) ───────────────────────────────────────
const PlusIcon = (c = '#fff') => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 3v12M3 9h12" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const PeopleIcon = (c = SUB) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <circle cx="6" cy="5" r="2.4" stroke={c} strokeWidth="1.3" />
    <path d="M2 13c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
    <path d="M11 3.4c1.2.2 2 1.1 2 2.3s-.8 2-2 2.3M12 13c0-1.7-.7-2.9-1.8-3.4" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const LockIcon = (c = '#fff') => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="2.5" y="6" width="9" height="6.5" rx="1.4" stroke={c} strokeWidth="1.4" />
    <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

// ── Tarjeta de campeonato (local a B1; ver .md §3) ──────────────────────────
function ChampionshipCard({ c, onPress }) {
  const isOpen = c.status === 'open';
  const isPrivate = c.visibility === 'private';
  const blocked = c.status === 'results' && isPrivate && !c.resultsPublic;

  return (
    <button
      onClick={onPress}
      className="pressable"
      style={{
        display: 'block', width: '100%', padding: 0, marginBottom: 12,
        background: '#fff', border: 'none', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit',
        opacity: blocked ? 0.7 : 1, WebkitTapHighlightColor: 'transparent',
      }}>
      {/* Portada */}
      <div style={{ position: 'relative', height: 96, background: c.coverTheme }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)' }} />
        {/* Pill de estado + (activos) subtítulo inmediatamente debajo */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <div style={{
            padding: '4px 10px', borderRadius: 999,
            background: isOpen ? BLUE : '#1B1B1F', color: '#fff',
            fontSize: 12.5, fontWeight: 700, letterSpacing: 0.2,
          }}>{isOpen ? 'Inscripciones abiertas' : 'Resultados'}</div>
          {isOpen && <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', paddingLeft: 10, textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>Armar equipos o inscribirse solo</div>}
        </div>
        {/* Candado si privado */}
        {isPrivate && (
          <div style={{ position: 'absolute', top: 10, right: 10 }}>{LockIcon('#fff')}</div>
        )}
        {/* Nombre */}
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 10,
          color: '#fff', fontSize: 17, fontWeight: 800, letterSpacing: -0.3,
          textShadow: '0 1px 3px rgba(0,0,0,0.35)',
        }}>{c.name}</div>
      </div>

      {/* Metadata + subtítulo */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SUB }}>
          {PeopleIcon(SUB)}
          <span style={{ color: TEXT, fontWeight: 600 }}>{c.teams} equipos</span>
          <span style={{ color: '#D1D1D6' }}>·</span>
          <span>{c.format}</span>
          <span style={{ flex: 1 }} />
          {isOpen
            ? <span style={{ fontWeight: 600, color: isPrivate ? SUB : BLUE }}>{isPrivate ? 'Privado' : 'Público'}</span>
            : <span style={{ color: '#9A9AA0' }}>Hace {c.daysAgo} {c.daysAgo === 1 ? 'día' : 'días'}</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5, color: SUB }}>{c.dateLabel} · {c.venueName}</div>
      </div>
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: SUB, letterSpacing: 0.3, textTransform: 'uppercase', margin: '4px 2px 8px' }}>
      {children}
    </div>
  );
}

export default function Championships() {
  const navigate = useNavigate();

  // Scroll de la lista: mismo mecanismo que Partidos/Canchas.
  const listRef = useRef(null);
  const scrollPosRef = useRef(0);
  const initScrollRef = useRef(undefined);
  if (initScrollRef.current === undefined) {
    try { initScrollRef.current = Number(sessionStorage.getItem(SCROLL_KEY)) || 0; } catch { initScrollRef.current = 0; }
  }
  // Restaurar scroll al montar (volver desde otro tab u Organiza → misma posición Y).
  useEffect(() => {
    const el = listRef.current;
    if (!el || !initScrollRef.current) return;
    const y = initScrollRef.current;
    requestAnimationFrame(() => requestAnimationFrame(() => el.scrollTo({ top: y, behavior: 'instant' })));
  }, []);
  // Guardar scroll al desmontar (salir a otro tab o a Organiza).
  useEffect(() => () => { try { sessionStorage.setItem(SCROLL_KEY, String(scrollPosRef.current)); } catch {} }, []);
  // Re-tap del tab Campeonatos estando ya en /championships → subir al inicio (patrón de la App).
  useEffect(() => {
    function onTabScrollTop(e) { if (e.detail === 'campeonatos') listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }
    window.addEventListener('tab-scroll-top', onTabScrollTop);
    return () => window.removeEventListener('tab-scroll-top', onTabScrollTop);
  }, []);

  const actives = LIST_CHAMPIONSHIPS.filter(c => c.status === 'open');
  const historic = LIST_CHAMPIONSHIPS
    .filter(c => c.status === 'results' && (c.daysAgo ?? 999) <= 14)
    .sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0));

  // Preparado para abrir el campeonato en bloques posteriores (destino aún no construido).
  const openChampionship = (_c) => { /* B2+: navegar a Ver mi campeonato / modal de clave */ };

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* Header AlGrass */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Campeonatos</div>
        </div>
      </div>

      {/* Área scrollable con CTA flotante superpuesto (sin holder/footer fijo) */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* La lista scrollea por detrás del CTA; paddingBottom deja aire para la última card */}
        <div ref={listRef} onScroll={e => { scrollPosRef.current = e.currentTarget.scrollTop; }} className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 16px 88px' }}>
          {actives.length > 0 && (
            <>
              <SectionLabel>Activos</SectionLabel>
              {actives.map(c => <ChampionshipCard key={c.id} c={c} onPress={() => openChampionship(c)} />)}
            </>
          )}

          {historic.length > 0 && (
            <>
              <div style={{ height: 8 }} />
              <SectionLabel>Históricos · últimos 14 días</SectionLabel>
              {historic.map(c => <ChampionshipCard key={c.id} c={c} onPress={() => openChampionship(c)} />)}
            </>
          )}
        </div>

        {/* CTA flotante: fijo justo encima del TabBar, el contenido pasa por detrás */}
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, pointerEvents: 'none' }}>
          <button
            onClick={() => navigate('/championships/organize')}
            className="pressable"
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', height: 54,
              background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18,
              boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
              WebkitTapHighlightColor: 'transparent',
            }}>
            {PlusIcon('#1B1B1F')}
            Crear nuevo campeonato
          </button>
        </div>
      </div>

      <TabBar />
    </div>
  );
}
