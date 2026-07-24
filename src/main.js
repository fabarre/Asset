        let supabaseClient = null;
        let editingPlantId = null;
        let originalPlantData = null;
        const State = window.State = {
            isLoading: true,
            inputs: {},
            plants: [],       // array of { id, name, capacity, zone, capex, opex, generation: Float64Array(8760) }
            stabilimenti: [], // array of { id, name, plantId, ppaType, ppaPrice, ppaDuration, load: Float64Array(8760), ... }
            zonalPun: {
                NORD: new Float64Array(8760),
                CNOR: new Float64Array(8760),
                CSUD: new Float64Array(8760),
                SUD: new Float64Array(8760),
                SICI: new Float64Array(8760),
                SARD: new Float64Array(8760)
            },
            selectedDay: 1,
            chartResolution: 'giorno',
            chartAggregation: 'orario',
            selectedPeriodIndex: 1,
            results: {},
            chartInstance: null,
            revenueChartInstance: null,
            hourlyChartInstance: null,
            isUpdatePending: false,
            recalcNeeded: false
        };

        function escapeHtml(str) {
            if (typeof str !== 'string') return str;
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }
        window.escapeHtml = escapeHtml;

        const PROJECT_LIFE = 20;

        // Initialize default profiles
        const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        
        function getHourIndex(month, day, hour) {
            let dayOffset = 0;
            for (let m = 0; m < month - 1; m++) {
                dayOffset += DAYS_IN_MONTH[m];
            }
            return (dayOffset + (day - 1)) * 24 + hour;
        }

        
        // Perdite di rete da configurazione utente (allineato al worker: prima erano hardcoded
        // BT 5.2 / MT 2.3 / AT 0 e ignoravano gli input ridLossInject*/ridLossWithdraw*/cerLossCpr*)
        function resolveGridLosses(voltage, type) {
            const v = String(voltage || 'none').toLowerCase().trim();
            if (v !== 'bt' && v !== 'mt' && v !== 'at') return 0;
            const suffix = v === 'bt' ? 'Bt' : (v === 'mt' ? 'Mt' : 'At');
            let key = '';
            if (type === 'inject') key = 'ridLossInject' + suffix;
            else if (type === 'withdraw') key = 'ridLossWithdraw' + suffix;
            else if (type === 'cpr') key = 'cerLossCpr' + suffix;
            else return 0;
            return (State.inputs && State.inputs[key] !== undefined) ? State.inputs[key] : 0;
        }

        function getMonthOfHour(t) {
            const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
            for (let m = 0; m < 12; m++) {
                if (t >= monthStartHours[m] && t < monthStartHours[m+1]) return m;
            }
            return 11;
        }

        // Seasonal solar profile generator

        // Default dual-peak PUN profile for all zones

        // Seasonal solar profile generator
        function generateDefaultSolarProfile(capacityMw, yieldKwhKwp) {
            const profile = new Float64Array(8760);
            let totalUnitGen = 0;
            for (let hourIndex = 0; hourIndex < 8760; hourIndex++) {
                const dayOfYear = Math.floor(hourIndex / 24);
                const hourOfDay = hourIndex % 24;
                const seasonFactor = 1.0 + 0.35 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                const sunrise = 6 - Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                const sunset = 18 + Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                
                if (hourOfDay >= sunrise && hourOfDay <= sunset) {
                    const peakFactor = Math.sin(Math.PI * (hourOfDay - sunrise) / (sunset - sunrise));
                    const gen = peakFactor * seasonFactor;
                    profile[hourIndex] = gen;
                    totalUnitGen += gen;
                } else {
                    profile[hourIndex] = 0;
                }
            }
            const targetTotalGenKwh = capacityMw * 1000 * yieldKwhKwp;
            const scaleFactor = targetTotalGenKwh / totalUnitGen;
            for (let i = 0; i < 8760; i++) {
                profile[i] *= scaleFactor;
            }
            return profile;
        }

        function initializeDefaultPrices() {
            // Rimosso su richiesta dell'utente: NIENTE DATI DI DEFAULT.
            // I prezzi PUN devono arrivare esclusivamente dal database (tabella pun_historical).
            // L'array State.zonalPun è già inizializzato a 0.
        }

        // Load Supabase credentials from external file, then auth gate.
        // Ritorna: 'authenticated' | 'auth_required' | 'no_config'
        async function loadSupabaseConfig() {
            const urlInput = document.getElementById('supabase-url');
            const keyInput = document.getElementById('supabase-key');
            const statusEl = document.getElementById('sync-status');
            
            let config = null;
            // First check window.SUPABASE_CONFIG (loaded from supabase_config.js via script tag, bypassing CORS)
            if (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.SUPABASE_URL && window.SUPABASE_CONFIG.SUPABASE_ANON_KEY) {
                config = window.SUPABASE_CONFIG;
            } else {
                try {
                    const response = await fetch('./supabase_config.json');
                    if (response.ok) {
                        const json = await response.json();
                        if (json.SUPABASE_URL && json.SUPABASE_ANON_KEY) config = json;
                    }
                } catch (e) {
                    console.warn("Impossibile caricare supabase_config.json:", e);
                }
            }
            if (!config) return 'no_config';
            
            urlInput.value = config.SUPABASE_URL;
            keyInput.value = config.SUPABASE_ANON_KEY;
            urlInput.disabled = true;
            keyInput.disabled = true;
            urlInput.classList.add('opacity-60', 'cursor-not-allowed');
            keyInput.classList.add('opacity-60', 'cursor-not-allowed');
            
            supabaseClient = supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
            registerAuthListener();
            
            // Auth gate: sessione attiva?
            let session = null;
            try {
                const { data } = await supabaseClient.auth.getSession();
                session = data && data.session;
            } catch (e) {
                console.warn('Auth session check fallito:', e);
            }
            
            if (session) {
                onUserAuthenticated(session.user);
                statusEl.textContent = "Stato Connessione: Collegato (autenticato)";
                statusEl.className = "text-xs text-emerald-400 font-medium";
                await loadDataFromSupabase();
                return 'authenticated';
            }
            
            // Nessuna sessione: mostra login (l'utente può anche proseguire in anonimo se le RLS lo consentono)
            statusEl.textContent = "Stato Connessione: Login richiesto";
            statusEl.className = "text-xs text-amber-400 font-medium";
            showAuthOverlay();
            return 'auth_required';
        }

        // ── AUTH MODULE (Supabase Auth, email/password) ──
        function showAuthOverlay() {
            const ov = document.getElementById('auth-overlay');
            if (ov) ov.style.display = 'flex';
            const emailEl = document.getElementById('auth-email');
            if (emailEl) setTimeout(() => emailEl.focus(), 150);
        }
        function hideAuthOverlay() {
            const ov = document.getElementById('auth-overlay');
            if (ov) ov.style.display = 'none';
            const errEl = document.getElementById('auth-error');
            if (errEl) errEl.classList.add('hidden');
        }
        function showAuthError(msg, isInfo = false) {
            const errEl = document.getElementById('auth-error');
            if (!errEl) return;
            errEl.textContent = msg;
            errEl.className = isInfo
                ? 'text-emerald-400 text-[11px] font-semibold text-center bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2'
                : 'text-rose-400 text-[11px] font-semibold text-center bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2';
        }
        function onUserAuthenticated(user) {
            State.currentUser = user || null;
            updateAdminTabVisibility();
            const badge = document.getElementById('auth-user-badge');
            const logoutBtn = document.getElementById('btn-logout');
            if (badge && user && user.email) {
                badge.textContent = user.email;
                badge.classList.remove('hidden');
            }
            if (logoutBtn) logoutBtn.classList.remove('hidden');
        }
        // ── Admin: scheda Gestione Utenti (visibile solo a app_metadata.role = 'admin') ──
        function isCurrentUserAdmin() {
            return !!(State.currentUser && State.currentUser.app_metadata && State.currentUser.app_metadata.role === 'admin');
        }

        function updateAdminTabVisibility() {
            const btn = document.getElementById('btn-tab-users');
            if (!btn) return;
            const admin = isCurrentUserAdmin();
            btn.classList.toggle('hidden', !admin);
            btn.classList.toggle('flex', admin);
        }

        window.fetchAdminUsers = async function() {
            const body = document.getElementById('users-table-body');
            if (!body) return;
            if (!isCurrentUserAdmin()) {
                body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-rose-400">Accesso riservato al ruolo admin.</td></tr>';
                return;
            }
            body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Caricamento utenti...</td></tr>';
            try {
                const { data, error } = await supabaseClient.rpc('admin_list_users');
                if (error) throw error;
                renderAdminUsers(data || []);
            } catch (err) {
                console.error('admin_list_users error:', err);
                body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-rose-400">Errore: ' + escapeHtml(err.message) + '</td></tr>';
            }
        };

        function renderAdminUsers(users) {
            const body = document.getElementById('users-table-body');
            if (!body) return;
            if (!users.length) {
                body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500">Nessun utente registrato.</td></tr>';
                return;
            }
            const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
            const oneHourAgo = Date.now() - 3600 * 1000;
            let html = '';
            users.forEach(u => {
                const lastActivity = u.last_activity ? new Date(u.last_activity).getTime() : 0;
                let semaforo, semaforoLabel;
                if (u.sessions_active > 0 && lastActivity >= oneHourAgo) {
                    semaforo = '\uD83D\uDFE2'; semaforoLabel = 'Online';
                } else if (u.sessions_active > 0) {
                    semaforo = '\uD83D\uDFE1'; semaforoLabel = 'Sessione valida';
                } else {
                    semaforo = '\u26AB'; semaforoLabel = 'Offline';
                }
                const isAdminUser = u.email === (State.currentUser && State.currentUser.email);
                html += `
                    <tr class="hover:bg-slate-900/40 border-b border-slate-850 transition-colors">
                        <td class="py-2.5 pr-4 whitespace-nowrap" title="${semaforoLabel}">${semaforo} <span class="text-[9px] text-slate-500">${semaforoLabel}</span></td>
                        <td class="py-2.5 pr-4 font-semibold ${isAdminUser ? 'text-emerald-400' : 'text-slate-200'}">${escapeHtml(u.email)}${isAdminUser ? ' <span class="text-[9px] bg-emerald-500/10 border border-emerald-500/30 rounded px-1 py-0.5 ml-1">ADMIN</span>' : ''}</td>
                        <td class="py-2.5 pr-4 text-slate-400 whitespace-nowrap">${fmtDate(u.created_at)}</td>
                        <td class="py-2.5 pr-4">${u.confirmed ? '<span class="text-emerald-400">\u2713 S\u00EC</span>' : '<span class="text-amber-400">In attesa</span>'}</td>
                        <td class="py-2.5 pr-4 text-slate-400 whitespace-nowrap">${fmtDate(u.last_sign_in_at)}</td>
                        <td class="py-2.5 pr-4 text-slate-400 whitespace-nowrap">${fmtDate(u.last_activity)}</td>
                        <td class="py-2.5 text-center font-mono">${u.sessions_active}</td>
                    </tr>`;
            });
            body.innerHTML = html;
        }

        function registerAuthListener() {
            if (!supabaseClient || State._authListenerRegistered) return;
            State._authListenerRegistered = true;
            supabaseClient.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_OUT') {
                    window.location.reload();
                }
            });
        }
        // Boot dell'app dopo autenticazione (o scelta anonima): carica dati e avvia simulazione
        async function bootAfterAuth() {
            showCalcIndicator(true);
            try {
                await withTimeout(loadDataFromSupabase(), 60000, 'loadDataFromSupabase');
                initDOMFromState();
                renderPlantsList();
                renderZonalAverages();
                triggerRecalculate();
            } catch (err) {
                console.error('Boot dopo autenticazione fallito:', err);
                // RLS restrittive o errore dati: riproponi il login invece di lasciare l'app bloccata
                showAuthOverlay();
                const statusEl = document.getElementById('sync-status');
                if (statusEl) {
                    statusEl.textContent = "Stato Connessione: Accesso negato - login richiesto";
                    statusEl.className = "text-xs text-rose-400 font-bold";
                }
                showAuthError('Accesso ai dati negato: autenticati per continuare. (' + err.message + ')');
            } finally {
                State.isLoading = false;
                showCalcIndicator(false);
                // i18n: applica lingua salvata anche dopo boot post-login
                if (window.I18n && !window.I18n._observer) window.I18n.init();
            }
        }

        window.loginUser = async function() {
            if (!supabaseClient) { showAuthError('Database non configurato.'); return; }
            const email = (document.getElementById('auth-email').value || '').trim();
            const password = document.getElementById('auth-password').value || '';
            if (!email || !password) { showAuthError('Inserisci email e password.'); return; }
            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;
                hideAuthOverlay();
                onUserAuthenticated(data.user);
                const statusEl = document.getElementById('sync-status');
                if (statusEl) {
                    statusEl.textContent = "Stato Connessione: Collegato (autenticato)";
                    statusEl.className = "text-xs text-emerald-400 font-medium";
                }
                await bootAfterAuth();
            } catch (err) {
                showAuthError(err.message === 'Invalid login credentials' ? 'Credenziali non valide. Riprova.' : err.message);
            }
        };

        window.signupUser = async function() {
            if (!supabaseClient) { showAuthError('Database non configurato.'); return; }
            const email = (document.getElementById('auth-email').value || '').trim();
            const password = document.getElementById('auth-password').value || '';
            if (!email || !password) { showAuthError('Inserisci email e password per la registrazione.'); return; }
            if (password.length < 6) { showAuthError('La password deve contenere almeno 6 caratteri.'); return; }
            try {
                const { data, error } = await supabaseClient.auth.signUp({ email, password });
                if (error) throw error;
                if (data.session) {
                    // Conferma email disabilitata: accesso immediato
                    hideAuthOverlay();
                    onUserAuthenticated(data.user);
                    await bootAfterAuth();
                } else {
                    showAuthError('Registrazione completata. Se richiesta dal progetto, conferma la email e poi accedi.', true);
                }
            } catch (err) {
                showAuthError(err.message);
            }
        };

        window.continueAnonymous = async function() {
            hideAuthOverlay();
            const statusEl = document.getElementById('sync-status');
            if (statusEl) {
                statusEl.textContent = "Stato Connessione: Collegato (anonimo)";
                statusEl.className = "text-xs text-emerald-400 font-medium";
            }
            await bootAfterAuth();
        };

        window.logoutUser = async function() {
            if (!supabaseClient) return;
            await supabaseClient.auth.signOut(); // il listener SIGNED_OUT ricarica la pagina
        };

        // Initialize App
        // Utility: wrap a promise with a timeout
        function withTimeout(promise, ms, label) {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout dopo ${ms}ms: ${label}`)), ms))
            ]);
        }

        window.onload = async function() {
            // Inizializza il DB offline
            try {
                await window.HybridDB.init();
            } catch (err) {
                console.warn("IndexedDB init failed:", err);
            }
            // Darken the page immediately before anything else is visible
            showCalcIndicator(true);

            try {
                initializeDefaultPrices();
                initializeTableSkeletons();
                attachEventListeners();
                initScrollSync();
                
                // Wrap Supabase loading con timeout a 60s, errore critico se fallisce (no fallback)
                let bootMode;
                try {
                    bootMode = await withTimeout(loadSupabaseConfig(), 60000, 'loadSupabaseConfig');
                } catch (sbErr) {
                    console.error("Caricamento Supabase fallito o timeout:", sbErr.message);
                    const statusEl = document.getElementById('sync-status');
                    if (statusEl) {
                        statusEl.textContent = "Stato Connessione: Timeout o Errore";
                        statusEl.className = "text-xs text-red-400 font-bold";
                    }
                    showCalcIndicator(false);
                    document.body.innerHTML = `
                        <div class="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center p-8 z-[9999]">
                            <div class="bg-red-500/10 border border-red-500 text-red-500 p-6 rounded-lg max-w-xl text-center shadow-2xl">
                                <h1 class="text-2xl font-bold mb-4">Errore Critico Inizializzazione DB</h1>
                                <p class="mb-4">Il database Supabase non ha risposto in tempo o si è verificato un errore (${sbErr.message}).</p>
                                <p class="font-bold text-lg mb-6">L'applicazione è stata bloccata per evitare l'uso di dati di default errati.</p>
                                <button onclick="window.location.reload()" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition-colors">
                                    Ricarica Pagina
                                </button>
                            </div>
                        </div>
                    `;
                    throw new Error("Fatal: Supabase init failed"); // Blocca esecuzione onload
                }
                
                if (bootMode === 'authenticated') {
                    // Inizializza il DOM con i valori REALI caricati da Supabase, nessun default.
                    initDOMFromState();
                    renderPlantsList();
                    renderZonalAverages();
                    triggerRecalculate();
                } else if (bootMode === 'no_config') {
                    throw new Error('Configurazione Supabase non trovata (supabase_config.js/json).');
                }
                // 'auth_required': il boot continua dopo login o scelta anonima (bootAfterAuth)
            } catch (err) {
                console.error("Errore durante l'inizializzazione dell'app:", err);
            } finally {
                State.isLoading = false;
                // Rilasciamo il blocco dell'indicatore iniziale
                showCalcIndicator(false);
                // i18n: applica lingua salvata (localStorage / config Supabase)
                if (window.I18n) window.I18n.init();
            }
        };

        // DOM helper formatters
        function formatEuro(val) {
            return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
        }


        function switchTab(tabId) {
            if (tabId === 'tab-stabilimenti') {
                // Refresh plant dropdown and list when entering the tab
                setTimeout(() => {
                    populatePlantSelectForStabilimento(document.getElementById('stab-edit-id').value || null);
                    renderStabilimentiList();
                    scheduleLoadPreview();
                }, 50);
            }
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            
            // Highlight nav buttons
            const navMap = {
                'tab-dashboard': 'btn-tab-dashboard',
                'tab-deal-config': 'btn-tab-deal-config',
                'tab-plants': 'btn-tab-plants',
                'tab-gme': 'btn-tab-gme',
                'tab-rid': 'btn-tab-rid',
                'tab-cer': 'btn-tab-cer',
                'tab-hourly': 'btn-tab-hourly',
                'tab-financials': 'btn-tab-financials',
                'tab-stabilimenti': 'btn-tab-stabilimenti',
                'tab-sensitivity': 'btn-tab-sensitivity',
                'tab-users': 'btn-tab-users'
            };
            
            document.querySelectorAll('nav button').forEach(btn => {
                btn.className = "border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-800 px-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center space-x-2";
            });
            const activeNavBtn = document.getElementById(navMap[tabId]);
            if (activeNavBtn) activeNavBtn.className = "border-b-2 border-emerald-500 text-emerald-400 px-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center space-x-2";
            // Il forEach sopra rimuove 'hidden' dai bottoni: riapplica la visibilità admin
            updateAdminTabVisibility();
            if (tabId === 'tab-users') fetchAdminUsers();
            
            // Re-render chart on tab switches to ensure proper layout sizing
            if (tabId === 'tab-dashboard') {
                if (State.chartInstance) setTimeout(() => State.chartInstance.resize(), 50);
                if (State.revenueChartInstance) setTimeout(() => State.revenueChartInstance.resize(), 50);
            } else if (tabId === 'tab-hourly') {
                setTimeout(() => renderHourlyProfileChart(), 50);
            } else if (tabId === 'tab-gme') {
                setTimeout(() => renderGmeDashboard(), 50);
            }
        }

        // Update BESS parameters on dropdown change (Add Plant form)
        function updatePlantBessParameters() {
            const type = document.getElementById('plant-bess-type').value;
            const mwEl = document.getElementById('plant-bess-mw');
            const mwhEl = document.getElementById('plant-bess-mwh');
            const efficiencyEl = document.getElementById('plant-bess-efficiency');
            const degradationEl = document.getElementById('plant-bess-degradation');
            const capexEl = document.getElementById('plant-bess-capex-kwh');
            const dodEl = document.getElementById('plant-bess-dod');
            const socMinEl = document.getElementById('plant-bess-soc-min');
            const socMaxEl = document.getElementById('plant-bess-soc-max');
            const tempMinEl = document.getElementById('plant-bess-temp-min');
            const tempMaxEl = document.getElementById('plant-bess-temp-max');
            const cyclesEl = document.getElementById('plant-bess-cycles');
            const warrantyEl = document.getElementById('plant-bess-warranty-years');

            if (type === 'none') {
                mwEl.value = 0; mwhEl.value = 0; efficiencyEl.value = 0;
                degradationEl.value = 0; capexEl.value = 0;
                dodEl.value = 0; socMinEl.value = 0; socMaxEl.value = 0;
                tempMinEl.value = 0; tempMaxEl.value = 0;
                cyclesEl.value = 0; warrantyEl.value = 0;
                document.getElementById('plant-bess-connection').value = 'none';
            } else if (type === 'graphene') {
                mwEl.value = 2; mwhEl.value = 4; efficiencyEl.value = 96;
                degradationEl.value = 0.1; capexEl.value = 600;
                dodEl.value = 100; socMinEl.value = 0; socMaxEl.value = 100;
                tempMinEl.value = -20; tempMaxEl.value = 60;
                cyclesEl.value = 20000; warrantyEl.value = 15;
            } else if (type === 'nmc') {
                mwEl.value = 2; mwhEl.value = 4; efficiencyEl.value = 86;
                degradationEl.value = 2.4; capexEl.value = 350;
                dodEl.value = 85; socMinEl.value = 10; socMaxEl.value = 95;
                tempMinEl.value = -10; tempMaxEl.value = 45;
                cyclesEl.value = 3000; warrantyEl.value = 10;
            } else if (type === 'lfp') {
                mwEl.value = 2; mwhEl.value = 4; efficiencyEl.value = 90;
                degradationEl.value = 1.8; capexEl.value = 300;
                dodEl.value = 90; socMinEl.value = 5; socMaxEl.value = 95;
                tempMinEl.value = -20; tempMaxEl.value = 55;
                cyclesEl.value = 6000; warrantyEl.value = 12;
            }
            onBessConnectionChange();
            validateGridConnectionPower();
            updateFormSubmitButtonState();
            recalcPlantKpis();
        }

        // Manage inverter section visibility based on BESS coupling
        function onBessConnectionChange() {
            const conn = document.getElementById('plant-bess-connection').value;
            const isDc = (conn === 'dc');
            const banner = document.getElementById('inverter-dc-banner');
            const fields = document.getElementById('inverter-fields');
            if (banner) banner.classList.toggle('hidden', !isDc);
            if (fields) {
                fields.classList.toggle('hidden', isDc);
                // When DC: zero out inverter power for grid connection calc
                if (isDc) {
                    const invPow = document.getElementById('plant-inverter-power-kw');
                    if (invPow) invPow.value = 0;
                }
            }
            validateGridConnectionPower();
            updateFormSubmitButtonState();
            recalcPlantKpis();
        }

        window.onMarketTypeChange = function() {
            const marketType = document.getElementById('plant-market-type').value;
            const ridParams = document.getElementById('market-params-rid');
            const ferxParams = document.getElementById('market-params-ferx');
            const decayParams = document.getElementById('market-params-decay');
            if (ridParams) ridParams.classList.toggle('hidden', marketType !== 'rid');
            if (ferxParams) ferxParams.classList.toggle('hidden', marketType !== 'fer_x');
            if (decayParams) decayParams.classList.toggle('hidden', marketType === 'fer_x');
        };

        // Validate that gridConnectionKw >= inverterKw + bessMw*1000
        function validateGridConnectionPower() {
            const gridKw = parseFloat((document.getElementById('plant-grid-connection-kw') || {}).value) || 0;
            const bessConn = (document.getElementById('plant-bess-connection') || {}).value || 'none';
            const isDc = (bessConn === 'dc');
            // DC: inverter is not present - only BESS power counts
            const invKw = isDc ? 0 : (parseFloat((document.getElementById('plant-inverter-power-kw') || {}).value) || 0);
            const bessMwVal = parseFloat((document.getElementById('plant-bess-mw') || {}).value) || 0;
            const bessKw = bessMwVal * 1000;
            const minRequired = invKw + bessKw;
            const warningEl = document.getElementById('grid-power-warning');
            const warningText = document.getElementById('grid-power-warning-text');
            if (warningEl && warningText) {
                if (minRequired > 0 && gridKw > 0 && gridKw < minRequired) {
                    warningText.textContent = `\u26A0 Potenza immissione (${gridKw.toLocaleString('it-IT')} kW) inferiore alla somma Inverter + BESS (${minRequired.toLocaleString('it-IT')} kW). Verificare il contratto di connessione.`;
                    warningEl.classList.remove('hidden');
                } else {
                    warningEl.classList.add('hidden');
                }
            }
            recalcPlantKpis();
        }

        // Recalculate plant KPIs: Yield, Annual Production, LCOE (realtime)
        // annualGenerationKwh: sum of hourly generation in kWh; capacityKwp: installed capacity
        // If called with no args (e.g. from oninput), tries to use last known values stored in window._lastKpiState
        function recalcPlantKpis(annualGenerationKwh, capacityKwp) {
            const yieldEl = document.getElementById('plant-kpi-yield');
            const prodEl  = document.getElementById('plant-kpi-production');
            const lcoeEl  = document.getElementById('plant-kpi-lcoe');
            if (!yieldEl || !prodEl || !lcoeEl) return;

            // Persist last known generation so cost-only changes can still update LCOE
            if (annualGenerationKwh != null) {
                window._lastKpiState = { annualGenerationKwh, capacityKwp };
            } else if (window._lastKpiState) {
                annualGenerationKwh = window._lastKpiState.annualGenerationKwh;
                capacityKwp = window._lastKpiState.capacityKwp;
            } else {
                return; // No generation data yet
            }

            const cap = capacityKwp || 0;
            const yieldKwhKwp = cap > 0 ? (annualGenerationKwh / cap) : 0;
            const productionMwh = annualGenerationKwh / 1000;

            yieldEl.value = cap > 0 ? yieldKwhKwp.toFixed(1) : '\u2014';
            prodEl.value  = cap > 0 ? productionMwh.toFixed(1) : '\u2014';

            // Discounted LCOE calculation over 20 years matching the simulation methodology
            const PLANT_LIFE = 20;
            const capexPerKwp   = parseFloat((document.getElementById('plant-capex') || {}).value) || 0;
            const opexAnnual    = parseFloat((document.getElementById('plant-opex') || {}).value) || 0;
            const opexIns       = parseFloat((document.getElementById('plant-opex-insurance') || {}).value) || 0;
            const opexTax       = parseFloat((document.getElementById('plant-opex-taxes') || {}).value) || 0;
            const opexSec       = parseFloat((document.getElementById('plant-opex-security') || {}).value) || 0;
            const opexAsset     = parseFloat((document.getElementById('plant-opex-asset-management') || {}).value) || 0;
            const connCost      = parseFloat((document.getElementById('plant-connection-cost') || {}).value) || 0;
            const devCost       = parseFloat((document.getElementById('plant-development-cost') || {}).value) || 0;
            const spvCost       = parseFloat((document.getElementById('plant-spv-acquisition-cost') || {}).value) || 0;
            const landTypeVal   = (document.getElementById('plant-land-type') || {}).value || 'none';
            const landCostVal   = parseFloat((document.getElementById('plant-land-cost') || {}).value) || 0;
            const landCapex = (landTypeVal === 'acquisto') ? landCostVal : 0;
            const landOpex  = (landTypeVal === 'dds_annuo') ? landCostVal : 0;

            let serviceOpexAnnual = 0;
            const serviceType = document.getElementById('plant-service-type') ? document.getElementById('plant-service-type').value : 'none';
            const serviceVal = parseFloat((document.getElementById('plant-service-val') || {}).value) || 0;
            const serviceYears = parseInt((document.getElementById('plant-service-years') || {}).value) || 0;
            if (serviceType !== 'none' && serviceVal > 0) {
                // Find associated stabilimento (if any)
                const activeStab = State.stabilimenti.find(s => s.plantId === (editingPlantId || ''));
                if (activeStab) {
                    if (serviceType === 'ppa_rev_pct') {
                        const ppaPrice = activeStab.ppaPrice || 0;
                        let selfConsKwh = 0;
                        if (activeStab.ppaType === 'on-site' || activeStab.ppaType === 'cer') {
                            const plant = State.plants.find(p => p.id === editingPlantId);
                            if (plant && plant._selfConsumptionMwh !== undefined) {
                                selfConsKwh = plant._selfConsumptionMwh * 1000;
                            } else {
                                selfConsKwh = (annualGenerationKwh || 0) * 0.5;
                            }
                        } else {
                            selfConsKwh = (annualGenerationKwh || 0);
                        }
                        const approxPpaRev = (selfConsKwh / 1000) * ppaPrice;
                        serviceOpexAnnual = (serviceVal / 100) * approxPpaRev;
                    } else if (serviceType === 'shared_ppa_mwh') {
                        let selfConsMwh = 0;
                        const plant = State.plants.find(p => p.id === editingPlantId);
                        if (plant && plant._selfConsumptionMwh !== undefined) {
                            selfConsMwh = plant._selfConsumptionMwh;
                        } else {
                            selfConsMwh = (annualGenerationKwh || 0) * 0.5 / 1000;
                        }
                        serviceOpexAnnual = serviceVal * selfConsMwh;
                    }
                }
            }

            // Exclude BESS CAPEX from Solar LCOE initial cost
            const totalCapexExBess = (capexPerKwp * cap) + connCost + devCost + spvCost + landCapex;
            
            let lcoeSumDiscountedCosts = totalCapexExBess;
            let lcoeSumDiscountedEnergy = 0;
            const wacc = State.inputs.wacc || 0.06;
            const inflation = State.inputs.inflation || 0.02;

            for (let yr = 1; yr <= PLANT_LIFE; yr++) {
                const inflationMultiplier = Math.pow(1 + inflation, yr - 1);
                const discountFactor = Math.pow(1 + wacc, yr);

                // Exclude BESS Opex and BESS maintenance reserve
                let yOpex = (opexAnnual + opexIns + opexTax + opexSec + opexAsset + landOpex) * inflationMultiplier;
                if (yr <= serviceYears) {
                    yOpex += serviceOpexAnnual * inflationMultiplier;
                }

                lcoeSumDiscountedCosts += yOpex / discountFactor;

                const solarDegradation = Math.max(0.50, 1 - 0.0035 * (yr - 1));
                const yEnergyKwh = annualGenerationKwh * solarDegradation;
                lcoeSumDiscountedEnergy += yEnergyKwh / discountFactor;
            }

            if (lcoeSumDiscountedEnergy > 0 && lcoeSumDiscountedCosts > 0) {
                const lcoeMwh = (lcoeSumDiscountedCosts / lcoeSumDiscountedEnergy) * 1000;
                lcoeEl.value = lcoeMwh.toFixed(2);
            } else {
                lcoeEl.value = '\u2014';
            }
        }

        function checkFormModified() {
            if (!originalPlantData) return false;
            
            const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
            const getFloat = (id) => parseFloat(getVal(id)) || 0;
            
            const name = getVal('plant-name');
            const capex = getFloat('plant-capex');
            const opex = getFloat('plant-opex');
            const opexOmBess = getFloat('plant-opex-om-bess');
            const opexInsurance = getFloat('plant-opex-insurance');
            const opexTaxes = getFloat('plant-opex-taxes');
            const opexSecurity = getFloat('plant-opex-security');
            const opexAssetManagement = getFloat('plant-opex-asset-management');
            const connectionCost = getFloat('plant-connection-cost');
            const developmentCost = getFloat('plant-development-cost');
            const landType = getVal('plant-land-type');
            const landCost = getFloat('plant-land-cost');
            const spvAcquisitionCost = getFloat('plant-spv-acquisition-cost');
            
            const bessMw = getFloat('plant-bess-mw');
            const bessMwh = getFloat('plant-bess-mwh');
            const bessType = getVal('plant-bess-type');
            const bessConnection = getVal('plant-bess-connection');
            const formHasBess = bessType && bessType !== 'none' && bessMwh > 0;
            const bessEfficiency = formHasBess ? (getFloat('plant-bess-efficiency') / 100) : 0;
            const bessDegradation = formHasBess ? (getFloat('plant-bess-degradation') / 100) : 0;
            const bessCapexKwh = formHasBess ? getFloat('plant-bess-capex-kwh') : 0;
            
            const gridConnectionKw = getFloat('plant-grid-connection-kw');
            const gridVoltage = getVal('plant-grid-voltage');
            const inverterBrand = getVal('plant-inverter-brand');
            const inverterModel = getVal('plant-inverter-model');
            const inverterPowerKw = getFloat('plant-inverter-power-kw');
            const inverterEfficiency = getFloat('plant-inverter-efficiency');
            const inverterMpptCount = getFloat('plant-inverter-mppt-count');
            const inverterMaxDcV = getFloat('plant-inverter-max-dc-v');
            const bessDoD = formHasBess ? getFloat('plant-bess-dod') : 0;
            const bessSocMin = formHasBess ? getFloat('plant-bess-soc-min') : 0;
            const bessSocMax = formHasBess ? getFloat('plant-bess-soc-max') : 0;
            const bessTempMin = formHasBess ? getFloat('plant-bess-temp-min') : 0;
            const bessTempMax = formHasBess ? getFloat('plant-bess-temp-max') : 0;
            const bessCycles = formHasBess ? getFloat('plant-bess-cycles') : 0;
            const bessWarrantyYears = formHasBess ? getFloat('plant-bess-warranty-years') : 0;

            const earnoutType = getVal('plant-earnout-type');
            const earnoutVal = getFloat('plant-earnout-val');
            const earnoutYears = getFloat('plant-earnout-years');
            const serviceType = getVal('plant-service-type');
            const serviceVal = getFloat('plant-service-val');
            const serviceYears = getFloat('plant-service-years');

            const traderContractType = getVal('plant-trader-contract-type');
            const traderSpread = getFloat('plant-trader-spread-eur-mwh');
            const traderDisp = getFloat('plant-trader-disp-eur-mwh');
            const pnrrContributionPct = getFloat('plant-pnrr-contribution-pct');
            const marketType = getVal('plant-market-type');
            const ferxTariff = getFloat('plant-ferx-tariff');

            const degradeRid = getFloat('plant-degrade-rid');
            const degradeTimeshifting = getFloat('plant-degrade-timeshifting');
            const degradeArbitrage = getFloat('plant-degrade-arbitrage');

            return name !== originalPlantData.name ||
                   capex !== originalPlantData.capex ||
                   opex !== originalPlantData.opex ||
                   opexOmBess !== (originalPlantData.opexOmBess || 0) ||
                   opexInsurance !== (originalPlantData.opexInsurance || 0) ||
                   opexTaxes !== (originalPlantData.opexTaxes || 0) ||
                   opexSecurity !== (originalPlantData.opexSecurity || 0) ||
                   opexAssetManagement !== (originalPlantData.opexAssetManagement || 0) ||
                   connectionCost !== originalPlantData.connectionCost ||
                   developmentCost !== originalPlantData.developmentCost ||
                   landType !== originalPlantData.landType ||
                   landCost !== originalPlantData.landCost ||
                   spvAcquisitionCost !== originalPlantData.spvAcquisitionCost ||
                   gridConnectionKw !== (originalPlantData.gridConnectionKw || 0) ||
                   gridVoltage !== (originalPlantData.gridVoltage || 'none') ||
                   inverterBrand !== (originalPlantData.inverterBrand || '') ||
                   inverterModel !== (originalPlantData.inverterModel || '') ||
                   inverterPowerKw !== (originalPlantData.inverterPowerKw || 0) ||
                   inverterEfficiency !== (originalPlantData.inverterEfficiency || 0) ||
                   inverterMpptCount !== (originalPlantData.inverterMpptCount || 0) ||
                   inverterMaxDcV !== (originalPlantData.inverterMaxDcV || 0) ||
                   bessMw !== originalPlantData.bessMw ||
                   bessMwh !== originalPlantData.bessMwh ||
                   Math.abs(bessEfficiency - originalPlantData.bessEfficiency) > 1e-6 ||
                   Math.abs(bessDegradation - originalPlantData.bessDegradation) > 1e-6 ||
                   bessCapexKwh !== originalPlantData.bessCapexKwh ||
                   bessType !== originalPlantData.bessType ||
                   bessConnection !== originalPlantData.bessConnection ||
                   bessDoD !== (originalPlantData.bessDoD || 0) ||
                   bessSocMin !== (originalPlantData.bessSocMin || 0) ||
                   bessSocMax !== (originalPlantData.bessSocMax || 0) ||
                   bessTempMin !== (originalPlantData.bessTempMin || 0) ||
                   bessTempMax !== (originalPlantData.bessTempMax || 0) ||
                   bessCycles !== (originalPlantData.bessCycles || 0) ||
                   bessWarrantyYears !== (originalPlantData.bessWarrantyYears || 0) ||
                   earnoutType !== (originalPlantData.earnoutType || 'none') ||
                   earnoutVal !== (originalPlantData.earnoutVal || 0) ||
                   earnoutYears !== (originalPlantData.earnoutYears || 0) ||
                   serviceType !== (originalPlantData.serviceType || 'none') ||
                   serviceVal !== (originalPlantData.serviceVal || 0) ||
                   serviceYears !== (originalPlantData.serviceYears || 0) ||
                   traderContractType !== (originalPlantData.traderContractType || 'pun_orario') ||
                   traderSpread !== (originalPlantData.traderSpread || 0) ||
                   traderDisp !== (originalPlantData.traderDisp || 0) ||
                   pnrrContributionPct !== (originalPlantData.pnrrContributionPct || 0) ||
                   marketType !== (originalPlantData.marketType || 'rid') ||
                   ferxTariff !== (originalPlantData.ferxTariff || 85) ||

                   degradeRid !== (originalPlantData.degradeRidPct !== undefined ? originalPlantData.degradeRidPct : 2.0) ||
                   degradeTimeshifting !== (originalPlantData.degradeTimeshiftingPct !== undefined ? originalPlantData.degradeTimeshiftingPct : 2.0) ||
                   degradeArbitrage !== (originalPlantData.degradeArbitragePct !== undefined ? originalPlantData.degradeArbitragePct : 2.0);
        }

        function updateFormSubmitButtonState() {
            const btn = document.getElementById('btn-add-plant');
            if (!btn) return;
            
            if (editingPlantId) {
                const isModified = checkFormModified();
                if (isModified) {
                    btn.disabled = false;
                    btn.className = "w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs cursor-pointer transition-colors flex items-center justify-center";
                } else {
                    btn.disabled = true;
                    btn.className = "w-full py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-xs cursor-not-allowed transition-colors flex items-center justify-center";
                }
            } else {
                const fileInput = document.getElementById('pvgis-file');
                const hasFile = (fileInput && fileInput.files && fileInput.files.length > 0) || !!window._pvgisApiText;
                if (hasFile) {
                    btn.disabled = false;
                    btn.className = "w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-xs cursor-pointer transition-colors flex items-center justify-center";
                } else {
                    btn.disabled = true;
                    btn.className = "w-full py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-xs cursor-not-allowed transition-colors flex items-center justify-center";
                }
            }
        }

        window.submitPlantForm = function() {
            if (editingPlantId) {
                savePlantEdits();
            } else {
                addPlantFromUI();
            }
        };

        window.startEditPlant = function(event, id) {
            const plant = State.plants.find(p => p.id === id);
            if (!plant) return;
            
            editingPlantId = id;
            originalPlantData = { ...plant };
            if (originalPlantData.degradeRidPct === undefined) originalPlantData.degradeRidPct = 2.0;
            if (originalPlantData.degradeTimeshiftingPct === undefined) originalPlantData.degradeTimeshiftingPct = 2.0;
            if (originalPlantData.degradeArbitragePct === undefined) originalPlantData.degradeArbitragePct = 2.0;

            // Normalise: if no BESS installed, treat all BESS numeric fields as 0
            // so that checkFormModified() correctly compares against what the form will show.
            const plantHasBess = plant.bessType && plant.bessType !== 'none' && (plant.bessMwh || 0) > 0;
            if (!plantHasBess) {
                originalPlantData.bessConnection = 'none';
                originalPlantData.bessMw = 0;
                originalPlantData.bessMwh = 0;
                originalPlantData.bessEfficiency = 0;
                originalPlantData.bessDegradation = 0;
                originalPlantData.bessCapexKwh = 0;
                originalPlantData.bessDoD = 0;
                originalPlantData.bessSocMin = 0;
                originalPlantData.bessSocMax = 0;
                originalPlantData.bessTempMin = 0;
                originalPlantData.bessTempMax = 0;
                originalPlantData.bessCycles = 0;
                originalPlantData.bessWarrantyYears = 0;
            }
            
            const titleEl = document.getElementById('plant-form-title');
            if (titleEl) titleEl.textContent = `Modifica Impianto: ${plant.name}`;
            
            document.getElementById('plant-name').value = plant.name;
            document.getElementById('plant-capacity').value = Math.round(plant.capacity);
            document.getElementById('plant-zone').value = plant.zone;
            document.getElementById('plant-capex').value = plant.capex;
            document.getElementById('plant-opex').value = plant.opex;
            document.getElementById('plant-opex-om-bess').value = plant.opexOmBess || 0;
            document.getElementById('plant-opex-insurance').value = plant.opexInsurance || 0;
            document.getElementById('plant-opex-taxes').value = plant.opexTaxes || 0;
            document.getElementById('plant-opex-security').value = plant.opexSecurity || 0;
            document.getElementById('plant-opex-asset-management').value = plant.opexAssetManagement || 0;
            document.getElementById('plant-connection-cost').value = plant.connectionCost || 0;
            document.getElementById('plant-development-cost').value = plant.developmentCost || 0;
            document.getElementById('plant-land-type').value = plant.landType || 'acquisto';
            document.getElementById('plant-land-cost').value = plant.landCost || 0;
            document.getElementById('plant-spv-acquisition-cost').value = plant.spvAcquisitionCost || 0;
            
            // Grid connection fields
            document.getElementById('plant-grid-connection-kw').value = plant.gridConnectionKw || 0;
            document.getElementById('plant-grid-voltage').value = plant.gridVoltage || 'none';

            // Trader & network parameters
            document.getElementById('plant-market-type').value = plant.marketType || 'rid';
            document.getElementById('plant-ferx-tariff').value = plant.ferxTariff !== undefined ? plant.ferxTariff : 85;
            if (window.onMarketTypeChange) window.onMarketTypeChange();
            
            document.getElementById('plant-trader-contract-type').value = plant.traderContractType || 'pun_orario';
            document.getElementById('plant-trader-spread-eur-mwh').value = plant.traderSpread || 0;
            document.getElementById('plant-trader-disp-eur-mwh').value = plant.traderDisp || 0;
            document.getElementById('plant-pnrr-contribution-pct').value = plant.pnrrContributionPct || 0;

            document.getElementById('plant-degrade-rid').value = plant.degradeRidPct !== undefined ? plant.degradeRidPct : 2.0;
            document.getElementById('plant-degrade-timeshifting').value = plant.degradeTimeshiftingPct !== undefined ? plant.degradeTimeshiftingPct : 2.0;
            document.getElementById('plant-degrade-arbitrage').value = plant.degradeArbitragePct !== undefined ? plant.degradeArbitragePct : 2.0;

            // Earn-out and service contract fields
            document.getElementById('plant-earnout-type').value = plant.earnoutType || 'none';
            document.getElementById('plant-earnout-val').value = plant.earnoutVal || 0;
            document.getElementById('plant-earnout-years').value = plant.earnoutYears || 0;
            document.getElementById('plant-service-type').value = plant.serviceType || 'none';
            document.getElementById('plant-service-val').value = plant.serviceVal || 0;
            document.getElementById('plant-service-years').value = plant.serviceYears || 0;

            // Inverter fields (DC coupled = hidden)
            const hasBess = plant.bessType && plant.bessType !== 'none' && (plant.bessMwh || 0) > 0;
            const bessConn = hasBess ? (plant.bessConnection || 'none') : 'none';
            const isDc = (bessConn === 'dc');
            document.getElementById('plant-inverter-brand').value = plant.inverterBrand || '';
            document.getElementById('plant-inverter-model').value = plant.inverterModel || '';
            document.getElementById('plant-inverter-power-kw').value = isDc ? 0 : (plant.inverterPowerKw || 0);
            document.getElementById('plant-inverter-efficiency').value = plant.inverterEfficiency || 0;
            document.getElementById('plant-inverter-mppt-count').value = plant.inverterMpptCount || 0;
            document.getElementById('plant-inverter-max-dc-v').value = plant.inverterMaxDcV || 0;
            // Inverter section visibility
            const invBanner = document.getElementById('inverter-dc-banner');
            const invFields = document.getElementById('inverter-fields');
            if (invBanner) invBanner.classList.toggle('hidden', !isDc);
            if (invFields) invFields.classList.toggle('hidden', isDc);

            // BESS fields
            document.getElementById('plant-bess-type').value = plant.bessType || 'none';
            document.getElementById('plant-bess-connection').value = hasBess ? bessConn : 'none';
            document.getElementById('plant-bess-mw').value = hasBess ? (plant.bessMw || 0) : 0;
            document.getElementById('plant-bess-mwh').value = hasBess ? (plant.bessMwh || 0) : 0;
            document.getElementById('plant-bess-efficiency').value = hasBess ? Math.round(plant.bessEfficiency * 100) : 0;
            document.getElementById('plant-bess-dod').value = hasBess ? (plant.bessDoD || 0) : 0;
            document.getElementById('plant-bess-soc-min').value = hasBess ? (plant.bessSocMin || 0) : 0;
            document.getElementById('plant-bess-soc-max').value = hasBess ? (plant.bessSocMax || 0) : 0;
            document.getElementById('plant-bess-degradation').value = hasBess ? (plant.bessDegradation * 100).toFixed(1) : 0;
            document.getElementById('plant-bess-capex-kwh').value = hasBess ? (plant.bessCapexKwh || 0) : 0;
            document.getElementById('plant-bess-temp-min').value = hasBess ? (plant.bessTempMin || 0) : 0;
            document.getElementById('plant-bess-temp-max').value = hasBess ? (plant.bessTempMax || 0) : 0;
            document.getElementById('plant-bess-cycles').value = hasBess ? (plant.bessCycles || 0) : 0;
            document.getElementById('plant-bess-warranty-years').value = hasBess ? (plant.bessWarrantyYears || 0) : 0;

            // PVGIS read-only display fields
            const setRo = (id, val) => { const el = document.getElementById(id); if (el) el.value = (val !== undefined && val !== null && val !== '') ? val : '-'; };
            setRo('pvgis-latitude', plant.pvgisLatitude);
            setRo('pvgis-longitude', plant.pvgisLongitude);
            setRo('pvgis-slope', plant.pvgisSlope);
            setRo('pvgis-azimuth', plant.pvgisAzimuth);
            setRo('pvgis-elevation', plant.pvgisElevation);
            setRo('pvgis-system-losses', plant.pvgisSystemLosses);
            setRo('pvgis-tracking', plant.pvgisTracking);
            setRo('pvgis-database', plant.pvgisDatabase);

            // Populate KPI calculated fields
            const setKpi = (id, val, decimals=1) => {
                const el = document.getElementById(id);
                if (el) el.value = (val != null && val > 0) ? Number(val).toFixed(decimals) : '-';
            };
            setKpi('plant-kpi-yield', plant.pvgisYield, 1);
            setKpi('plant-kpi-production', plant.pvgisAnnualProduction, 1);
            // Recalc LCOE using stored generation data
            if (plant.pvgisAnnualProduction != null) {
                recalcPlantKpis(plant.pvgisAnnualProduction * 1000, plant.capacity);
            }

            validateGridConnectionPower();
            
            const fileInput = document.getElementById('pvgis-file');
            if (fileInput) {
                fileInput.disabled = true;
                fileInput.classList.add('opacity-40', 'cursor-not-allowed');
            }
            
            const actionsContainer = document.getElementById('plant-form-actions');
            if (actionsContainer) {
                actionsContainer.innerHTML = `
                    <button id="btn-add-plant" onclick="submitPlantForm()" disabled class="w-full py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-xs cursor-not-allowed transition-colors flex items-center justify-center">
                        <i class="fa-solid fa-floppy-disk mr-1.5"></i> Salva Modifiche
                    </button>
                    <button onclick="window.exitEditMode()" class="w-full py-2 bg-slate-750 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs transition-colors flex items-center justify-center mt-2">
                        Annulla Modifiche
                    </button>
                `;
            }
            
            // Re-render list to show active edit background highlight
            renderPlantsList();
            
            updateFormSubmitButtonState();
        };

        window.exitEditMode = function() {
            editingPlantId = null;
            originalPlantData = null;
            
            const titleEl = document.getElementById('plant-form-title');
            if (titleEl) titleEl.textContent = "Aggiungi Impianto";
            
            document.getElementById('plant-name').value = "";
            document.getElementById('plant-capacity').value = "";
            document.getElementById('plant-zone').value = "none";
            document.getElementById('plant-capex').value = 0;
            document.getElementById('plant-opex').value = 0;
            document.getElementById('plant-opex-om-bess').value = 0;
            document.getElementById('plant-opex-insurance').value = 0;
            document.getElementById('plant-opex-taxes').value = 0;
            document.getElementById('plant-opex-security').value = 0;
            document.getElementById('plant-opex-asset-management').value = 0;
            document.getElementById('plant-connection-cost').value = 0;
            document.getElementById('plant-development-cost').value = 0;
            document.getElementById('plant-land-type').value = "none";
            document.getElementById('plant-land-cost').value = 0;
            document.getElementById('plant-spv-acquisition-cost').value = 0;
            document.getElementById('plant-grid-connection-kw').value = 0;
            document.getElementById('plant-grid-voltage').value = 'none';

            // Trader & network parameters reset
            document.getElementById('plant-trader-contract-type').value = 'pun_orario';
            document.getElementById('plant-trader-spread-eur-mwh').value = 0;
            document.getElementById('plant-trader-disp-eur-mwh').value = 0;
            document.getElementById('plant-pnrr-contribution-pct').value = 0;
            document.getElementById('plant-degrade-rid').value = 2.0;
            document.getElementById('plant-degrade-timeshifting').value = 2.0;
            document.getElementById('plant-degrade-arbitrage').value = 2.0;

            // Earn-out and service contract fields
            document.getElementById('plant-earnout-type').value = 'none';
            document.getElementById('plant-earnout-val').value = 0;
            document.getElementById('plant-earnout-years').value = 0;
            document.getElementById('plant-service-type').value = 'none';
            document.getElementById('plant-service-val').value = 0;
            document.getElementById('plant-service-years').value = 0;

            document.getElementById('plant-inverter-brand').value = '';
            document.getElementById('plant-inverter-model').value = '';
            document.getElementById('plant-inverter-power-kw').value = 0;
            document.getElementById('plant-inverter-efficiency').value = 0;
            document.getElementById('plant-inverter-mppt-count').value = 0;
            document.getElementById('plant-inverter-max-dc-v').value = 0;
            document.getElementById('plant-bess-type').value = 'none';
            document.getElementById('plant-bess-connection').value = 'none';
            document.getElementById('plant-bess-mw').value = 0;
            document.getElementById('plant-bess-mwh').value = 0;
            document.getElementById('plant-bess-efficiency').value = 0;
            document.getElementById('plant-bess-dod').value = 0;
            document.getElementById('plant-bess-soc-min').value = 0;
            document.getElementById('plant-bess-soc-max').value = 0;
            document.getElementById('plant-bess-degradation').value = 0;
            document.getElementById('plant-bess-capex-kwh').value = 0;
            document.getElementById('plant-bess-temp-min').value = 0;
            document.getElementById('plant-bess-temp-max').value = 0;
            document.getElementById('plant-bess-cycles').value = 0;
            document.getElementById('plant-bess-warranty-years').value = 0;
            // Reset PVGIS read-only display fields
            ['pvgis-latitude','pvgis-longitude','pvgis-slope','pvgis-azimuth',
             'pvgis-elevation','pvgis-system-losses','pvgis-tracking','pvgis-database'
            ].forEach(id => { const el = document.getElementById(id); if (el) el.value = '\u2014'; });
            // Reset KPI calculated fields
            ['plant-kpi-yield','plant-kpi-production','plant-kpi-lcoe']
                .forEach(id => { const el = document.getElementById(id); if (el) el.value = '\u2014'; });
            // Clear persisted KPI state so LCOE does not carry over to next plant
            window._lastKpiState = null;
            // Reset inverter section visibility
            const invBanner = document.getElementById('inverter-dc-banner');
            const invFields = document.getElementById('inverter-fields');
            if (invBanner) invBanner.classList.add('hidden');
            if (invFields) invFields.classList.remove('hidden');
            const gridWarn = document.getElementById('grid-power-warning');
            if (gridWarn) gridWarn.classList.add('hidden');
            
            const fileInput = document.getElementById('pvgis-file');
            if (fileInput) {
                fileInput.value = "";
                fileInput.disabled = false;
                fileInput.classList.remove('opacity-40', 'cursor-not-allowed');
            }
            
            const actionsContainer = document.getElementById('plant-form-actions');
            if (actionsContainer) {
                actionsContainer.innerHTML = `
                    <button id="btn-add-plant" onclick="submitPlantForm()" disabled class="w-full py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-xs cursor-not-allowed transition-colors flex items-center justify-center">
                        <i class="fa-solid fa-plus mr-1.5"></i> Aggiungi Impianto
                    </button>
                `;
            }
            
            renderPlantsList();
            updateFormSubmitButtonState();
        };

        async function savePlantEdits() {
            if (!editingPlantId) return;
            
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile salvare le modifiche.");
                return;
            }
            
            const plantIdx = State.plants.findIndex(p => p.id === editingPlantId);
            if (plantIdx < 0) {
                alert("Impianto non trovato.");
                return;
            }
            const plant = State.plants[plantIdx];
            
            // Validate mandatory dropdowns
            const editZone = document.getElementById('plant-zone').value;
            const editLandType = document.getElementById('plant-land-type').value;
            if (editZone === 'none') {
                alert("Seleziona una Zona Geografica valida prima di salvare.");
                return;
            }
            if (editLandType === 'none') {
                alert("Seleziona una Tipologia Terreno valida prima di salvare.");
                return;
            }
            
            // Clone plant to avoid modifying in-place before successful DB write
            const updatedPlant = {
                ...plant,
                name: document.getElementById('plant-name').value,
                zone: editZone,
                capex: parseFloat(document.getElementById('plant-capex').value) || 0,
                opex: parseFloat(document.getElementById('plant-opex').value) || 0,
                opexOmBess: parseFloat(document.getElementById('plant-opex-om-bess').value) || 0,
                opexInsurance: parseFloat(document.getElementById('plant-opex-insurance').value) || 0,
                opexTaxes: parseFloat(document.getElementById('plant-opex-taxes').value) || 0,
                opexSecurity: parseFloat(document.getElementById('plant-opex-security').value) || 0,
                opexAssetManagement: parseFloat(document.getElementById('plant-opex-asset-management').value) || 0,
                connectionCost: parseFloat(document.getElementById('plant-connection-cost').value) || 0,
                developmentCost: parseFloat(document.getElementById('plant-development-cost').value) || 0,
                landType: editLandType,
                landCost: parseFloat(document.getElementById('plant-land-cost').value) || 0,
                spvAcquisitionCost: parseFloat(document.getElementById('plant-spv-acquisition-cost').value) || 0,
                
                // Grid connection
                gridConnectionKw: parseFloat(document.getElementById('plant-grid-connection-kw').value) || 0,
                gridVoltage: document.getElementById('plant-grid-voltage').value,

                // Inverter
                inverterBrand: document.getElementById('plant-inverter-brand').value,
                inverterModel: document.getElementById('plant-inverter-model').value,
                inverterPowerKw: (document.getElementById('plant-bess-connection').value === 'dc') ? 0 : (parseFloat(document.getElementById('plant-inverter-power-kw').value) || 0),
                inverterEfficiency: parseFloat(document.getElementById('plant-inverter-efficiency').value) || 0,
                inverterMpptCount: parseFloat(document.getElementById('plant-inverter-mppt-count').value) || 0,
                inverterMaxDcV: parseFloat(document.getElementById('plant-inverter-max-dc-v').value) || 0,

                // BESS
                bessType: document.getElementById('plant-bess-type').value,
                bessMw: parseFloat(document.getElementById('plant-bess-mw').value) || 0,
                bessMwh: parseFloat(document.getElementById('plant-bess-mwh').value) || 0,
                bessConnection: document.getElementById('plant-bess-connection').value,

                // Earn-out and service contract fields
                earnoutType: document.getElementById('plant-earnout-type').value,
                earnoutVal: parseFloat(document.getElementById('plant-earnout-val').value) || 0,
                earnoutYears: parseInt(document.getElementById('plant-earnout-years').value) || 0,
                serviceType: document.getElementById('plant-service-type').value,
                serviceVal: parseFloat(document.getElementById('plant-service-val').value) || 0,
                serviceYears: parseInt(document.getElementById('plant-service-years').value) || 0,

                // Trader & network parameters
                marketType: document.getElementById('plant-market-type').value,
                ferxTariff: parseFloat(document.getElementById('plant-ferx-tariff').value) || 0,
                traderContractType: document.getElementById('plant-trader-contract-type').value,
                traderSpread: parseFloat(document.getElementById('plant-trader-spread-eur-mwh').value) || 0,
                traderDisp: parseFloat(document.getElementById('plant-trader-disp-eur-mwh').value) || 0,
                pnrrContributionPct: parseFloat(document.getElementById('plant-pnrr-contribution-pct').value) || 0,
                degradeRidPct: parseFloat(document.getElementById('plant-degrade-rid').value) || 0,
                degradeTimeshiftingPct: parseFloat(document.getElementById('plant-degrade-timeshifting').value) || 0,
                degradeArbitragePct: parseFloat(document.getElementById('plant-degrade-arbitrage').value) || 0
            };
            
            const saveHasBess = updatedPlant.bessType !== 'none' && updatedPlant.bessMwh > 0;
            updatedPlant.bessEfficiency = saveHasBess ? ((parseFloat(document.getElementById('plant-bess-efficiency').value) || 0) / 100) : 0;
            updatedPlant.bessDoD = saveHasBess ? (parseFloat(document.getElementById('plant-bess-dod').value) || 0) : 0;
            updatedPlant.bessSocMin = saveHasBess ? (parseFloat(document.getElementById('plant-bess-soc-min').value) || 0) : 0;
            updatedPlant.bessSocMax = saveHasBess ? (parseFloat(document.getElementById('plant-bess-soc-max').value) || 0) : 0;
            updatedPlant.bessDegradation = saveHasBess ? ((parseFloat(document.getElementById('plant-bess-degradation').value) || 0) / 100) : 0;
            updatedPlant.bessCapexKwh = saveHasBess ? (parseFloat(document.getElementById('plant-bess-capex-kwh').value) || 0) : 0;
            updatedPlant.bessTempMin = saveHasBess ? (parseFloat(document.getElementById('plant-bess-temp-min').value) || 0) : 0;
            updatedPlant.bessTempMax = saveHasBess ? (parseFloat(document.getElementById('plant-bess-temp-max').value) || 0) : 0;
            updatedPlant.bessCycles = saveHasBess ? (parseFloat(document.getElementById('plant-bess-cycles').value) || 0) : 0;
            updatedPlant.bessWarrantyYears = saveHasBess ? (parseFloat(document.getElementById('plant-bess-warranty-years').value) || 0) : 0;
            
            const success = await savePlantToSupabase(updatedPlant);
            if (success) {
                State.plants[plantIdx] = updatedPlant;
                renderPlantsList();
                triggerRecalculate();
                exitEditMode();
                Audit.log('plant.edit', updatedPlant.name);
            }
        }

        let simWorker = null;
        
        function initWorker() {
            if (!simWorker) {
                simWorker = new Worker('./src/worker/simulation.worker.js?v=3');
                simWorker.onmessage = function(e) {
                    const data = e.data;
                    try {
                        if (data.status === 'success') {
                            State.results = data.results;
                            renderUI();
                        } else if (data.status === 'sensitivity_success') {
                            renderSensitivityResults(data.results);
                            return;
                        } else if (data.status === 'sensitivity_error') {
                            console.error("Worker error during sensitivity:", data.error);
                            document.getElementById('sens-status').textContent = "Errore: " + data.error;
                            return;
                        } else if (data.status === 'tornado_success') {
                            State.lastTornado = data.results;
                            if (tornadoResolver) {
                                tornadoResolver.resolve(data.results);
                                tornadoResolver = null;
                            } else {
                                renderTornadoResults(data.results);
                            }
                            return;
                        } else if (data.status === 'tornado_error') {
                            console.error("Worker error during tornado:", data.error);
                            if (tornadoResolver) {
                                tornadoResolver.reject(new Error(data.error || 'tornado fallito'));
                                tornadoResolver = null;
                            } else {
                                const stT = document.getElementById('tornado-status');
                                if (stT) stT.textContent = 'Errore: ' + data.error;
                                const btnT = document.getElementById('btn-run-tornado');
                                if (btnT) { btnT.disabled = false; btnT.innerHTML = '<i class="fa-solid fa-wind"></i><span>Tornado (6 variabili)</span>'; }
                            }
                            return;
                        } else if (data.status === 'compare_success') {
                            renderScenarioCompareResults(data.results);
                            return;
                        } else if (data.status === 'compare_error') {
                            console.error("Worker error during scenario compare:", data.error);
                            const cmpEl = document.getElementById('scenario-compare-results');
                            if (cmpEl) {
                                cmpEl.classList.remove('hidden');
                                cmpEl.innerHTML = '<div class="text-rose-400 text-xs p-3">Errore confronto scenari: ' + escapeHtml(data.error || 'sconosciuto') + '</div>';
                            }
                            return;
                        } else if (data.status === 'montecarlo_success') {
                            renderMonteCarloResults(data.results);
                            return;
                        } else if (data.status === 'montecarlo_error') {
                            console.error("Worker error during Monte Carlo:", data.error);
                            const mcStatusErr = document.getElementById('mc-status');
                            if (mcStatusErr) mcStatusErr.textContent = "Errore: " + data.error;
                            const btnMcErr = document.getElementById('btn-run-montecarlo');
                            if (btnMcErr) { btnMcErr.disabled = false; btnMcErr.innerHTML = '<i class="fa-solid fa-dice"></i><span>Esegui Monte Carlo</span>'; }
                            return;
                        } else {
                            console.error("Worker error:", data.error, data.stack);
                            const syncErrEl = document.getElementById('sync-status');
                            if (syncErrEl) {
                                syncErrEl.textContent = "Errore calcolo: " + (data.error || "sconosciuto");
                                syncErrEl.className = "text-xs text-red-400 font-bold";
                            }
                        }
                    } catch (err) {
                        console.error("Errore irreversibile nell'interfaccia durante renderUI:", err);
                    } finally {
                        State.isUpdatePending = false;
                        showCalcIndicator(false);
                        saveConfigDebounced();
                        
                        if (State.recalcNeeded) {
                            State.recalcNeeded = false;
                            triggerRecalculate();
                        }
                    }
                };
            }
        }

        function triggerRecalculate() {
            if (State.isUpdatePending) {
                State.recalcNeeded = true;
                return;
            }
            State.isUpdatePending = true;
            State.recalcNeeded = false;
            showCalcIndicator(true);
            
            setTimeout(() => {
                try {
                    syncStateFromDOM();
                    initWorker();
                    // Send message to worker
                    simWorker.postMessage({
                        action: 'EXECUTE_CALCULATION',
                        payload: {
                            State: {
                                inputs: State.inputs,
                                plants: State.plants,
                                stabilimenti: State.stabilimenti,
                                zonalPun: State.zonalPun,
                                selectedBessPlantIds: State.selectedBessPlantIds,
                                previouslySeenPlantIds: State.previouslySeenPlantIds
                            }
                        }
                    });
                } catch (err) {
                    console.error("Errore durante l'invio al worker:", err);
                    State.isUpdatePending = false;
                    showCalcIndicator(false);
                }
            }, 50);
        }

        // ═══════════════════════════════════════════════════════════════════
        //  STABILIMENTI & PPA - Core Functions
        // ═══════════════════════════════════════════════════════════════════

        // Italian public holidays 2025 (day index 0-based from Jan 1)
        // Jan1=0, Jan6=5, EasterMon Apr21=110, Apr25=114, May1=120,
        // Jun2=152, Aug15=226, Nov1=304, Dec8=341, Dec25=358, Dec26=359
        const IT_HOLIDAYS_2025 = new Set([0, 5, 109, 110, 114, 120, 152, 226, 304, 341, 358, 359]);
        
        function generateLoadCurve(annualMwh, worksSat, worksSun, worksHol, shiftType, plantId) {
            if (shiftType === 'public_lighting') {
                const plant = State.plants.find(p => p.id === plantId);
                const lat = plant ? plant.pvgisLatitude : null;
                const lng = plant ? plant.pvgisLongitude : null;
                return calculateTwilightCurve(annualMwh, lat, lng);
            }

            if (shiftType === 'domestic') {
                return generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol);
            }

            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (3 + dayIdx) % 7; // 0=Sun,6=Sat
                const isHoliday = IT_HOLIDAYS_2025.has(dayIdx);
                const isSunday  = dow === 0;
                const isSaturday= dow === 6;
                let isWorkDay = true;
                if (isHoliday && !worksHol) isWorkDay = false;
                else if (isSunday && !worksSun) isWorkDay = false;
                else if (isSaturday && !worksSat) isWorkDay = false;

                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    let f = 0;
                    if (shiftType === 'three_shifts') {
                        f = isWorkDay ? 0.85 : 0.40;
                    } else if (!isWorkDay) {
                        f = 0.05;
                    } else if (shiftType === 'two_shifts') {
                        if      (h === 5)               f = 0.30;
                        else if (h === 6)               f = 0.65;
                        else if (h === 7)               f = 0.90;
                        else if (h >= 8  && h <= 11)    f = 1.00;
                        else if (h === 12)              f = 0.72; // pausa pranzo
                        else if (h === 13)              f = 0.78;
                        else if (h >= 14 && h <= 18)    f = 1.00;
                        else if (h === 19)              f = 0.88;
                        else if (h === 20)              f = 0.68;
                        else if (h === 21)              f = 0.45;
                        else                            f = 0.10;
                    } else { // office 8-18
                        if      (h === 7)               f = 0.40;
                        else if (h === 8)               f = 0.75;
                        else if (h === 9)               f = 0.95;
                        else if (h >= 10 && h <= 11)    f = 1.00;
                        else if (h === 12)              f = 0.55;
                        else if (h === 13)              f = 0.65;
                        else if (h >= 14 && h <= 16)    f = 0.95;
                        else if (h === 17)              f = 0.70;
                        else if (h === 18)              f = 0.30;
                        else                            f = 0.05;
                    }
                    rawLoad[t] = f;
                }
            }
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }

        function generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol) {
            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (3 + dayIdx) % 7;
                const isHoliday = IT_HOLIDAYS_2025.has(dayIdx);
                const isSunday  = dow === 0;
                const isSaturday= dow === 6;
                let isWorkDay = true;
                if (isHoliday && !worksHol) isWorkDay = false;
                else if (isSunday && !worksSun) isWorkDay = false;
                else if (isSaturday && !worksSat) isWorkDay = false;

                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    let f = 0;
                    if (isWorkDay) {
                        if (h < 6)                      f = 0.15;
                        else if (h === 6)               f = 0.35;
                        else if (h === 7)               f = 0.70;
                        else if (h === 8)               f = 0.80;
                        else if (h === 9)               f = 0.50;
                        else if (h >= 10 && h <= 12)    f = 0.30;
                        else if (h === 13)              f = 0.40;
                        else if (h === 14)              f = 0.35;
                        else if (h >= 15 && h <= 17)    f = 0.30;
                        else if (h === 18)              f = 0.60;
                        else if (h === 19)              f = 0.85;
                        else if (h === 20)              f = 1.00;
                        else if (h === 21)              f = 0.95;
                        else if (h === 22)              f = 0.60;
                        else                            f = 0.30;
                    } else {
                        if (h < 6)                      f = 0.15;
                        else if (h === 6)               f = 0.25;
                        else if (h === 7)               f = 0.45;
                        else if (h === 8)               f = 0.70;
                        else if (h === 9)               f = 0.80;
                        else if (h >= 10 && h <= 12)    f = 0.65;
                        else if (h === 13)              f = 0.85;
                        else if (h === 14)              f = 0.75;
                        else if (h >= 15 && h <= 17)    f = 0.65;
                        else if (h === 18)              f = 0.70;
                        else if (h === 19)              f = 0.90;
                        else if (h === 20)              f = 1.00;
                        else if (h === 21)              f = 0.95;
                        else if (h === 22)              f = 0.70;
                        else                            f = 0.40;
                    }
                    rawLoad[t] = f;
                }
            }
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }

        function calculateTwilightCurve(annualMwh, lat, lng) {
            const rawLoad = new Float64Array(8760);
            const latitude = (lat !== null && lat !== undefined) ? lat : 43.591;
            const longitude = (lng !== null && lng !== undefined) ? lng : 10.394;
            const latRad = latitude * Math.PI / 180;
            
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const d = dayIdx + 1;
                const decl = 0.40928 * Math.sin(2 * Math.PI * (d - 80) / 365);
                const cosH = (-0.104528 - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
                
                let H;
                if (cosH >= 1) {
                    H = 0;
                } else if (cosH <= -1) {
                    H = Math.PI;
                } else {
                    H = Math.acos(cosH);
                }
                
                const H_hours = H * 12 / Math.PI;
                const b = 2 * Math.PI * (d - 81) / 364;
                const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
                const eotHours = eot / 60;
                
                const isDST = (d >= 89 && d < 299);
                const tzOffset = isDST ? 2 : 1;
                
                const solarNoon = 12 - (longitude - 15 * tzOffset) / 15 - eotHours;
                const sunrise = solarNoon - H_hours;
                const sunset = solarNoon + H_hours;
                
                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    if (h < sunrise || h >= sunset) {
                        rawLoad[t] = 1.0;
                    } else {
                        rawLoad[t] = 0.0;
                    }
                }
            }
            
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }
        // Jan 1 2025 = Wednesday -> getDay() = 3
        // dayOfWeek = (3 + dayIdx) % 7, where 0=Sun,1=Mon,...,6=Sat

        let stabPreviewChartInstance = null;
        let stabPreviewDebounceTimer = null;
        let stabLoadedCurve = null; // Float64Array from CSV

        function onStabPlantChange() {
            scheduleLoadPreview();
        }




        function scheduleLoadPreview() {
            clearTimeout(stabPreviewDebounceTimer);
            stabPreviewDebounceTimer = setTimeout(updateLoadPreviewChart, 300);
        }

        function updateLoadPreviewChart() {
            const annualMwh  = parseFloat(document.getElementById('stab-annual-consumption').value) || 0;
            const worksSat   = document.getElementById('stab-works-saturday').checked;
            const worksSun   = document.getElementById('stab-works-sunday').checked;
            const worksHol   = document.getElementById('stab-works-holidays').checked;
            const shiftType  = document.getElementById('stab-shift-type').value;
            const plantId    = document.getElementById('stab-plant-id').value;

            // Handle warning visibility
            const lightingWarn = document.getElementById('stab-lighting-warning');
            const coordsWarn   = document.getElementById('stab-coords-warning');
            if (lightingWarn) lightingWarn.classList.add('hidden');
            if (coordsWarn) coordsWarn.classList.add('hidden');

            if (shiftType === 'public_lighting') {
                if (!plantId) {
                    if (lightingWarn) lightingWarn.classList.remove('hidden');
                    document.getElementById('stab-preview-peak').textContent = 'Picco: - kW';
                    const hb = document.getElementById('stab-hours-badge');
                    const eb = document.getElementById('stab-total-energy-badge');
                    if (hb) hb.classList.add('hidden');
                    if (eb) eb.classList.add('hidden');
                    if (stabPreviewChartInstance) {
                        stabPreviewChartInstance.destroy();
                        stabPreviewChartInstance = null;
                    }
                    return;
                } else {
                    const plant = State.plants.find(p => p.id === plantId);
                    if (plant && (plant.pvgisLatitude === null || plant.pvgisLatitude === undefined)) {
                        if (coordsWarn) coordsWarn.classList.remove('hidden');
                    }
                }
            }

            if (annualMwh <= 0) return;

            const load = generateLoadCurve(annualMwh, worksSat, worksSun, worksHol, shiftType, plantId);
            stabLoadedCurve = load;

            // Show week 1 (Jan 6 Mon -> Jan 12 Sun) = hours 120..287
            // Actually show a typical week starting Mon Jan 6 (dayIdx=5): hours 120-287
            const weekStart = 5 * 24; // dayIdx=5 = Jan 6 (Mon)
            const labels = [];
            const data   = [];
            for (let i = 0; i < 168; i++) {
                const h = weekStart + i;
                const day = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'][Math.floor(i / 24)];
                labels.push(i % 24 === 12 ? day : (i % 6 === 0 ? (i % 24) + 'h' : ''));
                data.push(Math.round(load[h]));
            }

            const peak = Math.max(...data);
            const totalKwh = load.reduce((a, b) => a + b, 0);
            const totalMwh = totalKwh / 1000;

            document.getElementById('stab-preview-peak').textContent = 'Picco: ' + peak.toLocaleString('it-IT') + ' kW';

            // Show the 8760-hours confirmation badge
            const hoursBadge = document.getElementById('stab-hours-badge');
            const energyBadge = document.getElementById('stab-total-energy-badge');
            if (hoursBadge) hoursBadge.classList.remove('hidden');
            if (energyBadge) {
                energyBadge.textContent = totalMwh.toFixed(0) + ' MWh/a';
                energyBadge.classList.remove('hidden');
            }

            // Safe destroy: use Chart.getChart() to avoid 'canvas already in use' errors
            // that occur when the instance reference (stabPreviewChartInstance) is null
            // but Chart.js still has the canvas registered internally.
            const canvas = document.getElementById('stab-preview-chart');
            if (typeof Chart !== 'undefined' && Chart.getChart) {
                const existing = Chart.getChart(canvas);
                if (existing) existing.destroy();
            } else if (stabPreviewChartInstance) {
                stabPreviewChartInstance.destroy();
            }

            // With responsive:false, Chart.js uses canvas pixel dimensions.
            // Set them explicitly so the chart fills the wrapper div correctly.
            const wrapper = canvas.parentElement;
            canvas.width  = wrapper ? wrapper.clientWidth  : 400;
            canvas.height = 90;

            stabPreviewChartInstance = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        data,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245,158,11,0.10)',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: false,
                    animation: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: { label: c => c.parsed.y.toLocaleString('it-IT') + ' kW' }
                        }
                    },
                    scales: {
                        x: { ticks: { color: '#475569', font: { size: 9 }, maxTicksLimit: 14 }, grid: { color: '#1e293b' } },
                        y: { ticks: { color: '#475569', font: { size: 9 }, callback: v => v + ' kW' }, grid: { color: '#1e293b' } }
                    }
                }
            });
        }

        function toggleLoadSource() {
            const isGenerated = document.getElementById('stab-load-generated').checked;
            document.getElementById('stab-generator-form').classList.toggle('hidden', !isGenerated);
            document.getElementById('stab-csv-form').classList.toggle('hidden', isGenerated);
        }

        function onStabCsvSelected() {
            const fileInput = document.getElementById('stab-csv-file');
            const statusEl  = document.getElementById('stab-csv-status');
            if (!fileInput.files[0]) return;
            statusEl.classList.remove('hidden');
            statusEl.textContent = 'Parsing CSV...';
            statusEl.className = 'text-xs text-amber-400';
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = parseStabilimentoCsv(e.target.result);
                    stabLoadedCurve = parsed;
                    const total = parsed.reduce((a, b) => a + b, 0) / 1000;
                    statusEl.textContent = '\u2713 CSV caricato: ' + parsed.length + ' ore, consumo totale ' + total.toFixed(1) + ' MWh/a';
                    statusEl.className = 'text-xs text-emerald-400';
                } catch (err) {
                    statusEl.textContent = '\u2717 Errore: ' + err.message;
                    statusEl.className = 'text-xs text-rose-400';
                    stabLoadedCurve = null;
                }
            };
            reader.readAsText(fileInput.files[0]);
        }

        function parseStabilimentoCsv(text) {
            const lines = text.trim().split('\n').filter(l => l.trim());
            // Skip header line if present (starts with non-numeric)
            const start = isNaN(parseFloat(lines[0]?.split(',')[0])) ? 1 : 0;
            const data = lines.slice(start);
            if (data.length !== 8760) throw new Error('Il CSV deve contenere esattamente 8760 righe (trovate ' + data.length + ')');
            const load = new Float64Array(8760);
            for (let i = 0; i < 8760; i++) {
                const parts = data[i].split(',');
                const val = parts.length >= 2 ? parseFloat(parts[1]) : parseFloat(parts[0]);
                if (isNaN(val) || val < 0) throw new Error('Valore non valido alla riga ' + (i + start + 1));
                load[i] = val;
            }
            return load;
        }

        function downloadLoadCsvTemplate() {
            let csv = 'hour_index,load_kw\n';
            for (let i = 0; i < 8760; i++) csv += i + ',0\n';
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            const tplUrl = URL.createObjectURL(blob);
            a.href = tplUrl;
            a.download = 'modello_curva_prelievo_8760h.csv';
            a.click();
            URL.revokeObjectURL(tplUrl);
        }

        function populatePlantSelectForStabilimento(currentStabId) {
            const sel = document.getElementById('stab-plant-id');
            const assignedPlants = new Set(
                State.stabilimenti
                    .filter(s => s.id !== currentStabId)
                    .map(s => s.plantId)
            );
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">- Seleziona impianto -</option>';
            State.plants.forEach(p => {
                const alreadyAssigned = assignedPlants.has(p.id);
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = (alreadyAssigned ? '\uD83D\uDD12 ' : '') + p.name + ' (' + ((p.capacity || 0) / 1000).toFixed(2) + ' MWp)';
                opt.disabled = alreadyAssigned;
                if (p.id === currentVal) opt.selected = true;
                sel.appendChild(opt);
            });
        }

        function renderStabilimentiList() {
            const container = document.getElementById('stabilimenti-list-container');
            const emptyState = document.getElementById('stab-empty-state');
            const badge = document.getElementById('stab-count-badge');

            const activeStabCount = State.stabilimenti.filter(s => s.enabled !== false).length;
            const totalStabCount = State.stabilimenti.length;
            const excludedStabs = totalStabCount - activeStabCount;
            badge.textContent = activeStabCount + ' profil' + (activeStabCount === 1 ? 'o' : 'i') +
                (excludedStabs > 0 ? ` (${excludedStabs} esclusi)` : '');

            if (State.stabilimenti.length === 0) {
                container.innerHTML = '';
                container.appendChild(emptyState);
                document.getElementById('stab-kpi-consumption').textContent = '\u2014 MWh';
                document.getElementById('stab-kpi-selfcons').textContent = '\u2014 MWh';
                document.getElementById('stab-kpi-coverage').textContent = '\u2014 %';
                document.getElementById('stab-kpi-ppa-revenue').textContent = '\u2014 \u20ac';
                return;
            }

            let totalConsumption = 0, totalSelfCons = 0, totalPpaRevenue = 0;

            let html = '';
            State.stabilimenti.forEach(s => {
                const plant = State.plants.find(p => p.id === s.plantId);
                const plantName = plant ? plant.name : 'N/D';

                // Annual load: sum the full 8760-hour curve (kWh -> MWh)
                const annLoad = s.load
                    ? (s.load.reduce((a, b) => a + b, 0) / 1000)
                    : (s.annualConsumption || 0);
                totalConsumption += annLoad;

                // Self-consumption and PPA revenue live in the worker's results (State.results.plantsMetrics)
                let selfCons = 0;
                let ppaRev = 0;
                if (State.results && State.results.plantsMetrics) {
                    const pm = State.results.plantsMetrics.find(pm => pm.id === s.plantId);
                    if (pm) {
                        selfCons = pm.selfConsumptionMwh;
                        ppaRev = pm.ppaRevenue_y1;
                    }
                }
                
                totalSelfCons    += selfCons;
                totalPpaRevenue  += ppaRev;

                const coverage = annLoad > 0 ? (selfCons / annLoad * 100) : 0;
                const calcDone = (State.results && State.results.plantsMetrics && State.results.plantsMetrics.some(pm => pm.id === s.plantId));

                let typeColor = 'text-sky-400 bg-sky-500/10 border-sky-500/20';
                let typeLabel = 'OFF-SITE';
                if (s.ppaType === 'on-site') {
                    typeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
                    typeLabel = 'ON-SITE';
                } else if (s.ppaType === 'cer') {
                    typeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
                    typeLabel = 'CER';
                }

                // Coverage bar (visual)
                const barPct = Math.min(100, coverage).toFixed(0);
                const barColor = coverage >= 60 ? '#10b981' : coverage >= 30 ? '#f59e0b' : '#6366f1';

                const stabEnabled = s.enabled !== false;
                const stabOpacity = stabEnabled ? '' : 'opacity-40';

                // Stab toggle
                const stabToggleTrack = stabEnabled ? 'background:#10b981;' : 'background:#1e293b;';
                const stabToggleThumb = stabEnabled ? 'transform:translateX(14px);' : 'transform:translateX(2px);';

                html += `
                <div class="px-4 py-3 hover:bg-slate-800/30 transition-colors cursor-pointer group ${stabOpacity}" onclick="selectStabilimentoForEdit('${s.id}')">
                    <div class="flex items-start justify-between">
                        <div class="flex items-center mr-3 mt-0.5 shrink-0" onclick="event.stopPropagation()">
                            <button
                                onclick="window.toggleStabEnabled('${s.id}')"
                                title="${stabEnabled ? 'Escludi dalla simulazione' : 'Includi nella simulazione'}"
                                style="display:inline-flex;align-items:center;width:34px;height:20px;border-radius:10px;border:none;cursor:pointer;padding:0;transition:background 0.2s;${stabToggleTrack}"
                                aria-pressed="${stabEnabled}"
                            >
                                <span style="display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);transition:transform 0.2s;${stabToggleThumb}"></span>
                            </button>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center space-x-2 mb-1">
                                <span class="font-semibold text-slate-100 text-sm truncate">${escapeHtml(s.name)}</span>
                                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border ${typeColor}">${typeLabel}</span>
                                ${!stabEnabled ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-500 border border-slate-700">ESCLUSO</span>' : ''}
                            </div>
                            <div class="text-[10px] text-slate-500">
                                <i class="fa-solid fa-solar-panel mr-1"></i>${escapeHtml(plantName)} &nbsp;|&nbsp;
                                <i class="fa-solid fa-tag mr-1 text-sky-500"></i>\u20ac${(s.ppaPrice || 0).toFixed(1)}/MWh &nbsp;|&nbsp;
                                <i class="fa-solid fa-calendar mr-1 text-violet-400"></i>${s.ppaDuration || 0} anni
                            </div>
                            ${calcDone ? `
                            <div class="mt-1.5">
                                <div class="flex items-center justify-between text-[10px] mb-0.5">
                                    <span class="text-slate-500">Consumo: ${annLoad.toFixed(0)} MWh/a &nbsp;|&nbsp; PPA: ${selfCons.toFixed(0)} MWh &nbsp;|&nbsp; Prezzo: \u20ac${(ppaRev > 0 && selfCons > 0 ? (ppaRev/selfCons).toFixed(1) : (s.ppaPrice||0).toFixed(1))}/MWh</span>
                                    <span style="color:${barColor}" class="font-bold">${coverage.toFixed(0)}%</span>
                                </div>
                                <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                    <div class="h-1 rounded-full transition-all" style="width:${barPct}%; background-color:${barColor}"></div>
                                </div>
                            </div>` : (!stabEnabled ? `
                            <div class="mt-1 text-[10px] text-slate-500 italic">
                                Profilo escluso. Riattivalo per vedere le proiezioni.
                            </div>` : `
                            <div class="mt-1 text-[10px] text-amber-600 italic">
                                <i class="fa-solid fa-clock-rotate-left mr-1"></i>In attesa di ricalcolo o Impianto disattivato...
                            </div>`)}
                        </div>
                        <button onclick="event.stopPropagation(); deleteStabilimento('${s.id}')" class="opacity-0 group-hover:opacity-100 ml-2 p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-all text-xs">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>`;
            });

            container.innerHTML = html;

            // Update KPI summary panel
            const avgCoverage = totalConsumption > 0 ? (totalSelfCons / totalConsumption * 100) : 0;
            document.getElementById('stab-kpi-consumption').textContent = totalConsumption.toFixed(0) + ' MWh';
            document.getElementById('stab-kpi-selfcons').textContent =
                totalSelfCons > 0 ? totalSelfCons.toFixed(0) + ' MWh' : '\u2014 (ricalcolo in corso)';
            document.getElementById('stab-kpi-coverage').textContent =
                totalSelfCons > 0 ? avgCoverage.toFixed(1) + ' %' : '\u2014';
            document.getElementById('stab-kpi-ppa-revenue').textContent =
                totalPpaRevenue > 0 ? '\u20ac ' + (totalPpaRevenue / 1000).toFixed(0) + 'k' : '\u2014';

            // Dynamic CER KPI label update
            const _hasCer = State.stabilimenti.some(s => s.enabled !== false && s.ppaType === 'cer');
            const _allCer = State.stabilimenti.filter(s => s.enabled !== false).every(s => s.ppaType === 'cer');
            const selfconsLbl = document.getElementById('lbl-stab-kpi-selfcons');
            const ppRevLbl = document.getElementById('lbl-stab-kpi-ppa-revenue');
            if (selfconsLbl) selfconsLbl.textContent = _allCer ? 'Energia Condivisa CER' : _hasCer ? 'Energia Cond./Autocons.' : 'Autoconsumo PPA';
            if (ppRevLbl) ppRevLbl.textContent = _allCer ? 'Ricavo CER Anno 1' : _hasCer ? 'Ricavo CER+PPA Anno 1' : 'Ricavo PPA Anno 1';
        }

        // Toggle a stabilimento's enabled state and immediately recalculate
        window.toggleStabEnabled = function(stabId) {
            const stab = State.stabilimenti.find(s => s.id === stabId);
            if (!stab) return;
            stab.enabled = stab.enabled === false ? true : false;
            
            // Persist enabling flag to config so it saves to database
            const disabled = State.stabilimenti.filter(s => s.enabled === false).map(s => s.id);
            State.inputs.disabledStabilimenti = JSON.stringify(disabled);
            
            saveConfigDebounced();
            
            renderStabilimentiList();
            triggerRecalculate();
        };

        function selectStabilimentoForEdit(id) {
            const s = State.stabilimenti.find(x => x.id === id);
            if (!s) return;
            document.getElementById('stab-edit-id').value = id;
            document.getElementById('stab-name').value = s.name;
            document.getElementById('stab-ppa-type').value = s.ppaType || 'on-site';
            document.getElementById('stab-ppa-price').value    = s.ppaPrice    || '';
            document.getElementById('stab-ppa-duration').value  = s.ppaDuration || '';
            document.getElementById('stab-shift-type').value = s.shiftType || 'office';
            document.getElementById('stab-annual-consumption').value = s.annualConsumption || '';
            
            const cerContainer = document.getElementById('stab-cer-share-type-container');
            const priceLabel = document.getElementById('lbl-stab-ppa-price');
            if (s.ppaType === 'cer') {
                if (cerContainer) cerContainer.classList.remove('hidden');
                if (priceLabel) priceLabel.textContent = 'Prezzo CER (€/MWh)';
                document.getElementById('stab-cer-share-type').value = s.cerShareType || 'shared_energy';
            } else {
                if (cerContainer) cerContainer.classList.add('hidden');
                if (priceLabel) priceLabel.textContent = 'Prezzo PPA (€/MWh)';
            }
            document.getElementById('stab-works-saturday').checked = !!s.worksSaturday;
            document.getElementById('stab-works-sunday').checked   = !!s.worksSunday;
            document.getElementById('stab-works-holidays').checked = !!s.worksHolidays;
            // Sync visual state using the new helper
            setStabToggleVisual('stab-works-saturday', !!s.worksSaturday);
            setStabToggleVisual('stab-works-sunday',   !!s.worksSunday);
            setStabToggleVisual('stab-works-holidays', !!s.worksHolidays);

            populatePlantSelectForStabilimento(id);
            document.getElementById('stab-plant-id').value = s.plantId || '';
            if (s.loadSource === 'csv') {
                document.getElementById('stab-load-csv').checked = true;
            } else {
                document.getElementById('stab-load-generated').checked = true;
            }
            toggleLoadSource();

            // UI: switch to edit mode
            document.getElementById('stab-form-title').textContent = 'Modifica: ' + s.name;
            document.getElementById('stab-form-icon').className = 'fa-solid fa-pen text-xs';
            document.getElementById('stab-submit-label').textContent = 'Salva Modifiche';
            document.getElementById('stab-submit-icon').className = 'fa-solid fa-floppy-disk';
            document.getElementById('stab-cancel-btn').classList.remove('hidden');

            scheduleLoadPreview();
        }

        function resetStabilimentoForm() {
            document.getElementById('stab-edit-id').value = '';
            document.getElementById('stab-name').value = '';
            document.getElementById('stab-ppa-type').value = 'on-site';
            document.getElementById('stab-ppa-price').value    = '';
            document.getElementById('stab-ppa-duration').value  = '';
            document.getElementById('stab-annual-consumption').value = '';
            document.getElementById('stab-shift-type').value = 'office';
            
            const cerContainer = document.getElementById('stab-cer-share-type-container');
            if (cerContainer) cerContainer.classList.add('hidden');
            const priceLabel = document.getElementById('lbl-stab-ppa-price');
            if (priceLabel) priceLabel.textContent = 'Prezzo PPA (€/MWh)';
            document.getElementById('stab-cer-share-type').value = 'shared_energy';
            ['stab-works-saturday','stab-works-sunday','stab-works-holidays'].forEach(id2 => {
                document.getElementById(id2).checked = false;
                setStabToggleVisual(id2, false);
            });
            document.getElementById('stab-load-generated').checked = true;
            toggleLoadSource();
            stabLoadedCurve = null;
            // Reset the annual consumption to empty (user must explicitly fill it)
            document.getElementById('stab-annual-consumption').value = '';
            // Hide confirmation badges
            const hb = document.getElementById('stab-hours-badge');
            const eb = document.getElementById('stab-total-energy-badge');
            if (hb) hb.classList.add('hidden');
            if (eb) { eb.classList.add('hidden'); eb.textContent = ''; }
            // Clear preview chart
            if (stabPreviewChartInstance) { stabPreviewChartInstance.destroy(); stabPreviewChartInstance = null; }
            document.getElementById('stab-preview-peak').textContent = 'Picco: - kW';
            document.getElementById('stab-form-title').textContent = 'Aggiungi Profilo Consumo';
            document.getElementById('stab-form-icon').className = 'fa-solid fa-plus text-xs';
            document.getElementById('stab-submit-label').textContent = 'Aggiungi Profilo Consumo';
            document.getElementById('stab-submit-icon').className = 'fa-solid fa-plus';
            document.getElementById('stab-cancel-btn').classList.add('hidden');
            document.getElementById('stab-validation-msg').classList.add('hidden');
            
            const lightingWarn = document.getElementById('stab-lighting-warning');
            const coordsWarn   = document.getElementById('stab-coords-warning');
            if (lightingWarn) lightingWarn.classList.add('hidden');
            if (coordsWarn) coordsWarn.classList.add('hidden');

            populatePlantSelectForStabilimento(null);
        }


        async function submitStabilimentoForm() {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile salvare lo stabilimento.");
                return;
            }

            const editId    = document.getElementById('stab-edit-id').value;
            const name      = document.getElementById('stab-name').value.trim();
            const plantId   = document.getElementById('stab-plant-id').value;
            const ppaType   = document.getElementById('stab-ppa-type').value;
            const ppaPrice  = parseFloat(document.getElementById('stab-ppa-price').value);
            const ppaDur    = parseInt(document.getElementById('stab-ppa-duration').value);
            const loadSrc   = document.getElementById('stab-load-generated').checked ? 'generated' : 'csv';
            const annualMwh = parseFloat(document.getElementById('stab-annual-consumption').value) || 0;
            const worksSat  = document.getElementById('stab-works-saturday').checked;
            const worksSun  = document.getElementById('stab-works-sunday').checked;
            const worksHol  = document.getElementById('stab-works-holidays').checked;
            const shiftType = document.getElementById('stab-shift-type').value;
            const cerShareType = ppaType === 'cer' ? document.getElementById('stab-cer-share-type').value : 'shared_energy';

            const msgEl = document.getElementById('stab-validation-msg');

            if (!name)              { msgEl.textContent = 'Inserisci il nome del profilo consumo.';              msgEl.classList.remove('hidden'); return; }
            if (!plantId)           { msgEl.textContent = 'Seleziona un impianto FV da associare.';             msgEl.classList.remove('hidden'); return; }
            if (shiftType === 'public_lighting' && !plantId) {
                msgEl.textContent = "L'opzione 'Illuminazione pubblica' richiede l'associazione di un impianto fotovoltaico per rilevarne le coordinate.";
                msgEl.classList.remove('hidden');
                return;
            }
            if (isNaN(ppaPrice) || ppaPrice < 0) { msgEl.textContent = 'Inserisci il prezzo o la valorizzazione - deve essere \u2265 0.'; msgEl.classList.remove('hidden'); return; }
            if (isNaN(ppaDur) || ppaDur < 0)    { msgEl.textContent = 'Inserisci la durata del contratto o della CER (\u2265 0 anni).';           msgEl.classList.remove('hidden'); return; }
            if (loadSrc === 'generated' && (isNaN(annualMwh) || annualMwh < 0)) {
                msgEl.textContent = 'Inserisci il consumo annuo in MWh/anno (\u2265 0).';
                msgEl.classList.remove('hidden'); return;
            }
            let existingStab = null;
            if (editId) {
                existingStab = State.stabilimenti.find(x => x.id === editId);
            }

            if (loadSrc === 'csv' && !stabLoadedCurve && (!existingStab || !existingStab.load)) {
                msgEl.textContent = 'Carica un file CSV valido (8760 ore) prima di salvare.';
                msgEl.classList.remove('hidden'); return;
            }
            msgEl.classList.add('hidden');


            let loadCurve;
            if (loadSrc === 'generated') {
                loadCurve = generateLoadCurve(annualMwh, worksSat, worksSun, worksHol, shiftType, plantId);
            } else {
                loadCurve = stabLoadedCurve || (existingStab ? existingStab.load : null);
            }

            const stab = {
                id: editId || ('stab_' + Date.now()),
                name, plantId, ppaType, ppaPrice, ppaDuration: ppaDur,
                annualConsumption: annualMwh, worksSaturday: worksSat,
                worksSunday: worksSun, worksHolidays: worksHol,
                shiftType, loadSource: loadSrc,
                cerShareType,
                load: loadCurve,
                enabled: true // default: included in simulation
            };

            const success = await saveStabilimentoToSupabase(stab);
            if (success) {
                if (editId) {
                    const idx = State.stabilimenti.findIndex(s => s.id === editId);
                    if (idx >= 0) State.stabilimenti[idx] = stab;
                } else {
                    State.stabilimenti.push(stab);
                }

                renderStabilimentiList();
                resetStabilimentoForm();
                triggerRecalculate();
            }
        }

        async function deleteStabilimento(id) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile eliminare il profilo consumo.");
                return;
            }
            if (!confirm('Eliminare questo profilo consumo e il relativo contratto PPA?')) return;
            
            const stabFound = State.stabilimenti.find(s => s.id === id);
            const stabBackupClone = stabFound ? structuredClone(stabFound) : null;
            const success = await deleteStabilimentoFromSupabase(id);
            if (success) {
                State.stabilimenti = State.stabilimenti.filter(s => s.id !== id);
                renderStabilimentiList();
                resetStabilimentoForm();
                triggerRecalculate();
                Audit.log('stab.delete', stabBackupClone ? stabBackupClone.name : id);
                if (stabBackupClone) {
                    UndoManager.show(`Profilo "${stabBackupClone.name}" eliminato`, async () => {
                        await saveStabilimentoToSupabase(stabBackupClone);
                        State.stabilimenti.push(stabBackupClone);
                        renderStabilimentiList();
                        triggerRecalculate();
                        Audit.log('stab.undo_delete', stabBackupClone.name);
                    });
                }
            }
        }

        /**
         * Toggle a stab checkbox by ID and update the visual switch.
         * Uses explicit function call from onclick (no <label> wrapper)
         * to avoid the native browser double-toggle bug.
         * @param {string} id - checkbox element ID
         */
        function toggleStabCheck(id) {
            const cb = document.getElementById(id);
            if (!cb) return;
            cb.checked = !cb.checked;
            setStabToggleVisual(id, cb.checked);
            scheduleLoadPreview();
        }

        /**
         * Update the visual state of a toggle switch based on a boolean value.
         * Directly sets inline styles so state is always in sync regardless of
         * how the checkbox value was changed (JS, form load, reset, edit mode).
         * @param {string} id - checkbox element ID
         * @param {boolean} checked - desired state
         */
        function setStabToggleVisual(id, checked) {
            const track = document.getElementById('track-' + id);
            const thumb = document.getElementById('thumb-' + id);
            if (track) track.style.backgroundColor = checked ? '#f59e0b' : '';
            if (thumb) thumb.style.transform = checked ? 'translateX(16px)' : '';
        }

        // PPA type description update
        document.addEventListener('change', function(e) {
            if (e.target.id === 'stab-ppa-type') {
                const descEl = document.getElementById('stab-ppa-type-desc-text');
                const cerContainer = document.getElementById('stab-cer-share-type-container');
                const priceLabel = document.getElementById('lbl-stab-ppa-price');
                if (!descEl) return;
                
                if (e.target.value === 'on-site') {
                    descEl.textContent = 'On-Site: energia consegnata fisicamente allo stabilimento. La quota eccedente va al Ritiro Dedicato (RID) valorizzata al PUN.';
                    if (cerContainer) cerContainer.classList.add('hidden');
                    if (priceLabel) priceLabel.textContent = 'Prezzo PPA (€/MWh)';
                } else if (e.target.value === 'off-site') {
                    descEl.textContent = 'Off-Site: contratto virtuale sull\'intera produzione dell\'impianto. Il prezzo PPA sostituisce il PUN per l\'impianto associato.';
                    if (cerContainer) cerContainer.classList.add('hidden');
                    if (priceLabel) priceLabel.textContent = 'Prezzo PPA (€/MWh)';
                } else if (e.target.value === 'cer') {
                    descEl.textContent = 'CER: condivisione virtuale dell\'energia prodotta. Il produttore cede l\'energia in Ritiro Dedicato (RID) e riceve una tariffa CER aggiuntiva sull\'energia prodotta o condivisa.';
                    if (cerContainer) cerContainer.classList.remove('hidden');
                    if (priceLabel) priceLabel.textContent = 'Prezzo CER (€/MWh)';
                }
            }
        });

        // ── Supabase CRUD ────────────────────────────────────────────────────
        async function saveStabilimentoToSupabase(stab) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile salvare il profilo consumi.");
                return false;
            }
             try {
                let { error } = await supabaseClient.from('stabilimenti').upsert({
                    id: stab.id, name: stab.name, plant_id: stab.plantId,
                    ppa_type: stab.ppaType, ppa_price: stab.ppaPrice, ppa_duration: stab.ppaDuration,
                    annual_consumption_mwh: stab.annualConsumption,
                    works_saturday: stab.worksSaturday, works_sunday: stab.worksSunday,
                    works_holidays: stab.worksHolidays, shift_type: stab.shiftType,
                    load_source: stab.loadSource,
                    cer_share_type: stab.cerShareType
                });
                if (error) {
                    if (error.message && (error.message.includes('cer_share_type') || error.code === 'PGRST204')) {
                        console.warn("Colonna 'cer_share_type' non presente nel database stabilimenti. Riprovo senza questa colonna. Si consiglia di applicare la migrazione 'supabase_cer_migration.sql'.");
                        const { error: retryError } = await supabaseClient.from('stabilimenti').upsert({
                            id: stab.id, name: stab.name, plant_id: stab.plantId,
                            ppa_type: stab.ppaType, ppa_price: stab.ppaPrice, ppa_duration: stab.ppaDuration,
                            annual_consumption_mwh: stab.annualConsumption,
                            works_saturday: stab.worksSaturday, works_sunday: stab.worksSunday,
                            works_holidays: stab.worksHolidays, shift_type: stab.shiftType,
                            load_source: stab.loadSource
                        });
                        error = retryError;
                    }
                }
                if (error) {
                    console.error('Errore salvataggio profilo consumo:', error);
                    alert(`Errore nel salvataggio del profilo consumo su Supabase: ${error.message}\nVerifica i permessi/RLS della tabella.`);
                    return false;
                }

                // Save load curve in chunks
                if (stab.load) {
                    const rows = [];
                    for (let t = 0; t < 8760; t++) rows.push({ stabilimento_id: stab.id, hour_index: t, load_kw: stab.load[t] });
                    const chunkSize = 1000;
                    for (let i = 0; i < rows.length; i += chunkSize) {
                        const chunk = rows.slice(i, i + chunkSize);
                        const { error: le } = await supabaseClient.from('stabilimento_load').upsert(chunk, { onConflict: 'stabilimento_id,hour_index' });
                        if (le) {
                            console.error('Errore salvataggio curva carico:', le);
                            alert(`Errore nel salvataggio della curva di consumo del profilo: ${le.message}\nVerifica i permessi/RLS della tabella.`);
                            return false;
                        }
                    }
                }
                return true;
            } catch (err) {
                console.error("Errore imprevisto salvataggio profilo consumo:", err);
                alert(`Errore imprevisto nel salvataggio del profilo consumo: ${err.message}`);
                return false;
            }
        }

        async function deleteStabilimentoFromSupabase(id) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile eliminare il profilo dal database.");
                return false;
            }
            try {
                const { error: le } = await supabaseClient.from('stabilimento_load').delete().eq('stabilimento_id', id);
                if (le) {
                    console.error('Errore rimozione curva consumo:', le);
                    alert(`Errore nella rimozione della curva di consumo: ${le.message}`);
                    return false;
                }
                const { error: se } = await supabaseClient.from('stabilimenti').delete().eq('id', id);
                if (se) {
                    console.error('Errore rimozione profilo consumo:', se);
                    alert(`Errore nella rimozione del profilo consumo da Supabase: ${se.message}\nVerifica i permessi/RLS della tabella.`);
                    return false;
                }
                return true;
            } catch (err) {
                console.error("Errore imprevisto rimozione profilo consumo:", err);
                alert(`Errore imprevisto nella rimozione del profilo consumo: ${err.message}`);
                return false;
            }
        }

        async function loadStabilimentiFromSupabase() {
            if (!supabaseClient) return;
            try {
                const { data: stabData, error } = await supabaseClient.from('stabilimenti').select('*');
                if (error || !stabData || stabData.length === 0) return;
                const loaded = [];
                for (const s of stabData) {
                    let loadData = [];
                    let startIdx = 0;
                    const limitVal = 1000;
                    let hasMore = true;
                    
                    while (hasMore) {
                        const { data: chunk, error: chunkErr } = await supabaseClient
                            .from('stabilimento_load')
                            .select('hour_index, load_kw')
                            .eq('stabilimento_id', s.id)
                            .range(startIdx, startIdx + limitVal - 1)
                            .order('hour_index');
                            
                        if (chunkErr) throw chunkErr;
                        
                        if (chunk && chunk.length > 0) {
                            loadData = loadData.concat(chunk);
                            startIdx += limitVal;
                            if (chunk.length < limitVal) {
                                hasMore = false;
                            }
                        } else {
                            hasMore = false;
                        }
                    }

                    const loadArr = new Float64Array(8760);
                    loadData.forEach(r => { loadArr[r.hour_index] = r.load_kw; });
                    loaded.push({
                        id: s.id, name: s.name, plantId: s.plant_id,
                        ppaType: s.ppa_type || 'on-site',
                        ppaPrice: parseFloat(s.ppa_price) || 0,
                        ppaDuration: parseInt(s.ppa_duration) || 15,
                        annualConsumption: parseFloat(s.annual_consumption_mwh) || 0,
                        worksSaturday: !!s.works_saturday, worksSunday: !!s.works_sunday,
                        worksHolidays: !!s.works_holidays,
                        shiftType: s.shift_type || 'office',
                        loadSource: s.load_source || 'generated',
                        load: loadArr,
                        cerShareType: s.cer_share_type || 'shared_energy',
                        enabled: true // default: included in simulation
                    });
                }
                if (loaded.length > 0) {
                    State.stabilimenti = loaded;
                    renderStabilimentiList();
                }
            } catch (err) {
                console.error('Errore caricamento stabilimenti da Supabase:', err);
            }
        }

        // Show/hide the calculation indicator badge (navbar) + full-screen overlay (count-based to support nested async calls)
        function showCalcIndicator(visible) {
            if (State.calcIndicatorCount === undefined) {
                State.calcIndicatorCount = 0;
            }
            if (visible) {
                State.calcIndicatorCount++;
            } else {
                State.calcIndicatorCount = Math.max(0, State.calcIndicatorCount - 1);
            }
            
            const show = State.calcIndicatorCount > 0;
            console.debug(`[CalcIndicator] ${visible ? 'SHOW' : 'HIDE'} -> count=${State.calcIndicatorCount}, visible=${show}`);

            // Reset safety timeout every time indicator is shown
            if (show) {
                clearTimeout(State._calcSafetyTimer);
                State._calcSafetyTimer = setTimeout(() => {
                    if (State.calcIndicatorCount > 0) {
                        console.warn(`[CalcIndicator] Safety timeout: forcing overlay hide (stale count=${State.calcIndicatorCount})`);
                        State.calcIndicatorCount = 0;
                        showCalcIndicator(false); // recursive call with count=0 will hide
                    }
                }, 30000); // 30s safety net
            } else if (State.calcIndicatorCount === 0) {
                clearTimeout(State._calcSafetyTimer);
            }

            // Navbar badge
            const badge = document.getElementById('calc-indicator');
            if (badge) {
                if (show) {
                    badge.classList.remove('hidden');
                    badge.style.display = 'inline-flex';
                } else {
                    badge.classList.add('hidden');
                    badge.style.display = '';
                }
            }
            // Full-screen overlay
            const overlay = document.getElementById('calc-overlay');
            if (overlay) {
                if (show) {
                    overlay.classList.add('visible');
                    overlay.style.opacity = '1';
                    overlay.style.pointerEvents = 'all';
                } else {
                    overlay.classList.remove('visible');
                    overlay.style.opacity = '0';
                    overlay.style.pointerEvents = 'none';
                    // Show main content when the loading overlay is hidden for the first time
                    const mainContent = document.getElementById('main-content');
                    if (mainContent) mainContent.style.opacity = '1';
                }
            }
        }

        function syncStateFromDOM() {
            const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value : '';
            const getNum = (id, def) => { const v = parseFloat(getVal(id)); return !isNaN(v) ? v : (def !== undefined ? def : 0); };
            const p = State.inputs;
            p.keVal = getNum('input-ke-val', 8) / 100;
            p.wacc = getNum('input-wacc', 6) / 100;
            p.inflation = getNum('input-inflation', 2) / 100;
            p.fiscalDeprRate = getNum('slide-fiscal-depreciation', 9) / 100;
            p.iresRate = getNum('input-ires-rate', 24) / 100;
            p.irapRate = getNum('input-irap-rate', 3.9) / 100;
            p.leverage = getNum('slide-leverage', 75) / 100;
            p.interestRate = getNum('slide-interest', 4.5) / 100;
            p.loanTerm = getNum('slide-loan-term', 11);
            p.debtBasis = getVal('select-debt-basis');
            // Cash Sweep params
            p.sweepType  = getVal('select-sweep-type') || 'none';
            p.sweepValue = getNum('input-sweep-value', 0);
            p.sweepYears = getNum('input-sweep-years', 0);
            p.sculptingEnabled = document.getElementById('input-sculpting-enabled') ? document.getElementById('input-sculpting-enabled').checked : false;
            p.targetDscr = getNum('input-target-dscr', 1.30);
            p.dsraMonths = getNum('input-dsra-months', 0);
            p.refiEnabled = document.getElementById('input-refi-enabled') ? document.getElementById('input-refi-enabled').checked : false;
            p.refiYear = getNum('input-refi-year', 7);
            p.refiInterestRate = getNum('input-refi-rate', 5.0);
            p.refiLoanTerm = getNum('input-refi-term', 10);
            p.seniorGracePeriodMonths = getNum('slide-senior-grace-period', 6);
            p.constructionMonths = getNum('slide-construction-months', 6);
            p.idcDrawdownFactor = getNum('slide-idc-drawdown', 50);
            // Shareholder Loan params
            p.sociEquityPct = getNum('slide-soci-equity-pct', 80);
            p.sociInterestRate = getNum('slide-soci-interest-rate', 5.5);
            p.sociInterestGrace = getNum('input-soci-interest-grace', 0);
            p.sociPrincipalGrace = getNum('input-soci-principal-grace', 0);
            // Private Debt
            p.pdEnabled = document.getElementById('input-pd-enabled') ? document.getElementById('input-pd-enabled').checked : false;
            p.pdAmountType = getVal('select-pd-amount-type') || 'fixed_eur';
            p.pdAmountValue = getNum('input-pd-amount-value', 0);
            p.pdInterestRate = getNum('slide-pd-interest-rate', 7.0);
            p.pdInterestGrace = getNum('input-pd-interest-grace', 0);
            p.pdPrincipalGrace = getNum('input-pd-principal-grace', 0);
            p.pdMode = getVal('select-pd-mode') || 'annual_interest';
            p.pdLoanTerm = getNum('input-pd-loan-term', 10);
            p.pdTaxDeductible = document.getElementById('input-pd-tax-deductible') ? document.getElementById('input-pd-tax-deductible').checked : true;
            p.pdWaterfallRank = getVal('select-pd-waterfall-rank') || 'after_senior_before_soci';
            // Private Equity
            p.peEnabled = document.getElementById('input-pe-enabled') ? document.getElementById('input-pe-enabled').checked : false;
            p.peAmountType = getVal('select-pe-amount-type') || 'fixed_eur';
            p.peAmountValue = getNum('input-pe-amount-value', 0);
            p.peMode = getVal('select-pe-mode') || 'dividend_share';
            p.peHurdleRate = getNum('slide-pe-hurdle-rate', 8.0);
            p.pePreferredPct = getNum('slide-pe-preferred-pct', 100);
            p.peExitMultiple = getNum('input-pe-exit-multiple', 2.0);
            p.peRoyaltyPct = getNum('slide-pe-royalty-pct', 5.0);
            p.peParticipatesExit = document.getElementById('input-pe-participates-exit') ? document.getElementById('input-pe-participates-exit').checked : true;
            // Altra Forma
            p.afEnabled = document.getElementById('input-af-enabled') ? document.getElementById('input-af-enabled').checked : false;
            p.afType = getVal('select-af-type') || 'advisory_fee';
            p.afAnnualAmount = getNum('input-af-annual-amount', 0);
            p.afRevenuePct = getNum('slide-af-revenue-pct', 0);
            p.afExitPct = getNum('slide-af-exit-pct', 2.0);
            p.afWarrantPct = getNum('slide-af-warrant-pct', 5.0);
            p.afConvertibleAmount = getNum('input-af-convertible-amount', 0);
            p.afConvertibleRate = getNum('slide-af-convertible-rate', 6.0);
            p.afConvertiblePct = getNum('slide-af-convertible-pct', 10.0);
            p.afTaxDeductible = document.getElementById('input-af-tax-deductible') ? document.getElementById('input-af-tax-deductible').checked : true;
            // Holding & Exit params
            p.holdcoCapital = getNum('input-holdco-capital', 10000);
            p.exitOption = getVal('input-exit-option') || '20';
            p.exitMultiple = getNum('input-exit-multiple', 8.0);
            p.exitValuePerMwp = getNum('input-exit-value-mwp', 0);
            p.exitEnterpriseValue = getNum('input-exit-ev', 0);

            p.priceScenarioType = getVal('select-price-scenario-type') || 'base';
            p.bessOptimizer = getVal('select-bess-optimizer') || 'dp';
            p.punZonalFloor = getNum('input-pun-zonal-floor', 60.0);
            p.punBearishDecayRate = getNum('input-pun-bearish-decay-rate', 5) / 100;
            p.tsBearishDecayRate = getNum('input-ts-bearish-decay-rate', 2) / 100;
            p.arbBearishDecayRate = getNum('input-arb-bearish-decay-rate', 3) / 100;
            p.dividendLock = document.getElementById('input-dividend-lock') ? document.getElementById('input-dividend-lock').checked : false;

            p.ridLossInjectBt = getNum('input-ridLossInjectBt', 0);
            p.ridLossInjectMt = getNum('input-ridLossInjectMt', 0);
            p.ridLossInjectAt = getNum('input-ridLossInjectAt', 0);
            p.ridLossWithdrawBt = getNum('input-ridLossWithdrawBt', 0);
            p.ridLossWithdrawMt = getNum('input-ridLossWithdrawMt', 0);
            p.ridLossWithdrawAt = getNum('input-ridLossWithdrawAt', 0);
            p.cerLossCprBt = getNum('input-cerLossCprBt', 0);
            p.cerLossCprMt = getNum('input-cerLossCprMt', 0);
            p.cerLossCprAt = getNum('input-cerLossCprAt', 0);
            p.ridImbalanceCost = getNum('input-ridImbalanceCost', 0);
            p.msdEurMwYr = getNum('input-msd-eur-mw-yr', 0);
            
            p.cerTras = getNum('input-cerTras', 0);
            p.cerFissaSmall = getNum('input-cerFissaSmall', 0);
            p.cerFissaMedium = getNum('input-cerFissaMedium', 0);
            p.cerFissaLarge = getNum('input-cerFissaLarge', 0);
            p.cerCapSmall = getNum('input-cerCapSmall', 0);
            p.cerCapMedium = getNum('input-cerCapMedium', 0);
            p.cerCapLarge = getNum('input-cerCapLarge', 0);
            p.cerVarReferencePrice = getNum('input-cerVarReferencePrice', 0);
            p.cerVarMax = getNum('input-cerVarMax', 0);
            p.cerGeoNord = getNum('input-cerGeoNord', 0);
            p.cerGeoCentro = getNum('input-cerGeoCentro', 0);
            p.cerGeoSud = getNum('input-cerGeoSud', 0);

            // Update sweep value label dynamically
            const sweepLbl = document.getElementById('sweep-value-label');
            if (sweepLbl) {
                if (p.sweepType === 'pct_cfads') sweepLbl.textContent = 'Percentuale CFADS (%)';
                else if (p.sweepType === 'fixed_eur') sweepLbl.textContent = 'Importo Fisso (\u20ac/anno)';
                else sweepLbl.textContent = 'Valore (% o \u20ac)';
            }
        }

        // BESS 8760-hour simulation with round-trip efficiency & AC/DC coupling

        // Initialize DOM values from State.inputs default parameters
        function initDOMFromState() {
            const p = State.inputs;
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            
            setVal('input-ke-val', p.keVal * 100);
            setVal('input-wacc', p.wacc * 100);
            setVal('input-inflation', p.inflation * 100);
            setVal('slide-fiscal-depreciation', p.fiscalDeprRate * 100);
            setVal('input-ires-rate', (p.iresRate !== undefined ? p.iresRate : 0.24) * 100);
            setVal('input-irap-rate', (p.irapRate !== undefined ? p.irapRate : 0.039) * 100);
            setVal('slide-leverage', p.leverage * 100);
            setVal('slide-interest', p.interestRate * 100);
            setVal('slide-loan-term', p.loanTerm);
            setVal('select-debt-basis', p.debtBasis);
            setVal('select-sweep-type', p.sweepType);
            setVal('input-sweep-value', p.sweepValue);
            setVal('input-sweep-years', p.sweepYears);
            const _sculptChk = document.getElementById('input-sculpting-enabled');
            if (_sculptChk) _sculptChk.checked = !!p.sculptingEnabled;
            setVal('input-target-dscr', p.targetDscr !== undefined ? p.targetDscr : 1.30);
            setVal('input-dsra-months', p.dsraMonths !== undefined ? p.dsraMonths : 0);
            const _refiChk = document.getElementById('input-refi-enabled');
            if (_refiChk) _refiChk.checked = !!p.refiEnabled;
            setVal('input-refi-year', p.refiYear !== undefined ? p.refiYear : 7);
            setVal('input-refi-rate', p.refiInterestRate !== undefined ? p.refiInterestRate : 5.0);
            setVal('input-refi-term', p.refiLoanTerm !== undefined ? p.refiLoanTerm : 10);
            setVal('slide-senior-grace-period', p.seniorGracePeriodMonths !== undefined ? p.seniorGracePeriodMonths : 6);
            setVal('slide-construction-months', p.constructionMonths !== undefined ? p.constructionMonths : 6);
            setVal('slide-idc-drawdown', p.idcDrawdownFactor !== undefined ? p.idcDrawdownFactor : 50);
            setVal('slide-soci-equity-pct', p.sociEquityPct);
            setVal('slide-soci-interest-rate', p.sociInterestRate);
            setVal('input-soci-interest-grace', p.sociInterestGrace);
            setVal('input-soci-principal-grace', p.sociPrincipalGrace);
            // Private Debt
            const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
            setChk('input-pd-enabled', p.pdEnabled);
            setVal('select-pd-amount-type', p.pdAmountType !== undefined ? p.pdAmountType : 'fixed_eur');
            setVal('input-pd-amount-value', p.pdAmountValue !== undefined ? p.pdAmountValue : 0);
            setVal('slide-pd-interest-rate', p.pdInterestRate !== undefined ? p.pdInterestRate : 7.0);
            setVal('input-pd-interest-grace', p.pdInterestGrace !== undefined ? p.pdInterestGrace : 0);
            setVal('input-pd-principal-grace', p.pdPrincipalGrace !== undefined ? p.pdPrincipalGrace : 0);
            setVal('select-pd-mode', p.pdMode !== undefined ? p.pdMode : 'annual_interest');
            setVal('input-pd-loan-term', p.pdLoanTerm !== undefined ? p.pdLoanTerm : 10);
            setChk('input-pd-tax-deductible', p.pdTaxDeductible);
            setVal('select-pd-waterfall-rank', p.pdWaterfallRank !== undefined ? p.pdWaterfallRank : 'after_senior_before_soci');
            // Private Equity
            setChk('input-pe-enabled', p.peEnabled);
            setVal('select-pe-amount-type', p.peAmountType !== undefined ? p.peAmountType : 'fixed_eur');
            setVal('input-pe-amount-value', p.peAmountValue !== undefined ? p.peAmountValue : 0);
            setVal('select-pe-mode', p.peMode !== undefined ? p.peMode : 'dividend_share');
            setVal('slide-pe-hurdle-rate', p.peHurdleRate !== undefined ? p.peHurdleRate : 8.0);
            setVal('slide-pe-preferred-pct', p.pePreferredPct !== undefined ? p.pePreferredPct : 100);
            setVal('input-pe-exit-multiple', p.peExitMultiple !== undefined ? p.peExitMultiple : 2.0);
            setVal('slide-pe-royalty-pct', p.peRoyaltyPct !== undefined ? p.peRoyaltyPct : 5.0);
            setChk('input-pe-participates-exit', p.peParticipatesExit);
            // Altra Forma
            setChk('input-af-enabled', p.afEnabled);
            setVal('select-af-type', p.afType !== undefined ? p.afType : 'advisory_fee');
            setVal('input-af-annual-amount', p.afAnnualAmount !== undefined ? p.afAnnualAmount : 0);
            setVal('slide-af-revenue-pct', p.afRevenuePct !== undefined ? p.afRevenuePct : 0);
            setVal('slide-af-exit-pct', p.afExitPct !== undefined ? p.afExitPct : 2.0);
            setVal('slide-af-warrant-pct', p.afWarrantPct !== undefined ? p.afWarrantPct : 5.0);
            setVal('input-af-convertible-amount', p.afConvertibleAmount !== undefined ? p.afConvertibleAmount : 0);
            setVal('slide-af-convertible-rate', p.afConvertibleRate !== undefined ? p.afConvertibleRate : 6.0);
            setVal('slide-af-convertible-pct', p.afConvertiblePct !== undefined ? p.afConvertiblePct : 10.0);
            setChk('input-af-tax-deductible', p.afTaxDeductible);
            setVal('input-holdco-capital', p.holdcoCapital !== undefined ? p.holdcoCapital : 10000);
            let eOpt = p.exitOption !== undefined ? p.exitOption : '20';
            if (eOpt === 'none') eOpt = '0';
            setVal('input-exit-option', eOpt);
            const eOptValEl = document.getElementById('val-exit-option');
            if(eOptValEl) eOptValEl.textContent = (eOpt === '0' || eOpt === 0) ? 'Nessun Exit' : 'Anno ' + eOpt;
            setVal('input-exit-multiple', p.exitMultiple !== undefined ? p.exitMultiple : 8.0);
            setVal('input-exit-value-mwp', p.exitValuePerMwp);
            setVal('input-exit-ev', p.exitEnterpriseValue);
            setVal('input-exit-value-mwp', p.exitValuePerMwp);
            setVal('input-exit-ev', p.exitEnterpriseValue);
            setVal('select-price-scenario-type', p.priceScenarioType || 'base');
            setVal('select-bess-optimizer', p.bessOptimizer || 'dp');
            setVal('input-pun-zonal-floor', p.punZonalFloor !== undefined ? p.punZonalFloor : 60);
            setVal('input-pun-bearish-decay-rate', p.punBearishDecayRate !== undefined ? p.punBearishDecayRate * 100 : 5);
            setVal('input-ts-bearish-decay-rate', p.tsBearishDecayRate !== undefined ? p.tsBearishDecayRate * 100 : 2);
            setVal('input-arb-bearish-decay-rate', p.arbBearishDecayRate !== undefined ? p.arbBearishDecayRate * 100 : 3);
            const dlEl = document.getElementById('input-dividend-lock');
            if (dlEl) dlEl.checked = (p.dividendLock === true || p.dividendLock === 'true');

            // RID & CER 2026 global configs
            setVal('input-ridLossInjectBt', p.ridLossInjectBt);
            setVal('input-ridLossInjectMt', p.ridLossInjectMt);
            setVal('input-ridLossInjectAt', p.ridLossInjectAt);
            setVal('input-ridLossWithdrawBt', p.ridLossWithdrawBt);
            setVal('input-ridLossWithdrawMt', p.ridLossWithdrawMt);
            setVal('input-ridLossWithdrawAt', p.ridLossWithdrawAt);
            setVal('input-cerLossCprBt', p.cerLossCprBt);
            setVal('input-cerLossCprMt', p.cerLossCprMt);
            setVal('input-cerLossCprAt', p.cerLossCprAt);
            setVal('input-ridImbalanceCost', p.ridImbalanceCost);
            setVal('input-msd-eur-mw-yr', p.msdEurMwYr !== undefined ? p.msdEurMwYr : 0);
            
            setVal('input-cerTras', p.cerTras);
            setVal('input-cerFissaSmall', p.cerFissaSmall);
            setVal('input-cerFissaMedium', p.cerFissaMedium);
            setVal('input-cerFissaLarge', p.cerFissaLarge);
            setVal('input-cerCapSmall', p.cerCapSmall);
            setVal('input-cerCapMedium', p.cerCapMedium);
            setVal('input-cerCapLarge', p.cerCapLarge);
            setVal('input-cerVarReferencePrice', p.cerVarReferencePrice);
            setVal('input-cerVarMax', p.cerVarMax);
            setVal('input-cerGeoNord', p.cerGeoNord);
            setVal('input-cerGeoCentro', p.cerGeoCentro);
            setVal('input-cerGeoSud', p.cerGeoSud);

            // Synchronize BESS chart selectors on load
            setVal('select-chart-resolution', State.chartResolution || 'giorno');
            setVal('select-chart-aggregation', State.chartAggregation || 'orario');
            updateAggregationDropdown(State.chartResolution || 'giorno');
        }

        // Download simulation config as CSV
        function downloadConfigCSV() {
            try {
                const p = State.inputs;
                let csvContent = "parameter_key,parameter_value\n";
                Object.keys(p).forEach(key => {
                    if (key === 'disabledPlants' || key === 'disabledStabilimenti') return;
                    csvContent += `${key},${p[key]}\n`;
                });
                
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", `deal_simulator_config_${new Date().toISOString().slice(0,10)}.csv`);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error("Errore durante l'esportazione del CSV:", err);
                alert("Errore durante l'esportazione della configurazione.");
            }
        }

        // Upload simulation config from CSV
        function uploadConfigCSV(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            showCalcIndicator(true);
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const text = e.target.result;
                    const lines = text.split(/\r?\n/);
                    if (lines.length < 2) {
                        throw new Error("File CSV non valido o vuoto.");
                    }
                    
                    const parsedInputs = {};
                    let keysFound = 0;
                    
                    // Parse CSV lines
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const parts = line.split(',');
                        if (parts.length < 2) continue;
                        const key = parts[0].trim();
                        const val = parts[1].trim();
                        
                        if (State.inputs[key] !== undefined) {
                            if (typeof State.inputs[key] === 'number') {
                                parsedInputs[key] = parseFloat(val);
                            } else if (typeof State.inputs[key] === 'boolean') {
                                // 'false' stringa sarebbe truthy: parsare esplicitamente i booleani
                                parsedInputs[key] = (val === 'true' || val === '1');
                            } else {
                                parsedInputs[key] = val;
                            }
                            keysFound++;
                        }
                    }
                    
                    if (keysFound === 0) {
                        throw new Error("Nessun parametro valido trovato nel file CSV.");
                    }
                    
                    // Update State.inputs
                    Object.keys(parsedInputs).forEach(key => {
                        State.inputs[key] = parsedInputs[key];
                    });
                    
                    // Update DOM elements using mapping
                    const domMap = {
                        'keVal': { id: 'input-ke-val', mult: 100 },
                        'wacc': { id: 'input-wacc', mult: 100 },
                        'inflation': { id: 'input-inflation', mult: 100 },
                        'fiscalDeprRate': { id: 'slide-fiscal-depreciation', mult: 100 },
                        'iresRate': { id: 'input-ires-rate', mult: 100 },
                        'irapRate': { id: 'input-irap-rate', mult: 100 },
                        'leverage': { id: 'slide-leverage', mult: 100 },
                        'interestRate': { id: 'slide-interest', mult: 100 },
                        'loanTerm': { id: 'slide-loan-term', mult: 1 },
                        'debtBasis': { id: 'select-debt-basis', mult: 1 },
                        'sweepType': { id: 'select-sweep-type', mult: 1 },
                        'sweepValue': { id: 'input-sweep-value', mult: 1 },
                        'sweepYears': { id: 'input-sweep-years', mult: 1 },
                        'sculptingEnabled': { id: 'input-sculpting-enabled', mult: 1 },
                        'targetDscr': { id: 'input-target-dscr', mult: 1 },
                        'dsraMonths': { id: 'input-dsra-months', mult: 1 },
                        'refiEnabled': { id: 'input-refi-enabled', mult: 1 },
                        'refiYear': { id: 'input-refi-year', mult: 1 },
                        'refiInterestRate': { id: 'input-refi-rate', mult: 1 },
                        'refiLoanTerm': { id: 'input-refi-term', mult: 1 },
                        'seniorGracePeriodMonths': { id: 'slide-senior-grace-period', mult: 1 },
                        'constructionMonths': { id: 'slide-construction-months', mult: 1 },
                        'idcDrawdownFactor': { id: 'slide-idc-drawdown', mult: 1 },
                        'sociEquityPct': { id: 'slide-soci-equity-pct', mult: 1 },
                        'sociInterestRate': { id: 'slide-soci-interest-rate', mult: 1 },
                        'sociInterestGrace': { id: 'input-soci-interest-grace', mult: 1 },
                        'sociPrincipalGrace': { id: 'input-soci-principal-grace', mult: 1 },
                        'pdEnabled': { id: 'input-pd-enabled', mult: 1 },
                        'pdAmountType': { id: 'select-pd-amount-type', mult: 1 },
                        'pdAmountValue': { id: 'input-pd-amount-value', mult: 1 },
                        'pdInterestRate': { id: 'slide-pd-interest-rate', mult: 1 },
                        'pdInterestGrace': { id: 'input-pd-interest-grace', mult: 1 },
                        'pdPrincipalGrace': { id: 'input-pd-principal-grace', mult: 1 },
                        'ridLossInjectBt': { id: 'input-ridLossInjectBt', mult: 1 },
                        'ridLossInjectMt': { id: 'input-ridLossInjectMt', mult: 1 },
                        'ridLossInjectAt': { id: 'input-ridLossInjectAt', mult: 1 },
                        'ridLossWithdrawBt': { id: 'input-ridLossWithdrawBt', mult: 1 },
                        'ridLossWithdrawMt': { id: 'input-ridLossWithdrawMt', mult: 1 },
                        'ridLossWithdrawAt': { id: 'input-ridLossWithdrawAt', mult: 1 },
                        'cerLossCprBt': { id: 'input-cerLossCprBt', mult: 1 },
                        'cerLossCprMt': { id: 'input-cerLossCprMt', mult: 1 },
                        'cerLossCprAt': { id: 'input-cerLossCprAt', mult: 1 },
                        'ridImbalanceCost': { id: 'input-ridImbalanceCost', mult: 1 },
                        'msdEurMwYr': { id: 'input-msd-eur-mw-yr', mult: 1 },
                        'cerTras': { id: 'input-cerTras', mult: 1 },
                        'cerFissaSmall': { id: 'input-cerFissaSmall', mult: 1 },
                        'cerFissaMedium': { id: 'input-cerFissaMedium', mult: 1 },
                        'cerFissaLarge': { id: 'input-cerFissaLarge', mult: 1 },
                        'cerCapSmall': { id: 'input-cerCapSmall', mult: 1 },
                        'cerCapMedium': { id: 'input-cerCapMedium', mult: 1 },
                        'cerCapLarge': { id: 'input-cerCapLarge', mult: 1 },
                        'cerVarReferencePrice': { id: 'input-cerVarReferencePrice', mult: 1 },
                        'cerVarMax': { id: 'input-cerVarMax', mult: 1 },
                        'cerGeoNord': { id: 'input-cerGeoNord', mult: 1 },
                        'cerGeoCentro': { id: 'input-cerGeoCentro', mult: 1 },
                        'cerGeoSud': { id: 'input-cerGeoSud', mult: 1 },
                        'pdMode': { id: 'select-pd-mode', mult: 1 },
                        'pdLoanTerm': { id: 'input-pd-loan-term', mult: 1 },
                        'pdTaxDeductible': { id: 'input-pd-tax-deductible', mult: 1 },
                        'pdWaterfallRank': { id: 'select-pd-waterfall-rank', mult: 1 },
                        'peEnabled': { id: 'input-pe-enabled', mult: 1 },
                        'peAmountType': { id: 'select-pe-amount-type', mult: 1 },
                        'peAmountValue': { id: 'input-pe-amount-value', mult: 1 },
                        'peMode': { id: 'select-pe-mode', mult: 1 },
                        'peHurdleRate': { id: 'slide-pe-hurdle-rate', mult: 1 },
                        'pePreferredPct': { id: 'slide-pe-preferred-pct', mult: 1 },
                        'peExitMultiple': { id: 'input-pe-exit-multiple', mult: 1 },
                        'peRoyaltyPct': { id: 'slide-pe-royalty-pct', mult: 1 },
                        'peParticipatesExit': { id: 'input-pe-participates-exit', mult: 1 },
                        'afEnabled': { id: 'input-af-enabled', mult: 1 },
                        'afType': { id: 'select-af-type', mult: 1 },
                        'afAnnualAmount': { id: 'input-af-annual-amount', mult: 1 },
                        'afRevenuePct': { id: 'slide-af-revenue-pct', mult: 1 },
                        'afExitPct': { id: 'slide-af-exit-pct', mult: 1 },
                        'afWarrantPct': { id: 'slide-af-warrant-pct', mult: 1 },
                        'afConvertibleAmount': { id: 'input-af-convertible-amount', mult: 1 },
                        'afConvertibleRate': { id: 'slide-af-convertible-rate', mult: 1 },
                        'afConvertiblePct': { id: 'slide-af-convertible-pct', mult: 1 },
                        'afTaxDeductible': { id: 'input-af-tax-deductible', mult: 1 },
                        'holdcoCapital': { id: 'input-holdco-capital', mult: 1 },
                        'exitOption': { id: 'input-exit-option', mult: 1 },
                        'exitMultiple': { id: 'input-exit-multiple', mult: 1 },
                        'exitValuePerMwp': { id: 'input-exit-value-mwp', mult: 1 },
                        'exitEnterpriseValue': { id: 'input-exit-ev', mult: 1 },
                        'exitValuePerMwp': { id: 'input-exit-value-mwp', mult: 1 },
                        'exitEnterpriseValue': { id: 'input-exit-ev', mult: 1 },
                        'priceScenarioType': { id: 'select-price-scenario-type', mult: 1 },
                        'punZonalFloor': { id: 'input-pun-zonal-floor', mult: 1 },
                        'punBearishDecayRate': { id: 'input-pun-bearish-decay-rate', mult: 100 },
                        'tsBearishDecayRate': { id: 'input-ts-bearish-decay-rate', mult: 100 },
                        'arbBearishDecayRate': { id: 'input-arb-bearish-decay-rate', mult: 100 },
                        'dividendLock': { id: 'input-dividend-lock', mult: 1 },
                        'bessOptimizer': { id: 'select-bess-optimizer', mult: 1 }
                    };
                    
                    Object.keys(parsedInputs).forEach(key => {
                        const mapping = domMap[key];
                        if (mapping) {
                            const domEl = document.getElementById(mapping.id);
                            if (domEl) {
                                if (domEl.type === 'checkbox') {
                                    domEl.checked = (parsedInputs[key] === 'true' || parsedInputs[key] === true);
                                } else if (typeof parsedInputs[key] === 'number') {
                                    domEl.value = parsedInputs[key] * mapping.mult;
                                } else {
                                    domEl.value = parsedInputs[key];
                                }
                            }
                        }
                    });
                    
                    // Save to Supabase (dynamic)
                    await saveConfigToSupabase();
                    
                    // Total application recalculation & update
                    triggerRecalculate();
                    
                    Audit.log('config.csv_import', keysFound + ' parametri importati da CSV');
                    alert("Configurazione importata con successo e sincronizzata con il database!");
                } catch (err) {
                    console.error("Errore durante l'importazione del CSV:", err);
                    alert("Errore nell'importazione: " + err.message);
                } finally {
                    showCalcIndicator(false);
                    // Reset file input so same file can be uploaded again
                    event.target.value = '';
                }
            };
            reader.onerror = function() {
                console.error("Errore di lettura del file FileReader");
                alert("Errore di lettura del file.");
                showCalcIndicator(false);
                event.target.value = '';
            };
            try {
                reader.readAsText(file);
            } catch (err) {
                console.error("Errore durante l'avvio della lettura:", err);
                showCalcIndicator(false);
                event.target.value = '';
            }
        }

        let saveConfigTimeout = null;
        function saveConfigDebounced() {
            if (saveConfigTimeout) clearTimeout(saveConfigTimeout);
            saveConfigTimeout = setTimeout(async () => {
                await saveConfigToSupabase();
            }, 1000);
        }

        async function saveConfigToSupabase() {
            if (!supabaseClient) return;
            try {
                const rows = [];
                const p = State.inputs;
                Object.keys(p).forEach(key => {
                    rows.push({
                        parameter_key: key,
                        parameter_value: String(p[key])
                    });
                });
                
                // Salva le selezioni degli impianti serializzandole come JSON
                if (State.selectedBessPlantIds) {
                    rows.push({
                        parameter_key: 'selectedBessPlantIds',
                        parameter_value: JSON.stringify(Array.from(State.selectedBessPlantIds))
                    });
                }
                if (State.selectedGmePlantIds) {
                    rows.push({
                        parameter_key: 'selectedGmePlantIds',
                        parameter_value: JSON.stringify(Array.from(State.selectedGmePlantIds))
                    });
                }
                
                const { error } = await supabaseClient
                    .from('simulation_config')
                    .upsert(rows, { onConflict: 'parameter_key' });
                
                if (error) throw error;
                ConfigHistory.record(JSON.stringify(State.inputs));
                console.log("Configurazione salvata su Supabase.");
            } catch (err) {
                console.error("Errore nel salvataggio della configurazione:", err);
            }
        }

        // Load data (zonal PUN and plants) from Supabase on start
        async function loadDataFromSupabase() {
            showCalcIndicator(true);
            
            // Helper function to fetch all rows by bypassing Supabase select limit of 1000 rows
            async function fetchAllRows(tableName, selectQuery, orderCol, eqCol, eqVal) {
                let allData = [];
                let start = 0;
                const limit = 1000;
                let hasMore = true;
                
                while (hasMore) {
                    let query = supabaseClient
                        .from(tableName)
                        .select(selectQuery)
                        .range(start, start + limit - 1);
                    
                    if (orderCol) {
                        query = query.order(orderCol, { ascending: true });
                    }
                    if (eqCol && eqVal !== undefined) {
                        query = query.eq(eqCol, eqVal);
                    }
                    
                    const { data, error } = await query;
                    if (error) throw error;
                    
                    if (data && data.length > 0) {
                        allData = allData.concat(data);
                        start += limit;
                        if (data.length < limit) {
                            hasMore = false;
                        }
                    } else {
                        hasMore = false;
                    }
                }
                return allData;
            }

            try {
                await loadStabilimentiFromSupabase();
                if (!supabaseClient) return;
                const statusEl = document.getElementById('sync-status');

                // 1. Fetch Zonal PUN (paginated)
                const punData = await fetchAllRows('zonal_pun', '*', 'hour_index');
                
                if (punData && punData.length === 8760) {
                    punData.forEach(row => {
                        const h = row.hour_index;
                        State.zonalPun.NORD[h] = row.nord;
                        State.zonalPun.CNOR[h] = row.cnor;
                        State.zonalPun.CSUD[h] = row.csud;
                        State.zonalPun.SUD[h] = row.sud;
                        State.zonalPun.SICI[h] = row.sici;
                        State.zonalPun.SARD[h] = row.sard;
                    });
                    State._punVersion = (State._punVersion || 0) + 1;
                    console.log("Prezzi PUN zonali caricati da Supabase.");
                    renderZonalAverages();
                }

                // 2. Fetch Plants (not paginated since plants count is small)
                const { data: plantsData, error: plantsError } = await supabaseClient
                    .from('plants')
                    .select('*');
                
                if (plantsError) {
                    console.warn("Tabella plants non disponibile:", plantsError.message);
                } else if (plantsData && plantsData.length > 0) {
                    const loadedPlants = [];
                    for (let p of plantsData) {
                        // Fetch generation profiles (paginated)
                        const genData = await fetchAllRows('plant_generation', 'hour_index, generation_kw', 'hour_index', 'plant_id', p.id);
                        
                        if (genData && genData.length > 0) {
                            if (genData.length !== 8760) {
                                console.warn(`Impianto "${p.name}": serie di generazione incompleta (${genData.length}/8760 ore). Le ore mancanti sono impostate a 0.`);
                            }
                            const generation = new Float64Array(8760);
                            genData.forEach(g => {
                                generation[g.hour_index] = g.generation_kw;
                            });
                            loadedPlants.push({
                                id: p.id,
                                name: p.name,
                                capacity: p.capacity_kwp,
                                zone: p.zone,
                                capex: p.capex_kwp,
                                opex: p.opex_eur,
                                enabled: true, // default: included in simulation
                                opexOmBess: parseFloat(p.opex_om_bess || 0),
                                opexInsurance: parseFloat(p.opex_insurance || 0),
                                opexTaxes: parseFloat(p.opex_taxes || 0),
                                opexSecurity: parseFloat(p.opex_security || 0),
                                opexAssetManagement: parseFloat(p.opex_asset_management || 0),
                                connectionCost: parseFloat(p.connection_cost_eur || 0),
                                landType: p.land_type || 'acquisto',
                                landCost: parseFloat(p.land_cost_eur || 0),
                                developmentCost: parseFloat(p.development_cost_eur || 0),
                                spvAcquisitionCost: parseFloat(p.spv_acquisition_cost_eur || 0),
                                bessMw: parseFloat(p.bess_mw || 0),
                                bessMwh: parseFloat(p.bess_mwh || 0),
                                bessType: p.bess_type || 'none',
                                // Normalise BESS at load time: if no storage keep all numerics at 0
                                bessEfficiency: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_efficiency || 0) : 0,
                                bessDegradation: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_degradation || 0) : 0,
                                bessCapexKwh: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_capex_kwh || 0) : 0,
                                bessConnection: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? (p.bess_connection || 'ac') : 'none',
                                bessDoD: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_dod || 0) : 0,
                                bessSocMin: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_soc_min || 0) : 0,
                                bessSocMax: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_soc_max || 0) : 0,
                                bessTempMin: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_temp_min || 0) : 0,
                                bessTempMax: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_temp_max || 0) : 0,
                                bessCycles: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_cycles || 0) : 0,
                                bessWarrantyYears: (p.bess_type && p.bess_type !== 'none' && (parseFloat(p.bess_mwh) || 0) > 0) ? parseFloat(p.bess_warranty_years || 0) : 0,
                                gridConnectionKw: parseFloat(p.grid_connection_kw || 0),
                                gridVoltage: p.grid_voltage || 'none',
                                inverterBrand: p.inverter_brand || '',
                                inverterModel: p.inverter_model || '',
                                inverterPowerKw: parseFloat(p.inverter_power_kw || 0),
                                inverterEfficiency: parseFloat(p.inverter_efficiency || 0),
                                inverterMpptCount: parseFloat(p.inverter_mppt_count || 0),
                                inverterMaxDcV: parseFloat(p.inverter_max_dc_v || 0),
                                pvgisLatitude: p.pvgis_latitude !== undefined ? parseFloat(p.pvgis_latitude) : null,
                                pvgisLongitude: p.pvgis_longitude !== undefined ? parseFloat(p.pvgis_longitude) : null,
                                pvgisElevation: p.pvgis_elevation !== undefined ? parseFloat(p.pvgis_elevation) : null,
                                pvgisSlope: p.pvgis_slope !== undefined ? parseFloat(p.pvgis_slope) : null,
                                pvgisAzimuth: p.pvgis_azimuth || null,
                                pvgisSystemLosses: p.pvgis_system_losses !== undefined ? parseFloat(p.pvgis_system_losses) : null,
                                pvgisTracking: p.pvgis_tracking || null,
                                pvgisDatabase: p.pvgis_database || null,
                                pvgisYield: p.pvgis_yield != null ? parseFloat(p.pvgis_yield) : null,
                                pvgisAnnualProduction: p.pvgis_annual_production != null ? parseFloat(p.pvgis_annual_production) : null,
                                earnoutType: p.earnout_type || 'none',
                                earnoutVal: parseFloat(p.earnout_val || 0),
                                earnoutYears: parseInt(p.earnout_years || 0),
                                serviceType: p.service_type || 'none',
                                serviceVal: parseFloat(p.service_val || 0),
                                serviceYears: parseInt(p.service_years || 0),
                                traderContractType: p.trader_contract_type || 'pun_orario',
                                traderSpread: parseFloat(p.trader_spread_eur_mwh || 0),
                                traderDisp: parseFloat(p.trader_disp_eur_mwh || 0),
                                marketType: p.market_type || 'rid',
                                ferxTariff: p.ferx_tariff_eur_mwh !== null && p.ferx_tariff_eur_mwh !== undefined ? parseFloat(p.ferx_tariff_eur_mwh) : 0,
                                pnrrContributionPct: parseFloat(p.pnrr_contribution_pct || 0),
                                degradeRidPct: p.degrade_rid_pct !== undefined && p.degrade_rid_pct !== null ? parseFloat(p.degrade_rid_pct) : 0,
                                degradeTimeshiftingPct: p.degrade_timeshifting_pct !== undefined && p.degrade_timeshifting_pct !== null ? parseFloat(p.degrade_timeshifting_pct) : 0,
                                degradeArbitragePct: p.degrade_arbitrage_pct !== undefined && p.degrade_arbitrage_pct !== null ? parseFloat(p.degrade_arbitrage_pct) : 0,
                                generation: generation
                            });
                        }
                    }
                    if (loadedPlants.length > 0) {
                        State.plants = loadedPlants;
                        console.log(`${loadedPlants.length} impianti caricati da Supabase.`);
                        renderPlantsList();
                    }
                }

                // 3. Fetch Simulation Config
                const { data: configData, error: configError } = await supabaseClient
                    .from('simulation_config')
                    .select('*');
                
                if (configError) {
                    throw new Error("Errore nel recupero di simulation_config: " + configError.message);
                }
                
                if (!configData || configData.length === 0) {
                    throw new Error("La tabella simulation_config è vuota in Supabase. Impossibile procedere senza fallback.");
                }

                const dbKeys = configData.map(r => r.parameter_key);
                
                configData.forEach(row => {
                    const key = row.parameter_key;
                    const val = row.parameter_value;
                    
                    // Le chiavi scenario:: e audit:: NON sono parametri attivi
                    if (key.startsWith('scenario::') || key.startsWith('audit::')) return;
                    
                    // Ripristino Selezioni speciali
                    if (key === 'selectedBessPlantIds') {
                        try { State.selectedBessPlantIds = new Set(JSON.parse(val)); } catch (e) { }
                        return;
                    }
                    if (key === 'selectedGmePlantIds') {
                        try { State.selectedGmePlantIds = new Set(JSON.parse(val)); } catch (e) { }
                        return;
                    }

                    if (val === 'true') {
                        State.inputs[key] = true;
                    } else if (val === 'false') {
                        State.inputs[key] = false;
                    } else if (val.trim() !== '' && !isNaN(val)) {
                        State.inputs[key] = parseFloat(val);
                    } else {
                        State.inputs[key] = val;
                    }
                        
                        // Also update the DOM element!
                            const domMap = {
                                'keVal': { id: 'input-ke-val', mult: 100 },
                                'wacc': { id: 'input-wacc', mult: 100 },
                                'inflation': { id: 'input-inflation', mult: 100 },
                                'fiscalDeprRate': { id: 'slide-fiscal-depreciation', mult: 100 },
                                'iresRate': { id: 'input-ires-rate', mult: 100 },
                                'irapRate': { id: 'input-irap-rate', mult: 100 },
                                'leverage': { id: 'slide-leverage', mult: 100 },
                                'interestRate': { id: 'slide-interest', mult: 100 },
                                'loanTerm': { id: 'slide-loan-term', mult: 1 },
                                'debtBasis': { id: 'select-debt-basis', mult: 1 },
                                'sweepType': { id: 'select-sweep-type', mult: 1 },
                                'sweepValue': { id: 'input-sweep-value', mult: 1 },
                                'sweepYears': { id: 'input-sweep-years', mult: 1 },
                                'sculptingEnabled': { id: 'input-sculpting-enabled', mult: 1 },
                                'targetDscr': { id: 'input-target-dscr', mult: 1 },
                                'dsraMonths': { id: 'input-dsra-months', mult: 1 },
                                'refiEnabled': { id: 'input-refi-enabled', mult: 1 },
                                'refiYear': { id: 'input-refi-year', mult: 1 },
                                'refiInterestRate': { id: 'input-refi-rate', mult: 1 },
                                'refiLoanTerm': { id: 'input-refi-term', mult: 1 },
                                'seniorGracePeriodMonths': { id: 'slide-senior-grace-period', mult: 1 },
                                'constructionMonths': { id: 'slide-construction-months', mult: 1 },
                                'idcDrawdownFactor': { id: 'slide-idc-drawdown', mult: 1 },
                                'sociEquityPct': { id: 'slide-soci-equity-pct', mult: 1 },
                                'sociInterestRate': { id: 'slide-soci-interest-rate', mult: 1 },
                                'sociInterestGrace': { id: 'input-soci-interest-grace', mult: 1 },
                                'sociPrincipalGrace': { id: 'input-soci-principal-grace', mult: 1 },
                                'pdEnabled': { id: 'input-pd-enabled', mult: 1 },
                                'pdAmountType': { id: 'select-pd-amount-type', mult: 1 },
                                'pdAmountValue': { id: 'input-pd-amount-value', mult: 1 },
                                'pdInterestRate': { id: 'slide-pd-interest-rate', mult: 1 },
                                'pdInterestGrace': { id: 'input-pd-interest-grace', mult: 1 },
                                'pdPrincipalGrace': { id: 'input-pd-principal-grace', mult: 1 },
                                'ridLossInjectBt': { id: 'input-ridLossInjectBt', mult: 1 },
                                'ridLossInjectMt': { id: 'input-ridLossInjectMt', mult: 1 },
                                'ridLossInjectAt': { id: 'input-ridLossInjectAt', mult: 1 },
                                'ridLossWithdrawBt': { id: 'input-ridLossWithdrawBt', mult: 1 },
                                'ridLossWithdrawMt': { id: 'input-ridLossWithdrawMt', mult: 1 },
                                'ridLossWithdrawAt': { id: 'input-ridLossWithdrawAt', mult: 1 },
                                'cerLossCprBt': { id: 'input-cerLossCprBt', mult: 1 },
                                'cerLossCprMt': { id: 'input-cerLossCprMt', mult: 1 },
                                'cerLossCprAt': { id: 'input-cerLossCprAt', mult: 1 },
                                'ridImbalanceCost': { id: 'input-ridImbalanceCost', mult: 1 },
                                'msdEurMwYr': { id: 'input-msd-eur-mw-yr', mult: 1 },
                                'cerTras': { id: 'input-cerTras', mult: 1 },
                                'cerFissaSmall': { id: 'input-cerFissaSmall', mult: 1 },
                                'cerFissaMedium': { id: 'input-cerFissaMedium', mult: 1 },
                                'cerFissaLarge': { id: 'input-cerFissaLarge', mult: 1 },
                                'cerCapSmall': { id: 'input-cerCapSmall', mult: 1 },
                                'cerCapMedium': { id: 'input-cerCapMedium', mult: 1 },
                                'cerCapLarge': { id: 'input-cerCapLarge', mult: 1 },
                                'cerVarReferencePrice': { id: 'input-cerVarReferencePrice', mult: 1 },
                                'cerVarMax': { id: 'input-cerVarMax', mult: 1 },
                                'cerGeoNord': { id: 'input-cerGeoNord', mult: 1 },
                                'cerGeoCentro': { id: 'input-cerGeoCentro', mult: 1 },
                                'cerGeoSud': { id: 'input-cerGeoSud', mult: 1 },
                                'pdMode': { id: 'select-pd-mode', mult: 1 },
                                'pdLoanTerm': { id: 'input-pd-loan-term', mult: 1 },
                                'pdTaxDeductible': { id: 'input-pd-tax-deductible', mult: 1 },
                                'pdWaterfallRank': { id: 'select-pd-waterfall-rank', mult: 1 },
                                'peEnabled': { id: 'input-pe-enabled', mult: 1 },
                                'peAmountType': { id: 'select-pe-amount-type', mult: 1 },
                                'peAmountValue': { id: 'input-pe-amount-value', mult: 1 },
                                'peMode': { id: 'select-pe-mode', mult: 1 },
                                'peHurdleRate': { id: 'slide-pe-hurdle-rate', mult: 1 },
                                'pePreferredPct': { id: 'slide-pe-preferred-pct', mult: 1 },
                                'peExitMultiple': { id: 'input-pe-exit-multiple', mult: 1 },
                                'peRoyaltyPct': { id: 'slide-pe-royalty-pct', mult: 1 },
                                'peParticipatesExit': { id: 'input-pe-participates-exit', mult: 1 },
                                'afEnabled': { id: 'input-af-enabled', mult: 1 },
                                'afType': { id: 'select-af-type', mult: 1 },
                                'afAnnualAmount': { id: 'input-af-annual-amount', mult: 1 },
                                'afRevenuePct': { id: 'slide-af-revenue-pct', mult: 1 },
                                'afExitPct': { id: 'slide-af-exit-pct', mult: 1 },
                                'afWarrantPct': { id: 'slide-af-warrant-pct', mult: 1 },
                                'afConvertibleAmount': { id: 'input-af-convertible-amount', mult: 1 },
                                'afConvertibleRate': { id: 'slide-af-convertible-rate', mult: 1 },
                                'afConvertiblePct': { id: 'slide-af-convertible-pct', mult: 1 },
                                'afTaxDeductible': { id: 'input-af-tax-deductible', mult: 1 },
                                'holdcoCapital': { id: 'input-holdco-capital', mult: 1 },
                                'exitOption': { id: 'input-exit-option', mult: 1 },
                                'exitMultiple': { id: 'input-exit-multiple', mult: 1 },
                        'exitValuePerMwp': { id: 'input-exit-value-mwp', mult: 1 },
                        'exitEnterpriseValue': { id: 'input-exit-ev', mult: 1 },
                        'exitValuePerMwp': { id: 'input-exit-value-mwp', mult: 1 },
                        'exitEnterpriseValue': { id: 'input-exit-ev', mult: 1 },
                                'priceScenarioType': { id: 'select-price-scenario-type', mult: 1 },
                                'punZonalFloor': { id: 'input-pun-zonal-floor', mult: 1 },
                                'punBearishDecayRate': { id: 'input-pun-bearish-decay-rate', mult: 100 },
                                'tsBearishDecayRate': { id: 'input-ts-bearish-decay-rate', mult: 100 },
                                'arbBearishDecayRate': { id: 'input-arb-bearish-decay-rate', mult: 100 },
                                'dividendLock': { id: 'input-dividend-lock', mult: 1 },
                                'bessOptimizer': { id: 'select-bess-optimizer', mult: 1 }
                            };
                            
                            const mapping = domMap[key];
                            if (mapping) {
                                const domEl = document.getElementById(mapping.id);
                                if (domEl) {
                                    if (domEl.type === 'checkbox') {
                                        domEl.checked = State.inputs[key];
                                    } else if (typeof State.inputs[key] === 'number') {
                                        domEl.value = State.inputs[key] * mapping.mult;
                                    } else {
                                        domEl.value = State.inputs[key];
                                    }
                                }
                            }
                    });
                    // Apply enabled/disabled states to plants & stabilimenti based on loaded config
                    if (State.inputs.disabledPlants) {
                        try {
                            const disabledIds = JSON.parse(State.inputs.disabledPlants);
                            State.plants.forEach(p => {
                                p.enabled = !disabledIds.includes(p.id);
                            });
                            renderPlantsList();
                        } catch (err) {
                            console.error("Errore nel parsing di disabledPlants:", err);
                        }
                    }
                    if (State.inputs.disabledStabilimenti) {
                        try {
                            const disabledIds = JSON.parse(State.inputs.disabledStabilimenti);
                            State.stabilimenti.forEach(s => {
                                s.enabled = !disabledIds.includes(s.id);
                            });
                            renderStabilimentiList();
                        } catch (err) {
                            console.error("Errore nel parsing di disabledStabilimenti:", err);
                        }
                    }
                
                // Carica gli scenari nominati salvati
                await loadScenariosFromSupabase();
                // Carica il registro audit
                await Audit.init();
                

            } catch (err) {
                console.error("Errore nel caricamento dati da Supabase:", err);
                throw err;
            } finally {
                showCalcIndicator(false);
                State.isLoading = false;
            }
        }

        // Save zonal prices to Supabase
        async function saveZonalPunToSupabase() {
            if (!supabaseClient) return;
            const statusEl = document.getElementById('sync-status');
            statusEl.textContent = "Salvataggio PUN su DB...";
            statusEl.className = "text-xs text-amber-400 font-medium";
            
            try {
                const rows = [];
                for (let t = 0; t < 8760; t++) {
                    rows.push({
                        hour_index: t,
                        nord: State.zonalPun.NORD[t],
                        cnor: State.zonalPun.CNOR[t],
                        csud: State.zonalPun.CSUD[t],
                        sud: State.zonalPun.SUD[t],
                        sici: State.zonalPun.SICI[t],
                        sard: State.zonalPun.SARD[t]
                    });
                }
                
                const chunkSize = 1000;
                for (let i = 0; i < rows.length; i += chunkSize) {
                    const chunk = rows.slice(i, i + chunkSize);
                    const { error } = await supabaseClient
                        .from('zonal_pun')
                        .upsert(chunk, { onConflict: 'hour_index' });
                    if (error) throw error;
                }
                statusEl.textContent = "PUN zonale salvato su DB!";
                statusEl.className = "text-xs text-emerald-400 font-medium";
                setTimeout(() => {
                    statusEl.textContent = "Stato Connessione: Collegato";
                }, 3000);
            } catch (err) {
                console.error("Errore nel salvataggio del PUN zonale:", err);
                statusEl.textContent = "Errore salvataggio PUN.";
                statusEl.className = "text-xs text-red-400 font-medium";
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // GESTIONE SCENARI NOMINATI (snapshot di State.inputs su simulation_config)
        // Chiavi: scenario::<id>::name e scenario::<id>::data (JSON) — nessuna migrazione DB richiesta
        // ═══════════════════════════════════════════════════════════════════
        const SCENARIO_PREFIX = 'scenario::';
        State.scenarios = [];
        State.selectedCompareIds = new Set();

        async function loadScenariosFromSupabase() {
            if (!supabaseClient) return;
            try {
                const { data, error } = await supabaseClient
                    .from('simulation_config')
                    .select('parameter_key, parameter_value')
                    .like('parameter_key', SCENARIO_PREFIX + '%');
                if (error) throw error;
                const list = [];
                (data || []).forEach(row => {
                    const rest = row.parameter_key.substring(SCENARIO_PREFIX.length);
                    const sep = rest.indexOf('::');
                    if (sep < 0) return;
                    const id = rest.substring(0, sep);
                    const field = rest.substring(sep + 2);
                    let scen = list.find(s => s.id === id);
                    if (!scen) { scen = { id, name: id, payload: null, chunks: [] }; list.push(scen); }
                    if (field === 'name') scen.name = row.parameter_value;
                    else if (field.startsWith('data::')) {
                        const idx = parseInt(field.substring(6)) || 0;
                        scen.chunks.push({ idx, text: row.parameter_value });
                    } else if (field === 'data') { // retro-compatibilità payload non chunkato
                        scen.chunks.push({ idx: 0, text: row.parameter_value });
                    }
                });
                list.forEach(s => {
                    if (s.chunks.length > 0) {
                        try {
                            s.payload = JSON.parse(s.chunks.sort((a, b) => a.idx - b.idx).map(c => c.text).join(''));
                        } catch (e) { s.payload = null; }
                    }
                    delete s.chunks;
                });
                State.scenarios = list.filter(s => s.payload);
            } catch (err) {
                console.error('Errore caricamento scenari:', err);
            }
            renderScenarioList();
        }

        function renderScenarioList() {
            const sel = document.getElementById('scenario-select');
            const listEl = document.getElementById('scenario-list');
            if (!sel || !listEl) return;

            const currentVal = sel.value;
            sel.innerHTML = State.scenarios.length === 0
                ? '<option value="">- Nessuno scenario salvato -</option>'
                : '<option value="">- Seleziona scenario -</option>';
            State.scenarios.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                sel.appendChild(opt);
            });
            if (State.scenarios.some(s => s.id === currentVal)) sel.value = currentVal;

            // Chip con checkbox per il confronto
            let html = '';
            State.scenarios.forEach(s => {
                const checked = State.selectedCompareIds.has(s.id) ? 'checked' : '';
                html += `
                    <label class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-violet-600/50 cursor-pointer transition-colors">
                        <input type="checkbox" ${checked} onchange="toggleScenarioCompare('${s.id}')" class="w-3 h-3 rounded border-slate-700 text-violet-500 focus:ring-violet-500 bg-slate-900">
                        <span class="text-[10px] text-slate-300 font-semibold">${escapeHtml(s.name)}</span>
                    </label>`;
            });
            listEl.innerHTML = html;
        }

        window.toggleScenarioCompare = function(id) {
            if (State.selectedCompareIds.has(id)) State.selectedCompareIds.delete(id);
            else State.selectedCompareIds.add(id);
        };

        // Scrittura chunkata di uno scenario (parameter_value varchar(255) -> righe da 200 char)
        async function writeScenarioRows(id, name, payload) {
            const json = JSON.stringify(payload);
            const rows = [{ parameter_key: SCENARIO_PREFIX + id + '::name', parameter_value: String(name).substring(0, 250) }];
            for (let i = 0; i * 200 < json.length; i++) {
                rows.push({ parameter_key: SCENARIO_PREFIX + id + '::data::' + i, parameter_value: json.substring(i * 200, (i + 1) * 200) });
            }
            const { error } = await supabaseClient.from('simulation_config').upsert(rows, { onConflict: 'parameter_key' });
            if (error) throw error;
        }

        window.saveCurrentScenario = async function() {
            if (!supabaseClient) { alert('Database non connesso.'); return; }
            const nameEl = document.getElementById('scenario-name-input');
            const name = (nameEl.value || '').trim();
            if (!name) { alert('Inserisci un nome per lo scenario.'); return; }
            syncStateFromDOM();
            const id = 'sc_' + Date.now();
            const payload = JSON.parse(JSON.stringify(State.inputs));
            try {
                await writeScenarioRows(id, name, payload);
                nameEl.value = '';
                await loadScenariosFromSupabase();
                document.getElementById('scenario-select').value = id;
                Audit.log('scenario.save', name);
            } catch (err) {
                console.error('Errore salvataggio scenario:', err);
                alert('Errore nel salvataggio dello scenario: ' + err.message);
            }
        };

        window.applySelectedScenario = async function() {
            const id = document.getElementById('scenario-select').value;
            if (!id) { alert('Seleziona uno scenario da applicare.'); return; }
            const scen = State.scenarios.find(s => s.id === id);
            if (!scen) { alert('Scenario non trovato.'); return; }
            State.inputs = JSON.parse(JSON.stringify(scen.payload));
            initDOMFromState();
            await saveConfigToSupabase();
            triggerRecalculate();
            Audit.log('scenario.apply', scen.name);
        };

        window.deleteSelectedScenario = async function() {
            if (!supabaseClient) { alert('Database non connesso.'); return; }
            const id = document.getElementById('scenario-select').value;
            if (!id) { alert('Seleziona uno scenario da eliminare.'); return; }
            const scen = State.scenarios.find(s => s.id === id);
            if (!confirm(`Eliminare lo scenario "${scen ? scen.name : id}"?`)) return;
            const scenBackup = scen ? { id: scen.id, name: scen.name, payload: JSON.parse(JSON.stringify(scen.payload)) } : null;
            try {
                const { error } = await supabaseClient.from('simulation_config').delete()
                    .like('parameter_key', SCENARIO_PREFIX + id + '::%');
                if (error) throw error;
                State.selectedCompareIds.delete(id);
                await loadScenariosFromSupabase();
                Audit.log('scenario.delete', scenBackup ? scenBackup.name : id);
                if (scenBackup) {
                    UndoManager.show(`Scenario "${scenBackup.name}" eliminato`, async () => {
                        await writeScenarioRows(scenBackup.id, scenBackup.name, scenBackup.payload);
                        await loadScenariosFromSupabase();
                        Audit.log('scenario.undo_delete', scenBackup.name);
                    });
                }
            } catch (err) {
                console.error('Errore eliminazione scenario:', err);
                alert('Errore nell\'eliminazione dello scenario: ' + err.message);
            }
        };

        window.runScenarioCompare = function() {
            const ids = Array.from(State.selectedCompareIds);
            if (ids.length === 0) { alert('Seleziona almeno uno scenario dai checkbox.'); return; }
            if (ids.length > 3) { alert('Confronto limitato a 3 scenari alla volta.'); return; }
            const selected = ids.map(id => State.scenarios.find(s => s.id === id)).filter(Boolean);
            if (selected.length === 0) return;

            const resultsEl = document.getElementById('scenario-compare-results');
            resultsEl.classList.remove('hidden');
            resultsEl.innerHTML = '<div class="text-center text-violet-400 text-xs p-4"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Calcolo confronto scenari in corso...</div>';

            initWorker();
            simWorker.postMessage({
                action: 'COMPARE_SCENARIOS',
                payload: {
                    State: {
                        inputs: State.inputs,
                        plants: State.plants,
                        stabilimenti: State.stabilimenti,
                        zonalPun: State.zonalPun,
                        selectedBessPlantIds: State.selectedBessPlantIds,
                        previouslySeenPlantIds: State.previouslySeenPlantIds
                    },
                    scenarios: selected.map(s => ({ id: s.id, name: s.name, inputs: s.payload }))
                }
            });
        };

        function renderScenarioCompareResults(results) {
            const resultsEl = document.getElementById('scenario-compare-results');
            if (!resultsEl) return;
            resultsEl.classList.remove('hidden');

            const kpis = [
                { key: 'irr', label: 'Equity IRR', fmt: v => v.toFixed(2) + '%', best: 'max' },
                { key: 'npv', label: 'NPV @ Ke', fmt: v => formatEuro(v), best: 'max' },
                { key: 'moic', label: 'MOIC', fmt: v => v.toFixed(2) + 'x', best: 'max' },
                { key: 'minDscr', label: 'DSCR Minimo', fmt: v => v === null ? 'N/A' : v.toFixed(2) + 'x', best: 'max' },
                { key: 'avgDscr', label: 'DSCR Medio', fmt: v => v.toFixed(2) + 'x', best: 'max' },
                { key: 'lcoe', label: 'LCOE', fmt: v => '\u20ac ' + v.toFixed(2) + '/MWh', best: 'min' },
                { key: 'payback', label: 'Payback', fmt: v => v, best: null }
            ];

            let html = '<table class="w-full text-xs text-left border border-slate-800 rounded-lg overflow-hidden"><thead><tr>';
            html += '<th class="p-2.5 bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">KPI</th>';
            results.forEach(r => {
                html += `<th class="p-2.5 bg-slate-900 text-violet-300 font-bold text-right border-b border-slate-800">${escapeHtml(r.name)}</th>`;
            });
            html += '</tr></thead><tbody>';
            kpis.forEach(k => {
                const vals = results.map(r => r[k.key]);
                let bestIdx = -1;
                if (k.best && vals.every(v => typeof v === 'number' && isFinite(v))) {
                    bestIdx = vals.indexOf(k.best === 'max' ? Math.max(...vals) : Math.min(...vals));
                }
                html += `<tr class="border-b border-slate-800/50"><td class="p-2.5 text-slate-400">${k.label}</td>`;
                vals.forEach((v, i) => {
                    const cls = i === bestIdx ? 'text-emerald-400 font-bold' : 'text-slate-300';
                    html += `<td class="p-2.5 text-right font-mono ${cls}">${v === null || v === undefined ? 'N/A' : k.fmt(v)}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
            resultsEl.innerHTML = html;
        }

        // Save single plant to Supabase
        async function savePlantToSupabase(plant) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile salvare l'impianto nel database.");
                return false;
            }
            const statusEl = document.getElementById('sync-status');
            statusEl.textContent = `Salvataggio ${plant.name} su DB...`;
            statusEl.className = "text-xs text-amber-400 font-medium";
            
            try {
                // 1. Insert plant metadata
                const payload = {
                    id: plant.id,
                    name: plant.name,
                    capacity_kwp: plant.capacity,
                    zone: plant.zone,
                    capex_kwp: plant.capex,
                    opex_eur: plant.opex,
                    opex_om_bess: plant.opexOmBess || 0,
                    opex_insurance: plant.opexInsurance || 0,
                    opex_taxes: plant.opexTaxes || 0,
                    opex_security: plant.opexSecurity || 0,
                    opex_asset_management: plant.opexAssetManagement || 0,
                    connection_cost_eur: plant.connectionCost || 0,
                    land_type: plant.landType || 'acquisto',
                    land_cost_eur: plant.landCost || 0,
                    development_cost_eur: plant.developmentCost || 0,
                    spv_acquisition_cost_eur: plant.spvAcquisitionCost || 0,
                    bess_mw: plant.bessMw || 0,
                    bess_mwh: plant.bessMwh || 0,
                    bess_efficiency: plant.bessEfficiency || 0,
                    bess_degradation: plant.bessDegradation || 0,
                    bess_capex_kwh: plant.bessCapexKwh || 0,
                    bess_type: plant.bessType || 'none',
                    bess_connection: plant.bessConnection || 'none',
                    bess_dod: plant.bessDoD || 0,
                    bess_soc_min: plant.bessSocMin || 0,
                    bess_soc_max: plant.bessSocMax || 0,
                    bess_temp_min: plant.bessTempMin || 0,
                    bess_temp_max: plant.bessTempMax || 0,
                    bess_cycles: plant.bessCycles || 0,
                    bess_warranty_years: plant.bessWarrantyYears || 0,
                    grid_connection_kw: plant.gridConnectionKw || 0,
                    grid_voltage: plant.gridVoltage || 'none',
                    inverter_brand: plant.inverterBrand || '',
                    inverter_model: plant.inverterModel || '',
                    inverter_power_kw: plant.inverterPowerKw || 0,
                    inverter_efficiency: plant.inverterEfficiency || 0,
                    inverter_mppt_count: plant.inverterMpptCount || 0,
                    inverter_max_dc_v: plant.inverterMaxDcV || 0,
                    pvgis_latitude: plant.pvgisLatitude || null,
                    pvgis_longitude: plant.pvgisLongitude || null,
                    pvgis_elevation: plant.pvgisElevation || null,
                    pvgis_slope: plant.pvgisSlope || null,
                    pvgis_azimuth: plant.pvgisAzimuth || null,
                    pvgis_system_losses: plant.pvgisSystemLosses || null,
                    pvgis_tracking: plant.pvgisTracking || null,
                    pvgis_database: plant.pvgisDatabase || null,
                    pvgis_yield: plant.pvgisYield || null,
                    pvgis_annual_production: plant.pvgisAnnualProduction || null,
                    earnout_type: plant.earnoutType || 'none',
                    earnout_val: plant.earnoutVal || 0,
                    earnout_years: plant.earnoutYears || 0,
                    service_type: plant.serviceType || 'none',
                    service_val: plant.serviceVal || 0,
                    service_years: plant.serviceYears || 0,
                    trader_contract_type: plant.traderContractType || 'pun_orario',
                    trader_spread_eur_mwh: plant.traderSpread || 0,
                    trader_disp_eur_mwh: plant.traderDisp || 0,
                    pnrr_contribution_pct: plant.pnrrContributionPct || 0,
                    market_type: plant.marketType || 'rid',
                    ferx_tariff_eur_mwh: plant.ferxTariff !== undefined ? plant.ferxTariff : 0,
                    degrade_rid_pct: plant.degradeRidPct !== undefined ? plant.degradeRidPct : 0,
                    degrade_timeshifting_pct: plant.degradeTimeshiftingPct !== undefined ? plant.degradeTimeshiftingPct : 0,
                    degrade_arbitrage_pct: plant.degradeArbitragePct !== undefined ? plant.degradeArbitragePct : 0
                };

                let { error: plantError } = await supabaseClient
                    .from('plants')
                    .upsert(payload);
                
                if (plantError && (plantError.message && (plantError.message.includes('pnrr_contribution_pct') || plantError.code === 'PGRST204'))) {
                    console.warn("Colonna 'pnrr_contribution_pct' non presente nel database impianti. Riprovo senza questa colonna. Si consiglia di applicare la migrazione 'migration_cer_rid_params.sql'.");
                    delete payload.pnrr_contribution_pct;
                    const { error: retryError } = await supabaseClient
                        .from('plants')
                        .upsert(payload);
                    plantError = retryError;
                }
                
                if (plantError) throw plantError;
                
                // 2. Prepare generation rows
                const rows = [];
                for (let t = 0; t < 8760; t++) {
                    rows.push({
                        plant_id: plant.id,
                        hour_index: t,
                        generation_kw: plant.generation[t]
                    });
                }
                
                const chunkSize = 1000;
                for (let i = 0; i < rows.length; i += chunkSize) {
                    const chunk = rows.slice(i, i + chunkSize);
                    const { error: genError } = await supabaseClient
                        .from('plant_generation')
                        .upsert(chunk, { onConflict: 'plant_id,hour_index' });
                    if (genError) throw genError;
                }
                
                statusEl.textContent = `Impianto ${plant.name} salvato!`;
                statusEl.className = "text-xs text-emerald-400 font-medium";
                setTimeout(() => {
                    statusEl.textContent = "Stato Connessione: Collegato";
                }, 3000);
                return true;
            } catch (err) {
                console.error("Errore salvataggio impianto su Supabase:", err);
                statusEl.textContent = "Errore salvataggio impianto.";
                statusEl.className = "text-xs text-red-400 font-medium";
                alert(`Errore di salvataggio dell'impianto nel database: ${err.message}`);
                return false;
            }
        }

        // Parser for PVGIS CSV - now also extracts all metadata from header
        window.importPvgisCsv = async function(fileContent, plantName, plantCapacityKwp, plantZone, capex, opex, connectionCost, landType, landCost, developmentCost, spvAcquisitionCost, bessMw, bessMwh, bessEfficiency, bessDoD, bessSocMin, bessSocMax, bessDegradation, bessCapexKwh, bessTempMin, bessTempMax, bessCycles, bessWarrantyYears, bessType, bessConnection, gridConnectionKw, gridVoltage, inverterBrand, inverterModel, inverterPowerKw, inverterEfficiency, inverterMpptCount, inverterMaxDcV, opexOmBess, opexInsurance, opexTaxes, opexSecurity, opexAssetManagement, earnoutType, earnoutVal, earnoutYears, serviceType, serviceVal, serviceYears, traderContractType, traderSpread, traderDisp, pnrrContributionPct, degradeRidPct, degradeTimeshiftingPct, degradeArbitragePct, marketType, ferxTariff) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile importare l'impianto.");
                return;
            }
            const lines = fileContent.split(/\r?\n/);
            const generation = new Float64Array(8760);
            let count = 0;

            // ── Extract PVGIS metadata from header ──
            const hdr = fileContent.substring(0, 1000); // only inspect first 1000 chars
            const capMatch = hdr.match(/Nominal power of the PV system.*?:\s*([\d.]+)/i);
            if (capMatch) plantCapacityKwp = parseFloat(capMatch[1]);
            const latMatch  = hdr.match(/Latitude[^:]*:\s*([\d.]+)/i);
            const lonMatch  = hdr.match(/Longitude[^:]*:\s*([\d.]+)/i);
            const eleMatch  = hdr.match(/Elevation[^:]*:\s*([\d.]+)/i);
            const slopeMatch = hdr.match(/Slope:\s*([\d.]+)/i);
            const azimMatch = hdr.match(/Azimuth:\s*([^\r\n\t]+)/i);
            const lossMatch = hdr.match(/System losses[^:]*:\s*([\d.]+)/i);
            const trackMatch = hdr.match(/Tracking[^:]*:\s*([^\r\n]+)/i);
            const dbMatch   = hdr.match(/Radiation database:\s*([^\r\n]+)/i);

            const pvgisMeta = {
                pvgisLatitude:    latMatch   ? parseFloat(latMatch[1])   : null,
                pvgisLongitude:   lonMatch   ? parseFloat(lonMatch[1])   : null,
                pvgisElevation:   eleMatch   ? parseFloat(eleMatch[1])   : null,
                pvgisSlope:       slopeMatch ? parseFloat(slopeMatch[1]) : null,
                pvgisAzimuth:     azimMatch  ? azimMatch[1].trim().replace(/deg.?/i,'\u00B0').replace(/^-\s*\u00B0?$/,'Ottimale (0\u00B0 Sud)') : null,
                pvgisSystemLosses: lossMatch ? parseFloat(lossMatch[1]) : null,
                pvgisTracking:    trackMatch ? trackMatch[1].trim() : 'Fixed',
                pvgisDatabase:    dbMatch    ? dbMatch[1].trim()   : null
            };

            // Update read-only display fields
            const setRo = (id, val) => { const el = document.getElementById(id); if (el && val !== null) el.value = val; };
            setRo('pvgis-latitude', pvgisMeta.pvgisLatitude);
            setRo('pvgis-longitude', pvgisMeta.pvgisLongitude);
            setRo('pvgis-slope', pvgisMeta.pvgisSlope);
            setRo('pvgis-azimuth', pvgisMeta.pvgisAzimuth);
            setRo('pvgis-elevation', pvgisMeta.pvgisElevation);
            setRo('pvgis-system-losses', pvgisMeta.pvgisSystemLosses);
            setRo('pvgis-tracking', pvgisMeta.pvgisTracking);
            setRo('pvgis-database', pvgisMeta.pvgisDatabase);
            // Update capacity field (read-only)
            const capEl = document.getElementById('plant-capacity');
            if (capEl) capEl.value = Math.round(plantCapacityKwp);
            // Store annual generation sum for KPI computation (will be available after parsing)
            pvgisMeta._annualGenerationKwh = null; // filled after loop below
            
            lines.forEach(line => {
                if (line.trim().startsWith('#') || !line.trim()) return;
                
                const parts = line.split(/[\t,;]/);
                if (parts.length < 2) return;
                
                const dateStr = parts[0].trim();
                const powerVal = parseFloat(parts[1].trim());
                
                if (dateStr.includes(':')) {
                    const dateParts = dateStr.split(':');
                    const yearMonthDay = dateParts[0];
                    const hourMin = dateParts[1];
                    if (yearMonthDay.length === 8) {
                        const month = parseInt(yearMonthDay.substring(4, 6));
                        const day = parseInt(yearMonthDay.substring(6, 8));
                        const hour = parseInt(hourMin.substring(0, 2));
                        
                        if (!isNaN(month) && !isNaN(day) && !isNaN(hour)) {
                            const index = getHourIndex(month, day, hour);
                            if (index >= 0 && index < 8760 && !isNaN(powerVal)) {
                                generation[index] = powerVal / 1000; // Convert W to kW
                                count++;
                            }
                        }
                    }
                }
            });
            
            if (count < 100) {
                alert("Formato PVGIS CSV non standard. Verr\u00E0 generata una curva di produzione di default basata sulla capacit\u00E0 nominale.");
                const defaultGen = generateDefaultSolarProfile(plantCapacityKwp / 1000, 1690);
                for(let i=0; i<8760; i++) generation[i] = defaultGen[i];
            }

            // Compute annual generation sum (kWh) from parsed generation array
            let annualKwh = 0;
            for (let i = 0; i < 8760; i++) annualKwh += generation[i];
            pvgisMeta._annualGenerationKwh = annualKwh;
            // Update KPI display fields in real time
            recalcPlantKpis(annualKwh, plantCapacityKwp);
            
            // Use trader & network parameters from arguments

            const newPlant = {
                id: "plant-" + Date.now(),
                name: plantName,
                capacity: plantCapacityKwp,
                zone: plantZone,
                capex: capex,
                opex: opex,
                enabled: true, // default: included in simulation
                opexOmBess: opexOmBess || 0,
                opexInsurance: opexInsurance || 0,
                opexTaxes: opexTaxes || 0,
                opexSecurity: opexSecurity || 0,
                opexAssetManagement: opexAssetManagement || 0,
                connectionCost: connectionCost,
                landType: landType,
                landCost: landCost,
                developmentCost: developmentCost,
                spvAcquisitionCost: spvAcquisitionCost,
                gridConnectionKw: gridConnectionKw || 0,
                gridVoltage: gridVoltage || 'none',
                inverterBrand: inverterBrand || '',
                inverterModel: inverterModel || '',
                inverterPowerKw: inverterPowerKw || 0,
                inverterEfficiency: inverterEfficiency || 0,
                inverterMpptCount: inverterMpptCount || 0,
                inverterMaxDcV: inverterMaxDcV || 0,
                bessMw: bessMw,
                bessMwh: bessMwh,
                bessEfficiency: bessEfficiency,
                bessDoD: bessDoD || 0,
                bessSocMin: bessSocMin || 0,
                bessSocMax: bessSocMax || 0,
                bessDegradation: bessDegradation,
                bessCapexKwh: bessCapexKwh,
                bessTempMin: bessTempMin || 0,
                bessTempMax: bessTempMax || 0,
                bessCycles: bessCycles || 0,
                bessWarrantyYears: bessWarrantyYears || 0,
                bessType: bessType,
                bessConnection: bessConnection,
                earnoutType: earnoutType || 'none',
                earnoutVal: earnoutVal || 0,
                earnoutYears: earnoutYears || 0,
                serviceType: serviceType || 'none',
                serviceVal: serviceVal || 0,
                serviceYears: serviceYears || 0,
                traderContractType: traderContractType,
                traderSpread: traderSpread,
                traderDisp: traderDisp,
                pnrrContributionPct: pnrrContributionPct,
                marketType: marketType || 'rid',
                ferxTariff: ferxTariff !== undefined ? ferxTariff : 85,
                degradeRidPct: degradeRidPct,
                degradeTimeshiftingPct: degradeTimeshiftingPct,
                degradeArbitragePct: degradeArbitragePct,
                ...pvgisMeta,
                pvgisYield: (pvgisMeta._annualGenerationKwh != null && plantCapacityKwp > 0) ? parseFloat((pvgisMeta._annualGenerationKwh / plantCapacityKwp).toFixed(1)) : null,
                pvgisAnnualProduction: pvgisMeta._annualGenerationKwh != null ? parseFloat((pvgisMeta._annualGenerationKwh / 1000).toFixed(1)) : null,
                generation: generation
            };

            const success = await savePlantToSupabase(newPlant);
            if (success) {
                State.plants.push(newPlant);
                Audit.log('plant.add', newPlant.name);
                renderPlantsList();
                renderZonalAverages();
                triggerRecalculate();

                // Reset PVGIS file input and disable add plant button
                const fileInput = document.getElementById('pvgis-file');
                if (fileInput) fileInput.value = "";
                const btnAddPlant = document.getElementById('btn-add-plant');
                if (btnAddPlant) {
                    btnAddPlant.disabled = true;
                    btnAddPlant.className = "w-full py-2 bg-slate-800 text-slate-500 font-bold rounded-lg text-xs cursor-not-allowed transition-colors flex items-center justify-center";
                }
            }
        };

        // GME XLSX Import (Fixed Italian formatting, date parsing, and DB upsert)
        window.importGmeXlsx = function(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);
                    
                    let count = 0;
                    const zonesMapping = {
                        "NORD": ["Nord", "NORD", "nord"],
                        "CNOR": ["Centro Nord", "CNOR", "cnor", "centro nord", "Centro nord"],
                        "CSUD": ["Centro Sud", "CSUD", "csud", "centro sud", "Centro sud"],
                        "SUD": ["Sud", "SUD", "sud"],
                        "SICI": ["Sicilia", "SICI", "sici", "sicilia"],
                        "SARD": ["Sardegna", "SARD", "sard", "sardegna"]
                    };

                    // Backup PUN per undo (6 zone x 8760h)
                    const punBackup = {};
                    Object.keys(State.zonalPun).forEach(z => { punBackup[z] = Float64Array.from(State.zonalPun[z]); });
                    
                    jsonData.forEach(row => {
                        let dateVal = row["Data"] || row["Date"] || row["data"] || row["date"];
                        let hourVal = row["Ora"] || row["Hour"] || row["ora"] || row["hour"];
                        if (!dateVal || hourVal === undefined) return;
                        
                        let dateObj;
                        if (typeof dateVal === 'number') {
                            dateObj = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
                        } else {
                            const cleanStr = String(dateVal).trim();
                            const parts = cleanStr.split(/[-/.]/);
                            if (parts.length === 3) {
                                let day, month, year;
                                if (parts[2].length === 4) {
                                    day = parseInt(parts[0], 10);
                                    month = parseInt(parts[1], 10);
                                    year = parseInt(parts[2], 10);
                                } else if (parts[0].length === 4) {
                                    year = parseInt(parts[0], 10);
                                    month = parseInt(parts[1], 10);
                                    day = parseInt(parts[2], 10);
                                }
                                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                                    dateObj = new Date(year, month - 1, day);
                                }
                            }
                            if (!dateObj || isNaN(dateObj.getTime())) {
                                dateObj = new Date(cleanStr);
                            }
                        }
                        if (!dateObj || isNaN(dateObj.getTime())) return;
                        
                        const month = dateObj.getMonth() + 1;
                        const day = dateObj.getDate();
                        const hour = parseInt(hourVal) - 1;
                        if (hour < 0 || hour > 23) return;
                        
                        const hourIndex = getHourIndex(month, day, hour);
                        
                        Object.keys(zonesMapping).forEach(zone => {
                            let rawVal = null;
                            const possibleKeys = zonesMapping[zone];
                            for (let key of possibleKeys) {
                                if (row[key] !== undefined) {
                                    rawVal = row[key];
                                    break;
                                }
                            }
                            if (rawVal !== null && rawVal !== undefined) {
                                let cleanVal = String(rawVal).trim().replace(',', '.');
                                let price = parseFloat(cleanVal);
                                if (!isNaN(price)) {
                                    State.zonalPun[zone][hourIndex] = price;
                                    count++;
                                }
                            }
                        });
                    });
                    
                    State._punVersion = (State._punVersion || 0) + 1;
                    alert(`Importazione GME completata! Aggiornati ${count} valori di prezzo zonale.`);
                    renderZonalAverages();
                    triggerRecalculate();
                    
                    Audit.log('gme.import', count + ' prezzi zonali aggiornati');
                    UndoManager.show(`Listino GME importato (${count} prezzi)`, async () => {
                        Object.keys(punBackup).forEach(z => { State.zonalPun[z].set(punBackup[z]); });
                        renderZonalAverages();
                        triggerRecalculate();
                        if (supabaseClient) await saveZonalPunToSupabase();
                        Audit.log('gme.undo_import', 'Ripristino PUN pre-import');
                    });

                    // Save to Supabase in background if connected
                    if (supabaseClient) {
                        saveZonalPunToSupabase();
                    }
                } catch(err) {
                    console.error(err);
                    alert("Errore nel parsing del file GME. Assicurati che sia un listino XLSX valido.");
                }
            };
            reader.readAsArrayBuffer(file);
        };

        function addPlantFromUI() {
            const fileInput = document.getElementById('pvgis-file');
            if (fileInput.files.length === 0 && !window._pvgisApiText) {
                alert("Seleziona un file PVGIS (o scarica i dati da PVGIS API) prima di aggiungere l'impianto.");
                return;
            }
            
            const zone = document.getElementById('plant-zone').value;
            const landType = document.getElementById('plant-land-type').value;
            
            // Validate mandatory dropdowns
            if (zone === 'none') {
                alert("Seleziona una Zona Geografica valida prima di aggiungere l'impianto.");
                return;
            }
            if (landType === 'none') {
                alert("Seleziona una Tipologia Terreno valida prima di aggiungere l'impianto.");
                return;
            }
            
            const name = document.getElementById('plant-name').value;
            const cap = parseFloat(document.getElementById('plant-capacity').value);
            const capex = parseFloat(document.getElementById('plant-capex').value) || 0;
            const opex = parseFloat(document.getElementById('plant-opex').value) || 0;
            const opexOmBess = parseFloat(document.getElementById('plant-opex-om-bess').value) || 0;
            const opexInsurance = parseFloat(document.getElementById('plant-opex-insurance').value) || 0;
            const opexTaxes = parseFloat(document.getElementById('plant-opex-taxes').value) || 0;
            const opexSecurity = parseFloat(document.getElementById('plant-opex-security').value) || 0;
            const opexAssetManagement = parseFloat(document.getElementById('plant-opex-asset-management').value) || 0;
            const connectionCost = parseFloat(document.getElementById('plant-connection-cost').value) || 0;
            const landCost = parseFloat(document.getElementById('plant-land-cost').value) || 0;
            const developmentCost = parseFloat(document.getElementById('plant-development-cost').value) || 0;
            const spvAcquisitionCost = parseFloat(document.getElementById('plant-spv-acquisition-cost').value) || 0;
            
            const bessType = document.getElementById('plant-bess-type').value;
            const bessMw = parseFloat(document.getElementById('plant-bess-mw').value) || 0;
            const bessMwh = parseFloat(document.getElementById('plant-bess-mwh').value) || 0;
            const addHasBess = bessType !== 'none' && bessMwh > 0;
            const bessEfficiency = addHasBess ? ((parseFloat(document.getElementById('plant-bess-efficiency').value) || 0) / 100) : 0;
            const bessDoD = addHasBess ? (parseFloat(document.getElementById('plant-bess-dod').value) || 0) : 0;
            const bessSocMin = addHasBess ? (parseFloat(document.getElementById('plant-bess-soc-min').value) || 0) : 0;
            const bessSocMax = addHasBess ? (parseFloat(document.getElementById('plant-bess-soc-max').value) || 0) : 0;
            const bessDegradation = addHasBess ? ((parseFloat(document.getElementById('plant-bess-degradation').value) || 0) / 100) : 0;
            const bessCapexKwh = addHasBess ? (parseFloat(document.getElementById('plant-bess-capex-kwh').value) || 0) : 0;
            const bessTempMin = addHasBess ? (parseFloat(document.getElementById('plant-bess-temp-min').value) || 0) : 0;
            const bessTempMax = addHasBess ? (parseFloat(document.getElementById('plant-bess-temp-max').value) || 0) : 0;
            const bessCycles = addHasBess ? (parseFloat(document.getElementById('plant-bess-cycles').value) || 0) : 0;
            const bessWarrantyYears = addHasBess ? (parseFloat(document.getElementById('plant-bess-warranty-years').value) || 0) : 0;
            const bessConnection = addHasBess ? document.getElementById('plant-bess-connection').value : 'none';
            const gridConnectionKw = parseFloat(document.getElementById('plant-grid-connection-kw').value) || 0;
            const gridVoltage = document.getElementById('plant-grid-voltage').value;
            const isDcAdd = (document.getElementById('plant-bess-connection').value === 'dc');
            const inverterBrand = document.getElementById('plant-inverter-brand').value;
            const inverterModel = document.getElementById('plant-inverter-model').value;
            const inverterPowerKw = isDcAdd ? 0 : (parseFloat(document.getElementById('plant-inverter-power-kw').value) || 0);
            const inverterEfficiency = parseFloat(document.getElementById('plant-inverter-efficiency').value) || 0;
            const inverterMpptCount = parseFloat(document.getElementById('plant-inverter-mppt-count').value) || 0;
            const inverterMaxDcV = parseFloat(document.getElementById('plant-inverter-max-dc-v').value) || 0;

            const earnoutType = document.getElementById('plant-earnout-type').value;
            const earnoutVal = parseFloat(document.getElementById('plant-earnout-val').value) || 0;
            const earnoutYears = parseInt(document.getElementById('plant-earnout-years').value) || 0;
            const serviceType = document.getElementById('plant-service-type').value;
            const serviceVal = parseFloat(document.getElementById('plant-service-val').value) || 0;
            const serviceYears = parseInt(document.getElementById('plant-service-years').value) || 0;
            const traderContractType = document.getElementById('plant-trader-contract-type').value;
            const traderSpread = parseFloat(document.getElementById('plant-trader-spread-eur-mwh').value) || 0;
            const traderDisp = parseFloat(document.getElementById('plant-trader-disp-eur-mwh').value) || 0;
            const pnrrContributionPct = parseFloat(document.getElementById('plant-pnrr-contribution-pct').value) || 0;
            const degradeRidPct = parseFloat(document.getElementById('plant-degrade-rid').value) || 0;
            const degradeTimeshiftingPct = parseFloat(document.getElementById('plant-degrade-timeshifting').value) || 0;
            const degradeArbitragePct = parseFloat(document.getElementById('plant-degrade-arbitrage').value) || 0;

            const marketType = document.getElementById('plant-market-type').value;
            const ferxTariff = parseFloat(document.getElementById('plant-ferx-tariff').value) || 0;

            const importArgs = [name, cap, zone, capex, opex, connectionCost, landType, landCost, developmentCost, spvAcquisitionCost, bessMw, bessMwh, bessEfficiency, bessDoD, bessSocMin, bessSocMax, bessDegradation, bessCapexKwh, bessTempMin, bessTempMax, bessCycles, bessWarrantyYears, bessType, bessConnection, gridConnectionKw, gridVoltage, inverterBrand, inverterModel, inverterPowerKw, inverterEfficiency, inverterMpptCount, inverterMaxDcV, opexOmBess, opexInsurance, opexTaxes, opexSecurity, opexAssetManagement, earnoutType, earnoutVal, earnoutYears, serviceType, serviceVal, serviceYears, traderContractType, traderSpread, traderDisp, pnrrContributionPct, degradeRidPct, degradeTimeshiftingPct, degradeArbitragePct, marketType, ferxTariff];
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = function(e) {
                    importPvgisCsv(e.target.result, ...importArgs);
                };
                reader.readAsText(file);
            } else {
                // Dati già scaricati da PVGIS API
                const apiText = window._pvgisApiText;
                window._pvgisApiText = null;
                importPvgisCsv(apiText, ...importArgs);
            }
        }

        window.deletePlant = async function(plantId) {
            if (!supabaseClient) {
                alert("Database non connesso. Impossibile eliminare l'impianto.");
                return;
            }
            if (!confirm('Eliminare questo impianto e tutti i relativi dati (inclusi stabilimenti e contratti PPA)?')) return;
            
            // Backup per undo (incluse curve 8760h)
            const plantFound = State.plants.find(p => p.id === plantId);
            const plantBackupClone = plantFound ? structuredClone(plantFound) : null;
            const stabsBackup = State.stabilimenti.filter(s => s.plantId === plantId).map(s => structuredClone(s));
            
            const statusEl = document.getElementById('sync-status');
            statusEl.textContent = "Eliminazione impianto su DB...";
            statusEl.className = "text-xs text-amber-400 font-medium";
            
            try {
                // Find associated stabilimenti
                const stabsToDelete = State.stabilimenti.filter(s => s.plantId === plantId);
                const stabIds = stabsToDelete.map(s => s.id);
                
                if (stabIds.length > 0) {
                    // Delete load curves
                    const { error: errLoad } = await supabaseClient.from('stabilimento_load').delete().in('stabilimento_id', stabIds);
                    if (errLoad) throw errLoad;
                    
                    // Delete stabilimenti
                    const { error: errStab } = await supabaseClient.from('stabilimenti').delete().in('id', stabIds);
                    if (errStab) throw errStab;
                }
                
                // Delete generation profiles
                const { error: errGen } = await supabaseClient.from('plant_generation').delete().eq('plant_id', plantId);
                if (errGen) throw errGen;
                
                // Delete plant itself
                const { error: errPlant } = await supabaseClient.from('plants').delete().eq('id', plantId);
                if (errPlant) throw errPlant;
                
                // Only modify local state on success!
                State.plants = State.plants.filter(p => p.id !== plantId);
                State.stabilimenti = State.stabilimenti.filter(s => s.plantId !== plantId);
                
                Audit.log('plant.delete', plantBackupClone ? plantBackupClone.name : plantId);
                if (plantBackupClone) {
                    UndoManager.show(`Impianto "${plantBackupClone.name}" eliminato`, async () => {
                        await savePlantToSupabase(plantBackupClone);
                        State.plants.push(plantBackupClone);
                        for (const s of stabsBackup) {
                            await saveStabilimentoToSupabase(s);
                            State.stabilimenti.push(s);
                        }
                        renderPlantsList();
                        renderStabilimentiList();
                        renderZonalAverages();
                        triggerRecalculate();
                        Audit.log('plant.undo_delete', plantBackupClone.name);
                    });
                }
                
                statusEl.textContent = "Impianto e dati associati eliminati!";
                statusEl.className = "text-xs text-emerald-400 font-medium";
                setTimeout(() => {
                    statusEl.textContent = "Stato Connessione: Collegato";
                }, 3000);
                
                renderPlantsList();
                renderStabilimentiList();
                renderZonalAverages();
                triggerRecalculate();
            } catch (err) {
                console.error("Errore eliminazione impianto su Supabase:", err);
                statusEl.textContent = "Errore rimozione impianto.";
                statusEl.className = "text-xs text-red-400 font-medium";
                alert(`Errore durante l'eliminazione dell'impianto dal database: ${err.message}`);
            }
        };

        // Cache produzione annua e PUN ponderato per impianto (evita cicli 8760 ad ogni render)
        function getPlantAnnualMwh(p) {
            if (p._cachedGenMwh === undefined) {
                p._cachedGenMwh = p.generation ? (p.generation.reduce((a, b) => a + b, 0) / 1000) : 0;
            }
            return p._cachedGenMwh;
        }

        function getPlantWeightedPun(p) {
            const punVer = State._punVersion || 0;
            if (p._cachedWeightedPun === undefined || p._cachedWeightedPunVer !== punVer) {
                let num = 0, den = 0;
                const zonePrices = State.zonalPun[String(p.zone).toUpperCase()] || State.zonalPun["CNOR"];
                if (p.generation) {
                    for (let t = 0; t < 8760; t++) {
                        num += p.generation[t] * zonePrices[t];
                        den += p.generation[t];
                    }
                }
                p._cachedWeightedPun = den > 0 ? (num / den) : 0;
                p._cachedWeightedPunVer = punVer;
            }
            return p._cachedWeightedPun;
        }

        function renderPlantsList() {
            const body = document.getElementById('plants-table-body');
            if (!body) return;

            // Compute summary metrics (only enabled plants count):
            const enabledPlants = State.plants.filter(p => p.enabled !== false);
            const count = enabledPlants.length;
            let totalKw = 0;
            let totalMwh = 0;
            let totalCapex = 0;

            enabledPlants.forEach(p => {
                totalKw += p.capacity || 0;
                const plantMwh = getPlantAnnualMwh(p);
                totalMwh += plantMwh;

                // Capex elements:
                const epcCapex = (p.capacity || 0) * (p.capex || 0);
                const connectionCost = p.connectionCost || 0;
                const developmentCost = p.developmentCost || 0;
                const spvAcquisitionCost = p.spvAcquisitionCost || 0;
                const landCost = (p.landType === 'acquisto' || p.landType === 'dds_attualizzato') ? (p.landCost || 0) : 0;
                const bessCAPEX = (p.bessMwh || 0) * 1000 * (p.bessCapexKwh || 0);

                totalCapex += epcCapex + connectionCost + developmentCost + spvAcquisitionCost + landCost + bessCAPEX;
            });

            const setTxt = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            const totalCount = State.plants.length;
            const disabledCount = totalCount - count;
            setTxt('val-portfolio-count', count + (disabledCount > 0 ? ` (${disabledCount} esclusi)` : ''));
            setTxt('val-portfolio-mwp', (totalKw / 1000).toFixed(2) + ' MWp');
            setTxt('val-portfolio-mwh', totalMwh.toFixed(0) + ' MWh/a');
            setTxt('val-portfolio-capex', formatEuro(totalCapex));

            if (State.plants.length === 0) {
                body.innerHTML = `<tr><td colspan="13" class="py-4 text-center text-slate-500">Nessun impianto caricato. Aggiungine uno per avviare la simulazione.</td></tr>`;
                return;
            }
            let html = '';
            State.plants.forEach(p => {
                // Calculate individual plant weighted PUN (cached, invalidata ad ogni import PUN)
                const weightedPun = getPlantWeightedPun(p);
                
                const connectionCost = p.connectionCost || 0;
                const landTypeStr = p.landType === 'acquisto' ? 'Acquisto' : (p.landType === 'dds_attualizzato' ? 'DDS Attual.' : 'DDS Annuo');
                const landCostStr = `${landTypeStr}: ${formatEuro(p.landCost || 0)}${p.landType === 'dds_annuo' ? '/a' : ''}`;
                const devCost = p.developmentCost || 0;
                const spvCost = p.spvAcquisitionCost || 0;

                const bessDesc = (p.bessMwh && p.bessMwh > 0) ? `${p.bessMw} MW / ${p.bessMwh} MWh (${p.bessType.toUpperCase()}, ${p.bessConnection.toUpperCase()})` : 'Nessuno';

                const isEditing = p.id === editingPlantId;
                const isEnabled = p.enabled !== false;
                const rowClass = isEditing 
                    ? "bg-emerald-500/10 hover:bg-emerald-500/15 border-l-2 border-emerald-500 font-semibold" 
                    : isEnabled ? "hover:bg-slate-900/40 cursor-pointer" : "opacity-40 hover:opacity-60 hover:bg-slate-900/20 cursor-pointer";

                // Toggle switch HTML
                const toggleTrack = isEnabled
                    ? 'background:#10b981;'
                    : 'background:#1e293b;';
                const toggleThumb = isEnabled
                    ? 'transform:translateX(14px);'
                    : 'transform:translateX(2px);';

                html += `
                    <tr class="${rowClass}" onclick="window.startEditPlant(event, '${p.id}')">
                        <td class="py-2.5 text-center" onclick="event.stopPropagation()">
                            <button
                                onclick="window.togglePlantEnabled('${p.id}')"
                                title="${isEnabled ? 'Escludi dalla simulazione' : 'Includi nella simulazione'}"
                                style="display:inline-flex;align-items:center;width:34px;height:20px;border-radius:10px;border:none;cursor:pointer;padding:0;transition:background 0.2s;${toggleTrack}"
                                aria-pressed="${isEnabled}"
                            >
                                <span style="display:block;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);transition:transform 0.2s;${toggleThumb}"></span>
                            </button>
                        </td>
                        <td class="py-2.5 font-semibold ${isEnabled ? 'text-white' : 'text-slate-500'}">${escapeHtml(p.name)}</td>
                        <td>${p.capacity.toLocaleString('it-IT')} kWp</td>
                        <td><span class="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-bold">${p.zone}</span></td>
                        <td>${formatEuro(p.capacity * p.capex)} (${formatEuro(p.capex)}/kWp)</td>
                        <td>${formatEuro(connectionCost)}</td>
                        <td>${landCostStr}</td>
                        <td>${formatEuro(devCost)}</td>
                        <td>${formatEuro(spvCost)}</td>
                        <td>${formatEuro(p.opex)}</td>
                        <td><span class="px-2 py-0.5 rounded text-[10px] font-medium ${p.bessMwh > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">${bessDesc}</span></td>
                        <td class="text-emerald-400 font-bold">€ ${weightedPun.toFixed(2)}</td>
                        <td class="text-right" onclick="event.stopPropagation()">
                            <button onclick="window.deletePlant('${p.id}')" class="text-red-400 hover:text-red-300 font-bold"><i class="fa-solid fa-trash-can"></i></button>
                        </td>
                    </tr>
                `;
            });
            body.innerHTML = html;
        }

        // Render Deal Value (Enterprise Value) Breakdown Table dynamically
        function renderDealValueBreakdownTable() {
            const headerEl = document.getElementById('deal-value-header');
            const bodyEl = document.getElementById('deal-value-body');
            if (!headerEl || !bodyEl) return;

            const activePlants = State.plants.filter(p => p.enabled !== false);
            if (activePlants.length === 0) {
                bodyEl.innerHTML = `<tr><td class="py-4 text-center text-slate-500">Nessun impianto attivo per la ripartizione del valore deal.</td></tr>`;
                headerEl.innerHTML = '';
                return;
            }

            // 1. Render Header
            let headerHtml = `<th class="frozen-column px-4 py-3 border-r border-slate-800 text-left min-w-[200px] z-30 uppercase tracking-wider text-[10px] text-slate-400" style="background-color: inherit;">Voce di Costo</th>`;
            activePlants.forEach(p => {
                headerHtml += `<th class="px-3 py-3 text-right font-bold text-slate-200 border-b border-slate-800 min-w-[120px] bg-[#020617]">${escapeHtml(p.name)}</th>`;
            });
            headerHtml += `<th class="px-3 py-3 text-right font-bold text-emerald-400 border-b border-slate-800 min-w-[130px] bg-[#020617]">Totale Portafoglio</th>`;
            headerHtml += `<th class="px-3 py-3 text-right font-bold text-slate-400 border-b border-slate-800 min-w-[110px] bg-[#020617]">% Ammortamento</th>`;
            headerHtml += `<th class="px-3 py-3 text-right font-bold text-slate-400 border-b border-slate-800 min-w-[140px] bg-[#020617]">Ammortamento Annuo</th>`;
            headerEl.innerHTML = headerHtml;

            // 2. Prepare Row Data
            const rows = [
                { key: 'epc', label: 'CAPEX EPC (Solare)', depreciable: true },
                { key: 'connection', label: 'Costo Connessione', depreciable: true },
                { key: 'land_purchase', label: 'Costo Terreno (Acquisto)', depreciable: false },
                { key: 'land_dds', label: 'Costo Terreno (DDS Attualizzato)', depreciable: true },
                { key: 'development', label: 'Costo Sviluppo', depreciable: true },
                { key: 'spv', label: 'Costo Acquisizione SPV', depreciable: false },
                { key: 'bess', label: 'CAPEX BESS (Accumulo)', depreciable: true },
                { key: 'total', label: 'VALORE DEAL (Enterprise Value)', isTotal: true }
            ];

            // 3. Compute and Inject values
            let html = '';
            rows.forEach(row => {
                let rowHtml = '';
                let rowTotal = 0;
                
                const isTotal = row.isTotal;
                const trClass = isTotal 
                    ? 'font-extrabold bg-[#0c1a2e] text-slate-100 border-t border-slate-700'
                    : 'bg-[#020617] group hover:bg-[#15223e]';
                const tdClass = isTotal
                    ? 'px-3 py-2.5 text-right font-black text-emerald-400'
                    : 'px-3 py-2 text-right border-b border-slate-800/40 text-slate-350';
                const labelClass = isTotal
                    ? 'frozen-column px-4 py-2.5 text-left font-black text-emerald-400 z-10'
                    : 'frozen-column px-4 py-2 text-left border-r border-slate-800 font-medium z-10 text-slate-400 border-b border-slate-800/40';

                rowHtml += `<tr class="${trClass}">`;
                rowHtml += `<td class="${labelClass}" style="background-color: inherit;">${row.label}</td>`;

                activePlants.forEach(p => {
                    let val = 0;
                    if (row.key === 'epc') {
                        val = (p.capacity || 0) * (p.capex || 0);
                    } else if (row.key === 'connection') {
                        val = p.connectionCost || 0;
                    } else if (row.key === 'land_purchase') {
                        val = (p.landType === 'acquisto') ? (p.landCost || 0) : 0;
                    } else if (row.key === 'land_dds') {
                        val = (p.landType === 'dds_attualizzato') ? (p.landCost || 0) : 0;
                    } else if (row.key === 'development') {
                        val = p.developmentCost || 0;
                    } else if (row.key === 'spv') {
                        val = p.spvAcquisitionCost || 0;
                    } else if (row.key === 'bess') {
                        const plantBessMwh = p.bessMwh !== undefined ? p.bessMwh : 0;
                        const plantBessCapexKwh = p.bessCapexKwh !== undefined ? p.bessCapexKwh : 300;
                        val = plantBessMwh * 1000 * plantBessCapexKwh;
                    } else if (row.isTotal) {
                        const epcVal = (p.capacity || 0) * (p.capex || 0);
                        const connVal = p.connectionCost || 0;
                        const landPurchaseVal = (p.landType === 'acquisto') ? (p.landCost || 0) : 0;
                        const landDdsVal = (p.landType === 'dds_attualizzato') ? (p.landCost || 0) : 0;
                        const devVal = p.developmentCost || 0;
                        const spvVal = p.spvAcquisitionCost || 0;
                        const plantBessMwh = p.bessMwh !== undefined ? p.bessMwh : 0;
                        const plantBessCapexKwh = p.bessCapexKwh !== undefined ? p.bessCapexKwh : 300;
                        const bessVal = plantBessMwh * 1000 * plantBessCapexKwh;
                        val = epcVal + connVal + landPurchaseVal + landDdsVal + devVal + spvVal + bessVal;
                    }
                    rowTotal += val;
                    rowHtml += `<td class="${tdClass}">${formatEuro(val)}</td>`;
                });

                rowHtml += `<td class="${tdClass} ${isTotal ? 'text-emerald-300 font-bold bg-[#0d2238]' : 'text-emerald-400 font-semibold'}" >${formatEuro(rowTotal)}</td>`;
                
                // Add rate and annual depreciation columns
                let depRateHtml = '';
                let depValHtml = '';
                const globalRate = (State.inputs && State.inputs.fiscalDeprRate !== undefined) ? State.inputs.fiscalDeprRate : 0.09;
                if (row.isTotal) {
                    depRateHtml = `<td class="${tdClass}">-</td>`;
                    // Calculate total annual depreciation
                    let totalDep = 0;
                    rows.forEach(r => {
                        if (!r.isTotal && r.depreciable) {
                            activePlants.forEach(p => {
                                let rVal = 0;
                                if (r.key === 'epc') rVal = (p.capacity || 0) * (p.capex || 0);
                                else if (r.key === 'connection') rVal = p.connectionCost || 0;
                                else if (r.key === 'land_dds') rVal = (p.landType === 'dds_attualizzato') ? (p.landCost || 0) : 0;
                                else if (r.key === 'development') rVal = p.developmentCost || 0;
                                else if (r.key === 'bess') {
                                    const plantBessMwh = p.bessMwh !== undefined ? p.bessMwh : 0;
                                    const plantBessCapexKwh = p.bessCapexKwh !== undefined ? p.bessCapexKwh : 300;
                                    rVal = plantBessMwh * 1000 * plantBessCapexKwh;
                                }
                                totalDep += (rVal * globalRate);
                            });
                        }
                    });
                    depValHtml = `<td class="${tdClass} ${isTotal ? 'text-emerald-300 font-bold bg-[#0d2238]' : ''}">${formatEuro(totalDep)}</td>`;
                } else if (row.depreciable) {
                    depRateHtml = `<td class="${tdClass}">${(globalRate * 100).toFixed(1)}%</td>`;
                    depValHtml = `<td class="${tdClass}">${formatEuro(rowTotal * globalRate)}</td>`;
                } else {
                    depRateHtml = `<td class="${tdClass}">0.0%</td>`;
                    depValHtml = `<td class="${tdClass}">${formatEuro(0)}</td>`;
                }
                
                rowHtml += depRateHtml + depValHtml;
                rowHtml += '</tr>';
                html += rowHtml;
            });
            bodyEl.innerHTML = html;
        }

        // Toggle a plant's enabled state and immediately recalculate
        window.togglePlantEnabled = function(plantId) {
            const plant = State.plants.find(p => p.id === plantId);
            if (!plant) return;
            plant.enabled = plant.enabled === false ? true : false;
            
            // Persist enabling flag to config so it saves to database
            const disabled = State.plants.filter(p => p.enabled === false).map(p => p.id);
            State.inputs.disabledPlants = JSON.stringify(disabled);
            
            saveConfigDebounced();
            
            renderPlantsList();
            triggerRecalculate();
        };

        function renderZonalAverages() {
            const body = document.getElementById('zonal-averages-table-body');
            if (!body) return;
            // Reset portfolio medione immediately if no plants
            if (State.plants.length === 0) {
                const medioneEl = document.getElementById('consolidated-medione-kpi');
                if (medioneEl) medioneEl.textContent = 'Medione Ponderato Portafoglio: - (nessun impianto)';
            }
            const months = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
            const zones = ["NORD", "CNOR", "CSUD", "SUD", "SICI", "SARD"];
            
            let html = '';
            for (let m = 0; m < 12; m++) {
                html += `<tr class="hover:bg-slate-900/40"><td class="py-2 px-2 font-medium text-white">${months[m]}</td>`;
                zones.forEach(zone => {
                    // Average prices for the month
                    let sum = 0, count = 0;
                    const days = DAYS_IN_MONTH[m];
                    const startIndex = getHourIndex(m + 1, 1, 0);
                    const endIndex = startIndex + days * 24;
                    for (let t = startIndex; t < endIndex; t++) {
                        sum += State.zonalPun[zone][t];
                        count++;
                    }
                    const avg = count > 0 ? (sum / count) : 0;
                    html += `<td class="font-semibold text-slate-300 text-right">€ ${avg.toFixed(1)}</td>`;
                });
                html += `</tr>`;
            }
            body.innerHTML = html;
        }

        // GME & Zonal PUN Dashboard Functions
        function initGmeState() {
            const activePlants = State.plants ? State.plants.filter(p => p.enabled !== false) : [];
            if (!State.selectedGmePlantIds) {
                State.selectedGmePlantIds = new Set(activePlants.map(p => p.id));
            } else {
                const activeIds = new Set(activePlants.map(p => p.id));
                // Remove obsolete IDs
                for (const id of State.selectedGmePlantIds) {
                    if (!activeIds.has(id)) {
                        State.selectedGmePlantIds.delete(id);
                    }
                }
                // Add new plants if not present
                activePlants.forEach(p => {
                    if (!State.selectedGmePlantIds.has(p.id) && !State.previouslySeenGmePlantIds?.has(p.id)) {
                        State.selectedGmePlantIds.add(p.id);
                    }
                });
            }
            State.previouslySeenGmePlantIds = new Set(activePlants.map(p => p.id));
            
            if (State.selectedGmeMonth === undefined) {
                State.selectedGmeMonth = 'all';
            }
        }

        function getMonthHourRange(month) {
            if (month === 'all') {
                return { start: 0, end: 8760 };
            }
            const mIndex = parseInt(month);
            const days = DAYS_IN_MONTH[mIndex];
            let start = 0;
            for (let m = 0; m < mIndex; m++) {
                start += DAYS_IN_MONTH[m] * 24;
            }
            return { start: start, end: start + days * 24 };
        }

        // ── Suite GME ottimizzata: calcola le metriche di tutti i 12 mesi + anno in un solo passaggio ──
        // (prima renderGmeDashboard + chart invocavano calculateGmeMetrics 25 volte, 25 × 8760 × N impianti)
        function calculateGmeMetricsSuite(selectedPlantIds) {
            const activePlants = State.plants.filter(p => p.enabled !== false && selectedPlantIds.has(p.id));
            const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
            const getMonthOfHour = (t) => {
                for (let m = 0; m < 12; m++) {
                    if (t >= monthStartHours[m] && t < monthStartHours[m+1]) return m;
                }
                return 11;
            };

            const newAcc = () => ({
                solarEnergySum: 0, solarPunValueSum: 0,
                gridFeedPvEnergySum: 0, gridFeedPvRIDValueSum: 0,
                selfConsSolarEnergySum: 0, selfConsSolarRIDValueSum: 0,
                dischargeTsEnergySum: 0, dischargeTsRIDValueSum: 0,
                chargeSolarEnergySum: 0, chargeSolarRIDValueSum: 0,
                dischargeArbEnergySum: 0, dischargeArbRIDValueSum: 0,
                chargeGridEnergySum: 0, chargeGridCostValueSum: 0
            });
            const months = Array.from({ length: 12 }, newAcc);

            activePlants.forEach(p => {
                const zonePrices = State.zonalPun[String(p.zone).toUpperCase()] || State.zonalPun["CNOR"];
                const lossInject = resolveGridLosses(p.gridVoltage, 'inject');
                const lossWithdraw = resolveGridLosses(p.gridVoltage, 'withdraw');
                const lossMult = 1 + (lossInject / 100);
                const gseImb = State.inputs.ridImbalanceCost || 0;
                const spread = p.traderSpread || 0;
                const disp = p.traderDisp || 0;

                const monthlyAveragePun = new Float64Array(12);
                const monthlyCounts = new Int32Array(12);
                for (let h = 0; h < 8760; h++) {
                    const m = getMonthOfHour(h);
                    monthlyAveragePun[m] += zonePrices[h];
                    monthlyCounts[m]++;
                }
                for (let m = 0; m < 12; m++) {
                    if (monthlyCounts[m] > 0) monthlyAveragePun[m] /= monthlyCounts[m];
                }

                const _pmGme = State.results && State.results.plantsMetrics ? State.results.plantsMetrics.find(m2 => m2.id === p.id) : null;
                const sim = (_pmGme && _pmGme.sim) || p.sim || {};
                const gridFeedPv = sim.hourlyGridFeedPv || new Float64Array(8760);
                const selfConsSolar = sim.hourlySelfConsSolar || new Float64Array(8760);
                const chargeSolar = sim.hourlyChargeSolar || new Float64Array(8760);
                const chargeGrid = sim.hourlyChargeGrid || new Float64Array(8760);
                const dischargeArb = sim.hourlyDischargeArbitrage || new Float64Array(8760);
                const dischargeTs = sim.hourlyDischargeTimeshifting || new Float64Array(8760);

                for (let t = 0; t < 8760; t++) {
                    const acc = months[getMonthOfHour(t)];
                    const solar = p.generation[t];
                    const pun = zonePrices[t];
                    const month = getMonthOfHour(t);
                    const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pun;

                    const priceRID = pun * lossMult - gseImb; // €/MWh
                    const costGrid = traderPrice * (1 + lossWithdraw / 100) + spread + disp; // €/MWh

                    acc.solarEnergySum += solar;
                    acc.solarPunValueSum += solar * pun;
                    acc.gridFeedPvEnergySum += gridFeedPv[t];
                    acc.gridFeedPvRIDValueSum += gridFeedPv[t] * priceRID;
                    acc.selfConsSolarEnergySum += selfConsSolar[t];
                    acc.selfConsSolarRIDValueSum += selfConsSolar[t] * priceRID;
                    acc.dischargeTsEnergySum += dischargeTs[t];
                    acc.dischargeTsRIDValueSum += dischargeTs[t] * priceRID;
                    acc.chargeSolarEnergySum += chargeSolar[t];
                    acc.chargeSolarRIDValueSum += chargeSolar[t] * priceRID;
                    acc.dischargeArbEnergySum += dischargeArb[t];
                    acc.dischargeArbRIDValueSum += dischargeArb[t] * priceRID;
                    acc.chargeGridEnergySum += chargeGrid[t];
                    acc.chargeGridCostValueSum += chargeGrid[t] * costGrid;
                }
            });

            const finalize = (a) => {
                const medioneFv = a.solarEnergySum > 0 ? (a.solarPunValueSum / a.solarEnergySum) : 0;
                const ponderatoImmissioneDiretta = a.gridFeedPvEnergySum > 0 ? (a.gridFeedPvRIDValueSum / a.gridFeedPvEnergySum) : 0;
                const ponderatoCessioneStab = a.selfConsSolarEnergySum > 0 ? (a.selfConsSolarRIDValueSum / a.selfConsSolarEnergySum) : 0;
                const weightedDischargeTs = a.dischargeTsEnergySum > 0 ? (a.dischargeTsRIDValueSum / a.dischargeTsEnergySum) : 0;
                const weightedChargeTs = a.chargeSolarEnergySum > 0 ? (a.chargeSolarRIDValueSum / a.chargeSolarEnergySum) : 0;
                const upliftTimeShifting = a.dischargeTsEnergySum > 0 && a.chargeSolarEnergySum > 0 ? (weightedDischargeTs - weightedChargeTs) : 0;
                const weightedDischargeArb = a.dischargeArbEnergySum > 0 ? (a.dischargeArbRIDValueSum / a.dischargeArbEnergySum) : 0;
                const weightedCostChargeArb = a.chargeGridEnergySum > 0 ? (a.chargeGridCostValueSum / a.chargeGridEnergySum) : 0;
                const margineArbitraggio = a.dischargeArbEnergySum > 0 && a.chargeGridEnergySum > 0 ? (weightedDischargeArb - weightedCostChargeArb) : 0;
                return { medioneFv, ponderatoImmissioneDiretta, ponderatoCessioneStab, upliftTimeShifting, margineArbitraggio };
            };

            const annualAcc = newAcc();
            months.forEach(ma => { Object.keys(ma).forEach(k => { annualAcc[k] += ma[k]; }); });
            return { monthly: months.map(finalize), annual: finalize(annualAcc) };
        }

        // Cache della suite invalidata ad ogni nuovo risultato worker / cambio selezione impianti
        function getGmeSuite() {
            const sel = State.selectedGmePlantIds || new Set();
            const selKey = Array.from(sel).sort().join('|');
            const cache = State._gmeSuiteCache;
            if (cache && cache.results === State.results && cache.selKey === selKey && cache.punVer === (State._punVersion || 0)) {
                return cache.suite;
            }
            const suite = calculateGmeMetricsSuite(sel);
            State._gmeSuiteCache = { results: State.results, selKey, punVer: (State._punVersion || 0), suite };
            return suite;
        }

        function toggleGmePlantsDropdown() {
            const menu = document.getElementById('gme-plants-dropdown-menu');
            if (menu) {
                menu.classList.toggle('hidden');
            }
        }

        function renderGmePlantsDropdown() {
            const menu = document.getElementById('gme-plants-dropdown-menu');
            if (!menu) return;

            const activePlants = State.plants ? State.plants.filter(p => p.enabled !== false) : [];
            menu.innerHTML = '';

            if (activePlants.length === 0) {
                menu.innerHTML = '<div class="text-[10px] text-slate-500 px-2 py-1.5 text-center">Nessun impianto attivo</div>';
                const label = document.getElementById('gme-plants-dropdown-label');
                if (label) label.textContent = "-";
                return;
            }

            if (!State.selectedGmePlantIds) {
                State.selectedGmePlantIds = new Set(activePlants.map(p => p.id));
            }

            // 1. "Seleziona Tutti" option
            const allSelected = activePlants.every(p => State.selectedGmePlantIds.has(p.id));
            const selectAllDiv = document.createElement('div');
            selectAllDiv.className = "flex items-center space-x-2 px-2 py-1 hover:bg-slate-900 rounded cursor-pointer transition-colors border-b border-slate-900 pb-1.5 mb-1";
            selectAllDiv.innerHTML = `
                <input type="checkbox" id="chk-gme-plant-all" ${allSelected ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950">
                <label for="chk-gme-plant-all" class="text-xs text-slate-200 font-semibold cursor-pointer select-none">Seleziona Tutti</label>
            `;
            selectAllDiv.querySelector('input').addEventListener('change', function(e) {
                const checked = e.target.checked;
                if (checked) {
                    activePlants.forEach(p => State.selectedGmePlantIds.add(p.id));
                } else {
                    State.selectedGmePlantIds.clear();
                }
                renderGmePlantsDropdown();
                renderGmeDashboard();
            });
            menu.appendChild(selectAllDiv);

            // 2. Individual plant options
            activePlants.forEach(plant => {
                const isSelected = State.selectedGmePlantIds.has(plant.id);
                const plantDiv = document.createElement('div');
                plantDiv.className = "flex items-center space-x-2 px-2 py-1 hover:bg-slate-900 rounded cursor-pointer transition-colors";
                plantDiv.innerHTML = `
                    <input type="checkbox" id="chk-gme-plant-${plant.id}" ${isSelected ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950">
                    <label for="chk-gme-plant-${plant.id}" class="text-xs text-slate-300 truncate cursor-pointer select-none w-full">${escapeHtml(plant.name)}</label>
                `;
                plantDiv.querySelector('input').addEventListener('change', function(e) {
                    const checked = e.target.checked;
                    if (checked) {
                        State.selectedGmePlantIds.add(plant.id);
                    } else {
                        State.selectedGmePlantIds.delete(plant.id);
                    }
                    renderGmePlantsDropdown();
                    renderGmeDashboard();
                });
                menu.appendChild(plantDiv);
            });

            // Update button label
            const label = document.getElementById('gme-plants-dropdown-label');
            if (label) {
                const selectedCount = Array.from(State.selectedGmePlantIds).filter(id => activePlants.some(p => p.id === id)).length;
                if (selectedCount === activePlants.length) {
                    label.textContent = "Tutti";
                } else if (selectedCount === 0) {
                    label.textContent = "Nessuno";
                } else if (selectedCount === 1) {
                    const singleId = Array.from(State.selectedGmePlantIds).find(id => activePlants.some(p => p.id === id));
                    const plant = activePlants.find(p => p.id === singleId);
                    label.textContent = plant ? plant.name : "1 Impianto";
                } else {
                    label.textContent = `${selectedCount} Impianti`;
                }
            }
        }

        function changeGmeMonth(value) {
            State.selectedGmeMonth = value;
            renderGmeDashboard();
        }

        function renderGmeDashboard() {
            initGmeState();
            
            const activePlants = State.plants.filter(p => p.enabled !== false);
            if (activePlants.length === 0) {
                document.getElementById('gme-kpi-medione-fv').textContent = "€ 0.00";
                document.getElementById('gme-kpi-imm-diretta').textContent = "€ 0.00";
                document.getElementById('gme-kpi-cessione-stab').textContent = "€ 0.00";
                document.getElementById('gme-kpi-uplift-ts').textContent = "€ 0.00";
                document.getElementById('gme-kpi-margine-arb').textContent = "€ 0.00";
                const tbody = document.getElementById('gme-performance-table-body');
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-500">Nessun impianto attivo.</td></tr>`;
                return;
            }

            renderGmePlantsDropdown();

            const gmeSuite = getGmeSuite();
            const metrics = (State.selectedGmeMonth === 'all' || State.selectedGmeMonth === undefined)
                ? gmeSuite.annual
                : gmeSuite.monthly[parseInt(State.selectedGmeMonth)];

            // Dynamic CER label update
            const activeStabsGme = State.stabilimenti.filter(s => s.enabled !== false);
            const isCerGme = activeStabsGme.some(s => s.ppaType === 'cer');
            const cessioneCardLabel = document.querySelector('#gme-kpi-cessione-stab')?.previousElementSibling;
            if (cessioneCardLabel) {
                cessioneCardLabel.textContent = isCerGme ? 'Condivisione CER' : 'Cessione Stab.';
            }
            const cessioneCardSubLabel = document.querySelector('#gme-kpi-cessione-stab')?.nextElementSibling;
            if (cessioneCardSubLabel) {
                cessioneCardSubLabel.textContent = isCerGme ? 'PUN opportunit\u00E0 energia condivisa' : 'Costo opp. se immessa in rete';
            }
            // Update table header
            const gmeTableHeaders = document.querySelectorAll('#tab-gme thead th');
            gmeTableHeaders.forEach(th => {
                if (th.textContent.trim() === 'Cessione Stab.') th.textContent = isCerGme ? 'Cond. CER' : 'Cessione Stab.';
                else if (th.textContent.trim() === 'Cond. CER' && !isCerGme) th.textContent = 'Cessione Stab.';
            });
            
            const setVal = (id, val, isUplift = false) => {
                const el = document.getElementById(id);
                if (el) {
                    const sign = isUplift && val > 0 ? '+' : '';
                    el.textContent = `${sign}€ ${val.toFixed(2)}`;
                }
            };
            setVal('gme-kpi-medione-fv', metrics.medioneFv);
            setVal('gme-kpi-imm-diretta', metrics.ponderatoImmissioneDiretta);
            setVal('gme-kpi-cessione-stab', metrics.ponderatoCessioneStab);
            setVal('gme-kpi-uplift-ts', metrics.upliftTimeShifting, true);
            setVal('gme-kpi-margine-arb', metrics.margineArbitraggio, true);

            const tbody = document.getElementById('gme-performance-table-body');
            if (tbody) {
                const months = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
                let tableHtml = '';
                
                for (let m = 0; m < 12; m++) {
                    const mMetrics = gmeSuite.monthly[m];
                    const isSelected = State.selectedGmeMonth === String(m);
                    const rowBg = isSelected ? 'bg-slate-900/60 font-bold border-l-2 border-emerald-500' : 'hover:bg-slate-900/40';
                    tableHtml += `
                        <tr class="${rowBg}">
                            <td class="py-2 px-2 font-medium text-white">${months[m]}</td>
                            <td class="text-right font-mono">€ ${mMetrics.medioneFv.toFixed(2)}</td>
                            <td class="text-right font-mono text-orange-400">€ ${mMetrics.ponderatoImmissioneDiretta.toFixed(2)}</td>
                            <td class="text-right font-mono text-purple-400">€ ${mMetrics.ponderatoCessioneStab.toFixed(2)}</td>
                            <td class="text-right font-mono text-sky-400">${mMetrics.upliftTimeShifting > 0 ? '+' : ''}€ ${mMetrics.upliftTimeShifting.toFixed(2)}</td>
                            <td class="text-right font-mono text-emerald-400">${mMetrics.margineArbitraggio > 0 ? '+' : ''}€ ${mMetrics.margineArbitraggio.toFixed(2)}</td>
                        </tr>
                    `;
                }

                const yMetrics = gmeSuite.annual;
                const isAllSelected = State.selectedGmeMonth === 'all';
                const yRowBg = isAllSelected ? 'bg-emerald-950/20 font-bold border-l-2 border-emerald-500' : 'bg-slate-950 font-bold';
                tableHtml += `
                    <tr class="${yRowBg} border-t border-slate-700">
                        <td class="py-2.5 px-2 text-emerald-400">CONSOLIDATO ANNO</td>
                        <td class="text-right font-mono text-emerald-400">€ ${yMetrics.medioneFv.toFixed(2)}</td>
                        <td class="text-right font-mono text-orange-400">€ ${yMetrics.ponderatoImmissioneDiretta.toFixed(2)}</td>
                        <td class="text-right font-mono text-purple-400">€ ${yMetrics.ponderatoCessioneStab.toFixed(2)}</td>
                        <td class="text-right font-mono text-sky-400">${yMetrics.upliftTimeShifting > 0 ? '+' : ''}€ ${yMetrics.upliftTimeShifting.toFixed(2)}</td>
                        <td class="text-right font-mono text-emerald-400">${yMetrics.margineArbitraggio > 0 ? '+' : ''}€ ${yMetrics.margineArbitraggio.toFixed(2)}</td>
                    </tr>
                `;
                tbody.innerHTML = tableHtml;
            }

            const tab = document.getElementById('tab-gme');
            if (tab && tab.classList.contains('active')) {
                updateGmeDashboardChart();
            }
        }

        function updateGmeDashboardChart() {
            const canvas = document.getElementById('chart-gme-trend');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            if (State.gmeChartInstance) {
                State.gmeChartInstance.destroy();
                State.gmeChartInstance = null;
            }

            const monthsShort = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
            const dataMedioneFv = [];
            const dataImmDiretta = [];
            const dataCessioneStab = [];
            const dataUpliftTs = [];
            const dataMargineArb = [];

            const gmeSuiteChart = getGmeSuite();
            for (let m = 0; m < 12; m++) {
                const mMetrics = gmeSuiteChart.monthly[m];
                dataMedioneFv.push(mMetrics.medioneFv);
                dataImmDiretta.push(mMetrics.ponderatoImmissioneDiretta);
                dataCessioneStab.push(mMetrics.ponderatoCessioneStab);
                dataUpliftTs.push(mMetrics.upliftTimeShifting);
                dataMargineArb.push(mMetrics.margineArbitraggio);
            }

            State.gmeChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: monthsShort,
                    datasets: [
                        {
                            label: 'Medione Ponderato FV',
                            data: dataMedioneFv,
                            type: 'line',
                            borderColor: '#ca8a04',
                            borderWidth: 2,
                            backgroundColor: 'transparent',
                            pointRadius: 3,
                            tension: 0.15
                        },
                        {
                            label: 'PUN Imm. Diretta',
                            data: dataImmDiretta,
                            type: 'line',
                            borderColor: '#f97316',
                            borderWidth: 2,
                            backgroundColor: 'transparent',
                            pointRadius: 3,
                            tension: 0.15
                        },
                        {
                            label: (() => { const as2 = State.stabilimenti.filter(s => s.enabled !== false); return as2.some(s => s.ppaType === 'cer') ? 'Condivisione CER' : 'Cessione Stabilimento'; })(),
                            data: dataCessioneStab,
                            type: 'line',
                            borderColor: '#a855f7',
                            borderWidth: 2,
                            backgroundColor: 'transparent',
                            pointRadius: 3,
                            tension: 0.15
                        },
                        {
                            label: 'Uplift Time Shifting',
                            data: dataUpliftTs,
                            backgroundColor: 'rgba(56, 189, 248, 0.35)',
                            borderColor: '#38bdf8',
                            borderWidth: 1
                        },
                        {
                            label: 'Margine Arbitraggio',
                            data: dataMargineArb,
                            backgroundColor: 'rgba(16, 185, 129, 0.35)',
                            borderColor: '#10b981',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            type: 'linear',
                            title: { display: true, text: 'Valore (€/MWh)', color: '#94a3b8', font: { size: 10 } },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#cbd5e1', font: { size: 9 } }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#cbd5e1', font: { size: 9 } }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: '#cbd5e1',
                                font: { size: 9 },
                                boxWidth: 12
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += '€ ' + context.parsed.y.toFixed(2) + '/MWh';
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Core Financial Calculation Engine
        // ── Helper: build a zeroed results object ──

        // ── Helper: render zero state in all tabs when no plants are loaded ──
        function renderZeroState() {
            // Re-render table skeletons with dynamic labels based on active inputs
            initializeTableSkeletons();

            const p = State.inputs;
            const setTxt = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

            setTxt('val-portfolio-count', '0');
            setTxt('val-portfolio-mwp', '0.00 MWp');
            setTxt('val-portfolio-mwh', '0 MWh/a');
            setTxt('val-portfolio-capex', '€ 0');

            setTxt('val-total-plants-count', '0');
            setTxt('val-total-solar-mw', '0.00 MWp');
            setTxt('val-total-solar-gen-mwh', '0 MWh');
            setTxt('val-avg-yield-kwh-kwp', '0 kWh/kWp');

            setTxt('val-total-bess-mw',  '0.0 MW');
            setTxt('val-total-bess-mwh', '0.0 MWh');
            setTxt('val-leverage', (p.leverage * 100) + ' %');
            setTxt('val-interest', (p.interestRate * 100).toFixed(2) + ' %');
            setTxt('val-loan-term', p.loanTerm + ' Anni');
            setTxt('val-senior-grace-period', p.seniorGracePeriodMonths + " Mesi");
            setTxt('val-construction-months', p.constructionMonths + " Mesi");
            setTxt('val-idc-drawdown', p.idcDrawdownFactor + " %");
            setTxt('val-fiscal-depreciation', (p.fiscalDeprRate * 100).toFixed(1) + ' %');
            setTxt('val-soci-equity-pct', p.sociEquityPct + " % dell'Equity");
            setTxt('val-soci-interest-rate', p.sociInterestRate.toFixed(2) + " %");
            window.updateExternalFinancingLabels(p);
            setTxt('kpi-total-cost',  '\u20ac 0');
            setTxt('kpi-equity-req',  '\u20ac 0');
            setTxt('kpi-debt-amt',    '\u20ac 0');
            setTxt('sub-kpi-equity-pct', '0% Quota Sponsor');
            setTxt('sub-kpi-debt-pct',   '0% di Leva');
            setTxt('kpi-project-irr', '\u2014');
            setTxt('kpi-irr',     '\u2014');
            setTxt('kpi-npv',     '\u20ac 0');
            setTxt('kpi-moic',    '0.00x');
            setTxt('kpi-payback', 'N/A');
            setTxt('kpi-lcoe',    '€ 0.00 /MWh');
            setTxt('kpi-lcos',    '€ 0.00 /MWh');
            setTxt('kpi-dscr',    'N/A');
            setTxt('sub-kpi-dscr', 'Nessun impianto caricato');
            const dscrCard = document.getElementById('card-dscr');
            if (dscrCard) dscrCard.className = 'bg-slate-900 border border-slate-850 p-4 rounded-xl';
            const dscrAlert = document.getElementById('dscr-breach-alert');
            if (dscrAlert) dscrAlert.classList.add('hidden');

            const medioneEl = document.getElementById('consolidated-medione-kpi');
            if (medioneEl) medioneEl.textContent = 'Medione Ponderato Portafoglio: \u2014 (nessun impianto)';

            // Zero out Deal Value breakdown table
            const breakdownBody = document.getElementById('deal-value-body');
            const breakdownHeader = document.getElementById('deal-value-header');
            if (breakdownBody) breakdownBody.innerHTML = `<tr><td class="py-4 text-center text-slate-500">Nessun impianto caricato per il calcolo del valore deal.</td></tr>`;
            if (breakdownHeader) breakdownHeader.innerHTML = '';

            // Zero P&L and Debt table cells directly (avoids crash from incomplete matrix)
            const pnlKeys = ['qtyEnergyGroup', 'priceEnergyGroup', 'qtySolarGen', 'qtySolarPpa', 'qtySolarRid', 'qtySolarToBess',
                'qtyBessDischarge', 'qtyBessSelfCons', 'qtyBessSelfConsArb', 'qtyBessSelfConsTs', 'qtyBessGridFeed', 'qtyBessGridFeedArb', 'qtyBessGridFeedTs', 'qtyBessChargeGrid', 'qtyBessLosses',
                'priceSolarAvg', 'priceSolarPpa', 'priceSolarRid', 'priceBessAvg',
                'priceBessPpa', 'priceBessRid', 'priceBessArbitrage', 'priceBessTimeshifting', 'priceBessChargeGrid',
                'revenueTotal',
                'revenueTimeshifting','revenueRid','revenuePpa', 'revenuePpaPv', 'revenuePpaBessArb', 'revenuePpaBessTs', 'revenueArbitrage', 'revenueMsd',
                'opexPlants','opexBess','opexGridCharging','opexLandDds',
                'opexInsurance','opexTaxes','opexSecurity','opexAssetManagement','opexServiceContract',
                'ebitda','depreciationCivil','depreciationCivilSolar','depreciationCivilBess','depreciationCivilOther','ebit','interestActive','interest',
                'sociInterestAccrued','ebt','currentTaxesSpv','deferredTaxes','netProfitSpv','cfads',
                'afInterestAccrued','peRoyalty','afFee',
                'pdInterestPaid','pdPrincipalPaid','peDividendPaid',
                'opexMaintReserve','interestPaid','principalScheduled','principalVoluntary',
                'dsraDraw','dsraFunding','dsraRelease',
                'holdcoInterestReceived','holdcoLoanRepaymentReceived','spvLockedDividends','holdcoDividendReceived',
                'dividendsPaid',
                'holdcoInflowTotal','holdcoOpex','holdcoEarnoutPaid','holdcoIresTaxPaid','holdcoNetProfit',
                'exitValuationGroup', 'exitEnterpriseValue', 'exitDebtPayoff', 'exitPexTaxRow',
                'pdBulletPayoff','peExitShare','afExitCost',
                'exitLimitedLiability',
                'holdcoFCFE','holdcoFCFECumulated'];
            const debtKeys = ['beginningBalance','interestAccrued','principalScheduled',
                'principalVoluntary','endingBalance','totalDebtService','dscr',
                'beginningBalanceSoci','interestAccruedSoci','interestPaidSoci',
                'principalPaidSoci','endingBalanceSoci',
                'beginningBalancePd','interestAccruedPd','interestPaidPd','principalPaidPd','endingBalancePd','dsraBalance'];
            for (let yr = 1; yr <= 20; yr++) {
                pnlKeys.forEach(k => { const el = document.getElementById(`cell-pnl-${k}-y${yr}`); if (el) el.textContent = '\u2014'; });
                debtKeys.forEach(k => { const el = document.getElementById(`cell-debt-${k}-y${yr}`); if (el) el.textContent = '\u2014'; });
            }

            // Render empty chart
            const emptyMatrix = { 
                years: Array.from({length:20},(_,i)=>i+1), 
                holdcoFCFE: new Array(20).fill(0),
                revenuePpa: new Array(20).fill(0),
                revenueRid: new Array(20).fill(0),
                revenueArbitrage: new Array(20).fill(0),
                revenueTimeshifting: new Array(20).fill(0)
            };
            const emptyDebt   = { dscr: new Array(20).fill(-1) };
            renderChart(emptyMatrix, emptyDebt);

            if (typeof renderHourlyProfileChart === 'function') renderHourlyProfileChart();
        }

        // Core Financial Calculation Engine

        // IRR Calculator

        // Setup matrix table skeletons (With sticky label column freezing)
        function initializeTableSkeletons() {
            const debtBody = document.getElementById('debt-body');
            if (!debtBody) return;
            const p = State.inputs;
            // exitOption '0' = Nessun Exit -> mostra comunque tutti i 20 anni
            const _exitOptIntSkel = parseInt(p.exitOption);
            const yearsLimit = (p.exitOption && p.exitOption !== 'none' && !isNaN(_exitOptIntSkel) && _exitOptIntSkel > 0) ? _exitOptIntSkel : 20;

            const activeStabs = State.stabilimenti.filter(s => s.enabled !== false);
            const isCER = activeStabs.some(s => s.ppaType === 'cer');

            const pnlRowsKPIs = [
                // ── QUANTITATIVI DI ENERGIA (MWh) ──────────────────────────────────────
                { key: 'qtyEnergyGroup', label: 'QUANTITATIVI DI ENERGIA (MWh)', type: 'group-header' },
                { key: 'qtySolarGen', label: 'Produzione Fotovoltaica Totale (MWh)', type: 'bold', parent: 'qtyEnergyGroup' },
                { key: 'qtySolarPpa', label: isCER ? 'di cui: Energia FV Condivisa CER (MWh)' : 'di cui: Energia FV in Autoconsumo / PPA (MWh)', type: 'detail', parent: 'qtySolarGen' },
                { key: 'qtySolarRid', label: 'di cui: Energia FV immessa in Rete / RID (MWh)', type: 'detail', parent: 'qtySolarGen' },
                { key: 'qtySolarToBess', label: 'di cui: Energia FV per Carica BESS (MWh)', type: 'detail', parent: 'qtySolarGen' },
                
                { key: 'qtyBessDischarge', label: 'Scarica BESS Totale (MWh)', type: 'bold', parent: 'qtyEnergyGroup' },
                { key: 'qtyBessSelfCons', label: isCER ? 'di cui: Scarica BESS Condivisa CER (MWh)' : 'di cui: Scarica BESS per Autoconsumo / PPA (MWh)', type: 'detail', parent: 'qtyBessDischarge' },
                ...(isCER ? [
                    { key: 'qtyBessSelfConsArb', label: '  - di cui: CER BESS da Arbitraggio (MWh)', type: 'detail-sub', parent: 'qtyBessSelfCons' },
                    { key: 'qtyBessSelfConsTs', label: '  - di cui: CER BESS da Timeshifting (MWh)', type: 'detail-sub', parent: 'qtyBessSelfCons' }
                ] : []),
                { key: 'qtyBessGridFeed', label: 'di cui: Scarica BESS immessa in Rete / RID (MWh)', type: 'detail', parent: 'qtyBessDischarge' },
                { key: 'qtyBessGridFeedArb', label: '  - di cui: Scarica Rete da Arbitraggio (MWh)', type: 'detail-sub', parent: 'qtyBessGridFeed' },
                { key: 'qtyBessGridFeedTs', label: '  - di cui: Scarica Rete da Timeshifting (MWh)', type: 'detail-sub', parent: 'qtyBessGridFeed' },
                
                { key: 'qtyBessChargeGrid', label: 'Carica BESS da Rete (MWh)', type: 'detail', parent: 'qtyEnergyGroup' },
                { key: 'qtyBessLosses', label: 'Perdite di Efficienza BESS (RTE) (MWh)', type: 'minus', parent: 'qtyEnergyGroup' },

                // ── VALORI UNITARI DI RICAVO (€/MWh) ───────────────────────────────────
                { key: 'priceEnergyGroup', label: 'VALORI UNITARI DI RICAVO & COSTO (€/MWh)', type: 'group-header' },
                { key: 'priceSolarAvg', label: 'Valore Unitario Medio Ponderato FV (€/MWh)', type: 'bold', parent: 'priceEnergyGroup' },
                { key: 'priceSolarPpa', label: isCER ? 'Prezzo Unitario CER FV (€/MWh)' : 'Prezzo Unitario PPA On-Site FV (€/MWh)', type: 'detail', parent: 'priceSolarAvg' },
                { key: 'priceSolarRid', label: 'Prezzo Unitario RID FV (€/MWh)', type: 'detail', parent: 'priceSolarAvg' },
                
                { key: 'priceBessAvg', label: 'Valore Unitario Medio Ponderato BESS (€/MWh)', type: 'bold', parent: 'priceEnergyGroup' },
                { key: 'priceBessPpa', label: isCER ? 'Prezzo Unitario CER BESS (€/MWh)' : 'Prezzo Unitario PPA On-Site BESS (€/MWh)', type: 'detail', parent: 'priceBessAvg' },
                { key: 'priceBessRid', label: 'Prezzo Unitario RID BESS (Arbitraggio + Time Shifting) (€/MWh)', type: 'detail', parent: 'priceBessAvg' },
                { key: 'priceBessArbitrage', label: 'di cui: Valore Arbitraggio Puro (€/MWh)', type: 'detail-sub', parent: 'priceBessRid' },
                { key: 'priceBessTimeshifting', label: 'di cui: Valore Time Shifting (€/MWh)', type: 'detail-sub', parent: 'priceBessRid' },
                
                { key: 'priceBessChargeGrid', label: 'Costo Unitario Prelievo da Rete BESS (€/MWh)', type: 'detail', parent: 'priceEnergyGroup' }
            ];

            const pnlRowsA = [
                { key: 'revenueTotal', label: 'RICAVI TOTALI SPV (€)', type: 'group-header' },
                { key: 'revenueRid',       label: 'di cui: Ricavi da RID generato da FV (€)', type: 'detail', parent: 'revenueTotal' },
                { key: 'revenuePpa',       label: isCER ? 'di cui: Ricavi da CER (Condivisione Energia) (€)' : 'di cui: Ricavi da PPA (FV + BESS) (€)', type: 'detail', parent: 'revenueTotal' },
                ...(isCER ? [
                    { key: 'revenuePpaPv',     label: '  - di cui: Ricavi CER da FV (€)', type: 'detail-sub', parent: 'revenuePpa' },
                    { key: 'revenuePpaBessArb', label: '  - di cui: Ricavi CER da BESS da Arbitraggio (€)', type: 'detail-sub', parent: 'revenuePpa' },
                    { key: 'revenuePpaBessTs',  label: '  - di cui: Ricavi CER da BESS da Timeshifting (€)', type: 'detail-sub', parent: 'revenuePpa' }
                ] : []),
                { key: 'revenueTimeshifting', label: 'di cui: Ricavi da Time Shifting (€)', type: 'detail', parent: 'revenueTotal' },
                { key: 'revenueArbitrage', label: 'di cui: Ricavi da Arbitraggio (€)', type: 'detail', parent: 'revenueTotal' },
                { key: 'revenueMsd', label: 'di cui: Ricavi Servizi Ancillari BESS - MSD / Capacity (€)', type: 'detail', parent: 'revenueTotal' },
                
                { key: 'opexTotal', label: '(-) COSTI OPERATIVI (OPEX) TOTALE SPV (€)', type: 'group-header' },
                { key: 'opexPlants', label: 'di cui: O&M Impianti Fotovoltaici (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexBess', label: 'di cui: Costi Operativi BESS (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexGridCharging', label: 'di cui: Costo Energia Pre-carica da Rete BESS (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexLandDds', label: 'di cui: Canone DDS/Affitto Terreno (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexInsurance', label: 'di cui: Assicurazione (All Risk / RC) (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexTaxes', label: 'di cui: Tasse Locali / IMU (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexSecurity', label: 'di cui: Vigilanza & Sicurezza (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexAssetManagement', label: 'di cui: Gestione Amministrativa & Asset Mgt (€)', type: 'detail', parent: 'opexTotal' },
                { key: 'opexServiceContract', label: isCER ? 'di cui: Contratto di Servizio Commerciale CER (€)' : 'di cui: Contratto di Servizio Commerciale PPA (€)', type: 'detail', parent: 'opexTotal' },
                ...(p.peEnabled && p.peMode === 'royalty_fee' ? [{ key: 'peRoyalty', label: 'di cui: Royalty Private Equity (% Ricavi) (€)', type: 'detail', parent: 'opexTotal' }] : []),
                ...(p.afEnabled && p.afType === 'advisory_fee' ? [{ key: 'afFee', label: 'di cui: Advisory Fee (Altra Forma Parasociale) (€)', type: 'detail', parent: 'opexTotal' }] : []),
                
                { key: 'ebitda', label: 'EBITDA SPV (€)', type: 'bold' },
                { key: 'depreciationCivil', label: '(-) Ammortamento Civilistico (€)', type: 'group-header' },
                { key: 'depreciationCivilSolar', label: 'di cui: Ammortamento Impianti Solari (€)', type: 'detail', parent: 'depreciationCivil' },
                { key: 'depreciationCivilBess', label: 'di cui: Ammortamento BESS (€)', type: 'detail', parent: 'depreciationCivil' },
                { key: 'depreciationCivilOther', label: 'di cui: Ammortamento Altri Costi Capitalizzati (€)', type: 'detail', parent: 'depreciationCivil' },
                
                { key: 'ebit', label: 'EBIT SPV (Risultato Operativo) (€)', type: 'bold' },
                { key: 'interestActive', label: '  (+) Interessi Attivi su MRA (€)', type: 'plus' },
                { key: 'interest', label: '  (-) Interessi Passivi Mutuo Bancario (€)', type: 'minus' },
                { key: 'sociInterestAccrued', label: `  (-) Interessi Finanziamento Soci (Accrual) (${p.sociInterestRate > 0 ? p.sociInterestRate.toFixed(2) + '%' : 'Nessuno'}) (€)`, type: 'minus' },
                ...(p.afEnabled && p.afType === 'convertible_note' ? [{ key: 'afInterestAccrued', label: `  (-) Interessi Convertibile (Altra Forma) PIK ${(p.afConvertibleRate||0).toFixed(2)}% (€)`, type: 'minus' }] : []),
                { key: 'ebt', label: 'EBT - Utile ante Imposte SPV (€)', type: 'bold' },
                { key: 'currentTaxesSpv', label: '  (-) Imposte Correnti SPV (IRES 24% + IRAP 3.9%) (€)', type: 'minus' },
                { key: 'iresTaxSpv', label: 'di cui: IRES (24% su EBT +/- Variazioni Fiscali) (€)', type: 'detail', parent: 'currentTaxesSpv' },
                { key: 'irapTaxSpv', label: 'di cui: IRAP (3.9% su EBIT + Costi Indeducibili) (€)', type: 'detail', parent: 'currentTaxesSpv' },
                { key: 'deferredTaxes', label: '  (-/+) Variazione Imposte Differite (-> Sez. B) (€)', type: 'normal' },
                { key: 'netProfitSpv', label: 'UTILE NETTO CIVILISTICO SPV (-> Sez. B) (€)', type: 'bold' }
            ];

            const pnlRowsB = [
                { key: 'rf_netProfitSpv', label: '-> Utile Netto Civilistico SPV (da Sez. A) (€)', type: 'detail' },
                { key: 'rf_depreciationCivil', label: '  (+) Ripresa Ammortamento Civilistico (Non-Cash) (€)', type: 'plus' },
                { key: 'rf_deferredTaxes', label: '  (+/Scale) Ripresa Imposte Differite (da Sez. A) (€)', type: 'normal' },
                { key: 'rf_interest', label: '  (+) Ripresa Interessi Mutuo Bancario Senior (Accrual) (€)', type: 'plus' },
                { key: 'rf_sociInterestAccrued', label: '  (+) Ripresa Interessi Finanziamento Soci (Accrual) (€)', type: 'plus' },
                ...(p.afEnabled && p.afType === 'convertible_note' ? [{ key: 'rf_afInterestAccrued', label: '  (+) Ripresa Interessi Convertibile (Altra Forma) (€)', type: 'plus' }] : []),
                { key: 'opexMaintReserve', label: '  (-) Accantonamento a Riserva di Manutenzione (MRA) (€)', type: 'minus' },
                { key: 'bessAugmentationCost', label: '  (-) CAPEX Sostituzione Celle NMC/LFP BESS (€)', type: 'minus' },
                { key: 'mraRelease', label: '  (+) Rilascio Riserva di Manutenzione (MRA) per CAPEX BESS (€)', type: 'plus' },
                { key: 'cfads', label: 'CFADS SPV (Cassa Disponibile ante Servizio Debito) (€)', type: 'bold-teal' },
                ...((p.dsraMonths || 0) > 0 ? [{ key: 'dsraDraw', label: '  (+) Utilizzo DSRA a copertura servizio debito (€)', type: 'plus' }] : []),

                // ── SERVIZIO DEL DEBITO SENIOR E CASSA ECCEDENTE SPV ───────────────────
                { section: 'SERVIZIO DEL DEBITO SENIOR MUTUO BANCARIO SPV', type: 'section-title' },
                { key: 'interestPaid', label: '  (-) Quota Interessi Mutuo Bancario Pagati (€)', type: 'minus' },
                { key: 'principalScheduled', label: '  (-) Quota Capitale Mutuo Bancario Programmata (€)', type: 'minus' },
                { key: 'principalVoluntary', label: '  (-) Cash Sweep Mutuo Bancario Volontario (€)', type: 'minus' },
                (() => {
                    const st = State.inputs.sweepType || 'none';
                    if (st === 'none') return null;
                    const sv = State.inputs.sweepValue || 0;
                    const sy = State.inputs.sweepYears || 0;
                    const typeStr = st === 'pct_cfads' ? `${sv}% del CFADS disponibile` : `€ ${sv.toLocaleString('it-IT')} fissi/anno`;
                    const durStr = sy > 0 ? `per ${sy} anni` : 'fino a estinzione mutuo';
                    return { key: '_sweepDetailLabel', label: `Sweep: ${typeStr} - ${durStr}`, type: 'detail' };
                })(),
                ...((p.dsraMonths || 0) > 0 ? [{ key: 'dsraFunding', label: '  (-) Accantonamento/Integrazione DSRA (€)', type: 'minus' }] : []),
                { key: 'spvFCFE', label: 'CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV) (€)', type: 'bold-teal' },
                ...((p.dsraMonths || 0) > 0 ? [{ key: 'dsraRelease', label: '  (+) Rilascio DSRA a estinzione debito/exit (€)', type: 'plus' }] : []),

                // ── CASCATA DI DISTRIBUZIONE SPV -> HOLDCO ───────────────────────────────
                { section: 'CASCATA DISTRIBUZIONE SPV -> HOLDCO (Waterfall)', type: 'section-title' },
                ...(p.peEnabled && p.peMode !== 'royalty_fee' ? [{ key: 'peDividendPaid', label: '  (-) Quota Dividendi/Preferred Private Equity a Partner Esterno (€)', type: 'minus' }] : []),
                { key: 'holdcoInterestReceived', label: '  (-) Interessi Soci Pagati da SPV a HoldCo (-> Sez. C) (€)', type: 'minus' },
                { key: 'holdcoLoanRepaymentReceived', label: '  (-) Rimborso Capitale Finanziamento Soci a HoldCo (-> Sez. C) (€)', type: 'minus' },
                { key: 'spvLockedDividends', label: '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti (€)', type: 'detail' },
                { key: 'holdcoDividendReceived', label: '  (-) Dividendi SPV Distribuiti a HoldCo (-> Sez. C) (€)', type: 'minus' },
                { key: 'spvCashTrap', label: '(=) Cassa Rimanente non distribuita in SPV (Cash Trap) (€)', type: 'bold' }
            ];

            const pnlRowsC = [
                { key: 'holdcoInflowTotal', label: '-> Flusso Cassa Risalito Totale da SPV (da Sez. B) (€)', type: 'group-header' },
                { key: 'hc_holdcoInterestReceived', label: '  di cui: Interessi Finanziamento Soci ricevuti (€)', type: 'detail', parent: 'holdcoInflowTotal' },
                { key: 'hc_holdcoLoanRepaymentReceived', label: '  di cui: Rimborso Capitale Finanziamento Soci ricevuto (€)', type: 'detail', parent: 'holdcoInflowTotal' },
                { key: 'hc_holdcoDividendReceived', label: '  di cui: Dividendi SPV ricevuti (quota Sponsor) (€)', type: 'detail', parent: 'holdcoInflowTotal' },
                ...(p.peEnabled && p.peMode !== 'royalty_fee' ? [{ key: 'hc_peDividendPaid', label: '  (-) Quota Dividendi/Preferred Private Equity (non sale alla HoldCo) (€)', type: 'minus' }] : []),
                { key: 'hc_holdcoAssetManagementReceived', label: '  di cui: Ricavi Gestione Amministrativa & Asset Mgt ricevuti da SPV (€)', type: 'detail', parent: 'holdcoInflowTotal' },
                { key: 'holdcoOpex', label: '  (-) Spese Funzionamento Holding (€)', type: 'minus' },
                { key: 'holdcoEarnoutPaid', label: '  (-) Earn-Out Holding (€)', type: 'minus' },
                { key: 'holdcoIresTaxPaid', label: '  (-) Imposta IRES HoldCo (24% su interessi netti e 5% dividendi) (€)', type: 'bold-rose' },
                { key: 'holdcoNetProfit', label: 'UTILE NETTO HOLDING CIVILISTICO (€)', type: 'bold' },
                { key: 'hc_reconcileLoanRepayment', label: '  (+) Rimborso Capitale Finanziamento Soci (Cassa Patrimoniale) (€)', type: 'plus' },
                ...(p.pdEnabled ? [
                    { section: 'SERVIZIO PRIVATE DEBT (HOLDING LEVEL)', type: 'section-title' },
                    { key: 'pdInterestPaid', label: '  (-) Interessi Private Debt Pagati dalla Holding (€)', type: 'minus' },
                    { key: 'pdPrincipalPaid', label: '  (-) Quota Capitale Private Debt (Ammortamento) (€)', type: 'minus' }
                ] : []),
                { key: 'exitValuationGroup', label: 'FLUSSO DA DISMISSIONE INVESTIMENTO (EXIT SPV) (€)', type: 'group-header' },
                { key: 'exitEnterpriseValue', label: 'di cui: Enterprise Value di Exit (€)', type: 'detail', parent: 'exitValuationGroup' },
                { key: 'exitDebtPayoff', label: 'di cui: Rimborso Debito Residuo Mutuo Bancario (€)', type: 'detail', parent: 'exitValuationGroup' },
                ...(p.peEnabled ? [{ key: 'peExitShare', label: 'di cui: Quota Exit Private Equity (Partner Esterno) (€)', type: 'detail', parent: 'exitValuationGroup' }] : []),
                ...(p.afEnabled ? [{ key: 'afExitCost', label: 'di cui: Costo Exit Altra Forma (Success Fee/Warrant/Convertibile) (€)', type: 'detail', parent: 'exitValuationGroup' }] : []),
                { key: 'exitPexTaxRow', label: 'di cui: Imposte PEX su Plusvalenza Exit (€)', type: 'detail', parent: 'exitValuationGroup' },
                ...(p.pdEnabled ? [
                    { section: 'PAYOFF PRIVATE DEBT (HOLDING LEVEL) A EXIT', type: 'section-title' },
                    { key: 'pdBulletPayoff', label: '  (-) Payoff Private Debt (Bullet/Residuo) dalla cassa Holding (€)', type: 'minus' },
                    { key: 'exitLimitedLiability', label: '  (+) Limited Liability Holding / Debt Forgiveness PD (se cassa < saldo) (€)', type: 'plus' }
                ] : []),
                { key: 'holdcoFCFE', label: 'FCFE - FLUSSO NETTO INVESTITORE (€)', type: 'total-gold' },
                { key: 'holdcoFCFECumulated', label: 'FCFE CUMULATO INVESTITORE (€)', type: 'total-gold' }
            ];

            const renderTableHeader = (headerId) => {
                const header = document.getElementById(headerId);
                if (!header) return;
                let headerHtml = `<th class="frozen-column px-4 py-4 border-r border-slate-800 text-left min-w-[340px] z-30 uppercase tracking-wider text-[10px] text-slate-400 bg-[#020617]">Voce di Bilancio</th>`;
                for (let yr = 1; yr <= yearsLimit; yr++) {
                    headerHtml += `<th class="px-3 py-4 text-right font-bold text-slate-200 border-b border-slate-800 min-w-[110px] bg-[#020617] sticky top-0 z-20">Anno ${yr}</th>`;
                }
                header.innerHTML = headerHtml;
            };

            renderTableHeader('pl-header-a');
            renderTableHeader('pl-header-b');
            renderTableHeader('pl-header-c');

            const renderTableBody = (tbodyId, rows) => {
                const tbody = document.getElementById(tbodyId);
                if (!tbody) return;

                let html = '';
                rows.filter(Boolean).forEach(row => {
                    if (row.section) {
                        let sectionClass = 'bg-[#111c30] text-indigo-300 font-bold uppercase text-[9px] tracking-wider border-b border-indigo-900/50';
                        if (row.type === 'section-title') sectionClass = 'bg-[#0b2725] text-emerald-300 font-bold uppercase text-[9px] tracking-wider border-b border-emerald-900/50';
                        else if (row.type === 'title-blue') sectionClass = 'bg-[#111c30] text-sky-300 font-bold uppercase text-[9px] tracking-wider border-b border-sky-800/50';
                        html += `
                            <tr class="${sectionClass}">
                                <td class="frozen-column px-4 py-2 border-r border-slate-800 z-10" style="background-color: inherit;">${row.section}</td>
                                <td colspan="${yearsLimit}" class="px-3 py-2"></td>
                            </tr>
                        `;
                    } else {
                        let trClass = 'group hover:bg-[#15223e]';
                        let tdClass = 'px-3 py-2 text-right border-b border-slate-800/40';
                        let textClass = 'text-slate-300';
                        let bgClass = 'bg-[#020617]'; // Default table row background to prevent scrolling overlap

                        if (row.type === 'bold') { trClass += ' font-bold text-slate-100'; bgClass = 'bg-[#141f35]'; }
                        else if (row.type === 'bold-teal') { trClass += ' font-bold text-emerald-300'; bgClass = 'bg-[#0f2e2a]'; }
                        else if (row.type === 'total') { trClass += ' font-extrabold text-emerald-400 border-t border-emerald-800'; bgClass = 'bg-[#022c22]'; }
                        else if (row.type === 'total-gold') { trClass += ' font-extrabold text-amber-400 border-t border-amber-800'; bgClass = 'bg-[#2b220c]'; }
                        else if (row.type === 'bold-rose') { trClass += ' font-bold text-rose-300'; bgClass = 'bg-[#2e141a]'; }
                        else if (row.type === 'detail') { trClass += ' text-slate-400 italic text-[10px]'; tdClass += ' text-[10px]'; }
                        else if (row.type === 'detail-sub') { trClass += ' text-slate-600 italic text-[10px]'; tdClass += ' text-[10px]'; }
                        else if (row.type === 'minus') { textClass = 'text-red-400'; }
                        else if (row.type === 'plus') { textClass = 'text-emerald-400'; }
                        else if (row.type === 'group-header') { trClass += ' font-bold text-slate-200 border-y border-slate-800/70'; bgClass = 'bg-[#080d19]'; }

                        trClass += ' ' + bgClass;

                        // Determine indentation depth
                        let depth = 0;
                        let cur = row.parent;
                        while (cur) {
                            const pRow = rows.find(r => r && r.key === cur);
                            if (pRow) {
                                depth++;
                                cur = pRow.parent;
                            } else {
                                break;
                            }
                        }

                        // Check if has children
                        const hasChildren = rows.some(r => r && r.parent === row.key);

                        // Add hidden class if parent is specified
                        const rowHiddenClass = row.parent ? 'hidden' : '';
                        trClass += ' ' + rowHiddenClass;

                        // Build toggle/indent HTML
                        let labelContent = '';
                        if (depth > 0) {
                            labelContent += `<span class="inline-block" style="width: ${depth * 16}px;"></span>`;
                        }
                        if (hasChildren) {
                            labelContent += `<span class="mr-2 inline-flex items-center justify-center w-4 h-4 rounded bg-slate-800/60 border border-slate-700 text-slate-300 font-bold text-[9px] cursor-pointer hover:bg-slate-700 hover:text-white transition-colors" onclick="toggleTableRowGroup('${row.key}'); event.stopPropagation();">` +
                                             `<i id="toggle-icon-${row.key}" class="fa-solid fa-plus"></i>` +
                                            `</span>`;
                        } else if (depth > 0) {
                            labelContent += `<span class="mr-2 text-slate-500 font-bold text-[10px]">·</span>`;
                        } else {
                            labelContent += `<span class="inline-block w-4 mr-2"></span>`;
                        }
                        labelContent += `<span>${row.label}</span>`;

                        html += `
                            <tr class="${trClass}" data-row-key="${row.key}" data-parent="${row.parent || ''}" data-expanded="false">
                                <td class="frozen-column px-4 py-2 text-left border-r border-slate-800 font-medium z-10 transition-colors duration-150 ${hasChildren ? 'cursor-pointer select-none hover:text-white' : ''}" style="background-color: inherit;" ${hasChildren ? `onclick="toggleTableRowGroup('${row.key}')"` : ''}>${labelContent}</td>
                        `;
                        for (let yr = 1; yr <= yearsLimit; yr++) {
                            html += `<td id="cell-pnl-${row.key}-y${yr}" class="${tdClass} ${textClass}">-</td>`;
                        }
                        html += `</tr>`;
                    }
                });
                tbody.innerHTML = html;
            };

            renderTableBody('pl-body-a', pnlRowsA);
            renderTableBody('pl-body-b', pnlRowsB);
            renderTableBody('pl-body-c', pnlRowsC);
            renderTableHeader('pl-header-kpis');
            renderTableBody('pl-body-kpis', pnlRowsKPIs);

            // Setup Debt rows
            const debtHeader = document.getElementById('debt-header');
            let debtHeaderHtml = `<th class="frozen-column px-4 py-4 border-r border-slate-800 text-left min-w-[280px] z-30 uppercase tracking-wider text-[10px] text-slate-400 bg-[#020617]">Parametro Ammortamento</th>`;
            for (let yr = 1; yr <= yearsLimit; yr++) {
                debtHeaderHtml += `<th class="px-3 py-4 text-right font-bold text-slate-200 border-b border-slate-800 min-w-[110px] bg-[#020617] sticky top-0 z-20">Anno ${yr}</th>`;
            }
            debtHeader.innerHTML = debtHeaderHtml;

            const debtRows = [
                // ── 1. Debito Bancario (Senior / Project Finance) ─────────────────────
                { section: '1. DEBITO BANCARIO SPV - Project Finance (Senior Debt)', type: 'title-purple' },
                { key: 'beginningBalance', label: 'Debito Residuo Inizio Anno (€)', type: 'normal' },
                { key: 'interestAccrued', label: '(-) Quota Interessi Mutuo Maturati (€)', type: 'minus' },
                { key: 'principalScheduled', label: '(-) Quota Capitale Programmata (€)', type: 'minus' },
                { key: 'principalVoluntary', label: '(-) Quota Capitale Prepagata - Cash Sweep (€)', type: 'minus' },
                { key: 'endingBalance', label: 'Debito Residuo Fine Anno (€)', type: 'bold' },
                ...((p.dsraMonths || 0) > 0 ? [{ key: 'dsraBalance', label: 'Saldo DSRA - Riserva Servizio Debito (€)', type: 'normal' }] : []),
                { key: 'totalDebtService', label: 'SERVIZIO DEL DEBITO EFFETTIVO (€)', type: 'total-purple' },
                { key: 'dscr', label: 'DSCR (Debt Service Coverage Ratio)', type: 'bold' },

                // ── 2. Finanziamento Soci (Subordinated / Shareholder Loan) ───────────
                { section: `2. FINANZIAMENTO SOCI - Subordinated Shareholder Loan (${p.sociEquityPct}% Equity)`, type: 'title-teal-debt' },
                { key: 'beginningBalanceSoci', label: 'Finanziamento Soci Inizio Anno (€)', type: 'normal' },
                { key: 'interestAccruedSoci', label: `(-) Interessi Maturati (${p.sociInterestRate > 0 ? p.sociInterestRate.toFixed(2) + '% p.a.' : 'Nessuno'}${p.sociInterestGrace > 0 ? `, grazia anni 1-${p.sociInterestGrace}` : ', nessuna grazia'}) (€)`, type: 'minus' },
                { key: 'interestPaidSoci', label: '(+) Interessi Pagati Effettivamente (€)', type: 'plus-debt' },
                { key: 'principalPaidSoci', label: `(-) Rimborso Quota Capitale (${p.sociPrincipalGrace > 0 ? 'grazia anni 1-' + p.sociPrincipalGrace : 'nessuna grazia'}) (€)`, type: 'minus' },
                { key: 'endingBalanceSoci', label: 'Finanziamento Soci Fine Anno (€)', type: 'bold' }
            ];
            // ── Sezione 3: Private Debt (se abilitato) ──
            if (p.pdEnabled) {
                const pdModeLabel = p.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : p.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale';
                debtRows.push(
                    { section: `3. PRIVATE DEBT - Mezzanine Esterna SPV (${(p.pdInterestRate||0).toFixed(2)}% - ${pdModeLabel})`, type: 'title-teal-debt' },
                    { key: 'beginningBalancePd', label: 'Private Debt Inizio Anno (€)', type: 'normal' },
                    { key: 'interestAccruedPd', label: `(-) Interessi Maturati (${(p.pdInterestRate||0).toFixed(2)}% p.a.${p.pdInterestGrace > 0 ? `, grazia anni 1-${p.pdInterestGrace}` : ', nessuna grazia'}) (€)`, type: 'minus' },
                    { key: 'interestPaidPd', label: '(+) Interessi Pagati Effettivamente (€)', type: 'plus-debt' },
                    { key: 'principalPaidPd', label: `(-) Rimborso Quota Capitale / Payoff Exit (€)`, type: 'minus' },
                    { key: 'endingBalancePd', label: 'Private Debt Fine Anno (€)', type: 'bold' }
                );
            }

            let debtBodyHtml = '';
            debtRows.forEach(row => {
                if (row.section) {
                    const sectionBg = row.type === 'title-teal-debt'
                        ? 'bg-[#0d2b28] text-emerald-300 border-b border-emerald-900/50'
                        : 'bg-[#1a1235] text-violet-300 border-b border-violet-800/50';
                    debtBodyHtml += `
                        <tr class="${sectionBg} font-bold uppercase text-[9px] tracking-wider">
                            <td class="frozen-column px-4 py-2 border-r border-slate-800 z-10" style="background-color: inherit;">${row.section}</td>
                            <td colspan="${yearsLimit}" class="px-3 py-2"></td>
                        </tr>
                    `;
                } else {
                    let trClass = 'group hover:bg-[#15223e]';
                    let tdClass = 'px-3 py-2 text-right border-b border-slate-800/40';
                    let textClass = 'text-slate-300';
                    let bgClass = 'bg-[#020617]'; // Default table row background to prevent scrolling overlap
                    
                    if (row.type === 'bold') { trClass += ' font-bold text-slate-100'; bgClass = 'bg-[#141f35]'; }
                    else if (row.type === 'total-purple') { trClass += ' font-extrabold text-violet-400 border-t border-violet-800'; bgClass = 'bg-[#1a1140]'; }
                    else if (row.type === 'plus-debt') { textClass = 'text-emerald-400'; }

                    trClass += ' ' + bgClass;

                    debtBodyHtml += `
                        <tr class="${trClass}">
                            <td class="frozen-column px-4 py-2 text-left border-r border-slate-800 font-medium z-10 transition-colors duration-150" style="background-color: inherit;">${row.label}</td>
                    `;
                    for (let yr = 1; yr <= yearsLimit; yr++) {
                        debtBodyHtml += `<td id="cell-debt-${row.key}-y${yr}" class="${tdClass} ${textClass}">-</td>`;
                    }
                    debtBodyHtml += `</tr>`;
                }
            });
            debtBody.innerHTML = debtBodyHtml;
        }

        // Populate table cells dynamically
        function updateTableData(m, d) {
            for (let i = 0; i < m.years.length; i++) {
                const yr = m.years[i];
                const setCell = (key, val, isPnl = true, formatFn = formatEuro) => {
                    const id = isPnl ? `cell-pnl-${key}-y${yr}` : `cell-debt-${key}-y${yr}`;
                    const el = document.getElementById(id);
                    if (el) {
                        el.textContent = formatFn(val);
                        if (key === 'deferredTaxes') {
                            el.classList.remove('text-emerald-400', 'text-red-400', 'text-slate-300', 'text-slate-450', 'text-slate-400');
                            if (Math.abs(val) < 0.01) {
                                el.classList.add('text-slate-400');
                            } else if (val > 0) {
                                el.classList.add('text-red-400'); // Cost (represented with '-')
                            } else {
                                el.classList.add('text-emerald-400'); // Benefit (represented with '+')
                            }
                        } else if (key === 'rf_deferredTaxes') {
                            el.classList.remove('text-emerald-400', 'text-red-400', 'text-slate-300', 'text-slate-450', 'text-slate-400');
                            if (Math.abs(val) < 0.01) {
                                el.classList.add('text-slate-400');
                            } else if (val > 0) {
                                el.classList.add('text-emerald-400'); // Positive addition (represented with '+')
                            } else {
                                el.classList.add('text-red-400'); // Subtraction (represented with '-')
                            }
                        } else if (key === 'qtyBessChargeGrid') {
                            el.classList.remove('text-emerald-400', 'text-red-400', 'text-slate-300', 'text-slate-400', 'text-slate-450');
                            if (val > 0.01) {
                                el.classList.add('text-red-400');
                            } else {
                                el.classList.add('text-slate-500');
                            }
                        }
                    }
                };
                
                const formatMinusEuro = v => v > 0 ? '-' + formatEuro(v) : '-';
                const formatPlusEuro = v => v > 0 ? '+' + formatEuro(v) : '-';

                const formatMwh = v => v > 0.01 ? new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v) + ' MWh' : '-';
                const formatMinusMwh = v => v > 0.01 ? '-' + formatMwh(v) : '-';
                const formatEuroMwh = v => v > 0.01 ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + '/MWh' : '-';

                // Driver Operativi Cells
                setCell('qtyEnergyGroup', m.qtyEnergyGroup ? m.qtyEnergyGroup[i] : 0, true, formatMwh);
                setCell('qtySolarGen', m.qtySolarGen ? m.qtySolarGen[i] : 0, true, formatMwh);
                setCell('qtySolarPpa', m.qtySolarPpa ? m.qtySolarPpa[i] : 0, true, formatMwh);
                setCell('qtySolarRid', m.qtySolarRid ? m.qtySolarRid[i] : 0, true, formatMwh);
                setCell('qtySolarToBess', m.qtySolarToBess ? m.qtySolarToBess[i] : 0, true, formatMwh);
                setCell('qtyBessDischarge', m.qtyBessDischarge ? m.qtyBessDischarge[i] : 0, true, formatMwh);
                setCell('qtyBessSelfCons', m.qtyBessSelfCons ? m.qtyBessSelfCons[i] : 0, true, formatMwh);
                setCell('qtyBessSelfConsArb', m.qtyBessSelfConsArb ? m.qtyBessSelfConsArb[i] : 0, true, formatMwh);
                setCell('qtyBessSelfConsTs', m.qtyBessSelfConsTs ? m.qtyBessSelfConsTs[i] : 0, true, formatMwh);
                setCell('qtyBessGridFeed', m.qtyBessGridFeed ? m.qtyBessGridFeed[i] : 0, true, formatMwh);
                setCell('qtyBessGridFeedArb', m.qtyBessGridFeedArb ? m.qtyBessGridFeedArb[i] : 0, true, formatMwh);
                setCell('qtyBessGridFeedTs', m.qtyBessGridFeedTs ? m.qtyBessGridFeedTs[i] : 0, true, formatMwh);
                setCell('qtyBessChargeGrid', m.qtyBessChargeGrid ? m.qtyBessChargeGrid[i] : 0, true, formatMinusMwh);
                setCell('qtyBessLosses', m.qtyBessLosses ? m.qtyBessLosses[i] : 0, true, formatMinusMwh);

                setCell('priceEnergyGroup', m.priceEnergyGroup ? m.priceEnergyGroup[i] : 0, true, formatEuroMwh);
                setCell('priceSolarAvg', m.priceSolarAvg ? m.priceSolarAvg[i] : 0, true, formatEuroMwh);
                setCell('priceSolarPpa', m.priceSolarPpa ? m.priceSolarPpa[i] : 0, true, formatEuroMwh);
                setCell('priceSolarRid', m.priceSolarRid ? m.priceSolarRid[i] : 0, true, formatEuroMwh);
                setCell('priceBessAvg', m.priceBessAvg ? m.priceBessAvg[i] : 0, true, formatEuroMwh);
                setCell('priceBessPpa', m.priceBessPpa ? m.priceBessPpa[i] : 0, true, formatEuroMwh);
                setCell('priceBessRid', m.priceBessRid ? m.priceBessRid[i] : 0, true, formatEuroMwh);
                setCell('priceBessArbitrage', m.priceBessArbitrage ? m.priceBessArbitrage[i] : 0, true, formatEuroMwh);
                setCell('priceBessTimeshifting', m.priceBessTimeshifting ? m.priceBessTimeshifting[i] : 0, true, formatEuroMwh);
                setCell('priceBessChargeGrid', m.priceBessChargeGrid ? m.priceBessChargeGrid[i] : 0, true, formatEuroMwh);

                setCell('revenueTotal', m.revenueTotal[i]);
                if (m.revenueRid) setCell('revenueRid', m.revenueRid[i], true, formatPlusEuro);
                if (m.revenuePpa) setCell('revenuePpa', m.revenuePpa[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenuePpaPv) setCell('revenuePpaPv', m.revenuePpaPv[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenuePpaBessArb) setCell('revenuePpaBessArb', m.revenuePpaBessArb[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenuePpaBessTs) setCell('revenuePpaBessTs', m.revenuePpaBessTs[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenueTimeshifting) setCell('revenueTimeshifting', m.revenueTimeshifting[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenueArbitrage) setCell('revenueArbitrage', m.revenueArbitrage[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                if (m.revenueMsd) setCell('revenueMsd', m.revenueMsd[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                setCell('opexTotal', m.opexTotal[i], true, formatMinusEuro);
                setCell('opexPlants', m.opexPlants[i], true, formatMinusEuro);
                setCell('opexBess', m.opexBess[i], true, formatMinusEuro);
                setCell('opexGridCharging', m.opexGridCharging[i], true, formatMinusEuro);
                setCell('opexLandDds', m.opexLandDds[i], true, formatMinusEuro);
                setCell('opexInsurance', m.opexInsurance[i], true, formatMinusEuro);
                setCell('opexTaxes', m.opexTaxes[i], true, formatMinusEuro);
                setCell('opexSecurity', m.opexSecurity[i], true, formatMinusEuro);
                setCell('opexAssetManagement', m.opexAssetManagement[i], true, formatMinusEuro);
                setCell('opexServiceContract', m.opexServiceContract[i], true, formatMinusEuro);
                setCell('ebitda', m.ebitda[i]);
                setCell('depreciationCivil', m.depreciationCivil[i], true, formatMinusEuro);
                setCell('depreciationCivilSolar', m.depreciationCivilSolar[i], true, formatMinusEuro);
                setCell('depreciationCivilBess', m.depreciationCivilBess[i], true, formatMinusEuro);
                setCell('depreciationCivilOther', m.depreciationCivilOther[i], true, formatMinusEuro);
                setCell('ebit', m.ebit[i]);
                setCell('interestActive', m.interestActive[i], true, formatPlusEuro);
                setCell('interest', m.interest[i], true, formatMinusEuro);
                setCell('sociInterestAccrued', m.sociInterestAccrued[i], true, formatMinusEuro);
                setCell('ebt', m.ebt[i]);
                setCell('currentTaxesSpv', m.currentTaxesSpv[i], true, formatMinusEuro);
                setCell('iresTaxSpv', m.iresTaxSpv[i], true, formatMinusEuro);
                setCell('irapTaxSpv', m.irapTaxSpv[i], true, formatMinusEuro);
                setCell('deferredTaxes', m.deferredTaxes[i], true, v => (v >= 0 ? '-' : '+') + formatEuro(Math.abs(v)));
                setCell('netProfitSpv', m.netProfitSpv[i]);
                setCell('rf_netProfitSpv', m.netProfitSpv[i], true, formatEuro);
                setCell('rf_depreciationCivil', m.depreciationCivil[i], true, formatPlusEuro);
                setCell('rf_deferredTaxes', m.deferredTaxes[i], true, v => (v >= 0 ? '+' : '-') + formatEuro(Math.abs(v)));
                setCell('rf_interest', m.interest[i], true, formatPlusEuro);
                setCell('rf_sociInterestAccrued', m.sociInterestAccrued[i], true, formatPlusEuro);
                if (m.afInterestAccrued) setCell('rf_afInterestAccrued', m.afInterestAccrued[i], true, formatPlusEuro);
                if (m.afInterestAccrued) setCell('afInterestAccrued', m.afInterestAccrued[i], true, formatMinusEuro);
                if (m.peRoyalty) setCell('peRoyalty', m.peRoyalty[i], true, formatMinusEuro);
                if (m.afFee) setCell('afFee', m.afFee[i], true, formatMinusEuro);
                setCell('cfads', m.cfads[i]);
                setCell('interestPaid', m.interest[i], true, formatMinusEuro);
                setCell('principalScheduled', m.principalScheduled[i], true, formatMinusEuro);
                setCell('principalVoluntary', Math.abs(m.principalVoluntary[i]), true, v => v > 0 ? '-' + formatEuro(v) : '-');
                if (m.dsraDraw) setCell('dsraDraw', m.dsraDraw[i], true, formatPlusEuro);
                if (m.dsraFunding) setCell('dsraFunding', m.dsraFunding[i], true, formatMinusEuro);
                if (m.dsraRelease) setCell('dsraRelease', m.dsraRelease[i], true, formatPlusEuro);
                if (m.pdInterestPaid) setCell('pdInterestPaid', m.pdInterestPaid[i], true, formatMinusEuro);
                if (m.pdPrincipalPaid) setCell('pdPrincipalPaid', m.pdPrincipalPaid[i], true, formatMinusEuro);
                if (m.peDividendPaid) setCell('peDividendPaid', m.peDividendPaid[i], true, formatMinusEuro);
                setCell('opexMaintReserve', m.opexMaintReserve ? m.opexMaintReserve[i] : 0, true, formatMinusEuro);
                setCell('holdcoInterestReceived', m.holdcoInterestReceived[i], true, formatMinusEuro);
                setCell('holdcoLoanRepaymentReceived', m.holdcoLoanRepaymentReceived[i], true, formatMinusEuro);
                setCell('spvLockedDividends', m.spvLockedDividends ? m.spvLockedDividends[i] : 0, true, formatEuro);
                setCell('holdcoDividendReceived', m.holdcoDividendReceived[i], true, formatMinusEuro);
                setCell('spvFCFE', m.spvFCFE ? m.spvFCFE[i] : 0, true, formatEuro);
                setCell('spvCashTrap', m.spvCashTrap ? m.spvCashTrap[i] : 0, true, formatEuro);
                setCell('bessAugmentationCost', m.bessAugmentationCost ? m.bessAugmentationCost[i] : 0, true, formatMinusEuro);
                setCell('mraRelease', m.mraRelease ? m.mraRelease[i] : 0, true, formatPlusEuro);
                setCell('dividendsPaid', m.dividendsPaid[i]);
                setCell('holdcoInflowTotal', m.holdcoInflowTotal[i]);
                setCell('hc_holdcoInterestReceived', m.holdcoInterestReceived[i], true, formatPlusEuro);
                setCell('hc_holdcoLoanRepaymentReceived', m.holdcoLoanRepaymentReceived[i], true, formatPlusEuro);
                setCell('hc_holdcoDividendReceived', m.holdcoDividendReceived[i], true, formatPlusEuro);
                if (m.peDividendPaid) setCell('hc_peDividendPaid', m.peDividendPaid[i], true, formatMinusEuro);
                setCell('hc_holdcoAssetManagementReceived', m.opexAssetManagement[i], true, formatPlusEuro);
                setCell('holdcoOpex', m.holdcoOpex[i], true, formatMinusEuro);
                setCell('holdcoEarnoutPaid', m.holdcoEarnoutPaid[i], true, formatMinusEuro);
                setCell('holdcoIresTaxPaid', m.holdcoIresTaxPaid[i], true, formatMinusEuro);
                setCell('holdcoNetProfit', m.holdcoNetProfit[i]);
                setCell('hc_reconcileLoanRepayment', m.holdcoLoanRepaymentReceived[i], true, formatPlusEuro);
                // exitValuationGroup: mostra sempre un valore esplicito nell'anno exit
                // (trasparenza: può essere negativo se default PD, l'equity sponsor è cappato a 0 da exitLimitedLiability)
                setCell('exitValuationGroup', m.exitValuationGroup[i], true, (v) => {
                    const exitYr = parseInt(window.State.inputs.exitOption);
                    const isExitYear = (exitYr > 0 && yr === exitYr);
                    if (isExitYear) {
                        if (Math.abs(v) < 0.01) return '0 €';
                        return v > 0 ? '+' + formatEuro(v) : '-' + formatEuro(Math.abs(v));
                    }
                    return v > 0 ? '+' + formatEuro(v) : '-';
                });
                setCell('exitEnterpriseValue', m.exitEnterpriseValue[i], true, formatPlusEuro);
                setCell('exitDebtPayoff', m.exitDebtPayoff[i], true, formatMinusEuro);
                if (m.peExitShare) setCell('peExitShare', m.peExitShare[i], true, formatMinusEuro);
                if (m.afExitCost) setCell('afExitCost', m.afExitCost[i], true, formatMinusEuro);
                setCell('exitPexTaxRow', m.exitPexTaxRow[i], true, formatMinusEuro);
                // PD a livello Holding: payoff e limited liability (solo anno exit, cassa Holding)
                if (m.pdBulletPayoff) setCell('pdBulletPayoff', m.pdBulletPayoff[i], true, formatMinusEuro);
                if (m.exitLimitedLiability) setCell('exitLimitedLiability', m.exitLimitedLiability[i], true, v => v > 0 ? '+' + formatEuro(v) : '-');
                setCell('exitNetProceedsRow', m.exitNetProceedsRow[i], true, formatPlusEuro);
                setCell('holdcoFCFE', m.holdcoFCFE[i]);
                setCell('holdcoFCFECumulated', m.holdcoFCFECumulated[i]);

                setCell('beginningBalance', d.beginningBalance[i], false);
                setCell('interestAccrued', d.interestAccrued[i], false, formatMinusEuro);
                setCell('principalScheduled', d.principalScheduled[i], false, formatMinusEuro);
                setCell('principalVoluntary', d.principalVoluntary[i], false, formatMinusEuro);
                setCell('endingBalance', d.endingBalance[i], false);
                setCell('totalDebtService', d.totalDebtService[i], false, formatMinusEuro);
                setCell('dscr', d.dscr[i], false, v => v !== -1 ? v.toFixed(2) + 'x' : 'N/A');
                // Shareholder loan schedule (P8)
                if (d.beginningBalanceSoci) {
                    setCell('beginningBalanceSoci', d.beginningBalanceSoci[i], false);
                    setCell('interestAccruedSoci', d.interestAccruedSoci[i], false, formatMinusEuro);
                    setCell('interestPaidSoci', d.interestPaidSoci[i], false, formatPlusEuro);
                    setCell('principalPaidSoci', d.principalPaidSoci[i], false, formatMinusEuro);
                    setCell('endingBalanceSoci', d.endingBalanceSoci[i], false);
                }
                if (d.dsraBalance) setCell('dsraBalance', d.dsraBalance[i], false);
                // Private Debt schedule (sezione 3)
                if (d.beginningBalancePd) {
                    setCell('beginningBalancePd', d.beginningBalancePd[i], false);
                    setCell('interestAccruedPd', d.interestAccruedPd[i], false, formatMinusEuro);
                    setCell('interestPaidPd', d.interestPaidPd[i], false, formatPlusEuro);
                    setCell('principalPaidPd', d.principalPaidPd[i], false, formatMinusEuro);
                    setCell('endingBalancePd', d.endingBalancePd[i], false);
                }
            }
        }

        // Render dashboard values
        function renderUI() {
            window.syncExitFields('render');
            if (State.results && State.results.medioneKpiText) {
                const kpiEl = document.getElementById('consolidated-medione-kpi');
                if (kpiEl) kpiEl.textContent = State.results.medioneKpiText;
            }
            if (State.plants.length === 0) return;
            
            const activePlants = State.plants.filter(pl => pl.enabled !== false);
            if (activePlants.length === 0) {
                renderZeroState();
                return;
            }
            
            // Popola il menu a discesa dei filtri impianto della scheda BESS
            renderBessPlantsDropdown();
            
            // Re-render table skeletons with dynamic labels based on active inputs
            initializeTableSkeletons();
            
            const r = State.results;
            const p = State.inputs;

            const setTxt = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            // Compute portfolio-level summaries for Dashboard (plants and yield)
            let totalSolarCapacityKwp = 0;
            let totalSolarProductionMwh = 0;
            activePlants.forEach(plant => {
                totalSolarCapacityKwp += plant.capacity || 0;
                const pm = r && r.plantsMetrics ? r.plantsMetrics.find(m => m.id === plant.id) : null;
                totalSolarProductionMwh += pm ? (pm.annualSolarProductionMWh || 0) : 0;
            });
            const avgYield = totalSolarCapacityKwp > 0 ? (totalSolarProductionMwh * 1000) / totalSolarCapacityKwp : 0; // specific yield: kWh/kWp

            setTxt('val-total-plants-count', activePlants.length.toString());
            setTxt('val-total-solar-mw', (totalSolarCapacityKwp / 1000).toFixed(2) + " MWp");
            setTxt('val-total-solar-gen-mwh', Math.round(totalSolarProductionMwh).toLocaleString('it-IT') + " MWh");
            setTxt('val-avg-yield-kwh-kwp', Math.round(avgYield).toLocaleString('it-IT') + " kWh/kWp");

            setTxt('val-total-bess-mw', (r.totalBessMw || 0).toFixed(1) + " MW");
            // Stabilimenti & PPA KPIs
            setTxt('val-stab-selfcons', r.totalSelfConsMwh ? r.totalSelfConsMwh.toFixed(0) + ' MWh' : '-');
            setTxt('val-stab-load', r.totalStabLoadMwh ? r.totalStabLoadMwh.toFixed(0) + ' MWh' : '-');
            setTxt('val-stab-coverage', r.stabCoverage ? r.stabCoverage.toFixed(1) + ' %' : '-');
            setTxt('val-stab-ppa-rev', r.totalPpaRev_y1 ? '€ ' + (r.totalPpaRev_y1 / 1000).toFixed(0) + 'k' : '-');
            // Update Stabilimenti tab KPI panel
            renderStabilimentiList();
            setTxt('val-total-bess-mwh', (r.totalBessMwh || 0).toFixed(1) + " MWh");
            setTxt('val-leverage', (p.leverage * 100) + " %");
            setTxt('val-interest', (p.interestRate * 100).toFixed(2) + " %");
            setTxt('val-loan-term', p.loanTerm + " Anni");
            setTxt('val-senior-grace-period', p.seniorGracePeriodMonths + " Mesi");
            setTxt('val-construction-months', p.constructionMonths + " Mesi");
            setTxt('val-idc-drawdown', p.idcDrawdownFactor + " %");
            setTxt('val-fiscal-depreciation', (p.fiscalDeprRate * 100).toFixed(1) + " %");
            setTxt('val-soci-equity-pct', p.sociEquityPct + " % dell'Equity");
            setTxt('val-soci-interest-rate', p.sociInterestRate.toFixed(2) + " %");
            window.updateExternalFinancingLabels(p);

            setTxt('kpi-total-cost', formatEuro(r.totalProjectCost));
            setTxt('kpi-equity-req', formatEuro(r.equityAmount));
            setTxt('kpi-debt-amt', formatEuro(r.debtAmount));
            setTxt('sub-kpi-equity-pct', `${((r.equityAmount / r.totalProjectCost) * 100).toFixed(0)}% Quota Sponsor`);
            setTxt('sub-kpi-debt-pct', `${((r.debtAmount / r.totalProjectCost) * 100).toFixed(0)}% di Leva`);
            
            const projectIrrEl = document.getElementById('kpi-project-irr');
            if (projectIrrEl) {
                if (r.calculatedProjectIrr > 0) {
                    projectIrrEl.textContent = `${r.calculatedProjectIrr.toFixed(2)} %`;
                    projectIrrEl.className = "text-xl font-black text-emerald-400 mt-1";
                } else if (r.calculatedProjectIrr < 0 && r.calculatedProjectIrr > -99.9) {
                    projectIrrEl.textContent = `${r.calculatedProjectIrr.toFixed(2)} %`;
                    projectIrrEl.className = "text-xl font-black text-red-400 mt-1";
                } else {
                    projectIrrEl.textContent = "Rend. Negativo";
                    projectIrrEl.className = "text-xl font-black text-red-400 mt-1";
                }
            }

            const irrEl = document.getElementById('kpi-irr');
            if (irrEl) {
                if (r.calculatedIrr > 0) {
                    irrEl.textContent = `${r.calculatedIrr.toFixed(2)} %`;
                    irrEl.className = "text-xl font-black text-emerald-400 mt-1";
                } else if (r.calculatedIrr < 0 && r.calculatedIrr > -99.9) {
                    irrEl.textContent = `${r.calculatedIrr.toFixed(2)} %`;
                    irrEl.className = "text-xl font-black text-red-400 mt-1";
                } else {
                    irrEl.textContent = "Rendimento Negativo";
                    irrEl.className = "text-xl font-black text-red-400 mt-1";
                }
            }

            setTxt('kpi-npv', formatEuro(r.holdcoNpv));
            setTxt('kpi-moic', r.holdcoMoic.toFixed(2) + 'x');
            setTxt('kpi-payback', r.paybackPeriod);
            setTxt('kpi-lcoe', `€ ${r.calculatedLcoe.toFixed(2)} /MWh`);
            setTxt('kpi-lcos', `€ ${r.calculatedLcos.toFixed(2)} /MWh`);

            // Populate Sources & Uses
            const spvAcquisition = r.totalSpvAcquisitionCapex || 0;
            const constructionCapex = (r.totalProjectCost || 0) - spvAcquisition;
            const holdcoSetup = p.holdcoCapital !== undefined ? p.holdcoCapital : 10000;
            const totalUses = spvAcquisition + constructionCapex + holdcoSetup;

            const seniorDebt = r.debtAmount || 0;
            const privateDebt = r.pdAmount || 0;
            const privateEquity = r.peAmount || 0;
            // L'equity di costruzione ora è residua dopo senior + PD + PE
            const constructionEquity = Math.max(0, constructionCapex - seniorDebt - privateDebt - privateEquity);
            const sponsorLoan = constructionEquity * ((p.sociEquityPct || 0) / 100);
            const sponsorEquity = Math.max(0, (r.equityAmount || 0) - sponsorLoan);
            const totalSources = seniorDebt + privateDebt + privateEquity + sponsorLoan + sponsorEquity;

            setTxt('uses-spv-acquisition', formatEuro(spvAcquisition));
            setTxt('uses-construction-capex', formatEuro(constructionCapex));
            setTxt('uses-holdco-setup', formatEuro(holdcoSetup));
            setTxt('uses-total', formatEuro(totalUses));

            setTxt('sources-senior-debt', formatEuro(seniorDebt));
            setTxt('sources-private-debt', formatEuro(privateDebt));
            setTxt('sources-private-equity', formatEuro(privateEquity));
            setTxt('sources-sponsor-loan', formatEuro(sponsorLoan));
            setTxt('sources-sponsor-equity', formatEuro(sponsorEquity));
            setTxt('sources-total', formatEuro(totalSources));

            // Calculate percentages for the bar
            const seniorDebtPct = totalSources > 0 ? (seniorDebt / totalSources * 100) : 0;
            const pdPct = totalSources > 0 ? (privateDebt / totalSources * 100) : 0;
            const pePct = totalSources > 0 ? (privateEquity / totalSources * 100) : 0;
            const sponsorLoanPct = totalSources > 0 ? (sponsorLoan / totalSources * 100) : 0;
            const sponsorEquityPct = totalSources > 0 ? (sponsorEquity / totalSources * 100) : 0;

            setTxt('sources-uses-leverage-pct', `${seniorDebtPct.toFixed(0)}% Debito / ${pdPct.toFixed(0)}% PD / ${pePct.toFixed(0)}% PE / ${sponsorLoanPct.toFixed(0)}% Sponsor Loan / ${sponsorEquityPct.toFixed(0)}% Sponsor Equity`);

            const barSenior = document.getElementById('bar-senior-debt');
            const barPd = document.getElementById('bar-private-debt');
            const barPe = document.getElementById('bar-private-equity');
            const barLoan = document.getElementById('bar-sponsor-loan');
            const barEquity = document.getElementById('bar-sponsor-equity');

            if (barSenior) barSenior.style.width = `${seniorDebtPct}%`;
            if (barPd) barPd.style.width = `${pdPct}%`;
            if (barPe) barPe.style.width = `${pePct}%`;
            if (barLoan) barLoan.style.width = `${sponsorLoanPct}%`;
            if (barEquity) barEquity.style.width = `${sponsorEquityPct}%`;

            if (p.loanTerm === 0 || r.debtAmount === 0) {
                setTxt('kpi-dscr', 'N/A');
                setTxt('sub-kpi-dscr', 'Nessun debito da coprire');
                document.getElementById('card-dscr').className = "bg-slate-900 border border-slate-850 p-4 rounded-xl";
                document.getElementById('dscr-breach-alert').classList.add('hidden');
            } else {
                setTxt('kpi-dscr', `${r.avgDscr.toFixed(2)}x`);
                setTxt('sub-kpi-dscr', `Minimo registrato: ${r.minDscr.toFixed(2)}x`);
                if (r.minDscr < 1.15) {
                    document.getElementById('card-dscr').className = "bg-red-950/20 border border-red-500/30 p-4 rounded-xl text-red-400";
                    document.getElementById('dscr-breach-alert').classList.remove('hidden');
                } else {
                    document.getElementById('card-dscr').className = "bg-[#0b0f19] border border-slate-850 p-4 rounded-xl";
                    document.getElementById('dscr-breach-alert').classList.add('hidden');
                }
            }

            updateTableData(r.matrix, r.debtSchedule);
            renderChart(r.matrix, r.debtSchedule);
            renderPlantsList(); // Update the plants table (including PUN Zonale Ponderato) when calculations are run
            renderDealValueBreakdownTable();
            renderGmeDashboard();
        }

        // Render main 20-year charts (operational revenues composition & cashflow/DSCR)
        function renderChart(matrix, debtSchedule) {
            const labels = matrix.years.map(yr => `Anno ${yr}`);

            // 1. Render Revenues Chart
            const canvasRevenues = document.getElementById('chart-revenues');
            if (canvasRevenues) {
                const ctxRev = canvasRevenues.getContext('2d');
                if (State.revenueChartInstance) {
                    State.revenueChartInstance.destroy();
                }
                
                const ppaData = (matrix.revenuePpa || []).map(v => Math.round(v));
                const ridData = (matrix.revenueRid || []).map(v => Math.round(v));
                const arbitrageData = (matrix.revenueArbitrage || []).map(v => Math.round(v));
                const timeshiftingData = (matrix.revenueTimeshifting || []).map(v => Math.round(v));

                State.revenueChartInstance = new Chart(ctxRev, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'PPA On-Site (€)',
                                data: ppaData,
                                backgroundColor: 'rgba(56, 189, 248, 0.85)',
                                borderRadius: 3
                            },
                            {
                                label: 'Ritiro Dedicato (GSE) (€)',
                                data: ridData,
                                backgroundColor: 'rgba(244, 63, 94, 0.85)',
                                borderRadius: 3
                            },
                            {
                                label: 'Arbitraggio BESS (€)',
                                data: arbitrageData,
                                backgroundColor: 'rgba(234, 179, 8, 0.85)',
                                borderRadius: 3
                            },
                            {
                                label: 'Time-Shifting BESS (€)',
                                data: timeshiftingData,
                                backgroundColor: 'rgba(16, 185, 129, 0.85)',
                                borderRadius: 3
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                stacked: true,
                                grid: { display: false },
                                ticks: { color: '#94a3b8' }
                            },
                            y: {
                                stacked: true,
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { color: '#94a3b8', callback: v => (v / 1000) + 'k' }
                            }
                        },
                        plugins: {
                            legend: { 
                                labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 9 } },
                                position: 'top'
                            },
                            title: {
                                display: true,
                                text: 'Composizione Ricavi Operativi SPV (€)',
                                color: '#ffffff',
                                font: { size: 10, weight: 'bold' }
                            }
                        }
                    }
                });
            }

            // 2. Render Cashflow & DSCR Chart
            const canvasCashflow = document.getElementById('chart-cashflow');
            if (canvasCashflow) {
                const ctxCash = canvasCashflow.getContext('2d');
                const fcfeData = matrix.holdcoFCFE.map(v => Math.round(v));
                const dscrData = debtSchedule.dscr.map(v => v === -1 ? null : parseFloat(v.toFixed(2)));

                if (State.chartInstance) {
                    State.chartInstance.destroy();
                }

                State.chartInstance = new Chart(ctxCash, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Cassa FCFE HoldCo (€)',
                                data: fcfeData,
                                backgroundColor: 'rgba(16, 185, 129, 0.8)',
                                borderRadius: 3,
                                yAxisID: 'y'
                            },
                            {
                                label: 'DSCR (Covenant Bancario)',
                                data: dscrData,
                                type: 'line',
                                borderColor: '#c084fc',
                                borderWidth: 2,
                                pointRadius: 3,
                                yAxisID: 'yDSCR',
                                borderDash: [3, 3]
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { color: '#94a3b8' }
                            },
                            y: {
                                type: 'linear',
                                position: 'left',
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { color: '#94a3b8', callback: v => (v / 1000) + 'k' }
                            },
                            yDSCR: {
                                type: 'linear',
                                position: 'right',
                                min: 0,
                                max: 3.5,
                                grid: { display: false },
                                ticks: { color: '#c084fc', callback: v => v.toFixed(1) + 'x' }
                            }
                        },
                        plugins: {
                            legend: { 
                                labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 9 } },
                                position: 'top'
                            },
                            title: {
                                display: true,
                                text: 'Flussi di Cassa FCFE HoldCo & Covenant DSCR',
                                color: '#ffffff',
                                font: { size: 10, weight: 'bold' }
                            }
                        }
                    }
                });
            }
        }

        // Period calculations and downsampling helpers for Tab 4
        function getPeriodHours(resolution, index) {
            const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
            
            if (resolution === 'giorno') {
                const dateStr = new Date(2025, 0, index).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
                return {
                    startHour: (index - 1) * 24,
                    numHours: 24,
                    label: `Giorno ${index}: ${dateStr}`
                };
            }
            if (resolution === 'settimana') {
                const startHour = (index - 1) * 168;
                return {
                    startHour: startHour,
                    numHours: 168,
                    label: `Settimana ${index} (Ore ${startHour + 1} - ${startHour + 168})`
                };
            }
            if (resolution === 'mese') {
                let startDay = 0;
                for (let i = 0; i < index - 1; i++) {
                    startDay += monthDays[i];
                }
                const numDays = monthDays[index - 1];
                return {
                    startHour: startDay * 24,
                    numHours: numDays * 24,
                    label: `Mese: ${monthNames[index - 1]}`
                };
            }
            if (resolution === 'trimestre') {
                const qDays = [90, 91, 92, 92]; // Q1, Q2, Q3, Q4 for non-leap year
                let startDay = 0;
                for (let i = 0; i < index - 1; i++) {
                    startDay += qDays[i];
                }
                return {
                    startHour: startDay * 24,
                    numHours: qDays[index - 1] * 24,
                    label: `Trimestre: Q${index}`
                };
            }
            if (resolution === 'semestre') {
                const startHour = index === 1 ? 0 : 4344;
                const numHours = index === 1 ? 4344 : 4416;
                return {
                    startHour: startHour,
                    numHours: numHours,
                    label: `Semestre: S${index}`
                };
            }
            if (resolution === 'anno') {
                return {
                    startHour: 0,
                    numHours: 8760,
                    label: 'Anno Intero (8760 ore)'
                };
            }
            return { startHour: 0, numHours: 24, label: 'Giorno: 1' };
        }

        function getSliceData(resolution, index, aggregation) {
            const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
            const qDays = [90, 91, 92, 92];
            
            const activePlants = State.plants ? State.plants.filter(p => p.enabled !== false) : [];
            const activeStabilimenti = State.stabilimenti ? State.stabilimenti.filter(s => s.enabled !== false) : [];
            
            // Filtra per gli impianti selezionati dall'utente nel tab BESS (fallback su tutti gli attivi se vuoto)
            const selectedPlants = activePlants.filter(p => {
                if (!State.selectedBessPlantIds || State.selectedBessPlantIds.size === 0) return true;
                return State.selectedBessPlantIds.has(p.id);
            });

            // Get unique zones
            const selectedZones = [...new Set(selectedPlants.map(p => String(p.zone).toUpperCase()))];
            if (selectedZones.length === 0) {
                selectedZones.push("CNOR");
            }

            const zonalPricesHourly = {};
            selectedZones.forEach(zone => {
                zonalPricesHourly[zone] = State.zonalPun[zone] || State.zonalPun["CNOR"];
            });

            const solGenHourly = new Float64Array(8760);
            const batChargeHourly = new Float64Array(8760);
            const batDischargeHourly = new Float64Array(8760);
            const batSoCHourly = new Float64Array(8760);
            const pricesHourly = new Float64Array(8760);
            
            const batChargeSolarHourly = new Float64Array(8760);
            const batChargeGridHourly = new Float64Array(8760);
            const batDischargeGridHourly = new Float64Array(8760);
            const batDischargeGridArbHourly = new Float64Array(8760);
            const batDischargeGridTsHourly = new Float64Array(8760);
            const batDischargePpaHourly = new Float64Array(8760);
            const selfConsSolarHourly = new Float64Array(8760);
            const selfConsBessHourly = new Float64Array(8760);
            const selfConsBessArbHourly = new Float64Array(8760);
            const selfConsBessTsHourly = new Float64Array(8760);
            const lossesRteHourly = new Float64Array(8760);
            const batGridFeedPvHourly = new Float64Array(8760);
            const revRidPureHourly = new Float64Array(8760);
            const revRidActualHourly = new Float64Array(8760);
            const revArbitrageHourly = new Float64Array(8760);
            const revPpaPvHourly = new Float64Array(8760);
            const revPpaBessHourly = new Float64Array(8760);
            const revPpaBessArbHourly = new Float64Array(8760);
            const revPpaBessTsHourly = new Float64Array(8760);
            const revTimeshiftingHourly = new Float64Array(8760);
            const costWithdrawalHourly = new Float64Array(8760);
            
            const stabLoadHourly = new Float64Array(8760);
            const stabSelfConsHourly = new Float64Array(8760);

            const cerGseIncentivePvHourly = new Float64Array(8760);
            const cerGseIncentiveBessArbHourly = new Float64Array(8760);
            const cerGseIncentiveBessTsHourly = new Float64Array(8760);
            const cerGseIncentiveBessHourly = new Float64Array(8760);

            const weightedPunNum = new Float64Array(8760);
            const weightedPunDen = new Float64Array(8760);
            const totalBessSoC = new Float64Array(8760);
            let totalBessMwh = 0;

            selectedPlants.forEach(plant => {
                const pm = State.results && State.results.plantsMetrics ? State.results.plantsMetrics.find(m => m.id === plant.id) : null;
                const sim = pm ? pm.sim : null;
                totalBessMwh += (plant.bessMwh || 0);
                const zonePrices = State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"];
                
                for (let t = 0; t < 8760; t++) {
                    solGenHourly[t] += plant.generation[t] || 0;
                    weightedPunNum[t] += (plant.generation[t] || 0) * zonePrices[t];
                    weightedPunDen[t] += plant.generation[t] || 0;
                    
                    if (sim) {
                        batChargeHourly[t] += sim.hourlyCharge[t] || 0;
                        batDischargeHourly[t] += sim.hourlyDischarge[t] || 0;
                        totalBessSoC[t] += sim.hourlySoC[t] || 0;
                        batChargeSolarHourly[t] += sim.hourlyChargeSolar[t] || 0;
                        batChargeGridHourly[t] += sim.hourlyChargeGrid[t] || 0;
                        batDischargeGridHourly[t] += sim.hourlyDischargeGrid[t] || 0;
                        batDischargeGridArbHourly[t] += sim.hourlyDischargeArbitrage[t] || 0;
                        batDischargeGridTsHourly[t] += sim.hourlyDischargeTimeshifting[t] || 0;
                        batDischargePpaHourly[t] += sim.hourlyDischargePpa[t] || 0;
                        selfConsSolarHourly[t] += sim.hourlySelfConsSolar[t] || 0;
                        selfConsBessHourly[t] += sim.hourlySelfConsBess[t] || 0;
                        selfConsBessArbHourly[t] += sim.hourlySelfConsBessArb[t] || 0;
                        selfConsBessTsHourly[t] += sim.hourlySelfConsBessTs[t] || 0;
                        lossesRteHourly[t] += sim.hourlyLossesRte[t] || 0;
                        batGridFeedPvHourly[t] += sim.hourlyGridFeedPv[t] || 0;
                        revRidPureHourly[t] += sim.hourlyRevenueRidPure[t] || 0;
                        revRidActualHourly[t] += sim.hourlyRevenueRidActual[t] || 0;
                        revArbitrageHourly[t] += sim.hourlyRevenueArbitrageGrid[t] || 0;
                        revPpaPvHourly[t] += sim.hourlyRevenuePpaPv[t] || 0;
                        revPpaBessHourly[t] += sim.hourlyRevenuePpaBess[t] || 0;
                        revPpaBessArbHourly[t] += sim.hourlyRevenuePpaBessArb[t] || 0;
                        revPpaBessTsHourly[t] += sim.hourlyRevenuePpaBessTs[t] || 0;
                        revTimeshiftingHourly[t] += sim.hourlyRevenueTimeshifting[t] || 0;
                        costWithdrawalHourly[t] += sim.hourlyCostWithdrawal[t] || 0;
                        
                        cerGseIncentivePvHourly[t] += sim.hourlyCerGseIncentivePv ? (sim.hourlyCerGseIncentivePv[t] || 0) : 0;
                        cerGseIncentiveBessArbHourly[t] += sim.hourlyCerGseIncentiveBessArb ? (sim.hourlyCerGseIncentiveBessArb[t] || 0) : 0;
                        cerGseIncentiveBessTsHourly[t] += sim.hourlyCerGseIncentiveBessTs ? (sim.hourlyCerGseIncentiveBessTs[t] || 0) : 0;
                        cerGseIncentiveBessHourly[t] += sim.hourlyCerGseIncentiveBess ? (sim.hourlyCerGseIncentiveBess[t] || 0) : 0;
                    }
                }
            });

            const fallbackZone = selectedPlants.length > 0 ? selectedPlants[0].zone : "CNOR";
            const fallbackPrices = State.zonalPun[String(fallbackZone).toUpperCase()] || State.zonalPun["CNOR"];
            
            for (let t = 0; t < 8760; t++) {
                pricesHourly[t] = weightedPunDen[t] > 0 ? (weightedPunNum[t] / weightedPunDen[t]) : fallbackPrices[t];
                if (totalBessMwh > 0) {
                    batSoCHourly[t] = (totalBessSoC[t] / (totalBessMwh * 1000)) * 100;
                }
            }

            // La presenza di consumi è valutata a livello di portafoglio attivo
            // in modo che le colonne e curve non spariscano ma mostrino 0 quando si filtra per un impianto senza consumi
            const hasOnSiteStab = activeStabilimenti.some(s2 => (s2.ppaType === 'on-site' || s2.ppaType === 'cer') && s2.load);
            selectedPlants.forEach(plant => {
                const stab = activeStabilimenti.find(s2 => s2.plantId === plant.id);
                if (stab && (stab.ppaType === 'on-site' || stab.ppaType === 'cer') && stab.load) {
                    const pmStab = State.results && State.results.plantsMetrics ? State.results.plantsMetrics.find(mm => mm.id === plant.id) : null;
                    const simStab = (pmStab && pmStab.sim) || plant.sim || null;
                    for (let i = 0; i < 8760; i++) {
                        stabLoadHourly[i] += stab.load[i] || 0;
                        if (simStab && simStab.hourlySelfCons) {
                            stabSelfConsHourly[i] += simStab.hourlySelfCons[i] || 0;
                        } else {
                            stabSelfConsHourly[i] += Math.min(plant.generation[i] || 0, stab.load[i] || 0);
                        }
                    }
                }
            });

            const toDaily = (hourly) => {
                const daily = new Float64Array(365);
                for (let d = 0; d < 365; d++) {
                    let sum = 0;
                    for (let h = 0; h < 24; h++) sum += hourly[d * 24 + h] || 0;
                    daily[d] = sum / 24;
                }
                return daily;
            };

            const toMonthly = (hourly) => {
                const monthly = new Float64Array(12);
                let hourOffset = 0;
                for (let m = 0; m < 12; m++) {
                    const hoursInMonth = monthDays[m] * 24;
                    let sum = 0;
                    for (let h = 0; h < hoursInMonth; h++) sum += hourly[hourOffset + h] || 0;
                    monthly[m] = sum / hoursInMonth;
                    hourOffset += hoursInMonth;
                }
                return monthly;
            };

            const toDailySum = (hourly) => {
                const daily = new Float64Array(365);
                for (let d = 0; d < 365; d++) {
                    let sum = 0;
                    for (let h = 0; h < 24; h++) sum += hourly[d * 24 + h] || 0;
                    daily[d] = sum;
                }
                return daily;
            };

            const toMonthlySum = (hourly) => {
                const monthly = new Float64Array(12);
                let hourOffset = 0;
                for (let m = 0; m < 12; m++) {
                    const hoursInMonth = monthDays[m] * 24;
                    let sum = 0;
                    for (let h = 0; h < hoursInMonth; h++) sum += hourly[hourOffset + h] || 0;
                    monthly[m] = sum;
                    hourOffset += hoursInMonth;
                }
                return monthly;
            };

            let solGenSource = solGenHourly;
            let batChargeSource = batChargeHourly;
            let batDischargeSource = batDischargeHourly;
            let batSoCSource = batSoCHourly;
            let pricesSource = pricesHourly;
            let stabLoadSource = stabLoadHourly;
            let stabSelfConsSource = stabSelfConsHourly;
            
            let batChargeSolarSource = batChargeSolarHourly;
            let batChargeGridSource = batChargeGridHourly;
            let batDischargeGridSource = batDischargeGridHourly;
            let batDischargeGridArbSource = batDischargeGridArbHourly;
            let batDischargeGridTsSource = batDischargeGridTsHourly;
            let batDischargePpaSource = batDischargePpaHourly;
            let selfConsSolarSource = selfConsSolarHourly;
            let selfConsBessSource = selfConsBessHourly;
            let selfConsBessArbSource = selfConsBessArbHourly;
            let selfConsBessTsSource = selfConsBessTsHourly;
            let lossesRteSource = lossesRteHourly;
            let batGridFeedPvSource = batGridFeedPvHourly;
            let revRidPureSource = revRidPureHourly;
            let revRidActualSource = revRidActualHourly;
            let revArbitrageSource = revArbitrageHourly;
            let revPpaPvSource = revPpaPvHourly;
            let revPpaBessSource = revPpaBessHourly;
            let revPpaBessArbSource = revPpaBessArbHourly;
            let revPpaBessTsSource = revPpaBessTsHourly;
            let revTimeshiftingSource = revTimeshiftingHourly;
            let costWithdrawalSource = costWithdrawalHourly;
            
            let cerGseIncentivePvSource = cerGseIncentivePvHourly;
            let cerGseIncentiveBessArbSource = cerGseIncentiveBessArbHourly;
            let cerGseIncentiveBessTsSource = cerGseIncentiveBessTsHourly;
            let cerGseIncentiveBessSource = cerGseIncentiveBessHourly;

            if (aggregation === 'giornaliero') {
                solGenSource = toDailySum(solGenHourly);
                batChargeSource = toDailySum(batChargeHourly);
                batDischargeSource = toDailySum(batDischargeHourly);
                batSoCSource = toDaily(batSoCHourly); // Keep as avg
                pricesSource = toDaily(pricesHourly); // Keep as avg
                stabLoadSource = toDailySum(stabLoadHourly);
                stabSelfConsSource = toDailySum(stabSelfConsHourly);
                
                batChargeSolarSource = toDailySum(batChargeSolarHourly);
                batChargeGridSource = toDailySum(batChargeGridHourly);
                batDischargeGridSource = toDailySum(batDischargeGridHourly);
                batDischargeGridArbSource = toDailySum(batDischargeGridArbHourly);
                batDischargeGridTsSource = toDailySum(batDischargeGridTsHourly);
                batDischargePpaSource = toDailySum(batDischargePpaHourly);
                selfConsSolarSource = toDailySum(selfConsSolarHourly);
                selfConsBessSource = toDailySum(selfConsBessHourly);
                selfConsBessArbSource = toDailySum(selfConsBessArbHourly);
                selfConsBessTsSource = toDailySum(selfConsBessTsHourly);
                lossesRteSource = toDailySum(lossesRteHourly);
                batGridFeedPvSource = toDailySum(batGridFeedPvHourly);
                revRidPureSource = toDailySum(revRidPureHourly);
                revRidActualSource = toDailySum(revRidActualHourly);
                revArbitrageSource = toDailySum(revArbitrageHourly);
                revPpaPvSource = toDailySum(revPpaPvHourly);
                revPpaBessSource = toDailySum(revPpaBessHourly);
                revPpaBessArbSource = toDailySum(revPpaBessArbHourly);
                revPpaBessTsSource = toDailySum(revPpaBessTsHourly);
                revTimeshiftingSource = toDailySum(revTimeshiftingHourly);
                costWithdrawalSource = toDailySum(costWithdrawalHourly);
                
                cerGseIncentivePvSource = toDailySum(cerGseIncentivePvHourly);
                cerGseIncentiveBessArbSource = toDailySum(cerGseIncentiveBessArbHourly);
                cerGseIncentiveBessTsSource = toDailySum(cerGseIncentiveBessTsHourly);
                cerGseIncentiveBessSource = toDailySum(cerGseIncentiveBessHourly);
            } else if (aggregation === 'mensile') {
                solGenSource = toMonthlySum(solGenHourly);
                batChargeSource = toMonthlySum(batChargeHourly);
                batDischargeSource = toMonthlySum(batDischargeHourly);
                batSoCSource = toMonthly(batSoCHourly); // Keep as avg
                pricesSource = toMonthly(pricesHourly); // Keep as avg
                stabLoadSource = toMonthlySum(stabLoadHourly);
                stabSelfConsSource = toMonthlySum(stabSelfConsHourly);
                
                batChargeSolarSource = toMonthlySum(batChargeSolarHourly);
                batChargeGridSource = toMonthlySum(batChargeGridHourly);
                batDischargeGridSource = toMonthlySum(batDischargeGridHourly);
                batDischargeGridArbSource = toMonthlySum(batDischargeGridArbHourly);
                batDischargeGridTsSource = toMonthlySum(batDischargeGridTsHourly);
                batDischargePpaSource = toMonthlySum(batDischargePpaHourly);
                selfConsSolarSource = toMonthlySum(selfConsSolarHourly);
                selfConsBessSource = toMonthlySum(selfConsBessHourly);
                selfConsBessArbSource = toMonthlySum(selfConsBessArbHourly);
                selfConsBessTsSource = toMonthlySum(selfConsBessTsHourly);
                lossesRteSource = toMonthlySum(lossesRteHourly);
                batGridFeedPvSource = toMonthlySum(batGridFeedPvHourly);
                revRidPureSource = toMonthlySum(revRidPureHourly);
                revRidActualSource = toMonthlySum(revRidActualHourly);
                revArbitrageSource = toMonthlySum(revArbitrageHourly);
                revPpaPvSource = toMonthlySum(revPpaPvHourly);
                revPpaBessSource = toMonthlySum(revPpaBessHourly);
                revPpaBessArbSource = toMonthlySum(revPpaBessArbHourly);
                revPpaBessTsSource = toMonthlySum(revPpaBessTsHourly);
                revTimeshiftingSource = toMonthlySum(revTimeshiftingHourly);
                costWithdrawalSource = toMonthlySum(costWithdrawalHourly);
                
                cerGseIncentivePvSource = toMonthlySum(cerGseIncentivePvHourly);
                cerGseIncentiveBessArbSource = toMonthlySum(cerGseIncentiveBessArbHourly);
                cerGseIncentiveBessTsSource = toMonthlySum(cerGseIncentiveBessTsHourly);
                cerGseIncentiveBessSource = toMonthlySum(cerGseIncentiveBessHourly);
            }

            const aggregatedZonalPrices = {};
            selectedZones.forEach(zone => {
                const hourlySeries = zonalPricesHourly[zone];
                if (aggregation === 'giornaliero') {
                    aggregatedZonalPrices[zone] = toDaily(hourlySeries);
                } else if (aggregation === 'mensile') {
                    aggregatedZonalPrices[zone] = toMonthly(hourlySeries);
                } else {
                    aggregatedZonalPrices[zone] = hourlySeries;
                }
            });

            let start = 0;
            let length = 0;
            let labelList = [];
            let dateList = [];

            if (aggregation === 'orario') {
                const period = getPeriodHours(resolution, index);
                start = period.startHour;
                length = period.numHours;
                
                for (let i = 0; i < length; i++) {
                    const hourIndex = start + i;
                    const date = new Date(2025, 0, Math.floor(hourIndex / 24) + 1, hourIndex % 24);
                    dateList.push(date);
                    const dayStr = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
                    const hourOfDay = hourIndex % 24;
                    const hhStr = hourOfDay.toString().padStart(2, '0');
                    
                    if (length <= 24) {
                        labelList.push(`${hhStr}:00`);
                    } else if (length <= 168) {
                        const weekday = date.toLocaleDateString('it-IT', { weekday: 'short' });
                        labelList.push(`${weekday} ${hhStr}:00`);
                    } else {
                        labelList.push(`${dayStr} ${hhStr}:00`);
                    }
                }
            } else if (aggregation === 'giornaliero') {
                if (resolution === 'giorno') {
                    start = index - 1;
                    length = 1;
                    const date = new Date(2025, 0, index);
                    dateList.push(date);
                    labelList.push(date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
                } else if (resolution === 'settimana') {
                    start = (index - 1) * 7;
                    length = 7;
                    for (let d = 0; d < 7; d++) {
                        const date = new Date(2025, 0, start + d + 1);
                        dateList.push(date);
                        const weekday = date.toLocaleDateString('it-IT', { weekday: 'short' });
                        const dayStr = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
                        labelList.push(`${weekday} ${dayStr}`);
                    }
                } else if (resolution === 'mese') {
                    let startDay = 0;
                    for (let i = 0; i < index - 1; i++) startDay += monthDays[i];
                    start = startDay;
                    length = monthDays[index - 1];
                    for (let d = 0; d < length; d++) {
                        const date = new Date(2025, 0, start + d + 1);
                        dateList.push(date);
                        labelList.push(`${d + 1}`);
                    }
                } else if (resolution === 'trimestre') {
                    let startDay = 0;
                    for (let i = 0; i < index - 1; i++) startDay += qDays[i];
                    start = startDay;
                    length = qDays[index - 1];
                    for (let d = 0; d < length; d++) {
                        const date = new Date(2025, 0, start + d + 1);
                        dateList.push(date);
                        labelList.push(date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
                    }
                } else if (resolution === 'semestre') {
                    start = index === 1 ? 0 : 181;
                    length = index === 1 ? 181 : 184;
                    for (let d = 0; d < length; d++) {
                        const date = new Date(2025, 0, start + d + 1);
                        dateList.push(date);
                        labelList.push(date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
                    }
                } else if (resolution === 'anno') {
                    start = 0;
                    length = 365;
                    for (let d = 0; d < 365; d++) {
                        const date = new Date(2025, 0, d + 1);
                        dateList.push(date);
                        labelList.push(date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }));
                    }
                }
            } else if (aggregation === 'mensile') {
                if (resolution === 'giorno' || resolution === 'settimana') {
                    const currentDay = resolution === 'giorno' ? index : (index - 1) * 7 + 1;
                    const d = new Date(2025, 0, currentDay);
                    start = d.getMonth();
                    length = 1;
                    const date = new Date(2025, start, 1);
                    dateList.push(date);
                    labelList.push(monthNames[start]);
                } else if (resolution === 'mese') {
                    start = index - 1;
                    length = 1;
                    const date = new Date(2025, start, 1);
                    dateList.push(date);
                    labelList.push(monthNames[start]);
                } else if (resolution === 'trimestre') {
                    start = (index - 1) * 3;
                    length = 3;
                    for (let m = 0; m < 3; m++) {
                        const date = new Date(2025, start + m, 1);
                        dateList.push(date);
                        labelList.push(monthNames[start + m]);
                    }
                } else if (resolution === 'semestre') {
                    start = index === 1 ? 0 : 6;
                    length = 6;
                    for (let m = 0; m < 6; m++) {
                        const date = new Date(2025, start + m, 1);
                        dateList.push(date);
                        labelList.push(monthNames[start + m]);
                    }
                } else if (resolution === 'anno') {
                    start = 0;
                    length = 12;
                    for (let m = 0; m < 12; m++) {
                        const date = new Date(2025, m, 1);
                        dateList.push(date);
                        labelList.push(monthNames[m]);
                    }
                }
            }

            const slicedSolGen = Array.from(solGenSource.slice(start, start + length));
            const slicedBatCharge = Array.from(batChargeSource.slice(start, start + length));
            const slicedBatDischarge = Array.from(batDischargeSource.slice(start, start + length));
            const slicedBatSoC = Array.from(batSoCSource.slice(start, start + length));
            const slicedPrices = Array.from(pricesSource.slice(start, start + length));
            
            const slicedBatChargeSolar = Array.from(batChargeSolarSource.slice(start, start + length));
            const slicedBatChargeGrid = Array.from(batChargeGridSource.slice(start, start + length));
            const slicedBatDischargeGrid = Array.from(batDischargeGridSource.slice(start, start + length));
            const slicedBatDischargeGridArb = Array.from(batDischargeGridArbSource.slice(start, start + length));
            const slicedBatDischargeGridTs = Array.from(batDischargeGridTsSource.slice(start, start + length));
            const slicedBatDischargePpa = Array.from(batDischargePpaSource.slice(start, start + length));
            const slicedSelfConsSolar = Array.from(selfConsSolarSource.slice(start, start + length));
            const slicedSelfConsBess = Array.from(selfConsBessSource.slice(start, start + length));
            const slicedSelfConsBessArb = Array.from(selfConsBessArbSource.slice(start, start + length));
            const slicedSelfConsBessTs = Array.from(selfConsBessTsSource.slice(start, start + length));
            const slicedLossesRte = Array.from(lossesRteSource.slice(start, start + length));
            const slicedBatGridFeedPv = Array.from(batGridFeedPvSource.slice(start, start + length));
            const slicedRevRidPure = Array.from(revRidPureSource.slice(start, start + length));
            const slicedRevRidActual = Array.from(revRidActualSource.slice(start, start + length));
            const slicedRevArbitrage = Array.from(revArbitrageSource.slice(start, start + length));
            const slicedRevPpaPv = Array.from(revPpaPvSource.slice(start, start + length));
            const slicedRevPpaBess = Array.from(revPpaBessSource.slice(start, start + length));
            const slicedRevPpaBessArb = Array.from(revPpaBessArbSource.slice(start, start + length));
            const slicedRevPpaBessTs = Array.from(revPpaBessTsSource.slice(start, start + length));
            const slicedRevTimeshifting = Array.from(revTimeshiftingSource.slice(start, start + length));
            const slicedCostWithdrawal = Array.from(costWithdrawalSource.slice(start, start + length));
            
            const slicedCerGseIncentivePv = Array.from(cerGseIncentivePvSource.slice(start, start + length));
            const slicedCerGseIncentiveBessArb = Array.from(cerGseIncentiveBessArbSource.slice(start, start + length));
            const slicedCerGseIncentiveBessTs = Array.from(cerGseIncentiveBessTsSource.slice(start, start + length));
            const slicedCerGseIncentiveBess = Array.from(cerGseIncentiveBessSource.slice(start, start + length));
            
            const slicedStabLoad = hasOnSiteStab ? Array.from(stabLoadSource.slice(start, start + length)) : [];
            const slicedStabSelfCons = hasOnSiteStab ? Array.from(stabSelfConsSource.slice(start, start + length)) : [];

            const slicedZonalPrices = {};
            selectedZones.forEach(zone => {
                slicedZonalPrices[zone] = Array.from(aggregatedZonalPrices[zone].slice(start, start + length));
            });

            return {
                solGen: slicedSolGen,
                batCharge: slicedBatCharge,
                batDischarge: slicedBatDischarge,
                batChargeSolar: slicedBatChargeSolar,
                batChargeGrid: slicedBatChargeGrid,
                batDischargeGrid: slicedBatDischargeGrid,
                batDischargeGridArb: slicedBatDischargeGridArb,
                batDischargeGridTs: slicedBatDischargeGridTs,
                batDischargePpa: slicedBatDischargePpa,
                selfConsSolar: slicedSelfConsSolar,
                selfConsBess: slicedSelfConsBess,
                selfConsBessArb: slicedSelfConsBessArb,
                selfConsBessTs: slicedSelfConsBessTs,
                lossesRte: slicedLossesRte,
                batGridFeedPv: slicedBatGridFeedPv,
                revRidPure: slicedRevRidPure,
                revRidActual: slicedRevRidActual,
                revArbitrage: slicedRevArbitrage,
                revPpaPv: slicedRevPpaPv,
                revPpaBess: slicedRevPpaBess,
                revPpaBessArb: slicedRevPpaBessArb,
                revPpaBessTs: slicedRevPpaBessTs,
                revTimeshifting: slicedRevTimeshifting,
                costWithdrawal: slicedCostWithdrawal,
                cerGseIncentivePv: slicedCerGseIncentivePv,
                cerGseIncentiveBessArb: slicedCerGseIncentiveBessArb,
                cerGseIncentiveBessTs: slicedCerGseIncentiveBessTs,
                cerGseIncentiveBess: slicedCerGseIncentiveBess,
                batSoC: slicedBatSoC,
                prices: slicedPrices,
                selectedZones: selectedZones,
                zonalPrices: slicedZonalPrices,
                stabLoad: slicedStabLoad,
                stabSelfCons: slicedStabSelfCons,
                labels: labelList,
                dates: dateList
            };
        }

        function downsampleData(data, maxPoints = 500) {
            if (!data || data.length <= maxPoints) {
                return { data: Array.from(data), step: 1 };
            }
            const step = Math.ceil(data.length / maxPoints);
            const sampled = [];
            for (let i = 0; i < data.length; i += step) {
                let sum = 0;
                let count = 0;
                for (let j = 0; j < step && (i + j) < data.length; j++) {
                    sum += data[i + j];
                    count++;
                }
                sampled.push(count > 0 ? sum / count : data[i]);
            }
            return { data: sampled, step: step };
        }

        // Render detailed dispatch profile chart (Tab 4) with multi-resolution and downsampling
        function renderHourlyProfileChart() {
            const canvas = document.getElementById('chart-hourly-profile');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            
            showCalcIndicator(true);
            setTimeout(() => {
                try {
                    // Clean up previous chart instance
                    if (State.hourlyChartInstance) {
                        State.hourlyChartInstance.destroy();
                        State.hourlyChartInstance = null;
                    }

                    const resolution = State.chartResolution || 'giorno';
                    const periodIndex = State.selectedPeriodIndex || 1;
                    const aggregation = State.chartAggregation || 'orario';
                    
                    // Get aggregated and sliced data
                    const data = getSliceData(resolution, periodIndex, aggregation);
            
            // Determine downsampling max points based on resolution and aggregation
            let maxPoints = 500;
            if (aggregation === 'mensile') {
                maxPoints = 12;
            } else if (aggregation === 'giornaliero') {
                maxPoints = 365;
            } else {
                if (resolution === 'giorno') maxPoints = 24;
                else if (resolution === 'settimana') maxPoints = 168;
                else if (resolution === 'mese') maxPoints = 744;
                else if (resolution === 'trimestre') maxPoints = 2208;
                else if (resolution === 'semestre') maxPoints = 2208;
                else if (resolution === 'anno') maxPoints = 1460; // downsample a step 6h: Chart.js con 8760×40 serie è troppo lento
                else maxPoints = 1460;
            }
            
            const dsSolGen = downsampleData(data.solGen, maxPoints);
            const step = dsSolGen.step;
            
            const downsampleArray = (arr, stepVal) => {
                if (stepVal <= 1 || arr.length === 0) return arr;
                const res = [];
                for (let i = 0; i < arr.length; i += stepVal) {
                    let sum = 0, count = 0;
                    for (let j = 0; j < stepVal && (i + j) < arr.length; j++) {
                        sum += arr[i + j];
                        count++;
                    }
                    res.push(count > 0 ? sum / count : arr[i]);
                }
                return res;
            };

            const rawSolGen = dsSolGen.data;
            const rawBatChargeSolar = downsampleArray(data.batChargeSolar, step);
            const rawBatChargeGrid = downsampleArray(data.batChargeGrid, step);
            const rawBatDischargeGrid = downsampleArray(data.batDischargeGrid, step);
            const rawBatDischargeGridArb = downsampleArray(data.batDischargeGridArb, step);
            const rawBatDischargeGridTs = downsampleArray(data.batDischargeGridTs, step);
            const rawBatDischargePpa = downsampleArray(data.batDischargePpa, step);
            const rawSelfConsSolar = downsampleArray(data.selfConsSolar, step);
            const rawSelfConsBess = downsampleArray(data.selfConsBess, step);
            const rawSelfConsBessArb = downsampleArray(data.selfConsBessArb, step);
            const rawSelfConsBessTs = downsampleArray(data.selfConsBessTs, step);
            const rawLossesRte = downsampleArray(data.lossesRte, step);
            const rawBatGridFeedPv = downsampleArray(data.batGridFeedPv, step);
            const rawBatSoC = downsampleArray(data.batSoC, step);
            const rawPrices = downsampleArray(data.prices, step);
            const rawRevRidPure = downsampleArray(data.revRidPure, step);
            const rawRevRidActual = downsampleArray(data.revRidActual, step);
            const rawRevArbitrage = downsampleArray(data.revArbitrage, step);
            const rawRevTimeshifting = downsampleArray(data.revTimeshifting, step);
            const rawCostWithdrawal = downsampleArray(data.costWithdrawal, step);
            const rawRevPpaPv = downsampleArray(data.revPpaPv, step);
            const rawRevPpaBess = downsampleArray(data.revPpaBess, step);
            const rawRevPpaBessArb = downsampleArray(data.revPpaBessArb, step);
            const rawRevPpaBessTs = downsampleArray(data.revPpaBessTs, step);
            const rawCerGseIncentivePv = downsampleArray(data.cerGseIncentivePv, step);
            const rawCerGseIncentiveBessArb = downsampleArray(data.cerGseIncentiveBessArb, step);
            const rawCerGseIncentiveBessTs = downsampleArray(data.cerGseIncentiveBessTs, step);
            const rawStabLoad = data.stabLoad.length > 0 ? downsampleArray(data.stabLoad, step) : [];

            const solGen = rawSolGen.map(Math.round);
            const batChargeSolar = rawBatChargeSolar.map(Math.round);
            const batChargeGrid = rawBatChargeGrid.map(Math.round);
            const batDischargeGrid = rawBatDischargeGrid.map(Math.round);
            const batDischargeGridArb = rawBatDischargeGridArb.map(Math.round);
            const batDischargeGridTs = rawBatDischargeGridTs.map(Math.round);
            const batDischargePpa = rawBatDischargePpa.map(Math.round);
            const selfConsSolar = rawSelfConsSolar.map(Math.round);
            const selfConsBess = rawSelfConsBess.map(Math.round);
            const selfConsBessArb = rawSelfConsBessArb.map(Math.round);
            const selfConsBessTs = rawSelfConsBessTs.map(Math.round);
            const lossesRte = rawLossesRte.map(Math.round);
            const batGridFeedPv = rawBatGridFeedPv.map(Math.round);
            const batSoC = rawBatSoC.map(Math.round);
            const prices = rawPrices.map(Math.round);
            const revRidPure = rawRevRidPure.map(Math.round);
            const revRidActual = rawRevRidActual.map(Math.round);
            const revArbitrage = rawRevArbitrage.map(Math.round);
            const revTimeshifting = rawRevTimeshifting.map(Math.round);
            const costWithdrawal = rawCostWithdrawal.map(Math.round);
            const revPpaPv = rawRevPpaPv.map(Math.round);
            const revPpaBess = rawRevPpaBess.map(Math.round);
            const revPpaBessArb = rawRevPpaBessArb.map(Math.round);
            const revPpaBessTs = rawRevPpaBessTs.map(Math.round);
            const cerGseIncentivePv = rawCerGseIncentivePv.map(Math.round);
            const cerGseIncentiveBessArb = rawCerGseIncentiveBessArb.map(Math.round);
            const cerGseIncentiveBessTs = rawCerGseIncentiveBessTs.map(Math.round);
            const stabLoad = rawStabLoad.map(Math.round);
            
            const zoneColors = {
                "NORD": "#f43f5e",  // Rose
                "CNOR": "#ec4899",  // Pink
                "CSUD": "#8b5cf6",  // Violet
                "SUD": "#3b82f6",   // Blue
                "SICI": "#06b6d4",  // Cyan
                "SARD": "#10b981"   // Emerald
            };
            const getZoneColor = (zone) => zoneColors[zone.toUpperCase()] || "#f43f5e";

            const punDatasets = data.selectedZones.map(zone => {
                const rawZonal = downsampleArray(data.zonalPrices[zone] || [], step);
                const zonalData = rawZonal.map(Math.round);
                return {
                    label: `Prezzo PUN ${zone} (€/MWh)`,
                    data: zonalData,
                    borderColor: getZoneColor(zone),
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: aggregation === 'mensile' ? 3 : 0,
                    borderDash: [3, 3],
                    yAxisID: 'yPrice',
                    tension: 0.1
                };
            });
            
            const labels = [];
            for (let i = 0; i < data.labels.length; i += step) {
                labels.push(data.labels[i]);
            }
            
            const datasets = [
                {
                    label: 'Generazione FV (kW)',
                    data: solGen,
                    borderColor: '#eab308',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Cessione FV alla Rete (kW)',
                    data: batGridFeedPv,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Carica BESS da FV (kW)',
                    data: batChargeSolar,
                    borderColor: '#38bdf8',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Carica BESS da Rete (kW)',
                    data: batChargeGrid,
                    borderColor: '#6366f1',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Scarica BESS alla Rete (kW)',
                    data: batDischargeGrid,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Scarica BESS alla Rete da Arbitraggio (kW)',
                    data: batDischargeGridArb,
                    borderColor: '#34d399',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Scarica BESS alla Rete da Timeshifting (kW)',
                    data: batDischargeGridTs,
                    borderColor: '#a78bfa',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: (() => { const _as = State.stabilimenti.filter(s => s.enabled !== false); return _as.some(s => s.ppaType === 'cer') ? 'Scarica BESS Condivisa (kW)' : 'Scarica BESS a Stabilimento (kW)'; })(),
                    data: batDischargePpa,
                    borderColor: '#06b6d4',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 3 : 0,
                    tension: 0.15
                },
                {
                    label: 'Perdite RTE BESS (kW)',
                    data: lossesRte,
                    borderColor: '#64748b',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Stato di Carica SoC (%)',
                    data: batSoC,
                    borderColor: '#22c55e',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: aggregation === 'mensile' ? 3 : 0,
                    yAxisID: 'ySoC',
                    tension: 0.1
                },
                ...punDatasets,
                {
                    label: 'Ricavi da RID (Pure) (€)',
                    data: revRidPure,
                    borderColor: '#ca8a04',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Ricavi da RID+BESS+PPA (€)',
                    data: revRidActual,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Ricavi da Arbitraggio (€)',
                    data: revArbitrage,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Ricavi da Timeshifting BESS (€)',
                    data: revTimeshifting,
                    borderColor: '#06b6d4',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: 'Costi Prelievo (€)',
                    data: costWithdrawal,
                    borderColor: '#f43f5e',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                {
                    label: (() => { const _as = State.stabilimenti.filter(s => s.enabled !== false); return _as.some(s => s.ppaType === 'cer') ? 'Ricavi SPV da CER FV (€)' : 'Ricavi da FV a PPA (€)'; })(),
                    data: revPpaPv,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                    yAxisID: 'yRevenue',
                    tension: 0.15,
                    hidden: true
                },
                ...(() => {
                    const _as = State.stabilimenti.filter(s => s.enabled !== false);
                    const _isCerChart = _as.some(s => s.ppaType === 'cer');
                    if (_isCerChart) {
                        return [
                            {
                                label: 'Ricavi SPV da CER BESS da Arbitraggio (€)',
                                data: revPpaBessArb,
                                borderColor: '#ec4899',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            },
                            {
                                label: 'Ricavi SPV da CER BESS da Timeshifting (€)',
                                data: revPpaBessTs,
                                borderColor: '#f472b6',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            },
                            {
                                label: 'Incentivo GSE CER FV (€)',
                                data: cerGseIncentivePv,
                                borderColor: '#a78bfa',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            },
                            {
                                label: 'Incentivo GSE CER BESS da Arbitraggio (€)',
                                data: cerGseIncentiveBessArb,
                                borderColor: '#f472b6',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            },
                            {
                                label: 'Incentivo GSE CER BESS da Timeshifting (€)',
                                data: cerGseIncentiveBessTs,
                                borderColor: '#fb7185',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            }
                        ];
                    } else {
                        return [
                            {
                                label: 'Ricavi da Bess a PPA (€)',
                                data: revPpaBess,
                                borderColor: '#ec4899',
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                pointRadius: (resolution === 'giorno' || aggregation === 'mensile') ? 2 : 0,
                                yAxisID: 'yRevenue',
                                tension: 0.15,
                                hidden: true
                            }
                        ];
                    }
                })()
            ];
            
            if (stabLoad.length > 0) {
                const _isCerChart = State.stabilimenti.filter(s => s.enabled !== false).some(s => s.ppaType === 'cer');
                datasets.push({
                    label: _isCerChart ? 'Fabbisogno Virtuale Membri CER (kW)' : 'Consumo (kW)',
                    data: stabLoad,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168,85,247,0.02)',
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    pointRadius: aggregation === 'mensile' ? 2 : 0,
                    tension: 0.2,
                    fill: false
                });
                datasets.push({
                    label: _isCerChart ? 'Energia Condivisa FV (kW)' : 'Autoconsumo da FV (kW)',
                    data: selfConsSolar,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(168,85,247,0.1)',
                    borderWidth: 0,
                    pointRadius: 0,
                    tension: 0.2,
                    fill: true
                });
                if (_isCerChart) {
                    datasets.push({
                        label: 'Energia Condivisa BESS da Arbitraggio (kW)',
                        data: selfConsBessArb,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(219,39,119,0.15)',
                        borderWidth: 0,
                        pointRadius: 0,
                        tension: 0.2,
                        fill: true
                    });
                    datasets.push({
                        label: 'Energia Condivisa BESS da Timeshifting (kW)',
                        data: selfConsBessTs,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(236,72,153,0.25)',
                        borderWidth: 0,
                        pointRadius: 0,
                        tension: 0.2,
                        fill: true
                    });
                } else {
                    datasets.push({
                        label: 'Autoconsumo da BESS (kW)',
                        data: selfConsBess,
                        borderColor: 'transparent',
                        backgroundColor: 'rgba(219,39,119,0.15)',
                        borderWidth: 0,
                        pointRadius: 0,
                        tension: 0.2,
                        fill: true
                    });
                }
            }

            State.hourlyChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            position: 'left',
                            title: { display: true, text: aggregation === 'orario' ? 'Potenza/Energia (kW/kWh)' : 'Energia (kWh)', color: '#94a3b8', font: { size: 10 } },
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#94a3b8' }
                        },
                        ySoC: {
                            type: 'linear',
                            position: 'right',
                            min: 0,
                            max: 100,
                            title: { display: true, text: 'SoC (%)', color: '#22c55e', font: { size: 10 } },
                            grid: { display: false },
                            ticks: { color: '#22c55e', callback: v => v + '%' }
                        },
                        yPrice: {
                            type: 'linear',
                            position: 'right',
                            title: { display: true, text: 'Prezzo (€/MWh)', color: '#f43f5e', font: { size: 10 } },
                            grid: { display: false },
                            ticks: { color: '#f43f5e', callback: v => '€' + v }
                        },
                        yRevenue: {
                            type: 'linear',
                            position: 'right',
                            title: { display: true, text: aggregation === 'orario' ? 'Ricavi (€/ora)' : 'Ricavi (€)', color: '#3b82f6', font: { size: 10 } },
                            grid: { display: false },
                            ticks: { color: '#3b82f6', callback: v => '€' + v }
                        }
                    },
                    plugins: {
                        legend: {
                            labels: {
                                color: '#cbd5e1',
                                boxWidth: 12,
                                font: { size: 10 },
                                generateLabels: function(chart) {
                                    return chart.data.datasets.map((dataset, index) => {
                                        const isHidden = !chart.isDatasetVisible(index);
                                        return {
                                            text: dataset.label,
                                            datasetIndex: index,
                                            fillStyle: isHidden ? 'rgba(71, 85, 105, 0.3)' : (dataset.backgroundColor && dataset.backgroundColor !== 'transparent' ? dataset.backgroundColor : dataset.borderColor),
                                            strokeStyle: isHidden ? 'rgba(71, 85, 105, 0.3)' : dataset.borderColor,
                                            lineWidth: dataset.borderWidth || 1,
                                            hidden: false,
                                            fontColor: isHidden ? '#64748b' : '#cbd5e1',
                                            color: isHidden ? '#64748b' : '#cbd5e1'
                                        };
                                    });
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        if (context.dataset.yAxisID === 'ySoC') {
                                            label += context.parsed.y + '%';
                                        } else if (context.dataset.yAxisID === 'yPrice') {
                                            label += '€' + context.parsed.y + '/MWh';
                                        } else if (context.dataset.yAxisID === 'yRevenue') {
                                            label += '€' + context.parsed.y.toLocaleString('it-IT');
                                        } else {
                                            label += context.parsed.y.toLocaleString('it-IT') + ' kW';
                                        }
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                }
            });

            // Render corresponding data table below the chart
            renderHourlyProfileTable(labels, rawSolGen, rawBatChargeSolar, rawBatChargeGrid, rawBatDischargeGrid, rawBatDischargeGridArb, rawBatDischargeGridTs, rawBatDischargePpa, rawLossesRte, rawBatSoC, rawPrices, rawStabLoad, rawSelfConsSolar, rawSelfConsBess, rawBatGridFeedPv, rawRevRidPure, rawRevRidActual, rawRevArbitrage, rawRevTimeshifting, rawCostWithdrawal, rawRevPpaPv, rawRevPpaBess, data.dates, data.selectedZones, data.zonalPrices, rawSelfConsBessArb, rawSelfConsBessTs, rawRevPpaBessArb, rawRevPpaBessTs, rawCerGseIncentivePv, rawCerGseIncentiveBessArb, rawCerGseIncentiveBessTs);
                } catch (err) {
                    console.error("Errore durante il rendering del grafico orario:", err);
                } finally {
                    showCalcIndicator(false);
                }
            }, 50);
        }

        // Render detailed dispatch profile data table below the chart
        function renderHourlyProfileTable(labels, solGen, batChargeSolar, batChargeGrid, batDischargeGrid, batDischargeGridArb, batDischargeGridTs, batDischargePpa, lossesRte, batSoC, prices, stabLoad, selfConsSolar, selfConsBess, batGridFeedPv, revRidPure, revRidActual, revArbitrage, revTimeshifting, costWithdrawal, revPpaPv, revPpaBess, dates, selectedZones, zonalPrices, selfConsBessArb, selfConsBessTs, revPpaBessArb, revPpaBessTs, cerGseIncentivePv, cerGseIncentiveBessArb, cerGseIncentiveBessTs) {
            const table = document.getElementById('table-hourly-profile');
            if (!table) return;
            const thead = table.querySelector('thead');
            const tbody = table.querySelector('tbody');
            if (!thead || !tbody) return;

            // Clear previous contents
            thead.innerHTML = '';
            tbody.innerHTML = '';

            // Store transiently in State to access in export functions
            State.activeProfileData = {
                labels: labels,
                dates: dates,
                solGen: solGen,
                batChargeSolar: batChargeSolar,
                batChargeGrid: batChargeGrid,
                batDischargeGrid: batDischargeGrid,
                batDischargeGridArb: batDischargeGridArb,
                batDischargeGridTs: batDischargeGridTs,
                batDischargePpa: batDischargePpa,
                lossesRte: lossesRte,
                batSoC: batSoC,
                prices: prices,
                stabLoad: stabLoad,
                selfConsSolar: selfConsSolar,
                selfConsBess: selfConsBess,
                selfConsBessArb: selfConsBessArb,
                selfConsBessTs: selfConsBessTs,
                batGridFeedPv: batGridFeedPv,
                revRidPure: revRidPure,
                revRidActual: revRidActual,
                revArbitrage: revArbitrage,
                revTimeshifting: revTimeshifting,
                costWithdrawal: costWithdrawal,
                revPpaPv: revPpaPv,
                revPpaBess: revPpaBess,
                revPpaBessArb: revPpaBessArb,
                revPpaBessTs: revPpaBessTs,
                cerGseIncentivePv: cerGseIncentivePv,
                cerGseIncentiveBessArb: cerGseIncentiveBessArb,
                cerGseIncentiveBessTs: cerGseIncentiveBessTs,
                selectedZones: selectedZones,
                zonalPrices: zonalPrices
            };

            const hasStab = stabLoad && stabLoad.length > 0;
            const _isCerTable = State.stabilimenti.filter(s => s.enabled !== false).some(s => s.ppaType === 'cer');

            // Render Header with grouped logic and colors
            let headerHTML = `
                <tr>
                    <th class="px-4 py-3 text-slate-300 font-semibold border-b border-slate-800 text-left bg-slate-900/40">Periodo / Tempo</th>
                    <th class="px-4 py-3 text-slate-300 font-semibold border-b border-slate-800 text-right bg-slate-900/20 border-l border-slate-800/60">Produzione Solare (kWh)</th>
                    <th class="px-4 py-3 text-amber-500 font-semibold border-b border-slate-800 text-right bg-slate-900/20">Immissione Diretta Rete FV (kWh)</th>
            `;

            if (hasStab) {
                if (_isCerTable) {
                    headerHTML += `
                        <th class="px-4 py-3 text-purple-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10 border-l border-slate-800/60">Carico Utenza (kWh)</th>
                        <th class="px-4 py-3 text-indigo-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10">Autoconsumo Diretto FV (kWh)</th>
                        <th class="px-4 py-3 text-violet-500 font-semibold border-b border-slate-800 text-right bg-purple-950/10">Autoconsumo BESS Arb (kWh)</th>
                        <th class="px-4 py-3 text-violet-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10">Autoconsumo BESS Ts (kWh)</th>
                    `;
                } else {
                    headerHTML += `
                        <th class="px-4 py-3 text-purple-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10 border-l border-slate-800/60">Carico Utenza (kWh)</th>
                        <th class="px-4 py-3 text-indigo-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10">Autoconsumo Diretto FV (kWh)</th>
                        <th class="px-4 py-3 text-violet-400 font-semibold border-b border-slate-800 text-right bg-purple-950/10">Autoconsumo da BESS (kWh)</th>
                    `;
                }
            }

            headerHTML += `
                    <th class="px-4 py-3 text-sky-400 font-semibold border-b border-slate-800 text-right bg-blue-950/10 border-l border-slate-800/60">Carica BESS da FV (kWh)</th>
                    <th class="px-4 py-3 text-blue-400 font-semibold border-b border-slate-800 text-right bg-blue-950/10">Carica BESS da Rete (kWh)</th>
                    <th class="px-4 py-3 text-emerald-400 font-semibold border-b border-slate-800 text-right bg-blue-950/10">Scarica BESS alla Rete (kWh)</th>
                    <th class="px-4 py-3 text-emerald-500 font-semibold border-b border-slate-800 text-right bg-blue-950/10">Scarica BESS Rete Arb. (kWh)</th>
                    <th class="px-4 py-3 text-emerald-300 font-semibold border-b border-slate-800 text-right bg-blue-950/10">Scarica BESS Rete Ts. (kWh)</th>
                    <th class="px-4 py-3 text-cyan-400 font-semibold border-b border-slate-800 text-right bg-blue-950/10">${_isCerTable ? 'Scarica BESS Condivisa (kWh)' : 'Scarica BESS a Stab. (kWh)'}</th>
                    <th class="px-4 py-3 text-slate-500 font-semibold border-b border-slate-800 text-right bg-blue-950/10">Perdite RTE BESS (kWh)</th>
                    <th class="px-4 py-3 text-green-400 font-semibold border-b border-slate-800 text-right bg-blue-950/10">SoC (%)</th>
            `;

            (selectedZones || ["CNOR"]).forEach((zone, idx) => {
                const borderClass = idx === 0 ? 'border-l border-slate-800/60' : '';
                headerHTML += `<th class="px-4 py-3 text-rose-400 font-semibold border-b border-slate-800 text-right bg-rose-950/10 ${borderClass}">Prezzo PUN ${zone} (€/MWh)</th>`;
            });

            headerHTML += `
                    <th class="px-4 py-3 text-slate-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10 border-l border-slate-800/60">Ricavi RID / FER X (Pure)</th>
                    <th class="px-4 py-3 text-emerald-500 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi RID / FER X (Reali)</th>
                    <th class="px-4 py-3 text-amber-500 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi Arbitraggio</th>
                    <th class="px-4 py-3 text-cyan-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi Timeshifting</th>
                    <th class="px-4 py-3 text-rose-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Costi Prelievo</th>
                    <th class="px-4 py-3 text-violet-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">${_isCerTable ? 'Ricavi SPV da CER FV' : 'Ricavi PPA FV'}</th>
            `;
 
            if (_isCerTable) {
                headerHTML += `
                    <th class="px-4 py-3 text-pink-500 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi SPV da CER BESS da Arb.</th>
                    <th class="px-4 py-3 text-pink-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi SPV da CER BESS da Ts.</th>
                    <th class="px-4 py-3 text-indigo-300 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Incentivo GSE CER FV</th>
                    <th class="px-4 py-3 text-purple-300 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Incentivo GSE CER BESS da Arb.</th>
                    <th class="px-4 py-3 text-purple-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Incentivo GSE CER BESS da Ts.</th>
                `;
            } else {
                headerHTML += `
                    <th class="px-4 py-3 text-pink-400 font-semibold border-b border-slate-800 text-right bg-emerald-950/10">Ricavi PPA BESS</th>
                `;
            }

            headerHTML += `
                </tr>
            `;
            thead.innerHTML = headerHTML;

            // Render Body
            let rowsHTML = '';
            for (let i = 0; i < labels.length; i++) {
                const label = labels[i];
                const sol = solGen[i] !== undefined ? Math.round(solGen[i]) : 0;
                const gridFeedPv = batGridFeedPv[i] !== undefined ? Math.round(batGridFeedPv[i]) : 0;
                const chgSolar = batChargeSolar[i] !== undefined ? Math.round(batChargeSolar[i]) : 0;
                const chgGrid = batChargeGrid[i] !== undefined ? Math.round(batChargeGrid[i]) : 0;
                const disGrid = batDischargeGrid[i] !== undefined ? Math.round(batDischargeGrid[i]) : 0;
                const disGridArb = batDischargeGridArb[i] !== undefined ? Math.round(batDischargeGridArb[i]) : 0;
                const disGridTs = batDischargeGridTs[i] !== undefined ? Math.round(batDischargeGridTs[i]) : 0;
                const disPpa = batDischargePpa[i] !== undefined ? Math.round(batDischargePpa[i]) : 0;
                const loss = lossesRte[i] !== undefined ? Math.round(lossesRte[i]) : 0;
                const soc = batSoC[i] !== undefined ? Math.round(batSoC[i]) : 0;
                const price = prices[i] !== undefined ? Math.round(prices[i]) : 0;
                const revPure = revRidPure[i] !== undefined ? Math.round(revRidPure[i]) : 0;
                const revActual = revRidActual[i] !== undefined ? Math.round(revRidActual[i]) : 0;
                const revArb = revArbitrage[i] !== undefined ? Math.round(revArbitrage[i]) : 0;
                const revTshift = revTimeshifting[i] !== undefined ? Math.round(revTimeshifting[i]) : 0;
                const costWithd = costWithdrawal[i] !== undefined ? Math.round(costWithdrawal[i]) : 0;
                const revPpaPvVal = revPpaPv[i] !== undefined ? Math.round(revPpaPv[i]) : 0;
                const revPpaBessVal = revPpaBess[i] !== undefined ? Math.round(revPpaBess[i]) : 0;

                rowsHTML += `
                    <tr class="hover:bg-slate-900/40 border-b border-slate-850 transition-colors">
                        <td class="px-4 py-2.5 font-medium text-slate-300 bg-slate-900/10">${label}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-slate-300 border-l border-slate-850/60">${sol.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-amber-500">${gridFeedPv.toLocaleString('it-IT')}</td>
                `;

                if (hasStab) {
                    const loadVal = stabLoad[i] !== undefined ? Math.round(stabLoad[i]) : 0;
                    const consSolar = selfConsSolar[i] !== undefined ? Math.round(selfConsSolar[i]) : 0;
                    if (_isCerTable) {
                        const consBessArb = selfConsBessArb[i] !== undefined ? Math.round(selfConsBessArb[i]) : 0;
                        const consBessTs = selfConsBessTs[i] !== undefined ? Math.round(selfConsBessTs[i]) : 0;
                        rowsHTML += `
                            <td class="px-4 py-2.5 text-right font-mono text-purple-400 bg-purple-950/5 border-l border-slate-850/60">${loadVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-indigo-400 bg-purple-950/5">${consSolar.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-violet-500 bg-purple-950/5">${consBessArb.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-violet-400 bg-purple-950/5">${consBessTs.toLocaleString('it-IT')}</td>
                        `;
                    } else {
                        const consBess = selfConsBess[i] !== undefined ? Math.round(selfConsBess[i]) : 0;
                        rowsHTML += `
                            <td class="px-4 py-2.5 text-right font-mono text-purple-400 bg-purple-950/5 border-l border-slate-850/60">${loadVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-indigo-400 bg-purple-950/5">${consSolar.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-violet-400 bg-purple-950/5">${consBess.toLocaleString('it-IT')}</td>
                        `;
                    }
                }

                rowsHTML += `
                        <td class="px-4 py-2.5 text-right font-mono text-sky-400 bg-blue-950/5 border-l border-slate-850/60">${chgSolar.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-blue-400 bg-blue-950/5">${chgGrid.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-emerald-400 bg-blue-950/5">${disGrid.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-emerald-500 bg-blue-950/5">${disGridArb.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-emerald-300 bg-blue-950/5">${disGridTs.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-cyan-400 bg-blue-950/5">${disPpa.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-slate-500 bg-blue-950/5">${loss.toLocaleString('it-IT')}</td>
                        <td class="px-4 py-2.5 text-right font-mono text-green-400 bg-blue-950/5">${soc}%</td>
                `;

                (selectedZones || ["CNOR"]).forEach((zone, idx) => {
                    const zPrices = (zonalPrices && zonalPrices[zone]) ? zonalPrices[zone] : [];
                    const zPrice = zPrices[i] !== undefined ? Math.round(zPrices[i]) : 0;
                    const borderClass = idx === 0 ? 'border-l border-slate-850/60' : '';
                    rowsHTML += `<td class="px-4 py-2.5 text-right font-mono text-rose-400 bg-rose-950/5 ${borderClass}">€${zPrice.toLocaleString('it-IT')}</td>`;
                });

                if (_isCerTable) {
                    const revPpaBessArbVal = revPpaBessArb[i] !== undefined ? Math.round(revPpaBessArb[i]) : 0;
                    const revPpaBessTsVal = revPpaBessTs[i] !== undefined ? Math.round(revPpaBessTs[i]) : 0;
                    const cerGsePvVal = cerGseIncentivePv[i] !== undefined ? Math.round(cerGseIncentivePv[i]) : 0;
                    const cerGseArbVal = cerGseIncentiveBessArb[i] !== undefined ? Math.round(cerGseIncentiveBessArb[i]) : 0;
                    const cerGseTsVal = cerGseIncentiveBessTs[i] !== undefined ? Math.round(cerGseIncentiveBessTs[i]) : 0;
                    rowsHTML += `
                            <td class="px-4 py-2.5 text-right font-mono text-slate-400 bg-emerald-950/5 border-l border-slate-850/60">€${revPure.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-emerald-500 bg-emerald-950/5">€${revActual.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-amber-500 bg-emerald-950/5">€${revArb.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-cyan-400 bg-emerald-950/5">€${revTshift.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-rose-400 bg-emerald-950/5">€${costWithd.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-violet-400 bg-emerald-950/5">€${revPpaPvVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-pink-500 bg-emerald-950/5">€${revPpaBessArbVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-pink-400 bg-emerald-950/5">€${revPpaBessTsVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-indigo-300 bg-emerald-950/5">€${cerGsePvVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-purple-300 bg-emerald-950/5">€${cerGseArbVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-purple-400 bg-emerald-950/5">€${cerGseTsVal.toLocaleString('it-IT')}</td>
                        </tr>
                    `;
                } else {
                    rowsHTML += `
                            <td class="px-4 py-2.5 text-right font-mono text-slate-400 bg-emerald-950/5 border-l border-slate-850/60">€${revPure.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-emerald-500 bg-emerald-950/5">€${revActual.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-amber-500 bg-emerald-950/5">€${revArb.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-cyan-400 bg-emerald-950/5">€${revTshift.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-rose-400 bg-emerald-950/5">€${costWithd.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-violet-400 bg-emerald-950/5">€${revPpaPvVal.toLocaleString('it-IT')}</td>
                            <td class="px-4 py-2.5 text-right font-mono text-pink-400 bg-emerald-950/5">€${revPpaBessVal.toLocaleString('it-IT')}</td>
                        </tr>
                    `;
                }
            }
            tbody.innerHTML = rowsHTML;
        }

        // Export active BESS profile data as CSV
        function downloadProfileCSV() {
            const activeData = State.activeProfileData;
            if (!activeData || !activeData.labels || activeData.labels.length === 0) {
                alert("Nessun dato disponibile da esportare.");
                return;
            }

            const resolution = State.chartResolution || 'giorno';
            const aggregation = State.chartAggregation || 'orario';
            const hasStab = activeData.stabLoad && activeData.stabLoad.length > 0;
            const _isCer = State.stabilimenti.filter(s => s.enabled !== false).some(s => s.ppaType === 'cer');
            const zones = activeData.selectedZones || ["CNOR"];
            const zonalPrices = activeData.zonalPrices || {};

            let csv = "Periodo/Tempo;Generazione FV (kWh);Cessione FV alla Rete (kWh);";
            if (hasStab) {
                if (_isCer) {
                    csv += "Fabbisogno Virtuale Membri CER (kWh);Energia Condivisa Virtuale FV (kWh);Energia Condivisa BESS da Arbitraggio (kWh);Energia Condivisa BESS da Timeshifting (kWh);";
                } else {
                    csv += "Consumo (kWh);Autoconsumo da FV (kWh);Autoconsumo da BESS (kWh);";
                }
            }
            csv += "Carica BESS da FV (kWh);Carica BESS da Rete (kWh);Scarica BESS alla Rete (kWh);Scarica BESS alla Rete da Arbitraggio (kWh);Scarica BESS alla Rete da Timeshifting (kWh);Scarica BESS a Stabilimento (kWh);Perdite RTE BESS (kWh);SoC (%);";
            
            zones.forEach(zone => {
                csv += `Prezzo PUN ${zone} (EUR/MWh);`;
            });

            if (_isCer) {
                csv += "Ricavi RID / FER X (Pure) (EUR);Ricavi RID / FER X (Reali) (EUR);Ricavi Arbitraggio (EUR);Ricavi Timeshifting (EUR);Costi Prelievo (EUR);Ricavi SPV da CER FV (EUR);Ricavi SPV da CER BESS da Arbitraggio (EUR);Ricavi SPV da CER BESS da Timeshifting (EUR);Incentivo GSE CER FV (EUR);Incentivo GSE CER BESS da Arbitraggio (EUR);Incentivo GSE CER BESS da Timeshifting (EUR)\n";
            } else {
                csv += "Ricavi RID / FER X (Pure) (EUR);Ricavi RID / FER X (Reali) (EUR);Ricavi Arbitraggio (EUR);Ricavi Timeshifting (EUR);Costi Prelievo (EUR);Ricavi PPA FV (EUR);Ricavi PPA BESS (EUR)\n";
            }

            const formatDateForExport = (date, agg) => {
                if (!date) return "";
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                if (agg === 'mensile') return `${y}-${m}`;
                if (agg === 'giornaliero') return `${y}-${m}-${d}`;
                const hh = String(date.getHours()).padStart(2, '0');
                return `${y}-${m}-${d} ${hh}:00`;
            };

            const formatDec = (val) => {
                if (val === undefined || val === null || isNaN(val)) return "0,00";
                return val.toFixed(2).replace('.', ',');
            };

            for (let i = 0; i < activeData.labels.length; i++) {
                const label = activeData.labels[i];
                const dateVal = activeData.dates && activeData.dates[i] ? activeData.dates[i] : null;
                const dateStrVal = dateVal ? formatDateForExport(dateVal, aggregation) : label;
                const sol = activeData.solGen[i] !== undefined ? formatDec(activeData.solGen[i]) : 0;
                const gridFeedPv = activeData.batGridFeedPv[i] !== undefined ? formatDec(activeData.batGridFeedPv[i]) : 0;
                const chgSolar = activeData.batChargeSolar[i] !== undefined ? formatDec(activeData.batChargeSolar[i]) : 0;
                const chgGrid = activeData.batChargeGrid[i] !== undefined ? formatDec(activeData.batChargeGrid[i]) : 0;
                const disGrid = activeData.batDischargeGrid[i] !== undefined ? formatDec(activeData.batDischargeGrid[i]) : 0;
                const disGridArb = activeData.batDischargeGridArb[i] !== undefined ? formatDec(activeData.batDischargeGridArb[i]) : 0;
                const disGridTs = activeData.batDischargeGridTs[i] !== undefined ? formatDec(activeData.batDischargeGridTs[i]) : 0;
                const disPpa = activeData.batDischargePpa[i] !== undefined ? formatDec(activeData.batDischargePpa[i]) : 0;
                const loss = activeData.lossesRte[i] !== undefined ? formatDec(activeData.lossesRte[i]) : 0;
                const soc = activeData.batSoC[i] !== undefined ? formatDec(activeData.batSoC[i]) : 0;

                let rowStr = `"${dateStrVal}";${sol};${gridFeedPv}`;
                if (hasStab) {
                    const loadVal = activeData.stabLoad[i] !== undefined ? formatDec(activeData.stabLoad[i]) : 0;
                    const consSolar = activeData.selfConsSolar[i] !== undefined ? formatDec(activeData.selfConsSolar[i]) : 0;
                    if (_isCer) {
                        const consBessArb = activeData.selfConsBessArb[i] !== undefined ? formatDec(activeData.selfConsBessArb[i]) : 0;
                        const consBessTs = activeData.selfConsBessTs[i] !== undefined ? formatDec(activeData.selfConsBessTs[i]) : 0;
                        rowStr += `;${loadVal};${consSolar};${consBessArb};${consBessTs}`;
                    } else {
                        const consBess = activeData.selfConsBess[i] !== undefined ? formatDec(activeData.selfConsBess[i]) : 0;
                        rowStr += `;${loadVal};${consSolar};${consBess}`;
                    }
                }
                rowStr += `;${chgSolar};${chgGrid};${disGrid};${disGridArb};${disGridTs};${disPpa};${loss};${soc}`;

                zones.forEach(zone => {
                    const zPrices = zonalPrices[zone] || [];
                    const zPriceVal = zPrices[i] !== undefined ? formatDec(zPrices[i]) : "0,00";
                    rowStr += `;${zPriceVal}`;
                });

                const revPure = activeData.revRidPure[i] !== undefined ? formatDec(activeData.revRidPure[i]) : 0;
                const revActual = activeData.revRidActual[i] !== undefined ? formatDec(activeData.revRidActual[i]) : 0;
                const revArb = activeData.revArbitrage[i] !== undefined ? formatDec(activeData.revArbitrage[i]) : 0;
                const revTshift = activeData.revTimeshifting[i] !== undefined ? formatDec(activeData.revTimeshifting[i]) : 0;
                const costWithd = activeData.costWithdrawal[i] !== undefined ? formatDec(activeData.costWithdrawal[i]) : 0;
                const revPpaPvVal = activeData.revPpaPv[i] !== undefined ? formatDec(activeData.revPpaPv[i]) : 0;

                if (_isCer) {
                    const revPpaBessArbVal = activeData.revPpaBessArb[i] !== undefined ? formatDec(activeData.revPpaBessArb[i]) : 0;
                    const revPpaBessTsVal = activeData.revPpaBessTs[i] !== undefined ? formatDec(activeData.revPpaBessTs[i]) : 0;
                    const cerGsePvVal = activeData.cerGseIncentivePv[i] !== undefined ? formatDec(activeData.cerGseIncentivePv[i]) : 0;
                    const cerGseArbVal = activeData.cerGseIncentiveBessArb[i] !== undefined ? formatDec(activeData.cerGseIncentiveBessArb[i]) : 0;
                    const cerGseTsVal = activeData.cerGseIncentiveBessTs[i] !== undefined ? formatDec(activeData.cerGseIncentiveBessTs[i]) : 0;
                    rowStr += `;${revPure};${revActual};${revArb};${revTshift};${costWithd};${revPpaPvVal};${revPpaBessArbVal};${revPpaBessTsVal};${cerGsePvVal};${cerGseArbVal};${cerGseTsVal}\n`;
                } else {
                    const revPpaBessVal = activeData.revPpaBess[i] !== undefined ? formatDec(activeData.revPpaBess[i]) : 0;
                    rowStr += `;${revPure};${revActual};${revArb};${revTshift};${costWithd};${revPpaPvVal};${revPpaBessVal}\n`;
                }
                csv += rowStr;
            }

            const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            const filename = `profilo_bess_${resolution}_${aggregation}.csv`;
            
            const profileBlobUrl = URL.createObjectURL(blob);
            link.href = profileBlobUrl;
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(profileBlobUrl);
        }

        // Export active BESS profile data as Excel (using SheetJS)
        function downloadProfileExcel() {
            const activeData = State.activeProfileData;
            if (!activeData || !activeData.labels || activeData.labels.length === 0) {
                alert("Nessun dato disponibile da esportare.");
                return;
            }

            const resolution = State.chartResolution || 'giorno';
            const aggregation = State.chartAggregation || 'orario';
            const hasStab = activeData.stabLoad && activeData.stabLoad.length > 0;
            const activeStabs = State.stabilimenti.filter(s => s.enabled !== false);
            const isCER = activeStabs.some(s => s.ppaType === 'cer');
            const zones = activeData.selectedZones || ["CNOR"];
            const zonalPrices = activeData.zonalPrices || {};

            const formatDateForExport = (date, agg) => {
                if (!date) return "";
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                if (agg === 'mensile') return `${y}-${m}`;
                if (agg === 'giornaliero') return `${y}-${m}-${d}`;
                const hh = String(date.getHours()).padStart(2, '0');
                return `${y}-${m}-${d} ${hh}:00`;
            };

            const formatDec = (val) => {
                if (val === undefined || val === null || isNaN(val)) return 0;
                return parseFloat(val.toFixed(2));
            };

            const excelRows = [];
            for (let i = 0; i < activeData.labels.length; i++) {
                const label = activeData.labels[i];
                const dateVal = activeData.dates && activeData.dates[i] ? activeData.dates[i] : null;
                const dateStrVal = dateVal ? formatDateForExport(dateVal, aggregation) : label;
                const sol = activeData.solGen[i] !== undefined ? formatDec(activeData.solGen[i]) : 0;
                const gridFeedPv = activeData.batGridFeedPv[i] !== undefined ? formatDec(activeData.batGridFeedPv[i]) : 0;
                const chgSolar = activeData.batChargeSolar[i] !== undefined ? formatDec(activeData.batChargeSolar[i]) : 0;
                const chgGrid = activeData.batChargeGrid[i] !== undefined ? formatDec(activeData.batChargeGrid[i]) : 0;
                const disGrid = activeData.batDischargeGrid[i] !== undefined ? formatDec(activeData.batDischargeGrid[i]) : 0;
                const disGridArb = activeData.batDischargeGridArb[i] !== undefined ? formatDec(activeData.batDischargeGridArb[i]) : 0;
                const disGridTs = activeData.batDischargeGridTs[i] !== undefined ? formatDec(activeData.batDischargeGridTs[i]) : 0;
                const disPpa = activeData.batDischargePpa[i] !== undefined ? formatDec(activeData.batDischargePpa[i]) : 0;
                const loss = activeData.lossesRte[i] !== undefined ? formatDec(activeData.lossesRte[i]) : 0;
                const soc = activeData.batSoC[i] !== undefined ? formatDec(activeData.batSoC[i]) : 0;

                const row = {};
                row["Periodo / Tempo"] = dateStrVal;
                row["Generazione FV (kWh)"] = sol;
                row["Cessione FV alla Rete (kWh)"] = gridFeedPv;

                if (hasStab) {
                    if (isCER) {
                        row["Fabbisogno Virtuale Membri CER (kWh)"] = activeData.stabLoad[i] !== undefined ? formatDec(activeData.stabLoad[i]) : 0;
                        row["Energia Condivisa Virtuale FV (kWh)"] = activeData.selfConsSolar[i] !== undefined ? formatDec(activeData.selfConsSolar[i]) : 0;
                        row["Energia Condivisa BESS da Arbitraggio (kWh)"] = activeData.selfConsBessArb[i] !== undefined ? formatDec(activeData.selfConsBessArb[i]) : 0;
                        row["Energia Condivisa BESS da Timeshifting (kWh)"] = activeData.selfConsBessTs[i] !== undefined ? formatDec(activeData.selfConsBessTs[i]) : 0;
                    } else {
                        row["Consumo (kWh)"] = activeData.stabLoad[i] !== undefined ? formatDec(activeData.stabLoad[i]) : 0;
                        row["Autoconsumo da FV (kWh)"] = activeData.selfConsSolar[i] !== undefined ? formatDec(activeData.selfConsSolar[i]) : 0;
                        row["Autoconsumo da BESS (kWh)"] = activeData.selfConsBess[i] !== undefined ? formatDec(activeData.selfConsBess[i]) : 0;
                    }
                }

                row["Carica BESS da FV (kWh)"] = chgSolar;
                row["Carica BESS da Rete (kWh)"] = chgGrid;
                row["Scarica BESS alla Rete (kWh)"] = disGrid;
                row["Scarica BESS alla Rete da Arbitraggio (kWh)"] = disGridArb;
                row["Scarica BESS alla Rete da Timeshifting (kWh)"] = disGridTs;
                if (isCER) {
                    row["Scarica BESS Condivisa Virtuale (kWh)"] = disPpa;
                } else {
                    row["Scarica BESS a Stabilimento (kWh)"] = disPpa;
                }
                row["Perdite RTE BESS (kWh)"] = loss;
                row["SoC (%)"] = soc;

                zones.forEach(zone => {
                    const zPrices = zonalPrices[zone] || [];
                    row[`Prezzo PUN ${zone} (€/MWh)`] = zPrices[i] !== undefined ? formatDec(zPrices[i]) : 0;
                });

                const revPure = activeData.revRidPure[i] !== undefined ? formatDec(activeData.revRidPure[i]) : 0;
                const revActual = activeData.revRidActual[i] !== undefined ? formatDec(activeData.revRidActual[i]) : 0;
                const revArb = activeData.revArbitrage[i] !== undefined ? formatDec(activeData.revArbitrage[i]) : 0;
                const revTshift = activeData.revTimeshifting[i] !== undefined ? formatDec(activeData.revTimeshifting[i]) : 0;
                const costWithd = activeData.costWithdrawal[i] !== undefined ? formatDec(activeData.costWithdrawal[i]) : 0;

                row["Ricavi RID / FER X (Pure) (€)"] = revPure;
                row["Ricavi RID / FER X (Reali) (€)"] = revActual;
                row["Ricavi Arbitraggio (€)"] = revArb;
                row["Ricavi Timeshifting (€)"] = revTshift;
                row["Costi Prelievo (€)"] = costWithd;

                if (isCER) {
                    row["Ricavi SPV da CER FV (€)"] = activeData.revPpaPv[i] !== undefined ? formatDec(activeData.revPpaPv[i]) : 0;
                    row["Ricavi SPV da CER BESS da Arbitraggio (€)"] = activeData.revPpaBessArb[i] !== undefined ? formatDec(activeData.revPpaBessArb[i]) : 0;
                    row["Ricavi SPV da CER BESS da Timeshifting (€)"] = activeData.revPpaBessTs[i] !== undefined ? formatDec(activeData.revPpaBessTs[i]) : 0;
                    row["Incentivo GSE CER FV (€)"] = activeData.cerGseIncentivePv[i] !== undefined ? formatDec(activeData.cerGseIncentivePv[i]) : 0;
                    row["Incentivo GSE CER BESS da Arbitraggio (€)"] = activeData.cerGseIncentiveBessArb[i] !== undefined ? formatDec(activeData.cerGseIncentiveBessArb[i]) : 0;
                    row["Incentivo GSE CER BESS da Timeshifting (€)"] = activeData.cerGseIncentiveBessTs[i] !== undefined ? formatDec(activeData.cerGseIncentiveBessTs[i]) : 0;
                } else {
                    row["Ricavi PPA FV (€)"] = activeData.revPpaPv[i] !== undefined ? formatDec(activeData.revPpaPv[i]) : 0;
                    row["Ricavi PPA BESS (€)"] = activeData.revPpaBess[i] !== undefined ? formatDec(activeData.revPpaBess[i]) : 0;
                }

                excelRows.push(row);
            }

            try {
                const worksheet = XLSX.utils.json_to_sheet(excelRows);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Dati Profilo BESS");
                
                // Adjust column widths automatically
                const keys = Object.keys(excelRows[0]);
                const colWidths = keys.map(key => {
                    let maxLen = key.length;
                    excelRows.forEach(row => {
                        const val = row[key];
                        if (val !== undefined && val !== null) {
                            maxLen = Math.max(maxLen, String(val).length);
                        }
                    });
                    return { wch: maxLen + 2 };
                });
                worksheet['!cols'] = colWidths;

                const filename = `profilo_bess_${resolution}_${aggregation}.xlsx`;
                XLSX.writeFile(workbook, filename);
            } catch (err) {
                console.error("Errore durante l'esportazione Excel:", err);
                alert("Si è verificato un errore durante la generazione del file Excel.");
            }
        }

        function changeSelectedDay(val) {
            State.selectedDay = parseInt(val);
            State.selectedPeriodIndex = parseInt(val);
            const resolution = State.chartResolution || 'giorno';
            const period = getPeriodHours(resolution, State.selectedPeriodIndex);
            document.getElementById('label-selected-day').textContent = period.label;
            renderHourlyProfileChart();
        }

        function changeChartAggregation(val) {
            State.chartAggregation = val;
            renderHourlyProfileChart();
        }

        function updateAggregationDropdown(resolution) {
            const selectAgg = document.getElementById('select-chart-aggregation');
            if (!selectAgg) return;
            
            const optOrario = selectAgg.querySelector('option[value="orario"]');
            const optGiornaliero = selectAgg.querySelector('option[value="giornaliero"]');
            const optMensile = selectAgg.querySelector('option[value="mensile"]');
            
            optOrario.disabled = false;
            optGiornaliero.disabled = false;
            optMensile.disabled = false;
            
            if (resolution === 'giorno') {
                optGiornaliero.disabled = true;
                optMensile.disabled = true;
                State.chartAggregation = 'orario';
                selectAgg.value = 'orario';
            } else if (resolution === 'settimana' || resolution === 'mese') {
                optMensile.disabled = true;
                if (State.chartAggregation === 'mensile') {
                    State.chartAggregation = 'giornaliero';
                    selectAgg.value = 'giornaliero';
                }
            }
        }

        function changeChartResolution(resolution) {
            State.chartResolution = resolution;
            const slider = document.getElementById('slider-selected-day');
            const label = document.getElementById('label-selected-day');
            const sliderContainer = document.getElementById('slider-container-selected-day');
            
            if (resolution === 'giorno') {
                slider.min = 1;
                slider.max = 365;
                State.selectedPeriodIndex = Math.min(365, State.selectedPeriodIndex || 1);
                slider.value = State.selectedPeriodIndex;
                sliderContainer.style.display = 'flex';
            } else if (resolution === 'settimana') {
                slider.min = 1;
                slider.max = 52;
                const currentDay = State.selectedDay || 1;
                State.selectedPeriodIndex = Math.min(52, Math.ceil(currentDay / 7));
                slider.value = State.selectedPeriodIndex;
                sliderContainer.style.display = 'flex';
            } else if (resolution === 'mese') {
                slider.min = 1;
                slider.max = 12;
                const currentDay = State.selectedDay || 1;
                const d = new Date(2025, 0, currentDay);
                State.selectedPeriodIndex = d.getMonth() + 1;
                slider.value = State.selectedPeriodIndex;
                sliderContainer.style.display = 'flex';
            } else if (resolution === 'trimestre') {
                slider.min = 1;
                slider.max = 4;
                const currentDay = State.selectedDay || 1;
                const d = new Date(2025, 0, currentDay);
                State.selectedPeriodIndex = Math.floor(d.getMonth() / 3) + 1;
                slider.value = State.selectedPeriodIndex;
                sliderContainer.style.display = 'flex';
            } else if (resolution === 'semestre') {
                slider.min = 1;
                slider.max = 2;
                const currentDay = State.selectedDay || 1;
                State.selectedPeriodIndex = currentDay <= 181 ? 1 : 2;
                slider.value = State.selectedPeriodIndex;
                sliderContainer.style.display = 'flex';
            } else if (resolution === 'anno') {
                State.selectedPeriodIndex = 1;
                sliderContainer.style.display = 'none';
            }
            
            updateAggregationDropdown(resolution);
            
            const period = getPeriodHours(resolution, State.selectedPeriodIndex);
            label.textContent = period.label;
            renderHourlyProfileChart();
        }

        // Toggle the BESS plants filter dropdown menu
        function toggleBessPlantsDropdown() {
            const menu = document.getElementById('bess-plants-dropdown-menu');
            if (menu) {
                menu.classList.toggle('hidden');
            }
        }

        // Render the BESS plants filter dropdown menu
        function renderBessPlantsDropdown() {
            const menu = document.getElementById('bess-plants-dropdown-menu');
            if (!menu) return;
            
            const activePlants = State.plants ? State.plants.filter(p => p.enabled !== false) : [];
            
            // Clear existing menu
            menu.innerHTML = '';
            
            if (activePlants.length === 0) {
                menu.innerHTML = '<div class="text-[10px] text-slate-500 px-2 py-1.5 text-center">Nessun impianto attivo</div>';
                const label = document.getElementById('bess-plants-dropdown-label');
                if (label) label.textContent = "-";
                return;
            }
            
            if (!State.selectedBessPlantIds) {
                State.selectedBessPlantIds = new Set(activePlants.map(p => p.id));
            }
            
            // 1. "Seleziona Tutti" option
            const allSelected = activePlants.every(p => State.selectedBessPlantIds.has(p.id));
            const selectAllDiv = document.createElement('div');
            selectAllDiv.className = "flex items-center space-x-2 px-2 py-1 hover:bg-slate-900 rounded cursor-pointer transition-colors border-b border-slate-900 pb-1.5 mb-1";
            selectAllDiv.innerHTML = `
                <input type="checkbox" id="chk-bess-plant-all" ${allSelected ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950">
                <label for="chk-bess-plant-all" class="text-xs text-slate-200 font-semibold cursor-pointer select-none">Seleziona Tutti</label>
            `;
            
            selectAllDiv.querySelector('input').addEventListener('change', function(e) {
                const checked = e.target.checked;
                if (checked) {
                    activePlants.forEach(p => State.selectedBessPlantIds.add(p.id));
                } else {
                    State.selectedBessPlantIds.clear();
                }
                updateDropdownMenuAndChart();
            });
            menu.appendChild(selectAllDiv);
            
            // 2. Individual plant options
            activePlants.forEach(plant => {
                const isSelected = State.selectedBessPlantIds.has(plant.id);
                const plantDiv = document.createElement('div');
                plantDiv.className = "flex items-center space-x-2 px-2 py-1 hover:bg-slate-900 rounded cursor-pointer transition-colors";
                plantDiv.innerHTML = `
                    <input type="checkbox" id="chk-bess-plant-${plant.id}" ${isSelected ? 'checked' : ''} class="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950">
                    <label for="chk-bess-plant-${plant.id}" class="text-xs text-slate-300 truncate cursor-pointer select-none w-full">${escapeHtml(plant.name)}</label>
                `;
                
                plantDiv.querySelector('input').addEventListener('change', function(e) {
                    const checked = e.target.checked;
                    if (checked) {
                        State.selectedBessPlantIds.add(plant.id);
                    } else {
                        State.selectedBessPlantIds.delete(plant.id);
                    }
                    updateDropdownMenuAndChart();
                });
                menu.appendChild(plantDiv);
            });
            
            // Update button label
            updateDropdownButtonLabel();
            
            function updateDropdownMenuAndChart() {
                renderBessPlantsDropdown();
                renderHourlyProfileChart();
            }
            
            function updateDropdownButtonLabel() {
                const label = document.getElementById('bess-plants-dropdown-label');
                if (!label) return;
                
                const selectedCount = Array.from(State.selectedBessPlantIds).filter(id => activePlants.some(p => p.id === id)).length;
                
                if (selectedCount === activePlants.length) {
                    label.textContent = "Tutti";
                } else if (selectedCount === 0) {
                    label.textContent = "Nessuno";
                } else if (selectedCount === 1) {
                    const singleId = Array.from(State.selectedBessPlantIds).find(id => activePlants.some(p => p.id === id));
                    const plant = activePlants.find(p => p.id === singleId);
                    label.textContent = plant ? plant.name : "1 Impianto";
                } else {
                    label.textContent = `${selectedCount} Impianti`;
                }
            }
        }

        // Close Bess and Gme plants dropdowns when clicking outside
        window.addEventListener('click', function(e) {
            const menu = document.getElementById('bess-plants-dropdown-menu');
            const btn = document.getElementById('btn-bess-plants-dropdown');
            if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.add('hidden');
            }
            const gmeMenu = document.getElementById('gme-plants-dropdown-menu');
            const gmeBtn = document.getElementById('btn-gme-plants-dropdown');
            if (gmeMenu && gmeBtn && !gmeBtn.contains(e.target) && !gmeMenu.contains(e.target)) {
                gmeMenu.classList.add('hidden');
            }
        });

        // Supabase DB synchronization implementation
        async function syncToSupabase() {
            const url = document.getElementById('supabase-url').value.trim();
            const key = document.getElementById('supabase-key').value.trim();
            const statusEl = document.getElementById('sync-status');
            
            if (!url || !key) {
                alert("Inserisci l'URL di Supabase e la Anon API Key per procedere con la sincronizzazione.");
                return;
            }
            
            statusEl.textContent = "Connessione in corso...";
            statusEl.className = "text-xs text-amber-400 font-medium";

            try {
                // Initialize Supabase Client (avoiding shadowing error)
                supabaseClient = supabase.createClient(url, key);
                
                // Prepare consolidated hourly telemetry rows
                const telemetryRows = [];
                const r = State.results;
                for (let t = 0; t < 8760; t++) {
                    telemetryRows.push({
                        hour_index: t,
                        generation_kw: r.combinedSolarProfile[t],
                        price_eur_mwh: r.generalMedionePrices[t],
                        bess_soc_kwh: r.bessSimulation.hourlySoC[t],
                        bess_charge_kw: r.bessSimulation.hourlyCharge[t],
                        bess_discharge_kw: r.bessSimulation.hourlyDischarge[t],
                        bess_charge_solar_kw: r.bessSimulation.hourlyChargeSolar[t],
                        bess_charge_grid_kw: r.bessSimulation.hourlyChargeGrid[t],
                        bess_discharge_grid_kw: r.bessSimulation.hourlyDischargeGrid[t],
                        bess_discharge_ppa_kw: r.bessSimulation.hourlyDischargePpa[t],
                        self_consumption_solar_kw: r.bessSimulation.hourlySelfConsSolar[t],
                        self_consumption_bess_kw: r.bessSimulation.hourlySelfConsBess[t],
                        bess_losses_kw: r.bessSimulation.hourlyLossesRte[t],
                        pv_grid_feed_kw: r.bessSimulation.hourlyGridFeedPv[t],
                        revenue_rid_pure_eur: r.bessSimulation.hourlyRevenueRidPure[t],
                        revenue_rid_actual_eur: r.bessSimulation.hourlyRevenueRidActual[t],
                        revenue_arbitrage_grid_eur: r.bessSimulation.hourlyRevenueArbitrageGrid[t],
                        revenue_ppa_pv_eur: r.bessSimulation.hourlyRevenuePpaPv[t],
                        revenue_ppa_bess_eur: r.bessSimulation.hourlyRevenuePpaBess[t],
                        revenue_timeshifting_eur: r.bessSimulation.hourlyRevenueTimeshifting[t] || 0,
                        cost_withdrawal_bess_eur: r.bessSimulation.hourlyCostWithdrawal[t] || 0
                    });
                }

                statusEl.textContent = "Invio dati in batch...";
                
                // Chunk size 1000 records
                const chunkSize = 1000;
                for (let i = 0; i < telemetryRows.length; i += chunkSize) {
                    const chunk = telemetryRows.slice(i, i + chunkSize);
                    // Send to Supabase Table 'hourly_telemetry'
                    const { error } = await supabaseClient
                        .from('hourly_telemetry')
                        .upsert(chunk, { onConflict: 'hour_index' });
                    
                    if (error) throw error;
                }
                
                statusEl.textContent = "Sincronizzazione completata!";
                statusEl.className = "text-xs text-emerald-400 font-medium";
                alert("Tutti gli 8760 record orari sono stati inseriti ed allineati con successo sul database Supabase.");
            } catch (err) {
                console.error(err);
                statusEl.textContent = "Errore di connessione.";
                statusEl.className = "text-xs text-red-400 font-medium";
                alert("Errore durante l'invio batch dei dati. Verifica le credenziali Supabase.");
            }
        }

        // Debounce per i ricalcoli da digitazione: evita una simulazione completa ad ogni keystroke
        let recalcDebounceTimer = null;
        function triggerRecalculateDebounced(ms = 350) {
            clearTimeout(recalcDebounceTimer);
            recalcDebounceTimer = setTimeout(triggerRecalculate, ms);
        }

        // Attach event listeners to all sliders
        function attachEventListeners() {
            const sliders = [
                'slide-leverage', 'slide-interest', 'slide-loan-term', 'slide-fiscal-depreciation',
                'slide-senior-grace-period', 'slide-construction-months', 'slide-idc-drawdown',
                'slide-soci-equity-pct', 'slide-soci-interest-rate',
                'slide-pd-interest-rate', 'slide-pe-hurdle-rate', 'slide-pe-preferred-pct', 'slide-pe-royalty-pct',
                'slide-af-revenue-pct', 'slide-af-exit-pct', 'slide-af-warrant-pct', 'slide-af-convertible-rate', 'slide-af-convertible-pct',
                'input-exit-option'
            ];
            sliders.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => triggerRecalculateDebounced(350));
            });
            const selects = ['select-debt-basis', 'select-sweep-type', 'select-price-scenario-type', 'select-bess-optimizer',
                'select-pd-amount-type', 'select-pd-mode', 'select-pd-waterfall-rank',
                'select-pe-amount-type', 'select-pe-mode', 'select-af-type'
            ];
            selects.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', triggerRecalculate);
            });
            const sweepInputs = [
                'input-sweep-value', 'input-sweep-years', 'input-sculpting-enabled', 'input-target-dscr',
                'input-dsra-months', 'input-refi-enabled', 'input-refi-year', 'input-refi-rate', 'input-refi-term',
                'input-soci-interest-grace', 'input-soci-principal-grace',
                'input-holdco-capital',
                'input-pd-amount-value', 'input-pd-interest-grace', 'input-pd-principal-grace', 'input-pd-loan-term',
                'input-pd-enabled', 'input-pd-tax-deductible',
                'input-pe-amount-value', 'input-pe-exit-multiple', 'input-pe-enabled', 'input-pe-participates-exit',
                'input-af-annual-amount', 'input-af-convertible-amount', 'input-af-enabled', 'input-af-tax-deductible'
            ];
            // I 3 campi exit (multiple, value-mwp, ev) usano onchange (non oninput) per evitare
            // che ogni keystroke triggeri il ricalcolo worker e sovrascriva il campo durante la digitazione.
            const exitChangeInputs = ['input-exit-multiple', 'input-exit-value-mwp', 'input-exit-ev'];
            sweepInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => triggerRecalculateDebounced(350));
            });
            exitChangeInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', triggerRecalculate);
            });
            const inputs = [
                'input-ke-val', 'input-wacc', 'input-inflation', 'input-ires-rate', 'input-irap-rate', 'input-pun-zonal-floor', 'input-pun-bearish-decay-rate', 'input-ts-bearish-decay-rate', 'input-arb-bearish-decay-rate', 'input-dividend-lock',
                'input-ridLossInjectBt', 'input-ridLossInjectMt', 'input-ridLossInjectAt',
                'input-ridLossWithdrawBt', 'input-ridLossWithdrawMt', 'input-ridLossWithdrawAt',
                'input-cerLossCprBt', 'input-cerLossCprMt', 'input-cerLossCprAt',
                'input-ridImbalanceCost', 'input-msd-eur-mw-yr',
                'input-cerTras',
                'input-cerFissaSmall', 'input-cerFissaMedium', 'input-cerFissaLarge',
                'input-cerCapSmall', 'input-cerCapMedium', 'input-cerCapLarge',
                'input-cerVarReferencePrice', 'input-cerVarMax',
                'input-cerGeoNord', 'input-cerGeoCentro', 'input-cerGeoSud'
            ];
            inputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', () => triggerRecalculateDebounced(350));
            });

            // Event delegation for plant form changes
            const formContainer = document.getElementById('plant-form-container');
            if (formContainer) {
                formContainer.addEventListener('input', updateFormSubmitButtonState);
                formContainer.addEventListener('change', updateFormSubmitButtonState);
            }

            // PVGIS File: full header + generation parse on file selection
            // Enter key nel form di login
            ['auth-email', 'auth-password'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginUser(); });
            });

            const pvgisFileEl = document.getElementById('pvgis-file');
            if (pvgisFileEl) {
                pvgisFileEl.addEventListener('change', function(event) {
                    const file = event.target.files[0];
                    if (!file) {
                        updateFormSubmitButtonState();
                        return;
                    }
                    window._pvgisApiText = null; // un file manuale invalida il download API
                    updateFormSubmitButtonState();

                    const reader = new FileReader();
                    reader.onload = function(e) {
                        processPvgisContent(e.target.result);
                    };
                    reader.readAsText(file);
                });
            }
        }

        // Parsing condiviso di un contenuto PVGIS (da file CSV o scaricato da API):
        // header metadati, curva oraria 8760, KPI impianto
        function processPvgisContent(content) {
                        const pvgisFileEl = document.getElementById('pvgis-file');
                        const setRo = (id, val) => {
                            const el = document.getElementById(id);
                            if (el && val !== null && val !== undefined) el.value = val;
                        };

                        // ── 1. Parse header metadata (first 1200 chars) ──
                        const hdr = content.substring(0, 1200);
                        const capMatch   = hdr.match(/Nominal power of the PV system.*?:\s*([\d.]+)/i);
                        const latMatch   = hdr.match(/Latitude[^:]*:\s*([\d.]+)/i);
                        const lonMatch   = hdr.match(/Longitude[^:]*:\s*([\d.]+)/i);
                        const eleMatch   = hdr.match(/Elevation[^:]*:\s*([\d.]+)/i);
                        const slopeMatch = hdr.match(/Slope:\s*([\d.]+)/i);
                        const azimMatch  = hdr.match(/Azimuth:\s*([^\r\n\t]+)/i);
                        const lossMatch  = hdr.match(/System losses[^:]*:\s*([\d.]+)/i);
                        const trackMatch = hdr.match(/Tracking[^:]*:\s*([^\r\n]+)/i);
                        const dbMatch    = hdr.match(/Radiation database:\s*([^\r\n]+)/i);

                        const capacity = capMatch ? parseFloat(capMatch[1]) : 0;

                        // Populate PVGIS metadata fields
                        const capEl = document.getElementById('plant-capacity');
                        if (capEl && capacity > 0) capEl.value = Math.round(capacity);
                        setRo('pvgis-latitude',     latMatch   ? parseFloat(latMatch[1])   : null);
                        setRo('pvgis-longitude',    lonMatch   ? parseFloat(lonMatch[1])   : null);
                        setRo('pvgis-elevation',    eleMatch   ? parseFloat(eleMatch[1])   : null);
                        setRo('pvgis-slope',        slopeMatch ? parseFloat(slopeMatch[1]) : null);
                        setRo('pvgis-azimuth',      azimMatch  ? azimMatch[1].trim().replace(/deg.?/i,'\u00b0').replace(/^-\s*\u00b0?$/,'Ottimale (0\u00b0 Sud)') : null);
                        setRo('pvgis-system-losses',lossMatch  ? parseFloat(lossMatch[1])  : null);
                        setRo('pvgis-tracking',     trackMatch ? trackMatch[1].trim() : 'Fixed');
                        setRo('pvgis-database',     dbMatch    ? dbMatch[1].trim()    : null);

                        // ── 2. Parse hourly generation data ──
                        const lines = content.split(/\r?\n/);
                        const generation = new Float64Array(8760);
                        let count = 0;
                        lines.forEach(line => {
                            if (line.trim().startsWith('#') || !line.trim()) return;
                            const parts = line.split(/[\t,;]/);
                            if (parts.length < 2) return;
                            const dateStr  = parts[0].trim();
                            const powerVal = parseFloat(parts[1].trim());
                            if (dateStr.includes(':')) {
                                const dateParts    = dateStr.split(':');
                                const yearMonthDay = dateParts[0];
                                const hourMin      = dateParts[1];
                                if (yearMonthDay.length === 8) {
                                    const month = parseInt(yearMonthDay.substring(4, 6));
                                    const day   = parseInt(yearMonthDay.substring(6, 8));
                                    const hour  = parseInt(hourMin.substring(0, 2));
                                    if (!isNaN(month) && !isNaN(day) && !isNaN(hour)) {
                                        const index = getHourIndex(month, day, hour);
                                        if (index >= 0 && index < 8760 && !isNaN(powerVal)) {
                                            generation[index] = powerVal / 1000; // W -> kW
                                            count++;
                                        }
                                    }
                                }
                            }
                        });

                        // ── 3. Fallback if parsing produced too few rows ──
                        if (count < 100 && capacity > 0) {
                            const defaultGen = generateDefaultSolarProfile(capacity / 1000, 1690);
                            for (let i = 0; i < 8760; i++) generation[i] = defaultGen[i];
                        }

                        // ── 4. Compute annual KWh and update KPI display fields ──
                        let annualKwh = 0;
                        for (let i = 0; i < 8760; i++) annualKwh += generation[i];

                        // Cache parsed data so submitPlantForm doesn't need to re-parse
                        pvgisFileEl._parsedCapacity   = capacity;
                        pvgisFileEl._parsedGeneration = generation;
                        pvgisFileEl._parsedAnnualKwh  = annualKwh;

                        if (capacity > 0 && annualKwh > 0) {
                            recalcPlantKpis(annualKwh, capacity);
                        }

                        // Expand the Dati PVGIS section so the user sees the values
                        const pvgisSection = document.querySelector('details:has(#pvgis-latitude)');
                        if (pvgisSection && !pvgisSection.open) pvgisSection.open = true;
        }

        // Scarica la curva oraria direttamente dalle API PVGIS 5.2 (JRC) dato lat/lon/picco/perdite
        window.importPvgisFromApi = async function() {
            if (editingPlantId) {
                alert("Termina prima la modifica dell'impianto in corso.");
                return;
            }
            const readNum = (msg, def, min, max) => {
                const raw = prompt(msg, def);
                if (raw === null) return null;
                const v = parseFloat(String(raw).replace(',', '.'));
                if (isNaN(v) || v < min || v > max) return undefined;
                return v;
            };
            const curLat = document.getElementById('pvgis-latitude')?.value;
            const curLon = document.getElementById('pvgis-longitude')?.value;
            const curCap = document.getElementById('plant-capacity')?.value;

            const lat = readNum('Latitudine (es. 43.55):', (curLat && curLat !== '-' && curLat !== '\u2014') ? curLat : '43.55', -90, 90);
            if (lat === null) return;
            if (lat === undefined) { alert('Latitudine non valida.'); return; }
            const lon = readNum('Longitudine (es. 10.31):', (curLon && curLon !== '-' && curLon !== '\u2014') ? curLon : '10.31', -180, 180);
            if (lon === null) return;
            if (lon === undefined) { alert('Longitudine non valida.'); return; }
            const peak = readNum('Potenza di picco (kWp):', curCap || '1000', 0.001, 1000000);
            if (peak === null) return;
            if (peak === undefined) { alert('Potenza non valida.'); return; }
            const loss = readNum('Perdite di sistema (%):', '14', 0, 100);
            if (loss === null) return;
            if (loss === undefined) { alert('Perdite di sistema non valide.'); return; }

            showCalcIndicator(true);
            try {
                const url = `https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=${lat}&lon=${lon}&pvcalculation=1&peakpower=${peak}&loss=${loss}&outputformat=csv`;
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const text = await resp.text();
                if (!text || text.length < 5000) throw new Error('Risposta PVGIS vuota o non valida.');
                window._pvgisApiText = text;
                processPvgisContent(text);
                updateFormSubmitButtonState();
            } catch (err) {
                console.error('Errore download PVGIS API:', err);
                alert('Impossibile scaricare i dati da PVGIS API:\n' + err.message + '\n\nVerifica la connessione o usa il caricamento CSV manuale.');
            } finally {
                showCalcIndicator(false);
            }
        };

        // Global functions for P&L collapsible rows
        window.toggleTableRowGroup = function(parentKey) {
            const parentRow = document.querySelector(`tr[data-row-key="${parentKey}"]`);
            if (!parentRow) return;
            
            const isExpanded = parentRow.getAttribute('data-expanded') === 'true';
            const newExpandedState = !isExpanded;
            parentRow.setAttribute('data-expanded', newExpandedState ? 'true' : 'false');
            
            // Update the toggle button icon
            const icon = document.getElementById(`toggle-icon-${parentKey}`);
            if (icon) {
                if (newExpandedState) {
                    icon.classList.remove('fa-plus');
                    icon.classList.add('fa-minus');
                } else {
                    icon.classList.remove('fa-minus');
                    icon.classList.add('fa-plus');
                }
            }
            
            if (newExpandedState) {
                // Expand: show immediate children
                const children = document.querySelectorAll(`tr[data-parent="${parentKey}"]`);
                children.forEach(child => {
                    child.classList.remove('hidden');
                    // If child has children and is expanded, recursively expand its children too
                    const childKey = child.getAttribute('data-row-key');
                    const childExpanded = child.getAttribute('data-expanded') === 'true';
                    if (childExpanded && childKey) {
                        expandTableRowGroupRecursively(childKey);
                    }
                });
            } else {
                // Collapse: hide all descendants recursively
                collapseTableRowGroupRecursively(parentKey);
            }
        };

        function expandTableRowGroupRecursively(parentKey) {
            const children = document.querySelectorAll(`tr[data-parent="${parentKey}"]`);
            children.forEach(child => {
                child.classList.remove('hidden');
                const childKey = child.getAttribute('data-row-key');
                const childExpanded = child.getAttribute('data-expanded') === 'true';
                if (childExpanded && childKey) {
                    expandTableRowGroupRecursively(childKey);
                }
            });
        }

        function collapseTableRowGroupRecursively(parentKey) {
            const children = document.querySelectorAll(`tr[data-parent="${parentKey}"]`);
            children.forEach(child => {
                child.classList.add('hidden');
                const childKey = child.getAttribute('data-row-key');
                if (childKey) {
                    collapseTableRowGroupRecursively(childKey);
                }
            });
        }

        // Synchronize horizontal scrolling between financials and debt tables
        function initScrollSync() {
            const containers = document.querySelectorAll('.sync-scroll');
            containers.forEach(container => {
                container.addEventListener('scroll', () => {
                    const scrollLeft = container.scrollLeft;
                    containers.forEach(other => {
                        if (other !== container && Math.abs(other.scrollLeft - scrollLeft) > 1) {
                            other.scrollLeft = scrollLeft;
                        }
                    });
                });
            });
        }

        // =========================================================
        // SENSITIVITY ANALYSIS
        // =========================================================

        function runSensitivity() {
            if (State.isUpdatePending) return;
            const btn = document.getElementById('btn-run-sensitivity');
            const statusEl = document.getElementById('sens-status');
            const container = document.getElementById('sens-results-container');
            if (!btn || !statusEl || !container || !document.getElementById('sens-var-x')) return;
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Calcolo in corso...';
            statusEl.textContent = "Elaborazione in corso...";
            statusEl.className = "px-2 py-1 text-xs rounded border bg-amber-900/50 text-amber-400 border-amber-800 animate-pulse";
            container.innerHTML = '<div class="text-center text-amber-400"><i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3"></i><p>Generazione matrice scenari in corso, attendere...</p></div>';

            const config = {
                xVar: document.getElementById('sens-var-x').value,
                xMin: parseFloat(document.getElementById('sens-var-x-min').value),
                xMax: parseFloat(document.getElementById('sens-var-x-max').value),
                xSteps: parseInt(document.getElementById('sens-var-x-steps').value),
                
                yVar: document.getElementById('sens-var-y').value,
                yMin: parseFloat(document.getElementById('sens-var-y-min').value),
                yMax: parseFloat(document.getElementById('sens-var-y-max').value),
                ySteps: parseInt(document.getElementById('sens-var-y-steps').value),
                
                targetKpi: document.getElementById('sens-target-kpi').value
            };

            syncStateFromDOM();
            initWorker();

            const payload = {
                State: {
                    inputs: State.inputs,
                    plants: State.plants,
                    stabilimenti: State.stabilimenti,
                    zonalPun: State.zonalPun,
                    selectedBessPlantIds: State.selectedBessPlantIds,
                    previouslySeenPlantIds: State.previouslySeenPlantIds
                },
                sensitivityConfig: config
            };

            simWorker.postMessage({
                action: 'EXECUTE_SENSITIVITY',
                payload: payload
            });
        }

        function renderSensitivityResults(results) {
            State.lastSensitivity = results; // disponibile per il report PDF
            const btn = document.getElementById('btn-run-sensitivity');
            const statusEl = document.getElementById('sens-status');
            const container = document.getElementById('sens-results-container');
            
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-play mr-2"></i> Esegui Analisi';
            statusEl.textContent = "Completato";
            statusEl.className = "px-2 py-1 text-xs rounded border bg-emerald-900/50 text-emerald-400 border-emerald-800";

            if (results.type === '1D') {
                renderSensitivity1D(results, container);
            } else {
                renderSensitivity2D(results, container);
            }
        }

        function getVarLabel(v) {
            const map = {
                capex: "CAPEX Totale",
                opex: "OPEX Annuo",
                wacc: "WACC",
                pun: "Prezzo PUN Base",
                inflation: "Inflazione",
                euribor: "Euribor"
            };
            return map[v] || v;
        }

        function formatKpi(val, kpi) {
            if (val === null || val === undefined) return "N/A";
            if (kpi === 'irr') return val.toFixed(2) + "%";
            if (kpi === 'npv') return (val / 1e6).toFixed(2) + " M€";
            if (kpi === 'dscr') return val.toFixed(2);
            if (kpi === 'lcoe') return val.toFixed(2) + " €/MWh";
            return val.toFixed(2);
        }

        function renderSensitivity1D(results, container) {
            const { xVals, kpiVals, targetKpi, config } = results;
            const xLabel = getVarLabel(config.xVar) + (['wacc','inflation','euribor'].includes(config.xVar) ? ' (Abs %)' : ' (Rel %)');
            
            let html = '<div class="w-full h-full relative" style="min-height:300px"><canvas id="sens-chart"></canvas></div>';
            container.innerHTML = html;

            const ctx = document.getElementById('sens-chart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: xVals.map(v => v > 0 ? '+'+v+'%' : v+'%'),
                    datasets: [{
                        label: targetKpi.toUpperCase(),
                        data: kpiVals,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 2,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#0b0f19',
                        pointBorderWidth: 2,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return targetKpi.toUpperCase() + ': ' + formatKpi(context.raw, targetKpi);
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' }, title: { display: true, text: xLabel, color: '#94a3b8' } },
                        y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        }

        function renderSensitivity2D(results, container) {
            const { xVals, yVals, matrix, targetKpi, config } = results;
            
            let allVals = [];
            matrix.forEach(row => row.forEach(v => { if(v !== null) allVals.push(v); }));
            const minV = Math.min(...allVals);
            const maxV = Math.max(...allVals);

            const xLabel = getVarLabel(config.xVar);
            const yLabel = getVarLabel(config.yVar);

            let html = '<div class="overflow-auto w-full max-h-full"><table class="w-full text-sm text-left">';
            
            // Header
            html += '<thead><tr><th class="p-3 bg-slate-900 border border-slate-700 text-slate-400 font-semibold text-center align-middle sticky top-0 z-10" rowspan="2">';
            html += yLabel + ' \\ ' + xLabel;
            html += '</th><th colspan="' + xVals.length + '" class="p-2 bg-slate-900 border border-slate-700 text-slate-300 font-bold text-center sticky top-0 z-10">';
            html += xLabel + (['wacc','inflation','euribor'].includes(config.xVar) ? ' (Abs %)' : ' (Rel %)');
            html += '</th></tr><tr>';
            xVals.forEach(x => {
                html += '<th class="p-2 bg-[#0b0f19] border border-slate-700 text-slate-400 text-center sticky top-9 z-10">' + (x > 0 ? '+'+x : x) + '%</th>';
            });
            html += '</tr></thead><tbody>';

            // Rows
            yVals.forEach((y, i) => {
                html += '<tr><th class="p-2 bg-[#0b0f19] border border-slate-700 text-slate-400 text-center whitespace-nowrap sticky left-0 z-10 shadow-[2px_0_4px_rgba(0,0,0,0.5)]">';
                html += (y > 0 ? '+'+y : y) + '%</th>';
                
                matrix[i].forEach(v => {
                    let color = 'transparent';
                    let textClass = 'text-slate-300';
                    if (v !== null && maxV !== minV) {
                        let pct = (v - minV) / (maxV - minV);
                        // green to red or vice versa depending on KPI. higher is usually better except LCOE
                        if (targetKpi === 'lcoe') pct = 1 - pct; 
                        
                        // HSL: 0 is red, 120 is green. We want higher to be green.
                        const hue = pct * 120;
                        color = `hsla(${hue}, 70%, 40%, 0.4)`;
                    }
                    html += `<td class="p-3 border border-slate-800 text-center font-medium ${textClass}" style="background-color: ${color}">`;
                    html += formatKpi(v, targetKpi);
                    html += '</td>';
                });
                html += '</tr>';
            });

            html += '</tbody></table></div>';
            container.innerHTML = html;
        }

        document.getElementById('btn-run-sensitivity').addEventListener('click', runSensitivity);

        // =========================================================
        // MONTE CARLO ANALYSIS (P50 / P90)
        // =========================================================

        function runMonteCarlo() {
            if (State.isUpdatePending) return;
            const btn = document.getElementById('btn-run-montecarlo');
            const statusEl = document.getElementById('mc-status');
            const container = document.getElementById('mc-results-container');
            if (!btn || !statusEl || !container) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Simulazioni in corso...';
            statusEl.textContent = "Elaborazione scenari stocastici...";
            statusEl.className = "text-center mt-2 text-[10px] text-violet-400 font-medium h-4 animate-pulse";
            container.innerHTML = '<div class="text-center text-violet-400"><i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3"></i><p>Esecuzione simulazioni Monte Carlo, attendere...</p></div>';

            const mcConfig = {
                nSim: parseInt(document.getElementById('mc-n-sim').value) || 100,
                sigmaPun: parseFloat(document.getElementById('mc-sigma-pun').value) || 0,
                sigmaGen: parseFloat(document.getElementById('mc-sigma-gen').value) || 0
            };

            syncStateFromDOM();
            initWorker();

            simWorker.postMessage({
                action: 'EXECUTE_MONTECARLO',
                payload: {
                    State: {
                        inputs: State.inputs,
                        plants: State.plants,
                        stabilimenti: State.stabilimenti,
                        zonalPun: State.zonalPun,
                        selectedBessPlantIds: State.selectedBessPlantIds,
                        previouslySeenPlantIds: State.previouslySeenPlantIds
                    },
                    mcConfig
                }
            });
        }

        function renderMonteCarloResults(results) {
            const btn = document.getElementById('btn-run-montecarlo');
            const statusEl = document.getElementById('mc-status');
            const container = document.getElementById('mc-results-container');
            if (!btn || !statusEl || !container) return;
            State.lastMonteCarlo = results; // disponibile per il report PDF

            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-dice"></i><span>Esegui Monte Carlo</span>';
            statusEl.textContent = `Completato (${results.nSim} simulazioni)`;
            statusEl.className = "text-center mt-2 text-[10px] text-emerald-400 font-medium h-4";

            const rows = [
                { label: 'Equity IRR (%)', k: 'irr', fmt: v => v.toFixed(2) + '%' },
                { label: 'NPV @ Ke (€)', k: 'npv', fmt: v => formatEuro(v) },
                { label: 'DSCR Minimo (x)', k: 'dscrMin', fmt: v => v.toFixed(2) + 'x' },
                { label: 'DSCR Medio (x)', k: 'dscrAvg', fmt: v => v.toFixed(2) + 'x' }
            ];

            let html = '<div class="overflow-auto w-full"><table class="w-full text-sm text-left">';
            html += '<thead><tr>'
                + '<th class="p-3 bg-slate-900 border border-slate-700 text-slate-400 font-semibold">KPI</th>'
                + '<th class="p-3 bg-slate-900 border border-slate-700 text-rose-400 font-semibold text-right">P10 (Pessimistico)</th>'
                + '<th class="p-3 bg-slate-900 border border-slate-700 text-slate-200 font-semibold text-right">P50 (Mediano)</th>'
                + '<th class="p-3 bg-slate-900 border border-slate-700 text-emerald-400 font-semibold text-right">P90 (Ottimistico)</th>'
                + '<th class="p-3 bg-slate-900 border border-slate-700 text-slate-400 font-semibold text-right">Media</th>'
                + '</tr></thead><tbody>';
            rows.forEach(r => {
                const s = results[r.k];
                html += '<tr>'
                    + `<td class="p-3 border border-slate-800 font-semibold text-slate-200">${r.label}</td>`
                    + `<td class="p-3 border border-slate-800 text-right font-mono text-rose-300">${r.fmt(s.p10)}</td>`
                    + `<td class="p-3 border border-slate-800 text-right font-mono text-white font-bold">${r.fmt(s.p50)}</td>`
                    + `<td class="p-3 border border-slate-800 text-right font-mono text-emerald-300">${r.fmt(s.p90)}</td>`
                    + `<td class="p-3 border border-slate-800 text-right font-mono text-slate-400">${r.fmt(s.mean)}</td>`
                    + '</tr>';
            });
            html += '</tbody></table>';

            // Mini-istogramma testuale della distribuzione IRR (decili)
            if (results.irrSamples && results.irrSamples.length > 0) {
                const s = results.irrSamples;
                html += `<div class="mt-4 text-[10px] text-slate-500">Distribuzione IRR: min ${s[0].toFixed(2)}% &nbsp;•&nbsp; max ${s[s.length - 1].toFixed(2)}% &nbsp;•&nbsp; σ PUN ${results.sigmaPun}% / σ FV ${results.sigmaGen}%</div>`;
            }
            html += '</div>';
            container.innerHTML = html;
        }

        const btnMc = document.getElementById('btn-run-montecarlo');
        if (btnMc) btnMc.addEventListener('click', runMonteCarlo);

        // =========================================================
        // TORNADO ANALYSIS (deterministica, 6 driver)
        // =========================================================

        let tornadoResolver = null;
        function requestTornado() {
            return new Promise((resolve, reject) => {
                tornadoResolver = { resolve, reject };
                syncStateFromDOM();
                initWorker();
                simWorker.postMessage({
                    action: 'EXECUTE_TORNADO',
                    payload: {
                        State: {
                            inputs: State.inputs,
                            plants: State.plants,
                            stabilimenti: State.stabilimenti,
                            zonalPun: State.zonalPun,
                            selectedBessPlantIds: State.selectedBessPlantIds,
                            previouslySeenPlantIds: State.previouslySeenPlantIds
                        }
                    }
                });
            });
        }

        function runTornado() {
            if (State.isUpdatePending) return;
            const btn = document.getElementById('btn-run-tornado');
            const statusEl = document.getElementById('tornado-status');
            const container = document.getElementById('tornado-results');
            if (!btn || !statusEl || !container) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Calcolo tornado...';
            statusEl.textContent = 'Elaborazione 13 scenari...';
            statusEl.className = 'text-center mt-2 text-[10px] text-sky-400 font-medium h-4 animate-pulse';
            container.innerHTML = '<div class="text-center text-sky-400"><i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3"></i><p>Calcolo tornado in corso (13 simulazioni)...</p></div>';

            requestTornado()
                .then(res => { renderTornadoResults(res); })
                .catch(err => {
                    statusEl.textContent = 'Errore: ' + err.message;
                    container.innerHTML = '<div class="text-rose-400 text-xs p-3">Errore nel calcolo del tornado.</div>';
                });
        }

        function renderTornadoResults(results) {
            const btn = document.getElementById('btn-run-tornado');
            const statusEl = document.getElementById('tornado-status');
            const container = document.getElementById('tornado-results');
            if (!container) return;
            State.lastTornado = results;

            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wind"></i><span>Tornado (6 variabili)</span>'; }
            if (statusEl) {
                statusEl.textContent = 'Completato';
                statusEl.className = 'text-center mt-2 text-[10px] text-emerald-400 font-medium h-4';
            }

            const base = results.baseIrr;
            const maxSpan = Math.max(...results.rows.map(r => Math.abs(r.irrUp - r.irrDown)), 0.01);
            let html = '<div class="w-full space-y-2 py-2">';
            html += `<div class="text-center text-[11px] text-slate-400 mb-3">IRR base: <span class="text-white font-bold">${base.toFixed(2)}%</span> &nbsp;•&nbsp; barre = IRR a ±Δ della variabile</div>`;
            results.rows.forEach(r => {
                const leftW = Math.min(50, Math.abs(r.irrDown - base) / maxSpan * 50);
                const rightW = Math.min(50, Math.abs(r.irrUp - base) / maxSpan * 50);
                const deltaLabel = ['wacc','inflation','interestRate'].includes(r.key) ? `±${r.delta}pp` : `±${r.delta}%`;
                html += `
                <div class="flex items-center space-x-2">
                    <div class="w-44 text-right text-[10px] text-slate-300 font-semibold truncate" title="${escapeHtml(r.label)} (${deltaLabel})">${escapeHtml(r.label)} <span class="text-slate-500">${deltaLabel}</span></div>
                    <div class="flex-1 flex items-center h-5 relative bg-slate-900/40 rounded">
                        <div class="absolute left-1/2 w-px h-5 bg-slate-500 z-10"></div>
                        <div class="absolute h-3.5 bg-rose-500/80 rounded-l" style="right:50%;width:${leftW}%" title="IRR (−Δ): ${r.irrDown.toFixed(2)}%"></div>
                        <div class="absolute h-3.5 bg-emerald-500/80 rounded-r" style="left:50%;width:${rightW}%" title="IRR (+Δ): ${r.irrUp.toFixed(2)}%"></div>
                    </div>
                    <div class="w-32 text-[9px] font-mono text-slate-400 shrink-0">${r.irrDown.toFixed(1)}% / <span class="text-emerald-400">${r.irrUp.toFixed(1)}%</span></div>
                </div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        }

        const btnTornado = document.getElementById('btn-run-tornado');
        if (btnTornado) btnTornado.addEventListener('click', runTornado);





window.syncExitFields = function(source, isTyping) {
    if (!window.State || !window.State.inputs) return;
    let p = window.State.inputs;
    
    let ebitdaExit = 0;
    let exitYear = parseInt(document.getElementById('input-exit-option').value);
    if(isNaN(exitYear)) exitYear = 20;
    
    if (window.State.results && window.State.results.matrix && window.State.results.matrix.ebitda) {
        if(exitYear > 0 && exitYear <= 20) {
            ebitdaExit = window.State.results.matrix.ebitda[exitYear - 1] || 0;
        }
    }
    
    let mwp = 0;
    if (window.State.plants) {
        mwp = window.State.plants
            .filter(pl => pl.enabled !== false)
            .reduce((acc, pl) => acc + (parseFloat(pl.capacity) || 0), 0) / 1000;
    }
    if (mwp === 0) mwp = p.plantSystemSize || 0;
    
    let multipleEl = document.getElementById('input-exit-multiple');
    let evEl = document.getElementById('input-exit-ev');
    let mwpValEl = document.getElementById('input-exit-value-mwp');
    
    if (!multipleEl || !evEl || !mwpValEl) return;
    
    let ev = p.exitEnterpriseValue || parseFloat(evEl.value) || 0;
    let mwpVal = p.exitValuePerMwp || parseFloat(mwpValEl.value) || 0;
    let multiple = p.exitMultiple || 0;

    if (source === 'ev') {
        ev = parseFloat(evEl.value) || 0;
        mwpVal = mwp > 0 ? ev / mwp : 0;
        multiple = ebitdaExit > 0 ? ev / ebitdaExit : 0;
        if (isTyping) {
            mwpValEl.value = Math.round(mwpVal);
            multipleEl.value = multiple.toFixed(2);
        } else {
            mwpValEl.value = Math.round(mwpVal);
            multipleEl.value = multiple.toFixed(2);
        }
    } else if (source === 'mwpVal') {
        const raw = mwpValEl.value;
        if (raw === '' || raw === '-' || raw === '.') {
            mwpVal = 0; ev = 0; multiple = 0;
        } else {
            mwpVal = parseFloat(raw);
            if (isNaN(mwpVal)) mwpVal = 0;
            ev = mwpVal * mwp;
            multiple = ebitdaExit > 0 ? ev / ebitdaExit : 0;
            if (isTyping) {
                evEl.value = Math.round(ev);
                multipleEl.value = multiple.toFixed(2);
            } else {
                evEl.value = Math.round(ev);
                multipleEl.value = multiple.toFixed(2);
            }
        }
    } else if (source === 'render') {
        // Anchoring on mwpVal (Value per MWp) so that when total capacity (mwp) changes, 
        // the absolute Enterprise Value adapts automatically.
        ev = mwpVal * mwp;
        multiple = ebitdaExit > 0 ? ev / ebitdaExit : 0;
        
        if (document.activeElement !== evEl) evEl.value = Math.round(ev);
        if (document.activeElement !== mwpValEl) mwpValEl.value = Math.round(mwpVal);
        multipleEl.value = multiple.toFixed(2);
    }

    // Sync exact floats back to State.inputs so saveConfigToSupabase persists them perfectly
    p.exitMultiple = multiple;
    p.exitEnterpriseValue = ev;
    p.exitValuePerMwp = mwpVal;
};

// ── External Financing Instruments (Private Debt / Private Equity / Altra Forma) ──
// Aggiorna le label dinamiche dei valori e la visibilità dei gruppi condizionali.
window.updateExternalFinancingLabels = function(p) {
    if (!p) p = window.State.inputs;
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    // Private Debt
    setTxt('val-pd-interest-rate', (p.pdInterestRate || 0).toFixed(2) + '%');
    const pdAmtLbl = document.getElementById('pd-amount-label');
    if (pdAmtLbl) pdAmtLbl.textContent = p.pdAmountType === 'fixed_eur' ? 'Importo (€)' : (p.pdAmountType === 'pct_bankable' ? '% Base Finanziabile' : '% Totale Fabbisogno');
    // Private Equity
    setTxt('val-pe-hurdle-rate', (p.peHurdleRate || 0).toFixed(2) + '%');
    setTxt('val-pe-preferred-pct', (p.pePreferredPct || 0) + '%');
    setTxt('val-pe-royalty-pct', (p.peRoyaltyPct || 0).toFixed(2) + '%');
    const peAmtLbl = document.getElementById('pe-amount-label');
    if (peAmtLbl) peAmtLbl.textContent = p.peAmountType === 'fixed_eur' ? 'Importo (€)' : '% Equity Totale';
    // Visibilità gruppi PE in base alla modalità
    const peMode = p.peMode || 'dividend_share';
    const show = (id, cond) => { const el = document.getElementById(id); if (el) el.style.display = cond ? '' : 'none'; };
    show('pe-hurdle-group', peMode === 'preferred_return');
    show('pe-preferred-group', peMode === 'preferred_return');
    show('pe-exit-mult-group', peMode === 'bullet_exit');
    show('pe-royalty-group', peMode === 'royalty_fee');
    // Altra Forma
    setTxt('val-af-revenue-pct', (p.afRevenuePct || 0).toFixed(2) + '%');
    setTxt('val-af-exit-pct', (p.afExitPct || 0).toFixed(2) + '%');
    setTxt('val-af-warrant-pct', (p.afWarrantPct || 0) + '%');
    setTxt('val-af-convertible-rate', (p.afConvertibleRate || 0).toFixed(2) + '%');
    setTxt('val-af-convertible-pct', (p.afConvertiblePct || 0) + '%');
    const afType = p.afType || 'advisory_fee';
    show('af-annual-group', afType === 'advisory_fee');
    show('af-revenue-group', afType === 'advisory_fee');
    show('af-exit-pct-group', afType === 'success_fee_exit');
    show('af-warrant-group', afType === 'warrant_kicker');
    show('af-conv-amount-group', afType === 'convertible_note');
    show('af-conv-rate-group', afType === 'convertible_note');
    show('af-conv-pct-group', afType === 'convertible_note');
};

// ═══════════════════════════════════════════════════════════════════
// MODULO: STAMPA REPORT PDF (Dashboard)
// Genera report professionali in PDF via jsPDF + AutoTable.
// I file vengono scaricati nella cartella download del browser.
// ═══════════════════════════════════════════════════════════════════

window.REPORT_DESCRIPTIONS = {
    executive_summary: 'Sintesi direzionale con KPI principali (IRR, NPV, DSCR, LCOE), struttura fonti/impieghi e commento metodologico. Destinato a management e comitato investimenti.',
    relazione_tecnica: 'Descrizione fisica e tecnica degli impianti (FV e Storage BESS), dettaglio inverter e consumi/utenze sottese (PPA/CER).',
    conto_economico: 'Conto Economico SPV completo a 20 anni: ricavi, OPEX, EBITDA, ammortamenti, interessi (senior/soci/PD/AF), EBT, imposte (IRES+IRAP, Art.96 TUIR), utile netto. Formato landscape tabellare.',
    rendiconto_finanziario: 'Bridge CFADS (da utile netto a cassa disponibile ante debito), servizio debito senior, cascata distribuzione SPV->HoldCo (waterfall) con Private Debt e Private Equity. Formato landscape.',
    piano_ammortamento: 'Piano ammortamento dettagliato: Senior Debt bancario, Finanziamento Soci, Private Debt (con modalità bullet PIK / ammortamento / interessi annuali). DSCR annuo. Formato landscape.',
    struttura_finanziaria: 'Struttura del capitale: fonti/impieghi, breakdown CAPEX (EPC, BESS, connessione, land, sviluppo, SPV), stratificazione equity (Senior/PD/PE/Soci/Sponsor Equity), leverage ratio.',
    exit_valutazione: 'Analisi exit: Enterprise Value (multiplo EBITDA), payoff debito senior + PD bullet, quota Private Equity, costi Altra Forma, PEX tax, net proceeds Sponsor, MOIC e multiplo realizzato.',
    sensibilita: 'Analisi di sensibilità 1D/2D (tornado) su IRR / NPV / DSCR al variare di CAPEX, OPEX, WACC, inflazione, EURIBOR, PUN, importo PD/PE. Evidenzia variabili critiche.',
    full_due_diligence: 'Report completo di due diligence bancaria: executive summary + CE + RF + ammortamento + struttura + exit. Documento multi-pagina per investment committee.'
};

// Aggiorna la descrizione del report al cambio del menu a tendina
window.updateReportDescription = function() {
    const sel = document.getElementById('select-report-type');
    const desc = document.getElementById('report-desc-text');
    if (!sel || !desc) return;
    const val = sel.value;
    desc.textContent = window.REPORT_DESCRIPTIONS[val] || '';
};
document.addEventListener('DOMContentLoaded', function() {
    const sel = document.getElementById('select-report-type');
    if (sel) sel.addEventListener('change', window.updateReportDescription);
});

// ── Helper: formattazione ──
const _fmtE = v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v < 0 ? '-' : '') + (abs / 1e6).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' M€';
    if (abs >= 1e3) return (v < 0 ? '-' : '') + (abs / 1e3).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' k€';
    return (v < 0 ? '-' : '') + abs.toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' €';
};
const _fmtEFull = v => {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '\u00A0€';
};
const _fmtPct = v => (v === null || v === undefined || isNaN(v)) ? '-' : v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const _fmtX = v => (v === null || v === undefined || isNaN(v)) ? '-' : v.toFixed(2) + 'x';
const _fmtMwh = v => (v === null || v === undefined || isNaN(v)) ? '-' : v.toLocaleString('it-IT', { maximumFractionDigits: 0 }) + '\u00A0MWh';

// ── Helper: header/footer su ogni pagina ──
function _pdfHeader(doc, title, subtitle) {
    const W = doc.internal.pageSize.getWidth();
    // Banda superiore
    doc.setFillColor(11, 15, 25);
    doc.rect(0, 0, W, 22, 'F');
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 22, W, 1.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(window._currentProjectName || 'Progetto New Green Deal', 14, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(title, 14, 17);
    doc.setTextColor(255, 255, 255);
    doc.text(subtitle, W - 14, 10, { align: 'right' });
    doc.setTextColor(148, 163, 184);
    doc.text(new Date().toLocaleString('it-IT'), W - 14, 17, { align: 'right' });
}
function _pdfFooter(doc) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(30, 41, 59);
        doc.setLineWidth(0.3);
        doc.line(14, H - 12, W - 14, H - 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text('Documento generato automaticamente - ' + (window._currentProjectName || 'Progetto New Green Deal'), 14, H - 7);
        doc.text('Pagina ' + i + ' di ' + pages, W - 14, H - 7, { align: 'right' });
    }
}

// ── Helper: sezione titolo dentro il corpo ──
function _sectionTitle(doc, txt, y) {
    doc.setFillColor(15, 23, 42);
    doc.rect(14, y - 4, doc.internal.pageSize.getWidth() - 28, 7, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(txt.toUpperCase(), 16, y + 0.5);
    return y + 7;
}

function _ensureSpace(doc, needed, startY) {
    const H = doc.internal.pageSize.getHeight();
    if (startY + needed > H - 18) {
        doc.addPage();
        return 32;
    }
    return startY;
}

// ── Dati di contesto condivisi ──
function _ctx() {
    const r = window.State.results || {};
    const m = r.matrix || {};
    const d = r.debtSchedule || {};
    const p = window.State.inputs || {};
    const plants = (window.State.plants || []).filter(pl => pl.enabled !== false);
    const totKwp = plants.reduce((a, pl) => a + (parseFloat(pl.capacity) || 0), 0);
    return { r, m, d, p, plants, totKwp };
}

// ═══════════════════════════════════════════════════════════════════
// Funzione dispatcher principale
// ═══════════════════════════════════════════════════════════════════
window.generateReport = async function(reportType) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('Libreria PDF non caricata. Ricarica la pagina e riprova.');
        return;
    }
    const projName = prompt("Inserisci il nome del progetto da stampare nel PDF:", window._currentProjectName || "Progetto New Green Deal");
    if (projName === null) return;
    window._currentProjectName = projName;
    const { jsPDF } = window.jspdf;
    const { r } = _ctx();
    if (!r.matrix || !r.matrix.years || r.matrix.years.length === 0) {
        alert('Nessun risultato di simulazione disponibile. Esegui prima un calcolo (Ricalcola Scenario).');
        return;
    }
    // Per il report Sensibilità: assicura dati tornado reali (calcolati al volo se mai eseguito)
    if (reportType === 'sensibilita' && !window.State.lastTornado) {
        showCalcIndicator(true);
        try {
            window.State.lastTornado = await requestTornado();
        } catch (tornErr) {
            console.warn('Tornado non disponibile per il PDF:', tornErr);
        }
        showCalcIndicator(false);
    }
    try {
        let doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        let filename = 'report.pdf';
        switch (reportType) {
            case 'executive_summary':       _repExecutiveSummary(doc); filename = 'Executive_Summary.pdf'; break;
            case 'relazione_tecnica':       _repRelazioneTecnica(doc); filename = 'Relazione_Tecnica.pdf'; break;
            case 'conto_economico':         doc = _repContoEconomico(doc); filename = 'Conto_Economico_SPV.pdf'; break;
            case 'rendiconto_finanziario':  doc = _repRendicontoFinanziario(doc); filename = 'Rendiconto_Finanziario_SPV.pdf'; break;
            case 'piano_ammortamento':      doc = _repPianoAmmortamento(doc); filename = 'Piano_Ammortamento_Debito.pdf'; break;
            case 'struttura_finanziaria':   _repStrutturaFinanziaria(doc); filename = 'Struttura_Finanziaria.pdf'; break;
            case 'exit_valutazione':        _repExitValutazione(doc); filename = 'Exit_Valutazione.pdf'; break;
            case 'sensibilita':             _repSensibilita(doc); filename = 'Analisi_Sensibilita.pdf'; break;
            case 'full_due_diligence':      _repFullDueDiligence(doc); filename = 'Due_Diligence_Completa.pdf'; break;
            default: alert('Tipo report non riconosciuto: ' + reportType); return;
        }
        _pdfFooter(doc);
        doc.save(filename);
        Audit.log('report.pdf', reportType);
    } catch (err) {
        console.error('Errore generazione PDF:', err);
        alert('Errore durante la generazione del PDF:\n' + err.message);
    }
};

// ═══════════════════════════════════════════════════════════════════
// REPORT 1: EXECUTIVE SUMMARY
// ═══════════════════════════════════════════════════════════════════
function _repExecutiveSummary(doc) {
    const { r, m, p, plants, totKwp } = _ctx();
    _pdfHeader(doc, 'Executive Summary - Sintesi Direzionale', 'Report N. 01');
    let y = 32;
    // Portfolio snapshot
    y = _sectionTitle(doc, '1. Riepilogo Portafoglio', y);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Parametro', 'Valore']],
        body: [
            ['Impianti attivi', String(plants.length)],
            ['Potenza FV totale', (totKwp / 1000).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' MWp'],
            ['Potenza BESS totale', (r.totalBessMw || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MW / ' + (r.totalBessMwh || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MWh'],
            ['Autoconsumo stimato', _fmtMwh(r.totalSelfConsMwh)],
            ['Copertura carico stab.', (r.stabCoverage || 0).toFixed(1) + '%']
        ],
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 60, y);
    y = _sectionTitle(doc, '2. KPI Finanziari Principali', y);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Indicatore', 'Valore', 'Soglia/Commento']],
        body: [
            ['IRR Equity (HoldCo)', _fmtPct(r.calculatedIrr), 'Target sponsor ≥ 8%'],
            ['NPV @ Ke (' + _fmtPct(p.keVal * 100) + ')', _fmtE(r.holdcoNpv), 'Positivo = crea valore'],
            ['MOIC (multiplo cash investito)', _fmtX(r.holdcoMoic), '≥ 1.5x tipicamente atteso'],
            ['Payback Period', r.paybackPeriod, 'Anni a recupero capitale'],
            ['DSCR medio', _fmtX(r.avgDscr), 'Covenant bancario tipico ≥ 1.30x'],
            ['DSCR minimo', _fmtX(r.minDscr), 'Allarme se < 1.15x'],
            ['LCOE (energia solare)', _fmtE(r.calculatedLcoe) + '/MWh', 'Costo livellato FV'],
            ['LCOS (storage)', _fmtE(r.calculatedLcos) + '/MWh', 'Costo livellato BESS']
        ],
        margin: { left: 14, right: 14 },
        columnStyles: { 2: { cellWidth: 60 } }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 50, y);
    y = _sectionTitle(doc, '3. Struttura Fonti / Impieghi', y);
    const spvAcq = (plants.reduce((a, pl) => a + (pl.spvAcquisitionCost || 0), 0));
    const holdcoSetup = typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000;
    const constructionCapex = (r.totalProjectCost || 0) - spvAcq;
    const seniorDebt = r.debtAmount || 0;
    const pdAmt = r.pdAmount || 0;
    const peAmt = r.peAmount || 0;
    const constructionEquity = Math.max(0, constructionCapex - seniorDebt - pdAmt - peAmt);
    const sponsorLoan = constructionEquity * ((p.sociEquityPct || 0) / 100);
    const sponsorEquity = Math.max(0, (r.equityAmount || 0) - sponsorLoan);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['IMPIEGHI (€)', 'Valore', 'FONTI (€)', 'Valore']],
        body: [
            ['Acquisizione SPV', _fmtE(spvAcq), 'Debito Senior Bancario', _fmtE(seniorDebt)],
            ['CAPEX Costruzione', _fmtE(constructionCapex), 'Private Debt (Mezzanine)', _fmtE(pdAmt)],
            ['Capitale Holding', _fmtE(holdcoSetup), 'Private Equity', _fmtE(peAmt)],
            ['', '', 'Finanziamento Soci', _fmtE(sponsorLoan)],
            ['', '', 'Sponsor Pure Equity', _fmtE(sponsorEquity)],
            ['TOTALE IMPIEGHI', _fmtE(spvAcq + constructionCapex + holdcoSetup), 'TOTALE FONTI', _fmtE(seniorDebt + pdAmt + peAmt + sponsorLoan + sponsorEquity)]
        ],
        margin: { left: 14, right: 14 },
        willDrawCell: function(data) {
            if (data.row.index === 5) {
                doc.setFont('helvetica', 'bold');
            }
        }
    });
    y = doc.lastAutoTable.finalY + 6;

    // Commento metodologico
    y = _ensureSpace(doc, 45, y);
    y = _sectionTitle(doc, '4. Commento Metodologico', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const dscrFlag = (r.minDscr < 1.15) ? 'ATTENZIONE: DSCR minimo sotto soglia covenant (1.15x) - distribuzioni a Holding potrebbero essere bloccate (Cash Trap).' : 'DSCR minimo entro la soglia covenant bancaria: servizio del debito sostenibile.';
    const irrFlag = (r.calculatedIrr >= 8) ? 'IRR Equity superiore al target sponsor (8%): operazione creazione valore.' : 'IRR Equity sotto il target sponsor (8%): rivalutare struttura leva o costi.';
    const exitFlag = (p.exitOption && p.exitOption !== 'none') ? 'Exit previsto all\'anno ' + p.exitOption + ' con multiplo EBITDA ' + (typeof p.exitMultiple === 'number' ? p.exitMultiple : 8) + 'x.' : 'Strategia hold-to-maturity (nessun exit anticipato).';
    const txt = 'Modello di project finance con separazione SPV / Holding. Debito senior bancario servicing-first, finanziamento soci subordinato con funzione di scudo fiscale intra-gruppo. ' +
        (r.pdEnabled ? 'Private Debt esterno (' + _fmtE(pdAmt) + ', modalità ' + (p.pdMode) + ') integrato nel waterfall. ' : '') +
        (r.peEnabled ? 'Private Equity esterno (' + _fmtE(peAmt) + ', modalità ' + (p.peMode) + ') con quota distribuzioni/exit. ' : '') +
        (r.afEnabled ? 'Altra Forma (' + (p.afType) + ') attiva. ' : '') +
        dscrFlag + ' ' + irrFlag + ' ' + exitFlag;
    const lines = doc.splitTextToSize(txt, doc.internal.pageSize.getWidth() - 28);
    doc.text(lines, 14, y + 2);
}

// ═══════════════════════════════════════════════════════════════════
// Helper: tabella orizzontale 20 anni (landscape)
// ═══════════════════════════════════════════════════════════════════
function _landscapeDoc() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
}

function _yearTable(doc, title, subtitle, rows, startY, extraOptions = {}) {
    const { m, p } = _ctx();
    const exitOption = p && p.exitOption ? p.exitOption : (document.getElementById('input-exit-option') ? document.getElementById('input-exit-option').value : null);
    let exitYear = (exitOption && exitOption !== 'none') ? parseInt(exitOption) : 20;
    if (isNaN(exitYear) || exitYear < 1) exitYear = 20;

    const years = (m.years || []).slice(0, exitYear);
    const head = [['Voce', ...years.map(y => 'Anno ' + y)]];
    const body = rows.map(r => {
        const key = r.key;
        const arr = m[key] || [];
        const fmt = r.fmt || _fmtEFull;
        return [r.label, ...years.map((_, i) => fmt(arr[i] || 0))];
    });
    doc.autoTable(Object.assign({
        startY: startY,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
        bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
        alternateRowStyles: { fillColor: [243, 244, 246] },
        head: head,
        body: body,
        margin: { left: 10, right: 10 },
        styles: { cellPadding: 1 }
    }, extraOptions));
    return doc.lastAutoTable.finalY + 4;
}

// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// REPORT 1.5: RELAZIONE TECNICA
// ═══════════════════════════════════════════════════════════════════
function _repRelazioneTecnica(doc) {
    const { r, plants } = _ctx();
    const stabilimenti = (window.State.stabilimenti || []).filter(s => s.enabled !== false);
    
    _pdfHeader(doc, 'Relazione Tecnica & Descrittiva', 'Report N. 02');
    let y = 32;

    // 1. Impianti FV
    y = _sectionTitle(doc, '1. Impianti Fotovoltaici (Generazione)', y);
    const fvBody = plants.map(pl => {
        const pm = r && r.plantsMetrics ? r.plantsMetrics.find(m => m.id === pl.id) : null;
        const pwr = (parseFloat(pl.capacity) || 0) / 1000;
        const prod = pm ? parseFloat(pm.annualSolarProductionMWh || 0) : 0;
        const tracker = (pl.pvgisTracking && pl.pvgisTracking.toLowerCase().includes('axis')) ? 'Inseguitore Monoasse' : 'Fisso';
        return [
            pl.name || 'Impianto', 
            pwr.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' MWp',
            _fmtMwh(prod),
            (pwr > 0 ? (prod / pwr).toLocaleString('it-IT', { maximumFractionDigits: 0 }) : '0') + ' kWh/kWp',
            tracker
        ];
    });
    if (fvBody.length === 0) fvBody.push(['Nessun impianto', '-', '-', '-', '-']);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Nome Impianto', 'Potenza', 'Produzione Y1', 'Resa Specifica', 'Struttura']],
        body: fvBody,
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;

    // 2. Storage BESS
    y = _ensureSpace(doc, 40, y);
    y = _sectionTitle(doc, '2. Sistemi di Accumulo (BESS)', y);
    const bessBody = plants.map(pl => {
        const mw = parseFloat(pl.bessMw || 0);
        const mwh = parseFloat(pl.bessMwh || 0);
        if (mwh === 0) return null;
        return [
            pl.name || 'Impianto',
            mw.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' MW',
            mwh.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' MWh',
            (parseFloat(pl.bessEfficiency || 0) * 100).toFixed(1) + '%',
            (pl.bessSocMin || 0) + '% - ' + (pl.bessSocMax || 100) + '%',
            pl.bessConnection === 'dc' ? 'DC-Coupled' : 'AC-Coupled'
        ];
    }).filter(x => x !== null);
    if (bessBody.length === 0) bessBody.push(['Nessun BESS configurato', '-', '-', '-', '-', '-']);
    
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Impianto Associato', 'Potenza', 'Capacità', 'RTE (Efficienza)', 'Limiti SoC', 'Connessione']],
        body: bessBody,
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;

    // 3. Setup Tecnico Inverter
    y = _ensureSpace(doc, 40, y);
    y = _sectionTitle(doc, '3. Setup Tecnico Rete e Inverter', y);
    const invBody = plants.map(pl => {
        return [
            pl.name || 'Impianto',
            parseFloat(pl.gridConnectionKw || 0).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + ' kW',
            pl.gridVoltage || 'Media Tensione',
            pl.inverterBrand || 'N/A',
            (parseFloat(pl.inverterEfficiency || 0) * 100).toFixed(1) + '%'
        ];
    });
    if (invBody.length === 0) invBody.push(['-', '-', '-', '-', '-']);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Impianto', 'Potenza Immissione', 'Tensione Rete', 'Marca Inverter', 'Efficienza Inv.']],
        body: invBody,
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;

    // 4. Consumi (Stabilimenti)
    y = _ensureSpace(doc, 50, y);
    y = _sectionTitle(doc, '4. Utenze e Consumi (Off-taker)', y);
    const consBody = stabilimenti.map(s => {
        const ppaType = s.ppaType === 'on-site' ? 'On-site (Dietro Contatore)' : (s.ppaType === 'cer' ? 'CER (Comunità Energetica)' : 'PPA Off-site (Virtuale)');
        const load = parseFloat(s.annualConsumption || 0);
        return [
            s.name || 'Utenza',
            ppaType,
            _fmtMwh(load),
            s.shiftType === 'three_shifts' ? 'H24 (3 Turni)' : 'Diurno (1/2 Turni)'
        ];
    });
    if (consBody.length === 0) consBody.push(['Nessuna utenza configurata', '-', '-', '-']);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Nome Stabilimento', 'Configurazione', 'Fabbisogno Annuo', 'Profilo Lavoro']],
        body: consBody,
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 2: CONTO ECONOMICO SPV
// ═══════════════════════════════════════════════════════════════════
function _repContoEconomico(doc) {
    doc = _landscapeDoc();
    _pdfHeader(doc, 'Conto Economico SPV - 20 Anni Previsionali', 'Report N. 02');
    const { p } = _ctx();
    let y = 30;
    const rows = [
        { key: 'revenueTotal', label: 'RICAVI TOTALI SPV' },
        { key: 'revenueRid', label: '  di cui Ricavi RID / FER X (FV)' },
        { key: 'revenuePpa', label: '  di cui Ricavi PPA / CER' },
        { key: 'revenueTimeshifting', label: '  di cui Time Shifting BESS' },
        { key: 'revenueArbitrage', label: '  di cui Arbitraggio BESS' },
        { key: 'opexTotal', label: '(-) OPEX TOTALE SPV', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexPlants', label: '  di cui O&M FV', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexBess', label: '  di cui O&M BESS', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexGridCharging', label: '  di cui Costo Energia Pre-carica da Rete BESS', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexLandDds', label: '  di cui Canone DDS/Affitto Terreno', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexInsurance', label: '  di cui Assicurazione', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexTaxes', label: '  di cui Tasse Locali / IMU', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexSecurity', label: '  di cui Vigilanza & Sicurezza', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexAssetManagement', label: '  di cui Asset Management', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexServiceContract', label: '  di cui Contratto di Servizio Commerciale PPA', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'ebitda', label: 'EBITDA SPV' },
        { key: 'depreciationCivil', label: '(-) Ammortamento Civilistico', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'ebit', label: 'EBIT SPV' },
        { key: 'interestActive', label: '(+) Interessi Attivi MRA' },
        { key: 'interest', label: '(-) Interessi Mutuo Bancario Senior', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'sociInterestAccrued', label: '(-) Interessi Finanziamento Soci', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'pdInterestAccrued', label: '(-) Interessi Private Debt', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'afInterestAccrued', label: '(-) Interessi Convertibile (AF)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'ebt', label: 'EBT - Utile ante Imposte' },
        { key: 'currentTaxesSpv', label: '(-) Imposte Correnti (IRES+IRAP)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'iresTaxSpv', label: '    di cui: IRES (24% su EBT +/- Variazioni)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'irapTaxSpv', label: '    di cui: IRAP (3.9% su EBIT + Costi Indeducibili)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'deferredTaxes', label: '(-/+) Imposte Differite' },
        { key: 'netProfitSpv', label: 'UTILE NETTO SPV' },
        { key: 'spvLockedDividends', label: '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti' }
    ];
    y = _yearTable(doc, 'Conto Economico', '', rows, y, { styles: { cellPadding: 0.5 } });
    // nota
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Interessi Private Debt / Convertibile AF mostrati solo se gli strumenti sono abilitati. Fiscalità: IRES 24% + IRAP 3,9% con Art.96 TUIR (deducibilità interessi netti entro ROL 30% EBITDA).', 10, y);
    return doc;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 3: RENDICONTO FINANZIARIO SPV
// ═══════════════════════════════════════════════════════════════════
function _repRendicontoFinanziario(doc) {
    doc = _landscapeDoc();
    _pdfHeader(doc, 'Rendiconto Finanziario SPV - CFADS & Waterfall', 'Report N. 03');
    let y = 30;
    const rows = [
        { key: 'netProfitSpv', label: 'Utile Netto SPV (da CE)' },
        { key: 'depreciationCivil', label: '(+) Ripresa Ammortamento' },
        { key: 'deferredTaxes', label: '(+/-) Imposte Differite' },
        { key: 'interest', label: '(+) Ripresa Interessi Senior' },
        { key: 'sociInterestAccrued', label: '(+) Ripresa Interessi Soci' },
        { key: 'pdInterestAccrued', label: '(+) Ripresa Interessi PD' },
        { key: 'afInterestAccrued', label: '(+) Ripresa Interessi AF' },
        { key: 'opexMaintReserve', label: '(-) Accantonamento MRA' },
        { key: 'bessAugmentationCost', label: '(-) CAPEX Sostituzione BESS' },
        { key: 'mraRelease', label: '(+) Rilascio MRA' },
        { key: 'cfads', label: 'CFADS SPV' },
        { key: 'interestPaid', label: '(-) Interessi Senior Pagati', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'principalScheduled', label: '(-) Quota Capitale Senior Programmata', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'principalVoluntary', label: '(-) Cash Sweep Senior Volontario', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvFCFE', label: 'CASSA POST-DEBITO SENIOR (FCFE SPV)' },
        { key: 'pdInterestPaid', label: '(-) Interessi Private Debt Pagati' },
        { key: 'pdPrincipalPaid', label: '(-) Quota Capitale Private Debt' },
        { key: 'peDividendPaid', label: '(-) Quota Dividendi/Preferred PE' },
        { key: 'holdcoInterestReceived', label: '(-) Interessi Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'holdcoLoanRepaymentReceived', label: '(-) Rimborso Capitale Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvLockedDividends', label: '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti' },
        { key: 'holdcoDividendReceived', label: '(-) Dividendi -> HoldCo (quota Sponsor)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvCashTrap', label: '(=) Cassa Residua SPV (Cash Trap)' }
    ];
    y = _yearTable(doc, 'Rendiconto Finanziario', '', rows, y);
    return doc;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 4: PIANO AMMORTAMENTO
// ═══════════════════════════════════════════════════════════════════
function _repPianoAmmortamento(doc) {
    const { d, p } = _ctx();
    doc = _landscapeDoc();
    _pdfHeader(doc, 'Piano di Ammortamento Debito - Senior + Soci + Private Debt', 'Report N. 04');
    let y = 30;
    const exitOption = p && p.exitOption ? p.exitOption : (document.getElementById('input-exit-option') ? document.getElementById('input-exit-option').value : null);
    let exitYear = (exitOption && exitOption !== 'none') ? parseInt(exitOption) : 20;
    if (isNaN(exitYear) || exitYear < 1) exitYear = 20;
    const years = (d.years || []).slice(0, exitYear);
    const fmt = _fmtEFull;
    // Sezione 1: Senior
    y = _sectionTitleLS(doc, '1. DEBITO BANCARIO SPV - Project Finance (Senior Debt)', y);
    doc.autoTable({
        startY: y,
        theme: 'striped',
        headStyles: { fillColor: [76, 35, 90], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
        bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
        head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
        body: [
            ['Debito Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalance[i] || 0))],
            ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccrued[i] || 0)))],
            ['(-) Quota Capitale Programmata', ...years.map((_, i) => fmt(-Math.abs(d.principalScheduled[i] || 0)))],
            ['(-) Cash Sweep Volontario', ...years.map((_, i) => fmt(-Math.abs(d.principalVoluntary[i] || 0)))],
            ['Debito Fine Anno', ...years.map((_, i) => fmt(d.endingBalance[i] || 0))],
            ['Servizio Debito Effettivo', ...years.map((_, i) => fmt(-Math.abs(d.totalDebtService[i] || 0)))],
            ['DSCR', ...years.map((_, i) => (d.dscr[i] !== -1 && d.dscr[i] !== undefined) ? (d.dscr[i]).toFixed(2) + 'x' : 'N/A')]
        ],
        margin: { left: 10, right: 10 },
        styles: { cellPadding: 1 }
    });
    y = doc.lastAutoTable.finalY + 5;

    // Sezione 2: Soci
    y = _ensureSpaceLS(doc, 40, y);
    y = _sectionTitleLS(doc, '2. FINANZIAMENTO SOCI - Subordinated Shareholder Loan (' + (p.sociEquityPct || 0) + '% Equity)', y);
    doc.autoTable({
        startY: y,
        theme: 'striped',
        headStyles: { fillColor: [14, 98, 81], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
        bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
        head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
        body: [
            ['Fin. Soci Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalanceSoci[i] || 0))],
            ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedSoci[i] || 0)))],
            ['(+) Interessi Pagati', ...years.map((_, i) => fmt(d.interestPaidSoci[i] || 0))],
            ['(-) Rimborso Capitale', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidSoci[i] || 0)))],
            ['Fin. Soci Fine Anno', ...years.map((_, i) => fmt(d.endingBalanceSoci[i] || 0))]
        ],
        margin: { left: 10, right: 10 },
        styles: { cellPadding: 1 }
    });
    y = doc.lastAutoTable.finalY + 5;

    // Sezione 3: Private Debt (se abilitato)
    if (p.pdEnabled && d.beginningBalancePd) {
        y = _ensureSpaceLS(doc, 40, y);
        const pdModeTxt = p.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (p.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
        y = _sectionTitleLS(doc, '3. PRIVATE DEBT - Mezzanine Esterna (' + (p.pdInterestRate || 0).toFixed(2) + '% - ' + pdModeTxt + ')', y);
        doc.autoTable({
            startY: y,
            theme: 'striped',
            headStyles: { fillColor: [14, 98, 81], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
            bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
            columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
            head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
            body: [
                ['PD Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalancePd[i] || 0))],
                ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedPd[i] || 0)))],
                ['(+) Interessi Pagati', ...years.map((_, i) => fmt(d.interestPaidPd[i] || 0))],
                ['(-) Rimborso Capitale / Payoff', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidPd[i] || 0)))],
                ['PD Fine Anno', ...years.map((_, i) => fmt(d.endingBalancePd[i] || 0))]
            ],
            margin: { left: 10, right: 10 },
            styles: { cellPadding: 1 }
        });
    }
    return doc;
}

// ── Helper landscape per section title ──
function _sectionTitleLS(doc, txt, y) {
    doc.setFillColor(15, 23, 42);
    doc.rect(10, y - 3.5, doc.internal.pageSize.getWidth() - 20, 6, 'F');
    doc.setTextColor(16, 185, 129);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(txt.toUpperCase(), 12, y + 0.5);
    return y + 6;
}
function _ensureSpaceLS(doc, needed, startY) {
    const H = doc.internal.pageSize.getHeight();
    if (startY + needed > H - 16) {
        doc.addPage();
        return 28;
    }
    return startY;
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 5: STRUTTURA FINANZIARIA
// ═══════════════════════════════════════════════════════════════════
function _repStrutturaFinanziaria(doc) {
    const { r, p, plants } = _ctx();
    _pdfHeader(doc, 'Struttura Finanziaria & Fonti/Impieghi', 'Report N. 05');
    let y = 32;
    const spvAcq = plants.reduce((a, pl) => a + (pl.spvAcquisitionCost || 0), 0);
    const holdcoSetup = typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000;
    const constructionCapex = (r.totalProjectCost || 0) - spvAcq;
    const seniorDebt = r.debtAmount || 0;
    const pdAmt = r.pdAmount || 0;
    const peAmt = r.peAmount || 0;
    const constructionEquity = Math.max(0, constructionCapex - seniorDebt - pdAmt - peAmt);
    const sponsorLoan = constructionEquity * ((p.sociEquityPct || 0) / 100);
    const sponsorEquity = Math.max(0, (r.equityAmount || 0) - sponsorLoan);
    const totalSources = seniorDebt + pdAmt + peAmt + sponsorLoan + sponsorEquity;

    y = _sectionTitle(doc, '1. Fonti & Impieghi', y);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Fonti', 'Valore (€)', '%', 'Impieghi', 'Valore (€)', '%']],
        body: [
            ['Debito Senior Bancario', _fmtEFull(seniorDebt), _fmtPct(totalSources ? seniorDebt/totalSources*100 : 0), 'Acquisizione SPV', _fmtEFull(spvAcq), _fmtPct(totalSources ? spvAcq/totalSources*100 : 0)],
            ['Private Debt (Mezzanine)', _fmtEFull(pdAmt), _fmtPct(totalSources ? pdAmt/totalSources*100 : 0), 'CAPEX Costruzione', _fmtEFull(constructionCapex), _fmtPct(totalSources ? constructionCapex/totalSources*100 : 0)],
            ['Private Equity', _fmtEFull(peAmt), _fmtPct(totalSources ? peAmt/totalSources*100 : 0), 'Capitale Holding', _fmtEFull(holdcoSetup), _fmtPct(totalSources ? holdcoSetup/totalSources*100 : 0)],
            ['Finanziamento Soci', _fmtEFull(sponsorLoan), _fmtPct(totalSources ? sponsorLoan/totalSources*100 : 0), '', '', ''],
            ['Sponsor Pure Equity', _fmtEFull(sponsorEquity), _fmtPct(totalSources ? sponsorEquity/totalSources*100 : 0), '', '', ''],
            ['TOTALE FONTI', _fmtEFull(totalSources), '100,00%', 'TOTALE IMPIEGHI', _fmtEFull(spvAcq + constructionCapex + holdcoSetup), '100,00%']
        ],
        margin: { left: 14, right: 14 },
        willDrawCell: function(data) { if (data.row.index === 5) doc.setFont('helvetica', 'bold'); }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 60, y);
    y = _sectionTitle(doc, '2. Breakdown CAPEX', y);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Componente CAPEX', 'Valore (€)', '% su tot progetto']],
        body: [
            ['EPC Impianti Solari (capacity × capex/kWp)', _fmtEFull(r.totalEpcCapex || 0), _fmtPct(r.totalProjectCost ? r.totalEpcCapex/r.totalProjectCost*100 : 0)],
            ['BESS (MWh × capex/kWh)', _fmtEFull(r.bessCAPEX || 0), _fmtPct(r.totalProjectCost ? r.bessCAPEX/r.totalProjectCost*100 : 0)],
            ['Costi di Connessione alla rete', _fmtEFull(r.totalConnectionCapex || 0), _fmtPct(r.totalProjectCost ? r.totalConnectionCapex/r.totalProjectCost*100 : 0)],
            ['Acquisto Terreno', _fmtEFull(r.totalLandPurchaseCapex || 0), _fmtPct(r.totalProjectCost ? r.totalLandPurchaseCapex/r.totalProjectCost*100 : 0)],
            ['DDS Terreno (attualizzato)', _fmtEFull(r.totalLandDdsAttualizzatoCapex || 0), _fmtPct(r.totalProjectCost ? r.totalLandDdsAttualizzatoCapex/r.totalProjectCost*100 : 0)],
            ['Costi di Sviluppo', _fmtEFull(r.totalDevelopmentCapex || 0), _fmtPct(r.totalProjectCost ? r.totalDevelopmentCapex/r.totalProjectCost*100 : 0)],
            ['Acquisizione SPV', _fmtEFull(r.totalSpvAcquisitionCapex || 0), _fmtPct(r.totalProjectCost ? r.totalSpvAcquisitionCapex/r.totalProjectCost*100 : 0)],
            ['TOTALE PROGETTO', _fmtEFull(r.totalProjectCost || 0), '100,00%']
        ],
        margin: { left: 14, right: 14 },
        willDrawCell: function(data) { if (data.row.index === 7) doc.setFont('helvetica', 'bold'); }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 45, y);
    y = _sectionTitle(doc, '3. Leva Finanziaria & Capital Stack', y);
    
    const debtBasisLabel = p.debtBasis === 'enterprise_value' ? 'Intero Enterprise Value (EV)' : 
                          (p.debtBasis === 'ev_ex_spv' ? 'Valore Deal senza Acquisizione SPV (EV Ex SPV)' : 'Sola Costruzione (Hard Costs)');
    const targetLeveragePct = p.leverage || 0;
    
    const effLevEV = r.totalProjectCost ? (seniorDebt / r.totalProjectCost) : 0;
    const capexOnly = (r.totalProjectCost || 0) - spvAcq;
    const effLevCapex = capexOnly ? (seniorDebt / capexOnly) : 0;
    
    const equityPct = r.totalProjectCost ? (r.equityAmount / r.totalProjectCost * 100) : 0;
    
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Indicatore Struttura', 'Valore']],
        body: [
            ['Base di Calcolo Debito Impostata', debtBasisLabel],
            ['Leva Finanziaria Target (Input)', _fmtPct(targetLeveragePct * 100)],
            ['Leva Finanziaria Effettiva (su Intero EV)', _fmtPct(effLevEV * 100)],
            ['Leva Finanziaria Effettiva (su EV Ex SPV)', _fmtPct(effLevCapex * 100)],
            ['Quota equity Sponsor su EV Totale', _fmtPct(equityPct)],
            ['Tasso debito senior', _fmtPct((p.interestRate || 0) * 100)],
            ['Durata mutuo senior', (p.loanTerm || 0) + ' anni'],
            ['Cash Sweep', p.sweepType === 'none' ? 'Nessuno' : (p.sweepType === 'pct_cfads' ? p.sweepValue + '% CFADS' : '€' + (p.sweepValue || 0) + '/anno')],
            ['WACC di progetto', _fmtPct((p.wacc || 0) * 100)],
            ['Costo equity (Ke)', _fmtPct((p.keVal || 0) * 100)]
        ],
        margin: { left: 14, right: 14 }
    });
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 6: EXIT & VALUTAZIONE
// ═══════════════════════════════════════════════════════════════════
function _repExitValutazione(doc) {
    const { r, m, p } = _ctx();
    _pdfHeader(doc, 'Report Exit & Valutazione', 'Report N. 06');
    let y = 32;
    const exitYear = (p.exitOption && p.exitOption !== 'none') ? parseInt(p.exitOption) : 20;
    const ev = (m.exitEnterpriseValue || [])[exitYear - 1] || 0;
    const debtPayoff = (m.exitDebtPayoff || [])[exitYear - 1] || 0;
    const pdPayoff = (m.pdBulletPayoff || [])[exitYear - 1] || 0;
    const peShare = (m.peExitShare || [])[exitYear - 1] || 0;
    const afCost = (m.afExitCost || [])[exitYear - 1] || 0;
    const pexTax = (m.exitPexTaxRow || [])[exitYear - 1] || 0;
    const netProceeds = (m.exitNetProceedsRow || [])[exitYear - 1] || 0;
    const ebitdaExit = (m.ebitda || [])[exitYear - 1] || 0;

    y = _sectionTitle(doc, '1. Valutazione Exit (Anno ' + exitYear + ')', y);
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Voce di Valutazione', 'Valore (€)']],
        body: [
            ['EBITDA anno exit', _fmtEFull(ebitdaExit)],
            ['Multiplo EBITDA applicato', (typeof p.exitMultiple === 'number' ? p.exitMultiple : 8).toFixed(2) + 'x'],
            ['Enterprise Value (EV)', _fmtEFull(ev)],
            ['(-) Payoff Debito Senior Residuo', _fmtEFull(debtPayoff)],
            ['(-) Payoff Private Debt (bullet)', _fmtEFull(pdPayoff)],
            ['Equity Value (EV - debito)', _fmtEFull(Math.max(0, ev - debtPayoff - pdPayoff))],
            ['(-) Quota Private Equity a partner', _fmtEFull(peShare)],
            ['(-) Costo Altra Forma (success/warrant/conv)', _fmtEFull(afCost)],
            ['Equity Value netto Sponsor', _fmtEFull(Math.max(0, ev - debtPayoff - pdPayoff - peShare - afCost))],
            ['(-) PEX Tax (1,2% su plusvalenza)', _fmtEFull(pexTax)],
            ['NET PROCEEDS SPONSOR (Exit)', _fmtEFull(netProceeds)]
        ],
        margin: { left: 14, right: 14 },
        willDrawCell: function(data) { if (data.row.index === 10) doc.setFont('helvetica', 'bold'); }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 50, y);
    y = _sectionTitle(doc, '2. Rendimenti Realizzati Sponsor', y);
    const moic = r.holdcoMoic || 0;
    doc.autoTable({
        startY: y,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        head: [['Metrica', 'Valore']],
        body: [
            ['Equity investito Sponsor', _fmtEFull(r.equityAmount || 0)],
            ['Totale FCFE HoldCo cumulato (fino a exit)', _fmtEFull((m.holdcoFCFE || []).slice(0, exitYear).reduce((a, b) => a + (b || 0), 0))],
            ['Net Proceeds Exit', _fmtEFull(netProceeds)],
            ['MOIC (Multiplo su investito)', _fmtX(moic)],
            ['IRR Equity HoldCo', _fmtPct(r.calculatedIrr)],
            ['NPV @ Ke', _fmtE(r.holdcoNpv)],
            ['Payback period', r.paybackPeriod]
        ],
        margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 6;

    y = _ensureSpace(doc, 30, y);
    y = _sectionTitle(doc, '3. Note Valutative', y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const note = 'Valutazione exit basata su multiplo EBITDA. PEX Tax: 5% della plusvalenza è tassato a IRES (24%) = 1,2% effettivo (regime partecipation exemption). ' +
        'Payoff Private Debt bullet capitalizza gli interessi PIK composti fino all\'anno di exit. Quota Private Equity determinata dalla modalità scelta (dividend_share / preferred_return / bullet_exit). ' +
        'Altra Forma: success fee su %EV, warrant su %equity, o convertible con payoff = max(saldo PIK, %EV).';
    doc.text(doc.splitTextToSize(note, doc.internal.pageSize.getWidth() - 28), 14, y + 2);
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 7: SENSIBILITÀ
// ═══════════════════════════════════════════════════════════════════
function _repSensibilita(doc) {
    const { r, p } = _ctx();
    _pdfHeader(doc, 'Analisi di Sensibilità - Variabili Critiche', 'Report N. 07');
    let y = 32;
    const baseIrr = r.calculatedIrr || 0;

    // ── Sezione 1: TORNADO con dati reali (calcolati dal worker) ──
    y = _sectionTitle(doc, '1. Tornado IRR - Dati Reali (± singola variabile)', y);
    const torn = window.State.lastTornado;
    if (torn && torn.rows && torn.rows.length > 0) {
        doc.autoTable({
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
            head: [['Variabile (ordinata per impatto)', 'Variazione', 'IRR base', 'IRR (−Δ)', 'IRR (+Δ)', 'Impatto ±']],
            body: torn.rows.map(row => [
                row.label,
                '±' + row.delta + (['wacc', 'inflation', 'interestRate'].includes(row.key) ? ' pp' : ' %'),
                _fmtPct(torn.baseIrr),
                _fmtPct(row.irrDown),
                _fmtPct(row.irrUp),
                ((row.irrUp - row.irrDown) / 2).toFixed(2) + ' pp'
            ]),
            margin: { left: 14, right: 14 },
            willDrawCell: function(data) {
                if (data.row.index === 0) doc.setFont('helvetica', 'bold');
            }
        });
        y = doc.lastAutoTable.finalY + 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        const top = torn.rows[0];
        doc.text(`Variabile più critica: ${top.label} (impatto ±${((top.irrUp - top.irrDown) / 2).toFixed(2)} pp su IRR). La tabella è ordinata per impatto decrescente.`, 14, y + 2);
        y += 8;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('Tornado non disponibile (calcolo fallito). Esegui "Tornado (6 variabili)" nella scheda Sensibilità e rigenera il report.', 14, y + 4);
        y += 12;
    }

    // ── Sezione 2: MONTE CARLO (percentili, se eseguito) ──
    y = _ensureSpace(doc, 55, y);
    y = _sectionTitle(doc, '2. Monte Carlo - Percentili (P10 / P50 / P90)', y);
    const mc = window.State.lastMonteCarlo;
    if (mc) {
        const fmtMc = (k, s) => {
            if (k === 'irr') return [_fmtPct(s.p10), _fmtPct(s.p50), _fmtPct(s.p90), _fmtPct(s.mean)];
            if (k === 'npv') return [_fmtE(s.p10), _fmtE(s.p50), _fmtE(s.p90), _fmtE(s.mean)];
            return [s.p10.toFixed(2) + 'x', s.p50.toFixed(2) + 'x', s.p90.toFixed(2) + 'x', s.mean.toFixed(2) + 'x'];
        };
        doc.autoTable({
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 8 },
            bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
            head: [['KPI', 'P10 (Pessimistico)', 'P50 (Mediano)', 'P90 (Ottimistico)', 'Media']],
            body: [
                ['Equity IRR', ...fmtMc('irr', mc.irr)],
                ['NPV @ Ke', ...fmtMc('npv', mc.npv)],
                ['DSCR Minimo', ...fmtMc('dscrMin', mc.dscrMin)],
                ['DSCR Medio', ...fmtMc('dscrAvg', mc.dscrAvg)]
            ],
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(`Simulazioni: ${mc.nSim} | Volatilità: σ PUN ${mc.sigmaPun}% / σ Produzione FV ${mc.sigmaGen}% | Shock lognormale mean-preserving sui prezzi, gaussiano sulla produzione.`, 14, y + 2);
        y += 8;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('Monte Carlo non ancora eseguito. Apri la scheda Sensibilità → Monte Carlo, esegui e rigenera il report.', 14, y + 4);
        y += 12;
    }

    y = _ensureSpace(doc, 40, y);
    y = _sectionTitle(doc, '3. Risultati Sensibilità 1D/2D Salvati (ultima esecuzione)', y);
    const sens = window.State.lastSensitivity || null;
    if (sens && sens.matrix) {
        const targetLabel = { irr: 'IRR %', npv: 'NPV €', dscr_min: 'DSCR min', dscr_avg: 'DSCR avg' }[sens.targetKpi] || 'KPI';
        const xLabels = sens.xVals || [];
        const rows2D = sens.matrix;
        const yLabels = sens.yVals || [0];
        const head = [['y \\ x', ...xLabels.map(v => String(v))]];
        const body = rows2D.map((row, i) => [String(yLabels[i]), ...row.map(v => v === null ? '-' : (sens.targetKpi === 'irr' ? v.toFixed(2) + '%' : (sens.targetKpi === 'npv' ? _fmtE(v) : v.toFixed(2))))]);
        doc.autoTable({
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [148, 163, 184], fontSize: 7 },
            bodyStyles: { fontSize: 7, textColor: [30, 41, 59], halign: 'right' },
            columnStyles: { 0: { cellWidth: 25, halign: 'left', fontStyle: 'bold' } },
            head: head,
            body: body,
            margin: { left: 14, right: 14 }
        });
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text('Target KPI: ' + targetLabel + ' - variabile X: ' + (sens.config && sens.config.xVar) + (sens.type === '2D' ? ', variabile Y: ' + (sens.config && sens.config.yVar) : ''), 14, doc.lastAutoTable.finalY + 5);
    } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('Nessuna analisi di sensibilità ancora eseguita. Apri la scheda "Sensibilità", configura variabili X/Y e target KPI, poi esegui. Il report verrà popolato automaticamente con la matrice dei risultati.', 14, y + 4);
    }
}

// ═══════════════════════════════════════════════════════════════════
// REPORT 8: FULL DUE DILIGENCE (unione di tutti in unico doc)
// ═══════════════════════════════════════════════════════════════════
function _repFullDueDiligence(doc) {
    const W = doc.internal.pageSize.getWidth();
    // Copertina (portrait, prima pagina del doc iniziale)
    _pdfHeader(doc, 'Due Diligence Bancaria - Report Completo', 'Report N. 08');
    let y = 40;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text('Due Diligence Bancaria Completa', 14, y);
    y += 8;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(window._currentProjectName || 'Progetto New Green Deal', 14, y);
    y += 14;
    doc.setFontSize(9);
    const intro = 'Documento di due diligence integrato per valutazione di operazioni M&A nel settore rinnovabili (FV + BESS) in struttura di project finance. Include: executive summary, struttura finanziaria, conto economico SPV, rendiconto finanziario con waterfall, piano di ammortamento (senior + soci + private debt), analisi exit e valutazione. I parametri finanziari esterni (Private Debt, Private Equity, Altra Forma) sono integrati nel modello waterfall e fiscale.';
    doc.text(doc.splitTextToSize(intro, W - 28), 14, y);
    y += 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Indice del Report:', 14, y);
    y += 6;
    const toc = ['Sezione 1 - Executive Summary (KPI & commento)', 'Sezione 2 - Relazione Tecnica & Descrittiva', 'Sezione 3 - Struttura Finanziaria & Fonti/Impieghi', 'Sezione 4 - Conto Economico SPV (20 anni, landscape)', 'Sezione 5 - Rendiconto Finanziario SPV (landscape)', 'Sezione 6 - Piano di Ammortamento (landscape)', 'Sezione 7 - Exit & Valutazione'];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    toc.forEach(line => { doc.text('•  ' + line, 16, y); y += 5; });

    // Sezione 1 (portrait)
    doc.addPage();
    _repExecutiveSummary(doc);

    // Sezione 2 (portrait)
    doc.addPage();
    _repRelazioneTecnica(doc);

    // Sezione 3 (portrait)
    doc.addPage();
    _repStrutturaFinanziaria(doc);

    // Sezioni 4, 5, 6 (landscape): aggiungiamo pagine in orientation landscape
    // jsPDF: addPage accetta formato/orientamento; cambiamo poi il layout page corrente.
    doc.addPage('a4', 'landscape');
    _pdfHeader(doc, 'Sezione 4 - Conto Economico SPV', 'Due Diligence N. 08');
    _repContoEconomicoInline(doc, 30);

    doc.addPage('a4', 'landscape');
    _pdfHeader(doc, 'Sezione 5 - Rendiconto Finanziario SPV', 'Due Diligence N. 08');
    _repRendicontoFinanziarioInline(doc, 30);

    doc.addPage('a4', 'landscape');
    _pdfHeader(doc, 'Sezione 6 - Piano di Ammortamento', 'Due Diligence N. 08');
    _repPianoAmmortamentoInline(doc, 30);

    // Sezione 7 (portrait)
    doc.addPage('a4', 'portrait');
    _pdfHeader(doc, 'Sezione 7 - Exit & Valutazione', 'Due Diligence N. 08');
    _repExitValutazione(doc);
}

// ── Versioni inline (rendering sul doc corrente senza ricreare header/copertina) ──
function _repContoEconomicoInline(doc, startY) {
    const rows = [
        { key: 'revenueTotal', label: 'RICAVI TOTALI SPV' },
        { key: 'revenueRid', label: '  di cui Ricavi RID / FER X (FV)' },
        { key: 'revenuePpa', label: '  di cui Ricavi PPA / CER' },
        { key: 'revenueTimeshifting', label: '  di cui Time Shifting BESS' },
        { key: 'revenueArbitrage', label: '  di cui Arbitraggio BESS' },
        { key: 'opexTotal', label: '(-) OPEX TOTALE SPV', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexPlants', label: '  di cui O&M FV', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexBess', label: '  di cui O&M BESS', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexGridCharging', label: '  di cui Costo Energia Pre-carica da Rete BESS', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexLandDds', label: '  di cui Canone DDS/Affitto Terreno', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexInsurance', label: '  di cui Assicurazione', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexTaxes', label: '  di cui Tasse Locali / IMU', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexSecurity', label: '  di cui Vigilanza & Sicurezza', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexAssetManagement', label: '  di cui Asset Management', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'opexServiceContract', label: '  di cui Contratto di Servizio Commerciale PPA', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'ebitda', label: 'EBITDA SPV' },
        { key: 'depreciationCivil', label: '(-) Ammortamento Civilistico' },
        { key: 'ebit', label: 'EBIT SPV' },
        { key: 'interestActive', label: '(+) Interessi Attivi MRA' },
        { key: 'interest', label: '(-) Interessi Mutuo Bancario Senior' },
        { key: 'sociInterestAccrued', label: '(-) Interessi Finanziamento Soci' },
        { key: 'pdInterestAccrued', label: '(-) Interessi Private Debt' },
        { key: 'afInterestAccrued', label: '(-) Interessi Convertibile (AF)' },
        { key: 'ebt', label: 'EBT - Utile ante Imposte' },
        { key: 'currentTaxesSpv', label: '(-) Imposte Correnti (IRES+IRAP)' },
        { key: 'deferredTaxes', label: '(-/+) Imposte Differite' },
        { key: 'netProfitSpv', label: 'UTILE NETTO SPV' }
    ];
    return _yearTable(doc, 'Conto Economico', '', rows, startY);
}
function _repRendicontoFinanziarioInline(doc, startY) {
    const rows = [
        { key: 'netProfitSpv', label: 'Utile Netto SPV (da CE)' },
        { key: 'depreciationCivil', label: '(+) Ripresa Ammortamento' },
        { key: 'deferredTaxes', label: '(+/-) Imposte Differite' },
        { key: 'interest', label: '(+) Ripresa Interessi Senior' },
        { key: 'sociInterestAccrued', label: '(+) Ripresa Interessi Soci' },
        { key: 'pdInterestAccrued', label: '(+) Ripresa Interessi PD' },
        { key: 'afInterestAccrued', label: '(+) Ripresa Interessi AF' },
        { key: 'opexMaintReserve', label: '(-) Accantonamento MRA' },
        { key: 'bessAugmentationCost', label: '(-) CAPEX Sostituzione BESS' },
        { key: 'mraRelease', label: '(+) Rilascio MRA' },
        { key: 'cfads', label: 'CFADS SPV' },
        { key: 'interestPaid', label: '(-) Interessi Senior Pagati', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'principalScheduled', label: '(-) Quota Capitale Senior Programmata', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'principalVoluntary', label: '(-) Cash Sweep Senior Volontario', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvFCFE', label: 'CASSA POST-DEBITO SENIOR (FCFE SPV)' },
        { key: 'pdInterestPaid', label: '(-) Interessi Private Debt Pagati' },
        { key: 'pdPrincipalPaid', label: '(-) Quota Capitale Private Debt' },
        { key: 'peDividendPaid', label: '(-) Quota Dividendi/Preferred PE' },
        { key: 'holdcoInterestReceived', label: '(-) Interessi Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'holdcoLoanRepaymentReceived', label: '(-) Rimborso Capitale Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvLockedDividends', label: '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti' },
        { key: 'holdcoDividendReceived', label: '(-) Dividendi -> HoldCo (quota Sponsor)', fmt: v => _fmtEFull(-Math.abs(v)) },
        { key: 'spvCashTrap', label: '(=) Cassa Residua SPV (Cash Trap)' }
    ];
    return _yearTable(doc, 'Rendiconto Finanziario', '', rows, startY);
}
function _repPianoAmmortamentoInline(doc, startY) {
    const { d, p } = _ctx();
    let y = startY;
    const exitOption = p && p.exitOption ? p.exitOption : (document.getElementById('input-exit-option') ? document.getElementById('input-exit-option').value : null);
    let exitYear = (exitOption && exitOption !== 'none') ? parseInt(exitOption) : 20;
    if (isNaN(exitYear) || exitYear < 1) exitYear = 20;
    const years = (d.years || []).slice(0, exitYear);
    const fmt = _fmtEFull;
    y = _sectionTitleLS(doc, '1. DEBITO BANCARIO SPV - Project Finance (Senior Debt)', y);
    doc.autoTable({
        startY: y, theme: 'striped',
        headStyles: { fillColor: [76, 35, 90], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
        bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
        head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
        body: [
            ['Debito Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalance[i] || 0))],
            ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccrued[i] || 0)))],
            ['(-) Quota Capitale Programmata', ...years.map((_, i) => fmt(-Math.abs(d.principalScheduled[i] || 0)))],
            ['(-) Cash Sweep Volontario', ...years.map((_, i) => fmt(-Math.abs(d.principalVoluntary[i] || 0)))],
            ['Debito Fine Anno', ...years.map((_, i) => fmt(d.endingBalance[i] || 0))],
            ['Servizio Debito Effettivo', ...years.map((_, i) => fmt(-Math.abs(d.totalDebtService[i] || 0)))],
            ['DSCR', ...years.map((_, i) => (d.dscr[i] !== -1 && d.dscr[i] !== undefined) ? (d.dscr[i]).toFixed(2) + 'x' : 'N/A')]
        ],
        margin: { left: 10, right: 10 }
    });
    y = doc.lastAutoTable.finalY + 5;
    y = _ensureSpaceLS(doc, 40, y);
    y = _sectionTitleLS(doc, '2. FINANZIAMENTO SOCI (' + (p.sociEquityPct || 0) + '% Equity)', y);
    doc.autoTable({
        startY: y, theme: 'striped',
        headStyles: { fillColor: [14, 98, 81], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
        bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
        columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
        head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
        body: [
            ['Fin. Soci Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalanceSoci[i] || 0))],
            ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedSoci[i] || 0)))],
            ['(+) Interessi Pagati', ...years.map((_, i) => fmt(d.interestPaidSoci[i] || 0))],
            ['(-) Rimborso Capitale', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidSoci[i] || 0)))],
            ['Fin. Soci Fine Anno', ...years.map((_, i) => fmt(d.endingBalanceSoci[i] || 0))]
        ],
        margin: { left: 10, right: 10 }
    });
    y = doc.lastAutoTable.finalY + 5;
    if (p.pdEnabled && d.beginningBalancePd) {
        y = _ensureSpaceLS(doc, 40, y);
        const pdModeTxt = p.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (p.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
        y = _sectionTitleLS(doc, '3. PRIVATE DEBT - Mezzanine (' + (p.pdInterestRate || 0).toFixed(2) + '% - ' + pdModeTxt + ')', y);
        doc.autoTable({
            startY: y, theme: 'striped',
            headStyles: { fillColor: [14, 98, 81], textColor: [226, 232, 240], fontSize: 6, halign: 'right' },
            bodyStyles: { fontSize: 6, textColor: [30, 41, 59] },
            columnStyles: { 0: { cellWidth: 50, halign: 'left', fontStyle: 'bold' } },
            head: [['Voce', ...years.map(yr => 'Anno ' + yr)]],
            body: [
                ['PD Inizio Anno', ...years.map((_, i) => fmt(d.beginningBalancePd[i] || 0))],
                ['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedPd[i] || 0)))],
                ['(+) Interessi Pagati', ...years.map((_, i) => fmt(d.interestPaidPd[i] || 0))],
                ['(-) Rimborso Capitale / Payoff', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidPd[i] || 0)))],
                ['PD Fine Anno', ...years.map((_, i) => fmt(d.endingBalancePd[i] || 0))]
            ],
            margin: { left: 10, right: 10 }
        });
    }
    return y;
}

// ── Helper: merge di un secondo doc PDF nel principale (legacy placeholder, non usato) ──
function _mergePdf(target, source) { /* no-op: full DD usa rendering inline sequenziale */ }

