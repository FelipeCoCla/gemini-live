import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

const ws = new WebSocket(url);
const wav = fs.readFileSync('/tmp/question1.wav').subarray(4096);

ws.on('open', () => {
  console.log('Sending setup with inputTranscription and outputTranscription...');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO']
      },
      inputTranscription: {},
      outputTranscription: {}
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.setupComplete) {
    console.log('Setup complete. Streaming question1.wav ("¿Cuál es la distancia entre la Tierra y la Luna?")...');
    let offset = 0;
    const interval = setInterval(() => {
      if (offset >= wav.length) {
        clearInterval(interval);
        console.log('Audio finished. Sending turnComplete: true...');
        ws.send(JSON.stringify({ clientContent: { turnComplete: true } }));
        return;
      }
      const chunk = wav.subarray(offset, Math.min(offset + 2048, wav.length));
      ws.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=16000',
            data: chunk.toString('base64')
          }]
        }
      }));
      offset += 2048;
    }, 64);
  }

  // Log raw message keys and transcript
  if (msg.serverContent) {
    if (msg.serverContent.inputTranscription) {
      console.log('🎤 USER HEARD:', msg.serverContent.inputTranscription.text);
    }
    if (msg.serverContent.outputTranscription) {
      process.stdout.write(msg.serverContent.outputTranscription.text || '');
    }
    if (msg.serverContent.turnComplete) {
      console.log('\n[Turn Complete]');
      process.exit(0);
    }
  }
});

ws.on('error', (err) => console.error('WS Error:', err));
ws.on('close', (code, reason) => console.log('WS Closed:', code, reason.toString()));
