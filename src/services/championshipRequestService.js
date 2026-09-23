import { supabase } from '../lib/supabase';

// ── Solicitud de campeonato → public.championship_requests ──────────────────
// Un lead comercial: alguien quiere organizar un campeonato y no completó el
// flujo normal de creación y pago. NO crea ningún campeonato, no reserva canchas
// y no cotiza nada; AlGrass la gestiona a mano desde el Back Office.
//
// La tabla solo concede INSERT a `authenticated`, y su policy exige
// user_id = auth.uid() + status 'pending' + los campos de gestión vacíos. Es
// decir: esta función no PUEDE crear una solicitud ya contactada ni con notas
// internas aunque se lo pidieran. Eso lo impone la base, no este archivo.

// El formulario entrega sus campos en camelCase; la tabla los guarda con los
// nombres reales de sus columnas. La traducción vive aquí y en ningún otro sitio.
function toRow(userId, fields) {
  const estimate = fields.participantEstimate || {};

  return {
    user_id: userId,

    contact_name: fields.contactName,
    email: fields.email,
    phone_country_code: fields.phoneCountryCode || null,
    contact_phone: fields.contactPhone || null,
    company: fields.company || null,
    job_title: fields.jobTitle || null,
    message: fields.message || null,

    championship_name: fields.championshipName || null,
    city: fields.city || null,
    // El formulario deja marcar varios distritos; la columna es text[].
    districts: fields.districts && fields.districts.length ? fields.districts : null,
    format: fields.format || null,
    // "8 equipos" o "60 personas": la cifra no significa nada sin su unidad.
    participant_type: estimate.type || null,
    participant_quantity: estimate.quantity ?? null,
    // Un día suelto (torneo) o un rango (liga). El formulario manda uno u otro.
    tentative_date: fields.tentativeDate || null,
    tentative_start_date: fields.tentativeStartDate || null,
    tentative_end_date: fields.tentativeEndDate || null,
    match_duration_min: fields.matchDuration ?? null,

    // `status` NO se envia, y no es un olvido: el grant es POR COLUMNAS y
    // `status` no esta entre las concedidas, asi que nombrarlo haria fallar el
    // INSERT por permisos. La fila nace 'pending' por el DEFAULT de la columna,
    // y la policy lo vuelve a comprobar. La App no decide estados
    // administrativos porque no PUEDE, no porque se abstenga.
  };
}

// Crea la solicitud del usuario autenticado.
//
// SIN `.select()` a proposito: `authenticated` no tiene SELECT sobre la tabla
// —es lo que impide leer las notas internas—, asi que pedir la fila de vuelta
// haria fallar el INSERT entero con un error de permisos. El id no hace falta:
// quien llama solo necesita saber si se guardo.
export async function createChampionshipRequest(userId, fields) {
  if (!supabase || !userId) return { data: null, error: { message: 'invalid' } };

  const { error } = await supabase
    .from('championship_requests')
    .insert(toRow(userId, fields));

  return { data: null, error: error ?? null };
}
