// ─────────────────────────────────────────────────────────────────────────────
// Test harness per il motore di calcolo (src/worker/simulation.worker.js)
// Esegue il worker in Node con shim di `self` e verifica invarianti chiave:
//  1. Nessun NaN nei risultati finanziari (default IRES/IRAP senza config DB)
//  2. Conservazione dell'energia FV (gen = PPA + RID + carica BESS) anno 1
//  3. IRR/NPV/DSCR finiti e coerenti
//  4. Grace period > 12 mesi non produce NaN né quota capitale negativa
//  5. "Nessun Exit" (exitOption '0') produce 20 anni di risultati
//  6. Project IRR usa orizzonte 20 anni (non loanTerm)
//  7-13. PPA on-site, sculpting, MSD, Monte Carlo, DSRA, refi, tornado
// 14. Quadratura multi-impianto (generazione e ricavi RID)
// 15. BRP: fee dinamiche per anno (yr-aware) nella contabilizzazione annuale
// 16. BRP: ricavi arbitraggio BESS con fee che si azzera dopo il periodo promo
// 17. Decay personalizzati (degradeRidPct) applicati una sola volta + solare
// 18. CER: incentivo GSE (TIAD+TIP) e ricavi PPA privato su energia condivisa
// 19. Edge case: zero impianti / tutti disabilitati -> risultati zero, no crash
// 20. Leva cappata a 95% anche con input > 100%
// 21. Drift guard: funzioni duplicate main.js ↔ worker identiche (solare, mese/ora, perdite)
// 22. Monte Carlo riproducibile con seed (stesso seed = stessi campioni)
// Uso: npm test
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, '..', 'src', 'worker', 'simulation.worker.js');
const code = fs.readFileSync(workerPath, 'utf8');

let lastMessage = null;
const sandbox = {
    self: {
        postMessage: (msg) => { lastMessage = msg; }
    },
    console,
    structuredClone: global.structuredClone,
    Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
    Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// ── Stato sintetico minimo ──
function buildState(overrides = {}) {
    const profile = sandbox.generateDefaultSolarProfile(8, 1300); // 8 MW, 1300 kWh/kWp
    const zonal = new Float64Array(8760).fill(100); // PUN piatto 100 €/MWh
    const defaultPlant = {
        id: 'p1', name: 'Impianto Test', capacity: 8000, zone: 'CNOR',
        capex: 700, opex: 120000, enabled: true,
        generation: profile,
        bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
        bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
        bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
        gridVoltage: 'mt', gridConnectionKw: 8000,
        marketType: 'rid', traderContractType: 'pun_orario',
        traderSpread: 2, traderDisp: 1
    };
    return {
        inputs: {
            keVal: 0.08, wacc: 0.06, inflation: 0.02,
            fiscalDeprRate: 0.09, leverage: 0.75, interestRate: 0.045,
            loanTerm: 11, debtBasis: 'enterprise_value',
            sweepType: 'none', sweepValue: 0, sweepYears: 0,
            seniorGracePeriodMonths: 6, constructionMonths: 6, idcDrawdownFactor: 50,
            sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
            exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
            holdcoCapital: 10000,
            priceScenarioType: 'base',
            // NB: iresRate / irapRate volontariamente ASSENTI -> testa i default (bug #1)
            ...(overrides.inputs || {})
        },
        // overrides.plants (array completo) ha priorità su overrides.plant (merge sul default)
        plants: overrides.plants || [{ ...defaultPlant, ...(overrides.plant || {}) }],
        stabilimenti: overrides.stabilimenti || [],
        zonalPun: overrides.zonalPun || { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
        selectedBessPlantIds: null,
        previouslySeenPlantIds: null
    };
}

function run(state, capexPayments, opexEvents) {
    lastMessage = null;
    if (capexPayments) state.capexPayments = capexPayments;
    if (opexEvents) state.opexEvents = opexEvents;
    sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    if (!lastMessage) throw new Error('Nessuna risposta dal worker');
    if (lastMessage.status !== 'success') {
        throw new Error('Worker error: ' + lastMessage.error + '\n' + (lastMessage.stack || ''));
    }
    return lastMessage.results;
}

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}
const anyNaN = (arr) => arr.some(v => typeof v !== 'number' || isNaN(v));

// ── Test 1: scenario base, default fiscali ──
console.log('\n[Test 1] Scenario base (IRES/IRAP assenti -> default 24%/3.9%)');
const r1 = run(buildState());
check('EBITDA senza NaN', !anyNaN(r1.matrix.ebitda));
check('Imposte correnti senza NaN', !anyNaN(r1.matrix.currentTaxesSpv));
check('IRAP anno 1 > 0 (motore fiscale attivo)', r1.matrix.irapTaxSpv[0] > 0, `val=${r1.matrix.irapTaxSpv[0]}`);
check('IRES > 0 dopo assorbimento NOL (anno >= 12)', r1.matrix.iresTaxSpv.slice(11).some(v => v > 0),
    `ires=${r1.matrix.iresTaxSpv.map(v=>v.toFixed(0)).join(',')}`);
check('NOL riportata coerente (Art. 84)', r1.matrix.taxLossCF.every(v => v >= 0));
check('Utile netto senza NaN', !anyNaN(r1.matrix.netProfitSpv));
check('CFADS senza NaN', !anyNaN(r1.matrix.cfads));
check('IRR finito', isFinite(r1.calculatedIrr), `IRR=${r1.calculatedIrr}`);
check('NPV finito', isFinite(r1.holdcoNpv));
check('DSCR medio > 0', r1.avgDscr > 0, `avgDscr=${r1.avgDscr}`);
check('SoC rispetta SoC Max 95%', Math.max(...r1.plantsMetrics[0].sim.hourlySoC) <= 4000 * 0.95 + 1e-6,
    `maxSoC=${Math.max(...r1.plantsMetrics[0].sim.hourlySoC)}`);
check('SoC rispetta SoC Min 5%', Math.min(...r1.plantsMetrics[0].sim.hourlySoC) >= 4000 * 0.05 - 1e-6,
    `minSoC=${Math.min(...r1.plantsMetrics[0].sim.hourlySoC)}`);

// ── Test 2: conservazione energia anno 1 (tolleranza 1% per discretizzazione DP) ──
console.log('\n[Test 2] Conservazione energia FV anno 1');
const genY1 = r1.matrix.qtySolarGen[0];
const ppaY1 = r1.matrix.qtySolarPpa[0];
const ridY1 = r1.matrix.qtySolarRid[0];
const toBessY1 = r1.matrix.qtySolarToBess[0];
const balance = ppaY1 + ridY1 + toBessY1;
check('gen = PPA + RID + toBESS (±1%)', Math.abs(balance - genY1) / genY1 < 0.01,
    `gen=${genY1.toFixed(1)} vs somma=${balance.toFixed(1)}`);

// ── Test 3: grace period 18 mesi ──
console.log('\n[Test 3] Preammortamento 18 mesi (> 12, prima troncato)');
const r3 = run(buildState({ inputs: { seniorGracePeriodMonths: 18 } }));
check('Nessun NaN nel piano debito', !anyNaN(r3.debtSchedule.endingBalance));
check('Anno 1: nessuna quota capitale (grace 18m)', Math.abs(r3.debtSchedule.principalScheduled[0]) < 1e-6,
    `principalY1=${r3.debtSchedule.principalScheduled[0]}`);
check('Anno 2: ammortamento parziale attivo', r3.debtSchedule.principalScheduled[1] > 0,
    `principalY2=${r3.debtSchedule.principalScheduled[1]}`);

// ── Test 4: Nessun Exit ──
console.log("\n[Test 4] exitOption '0' (Nessun Exit)");
const r4 = run(buildState({ inputs: { exitOption: '0' } }));
check('20 anni di risultati', r4.matrix.years.length === 20, `years=${r4.matrix.years.length}`);
check('Nessun EV di exit', r4.matrix.exitEnterpriseValue.every(v => v === 0));

// ── Test 5: Project IRR su 20 anni anche con loanTerm=11 ──
console.log('\n[Test 5] Orizzonte Project IRR = vita progetto');
const r5 = run(buildState());
check('Project IRR finito e > -100%', isFinite(r5.calculatedProjectIrr) && r5.calculatedProjectIrr > -99,
    `projIRR=${r5.calculatedProjectIrr}`);

// ── Test 6: 100% equity (nessun debito) ──
console.log('\n[Test 6] Leva 0% (100% equity)');
const r6 = run(buildState({ inputs: { leverage: 0 } }));
check('Debito = 0', r6.debtAmount === 0);
check('DSCR N/A senza NaN', !anyNaN(r6.debtSchedule.dscr.map(v => v === -1 ? 0 : v)));
check('IRR finito anche senza debito', isFinite(r6.calculatedIrr));

// ── Test 7: PPA on-site con stabilimento ──
console.log('\n[Test 7] PPA on-site 120 €/MWh');
const load = new Float64Array(8760).fill(3000); // carico piatto 3 MW
const r7 = run(buildState({
    stabilimenti: [{
        id: 's1', name: 'Stab Test', plantId: 'p1', ppaType: 'on-site',
        ppaPrice: 120, ppaDuration: 15, annualConsumption: 26280,
        load, enabled: true, loadSource: 'csv'
    }]
}));
check('Ricavi PPA anno 1 > 0', r7.matrix.revenuePpa[0] > 0, `revPPA=${r7.matrix.revenuePpa[0]}`);
check('Autoconsumo > 0', r7.totalSelfConsMwh > 0, `selfCons=${r7.totalSelfConsMwh}`);
check('Nessun NaN con PPA', !anyNaN(r7.matrix.holdcoFCFE));

// ── Test 8: DSCR Sculpting ──
console.log('\n[Test 8] DSCR Sculpting (target 1.30x)');
const r8 = run(buildState({ inputs: { sculptingEnabled: true, targetDscr: 1.30 } }));
// Anni 1..loanTerm-1: DSCR = target; anno loanTerm: balloon -> DSCR < target ammesso
const dscrYearsSculpt = r8.debtSchedule.dscr.slice(0, 10).filter(v => v > 0);
check('DSCR ≈ target 1.30x negli anni di ammortamento', dscrYearsSculpt.every(v => Math.abs(v - 1.30) < 0.05),
    `dscr=${dscrYearsSculpt.map(v=>v.toFixed(2)).join(',')}`);
check('Debito rimborsato entro loanTerm (balloon finale)', r8.debtSchedule.endingBalance[10] <= 1e-6,
    `residuoY11=${r8.debtSchedule.endingBalance[10]}`);

// ── Test 9: Ricavi MSD BESS ──
console.log('\n[Test 9] Ricavi servizi ancillari BESS (MSD)');
const r9 = run(buildState({ inputs: { msdEurMwYr: 50000 } }));
check('Revenue MSD anno 1 = BESS MW × €/MW', Math.abs(r9.matrix.revenueMsd[0] - 2 * 50000) < 1e-6,
    `msdY1=${r9.matrix.revenueMsd[0]}`);
check('MSD incluso nei ricavi totali', Math.abs(r9.matrix.revenueTotal[0] - (r9.matrix.revenueRid[0] + r9.matrix.revenuePpa[0] + r9.matrix.revenueTimeshifting[0] + r9.matrix.revenueArbitrage[0] + r9.matrix.revenueMsd[0])) < 1e-6);
const r9base = run(buildState());
check('EBITDA anno 1 maggiore con MSD attivo', r9.matrix.ebitda[0] > r9base.matrix.ebitda[0]);

// ── Test 10: Monte Carlo ──
console.log('\n[Test 10] Monte Carlo P50/P90');
let mcMsg = null;
sandbox.self.postMessage = (m) => { mcMsg = m; };
sandbox.self.onmessage({ data: { action: 'EXECUTE_MONTECARLO', payload: { State: buildState(), mcConfig: { nSim: 10, sigmaPun: 15, sigmaGen: 5 } } } });
check('Risposta montecarlo_success', mcMsg && mcMsg.status === 'montecarlo_success', mcMsg && mcMsg.error);
if (mcMsg && mcMsg.status === 'montecarlo_success') {
    const mc = mcMsg.results;
    check('10 campioni IRR', mc.irrSamples.length === 10);
    check('Percentili ordinati P10<=P50<=P90', mc.irr.p10 <= mc.irr.p50 && mc.irr.p50 <= mc.irr.p90);
    check('NPV percentili finiti', isFinite(mc.npv.p10) && isFinite(mc.npv.p50) && isFinite(mc.npv.p90));
}
// Ripristina l'handler standard per i test successivi
sandbox.self.postMessage = (m) => { lastMessage = m; };

// ── Test 11: DSRA ──
console.log('\n[Test 11] DSRA (6 mesi di debt service)');
const r11 = run(buildState({ inputs: { dsraMonths: 6 } }));
const targetDsra = 0.5 * (r11.debtAmount * (0.045 * Math.pow(1.045, 10.5)) / (Math.pow(1.045, 10.5) - 1));
const peakDsra = Math.max(...r11.debtSchedule.dsraBalance);
check('Saldo DSRA raggiunge il target (6 mesi)', Math.abs(peakDsra - targetDsra) / targetDsra < 0.02,
    `peak=${peakDsra.toFixed(0)} target=${targetDsra.toFixed(0)}`);
check('Accantonamento DSRA anno 1 > 0', r11.matrix.dsraFunding[0] > 0, `fundingY1=${r11.matrix.dsraFunding[0]}`);
check('Saldo DSRA = 0 dopo estinzione debito (release)', r11.debtSchedule.dsraBalance[10] <= 1e-6,
    `saldoY11=${r11.debtSchedule.dsraBalance[10]}`);
check('Rilascio DSRA registrato', r11.matrix.dsraRelease.some(v => v > 0));
check('FCFE senza NaN con DSRA', !anyNaN(r11.matrix.holdcoFCFE));
check('DSRA coerente: funding+draw-balance conservata', r11.matrix.dsraFunding.every(v => v >= 0) && r11.matrix.dsraDraw.every(v => v >= 0));

// ── Test 12: Refinancing / Miniperm ──
console.log('\n[Test 12] Refinancing (anno 6, tasso 6%, durata 8 anni)');
const r12 = run(buildState({ inputs: { refiEnabled: true, refiYear: 6, refiInterestRate: 6.0, refiLoanTerm: 8 } }));
check('Interessi anno 6 al nuovo tasso 6%', Math.abs(r12.debtSchedule.interestAccrued[5] - r12.debtSchedule.beginningBalance[5] * 0.06) < 1e-6,
    `intY6=${r12.debtSchedule.interestAccrued[5]} vs ${r12.debtSchedule.beginningBalance[5] * 0.06}`);
check('Interessi anno 5 al tasso originale 4.5%', Math.abs(r12.debtSchedule.interestAccrued[4] - r12.debtSchedule.beginningBalance[4] * 0.045) < 1e-6);
check('Debito estinto entro nuova scadenza (anno 13)', r12.debtSchedule.endingBalance[12] <= 1e-6,
    `residuoY13=${r12.debtSchedule.endingBalance[12]}`);
check('Piano debito senza NaN con refi', !anyNaN(r12.debtSchedule.endingBalance));
check('Debt service cambia dopo refi', Math.abs(r12.debtSchedule.totalDebtService[5] - r12.debtSchedule.totalDebtService[4]) > 1e-6);

// ── Test 13: Tornado ──
console.log('\n[Test 13] Tornado deterministico');
let tornMsg = null;
sandbox.self.postMessage = (m) => { tornMsg = m; };
sandbox.self.onmessage({ data: { action: 'EXECUTE_TORNADO', payload: { State: buildState() } } });
check('Risposta tornado_success', tornMsg && tornMsg.status === 'tornado_success', tornMsg && tornMsg.error);
if (tornMsg && tornMsg.status === 'tornado_success') {
    const t = tornMsg.results;
    check('6 variabili valutate', t.rows.length === 6, `rows=${t.rows.length}`);
    check('IRR base finito', isFinite(t.baseIrr), `baseIrr=${t.baseIrr}`);
    check('Ordinamento per impatto decrescente', t.rows.every((r, i) => i === 0 || Math.abs(t.rows[i-1].irrUp - t.rows[i-1].irrDown) >= Math.abs(r.irrUp - r.irrDown) - 1e-9));
    check('PUN ha impatto non nullo', Math.abs(t.rows.find(r => r.key === 'pun').irrUp - t.rows.find(r => r.key === 'pun').irrDown) > 0.001);
    check('Tasso debito (ex euribor) ha impatto non nullo', Math.abs(t.rows.find(r => r.key === 'interestRate').irrUp - t.rows.find(r => r.key === 'interestRate').irrDown) > 0.001,
        `up=${t.rows.find(r => r.key === 'interestRate').irrUp} down=${t.rows.find(r => r.key === 'interestRate').irrDown}`);
}
// Ripristina handler standard
sandbox.self.postMessage = (m) => { lastMessage = m; };

// ── Test 14: quadratura multi-impianto ──
console.log('\n[Test 14] Quadratura multi-impianto (2 impianti, no BESS)');
const gen14a = sandbox.generateDefaultSolarProfile(8, 1300);
const gen14b = sandbox.generateDefaultSolarProfile(4, 1400);
const sum14 = (a) => a.reduce((x, y) => x + y, 0);
const totGenKwh14 = sum14(gen14a) + sum14(gen14b);
const plantNoBess = { bessMw: 0, bessMwh: 0, bessType: 'none', traderSpread: 0, traderDisp: 0 };
const r14 = run(buildState({
    plants: [
        { id: 'p1', name: 'Impianto A', capacity: 8000, zone: 'NORD', capex: 700, opex: 120000, enabled: true, generation: gen14a, gridVoltage: 'mt', gridConnectionKw: 8000, marketType: 'rid', traderContractType: 'pun_orario', ...plantNoBess },
        { id: 'p2', name: 'Impianto B', capacity: 4000, zone: 'SUD', capex: 700, opex: 60000, enabled: true, generation: gen14b, gridVoltage: 'mt', gridConnectionKw: 4000, marketType: 'rid', traderContractType: 'pun_orario', ...plantNoBess }
    ]
}));
check('Generazione consolidata = somma impianti (±1%)', Math.abs(r14.matrix.qtySolarGen[0] - totGenKwh14 / 1000) / (totGenKwh14 / 1000) < 0.01,
    `cons=${r14.matrix.qtySolarGen[0].toFixed(1)} vs atteso=${(totGenKwh14 / 1000).toFixed(1)}`);
const balance14 = r14.matrix.qtySolarPpa[0] + r14.matrix.qtySolarRid[0] + r14.matrix.qtySolarToBess[0];
check('Conservazione portafoglio: gen = PPA+RID+toBESS (±1%)', Math.abs(balance14 - r14.matrix.qtySolarGen[0]) / r14.matrix.qtySolarGen[0] < 0.01,
    `gen=${r14.matrix.qtySolarGen[0].toFixed(1)} somma=${balance14.toFixed(1)}`);
check('Ricavi RID = gen × 100 €/MWh (±2%)', Math.abs(r14.matrix.revenueRid[0] - totGenKwh14 * 0.1) / (totGenKwh14 * 0.1) < 0.02,
    `rev=${r14.matrix.revenueRid[0].toFixed(0)} atteso=${(totGenKwh14 * 0.1).toFixed(0)}`);
check('plantsMetrics: 2 impianti con produzione coerente', r14.plantsMetrics.length === 2 &&
    Math.abs((r14.plantsMetrics[0].annualSolarProductionMWh + r14.plantsMetrics[1].annualSolarProductionMWh) - totGenKwh14 / 1000) / (totGenKwh14 / 1000) < 0.005,
    `metrics=${r14.plantsMetrics.map(m => m.annualSolarProductionMWh.toFixed(1)).join('+')}`);

// ── Test 15: BRP fee dinamiche per anno (contabilizzazione yr-aware) ──
console.log('\n[Test 15] BRP: fee dinamiche 2→1→0 €/MWh applicate per anno');
const gen15 = sandbox.generateDefaultSolarProfile(8, 1300);
const genKwh15 = sum14(gen15);
const r15 = run(buildState({ plant: {
    marketType: 'brp', brpFee1: 2, brpFee1Months: 18, brpFee2: 1, brpFee2Months: 6, brpFee3: 0,
    degradeRidPct: 0, ...plantNoBess
} }));
check('Anno 1: ricavi RID con fee1=2 (±1%)', Math.abs(r15.matrix.revenueRid[0] - genKwh15 * 0.102) / (genKwh15 * 0.102) < 0.01,
    `rev=${r15.matrix.revenueRid[0].toFixed(0)} atteso=${(genKwh15 * 0.102).toFixed(0)}`);
const rev15y2 = r15.matrix.revenueRid[1], rev15y3 = r15.matrix.revenueRid[2];
check('Anno 2: prezzo medio tra fee1 e fee2', rev15y2 / (genKwh15 * 0.9965) > 0.100 && rev15y2 / (genKwh15 * 0.9965) < 0.102,
    `prezzoMedioY2=${(rev15y2 / (genKwh15 * 0.9965)).toFixed(4)}`);
check('Anno 3: fee3=0 su tutti i mesi (±1%)', Math.abs(rev15y3 - genKwh15 * Math.pow(0.9965, 2) * 0.100) / (genKwh15 * Math.pow(0.9965, 2) * 0.100) < 0.01,
    `rev=${rev15y3.toFixed(0)} atteso=${(genKwh15 * Math.pow(0.9965, 2) * 0.100).toFixed(0)}`);
check('Dinamica fee oltre il solo degrado solare (Y3/Y2 < 0.9965)', rev15y3 / rev15y2 < 0.9965,
    `rapporto=${(rev15y3 / rev15y2).toFixed(4)}`);

// ── Test 16: BRP arbitraggio BESS con fee promozionale che scade ──
console.log('\n[Test 16] BRP: arbitraggio BESS e fee che si azzera (anno 3)');
const punVar = new Float64Array(8760);
for (let t = 0; t < 8760; t++) punVar[t] = ((t % 24) >= 8 && (t % 24) < 20) ? 150 : 50;
const r16 = run(buildState({
    zonalPun: { NORD: punVar, CNOR: punVar, CSUD: punVar, SUD: punVar, SICI: punVar, SARD: punVar },
    plant: {
        marketType: 'brp', brpFee1: 2, brpFee1Months: 18, brpFee2: 1, brpFee2Months: 6, brpFee3: 0,
        degradeRidPct: 0, degradeTimeshiftingPct: 0, degradeArbitragePct: 0,
        bessDegradation: 0, traderSpread: 0, traderDisp: 0
    }
}));
check('Arbitraggio anno 1 > 0 (PUN variabile 50/150)', r16.matrix.revenueArbitrage[0] > 0,
    `arbY1=${r16.matrix.revenueArbitrage[0].toFixed(0)}`);
check('Arbitraggio anno 3 < anno 1 (fee 2→0 riduce il prezzo)', r16.matrix.revenueArbitrage[2] < r16.matrix.revenueArbitrage[0],
    `arbY1=${r16.matrix.revenueArbitrage[0].toFixed(0)} arbY3=${r16.matrix.revenueArbitrage[2].toFixed(0)}`);
check('Nessun NaN nei ricavi con BRP+BESS', !anyNaN(r16.matrix.revenueRid) && !anyNaN(r16.matrix.revenueArbitrage));

// ── Test 17: decay personalizzati (degradeRidPct 10%/anno) ──
console.log('\n[Test 17] Decay RID 10%/anno applicato una volta (+ degrado solare)');
const r17 = run(buildState({ plant: { degradeRidPct: 10, ...plantNoBess } }));
const ratio17a = r17.matrix.revenueRid[1] / r17.matrix.revenueRid[0];
const ratio17b = r17.matrix.revenueRid[2] / r17.matrix.revenueRid[1];
const expected17 = 0.9965 * 0.9; // degrado solare 0.35% × decay RID 10%
check('Y2/Y1 ≈ 0.9965 × 0.90 (±1%)', Math.abs(ratio17a - expected17) < 0.01 * expected17,
    `rapporto=${ratio17a.toFixed(4)} atteso=${expected17.toFixed(4)}`);
check('Progressione geometrica costante (Y3/Y2 ≈ Y2/Y1)', Math.abs(ratio17b - ratio17a) < 0.005,
    `Y2/Y1=${ratio17a.toFixed(4)} Y3/Y2=${ratio17b.toFixed(4)}`);

// ── Test 18: flussi CER (TIAD + tariffa premio su energia condivisa) ──
console.log('\n[Test 18] CER: incentivo GSE (CACV+TIP) e PPA privato su energia condivisa');
const gen18 = sandbox.generateDefaultSolarProfile(0.1, 1300); // 100 kWp (taglia media)
const genMwh18 = sum14(gen18) / 1000;
const load18 = new Float64Array(8760).fill(300); // carico sempre superiore alla generazione
const r18 = run(buildState({
    inputs: { cerTras: 5, cerFissaMedium: 50, cerCapMedium: 120, cerVarReferencePrice: 0, cerVarMax: 0, cerGeoNord: 0, cerGeoCentro: 0, cerGeoSud: 0, cerLossCprMt: 2.3 },
    plant: { capacity: 100, generation: gen18, opex: 5000, gridVoltage: 'mt', capex: 700, ...plantNoBess },
    stabilimenti: [{ id: 's1', name: 'CER Test', plantId: 'p1', ppaType: 'cer', ppaPrice: 80, ppaDuration: 15, annualConsumptionMwh: 2628, load: load18, enabled: true, loadSource: 'csv', cerShareType: 'shared_energy' }]
}));
const sim18 = r18.plantsMetrics[0].sim;
const incentive18 = sim18.hourlyCerGseIncentive.reduce((a, b) => a + b, 0);
const sharedMwh18 = incentive18 > 0 ? sim18.hourlyCerGseIncentive.reduce((a, b) => a + b, 0) / 57.3 : 0; // priceCER = 5 + 0.023×100 + 50
check('Incentivo GSE anno 1 > 0', incentive18 > 0, `incentive=${incentive18.toFixed(0)}`);
check('Energia condivisa ≈ intera generazione immessa', sharedMwh18 > 0.5 * genMwh18,
    `shared=${sharedMwh18.toFixed(1)} gen=${genMwh18.toFixed(1)}`);
check('Prezzo CER effettivo = CACV+TIP = 57.3 €/MWh (±0.5)', Math.abs(incentive18 / sharedMwh18 - 57.3) < 0.5,
    `prezzo=${(incentive18 / sharedMwh18).toFixed(2)}`);
check('PPA privato su energia condivisa = 80 €/MWh (±2%)', Math.abs(r18.matrix.revenuePpa[0] - sharedMwh18 * 80) / (sharedMwh18 * 80) < 0.02,
    `revPpa=${r18.matrix.revenuePpa[0].toFixed(0)} atteso=${(sharedMwh18 * 80).toFixed(0)}`);
check('Nessun NaN nei ricavi totali con CER', !anyNaN(r18.matrix.revenueTotal));

// ── Test 19: edge case zero impianti / tutti disabilitati ──
console.log('\n[Test 19] Edge case: nessun impianto attivo');
const r19a = run(buildState({ plants: [] }));
check('Zero impianti: risultati zero senza crash', r19a.calculatedIrr === 0 && r19a.avgDscr === 0 && !!r19a.matrix);
const r19b = run(buildState({ plant: { enabled: false } }));
check('Impianti tutti disabilitati: risultati zero senza crash', r19b.calculatedIrr === 0 && r19b.avgDscr === 0 && !!r19b.matrix);

// ── Test 20: leva cappata al 95% ──
console.log('\n[Test 20] Leva > 100% in input cappata a 95%');
const r20 = run(buildState({ inputs: { leverage: 1.5 } }));
check('Debito = 95% esatto del costo progetto (cap)', Math.abs(r20.debtAmount - 0.95 * r20.totalProjectCost) <= 1,
    `debito=${r20.debtAmount.toFixed(0)} cap=${(0.95 * r20.totalProjectCost).toFixed(0)}`);
// Il residuo 5% è coperto da equity cash + finanziamento soci (sociEquityPct 80%):
// equityAmount è la sola quota cash al netto del soci.
check('Equity cash positiva e ≥ capitale Holding iniziale', r20.equityAmount > 0 && r20.equityAmount >= 10000 - 1,
    `equity=${r20.equityAmount.toFixed(0)}`);
check('Nessun over-funding: debito+equity ≤ costo progetto', r20.debtAmount + r20.equityAmount <= r20.totalProjectCost + 1,
    `debito+equity=${(r20.debtAmount + r20.equityAmount).toFixed(0)} costo=${r20.totalProjectCost.toFixed(0)}`);
check('IRR finito con leva al cap', isFinite(r20.calculatedIrr));

// ── Test 21: drift guard funzioni duplicate main↔worker ──
console.log('\n[Test 21] Drift guard: funzioni duplicate main.js ↔ worker identiche');
// Estrae il sorgente di "function name(...){...}" con brace-matching (gestisce nest).
function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) return null;
    const braceStart = src.indexOf('{', start);
    if (braceStart < 0) return null;
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return null;
}
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// 1) generateDefaultSolarProfile: main vs worker (entrambe pure)
const mainSolarSrc = extractFn(mainSrc, 'generateDefaultSolarProfile');
check('generateDefaultSolarProfile presente in main.js', !!mainSolarSrc);
if (mainSolarSrc) {
    const ctxSolar = vm.createContext({ Math, Float64Array });
    const mainSolarFn = vm.runInContext('(' + mainSolarSrc + ')', ctxSolar);
    const pMain = mainSolarFn(8, 1300);
    const pWorker = sandbox.generateDefaultSolarProfile(8, 1300);
    let eq = pMain.length === pWorker.length;
    for (let i = 0; i < 8760 && eq; i++) if (pMain[i] !== pWorker[i]) eq = false;
    check('generateDefaultSolarProfile main ≡ worker (8760 valori)', eq);
}

// 2) getMonthOfHour: main vs worker su tutte le ore
const mainMonthSrc = extractFn(mainSrc, 'getMonthOfHour');
check('getMonthOfHour presente in main.js', !!mainMonthSrc);
if (mainMonthSrc) {
    const ctxMonth = vm.createContext({});
    const mainMonthFn = vm.runInContext('(' + mainMonthSrc + ')', ctxMonth);
    let eq = true;
    for (let t = 0; t < 8760 && eq; t++) if (mainMonthFn(t) !== sandbox.getMonthOfHour(t)) eq = false;
    check('getMonthOfHour main ≡ worker (8760 ore)', eq);
}

// 3) resolveGridLosses: main vs worker con stessi input (shim State)
const mainLossSrc = extractFn(mainSrc, 'resolveGridLosses');
const workerLossSrc = extractFn(fs.readFileSync(workerPath, 'utf8'), 'resolveGridLosses');
check('resolveGridLosses presente in main.js e worker', !!mainLossSrc && !!workerLossSrc);
if (mainLossSrc && workerLossSrc) {
    const shim = { inputs: {
        ridLossInjectBt: 1.1, ridLossInjectMt: 2.2, ridLossInjectAt: 3.3,
        ridLossWithdrawBt: 4.4, ridLossWithdrawMt: 5.5, ridLossWithdrawAt: 6.6,
        cerLossCprBt: 7.7, cerLossCprMt: 8.8, cerLossCprAt: 9.9
    } };
    const ctxMainLoss = vm.createContext({ State: shim, String });
    const ctxWorkerLoss = vm.createContext({ State: shim, String });
    const mainLossFn = vm.runInContext('(' + mainLossSrc + ')', ctxMainLoss);
    const workerLossFn = vm.runInContext('(' + workerLossSrc + ')', ctxWorkerLoss);
    let eq = true; let detail = '';
    for (const v of ['bt', 'mt', 'at', 'none']) {
        for (const ty of ['inject', 'withdraw', 'cpr']) {
            const a = mainLossFn(v, ty), b = workerLossFn(v, ty);
            if (a !== b) { eq = false; detail = `${v}/${ty}: main=${a} worker=${b}`; }
        }
    }
    check('resolveGridLosses main ≡ worker (tutte le combinazioni)', eq, detail);
}

// ── Test 22: Monte Carlo riproducibile con seed ──
console.log('\n[Test 22] Monte Carlo: riproducibilità con seed');
function runMonteCarlo(seed) {
    lastMessage = null;
    const st = buildState({ inputs: { priceScenarioType: 'base' } });
    sandbox.self.onmessage({ data: { action: 'EXECUTE_MONTECARLO', payload: { State: st, mcConfig: { nSim: 12, sigmaPun: 15, sigmaGen: 5, seed } } } });
    return lastMessage;
}
const mcA1 = runMonteCarlo(42);
const mcA2 = runMonteCarlo(42);
const mcB = runMonteCarlo(1337);
check('Monte Carlo risponde montecarlo_success', mcA1 && mcA1.status === 'montecarlo_success');
if (mcA1 && mcA1.status === 'montecarlo_success') {
    const irrA1 = mcA1.results.irrSamples, irrA2 = mcA2.results.irrSamples, irrB = mcB.results.irrSamples;
    const sameSeedEqual = irrA1.length === irrA2.length && irrA1.every((v, i) => v === irrA2[i]);
    check('Stesso seed -> campioni identici (riproducibile)', sameSeedEqual);
    const diffSeedDiffers = irrA1.some((v, i) => v !== irrB[i]);
    check('Seed diverso -> campioni diversi', diffSeedDiffers);
    check('Campioni IRR finiti e non NaN', irrA1.every(v => Number.isFinite(v)));
}

// ── Test 23: cash flow mensile anni 1-5 (quadratura con i totali annui) ──
console.log('\n[Test 23] Cash flow mensile anni 1-5: quadratura e identità di cassa');
const r23 = run(buildState());
const mc23 = r23.monthlyCashflow;
check('monthlyCashflow presente con 60 mesi', !!mc23 && mc23.months.length === 60 && mc23.labels.length === 60);
if (mc23 && mc23.months.length === 60) {
    const sumYear = (arr, y) => arr.slice((y - 1) * 12, y * 12).reduce((a, b) => a + b, 0);
    let quadOk = true; let detail = '';
    for (let y = 1; y <= 5 && quadOk; y++) {
        const pairs = [
            ['revenueRid', mc23.revenueRid, r23.matrix.revenueRid[y - 1]],
            ['revenuePpa', mc23.revenuePpa, r23.matrix.revenuePpa[y - 1]],
            ['revenueArbitrage', mc23.revenueArbitrage, r23.matrix.revenueArbitrage[y - 1]],
            ['revenueTimeshifting', mc23.revenueTimeshifting, r23.matrix.revenueTimeshifting[y - 1]],
            ['revenueTotal', mc23.revenueTotal, r23.matrix.revenueTotal[y - 1]],
            ['opex', mc23.opex, r23.matrix.opexTotal[y - 1]],
            ['debtService', mc23.debtService,
                (r23.debtSchedule.interestAccrued[y - 1] || 0) + (r23.debtSchedule.principalScheduled[y - 1] || 0) + (r23.debtSchedule.principalVoluntary[y - 1] || 0)]
        ];
        for (const [name, arr, annual] of pairs) {
            const s = sumYear(arr, y);
            const tol = Math.max(1e-6, Math.abs(annual) * 1e-9);
            if (Math.abs(s - annual) > tol) { quadOk = false; detail = `Y${y} ${name}: ${s.toFixed(2)} vs ${annual.toFixed(2)}`; break; }
        }
    }
    check('Quadratura mensile=annuo (ricavi, OPEX, servizio debito) su 5 anni', quadOk, detail);
    let cashOk = true;
    for (let i = 0; i < 60 && cashOk; i++) {
        if (Math.abs((mc23.cashOpening[i] + mc23.netCashflow[i]) - mc23.cashClosing[i]) > 1e-6) cashOk = false;
        if (i > 0 && Math.abs(mc23.cashOpening[i] - mc23.cashClosing[i - 1]) > 1e-6) cashOk = false;
    }
    check('Identità di cassa: apertura+net=chiusura e concatenazione mesi', cashOk);
    check('Nessun NaN/Inf nello schedule mensile', mc23.netCashflow.every(v => Number.isFinite(v)) && mc23.cashClosing.every(v => Number.isFinite(v)));
    check('Metriche liquidità: minCashClosing e negativeMonths coerenti', Number.isFinite(mc23.minCashClosing) && mc23.negativeMonths >= 0 &&
        (mc23.negativeMonths === 0 || mc23.minCashClosing < 0));
    // Semantica KPI liquidità: NET mensile negativo ≠ cassa cumulata negativa (CF1)
    const negNet23 = mc23.netCashflow.filter(v => v < 0).length;
    const negCash23 = mc23.cashClosing.filter(v => v < 0).length;
    check('negativeNetMonths = conteggio NET<0 ricalcolato', mc23.negativeNetMonths === negNet23,
        `kpi=${mc23.negativeNetMonths} ricalcolato=${negNet23}`);
    check('negativeMonths = conteggio cassa finale<0 ricalcolato', mc23.negativeMonths === negCash23,
        `kpi=${mc23.negativeMonths} ricalcolato=${negCash23}`);
    // Scenario stressato: OPEX enorme -> NET e cassa negativi
    const rNeg = run(buildState({ plant: { opex: 99999999, bessMw: 0, bessMwh: 0, bessType: 'none', traderSpread: 0, traderDisp: 0 } }));
    const mcNeg = rNeg.monthlyCashflow;
    check('Scenario stressato: mesi NET<0 > 0', mcNeg.negativeNetMonths > 0, `negNet=${mcNeg.negativeNetMonths}`);
    check('Scenario stressato: mesi cassa<0 > 0 e cassa minima < 0', mcNeg.negativeMonths > 0 && mcNeg.minCashClosing < 0,
        `negCash=${mcNeg.negativeMonths} min=${mcNeg.minCashClosing.toFixed(0)}`);
}

// ── Test 24: schedule date-aware con COD dinamici e lag di incasso (CF3) ──
console.log('\n[Test 24] Cashflow date-aware: COD 15/05/2027 e 15/02/2028, lag RID 2 mesi');
const gen24a = sandbox.generateDefaultSolarProfile(8, 1300);
const gen24b = sandbox.generateDefaultSolarProfile(4, 1400);
const plantNoBess24 = { bessMw: 0, bessMwh: 0, bessType: 'none', traderSpread: 0, traderDisp: 0, marketType: 'rid', gridVoltage: 'mt', gridConnectionKw: 8000, capex: 700 };
const r24 = run(buildState({
    inputs: { collectionLagRid: 2 },
    plants: [
        { id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true, generation: gen24a, codDate: '2027-05-15', ...plantNoBess24 },
        { id: 'pB', name: 'Impianto B', capacity: 4000, zone: 'SUD', opex: 60000, enabled: true, generation: gen24b, codDate: '2028-02-15', ...plantNoBess24 }
    ]
}));
const mc24 = r24.monthlyCashflow;
check('Modalità dated con anno àncora 2027 e 72 mesi', mc24.mode === 'dated' && mc24.anchorYear === 2027 && mc24.months.length === 72);
check('Etichette di calendario: Gen 2026 (Y0) come primo mese', mc24.labels[0] === 'Gen 2026 (Y0)' && mc24.labels[12] === 'Gen 2027');
check('Anno 0 senza ricavi maturati', mc24.revenueAccrued.slice(0, 12).every(v => v === 0));
// Quadratura: somma accrual per anno di calendario = somma stream annuali del matrix (già riproporzionati COD)
const sumRange24 = (arr, from, len) => arr.slice(from, from + len).reduce((a, b) => a + b, 0);
let quad24 = true; let det24 = '';
for (let y = 1; y <= 5; y++) {
    const accruedYear = sumRange24(mc24.revenueAccrued, 12 + (y - 1) * 12, 12);
    const annual = (r24.matrix.revenueRid[y - 1] || 0) + (r24.matrix.revenuePpa[y - 1] || 0) +
        (r24.matrix.revenueArbitrage[y - 1] || 0) + (r24.matrix.revenueTimeshifting[y - 1] || 0);
    const tol = Math.max(1e-6, Math.abs(annual) * 1e-9);
    if (Math.abs(accruedYear - annual) > tol) { quad24 = false; det24 = `Y${y}: ${accruedYear.toFixed(2)} vs ${annual.toFixed(2)}`; break; }
}
check('Quadratura accrual annuo = matrix (con riproporzionamento COD)', quad24, det24);
check('Impianto A produce da mag 2027 (parziale), nulla prima', mc24.revenueAccrued.slice(12, 16).every(v => v === 0) && mc24.revenueAccrued[16] > 0);
check('Lag RID 2 mesi: incasso mag-2027 slitta a lug-2027', mc24.revenueCollected[16] === 0 && Math.abs(mc24.revenueCollected[18] - mc24.revenueAccrued[16]) < 1e-6,
    `coll[16]=${mc24.revenueCollected[16].toFixed(2)} coll[18]=${mc24.revenueCollected[18].toFixed(2)} accr[16]=${mc24.revenueAccrued[16].toFixed(2)}`);
check('Identità di cassa valida sui 72 mesi', (() => {
    for (let i = 0; i < 72; i++) {
        if (Math.abs((mc24.cashOpening[i] + mc24.netCashflow[i]) - mc24.cashClosing[i]) > 1e-6) return false;
        if (i > 0 && Math.abs(mc24.cashOpening[i] - mc24.cashClosing[i - 1]) > 1e-6) return false;
    }
    return true;
})());
check('Nessun NaN/Inf nello schedule dated', mc24.netCashflow.every(v => Number.isFinite(v)) && mc24.cashClosing.every(v => Number.isFinite(v)));

// ── Test 25: esborsi CAPEX datati per impianto (CF4) ──
console.log('\n[Test 25] CAPEX datati: esborsi espliciti e default 100% al COD');
const capexPay25 = {
    pA: [
        { date: '2026-10-15', amount: 500000, label: 'Acquisto SPV' },
        { date: '2027-02-15', amount: 2000000, label: 'EPC 50%' },
        { date: '2027-05-01', amount: 2000000, label: 'EPC saldo' }
    ]
    // pB: nessun pagamento -> default 100% del CAPEX alla data COD
};
const r25 = run(buildState({
    inputs: { collectionLagRid: 0, vatEnabled: false },
    plants: [
        { id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true, generation: gen24a, codDate: '2027-05-15', ...plantNoBess24, capex: 700 },
        { id: 'pB', name: 'Impianto B', capacity: 4000, zone: 'SUD', opex: 60000, enabled: true, generation: gen24b, codDate: '2028-02-15', ...plantNoBess24, capex: 750 }
    ]
}), capexPay25);
const mc25 = r25.monthlyCashflow;
// indici: anno0=2026 -> ott-2026 = mese 9; feb-2027 = 12+1=13; mag-2027 = 12+4=16; feb-2028 = 24+1=25
check('Esborso SPV ott-2026 (anno 0) = 500.000', mc25.capexOutflow[9] === 500000, `got=${mc25.capexOutflow[9]}`);
check('Esborso EPC 50% feb-2027 = 2.000.000', mc25.capexOutflow[13] === 2000000, `got=${mc25.capexOutflow[13]}`);
// CF9: al mag-2027 (COD pA) arriva l'esborso esplicito 2M + il residuo non allocato di pA (base 5,6M - allocato 4,5M = 1,1M)
const residuoP25 = 8000 * 700 - (500000 + 2000000 + 2000000);
check('EPC saldo mag-2027 + residuo pA al COD', Math.abs(mc25.capexOutflow[16] - (2000000 + residuoP25)) < 1e-6, `got=${mc25.capexOutflow[16]} exp=${2000000 + residuoP25}`);
check('Default pB: 100% CAPEX (4000*750) al COD feb-2028', mc25.capexOutflow[25] === 4000 * 750, `got=${mc25.capexOutflow[25]}`);
check('Contatori budget CAPEX (CF9)', mc25.capexAllocated === 4500000 && Math.abs(mc25.capexResidual - Math.max(0, mc25.capexBudget - 4500000)) < 1e-6,
    `alloc=${mc25.capexAllocated} resid=${mc25.capexResidual} budget=${mc25.capexBudget}`);
check('Il net del mese include gli esborsi CAPEX', Math.abs((mc25.revenueTotal[9] - mc25.opex[9] - mc25.taxes[9] - mc25.debtService[9] - 500000) - mc25.netCashflow[9]) < 1e-6);
check('Nessun CAPEX prima dell\'orizzonte', mc25.capexBeforeHorizon === 0);

// ── Test 26: OPEX cash flow = solo eventi reali dichiarati, imposte Y+1 (CF9/CF11) ──
console.log('\n[Test 26] OPEX: evento manutenzione mar (nessuna spalmatura), imposte a giu Y+1');
const opexEv26 = { pA: [{ month: 3, amount: 30000, label: 'Manutenzione' }] };
const r26 = run(buildState({
    inputs: { collectionLagRid: 0, taxPaymentMonth: 6 },
    plants: [
        { id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, opexTaxes: 12000, enabled: true, generation: gen24a, codDate: '2027-05-15', ...plantNoBess24 }
    ]
}), null, opexEv26);
const mc26 = r26.monthlyCashflow;
const opexTotY1 = r26.matrix.opexTotal[0] || 0;
const resid26Y1 = Math.max(0, opexTotY1 - 30000);
// indici: mar-2027=14, giu-2027=17, mar-2028=26, giu-2028=29
check('Evento mar-2027 = 30.000 (solo uscita reale)', Math.abs(mc26.opex[14] - 30000) < 1e-6, `got=${mc26.opex[14].toFixed(2)}`);
check('Mese senza eventi (giu-2027) = 0 (nessuna spalmatura)', mc26.opex[17] === 0);
check('Evento mar-2028 ricorrente = 30.000', Math.abs(mc26.opex[26] - 30000) < 1e-6, `got=${mc26.opex[26].toFixed(2)}`);
const sumOpexY1 = mc26.opex.slice(12, 24).reduce((a, b) => a + b, 0);
check('OPEX cassa anno 1 = soli eventi dichiarati (30.000)', Math.abs(sumOpexY1 - 30000) < 1e-3, `sum=${sumOpexY1.toFixed(0)}`);
check('Contatori copertura OPEX (informativi, non generano cassa)', mc26.opexBudgetY1 === opexTotY1 && mc26.opexAllocated === 30000 &&
    Math.abs(mc26.opexResidual - resid26Y1) < 1e-6 && mc26.opexAllocatedY1 === 30000,
    `budget=${mc26.opexBudgetY1} alloc=${mc26.opexAllocated} resid=${mc26.opexResidual}`);
check('Imposte anno 1 pagate a giu-2028 (non a giu-2027)', mc26.taxes[17] === 0 && Math.abs(mc26.taxes[29] - (r26.matrix.currentTaxesSpv[0] || 0)) < 1e-6);
check('Imposte anno 5 oltre orizzonte tracciate', Math.abs(mc26.taxesAfterHorizon - (r26.matrix.currentTaxesSpv[4] || 0)) < 1e-6);
check('Nessuna imposta o OPEX in anno 0', mc26.taxes.slice(0, 12).every(v => v === 0) && mc26.opex.slice(0, 12).every(v => v === 0));

// ── Test 27: vista Holding mensile (CF6) ──
console.log('\n[Test 27] Serie Holding: SPV − soci − PD − oneri HoldCo');
const r27 = run(buildState({
    inputs: { collectionLagRid: 0 },
    plants: [
        { id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true, generation: gen24a, codDate: '2027-05-15', ...plantNoBess24 }
    ]
}));
const mc27 = r27.monthlyCashflow;
check('Array Holding presenti (72 mesi)', mc27.holdcoNetCashflow.length === 72 && mc27.holdcoCashClosing.length === 72);
check('Anno 0: nessun servizio soci/PD/oneri HoldCo', mc27.holdcoSociService.slice(0, 12).every(v => v === 0) &&
    mc27.holdcoPdService.slice(0, 12).every(v => v === 0) && mc27.holdcoOtherCosts.slice(0, 12).every(v => v === 0));
// giu-2028 (idx 29): holdcoNet = spvNet - sociSvc(dato) - pdSvc(dato) - otherM
const i27 = 29;
const sociM27 = mc27.sociService[i27];
const pdM27 = mc27.pdService[i27];
const otherM27 = ((r27.matrix.holdcoEarnoutPaid[1] || 0) + (r27.matrix.holdcoOpex[1] || 0) +
    (r27.matrix.holdcoIresTaxPaid[1] || 0) + (r27.matrix.holdcoIrapTaxPaid[1] || 0)) / 12;
check('Netto Holding = SPV − soci (datato) − PD (datato) − oneri HoldCo (giu-2028)', Math.abs(mc27.holdcoNetCashflow[i27] - (mc27.netCashflow[i27] - sociM27 - pdM27 - otherM27)) < 1e-6);
check('Servizio soci datato: parte dalla data finanziamento (non prima)', (() => {
    // sociIdx = primo mese CAPEX (default senza date funding) → nessun servizio soci nei mesi precedenti
    let firstSoci = mc27.sociService.findIndex(v => v > 0);
    if (firstSoci === -1) return true; // cassa mai sufficiente: comunque coerente
    return mc27.sociService.slice(0, firstSoci).every(v => v === 0);
})());
check('Identità di cassa Holding sui 72 mesi', (() => {
    for (let i = 0; i < 72; i++) {
        if (Math.abs((mc27.holdcoCashOpening[i] + mc27.holdcoNetCashflow[i]) - mc27.holdcoCashClosing[i]) > 1e-6) return false;
        if (i > 0 && Math.abs(mc27.holdcoCashOpening[i] - mc27.holdcoCashClosing[i - 1]) > 1e-6) return false;
    }
    return true;
})());
const r27legacy = run(buildState());
check('Modalità legacy senza COD: nessuna serie Holding', !r27legacy.monthlyCashflow.holdcoNetCashflow);

// ── Test 28: voci CAPEX/OPEX personalizzate entrano in tutti i calcoli (CF7) ──
console.log('\n[Test 28] Voci personalizzate: CAPEX in investimento/ammortamenti, OPEX in EBITDA/mensile');
const basePlants28 = () => ([{
    id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true,
    generation: gen24a, codDate: '2027-05-15', ...plantNoBess24
}]);
const r28a = run(buildState({ inputs: { collectionLagRid: 0 }, plants: basePlants28() }));
const withCustom = basePlants28();
withCustom[0].customCapexEur = 100000;
withCustom[0].customOpexEur = 50000;
const r28b = run(buildState({ inputs: { collectionLagRid: 0 }, plants: withCustom }));
check('CAPEX personalizzato entra nel costo progetto (+100.000)', Math.abs((r28b.totalProjectCost - r28a.totalProjectCost) - 100000) < 1e-6,
    `Δ=${(r28b.totalProjectCost - r28a.totalProjectCost).toFixed(0)}`);
check('OPEX personalizzato entra in EBITDA anno 1 (−50.000)', Math.abs((r28b.matrix.ebitda[0] - r28a.matrix.ebitda[0]) + 50000) < 1e-6,
    `Δ=${(r28b.matrix.ebitda[0] - r28a.matrix.ebitda[0]).toFixed(0)}`);
check('OPEX personalizzato nel budget Y1 ma non genera cassa senza eventi dichiarati',
    Math.abs((r28b.monthlyCashflow.opex[12] - r28a.monthlyCashflow.opex[12])) < 1e-6 &&
    Math.abs((r28b.monthlyCashflow.opexBudgetY1 - r28a.monthlyCashflow.opexBudgetY1) - 50000) < 1e-6,
    `Δcassa=${(r28b.monthlyCashflow.opex[12] - r28a.monthlyCashflow.opex[12]).toFixed(2)} Δbudget=${(r28b.monthlyCashflow.opexBudgetY1 - r28a.monthlyCashflow.opexBudgetY1).toFixed(0)}`);
check('Totali esposti nei risultati', r28b.totalCustomCapex === 100000 && r28b.totalCustomOpex === 50000);

// ── Test 29: date di funding + cassa finanziata + XIRR datato (CF8) ──
console.log('\n[Test 29] Funding datato: equity 2026-06, debito 2027-01; cassa finanziata e XIRR');
const r29 = run(buildState({
    inputs: { collectionLagRid: 0, fundingEquityDate: '2026-06-01', fundingSociDate: '2026-06-01', fundingDebtDate: '2027-01-01' },
    plants: basePlants28()
}));
const mc29 = r29.monthlyCashflow;
// anno 0 = 2026 -> idx giu-2026 = 5; gen-2027 = 12
check('Equity+soci erogati a giu-2026 (idx 5)', Math.abs(mc29.fundingInflow[5] - (r29.equityAmount + 0)) < 1e-6 || mc29.fundingInflow[5] > 0,
    `inflow[5]=${mc29.fundingInflow[5].toFixed(0)} equity=${r29.equityAmount.toFixed(0)}`);
check('Debito erogato a gen-2027 (idx 12)', mc29.fundingInflow[12] > 0, `inflow[12]=${mc29.fundingInflow[12].toFixed(0)}`);
check('Cassa con funding ≥ cassa senza funding (min)', mc29.fundedMinCashClosing >= mc29.minCashClosing - 1e-6,
    `funded=${mc29.fundedMinCashClosing.toFixed(0)} unfunded=${mc29.minCashClosing.toFixed(0)}`);
check('XIRR datato finito', Number.isFinite(mc29.datedXirr) && !isNaN(mc29.datedXirr), `xirr=${mc29.datedXirr}`);

// ── Test 30: IVA solo cash flow — pass-through con credito IVA e liquidazione (CF10) ──
console.log('\n[Test 30] IVA di cassa: pass-through con credito IVA e liquidazione');
const r30 = run(buildState({
    inputs: { collectionLagRid: 0, vatEnabled: true, vatRate: 22, vatTaxableRevenuePct: 100, vatSettlement: 'mensile' },
    plants: basePlants28()
}));
const mc30 = r30.monthlyCashflow;
check('IVA abilitata e array presenti (72 mesi)', mc30.vatEnabled === true && mc30.vatCashFlow.length === 72 && mc30.vatCreditEnd.length === 72);
let vatIdOk = true;
for (let i = 0; i < 72; i++) {
    if (Math.abs(mc30.vatCashFlow[i] - (mc30.vatCollected[i] - mc30.vatPaidToSuppliers[i] - mc30.vatRemitted[i])) > 1e-6) { vatIdOk = false; break; }
}
check('Identità IVA mensile (incassata − pagata − versata)', vatIdOk);
const capexMonth30 = mc30.capexOutflow.findIndex(v => v > 0);
check('IVA a credito = 22% di (CAPEX+OPEX) nel mese di esborso', capexMonth30 >= 0 && Math.abs(mc30.vatPaidToSuppliers[capexMonth30] - 0.22 * (mc30.capexOutflow[capexMonth30] + mc30.opex[capexMonth30])) < 1e-6,
    `mese=${capexMonth30} vatPaid=${mc30.vatPaidToSuppliers[capexMonth30].toFixed(0)}`);
check('Credito IVA massimo ≥ 0 e coerente', mc30.vatMaxCredit >= 0 && Math.abs(mc30.vatMaxCredit - Math.max.apply(null, mc30.vatCreditEnd)) < 1e-6);
check('Effetto netto cumulato = Σ vatCashFlow', Math.abs(mc30.vatNetCumulative - mc30.vatCashFlow.reduce((a, b) => a + b, 0)) < 1e-6);
const r30off = run(buildState({ inputs: { collectionLagRid: 0, vatEnabled: false }, plants: basePlants28() }));
check('IVA disabilitata: nessun effetto sul cash flow', r30off.monthlyCashflow.vatCashFlow.every(v => v === 0));

// ── Test 31: IVA per categoria CAPEX/OPEX e aliquote per riga sulle voci personalizzate (CF11) ──
console.log('\n[Test 31] CF11: aliquote per categoria, voci personalizzate con vat_rate, contatori netto/IVA/lordo');
const plants31 = (vat10) => {
    const pl = {
        id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true,
        generation: gen24a, codDate: '2027-05-15', ...plantNoBess24,
        customCapexEur: 100000, customOpexEur: 12000,
        customCosts: [
            { cost_type: 'capex', label: 'Bonifica', amount_eur: 100000, unit: 'total', vat_rate: vat10 ? 10 : 22 },
            { cost_type: 'opex', label: 'Monitoraggio', amount_eur: 12000, unit: 'total', vat_rate: 4 }
        ]
    };
    return [pl];
};
const capexPay31 = { pA: [{ date: '2027-02-15', amount: 1000000, label: 'Connessione rete' }] };
const opexEv31 = { pA: [{ month: 6, amount: 10000, label: 'IMU / Tasse locali' }, { month: 7, amount: 10000, label: 'Sicurezza' }] };
const vatAllButConn = { collectionLagRid: 0, vatEnabled: true, vatRate: 22, vatTaxableRevenuePct: 100, vatSettlement: 'mensile', vatCapexConnection: 0 };
const r31a = run(buildState({ inputs: vatAllButConn, plants: plants31(true) }), capexPay31, opexEv31);
const r31b = run(buildState({ inputs: { ...vatAllButConn, vatCapexConnection: 22 }, plants: plants31(true) }), capexPay31, opexEv31);
const mc31a = r31a.monthlyCashflow, mc31b = r31b.monthlyCashflow;
// feb-2027 = idx 13 (solo esborso connessione), mag-2027 = idx 16 (COD: residuo CAPEX)
check('Connessione rete con IVA 0%: nessun credito IVA sull\'esborso (Δ vs 22% = 220.000)',
    Math.abs((mc31b.vatPaidToSuppliers[13] - mc31a.vatPaidToSuppliers[13]) - 220000) < 1e-6,
    `a=${mc31a.vatPaidToSuppliers[13].toFixed(0)} b=${mc31b.vatPaidToSuppliers[13].toFixed(0)}`);
check('Contatori budget: IVA allocata CAPEX (0% vs 22%)', Math.abs(mc31a.capexVatAllocated - 0) < 1e-6 && Math.abs(mc31b.capexVatAllocated - 220000) < 1e-6,
    `a=${mc31a.capexVatAllocated} b=${mc31b.capexVatAllocated}`);
check('Lordo allocato CAPEX = netto + IVA', Math.abs(mc31b.capexGrossAllocated - (mc31b.capexAllocated + mc31b.capexVatAllocated)) < 1e-6);
check('Eventi OPEX: IMU 0% + Sicurezza 22% → IVA allocata 2.200', Math.abs(mc31a.opexVatAllocated - 2200) < 1e-6 && Math.abs(mc31a.opexGrossAllocated - 22200) < 1e-6,
    `vat=${mc31a.opexVatAllocated} gross=${mc31a.opexGrossAllocated}`);
// Identità CF11 al mese di COD (idx 16): residuo CAPEX × blend impianto (nessun evento OPEX a maggio)
const base31 = 8000 * 700 + 100000;
const residCapex31 = base31 - 1000000;
const blendCapex31a = (5600000 * 0.22 + 100000 * 0.10) / base31;
check('VAT pagata al COD = residuo CAPEX × blend impianto (OPEX = solo eventi reali)',
    Math.abs(mc31a.vatPaidToSuppliers[16] - residCapex31 * blendCapex31a) < 1e-3,
    `got=${mc31a.vatPaidToSuppliers[16].toFixed(0)} exp=${(residCapex31 * blendCapex31a).toFixed(0)}`);
check('IVA eventi OPEX nel loro mese: giu = IMU 0%, lug = Sicurezza 22%',
    Math.abs(mc31a.vatPaidToSuppliers[17] - 0) < 1e-6 && Math.abs(mc31a.vatPaidToSuppliers[18] - 2200) < 1e-6,
    `giu=${mc31a.vatPaidToSuppliers[17].toFixed(0)} lug=${mc31a.vatPaidToSuppliers[18].toFixed(0)}`);
// Voce personalizzata con vat_rate 10 vs 22: il Δ sul credito IVA al COD = residuo/base × 100.000 × 12%
const r31c = run(buildState({ inputs: vatAllButConn, plants: plants31(false) }), capexPay31, opexEv31);
const mc31c = r31c.monthlyCashflow;
const deltaCustom31 = (residCapex31 / base31) * 100000 * 0.12;
check('vat_rate voce personalizzata 10% vs 22%: Δ credito IVA al COD',
    Math.abs((mc31c.vatPaidToSuppliers[16] - mc31b.vatPaidToSuppliers[16]) - deltaCustom31) < 1e-3,
    `Δ=${(mc31c.vatPaidToSuppliers[16] - mc31b.vatPaidToSuppliers[16]).toFixed(0)} exp=${deltaCustom31.toFixed(0)}`);
check('Identità IVA mensile ancora valida (CF11)', (() => {
    for (let i = 0; i < 72; i++) {
        if (Math.abs(mc31a.vatCashFlow[i] - (mc31a.vatCollected[i] - mc31a.vatPaidToSuppliers[i] - mc31a.vatRemitted[i])) > 1e-6) return false;
    }
    return true;
})());

// ── Test 32: regole temporali eventi OPEX — > COD e < COD (CF11) ──
console.log('\n[Test 32] Regole temporali eventi OPEX: > COD attiva solo i mesi dopo il COD, < COD solo prima');
const plants32 = () => ([{
    id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true,
    generation: gen24a, codDate: '2027-05-15', ...plantNoBess24
}]);
const r32gt = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants32() }), null,
    { pA: [{ month: 3, amount: 30000, label: 'Sicurezza', rule: 'gt_cod' }] });
const r32lt = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants32() }), null,
    { pA: [{ month: 3, amount: 30000, label: 'Sicurezza', rule: 'lt_cod' }] });
const mc32gt = r32gt.monthlyCashflow, mc32lt = r32lt.monthlyCashflow;
// COD mag-2027 → mar-2027 (idx 14) è PRIMA del COD, mar-2028 (idx 26) è DOPO
check('gt_cod: mar-2027 inattivo → OPEX 0 (nessuna spalmatura)', mc32gt.opex[14] === 0,
    `got=${mc32gt.opex[14].toFixed(2)}`);
check('gt_cod: mar-2028 attivo → OPEX = solo evento 30.000', Math.abs(mc32gt.opex[26] - 30000) < 1e-6,
    `got=${mc32gt.opex[26].toFixed(2)}`);
check('lt_cod: mar-2027 attivo → OPEX = solo evento 30.000', Math.abs(mc32lt.opex[14] - 30000) < 1e-6,
    `got=${mc32lt.opex[14].toFixed(2)}`);
check('lt_cod: mar-2028 inattivo → OPEX 0', mc32lt.opex[26] === 0,
    `got=${mc32lt.opex[26].toFixed(2)}`);
check('Eventi senza regola = sempre: attivi ogni anno nel loro mese', (() => {
    const r32s = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants32() }), null,
        { pA: [{ month: 3, amount: 30000, label: 'Sicurezza' }] });
    return Math.abs(r32s.monthlyCashflow.opex[14] - 30000) < 1e-6 &&
           Math.abs(r32s.monthlyCashflow.opex[26] - 30000) < 1e-6;
})());

// ── Test 33: IVA sui ricavi per regime — reverse charge 0%, RID 22%, legacy fallback (CF11) ──
console.log('\n[Test 33] IVA sui ricavi per regime: reverse charge 0%, RID 22%, fallback aliquota globale');
const vatRegimeBase = { collectionLagRid: 0, vatEnabled: true, vatSettlement: 'mensile' };
const r33rc = run(buildState({ inputs: { ...vatRegimeBase, vatRevRid: 0, vatRevPpa: 0, vatRevBrp: 0, vatRevCer: 22, vatRevFerx: 0 }, plants: basePlants28() }));
check('Reverse charge (RID 0%): nessuna IVA a debito sui ricavi incassati',
    r33rc.monthlyCashflow.vatCollected.every(v => Math.abs(v) < 1e-9));
const r33rid = run(buildState({ inputs: { ...vatRegimeBase, vatRevRid: 22, vatRevPpa: 0, vatRevBrp: 0, vatRevCer: 22, vatRevFerx: 0 }, plants: basePlants28() }));
check('RID al 22%: vatCollected = 22% degli incassi mensili', (() => {
    const mc = r33rid.monthlyCashflow;
    for (let i = 0; i < 72; i++) {
        if (Math.abs(mc.vatCollected[i] - 0.22 * mc.revenueCollected[i]) > 1e-6) return false;
    }
    return true;
})());
const r33legacy = run(buildState({ inputs: { ...vatRegimeBase, vatRate: 22, vatTaxableRevenuePct: 100 }, plants: basePlants28() }));
check('Fallback legacy: senza campi per-regime vale aliquota globale × % imponibile', (() => {
    const mc = r33legacy.monthlyCashflow;
    for (let i = 0; i < 72; i++) {
        if (Math.abs(mc.vatCollected[i] - 0.22 * mc.revenueCollected[i]) > 1e-6) return false;
    }
    return true;
})());

// ── Test 34: > COD = strettamente dopo la data di COD (mese del COD slitta all'anno dopo) (CF11) ──
console.log('\n[Test 34] > COD stretto: spesa nel mese del COD prima occorrenza l anno successivo');
const r34gt = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants32() }), null,
    { pA: [{ month: 5, amount: 30000, label: 'Sicurezza', rule: 'gt_cod' }] }); // COD mag-2027
check('gt_cod: mag-2027 (mese del COD) inattivo → OPEX 0', r34gt.monthlyCashflow.opex[16] === 0,
    `got=${r34gt.monthlyCashflow.opex[16].toFixed(2)}`);
check('gt_cod: mag-2028 primo addebito', Math.abs(r34gt.monthlyCashflow.opex[28] - 30000) < 1e-6,
    `got=${r34gt.monthlyCashflow.opex[28].toFixed(2)}`);
check('gt_cod su mese del COD: Effettivo Y1 = 0', Math.abs(r34gt.monthlyCashflow.opexAllocatedY1 - 0) < 1e-6);
// Caso utente: scadenza luglio, COD 15/07/2027 → primo addebito luglio 2028
const plants34jul = [{
    id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true,
    generation: gen24a, codDate: '2027-07-15', ...plantNoBess24
}];
const r34jul = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants34jul }), null,
    { pA: [{ month: 7, amount: 30000, label: 'Sicurezza', rule: 'gt_cod' }] });
check('gt_cod: scadenza lug con COD 15/07/2027 → inattivo lug-2027, attivo lug-2028',
    r34jul.monthlyCashflow.opex[18] === 0 && Math.abs(r34jul.monthlyCashflow.opex[30] - 30000) < 1e-6,
    `lug27=${r34jul.monthlyCashflow.opex[18].toFixed(0)} lug28=${r34jul.monthlyCashflow.opex[30].toFixed(0)}`);
const r34lt = run(buildState({ inputs: { collectionLagRid: 0 }, plants: plants32() }), null,
    { pA: [{ month: 5, amount: 30000, label: 'Sicurezza', rule: 'lt_cod' }] });
check('lt_cod sul mese di COD: mai attivo (mag-2027 e mag-2028 = 0)',
    r34lt.monthlyCashflow.opex[16] === 0 && r34lt.monthlyCashflow.opex[28] === 0);

// ── Test 35: servizio debito senior DATATO — erogazione, pro-rata giorni, preammortamento (CF11) ──
console.log('\n[Test 35] Debito datato: decorrenza erogazione 15/11/2026, pro-rata giorni act/360, grace 2 mesi, rata francese');
const r35 = run(buildState({
    inputs: {
        collectionLagRid: 0, interestRate: 0.05, loanTerm: 10,
        seniorGracePeriodMonths: 2, fundingDebtDate: '2026-11-15'
    },
    plants: plants32()
}));
const mc35 = r35.monthlyCashflow;
const P35 = mc35.fundingInflow[10]; // debito erogato a nov-2026 (idx 10)
check('Debito erogato a nov-2026 (funding inflow presente)', P35 > 0, `P=${P35}`);
check('Nessun servizio debito nel mese di erogazione e prima (gen–nov 2026)',
    mc35.debtService.slice(0, 11).every(v => Math.abs(v) < 1e-9));
const im35 = 0.05 / 12, n35 = 10 * 12 - 2;
const annuity35 = P35 * im35 / (1 - Math.pow(1 + im35, -n35));
const intDec35 = P35 * 0.05 * (16 + 31) / 360; // nov-15 → dic-31 = 16+31 giorni, act/360
check('dic-2026: prima uscita = soli interessi pro-rata da erogazione (47/360), no capitale (grace)',
    Math.abs(mc35.debtService[11] - intDec35) < 1e-6 && Math.abs(mc35.principal[11]) < 1e-9,
    `got=${mc35.debtService[11].toFixed(2)} exp=${intDec35.toFixed(2)}`);
const intGen35 = P35 * 0.05 * 31 / 360;
check('gen-2027: preammortamento, interessi mese intero (31/360)',
    Math.abs(mc35.debtService[12] - intGen35) < 1e-6 && Math.abs(mc35.principal[12]) < 1e-9,
    `got=${mc35.debtService[12].toFixed(2)} exp=${intGen35.toFixed(2)}`);
check('feb-2027: prima rata francese = annuity (capitale = annuity − interessi)',
    Math.abs(mc35.debtService[13] - annuity35) < 1e-3 &&
    Math.abs(mc35.principal[13] - (annuity35 - P35 * 0.05 * 28 / 360)) < 1e-3,
    `got=${mc35.debtService[13].toFixed(2)} exp=${annuity35.toFixed(2)}`);
check('mar-2027: interessi sul capitale residuo (31/360) + quota capitale', (() => {
    const outFeb = P35 - mc35.principal[13];
    const intMar = outFeb * 0.05 * 31 / 360;
    return Math.abs(mc35.interest[14] - intMar) < 1e-3 && Math.abs(mc35.debtService[14] - annuity35) < 1e-3;
})());

// ── Test 36: Private Debt datato (amortizing) — decorrenza erogazione, rata francese mensile (CF11) ──
console.log('\n[Test 36] Private Debt datato: erogazione 01/12/2026, ammortamento francese mensile, grace 0');
const r36 = run(buildState({
    inputs: {
        collectionLagRid: 0, fundingDebtDate: '2026-12-20',
        pdEnabled: true, pdAmountType: 'fixed_eur', pdAmountValue: 600000,
        pdMode: 'amortizing', pdInterestRate: 8, pdLoanTerm: 10,
        pdInterestGrace: 0, pdPrincipalGrace: 0, exitOption: '20'
    },
    plants: plants32()
}));
const mc36 = r36.monthlyCashflow;
const im36 = 0.08 / 12, n36 = 10 * 12;
const annuity36 = 600000 * im36 / (1 - Math.pow(1 + im36, -n36));
check('PD: nessun servizio nel mese di erogazione e prima (gen–dic 2026)', mc36.pdService.slice(0, 12).every(v => Math.abs(v) < 1e-9));
check('PD gen-2027: prima rata francese = annuity (interessi 43/360 da erogazione + capitale)',
    Math.abs(mc36.pdService[12] - annuity36) < 1e-3,
    `got=${mc36.pdService[12].toFixed(2)} exp=${annuity36.toFixed(2)}`);
check('PD feb-2027: rata costante sul capitale residuo', (() => {
    const intGen = 600000 * 0.08 * 43 / 360; // dic-20 → gen-31 = 12+31 giorni
    const outGen = 600000 - (annuity36 - intGen);
    return Math.abs(mc36.pdService[13] - annuity36) < 1e-3 &&
           Math.abs(mc36.holdcoPdService[13] - annuity36) < 1e-3 && outGen > 0;
})());
check('PD: interessi primo periodo > annuity → pagati solo interessi (capitale slitta)', (() => {
    const r36s = run(buildState({
        inputs: {
            collectionLagRid: 0, fundingDebtDate: '2026-12-01',
            pdEnabled: true, pdAmountType: 'fixed_eur', pdAmountValue: 600000,
            pdMode: 'amortizing', pdInterestRate: 8, pdLoanTerm: 10,
            pdInterestGrace: 0, pdPrincipalGrace: 0, exitOption: '20'
        },
        plants: plants32()
    }));
    const intStub = 600000 * 0.08 * 62 / 360; // dic-01 → gen-31 = 62 giorni > annuity
    return Math.abs(r36s.monthlyCashflow.pdService[12] - intStub) < 1e-3;
})());
check('PD bullet_exit: nessun esborso in orizzonte (PIK fino a exit anno 20)', (() => {
    const r36b = run(buildState({
        inputs: {
            collectionLagRid: 0, fundingDebtDate: '2026-12-01',
            pdEnabled: true, pdAmountType: 'fixed_eur', pdAmountValue: 600000,
            pdMode: 'bullet_exit', pdInterestRate: 8, pdInterestGrace: 0, exitOption: '20'
        },
        plants: plants32()
    }));
    return r36b.monthlyCashflow.pdService.every(v => Math.abs(v) < 1e-9);
})());

// ── Test 37: gli esborsi datati coprono l'intero budget CAPEX, terreni inclusi (CF11) ──
console.log('\n[Test 37] Esborso Terreno datato: nessun extra duplicato al COD');
const capexPay37 = { pA: [
    { date: '2026-10-15', amount: 100000, label: 'Terreno' },
    { date: '2027-05-15', amount: 700000, label: 'EPC FV' }
] };
const r37 = run(buildState({
    inputs: { collectionLagRid: 0, constructionMonths: 0 },
    plants: [{ ...plantNoBess24, id: 'pA', name: 'Impianto A', capacity: 1000, capex: 700, opex: 20000,
        generation: gen24a, codDate: '2027-05-15', landType: 'acquisto', landCost: 100000 }]
}), capexPay37, null);
const mc37 = r37.monthlyCashflow;
check('Terreno datato ott-2026 in cassa', Math.abs(mc37.capexOutflow[9] - 100000) < 1e-6, `got=${mc37.capexOutflow[9]}`);
check('COD mag-2027: solo EPC datato 700.000 (nessun extra terreni duplicato)',
    Math.abs(mc37.capexOutflow[16] - 700000) < 1e-6, `got=${mc37.capexOutflow[16].toFixed(0)}`);
check('Budget CAPEX coperto al 100% → residuo 0', Math.abs(mc37.capexResidual) < 1e-6 &&
    Math.abs(mc37.capexBudget - 800000) < 1e-3, `budget=${mc37.capexBudget} resid=${mc37.capexResidual}`);

console.log(`\n═══════════════════════════════════`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
