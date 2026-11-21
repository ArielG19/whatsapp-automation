// Guardado en MySQL. Se activa solo si hay variables de conexión (DB_HOST, DB_NAME... o DATABASE_URL);
// en tu ordenador, sin ellas, la app sigue usando el archivo store.json.
//
// Tablas:
//   tasks          una fila por tarea (columnas legibles + la tarea completa en "data")
//   archived_tasks tareas descartadas o limpiadas (para no volver a proponerlas)
//   users          usuarios del panel (solo el hash de la contraseña, nunca la contraseña)
//   app_state      el resto: ajustes, modo ocupado, progreso del análisis, último resumen... (JSON por clave)
const crypto = require('crypto');

function connectionConfig() {
    const env = process.env;
    if (env.DB_HOST && env.DB_NAME && env.DB_USER) {
        return {
            host: env.DB_HOST,
            port: Number(env.DB_PORT) || 3306,
            database: env.DB_NAME,
            user: env.DB_USER,
            password: env.DB_PASSWORD || '',
        };
    }
    if (env.DATABASE_URL && /^mysql:\/\//i.test(env.DATABASE_URL)) return { uri: env.DATABASE_URL };
    return null;
}

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        text VARCHAR(400) NOT NULL,
        source_name VARCHAR(200) NULL,
        source_id VARCHAR(200) NULL,
        urgency VARCHAR(10) NULL,
        deadline DATE NULL,
        completed TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NULL,
        completed_at BIGINT NULL,
        data LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tasks_completed (completed),
        INDEX idx_tasks_deadline (deadline)
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS archived_tasks (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        text VARCHAR(400) NULL,
        reason VARCHAR(120) NULL,
        archived_at BIGINT NULL,
        data LONGTEXT NOT NULL
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        username VARCHAR(40) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at BIGINT NULL,
        last_login_at BIGINT NULL,
        UNIQUE KEY uq_users_username (username)
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS app_state (
        k VARCHAR(64) NOT NULL PRIMARY KEY,
        v LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`,
];

// Clave estable para cada tarea archivada (las antiguas pueden no tener id)
function archivedKey(a) {
    if (a && a.id) return String(a.id).slice(0, 80);
    return 'arch-' + crypto.createHash('sha1').update(`${a && a.text}|${a && a.archivedAt}`).digest('hex').slice(0, 32);
}

function taskRow(t) {
    return [
        String(t.id).slice(0, 64),
        String(t.text || '').slice(0, 400),
        t.sourceName ? String(t.sourceName).slice(0, 200) : null,
        t.sourceId ? String(t.sourceId).slice(0, 200) : null,
        t.urgency || null,
        /^\d{4}-\d{2}-\d{2}$/.test(t.deadline || '') ? t.deadline : null,
        t.completed ? 1 : 0,
        Number(t.createdAt) || null,
        Number(t.completedAt) || null,
        JSON.stringify(t),
    ];
}

function archivedRow(a) {
    return [
        archivedKey(a),
        a.text ? String(a.text).slice(0, 400) : null,
        a.reason ? String(a.reason).slice(0, 120) : null,
        Number(a.archivedAt) || null,
        JSON.stringify(a),
    ];
}

async function createDb() {
    const config = connectionConfig();
    if (!config) return null;
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
        ...config,
        connectionLimit: 2,
        charset: 'utf8mb4',
        enableKeepAlive: true,
        connectTimeout: 10000,
    });

    // Comprobar la conexión y crear las tablas si no existen
    for (const sql of SCHEMA) await pool.query(sql);

    async function loadAll() {
        const [taskRows] = await pool.query('SELECT data FROM tasks ORDER BY created_at, id');
        const [archRows] = await pool.query('SELECT data FROM archived_tasks ORDER BY archived_at, id');
        const [userRows] = await pool.query('SELECT id, username, password_hash, created_at, last_login_at FROM users ORDER BY created_at, id');
        const [stateRows] = await pool.query('SELECT k, v FROM app_state');
        const state = {};
        for (const row of stateRows) {
            try { state[row.k] = JSON.parse(row.v); } catch (e) { /* fila dañada: se ignora */ }
        }
        return {
            tasks: taskRows.map(r => JSON.parse(r.data)),
            archivedTasks: archRows.map(r => JSON.parse(r.data)),
            users: userRows.map(r => ({
                id: r.id,
                username: r.username,
                passwordHash: r.password_hash,
                createdAt: r.created_at === null ? null : Number(r.created_at),
                lastLoginAt: r.last_login_at === null ? null : Number(r.last_login_at),
            })),
            state,
            empty: taskRows.length === 0 && archRows.length === 0 && stateRows.length === 0 && userRows.length === 0,
        };
    }

    // Aplica los cambios en una transacción: todo o nada
    async function applyChanges({ upsertTasks, deleteTasks, upsertArchived, deleteArchived, upsertUsers = [], deleteUsers = [], upsertState }) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const t of upsertTasks) {
                await conn.query(
                    `INSERT INTO tasks (id, text, source_name, source_id, urgency, deadline, completed, created_at, completed_at, data)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE text = VALUES(text), source_name = VALUES(source_name), source_id = VALUES(source_id),
                       urgency = VALUES(urgency), deadline = VALUES(deadline), completed = VALUES(completed),
                       created_at = VALUES(created_at), completed_at = VALUES(completed_at), data = VALUES(data)`,
                    taskRow(t));
            }
            if (deleteTasks.length) await conn.query('DELETE FROM tasks WHERE id IN (?)', [deleteTasks]);
            for (const a of upsertArchived) {
                await conn.query(
                    `INSERT INTO archived_tasks (id, text, reason, archived_at, data) VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE text = VALUES(text), reason = VALUES(reason), archived_at = VALUES(archived_at), data = VALUES(data)`,
                    archivedRow(a));
            }
            if (deleteArchived.length) await conn.query('DELETE FROM archived_tasks WHERE id IN (?)', [deleteArchived]);
            // Primero se borran los usuarios quitados, por si se vuelve a crear uno con el mismo nombre
            if (deleteUsers.length) await conn.query('DELETE FROM users WHERE id IN (?)', [deleteUsers]);
            for (const u of upsertUsers) {
                await conn.query(
                    `INSERT INTO users (id, username, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE username = VALUES(username), password_hash = VALUES(password_hash),
                       created_at = VALUES(created_at), last_login_at = VALUES(last_login_at)`,
                    [String(u.id).slice(0, 64), String(u.username).slice(0, 40), String(u.passwordHash).slice(0, 255),
                        Number(u.createdAt) || null, Number(u.lastLoginAt) || null]);
            }
            for (const [k, v] of upsertState) {
                await conn.query('INSERT INTO app_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, v]);
            }
            await conn.commit();
        } catch (e) {
            try { await conn.rollback(); } catch (_) { /* ignorar */ }
            throw e;
        } finally {
            conn.release();
        }
    }

    return { pool, loadAll, applyChanges, archivedKey, describe: () => `${config.database || 'MySQL'}@${config.host || 'url'}` };
}

module.exports = { createDb, connectionConfig, archivedKey };
