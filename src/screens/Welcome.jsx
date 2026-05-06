import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB } from '../constants';
import { haptic } from '../utils/haptic';

export const WELCOME_KEY = 'pichanga_welcome_seen';

const FEATURES = [
  'Encuentra partidos de fútbol cerca de ti.',
  'Reserva canchas en minutos, sin llamadas.',
  'Únete a un partido o crea el tuyo.',
];

function Ball({ size = 80 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.305),
      background: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.6"/>
        <path d="M12 7l2.8 2v3.2L12 14.2l-2.8-2.2V9L12 7z" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round"/>
        <path d="M9.2 9L6.5 10.5M14.8 9L17.5 10.5M12 14.2V17M9.2 12.2L7.5 15M14.8 12.2L16.5 15" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function SplashView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
      <div style={{ animation: 'spin 1.8s ease-in-out forwards' }}>
        <Ball size={88} />
      </div>
      <span style={{ fontSize: 34, fontWeight: 800, color: BLUE, letterSpacing: -1.2 }}>
        Algrass
      </span>
    </div>
  );
}

function WelcomeView({ onStart }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 32px', maxWidth: 360,
      animation: 'lp-fadein 0.45s ease forwards',
    }}>
      <Ball size={68} />
      <div style={{ height: 22 }} />
      <div style={{ fontSize: 24, fontWeight: 800, color: TEXT, letterSpacing: -0.5, textAlign: 'center', lineHeight: 1.2 }}>
        Bienvenido a Algrass
      </div>
      <div style={{ height: 8 }} />
      <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
        La app para organizar y unirte a partidos de fútbol.
      </div>
      <div style={{ height: 28 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignSelf: 'stretch' }}>
        {FEATURES.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: BLUE, marginTop: 5, flexShrink: 0 }} />
            <span style={{ fontSize: 14.5, color: TEXT, lineHeight: 1.45 }}>{f}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 38 }} />
      <button
        onClick={onStart}
        style={{
          width: '100%', padding: '15px', borderRadius: 16, border: 'none',
          background: BLUE, color: '#fff', fontSize: 16, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
        Empezar
      </button>
    </div>
  );
}

export default function Welcome() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('splash');

  useEffect(() => {
    const t = setTimeout(() => setPhase('welcome'), 2000);
    return () => clearTimeout(t);
  }, []);

  function handleStart() {
    haptic();
    navigate('/games', { replace: true, state: { showCitySheet: true } });
  }

  return (
    <div className="screen-shell" style={{
      background: '#fff', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {phase === 'splash'
        ? <SplashView />
        : <WelcomeView onStart={handleStart} />
      }
    </div>
  );
}
