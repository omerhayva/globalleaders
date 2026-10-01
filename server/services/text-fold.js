// Arama için metin katlama (folding).
//
// Amaç: "erdogan" yazan kullanıcı "Recep Tayyip Erdoğan"ı, "suleyman" yazan
// "Süleyman"ı bulabilsin. Aksanlı/özel harfler ASCII karşılığına indirilir,
// büyük/küçük harf farkı kaldırılır. NFD ayrıştırması çoğu dili kapsar;
// Türkçe ı/İ, ø, ł, đ, ß gibi ayrışmayan harfler ayrıca eşlenir.
const SPECIAL = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u',
  ø: 'o', Ø: 'o', å: 'a', Å: 'a', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ß: 'ss',
  ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ð: 'd', þ: 'th', ñ: 'n', Ñ: 'n',
  ș: 's', Ș: 's', ț: 't', Ț: 't', ć: 'c', Ć: 'c', č: 'c', Č: 'c', ž: 'z', Ž: 'z', ś: 's', Ś: 's', ż: 'z', Ż: 'z', ń: 'n', Ń: 'n', ă: 'a', Ă: 'a', â: 'a', Â: 'a', î: 'i', Î: 'i', ș: 's'
};

function fold(value) {
  let s = String(value || '');
  s = s.replace(/[^\u0000-\u007F]/g, ch => SPECIAL[ch] !== undefined ? SPECIAL[ch] : ch);
  try {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch { /* normalize desteklenmiyorsa yukarıdaki tablo yeterli */ }
  return s.toLowerCase().trim();
}

module.exports = { fold };
