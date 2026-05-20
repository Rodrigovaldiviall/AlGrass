import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT } from '../constants';
import I from '../icons';
import TabBar from '../components/TabBar';
import { supabase } from '../lib/supabase';
import { getVenueCoverUrl } from '../utils/venue';
import { getGameById } from '../services/gameService';

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDateEs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${_DOW[d.getDay()]} ${d.getDate()} ${_MON[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDuration(min) {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

// ── Header
function Header({ title, onBack }) {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          {I.back('#fff')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        </div>
      </div>
    </div>
  );
}

// ── Hero image
function HeroImage({ coverPath, coverVersion }) {
  const src = coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null;
  if (src) {
    return (
      <div style={{ width: '100%', aspectRatio: '16/6.3', overflow: 'hidden', flexShrink: 0 }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: '100%', aspectRatio: '16/6.3', background: SOFT,
      backgroundImage: 'repeating-linear-gradient(135deg, #E8E8EC 0 14px, #F2F2F4 14px 28px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: SUB, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12, letterSpacing: 0.4,
    }}>FOTO DEL CAMPO</div>
  );
}

// ── Info row
function InfoRow({ icon, primary, secondary }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{primary}</div>
        {secondary && <div style={{ fontSize: 13, color: SUB, marginTop: 2, lineHeight: 1.35 }}>{secondary}</div>}
      </div>
    </div>
  );
}

// ── Chip
function Chip({ label, icon }) {
  return (
    <div style={{ flex: '0 0 auto', height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, color: TEXT, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {icon ? icon(TEXT) : null}
      <span>{label}</span>
    </div>
  );
}

// ── CTA
function CTA({ price, onPress }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div style={{ padding: '12px 16px 12px', background: '#fff', borderTop: `1px solid ${HAIR}` }}>
      <button
        onClick={onPress}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        style={{
          width: '100%', height: 54, borderRadius: 18,
          background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer',
          fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)',
          transform: pressed ? 'scale(0.985)' : 'scale(1)',
          transition: 'transform .12s ease, box-shadow .15s ease',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
        {I.joinIcon('#1B1B1F')}
        <span>Reservar campo por {price}</span>
      </button>
    </div>
  );
}

// ── Screen
export default function RentalDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id }   = useParams();

  const [game, setGame]       = useState(location.state?.field ?? null);
  const [loading, setLoading] = useState(!location.state?.field);

  useEffect(() => {
    if (game) return;
    getGameById(id).then(g => { setGame(g); setLoading(false); });
  }, [id]); // eslint-disable-line

  if (loading) {
    return <div className="screen-shell" style={{ background: '#F2F2F4' }} />;
  }

  if (!game) {
    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#F2F2F4' }}>
        <Header title="Cancha" onBack={() => navigate('/fields')} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, fontSize: 15 }}>
          Cancha no encontrada
        </div>
        <TabBar />
      </div>
    );
  }

  const title        = game.fieldName || game.field || 'Cancha';
  const date         = formatDateEs(game.dateKey);
  const timeStr      = game.time && game.ampm ? `${game.time} ${game.ampm}` : '';
  const duration     = formatDuration(game.durationMin);
  const timeRow      = [timeStr, duration].filter(Boolean).join(' · ');
  const priceNum     = game.priceTotalNum ?? 0;
  const priceDisplay = priceNum > 0 ? `S/.${priceNum.toFixed(2)}` : null;

  const chips = [
    game.format  && { label: game.format,      icon: I.twoPeople },
    game.covered && { label: 'Cubierto',        icon: I.roof      },
    game.filmed  && { label: 'Filmado',         icon: I.camera    },
    game.parking && { label: 'Estacionamiento', icon: null        },
    game.showers && { label: 'Duchas',          icon: null        },
  ].filter(Boolean);

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <Header title={title} onBack={() => navigate('/fields')} />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
        <HeroImage coverPath={game.venueCoverPath} coverVersion={game.venueCoverVersion} />

        <div style={{ padding: '12px 16px 4px' }}>
          {date && (
            <InfoRow
              icon={I.cal()}
              primary={date}
              secondary={timeRow || undefined}
            />
          )}
          <InfoRow
            icon={I.fieldIcon()}
            primary={title}
            secondary={game.address || undefined}
          />
        </div>

        {chips.length > 0 && (
          <div style={{ padding: '8px 16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {chips.map((c, i) => <Chip key={i} label={c.label} icon={c.icon} />)}
          </div>
        )}

        {priceDisplay && (
          <div style={{ padding: '14px 16px', borderTop: `1px solid ${HAIR}` }}>
            <div style={{ fontSize: 13, color: SUB, marginBottom: 4 }}>Precio total del campo</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, letterSpacing: -0.5 }}>{priceDisplay}</div>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>

      {priceDisplay && (
        <CTA
          price={priceDisplay}
          onPress={() => navigate('/checkout', { state: {
            game: {
              id:          game.id,
              type:        'rental',
              source:      'rental',
              field:       title,
              date,
              time:        timeStr,
              duration:    duration || '',
              format:      game.format || '',
              price:       priceDisplay,
              priceNumber: priceNum,
              currency:    'S/.',
              backPath:    `/rental/${game.id}`,
            },
          }})}
        />
      )}
      <TabBar />
    </div>
  );
}
