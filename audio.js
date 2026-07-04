// =====================================================
// Sky Ace — audio manager (Web Audio API)
// All clips generated with Higgsfield and stored in assets/audio/.
// Music sits quiet under SFX; SFX overlap freely; engine + music loop.
// =====================================================

const FILES = {
  // looping music (routed through the music bus)
  music_menu:     { src: 'assets/audio/music_menu.mp3',     gain: 0.50, loop: true, music: true },
  music_action:   { src: 'assets/audio/music_action.mp3',   gain: 0.45, loop: true, music: true },
  music_dogfight: { src: 'assets/audio/music_dogfight.mp3', gain: 0.45, loop: true, music: true },
  fanfare:      { src: 'assets/audio/fanfare_victory.mp3', gain: 0.75, music: true },
  // looping engine (sfx bus, gain/rate driven live by throttle & speed)
  engine:       { src: 'assets/audio/engine_loop.mp3',    gain: 0.22, loop: true },
  // one-shots
  cannon:       { src: 'assets/audio/cannon_fire.mp3',    gain: 0.55 },
  explosion:    { src: 'assets/audio/explosion.mp3',      gain: 0.85 },
  boost:        { src: 'assets/audio/boost_whoosh.mp3',   gain: 0.65 },
  chime:        { src: 'assets/audio/chime_success.mp3',  gain: 0.55 },
};

// Pilot / AWACS radio callouts (already normalized loud)
const VOICE = {
  takeoff:  'assets/audio/vo_takeoff.mp3',
  combat:   'assets/audio/vo_combat.mp3',
  splash:   'assets/audio/vo_splash.mp3',
  bullseye: 'assets/audio/vo_bullseye.mp3',
  complete: 'assets/audio/vo_complete.mp3',
  failed:   'assets/audio/vo_failed.mp3',
};

const MUSIC_TRACKS = ['music_menu', 'music_action', 'music_dogfight'];
const MUTE_KEY = 'sky_ace_muted';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.muted = false;
    this.volume = 1;          // user master volume (0..1), driven by settings
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.voiceGain = null;
    this.voiceBuffers = {};
    this._voEndTime = 0;
    this._loops = {};        // name -> { src, gain }
    this._loadPromise = null;
    // muffle (lowpass inserted into master chain in init())
    this.muffleFilter = null;
    this._muffleOn    = false;
    this._muffleBaseGain = 1.0;  // nominal musicGain when not voice-ducked
  }

  // Must be called from a user gesture (browsers block audio otherwise).
  init() {
    if (this._loadPromise) return this._loadPromise;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    // Insert the muffle lowpass filter into the master chain so the graph is:
    //   masterGain -> muffleFilter -> destination
    // Initialised fully open (20 kHz) so it is inaudible until setMuffle(true).
    this.muffleFilter = this.ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.Q.value = 0.0001;
    this.masterGain.connect(this.muffleFilter);
    this.muffleFilter.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this.voiceGain = this.ctx.createGain();
    this.voiceGain.connect(this.masterGain);
    this._loadPromise = this._loadAll();
    return this._loadPromise;
  }

  async _load(src) {
    try {
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn('[audio] failed to load', src, e);
      return null;
    }
  }

  async _loadAll() {
    const jobs = [];
    for (const [name, def] of Object.entries(FILES)) {
      jobs.push(this._load(def.src).then((b) => { if (b) this.buffers[name] = b; }));
    }
    for (const [name, src] of Object.entries(VOICE)) {
      jobs.push(this._load(src).then((b) => { if (b) this.voiceBuffers[name] = b; }));
    }
    await Promise.all(jobs);
    this.ready = true;
  }

  // Pilot radio line — ducks music while speaking; ignores overlap.
  playVoice(name) {
    if (!this.ready || !this.ctx) return;
    const buf = this.voiceBuffers[name];
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (now < this._voEndTime) return;   // one radio call at a time
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.voiceGain);
    src.start(0);
    const dur = buf.duration;
    this._voEndTime = now + dur + 0.1;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.28, now + 0.12);
    g.setValueAtTime(0.28, now + dur);
    g.linearRampToValueAtTime(1.0, now + dur + 0.4);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  // Fire-and-forget one-shot (overlaps allowed).
  play(name, opts = {}) {
    if (!this.ready || !this.ctx) return;
    const def = FILES[name], buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain != null ? opts.gain : (def.gain != null ? def.gain : 1);
    src.connect(g);
    g.connect(def.music ? this.musicGain : this.sfxGain);
    src.start(0);
  }

  isLoopActive(name) { return !!this._loops[name]; }

  startLoop(name, opts = {}) {
    if (!this.ready || !this.ctx || this._loops[name]) return;
    const def = FILES[name], buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain != null ? opts.gain : def.gain;
    src.connect(g);
    g.connect(def.music ? this.musicGain : this.sfxGain);
    src.start(0);
    this._loops[name] = { src, gain: g };
  }

  stopLoop(name, fade = 0.3) {
    const node = this._loops[name];
    if (!node) return;
    delete this._loops[name];
    const now = this.ctx.currentTime;
    try {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      node.src.stop(now + fade + 0.05);
    } catch {}
  }

  setLoopParams(name, gain, rate, ramp = 0.1) {
    const node = this._loops[name];
    if (!node || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (gain != null) {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(gain, now + ramp);
    }
    if (rate != null) {
      node.src.playbackRate.cancelScheduledValues(now);
      node.src.playbackRate.setValueAtTime(node.src.playbackRate.value, now);
      node.src.playbackRate.linearRampToValueAtTime(rate, now + ramp);
    }
  }

  // Crossfade to one music track (or none).
  playMusic(name, gain) {
    for (const t of MUSIC_TRACKS) if (t !== name) this.stopLoop(t, 0.6);
    if (name) this.startLoop(name, gain != null ? { gain } : {});
  }
  stopAllMusic(fade = 0.6) { for (const t of MUSIC_TRACKS) this.stopLoop(t, fade); }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch {}
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(m ? 0 : this.volume, now + 0.15);
    }
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }

  // User master volume (0..1), wired to the settings slider.
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx && !this.muted) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(this.volume, now + 0.1);
    }
  }

  // Synthesized UI tick — no asset needed.
  click() {
    if (!this.ready || !this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.1);
  }

  // ---- muffle (pause lowpass) ----
  // Inserts a single persistent BiquadFilterNode already wired in init().
  // Safe to call before init() — no-ops when ctx/filter are not yet created.
  setMuffle(on, ramp = 0.18) {
    if (!this.ctx || !this.muffleFilter) return;
    this._muffleOn = on;
    const now = this.ctx.currentTime;
    // Ramp filter cutoff: 20000 (transparent) ↔ 320 Hz (muffled)
    const freq = this.muffleFilter.frequency;
    freq.cancelScheduledValues(now);
    freq.setValueAtTime(freq.value, now);
    freq.linearRampToValueAtTime(on ? 320 : 20000, now + ramp);
    // Ramp Q: tiny (flat) ↔ 0.9 (mild resonance on muffled edge)
    const q = this.muffleFilter.Q;
    q.cancelScheduledValues(now);
    q.setValueAtTime(q.value, now);
    q.linearRampToValueAtTime(on ? 0.9 : 0.0001, now + ramp);
    // Duck / restore music gain relative to the nominal (non-voice-ducked) level.
    // _muffleBaseGain tracks the target outside of voice-ducking (default 1.0).
    const mg = this.musicGain.gain;
    mg.cancelScheduledValues(now);
    mg.setValueAtTime(mg.value, now);
    mg.linearRampToValueAtTime(on ? this._muffleBaseGain * 0.6 : this._muffleBaseGain, now + ramp);
  }

  // ---- synthesized one-shots (all routed to sfxGain, all respect mute) ----

  // Generic square blip — public primitive that callers can pitch/time freely.
  beep(freq, dur = 0.12, gain = 0.06) {
    if (!this.ready || !this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.01);
  }

  // UI hover — soft sine ping.
  hover() {
    if (!this.ready || !this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(1100, t);
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.045);
  }

  // UI confirm — ascending square sweep (perfect fifth: 520 → 784 Hz).
  confirm() {
    if (!this.ready || !this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(784, t + 0.06);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.08);
  }

  // UI back/cancel — descending square sweep.
  back() {
    if (!this.ready || !this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square';
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(600, t);
    o.frequency.linearRampToValueAtTime(400, t + 0.05);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.07);
  }
}

export const audio = new AudioManager();
