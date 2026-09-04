// Dosya yükleme doğrulama — hem admin hem genel satın alma akışı için ortak.
// MIME bildirimine DEĞİL, gerçek dosya içeriğine (magic bytes) bakar.
const fs = require('fs');
const path = require('path');

const UPLOADS = path.join(__dirname, '..', '..', 'public', 'uploads');

function saveImage(dataUri, name) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUri || ''));
  if (!m) return { error: 'Only PNG, JPG or WEBP images are allowed.' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return { error: 'Max image size is 2 MB.' };
  const magicOk = (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xFF && buf[1] === 0xD8) ||
    (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
  if (!magicOk) return { error: 'File content does not match an allowed image type.' };
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const file = `${name}.${ext}`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { path: '/uploads/' + file };
}

function saveAudio(dataUri, name) {
  const m = /^data:audio\/(mpeg|mp3|ogg|wav);base64,(.+)$/.exec(String(dataUri || ''));
  if (!m) return { error: 'Only MP3, OGG or WAV audio is allowed. Upload legally cleared recordings only.' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12 * 1024 * 1024) return { error: 'Max audio size is 12 MB.' };
  const ext = m[1] === 'mpeg' ? 'mp3' : m[1];
  const file = `${name}.${ext}`;
  fs.mkdirSync(UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { path: '/uploads/' + file };
}

module.exports = { saveImage, saveAudio, UPLOADS };
