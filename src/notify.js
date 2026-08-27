// ═══════════════════════════════════════════════════════════════════════════
// notify.js — Sistema di notifiche corporate (toast + modali di conferma)
// Sostituisce i dialoghi nativi alert()/confirm() con componenti coerenti al
// tema dark dell'app. Caricato PRIMA di i18n/audit/excelExport/main.
//
// API globale:
//   showToast(message, type, opts?)  type: 'success'|'error'|'warning'|'info'
//   showAlert(message, type, opts?)  alias di showToast (ritorna Promise)
//   showConfirm({ title, message, confirmLabel, cancelLabel, danger }) -> Promise<boolean>
//   showPrompt({ title, message, defaultValue, confirmLabel, cancelLabel }) -> Promise<string|null>
// ═══════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const escHtml = (s) => String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    // Keyframes animazioni (self-contained: nessuna dipendenza da CSS esterno)
    const STYLE_ID = 'notify-styles';
    if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '@keyframes notify-pop-in { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }' +
            '.notify-pop { animation: notify-pop-in 0.18s ease-out; }';
        document.head.appendChild(style);
    }

    const TYPES = {
        success: { icon: 'fa-circle-check', color: 'text-emerald-400', border: 'border-emerald-500/40', title: 'Operazione riuscita' },
        error: { icon: 'fa-circle-xmark', color: 'text-rose-400', border: 'border-rose-500/40', title: 'Errore' },
        warning: { icon: 'fa-triangle-exclamation', color: 'text-amber-400', border: 'border-amber-500/40', title: 'Attenzione' },
        info: { icon: 'fa-circle-info', color: 'text-sky-400', border: 'border-sky-500/40', title: 'Info' }
    };

    function ensureContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            c.setAttribute('aria-live', 'polite');
            c.className = 'fixed top-4 right-4 z-[10001] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none';
            document.body.appendChild(c);
        }
        return c;
    }

    // Toast non bloccante: si accumula (max 5), auto-dismiss, pausa al hover.
    function showToast(message, type, opts) {
        type = TYPES[type] ? type : 'info';
        opts = opts || {};
        const cfg = TYPES[type];
        const container = ensureContainer();
        while (container.children.length >= 5) container.removeChild(container.firstChild);

        const el = document.createElement('div');
        el.className = 'toast-card pointer-events-auto bg-slate-900/95 backdrop-blur border ' + cfg.border +
            ' rounded-xl shadow-2xl px-3.5 py-3 flex items-start gap-2.5 transition-all duration-300 opacity-0 translate-x-4';
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        el.innerHTML =
            '<i class="fa-solid ' + cfg.icon + ' ' + cfg.color + ' mt-0.5 text-sm shrink-0"></i>' +
            '<div class="flex-1 min-w-0">' +
            '<div class="text-[11px] font-bold ' + cfg.color + '">' + escHtml(opts.title || cfg.title) + '</div>' +
            '<div class="text-[11px] text-slate-200 whitespace-pre-line break-words mt-0.5">' + escHtml(message) + '</div>' +
            '</div>' +
            '<button class="text-slate-500 hover:text-slate-300 text-xs shrink-0 mt-0.5" aria-label="Chiudi notifica"><i class="fa-solid fa-xmark"></i></button>';

        let timer = null;
        function dismiss() {
            if (timer) clearTimeout(timer);
            el.classList.add('opacity-0', 'translate-x-4');
            setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
        }
        el.querySelector('button').addEventListener('click', dismiss);
        el.addEventListener('mouseenter', () => { if (timer) clearTimeout(timer); });
        el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 1500); });

        container.appendChild(el);
        requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-x-4'));
        const ttl = opts.duration || (type === 'error' ? 8000 : 4500);
        timer = setTimeout(dismiss, ttl);
        return el;
    }

    // Alias compatibile con la semantica alert() (non bloccante).
    function showAlert(message, type, opts) {
        showToast(message, type, opts);
        return Promise.resolve();
    }

    // Modale di conferma: Promise<boolean>. ESC/click fuori = annulla.
    function showConfirm(opts) {
        opts = opts || {};
        const title = opts.title || 'Conferma operazione';
        const message = opts.message || '';
        const confirmLabel = opts.confirmLabel || 'Conferma';
        const cancelLabel = opts.cancelLabel || 'Annulla';
        const danger = opts.danger !== false;

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[10002] flex items-center justify-center p-4';
            overlay.style.background = 'rgba(5, 8, 17, 0.8)';
            overlay.style.backdropFilter = 'blur(4px)';
            overlay.style.webkitBackdropFilter = 'blur(4px)';
            overlay.innerHTML =
                '<div class="notify-pop bg-[#0b0f19] border border-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm" role="alertdialog" aria-modal="true">' +
                '<div class="flex items-start gap-3">' +
                '<div class="inline-flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ' +
                (danger ? 'bg-rose-500/10 border border-rose-500/30' : 'bg-sky-500/10 border border-sky-500/30') + '">' +
                '<i class="fa-solid ' + (danger ? 'fa-triangle-exclamation text-rose-400' : 'fa-circle-question text-sky-400') + '"></i>' +
                '</div>' +
                '<div class="min-w-0">' +
                '<h3 class="text-white font-bold text-sm">' + escHtml(title) + '</h3>' +
                '<p class="text-slate-400 text-[11px] mt-1 whitespace-pre-line break-words">' + escHtml(message) + '</p>' +
                '</div>' +
                '</div>' +
                '<div class="flex gap-2 justify-end mt-5">' +
                '<button data-role="cancel" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-[11px] transition-colors">' + escHtml(cancelLabel) + '</button>' +
                '<button data-role="ok" class="px-3.5 py-2 ' + (danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500') + ' text-white font-bold rounded-lg text-[11px] transition-colors">' + escHtml(confirmLabel) + '</button>' +
                '</div>' +
                '</div>';

            let settled = false;
            const close = (val) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(val);
            };
            const onKey = (e) => { if (e.key === 'Escape') close(false); };
            document.addEventListener('keydown', onKey, true);
            overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => close(false));
            overlay.querySelector('[data-role="ok"]').addEventListener('click', () => close(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

            document.body.appendChild(overlay);
            overlay.querySelector('[data-role="ok"]').focus();
        });
    }

    // Modale di input: Promise<string|null> (null = annullato). Sostituisce prompt().
    function showPrompt(opts) {
        opts = opts || {};
        const title = opts.title || 'Input richiesto';
        const message = opts.message || '';
        const defaultValue = opts.defaultValue !== undefined && opts.defaultValue !== null ? String(opts.defaultValue) : '';
        const confirmLabel = opts.confirmLabel || 'OK';
        const cancelLabel = opts.cancelLabel || 'Annulla';

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[10002] flex items-center justify-center p-4';
            overlay.style.background = 'rgba(5, 8, 17, 0.8)';
            overlay.style.backdropFilter = 'blur(4px)';
            overlay.style.webkitBackdropFilter = 'blur(4px)';
            overlay.innerHTML =
                '<div class="notify-pop bg-[#0b0f19] border border-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm" role="dialog" aria-modal="true">' +
                '<h3 class="text-white font-bold text-sm">' + escHtml(title) + '</h3>' +
                (message ? '<p class="text-slate-400 text-[11px] mt-1 whitespace-pre-line break-words">' + escHtml(message) + '</p>' : '') +
                '<input data-role="input" type="text" class="w-full mt-3 bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-white text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">' +
                '<div class="flex gap-2 justify-end mt-4">' +
                '<button data-role="cancel" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg text-[11px] transition-colors">' + escHtml(cancelLabel) + '</button>' +
                '<button data-role="ok" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[11px] transition-colors">' + escHtml(confirmLabel) + '</button>' +
                '</div>' +
                '</div>';

            const input = overlay.querySelector('[data-role="input"]');
            input.value = defaultValue;

            let settled = false;
            const close = (val) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(val);
            };
            const onKey = (e) => { if (e.key === 'Escape') close(null); };
            document.addEventListener('keydown', onKey, true);
            overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
            overlay.querySelector('[data-role="ok"]').addEventListener('click', () => close(input.value));
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

            document.body.appendChild(overlay);
            input.focus();
            input.select();
        });
    }

    window.showToast = showToast;
    window.showAlert = showAlert;
    window.showConfirm = showConfirm;
    window.showPrompt = showPrompt;
})();
