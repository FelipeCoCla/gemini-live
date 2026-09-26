/**
 * Sound Effects Manager (Web Audio API Synthesizer)
 * Zero-latency procedural earcon for Orb activation and deactivation.
 * Uses the exact warm two-tone sound currently used in OFF for both ON and OFF.
 */

export class SoundManager {
  constructor(getAudioContext) {
    this.getAudioContext = getAudioContext;
    this.isEnabled = localStorage.getItem('gemini_sound_enabled') !== 'false';
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    localStorage.setItem('gemini_sound_enabled', String(this.isEnabled));
  }

  play(type = 'toggle') {
    if (!this.isEnabled) return;
    let ctx = typeof this.getAudioContext === 'function' ? this.getAudioContext() : this.getAudioContext;
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        ctx = new AudioContextClass({ latencyHint: 'interactive' });
      }
    }
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    try {
      this.playOffSound(ctx);
    } catch (e) {
      console.warn('[SoundManager] Error playing sound:', e);
    }
  }

  // The exact sound currently used in OFF
  // Pure sine tones in La (880Hz) -> Re (587Hz) with warm lowpass closing filter
  playOffSound(ctx) {
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.24, now);
    masterGain.connect(ctx.destination);

    const notes = [
      { f: 880.00, delay: 0.00, dur: 0.6 },
      { f: 587.33, delay: 0.08, dur: 0.7 }
    ];

    notes.forEach(({ f, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now + delay);
      filter.frequency.exponentialRampToValueAtTime(450, now + delay + dur);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.30, now + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }
}
