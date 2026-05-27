import { useState } from 'react';
import { TEXT, SUB, HAIR, ORANGE, SOFT } from '../constants';
import { saveRating } from '../services/ratingService';
import { useAuth } from '../context/AuthContext';

function StarIcon({ filled, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <path
        d="M15 3l3.09 7.26L26 11.27l-5.5 5.36 1.3 7.57L15 20.5l-6.8 3.7 1.3-7.57L4 11.27l7.91-1.01L15 3z"
        fill={filled ? '#F5A524' : 'none'}
        stroke={filled ? '#F5A524' : '#C7C7CC'}
        strokeWidth="1.6" strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RatingBlock({ gameId, existingRating, gameType, hostUserId }) {
  const { user } = useAuth();
  const [stars,   setStars]   = useState(existingRating?.stars   ?? 0);
  const [comment, setComment] = useState(existingRating?.comment ?? '');
  const [hovered, setHovered] = useState(0);
  const [saved,   setSaved]   = useState(false);

  const preRated = !!existingRating;
  const frozen   = preRated || saved;
  const active   = hovered || stars;

  async function handleSave() {
    const cleanComment = comment.trim() || null;
    await saveRating({
      userId:      user?.id ?? null,
      gameType:    gameType ?? 'match',
      gameId,
      hostUserId:  hostUserId ?? null,
      stars,
      comment:     cleanComment,
    });
    setComment(cleanComment ?? '');
    setSaved(true);
  }

  const displayComment = (comment ?? '').trim() || null;

  return (
    <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 12, letterSpacing: -0.1 }}>
        {preRated ? 'Tu calificación' : '¿Cómo estuvo?'}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n}
            onPointerEnter={() => !frozen && setHovered(n)}
            onPointerLeave={() => !frozen && setHovered(0)}
            onClick={() => !frozen && setStars(n)}
            style={{
              background: 'none', border: 'none',
              cursor: frozen ? 'default' : 'pointer',
              padding: 2, WebkitTapHighlightColor: 'transparent', outline: 'none',
              transform: !frozen && active >= n ? 'scale(1.12)' : 'scale(1)',
              transition: 'transform .1s ease',
            }}>
            <StarIcon filled={n <= (frozen ? stars : active)} />
          </button>
        ))}
      </div>

      {frozen ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: displayComment ? TEXT : SUB, fontStyle: displayComment ? 'normal' : 'italic' }}>
          {displayComment ?? 'Sin comentarios'}
        </div>
      ) : (
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Cuéntanos más. (Opcional)"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            border: `1px solid ${HAIR}`, borderRadius: 12,
            padding: '10px 12px', resize: 'none',
            fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5,
            outline: 'none', background: SOFT, color: TEXT,
          }}
        />
      )}

      {!frozen && stars > 0 && (
        <button
          onClick={handleSave}
          style={{
            marginTop: 10, width: '100%', height: 46, borderRadius: 14,
            background: ORANGE, color: '#1B1B1F',
            border: 'none', cursor: 'pointer',
            fontSize: 15, fontWeight: 700, fontFamily: 'inherit', letterSpacing: -0.1,
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          Guardar
        </button>
      )}
    </div>
  );
}
