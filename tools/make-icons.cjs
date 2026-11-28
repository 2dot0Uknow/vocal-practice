// One-off: renders the app icons from favicon.svg with sharp (installed globally here, not an app dependency).
// The PNGs in icons/ are committed; nothing in the app or its deploy runs this.
//   node tools/make-icons.cjs
// icon-192.png and icon-512.png are the sun mark as it is in favicon.svg.
// icon-maskable-512.png fills the whole square with the page colour and shrinks the sun to 80% so it stays inside
// the circle Android may crop to (the "safe zone" is the middle 80%).
const sharp = require('/opt/npm-tools/node_modules/sharp');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const favicon = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8');
const drawing = favicon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');   // the defs and shapes inside the svg tag
const withoutBackground = drawing.replace(/<rect[^>]*\/>/, '');
const BACKGROUND = '#fdfbf7';
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BACKGROUND}"/><g transform="translate(32 32) scale(.8) translate(-32 -32)">${withoutBackground}</g></svg>`;

const jobs = [
  ['icon-192.png', Buffer.from(favicon), 192],
  ['icon-512.png', Buffer.from(favicon), 512],
  ['icon-maskable-512.png', Buffer.from(maskable), 512],
];
fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
Promise.all(jobs.map(([name, svg, size]) => sharp(svg, { density: 72 * (size / 64) * 2 })
  .resize(size, size)
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'icons', name))
  .then((info) => console.log(name, info.width + 'x' + info.height, info.size + ' bytes'))));
