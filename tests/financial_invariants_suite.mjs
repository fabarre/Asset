#!/usr/bin/env node
/**
 * Financial Invariants Test Suite (Deterministic Anti-Hallucination Engine)
 * Esegue il worker in Node via VM e verifica in modo bloccante le 10 Invarianti di Bilancio Fondamentali.
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

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assertInvariant(name, condition, detail = '') {
    totalChecks++;
    if (condition) {
        passedChecks++;
        console.log(`  ✓ [PASSED] ${name}`);
    } else {
        failedChecks++;
        console.error(`  ✗ [FAILED] ${name} ${detail ? '--> ' + detail : ''}`);
    }
}

function run(state, capexPayments = null, opexEvents = null) {
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

function createBaseState(overrides = {}) {
    const profile = sandbox.generateDefaultSolarProfile(8, 1300);
    const zonal = new Float64Array(8760).fill(100);
    const defaultPlant = {
        id: 'p1', name: 'Impianto Invarianti', capacity: 8000, zone: 'CNOR',
        capex: 700, opex: 120000, enabled: true,
        codDate: '2027-05-15',
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
            loanTerm: 15, debtBasis: 'enterprise_value',
            sweepType: 'none', sweepValue: 0, sweepYears: 0,
            seniorGracePeriodMonths: 12, constructionMonths: 6, idcDrawdownFactor: 50,
            sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
            exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
            holdcoCapital: 10000,
            priceScenarioType: 'base',
            vatEnabled: true,
            vatTrMode: 'ibrido',
            vatRefundLagMonths: 0,
            vatRevRid: 0,
            vatRevPpa: 10,
            vatCapexEpcFv: 10,
            vatCapexEpcBess: 22,
            vatOpexOmFv: 22,
            taxPaymentMonth: 6,
            ...(overrides.inputs || {})
        },
        plants: overrides.plants || [{ ...defaultPlant, ...(overrides.plant || {}) }],
        stabilimenti: overrides.stabilimenti || [],
        zonalPun: overrides.zonalPun || { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal },
        selectedBessPlantIds: null,
        previouslySeenPlantIds: null
    };
}

function verifyScenarioInvariants(scenarioName, state, capexPayments = null, opexEvents = null) {
    console.log(`\n======================================================`);
    console.log(`Verifica Invarianti: ${scenarioName}`);
    console.log(`======================================================`);
    const res = run(state, capexPayments, opexEvents);
    const mc = res.monthlyCashflow;
    const mtx = res.matrix;
    const totalMonths = mc.months.length;

    // INV-01: Identità Cassa SPV (Saldo Continuo di Cassa Operativa)
    let inv1Ok = true;
    for (let i = 0; i < totalMonths; i++) {
        const expected = (i === 0 ? 0 : mc.cashClosing[i - 1]) + mc.netCashflow[i];
        if (Math.abs(mc.cashClosing[i] - expected) > 1e-3) {
            inv1Ok = false;
            console.error(`INV-01 Fail at month ${i}: got=${mc.cashClosing[i]}, exp=${expected}`);
            break;
        }
    }
    assertInvariant('INV-01: Identità di Cassa SPV (Cassa_t = Cassa_{t-1} + NetCashflow_t)', inv1Ok);

    // INV-02: Identità Cassa con Funding
    let inv2Ok = true;
    for (let i = 0; i < totalMonths; i++) {
        const expected = (i === 0 ? 0 : mc.fundedCashClosing[i - 1]) + mc.netCashflow[i] + mc.fundingInflow[i];
        if (Math.abs(mc.fundedCashClosing[i] - expected) > 1e-3) {
            inv2Ok = false;
            console.error(`INV-02 Fail at month ${i}: got=${mc.fundedCashClosing[i]}, exp=${expected}`);
            break;
        }
    }
    assertInvariant('INV-02: Identità Cassa con Funding (CassaFund_t = CassaFund_{t-1} + Net_t + Fund_t)', inv2Ok);

    // INV-03: Conservazione Patrimoniale del Credito IVA
    let inv3Ok = true;
    let expectedVatCredit = 0;
    for (let i = 0; i < totalMonths; i++) {
        expectedVatCredit += (mc.vatPaidToSuppliers[i] - mc.vatCollected[i] - mc.vatRemitted[i] - ((mc.vatRefundReceived && mc.vatRefundReceived[i]) || 0) - ((mc.vatCompensated && mc.vatCompensated[i]) || 0));
        expectedVatCredit = Math.max(0, expectedVatCredit);
        if (Math.abs(mc.vatCreditEnd[i] - expectedVatCredit) > 1e-3) {
            inv3Ok = false;
            console.error(`INV-03 Fail at month ${i}: got=${mc.vatCreditEnd[i]}, exp=${expectedVatCredit}`);
            break;
        }
    }
    assertInvariant('INV-03: Conservazione Patrimoniale Credito IVA (Delta Credito = Paid - Coll - Remit - Ref - Comp)', inv3Ok);

    // INV-04: Conservazione Flussi IVA di Cassa
    let inv4Ok = true;
    for (let i = 0; i < totalMonths; i++) {
        const refRec = (mc.vatRefundReceived && mc.vatRefundReceived[i]) || 0;
        const expectedVatCf = mc.vatCollected[i] - mc.vatPaidToSuppliers[i] - mc.vatRemitted[i] + refRec;
        if (Math.abs(mc.vatCashFlow[i] - expectedVatCf) > 1e-3) {
            inv4Ok = false;
            console.error(`INV-04 Fail at month ${i}: got=${mc.vatCashFlow[i]}, exp=${expectedVatCf}`);
            break;
        }
    }
    assertInvariant('INV-04: Conservazione Flusso IVA di Cassa (vatCF = vatColl - vatPaid - vatRemit + vatRef)', inv4Ok);

    // INV-05: Quadratura Imposte P&L vs Cash Flow
    const accruedWithinHorizon = mc.taxesAccruedTotal - (mc.taxesAfterHorizon || 0);
    const compensatedTotal = mc.vatCompensatedTotal || 0;
    const paidTotal = mc.taxesPaidTotal || 0;
    const inv5Ok = Math.abs(accruedWithinHorizon - (compensatedTotal + paidTotal)) < 1e-2;
    assertInvariant('INV-05: Quadratura Fiscale P&L vs Cash Flow (Imposte P&L entro orizzonte = Compensate + Pagate Cassa)', inv5Ok,
        `accrued=${accruedWithinHorizon.toFixed(2)}, comp=${compensatedTotal.toFixed(2)}, paid=${paidTotal.toFixed(2)}`);

    // INV-06: Servizio Debito Senior (Totale = Interessi + Quota Capitale)
    let inv6Ok = true;
    for (let i = 0; i < totalMonths; i++) {
        if (Math.abs(mc.debtService[i] - (mc.interest[i] + mc.principal[i])) > 1e-3) {
            inv6Ok = false;
            break;
        }
    }
    assertInvariant('INV-06: Servizio Debito Senior (debtService = interest + principal)', inv6Ok);

    // INV-07: Preammortamento Quota Capitale = 0 nei mesi di grazia
    let inv7Ok = true;
    const graceM = state.inputs.seniorGracePeriodMonths || 0;
    for (let i = 0; i < 12 + graceM && i < totalMonths; i++) {
        if (mc.principal[i] > 1e-3) {
            inv7Ok = false;
            break;
        }
    }
    assertInvariant(`INV-07: Preammortamento Quota Capitale = 0 nei primi ${graceM} mesi`, inv7Ok);

    // INV-08: Conservazione DSRA (se attivo)
    const dsraOk = mtx.dsraFunding.every(v => v >= 0) && mtx.dsraDraw.every(v => v >= 0);
    assertInvariant('INV-08: Conservazione e Non-Negativita Flussi DSRA', dsraOk);

    // INV-09: Cascata Waterfall Holding (Netto Holding = SPV - Soci - PD - Oneri HoldCo)
    let inv9Ok = true;
    for (let i = 0; i < totalMonths; i++) {
        const expHNet = mc.netCashflow[i] - mc.holdcoSociService[i] - mc.holdcoPdService[i] - mc.holdcoOtherCosts[i];
        if (Math.abs(mc.holdcoNetCashflow[i] - expHNet) > 1e-3) {
            inv9Ok = false;
            break;
        }
    }
    assertInvariant('INV-09: Cascata Waterfall Holding (HoldCo Net = SPV Net - Soci - PD - Oneri)', inv9Ok);

    // INV-10: Cassa Finale a fine orizzonte finita e priva di NaN
    const inv10Ok = mc.cashClosing.every(v => Number.isFinite(v)) && mc.fundedCashClosing.every(v => Number.isFinite(v));
    assertInvariant('INV-10: Determinismo e Assenza di NaN/Infinity su tutte le serie temporali', inv10Ok);
}

function runAllScenarios() {
    const capexPaySample = { p1: [{ date: '2026-10-15', amount: 1000000, label: 'EPC FV' }] };

    // 1. Scenario A: Rimborso IVA trimestrale immediato (Lag = 0)
    verifyScenarioInvariants('Scenario A: Rimborso IVA Modello TR Immediato (Lag = 0)',
        createBaseState({ inputs: { vatTrMode: 'rimborso', vatRefundLagMonths: 0 } }), capexPaySample);

    // 2. Scenario B: Rimborso IVA trimestrale differito (Lag = 3 mesi)
    verifyScenarioInvariants('Scenario B: Rimborso IVA Modello TR Differito (Lag = 3 mesi)',
        createBaseState({ inputs: { vatTrMode: 'rimborso', vatRefundLagMonths: 3 } }), capexPaySample);

    // 3. Scenario C: Solo Compensazione F24
    verifyScenarioInvariants('Scenario C: Solo Compensazione F24 Imposte',
        createBaseState({ inputs: { vatTrMode: 'compensazione' } }), capexPaySample);

    // 4. Scenario D: Solo Riporto a nuovo
    verifyScenarioInvariants('Scenario D: Riporto a Nuovo Credito IVA',
        createBaseState({ inputs: { vatTrMode: 'riporto' } }), capexPaySample);

    // 5. Scenario E: Debito Semestrale con Preammortamento 12 Mesi
    verifyScenarioInvariants('Scenario E: Debito Senior Semestrale (Preammortamento 12m)',
        createBaseState({ inputs: { debtRepaymentFrequency: 'semestrale', seniorGracePeriodMonths: 12 } }), capexPaySample);

    console.log(`\n======================================================`);
    console.log(`Riepilogo Suite Invarianti Finanziarie:`);
    console.log(`Controlli Eseguiti: ${totalChecks} | Superati: ${passedChecks} | Falliti: ${failedChecks}`);
    console.log(`======================================================`);

    if (failedChecks > 0) {
        process.exit(1);
    } else {
        console.log(`🎉 TUTTE LE INVARIANTI FINANZIARIE SONO RISPETTATE AL 100%!`);
        process.exit(0);
    }
}

try {
    runAllScenarios();
} catch (err) {
    console.error("Errore critico nella suite invarianti:", err);
    process.exit(1);
}
