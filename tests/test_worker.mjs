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

function run(state, capexPayments) {
    lastMessage = null;
    if (capexPayments) state.capexPayments = capexPayments;
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
    inputs: { collectionLagRid: 0 },
    plants: [
        { id: 'pA', name: 'Impianto A', capacity: 8000, zone: 'NORD', opex: 120000, enabled: true, generation: gen24a, codDate: '2027-05-15', ...plantNoBess24, capex: 700 },
        { id: 'pB', name: 'Impianto B', capacity: 4000, zone: 'SUD', opex: 60000, enabled: true, generation: gen24b, codDate: '2028-02-15', ...plantNoBess24, capex: 750 }
    ]
}), capexPay25);
const mc25 = r25.monthlyCashflow;
// indici: anno0=2026 -> ott-2026 = mese 9; feb-2027 = 12+1=13; mag-2027 = 12+4=16; feb-2028 = 24+1=25
check('Esborso SPV ott-2026 (anno 0) = 500.000', mc25.capexOutflow[9] === 500000, `got=${mc25.capexOutflow[9]}`);
check('Esborso EPC 50% feb-2027 = 2.000.000', mc25.capexOutflow[13] === 2000000, `got=${mc25.capexOutflow[13]}`);
check('Esborso EPC saldo mag-2027 = 2.000.000', mc25.capexOutflow[16] === 2000000, `got=${mc25.capexOutflow[16]}`);
check('Default pB: 100% CAPEX (4000*750) al COD feb-2028', mc25.capexOutflow[25] === 4000 * 750, `got=${mc25.capexOutflow[25]}`);
check('Il net del mese include gli esborsi CAPEX', Math.abs((mc25.revenueTotal[9] - mc25.opex[9] - mc25.taxes[9] - mc25.debtService[9] - 500000) - mc25.netCashflow[9]) < 1e-6);
check('Nessun CAPEX prima dell\'orizzonte', mc25.capexBeforeHorizon === 0);

console.log(`\n═══════════════════════════════════`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
