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
  { ul: ['nombre completo;', 'dirección de correo electrónico;', 'número telefónico;', 'fecha de nacimiento;', 'sexo;', 'nacionalidad;', 'fotografía de perfil;', 'código interno de usuario;', 'ciudad seleccionada; y', 'demás información de perfil proporcionada por el Usuario.'] },
  { sh: '4.2 Perfil público' },
  { p: 'AlGrass dispone de perfiles públicos de Usuario que pueden ser consultados a través de la Plataforma, sin que sea necesario iniciar sesión.' },
  { p: 'El perfil público muestra exclusivamente los siguientes datos:' },
  { ul: ['nombre;', 'fotografía de perfil;', 'edad;', 'sexo;', 'posición de juego; y', 'número de partidos disputados.'] },
  { p: 'La visualización de esta información tiene como finalidad facilitar la identificación de los participantes y contribuir a la seguridad, confianza y adecuada organización de las actividades deportivas gestionadas mediante AlGrass, incluyendo la identificación por parte de otros jugadores, hosts, complejos deportivos y AlGrass.' },
  { p: 'La fecha de nacimiento utilizada para determinar la edad no se muestra públicamente.' },
  { p: 'El correo electrónico, número telefónico, información de pagos, saldo y movimientos de Wallet y demás información privada de la cuenta no forman parte del perfil público.' },
  { sh: '4.3 Información deportiva y de utilización de la Plataforma' },
  { p: 'Podremos registrar información relacionada con:' },
  { ul: ['posición y preferencias deportivas;', 'partidos y actividades deportivas;', 'reservas de partidos y canchas;', 'historial de participación;', 'cancelaciones;', 'listas de espera;', 'calificaciones;', 'invitaciones;', 'referidos;', 'cupos reservados;', 'participación como Capitán; y', 'promociones y beneficios utilizados.'] },
  { sh: '4.4 Información obtenida mediante proveedores de autenticación' },
  { p: 'Cuando el Usuario decida autenticarse mediante servicios de terceros como Google o Facebook, AlGrass podrá recibir, dependiendo de los permisos concedidos y de la información facilitada por dichos proveedores:' },
  { ul: ['nombre;', 'correo electrónico;', 'fotografía de perfil;', 'identificador del proveedor de autenticación; y', 'demás información autorizada por el Usuario.'] },
  { p: 'AlGrass no recibe ni almacena las contraseñas utilizadas por el Usuario para acceder a dichos servicios externos.' },
  { sh: '4.5 Información sobre pagos y Wallet' },
  { p: 'AlGrass podrá registrar información relacionada con:' },
  { ul: ['operaciones y reservas realizadas;', 'importes;', 'cancelaciones;', 'créditos;', 'descuentos y promociones;', 'saldo interno de la Wallet; y', 'movimientos asociados a dicho saldo.'] },
  { p: 'AlGrass no almacena números completos de tarjetas, códigos CVV ni credenciales financieras cuya gestión corresponda al proveedor externo encargado del procesamiento del pago.' },
  { sh: '4.6 Información de ubicación' },
  { p: 'AlGrass podrá acceder a la ubicación del dispositivo cuando el Usuario otorgue el permiso correspondiente.' },
  { p: 'Esta información podrá utilizarse para funcionalidades relacionadas con mapas, orientación respecto de instalaciones deportivas u otras funciones de la Plataforma que requieran ubicación.' },
  { p: 'El Usuario podrá retirar el permiso desde la configuración de su dispositivo.' },
  { sh: '4.7 Información técnica' },
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
  { ul: ['crear y administrar cuentas;', 'identificar y autenticar Usuarios;', 'gestionar las cuentas y perfiles de los Usuarios, incluyendo la visualización del perfil público para facilitar la identificación de los participantes, la seguridad, confianza y organización de las actividades deportivas;', 'gestionar partidos, reservas de canchas y otras actividades deportivas;', 'permitir la participación de Usuarios;', 'gestionar invitaciones, referidos y funcionalidades de Capitán;', 'gestionar listas de espera;', 'administrar promociones y beneficios;', 'gestionar operaciones, cancelaciones, reembolsos y Wallet;', 'procesar pagos mediante proveedores especializados;', 'responder consultas y solicitudes;', 'enviar comunicaciones necesarias para la prestación del servicio;', 'enviar notificaciones cuando corresponda y conforme a los permisos otorgados;', 'prevenir fraude y actividades sospechosas;', 'garantizar la seguridad y estabilidad de la Plataforma;', 'investigar incidentes;', 'mejorar los servicios existentes;', 'desarrollar nuevas funcionalidades;', 'elaborar estadísticas y análisis;', 'cumplir obligaciones legales; y', 'proteger los derechos e intereses legítimos de AlGrass y de sus Usuarios.'] },
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

// Contenido de los Términos del Servicio (fuente: Terminos_del_Servicio_AlGrass.txt).
// Estructura del documento preservada: fecha, secciones 1–25, subsecciones, párrafos y
// listas. Renderizado directamente en /terms (no como archivo/descarga).
const TERMS_UPDATED = 'Última actualización: agosto de 2026';

const TERMS_BLOCKS = [
  { h: '1. INTRODUCCIÓN' },
  { p: 'Los presentes Términos del Servicio regulan el acceso y utilización de AlGrass, plataforma digital operada por AlGrass S.A.C. (en adelante, "AlGrass", "nosotros", "nuestro" o la "Plataforma").' },
  { p: 'AlGrass es una plataforma tecnológica orientada a facilitar la búsqueda, organización, reserva, gestión y participación en actividades y servicios deportivos, así como la interacción entre jugadores, organizadores y proveedores de servicios deportivos.' },
  { p: 'Al utilizar la Plataforma, el Usuario declara haber leído, comprendido y aceptado los presentes Términos y la Política de Privacidad de AlGrass.' },

  { h: '2. RESPONSABLE DEL SERVICIO' },
  { p: 'Responsable de la Plataforma: AlGrass S.A.C.' },
  { p: 'Domicilio: Av. Javier Prado Este 3654, oficina 802, San Borja, Lima, Perú.' },
  { p: 'Correo electrónico: legal@algrass.com' },
  { p: 'Sitio web oficial: https://algrass.com' },

  { h: '3. ÁMBITO DE APLICACIÓN' },
  { p: 'Los presentes Términos resultan aplicables a toda persona que acceda o utilice los servicios de AlGrass, incluyendo quienes creen una cuenta, participen en partidos, realicen reservas, utilicen promociones o beneficios o accedan a otras funcionalidades de la Plataforma.' },
  { p: 'Determinados servicios, promociones, beneficios o funcionalidades podrán estar sujetos a condiciones particulares que serán informadas al Usuario antes de su utilización. Dichas condiciones complementarán estos Términos respecto del servicio o beneficio correspondiente.' },

  { h: '4. DEFINICIONES' },
  { sh: 'AlGrass o Plataforma' },
  { p: 'Plataforma digital operada por AlGrass S.A.C.' },
  { sh: 'Usuario' },
  { p: 'Persona que accede o utiliza los servicios ofrecidos mediante la Plataforma.' },
  { sh: 'Partido o Match' },
  { p: 'Actividad deportiva organizada o gestionada mediante AlGrass en la que los Usuarios pueden reservar plazas para participar.' },
  { sh: 'Reserva de cancha o Rental' },
  { p: 'Reserva de una instalación deportiva ofrecida mediante la Plataforma para una fecha y horario determinados.' },
  { sh: 'Complejo Deportivo' },
  { p: 'Persona natural o jurídica responsable de una o más instalaciones deportivas disponibles mediante la Plataforma.' },
  { sh: 'Host' },
  { p: 'Persona encargada de apoyar la organización y desarrollo de determinadas actividades gestionadas por AlGrass.' },
  { sh: 'Capitán' },
  { p: 'Usuario que puede disponer de funcionalidades adicionales de organización conforme a las condiciones establecidas por AlGrass.' },
  { sh: 'Crédito AlGrass o Wallet' },
  { p: 'Saldo interno asociado a una cuenta que puede utilizarse para operaciones admitidas por la Plataforma.' },

  { h: '5. REQUISITOS Y ACEPTACIÓN' },
  { p: 'AlGrass está dirigido exclusivamente a personas mayores de 18 años.' },
  { p: 'Al crear una cuenta, el Usuario declara tener al menos 18 años y proporcionar información verdadera y actualizada.' },
  { p: 'Cada Usuario es responsable de mantener la confidencialidad de sus credenciales y del uso de su cuenta.' },
  { p: 'La aceptación de los presentes Términos y de la Política de Privacidad constituye un requisito para utilizar aquellas funcionalidades de la Plataforma que requieran registro.' },

  { h: '6. SERVICIOS OFRECIDOS' },
  { p: 'AlGrass facilita la organización, contratación, reserva y gestión de actividades y servicios deportivos.' },
  { p: 'Dependiendo del servicio, ciudad, complejo deportivo y funcionalidades disponibles, la Plataforma podrá permitir la participación en partidos, reserva de instalaciones, interacción entre Usuarios y utilización de otras herramientas relacionadas con las actividades deportivas.' },
  { p: 'Antes de confirmar una operación, el Usuario podrá consultar las características esenciales del servicio, su precio y las condiciones aplicables a la operación correspondiente.' },
  { p: 'La disponibilidad de determinadas funcionalidades podrá variar con el tiempo.' },

  { h: '7. PERFILES Y PARTICIPANTES' },
  { p: 'Determinada información del perfil del Usuario podrá ser visible para otros Usuarios y visitantes de la Plataforma, incluso sin iniciar sesión, conforme se detalla en la Política de Privacidad.' },
  { p: 'Esta visibilidad facilita la identificación de los participantes y contribuye a la adecuada organización y seguridad de las actividades deportivas.' },
  { p: 'El Usuario es responsable de mantener actualizada la información de su perfil y de no utilizar información o imágenes que vulneren derechos de terceros.' },

  { h: '8. PARTIDOS' },
  { p: 'Los Usuarios podrán reservar plazas disponibles para participar en partidos ofrecidos mediante la Plataforma.' },
  { p: 'La inscripción estará sujeta a la disponibilidad existente y a las condiciones mostradas al Usuario antes de confirmar la operación.' },
  { p: 'AlGrass podrá disponer de personal o colaboradores encargados de facilitar la organización y adecuado desarrollo de determinadas actividades deportivas.' },
  { p: 'AlGrass realizará esfuerzos razonables para que las actividades se desarrollen conforme a las condiciones ofrecidas. No obstante, la naturaleza de las actividades deportivas y la intervención de distintos participantes y terceros pueden generar circunstancias que requieran ajustes operativos razonables.' },

  { h: '9. RESERVAS DE CANCHAS' },
  { p: 'Los Usuarios podrán reservar instalaciones deportivas disponibles mediante la Plataforma para las fechas y horarios ofrecidos.' },
  { p: 'La reserva estará sujeta a disponibilidad y a las características, precio y demás condiciones informadas antes de confirmar la operación.' },
  { p: 'Los complejos deportivos son responsables de las instalaciones y de aquellos servicios que se encuentren bajo su administración y control.' },
  { p: 'AlGrass actúa dentro del ámbito de los servicios que presta directamente, sin perjuicio de las responsabilidades que correspondan a cada parte conforme a la legislación aplicable.' },

  { h: '10. PRECIOS Y PAGOS' },
  { p: 'Los precios aplicables serán los mostrados al Usuario antes de confirmar cada operación.' },
  { p: 'Los pagos podrán realizarse mediante los medios habilitados en la Plataforma en cada momento.' },
  { p: 'Cuando resulte aplicable, antes de completar la operación se mostrarán los descuentos, promociones o créditos utilizados.' },
  { p: 'AlGrass podrá corregir errores manifiestos de precio o información antes de que una operación quede confirmada.' },
  { p: 'Si un error afectara una operación ya confirmada, AlGrass informará al Usuario y adoptará las medidas correspondientes respetando los derechos reconocidos por la legislación aplicable.' },

  { h: '11. CRÉDITO ALGRASS' },
  { p: 'AlGrass podrá mantener un saldo interno o Wallet asociado a la cuenta del Usuario.' },
  { p: 'El crédito podrá originarse, entre otros supuestos, por cancelaciones, promociones, beneficios o ajustes operativos.' },
  { p: 'El Crédito AlGrass:' },
  { ul: ['podrá utilizarse únicamente en las operaciones admitidas por la Plataforma;', 'no constituye dinero electrónico;', 'no constituye una cuenta bancaria;', 'no genera intereses; y', 'no constituye un depósito ni instrumento financiero.'] },
  { p: 'Salvo los supuestos expresamente establecidos en estos Términos o aquellos exigidos por la legislación aplicable, el Crédito AlGrass no es canjeable por dinero.' },

  { h: '12. CANCELACIONES, INASISTENCIAS Y DEVOLUCIONES' },
  { sh: '12.1 Cancelación de inscripción en partidos' },
  { p: 'Cuando el Usuario cancele su inscripción con más de veinticuatro (24) horas de anticipación respecto del inicio del partido, el importe correspondiente será restituido como Crédito AlGrass.' },
  { p: 'Cuando la cancelación haya sido realizada voluntariamente por el Usuario, dicho crédito no podrá solicitarse como devolución monetaria.' },
  { p: 'Dentro de las veinticuatro (24) horas anteriores al partido, el Usuario podrá informar mediante la Plataforma que no asistirá, permitiendo liberar su plaza. En este supuesto no corresponderá crédito ni devolución por dicha plaza.' },
  { p: 'La inasistencia sin cancelación previa tampoco genera derecho a crédito ni devolución.' },
  { p: 'Estas condiciones serán aplicables, según corresponda, a las plazas de invitados gestionadas o pagadas por el Usuario.' },
  { sh: '12.2 Cancelación de reservas de canchas' },
  { p: 'Para las reservas de canchas se aplicarán las siguientes condiciones:' },
  { ul: ['cancelación con más de setenta y dos (72) horas de anticipación: restitución del 100 % del importe correspondiente como Crédito AlGrass. El Usuario podrá solicitar alternativamente una devolución monetaria;', 'cancelación con setenta y dos (72) horas o menos, pero más de veinticuatro (24) horas de anticipación: restitución del 50 % exclusivamente como Crédito AlGrass;', 'cancelación con veinticuatro (24) horas o menos de anticipación: no corresponde crédito ni devolución.'] },
  { p: 'Cuando ya no corresponda devolución, el Usuario podrá informar mediante la Plataforma que no utilizará la reserva.' },
  { p: 'La inasistencia o no utilización de la reserva no genera derecho a crédito ni devolución.' },
  { sh: '12.3 Cancelaciones realizadas por AlGrass' },
  { p: 'AlGrass podrá cancelar una actividad cuando existan circunstancias operativas, condiciones climáticas, indisponibilidad de la instalación u otras circunstancias justificadas que impidan o hagan razonablemente desaconsejable la prestación del servicio.' },
  { p: 'Cuando una actividad sea cancelada por AlGrass, el importe correspondiente será acreditado automáticamente como Crédito AlGrass.' },
  { p: 'El Usuario podrá solicitar alternativamente la devolución monetaria de dicho importe.' },
  { p: 'Lo anterior será igualmente aplicable cuando el servicio no pueda prestarse y corresponda la devolución conforme a estos Términos o a la legislación aplicable.' },
  { sh: '12.4 Devoluciones monetarias' },
  { p: 'Cuando corresponda una devolución monetaria y el Usuario la solicite, AlGrass gestionará la devolución en un plazo máximo de quince (15) días hábiles desde que la solicitud cuente con la información necesaria para ser procesada.' },
  { p: 'Una vez gestionada por AlGrass, la disponibilidad efectiva del importe podrá depender adicionalmente de los plazos del proveedor de pago o entidad financiera correspondiente.' },
  { p: 'Las disposiciones de esta sección se aplican sin perjuicio de los derechos que correspondan al Usuario conforme a la legislación aplicable.' },

  { h: '13. CAMBIOS OPERATIVOS' },
  { p: 'Cuando resulte necesario para prestar adecuadamente el servicio, AlGrass podrá realizar ajustes operativos que no alteren sustancialmente las características esenciales de la actividad contratada.' },
  { p: 'Cuando sea necesario, la cancha asignada podrá ser sustituida por otra dentro del mismo complejo deportivo, procurando mantener características razonablemente equivalentes.' },
  { p: 'Cuando un cambio altere sustancialmente las condiciones del servicio contratado, AlGrass informará al Usuario y respetará los derechos que correspondan conforme a la legislación aplicable.' },

  { h: '14. CAPITANES, INVITACIONES, REFERIDOS Y PROMOCIONES' },
  { p: 'AlGrass podrá ofrecer funcionalidades relacionadas con invitaciones, reserva de cupos, Capitanes, referidos, promociones y otros beneficios.' },
  { p: 'Estas funcionalidades podrán estar sujetas a condiciones específicas informadas mediante la Plataforma.' },
  { p: 'Los Usuarios deberán utilizarlas de buena fe.' },
  { p: 'AlGrass podrá denegar, cancelar o retirar beneficios obtenidos mediante fraude, manipulación, cuentas ficticias, uso indebido de promociones o cualquier otra utilización contraria a sus condiciones, sin perjuicio de las medidas adicionales que pudieran corresponder.' },

  { h: '15. CONDUCTA DE LOS USUARIOS' },
  { p: 'Los Usuarios deberán mantener una conducta respetuosa y segura tanto en la Plataforma como durante las actividades deportivas.' },
  { p: 'No se permite:' },
  { ul: ['violencia, amenazas, acoso o discriminación;', 'conductas deliberadamente peligrosas;', 'fraude o suplantación de identidad;', 'utilización abusiva de promociones o beneficios;', 'utilización de la Plataforma para actividades ilícitas; ni', 'conductas que afecten gravemente la seguridad de otros participantes o el adecuado funcionamiento de los servicios.'] },
  { p: 'Cuando resulte necesario para proteger a los participantes o preservar el adecuado desarrollo de una actividad, AlGrass, el personal encargado de la actividad o el responsable de la instalación podrán adoptar medidas razonables frente a conductas graves o peligrosas.' },

  { h: '16. ACTIVIDAD DEPORTIVA Y SEGURIDAD' },
  { p: 'La práctica deportiva implica esfuerzo físico y riesgos inherentes propios de este tipo de actividad.' },
  { p: 'Cada Usuario es responsable de valorar si se encuentra en condiciones adecuadas para participar y deberá actuar de forma prudente y respetuosa con los demás participantes.' },
  { p: 'Los Hosts cumplen funciones relacionadas con la organización de las actividades y no prestan servicios médicos por el hecho de desempeñar dicha función.' },
  { p: 'La eventual disponibilidad de elementos básicos de asistencia o primeros auxilios no sustituye la atención de profesionales sanitarios.' },
  { p: 'Nada de lo dispuesto en esta sección limita las responsabilidades que legalmente pudieran corresponder a AlGrass o a terceros.' },

  { h: '17. COMPLEJOS DEPORTIVOS Y TERCEROS' },
  { p: 'Algunos servicios ofrecidos mediante AlGrass requieren la participación de complejos deportivos, proveedores de pagos u otros terceros.' },
  { p: 'Cada tercero será responsable de los servicios y obligaciones que se encuentren bajo su ámbito de actuación conforme a la legislación aplicable.' },
  { p: 'AlGrass procurará trabajar con proveedores adecuados para la prestación de sus servicios, sin asumir obligaciones que correspondan exclusivamente a dichos terceros.' },
  { p: 'Lo anterior no limita las responsabilidades que legalmente correspondan a AlGrass.' },

  { h: '18. CALIFICACIONES Y CONTENIDO' },
  { p: 'AlGrass podrá permitir que los Usuarios publiquen calificaciones, comentarios u otros contenidos relacionados con los servicios utilizados.' },
  { p: 'El Usuario será responsable del contenido que publique y deberá respetar los derechos de terceros.' },
  { p: 'No se permite contenido ilícito, fraudulento, amenazante, discriminatorio, difamatorio, que vulnere derechos de terceros o que tenga como finalidad manipular los sistemas de calificación.' },
  { p: 'AlGrass podrá moderar o retirar contenido cuando exista una razón justificada para ello.' },

  { h: '19. SUSPENSIÓN Y ELIMINACIÓN DE CUENTAS' },
  { p: 'AlGrass podrá limitar, suspender o cerrar una cuenta cuando existan motivos razonables relacionados con fraude, seguridad, utilización ilícita de la Plataforma, conductas graves o peligrosas o incumplimientos graves o reiterados de estos Términos, respetando los derechos del Usuario y las disposiciones de la legislación aplicable.' },
  { p: 'Cuando resulte razonablemente posible y corresponda, AlGrass informará al Usuario sobre la medida adoptada.' },
  { p: 'La suspensión o cierre de una cuenta no elimina los derechos económicos que legalmente correspondan al Usuario.' },
  { p: 'El Usuario podrá eliminar su cuenta utilizando las funcionalidades disponibles en la Plataforma, sujeto a las reglas de conservación de información establecidas en la Política de Privacidad.' },

  { h: '20. DISPONIBILIDAD DE LA PLATAFORMA' },
  { p: 'AlGrass procurará mantener la Plataforma disponible y operativa.' },
  { p: 'No obstante, podrán producirse interrupciones temporales derivadas de mantenimiento, actualizaciones, incidencias técnicas, servicios de terceros o circunstancias fuera del control razonable de AlGrass.' },
  { p: 'AlGrass podrá actualizar, modificar o incorporar funcionalidades con el fin de mantener, mejorar o adaptar sus servicios.' },
  { p: 'Dichos cambios respetarán las operaciones ya contratadas y los derechos de los Usuarios cuando corresponda.' },

  { h: '21. PROPIEDAD INTELECTUAL' },
  { p: 'La marca AlGrass, nombres comerciales, logotipos, software, diseño de la Plataforma, elementos gráficos, documentación, contenidos y demás elementos propios se encuentran protegidos por la legislación aplicable.' },
  { p: 'La utilización de la Plataforma no concede al Usuario derechos de propiedad sobre dichos elementos.' },
  { p: 'El Usuario únicamente obtiene el derecho personal y limitado de utilizar los servicios conforme a estos Términos.' },

  { h: '22. PRIVACIDAD Y DATOS PERSONALES' },
  { p: 'El tratamiento de los datos personales de los Usuarios se encuentra regulado por la Política de Privacidad de AlGrass.' },
  { p: 'La versión vigente estará disponible públicamente en: https://algrass.com/privacy' },
  { p: 'La Política de Privacidad forma parte de las condiciones aplicables a la utilización de la Plataforma y deberá ser aceptada cuando corresponda.' },

  { h: '23. MODIFICACIONES DE LOS TÉRMINOS' },
  { p: 'AlGrass podrá modificar los presentes Términos para adaptarlos a cambios legislativos, regulatorios, tecnológicos u operativos, así como a nuevas funcionalidades o servicios.' },
  { p: 'La versión vigente estará disponible en: https://algrass.com/terms' },
  { p: 'La fecha de la última actualización aparecerá al inicio del documento.' },
  { p: 'Cuando una modificación requiera una comunicación o aceptación adicional conforme a la legislación aplicable, AlGrass adoptará las medidas correspondientes.' },
  { p: 'Las modificaciones no afectarán retroactivamente derechos adquiridos cuando ello no resulte legalmente procedente.' },

  { h: '24. LEGISLACIÓN APLICABLE Y DERECHOS DEL CONSUMIDOR' },
  { p: 'Los presentes Términos se rigen e interpretan conforme a las leyes de la República del Perú.' },
  { p: 'Ninguna disposición de estos Términos pretende excluir, limitar o implicar la renuncia a derechos que correspondan al Usuario conforme a normas de carácter imperativo, incluyendo la legislación peruana de protección y defensa del consumidor.' },
  { p: 'Cualquier controversia relacionada con los servicios será atendida conforme a los mecanismos y autoridades competentes establecidos por la legislación peruana.' },

  { h: '25. CONTACTO' },
  { p: 'Para consultas relacionadas con estos Términos o con los servicios de AlGrass, el Usuario podrá comunicarse con:' },
  { p: 'AlGrass S.A.C. Domicilio: Av. Javier Prado Este 3654, oficina 802, San Borja, Lima, Perú. Correo electrónico: legal@algrass.com Sitio web: https://algrass.com' },
  { p: 'AlGrass atenderá las comunicaciones dentro de los plazos que correspondan conforme a la naturaleza de la solicitud y a la legislación aplicable.' },

  { h: 'DISPOSICIÓN FINAL' },
  { p: 'Los presentes Términos del Servicio constituyen las condiciones generales aplicables a la utilización de AlGrass y sustituyen cualquier versión anterior publicada por la Plataforma, sin perjuicio de las condiciones particulares que puedan resultar aplicables a determinados servicios, promociones o funcionalidades.' },
  { p: 'AlGrass revisará periódicamente estos Términos para mantenerlos actualizados conforme a la evolución de la Plataforma y de la legislación aplicable.' },
];

// Página legal (Política de Privacidad / Términos del Servicio). Una sola pantalla
// parametrizada por `type`; sirve TANTO a la app (enlace desde los modales de Configuración)
// COMO a la web pública (https://algrass.com/privacy, /terms) — el rewrite SPA de Vercel
// entrega index.html y React Router renderiza esta misma ruta.
// Privacy: contenido completo (arriba). Terms: placeholder por ahora (se rellenará después).
export default function LegalPage({ type }) {
  const isTerms = type === 'terms';
  const title = isTerms ? 'Términos del Servicio' : 'Política de Privacidad';

  // "Atrás" navega SIEMPRE a "/" con navegación dura (no history.back hacia una
  // ruta interna). Así PrivateAccessGate se re-evalúa en la carga: si se llegó
  // sin clave, "/" muestra la pantalla de clave; si ya había acceso válido,
  // carga normal. No desbloquea ni escribe algr_private_access en localStorage.
  const goBack = () => { window.location.href = '/'; };

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
        <p style={{ fontSize: 13, color: SUB, margin: '0 0 18px' }}>{isTerms ? TERMS_UPDATED : PRIVACY_UPDATED}</p>
        {(isTerms ? TERMS_BLOCKS : PRIVACY_BLOCKS).map((b, i) => (
          b.h
            ? <h2 key={i} style={{ fontSize: 16.5, fontWeight: 700, color: TEXT, letterSpacing: -0.2, margin: '22px 0 8px' }}>{b.h}</h2>
            : b.sh
              ? <h3 key={i} style={{ fontSize: 15, fontWeight: 700, color: TEXT, margin: '14px 0 6px' }}>{b.sh}</h3>
              : b.ul
                ? <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 20 }}>{b.ul.map((it, j) => <li key={j} style={{ fontSize: 14.5, color: SUB, lineHeight: 1.6, marginBottom: 4 }}>{it}</li>)}</ul>
                : <p key={i} style={{ fontSize: 14.5, color: SUB, lineHeight: 1.65, margin: '0 0 10px' }}>{b.p}</p>
        ))}
      </div>
    </div>
  );
}
