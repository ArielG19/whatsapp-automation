const socket = io();

// --- ACCESO CON CONTRASEÑA ---
// Si la sesión del panel caduca, cualquier petición devuelve 401: se vuelve a la página de acceso.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.status === 401) {
        window.location.replace('/login');
        return new Promise(() => {}); // la página está saliendo: no continuar
    }
    return response;
};

// La conexión en vivo también exige sesión: si se rechaza, comprobar si hay que volver a entrar
socket.on('connect_error', async () => {
    try {
        const data = await nativeFetch('/api/session').then(r => r.json());
        if (data.authRequired && !data.authenticated) window.location.replace('/login');
    } catch (e) { /* servidor caído: lo gestiona el aviso de desconexión */ }
});

// --- ICONOS (SVG en línea, mismo estilo que los del menú) ---
function icon(paths, size = 16) {
    return `<svg class="ico" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="${size}" height="${size}" aria-hidden="true">${paths}</svg>`;
}
const ICONS = {
    calendar: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />', 14),
    external: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />', 14),
    chevron: icon('<path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />', 14),
    trash: icon('<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />', 16),
    photo: icon('<path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0 0 21.75 19.5V4.5A1.5 1.5 0 0 0 20.25 3H3.75A1.5 1.5 0 0 0 2.25 4.5v15A1.5 1.5 0 0 0 3.75 21Z" />', 14),
};

// --- UTILIDADES ---

// Escapa texto antes de insertarlo como HTML (evita ejecutar código de mensajes recibidos)
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Solo se permiten enlaces de WhatsApp
function safeLink(link, sourceId) {
    if (typeof link === 'string' && /^https:\/\/(wa\.me|web\.whatsapp\.com)\//.test(link)) {
        return link;
    }
    // Compatibilidad con datos antiguos guardados sin 'link'
    if (sourceId && sourceId.includes('@c.us')) {
        return `https://wa.me/${encodeURIComponent(sourceId.split('@')[0])}`;
    }
    return 'https://web.whatsapp.com/';
}

function isDirectLink(link) {
    return link.startsWith('https://wa.me/');
}

// Peticiones de acción al servidor (la cabecera propia impide que otras webs las disparen)
function apiPost(url, body = {}) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WA-Panel': '1' },
        body: JSON.stringify(body)
    });
}

// Hora si es de hoy, "Ayer" o la fecha si es más antiguo
function formatChatTime(unixSeconds) {
    if (!unixSeconds) return '';
    const date = new Date(unixSeconds * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateTime(ms) {
    const date = new Date(ms);
    if (isNaN(date)) return '';
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) return `hoy a las ${time}`;
    return `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })} a las ${time}`;
}

// Elementos de Auth
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const authStatusDot = document.getElementById('auth-status-dot');
const authStatusText = document.getElementById('auth-status-text');
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const qrContainer = document.getElementById('qrcode');
const qrLoader = document.getElementById('qr-loader');

let waConnected = false;

// --- NAVEGACIÓN SPA ---
const menuItems = document.querySelectorAll('.menu-item');
const viewSections = document.querySelectorAll('.view-section');

menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();

        // Remover activo de todos
        menuItems.forEach(i => i.classList.remove('active'));
        viewSections.forEach(v => v.classList.add('hidden'));

        // Activar el clickeado
        item.classList.add('active');
        const targetViewId = item.getAttribute('data-target');
        document.getElementById(targetViewId).classList.remove('hidden');
    });
});

// --- SOCKET EVENTS ---
socket.on('connect', () => {
    console.log('Conectado al servidor web');
});

// --- CERRAR SESIÓN ---
const btnLogout = document.getElementById('btn-logout');

btnLogout.addEventListener('click', async () => {
    const ok = confirm('¿Cerrar la sesión de WhatsApp en este panel?\n\n'
        + 'Se desvinculará este dispositivo de tu móvil y tendrás que volver a escanear el código QR. '
        + 'Tus tareas guardadas no se borran.');
    if (!ok) return;

    btnLogout.disabled = true;
    try {
        const response = await apiPost('/api/logout');
        const data = await response.json();
        if (!data.success) {
            alert('Cerrar sesión: ' + (data.error || 'Error desconocido'));
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión con el servidor.');
    } finally {
        btnLogout.disabled = false;
    }
});

// --- SALIR DEL PANEL (solo cuando el panel tiene contraseña) ---
const btnPanelLogout = document.getElementById('btn-panel-logout');
const btnUsers = document.getElementById('btn-users');

nativeFetch('/api/session').then(r => r.json()).then(data => {
    if (data.authRequired) {
        btnPanelLogout.classList.remove('hidden');
        btnUsers.classList.remove('hidden');
    }
}).catch(() => {});

btnPanelLogout.addEventListener('click', async () => {
    try { await apiPost('/api/panel-logout'); } catch (e) { console.error(e); }
    window.location.replace('/login');
});

// --- MENÚ DEL MÓVIL (Desvincular / Salir del panel) ---
const btnMobileMenu = document.getElementById('btn-mobile-menu');
const sidebarFooter = document.getElementById('sidebar-footer');

function setMobileMenu(open) {
    sidebarFooter.classList.toggle('open', open);
    btnMobileMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
}
btnMobileMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    setMobileMenu(!sidebarFooter.classList.contains('open'));
});
// Se cierra al tocar fuera, al pulsar una opción o con la tecla Escape
document.addEventListener('click', (e) => {
    if (sidebarFooter.classList.contains('open') && !sidebarFooter.contains(e.target)) setMobileMenu(false);
});
sidebarFooter.addEventListener('click', () => setMobileMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMobileMenu(false); });

// Al cambiar de sección, volver arriba (en el móvil cada sección es una pantalla)
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => document.querySelector('.main-content').scrollTo(0, 0));
});

// El servidor Node se ha caído o reiniciado: avisar en vez de seguir diciendo "Conectado"
socket.on('disconnect', () => {
    waConnected = false;
    statusDot.className = 'dot offline';
    statusText.textContent = 'Servidor detenido';
    authStatusDot.className = 'dot offline';
    authStatusText.textContent = 'Sin conexión con el servidor. Reintentando...';
});

socket.on('status', (data) => {
    updateStatus(data.state, data);
});

// El servidor envía el QR ya dibujado como imagen (no depende de librerías externas)
socket.on('qr', (qrDataUrl) => {
    if (typeof qrDataUrl !== 'string' || !qrDataUrl.startsWith('data:image/')) return;
    showAuth();
    qrLoader.classList.add('hidden');
    qrContainer.classList.remove('hidden');

    let img = qrContainer.querySelector('img');
    if (!img) {
        img = document.createElement('img');
        img.alt = 'Código QR de WhatsApp';
        img.width = 250;
        img.height = 250;
        qrContainer.replaceChildren(img);
    }
    img.src = qrDataUrl;
});

socket.on('update_chats', () => {
    if (waConnected) {
        loadChats(true);
    }
});

function showAuth() {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
}

function showQrLoader() {
    qrLoader.classList.remove('hidden');
    qrContainer.classList.add('hidden');
}

function updateStatus(state, data = {}) {
    if (state === 'connected') {
        const wasConnected = waConnected;
        waConnected = true;
        authSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
        statusDot.className = 'dot online';
        statusText.textContent = 'Conectado';
        loadChats(wasConnected);
        loadSettings();
        return;
    }

    // Sin conexión con WhatsApp: volver a la pantalla de vinculación
    waConnected = false;
    showAuth();

    if (state === 'disconnected') {
        // El QR anterior ya no sirve: mostrar el cargador hasta que llegue uno nuevo
        showQrLoader();
        statusDot.className = 'dot offline';
        statusText.textContent = 'Desconectado';
        authStatusDot.className = 'dot offline';
        authStatusText.textContent = 'Desconectado. Reconectando...';
    } else if (state === 'authenticated') {
        // QR ya escaneado: WhatsApp está cargando la sesión
        showQrLoader();
        authStatusDot.className = 'dot online';
        authStatusText.textContent = data.percent
            ? `Vinculado. Cargando tus chats... ${data.percent}%`
            : 'Vinculado. Cargando tus chats...';
    } else if (state === 'logging_out') {
        showQrLoader();
        authStatusDot.className = 'dot';
        authStatusText.textContent = 'Cerrando sesión...';
    } else if (state === 'starting') {
        showQrLoader();
        authStatusDot.className = 'dot';
        authStatusText.textContent = 'Iniciando sistema...';
    } else {
        // 'waiting': no se toca el QR, porque el servidor lo envía justo antes de este estado
        statusDot.className = 'dot';
        statusText.textContent = 'Esperando vinculación...';
        authStatusDot.className = 'dot';
        authStatusText.textContent = 'Escanea el código QR con WhatsApp';
    }
}

// --- VISTA: CHATS ---
const chatsList = document.getElementById('chats-list');
const btnRefreshChats = document.getElementById('btn-refresh-chats');

if (btnRefreshChats) {
    btnRefreshChats.addEventListener('click', () => loadChats());
}

// Un solo listener para todos los chats (sin onclick en línea)
chatsList.addEventListener('click', (e) => {
    const item = e.target.closest('.chat-item');
    if (item && item.dataset.url) {
        window.open(item.dataset.url, '_blank', 'noopener');
    }
});

// Fotos de perfil: si no hay (o la persona la tiene privada), se quita la imagen y queda la inicial
function attachAvatarFallbacks(container) {
    container.querySelectorAll('img.avatar-img').forEach(img => {
        const drop = () => img.remove();
        if (img.complete && img.naturalWidth === 0 && img.src) drop();
        img.addEventListener('error', drop, { once: true });
        img.addEventListener('load', () => { if (img.naturalWidth === 0) drop(); }, { once: true });
    });
}

let chatsRequestId = 0;

async function loadChats(silent = false) {
    if (!silent) {
        chatsList.innerHTML = '<div class="empty-state">Cargando chats...</div>';
    }

    // Si se lanzan varias cargas seguidas, solo cuenta la última
    const requestId = ++chatsRequestId;

    try {
        const response = await fetch('/api/chats');
        const data = await response.json();
        if (requestId !== chatsRequestId) return;

        if (data.success) {
            if (data.chats.length === 0) {
                chatsList.innerHTML = '<div class="empty-state">No hay chats.</div>';
                return;
            }

            let html = '';
            data.chats.forEach(chat => {
                const badge = chat.unreadCount > 0 ? `<span class="chat-badge">${Number(chat.unreadCount)}</span>` : '';
                const initial = chat.name ? chat.name.charAt(0).toUpperCase() : '?';

                const timeStr = formatChatTime(chat.timestamp);

                const linkUrl = safeLink(chat.link, chat.id);
                const title = isDirectLink(linkUrl) ? 'Abrir chat' : 'Abrir WhatsApp Web';

                html += `
                    <div class="chat-item" data-url="${escapeHtml(linkUrl)}" style="cursor: pointer;" title="${title}">
                        <div class="chat-avatar">${escapeHtml(initial)}${chat.id ? `<img class="avatar-img" src="/api/avatar/${encodeURIComponent(chat.id)}" alt="" loading="lazy" decoding="async">` : ''}</div>
                        <div class="chat-details">
                            <div class="chat-header">
                                <span class="chat-name">${escapeHtml(chat.name)}</span>
                                <span class="chat-time">${escapeHtml(timeStr)}</span>
                            </div>
                            <div class="chat-footer">
                                <div class="chat-msg">${chat.lastMessage && chat.lastMessage !== 'Mensaje multimedia' ? escapeHtml(chat.lastMessage) : `<span class="chat-media">${ICONS.photo}<i>Mensaje multimedia</i></span>`}</div>
                                ${badge}
                            </div>
                        </div>
                    </div>
                `;
            });
            chatsList.innerHTML = html;
            attachAvatarFallbacks(chatsList);
        } else if (!silent) {
            chatsList.innerHTML = `<div class="empty-state">${escapeHtml(data.error || 'No se pudieron cargar los chats')}</div>`;
        }
    } catch (e) {
        console.error(e);
        if (!silent && requestId === chatsRequestId) {
            chatsList.innerHTML = '<div class="empty-state" style="color: var(--danger)">Error de conexión.</div>';
        }
    }
}

// --- VISTA: RESUMEN ---
const btnResumen = document.getElementById('btn-resumen');
const btnText = btnResumen.querySelector('.btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const summaryContent = document.getElementById('summary-content');
const summaryNotice = document.getElementById('summary-notice');

// Iconos de las etiquetas de importancia
const REASON_ICONS = {
    respuesta: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />', 14),
    plazo: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />', 14),
    decision: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />', 14),
    cita: ICONS.calendar,
    dinero: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />', 14),
    novedad: icon('<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />', 14),
    informativo: icon('<path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />', 14),
};

const REASON_TEXT = {
    respuesta: 'Esperan tu respuesta', plazo: 'Plazo', decision: 'Decisión pendiente', cita: 'Cita o reunión',
    dinero: 'Pago o dinero', novedad: 'Novedad importante', informativo: 'Informativo',
};

// Días desde hoy hasta una fecha AAAA-MM-DD (null si no es válida)
function daysUntil(deadline) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline || '');
    if (!match) return null;
    const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (isNaN(due)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((due - today) / 86400000);
}

function relativeDay(deadline) {
    const days = daysUntil(deadline);
    if (days === null) return '';
    if (days === 0) return 'hoy';
    if (days === 1) return 'mañana';
    if (days === -1) return 'ayer';
    const [, m, d] = deadline.split('-');
    return `el ${d}/${m}`;
}

function renderReason(item) {
    const reason = REASON_TEXT[item.reason] ? item.reason : 'novedad';
    let label = REASON_TEXT[reason];
    if ((reason === 'plazo' || reason === 'cita') && relativeDay(item.deadline)) {
        label += ` ${relativeDay(item.deadline)}`;
    }
    const days = daysUntil(item.deadline);
    const soon = days !== null && days <= 1 && (reason === 'plazo' || reason === 'cita');
    return `<span class="reason-tag reason-${reason}${soon ? ' soon' : ''}">${REASON_ICONS[reason]}${escapeHtml(label)}</span>`;
}

function renderSummaryCards(summary) {
    if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) return '';

    let html = '';
    const parts = [];
    if (summary.mode === 'recent') parts.push(`Tus ${summary.items.length} chats más importantes, del más reciente al más antiguo`);
    else if (summary.since) parts.push(`Novedades desde ${formatDateTime(summary.since)}`);
    if (summary.generatedAt) parts.push(`generado ${formatDateTime(summary.generatedAt)}`);
    if (parts.length) html += `<div class="summary-generated">${escapeHtml(parts.join(' · '))}</div>`;

    // Más recientes primero (los resúmenes antiguos sin fecha conservan su orden)
    const items = summary.items.every(i => i.lastMessageAt)
        ? [...summary.items].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        : summary.items;

    items.forEach(item => {
        const linkUrl = safeLink(item.link, item.sourceId);
        const linkLabel = (isDirectLink(linkUrl) ? 'Ver conversación' : 'Abrir WhatsApp Web') + ICONS.chevron;

        html += `
            <div class="summary-card">
                <div class="summary-avatar">${escapeHtml(item.initials || '?')}${item.sourceId ? `<img class="avatar-img" src="/api/avatar/${encodeURIComponent(item.sourceId)}" alt="" loading="lazy" decoding="async">` : ''}</div>
                <div class="summary-content-wrap">
                    <div class="summary-header">
                        <span class="summary-title">${escapeHtml(item.chatName)}</span>
                        <span class="summary-time">${escapeHtml(item.time || '')}</span>
                    </div>
                    <div class="summary-reason">${renderReason(item)}</div>
                    <div class="summary-body">
                        ${escapeHtml((item.summaryText || '').trim())}
                    </div>
                    <div class="summary-footer">
                        <span class="summary-badge">${escapeHtml((item.category || 'General').trim())}</span>
                        <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" class="summary-link">${linkLabel}</a>
                    </div>
                </div>
            </div>
        `;
    });
    return html;
}

function showNotice(el, text) {
    if (!text) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
}

function showSummary(summary) {
    const html = renderSummaryCards(summary);
    if (html) {
        summaryContent.innerHTML = html;
        attachAvatarFallbacks(summaryContent);
    }
}

async function loadLastSummary() {
    try {
        const data = await fetch('/api/resumen').then(r => r.json());
        if (data.success && data.lastSummary) showSummary(data.lastSummary);
    } catch (e) {
        console.error(e);
    }
}

async function generateSummary() {
    btnResumen.disabled = true;
    btnText.textContent = 'Analizando...';
    btnSpinner.classList.remove('hidden');

    try {
        const response = await apiPost('/api/resumen', {});
        const data = await response.json();

        if (data.success) {
            if (data.items.length === 0) {
                showNotice(summaryNotice, 'No hay conversaciones con actividad en los últimos 7 días que resumir.');
                summaryContent.innerHTML = '';
            } else {
                showNotice(summaryNotice, '');
                showSummary(data);
            }
        } else {
            alert('Error al generar resumen: ' + (data.error || 'Desconocido'));
        }
    } catch (error) {
        console.error(error);
        alert('Error de conexión con el servidor.');
    } finally {
        btnResumen.disabled = false;
        btnText.textContent = 'Ver novedades';
        btnSpinner.classList.add('hidden');
    }
}

btnResumen.addEventListener('click', () => generateSummary());

// --- VISTA: TAREAS ---
const btnTasks = document.getElementById('btn-tasks');
const btnTextTasks = btnTasks.querySelector('.btn-text-tasks');
const btnSpinnerTasks = document.getElementById('btn-spinner-tasks');
const tasksListUI = document.getElementById('tasks-list');
const btnClearTasks = document.getElementById('btn-clear-tasks');
const tasksNotice = document.getElementById('tasks-notice');

let myTasks = [];
let currentTaskTab = 'pending';

// TABS LOGIC
const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTaskTab = btn.getAttribute('data-tab');
        btnClearTasks.classList.toggle('hidden', currentTaskTab !== 'completed');
        renderTasks();
    });
});

const VALID_URGENCIES = ['alta', 'media', 'baja'];

// Cuándo llegó la tarea: la hora del mensaje del que sale o, si no se sabe, cuándo se detectó
const taskDate = (t) => t.messageAt || t.createdAt || 0;

// Pendientes: las más recientes primero
function compareTasks(a, b) {
    return taskDate(b) - taskDate(a);
}

function formatShortDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `hoy ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `ayer ${time}`;
    return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${time}`;
}

// "Vence hoy", "Vence mañana", "Venció el 10/11"... a partir de una fecha AAAA-MM-DD
function renderDeadline(deadline, completed) {
    const days = daysUntil(deadline);
    if (days === null) return '';
    const [, m, d] = deadline.split('-');
    const dateStr = `${d}/${m}`;

    let label;
    if (days === 0) label = 'Vence hoy';
    else if (days === 1) label = 'Vence mañana';
    else if (days < 0) label = `Venció el ${dateStr}`;
    else label = `Vence el ${dateStr}`;

    const cls = completed ? '' : (days < 0 ? ' overdue' : (days <= 1 ? ' soon' : ''));
    return `<span class="task-deadline${cls}">${ICONS.calendar}${escapeHtml(label)}</span>`;
}

function renderTasks() {
    const pending = myTasks.filter(t => !t.completed);
    document.getElementById('count-pending').textContent = pending.length;

    const filteredTasks = currentTaskTab === 'pending'
        ? pending.sort(compareTasks)
        : myTasks.filter(t => t.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    if (filteredTasks.length === 0) {
        tasksListUI.innerHTML = `<div class="empty-state">No hay tareas ${currentTaskTab === 'pending' ? 'pendientes' : 'completadas'}.</div>`;
        return;
    }

    let html = '';
    filteredTasks.forEach((task) => {
        const days = daysUntil(task.deadline);
        const isOverdue = !task.completed && days !== null && days < 0;
        const urgency = VALID_URGENCIES.includes(String(task.urgency).toLowerCase())
            ? String(task.urgency).toLowerCase()
            : 'media';

        let linkHtml = '';
        if (task.sourceId || task.link) {
            const linkUrl = safeLink(task.link, task.sourceId);
            const label = isDirectLink(linkUrl) ? 'Abrir chat' : 'WhatsApp Web';
            linkHtml = `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" class="task-link">${label}${ICONS.external}</a>`;
        }

        const quoteHtml = task.quote ? `<div class="task-quote">"${escapeHtml(task.quote)}"</div>` : '';

        html += `
            <div class="task-item ${task.completed ? 'completed' : ''} ${isOverdue ? 'is-overdue' : ''}">
                <input type="checkbox" class="task-checkbox" data-id="${escapeHtml(task.id)}" ${task.completed ? 'checked' : ''}>
                <div class="task-content">
                    <div class="task-text">${escapeHtml(task.text)}</div>
                    ${quoteHtml}
                    <div class="task-meta">
                        <span class="task-urgency urgency-${urgency}">${escapeHtml(urgency)}</span>
                        ${renderDeadline(task.deadline, task.completed)}
                        <span>Origen: ${escapeHtml(task.sourceName || 'Desconocido')}</span>
                        ${taskDate(task) ? `<span class="task-date" title="${task.messageAt ? 'Fecha del mensaje' : 'Fecha en que se detectó'}">${escapeHtml(formatShortDate(taskDate(task)))}</span>` : ''}
                        ${linkHtml}
                    </div>
                </div>
                <button class="task-delete" data-id="${escapeHtml(task.id)}" title="Descartar: no es una tarea (no se volverá a proponer)" aria-label="Descartar tarea">${ICONS.trash}</button>
            </div>
        `;
    });
    tasksListUI.innerHTML = html;
}

async function loadTasks() {
    try {
        const data = await fetch('/api/tasks').then(r => r.json());
        if (data.success) {
            myTasks = data.tasks;
            renderTasks();
        }
    } catch (e) {
        console.error(e);
        tasksListUI.innerHTML = '<div class="empty-state">No se pudieron cargar las tareas.</div>';
    }
}

// Las tareas antes se guardaban en el navegador: pasarlas al servidor una sola vez
async function migrateLocalTasks() {
    let local = [];
    try { local = JSON.parse(localStorage.getItem('myTasks') || '[]'); } catch (e) { local = []; }
    try { localStorage.removeItem('lastSummary'); } catch (e) { /* sin storage */ }
    if (!Array.isArray(local) || local.length === 0) return;

    try {
        const data = await apiPost('/api/tasks/import', { tasks: local }).then(r => r.json());
        if (data.success) {
            localStorage.removeItem('myTasks');
            if (data.imported > 0) showNotice(tasksNotice, `Se han pasado ${data.imported} tareas guardadas en este navegador a la app.`);
        }
    } catch (e) {
        console.error('No se pudieron importar las tareas del navegador:', e);
    }
}

// Un solo listener para todas las casillas
tasksListUI.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('task-checkbox')) return;
    const id = e.target.getAttribute('data-id');
    const task = myTasks.find(t => t.id === id);
    if (!task) return;

    const completed = e.target.checked;
    task.completed = completed;
    task.completedAt = completed ? Date.now() : null;
    renderTasks();

    try {
        const data = await apiPost(`/api/tasks/${encodeURIComponent(id)}`, { completed }).then(r => r.json());
        if (!data.success) throw new Error(data.error);
    } catch (err) {
        console.error(err);
        alert('No se pudo guardar el cambio. Se recargará la lista.');
        loadTasks();
    }
});

// Descartar una tarea concreta
tasksListUI.addEventListener('click', async (e) => {
    const btn = e.target.closest('.task-delete');
    if (!btn) return;
    const id = btn.dataset.id;
    const task = myTasks.find(t => t.id === id);
    if (!task) return;

    // Se quita al momento; si el servidor falla, se recarga la lista
    myTasks = myTasks.filter(t => t.id !== id);
    renderTasks();
    try {
        const data = await apiPost(`/api/tasks/${encodeURIComponent(id)}/delete`).then(r => r.json());
        if (!data.success) throw new Error(data.error);
        showNotice(tasksNotice, `Descartada: "${task.text}". No se volverá a proponer.`);
    } catch (err) {
        console.error(err);
        alert('No se pudo descartar la tarea.');
        loadTasks();
    }
});

// Revisar la lista con la IA
const btnReviewTasks = document.getElementById('btn-review-tasks');
btnReviewTasks.addEventListener('click', async () => {
    btnReviewTasks.disabled = true;
    btnReviewTasks.querySelector('span').textContent = 'Revisando...';
    try {
        const data = await apiPost('/api/tasks/review').then(r => r.json());
        if (data.success) {
            myTasks = data.tasks;
            renderTasks();
            if (data.removed.length === 0) {
                showNotice(tasksNotice, 'Lista revisada: todas las tareas pendientes parecen correctas.');
            } else {
                const lines = data.removed.map(r => `• ${r.text} (${r.reason})`).join('\n');
                showNotice(tasksNotice, `Lista revisada: se han quitado ${data.removed.length} tareas.\n${lines}`);
            }
        } else {
            alert('Error al revisar la lista: ' + (data.error || 'Desconocido'));
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión con el servidor.');
    } finally {
        btnReviewTasks.disabled = false;
        btnReviewTasks.querySelector('span').textContent = 'Revisar lista';
    }
});

btnClearTasks.addEventListener('click', async () => {
    try {
        const data = await apiPost('/api/tasks/clear-completed').then(r => r.json());
        if (data.success) {
            myTasks = data.tasks;
            renderTasks();
        }
    } catch (e) {
        console.error(e);
        alert('Error de conexión con el servidor.');
    }
});

btnTasks.addEventListener('click', async () => {
    btnTasks.disabled = true;
    btnTextTasks.textContent = 'Buscando...';
    btnSpinnerTasks.classList.remove('hidden');

    try {
        const data = await apiPost('/api/tasks/extract').then(r => r.json());

        if (data.success) {
            myTasks = data.tasks;
            renderTasks();
            let text;
            if (data.chatsAnalyzed === 0) text = 'No hay mensajes nuevos desde la última búsqueda.';
            else if (data.added === 0) text = `Revisados ${data.chatsAnalyzed} chats con mensajes nuevos: no hay tareas nuevas.`;
            else text = `${data.added === 1 ? 'Se ha añadido 1 tarea nueva' : `Se han añadido ${data.added} tareas nuevas`} (revisados ${data.chatsAnalyzed} chats con mensajes nuevos).`;
            const d = data.discarded || {};
            const ignored = (d.noEsTarea || 0) + (d.deOtros || 0) + (d.dudosa || 0);
            if (ignored > 0) text += ` Se ignoraron ${ignored} mensajes que no eran tareas tuyas.`;
            if (data.chatsLeft > 0) text += ` Quedan ${data.chatsLeft} chats por revisar: vuelve a pulsar.`;
            showNotice(tasksNotice, text);
        } else {
            alert('Error al extraer tareas: ' + (data.error || 'Desconocido'));
        }
    } catch (error) {
        console.error(error);
        alert('Error de conexión con el servidor.');
    } finally {
        btnTasks.disabled = false;
        btnTextTasks.textContent = 'Extraer Tareas';
        btnSpinnerTasks.classList.add('hidden');
    }
});

// --- VISTA: RECORDATORIOS ---
const setDailyDigest = document.getElementById('set-daily-digest');
const setDigestTime = document.getElementById('set-digest-time');
const setDeadlineReminders = document.getElementById('set-deadline-reminders');
const setSendManual = document.getElementById('set-send-manual');
const settingsStatus = document.getElementById('settings-status');
const btnDigestNow = document.getElementById('btn-digest-now');

function applySettings(s) {
    setDailyDigest.checked = !!s.dailyDigest;
    setDigestTime.value = s.dailyDigestTime || '09:00';
    setDeadlineReminders.checked = !!s.deadlineReminders;
    setSendManual.checked = !!s.sendManualSummary;
}

let statusTimer = null;
function flashStatus(text, isError = false) {
    settingsStatus.textContent = text;
    settingsStatus.classList.toggle('error', isError);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { settingsStatus.textContent = ''; }, 4000);
}

async function loadSettings() {
    try {
        const data = await fetch('/api/settings').then(r => r.json());
        if (data.success) applySettings(data.settings);
        // Mostrar con qué cuenta está vinculada la app
        if (data.userName && waConnected) statusText.textContent = `Conectado como ${data.userName}`;
    } catch (e) {
        console.error(e);
    }
}

async function saveSettings() {
    try {
        const data = await apiPost('/api/settings', {
            dailyDigest: setDailyDigest.checked,
            dailyDigestTime: setDigestTime.value,
            deadlineReminders: setDeadlineReminders.checked,
            sendManualSummary: setSendManual.checked,
        }).then(r => r.json());
        if (data.success) {
            applySettings(data.settings);
            flashStatus('Guardado');
        } else {
            flashStatus(data.error || 'No se pudo guardar', true);
            loadSettings();
        }
    } catch (e) {
        console.error(e);
        flashStatus('Error de conexión', true);
    }
}

[setDailyDigest, setDeadlineReminders, setSendManual, setDigestTime].forEach(el => el.addEventListener('change', saveSettings));

btnDigestNow.addEventListener('click', async () => {
    btnDigestNow.disabled = true;
    flashStatus('Preparando el resumen...');
    try {
        const data = await apiPost('/api/digest/run').then(r => r.json());
        if (data.success) {
            flashStatus('Enviado a tu WhatsApp');
            myTasks = data.tasks;
            renderTasks();
            if (data.lastSummary) showSummary(data.lastSummary);
        } else {
            flashStatus(data.error || 'No se pudo enviar', true);
        }
    } catch (e) {
        console.error(e);
        flashStatus('Error de conexión', true);
    } finally {
        btnDigestNow.disabled = false;
    }
});

// --- VISTA: MODO OCUPADO ---
const busyActive = document.getElementById('busy-active');
const busyState = document.getElementById('busy-state');
const busyReasons = document.getElementById('busy-reasons');
const busyCustom = document.getElementById('busy-custom');
const busyDuration = document.getElementById('busy-duration');
const busyPreview = document.getElementById('busy-preview');
const busyNotifyUrgent = document.getElementById('busy-notify-urgent');
const busySummaryEnd = document.getElementById('busy-summary-end');
const busyStatusMsg = document.getElementById('busy-status');
const busyInbox = document.getElementById('busy-inbox');
const busyIndicator = document.getElementById('busy-indicator');
const busyCard = document.getElementById('busy-card');

let busy = null;

function clockTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function busyReasonLabel(b) {
    if (b.reason === 'otro') return b.customText ? b.customText : 'Ocupado';
    const r = (b.reasons || []).find(x => x.key === b.reason);
    return r ? r.label : 'Ocupado';
}

function renderBusy() {
    if (!busy) return;

    // Indicador de la barra lateral
    const reasonLabel = busyReasonLabel(busy);
    if (busy.active) {
        busyIndicator.textContent = `Modo ocupado · ${reasonLabel}${busy.until ? ` · hasta las ${clockTime(busy.until)}` : ''}`;
        busyIndicator.classList.remove('hidden');
    } else {
        busyIndicator.classList.add('hidden');
    }

    busyActive.checked = busy.active;
    busyCard.classList.toggle('is-active', busy.active);
    busyState.textContent = busy.active
        ? `Activo: ${reasonLabel}${busy.until ? `, hasta las ${clockTime(busy.until)}` : ', hasta que lo desactives'}`
        : 'Desactivado';

    // Selector de motivo (se dibuja una vez y luego solo se marca el elegido)
    if (!busyReasons.children.length) {
        busyReasons.innerHTML = busy.reasons.map(r =>
            `<button type="button" class="reason-chip" role="radio" data-reason="${escapeHtml(r.key)}">${escapeHtml(r.label)}</button>`
        ).join('');
    }
    [...busyReasons.children].forEach(chip => {
        const selected = chip.dataset.reason === busy.reason;
        chip.classList.toggle('selected', selected);
        chip.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    busyCustom.classList.toggle('hidden', busy.reason !== 'otro');
    if (document.activeElement !== busyCustom) busyCustom.value = busy.customText || '';
    // Duraciones puestas desde WhatsApp (p. ej. 45 min) que no están en la lista: añadirlas
    const minutes = busy.durationMinutes || 0;
    if (![...busyDuration.options].some(o => o.value === String(minutes))) {
        const option = document.createElement('option');
        option.value = String(minutes);
        option.textContent = minutes % 60 === 0 ? `${minutes / 60} horas` : (minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minutos`);
        busyDuration.appendChild(option);
    }
    busyDuration.value = String(minutes);
    busyPreview.textContent = busy.preview;
    busyNotifyUrgent.checked = !!busy.notifyUrgent;
    busySummaryEnd.checked = !!busy.summaryOnEnd;

    renderBusyInbox();
}

function renderBusyInbox() {
    const items = busy.inbox || [];
    if (items.length === 0) {
        busyInbox.innerHTML = `<div class="empty-state">${busy.active ? 'Nadie te ha escrito todavía en este periodo.' : 'Aquí aparecerá quién te escriba mientras el modo ocupado esté activo.'}</div>`;
        return;
    }
    busyInbox.innerHTML = items.map(e => {
        const tags = [];
        if (e.urgent) tags.push('<span class="inbox-tag urgent">Urgente</span>');
        if (e.answeredByUser) tags.push('<span class="inbox-tag">Contestaste tú</span>');
        else if (e.replied) tags.push('<span class="inbox-tag ok">Respondido por la IA</span>');
        else tags.push('<span class="inbox-tag pending">Respondiendo…</span>');
        if (e.count > 1) tags.push(`<span class="inbox-tag">${Number(e.count)} mensajes</span>`);
        const linkUrl = safeLink(e.link, e.chatId);
        return `
            <div class="inbox-item${e.urgent ? ' is-urgent' : ''}">
                <div class="inbox-top">
                    <span class="inbox-name">${escapeHtml(e.name)}</span>
                    <span class="inbox-time">${escapeHtml(clockTime(e.lastAt))}</span>
                </div>
                <div class="inbox-text">${escapeHtml(e.summary || e.lastText)}</div>
                ${e.replyText ? `<div class="inbox-reply">Respuesta: "${escapeHtml(e.replyText)}"</div>` : ''}
                <div class="inbox-meta">${tags.join('')}
                    <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" class="task-link">${isDirectLink(linkUrl) ? 'Abrir chat' : 'WhatsApp Web'}${ICONS.external}</a>
                </div>
            </div>`;
    }).join('');
}

async function loadBusy() {
    try {
        const data = await fetch('/api/busy').then(r => r.json());
        if (data.success) {
            busy = data.busy;
            renderBusy();
        }
    } catch (e) {
        console.error(e);
    }
}

let busyStatusTimer = null;
function flashBusyStatus(text, isError = false) {
    busyStatusMsg.textContent = text;
    busyStatusMsg.classList.toggle('error', isError);
    clearTimeout(busyStatusTimer);
    busyStatusTimer = setTimeout(() => { busyStatusMsg.textContent = ''; }, 4000);
}

async function saveBusy(changes) {
    try {
        const data = await apiPost('/api/busy', changes).then(r => r.json());
        if (data.success) {
            busy = data.busy;
            renderBusy();
            flashBusyStatus('Guardado');
        } else {
            flashBusyStatus(data.error || 'No se pudo guardar', true);
            loadBusy();
        }
    } catch (e) {
        console.error(e);
        flashBusyStatus('Error de conexión', true);
        loadBusy();
    }
}

busyActive.addEventListener('change', () => {
    saveBusy({
        active: busyActive.checked,
        reason: busy.reason,
        customText: busyCustom.value,
        durationMinutes: Number(busyDuration.value),
    });
});

busyReasons.addEventListener('click', (e) => {
    const chip = e.target.closest('.reason-chip');
    if (!chip || chip.dataset.reason === busy.reason) return;
    busy.reason = chip.dataset.reason;
    renderBusy();
    if (busy.reason === 'otro' && !busyCustom.value.trim()) {
        busyCustom.focus();
        return; // se guarda al escribir el motivo
    }
    saveBusy({ reason: busy.reason, customText: busyCustom.value });
});

busyCustom.addEventListener('change', () => saveBusy({ reason: 'otro', customText: busyCustom.value }));
busyDuration.addEventListener('change', () => saveBusy({ durationMinutes: Number(busyDuration.value) }));
busyNotifyUrgent.addEventListener('change', () => saveBusy({ notifyUrgent: busyNotifyUrgent.checked }));
busySummaryEnd.addEventListener('change', () => saveBusy({ summaryOnEnd: busySummaryEnd.checked }));

document.getElementById('busy-clear').addEventListener('click', async () => {
    try {
        const data = await apiPost('/api/busy/clear').then(r => r.json());
        if (data.success) {
            busy = data.busy;
            renderBusy();
        }
    } catch (e) {
        console.error(e);
    }
});

// El indicador de la barra lateral lleva a la vista
busyIndicator.addEventListener('click', () => {
    document.querySelector('.menu-item[data-target="view-busy"]').click();
});

// Actualizaciones en directo (nuevos mensajes, respuestas, fin del tiempo)
socket.on('busy_update', () => loadBusy());

// --- INICIO ---
// El script se carga al final del <body>, así que el DOM ya está listo
(async () => {
    await migrateLocalTasks();
    await Promise.all([loadTasks(), loadLastSummary(), loadSettings(), loadBusy()]);
})();
