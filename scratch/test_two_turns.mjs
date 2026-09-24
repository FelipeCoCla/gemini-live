import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

const SYSTEM_PROMPT = `Eres la interfaz de voz inteligente entre Felipe y su orquestador técnico central Hermes en su bunker.
Tus directrices:
1. Para saludos, conversación casual, preguntas generales o explicaciones: responde TÚ DIRECTAMENTE por voz en español de forma natural, cercana y concisa. NUNCA llames a Hermes para preguntas normales o charla casual.
2. ÚNICAMENTE cuando Felipe te pida explícitamente ejecutar un comando técnico en la terminal, correr un script, consultar o modificar repositorios git, o cuando mencione a "Hermes" para realizar una tarea técnica en el bunker:
   a) Invoca la herramienta 'send_to_orchestrator'.
   b) Confirma de inmediato con una frase corta y ejecutiva (ej: "Entendido, se lo paso a Hermes", "Conectando con Hermes para ejecutar eso").
3. Si recibes una notificación [RESPUESTA DE HERMES] o [MENSAJE DE HERMES], resúmesela a Felipe por audio con claridad y al grano.`;

const TOOLS_CONFIG = [
  {
    functionDeclarations: [
      {
        name: 'send_to_orchestrator',
        description: 'Ejecuta comandos técnicos, scripts o tareas de infraestructura en el bunker de Hermes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task: { type: 'STRING', description: 'Tarea técnica a ejecutar' },
            action_type: { type: 'STRING', description: 'Tipo de acción (command, git, script)' }
          },
          required: ['task', 'action_type']
        }
      }
    ]
  }
];

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('Connected to Gemini Live. Sending setup...');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }
          }
        }
      },
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: TOOLS_CONFIG
    }
  }));
});

let turn = 1;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.setupComplete) {
    console.log('✅ Setup complete. Sending Turn 1: text user question: "¿Qué hora es en Tokio y cómo está el clima?"');
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: 'Hola, ¿qué hora es en Tokio aproximadamente?' }] }],
        turnComplete: true
      }
    }));
  }

  if (msg.toolCall) {
    console.log('🛠️ TOOL CALL:', msg.toolCall);
  }

  if (msg.serverContent) {
    if (msg.serverContent.outputTranscription?.text) {
      console.log(`🗣️ Gemini Turn ${turn}: "${msg.serverContent.outputTranscription.text}"`);
    }
    if (msg.serverContent.turnComplete) {
      console.log(`🎯 Turn ${turn} complete!`);
      if (turn === 1) {
        turn = 2;
        console.log('\n--- Sending Turn 2 (Follow-up general question) ---');
        setTimeout(() => {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: 'Genial. Y dime, ¿cuál es la capital de Francia?' }] }],
              turnComplete: true
            }
          }));
        }, 1000);
      } else if (turn === 2) {
        turn = 3;
        console.log('\n--- Sending Turn 3 (Hermes technical task) ---');
        setTimeout(() => {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: 'Hermes, revisa el estado del contenedor Docker de la base de datos.' }] }],
              turnComplete: true
            }
          }));
        }, 1000);
      } else if (turn === 3) {
        console.log('✅ All 3 turns verified!');
        setTimeout(() => {
          ws.close();
          process.exit(0);
        }, 2000);
      }
    }
  }
});
