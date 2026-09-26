/**
 * Sound Effects Manager (Web Audio API Synthesizer)
 * Zero-latency procedural earcons for Orb activation and deactivation.
 * No audio files to download; 100% offline, synchronous, and studio-tuned.
 */

export class SoundManager {
  constructor(getAudioContext) {
    this.getAudioContext = getAudioContext;
    this.currentPreset = localStorage.getItem('gemini_sound_preset') || 'gemini';
    this.isEnabled = localStorage.getItem('gemini_sound_enabled') !== 'false';
  }

  setPreset(preset) {
    this.currentPreset = preset;
    localStorage.setItem('gemini_sound_preset', preset);
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    localStorage.setItem('gemini_sound_enabled', String(this.isEnabled));
  }

  getPresets() {
    return [
      { id: 'gemini', name: 'Dúo Cálido (Favorito)', icon: '⭐', desc: 'El sonido suave de dos notas que te gustó en OFF, idéntico al encender y apagar (0.6s)' },
      { id: 'harmonic', name: 'Dúo Armónico', icon: '🎶', desc: 'Misma textura cálida: sube al encender (587➔880Hz) y baja al apagar (880➔587Hz)' },
      { id: 'ambient', name: 'Gemini Acorde Swell', icon: '✨', desc: 'Acorde brillante etéreo de 4 notas con apertura de filtro (1.4s)' },
      { id: 'apple', name: 'Siri Minimal', icon: '🍎', desc: 'Chime clásico de dos notas ascendente / descendente (Apple)' },
      { id: 'marimba', name: 'Boutique Marimba', icon: '🪵', desc: 'Madera acústica y cálida estilo Notion / Linear' },
      { id: 'quantum', name: 'Quantum HUD', icon: '🛸', desc: 'Activación futurista con sweep armónico y cristal' },
      { id: 'zen', name: 'Zen Bell', icon: '🔔', desc: 'Campana tibetana armónica y relajante con decaimiento de 1.8s' }
    ];
  }

  play(type, presetName = null) {
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

    const preset = presetName || this.currentPreset;

    try {
      if (type === 'start') {
        this.playStartSound(ctx, preset);
      } else if (type === 'stop') {
        this.playStopSound(ctx, preset);
      }
    } catch (e) {
      console.warn('[SoundManager] Error playing sound:', e);
    }
  }

  // ==========================================
  // PRESET 1: Dúo Cálido (The user's favorite OFF tone)
  // Two warm sine tones with lowpass closing filter
  // ==========================================
  playWarmTones(ctx, now, ascending = false) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

    // Warm pair with soft LP filter sweep (the exact tone from OFF: 880Hz -> 587Hz)
    const notes = ascending
      ? [
          { f: 587.33, delay: 0.00, dur: 0.6 },
          { f: 880.00, delay: 0.08, dur: 0.7 }
        ]
      : [
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
      gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }

  playGeminiStart(ctx, now) {
    // Exact same sound as OFF: soothing, warm, two-tone
    return this.playWarmTones(ctx, now, false);
  }

  playGeminiStop(ctx, now) {
    return this.playWarmTones(ctx, now, false);
  }

  // ==========================================
  // PRESET: Ambient 4-note Swell (Google AI)
  // ==========================================
  playAmbientSwell(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.22, now);
    masterGain.connect(ctx.destination);

    const notes = [
      { f: 587.33, delay: 0.00, dur: 0.9, type: 'sine' },
      { f: 739.99, delay: 0.05, dur: 1.1, type: 'sine' },
      { f: 880.00, delay: 0.10, dur: 1.3, type: 'triangle' },
      { f: 1174.66, delay: 0.16, dur: 1.4, type: 'sine' }
    ];

    notes.forEach(({ f, delay, dur, type }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now + delay);
      filter.frequency.exponentialRampToValueAtTime(3400, now + delay + 0.12);
      filter.frequency.exponentialRampToValueAtTime(800, now + delay + dur);

      osc.type = type;
      osc.frequency.setValueAtTime(f, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.28, now + delay + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }

  // ==========================================
  // PRESET 2: Siri / Apple Minimal
  // ==========================================
  playAppleStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.22, now);
    masterGain.connect(ctx.destination);

    // Crisp two-tone rising chime (F#4 -> C#5)
    const tones = [
      { f: 554.37, delay: 0.00, dur: 0.32 },
      { f: 880.00, delay: 0.09, dur: 0.45 }
    ];

    tones.forEach(({ f, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }

  playAppleStop(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

    // Downward two-tone resolving chime (C#5 -> F#4)
    const tones = [
      { f: 880.00, delay: 0.00, dur: 0.30 },
      { f: 554.37, delay: 0.08, dur: 0.40 }
    ];

    tones.forEach(({ f, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.30, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }

  // ==========================================
  // PRESET 3: Boutique Marimba (Warm Acoustic)
  // ==========================================
  playMarimbaStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.24, now);
    masterGain.connect(ctx.destination);

    // Organic warm wood hits (E5 -> G#5) with rapid high harmonic decay
    const notes = [
      { f: 659.25, delay: 0.00, dur: 0.4 },
      { f: 830.61, delay: 0.11, dur: 0.55 }
    ];

    notes.forEach(({ f, delay, dur }) => {
      // Fundamental
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(f, now + delay);

      gain1.gain.setValueAtTime(0.0001, now + delay);
      gain1.gain.exponentialRampToValueAtTime(0.38, now + delay + 0.008);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc1.start(now + delay);
      osc1.stop(now + delay + dur + 0.05);

      // Acoustic mallet click / 3rd harmonic ping
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(f * 3, now + delay);

      gain2.gain.setValueAtTime(0.0001, now + delay);
      gain2.gain.exponentialRampToValueAtTime(0.12, now + delay + 0.004);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.05);

      osc2.connect(gain2);
      gain2.connect(masterGain);
      osc2.start(now + delay);
      osc2.stop(now + delay + 0.07);
    });
  }

  playMarimbaStop(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.20, now);
    masterGain.connect(ctx.destination);

    // Downward acoustic wood hit (G#5 -> E5)
    const notes = [
      { f: 830.61, delay: 0.00, dur: 0.35 },
      { f: 659.25, delay: 0.09, dur: 0.45 }
    ];

    notes.forEach(({ f, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + delay);

      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.32, now + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    });
  }

  // ==========================================
  // PRESET 4: Quantum HUD (Sci-Fi Hologram)
  // ==========================================
  playQuantumStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

    // Subtle upward holographic sweep + crystal ping
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(380, now);
    sweep.frequency.exponentialRampToValueAtTime(1100, now + 0.09);

    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    sweep.connect(sweepGain);
    sweepGain.connect(masterGain);
    sweep.start(now);
    sweep.stop(now + 0.16);

    // Crystal ping
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(1760, now + 0.08);

    pingGain.gain.setValueAtTime(0.0001, now + 0.08);
    pingGain.gain.exponentialRampToValueAtTime(0.20, now + 0.09);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    ping.connect(pingGain);
    pingGain.connect(masterGain);
    ping.start(now + 0.08);
    ping.stop(now + 0.75);
  }

  playQuantumStop(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

    // Downward gentle power-down sweep
    const sweep = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(1200, now);
    sweep.frequency.exponentialRampToValueAtTime(320, now + 0.15);

    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.26, now + 0.02);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    sweep.connect(sweepGain);
    sweepGain.connect(masterGain);
    sweep.start(now);
    sweep.stop(now + 0.25);
  }

  // ==========================================
  // PRESET 5: Zen Bell (Harmonic Singing Bowl)
  // ==========================================
  playZenStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.20, now);
    masterGain.connect(ctx.destination);

    // Warm singing bowl: 440Hz (A4) + 659.25Hz (E5 fifth) + 1320Hz harmonic overtone
    const harmonics = [
      { f: 440.00, peak: 0.35, dur: 1.8 },
      { f: 659.25, peak: 0.20, dur: 1.5 },
      { f: 1320.00, peak: 0.08, dur: 1.0 }
    ];

    harmonics.forEach(({ f, peak, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    });
  }

  playZenStop(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.16, now);
    masterGain.connect(ctx.destination);

    // Soft fading low bowl tone (E4)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(329.63, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.85);
  }

  playStartSound(ctx, preset) {
    const now = ctx.currentTime;
    switch (preset) {
      case 'harmonic': return this.playWarmTones(ctx, now, true); // Ascending pair
      case 'ambient': return this.playAmbientSwell(ctx, now);      // 4-note swell
      case 'apple': return this.playAppleStart(ctx, now);
      case 'marimba': return this.playMarimbaStart(ctx, now);
      case 'quantum': return this.playQuantumStart(ctx, now);
      case 'zen': return this.playZenStart(ctx, now);
      case 'gemini':
      default:
        // Default: exact same sound from OFF that the user loved!
        return this.playGeminiStart(ctx, now);
    }
  }

  playStopSound(ctx, preset) {
    const now = ctx.currentTime;
    switch (preset) {
      case 'harmonic': return this.playWarmTones(ctx, now, false); // Descending pair
      case 'ambient': return this.playWarmTones(ctx, now, false);
      case 'apple': return this.playAppleStop(ctx, now);
      case 'marimba': return this.playMarimbaStop(ctx, now);
      case 'quantum': return this.playQuantumStop(ctx, now);
      case 'zen': return this.playZenStop(ctx, now);
      case 'gemini':
      default:
        // Default: exact same sound from OFF that the user loved!
        return this.playGeminiStop(ctx, now);
    }
  }
}
