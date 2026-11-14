// Detección de tareas repetidas.
// Gemini redacta la misma tarea de forma distinta cada vez ("Enviar el informe a Ana" /
// "Mandar a Ana el informe"), así que comparar el texto exacto no basta.

// Texto sin mayúsculas, acentos ni signos
function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9ñ ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Palabras significativas (se ignoran las de 1-2 letras: "a", "el", "de"...)
function words(text) {
    return new Set(normalizeText(text).split(' ').filter(w => w.length > 2));
}

// Parecido entre dos textos de 0 (nada) a 1 (mismas palabras)
function similarity(a, b) {
    const A = words(a);
    const B = words(b);
    if (A.size === 0 || B.size === 0) return 0;
    let common = 0;
    for (const w of A) if (B.has(w)) common++;
    return (2 * common) / (A.size + B.size);
}

// ¿Son la misma tarea?
function isSameTask(a, b) {
    const textA = normalizeText(a.text);
    if (textA && textA === normalizeText(b.text)) return true;

    // El resto de comprobaciones solo dentro del mismo chat
    if (!a.sourceId || a.sourceId !== b.sourceId) return false;

    const textSim = similarity(a.text, b.text);
    const quoteA = normalizeText(a.quote);
    const sameQuote = quoteA !== '' && quoteA === normalizeText(b.quote);

    // Mismo mensaje de origen y redacción parecida. (Un mismo mensaje puede generar
    // dos tareas distintas, como "comprar pan" y "llamar al fontanero": por eso se exige parecido.)
    if (sameQuote && textSim >= 0.4) return true;

    // Redacción casi igual y además cita parecida o misma fecha límite
    const sameDeadline = !!a.deadline && a.deadline === b.deadline;
    return textSim >= 0.75 && (similarity(a.quote, b.quote) >= 0.5 || sameDeadline);
}

function findDuplicate(candidate, tasks) {
    return tasks.find(t => isSameTask(candidate, t)) || null;
}

const URGENCY_RANK = { alta: 0, media: 1, baja: 2 };

// Une la información de 'other' en 'keeper' sin perder nada útil
function mergeInto(keeper, other) {
    if ((URGENCY_RANK[other.urgency] ?? 1) < (URGENCY_RANK[keeper.urgency] ?? 1)) keeper.urgency = other.urgency;
    if (!keeper.deadline && other.deadline) keeper.deadline = other.deadline;
    if (!keeper.quote && other.quote) keeper.quote = other.quote;
    if (!keeper.link && other.link) keeper.link = other.link;
    // Si alguna copia ya estaba hecha, la tarea está hecha
    if (other.completed && !keeper.completed) {
        keeper.completed = true;
        keeper.completedAt = other.completedAt || Date.now();
    }
    if (!keeper.remindedOn && other.remindedOn) keeper.remindedOn = other.remindedOn;
    keeper.createdAt = Math.min(keeper.createdAt || Infinity, other.createdAt || Infinity);
}

// Elimina las tareas repetidas de una lista, conservando la más antigua de cada grupo
function mergeDuplicates(tasks) {
    const ordered = [...tasks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const kept = [];
    let removed = 0;
    for (const task of ordered) {
        const dup = findDuplicate(task, kept);
        if (dup) {
            mergeInto(dup, task);
            removed++;
        } else {
            kept.push(task);
        }
    }
    return { tasks: kept, removed };
}

module.exports = { normalizeText, similarity, isSameTask, findDuplicate, mergeInto, mergeDuplicates };
