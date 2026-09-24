/**
 * Gemini 3.8 Live WebSocket Bridge
 * Handles real-time voice streaming with immediate vocal confirmation,
 * async Hermes dispatch, and proactive vocal follow-up.
 */

import { WebSocket } from 'ws';
import { dispatchToHermesAsync } from './orchestrator.mjs';

const SYSTEM_PROMPT = `Eres la interfaz de voz inteligente y humana entre Felipe y su orquestador técnico central Hermes en su bunker.
Tus responsabilidades:
1. CONVERSACIÓN DIRECTA Y RESPUESTA PRECISA:
   - Escucha con máxima atención lo que Felipe te dice o pregunta.
   - Responde SIEMPRE de forma directa, concisa, natural y en español a la pregunta o tema específico que Felipe haya mencionado.
   - REGLA CRÍTICA ANTI-SALUDOS: NUNCA repitas saludos genéricos ("Hola, un gusto en saludarte, ¿en qué puedo ayudarte hoy?" o similares) si el usuario ya te ha hablado o hecho una pregunta. Solo saluda brevemente si el usuario te saluda primero explícitamente ("hola", "buenos días"). Si no entendiste con claridad su pregunta, dile de forma natural y breve: "No te entendí bien, ¿me repites?", NUNCA uses un saludo de bienvenida.
2. DELEGACIÓN A HERMES (Solo tareas técnicas explícitas):
   - ÚNICAMENTE invoca la herramienta 'send_to_orchestrator' cuando Felipe te pida EXPRESAMENTE realizar una acción técnica en el bunker, como:
     * Ejecutar comandos de terminal o consola.
     * Analizar o modificar repositorios Git (commits, branches, diffs).
     * Correr scripts, pruebas o gestionar Docker / servidores.
     * O cuando te diga expresamente: "dile a Hermes que...", "Hermes, haz...", "pásale esto a Hermes".
   - Al invocar la herramienta, dile INMEDIATAMENTE una frase corta de confirmación por voz (ejemplos: "Entendido, se lo paso a Hermes", "Conectando con Hermes para revisar eso", "Listo, ejecutando en el bunker").
3. SEGUIMIENTO DE HERMES:
   - Cuando recibas en el sistema un turno con [RESPUESTA DE HERMES] o [MENSAJE DE HERMES], comunícaselo de inmediato a Felipe por voz de forma clara, natural y al grano.
   - Si Hermes necesita aclaración, pregúntasela a Felipe por voz directamente.
4. Mantén las respuestas por voz ágiles, sin rodeos y adaptadas al ritmo de una conversación fluida.
5. REGLA ESTRICTA DE SILENCIO Y RUIDO AMBIENTAL:
   - Si en el turno de audio del usuario solo hay silencio, respiración, ruido ambiental tenue o chasquidos sin palabras habladas inteligibles, QUÉDATE EN TOTAL SILENCIO. NO digas nada, NO preguntes "¿qué necesitas?", ni respondas a sonidos accidentales. Espera pacientemente a que Felipe hable con palabras claras.
6. IDIOMA Y TONO ESTRICTOS:
   - Tu idioma EXCLUSIVO es el ESPAÑOL.
   - NUNCA respondas en inglés bajo ninguna circunstancia. Está terminantemente prohibido usar frases como "Yes, I am here", "I'm ready", "I can help you".
   - Responde siempre en español latinoamericano claro, humano y natural (ejemplo: "Sí, aquí estoy", "Dime", "Estoy listo").`;

const TOOLS_CONFIG = [
  {
    functionDeclarations: [
      {
        name: 'send_to_orchestrator',
        description: 'Delega una tarea técnica de ejecución de comandos, terminal, scripts, repositorios git o consultas de infraestructura a Hermes en el bunker. NO usar para saludos, preguntas generales ni conversación casual.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task: {
              type: 'STRING',
              description: 'Descripción depurada de la tarea técnica a ejecutar por Hermes'
            },
            action_type: {
              type: 'STRING',
              description: 'Tipo de acción técnica: command, git, script, deploy, docker, query'
            },
            details: {
              type: 'OBJECT',
              description: 'Detalles adicionales estructurados sobre la tarea'
            }
          },
          required: ['task', 'action_type']
        }
      }
    ]
  }
];

export class GeminiLiveSession {
  /**
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.model
   * @param {string} options.voiceName
   * @param {Function} options.onAudioOutput - (base64Pcm24k) => void
   * @param {Function} options.onStateChange - (state, metadata) => void
   * @param {Function} options.onInterrupted - () => void
   * @param {Function} options.onTranscript - (role, text) => void
   * @param {Function} options.onError - (err) => void
   * @param {Function} options.onClose - () => void
   */
  constructor(options) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.model = options.model || process.env.GEMINI_MODEL || 'models/gemini-3.8-live';
    this.voiceName = options.voiceName || process.env.GEMINI_VOICE || 'Aoede';
    
    this.onAudioOutput = options.onAudioOutput;
    this.onStateChange = options.onStateChange;
    this.onInterrupted = options.onInterrupted;
    this.onTranscript = options.onTranscript;
    this.onError = options.onError;
    this.onClose = options.onClose;

    this.ws = null;
    this.isReady = false;
    this.isClosed = false;
    this.isSpeaking = false;
    this.isGenerating = false;
    this.recentModelTexts = [];
  }

  connect() {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    console.log(`[GeminiLive] Connecting to Gemini Live API (${this.model})...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[GeminiLive] Connected to Gemini Live WebSocket. Sending setup configuration...');
      this.sendSetup();
    });

    this.ws.on('message', async (data) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        if (msg.serverContent) {
          console.log('[GeminiLive] 📩 serverContent:', Object.keys(msg.serverContent).join(', '));
        }
        await this.handleServerMessage(msg);
      } catch (err) {
        console.error('[GeminiLive] Failed parsing message:', err.message);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[GeminiLive] WebSocket error:', err.message);
      if (this.onError) this.onError(err);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[GeminiLive] WebSocket closed (${code}): ${reason.toString()}`);
      this.isReady = false;
      this.isClosed = true;
      this.isSpeaking = false;
      this.isGenerating = false;
      if (this.onClose) this.onClose(code, reason.toString());
    });
  }

  sendSetup() {
    const setupMessage = {
      setup: {
        model: this.model,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceName
              }
            }
          }
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        tools: TOOLS_CONFIG
      }
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  async handleServerMessage(msg) {
    // 1. Setup completed
    if (msg.setupComplete) {
      console.log('[GeminiLive] ✅ Setup completed. Session is LIVE and listening.');
      this.isReady = true;
      if (this.onStateChange) this.onStateChange('ready');
      if (this.pendingText) {
        const txt = this.pendingText;
        this.pendingText = null;
        setTimeout(() => this.sendUserText(txt), 100);
      }
      return;
    }

    // 2. Server Content (Audio / Text / Interruption)
    if (msg.serverContent) {
      const { modelTurn, interrupted, turnComplete } = msg.serverContent;

      if (interrupted) {
        console.log('[GeminiLive] ⚡ Model turn interrupted by user speech (barge-in)');
        this.isSpeaking = false;
        this.isGenerating = false;
        if (this.onInterrupted) this.onInterrupted();
        if (this.onStateChange) this.onStateChange('listening');
      }

      const filterNonSpeechTokens = (text) => {
        if (!text) return '';
        const lower = text.toLowerCase();
        if (lower.includes('no speech') || 
            lower.includes('no audio') || 
            lower.includes('no_speech') || 
            lower.includes('detected') ||
            lower.includes('silence') || 
            lower.includes('silencio') ||
            lower.includes('<') ||
            lower.includes('>')) {
          return '';
        }
        let stripped = text.replace(/<[^>]+>/g, '').replace(/\[[^\]]+\]/g, '');
        if (!stripped.trim() || /^[\s.,!?;:–—-]+$/.test(stripped.trim())) {
          return '';
        }
        return stripped;
      };

      const extractText = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val.text === 'string') return val.text;
        if (Array.isArray(val.parts)) {
          return val.parts.map(p => p.text || '').join('');
        }
        return '';
      };

      // Native Gemini Live user speech transcription
      const rawUserText = extractText(msg.serverContent.inputTranscription) || 
                          extractText(msg.serverContent.interimInputTranscription) ||
                          extractText(msg.serverContent.userTurn);
      if (rawUserText) {
        const cleanUser = filterNonSpeechTokens(rawUserText);
        if (cleanUser && !this.isEchoOfModel(cleanUser)) {
          console.log(`[GeminiLive] 👤 Usuario: "${cleanUser}"`);
          if (this.onTranscript) {
            this.onTranscript('user', cleanUser);
          }
        } else if (cleanUser) {
          console.log(`[GeminiLive] 🛡️ Ignored model echo in inputTranscription: "${cleanUser}"`);
        }
      }

      let outputTranscribed = false;
      const rawModelText = extractText(msg.serverContent.outputTranscription);
      if (rawModelText) {
        const cleanModel = filterNonSpeechTokens(rawModelText);
        if (cleanModel) {
          console.log(`[GeminiLive] 🗣️ Gemini: "${cleanModel}"`);
          this.recentModelTexts.push(cleanModel);
          if (this.recentModelTexts.length > 20) this.recentModelTexts.shift();
          if (this.onTranscript) {
            this.onTranscript('model', cleanModel);
          }
          outputTranscribed = true;
        }
      }

      if (modelTurn) {
        this.isGenerating = true;
        if (modelTurn.parts) {
          for (const part of modelTurn.parts) {
            if (part.text && this.onTranscript && !outputTranscribed) {
              const cleanPart = filterNonSpeechTokens(part.text);
              if (cleanPart) {
                this.recentModelTexts.push(cleanPart);
                if (this.recentModelTexts.length > 20) this.recentModelTexts.shift();
                this.onTranscript('model', cleanPart);
              }
            }
            if (part.inlineData && part.inlineData.data) {
              this.isSpeaking = true;
              if (this.speakingTimeout) clearTimeout(this.speakingTimeout);
              this.speakingTimeout = setTimeout(() => {
                this.isSpeaking = false;
                this.isGenerating = false;
                if (this.onStateChange) this.onStateChange('listening');
              }, 2500);

              if (this.onAudioOutput) {
                this.onAudioOutput(part.inlineData.data);
              }
              if (this.onStateChange) {
                this.onStateChange('speaking');
              }
            }
          }
        }
      }

      if (turnComplete) {
        this.isGenerating = false;
        // Do not immediately drop isSpeaking while audio may still be playing
        if (!this.isSpeaking && this.onStateChange) {
          this.onStateChange('listening');
        }
      }
    }

    // 3. Tool Calls from Gemini
    if (msg.toolCall && msg.toolCall.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        console.log(`[GeminiLive] 🛠️ Tool call received: ${call.name}`, call.args);
        
        if (call.name === 'send_to_orchestrator') {
          // Immediately send tool confirmation so Gemini can speak its vocal acknowledgment
          const immediateAck = dispatchToHermesAsync(call.args, {
            onComplete: (reply) => {
              console.log(`[GeminiLive] 📨 Hermes completed task, injecting reply for vocalization...`);
              if (this.onStateChange) {
                this.onStateChange('thinking', { task: 'Hermes completó la tarea' });
              }
              this.injectProactiveTurn(`[RESPUESTA DE HERMES]: ${reply}. Comunícale el resultado a Felipe por voz de forma clara, natural y concisa.`);
            },
            onClarification: (question) => {
              console.log(`[GeminiLive] ❓ Hermes needs clarification: "${question}"`);
              if (this.onStateChange) {
                this.onStateChange('thinking', { task: 'Hermes necesita aclaración' });
              }
              this.injectProactiveTurn(`[MENSAJE DE HERMES]: Hermes necesita saber: ${question}. Pregúntaselo a Felipe de forma concisa por voz.`);
            },
            onError: (errMessage) => {
              console.error(`[GeminiLive] ⚠️ Hermes error: ${errMessage}`);
              this.injectProactiveTurn(`[AVISO DE HERMES]: Hubo un problema al conectar con Hermes: ${errMessage}. Infórmaselo brevemente a Felipe por voz.`);
            }
          });

          // Respond immediately to Gemini so it doesn't block
          this.sendToolResponse(call.id, immediateAck);

          // Update UI state
          if (this.onStateChange) {
            this.onStateChange('thinking', { task: call.args.task, action_type: call.args.action_type });
          }
        }
      }
    }
  }

  /**
   * Commits a complete user speech audio turn to Gemini Live.
   * This guarantees 100% speech recognition without streaming chunk drops.
   * @param {string} base64Data
   * @param {string} mimeType
   */
  sendUserAudio(base64Data, mimeType = 'audio/pcm;rate=16000') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    console.log(`[GeminiLive] 🎙️ Committing user audio turn (${base64Data.length} chars, ${mimeType})...`);

    const payload = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sends audio chunk from client microphone (PCM 16kHz) to Gemini
   * @param {string} base64Pcm16k
   */
  sendAudioChunk(base64Pcm16k) {
    if (!this.isReady || this.isClosed || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Pcm16k
          }
        ]
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Responds to a tool call
   */
  sendToolResponse(callId, responseOutput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            response: {
              output: responseOutput
            }
          }
        ]
      }
    };

    console.log(`[GeminiLive] 📤 Sending tool response acknowledgment for call ${callId}`);
    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Injects a proactive message/turn into Gemini Live session
   * Gemini will immediately translate/vocalize it to the user.
   * @param {string} turnText
   */
  injectProactiveTurn(turnText) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    console.log(`[GeminiLive] 💬 Injecting proactive turn into Live session: "${turnText.slice(0, 100)}..."`);

    const payload = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: turnText
              }
            ]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sends user query as direct text turn (e.g. night mode or silent typing)
   * Gemini will process the exact text and respond by audio voice.
   * @param {string} text
   */
  sendUserText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (!this.isReady) {
      console.log(`[GeminiLive] ⏳ Session not ready yet, queuing user text: "${text}"`);
      this.pendingText = text;
      return;
    }

    console.log(`[GeminiLive] 👤 Direct user text query: "${text}"`);

    const payload = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [
              {
                text
              }
            ]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Signals to Gemini that the user has finished their speech turn.
   * This triggers immediate model inference and voice output generation.
   */
  signalTurnComplete() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.isSpeaking || this.isGenerating) {
      console.log('[GeminiLive] ⏭️ Skipping turnComplete: model is already generating/speaking');
      return;
    }

    console.log('[GeminiLive] 🏁 Signaling audioStreamEnd & turnComplete to Gemini...');
    
    // 1. Tell Gemini the audio stream ended
    this.ws.send(JSON.stringify({
      realtimeInput: {
        audioStreamEnd: true
      }
    }));

    // 2. Trigger immediate inference
    const payload = {
      clientContent: {
        turnComplete: true
      }
    };
    this.ws.send(JSON.stringify(payload));
  }

  isEchoOfModel(text) {
    if (!text || !this.recentModelTexts.length) return false;
    const normalize = (s) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\d]+/g, d => ({
        '1':'uno','2':'dos','3':'tres','4':'cuatro','5':'cinco','6':'seis','7':'siete',
        '8':'ocho','9':'nueve','10':'diez','11':'once','12':'doce','13':'trece',
        '14':'catorce','15':'quince','20':'veinte'
      }[d] || d))
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const normText = normalize(text);
    if (!normText || normText.length < 3) return false;

    const words = normText.split(' ').filter(w => w.length > 2);
    if (words.length === 0) return false;

    const combined = normalize(this.recentModelTexts.join(' '));
    if (combined.includes(normText)) return true;

    let matches = 0;
    for (const w of words) {
      if (combined.includes(w)) matches++;
    }
    return (matches / words.length) >= 0.6;
  }

  close() {
    this.isClosed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
  }
}
