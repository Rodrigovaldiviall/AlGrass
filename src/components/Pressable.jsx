import { useState } from 'react';

// Feedback táctil reutilizable (pressed/active) — mismo patrón que GameRow/FieldRow:
// estado `pressed` + handlers de puntero + resaltado '#F5F7FA'. Se siente como una fila nativa.
export default function Pressable({ onPress, style, children }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
        background: pressed ? '#F5F7FA' : 'transparent',
        transition: 'background .12s ease',
        ...style,
      }}>
      {children}
    </div>
  );
}
