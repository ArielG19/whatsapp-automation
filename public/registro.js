const form = document.getElementById('reg-form');
const usernameInput = document.getElementById('reg-username');
const passwordInput = document.getElementById('reg-password');
const confirmInput = document.getElementById('reg-confirm');
const errorBox = document.getElementById('reg-error');
const okBox = document.getElementById('reg-ok');
const submitBtn = document.getElementById('reg-button');
const meterBar = document.getElementById('meter-bar');
const meterLabel = document.getElementById('meter-label');
const rulesList = document.getElementById('rules');
const copyNote = document.getElementById('copy-note');
const btnToggle = document.getElementById('btn-toggle');
const btnCopy = document.getElementById('btn-copy');
const btnGenerate = document.getElementById('btn-generate');
const userList = document.getElementById('user-list');
const firstBanner = document.getElementById('first-banner');

let minLength = 12;
let maxUsers = 1;
let me = null;
const accountDone = document.getElementById('account-done');

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-WA-Panel': '1', ...(options.headers || {}) },
    });
    if (response.status === 401) {
        window.location.replace('/login');
        return new Promise(() => {});
    }
    return response.json();
}

// ---------- Generador de contraseñas ----------
// Sin caracteres que se confunden (l, I, O, 0, 1) y con al menos uno de cada tipo
const SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digits: '23456789',
    symbols: '!@#$%&*-_=+?.',
};
const GENERATED_LENGTH = 20;

// Número aleatorio uniforme en [0, max) con el generador criptográfico del navegador
function randomIndex(max) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
}

function generatePassword(length = GENERATED_LENGTH) {
    const all = Object.values(SETS).join('');
    const chars = Object.values(SETS).map(set => set[randomIndex(set.length)]);
    while (chars.length < length) chars.push(all[randomIndex(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

// ---------- Medidor de seguridad ----------
function classesIn(pw) {
    return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length;
}

function rulesState(pw, username) {
    return {
        length: pw.length >= minLength,
        mix: pw.length >= 16 || classesIn(pw) >= 3,
        user: !username || !pw.toLowerCase().includes(username),
    };
}

function strength(pw) {
    if (!pw) return null;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 20;
    let bits = pw.length * Math.log2(pool || 1);
    if (/^(.)\1+$/.test(pw)) bits = 0;
    if (bits < 50) return { pct: 25, label: 'Débil', color: '#ef4444' };
    if (bits < 70) return { pct: 50, label: 'Aceptable', color: '#f59e0b' };
    if (bits < 95) return { pct: 75, label: 'Fuerte', color: '#10b981' };
    return { pct: 100, label: 'Muy fuerte', color: '#059669' };
}

function normalizedUsername() {
    return usernameInput.value.trim().toLowerCase();
}

function updateMeter() {
    const pw = passwordInput.value;
    const s = strength(pw);
    meterBar.style.width = s ? `${s.pct}%` : '0';
    meterBar.style.backgroundColor = s ? s.color : '';
    meterLabel.textContent = s ? s.label : '—';
    meterLabel.style.color = s ? s.color : '';

    const state = rulesState(pw, normalizedUsername());
    rulesList.querySelectorAll('li').forEach(li => li.classList.toggle('ok', !!pw && state[li.dataset.rule]));
}

passwordInput.addEventListener('input', () => { copyNote.classList.add('hidden'); updateMeter(); });
usernameInput.addEventListener('input', updateMeter);

function setVisible(visible) {
    passwordInput.type = visible ? 'text' : 'password';
    confirmInput.type = visible ? 'text' : 'password';
    btnToggle.title = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
    btnToggle.setAttribute('aria-label', btnToggle.title);
}

btnToggle.addEventListener('click', () => setVisible(passwordInput.type === 'password'));

btnGenerate.addEventListener('click', () => {
    const pw = generatePassword();
    passwordInput.value = pw;
    confirmInput.value = pw;
    setVisible(true);
    copyNote.classList.remove('hidden');
    errorBox.textContent = '';
    updateMeter();
});

btnCopy.addEventListener('click', async () => {
    if (!passwordInput.value) return;
    try {
        await navigator.clipboard.writeText(passwordInput.value);
        okBox.textContent = 'Contraseña copiada.';
    } catch (e) {
        // Sin permiso para el portapapeles: seleccionar para copiar a mano
        setVisible(true);
        passwordInput.select();
        okBox.textContent = 'Selecciónala y cópiala con Ctrl+C.';
    }
    setTimeout(() => { if (okBox.textContent.startsWith('Contraseña copiada') || okBox.textContent.startsWith('Selecciónala')) okBox.textContent = ''; }, 2500);
});

// ---------- Alta ----------
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    okBox.textContent = '';

    const username = normalizedUsername();
    const pw = passwordInput.value;
    const state = rulesState(pw, username);
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        errorBox.textContent = 'Revisa el usuario: de 3 a 32 caracteres, minúsculas, números, punto, guion o guion bajo.';
        usernameInput.focus();
        return;
    }
    if (!state.length || !state.mix || !state.user) {
        errorBox.textContent = 'La contraseña no cumple los requisitos. Pulsa "Generar" para crear una segura.';
        passwordInput.focus();
        return;
    }
    if (pw !== confirmInput.value) {
        errorBox.textContent = 'Las contraseñas no coinciden.';
        confirmInput.focus();
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando...';
    try {
        const data = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
        if (data.success) {
            form.reset();
            setVisible(false);
            copyNote.classList.add('hidden');
            updateMeter();
            okBox.textContent = `Usuario "${username}" creado. Ya puede entrar con su contraseña.`;
            renderUsers(data.users);
        } else {
            errorBox.textContent = data.error || 'No se pudo crear el usuario.';
        }
    } catch (err) {
        errorBox.textContent = 'Error de conexión con el servidor.';
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear usuario';
});

// ---------- Lista de usuarios ----------
function formatDate(ms) {
    if (!ms) return 'nunca';
    return new Date(ms).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderUsers(users) {
    firstBanner.classList.toggle('hidden', !(me === 'admin' && users.length === 0));
    // Con la cuenta ya creada no se puede registrar nadie más
    const full = users.length >= maxUsers;
    form.classList.toggle('hidden', full);
    accountDone.classList.toggle('hidden', !full);
    const rows = users.map(u => `
        <li class="user-item">
            <div class="user-avatar">${escapeHtml(u.username.charAt(0))}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(u.username)}${u.username === me ? '<span class="badge-me">Tú</span>' : ''}</div>
                <div class="user-meta">Creado ${escapeHtml(formatDate(u.createdAt))} · Último acceso ${escapeHtml(formatDate(u.lastLoginAt))}</div>
            </div>
            <button type="button" class="del-btn" data-user="${escapeHtml(u.username)}">Eliminar</button>
        </li>`);
    rows.push(`
        <li class="user-item">
            <div class="user-avatar admin">A</div>
            <div class="user-info">
                <div class="user-name">admin${me === 'admin' ? '<span class="badge-me">Tú</span>' : ''}</div>
                <div class="user-meta">Acceso de emergencia con la contraseña configurada en el servidor (PANEL_PASSWORD). No se puede eliminar.</div>
            </div>
        </li>`);
    userList.innerHTML = rows.join('');
}

userList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.del-btn');
    if (!btn) return;
    const username = btn.dataset.user;
    const self = username === me;
    const question = self
        ? `¿Eliminar tu usuario "${username}"? Se cerrará tu sesión y tendrás que entrar con admin para crear uno nuevo.`
        : `¿Eliminar el usuario "${username}"? Ya no podrá entrar al panel y podrás crear uno nuevo.`;
    if (!confirm(question)) return;

    btn.disabled = true;
    try {
        const data = await api(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        if (data.success) {
            if (data.selfDeleted) { window.location.replace('/login'); return; }
            renderUsers(data.users);
        } else {
            alert(data.error || 'No se pudo eliminar el usuario.');
            btn.disabled = false;
        }
    } catch (err) {
        alert('Error de conexión con el servidor.');
        btn.disabled = false;
    }
});

async function loadUsers() {
    try {
        const data = await api('/api/users');
        if (!data.success) return;
        me = data.me;
        minLength = data.minPasswordLength || minLength;
        maxUsers = data.maxUsers || maxUsers;
        document.getElementById('min-len').textContent = minLength;
        renderUsers(data.users);
    } catch (e) {
        userList.innerHTML = '<li class="user-item">No se pudo cargar la lista.</li>';
    }
}

loadUsers();
