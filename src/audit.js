// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG + UNDO MANAGER — AntiGravity Hybrid FV + BESS Simulator
//
// Audit: registro degli eventi di modifica (CRUD impianti/stabilimenti, import
// GME, scenari, config). Persistenza su simulation_config con chiavi
// 'audit::<ISO timestamp>' (JSON compatto ≤ 250 char, pruning a 200 voci).
// Nessuna migrazione DB richiesta.
//
// Undo: banner temporizzato per azioni distruttive (delete impianto/stabilimento/
// scenario, import GME) + storico configurazione con Ctrl+Z (ultimi 10 stati).
// ═══════════════════════════════════════════════════════════════════════════

const Audit = {
    MAX_ENTRIES: 200,
    entries: [],
    _loaded: false,

    async init() {
        if (this._loaded || typeof supabaseClient === 'undefined' || !supabaseClient) return;
        this._loaded = true;
        try {
            const { data, error } = await supabaseClient
                .from('simulation_config')
                .select('parameter_key, parameter_value')
                .like('parameter_key', 'audit::%')
                .order('parameter_key', { ascending: false })
                .limit(this.MAX_ENTRIES);
            if (error) throw error;
            this.entries = (data || []).map(r => {
                try {
                    const obj = JSON.parse(r.parameter_value);
                    return { key: r.parameter_key, t: r.parameter_key.substring(7), a: obj.a, d: obj.d };
                } catch (e) { return null; }
            }).filter(Boolean);
        } catch (err) {
            console.warn('[Audit] caricamento log fallito:', err.message);
        }
    },

    async log(action, details) {
        const ts = new Date().toISOString();
        const key = 'audit::' + ts;
        const detail = (details || '').substring(0, 180);
        const payload = JSON.stringify({ a: action, d: detail });
        if (payload.length > 250) return; // guard varchar(255)
        this.entries.unshift({ key, t: ts, a: action, d: detail });
        if (this.entries.length > this.MAX_ENTRIES) this.entries.pop();
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            try {
                const uid = (typeof currentUserId === 'function') ? currentUserId() : null;
                await supabaseClient.from('simulation_config')
                    .upsert({ parameter_key: key, parameter_value: payload, user_id: uid }, { onConflict: 'parameter_key,user_id' });
                this._prune();
            } catch (err) {
                console.warn('[Audit] scrittura fallita:', err.message);
            }
        }
        if (document.getElementById('audit-modal')?.style.display === 'flex') renderAuditList();
    },

    async _prune() {
        try {
            const { data } = await supabaseClient
                .from('simulation_config')
                .select('parameter_key')
                .like('parameter_key', 'audit::%')
                .order('parameter_key', { ascending: false })
                .range(this.MAX_ENTRIES, this.MAX_ENTRIES + 500);
            if (data && data.length > 0) {
                await supabaseClient.from('simulation_config').delete()
                    .in('parameter_key', data.map(r => r.parameter_key));
            }
        } catch (e) { /* pruning best-effort */ }
    },

    async clear() {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            try {
                await supabaseClient.from('simulation_config').delete().like('parameter_key', 'audit::%');
            } catch (e) { /* best-effort */ }
        }
        this.entries = [];
        renderAuditList();
    }
};

// ── Undo banner per azioni distruttive ──
const UndoManager = {
    _current: null,
    _timer: null,
    _countdownInterval: null,

    show(label, undoFn) {
        this._current = { label, undo: undoFn };
        const banner = document.getElementById('undo-banner');
        const textEl = document.getElementById('undo-banner-text');
        if (!banner || !textEl) return;
        textEl.textContent = label;
        banner.style.display = 'flex';
        let seconds = 12;
        const cd = document.getElementById('undo-banner-countdown');
        if (cd) cd.textContent = seconds + 's';
        clearTimeout(this._timer);
        clearInterval(this._countdownInterval);
        this._countdownInterval = setInterval(() => {
            seconds--;
            if (cd) cd.textContent = Math.max(0, seconds) + 's';
            if (seconds <= 0) this.dismiss();
        }, 1000);
        this._timer = setTimeout(() => this.dismiss(), 12000);
    },

    async execute() {
        if (!this._current) return;
        const action = this._current;
        this.dismiss();
        try {
            await action.undo();
        } catch (e) {
            console.error('Undo fallito:', e);
            alert('Annullamento fallito: ' + e.message);
        }
    },

    dismiss() {
        clearTimeout(this._timer);
        clearInterval(this._countdownInterval);
        this._current = null;
        const banner = document.getElementById('undo-banner');
        if (banner) banner.style.display = 'none';
    }
};

// ── Storico configurazione (Ctrl+Z, profondità 10) ──
const ConfigHistory = {
    stack: [],
    current: null,

    record(inputsJson) {
        if (this.current !== null && this.current !== inputsJson) {
            this.stack.push(this.current);
            if (this.stack.length > 10) this.stack.shift();
        }
        this.current = inputsJson;
    },

    async undo() {
        if (this.stack.length === 0) return false;
        const target = this.stack.pop();
        this.current = target;
        State.inputs = JSON.parse(target);
        initDOMFromState();
        await saveConfigToSupabase(); // record(target): già current, niente push
        triggerRecalculate();
        Audit.log('config.undo', 'Ripristino configurazione precedente (Ctrl+Z)');
        return true;
    }
};

// ── UI: modale audit ──
window.openAuditLog = function() {
    const modal = document.getElementById('audit-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderAuditList();
};

window.closeAuditLog = function() {
    const modal = document.getElementById('audit-modal');
    if (modal) modal.style.display = 'none';
};

window.clearAuditLog = function() {
    if (!confirm('Svuotare tutto il registro audit?')) return;
    Audit.clear();
};

function renderAuditList() {
    const listEl = document.getElementById('audit-list');
    if (!listEl) return;
    if (!Audit.entries || Audit.entries.length === 0) {
        listEl.innerHTML = '<div class="text-center text-slate-500 text-xs py-8">Nessun evento registrato.</div>';
        return;
    }
    const iconFor = (a) => {
        if (a.startsWith('plant.')) return { icon: 'fa-solar-panel', color: 'text-amber-400' };
        if (a.startsWith('stab.')) return { icon: 'fa-industry', color: 'text-purple-400' };
        if (a.startsWith('scenario.')) return { icon: 'fa-layer-group', color: 'text-violet-400' };
        if (a.startsWith('gme.')) return { icon: 'fa-file-excel', color: 'text-emerald-400' };
        if (a.startsWith('config.')) return { icon: 'fa-sliders', color: 'text-sky-400' };
        if (a.startsWith('report.')) return { icon: 'fa-file-pdf', color: 'text-rose-400' };
        return { icon: 'fa-circle-info', color: 'text-slate-400' };
    };
    let html = '';
    Audit.entries.forEach(e => {
        const { icon, color } = iconFor(e.a);
        const when = new Date(e.t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        html += `
            <div class="flex items-start space-x-3 px-3 py-2 border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                <i class="fa-solid ${icon} ${color} mt-0.5 text-xs"></i>
                <div class="flex-1 min-w-0">
                    <div class="text-[11px] text-slate-200 font-semibold">${escapeHtml(e.a)}</div>
                    <div class="text-[10px] text-slate-500 truncate">${escapeHtml(e.d || '')}</div>
                </div>
                <span class="text-[9px] text-slate-600 font-mono whitespace-nowrap">${when}</span>
            </div>`;
    });
    listEl.innerHTML = html;
}

// ── Ctrl+Z: undo banner attivo -> esegui; altrimenti undo configurazione ──
document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('input, textarea, select')) {
        e.preventDefault();
        if (UndoManager._current) {
            UndoManager.execute();
        } else {
            ConfigHistory.undo().then(ok => {
                if (!ok) console.debug('[Undo] Nessuno stato configurazione precedente.');
            });
        }
    }
});

window.Audit = Audit;
window.UndoManager = UndoManager;
window.ConfigHistory = ConfigHistory;
