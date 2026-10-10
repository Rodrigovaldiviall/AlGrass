// ── ChampionshipIntro — pantalla informativa (UNA sola) reutilizada por dos rutas de entrada:
//    · /championships/intro  (desde la app)
//    · /empresas             (entrada externa/comercial)
// Misma intro visual/CSS; la única diferencia es el ORIGEN, que se propaga al form como introSource
// para que el back del form vuelva al lugar correcto. "Empezar" → /championships/organize (form real).
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, SOFT, ORANGE, TEXT, SUB, HAIR } from '../constants';
import { getActiveCity, setActiveCity, fetchCities } from '../utils/profileData';
import { useAuth } from '../context/AuthContext';
import './ChampionshipIntroContent.css';
import cimg01 from '../assets/championship-intro/01-app.webp';
import cimg02 from '../assets/championship-intro/02-arbitro.webp';
import cimg03 from '../assets/championship-intro/03-organizador.webp';
import cimg04 from '../assets/championship-intro/04-celebracion.webp';

// Selector de ciudad MÍNIMO y LOCAL a la intro de Campeonatos (landing /empresas, primera entrada). NO extrae ni
// toca el CitySheet de Partidos. Reutiliza fetchCities/setActiveCity (misma persistencia que Partidos). No dismissible.
function CityOnboardSheet({ cities, current, onPick }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(r); }, []);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
        background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        maxHeight: '70%', display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
      }}>
        <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 12px' }} />
          <div style={{ paddingBottom: 12, borderBottom: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Elige tu ciudad</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>Verás los campeonatos disponibles en tu ciudad.</div>
          </div>
        </div>
        <div className="no-sb" style={{ overflowY: 'auto', flex: 1, padding: '4px 16px calc(16px + env(safe-area-inset-bottom))' }}>
          {cities.map(c => {
            const on = c === current;
            return (
              <button key={c} onClick={() => onPick(c)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 0',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${HAIR}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: on ? 'none' : `1.6px solid ${HAIR}`, background: on ? BLUE : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: TEXT, fontWeight: 500 }}>{c}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function ChampionshipIntro() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // Origen: en la app la X sale a /championships. En /empresas la salida está por definir → sin X (pendiente).
  const isApp = location.pathname === '/championships/intro';
  const empezar = () => navigate('/championships/organize', { state: { introSource: location.pathname } });

  // ── Primera entrada por /empresas: selector de ciudad SOBRE esta intro (solo aquí) ──
  // Depende EXCLUSIVAMENTE de la señal de navegación empresaFirstVisit (NO de !ciudad): es la excepción de la
  // primera llegada desde el Intro general. Al elegir, se persiste igual que Partidos (setActiveCity) y se limpia
  // el state (replace) → refresh/back no reabre el selector. NO marca pichanga_coach_seen (tutorial normal intacto).
  const [cityOnboard, setCityOnboard] = useState(() => location.state?.empresaFirstVisit === true);
  const [onboardCities, setOnboardCities] = useState([]);
  useEffect(() => { if (!cityOnboard) return; let alive = true; fetchCities().then(cs => { if (alive) setOnboardCities(cs); }); return () => { alive = false; }; }, [cityOnboard]);
  const pickOnboardCity = (c) => {
    setActiveCity(c, user?.id);
    setCityOnboard(false);
    navigate(location.pathname, { replace: true, state: null });   // consumir empresaFirstVisit → no reabre; queda en la intro
  };

  return (
    <div className="screen-shell championship-intro-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* X flotante SOLO en desktop (donde el header azul está oculto). Solo en contexto app. */}
      {isApp && (
        <button className="championship-intro-close" aria-label="Salir" onClick={() => navigate('/championships')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      )}
      {/* Header azul (mobile; oculto en desktop por CSS). Sin flecha atrás (se puede entrar por link directo). */}
      <div className="championship-intro-header" style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Campeonatos</div>
          {isApp && (
            <button onClick={() => navigate('/championships')} aria-label="Salir" style={{ position: 'absolute', right: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14 }}>
        <div className="champ-intro">
          <div className="ci-content">

            <section className="intro">
              <div className="intro__texto">
                <p className="antetitulo">Campeonatos de fútbol</p>
                <h1>Arma tu campeonato. <span>Confirma los equipos y vive la competencia con AlGrass.</span></h1>
              </div>
              <p className="bajada">
                <strong>Todo en un solo lugar.</strong> Olvídate de cotizar canchas, conseguir árbitros y buscar quién se haga cargo. Nosotros nos encargamos de todo.
              </p>
            </section>

            <section className="tira" aria-label="Cómo se vive un campeonato AlGrass">
              <img src={cimg01} width="1200" height="600" loading="lazy" alt="Dos personas siguen la tabla de posiciones del campeonato desde el celular." />
              <img src={cimg02} width="1200" height="600" loading="lazy" alt="Un árbitro señala una falta durante un partido en cancha de grass." />
              <img src={cimg03} width="1200" height="600" loading="lazy" alt="El organizador mira tranquilo el partido desde su escritorio." />
              <img src={cimg04} width="1200" height="600" loading="lazy" alt="El equipo campeón levanta el trofeo con las medallas puestas." />
            </section>

            <section className="paneles">

              <div className="panel-tu">
                <h2 className="rotulo">Lo que haces tú</h2>

                <div className="paso">
                  <span className="paso__num">01</span>
                  <div>
                    <div className="paso__titulo">Elige el formato</div>
                    <p>Torneo o liga, fútbol 7, 8, 11… y cantidad de equipos (personas).</p>
                  </div>
                </div>

                <div className="separador"></div>

                <div className="paso">
                  <span className="paso__num">02</span>
                  <div>
                    <div className="paso__titulo">Elige la cancha</div>
                    <p>Disponibilidad real. Reservas todas las fechas de una vez.</p>
                  </div>
                </div>

                <div className="aviso">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#B34A0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.4A8.4 8.4 0 1 1 21 11.5z"></path></svg>
                  <p>¿No encuentras lo que buscas? No te preocupes, nos pondremos en contacto contigo.</p>
                </div>
              </div>

              <div className="panel-nosotros">
                <h2 className="rotulo">Lo que hacemos nosotros</h2>

                {/* HOLDER BLANCO 1 — Experiencia (Inscripciones / Calendario como mini-cards) */}
                <div className="tarjeta kit">
                  <div className="tarjeta__titulo">Brindamos una experiencia de campeonato profesional</div>
                  <div className="kit__items kit__items--stack">
                    <div className="kit__card">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.4"></circle><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"></path><path d="M17 5.2a3.4 3.4 0 0 1 0 5.6"></path><path d="M19 13.8c1.6 1.2 2.5 3.1 2.5 5.2"></path></svg>
                      <div>
                        <div className="kit__card-title">Inscripciones</div>
                        <div className="kit__card-text">Tus jugadores se inscriben solos: crean sus equipos y se suman con un link. Tú no persigues a nadie ni armas listas.</div>
                      </div>
                    </div>
                    <div className="kit__card">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18"></path><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M8 14.5h3"></path><path d="M14 14.5h2"></path></svg>
                      <div>
                        <div className="kit__card-title">Calendario y resultados</div>
                        <div className="kit__card-text">Fixture con fechas y horas, resultados, tabla y goleadores. Lo siguen todos los jugadores y quien tú invites.</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* HOLDER BLANCO 2 — Logística */}
                <div className="tarjeta kit">
                  <div className="tarjeta__titulo">Nos encargamos de toda la logística y más</div>
                  <div className="kit__items">
                    <div className="kit__item">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5"></path></svg>
                      <span>Organizador</span>
                    </div>
                    <div className="kit__item">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4"></path><path d="M5 5h12l-2.2 4L17 13H5"></path></svg>
                      <span>Árbitros</span>
                    </div>
                    <div className="kit__item">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"></path><path d="M3 8l9 5 9-5"></path></svg>
                      <span>Chalecos y balón</span>
                    </div>
                    <div className="kit__item">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5h4l1.5-2.5h7L17 8.5h4v11H3z"></path><circle cx="12" cy="13.5" r="3.2"></circle></svg>
                      <span>Fotos</span>
                    </div>
                  </div>
                  <p className="kit__extra">Y lo que quieras sumar: trofeo, medallas, premiación.</p>
                </div>
              </div>

            </section>

          </div>
        </div>
      </div>

      <div className="championship-intro-footer" style={{ padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', background: SOFT }}>
        <button onClick={empezar} className="pressable championship-intro-cta" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54,
          background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18,
          boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>Empezar</button>
      </div>

      {/* Selector de ciudad SOLO en la primera llegada por /empresas (empresaFirstVisit). No dismissible. */}
      {cityOnboard && onboardCities.length > 0 && (
        <CityOnboardSheet cities={onboardCities} current={getActiveCity()} onPick={pickOnboardCity} />
      )}
    </div>
  );
}
