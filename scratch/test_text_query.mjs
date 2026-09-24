import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WS connected.');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO']
      }
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Got msg:', Object.keys(msg));
  if (msg.setupComplete) {
    console.log('Sending text question...');
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text: 'Hola, ¿cuál es la capital de Francia?' }]
        }],
        turnComplete: true
      }
    }));
  }
  if (msg.serverContent) {
    if (msg.serverContent.outputTranscription) {
      process.stdout.write(msg.serverContent.outputTranscription.text || '');
    }
    if (msg.serverContent.turnComplete) {
      console.log('\nTurn complete!');
      process.exit(0);
    }
  }
});

ws.on('error', (err) => console.error('WS error:', err));
ws.on('close', (code, reason) => console.log('WS closed:', code, reason.toString()));
