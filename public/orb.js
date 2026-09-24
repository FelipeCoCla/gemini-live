/**
 * Minimalist Geometric Voice Orb (Pure Primitives)
 * Clean, timeless geometric design inspired by Dieter Rams / Bauhaus & modern Apple acoustics.
 * Built entirely with pure circular primitives, razor-sharp line weights, and soft ambient light.
 */

export class GlowingOrb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.currentState = 'idle';
    this.targetState = 'idle';

    this.micAnalyser = null;
    this.speakerAnalyser = null;
    this.frequencyData = new Uint8Array(64);

    this.currentAudioLevel = 0;
    this.targetAudioLevel = 0;
    this.smoothedAudio = 0;

    this.time = 0;
    this.rotation = 0;

    // Expanding acoustic ripple rings for speech
    this.ripples = [];
    this.lastRippleTime = 0;

    // Refined, high-contrast geometric palettes
    this.palettes = {
      idle: {
        core: [99, 102, 241],        // Muted Indigo
        rim: [165, 180, 252],        // Soft Lavender
        ambient: [49, 46, 129],      // Deep Midnight Void
        glow: [129, 140, 248],       // Ethereal Violet
        breatheRate: 1.0,
        coreScale: 1.0
      },
      listening: {
        core: [6, 182, 212],         // Pure Electric Cyan
        rim: [103, 232, 249],        // Crisp Ice Cyan
        ambient: [14, 116, 144],     // Deep Oceanic Teal
        glow: [34, 211, 238],        // Bright Laser Glow
        breatheRate: 1.6,
        coreScale: 1.15
      },
      thinking: {
        core: [245, 158, 11],        // Pure Warm Amber
        rim: [253, 230, 138],        // Champagne Highlight
        ambient: [180, 83, 9],       // Deep Bronze Amber
        glow: [251, 191, 36],        // Solar Radiance
        breatheRate: 2.2,
        coreScale: 1.05
      },
      speaking: {
        core: [168, 85, 247],        // Neon Orchid Violet
        rim: [244, 114, 182],        // Soft Rose Quartz
        ambient: [126, 34, 206],     // Deep Royal Magenta
        glow: [56, 189, 248],        // Sky Cyan Accent
        breatheRate: 1.8,
        coreScale: 1.2
      }
    };

    // Interpolated palette
    this.current = {
      core: [...this.palettes.idle.core],
      rim: [...this.palettes.idle.rim],
      ambient: [...this.palettes.idle.ambient],
      glow: [...this.palettes.idle.glow],
      breatheRate: this.palettes.idle.breatheRate,
      coreScale: this.palettes.idle.coreScale
    };

    // Position and scale interpolation for compact mode (when minimized to top)
    this.centerYFactor = 0.5;
    this.targetCenterY = 0.5;
    this.scaleFactor = 1.0;
    this.targetScale = 1.0;
    this.isCompact = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  setCompact(isCompact) {
    this.isCompact = isCompact;
    this.targetCenterY = isCompact ? 0.095 : 0.5;
    this.targetScale = isCompact ? 0.42 : 1.0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;

    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.dpr = dpr;
  }

  setState(newState) {
    if (this.palettes[newState] && this.targetState !== newState) {
      this.targetState = newState;
    }
  }

  setMicAnalyser(analyser) {
    this.micAnalyser = analyser;
  }

  setSpeakerAnalyser(analyser) {
    this.speakerAnalyser = analyser;
  }

  lerp(a, b, t) {
    return (1 - t) * a + t * b;
  }

  lerpColor(c1, c2, t) {
    return [
      this.lerp(c1[0], c2[0], t),
      this.lerp(c1[1], c2[1], t),
      this.lerp(c1[2], c2[2], t)
    ];
  }

  updateAudio() {
    let analyser = null;
    if (this.targetState === 'listening' && this.micAnalyser) {
      analyser = this.micAnalyser;
    } else if (this.targetState === 'speaking' && this.speakerAnalyser) {
      analyser = this.speakerAnalyser;
    }

    if (analyser) {
      analyser.getByteFrequencyData(this.frequencyData);
      let sum = 0;
      const count = Math.min(32, this.frequencyData.length);
      for (let i = 0; i < count; i++) {
        sum += this.frequencyData[i];
      }
      this.targetAudioLevel = (sum / count) / 255;
    } else if (this.targetState === 'thinking') {
      this.targetAudioLevel = 0.2 + 0.12 * Math.sin(this.time * 4.5);
    } else {
      this.targetAudioLevel = 0;
    }

    // Low-pass exponential smoothing
    this.smoothedAudio = this.lerp(this.smoothedAudio, this.targetAudioLevel, 0.22);
  }

  updateInterpolation() {
    const target = this.palettes[this.targetState];
    const rate = 0.08;

    this.current.core = this.lerpColor(this.current.core, target.core, rate);
    this.current.rim = this.lerpColor(this.current.rim, target.rim, rate);
    this.current.ambient = this.lerpColor(this.current.ambient, target.ambient, rate);
    this.current.glow = this.lerpColor(this.current.glow, target.glow, rate);

    this.current.breatheRate = this.lerp(this.current.breatheRate, target.breatheRate, rate);
    this.current.coreScale = this.lerp(this.current.coreScale, target.coreScale, rate);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    this.time += 0.016 * this.current.breatheRate;
    this.rotation += 0.015;

    // Smooth floating position and scale transition (lerp)
    this.centerYFactor = this.lerp(this.centerYFactor, this.targetCenterY, 0.075);
    this.scaleFactor = this.lerp(this.scaleFactor, this.targetScale, 0.075);

    this.updateAudio();
    this.updateInterpolation();

    this.render();
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr || 1;

    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * this.centerYFactor;

    // Core primitive sizing with smooth scaleFactor
    const minDim = Math.min(w, h);
    const nominalRadius = minDim * 0.11 * this.scaleFactor;

    // Gentle breathing + audio response (pure spring physics, no distortion)
    const breathing = Math.sin(this.time * 1.6) * (nominalRadius * 0.04);
    const audioExpansion = this.smoothedAudio * (nominalRadius * 0.35);
    const coreRadius = (nominalRadius + breathing + audioExpansion) * this.current.coreScale;

    const cCore = this.current.core.map(Math.round);
    const cRim = this.current.rim.map(Math.round);
    const cAmbient = this.current.ambient.map(Math.round);
    const cGlow = this.current.glow.map(Math.round);

    // =========================================================================
    // PRIMITIVE 1: Soft Pure Radial Bloom (Atmospheric backdrop)
    // =========================================================================
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bloomRadius = coreRadius * 2.8;
    const bloomGrad = ctx.createRadialGradient(cx, cy, coreRadius * 0.4, cx, cy, bloomRadius);
    bloomGrad.addColorStop(0, `rgba(${cAmbient[0]}, ${cAmbient[1]}, ${cAmbient[2]}, ${0.45 + this.smoothedAudio * 0.3})`);
    bloomGrad.addColorStop(0.5, `rgba(${cGlow[0]}, ${cGlow[1]}, ${cGlow[2]}, ${0.18 + this.smoothedAudio * 0.2})`);
    bloomGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = bloomGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, bloomRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // =========================================================================
    // PRIMITIVE 2: Acoustic Ripple Rings (Pure concentric circles for speaking)
    // =========================================================================
    if (this.targetState === 'speaking' || (this.targetState === 'listening' && this.smoothedAudio > 0.12)) {
      const now = performance.now();
      if (now - this.lastRippleTime > 340 && this.smoothedAudio > 0.06) {
        this.ripples.push({
          radius: coreRadius * 1.05,
          maxRadius: coreRadius * 2.1,
          opacity: 0.65,
          speed: (1.2 + this.smoothedAudio * 2.0) * dpr
        });
        this.lastRippleTime = now;
      }
    }

    // Render and update active ripples
    if (this.ripples.length > 0) {
      ctx.save();
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.radius += r.speed;
        const progress = (r.radius - coreRadius) / (r.maxRadius - coreRadius);
        const alpha = Math.max(0, (1 - progress) * r.opacity);

        if (progress >= 1 || alpha <= 0.01) {
          this.ripples.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, ${alpha * 0.75})`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
      }
      ctx.restore();
    }

    // =========================================================================
    // PRIMITIVE 3: Concentric Geometric Ring (Precision Aperture)
    // =========================================================================
    ctx.save();
    const apertureRadius = coreRadius * 1.38;

    if (this.targetState === 'thinking') {
      // Rotating dual geometric arcs (minimal Bauhaus loading indicator)
      const arcLen = Math.PI * 0.42;
      const angle1 = this.rotation * 2.0;
      const angle2 = angle1 + Math.PI;

      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, 0.85)`;

      ctx.beginPath();
      ctx.arc(cx, cy, apertureRadius, angle1, angle1 + arcLen);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, apertureRadius, angle2, angle2 + arcLen);
      ctx.stroke();

      // Subtle faint track ring
      ctx.beginPath();
      ctx.arc(cx, cy, apertureRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, 0.15)`;
      ctx.lineWidth = 1.0 * dpr;
      ctx.stroke();

    } else {
      // Clean, quiet concentric circular stroke
      const ringAlpha = (this.targetState === 'listening' ? 0.45 + this.smoothedAudio * 0.45 : 0.22);
      ctx.beginPath();
      ctx.arc(cx, cy, apertureRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, ${ringAlpha})`;
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }
    ctx.restore();

    // =========================================================================
    // PRIMITIVE 4: The Central Circle (Pure Solid Geometric Core)
    // =========================================================================
    ctx.save();
    // Inner solid core disc with clean radial gradient
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    coreGrad.addColorStop(0, `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, 0.95)`);
    coreGrad.addColorStop(0.65, `rgba(${cCore[0]}, ${cCore[1]}, ${cCore[2]}, 0.92)`);
    coreGrad.addColorStop(1, `rgba(${cAmbient[0]}, ${cAmbient[1]}, ${cAmbient[2]}, 0.88)`);

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // Razor-clean perimeter line
    ctx.strokeStyle = `rgba(${cRim[0]}, ${cRim[1]}, ${cRim[2]}, ${0.75 + this.smoothedAudio * 0.25})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.shadowColor = `rgba(${cGlow[0]}, ${cGlow[1]}, ${cGlow[2]}, 0.8)`;
    ctx.shadowBlur = (12 + this.smoothedAudio * 14) * dpr;
    ctx.stroke();
    ctx.restore();
  }
}
