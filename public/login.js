const form = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorBox = document.getElementById('login-error');
const button = document.getElementById('login-button');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    button.textContent = 'Entrando...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-WA-Panel': '1' },
            body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value }),
        });
        const data = await response.json();
        if (data.success) {
            // Solo rutas propias (nunca una dirección externa)
            window.location.replace(data.next === '/registro' ? '/registro' : '/panel');
            return;
        }
        errorBox.textContent = data.error || 'No se pudo iniciar sesión';
        passwordInput.select();
    } catch (err) {
        errorBox.textContent = 'Error de conexión con el servidor.';
    }
    button.disabled = false;
    button.textContent = 'Entrar';
});
