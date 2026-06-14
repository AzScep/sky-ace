// =====================================================
// Sky Ace — audio manager (Web Audio API)
// All clips generated with Higgsfield and stored in assets/audio/.
// Music sits quiet under SFX; SFX overlap freely; engine + music loop.
// =====================================================

const FILES = {
  // looping music (routed through the music bus)
  music_menu:   { src: 'assets/audio/music_menu.mp3',     gain: 0.50, loop: true, music: true },
  music_action: { src: 'assets/audio/music_action.mp3',   gain: 0.45, loop: true, music: true },
  fanfare:      { src: 'assets/audio/fanfare_victory.mp3', gain: 0.75, music: true },
  // looping engine (sfx bus, gain/rate driven live by throttle & speed)
  engine:       { src: 'assets/audio/engine_loop.mp3',    gain: 0.22, loop: true },
  // one-shots
  cannon:       { src: 'assets/audio/cannon_fire.mp3',    gain: 0.55 },
  explosion:    { src: 'assets/audio/explosion.mp3',      gain: 0.85 },
  boost:        { src: 'assets/audio/boost_whoosh.mp3',   gain: 0.65 },
  chime:        { src: 'assets/audio/chime_success.mp3',  gain: 0.55 },
};

const MUSIC_TRACKS = ['music_menu', 'music_action'];
const MUTE_KEY = 'sky_ace_muted';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this._loops = {};        // name -> { src, gain }
    this._loadPromise = null;
  }

  // Must be called from a user gesture (browsers block audio otherwise).
  init() {
    if (this._loadPromise) return this._loadPromise;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this._loadPromise = this._loadAll();
    return this._loadPromise;
  }

  async _loadAll() {
    await Promise.all(Object.entries(FILES).map(async ([name, def]) => {
      try {
        const res = await fetch(def.src);
        const arr = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(arr);
      } catch (e) {
        console.warn('[audio] failed to load', name, e);
      }
    }));
    this.ready = true;
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
      this.masterGain.gain.linearRampToValueAtTime(m ? 0 : 1, now + 0.15);
    }
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }

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
}

export const audio = new AudioManager();
