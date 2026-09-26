# 🎙️ Gemini Live + Hermes Voice Interface PWA

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Gemini 3.8 Live](https://img.shields.io/badge/Gemini-3.8%20Live-blue.svg)](https://ai.google.dev/)
[![PWA](https://img.shields.io/badge/PWA-Ready-purple.svg)](https://web.dev/progressive-web-apps/)

Progressive Web App (PWA) minimalista y manos libres que funciona como canal de voz continuo e inteligente entre el usuario y su orquestador de sistemas técnicos (**Hermes**), con procesamiento de voz bidireccional en tiempo real a través de **Gemini 3.8 Live**.

---

## 🌟 Características Principales

- **Orbe Reactivo en Tiempo Real:** Renderizado fluido mediante Canvas con estados visuales claros (*Desconectado*, *Escuchando*, *Pensando*, *Hablando*).
- **Audio Bidireccional de Baja Latencia:** Captura PCM lineal a 16 kHz mediante `AudioWorklet` y reproducción PCM a 24 kHz continua y sin chasquidos.
- **Interfaz estilo WhatsApp:** Conversación fluida con diseño dark moderno en Obsidian/Cyan, burbujas de diálogo y transcripciones sincronizadas.
- **Soporte Móvil (Android / iOS):** PWA instalable con diseño adaptativo y audio WebRTC/WebAudio de baja latencia.
- **Human-in-the-Loop & Tool Calling:** Herramienta `send_to_orchestrator` integrada para delegar tareas técnicas complejas a Hermes e inyectar turnos vocales proactivos de clarificación.

---

## 📚 Documentación de Arquitectura y Resolución de Problemas

Para un análisis exhaustivo de la arquitectura, cronología de desafíos encontrados y cómo se solucionaron, consulta:
👉 **[PROYECTO_ESTADO_Y_ARQUITECTURA.md](PROYECTO_ESTADO_Y_ARQUITECTURA.md)**

---

## 🚀 Inicio Rápido

### Requisitos Previos
- Node.js 18 o superior.
- Clave de API de Google AI Studio con acceso a Gemini 3.8 Live.

### 1. Clonar e Instalar Dependencias
```bash
git clone https://github.com/FelipeCoCla/gemini-live.git
cd gemini-live
npm install
```

### 2. Configurar Variables de Entorno
Copia la plantilla y configura tu clave de Gemini:
```bash
cp .env.example .env
```
Edita `.env`:
```env
PORT=4040
GEMINI_API_KEY=tu_api_key_aqui
GEMINI_MODEL=models/gemini-3.8-live
GEMINI_VOICE=Aoede
HERMES_API_URL=https://hermes.bolidus.xyz/v1/chat/completions
```

### 3. Ejecutar el Servidor
```bash
# Modo desarrollo con recarga automática
npm run dev

# Modo producción
npm start
```

### 4. Acceder a la Interfaz
- **Desktop (Localhost):** [http://localhost:4040](http://localhost:4040)
- **Producción:** [https://voice.bolidus.xyz](https://voice.bolidus.xyz)

---

## 🛠️ Estructura del Proyecto

```
gemini-live/
├── public/                       # Frontend Progressive Web App
│   ├── index.html                # Interfaz principal de usuario
│   ├── styles.css                # Estilos Obsidian/Cyan y diseño responsive
│   ├── app.js                    # Web Audio API, WebSocket client y lógica UI
│   ├── orb.js                    # Motor gráfico del orbe
│   ├── sound-effects.js          # Síntesis procedural de efectos de sonido (Zen Bell)
│   ├── audio-recorder-worklet.js # Procesamiento de audio en tiempo real
│   ├── service-worker.js         # Cache y capacidades PWA offline
│   └── manifest.json             # Manifiesto PWA para instalación móvil
├── server/                       # Backend Gateway & Orquestador
│   ├── server.mjs                # Servidor HTTP y WebSocket
│   ├── gemini-live.mjs           # Sesión bidireccional con Gemini 3.8 Live
│   └── orchestrator.mjs          # Conexión con Hermes
├── PROYECTO_ESTADO_Y_ARQUITECTURA.md # Bitácora técnica y arquitectura
└── package.json
```

---

## 📄 Licencia

MIT © Felipe Contreras Clavero
