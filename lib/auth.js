// Acceso al panel con usuario y contraseña.
// - Los usuarios se guardan en la base de datos (tabla "users") con un hash scrypt de la contraseña: nunca la contraseña.
// - El usuario "admin" entra con la contraseña de la variable PANEL_PASSWORD. Sirve para crear el primer usuario
//   y como acceso de emergencia si olvidas tu contraseña.
// - Sesiones por cookie HttpOnly; solo se guarda un resumen (hash) del identificador de sesión.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = 'wa_session';
const SESSION_DAYS = 30;
const MAX_SESSIONS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;     // intentos fallidos por dirección en 15 minutos
const MAX_FAILS_GLOBAL = 40;    // freno general frente a ataques repartidos
// Una sola cuenta: el panel está ligado a un único WhatsApp, así que cualquier otro usuario vería tus datos
const MAX_USERS = 1;

const ADMIN_USERNAME = 'admin';
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// Parámetros de scrypt: ~16 MB de memoria por comprobación, lento a propósito para frenar ataques
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const { N, r, p } = SCRYPT_PARAMS;
    const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
        { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(key, expected);
}

// Hash de relleno: si el usuario no existe se hace el mismo trabajo, para no delatarlo por el tiempo de respuesta
let dummyHash = null;
hashPassword(crypto.randomBytes(16).toString('hex')).then(h => { dummyHash = h; });

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

// Devuelve el motivo por el que una contraseña no es aceptable, o null si vale
function passwordProblem(password, username) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) return `La contraseña no puede pasar de ${MAX_PASSWORD_LENGTH} caracteres.`;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
    if (password.length < 16 && classes < 3) {
        return 'Usa al menos 3 tipos de caracteres (minúsculas, mayúsculas, números o símbolos), o 16 caracteres o más.';
    }
    if (username && password.toLowerCase().includes(username)) return 'La contraseña no puede contener el nombre de usuario.';
    if (/^(.)\1+$/.test(password)) return 'La contraseña no puede ser un mismo carácter repetido.';
    return null;
}

module.exports = function createAuth({ store, password, required, secureCookies }) {
    if (!store.data.auth) store.data.auth = { sessions: [] };
    if (!Array.isArray(store.data.users)) store.data.users = [];
    const sessions = () => store.data.auth.sessions;
    const users = () => store.data.users;

    const failsByIp = new Map(); // ip -> [marcas de tiempo]
    let globalFails = [];

    function prune(list) {
        const limit = Date.now() - WINDOW_MS;
        return list.filter(t => t > limit);
    }

    function findSession(req) {
        const token = readCookie(req, COOKIE_NAME);
        if (!token) return null;
        const hash = sha256(token).toString('hex');
        const now = Date.now();
        return sessions().find(s => s.hash === hash && s.expires > now) || null;
    }

    function isAuthenticated(req) {
        if (!required) return true;
        return !!findSession(req);
    }

    // Usuario de la sesión actual ("admin" en sesiones antiguas, anteriores a los usuarios)
    function currentUser(req) {
        if (!required) return null;
        const session = findSession(req);
        return session ? (session.user || ADMIN_USERNAME) : null;
    }

    function cookieHeader(value, maxAgeSeconds) {
        return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`;
    }

    function registerFail(ip) {
        const ipFails = prune(failsByIp.get(ip) || []);
        ipFails.push(Date.now());
        failsByIp.set(ip, ipFails);
        globalFails.push(Date.now());
        return ipFails.length;
    }

    async function login(req, res) {
        const ip = req.ip || 'desconocida';
        globalFails = prune(globalFails);
        if (prune(failsByIp.get(ip) || []).length >= MAX_FAILS_PER_IP || globalFails.length >= MAX_FAILS_GLOBAL) {
            return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.' });
        }

        const username = normalizeUsername(req.body && req.body.username);
        const given = typeof (req.body && req.body.password) === 'string' ? req.body.password.slice(0, MAX_PASSWORD_LENGTH) : '';

        let ok = false;
        let user = null;
        if (username === ADMIN_USERNAME) {
            // Comparación en tiempo constante (sobre hashes, para igualar longitudes)
            ok = password.length > 0 && crypto.timingSafeEqual(sha256(given), sha256(password));
        } else {
            user = users().find(u => u.username === username) || null;
            try {
                const valid = await verifyPassword(given, user ? user.passwordHash : dummyHash);
                ok = !!user && valid;
            } catch (e) {
                ok = false;
            }
        }

        if (!ok) {
            const count = registerFail(ip);
            console.warn(`Panel: intento de acceso fallido desde ${ip} (${count}/${MAX_FAILS_PER_IP}).`);
            return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
        }

        failsByIp.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        const list = sessions().filter(s => s.expires > now);
        const sessionUser = user ? user.username : ADMIN_USERNAME;
        list.push({ hash: sha256(token).toString('hex'), expires: now + SESSION_DAYS * 86400000, createdAt: now, user: sessionUser });
        store.data.auth.sessions = list.slice(-MAX_SESSIONS);
        if (user) user.lastLoginAt = now;
        store.save();

        res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
        console.log(`Panel: sesión iniciada por ${sessionUser} desde ${ip}.`);
        // Entrando como admin sin usuarios creados todavía: directo al registro
        res.json({ success: true, next: (!user && users().length === 0) ? '/registro' : '/panel' });
    }

    function logout(req, res) {
        const token = readCookie(req, COOKIE_NAME);
        if (token) {
            const hash = sha256(token).toString('hex');
            store.data.auth.sessions = sessions().filter(s => s.hash !== hash);
            store.save();
        }
        res.setHeader('Set-Cookie', cookieHeader('', 0));
        res.json({ success: true });
    }

    function publicUsers() {
        return users().map(u => ({ username: u.username, createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null }));
    }

    // Solo con sesión iniciada (lo comprueba el servidor antes de llamar aquí)
    async function createUser(req, res) {
        const username = normalizeUsername(req.body && req.body.username);
        const newPassword = req.body && req.body.password;

        if (!USERNAME_RE.test(username)) {
            return res.status(400).json({ success: false, error: 'El usuario debe tener de 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo.' });
        }
        if (username === ADMIN_USERNAME) {
            return res.status(400).json({ success: false, error: '"admin" está reservado para el acceso de emergencia. Elige otro nombre.' });
        }
        if (users().length >= MAX_USERS) {
            return res.status(409).json({ success: false, error: 'Ya existe la cuenta del panel. Solo se permite un usuario, porque el panel está vinculado a un único WhatsApp.' });
        }
        const problem = passwordProblem(newPassword, username);
        if (problem) return res.status(400).json({ success: false, error: problem });

        const user = {
            id: crypto.randomUUID(),
            username,
            passwordHash: await hashPassword(newPassword),
            createdAt: Date.now(),
            lastLoginAt: null,
        };
        users().push(user);
        store.save();
        console.log(`Panel: usuario "${username}" creado por ${currentUser(req) || 'el panel'}.`);
        res.json({ success: true, users: publicUsers() });
    }

    function deleteUser(req, res) {
        const username = normalizeUsername(req.params.username);
        const me = currentUser(req);
        const index = users().findIndex(u => u.username === username);
        if (index === -1) return res.status(404).json({ success: false, error: 'No existe ese usuario.' });

        users().splice(index, 1);
        // Sus sesiones abiertas dejan de valer
        store.data.auth.sessions = sessions().filter(s => s.user !== username);
        store.save();
        console.log(`Panel: usuario "${username}" eliminado por ${me || 'el panel'}.`);
        res.json({ success: true, users: publicUsers(), selfDeleted: me === username });
    }

    return {
        required, isAuthenticated, currentUser, login, logout,
        publicUsers, createUser, deleteUser,
        MIN_PASSWORD_LENGTH, ADMIN_USERNAME, MAX_USERS,
    };
};
