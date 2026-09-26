/**
 * Sound Effects Manager (Web Audio API Synthesizer)
 * Iterations on the user's favorite Zen Bell off-tone (E4 329.63Hz).
 * Same warm sine base, soft 30ms attack, exponential decay, 0.16 master gain.
 */

export class SoundManager {
  constructor(getAudioContext) {
    this.getAudioContext = getAudioContext;
    this.currentPreset = localStorage.getItem('gemini_sound_preset') || 'zen_original';
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
      {
        id: 'zen_original',
        name: 'Zen 1: Base Original (E4 Fijo)',
        icon: '🔔',
        desc: 'El tono exacto de cuenco en 329Hz que te gustó, idéntico tanto al encender como al apagar (0.8s).'
      },
      {
        id: 'zen_harmonic',
        name: 'Zen 2: Quinta Armónica (La ➔ Mi)',
        icon: '🎶',
        desc: 'Misma textura suave: La4 (440Hz) de bienvenida al encender y Mi4 (329Hz) de resolución al apagar.'
      },
      {
        id: 'zen_duo',
        name: 'Zen 3: Doble Gota (Mi ➔ Sol#)',
        icon: '✨',
        desc: 'Dos toques de cuenco sutiles (329Hz ➔ 415Hz al abrir, 415Hz ➔ 329Hz al cerrar).'
      },
      {
        id: 'zen_deep',
        name: 'Zen 4: Profundo / Grave (277Hz / 220Hz)',
        icon: '🧘',
        desc: 'Tonalidades más graves y cálidas con decaimiento de 1.0s (Do#4 al abrir, La3 al cerrar).'
      },
      {
        id: 'zen_shimmer',
        name: 'Zen 5: Shimmer Sutil (E4 + E5 tenue)',
        icon: '💎',
        desc: 'Mi4 con un tenue armónico alto al abrir (12% volumen) y el tono puro en reposo al cerrar.'
      },
      {
        id: 'zen_resonance',
        name: 'Zen 6: Resonancia Larga (1.4s)',
        icon: '🕯️',
        desc: 'Misma nota Mi4 pero con mayor tiempo de resonancia y cola etérea extendida (1.4s).'
      },
      {
        id: 'quantum',
        name: 'Quantum HUD (Tesla)',
        icon: '⚡',
        desc: 'Barrido futurista estilo Tesla con apagado de potencia (1200➔320Hz).'
      },
      {
        id: 'apple',
        name: 'Siri Minimal',
        icon: '🍎',
        desc: 'Chime clásico nítido de dos notas ascendente / descendente.'
      }
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
  // CORE HELPER: Pure warm sine bowl generator
  // (Identical synthesis engine to playZenStop)
  // ==========================================
  playBowlTone(ctx, now, freq, dur = 0.8, peak = 0.25, delay = 0, masterVol = 0.16) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(masterVol, now);
    masterGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);

    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now + delay);
    osc.stop(now + delay + dur + 0.05);
  }

  // ==========================================
  // 1. ZEN ORIGINAL (Base que le gustó, E4 fijo)
  // ==========================================
  playZenOriginalStart(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 0.8, 0.25, 0, 0.16);
  }
  playZenOriginalStop(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 0.8, 0.25, 0, 0.16);
  }

  // ==========================================
  // 2. ZEN ARMÓNICO (Quinta: La4 -> Mi4)
  // ==========================================
  playZenHarmonicStart(ctx, now) {
    this.playBowlTone(ctx, now, 440.00, 0.75, 0.24, 0, 0.16);
  }
  playZenHarmonicStop(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 0.85, 0.25, 0, 0.16);
  }

  // ==========================================
  // 3. ZEN DÚO (Doble Gota Mi ➔ Sol#)
  // ==========================================
  playZenDuoStart(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 0.6, 0.22, 0.00, 0.16);
    this.playBowlTone(ctx, now, 415.30, 0.7, 0.24, 0.09, 0.16);
  }
  playZenDuoStop(ctx, now) {
    this.playBowlTone(ctx, now, 415.30, 0.6, 0.22, 0.00, 0.16);
    this.playBowlTone(ctx, now, 329.63, 0.75, 0.24, 0.09, 0.16);
  }

  // ==========================================
  // 4. ZEN PROFUNDO (Sub / Grave: 277Hz / 220Hz)
  // ==========================================
  playZenDeepStart(ctx, now) {
    this.playBowlTone(ctx, now, 277.18, 0.9, 0.26, 0, 0.18);
  }
  playZenDeepStop(ctx, now) {
    this.playBowlTone(ctx, now, 220.00, 1.05, 0.28, 0, 0.18);
  }

  // ==========================================
  // 5. ZEN SHIMMER (E4 + E5 tenue)
  // ==========================================
  playZenShimmerStart(ctx, now) {
    // Fundamental
    this.playBowlTone(ctx, now, 329.63, 0.8, 0.25, 0, 0.16);
    // Subtle higher octave shimmer at low volume
    this.playBowlTone(ctx, now, 659.25, 0.6, 0.05, 0.02, 0.16);
  }
  playZenShimmerStop(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 0.8, 0.25, 0, 0.16);
  }

  // ==========================================
  // 6. ZEN RESONANCIA LARGA (1.4s)
  // ==========================================
  playZenResonanceStart(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 1.2, 0.25, 0, 0.16);
  }
  playZenResonanceStop(ctx, now) {
    this.playBowlTone(ctx, now, 329.63, 1.4, 0.25, 0, 0.16);
  }

  // ==========================================
  // QUANTUM HUD (Tesla)
  // ==========================================
  playQuantumStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

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
  // SIRI MINIMAL (Apple)
  // ==========================================
  playAppleStart(ctx, now) {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.22, now);
    masterGain.connect(ctx.destination);

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

  playStartSound(ctx, preset) {
    const now = ctx.currentTime;
    switch (preset) {
      case 'zen_harmonic': return this.playZenHarmonicStart(ctx, now);
      case 'zen_duo': return this.playZenDuoStart(ctx, now);
      case 'zen_deep': return this.playZenDeepStart(ctx, now);
      case 'zen_shimmer': return this.playZenShimmerStart(ctx, now);
      case 'zen_resonance': return this.playZenResonanceStart(ctx, now);
      case 'quantum': return this.playQuantumStart(ctx, now);
      case 'apple': return this.playAppleStart(ctx, now);
      case 'zen':
      case 'zen_original':
      default:
        return this.playZenOriginalStart(ctx, now);
    }
  }

  playStopSound(ctx, preset) {
    const now = ctx.currentTime;
    switch (preset) {
      case 'zen_harmonic': return this.playZenHarmonicStop(ctx, now);
      case 'zen_duo': return this.playZenDuoStop(ctx, now);
      case 'zen_deep': return this.playZenDeepStop(ctx, now);
      case 'zen_shimmer': return this.playZenShimmerStop(ctx, now);
      case 'zen_resonance': return this.playZenResonanceStop(ctx, now);
      case 'quantum': return this.playQuantumStop(ctx, now);
      case 'apple': return this.playAppleStop(ctx, now);
      case 'zen':
      case 'zen_original':
      default:
        return this.playZenOriginalStop(ctx, now);
    }
  }
}
