/**
 * test/test-home-theme.js - Hearth themes on Glasshouse Home: a zip is
 * checked as Hearth checks it, kept, put on the apps and taken off again
 *
 * Strict ES5: runs on node 0.12.
 */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
var theme = require('../server/lib/home-theme');

console.log('Running test-home-theme.js ...');

// A zip of { name: text or Buffer }, deflated, as Hearth's export writes one.
function zip(files, statedSize) {
  var parts = [], dir = [], off = 0;
  Object.keys(files).forEach(function (name) {
    var data = Buffer.isBuffer(files[name]) ? files[name] : new Buffer(files[name]);
    var packed = zlib.deflateRawSync(data), nb = new Buffer(name);
    var local = new Buffer(30);
    local.fill(0);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(statedSize || data.length, 22);
    local.writeUInt16LE(nb.length, 26);
    parts.push(local, nb, packed);
    var central = new Buffer(46);
    central.fill(0);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(statedSize || data.length, 24);
    central.writeUInt16LE(nb.length, 28);
    central.writeUInt32LE(off, 42);
    dir.push(central, nb);
    off += 30 + nb.length + packed.length;
  });
  var cd = Buffer.concat(dir), end = new Buffer(22), n = Object.keys(files).length;
  end.fill(0);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(n, 8);
  end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

var PNG = new Buffer('89504e470d0a1a0a', 'hex');
var FULL = {
  format: 1, name: 'Teal night', author: 'Someone',
  colors: { theme: 'teal', widget: 'amber', icon: 'warm' },
  fonts: { files: [{ id: 'my-font', label: 'My font', file: 'fonts/my.woff2' }], widget: 'my-font', names: 'inter' },
  iconStyle: { style: 'mono', tile: 'dark' },
  wallpaper: { folder: 'wallpaper', intervalSec: 30, shuffle: true },
  icons: [{ app: 'netflix', file: 'icons/netflix.png' }],
  apps: [{ id: 'youtube.leanback.v4', name: 'Videos' }, { id: 'netflix' }],
  cities: [{ name: 'Delhi', lat: 28.6, lon: 77.2, detail: 'India' }]
};
function fullZip(manifest) {
  return zip({
    'manifest.json': JSON.stringify(manifest || FULL), 'theme-guide.md': '# notes',
    'fonts/my.woff2': 'font', 'icons/netflix.png': PNG,
    'wallpaper/b.jpg': 'jpg', 'wallpaper/a.png': PNG, 'wallpaper/old/c.jpg': 'jpg'
  });
}

function step1(parsed) {
assert.ok(!parsed.errors, JSON.stringify(parsed.errors));
var th = parsed.theme;
assert.deepEqual(th.colours, { bg: '#08191b', accent: '#6fd3cc', text: '#ffb74d' });
assert.deepEqual(th.fonts, { files: [{ id: 'my-font', file: 'fonts/my.woff2' }], widget: 'my-font', names: null });
assert.deepEqual(th.wallpaper, { files: ['wallpaper/a.png', 'wallpaper/b.jpg'], intervalSec: 30, shuffle: true });
assert.deepEqual(th.order, ['youtube.leanback.v4', 'netflix']);
assert.deepEqual(th.names, { 'youtube.leanback.v4': 'Videos' });
assert.deepEqual(th.icons, { netflix: 'icons/netflix.png' });
assert.deepEqual(th.ignored, ['colors.icon', 'fonts.names (inter)', 'iconStyle', 'cities']);
console.log('  ✓ a full theme: its palette, fonts, slideshow (pictures directly in the folder), apps and icons');
step2(parsed);
}

var REFUSED = [
  [{ 'theme/manifest.json': '{}' }, 'manifest.json is not at the top'],
  [{ 'manifest.json': '{', 'a.txt': '' }, 'not valid JSON'],
  [manifest({ format: 2, name: 'x' }), '"format" must be 1'],
  [manifest({ format: 1, name: 'x', colour: {} }), 'unknown key "colour"'],
  [manifest({ format: 1, name: 'x', colors: { widget: 'white', widgetInk: '#ffffff' } }), 'not both'],
  [manifest({ format: 1, name: 'x', icons: [{ app: 'netflix', file: 'icons/none.png' }] }), 'is not in the zip'],
  [{ 'manifest.json': JSON.stringify({ format: 1, name: 'x' }), 'run.sh': 'echo' }, 'run.sh: not allowed'],
  [{ 'manifest.json': JSON.stringify({ format: 1, name: 'x' }), '../evil.png': PNG }, 'not a plain relative path'],
  [{ 'manifest.json': JSON.stringify({ format: 1, name: 'x' }), 'page.html': '<script>' }, 'page.html: not allowed']
];
function manifest(m) { return { 'manifest.json': JSON.stringify(m) }; }
function refusedAll(i, done) {
  if (i >= REFUSED.length) return done();
  theme.parse(zip(REFUSED[i][0]), function (r) {
    var why = REFUSED[i][1];
    assert.ok(r.errors && r.errors.join('\n').indexOf(why) !== -1, why + ' in ' + JSON.stringify(r.errors));
    refusedAll(i + 1, done);
  });
}
function step2(parsed) {
  refusedAll(0, function () {
    theme.parse(new Buffer('not a zip at all, longer than a header'), function (r) {
      assert.deepEqual(r.errors, ['not a zip file']);
      var mac = zip({ 'manifest.json': JSON.stringify({ format: 1, name: 'x' }), '__MACOSX/._manifest.json': 'x', '.DS_Store': 'x' });
      theme.parse(mac, function (r2) {
        assert.ok(!r2.errors, 'what macOS adds to a zip is passed over');
        var big = new Buffer(20 * 1024 * 1024);
        big.fill(0);
        theme.parse(zip({ 'manifest.json': JSON.stringify({ format: 1, name: 'x' }), 'bomb.png': big }, 10), function (r3) {
          assert.ok(r3.errors && r3.errors.join('\n').indexOf('bomb.png: unpacks to more than it states') !== -1, JSON.stringify(r3.errors));
          console.log('  ✓ refused as Hearth refuses: unknown keys, missing files, scripts and pages, paths out of the zip');
          console.log('  ✓ an entry unpacking to more than its stated size is stopped (a zip bomb)');
          step3(parsed);
        });
      });
    });
  });
}

function step3(parsed) {
  var dir = path.join(os.tmpdir(), 'gh-theme-' + process.pid);
fs.mkdirSync(dir);
var themesDir = path.join(dir, 'themes');
fs.mkdirSync(themesDir);
fs.writeFileSync(path.join(themesDir, 'teal.zip'), fullZip());
fs.writeFileSync(path.join(themesDir, 'notes.txt'), 'x');
theme.init({ stateDir: dir, themesDir: themesDir });
assert.strictEqual(theme.current(), null);
theme.store(parsed, 'teal.zip', { colours: null, order: ['netflix'] });
assert.strictEqual(fs.readFileSync(theme.filePath('fonts/my.woff2'), 'utf8'), 'font');
assert.strictEqual(theme.filePath('theme-guide.md'), null, 'notes are not kept');
assert.strictEqual(theme.filePath('../theme.json'), null);
assert.strictEqual(theme.filePath('wallpaper/old/c.jpg'), null, 'a picture the theme does not use is not served');
var apps = theme.dressApps([{ id: 'netflix', title: 'Netflix', icon: '/api/home/icon?id=netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube', icon: null }, { id: 'other', title: 'Other' }]);
assert.ok(/^\/api\/home\/theme\/file\?path=icons%2Fnetflix\.png&v=/.test(apps[0].icon));
assert.strictEqual(apps[1].title, 'Videos');
assert.deepEqual(apps[2], { id: 'other', title: 'Other' });
var v = theme.view();
assert.strictEqual(v.bg, '#08191b');
assert.deepEqual(v.fonts.map(function (f) { return f.format; }), ['woff2']);
assert.strictEqual(v.wallpaper.urls.length, 2);
assert.strictEqual(theme.summary().source, 'teal.zip');
console.log('  ✓ kept with only the files it uses, its names and icons on the apps it names');

theme.init({ stateDir: dir, themesDir: themesDir });
assert.strictEqual(theme.current().theme.name, 'Teal night', 'read back after a restart');
theme.listZips(function (zips) {
  assert.deepEqual(zips.map(function (z) { return z.name; }), ['teal.zip']);
  theme.readZip('../teal.zip', function (err) {
    assert.ok(err, 'only a plain name in the themes folder');
    assert.deepEqual(theme.clear(), { colours: null, order: ['netflix'] });
    assert.strictEqual(theme.current(), null);
    assert.ok(!fs.existsSync(path.join(dir, 'home-theme')));
    assert.strictEqual(theme.dressApps([{ id: 'netflix', title: 'Netflix' }])[0].title, 'Netflix');
    console.log('  ✓ the zips in Hearth\'s folder are offered by name, and clearing gives back what the theme replaced');
    fs.unlinkSync(path.join(themesDir, 'teal.zip'));
    fs.unlinkSync(path.join(themesDir, 'notes.txt'));
    fs.rmdirSync(themesDir);
    fs.rmdirSync(dir);
    console.log('\nALL test-home-theme.js assertions passed!');
  });
});
}

theme.parse(fullZip(), step1);
