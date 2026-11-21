# WA Automator

Panel que conecta tu WhatsApp con Gemini para:

- **Resumen de chats:** las novedades más importantes desde la última vez, con el motivo (esperan tu respuesta, plazo, cita…).
- **Gestor de tareas:** extrae de tus chats lo que tienes que hacer, con urgencia y fecha límite, sin duplicados ni ruido (preguntas, comentarios o tareas de otras personas).
- **Recordatorios:** resumen diario y aviso el día que vence una tarea, por WhatsApp.
- **Modo ocupado:** la IA responde a quien te escribe por privado según el motivo (trabajo, iglesia, reunión…), te avisa si algo es urgente y al terminar te resume quién escribió.
- **Comandos desde WhatsApp:** escribe en tu chat contigo mismo `/resumen`, `/tareas`, `/pendientes`, `/ocupado iglesia 2h`, `/libre`, `/estado` o `/ayuda`.
- **Panel web** con contraseña, adaptado a móvil, con fotos de perfil de tus chats.

## Requisitos

- Node.js 20 o superior
- Una clave de la API de Gemini
- Opcional: una base de datos MySQL (si no hay, se usa un archivo JSON)

## Instalación en tu ordenador

```bash
npm install
cp .env.example .env   # y pon tu clave en GEMINI_API_KEY
npm start
```

Abre `http://localhost:3000/panel` y escanea el código QR con WhatsApp (Dispositivos vinculados). En `/` hay una portada pública de presentación, sin datos reales ni enlaces al panel.

## Datos

- **Con MySQL** (variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` o `DATABASE_URL`): las tareas se guardan en la tabla `tasks`, las descartadas en `archived_tasks` y el resto (ajustes, modo ocupado, progreso del análisis) en `app_state`. Las tablas se crean solas y, la primera vez, se migra lo que hubiera en `store.json`.
- **Sin MySQL:** todo va en `data/store.json`.
- En ambos casos `store.json` se mantiene como copia: si MySQL falla, la app sigue funcionando y lo actualiza al volver.

## Seguridad

- **En tu ordenador** el panel solo escucha en `127.0.0.1`. La contraseña (`PANEL_PASSWORD`) es opcional.
- **En un servidor** la contraseña es obligatoria (mínimo 10 caracteres): sin ella la app muestra una página de aviso y no conecta WhatsApp. El acceso usa una cookie de sesión `HttpOnly`, se bloquea tras 5 intentos fallidos durante 15 minutos y solo acepta peticiones del propio dominio por HTTPS.
- **Usuarios:** se entra con usuario y contraseña. La primera vez entra con el usuario `admin` y la contraseña de `PANEL_PASSWORD`, y crea tu usuario en `/registro` (con generador de contraseñas seguras). Solo se permite **un usuario**, porque el panel está vinculado a un único WhatsApp. Las contraseñas se guardan solo como hash scrypt en la tabla `users`. El registro no es público: solo se puede crear con la sesión iniciada y mientras no exista ya la cuenta. `admin` queda como acceso de emergencia.
- Los comandos de WhatsApp solo se obedecen si los escribes tú en tu propio chat.
- No se suben al repositorio: `.env` (claves y contraseñas), `.wwebjs_auth/` (sesión de WhatsApp: quien la tenga entra en tu cuenta), `data/` (tareas y resúmenes con texto de tus chats) ni `import/`.
- `whatsapp-web.js` no es una API oficial de WhatsApp: úsalo con moderación.

## Desplegar en un servidor

La app detecta sola cuándo corre en Hostinger (alojamiento compartido con Node.js): usa el dominio de la web, guarda la sesión y los datos en una carpeta persistente fuera del despliegue, descarga Chromium la primera vez y lo ejecuta en modo de un solo proceso y con pocos hilos (los alojamientos compartidos limitan ambos).

1. Sube el código (sin `node_modules`, `.env` ni `data/`) como app Node.js con `index.js` como archivo de entrada.
2. Añade las variables de entorno `PANEL_PASSWORD` y `GEMINI_API_KEY` (y, si quieres, crea una base de datos MySQL para la web).
3. Reinicia la app, abre `https://tu-dominio/panel`, entra con la contraseña y escanea el código QR.

En otros servidores define además `APP_DOMAIN` y `DATA_DIR` (ver `.env.example`). Usa una sola copia de la app por cuenta de WhatsApp: dos copias conectadas a la vez responderían todo por duplicado.
