// =====================================================
// Leaderboard — localStorage-backed scores with ranking
// =====================================================

const STORAGE_KEY = 'sky_ace_leaderboard_v1';
const MAX_ENTRIES_PER_MODE = 20;

export const MODES = {
  ring:     { name: 'Ring Run',       scoreLabel: 'POINTS' },
  canyon:   { name: 'Canyon Dash',    scoreLabel: 'POINTS' },
  bomb:     { name: 'Precision Drop', scoreLabel: 'POINTS' },
  dogfight: { name: 'Dogfight',       scoreLabel: 'POINTS' },
  flux:     { name: 'Flux Run',       scoreLabel: 'POINTS' },
};

// Grade thresholds [C, B, A, S, SS] per mode.
// Calibrated by Phase C test engineer after measuring sloppy / clean / flawless
// reference runs via forceMinigame + scripted ticks (see tests/calibrate.spec.js).
//
// Measured reference scores:
//   ring:     sloppy(no-combo,all-perfects)=5599  clean/flawless(full-combo)=10293
//   canyon:   sloppy(no-combo)=2700  clean(full-combo)=6522
//   bomb:     sloppy(62u miss)≈900  clean(3 bullseyes+bonus)=3700
//   dogfight: sloppy(no-streak)=6611  flawless(full-streak)=9911
//   flux:     sloppy(bank-1-at-a-time)=3900  clean(bank-5)=4940  flawless(all-28)=11440
//
// Grade targets: sloppy ≈ B, clean ≈ A/S, flawless ≈ SS.
const THRESHOLDS = {
  ring:     [800,  2500,  5000,  8000, 10000],
  canyon:   [700,  1500,  3000,  5500,  7000],
  bomb:     [400,  1100,  2000,  2900,  3500],
  dogfight: [1500, 3500,  6000,  8000,  9500],
  flux:     [1500, 3000,  4500,  6000, 10000],
};

export function gradeFor(mode, score) {
  const t = THRESHOLDS[mode] || THRESHOLDS.ring;
  if (score >= t[4]) return 'SS';
  if (score >= t[3]) return 'S';
  if (score >= t[2]) return 'A';
  if (score >= t[1]) return 'B';
  if (score >= t[0]) return 'C';
  return 'D';
}

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAll(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

export function addScore(mode, score, meta = {}) {
  const data = loadAll();
  if (!data[mode]) data[mode] = [];
  const grade = gradeFor(mode, score);
  const entry = {
    score: Math.round(score),
    grade,
    date: new Date().toISOString(),
    ...meta,
  };
  data[mode].push(entry);
  data[mode].sort((a, b) => b.score - a.score);
  data[mode] = data[mode].slice(0, MAX_ENTRIES_PER_MODE);
  saveAll(data);
  const rank = data[mode].findIndex(e => e === entry) + 1;
  return { grade, rank, entry };
}

export function getScores(mode) {
  const data = loadAll();
  return data[mode] || [];
}

export function getOverall() {
  const data = loadAll();
  const all = [];
  for (const mode of Object.keys(MODES)) {
    for (const entry of (data[mode] || [])) {
      all.push({ ...entry, mode });
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, MAX_ENTRIES_PER_MODE);
}

export function clearAll() {
  saveAll({});
}

export function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
