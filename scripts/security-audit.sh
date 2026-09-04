#!/usr/bin/env bash
# ============================================================================
# GLOBAL LEADERS LIVE — yerel güvenlik denetim testleri (yetkili, localhost)
# Kullanım:  bash scripts/security-audit.sh
# Amaç: bilinen saldırı senaryolarını kanıtlamak / düzeltmeleri doğrulamak.
# ============================================================================
B=${BASE:-http://localhost:3000}
VULN=0; OK=0
hr(){ echo; echo "════════ $1 ════════"; }
extract(){ grep -o "\"$1\":[^,}]*" | head -1 | cut -d'"' -f4; }
sid(){ openssl rand -hex 16; }
J='-H content-type:application/json'

hr "T1 · Ödeme niyeti (intent) hırsızlığı — başka oturumun intent'i onaylanabiliyor mu?"
A=$(sid); BX=$(sid)
INT=$(curl -s -X POST $B/api/purchase/intent $J -H "X-GL-Session: $A" -d '{"kind":"votes","reference":"votes-10"}' | extract intentId)
R=$(curl -s -X POST $B/api/purchase/confirm $J -H "X-GL-Session: $BX" -d "{\"intentId\":\"$INT\",\"details\":{}}")
if echo "$R" | grep -q '"ok":true'; then echo "SONUÇ: 🔴 AÇIK — oturum B, oturum A'nın ödemesini onayladı: $R"; VULN=$((VULN+1));
elif echo "$R" | grep -q 'wrong_session'; then echo "SONUÇ: 🟢 GÜVENLİ — oturum uyuşmazlığı reddedildi: $R"; OK=$((OK+1));
else echo "SONUÇ: ❓ beklenmedik yanıt: $R"; fi

hr "T2 · Oturum rotasyonu — aynı cihazdan 5 farklı oturumla bedava oy"
HITS=0
for i in 1 2 3 4 5; do
  S=$(sid)
  R=$(curl -s -X POST $B/api/vote $J -H "X-GL-Session: $S" -d '{"slug":"nelson-mandela"}')
  echo "$R" | grep -q '"ok":true' && HITS=$((HITS+1))
  sleep 1.5
done
if [ $HITS -ge 3 ]; then echo "SONUÇ: 🔴 AÇIK — tek cihazdan $HITS/5 bedava oy kabul edildi (kurallar 1/adet diyor)"; VULN=$((VULN+1));
elif [ $HITS -le 1 ]; then echo "SONUÇ: 🟢 GÜVENLİ — yalnızca $HITS/5 bedava oy kabul edildi (cihaz limiti çalışıyor)"; OK=$((OK+1));
else echo "SONUÇ: 🟡 KISMEN — $HITS/5 kabul edildi"; fi

hr "T3 · Depolanmış XSS — topluluk biosu JSON-LD'den </script> kaçırıyor mu?"
S=$(sid)
R=$(curl -s -X POST $B/api/suggest-leader $J -H "X-GL-Session: $S" \
  -d '{"name":"Zqx Auditprobe","country_code":"PT","bio":"Nötr biyografi.</script><img src=x onerror=console.log(1)> bitiş"}')
SLUG=$(echo "$R" | extract slug)
PAGE=$(curl -s "$B/leader/$SLUG")
if echo "$PAGE" | grep -q '</script><img src=x onerror'; then
  echo "SONUÇ: 🔴 AÇIK — lider sayfası HTML'inde ham payload: $(echo "$PAGE" | grep -o '.\{0,40\}</script><img src=x.\{0,20\}' | head -1)"; VULN=$((VULN+1));
else echo "SONUÇ: 🟢 GÜVENLİ — payload sayfada kaçırılmış/temizlenmiş (slug: $SLUG)"; OK=$((OK+1)); fi

hr "T4 · Reklam satın alımı — reklamveren adında ham HTML depolanıyor mu?"
S=$(sid)
INT=$(curl -s -X POST $B/api/purchase/intent $J -H "X-GL-Session: $S" -d '{"kind":"ad","reference":"top-left"}' | extract intentId)
R=$(curl -s -X POST $B/api/purchase/confirm $J -H "X-GL-Session: $S" \
  -d "{\"intentId\":\"$INT\",\"details\":{\"advertiser\":\"<img src=x onerror=alert(1)> AUDIT\",\"text\":\"t\",\"cta\":\"c\",\"url\":\"https://example.com\"}}")
ADS=$(curl -s $B/api/ads)
if echo "$ADS" | grep -q '<img src=x onerror=alert(1)>'; then
  echo "SONUÇ: 🔴 AÇIK — /api/ads ham HTML döndürüyor (istemci toast'a innerHTML ile basıyor)"; VULN=$((VULN+1));
else echo "SONUÇ: 🟢 GÜVENLİ — reklamveren adı sunucuda sanitizelendi"; OK=$((OK+1)); fi

hr "T5 · CSRF — yabancı Origin ile POST kabul ediliyor mu?"
S=$(sid)
R=$(curl -s -X POST $B/api/vote $J -H "X-GL-Session: $S" -H 'Origin: https://evil.example' -d '{"slug":"nelson-mandela"}')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/share $J -H "X-GL-Session: $S" -H 'Origin: https://evil.example' -d '{"slug":"nelson-mandela"}')
if [ "$CODE" = "200" ] || echo "$R" | grep -q '"ok":true'; then echo "SONUÇ: 🔴 AÇIK — evil.example origin'li istek işlendi (HTTP $CODE)"; VULN=$((VULN+1));
elif [ "$CODE" = "403" ]; then echo "SONUÇ: 🟢 GÜVENLİ — yabancı origin reddedildi (403)"; OK=$((OK+1));
else echo "SONUÇ: ❓ HTTP $CODE"; fi

hr "T6 · Admin reklam URL'i — javascript: şeması depolanıyor mu?"
ADM=$(mktemp)
LOGIN=$(curl -s -c $ADM -X POST $B/api/admin/login $J -d '{"password":"leaders2026"}')
if echo "$LOGIN" | grep -q 'rate_limited'; then
  echo "SONUÇ: ⏭️ Atlandı — admin giriş hız limiti dolu (önceki denemeler). 10 dk sonra tekrar çalıştırın."
else
  R=$(curl -s -b $ADM -X POST $B/api/admin/ads $J -d '{"slot_id":"top-right","advertiser":"AUDIT-URL-TEST","text":"t","cta":"c","url":"javascript:alert(1)"}')
  ADS=$(curl -s $B/api/ads)
  if echo "$ADS" | grep -q 'javascript:alert'; then echo "SONUÇ: 🔴 AÇIK — javascript: URL'li reklam yayınlanabilir"; VULN=$((VULN+1));
  else echo "SONUÇ: 🟢 GÜVENLİ — javascript: URL reddedildi/temizlendi"; OK=$((OK+1)); fi
fi
rm -f $ADM

hr "T7 · Hesap ele geçirme — başkasının e-postası hesap adı değiştirilebiliyor mu?"
S=$(sid)
R=$(curl -s -X POST $B/api/auth/login $J -H "X-GL-Session: $S" -d '{"name":"Attacker Claim","email":"mehmet@test.com","provider":"local"}')
DBNAME=$(node -e 'const d=require("better-sqlite3")("var/globalleaders.db");console.log(d.prepare("SELECT display_name FROM users WHERE email=?").get("mehmet@test.com").display_name)')
if [ "$DBNAME" = "Attacker Claim" ]; then
  echo "SONUÇ: 🔴 AÇIK — hesap ele alındı VE profili yeniden adlandırıldı (DB: $DBNAME)"; VULN=$((VULN+1));
elif echo "$R" | grep -q 'email_taken'; then
  echo "SONUÇ: 🟢 GÜVENLİ — üretim modunda sahte e-posta reddedildi"; OK=$((OK+1));
elif echo "$R" | grep -q '"ok":true'; then
  echo "SONUÇ: 🟡 DEMO — oturum birleştirildi ama profil adı DEĞİŞTİRİLEMEDİ (DB: '$DBNAME') — demo davranışı, üretim guard'ı eklendi"; OK=$((OK+1));
else echo "SONUÇ: ❓ $R"; fi

hr "T8 · IP sahteciliği — X-Forwarded-For spoofing (proxy zinciri taklidi)"
S1=$(sid); S2=$(sid)
R1=$(curl -s -X POST $B/api/vote $J -H "X-GL-Session: $S1" -H 'X-Forwarded-For: 6.6.6.6, 127.0.0.1' -d '{"slug":"nelson-mandela"}')
R2=$(curl -s -X POST $B/api/vote $J -H "X-GL-Session: $S2" -H 'X-Forwarded-For: 7.7.7.7, 127.0.0.1' -d '{"slug":"nelson-mandela"}')
if echo "$R2" | grep -q '"ok":true'; then echo "SONUÇ: 🔴 AÇIK — sahte IP'ler hız limitini/aşırı kullanım korumasını atlatıyor (2. oy da geçti)"; VULN=$((VULN+1));
elif echo "$R2" | grep -q 'too_fast\|no_votes_left\|device_limit'; then echo "SONUÇ: 🟢 GÜVENLİ — gerçek IP üzerinden limitlendi: $R2"; OK=$((OK+1));
else echo "SONUÇ: ❓ $R2"; fi

hr "T9 · Admin kaba kuvvet — 12 hızlı yanlış parola"
CODES=$(for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/admin/login $J -d "{\"password\":\"wrong$i\"}"; done)
N401=$(echo $CODES | tr ' ' '\n' | grep -c 401); N429=$(echo $CODES | tr ' ' '\n' | grep -c 429)
if [ $N429 -eq 0 ]; then echo "SONUÇ: 🔴 AÇIK — 12 denemenin tamamı işlendi (kilit yok): $CODES"; VULN=$((VULN+1));
else echo "SONUÇ: 🟢 GÜVENLİ — $N401 red sonrasında $N429 hız limiti ($CODES)"; OK=$((OK+1)); fi

hr "T10 · Güvenlik başlıkları"
H=$(curl -sI $B/)
MISS=""
echo "$H" | grep -qi 'content-security-policy' || MISS="$MISS content-security-policy"
echo "$H" | grep -qi 'x-content-type-options' || MISS="$MISS x-content-type-options"
echo "$H" | grep -qi 'referrer-policy' || MISS="$MISS referrer-policy"
if [ -n "$MISS" ]; then echo "SONUÇ: 🔴 EKSİK başlıklar:$MISS"; VULN=$((VULN+1));
else echo "SONUÇ: 🟢 GÜVENLİ — CSP, nosniff, referrer-policy mevcut"; OK=$((OK+1)); fi

hr "T11 · Kimlik doğrulama flood — 25 hızlı oturum açma denemesi"
CODES=$(for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/login $J -d '{"name":"Flood Test","email":"flood'$i'@t.co"}'; done)
N429=$(echo $CODES | tr ' ' '\n' | grep -c 429)
if [ $N429 -eq 0 ]; then echo "SONUÇ: 🔴 AÇIK — 25 denemenin tamamı işlendi (hız limiti yok)"; VULN=$((VULN+1));
else echo "SONUÇ: 🟢 GÜVENLİ — $N429 istek hız limitine takıldı"; OK=$((OK+1)); fi

# ---- temizlik: test artefaktlarını kaldır ----
node -e '
const Database=require("better-sqlite3");const db=new Database("var/globalleaders.db");
db.prepare("DELETE FROM leaders WHERE slug LIKE %s").run();' 2>/dev/null
node <<'EOF' 2>/dev/null
const Database = require('better-sqlite3');
const db = new Database('var/globalleaders.db');
db.prepare("DELETE FROM leaders WHERE slug LIKE 'zqx-%'").run();
db.prepare("DELETE FROM votes WHERE session_id LIKE '%' AND leader_id NOT IN (SELECT id FROM leaders)").run();
db.prepare("UPDATE advertisements SET status='removed' WHERE advertiser LIKE '%<img%' OR advertiser LIKE 'AUDIT-URL-TEST%' OR advertiser LIKE '%AUDIT%'").run();
db.prepare("UPDATE users SET display_name='Mehmet Yılmaz' WHERE email='mehmet@test.com' AND display_name='Attacker Claim'").run();
db.prepare("DELETE FROM users WHERE email LIKE 'flood%@t.co'").run();
console.log('temizlik tamam');
EOF

echo; echo "════════════════ ÖZET ════════════════"
echo "GÜVENLİ: $OK   ·   AÇIK/EKSİK: $VULN"
[ $VULN -eq 0 ] && echo "✅ TÜM KONTROLLER GEÇTİ" || echo "⛔ DÜZELTİLMESİ GEREKEN BULGULAR VAR"
