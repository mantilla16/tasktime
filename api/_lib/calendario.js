/* Calendario semanal: generación de semanas nuevas y festivos de Colombia.

   Las semanas empiezan en lunes. La etiqueta sigue el estilo del Excel
   ("Del 13 al 16"): del primer día hábil de la semana al sábado. El mes es el
   que contiene la mayoría de los días hábiles (el del miércoles). La
   cargabilidad por defecto son 44 h menos 8 h por cada festivo entre lunes y
   viernes; el gerente puede ajustarla después semana a semana. */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const HORAS_SEMANA = 44;
const HORAS_DIA = 8;

function iso(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function parse(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function nextMonday(d) {
  // 0 = domingo … 1 = lunes
  const dow = d.getUTCDay();
  const diff = dow === 1 ? 0 : (dow === 0 ? 1 : 8 - dow);
  return addDays(d, diff);
}

/* ---- festivos de Colombia (Ley 51 de 1983) ---- */

function easter(year) {
  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function festivosColombia(year) {
  const fijos = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]];
  const aLunes = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]];
  const out = {};
  fijos.forEach(function (md) { out[iso(new Date(Date.UTC(year, md[0] - 1, md[1])))] = true; });
  aLunes.forEach(function (md) { out[iso(nextMonday(new Date(Date.UTC(year, md[0] - 1, md[1]))))] = true; });
  const pascua = easter(year);
  out[iso(addDays(pascua, -3))] = true;              // Jueves Santo
  out[iso(addDays(pascua, -2))] = true;              // Viernes Santo
  out[iso(nextMonday(addDays(pascua, 43)))] = true;  // Ascensión
  out[iso(nextMonday(addDays(pascua, 64)))] = true;  // Corpus Christi
  out[iso(nextMonday(addDays(pascua, 71)))] = true;  // Sagrado Corazón
  return out;
}

const cacheFestivos = {};
function esFestivo(d) {
  const y = d.getUTCFullYear();
  if (!cacheFestivos[y]) cacheFestivos[y] = festivosColombia(y);
  return Boolean(cacheFestivos[y][iso(d)]);
}

/* ---- una semana a partir de su lunes ---- */

function semanaDesde(monday) {
  const dias = [];
  for (let i = 0; i < 6; i++) dias.push(addDays(monday, i));
  let festivos = 0;
  let primerHabil = null;
  for (let i = 0; i < 5; i++) {
    if (esFestivo(dias[i])) festivos++;
    else if (primerHabil === null) primerHabil = dias[i];
  }
  if (primerHabil === null) primerHabil = monday;
  const sabado = dias[5];
  return {
    start: iso(monday),
    label: 'Del ' + primerHabil.getUTCDate() + ' al ' + sabado.getUTCDate(),
    month: MESES[dias[2].getUTCMonth()],
    capacity: Math.max(0, HORAS_SEMANA - HORAS_DIA * festivos)
  };
}

/* Semanas nuevas desde el lunes siguiente a `lastStart` (o desde el lunes de
   `fromDate` si no hay semanas) hasta cubrir `untilDate`. */
function generarSemanas(lastStart, untilDate, fromDate) {
  const hasta = parse(untilDate);
  let lunes = lastStart ? addDays(parse(lastStart), 7) : nextMonday(parse(fromDate || untilDate));
  const out = [];
  while (lunes.getTime() <= hasta.getTime() && out.length < 520) {
    out.push(semanaDesde(lunes));
    lunes = addDays(lunes, 7);
  }
  return out;
}

module.exports = { MESES, festivosColombia, esFestivo, semanaDesde, generarSemanas };
