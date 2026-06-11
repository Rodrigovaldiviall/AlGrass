// TEMP diagnóstico de layout — medir alturas reales en PWA standalone.
// Panel fijo arriba (no tapa la zona inferior bajo medición). Tap = re-medir.
// Reversible: borrar este archivo y su import/uso en App.jsx.
import { useState, useLayoutEffect, useCallback } from 'react';

export default function DiagMeasure() {
  const [m, setM] = useState(null);

  const measure = useCallback(() => {
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const root   = document.getElementById('root')?.getBoundingClientRect();
    const shell  = rect('.screen-shell');
    const tabbar = rect('.tab-bar');
    const tabsab = rect('.tab-sab');
    const ih = window.innerHeight;
    const R = (x) => (x == null ? '—' : Math.round(x));
    const data = {
      standalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
      innerHeight: ih,
      visualVH:    window.visualViewport ? R(window.visualViewport.height) : '—',
      docClientH:  document.documentElement.clientHeight,
      bodyClientH: document.body.clientHeight,
      rootH:   R(root?.height),    rootB:   R(root?.bottom),
      shellH:  R(shell?.height),   shellB:  R(shell?.bottom),
      tabbarH: R(tabbar?.height),  tabbarB: R(tabbar?.bottom),
      tabsabH: R(tabsab?.height),  tabsabB: R(tabsab?.bottom),
      uncoveredRoot:  root   ? R(ih - root.bottom)   : '—',
      uncoveredShell: shell  ? R(ih - shell.bottom)  : '—',
      uncoveredTab:   tabsab ? R(ih - tabsab.bottom) : '—',
    };
    setM(data);
    console.log('[DIAG]', data);
  }, []);

  useLayoutEffect(() => {
    measure();
    const t1 = setTimeout(measure, 300);
    const t2 = setTimeout(measure, 1200);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [measure]);

  if (!m) return null;
  return (
    <div onClick={measure} style={{
      position: 'fixed', top: 'calc(env(safe-area-inset-top) + 4px)',
      left: 8, right: 8, zIndex: 2147483647,
      background: 'rgba(0,0,0,0.88)', color: '#0f0',
      font: '11px/1.4 monospace', padding: '8px 10px', borderRadius: 8,
      whiteSpace: 'pre-wrap', pointerEvents: 'auto',
    }}>
{`DIAG (tap=re-medir)  standalone=${m.standalone}
innerHeight = ${m.innerHeight}
visualVP.h  = ${m.visualVH}
docClientH  = ${m.docClientH}
bodyClientH = ${m.bodyClientH}
#root    h=${m.rootH}  bottom=${m.rootB}
shell    h=${m.shellH}  bottom=${m.shellB}
tab-bar  h=${m.tabbarH}  bottom=${m.tabbarB}
tab-sab  h=${m.tabsabH}  bottom=${m.tabsabB}
── descubierto (innerHeight − bottom) ──
window − #root.bottom  = ${m.uncoveredRoot}
window − shell.bottom  = ${m.uncoveredShell}
window − tabsab.bottom = ${m.uncoveredTab}`}
    </div>
  );
}
