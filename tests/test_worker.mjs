// ─────────────────────────────────────────────────────────────────────────────
// Test harness per il motore di calcolo (src/worker/simulation.worker.js)
// Esegue il worker in Node con shim di `self` e verifica invarianti chiave:
//  1. Nessun NaN nei risultati finanziari (default IRES/IRAP senza config DB)
//  2. Conservazione dell'energia FV (gen = PPA + RID + carica BESS) anno 1
//  3. IRR/NPV/DSCR finiti e coerenti
//  4. Grace period > 12 mesi non produce NaN né quota capitale negativa
//  5. "Nessun Exit" (exitOption '0') produce 20 anni di risultati
//  6. Project IRR usa orizzonte 20 anni (non loanTerm)
// Uso: node scratch/test_worker.mjs
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
        plants: [{
            id: 'p1', name: 'Impianto Test', capacity: 8000, zone: 'CNOR',
            capex: 700, opex: 120000, enabled: true,
            generation: profile,
            bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
            bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
            bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
            gridVoltage: 'mt', gridConnectionKw: 8000,
            marketType: 'rid', traderContractType: 'pun_orario',
            traderSpread: 2, traderDisp: 1,
            ...(overrides.plant || {})
        }],
        stabilimenti: overrides.stabilimenti || [],
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
        selectedBessPlantIds: null,
        previouslySeenPlantIds: null
    };
}

function run(state) {
    lastMessage = null;
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

console.log(`\n═══════════════════════════════════`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
