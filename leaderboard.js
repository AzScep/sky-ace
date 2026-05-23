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
};

// Grade thresholds (per-mode) used to convert raw scores to S/A/B/C/D
const THRESHOLDS = {
  ring:     [400, 800, 1400, 2200, 3200], // D, C, B, A, S, SS
  canyon:   [300, 600, 1000, 1600, 2400],
  bomb:     [200, 500, 900, 1500, 2200],
  dogfight: [300, 700, 1200, 2000, 3000],
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
