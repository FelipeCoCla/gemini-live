import fs from 'fs';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

const question = process.argv[2] || "¿Cuál es la capital de Italia?";
console.log('--- Diagnosing audio query:', question);

const tmpWav = `/tmp/diag_${Date.now()}.wav`;
execFileSync('/usr/bin/say', ['-v', 'Mónica', '-o', tmpWav, '--data-format=LEI16@16000', question]);
const wavBuf = fs.readFileSync(tmpWav);
const dataIdx = wavBuf.indexOf(Buffer.from('data'));
const pcmBuf = dataIdx !== -1 ? wavBuf.subarray(dataIdx + 8) : wavBuf.subarray(44);
fs.unlinkSync(tmpWav);

console.log(`PCM bytes: ${pcmBuf.length} (~${(pcmBuf.length / 32000).toFixed(2)}s)`);

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('Connected to Gemini Live. Sending setup...');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO']
      }
    }
  }));
});

let audioParts = 0;
let totalAudioBytes = 0;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.setupComplete) {
    console.log('Setup complete! Streaming audio chunks...');
    streamPcm();
  }

  if (msg.serverContent) {
    console.log('serverContent keys:', Object.keys(msg.serverContent));
    if (msg.serverContent.modelTurn) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.text) console.log('PART TEXT:', part.text);
        if (part.inlineData) {
          audioParts++;
          totalAudioBytes += Buffer.from(part.inlineData.data, 'base64').length;
        }
      }
    }
    if (msg.serverContent.inputTranscription) {
      console.log('🎤 USER INPUT HEARD BY GEMINI:', msg.serverContent.inputTranscription.text);
    }
    if (msg.serverContent.outputTranscription) {
      console.log('TRANSCRIPTION:', msg.serverContent.outputTranscription.text);
    }
    if (msg.serverContent.turnComplete) {
      console.log(`\nTurn complete! Total audio parts: ${audioParts}, bytes: ${totalAudioBytes}`);
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 1000);
    }
  }
});

ws.on('error', (err) => console.error('WS Error:', err));
ws.on('close', (code, reason) => console.log('WS Closed:', code, reason.toString()));

function streamPcm() {
  const chunkSize = 2048; // 64ms at 16kHz
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuf.length) {
      clearInterval(interval);
      console.log('All audio chunks sent. Streaming 1s of silence before turnComplete...');
      
      let silenceSent = 0;
      const silenceInterval = setInterval(() => {
        if (silenceSent >= 15) { // ~1s silence
          clearInterval(silenceInterval);
          console.log('Trailing silence sent. Now sending turnComplete: true...');
          ws.send(JSON.stringify({
            clientContent: {
              turnComplete: true
            }
          }));
          return;
        }

        const silent = Buffer.alloc(2048);
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: silent.toString('base64')
              }
            ]
          }
        }));
        silenceSent++;
      }, 64);
      return;
    }

    const chunk = pcmBuf.subarray(offset, Math.min(offset + chunkSize, pcmBuf.length));
    ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: chunk.toString('base64')
          }
        ]
      }
    }));
    offset += chunkSize;
  }, 64);
}
