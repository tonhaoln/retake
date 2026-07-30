const fs = require('fs');
let html = fs.readFileSync('openstudio-editor.html', 'utf8');
const muxer = fs.readFileSync('mp4-muxer.js', 'utf8');
const gifenc = 'var gifenc = (function(){ var exports = {};\n'
  + fs.readFileSync('gifenc.js', 'utf8')
  + '\nreturn exports; })();';
const app = fs.readFileSync('app.js', 'utf8');
html = html.replace('/* __MP4_MUXER__ */', () => muxer)
           .replace('/* __GIFENC__ */', () => gifenc)
           .replace('/* __APP__ */', () => app);
fs.writeFileSync('dist-openstudio-editor.html', html);
console.log('built', html.length, 'bytes');
