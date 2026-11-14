# WA Automator

Panel local que conecta tu WhatsApp con Gemini para:

- **Resumen de chats:** las novedades más importantes desde la última vez, con el motivo (esperan tu respuesta, plazo, cita…).
- **Gestor de tareas:** extrae de tus chats lo que tienes que hacer, con urgencia y fecha límite, sin duplicados.
- **Recordatorios:** resumen diario y aviso el día que vence una tarea, por WhatsApp.
- **Modo ocupado:** la IA responde a quien te escribe por privado según el motivo (trabajo, iglesia, reunión…) y te avisa si algo es urgente.

## Requisitos

- Node.js 20 o superior
- Una clave de la API de Gemini

## Instalación

```bash
npm install
cp .env.example .env   # y pon tu clave en GEMINI_API_KEY
npm start
```

Abre `http://localhost:3000` y escanea el código QR con WhatsApp (Dispositivos vinculados).

## Seguridad

- El panel solo escucha en `127.0.0.1` y no tiene contraseña: **no lo expongas a internet** sin añadir antes autenticación.
- No se suben al repositorio: `.env` (clave de Gemini), `.wwebjs_auth/` (sesión de WhatsApp: quien la tenga entra en tu cuenta) ni `data/` (tareas y resúmenes con texto de tus chats).
- `whatsapp-web.js` no es una API oficial de WhatsApp: úsalo con moderación.
