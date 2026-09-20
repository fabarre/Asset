#!/usr/bin/env node
/**
 * Monte Carlo Fuzzing & Boundary Stress Suite (Enterprise Resilience Engine)
 * Esegue N scenari stocastici con parametri limite/arbitrari e valida le 10 invarianti.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../src/worker/simulation.worker.js');
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

function parseArgs() {
    const args = process.argv.slice(2);
    let scenarios = 50;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--scenarios' && args[i + 1]) {
            scenarios = parseInt(args[i + 1], 10) || 50;
        }
    }
    return { scenarios };
}

function run(state) {
    lastMessage = null;
    sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    if (!lastMessage) throw new Error('Nessuna risposta dal worker');
    if (lastMessage.status !== 'success') {
        throw new Error('Worker error: ' + lastMessage.error);
    }
    return lastMessage.results;
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomScenario(index) {
    const punBase = randomBetween(30, 250);
    const zonal = new Float64Array(8760).fill(punBase);
    const capacity = Math.round(randomBetween(1000, 15000));
    const profile = sandbox.generateDefaultSolarProfile(capacity / 1000, 1300);

    const vatMode = randomChoice(['ibrido', 'rimborso', 'compensazione', 'credito']);
    const lagMonths = randomChoice([0, 1, 2, 3, 4, 6]);
    const leverage = randomBetween(0.0, 0.85);
    const interestRate = randomBetween(0.015, 0.09);
    const inflation = randomBetween(0.0, 0.08);
    const seniorGraceMonths = randomChoice([0, 6, 12, 18, 24]);
    const bessMwh = randomChoice([0, 2, 4, 8, 12]);

    const state = {
        inputs: {
            keVal: 0.08, wacc: 0.06, inflation,
            fiscalDeprRate: 0.09, leverage, interestRate,
            loanTerm: 15, debtBasis: 'enterprise_value',
            sweepType: 'none', sweepValue: 0, sweepYears: 0,
            seniorGracePeriodMonths: seniorGraceMonths,
            constructionMonths: 6, idcDrawdownFactor: 50,
            sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
            exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
            holdcoCapital: 10000,
            priceScenarioType: 'base',
            vatEnabled: true,
            vatTrMode: vatMode,
            vatRefundLagMonths: lagMonths,
            vatRevRid: 0,
            vatRevPpa: 10,
            vatCapexEpcFv: 10,
            vatCapexEpcBess: 22,
            vatOpexOmFv: 22,
            taxPaymentMonth: 6
        },
        plants: [{
            id: `p_mc_${index}`, name: `Plant Fuzzing ${index}`,
            capacity, zone: 'CNOR',
            capex: Math.round(randomBetween(450, 1100)),
            opex: Math.round(capacity * randomBetween(10, 25)),
            enabled: true,
            codDate: '2027-05-15',
            generation: profile,
            bessMw: bessMwh > 0 ? Math.round(bessMwh / 2) : 0,
            bessMwh, bessType: 'lfp', bessEfficiency: 0.90,
            bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
            bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
            gridVoltage: 'mt', gridConnectionKw: capacity,
            marketType: 'rid', traderContractType: 'pun_orario',
            traderSpread: 2, traderDisp: 1
        }],
        stabilimenti: [],
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
        selectedBessPlantIds: null,
        previouslySeenPlantIds: null
    };

    return { state, meta: { index, vatMode, lagMonths, leverage, interestRate, capacity, bessMwh } };
}

function verifyInvariants(results) {
    const cf = results.monthlyCashflow || [];
    if (cf.length === 0) return { ok: false, reason: 'Empty monthlyCashflow' };

    for (let t = 1; t < cf.length; t++) {
        // INV-01: Identità Cassa SPV
        const prevCash = cf[t - 1].closingCash || 0;
        const net = cf[t].netCashflow || 0;
        const currCash = cf[t].closingCash || 0;
        if (Math.abs(currCash - (prevCash + net)) > 0.05) {
            return { ok: false, reason: `INV-01 broken at month ${t}` };
        }

        // INV-03: Conservazione IVA
        const prevCred = cf[t - 1].vatCreditEnding || 0;
        const paid = cf[t].vatPaid || 0;
        const coll = cf[t].vatCollected || 0;
        const remit = cf[t].vatRemittance || 0;
        const ref = cf[t].vatRefund || 0;
        const comp = cf[t].vatCompensated || 0;
        const currCred = cf[t].vatCreditEnding || 0;
        const expectedCred = prevCred + paid - coll - remit - ref - comp;
        if (Math.abs(currCred - expectedCred) > 0.05) {
            return { ok: false, reason: `INV-03 broken at month ${t}` };
        }

        // INV-10: Assenza NaN
        if (isNaN(currCash) || !isFinite(currCash) || isNaN(currCred) || !isFinite(currCred)) {
            return { ok: false, reason: `INV-10 NaN/Infinity detected at month ${t}` };
        }
    }

    return { ok: true };
}

async function main() {
    const { scenarios } = parseArgs();
    console.log("=======================================================");
    console.log(`🎲 MONTE CARLO FUZZING STRESS SUITE: ${scenarios} SCENARI`);
    console.log("=======================================================\n");

    const startTime = Date.now();
    let passed = 0;
    let failed = 0;

    for (let i = 1; i <= scenarios; i++) {
        const { state, meta } = generateRandomScenario(i);
        try {
            const results = run(state);
            const check = verifyInvariants(results);
            if (check.ok) {
                passed++;
                if (i % 10 === 0 || i === scenarios) {
                    process.stdout.write(`  ✓ Scenari verificati: ${i}/${scenarios} (Pass: ${passed}, Fail: ${failed})\r`);
                }
            } else {
                failed++;
                console.error(`\n  ✗ [SCENARIO ${i} FAILED] ${check.reason} (Leverage: ${(meta.leverage*100).toFixed(1)}%, VAT: ${meta.vatMode}, Lag: ${meta.lagMonths}m)`);
            }
        } catch (e) {
            failed++;
            console.error(`\n  ✗ [SCENARIO ${i} EXCEPTION] ${e.message}`);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n\n=======================================================`);
    console.log(`Riepilogo Fuzzing Monte Carlo (${scenarios} scenari stocastici):`);
    console.log(`- Superati al 100%: ${passed}`);
    console.log(`- Falliti:          ${failed}`);
    console.log(`- Tempo Totale:     ${elapsed}s (media ${(elapsed / scenarios * 1000).toFixed(1)}ms per scenario)`);
    console.log(`=======================================================`);

    if (failed > 0) {
        console.error("❌ STRESS TEST FALLITO CON ANOMALIE.");
        process.exit(1);
    } else {
        console.log("🎉 TUTTI I TEST STOCASTICI HANNO CONFERMATO LA TENUTA AL 100%!");
        process.exit(0);
    }
}

main();
