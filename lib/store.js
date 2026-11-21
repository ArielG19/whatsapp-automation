// Almacenamiento de la app: tareas, hasta dónde se analizó cada chat, el último resumen y los ajustes.
// - Con base de datos configurada (servidor): MySQL es la fuente principal y store.json queda como copia.
// - Sin ella (tu ordenador): solo el archivo store.json.
// El resto de la app trabaja con el objeto "data" en memoria y llama a save() tras cada cambio.
const fs = require('fs');
const path = require('path');
const { createDb, archivedKey } = require('./db');

// En local es la carpeta data/ del proyecto; en un servidor, una carpeta persistente fuera del despliegue
const DATA_DIR = require('./config').STORE_DIR;
const FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_SETTINGS = {
    dailyDigest: true,          // Resumen automático cada mañana por WhatsApp
    dailyDigestTime: '09:00',   // Hora del resumen diario (HH:MM)
    deadlineReminders: true,    // Aviso por WhatsApp el día que vence una tarea
    sendManualSummary: false,   // Enviar también a WhatsApp los resúmenes generados desde el panel
};

function defaults() {
    return {
        version: 1,
        accountId: null,                       // Cuenta de WhatsApp a la que pertenecen los cursores
        tasks: [],
        archivedTasks: [],                     // Tareas borradas/descartadas: se recuerdan para no volver a crearlas
        users: [],                             // Usuarios del panel: { id, username, passwordHash, createdAt, lastLoginAt }
        cursors: { tasks: {}, summary: {} },   // chatId -> marca de tiempo (s) del último mensaje analizado
        lastRun: { tasks: null, summary: null },
        lastSummary: null,                     // { items, generatedAt, since }
        settings: { ...DEFAULT_SETTINGS },
        scheduler: { lastDigestDate: null },
        auth: { sessions: [] },                // Sesiones abiertas del panel (solo el hash de cada una)
        busy: {                                // Modo ocupado (respuestas automáticas)
            active: false,
            reason: 'ocupado',                 // ocupado | trabajo | iglesia | reunion | conduciendo | descansando | otro
            customText: '',                    // Motivo propio cuando reason = 'otro'
            durationMinutes: 0,                // 0 = hasta desactivarlo
            until: null,                       // ms; null = sin límite
            activatedAt: null,
            notifyUrgent: true,                // Avisar al momento si algo parece urgente
            summaryOnEnd: true,                // Al terminar, resumen de quién escribió
            inbox: [],                         // Quién escribió durante el modo ocupado
            autoReplyIds: [],                  // Mensajes enviados por la IA (para no analizarlos como tuyos)
        },
    };
}

// Completa lo leído (de archivo o de MySQL) con los valores por defecto
function normalize(raw) {
    const base = defaults();
    raw = raw || {};
    return {
        ...base,
        ...raw,
        cursors: { ...base.cursors, ...(raw.cursors || {}) },
        lastRun: { ...base.lastRun, ...(raw.lastRun || {}) },
        settings: { ...base.settings, ...(raw.settings || {}) },
        scheduler: { ...base.scheduler, ...(raw.scheduler || {}) },
        auth: { ...base.auth, ...(raw.auth || {}) },
        busy: { ...base.busy, ...(raw.busy || {}) },
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        archivedTasks: Array.isArray(raw.archivedTasks) ? raw.archivedTasks : [],
        users: Array.isArray(raw.users) ? raw.users : [],
    };
}

let fileSavedAt = 0; // cuándo se escribió por última vez el archivo (para comparar con MySQL al arrancar)

function load() {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        if (e.code !== 'ENOENT') {
            // Archivo dañado: apartarlo para no perderlo y empezar de cero
            const backup = FILE.replace(/\.json$/, `.danado-${Date.now()}.json`);
            try { fs.renameSync(FILE, backup); } catch (_) { /* ignorar */ }
            console.error(`No se pudo leer ${FILE} (${e.message}). Se guardó una copia en ${backup}.`);
        }
        return defaults();
    }
    fileSavedAt = Number(raw._savedAt) || 0;
    delete raw._savedAt;
    return normalize(raw);
}

const data = load();

// Sustituye el contenido de "data" sin cambiar el objeto (el resto de la app guarda la referencia)
function replaceData(next) {
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, normalize(next));
}

// Escritura atómica: primero a un temporal y luego se renombra, para no dejar el archivo a medias
function writeFile(savedAt) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify({ ...data, _savedAt: savedAt }, null, 2);
    const tmp = `${FILE}.tmp`;
    try {
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, FILE);
    } catch (e) {
        // En Windows el renombrado puede fallar si otro programa tiene el archivo abierto
        fs.writeFileSync(FILE, json);
        try { fs.unlinkSync(tmp); } catch (_) { /* ignorar */ }
    }
}

// ---------- MySQL ----------
let db = null;                 // conexión, si hay base de datos configurada y disponible
let lastSaveAt = 0;
let flushTimer = null;
let flushing = null;           // escritura en curso
let dirtyWhileFlushing = false;
let lastFlushError = null;
let lastFlushAt = null;
// Lo que hay ahora mismo en MySQL (para escribir solo lo que cambia)
const snapshot = { tasks: new Map(), archived: new Map(), users: new Map(), state: new Map() };

// Lo que tiene tabla propia en MySQL no se guarda en app_state
const TABLE_KEYS = new Set(['tasks', 'archivedTasks', 'users']);
const STATE_KEYS = () => Object.keys(data).filter(k => !TABLE_KEYS.has(k));
const userEntries = (users) => users.filter(u => u && u.id).map(u => [String(u.id), JSON.stringify(u)]);

function takeSnapshot(loaded) {
    snapshot.tasks = new Map(loaded.tasks.map(t => [String(t.id), JSON.stringify(t)]));
    snapshot.archived = new Map(loaded.archivedTasks.map(a => [archivedKey(a), JSON.stringify(a)]));
    snapshot.users = new Map(userEntries(loaded.users));
    snapshot.state = new Map(Object.entries(loaded.state).map(([k, v]) => [k, JSON.stringify(v)]));
}

// Escribe en MySQL las diferencias entre la memoria y lo último guardado
async function flushNow() {
    if (!db) return;
    const savedAt = lastSaveAt || Date.now();
    const current = {
        tasks: new Map(data.tasks.filter(t => t && t.id).map(t => [String(t.id), JSON.stringify(t)])),
        archived: new Map(data.archivedTasks.map(a => [archivedKey(a), JSON.stringify(a)])),
        users: new Map(userEntries(data.users)),
        state: new Map(STATE_KEYS().map(k => [k, JSON.stringify(data[k])])),
    };
    current.state.set('_meta', JSON.stringify({ savedAt }));

    const changes = {
        upsertTasks: [], deleteTasks: [], upsertArchived: [], deleteArchived: [], upsertUsers: [], deleteUsers: [], upsertState: [],
    };
    for (const [id, json] of current.tasks) if (snapshot.tasks.get(id) !== json) changes.upsertTasks.push(JSON.parse(json));
    for (const id of snapshot.tasks.keys()) if (!current.tasks.has(id)) changes.deleteTasks.push(id);
    for (const [id, json] of current.archived) if (snapshot.archived.get(id) !== json) changes.upsertArchived.push(JSON.parse(json));
    for (const id of snapshot.archived.keys()) if (!current.archived.has(id)) changes.deleteArchived.push(id);
    for (const [id, json] of current.users) if (snapshot.users.get(id) !== json) changes.upsertUsers.push(JSON.parse(json));
    for (const id of snapshot.users.keys()) if (!current.users.has(id)) changes.deleteUsers.push(id);
    for (const [k, json] of current.state) if (snapshot.state.get(k) !== json) changes.upsertState.push([k, json]);

    const total = changes.upsertTasks.length + changes.deleteTasks.length + changes.upsertArchived.length
        + changes.deleteArchived.length + changes.upsertUsers.length + changes.deleteUsers.length + changes.upsertState.length;
    if (total === 0) return;

    await db.applyChanges(changes);
    snapshot.tasks = current.tasks;
    snapshot.archived = current.archived;
    snapshot.users = current.users;
    snapshot.state = current.state;
    lastFlushAt = Date.now();
    if (lastFlushError) console.log('MySQL: vuelve a guardar correctamente.');
    lastFlushError = null;
}

function scheduleFlush(delay = 300) {
    if (!db) return;
    if (flushing) { dirtyWhileFlushing = true; return; }
    clearTimeout(flushTimer);
    flushTimer = setTimeout(runFlush, delay);
}

function runFlush() {
    flushTimer = null;
    dirtyWhileFlushing = false;
    flushing = flushNow()
        .catch((e) => {
            // Los datos siguen en memoria y en store.json: se reintenta en 30 s
            if (!lastFlushError) console.error('MySQL: no se pudo guardar; se reintentará (los datos siguen a salvo en store.json):', e.message);
            lastFlushError = e.message;
            dirtyWhileFlushing = true;
            return new Promise(r => setTimeout(r, 30000));
        })
        .finally(() => {
            flushing = null;
            if (dirtyWhileFlushing) scheduleFlush(0);
        });
    return flushing;
}

// Guarda: siempre en el archivo (al momento) y, si hay base de datos, en MySQL (unos instantes después)
function save() {
    lastSaveAt = Date.now();
    writeFile(lastSaveAt);
    scheduleFlush();
}

// Espera a que todo esté escrito en MySQL (al apagar la app)
async function flush() {
    if (!db) return;
    clearTimeout(flushTimer);
    if (flushing) await flushing;
    await flushNow().catch(e => console.error('MySQL: error al guardar antes de cerrar:', e.message));
}

// Al arrancar: conectar con MySQL (si está configurado) y decidir qué datos usar
async function init() {
    let attempt = 0;
    let candidate = null;
    while (true) {
        attempt++;
        try {
            candidate = await createDb();
            break;
        } catch (e) {
            if (attempt >= 5) {
                console.error(`MySQL: no se pudo conectar (${e.message}). La app sigue con store.json; se usará MySQL en el próximo arranque.`);
                return { backend: 'archivo', error: e.message };
            }
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    if (!candidate) return { backend: 'archivo' }; // sin base de datos configurada (p. ej. en tu ordenador)

    const loaded = await candidate.loadAll();
    takeSnapshot(loaded);
    db = candidate;

    const dbSavedAt = Number(loaded.state._meta && loaded.state._meta.savedAt) || 0;
    let action;
    if (loaded.empty) {
        // Primera vez: pasar a MySQL lo que había en el archivo
        action = `migrados desde store.json: ${data.tasks.length} tareas y ${data.archivedTasks.length} descartadas`;
        lastSaveAt = fileSavedAt || Date.now();
        await flushNow();
    } else if (fileSavedAt > dbSavedAt) {
        // El archivo es más reciente (p. ej. MySQL no estuvo disponible un tiempo): se actualiza MySQL
        action = 'store.json era más reciente: MySQL actualizado con su contenido';
        lastSaveAt = fileSavedAt;
        await flushNow();
    } else {
        delete loaded.state._meta;
        replaceData({ ...loaded.state, tasks: loaded.tasks, archivedTasks: loaded.archivedTasks, users: loaded.users });
        action = `cargadas ${data.tasks.length} tareas`;
        writeFile(dbSavedAt || Date.now()); // la copia en archivo refleja MySQL
    }
    console.log(`Datos en MySQL (${db.describe()}): ${action}.`);
    return { backend: 'mysql' };
}

function status() {
    return { backend: db ? 'mysql' : 'archivo', lastFlushAt, lastFlushError };
}

// Copia de seguridad antes de cambios grandes. Se conservan solo las más recientes.
const MAX_BACKUPS = 5;

function backup(label) {
    save(); // la copia refleja el estado actual
    const file = path.join(DATA_DIR, `store.${label}-${Date.now()}.json`);
    fs.copyFileSync(FILE, file);

    const backups = fs.readdirSync(DATA_DIR)
        .filter(name => /^store\.antes-de-[a-z-]+-\d+\.json$/.test(name))
        .map(name => ({ name, time: Number(name.match(/-(\d+)\.json$/)[1]) }))
        .sort((a, b) => b.time - a.time);
    for (const old of backups.slice(MAX_BACKUPS)) {
        try { fs.unlinkSync(path.join(DATA_DIR, old.name)); } catch (_) { /* ignorar */ }
    }
    return file;
}

// Si cambia la cuenta de WhatsApp, lo analizado de la cuenta anterior ya no sirve
function setAccount(accountId) {
    if (!accountId || data.accountId === accountId) return false;
    const changed = data.accountId !== null;
    data.accountId = accountId;
    if (changed) {
        data.cursors = { tasks: {}, summary: {} };
        data.lastRun = { tasks: null, summary: null };
        data.lastSummary = null;
    }
    save();
    return changed;
}

module.exports = { data, save, flush, init, status, backup, setAccount, DEFAULT_SETTINGS, FILE };
