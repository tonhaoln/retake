const fs = require('fs');
const path = require('path');
const d = f => path.join(__dirname, f);
let html = fs.readFileSync(d('retake-editor.html'), 'utf8');
const muxer = '/* mp4-muxer — (c) Vanilagy, MIT. https://github.com/Vanilagy/mp4-muxer (see NOTICE) */\n'
  + fs.readFileSync(d('mp4-muxer.js'), 'utf8');
const gifenc = '/* gifenc — (c) Matt DesLauriers, MIT. https://github.com/mattdesl/gifenc (see NOTICE) */\n'
  + 'var gifenc = (function(){ var exports = {};\n'
  + fs.readFileSync(d('gifenc.js'), 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '')
  + '\nreturn exports; })();';
const app = fs.readFileSync(d('app.js'), 'utf8');
html = html.replace('/* __MP4_MUXER__ */', () => muxer)
           .replace('/* __GIFENC__ */', () => gifenc)
           .replace('/* __APP__ */', () => app);
fs.writeFileSync(d('dist-retake-editor.html'), html);
console.log('built', html.length, 'bytes');
