// Seeding: countries, categories, leaders, demo votes, rank history, ads, settings.
// All seeded votes are type='demo' and can be wiped from the admin panel before production.
const db = require('./db');
const LEADERS = require('./data/leaders-seed');

const ANTHEMS = {
  TR:'İstiklal Marşı', US:'The Star-Spangled Banner', GB:'God Save the King', FR:'La Marseillaise',
  DE:'Deutschlandlied', IT:'Il Canto degli Italiani', ES:'Marcha Real', RU:'State Anthem of the Russian Federation',
  CN:'March of the Volunteers', IN:'Jana Gana Mana', JP:'Kimigayo', KR:'Aegukga', BR:'Hino Nacional Brasileiro',
  MX:'Himno Nacional Mexicano', AR:'Himno Nacional Argentino', ZA:'National Anthem of South Africa',
  EG:'Bilady, Bilady, Bilady', SA:'Aash Al Maleek', AE:'Ishy Bilady', GR:'Hymn to Liberty', NL:'Wilhelmus',
  SE:'Du gamla, Du fria', PL:'Mazurek Dąbrowskiego', UA:'Shche ne vmerla Ukrainy', IE:'Amhrán na bhFiann',
  CA:'O Canada', AU:'Advance Australia Fair', NZ:'God Defend New Zealand', ID:'Indonesia Raya',
  MY:'Negaraku', SG:'Majulah Singapura', PH:'Lupang Hinirang', VN:'Tiến Quân Ca', TH:'Phleng Chat Thai',
  PK:'Qaumī Tarānah', BD:'Amar Sonar Bangla', IR:'National Anthem of Iran', IQ:'Mawtini', IL:'Hatikvah',
  JO:'Al-Salam Al-Malaki Al-Urduni', TN:'Humat al-Hima', GH:'God Bless Our Homeland Ghana', ET:'March Forward, Dear Mother Ethiopia',
  TZ:'Mungu ibariki Afrika', BF:'Une Seule Nuit', ML:'Le Mali', KE:'Ee Mungu Nguvu Yetu', LR:'All Hail, Liberia, Hail!',
  RW:'Rwanda Nziza', NG:'Nigeria, We Hail Thee', CD:'Debout Congolais', MN:'National Anthem of Mongolia',
  UZ:'State Anthem of Uzbekistan', CZ:'Kde domov můj', RS:'Bože pravde', CU:'La Bayamesa', VE:'Gloria al Bravo Pueblo',
  PE:'Himno Nacional del Perú', CL:'Himno Nacional de Chile', MM:'Kaba Ma Kyei', KP:'Aegukka'
};

const CATEGORIES = [
  ['all','All Leaders',0],['current','Current Leaders',1],['historical','Historical Leaders',2],
  ['presidents','Presidents',3],['prime-ministers','Prime Ministers',4],['monarchs','Monarchs',5],
  ['revolutionaries','Revolutionaries',6],['military','Military Leaders',7],
  ['political','Political Leaders',8],['influential','Influential Leaders',9],
];

const slugify = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

function dayStr(offset = 0) {
  const d = new Date(Date.now() - offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function seedAll({ withDemoVotes = false } = {}) {
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

  const tx = db.transaction(() => {
    // categories
    const insCat = db.prepare('INSERT OR REPLACE INTO categories (id,name,sort) VALUES (?,?,?)');
    CATEGORIES.forEach(c => insCat.run(...c));

    // countries
    const codes = [...new Set(LEADERS.map(l => l.cc))];
    const insCountry = db.prepare('INSERT OR IGNORE INTO countries (code,name,anthem_title) VALUES (?,?,?)');
    codes.forEach(cc => insCountry.run(cc, regionNames.of(cc) || cc, ANTHEMS[cc] || 'National Anthem'));

    // leaders
    const insLeader = db.prepare(`INSERT OR IGNORE INTO leaders
      (slug,name,country_code,status,categories,era,years,title,bio) VALUES (?,?,?,?,?,?,?,?,?)`);
    LEADERS.forEach(l => insLeader.run(slugify(l.name), l.name, l.cc, l.status,
      JSON.stringify(l.cats), l.era, l.years, l.title, l.bio));

    // ad slots
    const insSlot = db.prepare('INSERT OR IGNORE INTO advertising_slots (id,label,price_usd) VALUES (?,?,5.0)');
    [['top-left','Top Left'],['top-right','Top Right'],['bottom-left','Bottom Left'],['bottom-right','Bottom Right']]
      .forEach(([id,label]) => insSlot.run(id,label));

    // settings
    const insSet = db.prepare('INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)');
  insSet.run('demo_mode','0');
insSet.run('admin_password','leaders2026');
insSet.run('simulator_enabled','0');
insSet.run('free_votes_per_day','1');
insSet.run('max_bonus_per_day','3');

    if (withDemoVotes) seedDemoVotes();
  });
  tx();
}

// Give every leader a realistic vote base (weight * noise), spread over 30 days.
// Everything is type='demo' so it can be wiped in one click.
function seedDemoVotes() {
  const leaders = db.prepare('SELECT id, slug, country_code FROM leaders').all();
  const weights = Object.fromEntries(LEADERS.map(l => [slugify(l.name), l.weight]));
  const updVotes = db.prepare('UPDATE leaders SET total_votes = ? WHERE id = ?');
  const insDaily = db.prepare('INSERT OR REPLACE INTO leader_daily_stats (leader_id,day,votes,shares) VALUES (?,?,?,?)');
  const insWeekly = db.prepare('INSERT OR REPLACE INTO leader_weekly_stats (leader_id,week,votes) VALUES (?,?,?)');
  const insVote = db.prepare(`INSERT INTO votes (leader_id,session_id,type,source,country,created_at) VALUES (?,?, 'demo','seed',?,?)`);
  const updCountry = db.prepare('UPDATE countries SET total_votes = total_votes + ? WHERE code = ?');

  for (const l of leaders) {
    const w = weights[l.slug] || 25;
    const base = Math.round(w * (38 + Math.random() * 28)); // realistic pre-launch scale (~1K–7K)
    let total = 0;
    const weekly = {};
    for (let d = 29; d >= 0; d--) {
      const trend = 1 + (Math.random() - 0.45) * 0.8;
      const dayVotes = Math.max(3, Math.round((base / 30) * trend * (0.4 + Math.random())));
      total += dayVotes;
      const day = dayStr(d);
      insDaily.run(l.id, day, dayVotes, Math.round(dayVotes * 0.06));
      const wk = day.slice(0, 8) + 'W';
      weekly[wk] = (weekly[wk] || 0) + dayVotes;
      // store a few representative raw demo vote rows for recent days (keeps table light)
      if (d < 2) {
        const rows = Math.min(40, Math.ceil(dayVotes / 50));
        for (let i = 0; i < rows; i++) {
          const ts = new Date(Date.now() - d * 86400000 - Math.random() * 86400000).toISOString().replace('T',' ').slice(0,19);
          insVote.run(l.id, 'seed', l.country_code, ts);
        }
      }
    }
    Object.entries(weekly).forEach(([wk, v]) => insWeekly.run(l.id, wk, v));
    updVotes.run(total, l.id);
    updCountry.run(total, l.country_code);
  }
  recomputeRanks(true);
  seedRankHistory();
}

function recomputeRanks(initial = false) {
  const rows = db.prepare(`SELECT id, rank FROM leaders WHERE visible=1 ORDER BY total_votes DESC, id ASC`).all();
  const upd = db.prepare('UPDATE leaders SET prev_rank = ?, rank = ? WHERE id = ?');
  const changes = [];
  rows.forEach((r, i) => {
    const newRank = i + 1;
    if (r.rank !== newRank) changes.push({ id: r.id, from: r.rank, to: newRank });
    upd.run(initial ? newRank : (r.rank ?? newRank), newRank, r.id);
  });
  return changes;
}

function seedRankHistory() {
  // Build 30 days of plausible rank history from daily stats cumulative sums.
  const leaders = db.prepare('SELECT id, total_votes FROM leaders').all();
  const daily = db.prepare('SELECT leader_id, day, votes FROM leader_daily_stats ORDER BY day').all();
  const byLeader = {};
  daily.forEach(r => { (byLeader[r.leader_id] ||= []).push(r); });
  const days = [...new Set(daily.map(r => r.day))].sort();
  const cum = {}; leaders.forEach(l => cum[l.id] = 0);
  const ins = db.prepare('INSERT OR REPLACE INTO leader_rank_history (leader_id,day,rank,votes) VALUES (?,?,?,?)');
  const perDay = {};
  daily.forEach(r => { (perDay[r.day] ||= []).push(r); });
  for (const day of days) {
    (perDay[day] || []).forEach(r => cum[r.leader_id] += r.votes);
    const order = leaders.map(l => ({ id: l.id, v: cum[l.id] })).sort((a, b) => b.v - a.v);
    order.forEach((o, i) => ins.run(o.id, day, i + 1, o.v));
  }
}

function clearDemoVotes() {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM votes WHERE type='demo'`).run();
    db.prepare('DELETE FROM leader_daily_stats').run();
    db.prepare('DELETE FROM leader_weekly_stats').run();
    db.prepare('DELETE FROM leader_rank_history').run();
    // recount from remaining real votes
    db.prepare('UPDATE leaders SET total_votes = (SELECT COUNT(*) FROM votes v WHERE v.leader_id = leaders.id)').run();
    db.prepare('UPDATE countries SET total_votes = (SELECT COALESCE(SUM(l.total_votes),0) FROM leaders l WHERE l.country_code = countries.code)').run();
    recomputeRanks(true);
  });
  tx();
}

function resetDemoData() {
  const tx = db.transaction(() => {
    ['votes','vote_sessions','bonus_votes','referrals','shares','leader_rank_history','leader_daily_stats',
     'leader_weekly_stats','advertisements','ad_purchases','anthem_purchases','anthem_history','payments',
     'activity_events','fraud_events'].forEach(t => db.prepare(`DELETE FROM ${t}`).run());
    db.prepare('DELETE FROM anthem_slots').run();
    db.prepare('UPDATE leaders SET total_votes=0, rank=NULL, prev_rank=NULL').run();
    db.prepare('UPDATE countries SET total_votes=0').run();
  });
  tx();
  seedDemoVotes();
}

module.exports = { seedAll, seedDemoVotes, clearDemoVotes, resetDemoData, recomputeRanks, slugify, dayStr };
