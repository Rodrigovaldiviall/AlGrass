// ── La plantilla del correo de bienvenida general ─────────────────────────
//
// El HTML es EL DEFINITIVO y se guarda tal cual llegó: no se ha tocado ni una
// etiqueta, ni un estilo, ni una palabra, ni un `src`.
//
// ── LAS IMÁGENES VAN POR URL, NO INCRUSTADAS ──────────────────────────
//
// Dos `src` absolutos a https://algrass.com/email-assets/. La versión anterior
// llevaba las dos imágenes incrustadas dentro del propio correo y pesaba 175 KB;
// esta pesa 12 KB. No queda ninguna incrustada, y no deben volver: incrustarlas
// engordan cada envío y empujan el correo hacia el recorte de Gmail.
//
// ── EL ÚNICO HUECO ───────────────────────────────────────────
//
// `{{nombre}}`, dentro de «Hola {{nombre}},». Lo rellena `cuerpo()` en index.ts,
// que reemplaza « {{nombre}}» CON EL ESPACIO DE DELANTE —así, sin nombre, queda
// «Hola,» y nunca el marcador a la vista—, escapa el nombre antes de insertarlo y
// usa una función de sustitución para que un `$&` en el nombre de alguien no se
// comporte como un patrón.
//
// Ese espacio delante es parte del contrato: si un HTML futuro escribiera
// «Hola{{nombre}}» sin él, el reemplazo fallaría en silencio.
//
// Lo único que se habría modificado respecto al fichero original son los tres
// caracteres que un template literal de JavaScript interpretaría: la barra
// invertida, el acento grave y la secuencia ${. En este HTML no aparece ninguno,
// así que el texto es idéntico byte a byte.
//
// Se generó desde el fichero en disco, no desde el texto del chat: ese llega con
// la codificación rota y mandaría los acentos partidos a todo el mundo.
export const PLANTILLA_BIENVENIDA = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bienvenido a AlGrass</title>
<style type="text/css">
@media only screen and (max-width:640px) {
  .wrap { padding:0 !important; }
  .card { border-radius:0 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F2F5FA;">
<div style="display:none;font-size:1px;color:#F2F5FA;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Elige un partido, paga tu cupo y solo llega a jugar.</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F5FA;">
  <tr>
    <td align="center" class="wrap" style="padding:24px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="768" class="card" style="width:768px;max-width:768px;background:#FFFFFF;border-radius:14px;overflow:hidden;">

        <tr>
          <td align="center" style="background:#104BFF;padding:22px 24px 24px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
              <tr>
                <td valign="middle" style="padding-right:9px;"><img src="https://algrass.com/email-assets/email-logo.png" width="42" height="42" alt="AlGrass" style="display:block;border:0;outline:none;width:42px;height:42px;" /></td>
                <td valign="middle" style="font-family:Helvetica,Arial,sans-serif;font-size:25px;font-weight:bold;color:#FFFFFF;letter-spacing:0.3px;">AlGrass</td>
              </tr>
            </table>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;color:#AFC4FF;letter-spacing:3px;padding:16px 0 9px 0;">BIENVENIDO</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:29px;font-weight:bold;color:#FFFFFF;line-height:1.22;white-space:nowrap;">Ya tienes cuenta. Ahora solo falta jugar.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:34px 40px 6px 40px;font-family:Helvetica,Arial,sans-serif;">
            <div style="font-size:20px;color:#101828;line-height:1.45;padding-bottom:14px;">Hola {{nombre}},</div>
            <div style="font-size:19px;color:#5B6577;line-height:1.55;">Ya est&aacute;s dentro de AlGrass. Convertimos tus ganas de jugar en una pichanga lista: t&uacute; eliges el d&iacute;a y la hora, nosotros nos encargamos del resto.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:30px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#1E6B34;letter-spacing:2px;">SIEMPRE JUEGAS</td>
        </tr>
        <tr>
          <td style="padding:16px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.5;padding:0 0 14px 0;"><strong style="color:#101828;">&iquest;Solo quieres jugar?</strong> Reserva al toque, cuando quieras.</td></tr><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.5;padding:0 0 14px 0;"><strong style="color:#101828;">&iquest;Te quedaste fuera de la lista?</strong> Siempre hay otro partido con cupo.</td></tr><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.5;padding:0 0 14px 0;"><strong style="color:#101828;">Chau a estar cobrando.</strong> Cada uno paga su cupo.</td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:6px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.5;"><strong style="color:#B82528;">&iquest;Vas con tus patas?</strong> Solicita ser capit&aacute;n desde la app: separas los cupos de tu grupo sin pagar por ellos y obtienes m&aacute;s beneficios.</td>
        </tr>

        <tr>
          <td style="padding:30px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#104BFF;letter-spacing:2px;">C&Oacute;MO FUNCIONA</td>
        </tr>
        <tr>
          <td style="padding:18px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:0 0 22px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="44" valign="top" style="width:44px;padding:2px 16px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#104BFF;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">1</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Elige tu partido</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">D&iacute;a, hora, distrito y cu&aacute;ntos cupos quedan.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 22px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="44" valign="top" style="width:44px;padding:2px 16px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#104BFF;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">2</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Revisa los detalles</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Direcci&oacute;n, cancha, formato, qui&eacute;n organiza y qui&eacute;nes ya se apuntaron.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 22px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="44" valign="top" style="width:44px;padding:2px 16px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#104BFF;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">3</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Paga tu cupo</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Yape, tarjeta, Apple Pay o Google Pay. Cada uno paga lo suyo.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 22px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="44" valign="top" style="width:44px;padding:2px 16px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#104BFF;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">4</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Solo llega y juega</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Ponemos chalecos, pelota y armamos los equipos.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:6px 0 0 0;">
            <img src="https://algrass.com/email-assets/bienvenida-partidos.png" width="1120" alt="Pantalla de partidos de AlGrass: 1. eliges tu ciudad o filtras por distrito, 2. tocas una fecha y ves los partidos de ese d&iacute;a, 3. ves los cupos disponibles en tiempo real, 4. entras al detalle para la direcci&oacute;n, qui&eacute;n organiza y qui&eacute;nes ya se apuntaron." style="display:block;border:0;outline:none;width:100%;max-width:768px;height:auto;" />
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:32px 20px 0 20px;font-family:Helvetica,Arial,sans-serif;font-size:20px;color:#5B6577;line-height:1.6;white-space:nowrap;">Estamos arrancando en Arequipa. Mira los partidos de esta semana.</td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#104BFF;border-radius:8px;">
                  <a href="https://algrass.com" style="display:inline-block;padding:15px 40px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;text-decoration:none;">Ver partidos</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:14px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:17px;color:#5B6577;line-height:1.55;">
            &iquest;Dudas? Escr&iacute;benos <a href="https://wa.me/51945763178?text=Hola%2C%20acabo%20de%20crear%20mi%20cuenta%20en%20AlGrass%20y%20tengo%20una%20consulta" style="color:#104BFF;text-decoration:none;font-weight:bold;">aqu&iacute;</a>.
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="1" style="height:1px;background:#E4E8F0;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 30px 40px;font-family:Helvetica,Arial,sans-serif;">
            <div style="font-size:18px;color:#101828;line-height:1.55;font-weight:bold;">Rodrigo Valdivia</div>
            <div style="font-size:18px;color:#5B6577;line-height:1.55;">Equipo AlGrass</div>
          </td>
        </tr>

        <tr>
          <td align="center" style="background:#101828;padding:24px 40px;font-family:Helvetica,Arial,sans-serif;">
            <div style="font-size:19px;font-weight:bold;color:#FFFFFF;letter-spacing:0.3px;">Despreoc&uacute;pate y juega.</div>
            <div style="font-size:14px;color:#8A93A6;padding-top:10px;line-height:1.5;">AlGrass Per&uacute;</div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
