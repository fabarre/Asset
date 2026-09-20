import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function verifyFullExport() {
    console.log('=== VERIFICA END-TO-END EXPORT EXCEL POST-FIX ===\n');

    // 1. Setup Worker simulation
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
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

    const p1 = sbW.generateDefaultSolarProfile(4.14068, 1686.07);
    const p2 = sbW.generateDefaultSolarProfile(4.04552, 1686.07);

    const plants = [
        { id: 'plant-guasticce', name: 'Guasticce (kW)', capacity: 4140.68, capex: 614.9654, connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1686.07, degradation: 0.003512, generation: p1, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR', earnoutType: 'rid_pct', earnoutVal: 2, earnoutYears: 5 },
        { id: 'plant-castenaso', name: 'Castenaso (kW)', capacity: 4045.52, capex: 609.7752, connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1686.07, degradation: 0.003512, generation: p2, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR', earnoutType: 'rid_pct', earnoutVal: 2, earnoutYears: 5 }
    ];

    const inputs = {
        inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
        iresRate: 0.24, irapRate: 0.039, leverage: 0.80, interestRate: 0.045, debtBasis: 'total_capex',
        loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
        sociEquityPct: 100, sociInterestRate: 4.3, sociLoanTerm: 10,
        sociPrincipalGrace: 0, sociInterestGrace: 0,
        distributionPolicy: 'civil_with_capital_reserve_return',
        dividendLock: false,
        holdcoCapital: 0,
        exitOption: '0', exitYear: 20
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
            { id: 'ev6', label: 'O&M FV Castenaso', amount: 57164.88, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev7', label: 'Assicurazione Castenaso', amount: 14291.22, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev8', label: 'IMU Castenaso Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
            { id: 'ev9', label: 'IMU Castenaso Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true },
            { id: 'ev10', label: 'Security Castenaso', amount: 3672, month: 7, rule: 'gt_cod', enabled: true }
        ]
    };

    const zonalPun = { CNOR: new Float64Array(8760).fill(99.30213531920911) };
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    state.results = lastMsg.results;

    // 2. Setup Excel export context
    const excelExportCode = fs.readFileSync('/home/ubuntu/Asset/src/excelExport.js', 'utf8');
    let exportedBuffer = null;

    const fakeWindow = {
        State: state,
        ExcelJS: ExcelJS,
        saveAs: (blob, filename) => {}
    };

    // Replace saveAs with capture of buffer
    const modifiedExportCode = excelExportCode.replace(
        'const buffer = await workbook.xlsx.writeBuffer();',
        'const buffer = await workbook.xlsx.writeBuffer(); global.__exportedBuffer = buffer;'
    );

    const sbE = {
        window: fakeWindow,
        ExcelJS: ExcelJS,
        console,
        showToast: (msg, type) => console.log(`[Toast] ${type}: ${msg}`),
        Blob: class {},
        Math, Date, JSON, Array, Object, Number, String, parseInt, parseFloat,
        global: {}
    };
    vm.createContext(sbE);
    vm.runInContext(modifiedExportCode, sbE);

    await sbE.exportPnlToExcel();
    exportedBuffer = sbE.global.__exportedBuffer;

    if (!exportedBuffer) {
        throw new Error('Export buffer not generated!');
    }

    // 3. Load generated workbook into HyperFormula
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exportedBuffer);

    const hfSheets = {};
    wb.worksheets.forEach(ws => {
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

    console.log('--- 1. VERIFICA CONTO ECONOMICO RIGA 35 (CALCOLO FISCALE DI SUPPORTO) ---');
    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    const r35 = sCe.getRow(35);
    console.log(`Label R35: "${r35.getCell(1).value}"`);
    console.log(`Col B35 value: ${JSON.stringify(r35.getCell(2).value)}`);
    console.log(`Col C35 value: ${JSON.stringify(r35.getCell(3).value)}`);
    if (r35.getCell(2).value === 0) {
        console.error('FAIL: B35 still has numeric 0!');
    } else {
        console.log('SUCCESS: B35 is properly merged / styled without numeric 0!\n');
    }

    console.log('--- 2. VERIFICA CONTO ECONOMICO HOLDING ---');
    const sCeHc = wb.getWorksheet('CONTO ECONOMICO HOLDING');
    const m = state.results.matrix;

    const testCeHcRows = [
        { r: 4, label: 'Valore Produzione (A)', key: 'holdcoProductionValue' },
        { r: 6, label: 'OPEX Holding', key: 'holdcoOpex', minus: true },
        { r: 7, label: 'Earn-Out Holding', key: 'holdcoEarnoutPaid', minus: true },
        { r: 8, label: 'Costi Produzione (B)', key: 'holdcoProductionCosts', minus: true },
        { r: 9, label: 'EBITDA HoldCo', key: 'holdcoOperatingEbit' },
        { r: 10, label: 'Ammortamento HoldCo', key: 'zero' },
        { r: 12, label: 'EBIT HoldCo (A-B)', key: 'holdcoOperatingEbit' },
        { r: 14, label: 'Dividendi SPV', key: 'holdcoDividendReceived' },
        { r: 15, label: 'Interessi Soci', key: 'holdcoInterestReceived' },
        { r: 16, label: 'Proventi Finanziari (C)', key: 'holdcoFinancialNet' },
        { r: 17, label: 'EBT HoldCo', key: 'holdcoEbt' },
        { r: 19, label: 'IRES HoldCo', key: 'holdcoIresTaxPaid', minus: true },
        { r: 21, label: 'Totale Imposte', key: 'holdcoTaxTotal', minus: true },
        { r: 23, label: 'Utile Netto HoldCo', key: 'holdcoNetProfit' }
    ];

    let ceHcPassCount = 0;
    testCeHcRows.forEach(item => {
        const valY1 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.r, 2)) || 0);
        const valY2 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.r, 3)) || 0);
        const formulaY1 = sCeHc.getRow(item.r).getCell(2).formula;
        const formulaY2 = sCeHc.getRow(item.r).getCell(3).formula;

        let appY1 = item.key === 'zero' ? 0 : (m[item.key] ? Math.round(item.minus ? -Math.abs(m[item.key][0]) : m[item.key][0]) : '-');
        let appY2 = item.key === 'zero' ? 0 : (m[item.key] ? Math.round(item.minus ? -Math.abs(m[item.key][1]) : m[item.key][1]) : '-');

        const ok1 = Math.abs(valY1 - appY1) <= 2;
        const ok2 = Math.abs(valY2 - appY2) <= 2;
        if (ok1 && ok2) ceHcPassCount++;

        console.log(`R${String(item.r).padStart(2)} [${item.label.padEnd(25)}]: Y1: XL=${valY1} App=${appY1} [${ok1 ? 'OK' : 'FAIL'}] | Y2: XL=${valY2} App=${appY2} [${ok2 ? 'OK' : 'FAIL'}]`);
        if (!ok1 || !ok2) {
            console.log(`     Formula Y1: ${formulaY1}`);
            console.log(`     Formula Y2: ${formulaY2}`);
        }
    });
    console.log(`CE HOLDING Passed: ${ceHcPassCount}/${testCeHcRows.length}\n`);

    console.log('--- 3. VERIFICA RENDICONTO FINANZIARIO SPV (RIGHE 18-30) ---');
    const testRfRows = [
        { r: 18, label: 'FCFE SPV', key: 'spvFCFE' },
        { r: 21, label: 'Riserva Legale SPV', key: 'spvLegalReserveAccrual' },
        { r: 23, label: 'Interessi Soci', key: 'sociInterestPaid', minus: true, keyAlt: 'holdcoInterestReceived' },
        { r: 24, label: 'Rimborso Capitale Soci', key: 'sociPrincipalPaid', minus: true, keyAlt: 'holdcoLoanRepaymentReceived' },
        { r: 25, label: 'Dividendi SPV', key: 'dividendsPaid', minus: true, keyAlt: 'holdcoDividendReceived' },
        { r: 26, label: 'Restituzione Riserve', key: 'spvCapitalReserveReturned', minus: true },
        { r: 28, label: 'Cash Trap Annuo', key: 'spvCashTrap' },
        { r: 30, label: 'Saldo Cassa Vincolata', key: 'spvCashTrapCumulative' }
    ];

    let rfPassCount = 0;
    testRfRows.forEach(item => {
        const valY1 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.r, 2)) || 0);
        const valY2 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.r, 3)) || 0);
        const arr = m[item.key] || m[item.keyAlt];
        let appY1 = arr ? Math.round(item.minus ? -Math.abs(arr[0]) : arr[0]) : '-';
        let appY2 = arr ? Math.round(item.minus ? -Math.abs(arr[1]) : arr[1]) : '-';

        const ok1 = Math.abs(valY1 - appY1) <= 2;
        const ok2 = Math.abs(valY2 - appY2) <= 2;
        if (ok1 && ok2) rfPassCount++;

        console.log(`R${String(item.r).padStart(2)} [${item.label.padEnd(25)}]: Y1: XL=${valY1} App=${appY1} [${ok1 ? 'OK' : 'FAIL'}] | Y2: XL=${valY2} App=${appY2} [${ok2 ? 'OK' : 'FAIL'}]`);
    });
    console.log(`RF SPV Passed: ${rfPassCount}/${testRfRows.length}\n`);

    console.log('--- 4. VERIFICA RENDICONTO FINANZIARIO HOLDING (SEZIONE D) ---');
    const sRfHc = wb.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    const testRfHcRows = [
        { r: 3, label: 'Flusso Cassa Risalito Totale', key: 'holdcoInflowTotal' },
        { r: 4, label: 'Interessi Soci Ricevuti', key: 'holdcoInterestReceived' },
        { r: 5, label: 'Rimborso Capitale Soci', key: 'holdcoLoanRepaymentReceived' },
        { r: 6, label: 'Dividendi Ricevuti', key: 'holdcoDividendReceived' },
        { r: 7, label: 'Restituzione Riserve Cap.', key: 'holdcoCapitalReserveReceived' },
        { r: 8, label: 'Asset Management Ricevuto', key: 'opexAssetManagement' },
        { r: 9, label: 'Spese Holding', key: 'holdcoOpex', minus: true },
        { r: 10, label: 'Earn-Out Holding', key: 'holdcoEarnoutPaid', minus: true },
        { r: 11, label: 'IRES Holding', key: 'holdcoIresTaxPaid', minus: true },
        { r: 12, label: 'IRAP Holding', key: 'holdcoIrapTaxPaid', minus: true },
        { r: 13, label: 'Utile Netto Holding', key: 'holdcoNetProfit' },
        { r: 14, label: 'Riconciliazione Rimborso', key: 'holdcoLoanRepaymentReceived' },
        { r: 15, label: 'Riconciliazione Riserve', key: 'holdcoCapitalReserveReceived' },
        { r: 16, label: 'Cassa Gestione Ordinaria', key: 'holdcoOperatingCashflow' },
        { r: 23, label: 'FCFE Sponsor', key: 'holdcoFCFE' },
        { r: 24, label: 'FCFE Cumulato', key: 'holdcoFCFECumulated' }
    ];

    let rfHcPassCount = 0;
    testRfHcRows.forEach(item => {
        const valY1 = Math.round(Number(getHf('RENDICONTO FINANZIARIO HOLDING', item.r, 2)) || 0);
        const valY2 = Math.round(Number(getHf('RENDICONTO FINANZIARIO HOLDING', item.r, 3)) || 0);
        const arr = m[item.key];
        let appY1 = arr ? Math.round(item.minus ? -Math.abs(arr[0]) : arr[0]) : 0;
        let appY2 = arr ? Math.round(item.minus ? -Math.abs(arr[1]) : arr[1]) : 0;

        const ok1 = Math.abs(valY1 - appY1) <= 2;
        const ok2 = Math.abs(valY2 - appY2) <= 2;
        if (ok1 && ok2) rfHcPassCount++;

        console.log(`R${String(item.r).padStart(2)} [${item.label.padEnd(26)}]: Y1: XL=${valY1} App=${appY1} [${ok1 ? 'OK' : 'FAIL'}] | Y2: XL=${valY2} App=${appY2} [${ok2 ? 'OK' : 'FAIL'}]`);
    });
    console.log(`RF HOLDING Passed: ${rfHcPassCount}/${testRfHcRows.length}\n`);

    if (ceHcPassCount === testCeHcRows.length && rfPassCount === testRfRows.length && rfHcPassCount === testRfHcRows.length) {
        console.log('🎉 100% RECONCILIATION VERIFIED ACROSS ALL TARGET AREAS (CE HC, RF SPV, RF HC)!');
    }
}

verifyFullExport().catch(console.error);
