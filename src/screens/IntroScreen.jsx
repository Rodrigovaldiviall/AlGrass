import { useState, useEffect, useRef } from 'react';
import logo from '../assets/logo.webp';

const BLUE     = '#3F5FE0';
const INTRO_KEY = 'algrass_intro_seen';

const BULLETS = [
  'Encuentra partidos de fútbol cerca de ti.',
  'Únete e invita a tus amigos.',
  'Reserva en segundos, sin llamadas.',
  'Paga con Yape, tarjeta o billetera virtual.',
];

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
          Bienvenido a AlGrass
        </h1>

        {/* Subtitle */}
        <p style={{
          margin: '0 0 28px',
          fontSize: 14.5, lineHeight: 1.52,
          color: 'rgba(255,255,255,0.66)',
          textAlign: 'center', maxWidth: 270,
          animation: 'intro-item-in 0.7s cubic-bezier(0.22,0.61,0.36,1) 0.52s both',
        }}>
          La app para unirte a partidos de fútbol organizados y reservar canchas.
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
        Empecemos
      </button>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function IntroScreen({ onStart, onDone }) {
  const [phase, setPhase]     = useState('loading'); // loading | playing | ended | error | out
  const [visible, setVisible] = useState(false);
  const metaRef = useRef(document.querySelector('meta[name="theme-color"]'));

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const isEnded = phase === 'ended' || phase === 'error';

  function handleDone() {
    // Restore theme-color BEFORE navigate so the /welcome→/games URL change
    // triggers Chrome to re-evaluate the meta and see the correct blue value.
    if (metaRef.current) metaRef.current.content = '#3F5FE0';
    setPhase('out');
    try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
    onStart?.();                        // navigate /welcome → /games (real URL change)
    setTimeout(() => onDone(), 480);    // remove from DOM once fade is complete
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: '#000',
      opacity: !visible ? 0 : phase === 'out' ? 0 : 1,
      transition: phase === 'out' ? 'opacity 0.48s ease' : 'opacity 0.4s ease',
    }}>

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
    </div>
  );
}
