import { useRef, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, ORANGE } from '../constants';
import TabBar from '../components/TabBar';
import ChampConfirmOverlay from '../components/ChampConfirmOverlay';
import { listPublicChampionships } from '../services/championshipService';
import { formatDateLabel } from '../utils/format';
import { coverColor } from '../data/championshipCover';

const SCROLL_KEY = 'ch_list_scroll'; // mismo patrón que Partidos/Canchas (sessionStorage; solo UI)

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
// highlighted/innerRef: recuadro azul transitorio tras publicar (mismo patrón que Profile/Games).
function ChampionshipCard({ c, onPress, highlighted = false, innerRef = null }) {
  const isOpen = c.status === 'open';
  const isPrivate = c.visibility === 'private';
  const blocked = c.status === 'results' && isPrivate && !c.resultsPublic;

  return (
    <button
      ref={innerRef}
      onClick={onPress}
      className={`pressable${highlighted ? ' game-row-highlighted' : ''}`}
      style={{
        display: 'block', width: '100%', padding: 0, marginBottom: 12,
        background: '#fff', border: 'none', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', cursor: 'pointer',
        textAlign: 'left', fontFamily: 'inherit',
        opacity: blocked ? 0.7 : 1, WebkitTapHighlightColor: 'transparent',
      }}>
      {/* Portada */}
      <div style={{ position: 'relative', height: 96, background: coverColor(c.coverTheme) }}>
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
          {c.teamsLabel && <><span style={{ color: TEXT, fontWeight: 600 }}>{c.teamsLabel}</span><span style={{ color: '#D1D1D6' }}>·</span></>}
          <span>{c.format}</span>
          <span style={{ flex: 1 }} />
          {(isOpen || c.daysAgo == null)
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
  const location = useLocation();

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

  // ── Listado REAL desde DB (fuente de verdad). NO usa cv.championship para las cards. ──
  //    champs: null = cargando · [] = vacío · array = datos. Refetch en refresh/reintento (no sessionStorage).
  const [champs, setChamps] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const loadChampionships = () => {
    setLoadError(false);
    listPublicChampionships().then(({ data, error }) => {
      if (error) { setLoadError(true); setChamps([]); return; }
      setChamps(data || []);
    });
  };
  useEffect(() => { loadChampionships(); }, []);

  // Card desde campos REALES. venue/formato/equipos se derivan de format_config (mismo mapeo que Profile;
  // venue_id sin FK → sin join). teamsLabel = rango/estimación contratada (no inscripciones reales, aún mock).
  const cards = (champs || []).map(row => {
    const fc = row.format_config || {};
    const sum = fc.summary || {};
    const le = sum.leagueEstimate;
    const teamsLabel = sum.mode === 'liga'
      ? (le?.quantity ? `${le.quantity} ${le.type === 'people' ? 'personas' : 'equipos'}` : 'Liga')
      : (sum.group ? (sum.group.min === sum.group.max ? `${sum.group.min} equipos` : `${sum.group.min}–${sum.group.max} equipos`) : '');
    const dateKey = row.event_date || fc.organizeState?.dateKey || null;
    return {
      id: row.id,
      name: row.name || 'Campeonato',
      teamsLabel,
      format: sum.formatLabel || (sum.mode === 'liga' ? 'Liga' : ''),
      status: row.status === 'registration_open' ? 'open' : 'results', // pill: abiertas vs Resultados
      visibility: row.privacy === 'private' ? 'private' : 'public',
      resultsPublic: row.results_public !== false,
      daysAgo: null,
      coverTheme: row.cover_theme || '#E24A4A',   // mismo default que la vista/Profile (COVER_THEMES[0]) — evita azul incoherente
      dateLabel: dateKey ? formatDateLabel(dateKey) : '',
      venueName: sum.venueName || '',
    };
  });

  // Abrir campeonato real → /championships/view/:id (UUID real). Sin cvReturn, sin reconstruir CV.
  const openChampionship = (card) => navigate('/championships/view/' + card.id, { state: { championshipOrigin: 'championships' } });

  // ── Confirmación post-publicación SOBRE el listado + highlight (patrón Profile/Games) ──
  // Estado TRANSITORIO por location.state (no se persiste en cv). Se consume y limpia → no reaparece.
  const [publishedConfirm, setPublishedConfirm] = useState(null); // id del campeonato recién publicado | null
  const [highlightedId, setHighlightedId] = useState(null);
  const highlightRef = useRef(null);
  useEffect(() => {
    const pc = location.state?.publishedChampionship;
    if (!pc) return;
    setPublishedConfirm(pc);
    navigate(location.pathname, { replace: true, state: null }); // consumir → refrescar/volver no reabre el modal
  }, [location.key]); // eslint-disable-line
  // Al pulsar Continuar: cerrar modal y señalar el campeonato recién publicado (por su id estable).
  const onPublishedContinue = () => { const id = publishedConfirm; setPublishedConfirm(null); setHighlightedId(id); };
  // Scroll SOLO si la card no está completamente visible; luego el highlight azul se desvanece (4.5s).
  useEffect(() => {
    if (!highlightedId) return;
    const el = highlightRef.current, scrollEl = listRef.current;
    if (el && scrollEl) {
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect(), c = scrollEl.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) scrollEl.scrollTo({ top: Math.max(0, scrollEl.scrollTop + (r.top - c.top) - 12), behavior: 'smooth' });
      });
    }
    const t = setTimeout(() => setHighlightedId(null), 4500);
    return () => clearTimeout(t);
  }, [highlightedId]);

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
          {champs === null ? (
            <div style={{ padding: '48px 24px', display: 'flex', justifyContent: 'center' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid #E4E4EA', borderTop: `3px solid ${BLUE}`, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : loadError ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 4 }}>No pudimos cargar los campeonatos</div>
              <button onClick={loadChampionships} className="pressable" style={{ marginTop: 12, height: 44, padding: '0 20px', borderRadius: 12, border: 'none', background: ORANGE, color: '#1B1B1F', fontFamily: 'inherit', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Reintentar</button>
            </div>
          ) : cards.length ? (
            <>
              <SectionLabel>Activos</SectionLabel>
              {cards.map(card => (
                <ChampionshipCard key={card.id} c={card} onPress={() => openChampionship(card)} highlighted={highlightedId === card.id} innerRef={highlightedId === card.id ? highlightRef : null} />
              ))}
            </>
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Aún no hay campeonatos</div>
              <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5 }}>Crea y publica tu campeonato para verlo aquí.</div>
            </div>
          )}
        </div>

        {/* CTA flotante: fijo justo encima del TabBar, el contenido pasa por detrás */}
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, pointerEvents: 'none' }}>
          <button
            onClick={() => { try { sessionStorage.removeItem('championship_organize_draft'); } catch {} navigate('/championships/intro'); }}
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

      {/* Confirmación de publicación SOBRE el listado. Detrás se ve la card recién publicada. */}
      {publishedConfirm && (
        <ChampConfirmOverlay
          title="¡Campeonato publicado!"
          lines={[
            'Tu campeonato ya está publicado.',
            'Comparte la clave con tus jugadores para que puedan empezar a inscribirse.',
          ]}
          onContinue={onPublishedContinue}
        />
      )}
    </div>
  );
}
