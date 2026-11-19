// Inicio de sesión del panel con contraseña (variable PANEL_PASSWORD).
// Sesiones por cookie HttpOnly; solo se guarda un resumen (hash) del identificador de sesión.
const crypto = require('crypto');

const COOKIE_NAME = 'wa_session';
const SESSION_DAYS = 30;
const MAX_SESSIONS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;     // intentos fallidos por dirección en 15 minutos
const MAX_FAILS_GLOBAL = 40;    // freno general frente a ataques repartidos

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
}

module.exports = function createAuth({ store, password, required, secureCookies }) {
    if (!store.data.auth) store.data.auth = { sessions: [] };
    const sessions = () => store.data.auth.sessions;

    const failsByIp = new Map(); // ip -> [marcas de tiempo]
    let globalFails = [];

    function prune(list) {
        const limit = Date.now() - WINDOW_MS;
        return list.filter(t => t > limit);
    }

    function isAuthenticated(req) {
        if (!required) return true;
        const token = readCookie(req, COOKIE_NAME);
        if (!token) return false;
        const hash = sha256(token).toString('hex');
        const now = Date.now();
        return sessions().some(s => s.hash === hash && s.expires > now);
    }

    function cookieHeader(value, maxAgeSeconds) {
        return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`;
    }

    function login(req, res) {
        const ip = req.ip || 'desconocida';
        const ipFails = prune(failsByIp.get(ip) || []);
        globalFails = prune(globalFails);
        if (ipFails.length >= MAX_FAILS_PER_IP || globalFails.length >= MAX_FAILS_GLOBAL) {
            return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.' });
        }

        const given = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
        // Comparación en tiempo constante (sobre hashes, para igualar longitudes)
        const ok = password.length > 0 && crypto.timingSafeEqual(sha256(given), sha256(password));
        if (!ok) {
            ipFails.push(Date.now());
            failsByIp.set(ip, ipFails);
            globalFails.push(Date.now());
            console.warn(`Panel: intento de acceso fallido desde ${ip} (${ipFails.length}/${MAX_FAILS_PER_IP}).`);
            return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        }

        failsByIp.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        const list = sessions().filter(s => s.expires > now);
        list.push({ hash: sha256(token).toString('hex'), expires: now + SESSION_DAYS * 86400000, createdAt: now });
        store.data.auth.sessions = list.slice(-MAX_SESSIONS);
        store.save();

        res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400));
        console.log(`Panel: sesión iniciada desde ${ip}.`);
        res.json({ success: true });
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

    return { required, isAuthenticated, login, logout };
};
