// Protege de la traducción automática (Google Translate, etc.) la marca y las abreviaturas de posición.
// Envuelve SOLO esos términos en <span translate="no" class="notranslate">; el resto del texto se sigue traduciendo.
const PROTECTED_RE = /(AlGrass|\b(?:DEL|MED|DEF|ARQ)\b)/g;

export default function NoTranslate({ text }) {
  if (typeof text !== 'string' || !text) return text ?? null;
  const parts = text.split(PROTECTED_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 === 1
    ? <span key={i} translate="no" className="notranslate">{part}</span>
    : part));
}
