/**
 * test/test-home-weather.js - The weather beside Glasshouse Home's clock:
 * read from Open-Meteo for the chosen place, kept and switched off again
 *
 * Strict ES5: runs on node 0.12.
 */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var weather = require('../server/lib/home-weather');

console.log('Running test-home-weather.js ...');

var dir = path.join(os.tmpdir(), 'gh-weather-' + process.pid);
fs.mkdirSync(dir);
var asked = [];
var answer = {
  current: { temperature_2m: 7.6, weather_code: 61, is_day: 1 },
  daily: { temperature_2m_max: [10.4], temperature_2m_min: [2.2] }
};
function getJson(url, cb) {
  asked.push(url);
  if (/geocoding/.test(url)) {
    return setTimeout(function () {
      cb(null, { results: [{ name: 'Warszawa', latitude: 52.22977, longitude: 21.01178, admin1: 'Mazowieckie', country: 'Polska' },
                           { name: 'Nowhere', latitude: 'x', longitude: 1 }] });
    }, 0);
  }
  setTimeout(function () { cb(null, answer); }, 0);
}
weather.init({ stateDir: dir, getJson: getJson });

assert.strictEqual(weather.view(), null, 'off until switched on');
assert.deepEqual(['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm'].map(function (k, i) {
  return weather._kindOf([0, 2, 3, 45, 80, 73, 95][i]) === k;
}), [true, true, true, true, true, true, true]);
console.log('  ✓ off until switched on; WMO codes as the kinds the view draws');

weather.search('Warszawa', 'pl', function (r) {
  assert.ok(/geocoding-api\.open-meteo\.com\/v1\/search\?name=Warszawa&count=8&format=json&language=pl/.test(asked[0]));
  assert.deepEqual(r.places, [{ name: 'Warszawa', lat: 52.2298, lon: 21.0118, detail: 'Mazowieckie, Polska' }], 'a place without coordinates is left out');
  weather.set({ place: { name: 'Nowhere', lat: 200, lon: 0 } }, function (bad) {
    assert.strictEqual(bad.ok, false, 'a latitude out of range is refused');
    weather.set({ on: true, place: r.places[0] }, function (ok) {
      assert.ok(ok.ok);
      // The reading set() starts answers on the next turn.
      setTimeout(function () {
        assert.ok(/api\.open-meteo\.com\/v1\/forecast\?latitude=52\.2298&longitude=21\.0118&current=/.test(asked[1]));
        assert.deepEqual(weather.view(), { place: 'Warszawa', temp: 8, kind: 'rain', day: true, high: 10, low: 2, units: 'c' });
        console.log('  ✓ a place found by name, and now and today\'s range read for it');

        weather.init({ stateDir: dir, getJson: getJson });
        assert.deepEqual(weather.status().place, r.places[0], 'the place is kept');
        weather.set({ units: 'f' }, function () {
          setTimeout(function () {
            assert.ok(/temperature_unit=fahrenheit/.test(asked[asked.length - 1]), 'units are asked for');
            weather.set({ on: false }, function () {
              assert.strictEqual(weather.view(), null);
              fs.unlinkSync(path.join(dir, 'home-weather.json'));
              fs.rmdirSync(dir);
              console.log('  ✓ kept over a restart, read again in Fahrenheit, and gone when switched off');
              console.log('\nALL test-home-weather.js assertions passed!');
            });
          }, 5);
        });
      }, 5);
    });
  });
});
