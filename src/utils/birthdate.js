import { peruTodayParts } from '../lib/peruTime';

// Validación de edad 18+ anclada al día calendario de Lima. Fuente compartida por
// "Editar perfil" y la solicitud de Capitán para NO duplicar la regla. La fecha de
// nacimiento más reciente seleccionable es hoy(Lima) − 18 años.
export function maxBirthParts() {
  const t = peruTodayParts();
  return { year: t.year - 18, month: t.month, day: t.day };
}

// Años seleccionables: desde el límite hacia atrás (sin años que impliquen < 18).
export function birthYears(max, from = 1940) {
  return Array.from({ length: max.year - (from - 1) }, (_, i) => max.year - i);
}

// Meses disponibles según el año: en el año límite solo hasta el mes límite.
export function birthMonthsCount(year, max) {
  return year === max.year ? max.month : 12;
}

// Días disponibles: respeta bisiestos/30-31 y, en año+mes límite, hasta el día límite.
export function birthDaysCount(year, month, max) {
  if (!month) return 31;
  return Math.min(
    new Date(year, month, 0).getDate(),
    (year === max.year && month === max.month) ? max.day : 31,
  );
}

// Baja el día si la nueva combinación año/mes lo dejó inválido (31→abril, 29/02→no bisiesto, límite).
export function clampBirthDay(year, month, day, max) {
  if (!day || !month) return day;
  const maxD = birthDaysCount(year, month, max);
  return day > maxD ? maxD : day;
}

// En el año límite, no permite meses posteriores al mes límite.
export function clampBirthMonth(year, month, max) {
  return (year === max.year && month && month > max.month) ? max.month : month;
}

// ¿La fecha corresponde a un menor de 18 (posterior al límite)? Guardia defensiva.
export function isUnderage(year, month, day, max) {
  if (!year || !month || !day) return false;
  return year > max.year
    || (year === max.year && month > max.month)
    || (year === max.year && month === max.month && day > max.day);
}
