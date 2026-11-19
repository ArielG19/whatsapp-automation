const form = document.getElementById('login-form');
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
            body: JSON.stringify({ password: passwordInput.value }),
        });
        const data = await response.json();
        if (data.success) {
            window.location.replace('/');
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
