/**
 * AudioRecorderProcessor
 * Pristine, low-latency, glitch-free 16kHz PCM audio capture worklet.
 * Resamples smoothly from hardware sampleRate (e.g. 48000Hz, 44100Hz)
 * to 16kHz 16-bit linear PCM mono chunks for Gemini Live.
 */

class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 1024; // 1024 output samples = 64ms at 16kHz
    this.outputBuffer = new Int16Array(this.chunkSize);
    this.outputIndex = 0;

    // Resampling ratio: e.g. 48000 / 16000 = 3.0, 44100 / 16000 = 2.75625
    this.resampleRatio = sampleRate / 16000;
    this.phase = 0;
    this.prevSample = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0];
    const len = channelData.length;

    // Resample using continuous linear interpolation across block boundaries
    while (this.phase < len) {
      const idx0 = Math.floor(this.phase);
      const frac = this.phase - idx0;

      // Seamless interpolation across block boundaries using prevSample
      const s0 = idx0 >= 0 ? channelData[idx0] : this.prevSample;
      const s1 = idx0 + 1 < len ? channelData[idx0 + 1] : channelData[len - 1];
      const sample = s0 + frac * (s1 - s0);

      // Clamping to [-1.0, 1.0] and converting to 16-bit signed integer PCM
      const clamped = Math.max(-1.0, Math.min(1.0, sample));
      this.outputBuffer[this.outputIndex++] = clamped < 0 
        ? Math.round(clamped * 32768) 
        : Math.round(clamped * 32767);

      if (this.outputIndex >= this.chunkSize) {
        const chunk = new Int16Array(this.outputBuffer);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.outputBuffer = new Int16Array(this.chunkSize);
        this.outputIndex = 0;
      }

      this.phase += this.resampleRatio;
    }

    this.prevSample = channelData[len - 1];
    this.phase -= len;
    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
