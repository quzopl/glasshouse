/*
 * lib/home-weather.js - the weather beside Glasshouse Home's clock.
 *
 * From Open-Meteo (open-meteo.com), which needs no key: the temperature and
 * conditions now and today's high and low for one place, read when the view
 * asks and at most every 20 minutes. The place is chosen on the dashboards,
 * found by name with Open-Meteo's geocoding, or taken from a Hearth theme's
 * cities. Kept in stateDir/home-weather.json as { on, place, units }.
 *
 * Strict ES5: runs on node 0.12.
 */
var fs = require('fs');
var path = require('path');
var fetchMod = require('./fetch');
var util = require('./util');

var stateDir = '/var/lib/tvweb';
var getJson = fetchMod.getJson;
var REFRESH_MS = 20 * 60 * 1000;
// A failed read is tried again sooner, but not on every heartbeat.
var RETRY_MS = 2 * 60 * 1000;

var settings = null, now = null, readAt = 0, reading = false, failedAt = 0, revision = 0;

function file() { return path.join(stateDir, 'home-weather.json'); }

function validPlace(p) {
  if (!p || typeof p.name !== 'string' || !p.name || p.name.length > 80) return null;
  var lat = Number(p.lat), lon = Number(p.lon);
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  var out = { name: p.name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
  if (typeof p.detail === 'string' && p.detail.length <= 120) out.detail = p.detail;
  return out;
}

function read() {
  if (settings) return settings;
  var raw = null;
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) {}
  settings = {
    on: !!(raw && raw.on === true),
    place: raw ? validPlace(raw.place) : null,
    units: raw && raw.units === 'f' ? 'f' : 'c'
  };
  return settings;
}

/*
 * Changes what was sent: { on, place, units }. A new place drops the
 * reading of the old one.
 */
function set(body, cb) {
  var s = read(), next = { on: s.on, place: s.place, units: s.units };
  if (body && typeof body.on === 'boolean') next.on = body.on;
  if (body && body.place !== undefined) {
    next.place = body.place === null ? null : validPlace(body.place);
    if (body.place !== null && !next.place) return cb({ ok: false, error: 'not a place' });
  }
  if (body && (body.units === 'c' || body.units === 'f')) next.units = body.units;
  try { util.writeJsonAtomic(file(), next); }
  catch (e) { return cb({ ok: false, error: e.message }); }
  var moved = JSON.stringify(next.place) !== JSON.stringify(s.place) || next.units !== s.units;
  settings = next;
  revision++;
  if (moved) { now = null; readAt = 0; failedAt = 0; }
  if (next.on && next.place) refresh();
  cb({ ok: true, weather: status() });
}

// Open-Meteo's WMO weather code as one of the kinds the view draws.
function kindOf(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

function refresh(cb) {
  var s = read();
  if (!s.on || !s.place || reading) return cb && cb();
  reading = true;
  var place = s.place;
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=1' + (s.units === 'f' ? '&temperature_unit=fahrenheit' : '');
  getJson(url, function (err, doc) {
    reading = false;
    // Answered for a place since changed.
    if (read().place !== place) return cb && cb();
    var cur = doc && doc.current, day = doc && doc.daily;
    if (err || !cur || typeof cur.temperature_2m !== 'number') {
      failedAt = Date.now();
      if (err) console.log('home: weather not read: ' + err.message);
      return cb && cb();
    }
    now = {
      temp: Math.round(cur.temperature_2m),
      kind: kindOf(cur.weather_code),
      day: cur.is_day !== 0,
      high: day && day.temperature_2m_max ? Math.round(day.temperature_2m_max[0]) : null,
      low: day && day.temperature_2m_min ? Math.round(day.temperature_2m_min[0]) : null
    };
    readAt = Date.now();
    failedAt = 0;
    revision++;
    if (cb) cb();
  });
}

// Read again when due; called as the view beats.
function tick() {
  var s = read(), t = Date.now();
  if (!s.on || !s.place || reading) return;
  if (failedAt && t - failedAt < RETRY_MS) return;
  if (!readAt || t - readAt >= REFRESH_MS) refresh();
}

// What the view draws: null while off, without a place or not read yet.
function view() {
  var s = read();
  tick();
  if (!s.on || !s.place || !now) return null;
  return { place: s.place.name, temp: now.temp, kind: now.kind, day: now.day, high: now.high, low: now.low, units: s.units };
}

// For the dashboards.
function status() {
  var s = read();
  return { on: s.on, place: s.place, units: s.units, now: s.on && s.place ? now : null, readAt: readAt || null };
}

/*
 * Places by name, from Open-Meteo's geocoding, for the dashboards' picker:
 * the place, its region and country.
 */
function search(query, lang, cb) {
  var q = String(query || '').trim().slice(0, 60);
  if (q.length < 2) return cb({ ok: true, places: [] });
  var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) +
    '&count=8&format=json&language=' + (/^[a-z]{2}$/.test(lang) ? lang : 'en');
  getJson(url, function (err, doc) {
    if (err) return cb({ ok: false, error: err.message });
    var places = ((doc && doc.results) || []).map(function (r) {
      return validPlace({ name: r.name, lat: r.latitude, lon: r.longitude,
        detail: [r.admin1, r.country].filter(function (x) { return x; }).join(', ') });
    }).filter(function (p) { return p; });
    cb({ ok: true, places: places });
  });
}

function weatherRevision() { return revision; }

function init(opts) {
  opts = opts || {};
  if (opts.stateDir) stateDir = opts.stateDir;
  if (opts.getJson) getJson = opts.getJson;
  settings = null;
  now = null;
  readAt = 0;
  failedAt = 0;
}

module.exports = {
  init: init,
  set: set,
  view: view,
  status: status,
  search: search,
  refresh: refresh,
  revision: weatherRevision,
  _kindOf: kindOf
};
