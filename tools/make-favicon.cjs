// One-off: renders favicon.svg to favicon-32.png with sharp (installed globally here, not an app dependency).
// The PNG is committed; nothing in the app or its deploy runs this.
//   node tools/make-favicon.cjs
const sharp = require('/opt/npm-tools/node_modules/sharp');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
sharp(path.join(root, 'favicon.svg'), { density: 384 })
  .resize(32, 32)
  .png()
  .toFile(path.join(root, 'favicon-32.png'))
  .then((info) => console.log('favicon-32.png', info.width + 'x' + info.height, info.size + ' bytes'));
