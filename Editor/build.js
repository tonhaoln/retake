const fs = require('fs');
const path = require('path');
const d = f => path.join(__dirname, f);
let html = fs.readFileSync(d('retake-editor.html'), 'utf8');
const muxer = fs.readFileSync(d('mp4-muxer.js'), 'utf8');
const gifenc = 'var gifenc = (function(){ var exports = {};\n'
  + fs.readFileSync(d('gifenc.js'), 'utf8')
  + '\nreturn exports; })();';
const app = fs.readFileSync(d('app.js'), 'utf8');
html = html.replace('/* __MP4_MUXER__ */', () => muxer)
           .replace('/* __GIFENC__ */', () => gifenc)
           .replace('/* __APP__ */', () => app);
fs.writeFileSync(d('dist-retake-editor.html'), html);
console.log('built', html.length, 'bytes');
