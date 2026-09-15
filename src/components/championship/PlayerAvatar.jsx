import { hashColor, initials } from '../../data/championshipTeamsMock';

// Avatar circular con iniciales, color por hash del nombre (.md §18).
export default function PlayerAvatar({ name, size = 36 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: hashColor(name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 700,
    }}>{initials(name)}</div>
  );
}
