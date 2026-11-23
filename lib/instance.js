// Una sola copia de la app tiene WhatsApp abierto; las demás le reenvían el tráfico.
//
// En Hostinger (LiteSpeed) se arranca una copia de la app por cada dominio de la web, y cada copia
// recibe las peticiones por su propio socket (LSNODE_SOCKET). WhatsApp solo puede estar abierto en una.
// La primera copia en arrancar es la "principal" y apunta su socket en un archivo; las que arrancan
// después, si la principal sigue viva, no cargan la app: solo pasan cada conexión tal cual a su socket
// (HTTP, WebSocket del panel, todo). Si la principal desaparece, la copia se cierra y el alojamiento
// arranca una nueva en la siguiente visita, que pasará a ser la principal.
const fs = require('fs');
const net = require('net');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.STORE_DIR, 'copia-principal.json');
// Canal interno de la copia principal (en la carpeta de datos: el socket del alojamiento no es accesible entre copias)
const INTERNAL_SOCKET = path.join(config.STORE_DIR, 'principal.sock');
const mySocket = process.env.LSNODE_SOCKET || '';

function isNodeAlive(pid) {
    try {
        return /node/i.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
    } catch (e) {
        return false;
    }
}

function readPrimary() {
    try {
        return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        return null;
    }
}

// Apunta esta copia como principal y abre su canal interno: lo que llegue por él lo atiende el servidor web de la app
function registerPrimary(httpServer) {
    if (!config.HOSTED || process.platform !== 'linux') return;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        try { fs.unlinkSync(INTERNAL_SOCKET); } catch (e) { /* no existía */ }
        const internal = net.createServer((conn) => httpServer.emit('connection', conn));
        internal.on('error', (e) => console.error('Canal interno de la copia principal:', e.message));
        internal.listen(INTERNAL_SOCKET, () => {
            fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, socket: INTERNAL_SOCKET, since: Date.now() }));
        });
    } catch (e) {
        console.error('No se pudo registrar la copia principal:', e.message);
    }
}

// Si ya hay otra copia principal viva, convierte esta en un reenvío y devuelve true
function runAsRelayIfSecondary() {
    if (!config.HOSTED || process.platform !== 'linux' || !mySocket) return false;
    const primary = readPrimary();
    if (!primary || primary.pid === process.pid || primary.socket === mySocket) return false;
    if (!isNodeAlive(primary.pid) || !fs.existsSync(primary.socket)) return false;

    const http = require('http');
    const onUpstreamError = (e) => {
        if (!isNodeAlive(primary.pid)) {
            // La principal ya no existe: esta copia se cierra y la próxima visita arrancará una nueva
            console.warn(`La copia principal (${primary.pid}) ya no está: esta copia de reenvío se cierra.`);
            setTimeout(() => process.exit(0), 100);
        } else {
            console.error('Reenvío a la copia principal fallido:', e.message);
        }
    };

    // Servidor HTTP normal (el alojamiento lo conecta a su socket igual que a la app) que reenvía cada petición
    const relay = http.createServer((req, res) => {
        const upstream = http.request({ socketPath: primary.socket, method: req.method, path: req.url, headers: req.headers }, (up) => {
            res.writeHead(up.statusCode, up.statusMessage, up.headers);
            up.pipe(res);
        });
        upstream.on('error', (e) => {
            if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('La app se está reiniciando. Vuelve a intentarlo en unos segundos.');
            onUpstreamError(e);
        });
        req.pipe(upstream);
    });

    // Conexión en vivo del panel (WebSocket): se pasa tal cual
    relay.on('upgrade', (req, socket, head) => {
        const upstream = net.connect(primary.socket, () => {
            const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
            for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
            upstream.write(lines.join('\r\n') + '\r\n\r\n');
            if (head && head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
        });
        const closeBoth = () => { socket.destroy(); upstream.destroy(); };
        upstream.on('error', (e) => { closeBoth(); onUpstreamError(e); });
        socket.on('error', closeBoth);
    });

    relay.listen(process.env.PORT || 3000, () => {
        console.log(`Copia de reenvío (${process.pid}): pasa el tráfico de ${path.basename(mySocket)} a la copia principal ${primary.pid}.`);
    });
    relay.on('error', (e) => {
        console.error('La copia de reenvío no pudo arrancar:', e.message);
        process.exit(1);
    });
    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGINT', () => process.exit(0));
    return true;
}

module.exports = { runAsRelayIfSecondary, registerPrimary, FILE };
