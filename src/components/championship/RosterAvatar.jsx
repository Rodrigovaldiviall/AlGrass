import { supabase } from '../../lib/supabase';
import { getAvatarUrl } from '../../utils/avatar';

// Avatar de fila del roster: foto real (avatar_path) o fallback hue+iniciales — MISMA lógica que PlayerModal.
// Compartido por ChampionshipView (Inscripciones) y ChampionshipTeam. loading/decoding perezosos para que un
// roster largo no descargue de golpe imágenes fuera del viewport.
export default function RosterAvatar({ path, hue, name, size = 34 }) {
  const h = hue ?? ([...(name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
  if (path) return <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}><img src={getAvatarUrl(supabase, path)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
  const ini = (name || '·').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·';
  return <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${h} 35% 92%)`, color: `hsl(${h} 45% 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.4), fontWeight: 700, flexShrink: 0 }}>{ini}</div>;
}
