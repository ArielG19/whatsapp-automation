// Comandos que escribes en tu propio chat de WhatsApp: /resumen, /tareas, /ocupado iglesia 2h...
// Aquí solo se interpreta el texto; lo que hace cada comando está en index.js.
const { normalizeText } = require('./dedupe');

// Nombre del comando -> nombre interno. Se aceptan variantes sin tilde y en inglés básico.
const COMMANDS = {
    ayuda: 'ayuda', help: 'ayuda', comandos: 'ayuda',
    resumen: 'resumen', novedades: 'resumen',
    tareas: 'tareas', extraer: 'tareas',
    pendientes: 'pendientes', lista: 'pendientes',
    ocupado: 'ocupado', ocupada: 'ocupado',
    libre: 'libre', disponible: 'libre', fin: 'libre',
    estado: 'estado', status: 'estado',
};

// "/Resumen completo" -> { name: 'resumen', args: 'completo' }; null si no es un comando conocido
function parseCommand(text) {
    const match = /^\s*\/([^\s/]+)\s*([\s\S]*)$/.exec(String(text || ''));
    if (!match) return null;
    const name = COMMANDS[normalizeText(match[1])];
    return name ? { name, args: match[2].trim() } : null;
}

function isCommandText(text) {
    return parseCommand(text) !== null;
}

// Motivos del modo ocupado: palabras que se reconocen para cada uno
const REASON_WORDS = [
    ['trabajo', ['trabajo', 'en el trabajo', 'trabajando', 'oficina', 'en la oficina']],
    ['iglesia', ['iglesia', 'en la iglesia', 'culto', 'en el culto', 'misa']],
    ['reunion', ['reunion', 'en una reunion', 'en reunion', 'reunido']],
    ['conduciendo', ['conduciendo', 'manejando', 'en el coche', 'en el carro']],
    ['descansando', ['descansando', 'durmiendo', 'dormido']],
    ['ocupado', ['', 'ocupado', 'ocupada']],
];

// Duración: 2h, 2 h, 2 horas, 1h30, 1h 30m, 45m, 45 min, 45 minutos, "hasta las 13:00"
function extractDuration(text, now = new Date()) {
    let rest = ` ${text} `;
    let minutes;

    const until = /\s(?:hasta\s+las?\s+)(\d{1,2})(?::(\d{2}))?\s*(?:h\b)?/i.exec(rest);
    if (until) {
        const target = new Date(now);
        target.setHours(Number(until[1]), Number(until[2] || 0), 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1); // "hasta las 8" dicho por la noche = mañana
        minutes = Math.round((target - now) / 60000);
        rest = rest.slice(0, until.index) + ' ' + rest.slice(until.index + until[0].length);
    } else {
        const hm = /\s(\d+)\s*(?:h|hr|hrs|hora|horas)(?=\d|\b)\s*(?:(\d+)\s*(?:m|min|mins|minuto|minutos)?\b)?/i.exec(rest);
        const m = /\s(\d+)\s*(?:m|min|mins|minuto|minutos)\b/i.exec(rest);
        if (hm) {
            minutes = Number(hm[1]) * 60 + Number(hm[2] || 0);
            rest = rest.slice(0, hm.index) + ' ' + rest.slice(hm.index + hm[0].length);
        } else if (m) {
            minutes = Number(m[1]);
            rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
        }
    }
    // Palabras de unión que sobran: "durante", "por", "unas"
    rest = rest.replace(/\s(durante|por|unas?|un|de)\s*$/i, ' ').replace(/^\s*(durante|por)\s/i, ' ');
    return { minutes, rest: rest.replace(/\s+/g, ' ').trim() };
}

// "/ocupado iglesia 2h" -> { reason: 'iglesia', customText: '', durationMinutes: 120 }
// "/ocupado en el gimnasio 45m" -> { reason: 'otro', customText: 'en el gimnasio', durationMinutes: 45 }
function parseBusyArgs(args, now = new Date()) {
    const { minutes, rest } = extractDuration(args, now);
    const key = normalizeText(rest);
    let reason = 'otro';
    for (const [name, words] of REASON_WORDS) {
        if (words.includes(key)) { reason = name; break; }
    }
    const result = { reason, customText: reason === 'otro' ? rest.slice(0, 60) : '' };
    if (minutes !== undefined) {
        if (minutes < 1 || minutes > 24 * 60) return { error: 'La duración debe estar entre 1 minuto y 24 horas.' };
        result.durationMinutes = minutes;
    }
    return result;
}

const HELP_TEXT = [
    '*Comandos* (escríbelos en este chat):',
    '',
    '/resumen: novedades importantes desde el último resumen',
    '/resumen completo: los últimos 2 días',
    '/tareas: busca tareas nuevas en tus chats',
    '/pendientes: tu lista de tareas pendientes',
    '/ocupado: activa el modo ocupado. Ejemplos:',
    '   /ocupado iglesia 2h',
    '   /ocupado trabajo hasta las 18:00',
    '   /ocupado en el gimnasio 45m',
    '/libre: desactiva el modo ocupado',
    '/estado: cómo está la app ahora',
    '/ayuda: esta lista',
].join('\n');

module.exports = { parseCommand, isCommandText, parseBusyArgs, HELP_TEXT };
