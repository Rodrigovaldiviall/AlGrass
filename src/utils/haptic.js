export function haptic() {
  try { navigator.vibrate?.(8); } catch {}
}
