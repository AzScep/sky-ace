// =====================================================
// Progression — XP, levels, ranks, medals
// Pure ES module: no Three.js import, no DOM access.
// localStorage keys: sky_profile_v1 / sky_medals_v1
// Never touches sky_ace_leaderboard_v1.
// =====================================================

const PROFILE_KEY = 'sky_profile_v1';
const MEDALS_KEY  = 'sky_medals_v1';

// ---------------------------------------------------------------------------
// MEDALS — 12 achievements with XP rewards
// ---------------------------------------------------------------------------

/** @type {Array<{id:string,name:string,desc:string,xp:number}>} */
export const MEDALS = [
  { id: 'first-flight',  name: 'First Flight',      desc: 'Complete your first run.',                          xp: 50  },
  { id: 'splash-one',    name: 'Splash One',         desc: 'Score your first kill in Dogfight.',                xp: 50  },
  { id: 'bullseye',      name: 'Bullseye',           desc: 'Land your first bullseye charge.',                  xp: 75  },
  { id: 'thread-needle', name: 'Thread the Needle',  desc: 'Thread a ring dead-centre (perfect pass).',         xp: 100 },
  { id: 'ringmaster',    name: 'Ringmaster',         desc: 'Complete Ring Run.',                                xp: 100 },
  { id: 'pinpoint',      name: 'Pinpoint',           desc: 'Land a bullseye in Precision Drop.',                xp: 200 },
  { id: 'ace-in-a-day',  name: 'Ace in a Day',       desc: 'Build a 2-day consecutive play streak.',            xp: 250 },
  { id: 'untouchable',   name: 'Untouchable',        desc: 'Finish Dogfight without taking a hit.',             xp: 200 },
  { id: 'speed-demon',   name: 'Speed Demon',        desc: 'Finish Canyon Dash with 20+ seconds remaining.',   xp: 150 },
  { id: 'top-gun',       name: 'Top Gun',            desc: 'Destroy all 8 enemies in Dogfight.',               xp: 300 },
  { id: 'centurion',     name: 'Centurion',          desc: 'Complete 100 total runs.',                         xp: 200 },
  { id: 'legend',        name: 'Legend',             desc: 'Reach Sky Ace rank (level 26).',                   xp: 400 },
];

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

function _defaultProfile() {
  return {
    v: 1,
    xp: 0,
    level: 1,
    rankTitle: 'Cadet',
    plays:   { ring: 0, canyon: 0, bomb: 0, dogfight: 0, flux: 0 },
    best:    {},
    totals:  { score: 0, kills: 0, rings: 0, gates: 0, bullseyes: 0, lowPasses: 0, runs: 0, flightSec: 0 },
    streak:  { count: 0, lastDay: '' },
    unlocked: [],
    equipped: { skin: 'magenta', trail: 'off' },
    updatedAt: new Date().toISOString(),
  };
}

function _loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return _defaultProfile();
    const p = JSON.parse(raw);
    const def = _defaultProfile();
    // Merge stored data with defaults for forward-compatibility
    return {
      ...def,
      ...p,
      plays:    { ...def.plays,    ...(p.plays    || {}) },
      best:     { ...(p.best      || {}) },
      totals:   { ...def.totals,   ...(p.totals   || {}) },
      streak:   { ...def.streak,   ...(p.streak   || {}) },
      unlocked: Array.isArray(p.unlocked) ? p.unlocked : [],
      equipped: { ...def.equipped, ...(p.equipped || {}) },
    };
  } catch { return _defaultProfile(); }
}

function _saveProfile(p) {
  try {
    p.updatedAt = new Date().toISOString();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

// ---------------------------------------------------------------------------
// Medal helpers
// ---------------------------------------------------------------------------

function _loadMedals() {
  try {
    const raw = localStorage.getItem(MEDALS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function _saveMedals(medals) {
  try { localStorage.setItem(MEDALS_KEY, JSON.stringify(medals)); } catch {}
}

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Compute player level from cumulative XP.
 * Cost to advance level L-1 → L = 300 + 150*(L-1).  No cap.
 * @param {number} xp
 * @returns {number} level (≥1)
 */
export function levelFromXp(xp) {
  let level     = 1;
  let remaining = Number(xp) || 0;
  while (true) {
    // For destination level = level+1 (L), cost = 300 + 150*(L-1) = 300 + 150*level
    const cost = 300 + 150 * level;
    if (remaining >= cost) {
      remaining -= cost;
      level++;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Human-readable rank title for a given level.
 * @param {number} level
 * @returns {string}
 */
export function rankTitle(level) {
  const l = Number(level) || 1;
  if (l >= 26) return 'Sky Ace';
  if (l >= 19) return 'Legend';
  if (l >= 14) return 'Veteran';
  if (l >= 10) return 'Ace';
  if (l >= 7)  return 'Aviator';
  if (l >= 5)  return 'Wingman';
  if (l >= 3)  return 'Pilot';
  return 'Cadet';
}

// ---------------------------------------------------------------------------
// Internal medal eligibility (no side effects — does NOT persist anything)
// ---------------------------------------------------------------------------

/**
 * @param {object} summary  Run summary (all fields optional).
 * @param {object} profile  Snapshot of profile (may have streak pre-updated for addRun flow).
 * @returns {string[]} Medal IDs that are newly eligible and not yet earned.
 */
function _pendingMedalIds(summary, profile) {
  const earned     = _loadMedals();
  const mode       = summary.mode          || '';
  const kills      = Number(summary.kills) || 0;
  const bullseyes  = Number(summary.bullseyes)   || 0;
  const completed  = Boolean(summary.completed);
  const noMiss     = Boolean(summary.noMiss);
  const perfectCount = Number(summary.perfectCount) || 0;
  const timeLeft   = Number(summary.timeLeft) || 0;
  const runs       = (profile.totals && Number(profile.totals.runs)) || 0;
  const streak     = (profile.streak  && Number(profile.streak.count))  || 0;

  const newIds = [];
  /** Only push if not already earned and condition is met. */
  function check(id, condition) {
    if (!earned[id] && condition) newIds.push(id);
  }

  check('first-flight',  runs === 0);
  check('splash-one',    kills >= 1);
  check('bullseye',      bullseyes >= 1);
  check('thread-needle', perfectCount >= 1);
  check('ringmaster',    mode === 'ring' && completed);
  check('pinpoint',      mode === 'bomb' && bullseyes >= 1);
  check('ace-in-a-day',  streak >= 2);
  check('untouchable',   noMiss && mode === 'dogfight' && completed);
  check('speed-demon',   mode === 'canyon' && completed && timeLeft >= 20);
  check('top-gun',       kills >= 8 && completed);
  check('centurion',     runs >= 99);   // this run will be the 100th (runs not yet incremented)
  check('legend',        profile.level >= 26);

  return newIds;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a copy of the player profile with level/rankTitle resolved from stored XP.
 * Absent storage → seed sane defaults.
 * @returns {object}
 */
export function getProfile() {
  const p  = _loadProfile();
  p.level  = levelFromXp(p.xp);
  p.rankTitle = rankTitle(p.level);
  return p;
}

/**
 * Compute the XP a summary would earn RIGHT NOW (preview — reads current profile/medals).
 * Medal XP is included for medals that are not yet earned.
 * Uses current saved streak (may differ from addRun which updates streak first).
 * @param {object} summary
 * @returns {number} XP (rounded integer)
 */
export function xpForRun(summary) {
  const profile = _loadProfile();
  profile.level = levelFromXp(profile.xp);

  const mode      = summary.mode     || '';
  const score     = Number(summary.score)    || 0;
  const completed = Boolean(summary.completed);

  const firstClearOfMode = completed && ((profile.plays && profile.plays[mode]) || 0) === 0;

  const pendingIds = _pendingMedalIds(summary, profile);
  const medalXp    = pendingIds.reduce((sum, id) => {
    const m = MEDALS.find(x => x.id === id);
    return sum + (m ? m.xp : 0);
  }, 0);

  const base = Math.round(score / 10)
    + (completed        ? 100 : 0)
    + (firstClearOfMode ? 250 : 0)
    + medalXp;

  const streak = (profile.streak && Number(profile.streak.count)) || 0;
  const mult   = 1 + 0.05 * Math.min(streak, 5);
  return Math.round(base * mult);
}

/**
 * Persist any newly-earned medals from `summary` and return their IDs.
 * Idempotent: already-earned medals are never re-earned.
 * @param {object} summary
 * @returns {string[]} Newly-earned medal IDs.
 */
export function checkMedals(summary) {
  const profile = _loadProfile();
  profile.level = levelFromXp(profile.xp);
  const newIds  = _pendingMedalIds(summary, profile);
  if (newIds.length === 0) return [];
  const earned = _loadMedals();
  const now    = new Date().toISOString();
  for (const id of newIds) earned[id] = now;
  _saveMedals(earned);
  return newIds;
}

/**
 * Return all earned medals as { [id]: isoDateString }.
 * @returns {object}
 */
export function getMedals() {
  return _loadMedals();
}

/**
 * Record a completed run, update the profile, and return a rich result object.
 *
 * Streak rules (ISO date key YYYY-MM-DD):
 *   - Same day  → keep count unchanged
 *   - Next day  → increment count
 *   - Any gap   → reset to 1
 *
 * XP formula: round( (round(score/10) + completionBonus + firstClearBonus + medalXp)
 *                    * (1 + 0.05 * min(streak, 5)) )
 *
 * @param {object} summary  { mode, score, grade, completed, finishReason, kills,
 *                            bullseyes, lowPasses, ringsCleared, gatesCleared,
 *                            charges, timeLeft, noMiss, perfectCount }
 *                          All fields are optional / default to 0/false.
 * @returns {{ gained, xp, level, prevLevel, leveledUp, rankTitle, isPB,
 *             earnedMedals:[{id,name,xp}] }}
 */
export function addRun(summary) {
  const profile  = _loadProfile();
  profile.level  = levelFromXp(profile.xp);
  const prevLevel = profile.level;

  const mode       = summary.mode      || '';
  const score      = Number(summary.score)      || 0;
  const completed  = Boolean(summary.completed);
  const kills      = Number(summary.kills)      || 0;
  const bullseyes  = Number(summary.bullseyes)  || 0;
  const lowPasses  = Number(summary.lowPasses)  || 0;
  const ringsCleared = Number(summary.ringsCleared) || 0;
  const gatesCleared = Number(summary.gatesCleared) || 0;

  // ---- 1. Update streak (before medal check so ace-in-a-day sees new streak) ----
  const today     = new Date().toISOString().slice(0, 10);
  const lastDay   = profile.streak.lastDay || '';
  const lastCount = Number(profile.streak.count) || 0;
  let newStreak;
  if (lastDay === today) {
    // Same session day — streak unchanged
    newStreak = lastCount;
  } else {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    newStreak = (lastDay === yesterday) ? lastCount + 1 : 1;
  }
  profile.streak.count   = newStreak;
  profile.streak.lastDay = today;

  // ---- 2. Determine pending medals (streak already updated in profile snapshot) ----
  const pendingIds    = _pendingMedalIds(summary, profile);
  const pendingMedals = pendingIds.map(id => MEDALS.find(m => m.id === id)).filter(Boolean);
  const medalXp       = pendingMedals.reduce((sum, m) => sum + m.xp, 0);

  // ---- 3. Compute XP ----
  const firstClearOfMode = completed && ((profile.plays && profile.plays[mode]) || 0) === 0;
  const base = Math.round(score / 10)
    + (completed        ? 100 : 0)
    + (firstClearOfMode ? 250 : 0)
    + medalXp;
  const mult   = 1 + 0.05 * Math.min(newStreak, 5);
  const gained = Math.round(base * mult);

  // ---- 4. Persist medals from this run ----
  if (pendingIds.length > 0) {
    const earned = _loadMedals();
    const now    = new Date().toISOString();
    for (const id of pendingIds) earned[id] = now;
    _saveMedals(earned);
  }

  // ---- 5. Update profile totals / plays / best ----
  profile.xp += gained;
  profile.level    = levelFromXp(profile.xp);
  profile.rankTitle = rankTitle(profile.level);

  // plays
  if (mode) profile.plays[mode] = (Number(profile.plays[mode]) || 0) + 1;

  // personal best
  const prevBest = Number(profile.best[mode]) || 0;
  const isPB     = score > prevBest;
  if (isPB) profile.best[mode] = score;

  // totals
  profile.totals.score     += score;
  profile.totals.kills     += kills;
  profile.totals.rings     += ringsCleared;
  profile.totals.gates     += gatesCleared;
  profile.totals.bullseyes += bullseyes;
  profile.totals.lowPasses += lowPasses;
  profile.totals.runs      += 1;

  // ---- 6. Post-update legend medal (triggered by reaching level 26 via THIS run's XP) ----
  const earnedMedals = pendingMedals.map(m => ({ id: m.id, name: m.name, xp: m.xp }));

  if (profile.level >= 26 && prevLevel < 26) {
    const earned = _loadMedals();
    if (!earned['legend']) {
      const lm = MEDALS.find(m => m.id === 'legend');
      if (lm) {
        earned['legend'] = new Date().toISOString();
        _saveMedals(earned);
        earnedMedals.push({ id: lm.id, name: lm.name, xp: lm.xp });
        // Fold legend XP into profile (not included in original `gained`)
        profile.xp   += lm.xp;
        profile.level = levelFromXp(profile.xp);
        profile.rankTitle = rankTitle(profile.level);
      }
    }
  }

  _saveProfile(profile);

  return {
    gained,
    xp:        profile.xp,
    level:     profile.level,
    prevLevel,
    leveledUp: profile.level > prevLevel,
    rankTitle: profile.rankTitle,
    isPB,
    earnedMedals,
  };
}
