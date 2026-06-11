import { useState, useRef } from 'react';
import logo from '../assets/logo.webp';
import desktopHero from '../assets/desktop-hero.webp';

const BLUE     = '#3F5FE0';
const INTRO_KEY = 'algrass_intro_seen';

const BULLETS = [
  'Encuentra partidos de fútbol cerca de ti.',
  'Únete e invita a tus amigos.',
  'Reserva en segundos, sin llamadas.',
  'Paga con Yape, tarjeta o billetera virtual.',
];

// Shared intro content — referenced by both the mobile overlay and the desktop landing
// so future edits apply to both.
const INTRO_TITLE    = 'Bienvenido a AlGrass';
const INTRO_SUBTITLE = 'La app para unirte a partidos de fútbol organizados y reservar canchas.';
const INTRO_CTA      = 'Empecemos';

// ── Minimal glow dot for bullets ──────────────────────────────────────────
function Dot() {
  return (
    <div style={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
      marginTop: 8,
      background: 'rgba(164,190,255,0.90)',
      boxShadow: '0 0 6px 2px rgba(100,140,255,0.45)',
    }} />
  );
}

// ── Onboarding overlay — appears over the frozen last frame ────────────────
function OnboardingOverlay({ onDone }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(180deg, rgba(4,8,22,0.10) 0%, rgba(4,8,22,0.30) 35%, rgba(4,8,22,0.72) 70%, rgba(4,8,22,0.90) 100%)',
      animation: 'intro-overlay-in 0.7s ease both',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: 'calc(env(safe-area-inset-top) + 52px) 28px calc(env(safe-area-inset-bottom) + 48px)',
    }}>

      {/* Content area — flex-grows to fill, centers its children */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        width: '100%', maxWidth: 360,
        paddingBottom: '18%',
      }}>
        {/* Logo */}
        <img
          src={logo}
          alt="AlGrass"
          style={{
            width: 88, height: 88, objectFit: 'contain',
            marginBottom: 18,
            animation: 'intro-logo-in 0.8s cubic-bezier(0.22,0.61,0.36,1) 0.20s both',
            filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.30))',
          }}
        />

        {/* Title */}
        <h1 style={{
          margin: '0 0 10px',
          fontSize: 33, fontWeight: 800, color: '#fff',
          letterSpacing: -1.0, lineHeight: 1.1, textAlign: 'center',
          animation: 'intro-item-in 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.35s both',
        }}>
          {INTRO_TITLE}
        </h1>

        {/* Subtitle */}
        <p style={{
          margin: '0 0 28px',
          fontSize: 14.5, lineHeight: 1.52,
          color: 'rgba(255,255,255,0.66)',
          textAlign: 'center', maxWidth: 270,
          animation: 'intro-item-in 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.52s both',
        }}>
          {INTRO_SUBTITLE}
        </p>

        {/* Bullets */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {BULLETS.map((text, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                animation: `intro-item-in 0.65s cubic-bezier(0.22,0.61,0.36,1) ${0.70 + i * 0.13}s both`,
              }}
            >
              <Dot />
              <span style={{ fontSize: 15.5, color: 'rgba(255,255,255,0.80)', lineHeight: 1.48 }}>
                {text}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA — appears last, slow and elegant */}
      <button
        onClick={onDone}
        style={{
          flexShrink: 0,
          width: '100%', maxWidth: 340,
          background: '#fff', color: BLUE,
          border: 'none', borderRadius: 999,
          padding: '17px 0',
          fontSize: 17, fontWeight: 700, letterSpacing: -0.3,
          cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 8px 40px rgba(0,0,0,0.36)',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
          animation: 'intro-item-in 0.9s cubic-bezier(0.22,0.61,0.36,1) 1.50s both',
        }}
      >
        {INTRO_CTA}
      </button>
    </div>
  );
}

// ── Desktop landing (≥1024px) — replaces the video with a two-column visual ──
// Reuses the same content (logo, INTRO_TITLE/SUBTITLE/CTA, BULLETS, Dot) as the
// mobile overlay so edits stay in sync. onStart === IntroScreen.handleDone.
function DesktopLanding({ onStart }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: "'Inter', -apple-system, 'SF Pro Text', system-ui, sans-serif" }}>
      {/* Hero stage — wrapper fits the image; capped so it never overflows top/bottom */}
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '106vw', maxHeight: '100vh' }}>
        <img
          src={desktopHero}
          alt="AlGrass"
          style={{ display: 'block', maxWidth: '106vw', maxHeight: '100vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
        />

        {/* Content overlaid on the right zone of the image, vertically centered, within bounds */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: '6%', width: '38%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
          <img src={logo} alt="AlGrass" style={{ width: 74, height: 74, objectFit: 'contain', marginBottom: 18, filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.28))' }} />
          <h1 style={{ margin: '0 0 12px', fontSize: 38, fontWeight: 700, color: '#fff', letterSpacing: -1.1, lineHeight: 1.08, textShadow: '0 2px 18px rgba(0,0,0,0.45)' }}>
            {INTRO_TITLE}
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: 15.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.95)', maxWidth: 360, textShadow: '0 1px 14px rgba(0,0,0,0.50)' }}>
            {INTRO_SUBTITLE}
          </p>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 30 }}>
            {BULLETS.map((text, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Dot />
                <span style={{ fontSize: 15, color: '#fff', lineHeight: 1.45, textShadow: '0 1px 12px rgba(0,0,0,0.50)' }}>{text}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onStart}
            style={{
              background: '#fff', color: BLUE, border: 'none', borderRadius: 999,
              padding: '14px 40px', fontSize: 16.5, fontWeight: 700, letterSpacing: -0.3,
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 10px 36px rgba(0,0,0,0.28)',
              WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}
          >
            {INTRO_CTA}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function IntroScreen({ onStart, onDone }) {
  const [phase, setPhase]     = useState('loading'); // loading | playing | ended | error | out
  const [isDesktop] = useState(() => window.innerWidth >= 1024);
  const metaRef = useRef(document.querySelector('meta[name="theme-color"]'));

  const isEnded = phase === 'ended' || phase === 'error';

  function handleDone() {
    // Restore theme-color BEFORE navigate so the /welcome→/games URL change
    // triggers Chrome to re-evaluate the meta and see the correct blue value.
    if (metaRef.current) metaRef.current.content = '#3F5FE0';
    document.documentElement.classList.add('app-ready');
    setPhase('out');
    try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
    onStart?.();                        // navigate /welcome → /games (real URL change)
    setTimeout(() => onDone(), 480);    // remove from DOM once fade is complete
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: '#000',
      opacity: phase === 'out' ? 0 : 1,
      transition: phase === 'out' ? 'opacity 0.48s ease' : 'opacity 0.4s ease',
    }}>

      {isDesktop ? (
        /* Desktop (≥1024): no video — visual landing instead */
        <DesktopLanding onStart={handleDone} />
      ) : (
        <>
          {/* Video */}
          {phase !== 'error' && (
            <video
              src="/videos/intro.mp4"
              autoPlay muted defaultMuted playsInline preload="metadata"
              onCanPlay={() => { if (phase === 'loading') setPhase('playing'); }}
              onEnded={() => setPhase('ended')}
              onError={() => setPhase('error')}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover', display: 'block',
              }}
            />
          )}

          {/* Fallback: solid blue bg when video fails to load */}
          {phase === 'error' && (
            <div style={{ position: 'absolute', inset: 0, background: BLUE }} />
          )}

          {/* Onboarding overlay + CTA */}
          {isEnded && <OnboardingOverlay onDone={handleDone} />}
        </>
      )}
    </div>
  );
}
