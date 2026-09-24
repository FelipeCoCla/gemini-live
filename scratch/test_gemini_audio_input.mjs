import dotenv from 'dotenv';
dotenv.config();
import { GeminiLiveSession } from '../server/gemini-live.mjs';

console.log('Testing Gemini Live Audio Input response...');

let audioChunksReceived = 0;
let transcriptReceived = 0;

const session = new GeminiLiveSession({
  onAudioOutput: (data) => {
    audioChunksReceived++;
    if (audioChunksReceived === 1) {
      console.log('🎉 SUCCESS! Gemini responded with audio output!');
      session.close();
      process.exit(0);
    }
  },
  onTranscript: (role, text) => {
    console.log(`[Transcript] ${role}: ${text}`);
    transcriptReceived++;
  },
  onStateChange: (state) => {
    console.log('[State]:', state);
  },
  onError: (err) => {
    console.error('Error:', err);
  }
});

session.connect();

// Wait for session to be ready
const checkInterval = setInterval(() => {
  if (session.isReady) {
    clearInterval(checkInterval);
    console.log('Session ready! Sending 3 seconds of synthetic 16kHz audio (440Hz tone and voice-range harmonics)...');

    // Generate 16kHz 16-bit PCM chunks (each 64ms = 1024 samples = 2048 bytes)
    const sampleRate = 16000;
    const chunkSize = 1024;
    const numChunks = 40; // ~2.5 seconds of audio

    let chunkIndex = 0;
    const sendTimer = setInterval(() => {
      if (chunkIndex >= numChunks) {
        clearInterval(sendTimer);
        console.log('Finished sending audio. Waiting for Gemini response...');
        return;
      }

      const pcmBuffer = new Int16Array(chunkSize);
      for (let i = 0; i < chunkSize; i++) {
        const t = (chunkIndex * chunkSize + i) / sampleRate;
        // Modulated tone in human voice frequency range (200Hz - 800Hz)
        const sample = Math.sin(2 * Math.PI * 300 * t) * 0.4 + Math.sin(2 * Math.PI * 600 * t) * 0.2;
        pcmBuffer[i] = Math.round(sample * 32767);
      }

      // Convert to base64
      const uint8 = new Uint8Array(pcmBuffer.buffer);
      const base64 = Buffer.from(uint8).toString('base64');
      session.sendAudioChunk(base64);

      chunkIndex++;
    }, 60);
  }
}, 500);

setTimeout(() => {
  console.log(`Test timeout. Received ${audioChunksReceived} audio chunks, ${transcriptReceived} transcripts.`);
  session.close();
  process.exit(0);
}, 18000);
