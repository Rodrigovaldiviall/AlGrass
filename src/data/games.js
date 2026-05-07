export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
export const TODAY_KEY    = ymd(TODAY);
export const TOMORROW_KEY = ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 1));

export const DATE_WINDOW = (() => {
  const out = [];
  for (let i = -2; i < 30; i++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + i);
    out.push(d);
  }
  return out;
})();

// g11 y g12 (3 mayo, 6:20 PM) liberan 1 cupo exactamente a las 6:22 PM
const MAY3_RELEASE = new Date(2026, 4, 3, 18, 22, 0);

export const GAMES = [
  // ── 1 mayo (Arequipa) ──────────────────────────────────────────────────────
  { id: 'g1',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 1)), time: '5:30',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 3, price: 8,  parking: false, showers: true,  master45: false },
  { id: 'g2',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 1)), time: '6:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: true,  covered: false, womenOnly: false, openSpots: 0, price: 9,  parking: false, showers: false, master45: false },
  { id: 'g3',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 1)), time: '7:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  womenOnly: false, openSpots: 2, price: 10, parking: true,  showers: true,  master45: false },
  { id: 'g4',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 1)), time: '7:30',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 0, price: 8,  parking: false, showers: false, master45: false },
  { id: 'g5',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 1)), time: '8:00',  ampm: 'PM', field: 'La Satalia',        format: '6v6', filmed: false, covered: false, womenOnly: false, openSpots: 1, price: 7,  parking: false, showers: false, master45: true  },

  // ── 2 mayo (Arequipa) ──────────────────────────────────────────────────────
  { id: 'g6',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 2)), time: '10:00', ampm: 'AM', field: 'La Satalia',        format: '6v6', filmed: false, covered: false, womenOnly: false, openSpots: 4, price: 7,  parking: false, showers: false, master45: false },
  { id: 'g7',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 2)), time: '5:00',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: true,  covered: false, womenOnly: false, openSpots: 0, price: 8,  parking: false, showers: true,  master45: false },
  { id: 'g8',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 2)), time: '6:30',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  womenOnly: false, openSpots: 2, price: 10, parking: true,  showers: true,  master45: false },
  { id: 'g9',  city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 2)), time: '7:00',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: false, covered: false, womenOnly: true,  openSpots: 1, price: 8,  parking: false, showers: false, master45: false },
  { id: 'g10', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 2)), time: '8:30',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 0, price: 9,  parking: false, showers: false, master45: false },

  // ── 3 mayo (Arequipa) — g11/g12 liberan 1 cupo a las 6:22 PM ──────────────
  { id: 'g11', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '6:20',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: true,  covered: false, womenOnly: false, get openSpots() { return new Date() >= MAY3_RELEASE ? 1 : 0; }, price: 9,  parking: false, showers: false, master45: false },
  { id: 'g12', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '6:20',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, womenOnly: false, get openSpots() { return new Date() >= MAY3_RELEASE ? 1 : 0; }, price: 8,  parking: false, showers: true,  master45: false },
  { id: 'g13', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '7:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  womenOnly: false, openSpots: 3, price: 10, parking: true,  showers: true,  master45: false },
  { id: 'g14', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '8:00',  ampm: 'PM', field: 'Ibèria',            format: '6v6', filmed: true,  covered: false, womenOnly: false, openSpots: 0, price: 7,  parking: false, showers: false, master45: false },
  { id: 'g15', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '9:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 2, price: 9,  parking: false, showers: false, master45: true  },
  { id: 'g26', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '6:46',  ampm: 'PM', field: 'Agapito Fernández', format: '6v6', filmed: false, covered: true,  womenOnly: false, openSpots: 0, price: 8,  parking: true,  showers: true,  master45: false },
  { id: 'g27', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '5:46',  ampm: 'PM', field: 'Ibèria',            format: '6v6', filmed: true,  covered: false, womenOnly: false, openSpots: 0, price: 7,  parking: false, showers: false, master45: false },
  { id: 'g28', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 3)), time: '6:50',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 1, price: 8,  parking: false, showers: true,  master45: false },

  // ── 4 mayo (Arequipa) ──────────────────────────────────────────────────────
  { id: 'g16', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 4)), time: '6:00',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 0, price: 8,  parking: false, showers: true,  master45: false },
  { id: 'g17', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 4)), time: '6:30',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: true,  covered: true,  womenOnly: false, openSpots: 4, price: 10, parking: true,  showers: true,  master45: false },
  { id: 'g18', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 4)), time: '7:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: true,  covered: false, womenOnly: false, openSpots: 0, price: 9,  parking: false, showers: false, master45: false },
  { id: 'g19', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 4)), time: '7:30',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: false, covered: false, womenOnly: true,  openSpots: 1, price: 8,  parking: false, showers: false, master45: false },
  { id: 'g20', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 4)), time: '8:00',  ampm: 'PM', field: 'Xaloc',             format: '6v6', filmed: false, covered: false, womenOnly: false, openSpots: 2, price: 7,  parking: false, showers: true,  master45: false },

  // ── 5 mayo (Arequipa) ──────────────────────────────────────────────────────
  { id: 'g21', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 5)), time: '11:00', ampm: 'AM', field: 'La Satalia',        format: '6v6', filmed: false, covered: false, womenOnly: false, openSpots: 3, price: 7,  parking: false, showers: false, master45: false },
  { id: 'g22', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 5)), time: '5:30',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  womenOnly: false, openSpots: 0, price: 10, parking: true,  showers: true,  master45: false },
  { id: 'g23', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 5)), time: '6:00',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: true,  covered: false, womenOnly: false, openSpots: 2, price: 8,  parking: false, showers: true,  master45: false },
  { id: 'g24', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 5)), time: '7:30',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 0, price: 9,  parking: false, showers: false, master45: true  },
  { id: 'g25', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 5)), time: '8:00',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 1, price: 8,  parking: false, showers: false, master45: false },

  // ── 7 mayo ─────────────────────────────────────────────────────────────────
  { id: 'mock-guest-001', city: 'Arequipa', dateKey: ymd(new Date(2026, 4, 7)), time: '7:00', ampm: 'PM', field: 'La Satalia', format: '7v7', filmed: true, covered: false, womenOnly: false, openSpots: 3, price: 25, parking: false, showers: false, master45: false },

  // ── Lima ────────────────────────────────────────────────────────────────────
  { id: 'g29', city: 'Lima', dateKey: ymd(new Date(2026, 4, 1)), time: '6:00',  ampm: 'PM', field: 'San Borja',  format: '7v7', filmed: false, covered: false, womenOnly: false, openSpots: 2, price: 9,  parking: true,  showers: true,  master45: false },
  { id: 'g30', city: 'Lima', dateKey: ymd(new Date(2026, 4, 2)), time: '7:00',  ampm: 'PM', field: 'Miraflores', format: '7v7', filmed: true,  covered: false, womenOnly: false, openSpots: 3, price: 10, parking: false, showers: false, master45: false },
];

export const FIELD_INFO = {
  'Xaloc':              { address: ['Xaloc - Cayma',      'Av. Ejemplo 123'] },
  'La Satalia':         { address: ['La Satalia',          'Carrer Eivissa 12'] },
  'Agapito Fernández':  { address: ['Agapito Fernández',   'Av. Túpac Amaru 540'] },
  'Ibèria':             { address: ['Ibèria',              'Carrer Mallorca 90'] },
};

export const DEMO_WAITLIST_IDS = ['g28'];
export function seedDemoWaitlist() {
  try {
    const wl = JSON.parse(localStorage.getItem('pichanga_waitlist')) || {};
    let changed = false;
    for (const id of DEMO_WAITLIST_IDS) {
      if (!wl[id]) { wl[id] = { gameId: id, userId: 'demo', joinedAt: '' }; changed = true; }
    }
    if (changed) localStorage.setItem('pichanga_waitlist', JSON.stringify(wl));
  } catch {}
}

export const GAME_DEFAULTS = {
  duration: '60 min',
  fieldNumber: 'Cancha 2',
  description: [
    'Un organizador les dará chalecos, pelota y ayudará a organizar los equipos.',
    'Los partidos son amistosos y abiertos para todos los niveles.',
    'Se espera que todos los jugadores roten el arco.',
  ],
  recommendations: [
    'Por favor llegar 15 minutos antes.',
    'Llevar una camiseta oscura.',
  ],
  organizer: { name: 'Juan León' },
  players: [
    { name: 'Carlos Pérez',   age: 28, position: 'MED'               },
    { name: 'Luis Ramos',     age: 32, position: 'DEF · ARQ'         },
    { name: 'Ana Torres',     age: 24, position: 'DEL · MED · DEF'   },
    { name: 'Diego Morales',  age: 27, position: 'DEL'               },
    { name: 'Pablo Suárez',   age: 35, position: 'ARQ'               },
    { name: 'Marco Vela',     age: 22, position: 'MED · DEF'         },
    { name: 'Andrés Quiroz',  age: 30, position: 'DEL · MED · DEF · ARQ' },
    { name: 'Felipe Ruiz',    age: 26, position: 'DEF'               },
    { name: 'Iván Castillo',  age: 29, position: 'DEL · MED'         },
    { name: 'Renato Díaz',    age: 31, position: 'MED · DEF · ARQ'   },
    { name: 'Sergio Pino',    age: 23, position: 'DEL · MED · DEF'   },
    { name: 'Tomás Vega',     age: 34, position: 'DEF · ARQ'         },
  ],
};
