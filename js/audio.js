// =============================================================
// Som ambiente gerado na hora (Web Audio, sem arquivos):
// murmúrio da multidão que sobe com a densidade, "bum" do show,
// gritos de euforia, apito do juiz e estouros de fogos.
// =============================================================
export class CrowdAudio {
  constructor() { this.ctx = null; this.muted = false; this.level = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 4; } // ruído marrom
    this.noiseBuf = buf;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    // murmúrio: ruído filtrado com leve modulação
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
    this.murmur = ctx.createGain(); this.murmur.gain.value = 0;
    src.connect(bp); bp.connect(this.murmur); this.murmur.connect(this.master);
    src.start();
    this.bp = bp;
    // grave do show (batida)
    this.bass = ctx.createGain(); this.bass.gain.value = 0; this.bass.connect(this.master);
    this.beatTimer = 0;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  // chamado a cada quadro
  update(dt, { active = 0, avgDensity = 0, showing = false, surge = false, bpm = 124 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const target = Math.min(0.5, (active / 1500) * 0.25 + avgDensity * 0.05) + (surge ? 0.1 : 0);
    this.murmur.gain.setTargetAtTime(target, t, 0.4);
    this.bp.frequency.setTargetAtTime(420 + avgDensity * 80 + (surge ? 300 : 0), t, 0.3);
    if (showing) {
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) { this.beatTimer += 60 / bpm; this.kick(surge ? 0.5 : 0.3); }
    }
  }

  kick(vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  cheer(vol = 0.5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 3.1);
  }

  whistle() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    [0, 0.45, 0.9].forEach((d, k) => {
      const t = ctx.currentTime + d;
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 2900;
      lfo.frequency.value = 28; lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
      const len = k === 2 ? 0.9 : 0.3;
      g.gain.setValueAtTime(0.18, t); g.gain.setValueAtTime(0.18, t + len - 0.05); g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g); g.connect(this.master); o.start(t); lfo.start(t); o.stop(t + len); lfo.stop(t + len);
    });
  }

  boom() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 1.3);
  }

  horn() { // buzina do trem
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const fr of [311, 392]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = fr;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05); g.gain.setValueAtTime(0.06, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 0.8);
      o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.85);
    }
  }
}
