import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB } from '../constants';
import I from '../icons';
import InfoRow from '../components/InfoRow';
import AmenityChips from '../components/AmenityChips';
import MapsLinkButton from '../components/MapsLinkButton';
import VenueMiniMap from '../components/VenueMiniMap';

function Section({ title, children }) {
  return (
    <div style={{ padding: '6px 16px 14px' }}>
      <div style={{ fontSize: 'var(--gd-st, 16px)', fontWeight: 700, color: TEXT, letterSpacing: -0.2, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function VenueDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const v = location.state?.venue ?? null;

  const back = () => navigate(location.state?.backPath ?? -1);

  const addressText = Array.isArray(v?.address) ? v.address.filter(Boolean).join(' ') : (v?.address || '');
  const secondary = [addressText, v?.district].filter(Boolean).join(' · ') || undefined;

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      {/* Header (mismo estilo que las pantallas de detalle) */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button onClick={back} style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
            {I.back('#fff')}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v?.venueName || v?.name || 'Cancha'}</div>
          </div>
        </div>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
        {/* Bloque de info (reutiliza InfoRow + MapsLinkButton) */}
        <div style={{ padding: '12px 16px 4px' }}>
          <InfoRow
            icon={I.fieldIcon()}
            primary={v?.name}
            secondary={secondary}
            action={<MapsLinkButton lat={v?.lat} lng={v?.lng} address={v?.address} down />}
          />
        </div>

        {/* Foto panorámica (placeholder) */}
        <div style={{ padding: '6px 16px 12px' }}>
          <div style={{ width: '100%', aspectRatio: '16/7', borderRadius: 14, background: '#F2F2F4', backgroundImage: 'repeating-linear-gradient(135deg, #E8E8EC 0 14px, #F2F2F4 14px 28px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, fontSize: 12, letterSpacing: 0.3 }}>
            Foto panorámica
          </div>
        </div>

        {/* Mapa (solo venue + GPS del usuario) */}
        <div style={{ padding: '0 16px 14px' }}>
          <VenueMiniMap lat={v?.lat} lng={v?.lng} cityLabel={v?.district || ''} />
        </div>

        {/* Amenities (mismo componente) */}
        {v?.chips?.length > 0 && (
          <Section title="Características">
            <AmenityChips chips={v.chips} />
          </Section>
        )}

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}
