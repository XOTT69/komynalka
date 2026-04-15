// 1. Реєстрація Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

// 2. Глобальна кастомна модалка (замість alert/prompt/confirm)
window.appModal = function({title = 'Увага', msg, type = 'alert'}) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customModalOverlay');
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalMsg').textContent = msg;
        
        const inputWrap = document.getElementById('modalInputWrap');
        const input = document.getElementById('modalInput');
        const btnCancel = document.getElementById('modalCancel');
        const btnOk = document.getElementById('modalOk');

        inputWrap.classList.toggle('hidden', type !== 'prompt');
        btnCancel.classList.toggle('hidden', type === 'alert');
        if (type === 'prompt') input.value = '';

        overlay.classList.remove('hidden');
        setTimeout(() => { overlay.classList.remove('opacity-0'); modal.classList.remove('scale-95'); }, 10);

        const close = (val) => {
            overlay.classList.add('opacity-0'); modal.classList.add('scale-95');
            setTimeout(() => overlay.classList.add('hidden'), 300);
            resolve(val);
        };

        btnOk.onclick = () => close(type === 'prompt' ? input.value : true);
        btnCancel.onclick = () => close(type === 'prompt' ? null : false);
    });
};

// !!! ВАЖЛИВО: 
// 1. Видаліть функцію "async function getHash(message) { ... }" повністю.
// 2. У вашій функції авторизації просто надсилайте пароль: 
//    const passHash = authPass.value; // без хешування на клієнті
