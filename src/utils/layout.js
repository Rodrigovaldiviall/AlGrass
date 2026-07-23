// getVisibleBottom() — coordenada Y (px) donde termina el área de contenido visible.
//
// En móvil es el borde superior de la .tab-bar; en desktop la .tab-bar existe en el
// DOM pero está display:none (index.css), y un elemento display:none devuelve un
// getBoundingClientRect() todo en 0. Por eso NO basta comprobar que el elemento
// exista: hay que comprobar que sea REALMENTE visible.
//
// Criterio robusto: rect.height > 0 (un elemento display:none tiene height 0).
// Si la tab-bar no está visible, se usa window.innerHeight → mismo comportamiento
// en móvil (tab-bar visible) y desktop (sin tab-bar).
export function getVisibleBottom() {
  const rect = document.querySelector('.tab-bar')?.getBoundingClientRect();
  return rect && rect.height > 0 ? rect.top : window.innerHeight;
}
