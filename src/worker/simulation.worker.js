// Web Worker per simulazione BESS
let State = null;

const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
function getMonthOfHour(t) {
    for (let m = 0; m < 12; m++) {
        if (t >= monthStartHours[m] && t < monthStartHours[m+1]) return m;
    }
    return 11;
}

function getBrpFeeForMonth(plant, yr, monthIndex) {
    const absMonth = (yr - 1) * 12 + monthIndex + 1;
    const fee1M = plant.brpFee1Months !== undefined ? plant.brpFee1Months : 18;
    const fee2M = plant.brpFee2Months !== undefined ? plant.brpFee2Months : 6;
    if (absMonth <= fee1M) return plant.brpFee1 !== undefined ? plant.brpFee1 : 2;
    if (absMonth <= fee1M + fee2M) return plant.brpFee2 !== undefined ? plant.brpFee2 : 1;
    return plant.brpFee3 !== undefined ? plant.brpFee3 : 0;
}

// Fee BRP rappresentativa per l'ottimizzazione del dispatch: il profilo orario
// 8760h è calcolato UNA volta e riusato per tutti gli anni (volumi fissi,
// prezzi ri-contabilizzati per anno), quindi la strategia di carica/scarica va
// sagomata sulla fee MEDIA per mese di calendario lungo la vita utile (20 anni),
// non sulla sola fee promozionale dell'anno 1 (che sovrastimava l'iniezione in
// rete quando le fee scendono a 0 dal ~2° anno).
const BRP_DISPATCH_HORIZON_YEARS = 20;
function getBrpLifetimeAvgFeeForMonth(plant, monthIndex) {
    let sum = 0;
    for (let yr = 1; yr <= BRP_DISPATCH_HORIZON_YEARS; yr++) {
        sum += getBrpFeeForMonth(plant, yr, monthIndex);
    }
    return sum / BRP_DISPATCH_HORIZON_YEARS;
}

// Potenza massima di PRELIEVO dalla rete utilizzabile per caricare il BESS (kW, lato POD).
//  - undefined/null (oggetti legacy senza il campo) -> nessun vincolo aggiuntivo (= potenza BESS)
//  - 0 -> carica da rete vietata: nessun arbitraggio, il BESS opera solo in time shifting da FV
//  - >0 -> vincolo c_grid(t) <= min(P_prelievo, P_BESS)
function resolveGridWithdrawalCapKw(p, maxPowerKw) {
    const raw = p ? p.gridWithdrawalKw : undefined;
    if (raw === undefined || raw === null || raw === '') return maxPowerKw;
    const v = Number(raw);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.min(v, maxPowerKw);
}

// Prezzo (€/kWh) dell'energia BESS di origine RETE (arbitraggio) re-immessa.
// RID/BRP: stesso prezzo orario di immissione dell'energia FV.
// FER X: la tariffa incentivante spetta solo all'energia rinnovabile; l'energia
// prelevata e re-immessa è valorizzata al prezzo zonale orario (con perdite convenzionali).
function arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID) {
    return marketType === 'fer_x' ? (pricePUN * lossMult / 1000) : priceRID;
}

// Penalità di throughput (€/kWh) usata da DP e LP: rompe la degenerazione tra soluzioni
// equivalenti ed esclude carica/scarica simultanea nello stesso intervallo.
const BESS_THROUGHPUT_PENALTY = 0.0001;

// ═══ CF3: COD dinamico e lag di incasso per regime ═══
// Data COD 'YYYY-MM-DD' -> {y,m,d} oppure null
function parseCodDate(codDate) {
    if (!codDate) return null;
    const s = String(codDate).slice(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
}
function codDaysInMonth(y, m) {
    const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return dim[m - 1];
}
// Frazione dell'anno di calendario in cui l'impianto è in esercizio (1 = anno intero, legacy)
function codYearAvailability(cod, calYear) {
    if (!cod) return 1;
    if (calYear < cod.y) return 0;
    if (calYear > cod.y) return 1;
    let days = 0;
    for (let m = cod.m; m <= 12; m++) {
        days += (m === cod.m) ? (codDaysInMonth(calYear, m) - cod.d + 1) : codDaysInMonth(calYear, m);
    }
    const totalDays = Math.round((Date.UTC(calYear, 11, 31) - Date.UTC(calYear, 0, 1)) / 86400000) + 1;
    return days / totalDays;
}
// Frazione del mese (1-12) in cui l'impianto è in esercizio
function codMonthActiveFraction(cod, calYear, m) {
    if (!cod) return 1;
    if (calYear < cod.y) return 0;
    if (calYear > cod.y) return 1;
    if (m < cod.m) return 0;
    if (m > cod.m) return 1;
    const dim = codDaysInMonth(calYear, m);
    return (dim - cod.d + 1) / dim;
}
// Intervallo orario esatto [hStart, hEnd) in cui l'impianto è in esercizio (CF3 - no pro-die)
function getPlantActiveHourRange(cod, calYear) {
    if (!cod || calYear === null || calYear === undefined) {
        return { hStart: 0, hEnd: 8760, isActive: true, isFullYear: true };
    }
    if (calYear < cod.y) {
        return { hStart: 8760, hEnd: 8760, isActive: false, isFullYear: false };
    }
    if (calYear > cod.y) {
        return { hStart: 0, hEnd: 8760, isActive: true, isFullYear: true };
    }
    // calYear === cod.y: COD cade nell'anno di calendario corrente
    const m = Math.max(1, Math.min(12, cod.m));
    const d = Math.max(1, Math.min(31, cod.d));
    const hStart = Math.min(8760, Math.max(0, monthStartHours[m - 1] + (d - 1) * 24));
    return {
        hStart,
        hEnd: 8760,
        isActive: hStart < 8760,
        isFullYear: hStart === 0
    };
}
// Lag di incasso (mesi) per l'impianto in base al regime di mercato
function collectionLagForPlant(plant, inputs, plantHasCer) {
    if (plantHasCer) return Math.max(0, parseInt(inputs.collectionLagCer, 10) || 0);
    switch (plant.marketType) {
        case 'brp': return Math.max(0, parseInt(inputs.collectionLagBrp, 10) || 0);
        case 'fer_x': return Math.max(0, parseInt(inputs.collectionLagFerx, 10) || 0);
        default: return Math.max(0, parseInt(inputs.collectionLagRid, 10) || 0);
    }
}

// Calcolo dinamico festività italiane (fisse e mobili ex Computus Pasqua di Butcher-Meeus)
function getItalianHolidays(year = 2026) {
    const fixedHolidays = [
        { m: 0, d: 1 },   // Capodanno
        { m: 0, d: 6 },   // Epifania
        { m: 3, d: 25 },  // Liberazione
        { m: 4, d: 1 },   // Festa del Lavoro
        { m: 5, d: 2 },   // Festa della Repubblica
        { m: 7, d: 15 },  // Ferragosto
        { m: 10, d: 1 },  // Ognissanti
        { m: 11, d: 8 },  // Immacolata
        { m: 11, d: 25 }, // Natale
        { m: 11, d: 26 }  // Santo Stefano
    ];
    // Algoritmo di Butcher-Meeus per la Pasqua
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const easterMonth = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const easterDay = ((h + l - 7 * m + 114) % 31) + 1;

    const holidays = new Set();
    const startYearMs = Date.UTC(year, 0, 1);

    fixedHolidays.forEach(h => {
        const dayIdx = Math.floor((Date.UTC(year, h.m, h.d) - startYearMs) / 86400000);
        if (dayIdx >= 0 && dayIdx < 365) holidays.add(dayIdx);
    });

    const easterMs = Date.UTC(year, easterMonth, easterDay);
    const easterDayIdx = Math.floor((easterMs - startYearMs) / 86400000);
    const easterMonIdx = easterDayIdx + 1; // Pasquetta
    if (easterDayIdx >= 0 && easterDayIdx < 365) holidays.add(easterDayIdx);
    if (easterMonIdx >= 0 && easterMonIdx < 365) holidays.add(easterMonIdx);

    return holidays;
}
const IT_HOLIDAYS_2026 = getItalianHolidays(2026);
const IT_HOLIDAYS_2025 = IT_HOLIDAYS_2026;

// Calcolo dinamico cambio ora solare <-> ora legale (Direttiva UE 2000/84/CE: ultima domenica di marzo -> ultima domenica di ottobre)
function getItalianDstBounds(year = 2026) {
    const march31Dow = new Date(Date.UTC(year, 2, 31)).getUTCDay();
    const springDay = 31 - march31Dow; // Ultima domenica di marzo (es. 29/03/2026)
    const oct31Dow = new Date(Date.UTC(year, 9, 31)).getUTCDay();
    const autumnDay = 31 - oct31Dow;   // Ultima domenica di ottobre (es. 25/10/2026)
    const springDayIdx = 31 + 28 + springDay - 1; // 0-based su 365 giorni (2026 -> 87, d=88)
    const autumnDayIdx = 273 + autumnDay - 1;     // 0-based su 365 giorni (2026 -> 297, d=298)
    return { springDay, autumnDay, springDayIdx, autumnDayIdx };
}

// Restituisce true se (dayIdx 0..364, solarHour 0..23 in ora solare standard) cade nel periodo di ora legale (CEST = UTC+2)
function isItalianDstHour(dayIdx, solarHour, year = 2026) {
    const { springDayIdx, autumnDayIdx } = getItalianDstBounds(year);
    if (dayIdx < springDayIdx || dayIdx > autumnDayIdx) return false;
    if (dayIdx > springDayIdx && dayIdx < autumnDayIdx) return true;
    if (dayIdx === springDayIdx) return solarHour >= 2; // alle 02:00 solare scatta le 03:00 legale
    return solarHour < 2; // ultima domenica di ottobre: alle 02:00 solare (03:00 legale) si torna in ora solare
}

// Mappa un'ora PVGIS (in ora solare fissa senza DST) sull'indice 0..8759 in ora civile italiana (CET/CEST)
function getPvgisCivilHourIndex(month, day, solarHour, year = 2026) {
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || solarHour < 0 || solarHour > 23) return -1;
    let dayIdx = day - 1;
    for (let m = 0; m < month - 1; m++) dayIdx += daysInMonth[m];
    const dst = isItalianDstHour(dayIdx, solarHour, year);
    const civilHour = dst ? ((solarHour + 1) % 24) : solarHour;
    return dayIdx * 24 + civilHour;
}

self.onmessage = async function(e) {
    const { action, payload } = e.data;
    // Pre-carica il solver LP HiGHS se richiesto (lazy, una sola volta per sessione worker nel browser)
    if (typeof importScripts === 'function' && payload && payload.State && payload.State.inputs && payload.State.inputs.bessOptimizer === 'lp') {
        await getHighs();
    }
    if (action === 'EXECUTE_CALCULATION') {
        try {
            console.log("[Worker] Starting executeCalculation...");
            State = payload.State;
            const results = executeCalculation(State);
            console.log("[Worker] executeCalculation completed.");
            self.postMessage({ status: 'success', results });
        } catch (err) {
            console.error("[Worker] Error in executeCalculation:", err);
            self.postMessage({ status: 'error', error: err.message, stack: err.stack });
        }
    } else if (action === 'EXECUTE_SENSITIVITY') {
        try {
            const results = runSensitivityLoop(payload.State, payload.sensitivityConfig);
            self.postMessage({ status: 'sensitivity_success', results });
        } catch (err) {
            self.postMessage({ status: 'sensitivity_error', error: err.message, stack: err.stack });
        }
    } else if (action === 'EXECUTE_MONTECARLO') {
        try {
            const results = runMonteCarloLoop(payload.State, payload.mcConfig);
            self.postMessage({ status: 'montecarlo_success', results });
        } catch (err) {
            self.postMessage({ status: 'montecarlo_error', error: err.message, stack: err.stack });
        }
    } else if (action === 'EXECUTE_TORNADO') {
        try {
            const results = runTornadoLoop(payload.State);
            self.postMessage({ status: 'tornado_success', results });
        } catch (err) {
            self.postMessage({ status: 'tornado_error', error: err.message, stack: err.stack });
        }
    } else if (action === 'COMPARE_SCENARIOS') {
        try {
            const results = [];
            for (const scen of (payload.scenarios || [])) {
                const stateClone = deepClone(payload.State);
                // Lo snapshot sostituisce interamente gli inputs finanziari
                stateClone.inputs = deepClone(scen.inputs);
                State = stateClone;
                const res = executeCalculation(stateClone);
                results.push({
                    id: scen.id,
                    name: scen.name,
                    irr: res.calculatedSpvEquityIrr || res.calculatedIrr,
                    npv: res.spvEquityNpv !== undefined ? res.spvEquityNpv : res.holdcoNpv,
                    holdcoNpv: res.holdcoNpv,
                    spvEquityNpv: res.spvEquityNpv,
                    moic: res.holdcoMoic,
                    minDscr: (res.minDscr === 999 || res.minDscr === 0) ? null : res.minDscr,
                    avgDscr: res.avgDscr,
                    lcoe: res.calculatedLcoe,
                    payback: res.paybackPeriod
                });
            }
            self.postMessage({ status: 'compare_success', results });
        } catch (err) {
            self.postMessage({ status: 'compare_error', error: err.message, stack: err.stack });
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LP OPTIMIZER (HiGHS WASM) — ottimo globale annuale del dispatch BESS
// ─────────────────────────────────────────────────────────────────────────────
let highsSolver = null;
let highsLoadFailed = false;
// HiGHS pinnato alla 1.15.2 (SRI non applicabile a importScripts; il pinning evita drift del CDN)
const HIGHS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/highs@1.15.2/build/';
async function getHighs() {
    if (highsSolver || highsLoadFailed) return highsSolver;
    if (typeof importScripts !== 'function') {
        highsLoadFailed = true;
        return null;
    }
    try {
        importScripts(HIGHS_CDN_BASE + 'highs.js');
        const factory = self.highs || self.Module || self.HiGHS;
        if (typeof factory !== 'function') throw new Error('factory HiGHS non trovata dopo importScripts');
        highsSolver = await factory({ locateFile: (f) => HIGHS_CDN_BASE + f });
        console.log('[Worker] HiGHS LP solver caricato da CDN.');
    } catch (err) {
        highsLoadFailed = true;
        console.warn('[Worker] HiGHS non disponibile, fallback su DP:', err.message);
    }
    return highsSolver;
}

// Dispatch BESS via LP globale su 8760h (stesso contratto di output di simulateBessHourly).
// Modello a DUE serbatoi contabili con tracciamento ESATTO dell'origine dell'energia:
//   ss = energia di origine FV (include la riserva minSoc, mai scaricata)
//   sg = energia di origine RETE (arbitraggio)
// Variabili/ora: cpv, cgr, dgs (scarica FV->rete), dgg (scarica rete->rete),
//                dppa (scarica FV->carico PPA), s (autoconsumo FV), ss, sg.
// L'energia prelevata dalla rete non può alimentare il PPA on-site (coerente con la DP 2D).
// Vincoli di rete: cgr <= min(P_prelievo, P_BESS). P_prelievo = 0 -> solo time shifting.
// Carica/scarica simultanea esclusa da RTE < 100% + penalità di throughput (LP puro, niente binarie).
function simulateBessLP(solarProfile, punProfile, loadProfile, p) {
    const H = 8760;
    const bessMw = p.bessMw;
    const bessMwh = p.bessMwh;
    const bessEfficiency = p.bessEfficiency;
    const bessConnection = p.bessConnection || 'ac';

    const lossMult = 1 + (p.gridLosses / 100);
    const lossWithdrawMult = 1 + ((p.gridLossesWithdraw || 0) / 100);
    const gseImb = p.gseImbalance;
    const spread = p.traderSpread;
    const disp = p.traderDisp;
    const ppaPrice = p.ppaPrice || 0;
    const marketType = p.marketType || 'rid';
    const ferxTariff = p.ferxTariff !== undefined ? p.ferxTariff : 85;

    // Efficienze (stesse convenzioni della DP)
    let rte = bessEfficiency;
    const configuredDod = (p.bessDoD && p.bessDoD > 0) ? p.bessDoD / 100 : null;
    const dod = configuredDod !== null ? configuredDod : 0.90;
    const socMaxPct = (p.bessSocMax !== undefined && p.bessSocMax > 0 && p.bessSocMax <= 100) ? p.bessSocMax : 100;
    const socMinPct = (p.bessSocMin !== undefined && p.bessSocMin > 0 && p.bessSocMin < socMaxPct) ? p.bessSocMin : null;
    const maxSoc = bessMwh * 1000 * (socMaxPct / 100);
    const minSoc = (socMinPct !== null) ? (bessMwh * 1000 * (socMinPct / 100)) : maxSoc * (1 - dod);
    const maxPower = bessMw * 1000;
    const wdCap = resolveGridWithdrawalCapKw(p, maxPower);
    const chargeSolarEff = bessConnection === 'dc' ? 0.98 : Math.sqrt(rte);
    const chargeGridEff = Math.sqrt(rte);
    const dischargeEff = Math.sqrt(rte);
    const eps = BESS_THROUGHPUT_PENALTY;

    // Media mensile PUN per contratto pun_medio
    const monthlyAveragePun = new Float64Array(12);
    const monthlyCounts = new Int32Array(12);
    for (let t = 0; t < H; t++) {
        const m = getMonthOfHour(t);
        monthlyAveragePun[m] += punProfile[t];
        monthlyCounts[m]++;
    }
    for (let m = 0; m < 12; m++) if (monthlyCounts[m] > 0) monthlyAveragePun[m] /= monthlyCounts[m];

    // ── Costruzione del modello in formato LP testuale (highs-js accetta stringhe) ──
    const fmt = (v) => {
        if (!isFinite(v)) return '0';
        return Math.abs(v) < 1e-12 ? '0' : Number(v.toPrecision(10)).toString();
    };
    const term = (coef, name) => (coef >= 0 ? ' + ' : ' - ') + fmt(Math.abs(coef)) + ' ' + name;
    const objParts = [];
    const ctrParts = [];
    const bndParts = [];
    const invEffD = 1 / dischargeEff;
    for (let t = 0; t < H; t++) {
        const pricePUN = punProfile[t];
        const month = getMonthOfHour(t);
        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000)
            : (marketType === 'brp') ? ((pricePUN + getBrpLifetimeAvgFeeForMonth(p, month)) * lossMult / 1000)
            : ((pricePUN * lossMult - gseImb) / 1000);
        const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
        const pricePPA = ppaPrice / 1000;
        const lodVal = loadProfile ? Math.max(0, loadProfile[t]) : 0;
        const solVal = Math.max(0, solarProfile[t]);

        // Funzione obiettivo (max): ricavi PPA/RID/arbitraggio - costi prelievo - penalità throughput
        objParts.push(term(-priceRID - eps, 'cpv' + t));
        objParts.push(term(-costGrid - eps, 'cgr' + t));
        objParts.push(term(priceRID - eps, 'dgs' + t));
        objParts.push(term(priceArb - eps, 'dgg' + t));
        objParts.push(term(pricePPA - eps, 'dppa' + t));
        objParts.push(term(pricePPA - priceRID, 's' + t));

        // Dinamica serbatoio FV: ss_t - ss_{t-1} - effCS*cpv + (dgs + dppa)/effD = (t==0 ? minSoc : 0)
        ctrParts.push(' dyns' + t + ': ss' + t
            + (t > 0 ? ' - ss' + (t - 1) : '')
            + ' - ' + fmt(chargeSolarEff) + ' cpv' + t
            + ' + ' + fmt(invEffD) + ' dgs' + t
            + ' + ' + fmt(invEffD) + ' dppa' + t
            + ' = ' + fmt(t === 0 ? minSoc : 0));
        // Dinamica serbatoio RETE: sg_t - sg_{t-1} - effCG*cgr + dgg/effD = 0
        ctrParts.push(' dyng' + t + ': sg' + t
            + (t > 0 ? ' - sg' + (t - 1) : '')
            + ' - ' + fmt(chargeGridEff) + ' cgr' + t
            + ' + ' + fmt(invEffD) + ' dgg' + t
            + ' = 0');
        // Capacità totale
        ctrParts.push(' soccap' + t + ': ss' + t + ' + sg' + t + ' <= ' + fmt(maxSoc));
        // Limiti potenza BESS
        ctrParts.push(' chcap' + t + ': cpv' + t + ' + cgr' + t + ' <= ' + fmt(maxPower));
        ctrParts.push(' discap' + t + ': dgs' + t + ' + dgg' + t + ' + dppa' + t + ' <= ' + fmt(maxPower));
        // Ripartizione solare: autoconsumo + carica <= generazione
        ctrParts.push(' solsplit' + t + ': s' + t + ' + cpv' + t + ' <= ' + fmt(solVal));
        // Scarica PPA + autoconsumo <= fabbisogno
        ctrParts.push(' ppalim' + t + ': dppa' + t + ' + s' + t + ' <= ' + fmt(lodVal));

        // Bounds (cgr limitato dalla potenza di prelievo del punto di connessione)
        bndParts.push(' 0 <= cpv' + t + ' <= ' + fmt(Math.min(solVal, maxPower)));
        bndParts.push(' 0 <= cgr' + t + ' <= ' + fmt(wdCap));
        bndParts.push(' 0 <= dgs' + t + ' <= ' + fmt(maxPower));
        bndParts.push(' 0 <= dgg' + t + ' <= ' + fmt(wdCap > 0 ? maxPower : 0));
        bndParts.push(' 0 <= dppa' + t + ' <= ' + fmt(Math.min(lodVal, maxPower)));
        bndParts.push(' 0 <= s' + t + ' <= ' + fmt(Math.min(lodVal, solVal)));
        bndParts.push(' ' + fmt(minSoc) + ' <= ss' + t + ' <= ' + fmt(maxSoc));
        bndParts.push(' 0 <= sg' + t + ' <= ' + fmt(wdCap > 0 ? Math.max(0, maxSoc - minSoc) : 0));
    }
    const lpString = 'Maximize\n obj:' + objParts.join('')
        + '\nSubject To\n' + ctrParts.join('\n')
        + '\nBounds\n' + bndParts.join('\n')
        + '\nEnd\n';

    const sol = highsSolver.solve(lpString);

    const status = sol && (sol.Status || sol.status);
    if (!sol || (status !== 'Optimal' && status !== 'optimal')) {
        throw new Error('LP non ottimo: ' + status);
    }
    const cols = sol.Columns;
    const colValByName = (name) => {
        const c = cols[name];
        if (!c) return 0;
        return (c.Primal !== undefined) ? c.Primal : 0;
    };

    // Ricostruzione output (stesso contratto di simulateBessHourly)
    const hourlySoC = new Float64Array(H);
    const hourlyCharge = new Float64Array(H);
    const hourlyDischarge = new Float64Array(H);
    const hourlyGridFeed = new Float64Array(H);
    const hourlySelfCons = new Float64Array(H);
    const hourlyChargeGrid = new Float64Array(H);
    const hourlyChargeGridNet = new Float64Array(H);
    const hourlyChargeSolar = new Float64Array(H);
    const hourlyChargeSolarNet = new Float64Array(H);
    const hourlyDischargeGrid = new Float64Array(H);
    const hourlyDischargePpa = new Float64Array(H);
    const hourlySelfConsSolar = new Float64Array(H);
    const hourlySelfConsBess = new Float64Array(H);
    const hourlyLossesRte = new Float64Array(H);
    const hourlyGridFeedPv = new Float64Array(H);
    const hourlyRevenueRidPure = new Float64Array(H);
    const hourlyRevenueRidActual = new Float64Array(H);
    const hourlyRevenueArbitrageGrid = new Float64Array(H);
    const hourlyRevenuePpaPv = new Float64Array(H);
    const hourlyRevenuePpaBess = new Float64Array(H);
    const hourlyRevenueTimeshifting = new Float64Array(H);
    const hourlyCostWithdrawal = new Float64Array(H);
    const hourlyDischargeArbitrage = new Float64Array(H);
    const hourlyDischargeTimeshifting = new Float64Array(H);

    let totalUplift = 0;
    let annualShiftedKwh = 0;

    for (let t = 0; t < H; t++) {
        const solVal = Math.max(0, solarProfile[t]);
        const lodVal = loadProfile ? Math.max(0, loadProfile[t]) : 0;
        // Clamp fisico delle tolleranze numeriche del solver (~1e-3 kW)
        const c_pv = Math.min(Math.max(0, colValByName('cpv' + t)), solVal);
        const c_grid = Math.min(Math.max(0, colValByName('cgr' + t)), wdCap);
        const d_gs = Math.max(0, colValByName('dgs' + t));
        const d_gg = wdCap > 0 ? Math.max(0, colValByName('dgg' + t)) : 0;
        const s = Math.min(Math.max(0, colValByName('s' + t)), Math.max(0, solVal - c_pv));
        const d_ppa = Math.min(Math.max(0, colValByName('dppa' + t)), Math.max(0, lodVal - s));
        const d_grid = d_gs + d_gg;
        const socEnd = colValByName('ss' + t) + colValByName('sg' + t);

        const pricePUN = punProfile[t];
        const month = getMonthOfHour(t);
        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000)
            : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
            : ((pricePUN * lossMult - gseImb) / 1000);
        const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
        const pricePPA = ppaPrice / 1000;

        const p_fed_pv = Math.max(0, solVal - s - c_pv);

        hourlySoC[t] = socEnd;
        hourlyCharge[t] = c_pv + c_grid;
        hourlyDischarge[t] = d_grid + d_ppa;
        hourlyChargeGrid[t] = c_grid;
        hourlyChargeGridNet[t] = c_grid * chargeGridEff;
        hourlyChargeSolar[t] = c_pv;
        hourlyChargeSolarNet[t] = c_pv * chargeSolarEff;
        hourlyDischargeGrid[t] = d_grid;
        hourlyDischargePpa[t] = d_ppa;
        hourlySelfConsSolar[t] = s;
        hourlySelfConsBess[t] = d_ppa;
        hourlySelfCons[t] = s + d_ppa;
        hourlyGridFeed[t] = p_fed_pv + d_grid;
        hourlyGridFeedPv[t] = p_fed_pv;
        hourlyLossesRte[t] = c_pv * (1 - chargeSolarEff) + c_grid * (1 - chargeGridEff) + (d_grid + d_ppa) * ((1 / dischargeEff) - 1);
        hourlyRevenueRidPure[t] = solVal * priceRID;
        hourlyRevenueRidActual[t] = p_fed_pv * priceRID;
        hourlyRevenueArbitrageGrid[t] = d_gg * priceArb;
        hourlyRevenueTimeshifting[t] = d_gs * priceRID;
        hourlyRevenuePpaPv[t] = s * pricePPA;
        hourlyRevenuePpaBess[t] = d_ppa * pricePPA;
        hourlyCostWithdrawal[t] = c_grid * costGrid;
        hourlyDischargeArbitrage[t] = d_gg;
        hourlyDischargeTimeshifting[t] = d_gs;

        totalUplift += (s + d_ppa) * pricePPA + (p_fed_pv + d_gs) * priceRID + d_gg * priceArb - c_grid * costGrid;
        annualShiftedKwh += d_grid + d_ppa;
    }

    return {
        hourlySoC, hourlyCharge, hourlyDischarge, hourlyGridFeed, hourlySelfCons,
        hourlyChargeGrid, hourlyChargeGridNet, hourlyChargeSolar, hourlyChargeSolarNet, hourlyDischargeGrid, hourlyDischargePpa,
        hourlySelfConsSolar, hourlySelfConsBess, hourlyLossesRte,
        hourlyGridFeedPv, hourlyRevenueRidPure, hourlyRevenueRidActual,
        hourlyRevenueArbitrageGrid, hourlyRevenuePpaPv, hourlyRevenuePpaBess,
        hourlyRevenueTimeshifting, hourlyCostWithdrawal,
        hourlyDischargeArbitrage, hourlyDischargeTimeshifting,
        totalUplift, annualShifted: annualShiftedKwh / 1000
    };
}

// ═══ Motore BESS Continuo & Rolling Horizon MGP 13:00 ═══
// Modelli supportati:
//   - 'rolling': Rolling Horizon GME 13:00 (Mercato Reale: finestra mobile 35h dalle 13:00 di oggi
//                fino alle 24:00 di domani con commit a 24h).
//   - 'daily':   Giornaliero Continuo 24h (Senza gradini: variabili float64 continue, carica 100%
//                del surplus solare utile e trasferisce il SoC residuo al giorno successivo).
//   - 'global':  Continuo Globale 8760h (ottimo deterministico su orizzonte annuale).
function simulateBessContinuous(solarProfile, punProfile, loadProfile, p, mode = 'rolling') {
    const H = 8760;
    const bessMw = p.bessMw;
    const bessMwh = p.bessMwh;
    const bessEfficiency = p.bessEfficiency;
    const bessType = p.bessType;
    const bessConnection = p.bessConnection || 'ac';

    const lossMult = 1 + (p.gridLosses / 100);
    const lossWithdrawMult = 1 + ((p.gridLossesWithdraw || 0) / 100);
    const gseImb = p.gseImbalance;
    const spread = p.traderSpread;
    const disp = p.traderDisp;
    const ppaPrice = p.ppaPrice || 0;
    const marketType = p.marketType || 'rid';
    const ferxTariff = p.ferxTariff !== undefined ? p.ferxTariff : 85;

    const hourlySoC = new Float64Array(H);
    const hourlyCharge = new Float64Array(H);
    const hourlyDischarge = new Float64Array(H);
    const hourlyGridFeed = new Float64Array(H);
    const hourlySelfCons = new Float64Array(H);
    const hourlyChargeGrid = new Float64Array(H);
    const hourlyChargeGridNet = new Float64Array(H);
    const hourlyChargeSolar = new Float64Array(H);
    const hourlyChargeSolarNet = new Float64Array(H);
    const hourlyDischargeGrid = new Float64Array(H);
    const hourlyDischargePpa = new Float64Array(H);
    const hourlySelfConsSolar = new Float64Array(H);
    const hourlySelfConsBess = new Float64Array(H);
    const hourlyLossesRte = new Float64Array(H);
    const hourlyGridFeedPv = new Float64Array(H);
    const hourlyRevenueRidPure = new Float64Array(H);
    const hourlyRevenueRidActual = new Float64Array(H);
    const hourlyRevenueArbitrageGrid = new Float64Array(H);
    const hourlyRevenuePpaPv = new Float64Array(H);
    const hourlyRevenuePpaBess = new Float64Array(H);
    const hourlyRevenueTimeshifting = new Float64Array(H);
    const hourlyCostWithdrawal = new Float64Array(H);
    const hourlyDischargeArbitrage = new Float64Array(H);
    const hourlyDischargeTimeshifting = new Float64Array(H);

    // Caso senza BESS o BESS disabilitato
    if (bessMwh === 0 || bessMw === 0 || bessType === 'none') {
        for (let t = 0; t < H; t++) {
            const sol = solarProfile ? Math.max(0, solarProfile[t]) : 0;
            const lod = loadProfile ? Math.max(0, loadProfile[t]) : 0;
            const selfCons = Math.min(sol, lod);
            const p_fed_pv = Math.max(0, sol - lod);

            const pricePUN = punProfile[t];
            const month = getMonthOfHour(t);
            const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000)
                : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
                : ((pricePUN * lossMult - gseImb) / 1000);
            const pricePPA = ppaPrice / 1000;

            hourlyGridFeed[t] = p_fed_pv;
            hourlySelfCons[t] = selfCons;
            hourlySelfConsSolar[t] = selfCons;
            hourlyGridFeedPv[t] = p_fed_pv;
            hourlyRevenueRidPure[t] = sol * priceRID;
            hourlyRevenueRidActual[t] = p_fed_pv * priceRID;
            hourlyRevenuePpaPv[t] = selfCons * pricePPA;
        }
        return {
            hourlySoC, hourlyCharge, hourlyDischarge, hourlyGridFeed, hourlySelfCons,
            hourlyChargeGrid, hourlyChargeSolar, hourlyDischargeGrid, hourlyDischargePpa,
            hourlySelfConsSolar, hourlySelfConsBess, hourlyLossesRte,
            hourlyGridFeedPv, hourlyRevenueRidPure, hourlyRevenueRidActual,
            hourlyRevenueArbitrageGrid, hourlyRevenuePpaPv, hourlyRevenuePpaBess,
            hourlyRevenueTimeshifting, hourlyCostWithdrawal,
            hourlyDischargeArbitrage, hourlyDischargeTimeshifting,
            totalUplift: 0, annualShifted: 0
        };
    }

    let rte = bessEfficiency;
    const configuredDod = (p.bessDoD && p.bessDoD > 0) ? p.bessDoD / 100 : null;
    const dod = configuredDod !== null ? configuredDod : 0.90;
    const socMaxPct = (p.bessSocMax !== undefined && p.bessSocMax > 0 && p.bessSocMax <= 100) ? p.bessSocMax : 100;
    const socMinPct = (p.bessSocMin !== undefined && p.bessSocMin > 0 && p.bessSocMin < socMaxPct) ? p.bessSocMin : null;
    const maxSoc = bessMwh * 1000 * (socMaxPct / 100);
    const minSoc = (socMinPct !== null) ? (bessMwh * 1000 * (socMinPct / 100)) : maxSoc * (1 - dod);
    const maxPower = bessMw * 1000;
    const wdCap = resolveGridWithdrawalCapKw(p, maxPower);
    const chargeSolarEff = bessConnection === 'dc' ? 0.98 : Math.sqrt(rte);
    const chargeGridEff = Math.sqrt(rte);
    const dischargeEff = Math.sqrt(rte);
    const eps = BESS_THROUGHPUT_PENALTY;

    // Media mensile PUN per contratti a PUN medio
    const monthlyAveragePun = new Float64Array(12);
    const monthlyCounts = new Int32Array(12);
    for (let t = 0; t < H; t++) {
        const m = getMonthOfHour(t);
        monthlyAveragePun[m] += punProfile[t];
        monthlyCounts[m]++;
    }
    for (let m = 0; m < 12; m++) if (monthlyCounts[m] > 0) monthlyAveragePun[m] /= monthlyCounts[m];

    let curSs = minSoc;
    let curSg = 0;

    // Costruzione delle finestre operative
    const windows = [];
    if (mode === 'daily') {
        for (let d = 0; d < 365; d++) {
            const tStart = d * 24;
            const W = Math.min(24, H - tStart);
            windows.push({ tStart, W, commit: W });
        }
    } else {
        // 'rolling' (e fallback per 'global'): finestra d'asta GME MGP 13:00 (lookahead rolling 35h, commit 24h)
        // Ore 0-12 del giorno 1: i prezzi del giorno 1 sono già noti dall'asta di ieri (31/12) alle 13:00 (lookahead 24h, commit 13h)
        windows.push({ tStart: 0, W: Math.min(24, H), commit: Math.min(13, H) });
        // Dalle ore 13:00 di ogni giorno d: lookahead di 35 ore (11h rimanenti oggi + 24h domani)
        // con impegno operativo (commit) fino alle ore 13:00 di domani (24h)
        for (let d = 0; d < 365; d++) {
            const tStart = d * 24 + 13;
            if (tStart >= H) break;
            const W = Math.min(H - tStart, 35);
            const commit = Math.min(H - tStart, 24);
            windows.push({ tStart, W, commit });
        }
    }

    for (let win of windows) {
        const { tStart, W, commit } = win;
        const cpv = new Float64Array(W);
        const cgr = new Float64Array(W);
        const dgs = new Float64Array(W);
        const dgg = new Float64Array(W);
        const dppa = new Float64Array(W);
        const s = new Float64Array(W);
        const ss = new Float64Array(W);
        const sg = new Float64Array(W);

        for (let k = 0; k < W; k++) {
            ss[k] = curSs;
            sg[k] = curSg;
        }

        const surplusSol = new Float64Array(W);
        const remLoad = new Float64Array(W);
        const priceRIDArr = new Float64Array(W);
        const priceArbArr = new Float64Array(W);
        const costGridArr = new Float64Array(W);
        const pricePPA = ppaPrice / 1000;

        for (let k = 0; k < W; k++) {
            const t = tStart + k;
            const sol = solarProfile ? Math.max(0, solarProfile[t]) : 0;
            const lod = loadProfile ? Math.max(0, loadProfile[t]) : 0;
            s[k] = Math.min(sol, lod);
            surplusSol[k] = Math.max(0, sol - s[k]);
            remLoad[k] = Math.max(0, lod - s[k]);

            const pricePUN = punProfile[t];
            const month = getMonthOfHour(t);
            const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
            const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000)
                : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
                : ((pricePUN * lossMult - gseImb) / 1000);
            const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
            const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;

            priceRIDArr[k] = priceRID;
            priceArbArr[k] = priceArb;
            costGridArr[k] = costGrid;
        }

        // Generazione delle opportunità di arbitraggio e time shifting
        // Include il costo di mantenimento/opportunità orario (autoscarica, ausiliari HVAC/BMS e costo opportunità di ciclo)
        const holdingCostRate = 0.00005; // 0.05 €/MWh per ora di stoccaggio (favorisce scarica tempestiva e liberazione capacità)
        const trades = [];
        for (let tDis = 0; tDis < W; tDis++) {
            const pRidDis = priceRIDArr[tDis];
            const pPpa = pricePPA;

            // 1. Scarica su carico PPA On-Site (priorità economica su PPA)
            if (remLoad[tDis] > 0 && pPpa > 0) {
                const holdCostStored = tDis * holdingCostRate;
                trades.push({ type: 'stored_to_ppa', tCh: -1, tDis, effCost: 0, effVal: pPpa * dischargeEff, spread: pPpa * dischargeEff - holdCostStored - eps });
                for (let tCh = 0; tCh < tDis; tCh++) {
                    if (surplusSol[tCh] > 0) {
                        const effCost = priceRIDArr[tCh] / chargeSolarEff;
                        const effVal = pPpa * dischargeEff;
                        const holdCost = (tDis - tCh) * holdingCostRate;
                        if (effVal - effCost - holdCost > eps) {
                            trades.push({ type: 'solar_to_ppa', tCh, tDis, effCost, effVal, spread: effVal - effCost - holdCost - eps });
                        }
                    }
                }
            }

            // 2. Scarica Time Shifting FV su Rete (prezzo RID orario)
            const holdCostStoredGrid = tDis * holdingCostRate;
            trades.push({ type: 'stored_to_grid', tCh: -1, tDis, effCost: 0, effVal: pRidDis * dischargeEff, spread: pRidDis * dischargeEff - holdCostStoredGrid - eps });
            if (wdCap > 0) {
                trades.push({ type: 'stored_grid_to_grid', tCh: -1, tDis, effCost: 0, effVal: priceArbArr[tDis] * dischargeEff, spread: priceArbArr[tDis] * dischargeEff - holdCostStoredGrid - eps });
            }
            for (let tCh = 0; tCh < tDis; tCh++) {
                if (surplusSol[tCh] > 0) {
                    const effCost = priceRIDArr[tCh] / chargeSolarEff;
                    const effVal = pRidDis * dischargeEff;
                    const holdCost = (tDis - tCh) * holdingCostRate;
                    if (effVal - effCost - holdCost > eps) {
                        trades.push({ type: 'solar_to_grid', tCh, tDis, effCost, effVal, spread: effVal - effCost - holdCost - eps });
                    }
                }
            }

            // 3. Scarica Arbitraggio puro da Rete (solo se il prelievo da rete è abilitato: wdCap > 0)
            if (wdCap > 0) {
                for (let tCh = 0; tCh < tDis; tCh++) {
                    const effCost = costGridArr[tCh] / chargeGridEff;
                    const effVal = priceArbArr[tDis] * dischargeEff;
                    const holdCost = (tDis - tCh) * holdingCostRate;
                    if (effVal - effCost - holdCost > eps) {
                        trades.push({ type: 'grid_to_grid', tCh, tDis, effCost, effVal, spread: effVal - effCost - holdCost - eps });
                    }
                }
            }
        }

        // Priorità economica e fisica:
        // 1. Stored trades (scarica dell'energia ereditata dalla finestra precedente per liberare capacità al miglior prezzo)
        // 2. Solar trades (Time Shifting solare e PPA con priorità: costo marginale zero del fotovoltaico e vincolo ore diurne)
        // 3. Grid trades (Arbitraggio puro da rete su capacità residua non occupata dal solare, es. ciclo notturno -> mattutino)
        trades.sort((a, b) => {
            const priorityOf = (t) => {
                if (t.type.startsWith('stored_')) return 3;
                if (t.type.startsWith('solar_')) return 2;
                return 1;
            };
            const pDiff = priorityOf(b) - priorityOf(a);
            if (pDiff !== 0) return pDiff;
            return b.spread - a.spread;
        });

        const remSurplus = Float64Array.from(surplusSol);
        const remPpaLoad = Float64Array.from(remLoad);
        const remChPower = new Float64Array(W).fill(maxPower);
        const remWdCap = new Float64Array(W).fill(wdCap);
        const remDisPower = new Float64Array(W).fill(maxPower);

        let curInitSs = curSs;
        let curInitSg = curSg;

        for (let tr of trades) {
            if (tr.spread <= 0) break;
            const { type, tCh, tDis } = tr;

            if (type === 'stored_to_ppa') {
                if (remDisPower[tDis] <= 1e-4) continue;
                let maxDeliverable = Math.max(0, curInitSs - minSoc);
                for (let k = tDis; k < W; k++) maxDeliverable = Math.min(maxDeliverable, Math.max(0, ss[k] - minSoc));
                const maxKwh = Math.min(remPpaLoad[tDis], remDisPower[tDis], maxDeliverable * dischargeEff);
                if (maxKwh > 1e-4) {
                    const energyDrawn = maxKwh / dischargeEff;
                    dppa[tDis] += maxKwh;
                    remPpaLoad[tDis] -= maxKwh;
                    remDisPower[tDis] -= maxKwh;
                    remChPower[tDis] = 0;
                    curInitSs -= energyDrawn;
                    for (let k = tDis; k < W; k++) ss[k] -= energyDrawn;
                }
            } else if (type === 'stored_to_grid') {
                if (remDisPower[tDis] <= 1e-4) continue;
                let maxDeliverable = Math.max(0, curInitSs - minSoc);
                for (let k = tDis; k < W; k++) maxDeliverable = Math.min(maxDeliverable, Math.max(0, ss[k] - minSoc));
                const maxKwh = Math.min(remDisPower[tDis], maxDeliverable * dischargeEff);
                if (maxKwh > 1e-4) {
                    const energyDrawn = maxKwh / dischargeEff;
                    dgs[tDis] += maxKwh;
                    remDisPower[tDis] -= maxKwh;
                    remChPower[tDis] = 0;
                    curInitSs -= energyDrawn;
                    for (let k = tDis; k < W; k++) ss[k] -= energyDrawn;
                }
            } else if (type === 'stored_grid_to_grid') {
                if (remDisPower[tDis] <= 1e-4) continue;
                let maxDeliverable = curInitSg;
                for (let k = tDis; k < W; k++) maxDeliverable = Math.min(maxDeliverable, sg[k]);
                const maxKwh = Math.min(remDisPower[tDis], maxDeliverable * dischargeEff);
                if (maxKwh > 1e-4) {
                    const energyDrawn = maxKwh / dischargeEff;
                    dgg[tDis] += maxKwh;
                    remDisPower[tDis] -= maxKwh;
                    remChPower[tDis] = 0;
                    curInitSg -= energyDrawn;
                    for (let k = tDis; k < W; k++) sg[k] -= energyDrawn;
                }
            } else if (type === 'solar_to_ppa' || type === 'solar_to_grid') {
                if (remChPower[tCh] <= 1e-4 || remDisPower[tDis] <= 1e-4) continue;
                const maxChargeKw = Math.min(remSurplus[tCh], remChPower[tCh]);
                const maxDischargeKw = type === 'solar_to_ppa' ? Math.min(remPpaLoad[tDis], remDisPower[tDis]) : remDisPower[tDis];
                let maxHeadroom = maxSoc;
                for (let k = tCh; k < tDis; k++) {
                    const headroom = maxSoc - (ss[k] + sg[k]);
                    if (headroom < maxHeadroom) maxHeadroom = headroom;
                }
                if (maxHeadroom <= 1e-4) continue;

                const eInjectableFromCh = maxChargeKw * chargeSolarEff;
                const eInjectableFromDis = maxDischargeKw / dischargeEff;
                const deltaSoC = Math.min(eInjectableFromCh, eInjectableFromDis, maxHeadroom);

                if (deltaSoC > 1e-4) {
                    const kwCharged = deltaSoC / chargeSolarEff;
                    const kwDischarged = deltaSoC * dischargeEff;

                    cpv[tCh] += kwCharged;
                    remSurplus[tCh] -= kwCharged;
                    remChPower[tCh] -= kwCharged;
                    remDisPower[tCh] = 0;

                    if (type === 'solar_to_ppa') {
                        dppa[tDis] += kwDischarged;
                        remPpaLoad[tDis] -= kwDischarged;
                    } else {
                        dgs[tDis] += kwDischarged;
                    }
                    remDisPower[tDis] -= kwDischarged;
                    remChPower[tDis] = 0;

                    for (let k = tCh; k < tDis; k++) ss[k] += deltaSoC;
                }
            } else if (type === 'grid_to_grid') {
                if (remChPower[tCh] <= 1e-4 || remDisPower[tDis] <= 1e-4) continue;
                const maxChargeKw = Math.min(remWdCap[tCh], remChPower[tCh]);
                const maxDischargeKw = remDisPower[tDis];
                let maxHeadroom = maxSoc;
                for (let k = tCh; k < tDis; k++) {
                    const headroom = maxSoc - (ss[k] + sg[k]);
                    if (headroom < maxHeadroom) maxHeadroom = headroom;
                }
                if (maxHeadroom <= 1e-4) continue;

                const deltaSoC = Math.min(maxChargeKw * chargeGridEff, maxDischargeKw / dischargeEff, maxHeadroom);
                if (deltaSoC > 1e-4) {
                    const kwCharged = deltaSoC / chargeGridEff;
                    const kwDischarged = deltaSoC * dischargeEff;

                    cgr[tCh] += kwCharged;
                    remWdCap[tCh] -= kwCharged;
                    remChPower[tCh] -= kwCharged;
                    remDisPower[tCh] = 0;

                    dgg[tDis] += kwDischarged;
                    remDisPower[tDis] -= kwDischarged;
                    remChPower[tDis] = 0;

                    for (let k = tCh; k < tDis; k++) sg[k] += deltaSoC;
                }
            }
        }

        // Commit dei primi `commit` intervalli nella soluzione annuale
        for (let k = 0; k < commit; k++) {
            const t = tStart + k;
            const solVal = solarProfile ? Math.max(0, solarProfile[t]) : 0;
            const lodVal = loadProfile ? Math.max(0, loadProfile[t]) : 0;
            const c_pv = cpv[k];
            const c_grid = cgr[k];
            const d_gs = dgs[k];
            const d_gg = dgg[k];
            const d_ppa = dppa[k];
            const s_val = s[k];
            const d_grid = d_gs + d_gg;
            const p_fed_pv = Math.max(0, solVal - s_val - c_pv);

            const pRid = priceRIDArr[k];
            const pArb = priceArbArr[k];
            const pCostGrid = costGridArr[k];

            hourlySoC[t] = ss[k] + sg[k];
            hourlyCharge[t] = c_pv + c_grid;
            hourlyDischarge[t] = d_grid + d_ppa;
            hourlyChargeGrid[t] = c_grid;
            hourlyChargeGridNet[t] = c_grid * chargeGridEff;
            hourlyChargeSolar[t] = c_pv;
            hourlyChargeSolarNet[t] = c_pv * chargeSolarEff;
            hourlyDischargeGrid[t] = d_grid;
            hourlyDischargePpa[t] = d_ppa;
            hourlySelfConsSolar[t] = s_val;
            hourlySelfConsBess[t] = d_ppa;
            hourlySelfCons[t] = s_val + d_ppa;
            hourlyGridFeed[t] = p_fed_pv + d_grid;
            hourlyGridFeedPv[t] = p_fed_pv;
            hourlyLossesRte[t] = c_pv * (1 - chargeSolarEff) + c_grid * (1 - chargeGridEff) + (d_grid + d_ppa) * ((1 / dischargeEff) - 1);
            hourlyRevenueRidPure[t] = solVal * pRid;
            hourlyRevenueRidActual[t] = p_fed_pv * pRid;
            hourlyRevenueArbitrageGrid[t] = d_gg * pArb;
            hourlyRevenueTimeshifting[t] = d_gs * pRid;
            hourlyRevenuePpaPv[t] = s_val * pricePPA;
            hourlyRevenuePpaBess[t] = d_ppa * pricePPA;
            hourlyCostWithdrawal[t] = c_grid * pCostGrid;
            hourlyDischargeArbitrage[t] = d_gg;
            hourlyDischargeTimeshifting[t] = d_gs;
        }

        curSs = ss[commit - 1];
        curSg = sg[commit - 1];
    }

    let totalUplift = 0;
    let annualShiftedKwh = 0;
    for (let t = 0; t < H; t++) {
        totalUplift += hourlySelfCons[t] * (ppaPrice / 1000)
            + hourlyRevenueRidActual[t]
            + hourlyRevenueTimeshifting[t]
            + hourlyRevenueArbitrageGrid[t]
            - hourlyCostWithdrawal[t];
        annualShiftedKwh += hourlyDischarge[t];
    }

    return {
        hourlySoC, hourlyCharge, hourlyDischarge, hourlyGridFeed, hourlySelfCons,
        hourlyChargeGrid, hourlyChargeGridNet, hourlyChargeSolar, hourlyChargeSolarNet, hourlyDischargeGrid, hourlyDischargePpa,
        hourlySelfConsSolar, hourlySelfConsBess, hourlyLossesRte,
        hourlyGridFeedPv, hourlyRevenueRidPure, hourlyRevenueRidActual,
        hourlyRevenueArbitrageGrid, hourlyRevenuePpaPv, hourlyRevenuePpaBess,
        hourlyRevenueTimeshifting, hourlyCostWithdrawal,
        hourlyDischargeArbitrage, hourlyDischargeTimeshifting,
        totalUplift, annualShifted: annualShiftedKwh / 1000
    };
}

// Tornado deterministico: IRR al variare ± di ogni driver critico (1 variabile alla volta)
function runTornadoLoop(baseState) {
    const vars = [
        { key: 'capex', label: 'CAPEX', delta: 10 },
        { key: 'opex', label: 'OPEX', delta: 10 },
        { key: 'pun', label: 'Prezzo PUN', delta: 10 },
        { key: 'wacc', label: 'WACC', delta: 1 },
        { key: 'inflation', label: 'Inflazione', delta: 1 },
        { key: 'interestRate', label: 'Tasso Debito (Euribor+Spread)', delta: 1 }
    ];

    // IRR base
    State = deepClone(baseState);
    const baseRes = executeCalculation(deepClone(baseState));
    const baseIrr = baseRes.calculatedIrr;

    const rows = [];
    for (const v of vars) {
        const upClone = deepClone(baseState);
        applySensitivityParam(upClone, v.key, v.delta);
        State = upClone;
        const irrUp = executeCalculation(upClone).calculatedIrr;

        const downClone = deepClone(baseState);
        applySensitivityParam(downClone, v.key, -v.delta);
        State = downClone;
        const irrDown = executeCalculation(downClone).calculatedIrr;

        rows.push({ key: v.key, label: v.label, delta: v.delta, irrUp, irrDown });
    }
    // Ordina per impatto assoluto decrescente (tornado classico)
    rows.sort((a, b) => Math.abs(b.irrUp - b.irrDown) - Math.abs(a.irrUp - a.irrDown));

    return { type: 'tornado', baseIrr, rows };
}

// PRNG deterministico (mulberry32): rende il Monte Carlo riproducibile a parità
// di seed. Restituisce una funzione () -> float in [0,1).
function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Box-Muller gaussian generator (N(0,1)); rng è la fonte di casualità (seedata).
function gaussianRandom(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Monte Carlo: shock lognormale mean-preserving sul PUN + shock gaussiano sulla produzione FV.
// Restituisce percentili P10/P50/P90 e media di IRR, NPV, DSCR min/avg.
// mcConfig.seed (opzionale): seed per risultati riproducibili; default fisso.
function runMonteCarloLoop(baseState, mcConfig) {
    const nSim = Math.min(500, Math.max(10, parseInt(mcConfig.nSim) || 100));
    const sigmaPun = Math.max(0, (mcConfig.sigmaPun || 0) / 100);
    const sigmaGen = Math.max(0, (mcConfig.sigmaGen || 0) / 100);
    const seed = (mcConfig.seed !== undefined && mcConfig.seed !== null && mcConfig.seed !== '')
        ? (parseInt(mcConfig.seed) || 0) : 20260101;
    const rng = mulberry32(seed);

    const samples = { irr: [], npv: [], dscrMin: [], dscrAvg: [] };

    for (let s = 0; s < nSim; s++) {
        const stateClone = deepClone(baseState);

        // Shock prezzi: fattore lognormale con media 1 (exp(-sigma^2/2) * exp(sigma*N))
        if (sigmaPun > 0 && stateClone.zonalPun) {
            const punFactor = Math.exp(-0.5 * sigmaPun * sigmaPun + sigmaPun * gaussianRandom(rng));
            for (let zone in stateClone.zonalPun) {
                const arr = stateClone.zonalPun[zone];
                if (arr) for (let t = 0; t < arr.length; t++) arr[t] *= punFactor;
            }
        }
        // Shock produzione: gaussiano per impianto (floor 50% per evitare valori non fisici)
        if (sigmaGen > 0 && stateClone.plants) {
            stateClone.plants.forEach(pl => {
                if (!pl.generation) return;
                const genFactor = Math.max(0.5, 1 + sigmaGen * gaussianRandom(rng));
                for (let t = 0; t < pl.generation.length; t++) pl.generation[t] *= genFactor;
            });
        }

        State = stateClone;
        const res = executeCalculation(stateClone);
        samples.irr.push(res.calculatedSpvEquityIrr || res.calculatedIrr);
        samples.npv.push(res.spvEquityNpv !== undefined ? res.spvEquityNpv : res.holdcoNpv);
        samples.dscrMin.push(res.minDscr === 999 ? 0 : res.minDscr);
        samples.dscrAvg.push(res.avgDscr);
    }

    const percentile = (arr, pctl) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = (sorted.length - 1) * pctl;
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const summarize = (arr) => ({
        p10: percentile(arr, 0.10),
        p50: percentile(arr, 0.50),
        p90: percentile(arr, 0.90),
        mean: mean(arr)
    });

    return {
        type: 'montecarlo',
        nSim,
        sigmaPun: mcConfig.sigmaPun,
        sigmaGen: mcConfig.sigmaGen,
        irr: summarize(samples.irr),
        npv: summarize(samples.npv),
        dscrMin: summarize(samples.dscrMin),
        dscrAvg: summarize(samples.dscrAvg),
        irrSamples: [...samples.irr].sort((a, b) => a - b)
    };
}

function deepClone(obj) {
    return structuredClone(obj);
}

function applySensitivityParam(stateClone, varName, variation) {
    if (varName === 'none') return;
    
    switch (varName) {
        case 'capex':
            stateClone.plants.forEach(p => {
                if (p.capex) p.capex = p.capex * (1 + variation / 100);
            });
            break;
        case 'opex':
            stateClone.plants.forEach(p => {
                if (p.opex) p.opex = p.opex * (1 + variation / 100);
            });
            break;
        case 'wacc':
            stateClone.inputs.wacc = stateClone.inputs.wacc + (variation / 100);
            break;
        case 'inflation':
            stateClone.inputs.inflation = stateClone.inputs.inflation + (variation / 100);
            break;
        case 'euribor':
            // Il modello usa interestRate (Euribor + spread): un delta Euribor si trasmette 1:1 sul tasso debito
            stateClone.inputs.interestRate = (stateClone.inputs.interestRate || 0) + (variation / 100);
            break;
        case 'interestRate':
            stateClone.inputs.interestRate = (stateClone.inputs.interestRate || 0) + (variation / 100);
            break;
        case 'pd_amount':
            stateClone.inputs.pdAmountValue = Math.max(0, (stateClone.inputs.pdAmountValue || 0) * (1 + variation / 100));
            break;
        case 'pe_amount':
            stateClone.inputs.peAmountValue = Math.max(0, (stateClone.inputs.peAmountValue || 0) * (1 + variation / 100));
            break;
        case 'pun':
            if (stateClone.zonalPun) {
                for (let zone in stateClone.zonalPun) {
                    if (stateClone.zonalPun[zone]) {
                        stateClone.zonalPun[zone] = stateClone.zonalPun[zone].map(p => p * (1 + variation / 100));
                    }
                }
            }
            break;
    }
}

function runSensitivityLoop(baseState, config) {
    const { xVar, xMin, xMax, xSteps, yVar, yMin, yMax, ySteps, targetKpi } = config;
    
    function generateRange(min, max, stepSize) {
        if (stepSize <= 0) return [min];
        const res = [];
        for(let val = min; val <= max + 0.0001; val += stepSize) {
            // Keep precision clean for UI
            res.push(Number(val.toFixed(4)));
        }
        return res;
    }

    const xVals = generateRange(xMin, xMax, xSteps);
    let is2D = (yVar !== 'none');
    let yVals = is2D ? generateRange(yMin, yMax, ySteps) : [0];

    const matrix = [];
    let kpiVals = [];

    for (let i = 0; i < yVals.length; i++) {
        const row = [];
        for (let j = 0; j < xVals.length; j++) {
            let stateClone = deepClone(baseState);
            applySensitivityParam(stateClone, xVar, xVals[j]);
            if (is2D) applySensitivityParam(stateClone, yVar, yVals[i]);
            
            State = stateClone;
            const res = executeCalculation(stateClone);
            
            let val = null;
            if (targetKpi === 'irr') val = res.calculatedSpvEquityIrr || res.calculatedIrr;
            else if (targetKpi === 'npv') val = res.spvEquityNpv !== undefined ? res.spvEquityNpv : res.holdcoNpv;
            else if (targetKpi === 'dscr_min') val = res.minDscr;
            else if (targetKpi === 'dscr_avg') val = res.avgDscr;
            
            row.push(val);
            if (!is2D) kpiVals.push(val);
        }
        matrix.push(row);
    }
    
    return {
        type: is2D ? '2D' : '1D',
        xVals,
        yVals: is2D ? yVals : null,
        matrix: is2D ? matrix : null,
        kpiVals: !is2D ? kpiVals : null,
        targetKpi,
        config
    };
}

        function simulateBessHourly(solarProfile, punProfile, loadProfile, p) {
            const bessMw = p.bessMw;
            const bessMwh = p.bessMwh;
            const bessEfficiency = p.bessEfficiency;
            const bessType = p.bessType;
            const bessConnection = p.bessConnection || 'ac';
            
            const lossMult = 1 + (p.gridLosses / 100);
            const lossWithdrawMult = 1 + ((p.gridLossesWithdraw || 0) / 100);
            const gseImb = p.gseImbalance;
            const spread = p.traderSpread;
            const disp = p.traderDisp;
            const ppaPrice = p.ppaPrice || 0;
            const marketType = p.marketType || 'rid';
            const ferxTariff = p.ferxTariff !== undefined ? p.ferxTariff : 85;
            
            const hourlySoC = new Float64Array(8760);
            const hourlyCharge = new Float64Array(8760);
            const hourlyDischarge = new Float64Array(8760);
            const hourlyGridFeed = new Float64Array(8760);
            const hourlySelfCons = new Float64Array(8760);
            const hourlyChargeGrid = new Float64Array(8760);
            const hourlyChargeGridNet = new Float64Array(8760);
            const hourlyChargeSolar = new Float64Array(8760);
            const hourlyChargeSolarNet = new Float64Array(8760);
            const hourlyDischargeGrid = new Float64Array(8760);
            const hourlyDischargePpa = new Float64Array(8760);
            const hourlySelfConsSolar = new Float64Array(8760);
            const hourlySelfConsBess = new Float64Array(8760);
            const hourlyLossesRte = new Float64Array(8760);
            
            // New physical and economic arrays
            const hourlyGridFeedPv = new Float64Array(8760);
            const hourlyRevenueRidPure = new Float64Array(8760);
            const hourlyRevenueRidActual = new Float64Array(8760);
            const hourlyRevenueArbitrageGrid = new Float64Array(8760);
            const hourlyRevenuePpaPv = new Float64Array(8760);
            const hourlyRevenuePpaBess = new Float64Array(8760);
            const hourlyRevenueTimeshifting = new Float64Array(8760);
            const hourlyCostWithdrawal = new Float64Array(8760);
            const hourlyDischargeArbitrage = new Float64Array(8760);
            const hourlyDischargeTimeshifting = new Float64Array(8760);
            
            if (bessMwh === 0 || bessMw === 0 || bessType === 'none') {
                for (let t = 0; t < 8760; t++) {
                    const solar = solarProfile[t];
                    const load = loadProfile ? loadProfile[t] : 0;
                    const selfCons = Math.min(solar, load);
                    const p_fed_pv = Math.max(0, solar - load);
                    
                    const pricePUN = punProfile[t];
                    const month = getMonthOfHour(t);
                    const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) 
            : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
            : ((pricePUN * lossMult - gseImb) / 1000);
                    const pricePPA = ppaPrice / 1000;

                    hourlyGridFeed[t] = p_fed_pv;
                    hourlySelfCons[t] = selfCons;
                    hourlySelfConsSolar[t] = selfCons;
                    
                    hourlyGridFeedPv[t] = p_fed_pv;
                    hourlyRevenueRidPure[t] = solar * priceRID;
                    hourlyRevenueRidActual[t] = p_fed_pv * priceRID;
                    hourlyRevenueArbitrageGrid[t] = 0;
                    hourlyRevenuePpaPv[t] = selfCons * pricePPA;
                    hourlyRevenuePpaBess[t] = 0;
                    hourlyRevenueTimeshifting[t] = 0;
                    hourlyCostWithdrawal[t] = 0;
                    hourlyDischargeArbitrage[t] = 0;
                    hourlyDischargeTimeshifting[t] = 0;
                }
                return {
                    hourlySoC,
                    hourlyCharge,
                    hourlyDischarge,
                    hourlyGridFeed,
                    hourlySelfCons,
                    hourlyChargeGrid,
                    hourlyChargeSolar,
                    hourlyDischargeGrid,
                    hourlyDischargePpa,
                    hourlySelfConsSolar,
                    hourlySelfConsBess,
                    hourlyLossesRte,
                    hourlyGridFeedPv,
                    hourlyRevenueRidPure,
                    hourlyRevenueRidActual,
                    hourlyRevenueArbitrageGrid,
                    hourlyRevenuePpaPv,
                    hourlyRevenuePpaBess,
                    hourlyRevenueTimeshifting,
                    hourlyCostWithdrawal,
                    hourlyDischargeArbitrage,
                    hourlyDischargeTimeshifting,
                    totalUplift: 0,
                    annualShifted: 0
                };
            }
            
            let defaultRte = 0.90;
            let defaultDod = 0.90;
            if (bessType === 'graphene') { defaultRte = 0.96; defaultDod = 1.0; }
            else if (bessType === 'nmc') { defaultRte = 0.86; defaultDod = 0.85; }
            else if (bessType === 'lfp') { defaultRte = 0.90; defaultDod = 0.90; }
            let rte = (p.bessEfficiency !== undefined && p.bessEfficiency > 0) ? bessEfficiency : defaultRte;
            
            const configuredDod = (p.bessDoD && p.bessDoD > 0) ? p.bessDoD / 100 : null;
            let dod = configuredDod !== null ? configuredDod : defaultDod;
            
            // Limiti SoC: SoC Min/Max espliciti (se configurati) hanno priorità sulla banda derivata dal DoD
            const socMaxPct = (p.bessSocMax !== undefined && p.bessSocMax > 0 && p.bessSocMax <= 100) ? p.bessSocMax : 100;
            const socMinPct = (p.bessSocMin !== undefined && p.bessSocMin > 0 && p.bessSocMin < socMaxPct) ? p.bessSocMin : null;
            const maxSoc = bessMwh * 1000 * (socMaxPct / 100); // kWh
            const minSoc = (socMinPct !== null) ? (bessMwh * 1000 * (socMinPct / 100)) : maxSoc * (1 - dod);
            const maxPower = bessMw * 1000; // kW
            const wdCap = resolveGridWithdrawalCapKw(p, maxPower);
            
            const chargeSolarEff = bessConnection === 'dc' ? 0.98 : Math.sqrt(rte);
            const chargeGridEff = Math.sqrt(rte);
            const dischargeEff = Math.sqrt(rte);
            
            // Check if we need 2D DP: required when on-site PPA load exists OR when FER X differentiates solar vs grid-charged arbitrage price
            let hasOnSiteLoad = false;
            if (loadProfile) {
                for (let t = 0; t < 8760; t++) {
                    if (loadProfile[t] > 0) {
                        hasOnSiteLoad = true;
                        break;
                    }
                }
            }
            const run2D = (hasOnSiteLoad && ppaPrice > 0) || (marketType === 'fer_x' && wdCap > 0);
            
            // Pre-compute monthly averages of PUN for pun_medio contract
            const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
            const monthlyAveragePun = new Float64Array(12);
            const monthlyCounts = new Int32Array(12);
            for (let t = 0; t < 8760; t++) {
                const m = getMonthOfHour(t);
                monthlyAveragePun[m] += punProfile[t];
                monthlyCounts[m]++;
            }
            for (let m = 0; m < 12; m++) {
                if (monthlyCounts[m] > 0) {
                    monthlyAveragePun[m] /= monthlyCounts[m];
                }
            }
            
            // getMonthOfHour is now global
            let totalUplift = 0;
            let annualShiftedKwh = 0;
            
            if (!run2D) {
                // Run 1D DP
                const M = 15;
                const socLevels = new Float64Array(M + 1);
                for (let i = 0; i <= M; i++) {
                    socLevels[i] = minSoc + (i / M) * (maxSoc - minSoc);
                }
                
                const validTransitions = Array.from({ length: M + 1 }, () => []);
                const maxChgEnergy = maxPower * Math.max(chargeSolarEff, chargeGridEff);
                const maxDisEnergy = maxPower / dischargeEff;
                
                for (let i = 0; i <= M; i++) {
                    const socStart = socLevels[i];
                    for (let iNext = 0; iNext <= M; iNext++) {
                        const socEnd = socLevels[iNext];
                        const deltaSoC = socEnd - socStart;
                        if (deltaSoC > maxChgEnergy + 1e-3) continue;
                        if (-deltaSoC > maxDisEnergy + 1e-3) continue;
                        validTransitions[i].push(iNext);
                    }
                }
                
                const V = Array.from({ length: 25 }, () => new Float64Array(M + 1));
                const nextState = Array.from({ length: 24 }, () => new Int32Array(M + 1));
                const dayC_pv = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayC_grid = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayD_grid = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayReward = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                
                let currState = 0;
                let socGridVal = 0;
                
                for (let day = 0; day < 365; day++) {
                    const dayStart = day * 24;
                    
                    for (let t = 23; t >= 0; t--) {
                        const h = dayStart + t;
                        const solVal = solarProfile[h];
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000)
                            : (marketType === 'brp') ? ((pricePUN + getBrpLifetimeAvgFeeForMonth(p, month)) * lossMult / 1000)
                            : ((pricePUN * lossMult - gseImb) / 1000);
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const V_next = V[t+1];
                        const V_curr = V[t];
                        const next_state_t = nextState[t];
                        
                        const c_pv_t = dayC_pv[t];
                        const c_grid_t = dayC_grid[t];
                        const d_grid_t = dayD_grid[t];
                        const reward_t = dayReward[t];
                        
                        for (let i = 0; i <= M; i++) {
                            const socStart = socLevels[i];
                            let bestVal = -Infinity;
                            let bestNext = -1;
                            let bestC_pv = 0, bestC_grid = 0, bestD_grid = 0, bestReward = 0;
                            
                            const nextList = validTransitions[i];
                            const len = nextList.length;
                            
                            for (let k = 0; k < len; k++) {
                                const iNext = nextList[k];
                                const socEnd = socLevels[iNext];
                                const deltaSoC = socEnd - socStart;
                                
                                let c_pv = 0;
                                let c_grid = 0;
                                let d_grid = 0;
                                let reward = 0;
                                let feasible = false;
                                
                                if (deltaSoC > 0) {
                                    const E_ch = deltaSoC;
                                    const E_ch_pv = Math.min(E_ch, solVal * chargeSolarEff);
                                    const E_ch_grid = E_ch - E_ch_pv;
                                    
                                    c_pv = E_ch_pv / chargeSolarEff;
                                    c_grid = E_ch_grid / chargeGridEff;
                                    
                                    if (c_pv + c_grid <= maxPower + 1e-5 && c_grid <= wdCap + 1e-5) {
                                        feasible = true;
                                        if (c_pv > solVal) c_pv = solVal;
                                        if (c_grid > wdCap) c_grid = wdCap;
                                        const p_fed_pv = Math.max(0, solVal - c_pv);
                                        reward = p_fed_pv * priceRID - c_grid * costGrid;
                                    }
                                } else if (deltaSoC < 0) {
                                    const E_dis = -deltaSoC;
                                    d_grid = E_dis * dischargeEff;
                                    if (d_grid <= maxPower + 1e-5) {
                                        feasible = true;
                                        reward = (solVal + d_grid) * priceRID;
                                    }
                                } else {
                                    feasible = true;
                                    reward = solVal * priceRID;
                                }
                                
                                if (feasible) {
                                    const throughput = c_pv + c_grid + d_grid;
                                    const penalty = throughput * BESS_THROUGHPUT_PENALTY;
                                    const val = reward - penalty + V_next[iNext];
                                    if (val > bestVal) {
                                        bestVal = val;
                                        bestNext = iNext;
                                        bestC_pv = c_pv;
                                        bestC_grid = c_grid;
                                        bestD_grid = d_grid;
                                        bestReward = reward;
                                    }
                                }
                            }
                            
                            V_curr[i] = bestVal;
                            next_state_t[i] = bestNext;
                            c_pv_t[i] = bestC_pv;
                            c_grid_t[i] = bestC_grid;
                            d_grid_t[i] = bestD_grid;
                            reward_t[i] = bestReward;
                        }
                    }
                    
                    for (let t = 0; t < 24; t++) {
                        const h = dayStart + t;
                        const ns = nextState[t][currState];
                        
                        hourlySoC[h] = socLevels[currState];
                        const c_pv = dayC_pv[t][currState];
                        const c_grid = dayC_grid[t][currState];
                        const d_grid = dayD_grid[t][currState];
                        
                        hourlyCharge[h] = c_pv + c_grid;
                        hourlyDischarge[h] = d_grid;
                        hourlyChargeGrid[h] = c_grid;
                        hourlyChargeGridNet[h] = c_grid * chargeGridEff;
                        
                        hourlyChargeSolar[h] = c_pv;
                        hourlyChargeSolarNet[h] = c_pv * chargeSolarEff;
                        hourlyDischargeGrid[h] = d_grid;
                        hourlyDischargePpa[h] = 0;
                        hourlySelfConsSolar[h] = 0;
                        hourlySelfConsBess[h] = 0;
                        
                        const lossChgSolar = c_pv * (1 - chargeSolarEff);
                        const lossChgGrid = c_grid * (1 - chargeGridEff);
                        const lossDis = d_grid * ((1 / dischargeEff) - 1);
                        hourlyLossesRte[h] = lossChgSolar + lossChgGrid + lossDis;
                        
                        const solVal = solarProfile[h];
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) 
                            : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
                            : ((pricePUN * lossMult - gseImb) / 1000);
                        const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
                        const pricePPA = ppaPrice / 1000;
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        // Proportional grid-charged pool tracking in 1D DP (su energia utile sopra minSoc)
                        const socStart = socLevels[currState];
                        const socEnd = socLevels[ns];
                        const deltaSoC = socEnd - socStart;
                        let d_grid_from_grid = 0;
                        
                        if (deltaSoC > 0) {
                            const E_ch = deltaSoC;
                            const E_ch_pv = Math.min(E_ch, solVal * chargeSolarEff);
                            const E_ch_grid = E_ch - E_ch_pv;
                            socGridVal = Math.min(Math.max(0, socEnd - minSoc), socGridVal + E_ch_grid);
                        } else if (deltaSoC < 0) {
                            const E_dis = -deltaSoC;
                            const usableStart = Math.max(0, socStart - minSoc);
                            const fraction = usableStart > 0 ? Math.min(1, socGridVal / usableStart) : 0;
                            const E_dis_grid = Math.min(socGridVal, E_dis * fraction);
                            socGridVal = Math.max(0, socGridVal - E_dis_grid);
                            d_grid_from_grid = Math.min(d_grid, E_dis_grid * dischargeEff);
                        }
                        
                        const p_fed_pv = Math.max(0, solVal - c_pv);
                        
                        hourlyGridFeed[h] = p_fed_pv + d_grid;
                        hourlySelfCons[h] = 0;
                        
                        hourlyGridFeedPv[h] = p_fed_pv;
                        hourlyRevenueRidPure[h] = solVal * priceRID;
                        hourlyRevenueRidActual[h] = p_fed_pv * priceRID;
                        hourlyRevenueArbitrageGrid[h] = d_grid_from_grid * priceArb;
                        hourlyRevenueTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid) * priceRID;
                        hourlyRevenuePpaPv[h] = 0;
                        hourlyRevenuePpaBess[h] = 0;
                        hourlyCostWithdrawal[h] = c_grid * costGrid;
                        hourlyDischargeArbitrage[h] = d_grid_from_grid;
                        hourlyDischargeTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid);
                        
                        totalUplift += dayReward[t][currState];
                        annualShiftedKwh += d_grid;
                        
                        currState = ns;
                    }
                }
            } else {
                // Run 2D DP
                const M = 10;
                const socLevels = new Float64Array(M + 1);
                for (let i = 0; i <= M; i++) {
                    socLevels[i] = minSoc + (i / M) * (maxSoc - minSoc);
                }
                
                const numStates = (M + 1) * (M + 1);
                const stateSoc = new Float64Array(numStates);
                const stateSocGrid = new Float64Array(numStates);
                
                for (let s = 0; s < numStates; s++) {
                    const i = Math.floor(s / (M + 1));
                    const j = s % (M + 1);
                    stateSoc[s] = socLevels[i];
                    // Pool di rete limitato alla sola capacità utile sopra minSoc (evita energia "intrappolata" sotto DoD)
                    stateSocGrid[s] = (j / M) * Math.max(0, socLevels[i] - minSoc);
                }
                
                const validTransitions = Array.from({ length: numStates }, () => []);
                const maxChgEnergy = maxPower * Math.max(chargeSolarEff, chargeGridEff);
                const maxDisEnergy = maxPower / dischargeEff;
                const maxChgGridEnergy = wdCap * chargeGridEff;
                
                for (let s = 0; s < numStates; s++) {
                    const socStart = stateSoc[s];
                    const socGridStart = stateSocGrid[s];
                    
                    for (let sNext = 0; sNext < numStates; sNext++) {
                        const socEnd = stateSoc[sNext];
                        const socGridEnd = stateSocGrid[sNext];
                        const deltaSoC = socEnd - socStart;
                        const deltaSoCGrid = socGridEnd - socGridStart;
                        
                        if (deltaSoC > maxChgEnergy + 1e-3) continue;
                        if (-deltaSoC > maxDisEnergy + 1e-3) continue;
                        
                        if (deltaSoC > 0) {
                            if (deltaSoCGrid < -1e-5 || (deltaSoC - deltaSoCGrid) < -1e-5) continue;
                            if (deltaSoCGrid > maxChgGridEnergy + 1e-3) continue;
                        } else if (deltaSoC < 0) {
                            if (deltaSoCGrid > 1e-5) continue;
                            if (-deltaSoCGrid > socGridStart + 1e-5) continue;
                            if (deltaSoC - deltaSoCGrid > 1e-5) continue;
                        } else {
                            if (Math.abs(deltaSoCGrid) > 1e-5) continue;
                        }
                        
                        validTransitions[s].push(sNext);
                    }
                }
                
                const V = Array.from({ length: 25 }, () => new Float64Array(numStates));
                const nextState = Array.from({ length: 24 }, () => new Int32Array(numStates));
                
                const dayC_pv = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayC_grid = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayD_ppa = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayD_grid = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayReward = Array.from({ length: 24 }, () => new Float64Array(numStates));
                
                let currState = 0;
                
                for (let day = 0; day < 365; day++) {
                    const dayStart = day * 24;
                    
                    for (let t = 23; t >= 0; t--) {
                        const h = dayStart + t;
                        const solVal = solarProfile[h];
                        const lodVal = loadProfile ? loadProfile[h] : 0;
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        
                        const pricePPA = ppaPrice / 1000;
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) 
            : (marketType === 'brp') ? ((pricePUN + getBrpLifetimeAvgFeeForMonth(p, month)) * lossMult / 1000)
            : ((pricePUN * lossMult - gseImb) / 1000);
                        const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const V_next = V[t+1];
                        const V_curr = V[t];
                        const next_state_t = nextState[t];
                        
                        const c_pv_t = dayC_pv[t];
                        const c_grid_t = dayC_grid[t];
                        const d_ppa_t = dayD_ppa[t];
                        const d_grid_t = dayD_grid[t];
                        const reward_t = dayReward[t];
                        
                        for (let s = 0; s < numStates; s++) {
                            const socStart = stateSoc[s];
                            const socGridStart = stateSocGrid[s];
                            
                            let bestVal = -Infinity;
                            let bestNext = -1;
                            let bestC_pv = 0, bestC_grid = 0, bestD_ppa = 0, bestD_grid = 0, bestReward = 0;
                            
                            const nextList = validTransitions[s];
                            const len = nextList.length;
                            
                            for (let k = 0; k < len; k++) {
                                const sNext = nextList[k];
                                const socEnd = stateSoc[sNext];
                                const socGridEnd = stateSocGrid[sNext];
                                
                                const deltaSoC = socEnd - socStart;
                                const deltaSoCGrid = socGridEnd - socGridStart;
                                
                                let c_pv = 0;
                                let c_grid = 0;
                                let d_ppa = 0;
                                let d_grid = 0;
                                let reward = 0;
                                let feasible = false;
                                
                                if (deltaSoC > 0) {
                                    const E_ch_grid = deltaSoCGrid > 0 ? deltaSoCGrid : 0;
                                    const E_ch_pv = deltaSoC - E_ch_grid > 0 ? deltaSoC - E_ch_grid : 0;
                                    
                                    c_grid = E_ch_grid / chargeGridEff;
                                    c_pv = E_ch_pv / chargeSolarEff;
                                    
                                    if (c_grid + c_pv <= maxPower + 1e-5 && c_grid <= wdCap + 1e-5 && c_pv <= solVal + 1e-5) {
                                        feasible = true;
                                        if (c_pv > solVal) c_pv = solVal;
                                        if (c_grid > wdCap) c_grid = wdCap;
                                        const p_self_pv = solVal - c_pv < lodVal ? solVal - c_pv : lodVal;
                                        const p_fed_pv = solVal - c_pv - lodVal > 0 ? solVal - c_pv - lodVal : 0;
                                        reward = p_self_pv * pricePPA + p_fed_pv * priceRID - c_grid * costGrid;
                                    }
                                } else if (deltaSoC < 0) {
                                    const E_dis = -deltaSoC;
                                    const E_dis_grid = -deltaSoCGrid;
                                    const E_dis_pv = E_dis - E_dis_grid > 0 ? E_dis - E_dis_grid : 0;
                                    
                                    const p_dis_delivered = E_dis * dischargeEff;
                                    const p_dis_ppa_max = E_dis_pv * dischargeEff;
                                    
                                    const p_self_pv = solVal < lodVal ? solVal : lodVal;
                                    const p_fed_pv = solVal - lodVal > 0 ? solVal - lodVal : 0;
                                    
                                    d_ppa = lodVal - p_self_pv < p_dis_ppa_max ? lodVal - p_self_pv : p_dis_ppa_max;
                                    d_grid = p_dis_delivered - d_ppa > 0 ? p_dis_delivered - d_ppa : 0;
                                    const d_grid_arb = Math.min(d_grid, E_dis_grid * dischargeEff);
                                    const d_grid_ts = Math.max(0, d_grid - d_grid_arb);
                                    
                                    if (d_ppa + d_grid <= maxPower + 1e-5) {
                                        feasible = true;
                                        reward = (p_self_pv + d_ppa) * pricePPA + (p_fed_pv + d_grid_ts) * priceRID + d_grid_arb * priceArb;
                                    }
                                } else {
                                    feasible = true;
                                    const p_self_pv = solVal < lodVal ? solVal : lodVal;
                                    const p_fed_pv = solVal - lodVal > 0 ? solVal - lodVal : 0;
                                    reward = p_self_pv * pricePPA + p_fed_pv * priceRID;
                                }
                                
                                if (feasible) {
                                    const throughput = c_pv + c_grid + d_ppa + d_grid;
                                    const penalty = throughput * BESS_THROUGHPUT_PENALTY;
                                    const val = reward - penalty + V_next[sNext];
                                    if (val > bestVal) {
                                        bestVal = val;
                                        bestNext = sNext;
                                        bestC_pv = c_pv;
                                        bestC_grid = c_grid;
                                        bestD_ppa = d_ppa;
                                        bestD_grid = d_grid;
                                        bestReward = reward;
                                    }
                                }
                            }
                            
                            V_curr[s] = bestVal;
                            next_state_t[s] = bestNext;
                            c_pv_t[s] = bestC_pv;
                            c_grid_t[s] = bestC_grid;
                            d_ppa_t[s] = bestD_ppa;
                            d_grid_t[s] = bestD_grid;
                            reward_t[s] = bestReward;
                        }
                    }
                    
                    for (let t = 0; t < 24; t++) {
                        const h = dayStart + t;
                        const ns = nextState[t][currState];
                        
                        hourlySoC[h] = stateSoc[currState];
                        const c_pv = dayC_pv[t][currState];
                        const c_grid = dayC_grid[t][currState];
                        const d_ppa = dayD_ppa[t][currState];
                        const d_grid = dayD_grid[t][currState];
                        
                        hourlyCharge[h] = c_pv + c_grid;
                        hourlyDischarge[h] = d_ppa + d_grid;
                        hourlyChargeGrid[h] = c_grid;
                        hourlyChargeGridNet[h] = c_grid * chargeGridEff;
                        
                        hourlyChargeSolar[h] = c_pv;
                        hourlyChargeSolarNet[h] = c_pv * chargeSolarEff;
                        hourlyDischargeGrid[h] = d_grid;
                        hourlyDischargePpa[h] = d_ppa;
                        
                        const solVal = solarProfile[h];
                        const lodVal = loadProfile ? loadProfile[h] : 0;
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) 
                            : (marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(p, 1, month)) * lossMult / 1000)
                            : ((pricePUN * lossMult - gseImb) / 1000);
                        const priceArb = arbitragePriceKwh(marketType, pricePUN, lossMult, priceRID);
                        const pricePPA = ppaPrice / 1000;
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const p_self_pv = solVal - c_pv < lodVal ? solVal - c_pv : lodVal;
                        const p_fed_pv = solVal - c_pv - lodVal > 0 ? solVal - c_pv - lodVal : 0;
                        
                        const socStart = stateSoc[currState];
                        const socGridStart = stateSocGrid[currState];
                        const socEnd = stateSoc[ns];
                        const socGridEnd = stateSocGrid[ns];
                        
                        const deltaSoC = socEnd - socStart;
                        const deltaSoCGrid = socGridEnd - socGridStart;
                        
                        let d_grid_from_grid = 0;
                        if (deltaSoC < 0 && deltaSoCGrid < 0) {
                            d_grid_from_grid = Math.min(d_grid, -deltaSoCGrid * dischargeEff);
                        }
                        
                        hourlySelfConsSolar[h] = p_self_pv;
                        hourlySelfConsBess[h] = d_ppa;
                        
                        const lossChgSolar = c_pv * (1 - chargeSolarEff);
                        const lossChgGrid = c_grid * (1 - chargeGridEff);
                        const lossDis = (d_ppa + d_grid) * ((1 / dischargeEff) - 1);
                        hourlyLossesRte[h] = lossChgSolar + lossChgGrid + lossDis;
                        
                        hourlySelfCons[h] = p_self_pv + d_ppa;
                        hourlyGridFeed[h] = p_fed_pv + d_grid;
                        
                        hourlyGridFeedPv[h] = p_fed_pv;
                        hourlyRevenueRidPure[h] = solVal * priceRID;
                        hourlyRevenueRidActual[h] = p_fed_pv * priceRID;
                        hourlyRevenueArbitrageGrid[h] = d_grid_from_grid * priceArb;
                        hourlyRevenueTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid) * priceRID;
                        hourlyRevenuePpaPv[h] = p_self_pv * pricePPA;
                        hourlyRevenuePpaBess[h] = d_ppa * pricePPA;
                        hourlyCostWithdrawal[h] = c_grid * costGrid;
                        hourlyDischargeArbitrage[h] = d_grid_from_grid;
                        hourlyDischargeTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid);
                        
                        totalUplift += dayReward[t][currState];
                        annualShiftedKwh += d_ppa + d_grid;
                        
                        currState = ns;
                    }
                }
            }
            
            return {
                hourlySoC,
                hourlyCharge,
                hourlyDischarge,
                hourlyGridFeed,
                hourlySelfCons,
                hourlyChargeGrid,
                hourlyChargeGridNet,
                hourlyChargeSolar,
                hourlyChargeSolarNet,
                hourlyDischargeGrid,
                hourlyDischargePpa,
                hourlySelfConsSolar,
                hourlySelfConsBess,
                hourlyLossesRte,
                hourlyGridFeedPv,
                hourlyRevenueRidPure,
                hourlyRevenueRidActual,
                hourlyRevenueArbitrageGrid,
                hourlyRevenuePpaPv,
                hourlyRevenuePpaBess,
                hourlyRevenueTimeshifting,
                hourlyCostWithdrawal,
                hourlyDischargeArbitrage,
                hourlyDischargeTimeshifting,
                totalUplift,
                annualShifted: annualShiftedKwh / 1000
            };
        }

        function classifyOpexLabel(label) {
            const l = (label || '').toLowerCase().trim();
            if (l.includes('bess') || l.includes('batteri')) return 'opexBess';
            if (l.includes('assicura') || l.includes('insurance') || l.includes('all risk')) return 'opexInsurance';
            if (l.includes('imu') || l.includes('tass') || l.includes('tasi') || l.includes('imposte local')) return 'opexTaxes';
            if (l.includes('sicurez') || l.includes('security') || l.includes('vigil')) return 'opexSecurity';
            if (l.includes('asset') || l.includes('gestione amm') || l.includes('amministra')) return 'opexAssetManagement';
            if (l.includes('dds') || l.includes('canone') || l.includes('terren') || l.includes('affitto')) return 'landDdsAnnuo';
            if (l.includes('o&m') || l.includes('om ') || l.includes('manutenz') || l.includes('impiant')) return 'opexPlants';
            return 'opexPlants';
        }

        function executeCalculation(State) {
            const p = State.inputs;

            // ── Fiscal & financial defaults (sanity fallback se i parametri mancano nel DB) ──
            // Default applicati SOLO se il parametro manca (DB legacy) o è NaN; uno 0% esplicito è rispettato
            if (typeof p.iresRate !== 'number' || isNaN(p.iresRate)) p.iresRate = 0.24;   // IRES 24%
            if (typeof p.irapRate !== 'number' || isNaN(p.irapRate)) p.irapRate = 0.039;  // IRAP 3.9%
            if (typeof p.wacc !== 'number' || isNaN(p.wacc)) p.wacc = 0.06;
            if (typeof p.keVal !== 'number' || isNaN(p.keVal)) p.keVal = 0.08;
            if (typeof p.inflation !== 'number' || isNaN(p.inflation)) p.inflation = 0.02;
            if (typeof p.interestRate !== 'number' || isNaN(p.interestRate)) p.interestRate = 0;
            p.leverage = Math.min(0.95, Math.max(0, (typeof p.leverage === 'number' && !isNaN(p.leverage)) ? p.leverage : 0));

            // 1. Build Combined Generation Profile & Portafoglio Weighted PUN
            const combinedSolarProfile = new Float64Array(8760);
            const portfolioWeightedPunProfile = new Float64Array(8760);
            
            const consolidatedHourlyCharge = new Float64Array(8760);
            const consolidatedHourlyDischarge = new Float64Array(8760);
            const consolidatedHourlySoC = new Float64Array(8760);
            const consolidatedHourlyGridFeed = new Float64Array(8760);
            const consolidatedHourlySelfCons = new Float64Array(8760);
            const consolidatedHourlyChargeGrid = new Float64Array(8760);
            const consolidatedHourlyChargeGridNet = new Float64Array(8760);
            const consolidatedHourlyChargeSolar = new Float64Array(8760);
            const consolidatedHourlyChargeSolarNet = new Float64Array(8760);
            const consolidatedHourlyDischargeGrid = new Float64Array(8760);
            const consolidatedHourlyDischargeGridArb = new Float64Array(8760);
            const consolidatedHourlyDischargeGridTs = new Float64Array(8760);
            const consolidatedHourlyDischargePpa = new Float64Array(8760);
            const consolidatedHourlySelfConsSolar = new Float64Array(8760);
            const consolidatedHourlySelfConsBess = new Float64Array(8760);
            const consolidatedHourlyLossesRte = new Float64Array(8760);
            
            const consolidatedHourlyGridFeedPv = new Float64Array(8760);
            const consolidatedHourlyRevenueRidPure = new Float64Array(8760);
            const consolidatedHourlyRevenueRidActual = new Float64Array(8760);
            const consolidatedHourlyRevenueArbitrageGrid = new Float64Array(8760);
            const consolidatedHourlyRevenuePpaPv = new Float64Array(8760);
            const consolidatedHourlyRevenuePpaBess = new Float64Array(8760);
            const consolidatedHourlyRevenueTimeshifting = new Float64Array(8760);
            const consolidatedHourlyCostWithdrawal = new Float64Array(8760);
            
            let totalArbitrageUpliftY1 = 0;
            let totalBessCAPEX = 0;
            let totalBessLossesMwh = 0;
            let totalShiftedMwh = 0;
            let totalBessMw = 0;
            let totalBessMwh = 0;

            let totalEpcCapex = 0;
            let totalConnectionCapex = 0;
            let totalLandPurchaseCapex = 0;
            let totalLandDdsAttualizzatoCapex = 0;
            let totalLandDdsAnnuo = 0;
            let totalDevelopmentCapex = 0;
            let totalSpvAcquisitionCapex = 0;
            let totalOpexPlants = 0;
            let totalOpexInsurance = 0;
            let totalOpexTaxes = 0;
            let totalOpexSecurity = 0;
            let totalOpexAssetManagement = 0;
            let totalCustomCapex = 0;
            let totalCustomOpex = 0;

            // ── No plants loaded: zero out all results and return early ──
            if (State.plants.length === 0) {
                return buildZeroResults();
            }
            // Only process plants that are enabled (default: true if undefined)
            const activePlants = State.plants.filter(p => p.enabled !== false);

            // If all plants are disabled, zero out and return
            if (activePlants.length === 0) {
                return buildZeroResults();
            }

            const activeStabilimenti = State.stabilimenti.filter(s => s.enabled !== false);
            const capexBreakdown = [];
            const opexBreakdown = [];

            // ── CF13: Riduzione PUN Zonale (%) applicata a tutti i calcoli orari ──
            const punDiscountPct = (State.inputs && State.inputs.punDiscountPct !== undefined) ? Number(State.inputs.punDiscountPct) : 0;
            const punDiscountMult = Math.max(0, 1 - (punDiscountPct / 100));
            const rawZonalPun = State.zonalPun || {};
            const effectiveZonalPun = {};
            Object.keys(rawZonalPun).forEach(z => {
                const raw = rawZonalPun[z];
                if (raw) {
                    if (punDiscountMult !== 1.0) {
                        const scaled = new Float64Array(8760);
                        for (let t = 0; t < 8760; t++) scaled[t] = raw[t] * punDiscountMult;
                        effectiveZonalPun[z] = scaled;
                    } else {
                        effectiveZonalPun[z] = raw;
                    }
                }
            });

            activePlants.forEach(plant => {
                const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                const plantBessEfficiency = plant.bessEfficiency !== undefined ? plant.bessEfficiency : 0.90;
                const plantBessDegradation = plant.bessDegradation !== undefined ? plant.bessDegradation : 0.018;
                const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                const plantBessType = plant.bessType || 'none';
                const plantBessConnection = plant.bessConnection || 'ac';

                // Apply plant production multiplier to raw generation without in-place compounding
                if (!plant._rawGeneration && plant.generation) {
                    plant._rawGeneration = plant.generation;
                }
                const rawGen = plant._rawGeneration || plant.generation;
                const mult = (plant.prodMultiplier !== undefined && plant.prodMultiplier !== null) 
                    ? Number(plant.prodMultiplier) 
                    : ((plant.prod_multiplier !== undefined && plant.prod_multiplier !== null) ? Number(plant.prod_multiplier) : 1.0);
                if (rawGen) {
                    if (mult !== 1.0) {
                        const scaledGen = new Float64Array(8760);
                        for (let t = 0; t < 8760; t++) scaledGen[t] = (rawGen[t] || 0) * mult;
                        plant.generation = scaledGen;
                    } else if (plant.generation !== rawGen) {
                        plant.generation = rawGen;
                    }
                }

                // Precompute annual solar production (MWh)
                plant.annualSolarProductionMWh = plant.generation ? (plant.generation.reduce((a, b) => a + b, 0) / 1000) : 0;

                const plantBessCAPEX = plantBessMwh * 1000 * plantBessCapexKwh;
                totalBessCAPEX += plantBessCAPEX;
                totalBessMw += plantBessMw;
                totalBessMwh += plantBessMwh;

                // Accumulate other non-storage costs
                totalEpcCapex += (plant.capacity * plant.capex);
                totalOpexPlants += (plant.opex || 0) + (plant.customOpexEur || 0);
                totalOpexInsurance += (plant.opexInsurance || 0);
                totalOpexTaxes += (plant.opexTaxes || 0);
                totalOpexSecurity += (plant.opexSecurity || 0);
                totalOpexAssetManagement += (plant.opexAssetManagement || 0);
                totalConnectionCapex += (plant.connectionCost || 0);
                totalDevelopmentCapex += (plant.developmentCost || 0);
                totalSpvAcquisitionCapex += (plant.spvAcquisitionCost || 0);
                // CF7: voci CAPEX/OPEX personalizzate
                totalCustomCapex += (plant.customCapexEur || 0);
                totalCustomOpex += (plant.customOpexEur || 0);
                
                const landType = plant.landType || 'acquisto';
                const landCost = plant.landCost || 0;
                let plantLandPurchase = 0, plantLandDdsAttualizzato = 0, plantLandDdsAnnuo = 0;
                if (landType === 'acquisto') {
                    plantLandPurchase = landCost;
                    totalLandPurchaseCapex += landCost;
                } else if (landType === 'dds_attualizzato') {
                    plantLandDdsAttualizzato = landCost;
                    totalLandDdsAttualizzatoCapex += landCost;
                } else if (landType === 'dds_annuo') {
                    plantLandDdsAnnuo = landCost;
                    totalLandDdsAnnuo += landCost;
                }
                
                const plantEpcCapex = plant.capacity * plant.capex;
                const plantConnectionCapex = plant.connectionCost || 0;
                const plantDevelopmentCapex = plant.developmentCost || 0;
                const plantSpvAcquisitionCapex = plant.spvAcquisitionCost || 0;
                
                capexBreakdown.push({
                    name: plant.name, capacity: plant.capacity,
                    solarCapex: plantEpcCapex, bessCapex: plantBessCAPEX,
                    connectionCapex: plantConnectionCapex, developmentCapex: plantDevelopmentCapex,
                    spvAcquisitionCapex: plantSpvAcquisitionCapex,
                    landPurchaseCapex: plantLandPurchase, landDdsAttualizzatoCapex: plantLandDdsAttualizzato,
                    customCapex: plant.customCapexEur || 0,
                    totalCapex: plantEpcCapex + plantBessCAPEX + plantConnectionCapex + plantDevelopmentCapex + plantSpvAcquisitionCapex + plantLandPurchase + plantLandDdsAttualizzato + (plant.customCapexEur || 0)
                });
                opexBreakdown.push({
                    name: plant.name, capacity: plant.capacity,
                    bessMwh: plantBessMwh, bessMw: plantBessMw, bessType: plantBessType,
                    customOpex: plant.customOpexEur || 0,
                    years: []
                });
                plant._remainingCivilBase = plantEpcCapex + plantBessCAPEX + plantConnectionCapex + plantDevelopmentCapex + plantLandDdsAttualizzato + (plant.customCapexEur || 0);
                plant._remainingBessAug = 0;

                // Link plant to its active stabilimento
                const stab = activeStabilimenti.find(s => s.plantId === plant.id);
                plant._stab = stab || null;
                const loadProfile = (stab && stab.ppaType === 'on-site' && stab.load) ? stab.load : null;
                const ppaPrice = (stab && stab.ppaPrice !== undefined) ? stab.ppaPrice : 0;

                // Run BESS simulation for this plant
                const plantGeneration = plant.generation || new Float64Array(8760);
                const plantZonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                const bessParams = {
                    bessMw: plantBessMw,
                    bessMwh: plantBessMwh,
                    bessEfficiency: plantBessEfficiency,
                    bessDegradation: plantBessDegradation,
                    bessCapexKwh: plantBessCapexKwh,
                    bessType: plantBessType,
                    bessConnection: plantBessConnection,
                    bessDoD: plant.bessDoD || 0,
                    bessSocMin: plant.bessSocMin || 0,
                    bessSocMax: plant.bessSocMax || 0,
                    traderContractType: plant.traderContractType || 'pun_orario',
                    traderSpread: plant.traderSpread || 0,
                    traderDisp: plant.traderDisp || 0,
                    marketType: plant.marketType || 'rid',
                    ferxTariff: plant.ferxTariff !== undefined ? plant.ferxTariff : 85,
                    brpFee1: plant.brpFee1,
                    brpFee1Months: plant.brpFee1Months,
                    brpFee2: plant.brpFee2,
                    brpFee2Months: plant.brpFee2Months,
                    brpFee3: plant.brpFee3,
                    gridLosses: resolveGridLosses(plant.gridVoltage, 'inject'),
                    gridLossesWithdraw: resolveGridLosses(plant.gridVoltage, 'withdraw'),
                    gridWithdrawalKw: plant.gridWithdrawalKw,
                    gseImbalance: State.inputs.ridImbalanceCost || 0,
                    ppaPrice: ppaPrice
                };
                // Motore Ottimizzazione BESS (Rolling GME 13:00, Daily Continuo, LP Globale HiGHS, DP Giornaliera)
                let plantSim = null;
                const optMode = State.inputs.bessOptimizer || 'dp';
                const hasBess = plantBessMwh > 0 && plantBessMw > 0 && plantBessType !== 'none';
                if (hasBess) {
                    if (optMode === 'lp' && highsSolver) {
                        try {
                            plantSim = simulateBessLP(plantGeneration, plantZonePrices, loadProfile, bessParams);
                        } catch (lpErr) {
                            console.warn('[Worker] LP HiGHS fallita per impianto ' + plant.name + ', fallback continuo globale:', lpErr.message);
                            try {
                                plantSim = simulateBessContinuous(plantGeneration, plantZonePrices, loadProfile, bessParams, 'global');
                            } catch (e2) {
                                plantSim = null;
                            }
                        }
                    } else if (optMode === 'rolling' || optMode === 'daily' || optMode === 'lp') {
                        try {
                            const contMode = optMode === 'daily' ? 'daily' : (optMode === 'lp' ? 'global' : 'rolling');
                            plantSim = simulateBessContinuous(plantGeneration, plantZonePrices, loadProfile, bessParams, contMode);
                        } catch (contErr) {
                            console.warn('[Worker] Continuous BESS fallita per impianto ' + plant.name + ', fallback DP:', contErr.message);
                            plantSim = null;
                        }
                    }
                }
                if (!plantSim) plantSim = simulateBessHourly(plantGeneration, plantZonePrices, loadProfile, bessParams);

                plant.sim = plantSim;
                
                if (!plantSim.hourlySelfConsBessArb) plantSim.hourlySelfConsBessArb = new Float64Array(8760);
                if (!plantSim.hourlySelfConsBessTs) plantSim.hourlySelfConsBessTs = new Float64Array(8760);
                if (!plantSim.hourlyRevenuePpaBessArb) plantSim.hourlyRevenuePpaBessArb = new Float64Array(8760);
                if (!plantSim.hourlyRevenuePpaBessTs) plantSim.hourlyRevenuePpaBessTs = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentivePv) plantSim.hourlyCerGseIncentivePv = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBessArb) plantSim.hourlyCerGseIncentiveBessArb = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBessTs) plantSim.hourlyCerGseIncentiveBessTs = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBess) plantSim.hourlyCerGseIncentiveBess = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentive) plantSim.hourlyCerGseIncentive = new Float64Array(8760);

                totalShiftedMwh += plantSim.annualShifted;
                totalBessLossesMwh += plantSim.annualShifted * (1 - plantBessEfficiency);

                // Pre-compute hourly revenues and energy components for decoupled cash flows
                let solarPpaRevY1 = 0;
                let solarRidRevY1 = 0;
                let bessPpaRevY1 = 0;
                let bessRidRevY1 = 0;
                let bessPpaRevArbY1 = 0;
                let bessPpaRevTsY1 = 0;
                let bessGridChargingCostY1 = 0;
                let timeshiftingRevY1 = 0;
                let arbitrageRevY1 = 0;
                let arbitrageCostY1 = 0;

                let solarSelfConsMwhY1 = 0;
                let solarGridFeedMwhY1 = 0;
                let bessSelfConsMwhY1 = 0;
                let bessSelfConsArbMwhY1 = 0;
                let bessSelfConsTsMwhY1 = 0;
                let bessGridFeedMwhY1 = 0;

                const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                const lossInject = resolveGridLosses(plant.gridVoltage, 'inject');
                const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');
                const lossMult = 1 + (lossInject / 100);
                const gseImb = State.inputs.ridImbalanceCost || 0;
                const spread = plant.traderSpread || 0;
                const disp = plant.traderDisp || 0;

                // Monthly average PUN for monthly average contract
                const monthlyAveragePun = new Float64Array(12);
                const monthlyCounts = new Int32Array(12);
                for (let t = 0; t < 8760; t++) {
                    const m = getMonthOfHour(t);
                    monthlyAveragePun[m] += zonePrices[t];
                    monthlyCounts[m]++;
                }
                for (let m = 0; m < 12; m++) {
                    if (monthlyCounts[m] > 0) {
                        monthlyAveragePun[m] /= monthlyCounts[m];
                    }
                }
                plant._monthlyAveragePun = monthlyAveragePun;

                for (let t = 0; t < 8760; t++) {
                    const solar = plantGeneration[t];
                    const load = loadProfile ? loadProfile[t] : 0;
                    const pricePUN = zonePrices[t];
                    const month = getMonthOfHour(t);
                    const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                    
                    const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) 
                        : (plant.marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(plant, typeof yr !== 'undefined' ? yr : 1, getMonthOfHour(t))) * lossMult / 1000)
                        : ((pricePUN * lossMult - gseImb) / 1000);
                    const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;

                    // Baseline solar flows (without BESS)
                    const baseSolarPpa = loadProfile ? Math.min(solar, load) : 0;
                    const baseSolarRid = loadProfile ? Math.max(0, solar - load) : solar;

                    // Actual flows with BESS
                    const actualPpa = plantSim.hourlySelfCons[t];
                    const actualRid = plantSim.hourlyGridFeed[t];
                    const gridCharge = plantSim.hourlyChargeGrid[t];

                    solarPpaRevY1 += baseSolarPpa * (ppaPrice / 1000);
                    
                    const chargeSolar = plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0;
                    const actualSolarGridFeed = Math.max(0, solar - baseSolarPpa - chargeSolar);
                    solarRidRevY1 += actualSolarGridFeed * priceRID;

                    bessPpaRevY1 += (actualPpa - baseSolarPpa) * (ppaPrice / 1000);
                    timeshiftingRevY1 += plantSim.hourlyRevenueTimeshifting[t] || 0;
                    arbitrageRevY1 += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                    arbitrageCostY1 += plantSim.hourlyCostWithdrawal[t] || 0;
                    bessRidRevY1 = timeshiftingRevY1 + arbitrageRevY1; // Consolidated BESS RID revenue
                    bessGridChargingCostY1 += gridCharge * costGrid;

                    solarSelfConsMwhY1 += baseSolarPpa / 1000;
                    solarGridFeedMwhY1 += actualSolarGridFeed / 1000;
                    bessSelfConsMwhY1 += (actualPpa - baseSolarPpa) / 1000;
                    bessGridFeedMwhY1 += Math.max(0, actualRid - actualSolarGridFeed) / 1000;
                }

                // If virtual off-site PPA: virtual contract on full solar production, PPA price replaces PUN
                if (stab && stab.ppaType === 'off-site') {
                    solarPpaRevY1 = plant.annualSolarProductionMWh * stab.ppaPrice;
                    solarRidRevY1 = 0;
                    bessPpaRevY1 = 0;
                    bessRidRevY1 = 0;
                    arbitrageRevY1 = 0;
                    arbitrageCostY1 = 0;
                    for (let t = 0; t < 8760; t++) {
                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) 
                            : (plant.marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(plant, typeof yr !== 'undefined' ? yr : 1, getMonthOfHour(t))) * lossMult / 1000)
                            : ((pricePUN * lossMult - gseImb) / 1000);
                        const actualRid = plantSim.hourlyGridFeed[t];
                        bessRidRevY1 += (actualRid - plant.generation[t]) * priceRID;
                        arbitrageRevY1 += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                        arbitrageCostY1 += plantSim.hourlyCostWithdrawal[t] || 0;
                    }
                    timeshiftingRevY1 = bessRidRevY1 - arbitrageRevY1;
                    bessGridChargingCostY1 = arbitrageCostY1;
                    solarSelfConsMwhY1 = plant.annualSolarProductionMWh;
                    solarGridFeedMwhY1 = 0;
                    bessSelfConsMwhY1 = 0;
                    bessGridFeedMwhY1 = plantSim.hourlyDischargeGrid.reduce((a, b) => a + b, 0) / 1000;
                } else if (stab && stab.ppaType === 'cer') {
                    solarPpaRevY1 = 0;
                    bessPpaRevY1 = 0;
                    solarSelfConsMwhY1 = 0;
                    bessSelfConsMwhY1 = 0;
                    solarRidRevY1 = 0;
                    bessRidRevY1 = 0;
                    timeshiftingRevY1 = 0;
                    arbitrageRevY1 = 0;
                    arbitrageCostY1 = 0;
                    bessGridChargingCostY1 = 0;
                    solarGridFeedMwhY1 = 0;
                    bessGridFeedMwhY1 = 0;

                    const cerShareType = stab.cerShareType || 'shared_energy';

                    // Determine CER tariff size parameters based on plant capacity (kWp)
                    let fissa = 0;
                    let cap = 0;
                    if (plant.capacity <= 20) {
                        fissa = State.inputs.cerFissaSmall;
                        cap = State.inputs.cerCapSmall;
                    } else if (plant.capacity <= 200) {
                        fissa = State.inputs.cerFissaMedium;
                        cap = State.inputs.cerCapMedium;
                    } else {
                        fissa = State.inputs.cerFissaLarge;
                        cap = State.inputs.cerCapLarge;
                    }

                    // Geographic correction
                    let geoCorr = 0;
                    const zoneUpper = String(plant.zone).toUpperCase();
                    if (zoneUpper === 'NORD') {
                        geoCorr = State.inputs.cerGeoNord;
                    } else if (zoneUpper === 'CNOR') {
                        geoCorr = State.inputs.cerGeoCentro;
                    } else {
                        geoCorr = State.inputs.cerGeoSud;
                    }

                    // PNRR reduction factor
                    const pnrrPct = plant.pnrrContributionPct || 0;
                    const decurtazioneF = 0.5 * (pnrrPct / 40);
                    const factorPNRR = 1 - decurtazioneF;

                    const cerTras = State.inputs.cerTras;
                    const cPR = resolveGridLosses(plant.gridVoltage, 'cpr') / 100;
                    const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');

                    for (let t = 0; t < 8760; t++) {
                        const solar = plant.generation[t];
                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) 
                            : (plant.marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(plant, typeof yr !== 'undefined' ? yr : 1, getMonthOfHour(t))) * lossMult / 1000)
                            : ((pricePUN * lossMult - gseImb) / 1000);
                        const month = getMonthOfHour(t);
                        const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;

                        const actualRid = plantSim.hourlyGridFeed[t];
                        const chargeSolar = plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0;
                        const gridCharge = plantSim.hourlyChargeGrid[t];

                        const actualSolarGridFeed = Math.max(0, solar - chargeSolar);
                        const actualBessGridFeed = Math.max(0, actualRid - actualSolarGridFeed);

                        // 1. RID Revenues
                        solarRidRevY1 += actualSolarGridFeed * priceRID;
                        
                        const hourlyArb = plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                        const hourlyTs = plantSim.hourlyRevenueTimeshifting[t] || 0;
                        arbitrageRevY1 += hourlyArb;
                        timeshiftingRevY1 += hourlyTs;
                        arbitrageCostY1 += (plantSim.hourlyCostWithdrawal[t] || 0);
                        bessRidRevY1 += (hourlyArb + hourlyTs);
                        bessGridChargingCostY1 += gridCharge * costGrid;

                        // Quantities in MWh
                        solarGridFeedMwhY1 += actualSolarGridFeed / 1000;
                        bessGridFeedMwhY1 += actualBessGridFeed / 1000;

                        // 2. CER Shared Energy (GSE)
                        const cerLoad = (stab.load && stab.load[t] !== undefined) ? stab.load[t] : 0;
                        const eSharedGse = Math.min(actualRid, cerLoad);

                        // Dynamic hourly price for CER shared energy (GSE incentive)
                        const cacv_t = cerTras + cPR * pricePUN;
                        const variablePortion = Math.min(State.inputs.cerVarMax, Math.max(0, State.inputs.cerVarReferencePrice - pricePUN));
                        const tip_t = Math.min(cap, fissa + variablePortion + geoCorr) * factorPNRR;
                        const priceCER_MWh = cacv_t + tip_t;
                        const priceCER_kWh = priceCER_MWh / 1000;

                        // Calculate BESS discharge split
                        const hourlyArbPhys = (plantSim.hourlyDischargeArbitrage ? plantSim.hourlyDischargeArbitrage[t] : 0);
                        const hourlyTsPhys = (plantSim.hourlyDischargeTimeshifting ? plantSim.hourlyDischargeTimeshifting[t] : 0);
                        const actualRenewableRid = actualSolarGridFeed + hourlyTsPhys;

                        // Priority-based shared energy allocation: Prioritize Renewable (Solar + BESS Timeshifting) over Arbitrage
                        const eSharedGseRenewable = Math.min(actualRenewableRid, cerLoad);
                        const eSharedGseBessArb = Math.min(hourlyArbPhys, eSharedGse - eSharedGseRenewable);

                        let eSharedGseSolar = 0;
                        let eSharedGseBessTs = 0;
                        if (actualRenewableRid > 0) {
                            const fSolarRen = actualSolarGridFeed / actualRenewableRid;
                            eSharedGseSolar = eSharedGseRenewable * fSolarRen;
                            eSharedGseBessTs = eSharedGseRenewable * (1 - fSolarRen);
                        }
                        const eSharedGseBess = eSharedGseBessTs + eSharedGseBessArb;

                        // CER GSE Incentives
                        const gseIncentiveSolar_t = eSharedGseSolar * priceCER_kWh;
                        // Grid-charged BESS energy (Arbitrage) is NOT renewable generation and is ineligible for GSE incentives (TIAD + TIP = 0)
                        const gseIncentiveBessArb_t = 0;
                        const gseIncentiveBessTs_t = eSharedGseBessTs * priceCER_kWh;
                        const gseIncentiveBess_t = gseIncentiveBessTs_t; // Only Timeshifting (solar-charged BESS) gets GSE incentives

                        // 3. SPV Private PPA Contract
                        const privatePpaPrice_kWh = (stab.ppaPrice || 0) / 1000;
                        let ePrivateSolar = 0;
                        let ePrivateBessArb = 0;
                        let ePrivateBessTs = 0;

                        if (cerShareType === 'total_generation') {
                            ePrivateSolar = actualSolarGridFeed;
                            ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                            ePrivateBessTs = hourlyTsPhys;
                        } else {
                            // If based on shared energy, we use the same priority allocation
                            ePrivateSolar = eSharedGseSolar;
                            ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                            ePrivateBessTs = eSharedGseBessTs;
                        }
                        const ePrivateBess = ePrivateBessTs + ePrivateBessArb;

                        const privateRevenuePv_t = ePrivateSolar * privatePpaPrice_kWh;
                        const privateRevenueBessArb_t = ePrivateBessArb * privatePpaPrice_kWh;
                        const privateRevenueBessTs_t = ePrivateBessTs * privatePpaPrice_kWh;
                        const privateRevenueBess_t = ePrivateBess * privatePpaPrice_kWh;

                        // Override hourly arrays in plantSim to keep consolidated graphs in sync (using SPV private revenues)
                        plantSim.hourlySelfConsSolar[t] = eSharedGseSolar;
                        plantSim.hourlySelfConsBess[t] = eSharedGseBess;
                        plantSim.hourlySelfConsBessArb[t] = eSharedGseBessArb;
                        plantSim.hourlySelfConsBessTs[t] = eSharedGseBessTs;
                        plantSim.hourlySelfCons[t] = eSharedGse;

                        plantSim.hourlyRevenuePpaPv[t] = privateRevenuePv_t;
                        plantSim.hourlyRevenuePpaBess[t] = privateRevenueBess_t;
                        plantSim.hourlyRevenuePpaBessArb[t] = privateRevenueBessArb_t;
                        plantSim.hourlyRevenuePpaBessTs[t] = privateRevenueBessTs_t;

                        plantSim.hourlyCerGseIncentivePv[t] = gseIncentiveSolar_t;
                        plantSim.hourlyCerGseIncentiveBessArb[t] = gseIncentiveBessArb_t;
                        plantSim.hourlyCerGseIncentiveBessTs[t] = gseIncentiveBessTs_t;
                        plantSim.hourlyCerGseIncentiveBess[t] = gseIncentiveBess_t;
                        plantSim.hourlyCerGseIncentive[t] = gseIncentiveSolar_t + gseIncentiveBess_t;

                        // SPV private PPA Revenues
                        solarPpaRevY1 += privateRevenuePv_t;
                        bessPpaRevY1 += privateRevenueBess_t;
                        bessPpaRevArbY1 += privateRevenueBessArb_t;
                        bessPpaRevTsY1 += privateRevenueBessTs_t;

                        solarSelfConsMwhY1 += eSharedGseSolar / 1000;
                        bessSelfConsMwhY1 += eSharedGseBess / 1000;
                        bessSelfConsArbMwhY1 += eSharedGseBessArb / 1000;
                        bessSelfConsTsMwhY1 += eSharedGseBessTs / 1000;
                    }
                }

                plant._solarPpaRevY1 = solarPpaRevY1;
                plant._solarRidRevY1 = solarRidRevY1;
                plant._bessPpaRevY1 = bessPpaRevY1;
                plant._bessPpaRevArbY1 = bessPpaRevArbY1;
                plant._bessPpaRevTsY1 = bessPpaRevTsY1;
                plant._bessRidRevY1 = bessRidRevY1;
                plant._bessGridChargingCostY1 = bessGridChargingCostY1;
                plant._timeshiftingRevY1 = timeshiftingRevY1;
                plant._arbitrageRevY1 = arbitrageRevY1;
                plant._arbitrageCostY1 = arbitrageCostY1;

                plant._solarSelfConsMwhY1 = solarSelfConsMwhY1;
                plant._bessSelfConsMwhY1 = bessSelfConsMwhY1;
                plant._bessSelfConsArbMwhY1 = bessSelfConsArbMwhY1;
                plant._bessSelfConsTsMwhY1 = bessSelfConsTsMwhY1;
                plant._solarGridFeedMwhY1 = solarGridFeedMwhY1;
                plant._bessGridFeedMwhY1 = bessGridFeedMwhY1;

                // Physical metrics for driver breakdown
                plant._physSolarGenMwhY1 = plant.annualSolarProductionMWh;
                plant._physSolarPpaMwhY1 = solarSelfConsMwhY1;
                plant._physSolarRidMwhY1 = solarGridFeedMwhY1;
                plant._physSolarToBessMwhY1 = plantSim.hourlyChargeSolar.reduce((a,b)=>a+b, 0) / 1000;
                
                plant._physBessDischargeMwhY1 = plantSim.hourlyDischarge.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessSelfConsMwhY1 = bessSelfConsMwhY1;
                plant._physBessGridFeedMwhY1 = plantSim.hourlyDischargeGrid.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessGridFeedArbMwhY1 = plantSim.hourlyDischargeArbitrage.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessGridFeedTsMwhY1 = plantSim.hourlyDischargeTimeshifting.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessChargeGridMwhY1 = plantSim.hourlyChargeGrid.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessLossesMwhY1 = plantSim.hourlyLossesRte.reduce((a,b)=>a+b, 0) / 1000;

                plant._selfConsumptionMwh = solarSelfConsMwhY1 + bessSelfConsMwhY1;
                plant._gridFeedMwh = solarGridFeedMwhY1 + bessGridFeedMwhY1;
                plant._ppaRevenue_y1 = solarPpaRevY1 + bessPpaRevY1;

                totalArbitrageUpliftY1 += (bessPpaRevY1 + bessRidRevY1 - bessGridChargingCostY1);

                // Accumulate profiles
                for (let t = 0; t < 8760; t++) {
                    combinedSolarProfile[t] += plant.generation[t];
                    portfolioWeightedPunProfile[t] += plant.generation[t] * zonePrices[t];
                    consolidatedHourlyCharge[t] += plantSim.hourlyCharge[t];
                    consolidatedHourlyDischarge[t] += plantSim.hourlyDischarge[t];
                    consolidatedHourlySoC[t] += plantSim.hourlySoC[t];
                    consolidatedHourlyGridFeed[t] += plantSim.hourlyGridFeed[t];
                    consolidatedHourlySelfCons[t] += plantSim.hourlySelfCons[t];
                    consolidatedHourlyChargeGrid[t] += plantSim.hourlyChargeGrid[t];
                    consolidatedHourlyChargeGridNet[t] += plantSim.hourlyChargeGridNet ? plantSim.hourlyChargeGridNet[t] : plantSim.hourlyChargeGrid[t];
                    consolidatedHourlyChargeSolar[t] += plantSim.hourlyChargeSolar[t];
                    consolidatedHourlyChargeSolarNet[t] += plantSim.hourlyChargeSolarNet ? plantSim.hourlyChargeSolarNet[t] : plantSim.hourlyChargeSolar[t];
                    consolidatedHourlyDischargeGrid[t] += plantSim.hourlyDischargeGrid[t];
                    consolidatedHourlyDischargeGridArb[t] += plantSim.hourlyDischargeArbitrage[t] || 0;
                    consolidatedHourlyDischargeGridTs[t] += plantSim.hourlyDischargeTimeshifting[t] || 0;
                    consolidatedHourlyDischargePpa[t] += plantSim.hourlyDischargePpa[t];
                    consolidatedHourlySelfConsSolar[t] += plantSim.hourlySelfConsSolar[t];
                    consolidatedHourlySelfConsBess[t] += plantSim.hourlySelfConsBess[t];
                    consolidatedHourlyLossesRte[t] += plantSim.hourlyLossesRte[t];
                    consolidatedHourlyGridFeedPv[t] += plantSim.hourlyGridFeedPv[t] || 0;
                    consolidatedHourlyRevenueRidPure[t] += plantSim.hourlyRevenueRidPure[t] || 0;
                    consolidatedHourlyRevenueRidActual[t] += plantSim.hourlyRevenueRidActual[t] || 0;
                    consolidatedHourlyRevenueArbitrageGrid[t] += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                    consolidatedHourlyRevenuePpaPv[t] += plantSim.hourlyRevenuePpaPv[t] || 0;
                    consolidatedHourlyRevenuePpaBess[t] += plantSim.hourlyRevenuePpaBess[t] || 0;
                    consolidatedHourlyRevenueTimeshifting[t] += plantSim.hourlyRevenueTimeshifting[t] || 0;
                    consolidatedHourlyCostWithdrawal[t] += plantSim.hourlyCostWithdrawal[t] || 0;
                }
            });

            // Normalise the portfolio weighted PUN profile (general medione ponderato)
            const generalMedionePrices = new Float64Array(8760);
            let numSum = 0, denSum = 0;
            for (let t = 0; t < 8760; t++) {
                numSum += portfolioWeightedPunProfile[t];
                denSum += combinedSolarProfile[t];
                generalMedionePrices[t] = combinedSolarProfile[t] > 0 ? (portfolioWeightedPunProfile[t] / combinedSolarProfile[t]) : effectiveZonalPun["CNOR"][t];
            }
            const generalMedioneKpiValue = denSum > 0 ? (numSum / denSum) : 0;
            // For the medione, weight grid-fed energy (for CER/off-site, all generation goes to grid)
            let ridNumSum = 0, ridDenSum = 0;
            activePlants.forEach(plant => {
                const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                const plantStab = plant._stab;
                for (let t = 0; t < 8760; t++) {
                    let gridKw = 0;
                    if (plantStab && plantStab.ppaType === 'on-site' && plantStab.load) {
                        // On-site PPA: grid feed = generation minus self-consumption
                        const loadKw = plantStab.load[t] || 0;
                        gridKw = Math.max(0, plant.generation[t] - loadKw);
                    } else {
                        // CER, off-site or no stab: all generation (+ BESS) goes to grid
                        // Use sim hourlyGridFeed if available
                        gridKw = plant.sim ? (plant.sim.hourlyGridFeed[t] || plant.generation[t]) : plant.generation[t];
                    }
                    ridNumSum += gridKw * zonePrices[t];
                    ridDenSum += gridKw;
                }
            });
            const ridMedioneValue = ridDenSum > 0 ? (ridNumSum / ridDenSum) : 0;
            const avgPunZonalInjectedY1 = ridMedioneValue || 95.0;
            // Quota PPA calcolata direttamente dalle metriche per-impianto anno 1
            // (State.results non esiste nel worker: prima leggeva sempre 0)
            let totalSelfConsKwhY1 = 0;
            activePlants.forEach(pl => { totalSelfConsKwhY1 += (pl._selfConsumptionMwh || 0) * 1000; });
            const ppaShare = denSum > 0 ? (totalSelfConsKwhY1 / denSum * 100) : 0;
            let scenarioText = "";
            if (p.priceScenarioType === 'bearish_floor') {
                scenarioText = `  |  Scenario: Ribassista (PUN -${((p.punBearishDecayRate || 0) * 100).toFixed(1)}%, TS -${((p.tsBearishDecayRate || 0) * 100).toFixed(1)}%, Arb -${((p.arbBearishDecayRate || 0) * 100).toFixed(1)}%/anno, Floor \u20ac${(p.punZonalFloor || 0).toFixed(0)}/MWh)`;
            } else {
                scenarioText = `  |  Scenario: Base`;
            }
            const medioneKpiText = `Medione Ponderato RID: € ${ridMedioneValue.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /MWh` +
                (ppaShare > 0 ? `  |  Quota PPA: ${ppaShare.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '') +
                scenarioText;

            // Mock BESS consolidated simulation for downstream functions
            const bessSimulation = {
                annualShifted: totalShiftedMwh,
                totalUplift: totalArbitrageUpliftY1,
                hourlyCharge: consolidatedHourlyCharge,
                hourlyDischarge: consolidatedHourlyDischarge,
                hourlySoC: consolidatedHourlySoC,
                hourlyGridFeed: consolidatedHourlyGridFeed,
                hourlySelfCons: consolidatedHourlySelfCons,
                hourlyChargeGrid: consolidatedHourlyChargeGrid,
                hourlyChargeGridNet: consolidatedHourlyChargeGridNet,
                hourlyChargeSolar: consolidatedHourlyChargeSolar,
                hourlyChargeSolarNet: consolidatedHourlyChargeSolarNet,
                hourlyDischargeGrid: consolidatedHourlyDischargeGrid,
                hourlyDischargeArbitrage: consolidatedHourlyDischargeGridArb,
                hourlyDischargeTimeshifting: consolidatedHourlyDischargeGridTs,
                hourlyDischargePpa: consolidatedHourlyDischargePpa,
                hourlySelfConsSolar: consolidatedHourlySelfConsSolar,
                hourlySelfConsBess: consolidatedHourlySelfConsBess,
                hourlyLossesRte: consolidatedHourlyLossesRte,
                hourlyGridFeedPv: consolidatedHourlyGridFeedPv,
                hourlyRevenueRidPure: consolidatedHourlyRevenueRidPure,
                hourlyRevenueRidActual: consolidatedHourlyRevenueRidActual,
                hourlyRevenueArbitrageGrid: consolidatedHourlyRevenueArbitrageGrid,
                hourlyRevenuePpaPv: consolidatedHourlyRevenuePpaPv,
                hourlyRevenuePpaBess: consolidatedHourlyRevenuePpaBess,
                hourlyRevenueTimeshifting: consolidatedHourlyRevenueTimeshifting,
                hourlyCostWithdrawal: consolidatedHourlyCostWithdrawal
            };

            // Year 1 Energy Values
            const totalSolarProductionMWh = denSum / 1000;
            const netSystemEnergyMWh = totalSolarProductionMWh - totalBessLossesMwh;

            // BESS Capex & parameters
            const bessCAPEX = totalBessCAPEX;
            const totalProjectCost = totalEpcCapex + bessCAPEX + totalConnectionCapex + totalLandPurchaseCapex + totalLandDdsAttualizzatoCapex + totalDevelopmentCapex + totalSpvAcquisitionCapex + totalCustomCapex;

            // Debt sizing
            let bankableBase = totalProjectCost;
            if (p.debtBasis === 'hard_costs') {
                bankableBase = totalEpcCapex + bessCAPEX + totalConnectionCapex;
            } else if (p.debtBasis === 'ev_ex_spv') {
                bankableBase = totalProjectCost - totalSpvAcquisitionCapex;
            }
            const debtAmount = p.loanTerm === 0 ? 0 : (bankableBase * p.leverage);
            
            // ── Private Debt sizing (external mezzanine/subordinated at SPV level) ──
            let pdAmount = 0;
            if (p.pdEnabled) {
                if (p.pdAmountType === 'fixed_eur') pdAmount = Math.max(0, p.pdAmountValue || 0);
                else if (p.pdAmountType === 'pct_bankable') pdAmount = Math.max(0, bankableBase * ((p.pdAmountValue || 0) / 100));
                else if (p.pdAmountType === 'pct_totusi') pdAmount = Math.max(0, (totalProjectCost + (typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000)) * ((p.pdAmountValue || 0) / 100));
            }
            // ── Private Equity sizing (external equity co-investor at SPV level) ──
            // % equity è calcolata sull'equity totale residua dopo senior debt + PD
            let peAmount = 0;
            if (p.peEnabled) {
                // PE è a livello SPV: sizing sull'equity SPV (che NON include il PD, perché il PD è a Holding level)
                const equityGrossSpv = Math.max(0, totalProjectCost - debtAmount);
                if (p.peAmountType === 'fixed_eur') peAmount = Math.min(Math.max(0, p.peAmountValue || 0), equityGrossSpv);
                else if (p.peAmountType === 'pct_equity') peAmount = Math.max(0, equityGrossSpv * ((p.peAmountValue || 0) / 100));
            }

            // ── Sizing per Categoria (con supporto slider FINANZA e SPV Acquisition) ──
            const c_epc = totalEpcCapex;
            const c_bess = bessCAPEX;
            const c_conn = totalConnectionCapex;
            const c_land = totalLandPurchaseCapex + totalLandDdsAttualizzatoCapex;
            const c_dev = totalDevelopmentCapex;
            const c_spv = totalSpvAcquisitionCapex;
            const c_cust = totalCustomCapex;

            const isHardCosts = p.debtBasis === 'hard_costs';
            const isEvExSpv = p.debtBasis === 'ev_ex_spv';

            // Allocazione del debito senior per categoria (in proporzione alla base bancabile)
            const debtAlloc = (c, isBankable) => {
                if (!isBankable || bankableBase <= 0 || debtAmount <= 0) return 0;
                return c * (debtAmount / bankableBase);
            };

            const d_epc = debtAlloc(c_epc, true);
            const d_bess = debtAlloc(c_bess, true);
            const d_conn = debtAlloc(c_conn, true);
            const d_land = debtAlloc(c_land, !isHardCosts);
            const d_dev = debtAlloc(c_dev, !isHardCosts);
            const d_cust = debtAlloc(c_cust, !isHardCosts);
            const d_spv = debtAlloc(c_spv, !isHardCosts && !isEvExSpv);

            // Fabbisogno lordo di equity per categoria (al netto del debito senior allocato)
            const eq_epc = Math.max(0, c_epc - d_epc);
            const eq_bess = Math.max(0, c_bess - d_bess);
            const eq_conn = Math.max(0, c_conn - d_conn);
            const eq_land = Math.max(0, c_land - d_land);
            const eq_dev = Math.max(0, c_dev - d_dev);
            const eq_cust = Math.max(0, c_cust - d_cust);
            const eq_spv = Math.max(0, c_spv - d_spv);
            const totalEqGross = eq_epc + eq_bess + eq_conn + eq_land + eq_dev + eq_cust + eq_spv;

            // Allocazione Private Equity (se presente)
            const peAlloc = (eq) => {
                if (peAmount <= 0 || totalEqGross <= 0) return 0;
                return peAmount * (eq / totalEqGross);
            };

            // Fabbisogno residuo a carico dello Sponsor per categoria
            const sp_epc = Math.max(0, eq_epc - peAlloc(eq_epc));
            const sp_bess = Math.max(0, eq_bess - peAlloc(eq_bess));
            const sp_conn = Math.max(0, eq_conn - peAlloc(eq_conn));
            const sp_land = Math.max(0, eq_land - peAlloc(eq_land));
            const sp_dev = Math.max(0, eq_dev - peAlloc(eq_dev));
            const sp_cust = Math.max(0, eq_cust - peAlloc(eq_cust));
            const sp_spv = Math.max(0, eq_spv - peAlloc(eq_spv));

            // Percentuali di copertura da Finanziamento Soci (slider categoria in FINANZA, fallback su p.sociEquityPct)
            const fallbackSociPct = p.sociEquityPct !== undefined ? p.sociEquityPct : 100;
            const pct_epc = (p.sociPctEpc !== undefined ? p.sociPctEpc : fallbackSociPct) / 100;
            const pct_bess = (p.sociPctBess !== undefined ? p.sociPctBess : fallbackSociPct) / 100;
            const pct_conn = (p.sociPctConnection !== undefined ? p.sociPctConnection : fallbackSociPct) / 100;
            const pct_land = (p.sociPctLand !== undefined ? p.sociPctLand : fallbackSociPct) / 100;
            const pct_dev = (p.sociPctDevelopment !== undefined ? p.sociPctDevelopment : fallbackSociPct) / 100;
            const pct_cust = (p.sociPctCustom !== undefined ? p.sociPctCustom : fallbackSociPct) / 100;
            const pct_spv = (p.sociPctSpv !== undefined ? p.sociPctSpv : fallbackSociPct) / 100;

            // Quote Finanziamento Soci per categoria
            const soci_epc = sp_epc * pct_epc;
            const soci_bess = sp_bess * pct_bess;
            const soci_conn = sp_conn * pct_conn;
            const soci_land = sp_land * pct_land;
            const soci_dev = sp_dev * pct_dev;
            const soci_cust = sp_cust * pct_cust;
            const soci_spv = sp_spv * pct_spv;

            const initialShareholderLoan = soci_epc + soci_bess + soci_conn + soci_land + soci_dev + soci_cust + soci_spv;
            let remainingShareholderLoan = initialShareholderLoan;

            // Quote Capitale Proprio Sponsor (Pure Equity) per categoria
            const pure_epc = sp_epc - soci_epc;
            const pure_bess = sp_bess - soci_bess;
            const pure_conn = sp_conn - soci_conn;
            const pure_land = sp_land - soci_land;
            const pure_dev = sp_dev - soci_dev;
            const pure_cust = sp_cust - soci_cust;
            const pure_spv = sp_spv - soci_spv;
            const totalProjectPureEquity = pure_epc + pure_bess + pure_conn + pure_land + pure_dev + pure_cust + pure_spv;

            const holdcoCap = typeof p.holdcoCapital === 'number' ? Math.max(0, p.holdcoCapital) : 10000;
            const spvCap = typeof p.spvCapital === 'number' ? Math.max(0, p.spvCapital) : 10000;
            // equityAmount = Capitale Proprio Sponsor puro: pure equity + dotazione HoldCo - PD (debito Holding)
            const equityAmount = Math.max(0, totalProjectPureEquity + holdcoCap - pdAmount);
            // totalSponsorCommittedEquity = Totale fondi propri Sponsor (Pure Equity + Finanziamento Soci + HoldCo Setup - PD)
            const totalSponsorCommittedEquity = Math.max(0, totalProjectPureEquity + initialShareholderLoan + holdcoCap - pdAmount);
            // totalSpvEquityTicket = Fabbisogno azionario totale a livello SPV (CAPEX totale - Debito Senior)
            const totalSpvEquityTicket = Math.max(0, totalProjectCost - debtAmount);
            let remainingDebt = debtAmount;

            // ── Private Debt running balance & schedule (ora a livello HOLDING) ──
            let remainingPd = pdAmount;
            const pdAmortizingAnnuality = (p.pdEnabled && p.pdMode === 'amortizing' && p.pdLoanTerm > 0 && pdAmount > 0)
                ? pdAmount * ((p.pdInterestRate/100) * Math.pow(1 + (p.pdInterestRate/100), p.pdLoanTerm)) / (Math.pow(1 + (p.pdInterestRate/100), p.pdLoanTerm) - 1)
                : 0;
            // ── Private Equity preferred return accrual (composto) ──
            let pePreferredAccrued = 0; // hurdle composto maturato non ancora distribuito
            // ── Altra Forma (convertible note) running balance PIK ──
            let remainingAfConvertible = (p.afEnabled && p.afType === 'convertible_note') ? Math.max(0, p.afConvertibleAmount || 0) : 0;

            // ── Parametri Configurabili IDC e Preammortamento ──
            const seniorGracePeriodMonths = p.seniorGracePeriodMonths !== undefined ? p.seniorGracePeriodMonths : 6;
            const constructionMonths = p.constructionMonths !== undefined ? p.constructionMonths : 6;
            const idcDrawdownFactor = p.idcDrawdownFactor !== undefined ? p.idcDrawdownFactor : 50;
            
            // Grace period generalizzato: supporta anche preammortamenti > 12 mesi (approssimazione annuale)
            const gracePeriodYears = Math.min(seniorGracePeriodMonths / 12, Math.max(0, (p.loanTerm || 0) - 1));
            const graceFullYears = Math.floor(gracePeriodYears);
            const graceFrac = gracePeriodYears - graceFullYears;
            let remainingGraceYears = gracePeriodYears;
            const constructionYears = constructionMonths / 12;

            // IDC = Interest During Construction
            const idcAmount = p.loanTerm > 0 ? (debtAmount * p.interestRate * constructionYears * (idcDrawdownFactor / 100)) : 0;

            // Frequenza rimborso debito senior: 'mensile' (12), 'trimestrale' (4), 'semestrale' (2), 'annuale' (1)
            let mDebt = 1; // Default legacy annuale se non specificato
            if (p.debtRepaymentFrequency === 'mensile') mDebt = 12;
            else if (p.debtRepaymentFrequency === 'trimestrale') mDebt = 4;
            else if (p.debtRepaymentFrequency === 'semestrale') mDebt = 2;
            else if (p.debtRepaymentFrequency === 'annuale') mDebt = 1;

            let annualDebtService = 0;
            let periodicAnnuity = 0;
            if (p.loanTerm > 0 && debtAmount > 0) {
                // Ammortamento calcolato sugli anni effettivi (scadenza originaria - preammortamento)
                const amortizingYears = Math.max(0.1, p.loanTerm - gracePeriodYears);
                const r = p.interestRate;
                if (mDebt === 1) {
                    if (amortizingYears > 0 && r > 0) {
                        annualDebtService = debtAmount * (r * Math.pow(1 + r, amortizingYears)) / (Math.pow(1 + r, amortizingYears) - 1);
                    } else if (amortizingYears > 0) {
                        annualDebtService = debtAmount / amortizingYears;
                    }
                    periodicAnnuity = annualDebtService;
                } else {
                    const i_m = r / mDebt;
                    const nPeriods = Math.max(1, Math.round(amortizingYears * mDebt));
                    if (nPeriods > 0 && i_m > 0) {
                        periodicAnnuity = debtAmount * (i_m * Math.pow(1 + i_m, nPeriods)) / (Math.pow(1 + i_m, nPeriods) - 1);
                        annualDebtService = periodicAnnuity * mDebt;
                    } else if (nPeriods > 0) {
                        periodicAnnuity = debtAmount / nPeriods;
                        annualDebtService = periodicAnnuity * mDebt;
                    }
                }
            }

            // ── DSRA (Debt Service Reserve Account): target = N mesi di debt service programmato ──
            const dsraTargetAmount = ((p.dsraMonths || 0) > 0 && annualDebtService > 0) ? ((p.dsraMonths / 12) * annualDebtService) : 0;
            let dsraBalance = 0;

            // ── Refinancing / Miniperm: stato del prestito corrente (cambia al refiYear) ──
            let activeRate = p.interestRate;
            let activePeriodicAnnuity = periodicAnnuity;
            let activeAnnuity = annualDebtService;
            let activeMaturity = p.loanTerm;
            const refiYear = (p.refiEnabled && (parseInt(p.refiYear) || 0) >= 1) ? Math.min(19, parseInt(p.refiYear)) : 0;

            // Capitalization of BESS cells at Year 10 (sum of cell replacements for non-graphene)
            let bessAugmentationCost = 0;
            activePlants.forEach(plant => {
                const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                const plantBessType = plant.bessType || 'none';
                
                if (plantBessMw > 0 && plantBessType !== 'graphene') {
                    bessAugmentationCost += (plantBessMwh * 1000 * plantBessCapexKwh) * 0.50;
                }
            });

            // LCOE and LCOS calculations
            let lcoeSumDiscountedCosts = totalProjectCost - bessCAPEX;
            let lcoeSumDiscountedEnergy = 0;
            let lcosSumDiscountedCosts = bessCAPEX;
            let lcosSumDiscountedEnergy = 0;

            const cashFlowsForIRR = [-totalSponsorCommittedEquity];

            // ── Stabilimenti Self-Consumption Pre-Computation ──────────────────────────────
            // Pre-computed inside the main plants loop above

            // ── P1 Fix: Pre-compute weighted PUN (€/MWh) per plant from imported GME data ──
            // Falls back to €95/MWh if no GME data is loaded for the zone
            activePlants.forEach(plant => {
                const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                let numP = 0, denP = 0;
                for (let t = 0; t < 8760; t++) {
                    numP += plant.generation[t] * zonePrices[t];
                    denP += plant.generation[t];
                }
                // If GME data not loaded (all zeros), fallback to default €95/MWh
                plant._weightedPun = (denP > 0 && numP > 0) ? (numP / denP) : 95;
            });
            let totalEbitda = 0;
            let totalHoldcoFCFE = 0;
            let minDscr = 999;
            let sumDscr = 0;
            let dscrYearsCount = 0;

            const matrix = {
                years: [], revenueTotal: [],
                qtyEnergyGroup: [], priceEnergyGroup: [],
                qtySolarGen: [], qtySolarPpa: [], qtySolarRid: [], qtySolarToBess: [],
                qtyBessDischarge: [], qtyBessSelfCons: [], qtyBessSelfConsArb: [], qtyBessSelfConsTs: [], qtyBessGridFeed: [],
                qtyBessGridFeedArb: [], qtyBessGridFeedTs: [],
                qtyBessChargeGrid: [], qtyBessLosses: [],
                priceSolarAvg: [], priceSolarPpa: [], priceSolarRid: [],
                priceBessAvg: [], priceBessPpa: [], priceBessRid: [],
                priceBessArbitrage: [], priceBessTimeshifting: [], priceBessChargeGrid: [],
                revenueTimeshifting: [], revenueArbitrage: [], revenueMsd: [],
                revenueRid: [], revenuePpa: [], revenuePpaPv: [], revenuePpaBessArb: [], revenuePpaBessTs: [],
                opexTotal: [], opexPlants: [], opexBess: [], opexGridCharging: [], opexLandDds: [], 
                opexInsurance: [], opexTaxes: [], opexSecurity: [], opexAssetManagement: [], opexServiceContract: [],
                opexMaintReserve: [],
                ebitda: [], ebit: [], depreciationCivil: [], depreciationCivilSolar: [], depreciationCivilBess: [], depreciationCivilOther: [],
                interest: [], interestPaid: [], interestActive: [], sociInterestAccrued: [], ebt: [],
                currentTaxesSpv: [], iresTaxSpv: [], irapTaxSpv: [], deferredTaxes: [], civilTaxesSpv: [], netProfitSpv: [], cfads: [],
                deductibleInterest: [], interestCF: [], rolCF: [], taxLossCF: [],
                taxTaxableIres: [], taxDeprDelta: [], taxInterestDelta: [], taxLossApplied: [], taxTaxableFinal: [], taxableIrap: [],
                taxNolFirst3Applied: [], taxLossFirst3CF: [], taxNolNormalApplied: [], taxLossNormalCF: [],
                taxFiscalDepr: [], taxFiscalDeprBase: [], taxFiscalRemaining: [], taxNetInterest: [], taxCivilIdc: [], taxDeferredRaw: [], taxDeferredFund: [],
                dividendsPaid: [], holdcoFCFE: [], rolCapacity: [], bessAugmentationCost: [], mraRelease: [],
                maintReserve: [], holdcoOpex: [], holdcoIresTaxPaid: [], holdcoIrapTaxPaid: [], holdcoNetProfit: [], holdcoEarnoutPaid: [], holdcoBuyoutPaid: [],
                holdcoProductionValue: [], holdcoProductionCosts: [], holdcoEbitda: [], holdcoOperatingEbit: [], holdcoFinancialNet: [], holdcoEbt: [], holdcoTaxTotal: [],
                holdcoInflowTotal: [], holdcoInterestReceived: [], holdcoLoanRepaymentReceived: [], holdcoDividendReceived: [], partnerDividendReceived: [], spvLockedDividends: [],
                spvLegalReserveAccrual: [], spvRetainedEarnings: [], spvCapitalReserveReturned: [], holdcoCapitalReserveReceived: [], spvCashTrapCumulative: [],
                cfadsCumulated: [], holdcoFCFECumulated: [], principalScheduled: [], principalVoluntary: [],
                dsraFunding: [], dsraDraw: [], dsraRelease: [],
                spvFCFE: [], spvCashTrap: [],
                // ── External financing instruments (Private Debt / Private Equity / Altra Forma) ──
                pdInterestAccrued: [], pdInterestPaid: [], pdPrincipalPaid: [], pdBulletPayoff: [],
                pdServiceHoldco: [], pdPayoffHoldco: [],
                afFee: [], afInterestAccrued: [], afExitCost: [],
                peRoyalty: [], peDividendPaid: [], pePreferredPaid: [], peExitShare: [], pePreferredAccruedBalance: [],
                peDividendToSponsor: [], peExitToSponsor: [],
                exitValuationGroup: [], exitEnterpriseValue: [], exitDebtPayoff: [], exitPexTaxRow: [], exitNetProceedsRow: [], exitLimitedLiability: [],
                projectFCFF: [],
                cerGseIncentive: [],
                holdcoOperatingCashflow: [],
                // ── Stato Patrimoniale SPV (Sez. B-bis) ──
                bsSpvGrossFixedAssets: [], bsSpvGrossCapex: [],
                bsSpvAccumDepreciation: [], bsSpvAccumDepr: [],
                bsSpvNetFixedAssets: [],
                bsSpvDta: [],
                bsSpvMraCash: [], bsSpvMra: [],
                bsSpvDsraCash: [], bsSpvDsra: [],
                bsSpvRestrictedCash: [],
                bsSpvCashBalance: [], bsSpvCash: [],
                bsSpvTotalAssets: [],
                bsSpvShareCapital: [], bsSpvLegalReserve: [], bsSpvRetainedEarnings: [],
                bsSpvNetProfit: [], bsSpvTotalEquity: [],
                bsSpvSeniorDebt: [],
                bsSpvShareholderLoan: [], bsSpvSociLoan: [],
                bsSpvAfLiability: [], bsSpvAfConvertible: [],
                bsSpvDtl: [],
                bsSpvTotalLiabilities: [],
                bsSpvTotalLiabAndEquity: [], bsSpvTotalLiabilitiesAndEquity: [],
                bsSpvBalanceCheck: [],
                // ── Stato Patrimoniale Holding (Sez. D-bis) ──
                bsHcSpvEquityInv: [], bsHcSpvParticipation: [],
                bsHcSociLoanReceivable: [],
                bsHcCashBalance: [], bsHcCash: [],
                bsHcTotalAssets: [],
                bsHcShareCapital: [], bsHcRetainedEarnings: [], bsHcNetProfit: [], bsHcTotalEquity: [],
                bsHcPdDebt: [],
                bsHcTotalLiabilities: [],
                bsHcTotalLiabAndEquity: [], bsHcTotalLiabilitiesAndEquity: [],
                bsHcBalanceCheck: [],
                capexBreakdown: capexBreakdown, opexBreakdown: opexBreakdown
            };

            const debtSchedule = {
                years: [], beginningBalance: [], interestAccrued: [], principalScheduled: [], principalVoluntary: [], endingBalance: [],
                totalDebtService: [], dscr: [], llcr: [], dsraBalance: [], beginningBalanceSoci: [], interestAccruedSoci: [], interestPaidSoci: [], principalPaidSoci: [], endingBalanceSoci: [],
                // Private Debt schedule (sezione 3)
                beginningBalancePd: [], interestAccruedPd: [], interestPaidPd: [], principalPaidPd: [], bulletPayoffPd: [], endingBalancePd: []
            };
            let taxLossCarriedForwardFirst3Y = 0;
            let taxLossCarriedForwardNormal = 0;
            let deferredTaxFund = 0;
            let interestExpensesCarriedForward = 0;
            let rolCarriedForward = 0;
            let mraBalance = 0;
            let cumulativeCfads = 0;
            let cumulativeHoldcoFCFE = 0;
            let accumulatedLegalReserve = 0;
            let retainedEarningsBalance = 0;
            let accumulatedCapitalReserveReturned = 0;
            let spvCashTrapCumulative = 0;

            // ── Stato Patrimoniale SPV & Holding running state (Partita Doppia OIC) ──
            const initialAfConvertible = (p.afEnabled && p.afType === 'convertible_note') ? Math.max(0, p.afConvertibleAmount || 0) : 0;
            const initialSpvPaidInCapital = totalProjectPureEquity + idcAmount - initialAfConvertible;
            let cumGrossFixedAssets = totalProjectCost + idcAmount;
            let cumDeprSpv = 0;
            const initialSpvCash = Math.max(0, spvCap - initialSpvPaidInCapital);
            let cumSpvCashBalance = initialSpvCash;
            let cumSpvRetainedEarnings = 0;

            const initialHcShareCapital = (totalProjectPureEquity + initialShareholderLoan + holdcoCap) - pdAmount;
            let cumHcSpvEquityInv = totalProjectPureEquity;
            let cumHcCash = holdcoCap;
            let cumHcRetainedEarnings = 0;

            // Depreciable base calculation includes IDC capitalized; CF7: custom CAPEX ammortizzabile
            const depreciablePlantBaseCivil = totalEpcCapex + bessCAPEX + totalConnectionCapex + totalLandDdsAttualizzatoCapex + totalDevelopmentCapex + idcAmount + totalCustomCapex;

            const exitOptionYear = (p.exitOption && p.exitOption !== 'none') ? parseInt(p.exitOption) : 0;
            const exitYear = 20;
            let spvLockedDividends = 0;

            // ═══ CF3: anno àncora = anno del COD più antico (null = legacy: anno 1 = gen-dic pieno) ═══
            let anchorYear = null;
            activePlants.forEach(pl => {
                const cod = parseCodDate(pl.codDate || pl.cod);
                pl._codParsed = cod;
                if (cod && (anchorYear === null || cod.y < anchorYear)) anchorYear = cod.y;
            });

            // ═══ OIC 16 / Art. 102 TUIR: Basi e residui ammortamento per impianto e per categoria ═══
            const totalDeprCapexExIdc = activePlants.reduce((sum, pl) => {
                const pSolar = (pl.capacity * pl.capex) + (pl.landType === 'dds_attualizzato' ? (pl.landCost || 0) : 0);
                const pBess = ((pl.bessMwh || 0) * 1000 * (pl.bessCapexKwh || 0));
                const pOther = (pl.connectionCost || 0) + (pl.developmentCost || 0) + (pl.customCapexEur || 0);
                return sum + pSolar + pBess + pOther;
            }, 0);

            activePlants.forEach(pl => {
                const pSolar = (pl.capacity * pl.capex) + (pl.landType === 'dds_attualizzato' ? (pl.landCost || 0) : 0);
                const pBess = ((pl.bessMwh || 0) * 1000 * (pl.bessCapexKwh || 0));
                let pOther = (pl.connectionCost || 0) + (pl.developmentCost || 0) + (pl.customCapexEur || 0);
                const pIdc = totalDeprCapexExIdc > 0 ? (idcAmount * ((pSolar + pBess + pOther) / totalDeprCapexExIdc)) : 0;
                pOther += pIdc;

                pl._baseSolarCivil = pSolar;
                pl._baseBessCivil = pBess;
                pl._baseOtherCivil = pOther;
                pl._baseIdcCivil = pIdc;

                pl._remainingSolarCivil = pSolar;
                pl._remainingBessCivil = pBess;
                pl._remainingOtherCivil = pOther;
                pl._remainingBessAugCivil = 0;
                pl._bessAugCost = 0;

                pl._baseTax = pSolar + pBess + pOther;
                pl._remainingTax = pSolar + pBess + pOther;
                pl._remainingTaxBessAug = 0;
            });

            let y1DebtAvail = 1.0;
            for (let yr = 0; yr <= exitYear; yr++) {
                const inflationMultiplier = yr === 0 ? 1.0 : Math.pow(1 + p.inflation, yr - 1);
                
                // Calculate Bearish Scenario with Floor scale factor K_y
                let K_y = 1.0;
                if (yr > 1 && p.priceScenarioType === 'bearish_floor') {
                    const rawDecay = Math.pow(1 - p.punBearishDecayRate, yr - 1);
                    const floorRatio = p.punZonalFloor / (avgPunZonalInjectedY1 || 1.0);
                    K_y = Math.max(rawDecay, floorRatio);
                }

                // Sum up plant-level values for year `yr`
                let ySolarMwh = 0;
                let yQtyEnergyGroup = 0;
                let yQtySolarAvgDen = 0;
                let yPriceEnergyGroup = 0;
                let yQtySolarGen = 0;
                let yQtySolarPpa = 0;
                let yQtySolarRid = 0;
                let yQtySolarToBess = 0;
                let yQtyBessDischarge = 0;
                let yQtyBessSelfCons = 0;
                let yQtyBessSelfConsArb = 0;
                let yQtyBessSelfConsTs = 0;
                let yQtyBessGridFeed = 0;
                let yQtyBessGridFeedArb = 0;
                let yQtyBessGridFeedTs = 0;
                let yQtyBessChargeGrid = 0;
                let yQtyBessLosses = 0;
                
                let ySolarPpaRev = 0;
                let ySolarRidRev = 0;
                let yBessPpaRev = 0;
                let yBessTimeshiftingRev = 0;
                let yBessArbitrageRev = 0;
                let yBessGridChargingCost = 0;
                let yShiftedMwh = 0;
                let yRevenueRid = 0;
                let yRevenuePpa = 0;
                let yRevenuePpaPv = 0;
                let yBessPpaRevArb = 0;
                let yBessPpaRevTs = 0;
                let yRevenueTimeshifting = 0;
                let yRevenueArbitrage = 0;
                let yCerGseIncentive = 0;
                let yBessOpex = 0;
                let yOpexGridCharging = 0;
                let yMaintReserve = 0;
                let yLcoeEnergyTotal = 0;
                let yLcosEnergyTotal = 0;
                let yLcosCostsTotal = 0;
                let yOpexServiceContract = 0;
                let yHoldcoEarnoutPaid = 0;
                let yOpexPlants = 0;
                let yOpexInsurance = 0;
                let yOpexTaxes = 0;
                let yOpexSecurity = 0;
                let yOpexAssetManagement = 0;
                let yLandDdsAnnuoFee = 0;
                let yDeprSolar = 0;
                let yDeprBess = 0;
                let yDeprOther = 0;
                let yDepreciationCivil = 0;
                let totalAnnualDepreciationFiscal = 0;
                let totalAnnualDepreciationFiscalBase = 0;
                let totalFiscalRemaining = 0;

                activePlants.forEach((plant, pIdx) => {
                    const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                    const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                    const plantBessEfficiency = plant.bessEfficiency !== undefined ? plant.bessEfficiency : 0.90;
                    const plantBessDegradation = plant.bessDegradation !== undefined ? plant.bessDegradation : 0.018;
                    const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                    const plantBessType = plant.bessType || 'none';

                    const solarDegradation = yr === 0 ? 1.0 : Math.max(0.50, 1 - 0.0035 * (yr - 1));
                    // Rule thermal_degradation_vs_revenue_arbitrage: Cap excessive degradation to preserve battery safety
                    const effectiveBessDegradation = Math.min(0.035, plantBessDegradation);
                    const bessDegradationMult = (yr === 0 || plantBessType === 'graphene') ? 1.0 : Math.max(0.50, 1 - effectiveBessDegradation * (yr - 1));

                    // CF3: Intervallo orario esatto per anno di calendario con impianto in esercizio (COD) — no pro-die
                    const calYear = (yr === 0 || anchorYear === null) ? null : (anchorYear + yr - 1);
                    const activeRange = (yr === 0) 
                        ? { hStart: 8760, hEnd: 8760, isActive: false, isFullYear: false }
                        : getPlantActiveHourRange(plant._codParsed, calYear);
                    const { hStart, hEnd, isActive, isFullYear } = activeRange;

                    let pSolarMwh = 0;
                    let pShiftedMwh = 0;
                    if (isActive) {
                        if (isFullYear) {
                            pSolarMwh = (plant.annualSolarProductionMWh || 0) * solarDegradation;
                            pShiftedMwh = (plant.sim ? plant.sim.annualShifted : 0) * bessDegradationMult;
                        } else {
                            let sumGen = 0;
                            for (let t = hStart; t < hEnd; t++) sumGen += plant.generation[t];
                            pSolarMwh = (sumGen / 1000) * solarDegradation;
                            let sumShifted = 0;
                            if (plant.sim && plant.sim.hourlyDischarge) {
                                for (let t = hStart; t < hEnd; t++) sumShifted += plant.sim.hourlyDischarge[t];
                            }
                            pShiftedMwh = (sumShifted / 1000) * bessDegradationMult;
                        }
                    }

                    // Decoupled revenues with plant-specific custom decays
                    const degradeRidFactor = 1 - (plant.degradeRidPct !== undefined ? plant.degradeRidPct : 2.0) / 100;
                    const degradeTimeshiftingFactor = 1 - (plant.degradeTimeshiftingPct !== undefined ? plant.degradeTimeshiftingPct : 2.0) / 100;
                    const degradeArbitrageFactor = 1 - (plant.degradeArbitragePct !== undefined ? plant.degradeArbitragePct : 2.0) / 100;

                    const ppaDuration = (plant._stab && plant._stab.ppaDuration) ? parseInt(plant._stab.ppaDuration) : 15;
                    const lossInject = resolveGridLosses(plant.gridVoltage, 'inject');
                    const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');
                    const lossMult = 1 + (lossInject / 100);
                    const gseImb = State.inputs.ridImbalanceCost || 0;
                    const spread = plant.traderSpread || 0;
                    const disp = plant.traderDisp || 0;
                    const fallbackPrice = (plant.marketType === 'fer_x') ? plant.ferxTariff : (plant._weightedPun * lossMult - gseImb);
                    const ridPriceY1 = (plant._solarGridFeedMwhY1 > 0) ? (plant._solarRidRevY1 / plant._solarGridFeedMwhY1) : fallbackPrice;
                    
                    let currentRidDecay = yr === 0 ? 1.0 : Math.pow(degradeRidFactor, yr - 1);
                    let currentTimeshiftingDecay = yr === 0 ? 1.0 : Math.pow(degradeTimeshiftingFactor, yr - 1);
                    let currentArbitrageDecay = yr === 0 ? 1.0 : Math.pow(degradeArbitrageFactor, yr - 1);
                    let ridPriceYr = yr === 0 ? 0 : ridPriceY1 * Math.pow(degradeRidFactor, yr - 1);

                    if (p.priceScenarioType === 'bearish_floor') {
                        currentRidDecay = yr === 0 ? 1.0 : K_y;
                        currentTimeshiftingDecay = yr === 0 ? 1.0 : Math.pow(1 - (p.tsBearishDecayRate || 0), yr - 1);
                        currentArbitrageDecay = yr === 0 ? 1.0 : Math.pow(1 - (p.arbBearishDecayRate || 0), yr - 1);
                        ridPriceYr = yr === 0 ? 0 : ridPriceY1 * K_y;
                    }

                    if (plant.marketType === 'fer_x') {
                        currentRidDecay = 1;
                        currentTimeshiftingDecay = 1;
                        currentArbitrageDecay = 1;
                        ridPriceYr = yr === 0 ? 0 : ridPriceY1;
                    }

                    let solarRidRev = 0;
                    let solarPpaRev = 0;
                    let bessPpaRev = 0;
                    let bessPpaRevArb = 0;
                    let bessPpaRevTs = 0;
                    let timeshiftingRev = 0;
                    let arbitrageRev = 0;
                    let pBessGridChargingCost = 0;

                    let pPhysSolarGen = 0;
                    let pPhysSolarToBess = 0;
                    let pPhysSolarPpa = 0;
                    let pPhysSolarRid = 0;
                    let pPhysBessSelfCons = 0;
                    let pPhysBessSelfConsArb = 0;
                    let pPhysBessSelfConsTs = 0;
                    let pPhysBessGridFeed = 0;
                    let pPhysBessGridFeedArb = 0;
                    let pPhysBessGridFeedTs = 0;

                    const stab = plant._stab;
                    const plantSim = plant.sim;

                    if (isActive) {
                        if (stab && stab.ppaType === 'cer') {
                            const cerShareType = stab.cerShareType || 'shared_energy';
                            const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];

                            // Determine CER tariff size parameters based on plant capacity (kWp)
                            let fissa = 0;
                            let cap = 0;
                            if (plant.capacity <= 20) {
                                fissa = State.inputs.cerFissaSmall;
                                cap = State.inputs.cerCapSmall;
                            } else if (plant.capacity <= 200) {
                                fissa = State.inputs.cerFissaMedium;
                                cap = State.inputs.cerCapMedium;
                            } else {
                                fissa = State.inputs.cerFissaLarge;
                                cap = State.inputs.cerCapLarge;
                            }

                            // Geographic correction
                            let geoCorr = 0;
                            const zoneUpper = String(plant.zone).toUpperCase();
                            
                            const cerTras = State.inputs.cerTras;
                            const cPR = resolveGridLosses(plant.gridVoltage, 'cpr') / 100;

                            if (zoneUpper === 'NORD') {
                                geoCorr = State.inputs.cerGeoNord;
                            } else if (zoneUpper === 'CNOR') {
                                geoCorr = State.inputs.cerGeoCentro;
                            } else {
                                geoCorr = State.inputs.cerGeoSud;
                            }

                            // PNRR reduction factor
                            const pnrrPct = plant.pnrrContributionPct || 0;
                            const decurtazioneF = 0.5 * (pnrrPct / 40);
                            const factorPNRR = 1 - decurtazioneF;

                            for (let t = hStart; t < hEnd; t++) {
                                const solar = plant.generation[t] * solarDegradation;
                                pPhysSolarGen += solar / 1000;
                                const pricePUN = zonePrices[t];
                                const basePrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) 
                                    : (plant.marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(plant, typeof yr !== 'undefined' ? yr : 1, getMonthOfHour(t))) * lossMult / 1000)
                                    : ((pricePUN * lossMult - gseImb) / 1000);
                                const priceRID = basePrice * currentRidDecay;
                                const month = getMonthOfHour(t);
                                const traderPrice = plant.traderContractType === 'pun_medio' ? plant._monthlyAveragePun[month] : pricePUN;
                                const costGrid = (((traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000) * currentArbitrageDecay);

                                const chargeSolar = (plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0) * bessDegradationMult;
                                pPhysSolarToBess += chargeSolar / 1000;
                                const gridCharge = (plantSim.hourlyChargeGrid[t] || 0) * bessDegradationMult;
                                const bessDischarge = (plantSim.hourlyDischarge[t] || 0) * bessDegradationMult;
                                const bessDischargeGrid = (plantSim.hourlyDischargeGrid[t] || 0) * bessDegradationMult;
                                const gridFeedPv = Math.max(0, solar - chargeSolar);
                                const actualRid = gridFeedPv + bessDischargeGrid;

                                // 1. RID Revenues
                                solarRidRev += gridFeedPv * priceRID;
                                
                                // BESS RID revenues
                                const hourlyArb = (plantSim.hourlyRevenueArbitrageGrid[t] || 0) * bessDegradationMult * currentArbitrageDecay;
                                const hourlyTs = (plantSim.hourlyRevenueTimeshifting[t] || 0) * bessDegradationMult * currentTimeshiftingDecay;
                                arbitrageRev += hourlyArb;
                                timeshiftingRev += hourlyTs;
                                pBessGridChargingCost += gridCharge * costGrid;

                                // 2. CER Shared Energy (GSE)
                                const cerLoad = (stab.load && stab.load[t] !== undefined) ? stab.load[t] : 0;
                                const eSharedGse = Math.min(actualRid, cerLoad);

                                const hourlyArbPhys = (plantSim.hourlyDischargeArbitrage ? plantSim.hourlyDischargeArbitrage[t] : 0) * bessDegradationMult;
                                const hourlyTsPhys = (plantSim.hourlyDischargeTimeshifting ? plantSim.hourlyDischargeTimeshifting[t] : 0) * bessDegradationMult;
                                const actualRenewableRid = gridFeedPv + hourlyTsPhys;

                                // Priority-based shared energy allocation: Prioritize Renewable (Solar + BESS Timeshifting) over Arbitrage
                                const eSharedGseRenewable = Math.min(actualRenewableRid, cerLoad);
                                const eSharedGseBessArb = Math.min(hourlyArbPhys, eSharedGse - eSharedGseRenewable);

                                let eSharedGseSolar = 0;
                                let eSharedGseBessTs = 0;
                                if (actualRenewableRid > 0) {
                                    const fSolarRen = gridFeedPv / actualRenewableRid;
                                    eSharedGseSolar = eSharedGseRenewable * fSolarRen;
                                    eSharedGseBessTs = eSharedGseRenewable * (1 - fSolarRen);
                                }

                                // CER GSE Incentives (TIAD + TIP accredited to CER)
                                const cacv_t = cerTras + cPR * (pricePUN * currentRidDecay);
                                const variablePortion = Math.min(State.inputs.cerVarMax || 40, Math.max(0, (State.inputs.cerVarReferencePrice || 180) - (pricePUN * currentRidDecay)));
                                const tip_t = Math.min(cap, fissa + variablePortion + geoCorr) * factorPNRR;
                                const priceCER_kWh = (cacv_t + tip_t) / 1000;
                                yCerGseIncentive += (eSharedGseSolar + eSharedGseBessTs) * priceCER_kWh;

                                // 3. SPV Private PPA Contract
                                if (yr <= ppaDuration) {
                                    const privatePpaPrice_kWh = (stab.ppaPrice || 0) / 1000;
                                    let ePrivateSolar = 0;
                                    let ePrivateBessArb = 0;
                                    let ePrivateBessTs = 0;

                                    if (cerShareType === 'total_generation') {
                                        ePrivateSolar = gridFeedPv;
                                        ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                                        ePrivateBessTs = hourlyTsPhys;
                                    } else {
                                        // Use the priority-based allocation
                                        ePrivateSolar = eSharedGseSolar;
                                        ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                                        ePrivateBessTs = eSharedGseBessTs;
                                    }
                                    const ePrivateBess = ePrivateBessTs + ePrivateBessArb;

                                    solarPpaRev += ePrivateSolar * privatePpaPrice_kWh;
                                    bessPpaRev += ePrivateBess * privatePpaPrice_kWh;
                                    bessPpaRevArb += ePrivateBessArb * privatePpaPrice_kWh;
                                    bessPpaRevTs += ePrivateBessTs * privatePpaPrice_kWh;

                                    pPhysSolarPpa += ePrivateSolar / 1000;
                                    pPhysBessSelfCons += ePrivateBess / 1000;
                                    pPhysBessSelfConsArb += ePrivateBessArb / 1000;
                                    pPhysBessSelfConsTs += ePrivateBessTs / 1000;
                                }
                                
                                pPhysSolarRid += gridFeedPv / 1000;
                            }
                            let sumDischGrid = 0;
                            if (plantSim && plantSim.hourlyDischargeGrid) {
                                for (let i = hStart; i < hEnd; i++) sumDischGrid += plantSim.hourlyDischargeGrid[i];
                            }
                            pPhysBessGridFeed = (sumDischGrid / 1000 * bessDegradationMult) - pPhysBessSelfCons;
                        } else {
                            // Standard PPA or RID calculation
                            if (isFullYear) {
                                pPhysSolarGen = (plant._physSolarGenMwhY1 || 0) * solarDegradation;
                                pPhysSolarToBess = (plant._physSolarToBessMwhY1 || 0) * bessDegradationMult;
                                if (yr <= ppaDuration) {
                                    pPhysSolarPpa = (plant._physSolarPpaMwhY1 || 0) * solarDegradation;
                                }
                                pPhysSolarRid = Math.max(0, pPhysSolarGen - pPhysSolarPpa - pPhysSolarToBess);

                                if (plant.marketType === 'brp') {
                                    // Per BRP ricalcolo orario esatto con fee dinamiche del mese/anno yr e prezzo puntuale di scarica
                                    solarRidRev = 0;
                                    timeshiftingRev = 0;
                                    arbitrageRev = 0;
                                    solarPpaRev = (yr <= ppaDuration) ? (plant._solarPpaRevY1 || 0) * solarDegradation : 0;
                                    bessPpaRev = (yr <= ppaDuration) ? (plant._bessPpaRevY1 || 0) * bessDegradationMult : 0;
                                    pPhysBessSelfCons = (yr <= ppaDuration) ? (plant._physBessSelfConsMwhY1 || 0) * bessDegradationMult : 0;
                                    pPhysBessGridFeed = (plant._physBessGridFeedMwhY1 || 0) * bessDegradationMult;
                                    
                                    const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                                    const loadProfile = (stab && stab.ppaType === 'on-site' && stab.load) ? stab.load : null;
                                    const isOffsiteBrp = (stab && stab.ppaType === 'off-site');
                                    for (let t = 0; t < 8760; t++) {
                                        const fee = getBrpFeeForMonth(plant, yr, getMonthOfHour(t));
                                        const pricePUN = zonePrices[t];
                                        const basePriceBrp = (pricePUN + fee) * lossMult / 1000;
                                        const priceRID = basePriceBrp * currentRidDecay;
                                        const priceTs = basePriceBrp * currentTimeshiftingDecay;
                                        const priceArb = basePriceBrp * currentArbitrageDecay;
                                        
                                        if (!isOffsiteBrp || yr > ppaDuration) {
                                            const solarGridFeedHourly = Math.max(0, plant.generation[t] - (loadProfile ? Math.min(plant.generation[t], loadProfile[t]) : 0) - (plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0));
                                            solarRidRev += solarGridFeedHourly * solarDegradation * priceRID;
                                        }
                                        
                                        const tsDischHourly = (plantSim && plantSim.hourlyDischargeTimeshifting) ? (plantSim.hourlyDischargeTimeshifting[t] || 0) : 0;
                                        const arbDischHourly = (plantSim && plantSim.hourlyDischargeArbitrage) ? (plantSim.hourlyDischargeArbitrage[t] || 0) : 0;
                                        timeshiftingRev += tsDischHourly * bessDegradationMult * priceTs;
                                        arbitrageRev += arbDischHourly * bessDegradationMult * priceArb;
                                        
                                        if (yr > ppaDuration && (plantSim.hourlySelfCons && plantSim.hourlyChargeSolar)) {
                                            // BESS PPA becomes BESS RID after PPA expires
                                            const actualPpa = plantSim.hourlySelfCons[t];
                                            const baseSolarPpa = loadProfile ? Math.min(plant.generation[t], loadProfile[t]) : 0;
                                            timeshiftingRev += (actualPpa - baseSolarPpa) * bessDegradationMult * priceTs;
                                            pPhysBessGridFeed += (actualPpa - baseSolarPpa) * bessDegradationMult / 1000;
                                        }
                                    }
                                    pBessGridChargingCost = (plant._arbitrageCostY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                                    
                                } else {
                                    if (yr <= ppaDuration) {
                                        solarRidRev = (plant._solarRidRevY1 || 0) * solarDegradation * currentRidDecay;
                                        solarPpaRev = (plant._solarPpaRevY1 || 0) * solarDegradation;
                                        bessPpaRev = (plant._bessPpaRevY1 || 0) * bessDegradationMult;
                                        timeshiftingRev = (plant._timeshiftingRevY1 || 0) * bessDegradationMult * currentTimeshiftingDecay;
                                        arbitrageRev = (plant._arbitrageRevY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                                        pPhysBessSelfCons = (plant._physBessSelfConsMwhY1 || 0) * bessDegradationMult;
                                        pPhysBessGridFeed = (plant._physBessGridFeedMwhY1 || 0) * bessDegradationMult;
                                    } else {
                                        solarPpaRev = 0;
                                        bessPpaRev = 0;
                                        solarRidRev = pPhysSolarRid * ridPriceYr;
                                        timeshiftingRev = (plant._timeshiftingRevY1 || 0) * bessDegradationMult * currentTimeshiftingDecay;
                                        arbitrageRev = (plant._arbitrageRevY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                                        const bessPpaMwhYr = (plant._bessSelfConsMwhY1 || 0) * bessDegradationMult;
                                        timeshiftingRev += bessPpaMwhYr * ridPriceYr;
                                        pPhysBessSelfCons = 0;
                                        pPhysBessGridFeed = ((plant._physBessSelfConsMwhY1 || 0) + (plant._physBessGridFeedMwhY1 || 0)) * bessDegradationMult;
                                    }
                                    pBessGridChargingCost = (plant._arbitrageCostY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                                }
                            } else {
                                // Partial year (COD happens in this year): exact hourly integration from hStart to hEnd
                                const zonePrices = effectiveZonalPun[String(plant.zone).toUpperCase()] || effectiveZonalPun["CNOR"];
                                const loadProfile = (stab && stab.ppaType === 'on-site' && stab.load) ? stab.load : null;
                                const isOffsite = (stab && stab.ppaType === 'off-site');
                                const ppaPrice = (stab && stab.ppaPrice !== undefined) ? stab.ppaPrice : 0;
                                const ppaPrice_kWh = ppaPrice / 1000;

                                for (let t = hStart; t < hEnd; t++) {
                                    const solar = plant.generation[t] * solarDegradation;
                                    pPhysSolarGen += solar / 1000;
                                    const pricePUN = zonePrices[t];
                                    const month = getMonthOfHour(t);
                                    const traderPrice = plant.traderContractType === 'pun_medio' ? plant._monthlyAveragePun[month] : pricePUN;
                                    const costGrid = ((traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000) * currentArbitrageDecay;
                                    
                                    const basePrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) 
                                        : (plant.marketType === 'brp') ? ((pricePUN + getBrpFeeForMonth(plant, yr, month)) * lossMult / 1000)
                                        : ((pricePUN * lossMult - gseImb) / 1000);
                                    const priceRID = basePrice * currentRidDecay;

                                    const chargeSolar = (plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0) * bessDegradationMult;
                                    pPhysSolarToBess += chargeSolar / 1000;
                                    const gridCharge = (plantSim.hourlyChargeGrid[t] || 0) * bessDegradationMult;
                                    const actualPpa = (plantSim.hourlySelfCons ? plantSim.hourlySelfCons[t] : 0) * bessDegradationMult;
                                    const actualRid = (plantSim.hourlyGridFeed ? plantSim.hourlyGridFeed[t] : 0) * bessDegradationMult;

                                    if (isOffsite) {
                                        if (yr <= ppaDuration) {
                                            solarPpaRev += (solar / 1000) * ppaPrice;
                                            pPhysSolarPpa += solar / 1000;
                                        } else {
                                            solarRidRev += solar * priceRID;
                                            pPhysSolarRid += solar / 1000;
                                        }
                                        const hourlyArb = (plantSim.hourlyRevenueArbitrageGrid[t] || 0) * bessDegradationMult * currentArbitrageDecay;
                                        const bessTotalHourly = (actualRid - solar) * priceRID;
                                        arbitrageRev += hourlyArb;
                                        timeshiftingRev += (bessTotalHourly - hourlyArb);
                                        pBessGridChargingCost += gridCharge * costGrid;
                                    } else {
                                        const baseSolarPpa = loadProfile ? Math.min(solar, loadProfile[t]) : 0;
                                        const actualSolarGridFeed = Math.max(0, solar - baseSolarPpa - chargeSolar);

                                        if (yr <= ppaDuration) {
                                            solarPpaRev += baseSolarPpa * ppaPrice_kWh;
                                            pPhysSolarPpa += baseSolarPpa / 1000;
                                            const bessPpaHourly = Math.max(0, actualPpa - baseSolarPpa);
                                            bessPpaRev += bessPpaHourly * ppaPrice_kWh;
                                            pPhysBessSelfCons += bessPpaHourly / 1000;
                                        } else {
                                            solarRidRev += baseSolarPpa * priceRID;
                                            pPhysSolarRid += baseSolarPpa / 1000;
                                            const bessPpaHourly = Math.max(0, actualPpa - baseSolarPpa);
                                            timeshiftingRev += bessPpaHourly * priceRID;
                                        }

                                        solarRidRev += actualSolarGridFeed * priceRID;
                                        pPhysSolarRid += actualSolarGridFeed / 1000;

                                        const hourlyTs = (plantSim.hourlyRevenueTimeshifting[t] || 0) * bessDegradationMult * currentTimeshiftingDecay;
                                        const hourlyArb = (plantSim.hourlyRevenueArbitrageGrid[t] || 0) * bessDegradationMult * currentArbitrageDecay;
                                        timeshiftingRev += hourlyTs;
                                        arbitrageRev += hourlyArb;
                                        pBessGridChargingCost += gridCharge * costGrid;
                                    }
                                }

                                let sumDischGrid = 0;
                                if (plantSim && plantSim.hourlyDischargeGrid) {
                                    for (let i = hStart; i < hEnd; i++) sumDischGrid += plantSim.hourlyDischargeGrid[i];
                                }
                                pPhysBessGridFeed = Math.max(0, (sumDischGrid / 1000 * bessDegradationMult) - pPhysBessSelfCons);
                            }
                        }

                        if (!(stab && stab.ppaType === 'cer')) {
                            pPhysBessSelfConsTs = pPhysBessSelfCons;
                        }
                        let sumDischArb = 0, sumDischTs = 0;
                        if (plantSim && plantSim.hourlyDischargeArbitrage) {
                            for (let i = hStart; i < hEnd; i++) sumDischArb += plantSim.hourlyDischargeArbitrage[i];
                        }
                        if (plantSim && plantSim.hourlyDischargeTimeshifting) {
                            for (let i = hStart; i < hEnd; i++) sumDischTs += plantSim.hourlyDischargeTimeshifting[i];
                        }
                        const totalDischArb = (sumDischArb / 1000) * bessDegradationMult;
                        const totalDischTs = (sumDischTs / 1000) * bessDegradationMult;
                        pPhysBessGridFeedArb = Math.max(0, totalDischArb - pPhysBessSelfConsArb);
                        pPhysBessGridFeedTs = Math.max(0, totalDischTs - pPhysBessSelfConsTs);
                    }

                    // Reconstruct helper variables for service contract and earn-out compatibility
                    const bessRidRev = timeshiftingRev + arbitrageRev;

                    yOpexGridCharging += pBessGridChargingCost;
                    
                    const plantBessCAPEX = plantBessMwh * 1000 * plantBessCapexKwh;
                    let pBessOpex = 0;
                    if (plantBessMwh > 0 && isActive) {
                        if (plant.opexOmBess !== undefined && plant.opexOmBess > 0) {
                            pBessOpex = plant.opexOmBess * inflationMultiplier;
                        } else {
                            pBessOpex = plantBessCAPEX * 0.015 * inflationMultiplier;
                        }
                    }
                    const pMaintReserve = (plantBessMw > 0 && plantBessType !== 'graphene' && isActive) ? (4000 * (plant.capacity / 1000) * inflationMultiplier) : 0;

                    // Calculate PPA Service Contract for this plant in year yr (if within duration)
                    let pOpexServiceContract = 0;
                    const serviceYears = plant.serviceYears !== undefined ? plant.serviceYears : 0;
                    if (yr > 0 && yr <= serviceYears) {
                        if (plant.serviceType === 'ppa_rev_pct') {
                            pOpexServiceContract = (plant.serviceVal / 100) * (solarPpaRev + bessPpaRev);
                        } else if (plant.serviceType === 'shared_ppa_mwh') {
                            const pSelfConsMwh = pPhysSolarPpa + pPhysBessSelfCons;
                            pOpexServiceContract = plant.serviceVal * pSelfConsMwh;
                        }
                    }
                    yOpexServiceContract += pOpexServiceContract;

                    // Calculate HoldCo Earn-Out for this plant in year yr (if within duration)
                    let pHoldcoEarnoutPaid = 0;
                    const earnoutYears = plant.earnoutYears !== undefined ? plant.earnoutYears : 0;
                    if (yr > 0 && yr <= earnoutYears) {
                        if (plant.earnoutType === 'fixed') {
                            pHoldcoEarnoutPaid = plant.earnoutVal * inflationMultiplier;
                        } else if (plant.earnoutType === 'rid_pct') {
                            pHoldcoEarnoutPaid = (plant.earnoutVal / 100) * (solarRidRev + bessRidRev);
                        } else if (plant.earnoutType === 'total_rev_pct') {
                            pHoldcoEarnoutPaid = (plant.earnoutVal / 100) * (solarRidRev + solarPpaRev + bessRidRev + bessPpaRev);
                        } else if (plant.earnoutType === 'grid_feed_mwh') {
                            const pGridFeedMwh = pPhysSolarRid + pPhysBessGridFeed;
                            pHoldcoEarnoutPaid = plant.earnoutVal * pGridFeedMwh;
                        } else if (plant.earnoutType === 'generation_mwh') {
                            pHoldcoEarnoutPaid = plant.earnoutVal * pSolarMwh;
                        }
                    }
                    yHoldcoEarnoutPaid += pHoldcoEarnoutPaid;

                    ySolarMwh += pSolarMwh;
                    yShiftedMwh += pShiftedMwh;
                    yRevenueRid += solarRidRev;
                    yRevenuePpa += (solarPpaRev + bessPpaRev);
                    yRevenuePpaPv += solarPpaRev;
                    yBessPpaRevArb += bessPpaRevArb;
                    yBessPpaRevTs += bessPpaRevTs;
                    yRevenueTimeshifting += timeshiftingRev;
                    yRevenueArbitrage += arbitrageRev;
                    yBessOpex += pBessOpex;
                    yMaintReserve += pMaintReserve;

                    // Accumulate physical metrics
                    let pPhysBessDischarge = 0;
                    let pPhysBessChargeGrid = 0;
                    let pPhysBessLosses = 0;
                    if (isActive) {
                        if (isFullYear) {
                            pPhysBessDischarge = (plant._physBessDischargeMwhY1 || 0) * bessDegradationMult;
                            pPhysBessChargeGrid = (plant._physBessChargeGridMwhY1 || 0) * bessDegradationMult;
                            pPhysBessLosses = (plant._physBessLossesMwhY1 || 0) * bessDegradationMult;
                        } else {
                            let sDisch = 0, sChGrid = 0, sLoss = 0;
                            if (plantSim) {
                                if (plantSim.hourlyDischarge) {
                                    for (let i = hStart; i < hEnd; i++) sDisch += plantSim.hourlyDischarge[i];
                                }
                                if (plantSim.hourlyChargeGrid) {
                                    for (let i = hStart; i < hEnd; i++) sChGrid += plantSim.hourlyChargeGrid[i];
                                }
                                if (plantSim.hourlyLossesRte) {
                                    for (let i = hStart; i < hEnd; i++) sLoss += plantSim.hourlyLossesRte[i];
                                }
                            }
                            pPhysBessDischarge = (sDisch / 1000) * bessDegradationMult;
                            pPhysBessChargeGrid = (sChGrid / 1000) * bessDegradationMult;
                            pPhysBessLosses = (sLoss / 1000) * bessDegradationMult;
                        }
                    }

                    yQtySolarGen += pPhysSolarGen;
                    yQtySolarPpa += pPhysSolarPpa;
                    yQtySolarRid += pPhysSolarRid;
                    yQtySolarToBess += pPhysSolarToBess;
                    
                    yQtyBessDischarge += pPhysBessDischarge;
                    yQtyBessSelfCons += pPhysBessSelfCons;
                    yQtyBessSelfConsArb += pPhysBessSelfConsArb;
                    yQtyBessSelfConsTs += pPhysBessSelfConsTs;
                    yQtyBessGridFeed += pPhysBessGridFeed;
                    yQtyBessGridFeedArb += pPhysBessGridFeedArb;
                    yQtyBessGridFeedTs += pPhysBessGridFeedTs;
                    yQtyBessChargeGrid += pPhysBessChargeGrid;
                    yQtyBessLosses += pPhysBessLosses;

                    // Accumulate correct energy quantities (avoid double counting shared energy in CER)
                    const isPlantCer = plant._stab && plant._stab.ppaType === 'cer';
                    const plantSolarQty = isPlantCer ? pPhysSolarRid : (pPhysSolarPpa + pPhysSolarRid);
                    yQtyEnergyGroup += (plantSolarQty + pPhysBessDischarge);
                    yQtySolarAvgDen += plantSolarQty;

                    ySolarPpaRev += solarPpaRev;
                    ySolarRidRev += solarRidRev;
                    yBessPpaRev += bessPpaRev;
                    yBessTimeshiftingRev += timeshiftingRev;
                    yBessArbitrageRev += arbitrageRev;
                    yBessGridChargingCost += pBessGridChargingCost;

                    yLcoeEnergyTotal += (pSolarMwh - (pShiftedMwh * (1 - plantBessEfficiency)));
                    yLcosEnergyTotal += pShiftedMwh;
                    yLcosCostsTotal += pBessOpex;
                    
                    const opexCalYear = (yr === 0 || anchorYear === null) ? ((anchorYear || 2027) - 1) : (anchorYear + yr - 1);
                    const plantOpexEvents = (State.opexEvents && State.opexEvents[plant.id]) || [];

                    const eventSums = {
                        opexPlants: 0,
                        opexBess: 0,
                        opexInsurance: 0,
                        opexTaxes: 0,
                        opexSecurity: 0,
                        opexAssetManagement: 0,
                        landDdsAnnuo: 0
                    };
                    const hasEventCat = {
                        opexPlants: false,
                        opexBess: false,
                        opexInsurance: false,
                        opexTaxes: false,
                        opexSecurity: false,
                        opexAssetManagement: false,
                        landDdsAnnuo: false
                    };

                    plantOpexEvents.forEach(ev => {
                        if (ev.enabled === false) return;
                        const amt = parseFloat(ev.amount) || 0;
                        if (!(amt > 0)) return;
                        const cat = classifyOpexLabel(ev.label);
                        hasEventCat[cat] = true;

                        const m = parseInt(ev.month, 10);
                        const rule = (ev.rule === 'gt_cod' || ev.rule === 'lt_cod') ? ev.rule : 'sempre';
                        let active = true;
                        if (rule === 'gt_cod' && plant._codParsed) {
                            active = (opexCalYear > plant._codParsed.y) || (opexCalYear === plant._codParsed.y && m > plant._codParsed.m);
                        } else if (rule === 'lt_cod' && plant._codParsed) {
                            active = (opexCalYear < plant._codParsed.y) || (opexCalYear === plant._codParsed.y && m < plant._codParsed.m);
                        } else if (rule === 'gt_cod' && !plant._codParsed) {
                            active = yr > 1;
                        } else if (rule === 'lt_cod' && !plant._codParsed) {
                            active = yr === 0;
                        }
                        if (active) {
                            eventSums[cat] += amt * (yr === 0 ? 1.0 : inflationMultiplier);
                        }
                    });

                    let pOpexPlants = 0;
                    if (hasEventCat.opexPlants) {
                        pOpexPlants = eventSums.opexPlants;
                    } else {
                        pOpexPlants = yr === 0 ? 0 : (((plant.opex || 0) + (plant.customOpexEur || 0)) * inflationMultiplier);
                    }

                    let pOpexInsurance = 0;
                    if (hasEventCat.opexInsurance) {
                        pOpexInsurance = eventSums.opexInsurance;
                    } else {
                        pOpexInsurance = yr === 0 ? 0 : ((plant.opexInsurance || 0) * inflationMultiplier);
                    }

                    let pOpexSecurity = 0;
                    if (hasEventCat.opexSecurity) {
                        pOpexSecurity = eventSums.opexSecurity;
                    } else {
                        pOpexSecurity = yr === 0 ? 0 : ((plant.opexSecurity || 0) * inflationMultiplier);
                    }

                    let pOpexAssetManagement = 0;
                    if (hasEventCat.opexAssetManagement) {
                        pOpexAssetManagement = eventSums.opexAssetManagement;
                    } else {
                        pOpexAssetManagement = yr === 0 ? 0 : ((plant.opexAssetManagement || 0) * inflationMultiplier);
                    }

                    let pOpexTaxes = 0;
                    if (hasEventCat.opexTaxes) {
                        pOpexTaxes = eventSums.opexTaxes;
                    } else {
                        pOpexTaxes = yr === 0 ? 0 : ((plant.opexTaxes || 0) * inflationMultiplier);
                    }

                    let pLandDdsAnnuo = 0;
                    if (hasEventCat.landDdsAnnuo) {
                        pLandDdsAnnuo = eventSums.landDdsAnnuo;
                    } else {
                        pLandDdsAnnuo = (plant.landType === 'dds_annuo' ? (plant.landCost || 0) : 0) * (yr === 0 ? 1.0 : inflationMultiplier);
                    }

                    let pOpexBess = pBessOpex;
                    if (hasEventCat.opexBess) {
                        pOpexBess = eventSums.opexBess;
                    }

                    yOpexPlants += pOpexPlants;
                    yOpexInsurance += pOpexInsurance;
                    yOpexTaxes += pOpexTaxes;
                    yOpexSecurity += pOpexSecurity;
                    yOpexAssetManagement += pOpexAssetManagement;
                    yLandDdsAnnuoFee += pLandDdsAnnuo;

                    const pOpexTotal = pOpexPlants + pOpexBess + pBessGridChargingCost + pLandDdsAnnuo + pOpexInsurance + pOpexTaxes + pOpexSecurity + pOpexAssetManagement + pOpexServiceContract;
                    
                    let plantBessAugActual = 0;
                    if (yr === 10 && plantBessMw > 0 && plantBessType !== 'graphene') {
                        plantBessAugActual = (plantBessMwh * 1000 * plantBessCapexKwh) * 0.50;
                        plant._bessAugCost = plantBessAugActual;
                        plant._remainingBessAugCivil += plantBessAugActual;
                        plant._remainingTaxBessAug += plantBessAugActual;
                    }
                    
                    let pDeprSolar = 0;
                    let pDeprBessBase = 0;
                    let pDeprBessAug = 0;
                    let pDeprOther = 0;
                    let pDeprTax = 0;
                    let pDeprTaxBessAug = 0;

                    if (yr > 0) {
                        const avail = codYearAvailability(plant._codParsed, opexCalYear);
                        if (avail > 0) {
                            pDeprSolar = Math.min(plant._baseSolarCivil * p.fiscalDeprRate * avail, plant._remainingSolarCivil);
                            plant._remainingSolarCivil -= pDeprSolar;

                            pDeprBessBase = Math.min(plant._baseBessCivil * p.fiscalDeprRate * avail, plant._remainingBessCivil);
                            plant._remainingBessCivil -= pDeprBessBase;

                            pDeprOther = Math.min(plant._baseOtherCivil * p.fiscalDeprRate * avail, plant._remainingOtherCivil);
                            plant._remainingOtherCivil -= pDeprOther;

                            // Fiscale ex Art. 102 c. 2 TUIR: primo esercizio di entrata in funzione al 50%
                            const isFirstFunctionYear = (plant._codParsed && opexCalYear === plant._codParsed.y) || (!plant._codParsed && yr === 1);
                            const taxRate = isFirstFunctionYear ? (p.fiscalDeprRate / 2) : p.fiscalDeprRate;
                            pDeprTax = Math.min(plant._baseTax * taxRate, plant._remainingTax);
                            plant._remainingTax -= pDeprTax;
                        }

                        if (yr > 10 && plant._remainingBessAugCivil > 0) {
                            pDeprBessAug = Math.min(plant._bessAugCost / 10, plant._remainingBessAugCivil);
                            plant._remainingBessAugCivil -= pDeprBessAug;
                        }
                        if (yr > 10 && plant._remainingTaxBessAug > 0) {
                            pDeprTaxBessAug = Math.min(plant._bessAugCost * p.fiscalDeprRate, plant._remainingTaxBessAug);
                            plant._remainingTaxBessAug -= pDeprTaxBessAug;
                        }
                    }

                    const pDeprBess = pDeprBessBase + pDeprBessAug;
                    const pDeprCivilTotal = pDeprSolar + pDeprBess + pDeprOther;

                    yDeprSolar += pDeprSolar;
                    yDeprBess += pDeprBess;
                    yDeprOther += pDeprOther;
                    yDepreciationCivil += pDeprCivilTotal;
                    totalAnnualDepreciationFiscal += (pDeprTax + pDeprTaxBessAug);
                    totalAnnualDepreciationFiscalBase += pDeprTax;
                    totalFiscalRemaining += plant._remainingTax;

                    opexBreakdown[pIdx].years.push({
                        opexTotal: pOpexTotal,
                        deprCivil: pDeprCivilTotal,
                        deprCivilSolar: pDeprSolar,
                        deprCivilBess: pDeprBess,
                        deprCivilOther: pDeprOther,
                        opexPlants: pOpexPlants,
                        opexBess: pOpexBess,
                        opexGridCharging: pBessGridChargingCost,
                        opexInsurance: pOpexInsurance,
                        opexTaxes: pOpexTaxes,
                        opexSecurity: pOpexSecurity,
                        opexAssetManagement: pOpexAssetManagement,
                        opexServiceContract: pOpexServiceContract,
                        maintReserve: pMaintReserve,
                        landDdsAnnuo: pLandDdsAnnuo
                    });

                });

                // Ricavi servizi ancillari BESS (MSD / Capacity Market): €/MW/anno × potenza BESS, indicizzati
                const yRevenueMsd = yr === 0 ? 0 : (totalBessMw * (p.msdEurMwYr || 0) * inflationMultiplier);
                const yRevenueTotal = yRevenueRid + yRevenuePpa + yRevenueTimeshifting + yRevenueArbitrage + yRevenueMsd;
                
                // ── External financing opex (PE royalty_fee / AF advisory_fee) — costi SPV deducibili ──
                let yPeRoyalty = 0;   // PE royalty_fee: % ricavi SPV (parasociale)
                if (yr > 0 && p.peEnabled && p.peMode === 'royalty_fee') {
                    yPeRoyalty = yRevenueTotal * ((p.peRoyaltyPct || 0) / 100);
                }
                let yAfFee = 0;      // AF advisory_fee: importo fisso + (% ricavi) inflazione
                if (yr > 0 && p.afEnabled && p.afType === 'advisory_fee') {
                    const fixedPart = (p.afAnnualAmount || 0) * inflationMultiplier;
                    const revPart = yRevenueTotal * ((p.afRevenuePct || 0) / 100);
                    yAfFee = fixedPart + revPart;
                }
                
                // EBITDA (including all opex components)
                const yOpexTotal = yOpexPlants + yBessOpex + yOpexGridCharging + yLandDdsAnnuoFee + yOpexInsurance + yOpexTaxes + yOpexSecurity + yOpexAssetManagement + yOpexServiceContract + yPeRoyalty + yAfFee;
                const yEbitda = yRevenueTotal - yOpexTotal;
                totalEbitda += yEbitda;

                // Provisions & Maintenance reserve
                let mraBeginning = mraBalance;
                let yInterestActive = mraBeginning * 0.015;
                
                let yBessAugmentationActual = 0;
                let mraRelease = 0;
                if (yr === 10 && bessAugmentationCost > 0) {
                    yBessAugmentationActual = bessAugmentationCost;
                    mraRelease = Math.min(mraBeginning + yMaintReserve, yBessAugmentationActual);
                    remainingBessAugmentationFiscal = yBessAugmentationActual;
                    remainingBessAugCivil = yBessAugmentationActual;
                }
                mraBalance = mraBeginning + yMaintReserve - mraRelease;

                // Civil Depreciation (OIC 16) e Fiscal Depreciation (Art. 102 TUIR)
                // sono già calcolati analiticamente per ciascun impianto nel loop activePlants sopra.

                // ── Refinancing / Miniperm: al refiYear il debito residuo è rimborsato con un
                // nuovo finanziamento (payoff balloon + nuova erogazione, netto cassa zero),
                // con nuovo tasso e nuovo piano di ammortamento ──
                if (refiYear > 0 && yr === refiYear && remainingDebt > 0) {
                    const r2 = (p.refiInterestRate || 0) / 100;
                    const t2 = Math.max(1, parseInt(p.refiLoanTerm) || 10);
                    activeRate = r2;
                    activeMaturity = Math.min(20, yr - 1 + t2);
                    const i_m2 = r2 / mDebt;
                    const nPeriods2 = Math.max(1, Math.round(t2 * mDebt));
                    activePeriodicAnnuity = (i_m2 > 0)
                        ? remainingDebt * (i_m2 * Math.pow(1 + i_m2, nPeriods2)) / (Math.pow(1 + i_m2, nPeriods2) - 1)
                        : remainingDebt / nPeriods2;
                    activeAnnuity = activePeriodicAnnuity * mDebt;
                }

                // Portfolio availability for debt in year yr
                let portfolioDebtAvail = 1.0;
                if (anchorYear !== null) {
                    const calYear = anchorYear + yr - 1;
                    let sumCapex = 0;
                    let weightedAvailSum = 0;
                    activePlants.forEach(plant => {
                        const pCapex = (plant._baseSolarCivil || 0) + (plant._baseBessCivil || 0) + (plant._baseOtherCivil || 0) || (plant.capacity || 1);
                        const pAvail = codYearAvailability(plant._codParsed, calYear);
                        sumCapex += pCapex;
                        weightedAvailSum += pCapex * pAvail;
                    });
                    portfolioDebtAvail = sumCapex > 0 ? (weightedAvailSum / sumCapex) : 1.0;
                    if (yr === 1) y1DebtAvail = portfolioDebtAvail;
                }

                // Debt Interest & Amortization (Dynamic Grace Period, COD-Awareness & Periodic Repayment)
                let yInterest = 0, yPrincipalScheduled = 0, yPrincipalVoluntary = 0, yDebtServiceScheduled = 0;
                if (yr > 0 && p.loanTerm > 0 && yr <= activeMaturity && remainingDebt > 0) {
                    if (portfolioDebtAvail > 0) {
                        const i_m = activeRate / mDebt;
                        let curDebtYear = remainingDebt;
                        let sumIntYear = 0;
                        let sumPrinYear = 0;

                        if (portfolioDebtAvail >= 0.999) {
                            for (let per = 0; per < mDebt; per++) {
                                const int_p = curDebtYear * i_m;
                                let prin_p = 0;
                                const graceInP = Math.min(remainingGraceYears, 1 / mDebt);
                                remainingGraceYears = Math.max(0, remainingGraceYears - graceInP);
                                const amortInP = Math.max(0, (1 / mDebt) - graceInP) * mDebt;
                                if (amortInP > 0) {
                                    const amortInt = curDebtYear * i_m * amortInP;
                                    prin_p = Math.min(curDebtYear, Math.max(0, (activePeriodicAnnuity * amortInP) - amortInt));
                                    curDebtYear = Math.max(0, curDebtYear - prin_p);
                                }
                                sumIntYear += int_p;
                                sumPrinYear += prin_p;
                            }
                            yInterest = sumIntYear;
                            yPrincipalScheduled = sumPrinYear;
                        } else {
                            // Anno 1 con COD infra-annuale (pro-rata temporis per i periodi post-COD)
                            const fracPostCod = portfolioDebtAvail;
                            for (let per = 0; per < mDebt; per++) {
                                const pStart = per / mDebt;
                                const pEnd = (per + 1) / mDebt;
                                const codCutoff = 1 - fracPostCod;
                                const activeFrac = Math.max(0, Math.min(pEnd, 1) - Math.max(pStart, codCutoff)) * mDebt;
                                if (activeFrac > 0) {
                                    const int_p = curDebtYear * i_m * activeFrac;
                                    let prin_p = 0;
                                    if (remainingGraceYears > 0.001) {
                                        const graceUsed = Math.min(remainingGraceYears, (1 / mDebt) * activeFrac);
                                        remainingGraceYears = Math.max(0, remainingGraceYears - graceUsed);
                                    } else {
                                        prin_p = Math.min(curDebtYear, Math.max(0, (activePeriodicAnnuity * activeFrac) - int_p));
                                        curDebtYear = Math.max(0, curDebtYear - prin_p);
                                    }
                                    sumIntYear += int_p;
                                    sumPrinYear += prin_p;
                                }
                            }
                            yInterest = sumIntYear;
                            yPrincipalScheduled = sumPrinYear;
                        }
                    } else {
                        // Anno pre-COD intero (es. COD in anno 2): tutti gli interessi sono IDC capitalizzati in CAPEX
                        yInterest = 0;
                        yPrincipalScheduled = 0;
                    }
                    yDebtServiceScheduled = yInterest + yPrincipalScheduled;
                }

                let yBeginningShareholderLoan = remainingShareholderLoan;
                let ySociInterestAccrued = (yr > 0 && p.sociInterestRate > 0 && yr > p.sociInterestGrace)
                    ? (remainingShareholderLoan * (p.sociInterestRate / 100))
                    : 0;

                // ── Private Debt interest & principal (external mezzanine at Holding level) ──
                let yPdInterestAccrued = 0;
                let yPdInterestPaid = 0;
                let yPdPrincipalPaid = 0;
                let yPdBulletPayoff = 0;
                let remainingPdBeforeExit = remainingPd;
                const pdIsExitYear = (exitOptionYear > 0 && yr === exitOptionYear) || yr === exitYear;
                if (yr > 0 && p.pdEnabled && pdAmount > 0) {
                    if (p.pdMode === 'bullet_exit') {
                        // PIK composto: interessi capitalizzati sul saldo (grazia = anni senza accrual)
                        if (yr > (p.pdInterestGrace || 0)) {
                            yPdInterestAccrued = remainingPd * ((p.pdInterestRate || 0) / 100);
                            remainingPd += yPdInterestAccrued;
                        }
                        remainingPdBeforeExit = remainingPd;
                        if (pdIsExitYear) {
                            yPdBulletPayoff = remainingPd; // payoff gestito in sezione exit
                            remainingPd = 0;
                        }
                    } else if (p.pdMode === 'annual_interest') {
                        if (yr > (p.pdInterestGrace || 0)) {
                            yPdInterestAccrued = remainingPd * ((p.pdInterestRate || 0) / 100);
                            yPdInterestPaid = yPdInterestAccrued; // interessi pagati in cassa annualmente
                        }
                        remainingPdBeforeExit = remainingPd;
                        // Capitale bullet a exit (o a loanTerm): payoff gestito in sezione exit
                        if (pdIsExitYear && remainingPd > 0) {
                            yPdBulletPayoff = remainingPd;
                            remainingPd = 0;
                        }
                    } else if (p.pdMode === 'amortizing') {
                        if (pdIsExitYear && remainingPd > 0) {
                            // Anno di exit: payoff bullet del saldo residuo. NON pagare anche la rata
                            // annua (sostituita dal bullet), altrimenti doppio conteggio nel FCFE Holding.
                            yPdBulletPayoff = remainingPd;
                            yPdPrincipalPaid = 0;
                            // Interessi dell'anno exit ancora dovuti (maturati sul saldo inizio anno)
                            const yPdIntExit = (yr > (p.pdInterestGrace || 0)) ? remainingPd * ((p.pdInterestRate || 0) / 100) : 0;
                            yPdInterestAccrued = yPdIntExit;
                            yPdInterestPaid = yPdIntExit;
                            remainingPdBeforeExit = remainingPd;
                            remainingPd = 0;
                        } else if (yr <= (p.pdLoanTerm || 0)) {
                            const yPdInt = (yr > (p.pdInterestGrace || 0)) ? remainingPd * ((p.pdInterestRate || 0) / 100) : 0;
                            yPdInterestAccrued = yPdInt;
                            yPdInterestPaid = yPdInt;
                            if (yr > (p.pdPrincipalGrace || 0)) {
                                yPdPrincipalPaid = Math.min(remainingPd, Math.max(0, pdAmortizingAnnuality - yPdInt));
                            }
                            remainingPd = Math.max(0, remainingPd - yPdPrincipalPaid);
                            remainingPdBeforeExit = remainingPd;
                        }
                    }
                }
                // ── Altra Forma: convertible note (PIK composto) ──
                let yAfInterestAccrued = 0;
                if (yr > 0 && p.afEnabled && p.afType === 'convertible_note' && remainingAfConvertible > 0) {
                    yAfInterestAccrued = remainingAfConvertible * ((p.afConvertibleRate || 0) / 100);
                    remainingAfConvertible += yAfInterestAccrued;
                }
                const remainingAfBeforeExit = remainingAfConvertible;
                // Componenti deducibili (solo AF convertible; il PD ora è a livello Holding e NON entra nel CE SPV)
                const yPdDeductible = 0; // PD non è più costo SPV (gestito a livello Holding)
                const yAfDeductible = (p.afTaxDeductible !== false) ? yAfInterestAccrued : 0;

                // EBIT & EBT (PD rimosso: è debito Holding, non SPV)
                const yEbit = yEbitda - yDepreciationCivil;
                const yEbt = yEbit + yInterestActive - yInterest - ySociInterestAccrued - yAfDeductible;

                // LCOE & LCOS discounting
                // LCOE is Solar PV only, excluding BESS costs, opex, charging, and maintenance reserve
                const yLcoeOpex = yOpexTotal - yBessOpex - yOpexGridCharging;
                lcoeSumDiscountedCosts += (yLcoeOpex / Math.pow(1 + p.wacc, yr));
                lcoeSumDiscountedEnergy += (ySolarMwh / Math.pow(1 + p.wacc, yr));
                
                if (totalBessMwh > 0) {
                    // LCOS includes BESS Opex, BESS cell augmentation, BESS grid charging cost, and BESS maintenance reserve (MRA)
                    const yLcosCostsTotalWithCharging = yLcosCostsTotal + yOpexGridCharging + yMaintReserve;
                    lcosSumDiscountedCosts += ((yLcosCostsTotalWithCharging + yBessAugmentationActual) / Math.pow(1 + p.wacc, yr));
                    lcosSumDiscountedEnergy += (yLcosEnergyTotal / Math.pow(1 + p.wacc, yr));
                }

                // totalAnnualDepreciationFiscal (Art. 102 c. 2 TUIR) è già calcolato analiticamente
                // per ciascun impianto nel loop activePlants sopra.

                // --- INTEGRATED ART. 96 TUIR INTERMEDIATE TAX ENGINE ---
                const ebitdaFiscale = yEbitda;
                const currentRolCapacity = Math.max(0, ebitdaFiscale * 0.30);
                const totalRolAvailable = currentRolCapacity + rolCarriedForward;
                
                // Deduct interest expenses up to active interest revenues first (Art. 96)
                const netInterestExpenses = Math.max(0, (yInterest + ySociInterestAccrued + yAfDeductible) - yInterestActive);
                const deductibleNetInterest = Math.min(netInterestExpenses, totalRolAvailable);
                const totalDeductibleInterest = yInterestActive + deductibleNetInterest;
                
                interestExpensesCarriedForward = Math.max(0, (yInterest + ySociInterestAccrued + yAfDeductible + interestExpensesCarriedForward) - totalDeductibleInterest);
                rolCarriedForward = Math.max(0, totalRolAvailable - deductibleNetInterest);

                // IRAP — Base imponibile = EBIT civilistico (Art. 5 D.Lgs.446/97) + ripresa indeducibilità IMU e IDC civilistico
                const yCivilDepreciationIdc = depreciablePlantBaseCivil > 0 ? (yDepreciationCivil * (idcAmount / depreciablePlantBaseCivil)) : 0;
                const taxableIrap = Math.max(0, yEbit + yOpexTaxes + yCivilDepreciationIdc);
                const yIrapTax = taxableIrap * p.irapRate;

                // IRES (Deductible interest applied)
                const rawTaxableIresBeforeLoss = ebitdaFiscale + yInterestActive - totalDeductibleInterest - totalAnnualDepreciationFiscal;
                let rawTaxableIres = rawTaxableIresBeforeLoss;
                let yIresTax = 0;
                let appliedLossesTotal = 0;
                let appliedLossesFirst3Y = 0;
                let appliedLossesNormal = 0;
                if (rawTaxableIres > 0) {
                    // Art. 84 TUIR: First 3 years losses can offset 100% of taxable income
                    appliedLossesFirst3Y = Math.min(rawTaxableIres, taxLossCarriedForwardFirst3Y);
                    rawTaxableIres -= appliedLossesFirst3Y;
                    taxLossCarriedForwardFirst3Y -= appliedLossesFirst3Y;
                    
                    // Subsequent years losses can offset up to 80% of taxable income
                    const limit80 = rawTaxableIres * 0.8;
                    appliedLossesNormal = Math.min(limit80, taxLossCarriedForwardNormal);
                    rawTaxableIres -= appliedLossesNormal;
                    taxLossCarriedForwardNormal -= appliedLossesNormal;
                    
                    appliedLossesTotal = appliedLossesFirst3Y + appliedLossesNormal;
                    yIresTax = rawTaxableIres * p.iresRate;
                } else {
                    if (yr <= 3) {
                        taxLossCarriedForwardFirst3Y += Math.abs(rawTaxableIres);
                    } else {
                        taxLossCarriedForwardNormal += Math.abs(rawTaxableIres);
                    }
                }
                const taxLossCarriedForward = taxLossCarriedForwardFirst3Y + taxLossCarriedForwardNormal;

                const yCurrentTaxesSpv = yIrapTax + yIresTax;
                // OIC 25: Simmetria completa tra DTA (Attività per Imposte Anticipate, deferredTaxFund < 0)
                // e DTL (Fondo Imposte Differite, deferredTaxFund > 0) con riassorbimento integrale a fine ammortamento.
                let rawDeferredTaxes = (totalAnnualDepreciationFiscal - yDepreciationCivil) * (p.iresRate + p.irapRate);
                const unconstrainedDeferredTaxes = rawDeferredTaxes;
                deferredTaxFund += rawDeferredTaxes;
                if (Math.abs(deferredTaxFund) < 1e-6) deferredTaxFund = 0;
                const yDeferredTaxes = rawDeferredTaxes;
                const yCivilTaxes = yCurrentTaxesSpv + yDeferredTaxes;
                
                const yNetProfitSpv = yEbt - yCivilTaxes;

                // CFADS
                const yCfads = yNetProfitSpv
                    + yDepreciationCivil
                    + yDeferredTaxes
                    + yInterest
                    + ySociInterestAccrued
                    + yAfDeductible
                    - yMaintReserve
                    - yBessAugmentationActual
                    + mraRelease;

                // ── DSCR Sculpting: quota capitale sagomata sul CFADS per DSCR target ──
                // principal_y = CFADS_y / targetDSCR - interessi_y (post grace, cappato al residuo).
                // Le imposte sono già state calcolate (dipendono solo dagli interessi, non dal capitale).
                if (p.sculptingEnabled && (p.targetDscr || 0) > 0 && p.loanTerm > 0 && yr <= activeMaturity && remainingDebt > 0 && remainingGraceYears <= 0) {
                    const sculptedPrincipal = Math.max(0, (yCfads / p.targetDscr) - yInterest);
                    yPrincipalScheduled = Math.min(remainingDebt, sculptedPrincipal);
                    // Il mutuo deve comunque chiudersi a scadenza: eventuale residuo scultato
                    // diventa rimborso balloon nell'ultimo anno (DSCR finale < target, realistico)
                    if (yr === activeMaturity) yPrincipalScheduled = remainingDebt;
                    yDebtServiceScheduled = yInterest + yPrincipalScheduled;
                }

                // ── DSRA: utilizzo a copertura di shortfall sul servizio del debito ──
                let yDsraFunding = 0, yDsraDraw = 0, yDsraRelease = 0;
                if (dsraTargetAmount > 0 && yDebtServiceScheduled > 0 && yCfads < yDebtServiceScheduled && dsraBalance > 0) {
                    yDsraDraw = Math.min(dsraBalance, yDebtServiceScheduled - yCfads);
                    dsraBalance -= yDsraDraw;
                }
                const yCfadsEff = yCfads + yDsraDraw;

                let dscr = -1;
                if (yDebtServiceScheduled > 0) {
                    dscr = yCfadsEff / yDebtServiceScheduled;
                    if (dscr < minDscr) minDscr = dscr;
                    sumDscr += dscr;
                    dscrYearsCount++;

                    // ── Cash Sweep Configurabile ──────────────────────────────────────
                    // Il sweep è rimborso anticipato facoltativo. Non è deducibile.
                    // Si applica solo se c'è CFADS in eccesso dopo il debt service.
                    if (p.sweepType !== 'none' && p.sweepValue > 0) {
                        const sweepActive = (p.sweepYears === 0) || (yr <= p.sweepYears);
                        if (sweepActive) {
                            const cfadsAvailableForSweep = Math.max(0, yCfads - yDebtServiceScheduled);
                            const maxAllowedSweep = Math.max(0, remainingDebt - yPrincipalScheduled);
                            if (p.sweepType === 'pct_cfads') {
                                // % del CFADS disponibile dopo debt service
                                yPrincipalVoluntary = Math.min(maxAllowedSweep,
                                    cfadsAvailableForSweep * (p.sweepValue / 100));
                            } else if (p.sweepType === 'fixed_eur') {
                                // Importo fisso annuo (non più del disponibile né del debito residuo)
                                yPrincipalVoluntary = Math.min(maxAllowedSweep,
                                    Math.min(cfadsAvailableForSweep, p.sweepValue));
                            }
                            yPrincipalVoluntary = Math.max(0, yPrincipalVoluntary);
                        }
                    }
                }

                let yPrincipalTotal = yPrincipalScheduled + yPrincipalVoluntary;
                let yDebtServiceActual = yInterest + yPrincipalTotal;
                remainingDebt = Math.max(0, remainingDebt - yPrincipalTotal);
                const remainingDebtAfterAmort = remainingDebt;

                // ── DSRA: integrazione fino al target (dopo il servizio debito)
                // e rilascio a estinzione del debito / exit ──
                if (dsraTargetAmount > 0) {
                    const cashAfterDs = Math.max(0, yCfadsEff - yDebtServiceActual);
                    yDsraFunding = Math.min(Math.max(0, dsraTargetAmount - dsraBalance), cashAfterDs);
                    if (yDsraFunding > 0) dsraBalance += yDsraFunding;
                    if ((remainingDebt <= 0.001 || (exitOptionYear > 0 && yr === exitOptionYear)) && dsraBalance > 0) {
                        yDsraRelease = dsraBalance;
                        dsraBalance = 0;
                    }
                }

                const ySpvFCF = yCfadsEff - yDebtServiceActual - yDsraFunding;

                // ── Waterfall SPV: Senior service (già in ySpvFCF) → Soci → Dividendi comuni/PE ──
                // Il PD non è più nel waterfall SPV (è a livello Holding). yPdInterestPaidActual/yPdPrincipalPaidActual restano 0 a livello SPV.
                let yPdInterestPaidActual = 0;
                let yPdPrincipalPaidActual = 0;
                let cashAvailable = ySpvFCF + yDsraRelease;

                // PE ownership % (per distribuzioni proporzionali / preferred)
                // PE ownership fissata a inception: NON usare remainingShareholderLoan (si ridurrebbe
                // col rimborso del finanziamento soci facendo derivare la quota PE anno dopo anno)
                const peOwnershipPct = (peAmount > 0 && (peAmount + equityAmount + initialShareholderLoan) > 0) ? (peAmount / (peAmount + equityAmount + initialShareholderLoan)) : 0;

                // 1. Riserva Legale SPV (5% ex Art. 2430 c.c., fino al 20% del capitale sociale SPV)
                let yLegalReserveAccrual = 0;
                if (yNetProfitSpv > 0) {
                    const maxLegalReserve = 0.20 * spvCap;
                    yLegalReserveAccrual = Math.min(0.05 * yNetProfitSpv, Math.max(0, maxLegalReserve - accumulatedLegalReserve));
                }
                accumulatedLegalReserve += yLegalReserveAccrual;

                // 2. Capacità Distributiva Utili SPV Cumulata (Capienza Utili ex Art. 2433 c.c.)
                const capUtili = Math.max(0, retainedEarningsBalance + yNetProfitSpv - yLegalReserveAccrual);

                // 3. Shareholder distribution (Finanziamento Soci) — subito dopo senior (PD rimosso dal waterfall SPV)
                const yTotalInterestPaid = Math.max(0, Math.min(ySociInterestAccrued, cashAvailable));
                let yTotalLoanRepayment = 0;
                if (yr > (p.sociPrincipalGrace || 0)) {
                    if (p.sociLoanTerm > 0) {
                        const remainingYears = Math.max(1, (p.sociPrincipalGrace || 0) + p.sociLoanTerm - yr + 1);
                        const targetRepayment = remainingShareholderLoan / remainingYears;
                        yTotalLoanRepayment = Math.max(0, Math.min(targetRepayment, cashAvailable - yTotalInterestPaid));
                    } else {
                        // Cash sweep al 100%
                        yTotalLoanRepayment = Math.max(0, Math.min(remainingShareholderLoan, cashAvailable - yTotalInterestPaid));
                    }
                }
                cashAvailable -= (yTotalInterestPaid + yTotalLoanRepayment);
                remainingShareholderLoan = Math.max(0, remainingShareholderLoan + (ySociInterestAccrued - yTotalInterestPaid) - yTotalLoanRepayment);

                // 4. Dividendi Comuni e Restituzione Riserve di Capitale (secondo p.distributionPolicy e p.dividendLock)
                const cashPostLoan = Math.max(0, cashAvailable);
                const isDividendLocked = p.dividendLock && remainingDebt > 0.001;

                let yDividendsDistributed = 0;
                let yCapitalReserveReturned = 0;

                if (isDividendLocked) {
                    // Cassa bloccata per dividend lock (cash sweep a garanzia debito)
                    yDividendsDistributed = 0;
                    yCapitalReserveReturned = 0;
                } else {
                    const policy = p.distributionPolicy || 'cash_flow_driven';
                    if (policy === 'cash_flow_driven') {
                        yDividendsDistributed = cashPostLoan;
                        yCapitalReserveReturned = 0;
                    } else if (policy === 'civil_statutory_strict' || policy === 'civil_strict') {
                        yDividendsDistributed = Math.min(cashPostLoan, capUtili);
                        yCapitalReserveReturned = 0;
                    } else if (policy === 'civil_with_capital_reserve_return') {
                        yDividendsDistributed = Math.min(cashPostLoan, capUtili);
                        const cashPostDiv = Math.max(0, cashPostLoan - yDividendsDistributed);
                        const availableCapitalReserve = Math.max(0, Math.max(0, totalProjectPureEquity - spvCap) - accumulatedCapitalReserveReturned);
                        yCapitalReserveReturned = Math.min(cashPostDiv, availableCapitalReserve);
                        accumulatedCapitalReserveReturned += yCapitalReserveReturned;
                    } else {
                        yDividendsDistributed = cashPostLoan;
                        yCapitalReserveReturned = 0;
                    }
                }

                // Aggiornamento capienza utili a nuovo per l'anno successivo
                retainedEarningsBalance = Math.max(0, capUtili - yDividendsDistributed);

                // 5. Cash Trap Annuo e Cumulato
                const yCashTrap = Math.max(0, cashPostLoan - yDividendsDistributed - yCapitalReserveReturned);
                const accumulatedSpvCashAtStart = spvCashTrapCumulative;
                spvCashTrapCumulative += yCashTrap;

                // ── Distribuzioni Private Equity (sulla quota dividendi Sponsor/totali) ──
                let yPeDividendPaid = 0;   // quota PE sui dividendi SPV (outflow SPV → PE partner)
                let yPePreferredPaid = 0;  // preferred return distribuito a PE
                let yPeDividendToSponsor = yDividendsDistributed; // quota Sponsor (default 100%)
                if (p.peEnabled && peAmount > 0) {
                    if (p.peMode === 'dividend_share') {
                        // PE riceve quota proporzionale; Sponsor riceve il resto
                        yPeDividendPaid = yDividendsDistributed * peOwnershipPct;
                        yPeDividendToSponsor = yDividendsDistributed * (1 - peOwnershipPct);
                    } else if (p.peMode === 'preferred_return') {
                        // Hurdle composto maturato sul capitale PE + arretrati; PE riceve fino a copertura (preferredPct% dei dividendi)
                        if (yr > 0) {
                            const rHurdle = (p.peHurdleRate || 0) / 100;
                            pePreferredAccrued = pePreferredAccrued * (1 + rHurdle) + peAmount * rHurdle;
                        }
                        const pePreferredShare = (p.pePreferredPct || 100) / 100;
                        const peMaxFromDiv = yDividendsDistributed * pePreferredShare;
                        yPePreferredPaid = Math.min(pePreferredAccrued, peMaxFromDiv);
                        pePreferredAccrued -= yPePreferredPaid;
                        yPeDividendToSponsor = Math.max(0, yDividendsDistributed - yPePreferredPaid);
                    } else if (p.peMode === 'bullet_exit') {
                        // Nessun dividendo annuo; PE riscuote multiplo a exit (gestito in sezione exit)
                        yPeDividendToSponsor = yDividendsDistributed; // Sponsor tiene tutti i dividendi comuni
                    } else if (p.peMode === 'royalty_fee') {
                        // Royalty già in opex; nessuna quota dividendi
                        yPeDividendToSponsor = yDividendsDistributed;
                    }
                }

                // HoldCo Level Inflows (Sponsor ownership = 100% dei flussi intra-gruppo, al netto quote PE)
                const yHoldcoOpex = (yr === 0 ? 15000 : 15000 * inflationMultiplier);
                // Aggiungiamo yOpexAssetManagement come ricavo per la Holdco
                // HoldCo IRES: se gli interessi PD sono deducibili (flag pdTaxDeductible),
                // riducono la base imponibile Holding (prima era un no-op: bug corretto)
                const yPdInterestDeductibleHoldco = (yr > 0 && p.pdEnabled && p.pdTaxDeductible !== false) ? yPdInterestPaid : 0;
                const taxableHoldcoRevenues = yTotalInterestPaid + (0.05 * yPeDividendToSponsor) + yOpexAssetManagement - yPdInterestDeductibleHoldco;
                const yHoldcoIresTaxPaid = Math.max(0, taxableHoldcoRevenues - yHoldcoOpex) * p.iresRate;
                // HoldCo IRAP: base = valore della produzione (fees Asset Mgt intra-gruppo) - costi operativi Holding.
                // Interessi attivi/passivi e dividendi sono esclusi dalla base IRAP (D.Lgs. 446/97).
                const yHoldcoIrapTaxPaid = Math.max(0, yOpexAssetManagement - yHoldcoOpex) * p.irapRate;

                // HoldCo Conto Economico intermedio (A, B, EBITDA, EBIT)
                const yHoldcoProductionValue = yOpexAssetManagement;
                const yHoldcoProductionCosts = yHoldcoOpex + yHoldcoEarnoutPaid;
                const yHoldcoEbitda = yHoldcoProductionValue - yHoldcoProductionCosts;
                const yHoldcoOperatingEbit = yHoldcoEbitda;

                // ── EXIT: payoff PD bullet, quota PE, costi AF (success fee / warrant / convertible) ──
                let exitNetProceeds = 0;
                let exitEquityValue = 0;
                let exitPexTax = 0;
                let exitEv = 0;
                let exitDebtPayoffVal = 0;
                let exitLimitedLiability = 0; // bridge (ora sempre 0: PD è a Holding, non c'è default SPV)
                let yPdBulletPayoffHoldco = 0; // payoff PD a livello Holding (cassa Holding)
                let yPdInterestPaidHoldco = 0; // servizio PD Holding (annual_interest/amortizing) pagato in cassa
                let yPeExitShare = 0;   // quota PE sull'exit equity value (o multiplo garantito)
                let yPeExitToSponsor = 0;
                let yAfExitCost = 0;    // costo AF a exit (success fee / warrant / convertible payoff)
                if (exitOptionYear > 0 && yr === exitOptionYear) {
                    let mwpForExit = 0;
                    if (State.plants && State.plants.length > 0) {
                        State.plants.forEach(pl => {
                            if (pl.enabled !== false) mwpForExit += (parseFloat(pl.capacity) || 0) / 1000;
                        });
                    }
                    if (mwpForExit === 0) mwpForExit = p.plantSystemSize || 0;
                    
                    exitEv = (p.exitValuePerMwp || 0) * mwpForExit;
                    if (exitEv === 0 && p.exitEnterpriseValue > 0) {
                        exitEv = p.exitEnterpriseValue;
                    }
                    // ── EXIT SPV: il PD non è più debito SPV (è a Holding level) ──
                    // L'exit equity value della SPV = EV - senior (senza PD payoff).
                    // Il PD è a livello Holding: il payoff PD si fa a livello Holding con
                    // la cassa Holding (cumulato FCFE + exitNetProceeds SPV).
                    // 1. Senior debt: payoff nominale (priorità assoluta SPV)
                    exitDebtPayoffVal = remainingDebt;
                    // 2. PE exit share: calcolato su exitEquityValue SPV (EV - senior)
                    exitEquityValue = Math.max(0, exitEv - exitDebtPayoffVal);
                    if (p.peEnabled && peAmount > 0) {
                        if (p.peMode === 'bullet_exit') {
                            yPeExitShare = Math.min(exitEquityValue, peAmount * (p.peExitMultiple || 0));
                        } else if (p.peParticipatesExit !== false && (p.peMode === 'dividend_share' || p.peMode === 'preferred_return')) {
                            yPeExitShare = exitEquityValue * peOwnershipPct;
                        }
                    }
                    // 3. Altra Forma exit cost (su equity positivo residuo)
                    if (p.afEnabled && exitEquityValue > 0) {
                        if (p.afType === 'success_fee_exit') {
                            yAfExitCost = Math.min(exitEv * ((p.afExitPct || 0) / 100), Math.max(0, exitEquityValue - yPeExitShare));
                        } else if (p.afType === 'warrant_kicker') {
                            yAfExitCost = Math.min(Math.max(0, exitEquityValue - yPeExitShare) * ((p.afWarrantPct || 0) / 100), Math.max(0, exitEquityValue - yPeExitShare));
                        } else if (p.afType === 'convertible_note') {
                            const conversionValue = exitEv * ((p.afConvertiblePct || 0) / 100);
                            yAfExitCost = Math.min(Math.max(remainingAfConvertible, conversionValue), Math.max(0, exitEquityValue - yPeExitShare));
                            remainingAfConvertible = 0;
                        }
                    }
                    // L'exit per definizione chiude il debito bancario: azzeriamo il saldo
                    // DOPO aver calcolato exitEquityValue (che usa exitDebtPayoffVal), così
                    // gli anni successivi non hanno servizio senior e DSCR = N/A.
                    remainingDebt = 0;
                    // Equity sponsor SPV (sempre ≥ 0: la SPV non ha più il PD)
                    const exitEquityToSponsor = Math.max(0, exitEquityValue - yPeExitShare - yAfExitCost);
                    yPeExitToSponsor = exitEquityToSponsor;
                    const taxBasis = equityAmount;
                    const capitalGain = Math.max(0, exitEquityToSponsor - taxBasis);
                    // PEX Tax: 5% of gain is taxed at IRES (24%), effective 1.2%
                    exitPexTax = capitalGain * 0.05 * p.iresRate;
                    exitNetProceeds = exitEquityToSponsor - exitPexTax;
                    // ── EXIT HOLDING: payoff PD con cassa Holding ──
                    // La Holding ha: cumulato FCFE Sponsor (anni precedenti) + exitNetProceeds SPV (corrente).
                    // Deve ripagare: saldo PD (capitale + interessi PIK se bullet) + servizio PD dell'anno (se annual/amortizing).
                    if (p.pdEnabled && pdAmount > 0) {
                        // Cassa Holding disponibile a exit = cumulato FCFE Sponsor + exitNetProceeds
                        const holdcoCashAtExit = cumulativeHoldcoFCFE + exitNetProceeds + (yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor + yOpexAssetManagement - yHoldcoOpex - yHoldcoIresTaxPaid - yHoldcoIrapTaxPaid - yHoldcoEarnoutPaid);
                        // Payoff PD bullet/residuo
                        yPdBulletPayoffHoldco = yPdBulletPayoff; // saldo PD catturato (bullet_exit o residuo annual/amortizing)
                        // Il payoff è cappato alla cassa Holding (limited liability Holding)
                        const pdPayoffActual = Math.min(yPdBulletPayoffHoldco, Math.max(0, holdcoCashAtExit));
                        exitLimitedLiability = yPdBulletPayoffHoldco - pdPayoffActual; // perdita PD se cassa < saldo (default Holding, raro)
                        yPdBulletPayoffHoldco = pdPayoffActual;
                        remainingPd = 0;
                    }
                }

                let yHoldcoFCFE = 0;
                let yProjectFCFF = 0;
                if (exitOptionYear === 0 || yr <= exitOptionYear) {
                    // ── Servizio PD a livello HOLDING (annual_interest / amortizing) ──
                    // Per bullet_exit il servizio annuo è 0 (PIK); il payoff è a exit (yPdBulletPayoffHoldco).
                    yPdInterestPaidHoldco = yPdInterestPaid; // cassa pagata dalla Holding per interessi PD annuali
                    // FCFE Sponsor = flussi intra-gruppo (quota Sponsor) + exit net proceeds - servizio PD Holding - payoff PD Holding
                    yHoldcoFCFE = yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor + yCapitalReserveReturned - yHoldcoOpex - yHoldcoIresTaxPaid - yHoldcoIrapTaxPaid - yHoldcoEarnoutPaid + exitNetProceeds + yOpexAssetManagement - yPdInterestPaidHoldco - yPdBulletPayoffHoldco - yPdPrincipalPaid;
                    totalHoldcoFCFE += yHoldcoFCFE;
                    if (yr > 0) {
                        cashFlowsForIRR.push(yHoldcoFCFE);
                    }
                    
                    // FCFF (Project Unlevered)
                    // EBITDA - CAPEX (nell'anno 0) - Tasse Operative - Variazione NWC
                    // Include BESS augmentation cost if any, excludes ALL financial flows (interest, debt, holdco fees)
                    const taxesForFcff = yIresTax + yIrapTax;
                    yProjectFCFF = yEbitda - yBessAugmentationActual - taxesForFcff + exitEv; 
                    // exitEv is added in the exit year to reflect the unlevered terminal value
                }

                // HoldCo Conto Economico intermedio (C, EBT, Totale Imposte, Utile Netto)
                const yHoldcoFinancialNet = yPeDividendToSponsor + yTotalInterestPaid - yPdInterestPaidHoldco;
                const yHoldcoEbt = yHoldcoOperatingEbit + yHoldcoFinancialNet;
                const yHoldcoTaxTotal = yHoldcoIresTaxPaid + yHoldcoIrapTaxPaid;
                const yHoldcoNetProfit = yHoldcoEbt - yHoldcoTaxTotal;
                const yHoldcoOperatingCashflow = yHoldcoNetProfit + yTotalLoanRepayment + yCapitalReserveReturned;

                // ── STATO PATRIMONIALE SPV (Sez. B-bis, Partita Doppia OIC) ──
                cumGrossFixedAssets += yBessAugmentationActual;
                cumDeprSpv += yDepreciationCivil;
                const yBsSpvNetFixedAssets = cumGrossFixedAssets - cumDeprSpv;
                const yBsSpvDta = Math.max(0, -deferredTaxFund);
                const yBsSpvDtl = Math.max(0, deferredTaxFund);
                const yBsSpvMra = mraBalance;
                const yBsSpvDsra = dsraBalance;
                const yBsSpvRestrictedCash = yBsSpvMra + yBsSpvDsra;
                const ySpvNetCashChange = (ySpvFCF + yDsraRelease) - yTotalInterestPaid - yTotalLoanRepayment - yDividendsDistributed - yCapitalReserveReturned;
                cumSpvCashBalance += ySpvNetCashChange;
                const yBsSpvTotalAssets = yBsSpvNetFixedAssets + yBsSpvDta + yBsSpvRestrictedCash + cumSpvCashBalance;

                const yBsSpvPaidInCapital = Math.max(spvCap, (totalProjectPureEquity + idcAmount - initialAfConvertible) - accumulatedCapitalReserveReturned);
                const yBsSpvLegalReserve = accumulatedLegalReserve;
                const yBsSpvRetainedEarnings = cumSpvRetainedEarnings - yDividendsDistributed - yLegalReserveAccrual;
                const yBsSpvNetProfit = yNetProfitSpv;
                const yBsSpvTotalEquity = yBsSpvPaidInCapital + yBsSpvLegalReserve + yBsSpvRetainedEarnings + yBsSpvNetProfit;
                cumSpvRetainedEarnings = yBsSpvRetainedEarnings + yNetProfitSpv + ((exitOptionYear > 0 && yr === exitOptionYear) ? (exitDebtPayoffVal + ((p.afEnabled && p.afType === 'convertible_note' && p.afTaxDeductible !== false) ? remainingAfBeforeExit : 0)) : 0);

                const yBsSpvSeniorDebt = remainingDebtAfterAmort;
                const yBsSpvShareholderLoan = remainingShareholderLoan;
                const yBsSpvAfLiability = (p.afTaxDeductible !== false) ? remainingAfBeforeExit : initialAfConvertible;
                const yBsSpvTotalLiabilities = yBsSpvDtl + yBsSpvSeniorDebt + yBsSpvShareholderLoan + yBsSpvAfLiability;
                const yBsSpvTotalLiabAndEquity = yBsSpvTotalEquity + yBsSpvTotalLiabilities;
                const yBsSpvCheck = yBsSpvTotalAssets - yBsSpvTotalLiabAndEquity;

                // ── STATO PATRIMONIALE HOLDING (Sez. D-bis, Partita Doppia OIC) ──
                cumHcSpvEquityInv = Math.max(spvCap, cumHcSpvEquityInv - yCapitalReserveReturned);
                const yBsHcSociReceivable = remainingShareholderLoan;
                cumHcCash += yHoldcoOperatingCashflow - yPdPrincipalPaid;
                const yBsHcTotalAssets = cumHcSpvEquityInv + yBsHcSociReceivable + cumHcCash;

                const yBsHcShareCapital = initialHcShareCapital;
                const yHcNonCashAccrualAdj = (ySociInterestAccrued - yTotalInterestPaid) - (yPdInterestAccrued - yPdInterestPaidHoldco);
                const yBsHcRetainedEarnings = cumHcRetainedEarnings + yHcNonCashAccrualAdj;
                const yBsHcNetProfit = yHoldcoNetProfit;
                const yBsHcTotalEquity = yBsHcShareCapital + yBsHcRetainedEarnings + yBsHcNetProfit;
                cumHcRetainedEarnings = yBsHcRetainedEarnings + yHoldcoNetProfit + ((exitOptionYear > 0 && yr === exitOptionYear && p.pdEnabled) ? remainingPdBeforeExit : 0);

                const yBsHcPdDebt = remainingPdBeforeExit;
                const yBsHcTotalLiabilities = yBsHcPdDebt;
                const yBsHcTotalLiabAndEquity = yBsHcTotalEquity + yBsHcTotalLiabilities;
                const yBsHcCheck = yBsHcTotalAssets - yBsHcTotalLiabAndEquity;

                cumulativeCfads += yCfads;
                cumulativeHoldcoFCFE += yHoldcoFCFE;

                // Push results matrix
                matrix.projectFCFF.push(yProjectFCFF);
                matrix.cerGseIncentive.push(yCerGseIncentive);
                matrix.holdcoOperatingCashflow.push(yHoldcoOperatingCashflow);
                matrix.years.push(yr);
                matrix.spvFCFE.push(ySpvFCF);
                matrix.spvCashTrap.push(yCashTrap);
                // Stato Patrimoniale SPV
                matrix.bsSpvGrossFixedAssets.push(cumGrossFixedAssets);
                matrix.bsSpvGrossCapex.push(cumGrossFixedAssets);
                matrix.bsSpvAccumDepreciation.push(cumDeprSpv);
                matrix.bsSpvAccumDepr.push(cumDeprSpv);
                matrix.bsSpvNetFixedAssets.push(yBsSpvNetFixedAssets);
                matrix.bsSpvDta.push(yBsSpvDta);
                matrix.bsSpvMraCash.push(yBsSpvMra);
                matrix.bsSpvMra.push(yBsSpvMra);
                matrix.bsSpvDsraCash.push(yBsSpvDsra);
                matrix.bsSpvDsra.push(yBsSpvDsra);
                matrix.bsSpvRestrictedCash.push(yBsSpvRestrictedCash);
                matrix.bsSpvCashBalance.push(cumSpvCashBalance);
                matrix.bsSpvCash.push(cumSpvCashBalance);
                matrix.bsSpvTotalAssets.push(yBsSpvTotalAssets);
                matrix.bsSpvShareCapital.push(yBsSpvPaidInCapital);
                matrix.bsSpvLegalReserve.push(yBsSpvLegalReserve);
                matrix.bsSpvRetainedEarnings.push(yBsSpvRetainedEarnings);
                matrix.bsSpvNetProfit.push(yBsSpvNetProfit);
                matrix.bsSpvTotalEquity.push(yBsSpvTotalEquity);
                matrix.bsSpvSeniorDebt.push(yBsSpvSeniorDebt);
                matrix.bsSpvShareholderLoan.push(yBsSpvShareholderLoan);
                matrix.bsSpvSociLoan.push(yBsSpvShareholderLoan);
                matrix.bsSpvAfLiability.push(yBsSpvAfLiability);
                matrix.bsSpvAfConvertible.push(yBsSpvAfLiability);
                matrix.bsSpvDtl.push(yBsSpvDtl);
                matrix.bsSpvTotalLiabilities.push(yBsSpvTotalLiabilities);
                matrix.bsSpvTotalLiabAndEquity.push(yBsSpvTotalLiabAndEquity);
                matrix.bsSpvTotalLiabilitiesAndEquity.push(yBsSpvTotalLiabAndEquity);
                matrix.bsSpvBalanceCheck.push(Math.abs(yBsSpvCheck) < 1e-6 ? 0 : yBsSpvCheck);
                // Stato Patrimoniale Holding
                matrix.bsHcSpvEquityInv.push(cumHcSpvEquityInv);
                matrix.bsHcSpvParticipation.push(cumHcSpvEquityInv);
                matrix.bsHcSociLoanReceivable.push(yBsHcSociReceivable);
                matrix.bsHcCashBalance.push(cumHcCash);
                matrix.bsHcCash.push(cumHcCash);
                matrix.bsHcTotalAssets.push(yBsHcTotalAssets);
                matrix.bsHcShareCapital.push(yBsHcShareCapital);
                matrix.bsHcRetainedEarnings.push(yBsHcRetainedEarnings);
                matrix.bsHcNetProfit.push(yBsHcNetProfit);
                matrix.bsHcTotalEquity.push(yBsHcTotalEquity);
                matrix.bsHcPdDebt.push(yBsHcPdDebt);
                matrix.bsHcTotalLiabilities.push(yBsHcTotalLiabilities);
                matrix.bsHcTotalLiabAndEquity.push(yBsHcTotalLiabAndEquity);
                matrix.bsHcTotalLiabilitiesAndEquity.push(yBsHcTotalLiabAndEquity);
                matrix.bsHcBalanceCheck.push(Math.abs(yBsHcCheck) < 1e-6 ? 0 : yBsHcCheck);
                // External financing instruments rows
                matrix.pdInterestAccrued.push(yPdInterestAccrued);
                matrix.pdInterestPaid.push(yPdInterestPaidHoldco); // ora servizio a livello Holding
                matrix.pdPrincipalPaid.push(yPdPrincipalPaid); // amortizing: quota capitale Holding
                matrix.pdBulletPayoff.push(yPdBulletPayoffHoldco); // payoff PD a livello Holding (cappato cassa)
                matrix.pdServiceHoldco.push(yPdInterestPaidHoldco + yPdPrincipalPaid); // servizio PD Holding annuo (annual/amortizing)
                matrix.pdPayoffHoldco.push(yPdBulletPayoffHoldco); // payoff PD Holding a exit
                matrix.afFee.push(yAfFee);
                matrix.afInterestAccrued.push(yAfInterestAccrued);
                matrix.afExitCost.push(yAfExitCost);
                matrix.peRoyalty.push(yPeRoyalty);
                matrix.peDividendPaid.push(yPeDividendPaid + yPePreferredPaid);
                matrix.pePreferredPaid.push(yPePreferredPaid);
                matrix.peExitShare.push(yPeExitShare);
                matrix.pePreferredAccruedBalance.push(pePreferredAccrued);
                matrix.peDividendToSponsor.push(yPeDividendToSponsor);
                matrix.peExitToSponsor.push(yPeExitToSponsor);
                matrix.revenueTotal.push(yRevenueTotal);
                matrix.revenueTimeshifting.push(yRevenueTimeshifting);
                matrix.revenueRid.push(yRevenueRid);
                matrix.revenuePpa.push(yRevenuePpa);
                matrix.revenuePpaPv.push(yRevenuePpaPv);
                matrix.revenuePpaBessArb.push(yBessPpaRevArb);
                matrix.revenuePpaBessTs.push(yBessPpaRevTs);
                matrix.revenueArbitrage.push(yRevenueArbitrage);
                matrix.revenueMsd.push(yRevenueMsd);
                matrix.opexTotal.push(yOpexTotal);
                // Calculate unit prices
                const safeDiv = (num, den) => (den > 0.001) ? (num / den) : 0;
                
                // yQtyEnergyGroup is already accumulated in the plants loop to prevent double-counting under CER
                yPriceEnergyGroup = safeDiv(ySolarPpaRev + ySolarRidRev + yBessPpaRev + yBessTimeshiftingRev + yBessArbitrageRev, yQtyEnergyGroup);

                const yPriceSolarAvg = safeDiv(ySolarPpaRev + ySolarRidRev, yQtySolarAvgDen);
                const yPriceSolarPpa = safeDiv(ySolarPpaRev, yQtySolarPpa);
                const yPriceSolarRid = safeDiv(ySolarRidRev, yQtySolarRid);
                
                const yPriceBessAvg = safeDiv(yBessPpaRev + yBessTimeshiftingRev + yBessArbitrageRev, yQtyBessDischarge);
                const yPriceBessPpa = safeDiv(yBessPpaRev, yQtyBessSelfCons);
                const yPriceBessRid = safeDiv(yBessTimeshiftingRev + yBessArbitrageRev, yQtyBessGridFeed);
                const yPriceBessArbitrage = safeDiv(yBessArbitrageRev, yQtyBessGridFeedArb > 0.001 ? yQtyBessGridFeedArb : yQtyBessChargeGrid);
                const yPriceBessTimeshifting = safeDiv(yBessTimeshiftingRev, yQtyBessGridFeedTs > 0.001 ? yQtyBessGridFeedTs : yQtySolarToBess);
                const yPriceBessChargeGrid = safeDiv(yBessGridChargingCost, yQtyBessChargeGrid);

                matrix.qtyEnergyGroup.push(yQtyEnergyGroup);
                matrix.priceEnergyGroup.push(yPriceEnergyGroup);

                matrix.qtySolarGen.push(yQtySolarGen);
                matrix.qtySolarPpa.push(yQtySolarPpa);
                matrix.qtySolarRid.push(yQtySolarRid);
                matrix.qtySolarToBess.push(yQtySolarToBess);
                matrix.qtyBessDischarge.push(yQtyBessDischarge);
                matrix.qtyBessSelfCons.push(yQtyBessSelfCons);
                matrix.qtyBessSelfConsArb.push(yQtyBessSelfConsArb);
                matrix.qtyBessSelfConsTs.push(yQtyBessSelfConsTs);
                matrix.qtyBessGridFeed.push(yQtyBessGridFeed);
                matrix.qtyBessGridFeedArb.push(yQtyBessGridFeedArb);
                matrix.qtyBessGridFeedTs.push(yQtyBessGridFeedTs);
                matrix.qtyBessChargeGrid.push(yQtyBessChargeGrid);
                matrix.qtyBessLosses.push(yQtyBessLosses);
                
                matrix.priceSolarAvg.push(yPriceSolarAvg);
                matrix.priceSolarPpa.push(yPriceSolarPpa);
                matrix.priceSolarRid.push(yPriceSolarRid);
                matrix.priceBessAvg.push(yPriceBessAvg);
                matrix.priceBessPpa.push(yPriceBessPpa);
                matrix.priceBessRid.push(yPriceBessRid);
                matrix.priceBessArbitrage.push(yPriceBessArbitrage);
                matrix.priceBessTimeshifting.push(yPriceBessTimeshifting);
                matrix.priceBessChargeGrid.push(yPriceBessChargeGrid);

                matrix.opexPlants.push(yOpexPlants);
                matrix.opexBess.push(yBessOpex);
                matrix.opexGridCharging.push(yOpexGridCharging);
                matrix.opexLandDds.push(yLandDdsAnnuoFee);
                matrix.opexInsurance.push(yOpexInsurance);
                matrix.opexTaxes.push(yOpexTaxes);
                matrix.opexSecurity.push(yOpexSecurity);
                matrix.opexAssetManagement.push(yOpexAssetManagement);
                matrix.opexServiceContract.push(yOpexServiceContract);
                matrix.opexMaintReserve.push(yMaintReserve);
                matrix.ebitda.push(yEbitda);
                matrix.ebit.push(yEbit);
                matrix.depreciationCivil.push(yDepreciationCivil);
                matrix.depreciationCivilSolar.push(yDeprSolar);
                matrix.depreciationCivilBess.push(yDeprBess);
                matrix.depreciationCivilOther.push(yDeprOther);
                matrix.interest.push(yInterest);
                matrix.interestPaid.push(yInterest);
                matrix.interestActive.push(yInterestActive);
                matrix.sociInterestAccrued.push(ySociInterestAccrued);
                matrix.ebt.push(yEbt);
                matrix.currentTaxesSpv.push(yCurrentTaxesSpv);
                matrix.iresTaxSpv.push(yIresTax);
                matrix.irapTaxSpv.push(yIrapTax);
                matrix.deferredTaxes.push(yDeferredTaxes);
                matrix.civilTaxesSpv.push(yCivilTaxes);
                matrix.netProfitSpv.push(yNetProfitSpv);
                matrix.cfads.push(yCfads);
                matrix.deductibleInterest.push(totalDeductibleInterest);
                matrix.interestCF.push(interestExpensesCarriedForward);
                matrix.rolCF.push(rolCarriedForward);
                matrix.taxLossCF.push(taxLossCarriedForward);
                matrix.taxTaxableIres.push(rawTaxableIresBeforeLoss);
                matrix.taxDeprDelta.push(yDepreciationCivil - totalAnnualDepreciationFiscal);
                matrix.taxInterestDelta.push((yInterest + ySociInterestAccrued + yAfDeductible) - totalDeductibleInterest);
                matrix.taxLossApplied.push(appliedLossesTotal);
                matrix.taxNolFirst3Applied.push(appliedLossesFirst3Y);
                matrix.taxLossFirst3CF.push(taxLossCarriedForwardFirst3Y);
                matrix.taxNolNormalApplied.push(appliedLossesNormal);
                matrix.taxLossNormalCF.push(taxLossCarriedForwardNormal);
                matrix.taxTaxableFinal.push(Math.max(0, rawTaxableIres));
                matrix.taxableIrap.push(taxableIrap);
                matrix.taxFiscalDepr.push(totalAnnualDepreciationFiscal);
                matrix.taxFiscalDeprBase.push(totalAnnualDepreciationFiscalBase);
                matrix.taxFiscalRemaining.push(totalFiscalRemaining);
                matrix.taxNetInterest.push(netInterestExpenses);
                matrix.taxCivilIdc.push(yCivilDepreciationIdc);
                matrix.taxDeferredRaw.push(unconstrainedDeferredTaxes);
                matrix.taxDeferredFund.push(deferredTaxFund);
                matrix.dividendsPaid.push(yDividendsDistributed);
                matrix.holdcoFCFE.push(yHoldcoFCFE);
                // exitValuationGroup = somma nominale delle figlie (trasparente, può essere negativa in caso di default PD)
                // exitValuationGroup (SPV): EV - senior - PE - AF - PEX (senza PD, che è a Holding)
                matrix.exitValuationGroup.push(exitEv - exitDebtPayoffVal - yPeExitShare - yAfExitCost - exitPexTax);
                matrix.exitEnterpriseValue.push(exitEv);
                matrix.exitDebtPayoff.push(exitDebtPayoffVal);
                matrix.exitPexTaxRow.push(exitPexTax);
                matrix.exitNetProceedsRow.push(exitNetProceeds);
                matrix.exitLimitedLiability.push(exitLimitedLiability);
                matrix.rolCapacity.push(currentRolCapacity);
                matrix.bessAugmentationCost.push(yBessAugmentationActual);
                matrix.mraRelease.push(mraRelease);
                matrix.maintReserve.push(yMaintReserve);
                matrix.holdcoOpex.push(yHoldcoOpex);
                matrix.holdcoIresTaxPaid.push(yHoldcoIresTaxPaid);
                matrix.holdcoIrapTaxPaid.push(yHoldcoIrapTaxPaid);
                matrix.holdcoProductionValue.push(yHoldcoProductionValue);
                matrix.holdcoProductionCosts.push(yHoldcoProductionCosts);
                matrix.holdcoEbitda.push(yHoldcoEbitda);
                matrix.holdcoOperatingEbit.push(yHoldcoOperatingEbit);
                matrix.holdcoFinancialNet.push(yHoldcoFinancialNet);
                matrix.holdcoEbt.push(yHoldcoEbt);
                matrix.holdcoTaxTotal.push(yHoldcoTaxTotal);
                matrix.holdcoNetProfit.push(yHoldcoNetProfit);
                matrix.holdcoEarnoutPaid.push(yHoldcoEarnoutPaid);
                matrix.holdcoInflowTotal.push(yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor + yCapitalReserveReturned + yOpexAssetManagement);
                matrix.holdcoInterestReceived.push(yTotalInterestPaid);
                matrix.holdcoLoanRepaymentReceived.push(yTotalLoanRepayment);
                matrix.holdcoDividendReceived.push(yPeDividendToSponsor);
                matrix.spvLockedDividends.push(accumulatedSpvCashAtStart);
                matrix.spvCashTrapCumulative.push(spvCashTrapCumulative);
                matrix.spvLegalReserveAccrual.push(yLegalReserveAccrual);
                matrix.spvRetainedEarnings.push(retainedEarningsBalance);
                matrix.spvCapitalReserveReturned.push(yCapitalReserveReturned);
                matrix.holdcoCapitalReserveReceived.push(yCapitalReserveReturned);
                matrix.partnerDividendReceived.push(0);
                matrix.cfadsCumulated.push(cumulativeCfads);
                matrix.holdcoFCFECumulated.push(cumulativeHoldcoFCFE);
                matrix.principalScheduled.push(yPrincipalScheduled);
                matrix.principalVoluntary.push(yPrincipalVoluntary);
                matrix.dsraFunding.push(yDsraFunding);
                matrix.dsraDraw.push(yDsraDraw);
                matrix.dsraRelease.push(yDsraRelease);

                // Debt matrices
                debtSchedule.years.push(yr);
                debtSchedule.beginningBalance.push(yr === 0 ? 0 : debtSchedule.endingBalance[yr - 1]);
                debtSchedule.interestAccrued.push(yInterest);
                debtSchedule.principalScheduled.push(yPrincipalScheduled);
                debtSchedule.principalVoluntary.push(yPrincipalVoluntary);
                debtSchedule.endingBalance.push(remainingDebt);
                debtSchedule.totalDebtService.push(yDebtServiceActual);
                debtSchedule.dscr.push(dscr);
                
                debtSchedule.beginningBalanceSoci.push(yr === 0 ? 0 : debtSchedule.endingBalanceSoci[yr - 1]);
                debtSchedule.interestAccruedSoci.push(ySociInterestAccrued);
                debtSchedule.interestPaidSoci.push(yTotalInterestPaid);
                debtSchedule.principalPaidSoci.push(yTotalLoanRepayment);
                debtSchedule.endingBalanceSoci.push(remainingShareholderLoan);
                debtSchedule.dsraBalance.push(dsraBalance);
                // Private Debt schedule (sezione 3)
                debtSchedule.beginningBalancePd.push(yr === 0 ? 0 : debtSchedule.endingBalancePd[yr - 1]);
                debtSchedule.interestAccruedPd.push(yPdInterestAccrued);
                debtSchedule.interestPaidPd.push(yPdInterestPaidHoldco); // servizio a livello Holding
                debtSchedule.principalPaidPd.push(yPdPrincipalPaid); // solo quota capitale AMMORTAMENTO (Holding)
                debtSchedule.bulletPayoffPd.push(yPdBulletPayoffHoldco); // solo payoff BULLET/residuo exit (Holding)
                debtSchedule.endingBalancePd.push(remainingPd);
            }

            // ── LLCR (Loan Life Coverage Ratio): PV(CFADS residui al tasso debitorio) / Debito Residuo Inizio Anno ──
            for (let yr = 0; yr <= exitYear; yr++) {
                const begDebt = debtSchedule.beginningBalance[yr] || 0;
                if (yr === 0 || begDebt <= 0.001 || yr > activeMaturity) {
                    debtSchedule.llcr.push(-1);
                } else {
                    let pvCfads = 0;
                    const rDebt = p.interestRate || 0;
                    for (let k = yr; k <= Math.min(exitYear, activeMaturity); k++) {
                        pvCfads += (matrix.cfads[k] || 0) / Math.pow(1 + rDebt, k - yr + 1);
                    }
                    debtSchedule.llcr.push((pvCfads + (debtSchedule.dsraBalance[yr] || 0)) / begDebt);
                }
            }

            // NPV discounting FCFE with the Cost of Equity (Ke)
            let holdcoNpv = -totalSponsorCommittedEquity;
            const npvYearsLimit = exitOptionYear > 0 ? exitOptionYear : exitYear;
            for (let yr = 1; yr <= npvYearsLimit; yr++) {
                holdcoNpv += matrix.holdcoFCFE[yr] / Math.pow(1 + p.keVal, yr);
            }

            const calculatedIrr = calculateIRR(cashFlowsForIRR);
            
            // Build Unlevered Project FCFF cashflows
            const cashFlowsForProjectIRR = [-totalProjectCost];
            // Orizzonte Project IRR: vita progetto (20 anni), NON durata del mutuo
            for (let yr = 1; yr <= (exitOptionYear > 0 ? exitOptionYear : 20); yr++) {
                cashFlowsForProjectIRR.push(matrix.projectFCFF[yr]);
            }
            const calculatedProjectIrr = calculateIRR(cashFlowsForProjectIRR);

            // Build SPV Levered Equity cash flows & SPV Equity NPV
            const cashFlowsForSpvEquityIRR = [-totalSpvEquityTicket];
            let spvEquityNpv = -totalSpvEquityTicket;
            const maxYearsForSpvIrr = exitOptionYear > 0 ? exitOptionYear : 20;
            for (let yr = 1; yr <= maxYearsForSpvIrr; yr++) {
                let ySpvFlow = (matrix.spvFCFE[yr] || 0) + (matrix.dsraRelease ? (matrix.dsraRelease[yr] || 0) : 0);
                if (exitOptionYear > 0 && yr === exitOptionYear) {
                    const exitEq = Math.max(0, (matrix.exitEnterpriseValue[yr] || 0) - (matrix.exitDebtPayoff[yr] || 0));
                    ySpvFlow += exitEq;
                }
                cashFlowsForSpvEquityIRR.push(ySpvFlow);
                spvEquityNpv += ySpvFlow / Math.pow(1 + p.keVal, yr);
            }
            const calculatedSpvEquityIrr = calculateIRR(cashFlowsForSpvEquityIRR);

            const calculatedLcoe = lcoeSumDiscountedEnergy > 0 ? (lcoeSumDiscountedCosts / lcoeSumDiscountedEnergy) : 0;
            const calculatedLcos = lcosSumDiscountedEnergy > 0 ? (lcosSumDiscountedCosts / lcosSumDiscountedEnergy) : 0;

            const holdcoMoic = totalSponsorCommittedEquity > 0 ? (totalHoldcoFCFE / totalSponsorCommittedEquity) : 0;

            let paybackPeriod = `> ${npvYearsLimit} Anni`;
            let cumulativeCash = -totalSponsorCommittedEquity;
            for (let t = 1; t <= npvYearsLimit; t++) {
                let prev = cumulativeCash;
                cumulativeCash += matrix.holdcoFCFE[t];
                if (prev < 0 && cumulativeCash >= 0) {
                    const fcfeT = matrix.holdcoFCFE[t];
                    // Guard: divisione per zero se l'FCFE dell'anno di crossing è nullo
                    paybackPeriod = (fcfeT > 0 ? ((t-1) + Math.abs(prev)/fcfeT) : t).toFixed(1) + " Anni";
                    break;
                }
            }

            let paybackPeriodUnlevered = `> ${npvYearsLimit} Anni`;
            let cumulativeCashUnlevered = -totalProjectCost;
            for (let t = 1; t <= npvYearsLimit; t++) {
                let prev = cumulativeCashUnlevered;
                cumulativeCashUnlevered += matrix.projectFCFF[t];
                if (prev < 0 && cumulativeCashUnlevered >= 0) {
                    const fcffT = matrix.projectFCFF[t];
                    paybackPeriodUnlevered = (fcffT > 0 ? ((t - 1) + Math.abs(prev) / fcffT) : t).toFixed(1) + " Anni";
                    break;
                }
            }

            // Compute portfolio-level self-consumption summary for Dashboard
            let totalSelfConsMwh = 0, totalPpaRev_y1 = 0, totalStabLoadMwh = 0;
            activePlants.forEach(plant => {
                totalSelfConsMwh += plant._selfConsumptionMwh || 0;
                totalPpaRev_y1   += plant._ppaRevenue_y1 || 0;
            });
            State.stabilimenti.forEach(s => {
                if (s.load) totalStabLoadMwh += Array.from(s.load).reduce((a,b)=>a+b,0) / 1000;
                else totalStabLoadMwh += s.annualConsumption || 0;
            });
            // Sincronizza lo stato degli impianti selezionati per il tab BESS
            const activePlantsForBess = State.plants.filter(p => p.enabled !== false);
            if (!State.selectedBessPlantIds) {
                State.selectedBessPlantIds = new Set(activePlantsForBess.map(p => p.id));
            } else {
                const activeIds = new Set(activePlantsForBess.map(p => p.id));
                // Rimuovi ID obsoleti
                for (const id of State.selectedBessPlantIds) {
                    if (!activeIds.has(id)) {
                        State.selectedBessPlantIds.delete(id);
                    }
                }
                // Aggiungi nuovi impianti se non erano presenti
                activePlantsForBess.forEach(p => {
                    if (!State.selectedBessPlantIds.has(p.id) && !State.previouslySeenPlantIds?.has(p.id)) {
                        State.selectedBessPlantIds.add(p.id);
                    }
                });
            }
            State.previouslySeenPlantIds = new Set(activePlantsForBess.map(p => p.id));

            // ═══ D1: Cash flow mensile anni 1-5 (60 mesi) ═══
            // Forme mensili derivate dagli array orari del dispatch (anno 1),
            // normalizzate ai totali annui del matrix: la somma dei mesi dell'anno y
            // coincide per costruzione con il valore annuo (quadratura esatta).
            // OPEX/imposte/servizio debito (annuali nel modello) sono ripartiti /12.
            function buildMonthlyCashflow(plantsList, mtx, ds) {
                const nYears = Math.min(5, (mtx.years ? mtx.years.length : 5));
                const shape = { ppa: new Float64Array(12), rid: new Float64Array(12), arb: new Float64Array(12), ts: new Float64Array(12) };
                plantsList.forEach(pl => {
                    const s = pl.sim;
                    if (!s) return;
                    for (let t = 0; t < 8760; t++) {
                        const m = getMonthOfHour(t);
                        if (s.hourlyRevenuePpaPv) shape.ppa[m] += s.hourlyRevenuePpaPv[t] + (s.hourlyRevenuePpaBess ? s.hourlyRevenuePpaBess[t] : 0);
                        if (s.hourlyRevenueRidActual) shape.rid[m] += s.hourlyRevenueRidActual[t];
                        if (s.hourlyRevenueArbitrageGrid) shape.arb[m] += s.hourlyRevenueArbitrageGrid[t];
                        if (s.hourlyRevenueTimeshifting) shape.ts[m] += s.hourlyRevenueTimeshifting[t];
                    }
                });
                const shares = {};
                ['ppa', 'rid', 'arb', 'ts'].forEach(k => {
                    const tot = shape[k].reduce((a, b) => a + b, 0);
                    shares[k] = tot > 1e-6 ? Array.from(shape[k], v => v / tot) : new Array(12).fill(1 / 12);
                });
                const totShape = new Array(12).fill(0);
                for (let m = 0; m < 12; m++) totShape[m] = shape.ppa[m] + shape.rid[m] + shape.arb[m] + shape.ts[m];
                const totTot = totShape.reduce((a, b) => a + b, 0);
                const shareTot = totTot > 1e-6 ? totShape.map(v => v / totTot) : new Array(12).fill(1 / 12);

                const out = {
                    months: [], labels: [],
                    revenuePpa: [], revenueRid: [], revenueArbitrage: [], revenueTimeshifting: [], revenueTotal: [],
                    opex: [], taxes: [], interest: [], principal: [], debtService: [],
                    netCashflow: [], cashOpening: [], cashClosing: []
                };
                const MONTHS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
                let cash = 0;
                for (let y = 1; y <= nYears; y++) {
                    const yi = y - 1;
                    for (let m = 0; m < 12; m++) {
                        const revPpa = (mtx.revenuePpa[y] || 0) * shares.ppa[m];
                        const revRid = (mtx.revenueRid[y] || 0) * shares.rid[m];
                        const revArb = (mtx.revenueArbitrage[y] || 0) * shares.arb[m];
                        const revTs = (mtx.revenueTimeshifting[y] || 0) * shares.ts[m];
                        const revTot = (mtx.revenueTotal[y] || 0) * shareTot[m];
                        const opex = (mtx.opexTotal[y] || 0) / 12;
                        const taxes = (mtx.currentTaxesSpv[y] || 0) / 12;
                        const interest = (ds.interestAccrued[y] || 0) / 12;
                        const principal = ((ds.principalScheduled[y] || 0) + (ds.principalVoluntary[y] || 0)) / 12;
                        const debtSvc = interest + principal;
                        const net = revTot - opex - taxes - debtSvc;
                        out.months.push(yi * 12 + m + 1);
                        out.labels.push(MONTHS_IT[m] + ' Y' + y);
                        out.revenuePpa.push(revPpa);
                        out.revenueRid.push(revRid);
                        out.revenueArbitrage.push(revArb);
                        out.revenueTimeshifting.push(revTs);
                        out.revenueTotal.push(revTot);
                        out.opex.push(opex);
                        out.taxes.push(taxes);
                        out.interest.push(interest);
                        out.principal.push(principal);
                        out.debtService.push(debtSvc);
                        out.netCashflow.push(net);
                        out.cashOpening.push(cash);
                        cash += net;
                        out.cashClosing.push(cash);
                    }
                }
                let minClosing = Infinity, minMonth = 0, negCount = 0, negNetCount = 0;
                out.cashClosing.forEach((c, i) => {
                    if (c < minClosing) { minClosing = c; minMonth = out.months[i]; }
                    if (c < 0) negCount++;
                });
                out.netCashflow.forEach(v => { if (v < 0) negNetCount++; });
                out.minCashClosing = isFinite(minClosing) ? minClosing : 0;
                out.minCashMonth = minMonth;
                out.negativeMonths = negCount;
                out.negativeNetMonths = negNetCount;
                return out;
            }

            // ═══ CF3: schedule mensile date-aware (COD dinamici + lag di incasso per regime) ═══
            // Orizzonte: anno 0 (àncora-1) + anni 1-5 (72 mesi) con etichette di calendario.
            // Quadratura: per ogni anno e stream, la somma dei mesi = valore annuo del matrix.
            // CF4: esborsi CAPEX datati per impianto (capexPayments), con default 100% al COD.
            // CF5: OPEX con scadenze (eventi ricorrenti per impianto + IMU giu/dic) e
            //      imposte IRES/IRAP dal P&L pagate l'anno successivo (taxPaymentMonth).
            function buildMonthlyCashflowDated(plantsList, mtx, ds, inputs, anchorYearIn, capexPayments, opexEvents, funding) {
                const YEARS = 5;
                const MONTHS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
                const totalMonths = (YEARS + 1) * 12;
                const out = {
                    mode: 'dated', anchorYear: anchorYearIn, hasYear0: true,
                    months: [], labels: [], calendarYears: [],
                    revenueAccrued: [], revenueCollected: [], revenueTotal: [],
                    opex: [], taxes: [], interest: [], principal: [], debtService: [],
                    capexOutflow: [],
                    fundingInflow: [],
                    vatCollected: [], vatPaidToSuppliers: [], vatRemitted: [], vatRefundReceived: [], vatCompensated: [], vatCreditEnd: [], vatCashFlow: [],
                    vatMaxCredit: 0, vatNetCumulative: 0, vatEnabled: false,
                    netCashflow: [], cashOpening: [], cashClosing: [],
                    fundedCashOpening: [], fundedCashClosing: [],
                    holdcoSociService: [], holdcoPdService: [], holdcoOtherCosts: [],
                    sociService: [], pdService: [],
                    holdcoNetCashflow: [], holdcoCashOpening: [], holdcoCashClosing: [],
                    lagResidual: 0, capexBeforeHorizon: 0, taxesAfterHorizon: 0,
                    fundedMinCashClosing: 0, fundedMinMonth: 0, datedXirr: 0
                };
                const accrued = new Float64Array(totalMonths);
                const collected = new Float64Array(totalMonths);

                // CF10/CF11: meccanismo IVA di cassa. L'IVA a debito sui ricavi è per regime
                // di mercato (reverse charge = 0%); se i campi per regime non sono definiti
                // si ripiega sulla vecchia aliquota globale × % ricavi imponibili.
                const vatEnabled = inputs.vatEnabled !== undefined ? !!inputs.vatEnabled : true;
                const vatRate = (inputs.vatRate !== undefined ? inputs.vatRate : 22) / 100;
                const vatTaxableRevenuePct = (inputs.vatTaxableRevenuePct !== undefined ? inputs.vatTaxableRevenuePct : 100) / 100;
                const vatSettlement = inputs.vatSettlement || 'mensile';
                const vatSettleEvery = (vatSettlement === 'trimestrale') ? 3 : 1;
                const vatTrMode = inputs.vatTrMode || (inputs.vatRefundEnabled === false ? 'riporto' : (inputs.vatRefundEnabled ? 'rimborso' : 'riporto'));
                const vatRefundLag = (inputs.vatRefundLagMonths !== undefined && inputs.vatRefundLagMonths !== null && !isNaN(parseInt(inputs.vatRefundLagMonths, 10)))
                    ? Math.max(0, parseInt(inputs.vatRefundLagMonths, 10))
                    : 0;
                const scheduledRefunds = new Float64Array(totalMonths);
                const _vatRevPct = (v, def) => ((v !== undefined && v !== null && isFinite(v)) ? v : def) / 100;
                const hasStreamVat = ['vatRevPpa', 'vatRevRid', 'vatRevBrp', 'vatRevCer', 'vatRevFerx']
                    .some(k => inputs[k] !== undefined && inputs[k] !== null);
                const legacyOutRate = vatRate * vatTaxableRevenuePct;
                const vatRevRateFor = (pl, stream) => {
                    if (!hasStreamVat) return legacyOutRate;
                    const rPpa = _vatRevPct(inputs.vatRevPpa, 0);
                    const rRid = _vatRevPct(inputs.vatRevRid, 0);
                    const rBrp = _vatRevPct(inputs.vatRevBrp, 0);
                    const rCer = _vatRevPct(inputs.vatRevCer, 22);
                    const rFerx = _vatRevPct(inputs.vatRevFerx, 0);
                    if (pl.marketType === 'cer') return rCer; // corrispettivi CER soggetti a IVA 22%
                    if (stream === 'ppa') return rPpa;        // PPA on-site: reverse charge
                    if (stream === 'rid') {
                        if (pl.marketType === 'fer_x') return rFerx;
                        if (pl.marketType === 'brp') return rBrp;
                        return rRid;                          // RID GSE: reverse charge
                    }
                    return rBrp;                              // arbitraggio/time-shifting via BRP: reverse charge
                };
                const vatOutPre = new Float64Array(totalMonths);

                // Forme orarie anno 1 per impianto e per stream di ricavo
                const plantShapes = plantsList.map(pl => {
                    const s = pl.sim;
                    const shapes = { ppa: new Float64Array(12), rid: new Float64Array(12), arb: new Float64Array(12), ts: new Float64Array(12) };
                    if (s) {
                        for (let t = 0; t < 8760; t++) {
                            const m = getMonthOfHour(t);
                            if (s.hourlyRevenuePpaPv) shapes.ppa[m] += s.hourlyRevenuePpaPv[t] + (s.hourlyRevenuePpaBess ? s.hourlyRevenuePpaBess[t] : 0);
                            if (s.hourlyRevenueRidActual) shapes.rid[m] += s.hourlyRevenueRidActual[t];
                            if (s.hourlyRevenueArbitrageGrid) shapes.arb[m] += s.hourlyRevenueArbitrageGrid[t];
                            if (s.hourlyRevenueTimeshifting) shapes.ts[m] += s.hourlyRevenueTimeshifting[t];
                        }
                    }
                    const totals = {
                        ppa: shapes.ppa.reduce((a, b) => a + b, 0),
                        rid: shapes.rid.reduce((a, b) => a + b, 0),
                        arb: shapes.arb.reduce((a, b) => a + b, 0),
                        ts: shapes.ts.reduce((a, b) => a + b, 0)
                    };
                    const hasCer = !!(pl._stab && pl._stab.ppaType === 'cer');
                    return {
                        shapes, totals,
                        lag: collectionLagForPlant(pl, inputs, hasCer),
                        cod: pl._codParsed || null,
                        revVat: {
                            ppa: vatRevRateFor(pl, 'ppa'), rid: vatRevRateFor(pl, 'rid'),
                            arb: vatRevRateFor(pl, 'arb'), ts: vatRevRateFor(pl, 'ts')
                        }
                    };
                });

                const STREAMS = ['ppa', 'rid', 'arb', 'ts'];
                const annualByStream = { ppa: mtx.revenuePpa, rid: mtx.revenueRid, arb: mtx.revenueArbitrage, ts: mtx.revenueTimeshifting };

                for (let y = 1; y <= YEARS; y++) {
                    const yi = y - 1;
                    const calYear = anchorYearIn + y - 1;
                    STREAMS.forEach(sName => {
                        const annual = (annualByStream[sName] && annualByStream[sName][y]) || 0;
                        if (annual === 0) return;
                        let wSum = 0;
                        const weights = plantShapes.map(ps => {
                            const w = ps.totals[sName] * codYearAvailability(ps.cod, calYear);
                            wSum += w;
                            return w;
                        });
                        if (wSum <= 1e-9) return;
                        plantShapes.forEach((ps, pi) => {
                            if (weights[pi] <= 0) return;
                            const plantAnnual = annual * weights[pi] / wSum;
                            const mShares = new Float64Array(12);
                            let mSum = 0;
                            for (let m = 0; m < 12; m++) {
                                const v = ps.shapes[sName][m] * codMonthActiveFraction(ps.cod, calYear, m + 1);
                                mShares[m] = v;
                                mSum += v;
                            }
                            if (mSum <= 1e-9) return;
                            for (let m = 0; m < 12; m++) {
                                const val = plantAnnual * mShares[m] / mSum;
                                const gi = 12 + yi * 12 + m; // l'anno 0 occupa i primi 12 slot
                                accrued[gi] += val;
                                const ci = gi + ps.lag;
                                if (ci < totalMonths) {
                                    collected[ci] += val;
                                    vatOutPre[ci] += val * ps.revVat[sName];
                                } else out.lagResidual += val;
                            }
                        });
                    });
                }

                // ═══ CF5/CF9: OPEX e imposte ═══
                // OPEX: modello budget (CF9) — eventi dichiarati + residuo /12 (blocco sotto).
                // Imposte dal P&L pagate a taxPaymentMonth dell'anno successivo.
                const taxPayMonth = Math.min(12, Math.max(1, parseInt(inputs.taxPaymentMonth, 10) || 6));
                const taxesOut = new Float64Array(totalMonths);
                for (let y = 1; y <= YEARS; y++) {
                    const tax = (mtx.currentTaxesSpv && mtx.currentTaxesSpv[y]) || 0;
                    if (tax === 0) continue;
                    const payIdx = 12 + y * 12 + (taxPayMonth - 1); // mese scelto dell'anno y+1
                    if (payIdx < totalMonths) taxesOut[payIdx] += tax;
                    else out.taxesAfterHorizon += tax;
                }

                // CF11: aliquote IVA per categoria (frazioni). Le voci di budget ereditano
                // l'aliquota della propria categoria; le voci personalizzate usano vat_rate
                // della riga (NULL = 22%).
                const _vatPct = (v, def) => ((v !== undefined && v !== null && isFinite(v)) ? v : def) / 100;
                const vatCapexRateByLabel = {
                    'EPC FV': _vatPct(inputs.vatCapexEpcFv, 22),
                    'EPC BESS': _vatPct(inputs.vatCapexEpcBess, 22),
                    'Connessione rete': _vatPct(inputs.vatCapexConnection, 22),
                    'Sviluppo': _vatPct(inputs.vatCapexDevelopment, 22),
                    'Acquisto SPV': _vatPct(inputs.vatCapexSpv, 22),
                    'Terreno': _vatPct(inputs.vatCapexLand, 0)
                };
                const vatOpexRateByLabel = {
                    'O&M FV': _vatPct(inputs.vatOpexOmFv, 22),
                    'O&M BESS': _vatPct(inputs.vatOpexOmBess, 22),
                    'Assicurazione': _vatPct(inputs.vatOpexInsurance, 0),
                    'IMU / Tasse locali': _vatPct(inputs.vatOpexImu, 0),
                    'Sicurezza': _vatPct(inputs.vatOpexSecurity, 22),
                    'Asset Management': _vatPct(inputs.vatOpexAssetMgmt, 22),
                    'Manutenzione straordinaria': _vatPct(inputs.vatOpexOmFv, 22)
                };
                // IVA delle voci personalizzate di un impianto: { net, vat } per tipo
                const customVatByType = (pl, type) => {
                    let net = 0, vat = 0;
                    (pl.customCosts || []).forEach(r => {
                        if (r.cost_type !== type) return;
                        const amt = parseFloat(r.amount_eur !== undefined ? r.amount_eur : r.amountEur) || 0;
                        const val = r.unit === 'per_kwp' ? amt * (pl.capacity || 0) : amt;
                        if (val <= 0) return;
                        const rate = (r.vat_rate !== undefined && r.vat_rate !== null) ? parseFloat(r.vat_rate) / 100 : 0.22;
                        net += val;
                        vat += val * rate;
                    });
                    return { net, vat };
                };

                // CF9: budget CAPEX = investimento complessivo (totalProjectCost).
                // Gli esborsi espliciti (capexPayments) controllano il "quando"; il residuo
                // non allocato di ciascun impianto viene collocato alla sua data di COD.
                const capexOut = new Float64Array(totalMonths);
                const capexVat = new Float64Array(totalMonths); // CF11: IVA pagata sui pagamenti CAPEX
                const firstYear = anchorYearIn - 1; // anno 0
                let capexAllocated = 0;
                let capexVatAllocated = 0;
                let sumPlantCapex = 0;
                let sumPlantCapexVat = 0;
                let residualPlantsSum = 0;
                const plantBases = [];
                plantsList.forEach(pl => {
                    const base = (pl.capacity || 0) * (pl.capex || 0) + ((pl.bessMwh || 0) * 1000) * (pl.bessCapexKwh || 0) +
                        (pl.connectionCost || 0) + (pl.developmentCost || 0) + (pl.spvAcquisitionCost || 0) + (pl.customCapexEur || 0);
                    sumPlantCapex += base;
                    // CF11: aliquota media ponderata del CAPEX impianto (per residuo e voci "Altro")
                    const cc = customVatByType(pl, 'capex');
                    const plantVatBase = (pl.capacity || 0) * (pl.capex || 0) * vatCapexRateByLabel['EPC FV'] +
                        ((pl.bessMwh || 0) * 1000) * (pl.bessCapexKwh || 0) * vatCapexRateByLabel['EPC BESS'] +
                        (pl.connectionCost || 0) * vatCapexRateByLabel['Connessione rete'] +
                        (pl.developmentCost || 0) * vatCapexRateByLabel['Sviluppo'] +
                        (pl.spvAcquisitionCost || 0) * vatCapexRateByLabel['Acquisto SPV'] + cc.vat;
                    const plantVatBlend = base > 0 ? plantVatBase / base : vatCapexRateByLabel['EPC FV'];
                    sumPlantCapexVat += plantVatBase;
                    const cod = pl._codParsed;
                    const codIdx = cod ? (cod.y - firstYear) * 12 + (cod.m - 1) : 12; // senza COD: gen anno 1
                    plantBases.push({ base, codIdx, vatBlend: plantVatBlend });
                    const list = (capexPayments && capexPayments[pl.id]) || [];
                    let outlaysSum = 0;
                    list.forEach(pm => {
                        const amt = parseFloat(pm.amount) || 0;
                        if (amt <= 0) return;
                        capexAllocated += amt;
                        outlaysSum += amt;
                        const rate = vatCapexRateByLabel[pm.label] !== undefined ? vatCapexRateByLabel[pm.label] : plantVatBlend;
                        const vatAmt = amt * rate;
                        capexVatAllocated += vatAmt;
                        const d = parseCodDate(pm.date);
                        const idx = d ? (d.y - firstYear) * 12 + (d.m - 1) : codIdx;
                        if (idx < 0) out.capexBeforeHorizon += amt;
                        else if (idx < totalMonths) { capexOut[idx] += amt; capexVat[idx] += vatAmt; }
                    });
                    // Residuo impianto (CAPEX non ancora allocato) collocato al COD
                    const residual = Math.max(0, base - outlaysSum);
                    residualPlantsSum += residual;
                    if (residual > 0) {
                        if (codIdx >= 0 && codIdx < totalMonths) { capexOut[codIdx] += residual; capexVat[codIdx] += residual * plantVatBlend; }
                        else if (codIdx < 0) out.capexBeforeHorizon += residual;
                    }
                });
                // Costi non attribuibili al singolo impianto (IDC, terreni, ecc.):
                // gli esborsi datati coprono l'INTERO budget (anche terreni/IDC, che non
                // sono nelle basi impianto) — al COD va solo il residuo davvero scoperto.
                const totalProjCost = (funding && funding.totalProjectCost) || mtx.totalProjectCost || 0;
                const totalResidualAll = Math.max(0, totalProjCost - capexAllocated);
                const extra = Math.max(0, totalResidualAll - residualPlantsSum);
                const projectVatBlend = sumPlantCapex > 0 ? sumPlantCapexVat / sumPlantCapex : vatCapexRateByLabel['EPC FV'];
                if (extra > 0 && sumPlantCapex > 0) {
                    plantBases.forEach(pb => {
                        const share = extra * (pb.base / sumPlantCapex);
                        if (share <= 0) return;
                        if (pb.codIdx >= 0 && pb.codIdx < totalMonths) { capexOut[pb.codIdx] += share; capexVat[pb.codIdx] += share * projectVatBlend; }
                        else if (pb.codIdx < 0) out.capexBeforeHorizon += share;
                    });
                } else if (extra > 0) {
                    capexOut[12] += extra;
                    capexVat[12] += extra * projectVatBlend;
                }
                out.capexBudget = totalProjCost;
                out.capexAllocated = capexAllocated;
                out.capexResidual = Math.max(0, totalProjCost - capexAllocated);
                out.capexVatAllocated = capexVatAllocated;
                out.capexGrossAllocated = capexAllocated + capexVatAllocated;

                // CF9: budget OPEX = OPEX Anno 1; eventi dichiarati sul loro mese,
                // il residuo non allocato si spalma uniformemente (/12).
                // CF11: regola temporale per evento: 'sempre' (default) | 'gt_cod'
                // (strettamente dopo la data di COD: spesa nel mese del COD slitta
                // all'anno dopo) | 'lt_cod' (solo mesi solari prima del mese di COD).
                const opexEvMonthlyY = Array.from({ length: YEARS }, () => new Float64Array(12));
                const opexVatEvMonthlyY = Array.from({ length: YEARS }, () => new Float64Array(12));
                const opexEvTotalY = new Float64Array(YEARS);
                const opexEvMonthlyY0 = new Float64Array(12);
                const opexVatEvMonthlyY0 = new Float64Array(12);
                let opexEvTotalY0 = 0;
                let opexEvTotal = 0;
                let opexVatEvTotal = 0;
                const calYear0 = anchorYearIn - 1;
                plantsList.forEach(pl => {
                    const cod = pl._codParsed || null;
                    const evs = (opexEvents && opexEvents[pl.id]) || [];
                    evs.forEach(ev => {
                        const m = parseInt(ev.month, 10);
                        const amt = parseFloat(ev.amount) || 0;
                        if (!(m >= 1 && m <= 12) || !(amt > 0)) return;
                        const rule = ev.rule === 'gt_cod' || ev.rule === 'lt_cod' ? ev.rule : 'sempre';
                        const rate = vatOpexRateByLabel[ev.label] !== undefined ? vatOpexRateByLabel[ev.label] : _vatPct(inputs.vatOpexAssetMgmt, 22);
                        opexEvTotal += amt;
                        opexVatEvTotal += amt * rate;

                        // Anno 0 (pre-COD)
                        let activeY0 = false;
                        if (rule === 'sempre') activeY0 = true;
                        else if (rule === 'lt_cod' && cod) activeY0 = (calYear0 < cod.y) || (calYear0 === cod.y && m < cod.m);
                        else if (rule === 'gt_cod' && cod) activeY0 = (calYear0 > cod.y) || (calYear0 === cod.y && m > cod.m);
                        if (activeY0) {
                            opexEvMonthlyY0[m - 1] += amt;
                            opexVatEvMonthlyY0[m - 1] += amt * rate;
                            opexEvTotalY0 += amt;
                        }

                        for (let yi = 0; yi < YEARS; yi++) {
                            const calYear = anchorYearIn + yi;
                            let active = true;
                            if (rule === 'gt_cod' && cod) active = (calYear > cod.y) || (calYear === cod.y && m > cod.m);
                            else if (rule === 'lt_cod' && cod) active = (calYear < cod.y) || (calYear === cod.y && m < cod.m);
                            if (!active) continue;
                            opexEvMonthlyY[yi][m - 1] += amt;
                            opexVatEvMonthlyY[yi][m - 1] += amt * rate;
                            opexEvTotalY[yi] += amt;
                        }
                    });
                });
                out.opexBudgetY0 = (mtx.opexTotal && mtx.opexTotal[0]) || 0;
                out.opexBudgetY1 = (mtx.opexTotal && mtx.opexTotal[1]) || 0;
                out.opexAllocated = opexEvTotal;                        // dichiarato (tutti gli eventi)
                out.opexAllocatedY0 = opexEvTotalY0;
                out.opexAllocatedY1 = opexEvTotalY[0] || 0;             // effettivo in Anno 1 (regole temporali)
                out.opexResidual = Math.max(0, out.opexBudgetY1 - (opexEvTotalY[0] || 0)); // indicatore di copertura (non genera cassa)
                out.opexVatAllocated = opexVatEvTotal;
                out.opexGrossAllocated = opexEvTotal + opexVatEvTotal;

                // CF6/CF11: vista Holding mensile — servizi Soci e PD sono DATATI
                // (calcolati sotto, senza ripartizioni /12); gli oneri Holding annuali
                // (earnout, OPEX HoldCo, imposte Holding) restano spalmati /12 perché
                // aggregati annui senza scadenza dichiarata.
                const otherM = new Float64Array(YEARS);
                for (let y = 1; y <= YEARS; y++) {
                    const yi = y - 1;
                    otherM[yi] = (((mtx.holdcoEarnoutPaid && mtx.holdcoEarnoutPaid[y]) || 0) + ((mtx.holdcoOpex && mtx.holdcoOpex[y]) || 0) +
                        ((mtx.holdcoIresTaxPaid && mtx.holdcoIresTaxPaid[y]) || 0) + ((mtx.holdcoIrapTaxPaid && mtx.holdcoIrapTaxPaid[y]) || 0)) / 12;
                }
                const otherM_Y0 = (((mtx.holdcoEarnoutPaid && mtx.holdcoEarnoutPaid[0]) || 0) + ((mtx.holdcoOpex && mtx.holdcoOpex[0]) || 0) +
                    ((mtx.holdcoIresTaxPaid && mtx.holdcoIresTaxPaid[0]) || 0) + ((mtx.holdcoIrapTaxPaid && mtx.holdcoIrapTaxPaid[0]) || 0)) / 12;

                let cash = 0;
                let holdcoCash = 0;
                let fundedCash = 0;

                // CF8: flussi in entrata di equity/soci/debito sulle date di messa a disposizione
                const dateToIdx = (dstr) => {
                    if (!dstr) return null;
                    const parts = String(dstr).split('-');
                    const y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10);
                    if (!y || !mo) return null;
                    const idx = (y - (anchorYearIn - 1)) * 12 + (mo - 1);
                    return (idx >= 0 && idx < totalMonths) ? idx : null;
                };
                let firstCapexIdx = 12;
                for (let i = 0; i < totalMonths; i++) { if (capexOut[i] > 0) { firstCapexIdx = i; break; } }
                const fundingInflow = new Float64Array(totalMonths);
                const eqIdx = dateToIdx(inputs.fundingEquityDate) !== null ? dateToIdx(inputs.fundingEquityDate) : firstCapexIdx;
                const sociIdx = dateToIdx(inputs.fundingSociDate) !== null ? dateToIdx(inputs.fundingSociDate) : firstCapexIdx;
                const debtIdx = dateToIdx(inputs.fundingDebtDate) !== null ? dateToIdx(inputs.fundingDebtDate) : firstCapexIdx;
                fundingInflow[eqIdx] += (funding && funding.equityAmount) || 0;
                fundingInflow[sociIdx] += (funding && funding.sociLoan) || 0;
                fundingInflow[debtIdx] += (funding && funding.debtAmount) || 0;

                // CF11: servizio debito SENIOR DATATO — decorre dal COD (logica Project Finance)
                // con preammortamento (seniorGracePeriodMonths) solo interessi, poi ammortamento
                // francese con frequenza impostata in FINANZA (mensile, trimestrale, semestrale, annuale).
                // Nei mesi pre-COD l'impianto è in costruzione: gli interessi sono IDC capitalizzati in CAPEX
                // e non gravano sulla cassa operativa della gestione.
                const interestDated = new Float64Array(totalMonths);
                const principalDated = new Float64Array(totalMonths);
                {
                    const P0 = (funding && funding.debtAmount) || 0;
                    const rate = inputs.interestRate !== undefined ? inputs.interestRate : 0.045;
                    const termYears = parseInt(inputs.loanTerm, 10) || 0;
                    const graceM = Math.max(0, parseInt(inputs.seniorGracePeriodMonths, 10) || 0);
                    const dIdx = debtIdx; // data afflusso CF8
                    const dParsed = parseCodDate(inputs.fundingDebtDate);

                    let minCodIdx = totalMonths;
                    let minCodDate = null;
                    plantsList.forEach(pl => {
                        if (pl.enabled !== false && pl._codParsed) {
                            const idx = (pl._codParsed.y - firstYear) * 12 + (pl._codParsed.m - 1);
                            if (idx < minCodIdx) {
                                minCodIdx = idx;
                                minCodDate = pl._codParsed;
                            }
                        }
                    });

                    const hasExplicitDebtDate = Boolean(inputs.fundingDebtDate && String(inputs.fundingDebtDate).trim());
                    const svcStartIdx = hasExplicitDebtDate ? (dIdx + 1) : (minCodDate !== null ? minCodIdx : (dIdx + 1));
                    const svcRefParsed = hasExplicitDebtDate ? dParsed : (minCodDate !== null ? minCodDate : dParsed);

                    let mDebtDated = 12; // default legacy mensile se non specificato
                    if (inputs.debtRepaymentFrequency === 'mensile') mDebtDated = 12;
                    else if (inputs.debtRepaymentFrequency === 'trimestrale') mDebtDated = 4;
                    else if (inputs.debtRepaymentFrequency === 'semestrale') mDebtDated = 2;
                    else if (inputs.debtRepaymentFrequency === 'annuale') mDebtDated = 1;

                    if (P0 > 0 && termYears > 0 && svcStartIdx >= 0 && svcStartIdx < totalMonths) {
                        if (mDebtDated === 12) {
                            const im = rate / 12;
                            const firstIdx = svcStartIdx;
                            const startIdx = Math.min(totalMonths, firstIdx + graceM);
                            const nMonths = Math.max(1, termYears * 12 - graceM);
                            const annuity = im > 0 ? P0 * im / (1 - Math.pow(1 + im, -nMonths)) : P0 / nMonths;
                            let outstanding = P0;
                            for (let i = firstIdx; i < totalMonths && outstanding > 1e-9; i++) {
                                const yy = anchorYearIn - 1 + Math.floor(i / 12);
                                const mm = (i % 12) + 1;
                                const dim = codDaysInMonth(yy, mm);
                                let days = dim;
                                if (i === firstIdx && svcRefParsed) {
                                    if (hasExplicitDebtDate) {
                                        days = Math.max(1, codDaysInMonth(svcRefParsed.y, svcRefParsed.m) - svcRefParsed.d + 1) + dim;
                                    } else if (svcRefParsed.d > 1) {
                                        days = Math.max(1, codDaysInMonth(svcRefParsed.y, svcRefParsed.m) - svcRefParsed.d + 1);
                                    }
                                }
                                const totalDaysYear = (codDaysInMonth(yy, 2) === 29 ? 366 : 365);
                                const dayDivisor = hasExplicitDebtDate ? 360 : totalDaysYear;
                                const intM = outstanding * rate * days / dayDivisor;
                                let prinM = 0;
                                if (i >= startIdx) {
                                    prinM = (i === startIdx + nMonths - 1) ? outstanding : Math.max(0, annuity - intM);
                                    prinM = Math.min(prinM, outstanding);
                                    outstanding -= prinM;
                                }
                                interestDated[i] = intM;
                                principalDated[i] = prinM;
                            }
                        } else {
                            const stepM = Math.max(1, Math.round(12 / mDebtDated));
                            const nPeriodsTotal = termYears * mDebtDated;
                            let remainingGraceP = graceM / stepM;
                            const nAmortPeriods = Math.max(0.1, nPeriodsTotal - (graceM / stepM));
                            const im = rate / mDebtDated;
                            const annuity = im > 0 ? P0 * im / (1 - Math.pow(1 + im, -nAmortPeriods)) : P0 / nAmortPeriods;
                            let outstanding = P0;
                            for (let k = 1; k <= nPeriodsTotal && outstanding > 1e-9; k++) {
                                const payIdx = svcStartIdx + k * stepM - 1;
                                if (payIdx >= totalMonths) break;

                                const intP = outstanding * im;
                                let prinP = 0;
                                const graceInP = Math.min(remainingGraceP, 1.0);
                                remainingGraceP = Math.max(0, remainingGraceP - graceInP);
                                const amortInP = Math.max(0, 1.0 - graceInP);
                                if (amortInP > 0) {
                                    const amortInt = outstanding * im * amortInP;
                                    prinP = (k === nPeriodsTotal) ? outstanding : Math.max(0, (annuity * amortInP) - amortInt);
                                    prinP = Math.min(prinP, outstanding);
                                    outstanding -= prinP;
                                }
                                interestDated[payIdx] = intP;
                                principalDated[payIdx] = prinP;
                            }
                        }
                    }
                }

                // CF11: servizio PRIVATE DEBT DATATO — decorre dall'erogazione (cluster
                // debito), pro-rata giorni act/360, grace in FINANZA (anni → mesi), poi
                // stessa semantica dell'annuale: bullet_exit = PIK composto + bullet a
                // exit; annual_interest = interessi in cassa + bullet a exit;
                // amortizing = rata mensile francese + bullet del residuo a exit.
                const pdSvcDated = new Float64Array(totalMonths);
                {
                    const pdP0 = pdAmount || 0;
                    if (p.pdEnabled && pdP0 > 0 && debtIdx >= 0 && debtIdx < totalMonths) {
                        const pdRate = (p.pdInterestRate || 0) / 100;
                        const pdParsed = parseCodDate(inputs.fundingDebtDate);
                        const graceIntM = Math.max(0, (p.pdInterestGrace || 0)) * 12;
                        const gracePrinM = Math.max(0, (p.pdPrincipalGrace || 0)) * 12;
                        const exitY = exitOptionYear > 0 ? exitOptionYear : exitYear;
                        const exitIdx = 12 + (exitY - 1) * 12 + 11; // dic dell'anno di exit
                        const pdDaysAt = (i) => {
                            const yy = anchorYearIn - 1 + Math.floor(i / 12);
                            const mm = (i % 12) + 1;
                            const dim = codDaysInMonth(yy, mm);
                            // Primo pagamento: interessi dal giorno di erogazione a fine mese
                            if (i === debtIdx + 1 && pdParsed) {
                                return Math.max(1, codDaysInMonth(pdParsed.y, pdParsed.m) - pdParsed.d + 1) + dim;
                            }
                            return dim;
                        };
                        let outstanding = pdP0;
                        const im = pdRate / 12;
                        const termM = Math.max(1, (p.pdLoanTerm || 10) * 12);
                        const pdFirstIdx = debtIdx + 1; // primo pagamento nel mese successivo all'erogazione
                        const startIdx = Math.min(totalMonths, pdFirstIdx + gracePrinM);
                        const nM = Math.max(1, termM - gracePrinM);
                        const pdAnnuity = im > 0 ? pdP0 * im / (1 - Math.pow(1 + im, -nM)) : pdP0 / nM;
                        for (let i = pdFirstIdx; i < totalMonths && outstanding > 1e-9; i++) {
                            if (exitIdx >= 0 && exitIdx < totalMonths && i === exitIdx) {
                                pdSvcDated[i] += outstanding; outstanding = 0; break;
                            }
                            const intDue = (i >= pdFirstIdx + graceIntM) ? outstanding * pdRate * pdDaysAt(i) / 360 : 0;
                            let svc = 0;
                            if (p.pdMode === 'amortizing') {
                                svc = intDue;
                                if (i >= startIdx) {
                                    let prin = (i === startIdx + nM - 1) ? outstanding : Math.max(0, pdAnnuity - intDue);
                                    prin = Math.min(prin, outstanding);
                                    outstanding -= prin;
                                    svc += prin;
                                }
                            } else if (p.pdMode === 'annual_interest') {
                                svc = intDue; // interessi pagati in cassa, capitale bullet a exit
                            } else { // bullet_exit: PIK composto, nessun esborso fino a exit
                                outstanding += intDue;
                            }
                            pdSvcDated[i] += svc;
                        }
                    }
                }

                // CF11: FINANZIAMENTO SOCI DATATO — waterfall mensile sulla cassa
                // disponibile (interessi dal termine della grazia interessi, capitale
                // dal termine della grazia capitale; interessi non pagati capitalizzati).
                const sociSvcDated = new Float64Array(totalMonths);
                const sociState = {
                    outstanding: (funding && funding.sociLoan) || 0,
                    rate: (inputs.sociInterestRate !== undefined ? inputs.sociInterestRate : 0) / 100,
                    graceIntM: Math.max(0, parseInt(inputs.sociInterestGrace, 10) || 0) * 12,
                    gracePrinM: Math.max(0, parseInt(inputs.sociPrincipalGrace, 10) || 0) * 12,
                    parsed: parseCodDate(inputs.fundingSociDate)
                };

                // ═══ CF10/CF11: IVA solo cash flow (pass-through, non tocca P&L né IRR) ═══
                // IVA a debito sui ricavi incassati (per regime, calcolata in vatOutPre),
                // IVA a credito su CAPEX+OPEX pagati (per categoria), liquidazione periodica
                // con credito IVA portato a nuovo. Effetto sul cash flow = incassata −
                // pagata ai fornitori − versata all'erario. Costanti IVA dichiarate sopra.
                let vatCredit = 0;
                let pendingRefund = 0;
                out.vatEnabled = vatEnabled;

                for (let i = 0; i < totalMonths; i++) {
                    const isYear0 = i < 12;
                    const yi = isYear0 ? -1 : Math.floor((i - 12) / 12);
                    const m = i % 12;
                    const calYear = anchorYearIn - 1 + Math.floor(i / 12);
                    // CF9/CF11: OPEX di cassa = SOLO eventi dichiarati attivi nel mese
                    // (con regole temporali). Nessuna spalmatura fittizia: il cash flow
                    // riflette esclusivamente le uscite reali dichiarate dall'utente.
                    const opex = isYear0 ? 0 : opexEvMonthlyY[yi][m];
                    // CF11: debito senior datato (erogazione + preammortamento + pro-rata giorni)
                    const interest = interestDated[i];
                    const principal = principalDated[i] + (isYear0 ? 0 : (ds.principalVoluntary[yi + 1] || 0) / 12);
                    const debtSvc = interest + principal;
                    // CF10/CF11: IVA di cassa del mese
                    let vatOut = 0, vatIn = 0, vatRemit = 0;
                    if (vatEnabled) {
                        vatOut = vatOutPre[i];
                        // CF11: IVA a credito per categoria: esborsi CAPEX con aliquota della
                        // voce + eventi OPEX con aliquota della voce (solo uscite reali).
                        const vatInOpex = isYear0 ? 0 : opexVatEvMonthlyY[yi][m];
                        vatIn = capexVat[i] + vatInOpex;
                        vatCredit += vatIn - vatOut;
                        const isSettle = ((i % vatSettleEvery) === (vatSettleEvery - 1)) || (i === totalMonths - 1);
                        if (isSettle && (vatCredit - pendingRefund) < 0) {
                            vatRemit = -(vatCredit - pendingRefund);
                            vatCredit = pendingRefund;
                        }
                    }

                    // Compensazione F24 con imposte correnti (IRES/IRAP in taxesOut[i]):
                    let comp = 0;
                    if (vatEnabled && (vatTrMode === 'compensazione' || vatTrMode === 'ibrido') && taxesOut[i] > 0) {
                        const availableCredit = Math.max(0, vatCredit - pendingRefund);
                        if (availableCredit > 0) {
                            comp = Math.min(availableCredit, taxesOut[i]);
                            taxesOut[i] -= comp;
                            vatCredit -= comp;
                        }
                    }
                    const taxes = taxesOut[i];

                    // Istanza trimestrale Modello IVA TR (fine trimestri solari: m = 2 (mar), 5 (giu), 8 (set), 11 (dic))
                    if (vatEnabled && (vatTrMode === 'rimborso' || vatTrMode === 'ibrido')) {
                        const isQuarterEnd = (m === 2 || m === 5 || m === 8 || m === 11);
                        const availableCredit = Math.max(0, vatCredit - pendingRefund);
                        if (isQuarterEnd && availableCredit >= 2582.28) {
                            const req = availableCredit;
                            pendingRefund += req;
                            const payIdx = i + vatRefundLag;
                            if (payIdx < totalMonths) {
                                scheduledRefunds[payIdx] += req;
                            } else {
                                out.vatRefundAfterHorizon = (out.vatRefundAfterHorizon || 0) + req;
                            }
                        }
                    }

                    const refundRec = vatEnabled ? scheduledRefunds[i] : 0;
                    if (refundRec > 0) {
                        pendingRefund = Math.max(0, pendingRefund - refundRec);
                        vatCredit = Math.max(0, vatCredit - refundRec);
                    }

                    const vatCashFlow = vatEnabled ? (vatOut - vatIn - vatRemit + refundRec) : 0;
                    out.vatCollected.push(vatOut);
                    out.vatPaidToSuppliers.push(vatIn);
                    out.vatRemitted.push(vatRemit);
                    out.vatRefundReceived.push(refundRec);
                    out.vatCompensated.push(comp);
                    out.vatCreditEnd.push(vatCredit);
                    out.vatCashFlow.push(vatCashFlow);
                    const net = collected[i] - opex - taxes - debtSvc - capexOut[i] + vatCashFlow;
                    out.months.push(i + 1);
                    out.labels.push(MONTHS_IT[m] + ' ' + calYear + (isYear0 ? ' (Y0)' : ''));
                    out.calendarYears.push(calYear);
                    out.revenueAccrued.push(accrued[i]);
                    out.revenueCollected.push(collected[i]);
                    out.revenueTotal.push(collected[i]);
                    out.opex.push(opex);
                    out.taxes.push(taxes);
                    out.interest.push(interest);
                    out.principal.push(principal);
                    out.debtService.push(debtSvc);
                    out.capexOutflow.push(capexOut[i]);
                    out.fundingInflow.push(fundingInflow[i]);
                    out.netCashflow.push(net);
                    out.cashOpening.push(cash);
                    cash += net;
                    out.cashClosing.push(cash);
                    // CF8: cassa "finanziata" = operativa + flussi in entrata equity/soci/debito
                    out.fundedCashOpening.push(fundedCash);
                    fundedCash += net + fundingInflow[i];
                    out.fundedCashClosing.push(fundedCash);
                    // CF6/CF11: cascata Holding = netto SPV − servizio soci (datato,
                    // waterfall sulla cassa del mese) − servizio PD (datato) − oneri HoldCo
                    let sociSvc = 0;
                    if (sociState.outstanding > 1e-9 && i >= sociIdx + 1) { // primo pagamento nel mese successivo all'erogazione
                        const yy = anchorYearIn - 1 + Math.floor(i / 12);
                        const mm = (i % 12) + 1;
                        const dim = codDaysInMonth(yy, mm);
                        let days = dim;
                        if (i === sociIdx + 1 && sociState.parsed) {
                            days = Math.max(1, codDaysInMonth(sociState.parsed.y, sociState.parsed.m) - sociState.parsed.d + 1) + dim;
                        }
                        let intDue = 0;
                        if (sociState.rate > 0 && i >= sociIdx + 1 + sociState.graceIntM) intDue = sociState.outstanding * sociState.rate * days / 360;
                        const cashAvail = Math.max(0, net);
                        const payInt = Math.min(intDue, cashAvail);
                        sociState.outstanding += intDue - payInt; // interessi non pagati capitalizzati
                        let payPrin = 0;
                        if (i >= sociIdx + 1 + sociState.gracePrinM) payPrin = Math.min(sociState.outstanding, Math.max(0, cashAvail - payInt));
                        sociState.outstanding -= payPrin;
                        sociSvc = payInt + payPrin;
                    }
                    sociSvcDated[i] = sociSvc;
                    const hSoci = sociSvc;
                    const hPd = pdSvcDated[i];
                    const hOther = isYear0 ? 0 : otherM[yi];
                    const hNet = net - hSoci - hPd - hOther;
                    out.sociService.push(sociSvc);
                    out.pdService.push(pdSvcDated[i]);
                    out.holdcoSociService.push(hSoci);
                    out.holdcoPdService.push(hPd);
                    out.holdcoOtherCosts.push(hOther);
                    out.holdcoNetCashflow.push(hNet);
                    out.holdcoCashOpening.push(holdcoCash);
                    holdcoCash += hNet;
                    out.holdcoCashClosing.push(holdcoCash);
                }
                let minClosing = Infinity, minMonth = 0, negCount = 0, negNetCount = 0;
                out.cashClosing.forEach((c, i) => {
                    if (c < minClosing) { minClosing = c; minMonth = out.months[i]; }
                    if (c < 0) negCount++;
                });
                out.netCashflow.forEach(v => { if (v < 0) negNetCount++; });
                out.minCashClosing = isFinite(minClosing) ? minClosing : 0;
                out.minCashMonth = minMonth;
                out.negativeMonths = negCount;
                out.negativeNetMonths = negNetCount;

                // CF10: aggregati IVA
                out.vatMaxCredit = out.vatCreditEnd.length ? Math.max.apply(null, out.vatCreditEnd) : 0;
                out.vatNetCumulative = out.vatCashFlow.reduce((a, b) => a + b, 0);
                out.vatCompensatedTotal = out.vatCompensated.reduce((a, b) => a + b, 0);
                out.vatRefundTotal = out.vatRefundReceived.reduce((a, b) => a + b, 0);
                out.taxesPaidTotal = out.taxes.reduce((a, b) => a + b, 0);
                out.taxesAccruedTotal = 0;
                for (let y = 1; y <= YEARS; y++) {
                    out.taxesAccruedTotal += (mtx.currentTaxesSpv && mtx.currentTaxesSpv[y]) || 0;
                }

                // CF8: minimo della cassa finanziata + XIRR equity datato
                let fMin = Infinity, fMinMonth = 0;
                out.fundedCashClosing.forEach((c, i) => { if (c < fMin) { fMin = c; fMinMonth = out.months[i]; } });
                out.fundedMinCashClosing = isFinite(fMin) ? fMin : 0;
                out.fundedMinMonth = fMinMonth;

                const eqParsed = parseCodDate(inputs.fundingEquityDate);
                const baseY = eqParsed ? eqParsed.y : anchorYearIn;
                const baseM = eqParsed ? eqParsed.m : 1;
                const toYears = (y, m) => (y - baseY) + ((m - 1) - (baseM - 1)) / 12;
                const equityCommitted = ((funding && funding.equityAmount) || 0) + ((funding && funding.sociLoan) || 0);
                const xflows = [{ t: 0, amount: -equityCommitted }];
                const nYr = (mtx.holdcoFCFE || []).length;
                for (let yr = 1; yr < nYr; yr++) {
                    const v = mtx.holdcoFCFE[yr] || 0;
                    if (Math.abs(v) > 1e-9) xflows.push({ t: toYears(anchorYearIn + yr - 1, 12), amount: v });
                }
                out.datedXirr = calculateXIRR(xflows);
                return out;
            }

            const finalResults = {
                medioneKpiText: medioneKpiText,
                totalProjectCost, debtAmount, equityAmount,
                initialShareholderLoan,
                y1OperatingAvail: y1DebtAvail,
                totalCustomCapex, totalCustomOpex,
                calculatedIrr, calculatedProjectIrr, calculatedSpvEquityIrr, spvEquityNpv, holdcoNpv, holdcoMoic, paybackPeriod, paybackPeriodUnlevered, calculatedLcoe, calculatedLcos, avgDscr: dscrYearsCount > 0 ? (sumDscr / dscrYearsCount) : 0, minDscr, totalEbitda, totalHoldcoFCFE,
                matrix, debtSchedule, combinedSolarProfile, generalMedionePrices, bessSimulation,
                monthlyCashflow: anchorYear !== null
                    ? buildMonthlyCashflowDated(activePlants, matrix, debtSchedule, State.inputs, anchorYear, State.capexPayments || null, State.opexEvents || null, {
                        equityAmount, debtAmount, sociLoan: initialShareholderLoan, totalProjectCost
                    })
                    : buildMonthlyCashflow(activePlants, matrix, debtSchedule),
                totalBessMw, totalBessMwh,
                totalSelfConsMwh, totalPpaRev_y1, totalStabLoadMwh,
                stabCoverage: totalStabLoadMwh > 0 ? (totalSelfConsMwh / totalStabLoadMwh * 100) : 0,
                // CAPEX breakdown fields
                totalEpcCapex, bessCAPEX, totalConnectionCapex, totalLandPurchaseCapex, totalLandDdsAttualizzatoCapex, totalDevelopmentCapex, totalSpvAcquisitionCapex,
                // External financing instruments totals
                pdAmount, peAmount, pdMode: p.pdMode, peMode: p.peMode, afType: p.afType, pdEnabled: p.pdEnabled, peEnabled: p.peEnabled, afEnabled: p.afEnabled,
                // Per-plant specific metrics needed by UI summaries
                plantsMetrics: activePlants.map(p => ({
                    id: p.id,
                    selfConsumptionMwh: p._selfConsumptionMwh || 0,
                    ppaRevenue_y1: p._ppaRevenue_y1 || 0,
                    annualSolarProductionMWh: p.annualSolarProductionMWh || 0,
                    sim: p.sim
                }))
            };
            return finalResults;
        }

        function resolveGridLosses(voltage, type) {
            // type: 'inject' | 'withdraw' | 'cpr'
            // voltage: 'bt' | 'mt' | 'at'
            const v = String(voltage || 'none').toLowerCase().trim();
            if (v !== 'bt' && v !== 'mt' && v !== 'at') return 0;
            const suffix = v === 'bt' ? 'Bt' : (v === 'mt' ? 'Mt' : 'At');
            let key = '';
            if (type === 'inject') key = 'ridLossInject' + suffix;
            else if (type === 'withdraw') key = 'ridLossWithdraw' + suffix;
            else if (type === 'cpr') key = 'cerLossCpr' + suffix;
            else return 0;
            return State.inputs[key] !== undefined ? State.inputs[key] : 0;
        }

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

        function generateLoadCurve(annualMwh, worksSat, worksSun, worksHol, shiftType, plantId) {
            const plant = State && State.plants ? State.plants.find(p => p.id === plantId) : null;
            const cod = plant && plant.codDate ? parseCodDate(plant.codDate) : null;
            const calYear = cod ? cod.y : (State && State.inputs && State.inputs.anchorYear ? Number(State.inputs.anchorYear) : 2026);
            if (shiftType === 'public_lighting') {
                const lat = plant ? plant.pvgisLatitude : null;
                const lng = plant ? plant.pvgisLongitude : null;
                return calculateTwilightCurve(annualMwh, lat, lng, calYear);
            }

            const startDow = new Date(Date.UTC(calYear, 0, 1)).getUTCDay();
            const holidays = getItalianHolidays(calYear);

            if (shiftType === 'domestic') {
                return generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol, calYear);
            }

            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (startDow + dayIdx) % 7; // 0=Sun,6=Sat
                const isHoliday = holidays.has(dayIdx);
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

        function generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol, calYear = 2026) {
            const startDow = new Date(Date.UTC(calYear, 0, 1)).getUTCDay();
            const holidays = getItalianHolidays(calYear);
            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (startDow + dayIdx) % 7; // 0=Sun,6=Sat
                const isHoliday = holidays.has(dayIdx);
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
                        // Domestic work day profile
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
                        // Domestic weekend / holiday profile
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

        function calculateTwilightCurve(annualMwh, lat, lng, calYear = 2026) {
            const rawLoad = new Float64Array(8760);
            const latitude = (lat !== null && lat !== undefined) ? lat : 43.591;
            const longitude = (lng !== null && lng !== undefined) ? lng : 10.394;
            const latRad = latitude * Math.PI / 180;
            const { springDayIdx, autumnDayIdx } = getItalianDstBounds(calYear);
            
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const d = dayIdx + 1;
                // Solar declination
                const decl = 0.40928 * Math.sin(2 * Math.PI * (d - 80) / 365);
                // Zenith angle for civil twilight is 96 degrees
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
                
                const isDST = (dayIdx >= springDayIdx && dayIdx < autumnDayIdx);
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

        function buildZeroResults() {
            return {
                cashFlowsForIRR: [], matrix: {}, debtSchedule: {}, pdSchedule: {}, cashTrapActiveYears: 0, exitEquityValue: 0,
                calculatedProjectIrr: 0, calculatedIrr: 0, calculatedSpvEquityIrr: 0, spvEquityNpv: 0, holdcoNpv: 0, holdcoMoic: 0,
                paybackPeriod: "-", calculatedLcoe: 0, calculatedLcos: 0, avgDscr: 0, minDscr: 0, totalEbitda: 0, totalHoldcoFCFE: 0,
                totalProjectCost: 0, equityAmount: 0, debtAmount: 0,
                pdAmount: 0, peAmount: 0, pdEnabled: false, peEnabled: false, afEnabled: false,
                combinedSolarProfile: new Float64Array(8760),
                generalMedioneKpiValue: 0,
            };
        }

        function calculateIRR(cashFlows) {
            const len = cashFlows.length;
            const hasNegative = cashFlows.some(v => v < 0);
            const hasPositive = cashFlows.some(v => v > 0);
            if (!hasNegative || !hasPositive) return 0;
            
            // Try standard Newton-Raphson first
            let irr = 0.08; 
            const maxIterations = 100;
            const precision = 1e-7;
            let converged = false;
            
            for (let i = 0; i < maxIterations; i++) {
                let npv = 0;
                let dNpv = 0; 
                let valid = true;
                for (let t = 0; t < len; t++) {
                    const factor = Math.pow(1 + irr, t);
                    if (isNaN(factor) || !isFinite(factor)) {
                        valid = false;
                        break;
                    }
                    npv += cashFlows[t] / factor;
                    dNpv -= t * cashFlows[t] / (factor * (1 + irr));
                }
                if (!valid || !isFinite(npv) || !isFinite(dNpv) || dNpv === 0) {
                    break;
                }
                const newIrr = irr - npv / dNpv;
                if (Math.abs(newIrr - irr) < precision) {
                    irr = newIrr;
                    converged = true;
                    break;
                }
                if (newIrr <= -0.99 || newIrr > 50.0) {
                    break;
                }
                irr = newIrr;
            }
            
            if (converged) {
                return irr * 100;
            }
            
            // Fallback to stable Bisection Search
            let low = -0.9999;
            let high = 100.0;
            
            const getNpv = (rate) => {
                let npv = 0;
                for (let t = 0; t < len; t++) {
                    npv += cashFlows[t] / Math.pow(1 + rate, t);
                }
                return npv;
            };
            
            let npvLow = getNpv(low);
            let npvHigh = getNpv(high);
            
            if (npvLow * npvHigh > 0) {
                if (npvHigh > 0) {
                    high = 1000.0;
                    npvHigh = getNpv(high);
                }
            }
            
            if (npvLow * npvHigh <= 0) {
                for (let i = 0; i < 100; i++) {
                    const mid = (low + high) / 2;
                    const npvMid = getNpv(mid);
                    if (Math.abs(npvMid) < 1e-6 || (high - low) < precision) {
                        return mid * 100;
                    }
                    if (npvMid * npvLow > 0) {
                        low = mid;
                        npvLow = npvMid;
                    } else {
                        high = mid;
                        npvHigh = npvMid;
                    }
                }
                return ((low + high) / 2) * 100;
            }
            
            const sum = cashFlows.reduce((a, b) => a + b, 0);
            if (sum === 0) return 0;
            return sum < 0 ? -99.99 : 999.99;
        }

        // CF8: XIRR datato — flussi [{ t: anni frazionari, amount }] con Newton+bisezione.
        // t è espresso in anni frazionari dalla prima data.
        function calculateXIRR(datedFlows) {
            const flows = datedFlows.filter(f => Math.abs(f.amount) > 1e-9);
            if (flows.length < 2) return 0;
            const hasNeg = flows.some(f => f.amount < 0);
            const hasPos = flows.some(f => f.amount > 0);
            if (!hasNeg || !hasPos) return 0;
            const t0 = Math.min(...flows.map(f => f.t));
            const npvAt = (rate) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + rate, f.t - t0), 0);

            let low = -0.99, high = 1.0;
            let npvLow = npvAt(low), npvHigh = npvAt(high);
            // espandi high finché il segno cambia
            let guard = 0;
            while (npvLow * npvHigh > 0 && high < 100 && guard < 60) {
                high *= 2; npvHigh = npvAt(high); guard++;
            }
            if (npvLow * npvHigh > 0) return 0;
            for (let i = 0; i < 120; i++) {
                const mid = (low + high) / 2;
                const npvMid = npvAt(mid);
                if (Math.abs(npvMid) < 1e-7 || (high - low) < 1e-9) return mid * 100;
                if (npvMid * npvLow > 0) { low = mid; npvLow = npvMid; }
                else { high = mid; npvHigh = npvMid; }
            }
            return ((low + high) / 2) * 100;
        }
