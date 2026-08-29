// Config/estado del acceso privado TEMPORAL (hasta el lanzamiento), compartido
// por PrivateAccessGate (el gate) y App (homepage pública "/"). Vive en un módulo
// aparte para no romper el fast-refresh del componente del gate.
export const PRIVATE_MODE = true;

export const PRIVATE_ACCESS_KEY = 'algr_private_access';

// Desbloqueo persistido por origen (algrass.com y admin.algrass.com son
// independientes). Es el mecanismo actual de acceso privado; NO es la lógica
// localStorage de "ya conoce AlGrass".
export function hasPrivateAccess() {
  try { return localStorage.getItem(PRIVATE_ACCESS_KEY) === 'true'; } catch { return false; }
}
