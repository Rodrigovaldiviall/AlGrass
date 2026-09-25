// Config/estado del acceso privado TEMPORAL (hasta el lanzamiento), compartido
// por PrivateAccessGate (el gate) y App (homepage pública "/"). Vive en un módulo
// aparte para no romper el fast-refresh del componente del gate.
export const PRIVATE_MODE = true;

export const PRIVATE_ACCESS_KEY = 'algr_private_access';

// Versión de autorización del gate. El desbloqueo persistido SOLO es válido si su valor coincide con esta
// versión. Al cambiar la contraseña en Supabase, SUBIR esta versión invalida todos los accesos previos (los
// usuarios vuelven a ver el gate y deben introducir la nueva clave). El valor guardado ES la versión (no se
// almacena la contraseña). '1' = accesos con la clave antigua (o el 'true' legacy) → ahora inválidos.
export const PRIVATE_ACCESS_VERSION = '2';

// Desbloqueo persistido por origen (algrass.com y admin.algrass.com son
// independientes). Es el mecanismo actual de acceso privado; NO es la lógica
// localStorage de "ya conoce AlGrass". Válido solo si la versión almacenada coincide.
export function hasPrivateAccess() {
  try { return localStorage.getItem(PRIVATE_ACCESS_KEY) === PRIVATE_ACCESS_VERSION; } catch { return false; }
}
