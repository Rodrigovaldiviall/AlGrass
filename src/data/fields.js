import { ymd } from './games';

const MAY3 = ymd(new Date(2026, 4, 3));
const MAY4 = ymd(new Date(2026, 4, 4));
const MAY5 = ymd(new Date(2026, 4, 5));
const MAY6 = ymd(new Date(2026, 4, 6));

export const FIELDS = [
  // 3 mayo (Arequipa)
  { id: 'c1',  city: 'Arequipa', dateKey: MAY3, time: '6:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: true,  covered: false, parking: false, showers: false, address: 'Av. Cayma 215',       price: 'S/.120', reserved: false },
  { id: 'c2',  city: 'Arequipa', dateKey: MAY3, time: '6:30',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.90',  reserved: true  },
  { id: 'c3',  city: 'Arequipa', dateKey: MAY3, time: '7:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: true,  covered: false, parking: false, showers: false, address: 'Av. Cayma 215',        price: 'S/.90',  reserved: false },
  { id: 'c4',  city: 'Arequipa', dateKey: MAY3, time: '7:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  parking: true,  showers: true,  address: 'Calle Lima 28',        price: 'S/.110', reserved: true  },
  { id: 'c9',  city: 'Arequipa', dateKey: MAY3, time: '10:00', ampm: 'AM', field: 'La Satalia',        format: '6v6', filmed: false, covered: false, parking: false, showers: false, address: 'Av. Cayma 215',        price: 'S/.75',  reserved: false },
  // 4 mayo (Arequipa)
  { id: 'c5',  city: 'Arequipa', dateKey: MAY4, time: '7:30',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: false, covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.100', reserved: false },
  { id: 'c6',  city: 'Arequipa', dateKey: MAY4, time: '8:00',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: true,  covered: false, parking: false, showers: false, address: 'Av. Callao 212',       price: 'S/.95',  reserved: true  },
  { id: 'c7',  city: 'Arequipa', dateKey: MAY4, time: '8:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  parking: true,  showers: true,  address: 'Calle Lima 28',        price: 'S/.120', reserved: false },
  { id: 'c10', city: 'Arequipa', dateKey: MAY4, time: '11:30', ampm: 'AM', field: 'Xaloc',             format: '7v7', filmed: true,  covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.90',  reserved: true  },
  { id: 'c11', city: 'Arequipa', dateKey: MAY4, time: '5:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: false, covered: true,  parking: true,  showers: true,  address: 'Calle Lima 28',        price: 'S/.110', reserved: false },
  { id: 'c16', city: 'Arequipa', dateKey: MAY4, time: '6:30',  ampm: 'PM', field: 'Xaloc',             format: '7v7', filmed: true,  covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.90',  reserved: false },
  // 5 mayo (Arequipa)
  { id: 'c8',  city: 'Arequipa', dateKey: MAY5, time: '8:30',  ampm: 'PM', field: 'Xaloc',             format: '6v6', filmed: false, covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.80',  reserved: false },
  { id: 'c12', city: 'Arequipa', dateKey: MAY5, time: '7:00',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: true,  covered: false, parking: false, showers: false, address: 'Av. Callao 212',       price: 'S/.95',  reserved: false },
  { id: 'c13', city: 'Arequipa', dateKey: MAY5, time: '7:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: false, covered: false, parking: false, showers: false, address: 'Av. Cayma 215',        price: 'S/.90',  reserved: false },
  { id: 'c17', city: 'Arequipa', dateKey: MAY5, time: '8:00',  ampm: 'PM', field: 'La Satalia',        format: '7v7', filmed: false, covered: false, parking: false, showers: false, address: 'Av. Cayma 215',        price: 'S/.120', reserved: false },
  // 6 mayo (Arequipa)
  { id: 'c14', city: 'Arequipa', dateKey: MAY6, time: '8:00',  ampm: 'PM', field: 'Xaloc',             format: '6v6', filmed: false, covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.80',  reserved: true  },
  { id: 'c15', city: 'Arequipa', dateKey: MAY6, time: '9:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: true,  covered: true,  parking: true,  showers: true,  address: 'Calle Lima 28',        price: 'S/.110', reserved: false },
  { id: 'c18', city: 'Arequipa', dateKey: MAY6, time: '7:30',  ampm: 'PM', field: 'Ibèria',            format: '7v7', filmed: false, covered: false, parking: false, showers: false, address: 'Av. Callao 212',       price: 'S/.95',  reserved: true  },
  { id: 'c19', city: 'Arequipa', dateKey: MAY6, time: '9:00',  ampm: 'PM', field: 'Agapito Fernández', format: '8v8', filmed: true,  covered: true,  parking: true,  showers: true,  address: 'Calle Lima 28',        price: 'S/.110', reserved: false },
  { id: 'c20', city: 'Arequipa', dateKey: MAY6, time: '7:00',  ampm: 'PM', field: 'Xaloc',             format: '6v6', filmed: false, covered: false, parking: false, showers: true,  address: 'Av. Primavera 314',    price: 'S/.80',  reserved: false },
  // Lima
  { id: 'c21', city: 'Lima', dateKey: MAY3, time: '6:00',  ampm: 'PM', field: 'San Borja',  format: '7v7', filmed: false, covered: false, parking: true,  showers: true,  address: 'Av. Javier Prado 420', price: 'S/.110', reserved: false },
  { id: 'c22', city: 'Lima', dateKey: MAY5, time: '7:30',  ampm: 'PM', field: 'Miraflores', format: '7v7', filmed: true,  covered: false, parking: false, showers: false, address: 'Av. Larco 180',        price: 'S/.95',  reserved: false },
];
