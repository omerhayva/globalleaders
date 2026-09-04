// React adacık paketini derler: public/js/react-app.js (kalıcı yol — "dist" gibi
// snapshot dışı klasör adları KULLANILMAZ).
// Kullanım:
//   npm run build:react            → tek seferlik derleme (üretim)
//   npm run watch:react            → değişiklik izleme (geliştirme)
const esbuild = require('esbuild');

const opts = {
  entryPoints: ['client/index.jsx'],
  bundle: true,
  minify: true,
  sourcemap: false,
  outfile: 'public/js/react-app.js',
  format: 'iife',
  target: ['es2019'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info'
};

const watch = process.argv.slice(2).some(a => a === '--watch' || a === '-w');

(async () => {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('👀 İzleme modu: client/** değiştikçe public/js/react-app.js yeniden derlenir (Ctrl+C ile çıkın)');
  } else {
    await esbuild.build(opts);
    console.log('✔ react-app.js derlendi → public/js/react-app.js');
  }
})().catch(e => { console.error(e); process.exit(1); });
