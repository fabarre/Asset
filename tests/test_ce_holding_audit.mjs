import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function runCeHoldingAudit(pdConfig = { pdEnabled: false }) {
    console.log(`\n=== AUDIT CONTO ECONOMICO HOLDING: P&L vs EXCEL (pdEnabled: ${pdConfig.pdEnabled}) ===\n`);

    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const excelExportPath = '/home/ubuntu/Asset/src/excelExport.js';

    const workerCode = fs.readFileSync(workerPath, 'utf8');
    let lastMsg = null;
    const sbW = {
        self: { postMessage: (m) => { lastMsg = m; } },
        console, structuredClone: global.structuredClone,
        Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
        Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
    };
    vm.createContext(sbW);
    vm.runInContext(workerCode, sbW);

    const p1Base = sbW.generateDefaultSolarProfile(4.14068, 1631.11);
    const p2Base = sbW.generateDefaultSolarProfile(4.04552, 1631.11);

    const plants = [
        {
            id: 'plant-guasticce', name: 'Guasticce (kW)', capacity: 4140.68, capex: 614.9654,
            connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820,
            cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p1Base,
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR',
            earnoutVal: 2, earnoutType: 'rid_pct', earnoutYears: 5
        },
        {
            id: 'plant-castenaso', name: 'Castenaso (kW)', capacity: 4045.52, capex: 609.7752,
            connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687,
            cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p2Base,
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR',
            earnoutVal: 2, earnoutType: 'rid_pct', earnoutYears: 5
        }
    ];

    const inputs = {
        inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
        iresRate: 0.24, irapRate: 0.039, leverage: 0.80, interestRate: 0.045, debtBasis: 'total_capex',
        loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
        sociEquityPct: 100, sociInterestRate: 4.3, sociLoanTerm: 10,
        sociPrincipalGrace: 0, sociInterestGrace: 0,
        distributionPolicy: 'civil_with_capital_reserve_return',
        dividendLock: false,
        exitOption: 'mwp', exitYear: 20,
        ...pdConfig
    };

    const opexEvents = {
        'plant-guasticce': [
            { id: 'ev1', label: 'O&M FV Guasticce', amount: 59735.28, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev2', label: 'Assicurazione Guasticce', amount: 14933.82, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev3', label: 'IMU Guasticce Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
            { id: 'ev4', label: 'IMU Guasticce Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true },
            { id: 'ev5', label: 'Security Guasticce', amount: 3672, month: 7, rule: 'gt_cod', enabled: true }
        ],
        'plant-castenaso': [
            { id: 'ev6', label: 'O&M FV Castenaso', amount: 58364.55, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev7', label: 'Assicurazione Castenaso', amount: 14591.14, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev8', label: 'IMU Castenaso Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
            { id: 'ev9', label: 'IMU Castenaso Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true },
            { id: 'ev10', label: 'Security Castenaso', amount: 3672, month: 7, rule: 'gt_cod', enabled: true }
        ]
    };

    const pY1 = 99.30213531920911;
    const zonal = new Float64Array(8760).fill(pY1);
    const state = {
        inputs, plants, stabilimenti: [], opexEvents,
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
    };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const results = lastMsg.results;
    const m = results.matrix;

    let genBuf = null;
    const mockWindow = {
        State: {
            inputs, plants, stabilimenti: [], opexEvents, results,
            financialModels: { currentModel: { id: 'test' } },
            branding: { company: 'Test Verification' }
        },
        _currentProjectName: 'Test CE Holding Verified',
        document: {
            createElement: () => ({ click: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
        showToast: () => {}
    };
    const exportSandbox = {
        window: mockWindow, document: mockWindow.document,
        ExcelJS, console,
        Blob: class { constructor(parts) { genBuf = parts[0]; } },
        setTimeout: (fn) => fn(), alert: console.log
    };
    vm.createContext(exportSandbox);
    const exportCode = fs.readFileSync(excelExportPath, 'utf8');
    vm.runInContext(exportCode, exportSandbox);

    await exportSandbox.exportPnlToExcel();
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(Buffer.from(genBuf));

    const sCeHc = exportedWorkbook.getWorksheet('CONTO ECONOMICO HOLDING');
    const hfSheets = {};
    exportedWorkbook.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let col = 1; col <= ws.columnCount; col++) {
                const cell = row.getCell(col);
                let val = null;
                let rawF = cell.formula;
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) rawF = cell.value.formula;
                if (rawF) val = rawF.startsWith('=') ? rawF : '=' + rawF;
                else if (cell.value !== undefined && cell.value !== null) val = cell.value;
                rowData.push(val);
            }
            matrix.push(rowData);
        }
        hfSheets[ws.name] = matrix;
    });

    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true });
    const getHf = (s, r, c) => {
        const raw = hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });
        if (typeof raw === 'object' && raw && raw.value !== undefined) return raw.value;
        return raw;
    };

    console.log('\nSheet CONTO ECONOMICO HOLDING Rows:');
    const rowMap = {};
    for (let r = 1; r <= sCeHc.rowCount; r++) {
        const label = sCeHc.getRow(r).getCell(1).value;
        if (label) {
            console.log(`  Row ${String(r).padStart(2)}: ${label}`);
            if (label.includes('RICAVI TOTALI HOLDING')) rowMap.ce_holdcoProductionValue = r;
            else if (label.includes('Gestione Amministrativa & Asset Management a SPV')) rowMap.ce_holdcoAssetManagementReceived = r;
            else if (label.includes('COSTI OPERATIVI (OPEX) TOTALE HOLDING')) rowMap.ce_holdcoProductionCosts = r;
            else if (label.includes('Spese Generali e Costi di Funzionamento Holding')) rowMap.ce_holdcoOpex = r;
            else if (label.includes('Quota Earn-Out Holding')) rowMap.ce_holdcoEarnoutPaid = r;
            else if (label.includes('EBITDA HOLDING')) rowMap.ce_holdcoEbitda = r;
            else if (label.includes('Ammortamento Civilistico') && !label.includes('Ammortamenti Beni')) rowMap.ce_holdcoDepreciation = r;
            else if (label.includes('Ammortamenti Beni Materiali e Immateriali')) rowMap.ce_holdcoDeprDetail = r;
            else if (label.includes('EBIT HOLDING (Risultato Operativo)')) rowMap.ce_holdcoOperatingEbit = r;
            else if (label.includes('Dividendi SPV da Utili')) rowMap.ce_holdcoDividendReceived = r;
            else if (label.includes('Interessi Attivi Finanziamento Soci SPV')) rowMap.ce_holdcoInterestReceived = r;
            else if (label.includes('Interessi Passivi Private Debt Holding')) rowMap.ce_pdInterestPaid = r;
            else if (label.includes('TOTALE PROVENTI E ONERI FINANZIARI (C)')) rowMap.ce_holdcoFinancialNet = r;
            else if (label.includes('EBT — Utile ante Imposte HOLDING')) rowMap.ce_holdcoEbt = r;
            else if (label.includes('Imposta IRES HoldCo')) rowMap.ce_holdcoIresTaxPaid = r;
            else if (label.includes('Imposta IRAP HoldCo')) rowMap.ce_holdcoIrapTaxPaid = r;
            else if (label.includes('Imposte Correnti Holding')) rowMap.ce_holdcoTaxTotal = r;
            else if (label.includes('UTILE NETTO CIVILISTICO HOLDING')) rowMap.ce_holdcoNetProfit = r;
        }
    }

    console.log('\n=== DIAGNOSIS YEAR 1 IRES INPUTS ===');
    const rInt = rowMap.ce_holdcoInterestReceived;
    const rDiv = rowMap.ce_holdcoDividendReceived;
    const rAm = rowMap.ce_holdcoAssetManagementReceived;
    const rOpex = rowMap.ce_holdcoOpex;
    const rIres = rowMap.ce_holdcoIresTaxPaid;
    console.log('HF Interest Y1:', getHf('CONTO ECONOMICO HOLDING', rInt, 3));
    console.log('HF Dividend Y1:', getHf('CONTO ECONOMICO HOLDING', rDiv, 3));
    console.log('HF Asset Mgt Y1:', getHf('CONTO ECONOMICO HOLDING', rAm, 3));
    console.log('HF Opex Y1:', getHf('CONTO ECONOMICO HOLDING', rOpex, 3));
    console.log('HF IRES Y1:', getHf('CONTO ECONOMICO HOLDING', rIres, 3));
    console.log('HF IRES Formula Y1:', sCeHc.getRow(rIres).getCell(3).formula);

    console.log('\nWorker Y1:');
    console.log('Worker Interest Y1:', m.holdcoInterestReceived[1]);
    console.log('Worker Dividend Y1:', m.holdcoDividendReceived[1]);
    console.log('Worker Asset Mgt Y1:', m.opexAssetManagement ? m.opexAssetManagement[1] : 0);
    console.log('Worker Opex Y1:', m.holdcoOpex[1]);
    console.log('Worker IRES Y1:', m.holdcoIresTaxPaid[1]);

    console.log('\n=== DETAILED COMPARISON: WEB APP vs EXCEL ===');
    const rowsToTest = [
        { key: 'ce_holdcoProductionValue', sign: 1 },
        { key: 'ce_holdcoAssetManagementReceived', sign: 1 },
        { key: 'ce_holdcoProductionCosts', sign: -1 },
        { key: 'ce_holdcoOpex', sign: -1 },
        { key: 'ce_holdcoEarnoutPaid', sign: -1 },
        { key: 'ce_holdcoEbitda', sign: 1 },
        { key: 'ce_holdcoDepreciation', sign: -1 },
        { key: 'ce_holdcoDeprDetail', sign: -1 },
        { key: 'ce_holdcoOperatingEbit', sign: 1 },
        { key: 'ce_holdcoDividendReceived', sign: 1 },
        { key: 'ce_holdcoInterestReceived', sign: 1 },
        ...(pdConfig.pdEnabled ? [{ key: 'ce_pdInterestPaid', sign: -1 }] : []),
        { key: 'ce_holdcoFinancialNet', sign: 1 },
        { key: 'ce_holdcoEbt', sign: 1 },
        { key: 'ce_holdcoTaxTotal', sign: -1 },
        { key: 'ce_holdcoIresTaxPaid', sign: -1 },
        { key: 'ce_holdcoIrapTaxPaid', sign: -1 },
        { key: 'ce_holdcoNetProfit', sign: 1 }
    ];

    let passCount = 0;
    let failCount = 0;

    for (const item of rowsToTest) {
        const r = rowMap[item.key];
        if (!r) {
            console.log(`[SKIP/FAIL] Row not mapped for key: ${item.key}`);
            failCount += 21;
            continue;
        }

        let maxDelta = 0;
        let rowPass = true;
        for (let yr = 0; yr <= 20; yr++) {
            const col = yr + 2; // Col 2 is Anno 0, Col 3 is Anno 1, etc.
            const hfVal = getHf('CONTO ECONOMICO HOLDING', r, col);
            
            // Get Web App value exactly as main.js computes it in updateTableData
            let appVal = 0;
            if (item.key === 'ce_holdcoProductionValue') {
                appVal = m.holdcoProductionValue ? m.holdcoProductionValue[yr] : (m.opexAssetManagement ? m.opexAssetManagement[yr] : 0);
            } else if (item.key === 'ce_holdcoAssetManagementReceived') {
                appVal = m.opexAssetManagement ? m.opexAssetManagement[yr] : 0;
            } else if (item.key === 'ce_holdcoProductionCosts') {
                appVal = m.holdcoProductionCosts ? m.holdcoProductionCosts[yr] : (m.holdcoOpex[yr] + m.holdcoEarnoutPaid[yr]);
            } else if (item.key === 'ce_holdcoOpex') {
                appVal = m.holdcoOpex[yr];
            } else if (item.key === 'ce_holdcoEarnoutPaid') {
                appVal = m.holdcoEarnoutPaid[yr];
            } else if (item.key === 'ce_holdcoEbitda') {
                appVal = m.holdcoOperatingEbit ? m.holdcoOperatingEbit[yr] : 0;
            } else if (item.key === 'ce_holdcoDepreciation' || item.key === 'ce_holdcoDeprDetail') {
                appVal = 0;
            } else if (item.key === 'ce_holdcoOperatingEbit') {
                appVal = m.holdcoOperatingEbit ? m.holdcoOperatingEbit[yr] : 0;
            } else if (item.key === 'ce_holdcoDividendReceived') {
                appVal = m.holdcoDividendReceived ? m.holdcoDividendReceived[yr] : 0;
            } else if (item.key === 'ce_holdcoInterestReceived') {
                appVal = m.holdcoInterestReceived ? m.holdcoInterestReceived[yr] : 0;
            } else if (item.key === 'ce_pdInterestPaid') {
                appVal = m.pdInterestPaid ? m.pdInterestPaid[yr] : 0;
            } else if (item.key === 'ce_holdcoFinancialNet') {
                appVal = m.holdcoFinancialNet ? m.holdcoFinancialNet[yr] : 0;
            } else if (item.key === 'ce_holdcoEbt') {
                appVal = m.holdcoEbt ? m.holdcoEbt[yr] : 0;
            } else if (item.key === 'ce_holdcoTaxTotal') {
                appVal = m.holdcoTaxTotal ? m.holdcoTaxTotal[yr] : (m.holdcoIresTaxPaid[yr] + (m.holdcoIrapTaxPaid ? m.holdcoIrapTaxPaid[yr] : 0));
            } else if (item.key === 'ce_holdcoIresTaxPaid') {
                appVal = m.holdcoIresTaxPaid[yr];
            } else if (item.key === 'ce_holdcoIrapTaxPaid') {
                appVal = m.holdcoIrapTaxPaid ? m.holdcoIrapTaxPaid[yr] : 0;
            } else if (item.key === 'ce_holdcoNetProfit') {
                appVal = m.holdcoNetProfit[yr];
            }

            const expectedHfVal = item.sign * appVal;
            const delta = Math.abs(hfVal - expectedHfVal);
            if (delta > maxDelta) maxDelta = delta;

            const relDelta = Math.abs(expectedHfVal) > 1 ? delta / Math.abs(expectedHfVal) : delta;
            if (delta > 5.0 && relDelta > 0.001) {
                rowPass = false;
                failCount++;
                console.log(`  [FAIL] ${item.key} Y${yr}: HF=${hfVal.toFixed(2)}, App=${appVal.toFixed(2)}, Expected=${expectedHfVal.toFixed(2)}, Delta=${delta.toFixed(2)}`);
            } else {
                passCount++;
            }
        }
        if (rowPass) {
            console.log(`  [OK] ${item.key.padEnd(35)}: 21/21 passed (max delta: ${maxDelta.toFixed(4)} €)`);
        }
    }

    console.log(`\nOverall Summary (pdEnabled: ${pdConfig.pdEnabled}): ${passCount} passed, ${failCount} failed.`);
    return { passCount, failCount };
}

async function runAll() {
    const res1 = await runCeHoldingAudit({ pdEnabled: false });
    const res2 = await runCeHoldingAudit({
        pdEnabled: true,
        pdAmount: 500000,
        pdRate: 0.06,
        pdTerm: 5,
        pdMode: 'annual_interest',
        pdTaxDeductible: true
    });

    console.log('\n========================================');
    console.log(`FINAL RESULTS:`);
    console.log(`Scenario 1 (Standard): ${res1.passCount} passed, ${res1.failCount} failed`);
    console.log(`Scenario 2 (Private Debt): ${res2.passCount} passed, ${res2.failCount} failed`);
    console.log('========================================');
}

runAll().catch(console.error);
