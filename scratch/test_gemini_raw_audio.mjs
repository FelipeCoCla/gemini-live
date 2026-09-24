import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

console.log('Connecting to Gemini Live...');
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WS Open. Sending setup...');
  const setupMsg = {
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO']
      }
    }
  };
  ws.send(JSON.stringify(setupMsg));
});

ws.on('message', (data) => {
  console.log('📩 Incoming message from Gemini:', data.toString().slice(0, 300));
});

ws.on('error', (err) => console.error('WS Error:', err));
ws.on('close', (code, reason) => console.log('WS Closed:', code, reason.toString()));

setTimeout(() => {
  console.log('Sending a text message turn to Gemini to verify bidirectional speech...');
  const clientContent = {
    clientContent: {
      turns: [
        {
          role: 'user',
          parts: [{ text: 'Hola Gemini, ¿puedes hablar conmigo? Di hola en una frase corta.' }]
        }
      ],
      turnComplete: true
    }
  };
  ws.send(JSON.stringify(clientContent));
}, 2000);

setTimeout(() => {
  console.log('Sending real-time audio chunk (PCM 16kHz)...');
  // 1 second of silence / tone PCM 16kHz
  const samples = 16000;
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * (i / 16000)) * 10000);
  }
  const base64 = Buffer.from(pcm.buffer).toString('base64');
  
  const audioMsg = {
    realtimeInput: {
      mediaChunks: [
        {
          mimeType: 'audio/pcm;rate=16000',
          data: base64
        }
      ]
    }
  };
  ws.send(JSON.stringify(audioMsg));
}, 6000);

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 15000);
