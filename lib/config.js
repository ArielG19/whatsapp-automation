// Configuración según dónde corre la app: en tu ordenador (local) o en un servidor (alojada).
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL_PORT = 3000;

// Hostinger despliega en /home/<usuario>/domains/<dominio>/...: de ahí se deduce el dominio
const hostinger = [__dirname, process.env.HOME || '']
    .map(dir => /^(\/home\/[^/]+\/domains\/([^/]+))\//.exec(dir.replace(/\\/g, '/') + '/'))
    .find(Boolean) || null;

// La app se considera "alojada" (accesible desde internet) en Hostinger o si se indica con variables
const HOSTED = process.env.HOSTED === '1' || !!process.env.APP_DOMAIN || !!hostinger;

// Dominios desde los que se acepta el panel (APP_DOMAIN admite varios separados por comas)
const DOMAINS = (process.env.APP_DOMAIN || (hostinger ? hostinger[2] : ''))
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// Carpeta persistente para la sesión de WhatsApp y los datos.
// En un servidor debe quedar FUERA de la carpeta del despliegue, que se sustituye en cada actualización.
const DATA_ROOT = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : (hostinger ? path.join(hostinger[1], 'wa-automator-data') : null);

// Zona horaria para los recordatorios (en local se usa la del sistema)
if (HOSTED && !process.env.TZ) process.env.TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';

const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const MIN_PASSWORD_LENGTH = 10;

module.exports = {
    ROOT,
    LOCAL_PORT,
    HOSTED,
    DOMAINS,
    IS_HOSTINGER: !!hostinger,
    STORE_DIR: DATA_ROOT ? path.join(DATA_ROOT, 'data') : path.join(ROOT, 'data'),
    WA_AUTH_DIR: DATA_ROOT ? path.join(DATA_ROOT, 'wwebjs_auth') : path.join(ROOT, '.wwebjs_auth'),
    WA_CACHE_DIR: DATA_ROOT ? path.join(DATA_ROOT, 'wwebjs_cache') : path.join(ROOT, '.wwebjs_cache'),
    PANEL_PASSWORD,
    MIN_PASSWORD_LENGTH,
    // En internet el panel NUNCA se abre sin una contraseña suficientemente larga
    PASSWORD_OK: PANEL_PASSWORD.length >= MIN_PASSWORD_LENGTH,
    AUTH_REQUIRED: HOSTED || PANEL_PASSWORD.length > 0,
    // El alojamiento compartido no deja a Chromium repartirse en varios procesos
    CHROME_SINGLE_PROCESS: process.env.CHROME_SINGLE_PROCESS
        ? process.env.CHROME_SINGLE_PROCESS === '1'
        : !!hostinger,
};
