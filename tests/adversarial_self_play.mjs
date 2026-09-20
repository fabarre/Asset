#!/usr/bin/env node
/**
 * Adversarial Self-Play & Red-Teaming Engine (Enterprise Resilience)
 * Genera attacchi sintetici estremi e condizioni paradossali per stressare il simulatore
 * e verificare che non si verifichino crash, NaN, o allucinazioni contabili.
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
    let iterations = 20;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--iterations' && args[i + 1]) {
            iterations = parseInt(args[i + 1], 10) || 20;
        }
    }
    return { iterations };
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

const ATTACK_VECTORS = [
    {
        name: "Zero Generation (Blackout Solare Totale)",
        apply: (state) => {
            state.plants[0].generation = new Float64Array(8760).fill(0);
        }
    },
    {
        name: "Prezzi PUN Fortemente Negativi (-50 €/MWh)",
        apply: (state) => {
            const negPUN = new Float64Array(8760).fill(-50);
            state.zonalPun = { NORD: negPUN, CNOR: negPUN, CSUD: negPUN, SUD: negPUN, SICI: negPUN, SARD: negPUN };
        }
    },
    {
        name: "Shock CAPEX Ultra-Elevato (50M €) con Ricavi Minimi",
        apply: (state) => {
            state.plants[0].capex = 50000;
            state.plants[0].capacity = 1000;
        }
    },
    {
        name: "Preammortamento Lunghissimo (36 mesi) e Tasso al 15%",
        apply: (state) => {
            state.inputs.seniorGracePeriodMonths = 36;
            state.inputs.interestRate = 0.15;
            state.inputs.leverage = 0.85;
        }
    },
    {
        name: "Mega BESS (50 MWh) senza Produzione Solare",
        apply: (state) => {
            state.plants[0].bessMw = 25;
            state.plants[0].bessMwh = 50;
            state.plants[0].generation = new Float64Array(8760).fill(0);
        }
    },
    {
        name: "Lag IVA Estremo (12 Mesi) + Compensazione F24 Massima",
        apply: (state) => {
            state.inputs.vatTrMode = 'compensazione';
            state.inputs.vatRefundLagMonths = 12;
        }
    },
    {
        name: "Cash Sweep 100% Immediato con Zero Equity Iniziale",
        apply: (state) => {
            state.inputs.sweepType = 'percentage';
            state.inputs.sweepValue = 100;
            state.inputs.leverage = 0.90;
        }
    },
    {
        name: "Deflazione Grave (-5%) e Tassi Zero",
        apply: (state) => {
            state.inputs.inflation = -0.05;
            state.inputs.interestRate = 0.001;
        }
    }
];

function createBaseState() {
    const profile = sandbox.generateDefaultSolarProfile(5, 1300);
    const pun = new Float64Array(8760).fill(110);
    return {
        inputs: {
            keVal: 0.08, wacc: 0.06, inflation: 0.02,
            fiscalDeprRate: 0.09, leverage: 0.70, interestRate: 0.045,
            loanTerm: 15, debtBasis: 'enterprise_value',
            sweepType: 'none', sweepValue: 0, sweepYears: 0,
            seniorGracePeriodMonths: 12, constructionMonths: 6, idcDrawdownFactor: 50,
            sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
            exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
            holdcoCapital: 10000,
            priceScenarioType: 'base',
            vatEnabled: true,
            vatTrMode: 'ibrido',
            vatRefundLagMonths: 2,
            vatRevRid: 0,
            vatRevPpa: 10,
            vatCapexEpcFv: 10,
            vatCapexEpcBess: 22,
            vatOpexOmFv: 22,
            taxPaymentMonth: 6
        },
        plants: [{
            id: 'p_redteam', name: 'Plant RedTeam',
            capacity: 5000, zone: 'CNOR',
            capex: 750, opex: 80000, enabled: true,
            codDate: '2027-05-15',
            generation: profile,
            bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
            bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
            bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
            gridVoltage: 'mt', gridConnectionKw: 5000,
            marketType: 'rid', traderContractType: 'pun_orario',
            traderSpread: 2, traderDisp: 1
        }],
        stabilimenti: [],
        zonalPun: { NORD: pun, CNOR: pun, CSUD: pun, SUD: pun, SICI: pun, SARD: pun },
        selectedBessPlantIds: null,
        previouslySeenPlantIds: null
    };
}

function verifyRobustness(results) {
    const cf = results.monthlyCashflow || [];
    if (cf.length === 0) return { ok: false, reason: "monthlyCashflow vuoto" };

    for (let t = 1; t < cf.length; t++) {
        const c = cf[t].closingCash;
        const net = cf[t].netCashflow;
        const prev = cf[t - 1].closingCash;

        if (isNaN(c) || !isFinite(c) || isNaN(net) || !isFinite(net)) {
            return { ok: false, reason: `NaN/Infinity rilevato a mese ${t}` };
        }
        if (Math.abs(c - (prev + net)) > 0.10) {
            return { ok: false, reason: `Disallineamento cassa mese ${t}: ${c} != ${prev} + ${net}` };
        }
    }
    return { ok: true };
}

async function main() {
    const { iterations } = parseArgs();
    console.log("=======================================================");
    console.log(`🛡️ ADVERSARIAL RED-TEAMING & SELF-PLAY: ${iterations} ATTACCHI`);
    console.log("=======================================================\n");

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < iterations; i++) {
        const attack = ATTACK_VECTORS[i % ATTACK_VECTORS.length];
        const state = createBaseState();
        attack.apply(state);

        try {
            const results = run(state);
            const check = verifyRobustness(results);
            if (check.ok) {
                passed++;
                console.log(`  ✓ [ATTACK ${i + 1}/${iterations}] SUPERATO: ${attack.name}`);
            } else {
                failed++;
                console.error(`  ✗ [ATTACK ${i + 1}/${iterations}] RESPINTO DAL WORKER CON ANOMALIA: ${attack.name} --> ${check.reason}`);
            }
        } catch (e) {
            failed++;
            console.error(`  ✗ [ATTACK ${i + 1}/${iterations}] CRASH / ECCEZIONE: ${attack.name} --> ${e.message}`);
        }
    }

    console.log("\n=======================================================");
    console.log(`Riepilogo Red-Teaming Self-Play (${iterations} attacchi eseguiti):`);
    console.log(`- Attacchi Neutralizzati (Calcolo Robusto): ${passed}`);
    console.log(`- Vulnerabilità Rilevate (Falliti):         ${failed}`);
    console.log("=======================================================");

    if (failed > 0) {
        console.error("❌ IL SISTEMA HA MOSTRATO VULNERABILITÀ AD ATTACCHI AVVERSARI.");
        process.exit(1);
    } else {
        console.log("🎉 IL MOTORE HA SUPERATO TUTTI GLI ATTACCHI AVVERSARI SENZA CRASH NÉ NAN!");
        process.exit(0);
    }
}

main();
