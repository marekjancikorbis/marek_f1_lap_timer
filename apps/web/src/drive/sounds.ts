import type { SectorColourName } from '../lib/types';

/**
 * Drive audio on WebAudio. Countdown beeps are scheduled on the audio clock,
 * so beats stay exactly one second apart however busy the page is.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private scheduled: OscillatorNode[] = [];

  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  private tone(freq: number, at: number, dur: number, gain = 0.25, type: OscillatorType = 'square') {
    const ctx = this.ctx;
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.005);
    g.gain.setValueAtTime(gain, at + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.01);
    return osc;
  }

  /** One beep per second for n seconds, then a longer, higher GO tone. */
  countdown(n: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stop();
    const t0 = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const o = this.tone(660, t0 + i, 0.12);
      if (o) this.scheduled.push(o);
    }
    const go = this.tone(1320, t0 + n, 0.55, 0.3);
    if (go) this.scheduled.push(go);
  }

  stop() {
    this.scheduled.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
    this.scheduled = [];
  }

  gate(colour?: SectorColourName) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (colour === 'purple') {
      this.tone(880, t, 0.09, 0.2, 'sine');
      this.tone(1320, t + 0.1, 0.14, 0.2, 'sine');
    } else if (colour === 'green') {
      this.tone(990, t, 0.14, 0.2, 'sine');
    } else {
      this.tone(520, t, 0.14, 0.2, 'sine');
    }
  }

  tick() {
    if (this.ctx) this.tone(880, this.ctx.currentTime, 0.05, 0.12, 'sine');
  }

  finish() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => this.tone(f, t + i * 0.12, 0.16, 0.2, 'sine'));
  }

  alarm() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(330, t, 0.25, 0.3, 'sawtooth');
    this.tone(330, t + 0.3, 0.25, 0.3, 'sawtooth');
  }

  close() {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
