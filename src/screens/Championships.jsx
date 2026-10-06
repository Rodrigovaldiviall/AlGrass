import { useRef, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, ORANGE, RED } from '../constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';   // antena "En vivo" (mismo icono que Profile/Games)
import TabBar from '../components/TabBar';
import ChampConfirmOverlay from '../components/ChampConfirmOverlay';
import { listPublicChampionships } from '../services/championshipService';
import { getActiveCity, setActiveCity, fetchCities } from '../utils/profileData';
import { useAuth } from '../context/AuthContext';
import { formatDateLabel } from '../utils/format';
import { coverColor } from '../data/championshipCover';
import { getChampionshipCoverUrl } from '../utils/championshipCoverImage';
import { supabase } from '../lib/supabase';

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
  // Label de fase (el texto NO cambia entre PRE-LIVE y LIVE: ambos "Calendario y resultados").
  // LIVE se distingue SOLO por la antena. completed sale del circuito activo → "Finalizado".
  const phaseLabel = c.status === 'open' ? 'Inscripciones abiertas'
    : c.status === 'closed' ? 'Equipos confirmados'
    : c.status === 'completed' ? 'Finalizado'
    : 'Calendario y resultados';   // in_progress (pre-live y live)

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
        // El estado NO altera el color/tema visual de la card (solo pill/candado/superficie). Sin opacidad por estado.
        WebkitTapHighlightColor: 'transparent',
      }}>
      {/* Portada. Regla: PÚBLICO + foto de portada → imagen de fondo (cover/center); resto → holder por color
          (fallback intacto). El color sigue como fondo base (se ve si la imagen no cargara). */}
      <div style={{ position: 'relative', height: 96, background: coverColor(c.coverTheme), overflow: 'hidden' }}>
        {c.visibility === 'public' && c.coverImagePath && (
          // <img> absoluta: ancho = 100% del holder (todo el ancho de la foto visible, sin recorte izq/der), alto
          // auto y centrado vertical → el único recorte es arriba/abajo (holder con overflow:hidden). Sin cover,
          // sin scale, sin object-fit. El coverColor del holder queda de fallback debajo.
          <img src={getChampionshipCoverUrl(supabase, c.coverImagePath, { width: 1200, quality: 82 })} alt=""
            style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '100%', height: 'auto', maxWidth: 'none', display: 'block', pointerEvents: 'none' }} />
        )}
        {/* Overlay para legibilidad. Con foto se suaviza (empieza más abajo + menos opacidad) para conservar luz/color;
            sin foto (holder por color) se mantiene el degradado original. Pill y nombre siguen legibles. */}
        <div style={{ position: 'absolute', inset: 0, background: (c.visibility === 'public' && c.coverImagePath) ? 'linear-gradient(to bottom, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)' : 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)' }} />
        {/* Pill de estado + (activos) subtítulo inmediatamente debajo */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <div style={{
            padding: '4px 10px', borderRadius: 999,
            background: isOpen ? BLUE : '#1B1B1F', color: '#fff',
            fontSize: 12.5, fontWeight: 700, letterSpacing: 0.2,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {/* LIVE: solo se añade la antena; el texto de fase NO cambia. */}
            {c.live && <FontAwesomeIcon icon={faTowerBroadcast} style={{ color: RED, fontSize: 12 }} />}
            {phaseLabel}
          </div>
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

// Skeleton de card (datos DESCONOCIDOS, champs === null). Aproxima la estructura de ChampionshipCard
// (portada 96px + 2 líneas de metadata) para no generar layout shift al llegar las cards. Reutiliza el
// mismo pulse/gris (#E8E8EC) que SkeletonRows/SkeletonPill del proyecto.
function ChampionshipCardSkeleton() {
  const S = { background: '#E8E8EC', borderRadius: 6 };
  return (
    <div aria-hidden="true" style={{ width: '100%', marginBottom: 12, background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', animation: 'pulse 1.4s ease-in-out infinite' }}>
      <div style={{ height: 96, background: '#E8E8EC' }} />
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ ...S, width: '52%', height: 13, marginBottom: 8 }} />
        <div style={{ ...S, width: '70%', height: 12 }} />
      </div>
    </div>
  );
}

export default function Championships() {
  const navigate = useNavigate();
  const location = useLocation();
  // Ciudad ACTIVA = MISMA fuente que Partidos/Rentals (getActiveCity → localStorage pichanga_profile.city).
  // Reactiva: se re-lee al volver a la pantalla (focus/visibility) para reflejar un cambio de ciudad sin remount.
  // user.city (AuthContext) = ciudad persistida (users.city) ya resuelta desde Supabase al hidratar sesión.
  // Se usa SOLO como recuperación cuando falta el cache local; nunca para pisar una ciudad válida de localStorage.
  const { user } = useAuth();
  // Prioridad: getActiveCity() (localStorage, ciudad activa inmediata y fresca ante cambios en sesión) →
  // user?.city (recuperación del perfil logueado si el cache se perdió). NO se elige cities[0] ni se carga sin ciudad.
  const [userCity, setUserCity] = useState(() => getActiveCity() || user?.city || '');
  const [cityReady, setCityReady] = useState(false);   // ciudad efectiva resuelta (incluye fallback cities[0])
  useEffect(() => {
    // Reacciona a user?.city en deps: si al montar userCity era '' y user.city llega async (AuthContext),
    // este effect re-corre y actualiza userCity → el effect [userCity] dispara la carga de esa ciudad.
    const sync = () => setUserCity(prev => prev || getActiveCity() || user?.city || '');
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, [user?.city]);
  // MISMO fallback que Partidos/Canchas: si no hay ciudad persistida/usuario, usar cities[0] (lista de venues) y
  // persistirla en localStorage (fuente común). Garantiza una ciudad efectiva SIN selector visible y SIN depender
  // del perfil. cityReady evita el flash de "sin ciudad" mientras resuelve. Updater funcional: no pisa una ciudad
  // ya activa/persistida.
  useEffect(() => {
    let alive = true;
    fetchCities().then(cities => {
      if (!alive) return;
      setUserCity(prev => {
        if (prev) return prev;
        const persisted = getActiveCity() || user?.city || '';
        if (persisted) return persisted;
        if (Array.isArray(cities) && cities.length > 0) { setActiveCity(cities[0]); return cities[0]; }  // default alfabético (solo localStorage)
        return prev;
      });
      setCityReady(true);
    }).catch(() => { if (alive) setCityReady(true); });
    return () => { alive = false; };
  }, []); // eslint-disable-line

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
  // ── INSTRUMENTACIÓN TEMPORAL (solo DEV) — diagnóstico de carga infinita en /championships. Prefijo
  //    [CHAMP_LIST]. NO cambia comportamiento (el catch solo loguea, no toca estado). QUITAR tras confirmar. ──
  const DBG = import.meta.env.DEV;
  const clog = (...a) => { if (DBG) console.log('[CHAMP_LIST]', ...a); };
  const listDbgRef = useRef(null);
  clog('component render', { userCity: userCity || null, champs: champs === null ? 'null' : (Array.isArray(champs) ? champs.length : String(champs)), loadError });
  useEffect(() => { clog('mounted'); return () => clog('unmounted'); }, []); // eslint-disable-line
  const loadChampionships = () => {
    clog('load effect start', { userCity: userCity || null });
    // Auth hidratando (user aún sin city): NO marcar vacío; se mantiene en carga y se reintenta cuando city llega.
    if (!userCity) { clog('early return: no userCity'); return; }
    setLoadError(false);
    clog('list_public start', { userCity });
    listPublicChampionships(userCity).then(({ data, error }) => {
      if (error) { clog('list_public error', { error: error?.message || error || null }); console.warn('[championships] list_public_championships error:', error.message || error, error); setLoadError(true); setChamps([]); clog('list_public settle'); return; }
      clog('list_public success', { count: (data || []).length }); setChamps(data || []); clog('list_public settle');
    }).catch((e) => { clog('list_public error (reject)', { message: String(e?.message || e) }); setLoadError(true); setChamps([]); });   // reject → error UI, nunca champs=null eterno
  };
  // Refetch cuando la ciudad del perfil se hidrata o cambia (null → "Arequipa" → "Lima").
  useEffect(() => { loadChampionships(); }, [userCity]); // eslint-disable-line

  // Card desde campos REALES. venue/formato/equipos se derivan de format_config (mismo mapeo que Profile;
  // venue_id sin FK → sin join). teamsLabel = rango/estimación contratada (no inscripciones reales, aún mock).
  const cards = (champs || []).map(row => {
    const fc = row.format_config || {};
    const sum = fc.summary || {};
    const le = sum.leagueEstimate;
    // Capacidad AUTORITATIVA (team_capacity de la RPC) como respaldo cuando falta summary.group (campeonatos Admin).
    const cap = Number.isFinite(row.team_capacity) ? row.team_capacity : null;
    const teamsLabel = sum.mode === 'liga'
      ? (le?.quantity ? `${le.quantity} ${le.type === 'people' ? 'personas' : 'equipos'}` : 'Liga')
      : (sum.group ? (sum.group.min === sum.group.max ? `${sum.group.min} equipos` : `${sum.group.min}–${sum.group.max} equipos`)
         : (cap ? `${cap} equipos` : ''));
    const dateKey = row.event_date || fc.organizeState?.dateKey || null;
    // Rango REAL del fixture (Fase 39): first_date/last_date derivados de championship_matches. Multi-día →
    // "PRIMERA a ÚLTIMA" (solo extremos); un día o sin fixture → formato actual con event_date. Misma regla que el detalle.
    const first = row.first_date || null, last = row.last_date || null;
    const dateLabel = (first && last && first !== last)
      ? `${formatDateLabel(first).replace(/^(Hoy|Mañana),\s*/, '')} a ${formatDateLabel(last).replace(/^(Hoy|Mañana),\s*/, '')}`
      : (dateKey ? formatDateLabel(dateKey) : '');
    return {
      id: row.id,
      name: row.name || 'Campeonato',
      teamsLabel,
      format: sum.formatLabel || (sum.mode === 'liga' ? 'Liga' : ''),
      // Fase funcional para el pill (label real por estado; ya no binario open/results).
      status: row.status === 'registration_open' ? 'open'
            : row.status === 'registration_closed' ? 'closed'
            : row.status === 'completed' ? 'completed'
            : 'in_progress',   // in_progress (pre-live y live), diferenciado por `live`
      // EN VIVO (Fase 21): in_progress + live_started_at != null. Tolerante a columna ausente/undefined → false.
      live: row.status === 'in_progress' && row.live_started_at != null,
      visibility: row.privacy === 'private' ? 'private' : 'public',
      resultsPublic: row.results_public !== false,
      daysAgo: null,
      coverTheme: row.cover_theme || '#E24A4A',   // mismo default que la vista/Profile (COVER_THEMES[0]) — evita azul incoherente
      coverImagePath: row.cover_image_path ?? null,   // foto de portada (solo pública); null = holder por color (fallback)
      dateLabel,
      venueName: sum.venueName || row.venue_name || '',
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

  if (DBG && champs === null) {
    const snap = `${userCity || '∅'}|${loadError}`;
    if (listDbgRef.current !== snap) {
      listDbgRef.current = snap;
      console.log('[CHAMP_LIST] loading reason'
        + '\n  champs=null (skeleton)'
        + '\n  userCity=' + (userCity || '(vacío → early return, nunca carga)')
        + '\n  loadError=' + loadError);
    }
  }
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
          {!userCity && !cityReady ? (
            // Ciudad aún resolviéndose (fallback cities[0] async) → skeleton, NO empty state (evita flash falso).
            <>
              <SectionLabel>Activos</SectionLabel>
              {Array.from({ length: 3 }, (_, i) => <ChampionshipCardSkeleton key={i} />)}
            </>
          ) : !userCity ? (
            // Caso excepcional: resuelto y aún sin ciudad (no hay venues con ciudad). Copy NEUTRAL (no "ve a tu perfil").
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Aún no hay campeonatos disponibles</div>
              <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5 }}>Vuelve a intentarlo más tarde.</div>
            </div>
          ) : champs === null ? (
            // Datos desconocidos → skeleton con la misma estructura que las cards (evita layout shift).
            <>
              <SectionLabel>Activos</SectionLabel>
              {Array.from({ length: 3 }, (_, i) => <ChampionshipCardSkeleton key={i} />)}
            </>
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
