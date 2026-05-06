export function shareOrCopy({ url, title = 'Pichanga', text = '', onCopied }) {
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => { onCopied?.(); }).catch(() => {});
  }
}
