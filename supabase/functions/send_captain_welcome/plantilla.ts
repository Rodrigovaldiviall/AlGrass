// ── La plantilla del correo de bienvenida de Capitán ──────────────────────
//
// El HTML es EL DEFINITIVO y se guarda tal cual llegó: no se ha tocado ni una
// etiqueta, ni un estilo, ni una palabra, ni un `alt`.
//
// Lo único que se cambió respecto al fichero aprobado son los DOS `src`, a los
// assets que ya se probaron en escritorio y en móvil:
//
//   logo.png                → email-logo.png
//   capitanes-tutorial.jpg  → capitanes-tutorial.png
//
// ── LAS IMÁGENES VAN POR URL, NO INCRUSTADAS ──────────────────────────
//
// Dos `src` absolutos a https://algrass.com/email-assets/. La versión anterior
// llevaba las imágenes incrustadas dentro del propio correo y pesaba 175 KB;
// esta pesa 15 KB. No queda ninguna incrustada, y no deben volver: incrustarlas
// engordan cada envío y empujan el correo hacia el recorte de Gmail, que empieza
// a los 102 KB.
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
// Lo único que se habría modificado por sintaxis son los tres caracteres que un
// template literal de JavaScript interpretaría: la barra invertida, el acento
// grave y la secuencia ${. En este HTML no aparece ninguno.
//
// Se generó desde el fichero en disco, no desde el texto del chat: ese llega con
// la codificación rota y mandaría los acentos partidos a todo el mundo.
export const PLANTILLA_BIENVENIDA = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Capitán AlGrass</title>
<style type="text/css">
@media only screen and (max-width:640px) {
  .wrap { padding:0 !important; }
  .card { border-radius:0 !important; }
  .pad { padding-left:20px !important; padding-right:20px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F2F5FA;">
<div style="display:none;font-size:1px;color:#F2F5FA;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Tú convocas a tu gente. Nosotros resolvemos la cancha, el pago y los jugadores que falten.</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F5FA;">
  <tr>
    <td align="center" class="wrap" style="padding:24px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="768" class="card" style="width:768px;max-width:768px;background:#FFFFFF;border-radius:14px;overflow:hidden;">

        <tr>
          <td align="center" style="background:#C42C2F;padding:22px 24px 24px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
              <tr>
                <td valign="middle" style="padding-right:9px;"><img src="https://algrass.com/email-assets/email-logo.png" width="42" height="42" alt="AlGrass" style="display:block;border:0;outline:none;width:42px;height:42px;" /></td>
                <td valign="middle" style="font-family:Helvetica,Arial,sans-serif;font-size:25px;font-weight:bold;color:#FFFFFF;letter-spacing:0.3px;">AlGrass</td>
              </tr>
            </table>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;color:#F9CFD0;letter-spacing:3px;padding:16px 0 9px 0;">CAPIT&Aacute;N ALGRASS</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:29px;font-weight:bold;color:#FFFFFF;line-height:1.22;white-space:nowrap;">T&uacute; convocas. Nosotros resolvemos el resto.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:34px 40px 6px 40px;font-family:Helvetica,Arial,sans-serif;">
            <div style="font-size:20px;color:#101828;line-height:1.45;padding-bottom:14px;">Hola {{nombre}},</div>
            <div style="font-size:19px;color:#5B6577;line-height:1.55;">Quedaste confirmado como Capit&aacute;n AlGrass. T&uacute; convocas a tu gente. Nosotros resolvemos la cancha, el pago y los jugadores que falten. Para que nunca dejes de jugar.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:30px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#B82528;letter-spacing:2px;">TUS BENEFICIOS</td>
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
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#C42C2F;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">1</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Arma la lista</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Si alguien se baja, el cupo sigue siendo tuyo.</div>
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
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#C42C2F;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">2</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Tu pichanga no se cae</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Si falta gente o el rival, lo buscamos hasta el último minuto.</div>
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
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#C42C2F;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">3</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Chau a estar cobrando</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Cada uno paga lo suyo. Tú no adelantas ni persigues a nadie.</div>
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
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#C42C2F;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">4</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">Juega gratis</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Gana créditos por cada nuevo jugador que juega contigo.</div>
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
                            <td align="center" valign="middle" width="30" height="30" style="width:30px;height:30px;background:#C42C2F;border-radius:15px;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;line-height:30px;">5</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;">
                        <div style="font-size:19px;font-weight:bold;color:#101828;line-height:1.35;padding-bottom:4px;">AlGrass te reconoce</div>
                        <div style="font-size:18px;color:#5B6577;line-height:1.5;">Regalos, soporte directo y beneficios que solo llegan a los capitanes.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="1" style="height:1px;background:#E4E8F0;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
          </td>
        </tr>

        <tr>
          <td style="padding:30px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#104BFF;letter-spacing:2px;">HAZLO F&Aacute;CIL</td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:26px;font-weight:bold;color:#101828;line-height:1.3;">As&iacute; armas tu lista</td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:19px;color:#5B6577;line-height:1.55;">Entra al partido, abre <strong style="color:#101828;">Gestionar mi lista</strong> y sigue estos cuatro pasos. Despu&eacute;s comparte el link del partido con tus amigos.</td>
        </tr>
        <tr>
          <td style="padding:20px 0 0 0;">
            <img src="https://algrass.com/email-assets/capitanes-tutorial.png" width="768" alt="1. Activa Arma la lista y elige cu&aacute;ntos cupos reservas. 2. En tu lista est&aacute;n t&uacute;, tus invitados y quienes entren con tu link. 3. Agregar jugadores suma invitados y esos cupos los pagas t&uacute;. 4. Los amigos sin cupo asegurado entraron con tu link: si cancelan, el cupo se libera al p&uacute;blico." style="display:block;border:0;outline:none;width:100%;max-width:768px;height:auto;" />
          </td>
        </tr>

        <tr>
          <td style="padding:4px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EDF2FF;border-radius:10px;">
              <tr>
                <td style="padding:20px 18px;font-family:Helvetica,Arial,sans-serif;">
                  <div style="font-size:19px;font-weight:bold;color:#104BFF;padding-bottom:13px;">Tips que funcionan</div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.45;padding:0 0 12px 0;white-space:nowrap;"><strong style="color:#101828;">Arma tu lista con anticipación.</strong> Tienes partidos hasta 30 días.</td></tr><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.45;padding:0 0 12px 0;white-space:nowrap;"><strong style="color:#101828;">Reserva los cupos que quieras.</strong> Puedes liberar o aumentar luego.</td></tr><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.45;padding:0 0 12px 0;white-space:nowrap;"><strong style="color:#101828;">Si falta gente o liberas cupos,</strong> los llenamos nosotros.</td></tr><tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#5B6577;line-height:1.45;padding:0 0 12px 0;white-space:nowrap;"><strong style="color:#101828;">Comparte tu link</strong> en el grupo de tu pichanga.</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:32px 20px 0 20px;font-family:Helvetica,Arial,sans-serif;font-size:20px;color:#5B6577;line-height:1.6;white-space:nowrap;">Reserva, arma tu primera lista y disfruta los beneficios de Capit&aacute;n.</td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#C42C2F;border-radius:8px;">
                  <a href="https://algrass.com" style="display:inline-block;padding:15px 40px;font-family:Helvetica,Arial,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;text-decoration:none;">Armar mi lista</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:14px 40px 0 40px;font-family:Helvetica,Arial,sans-serif;font-size:17px;color:#5B6577;line-height:1.55;">
            &iquest;Dudas? Escr&iacute;benos <a href="https://wa.me/51945763178?text=Hola%2C%20soy%20capit%C3%A1n%20de%20AlGrass%20y%20tengo%20una%20consulta" style="color:#104BFF;text-decoration:none;font-weight:bold;">aqu&iacute;</a>.
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
