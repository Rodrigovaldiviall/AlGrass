// Constructor único del link de un partido. Sin sharedByUserId devuelve el link
// de siempre; con sharedByUserId anexa ?ref=<id> (quién comparte). El referral
// AÚN NO se consume al abrir el link — solo cambia la URL generada.
export function buildGameShareUrl(gameId, { sharedByUserId } = {}) {
  const base = `${window.location.origin}/game/${gameId}`;
  return sharedByUserId != null ? `${base}?ref=${sharedByUserId}` : base;
}

export function shareOrCopy({ url, title = 'Pichanga', text = '', onCopied }) {
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => { onCopied?.(); }).catch(() => {});
  }
}
