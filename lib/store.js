// Almacenamiento local en un archivo JSON (data/store.json).
// Guarda las tareas, hasta dónde se analizó cada chat, el último resumen y los ajustes.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_SETTINGS = {
    dailyDigest: true,          // Resumen automático cada mañana por WhatsApp
    dailyDigestTime: '09:00',   // Hora del resumen diario (HH:MM)
    deadlineReminders: true,    // Aviso por WhatsApp el día que vence una tarea
    sendManualSummary: true,    // Enviar también a WhatsApp los resúmenes generados desde el panel
};

function defaults() {
    return {
        version: 1,
        accountId: null,                       // Cuenta de WhatsApp a la que pertenecen los cursores
        tasks: [],
        archivedTasks: [],                     // Tareas borradas/descartadas: se recuerdan para no volver a crearlas
        cursors: { tasks: {}, summary: {} },   // chatId -> marca de tiempo (s) del último mensaje analizado
        lastRun: { tasks: null, summary: null },
        lastSummary: null,                     // { items, generatedAt, since }
        settings: { ...DEFAULT_SETTINGS },
        scheduler: { lastDigestDate: null },
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

    const base = defaults();
    return {
        ...base,
        ...raw,
        cursors: { ...base.cursors, ...(raw.cursors || {}) },
        lastRun: { ...base.lastRun, ...(raw.lastRun || {}) },
        settings: { ...base.settings, ...(raw.settings || {}) },
        scheduler: { ...base.scheduler, ...(raw.scheduler || {}) },
        busy: { ...base.busy, ...(raw.busy || {}) },
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        archivedTasks: Array.isArray(raw.archivedTasks) ? raw.archivedTasks : [],
    };
}

const data = load();

// Escritura atómica: primero a un temporal y luego se renombra, para no dejar el archivo a medias
function save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify(data, null, 2);
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

module.exports = { data, save, backup, setAccount, DEFAULT_SETTINGS, FILE };
