// ── ChampionshipIntro — pantalla informativa DESKTOP previa a "Crear campeonato" ──
// Fuente de verdad visual/contenido: docs/championship-intro/index.html (textos, estructura,
// SVGs, tamaños, colores y orden EXACTOS). El <header class="barra"> del HTML se OMITE: la app
// ya tiene navegación global (Sidebar). "Empezar" entra al paso de FORMATO existente
// (/championships/organize) con state.fromIntro → organize arranca en 'form' (sin doble intro).
// Solo-desktop: la media query mobile del HTML no se implementa aquí.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmExitDialog from '../components/ConfirmExitDialog';
import './ChampionshipIntro.css';
import img01 from '../assets/championship-intro/01-app.webp';
import img02 from '../assets/championship-intro/02-arbitro.webp';
import img03 from '../assets/championship-intro/03-organizador.webp';
import img04 from '../assets/championship-intro/04-celebracion.webp';

export default function ChampionshipIntro() {
  const navigate = useNavigate();
  const [confirmExit, setConfirmExit] = useState(false);   // X = salir del flujo → confirmación
  const empezar = () => navigate('/championships/organize', { state: { fromIntro: true } });

  return (
    <div className="champ-intro">
      <main className="pantalla">
        <button type="button" className="salir" aria-label="Salir" onClick={() => setConfirmExit(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div className="contenido">

          <section className="intro">
            <div className="intro__texto">
              <p className="antetitulo">Campeonatos de fútbol</p>
              <h1>Organiza tu campeonato con AlGrass. <span>Despreocúpate y juega.</span></h1>
            </div>
            <p className="bajada">
              <strong>Todo en un solo lugar.</strong> Olvídate de cotizar canchas, conseguir árbitros y buscar quién se haga cargo. Nosotros nos encargamos de todo, para que lo vivas como un campeonato profesional.
            </p>
          </section>

          <section className="tira" aria-label="Cómo se vive un campeonato AlGrass">
            <img src={img01} width="1200" height="600" loading="lazy" alt="Dos personas siguen la tabla de posiciones del campeonato desde el celular." />
            <img src={img02} width="1200" height="600" loading="lazy" alt="Un árbitro señala una falta durante un partido en cancha de grass." />
            <img src={img03} width="1200" height="600" loading="lazy" alt="El organizador mira tranquilo el partido desde su escritorio." />
            <img src={img04} width="1200" height="600" loading="lazy" alt="El equipo campeón levanta el trofeo con las medallas puestas." />
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

              <div className="tarjeta kit">
                <div className="tarjeta__titulo">Llevamos el partido listo</div>
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

              <div className="duo">
                <div className="tarjeta">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.4"></circle><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"></path><path d="M17 5.2a3.4 3.4 0 0 1 0 5.6"></path><path d="M19 13.8c1.6 1.2 2.5 3.1 2.5 5.2"></path></svg>
                  <div className="tarjeta__titulo">Inscripciones</div>
                  <p>Tus jugadores se inscriben solos: crean sus equipos y se suman con un link. Tú no persigues a nadie ni armas listas.</p>
                </div>

                <div className="tarjeta">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18"></path><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M8 14.5h3"></path><path d="M14 14.5h2"></path></svg>
                  <div className="tarjeta__titulo">Calendario y resultados</div>
                  <p>Fixture con fechas y horas, resultados, tabla y goleadores. Lo siguen todos los jugadores y quien tú invites.</p>
                </div>
              </div>
            </div>

          </section>

          <div className="cta">
            <button type="button" className="boton" onClick={empezar}>Empezar</button>
          </div>

        </div>
      </main>
      {confirmExit && (
        <ConfirmExitDialog onCancel={() => setConfirmExit(false)} onConfirm={() => navigate('/championships')} />
      )}
    </div>
  );
}
