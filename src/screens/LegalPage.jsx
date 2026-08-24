import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB } from '../constants';
import I from '../icons';

// Contenido de la Política de Privacidad (fuente: Politica_de_Privacidad_AlGrass.txt).
// Estructura del documento preservada: fecha, secciones 1–22, subsecciones, párrafos y
// listas. Renderizado directamente en /privacy (no como archivo/descarga).
const PRIVACY_UPDATED = 'Última actualización: agosto de 2026';

const PRIVACY_BLOCKS = [
  { h: '1. INTRODUCCIÓN' },
  { p: 'La presente Política de Privacidad describe la forma en que AlGrass S.A.C. (en adelante, "AlGrass", "nosotros" o la "Plataforma") recopila, utiliza, almacena, comparte y protege los datos personales de los usuarios que utilizan los servicios ofrecidos a través de su sitio web, aplicación y demás canales oficiales.' },
  { p: 'AlGrass es una plataforma tecnológica que conecta jugadores, capitanes y complejos deportivos para facilitar la organización, reserva y participación en actividades deportivas.' },
  { p: 'AlGrass trata los datos personales de forma transparente, responsable y conforme a la legislación vigente de la República del Perú.' },
  { p: 'La presente Política estará disponible de forma clara y accesible para los Usuarios. Cuando el tratamiento de datos personales requiera consentimiento, AlGrass lo solicitará conforme a la legislación aplicable.' },

  { h: '2. RESPONSABLE DEL TRATAMIENTO' },
  { p: 'El responsable del tratamiento de los datos personales es:' },
  { p: 'AlGrass S.A.C. Domicilio: Av. Javier Prado Este 3654, oficina 802, San Borja, Lima, Perú Correo electrónico: legal@algrass.com Sitio web: algrass.com' },
  { p: 'AlGrass S.A.C. actúa como titular de los bancos de datos personales y responsable del tratamiento de los datos personales recopilados mediante la Plataforma, conforme a la legislación aplicable.' },

  { h: '3. ÁMBITO DE APLICACIÓN' },
  { p: 'La presente Política resulta aplicable a las personas que utilicen los servicios de AlGrass, incluyendo quienes:' },
  { ul: ['creen o mantengan una cuenta;', 'inicien sesión mediante los mecanismos de autenticación disponibles;', 'reserven partidos o canchas;', 'participen en partidos u otras actividades deportivas;', 'realicen o reciban invitaciones o referidos;', 'utilicen funcionalidades de Capitán;', 'administren complejos deportivos;', 'utilicen cualquiera de las funcionalidades de la Plataforma; o', 'visiten el sitio web oficial de AlGrass.'] },
  { p: 'La Política resulta aplicable independientemente del dispositivo utilizado para acceder al servicio.' },

  { h: '4. DATOS PERSONALES QUE RECOPILAMOS' },
  { p: 'Dependiendo de las funcionalidades utilizadas, AlGrass podrá recopilar las siguientes categorías de información.' },
  { sh: '4.1 Datos de identificación y perfil' },
  { p: 'Podremos recopilar:' },
  { ul: ['nombre completo;', 'dirección de correo electrónico;', 'número telefónico;', 'fecha de nacimiento;', 'nacionalidad;', 'fotografía de perfil;', 'código interno de usuario;', 'ciudad seleccionada; y', 'demás información de perfil proporcionada por el Usuario.'] },
  { sh: '4.2 Información deportiva y de utilización de la Plataforma' },
  { p: 'Podremos registrar información relacionada con:' },
  { ul: ['posición y preferencias deportivas;', 'partidos y actividades deportivas;', 'reservas de partidos y canchas;', 'historial de participación;', 'cancelaciones;', 'listas de espera;', 'calificaciones;', 'invitaciones;', 'referidos;', 'cupos reservados;', 'participación como Capitán; y', 'promociones y beneficios utilizados.'] },
  { sh: '4.3 Información obtenida mediante proveedores de autenticación' },
  { p: 'Cuando el Usuario decida autenticarse mediante servicios de terceros como Google o Facebook, AlGrass podrá recibir, dependiendo de los permisos concedidos y de la información facilitada por dichos proveedores:' },
  { ul: ['nombre;', 'correo electrónico;', 'fotografía de perfil;', 'identificador del proveedor de autenticación; y', 'demás información autorizada por el Usuario.'] },
  { p: 'AlGrass no recibe ni almacena las contraseñas utilizadas por el Usuario para acceder a dichos servicios externos.' },
  { sh: '4.4 Información sobre pagos y Wallet' },
  { p: 'AlGrass podrá registrar información relacionada con:' },
  { ul: ['operaciones y reservas realizadas;', 'importes;', 'cancelaciones;', 'créditos;', 'descuentos y promociones;', 'saldo interno de la Wallet; y', 'movimientos asociados a dicho saldo.'] },
  { p: 'AlGrass no almacena números completos de tarjetas, códigos CVV ni credenciales financieras cuya gestión corresponda al proveedor externo encargado del procesamiento del pago.' },
  { sh: '4.5 Información de ubicación' },
  { p: 'AlGrass podrá acceder a la ubicación del dispositivo cuando el Usuario otorgue el permiso correspondiente.' },
  { p: 'Esta información podrá utilizarse para funcionalidades relacionadas con mapas, orientación respecto de instalaciones deportivas u otras funciones de la Plataforma que requieran ubicación.' },
  { p: 'El Usuario podrá retirar el permiso desde la configuración de su dispositivo.' },
  { sh: '4.6 Información técnica' },
  { p: 'AlGrass podrá recopilar información técnica necesaria para el funcionamiento, seguridad y mejora del servicio, incluyendo:' },
  { ul: ['tipo de dispositivo;', 'sistema operativo;', 'idioma;', 'versión de la aplicación;', 'dirección IP;', 'identificadores técnicos;', 'información de sesión;', 'registros de errores; e', 'información relacionada con seguridad y prevención del fraude.'] },

  { h: '5. DATOS OBLIGATORIOS Y FACULTATIVOS' },
  { p: 'Los datos identificados como necesarios durante el registro, autenticación, reserva, pago o utilización de una determinada funcionalidad deberán ser proporcionados para poder prestar el servicio correspondiente.' },
  { p: 'La negativa a proporcionar dichos datos podrá impedir la creación de una cuenta, la realización de una reserva, el procesamiento de un pago o el acceso a la funcionalidad que los requiera.' },
  { p: 'Los datos identificados como opcionales podrán omitirse sin impedir el acceso a las demás funcionalidades que no los requieran.' },

  { h: '6. CÓMO OBTENEMOS LOS DATOS' },
  { p: 'Los datos personales podrán obtenerse mediante:' },
  { ul: ['información proporcionada directamente por el Usuario;', 'creación y gestión de cuentas;', 'utilización de la Plataforma;', 'proveedores de autenticación autorizados por el Usuario;', 'reservas y operaciones realizadas;', 'permisos concedidos por el Usuario;', 'interacciones entre Usuarios dentro de las funcionalidades de AlGrass; y', 'comunicaciones mantenidas con AlGrass.'] },
  { p: 'AlGrass no comercializa ni adquiere bases de datos personales para incorporarlas indiscriminadamente a la Plataforma.' },

  { h: '7. FINALIDADES DEL TRATAMIENTO' },
  { p: 'AlGrass podrá tratar los datos personales para:' },
  { ul: ['crear y administrar cuentas;', 'identificar y autenticar Usuarios;', 'gestionar perfiles;', 'gestionar partidos, reservas de canchas y otras actividades deportivas;', 'permitir la participación de Usuarios;', 'gestionar invitaciones, referidos y funcionalidades de Capitán;', 'gestionar listas de espera;', 'administrar promociones y beneficios;', 'gestionar operaciones, cancelaciones, reembolsos y Wallet;', 'procesar pagos mediante proveedores especializados;', 'responder consultas y solicitudes;', 'enviar comunicaciones necesarias para la prestación del servicio;', 'enviar notificaciones cuando corresponda y conforme a los permisos otorgados;', 'prevenir fraude y actividades sospechosas;', 'garantizar la seguridad y estabilidad de la Plataforma;', 'investigar incidentes;', 'mejorar los servicios existentes;', 'desarrollar nuevas funcionalidades;', 'elaborar estadísticas y análisis;', 'cumplir obligaciones legales; y', 'proteger los derechos e intereses legítimos de AlGrass y de sus Usuarios.'] },
  { p: 'Cuando AlGrass utilice información para estadísticas, estudios o análisis sin necesidad de identificar individualmente al Usuario, podrá utilizar información agregada o anonimizada.' },
  { p: 'AlGrass no utilizará los datos personales para finalidades incompatibles con aquellas informadas al Usuario sin cumplir previamente los requisitos establecidos por la legislación aplicable.' },

  { h: '8. BASE LEGAL DEL TRATAMIENTO' },
  { p: 'Dependiendo de la finalidad y de las circunstancias correspondientes, el tratamiento de datos personales podrá fundamentarse en:' },
  { ul: ['el consentimiento del Usuario, cuando resulte requerido;', 'la ejecución de la relación contractual derivada de la utilización de la Plataforma;', 'el cumplimiento de obligaciones legales; o', 'los demás supuestos que permitan el tratamiento conforme a la legislación aplicable.'] },
  { p: 'Cuando el tratamiento se base en el consentimiento, este será solicitado conforme a los requisitos establecidos por la legislación aplicable y podrá ser revocado cuando corresponda, sin afectar la licitud del tratamiento realizado con anterioridad.' },

  { h: '9. INVITACIONES Y PROGRAMA DE REFERIDOS' },
  { p: 'AlGrass podrá registrar la relación entre Usuarios generada mediante invitaciones, enlaces de referidos u otros mecanismos disponibles en la Plataforma.' },
  { p: 'Esta información podrá utilizarse para:' },
  { ul: ['identificar referidos;', 'gestionar beneficios y promociones;', 'gestionar programas de Capitanes;', 'verificar el cumplimiento de las condiciones de campañas;', 'prevenir usos fraudulentos; y', 'elaborar estadísticas sobre utilización y crecimiento de la Plataforma.'] },
  { p: 'Los beneficios y condiciones comerciales correspondientes a estos programas se regularán, cuando corresponda, en los Términos del Servicio o en las condiciones específicas de cada promoción.' },

  { h: '10. PAGOS Y PROVEEDORES DE PAGO' },
  { p: 'AlGrass podrá utilizar proveedores externos debidamente autorizados para procesar los pagos realizados mediante la Plataforma.' },
  { p: 'Cuando un Usuario efectúe una operación de pago, AlGrass podrá comunicar al proveedor correspondiente la información estrictamente necesaria para procesar la operación.' },
  { p: 'AlGrass no almacena números completos de tarjetas bancarias, códigos CVV ni otras credenciales financieras cuya gestión corresponda al proveedor de pagos.' },
  { p: 'El tratamiento efectuado directamente por dichos proveedores estará sujeto además a sus propias políticas y condiciones.' },

  { h: '11. COMPARTICIÓN DE DATOS PERSONALES' },
  { p: 'AlGrass no vende ni alquila los datos personales de sus Usuarios.' },
  { p: 'Los datos podrán ser comunicados o puestos a disposición de terceros cuando sea necesario para prestar el servicio, exista una base jurídica que lo permita o resulte exigido por la legislación aplicable.' },
  { sh: '11.1 Proveedores' },
  { p: 'AlGrass podrá utilizar proveedores para servicios como:' },
  { ul: ['infraestructura y alojamiento;', 'almacenamiento;', 'autenticación;', 'comunicaciones;', 'monitoreo;', 'seguridad;', 'análisis técnico;', 'procesamiento de pagos; y', 'otros servicios necesarios para operar la Plataforma.'] },
  { p: 'El acceso deberá limitarse a la información necesaria para prestar los servicios correspondientes.' },
  { sh: '11.2 Proveedores de autenticación' },
  { p: 'Cuando el Usuario utilice servicios externos como Google o Facebook, determinada información podrá ser intercambiada conforme a los permisos concedidos y las políticas del proveedor correspondiente.' },
  { sh: '11.3 Complejos deportivos' },
  { p: 'AlGrass podrá facilitar a los complejos deportivos aquella información que resulte necesaria para gestionar una reserva, identificar a los participantes, permitir el acceso a las instalaciones o prestar el servicio solicitado.' },
  { sh: '11.4 Autoridades' },
  { p: 'AlGrass podrá comunicar información cuando resulte requerido por ley, autoridad competente o resolución judicial, así como cuando resulte legalmente necesario para proteger los derechos de AlGrass o de terceros.' },
  { sh: '11.5 Operaciones societarias' },
  { p: 'En caso de fusión, adquisición, reorganización, escisión, transferencia de activos u otra operación societaria, los datos personales podrán formar parte de los activos involucrados, respetando la legislación aplicable.' },

  { h: '12. TRANSFERENCIAS INTERNACIONALES' },
  { p: 'Algunos proveedores tecnológicos utilizados por AlGrass podrán encontrarse o tratar información fuera del Perú.' },
  { p: 'Cuando corresponda, AlGrass adoptará las medidas necesarias para que las transferencias internacionales de datos personales se efectúen de acuerdo con la legislación peruana aplicable.' },
  { p: 'Cuando el consentimiento sea necesario para una transferencia internacional, el Usuario será informado conforme a los requisitos legales correspondientes.' },
  { p: 'AlGrass cumplirá además las obligaciones de comunicación o registro de los flujos transfronterizos que resulten aplicables.' },

  { h: '13. CONSERVACIÓN DE LOS DATOS' },
  { p: 'AlGrass conservará los datos personales durante el tiempo necesario para cumplir las finalidades para las que fueron recopilados y, posteriormente, durante los períodos que resulten necesarios para:' },
  { ul: ['cumplir obligaciones legales;', 'atender responsabilidades derivadas de la prestación del servicio;', 'resolver controversias;', 'prevenir fraude;', 'atender requerimientos de autoridades; y', 'proteger los derechos de AlGrass y de terceros.'] },
  { p: 'Cuando los datos dejen de ser necesarios, serán eliminados, anonimizados o tratados de la manera que corresponda conforme a la legislación aplicable.' },

  { h: '14. ELIMINACIÓN DE LA CUENTA' },
  { p: 'El Usuario podrá solicitar o realizar la eliminación de su cuenta mediante los mecanismos habilitados por AlGrass.' },
  { p: 'La eliminación de la cuenta impedirá continuar utilizando los servicios asociados a ella.' },
  { p: 'AlGrass podrá conservar aquellos datos que resulten necesarios durante los plazos legalmente aplicables para:' },
  { ul: ['cumplir obligaciones legales;', 'acreditar operaciones realizadas;', 'resolver controversias;', 'prevenir fraude o abuso;', 'atender requerimientos de autoridades; y', 'proteger los derechos de AlGrass y de terceros.'] },
  { p: 'Cuando no exista obligación o justificación para conservarlos, los datos serán eliminados o anonimizados conforme corresponda.' },

  { h: '15. SEGURIDAD' },
  { p: 'AlGrass adopta medidas técnicas, administrativas y organizativas razonables destinadas a proteger los datos personales frente a pérdida, destrucción, alteración, acceso, utilización o divulgación no autorizados.' },
  { p: 'Estas medidas podrán incluir, según corresponda:' },
  { ul: ['autenticación;', 'controles de acceso;', 'cifrado de comunicaciones;', 'mecanismos de respaldo;', 'monitoreo;', 'medidas de prevención del fraude;', 'gestión de incidentes; y', 'revisión de medidas de seguridad.'] },
  { p: 'El acceso por parte del personal, colaboradores y proveedores deberá limitarse a aquellos casos en que resulte necesario para el desempeño de sus funciones.' },
  { p: 'Ningún sistema informático puede garantizar una seguridad absoluta.' },

  { h: '16. COOKIES, ALMACENAMIENTO LOCAL Y TECNOLOGÍAS SIMILARES' },
  { p: 'El sitio web y la aplicación podrán utilizar, según corresponda:' },
  { ul: ['cookies;', 'LocalStorage;', 'SessionStorage;', 'tokens de autenticación; y', 'tecnologías similares.'] },
  { p: 'Estas tecnologías podrán utilizarse para mantener sesiones, recordar preferencias, almacenar configuraciones, facilitar funcionalidades, mejorar el rendimiento y proteger la seguridad de la cuenta.' },
  { p: 'El Usuario podrá gestionar determinadas tecnologías desde la configuración de su navegador o dispositivo, aunque su desactivación podrá afectar algunas funcionalidades.' },

  { h: '17. DERECHOS DEL USUARIO' },
  { p: 'De conformidad con la legislación aplicable, el Usuario podrá ejercer sus derechos de información y los derechos de Acceso, Rectificación, Cancelación y Oposición (derechos ARCO), así como los demás derechos que le reconozca la normativa vigente.' },
  { p: 'Las solicitudes relacionadas con protección de datos personales podrán remitirse a:' },
  { p: 'legal@algrass.com' },
  { p: 'AlGrass podrá solicitar la información razonablemente necesaria para verificar la identidad del solicitante y proteger los datos personales frente a solicitudes fraudulentas o no autorizadas.' },
  { p: 'Las solicitudes serán atendidas dentro de los plazos establecidos por la legislación aplicable.' },
  { p: 'Cuando corresponda, el Usuario podrá recurrir ante la Autoridad Nacional de Protección de Datos Personales si considera que sus derechos no han sido debidamente atendidos.' },

  { h: '18. MENORES DE EDAD' },
  { p: 'La Plataforma está dirigida exclusivamente a personas mayores de 18 años.' },
  { p: 'AlGrass no pretende recopilar intencionalmente datos personales de menores de edad.' },
  { p: 'Si AlGrass detecta que una cuenta pertenece a una persona que no cumple los requisitos de edad establecidos para utilizar la Plataforma, podrá adoptar las medidas necesarias, incluyendo la suspensión o eliminación de la cuenta, de conformidad con la legislación aplicable.' },

  { h: '19. BANCO DE DATOS PERSONALES' },
  { p: 'Los bancos de datos personales de titularidad de AlGrass S.A.C. serán inscritos y mantenidos actualizados ante el Registro Nacional de Protección de Datos Personales, de conformidad con la legislación aplicable.' },
  { p: 'Una vez realizada la inscripción, AlGrass incorporará o actualizará, cuando corresponda, la identificación del banco o bancos de datos personales y demás información exigida por la normativa aplicable.' },
  { p: 'AlGrass adoptará las medidas necesarias para cumplir las obligaciones relacionadas con dichos bancos y con los tratamientos realizados mediante la Plataforma.' },
  { p: 'Cuando corresponda, AlGrass comunicará los flujos transfronterizos de datos personales conforme a la normativa aplicable.' },

  { h: '20. MODIFICACIONES DE LA POLÍTICA' },
  { p: 'AlGrass podrá modificar esta Política para adaptarla a cambios legales, regulatorios, tecnológicos u operativos, así como a modificaciones en las funcionalidades, servicios o proveedores utilizados.' },
  { p: 'La versión vigente estará disponible públicamente en:' },
  { p: 'algrass.com/privacy' },
  { p: 'La fecha de última actualización aparecerá al inicio del documento.' },
  { p: 'Cuando una modificación requiera una nueva comunicación o consentimiento conforme a la legislación aplicable, AlGrass adoptará las medidas correspondientes.' },

  { h: '21. LEGISLACIÓN APLICABLE' },
  { p: 'La presente Política se regirá por las leyes de la República del Perú y, en particular, por la Ley N.º 29733 – Ley de Protección de Datos Personales, su Reglamento aprobado por Decreto Supremo N.º 016-2024-JUS, y demás disposiciones que resulten aplicables.' },

  { h: '22. CONTACTO' },
  { p: 'Para consultas relacionadas con esta Política, el tratamiento de datos personales o el ejercicio de derechos, el Usuario podrá comunicarse con:' },
  { p: 'AlGrass S.A.C. Domicilio: Av. Javier Prado Este 3654, oficina 802, San Borja, Lima, Perú Correo electrónico: legal@algrass.com Sitio web: algrass.com' },
  { p: 'AlGrass atenderá las solicitudes dentro de los plazos establecidos por la legislación aplicable.' },
];

// Página legal (Política de Privacidad / Términos del Servicio). Una sola pantalla
// parametrizada por `type`; sirve TANTO a la app (enlace desde los modales de Configuración)
// COMO a la web pública (https://algrass.com/privacy, /terms) — el rewrite SPA de Vercel
// entrega index.html y React Router renderiza esta misma ruta.
// Privacy: contenido completo (arriba). Terms: placeholder por ahora (se rellenará después).
export default function LegalPage({ type }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isTerms = type === 'terms';
  const title = isTerms ? 'Términos del Servicio' : 'Política de Privacidad';

  // Desde la app hubo navegación SPA (key ≠ 'default') → volver atrás (a Configuración).
  // Abierta directamente desde la web pública (carga inicial, key 'default') → volver a la home.
  const goBack = () => { if (location.key !== 'default') navigate(-1); else navigate('/'); };

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={goBack}
          aria-label="Regresar"
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          {I.back('#fff')}
        </button>
        <span style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{title}</span>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 20px 40px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT, letterSpacing: -0.5, margin: '0 0 14px' }}>{title}</h1>
        {isTerms ? (
          <p style={{ fontSize: 14.5, color: SUB, lineHeight: 1.65, margin: 0 }}>
            El contenido completo de los Términos del Servicio se añadirá aquí próximamente.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: SUB, margin: '0 0 18px' }}>{PRIVACY_UPDATED}</p>
            {PRIVACY_BLOCKS.map((b, i) => (
              b.h
                ? <h2 key={i} style={{ fontSize: 16.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, margin: '22px 0 8px' }}>{b.h}</h2>
                : b.sh
                  ? <h3 key={i} style={{ fontSize: 15, fontWeight: 700, color: TEXT, margin: '14px 0 6px' }}>{b.sh}</h3>
                  : b.ul
                    ? <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 20 }}>{b.ul.map((it, j) => <li key={j} style={{ fontSize: 14.5, color: SUB, lineHeight: 1.6, marginBottom: 4 }}>{it}</li>)}</ul>
                    : <p key={i} style={{ fontSize: 14.5, color: SUB, lineHeight: 1.65, margin: '0 0 10px' }}>{b.p}</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
