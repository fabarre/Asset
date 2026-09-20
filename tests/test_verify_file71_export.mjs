import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function verifyFile71Export() {
    console.log('=== VERIFICA COMPLETA EXPORT CONTO ECONOMICO POST-FIX FILE 71 ===\n');

    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const excelExportPath = '/home/ubuntu/Asset/src/excelExport.js';

    // 1. Worker Setup
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
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        },
        {
            id: 'plant-castenaso', name: 'Castenaso (kW)', capacity: 4045.52, capex: 609.7752,
            connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687,
            cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p2Base,
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        }
    ];

    const inputs = {
        inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
        iresRate: 0.24, irapRate: 0.039, leverage: 0.80, interestRate: 0.045, debtBasis: 'total_capex',
        loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
        sociEquityPct: 100, sociInterestRate: 4.3, sociLoanTerm: 10,
        sociPrincipalGrace: 0, sociInterestGrace: 0,
        distributionPolicy: 'civil_with_capital_reserve_return',
        exitOption: 'mwp', exitYear: 20
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

    const pY1 = 99.30213531920911;
    const zonal = new Float64Array(8760).fill(pY1);
    const state = {
        inputs, plants, stabilimenti: [], opexEvents,
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
    };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const workerRes = lastMsg.results;
    const m = workerRes.matrix;

    // 2. Excel Export execution
    let genBuf = null;
    const winMock = {
        State: {
            inputs: state.inputs,
            plants: state.plants,
            stabilimenti: state.stabilimenti,
            opexEvents: state.opexEvents,
            results: workerRes,
            branding: { company: 'Test Verification File 71' }
        },
        _currentProjectName: 'Test File 71 Verified',
        document: {
            createElement: () => ({ click: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
        showToast: () => {}
    };

    const excelCode = fs.readFileSync(excelExportPath, 'utf8');
    const sbE = {
        window: winMock, ExcelJS, console,
        Blob: class { constructor(parts) { genBuf = parts[0]; } },
        setTimeout: (fn) => fn(),
        document: winMock.document
    };
    vm.createContext(sbE);
    vm.runInContext(excelCode, sbE);

    await sbE.exportPnlToExcel();
    const testOutputPath = '/home/ubuntu/Asset/tests/test_output_file71_verified.xlsx';
    fs.writeFileSync(testOutputPath, Buffer.from(genBuf));
    console.log(`Workbook esportato con successo in ${testOutputPath} (${genBuf.length} bytes)\n`);

    // 3. HyperFormula Evaluation
    const wbNew = new ExcelJS.Workbook();
    await wbNew.xlsx.readFile(testOutputPath);

    const hfSheets = {};
    wbNew.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let c = 1; c <= ws.columnCount; c++) {
                const cell = row.getCell(c);
                let val = null;
                if (cell.formula) {
                    val = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
                } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    val = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
                } else if (cell.value !== undefined && cell.value !== null) {
                    val = cell.value;
                }
                rowData.push(val);
            }
            matrix.push(rowData);
        }
        hfSheets[ws.name] = matrix;
    });

    const hf = HyperFormula.buildFromSheets(hfSheets, {
        licenseKey: 'gpl-v3', useColumnIndex: true, precisionRounding: 6
    });
    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    // 4. Detailed audit of CONTO ECONOMICO
    const sCe = wbNew.getWorksheet('CONTO ECONOMICO');
    const rowsToTest = [
        { label: 'RICAVI TOTALI SPV', key: 'revenueTotal' },
        { label: 'COSTI OPERATIVI (OPEX) TOTALE SPV', key: 'opexTotal', minus: true },
        { label: 'MARGINE OPERATIVO LORDO (EBITDA)', key: 'ebitda' },
        { label: '(-) Ammortamento Civilistico', key: 'depreciationCivil', minus: true },
        { label: 'di cui: Ammortamento Impianti Solari', key: 'depreciationCivilSolar', minus: true },
        { label: 'di cui: Ammortamento Altri Costi Capitalizzati', key: 'depreciationCivilOther', minus: true },
        { label: 'EBIT SPV (Risultato Operativo)', key: 'ebit' },
        { label: 'Interessi Passivi Mutuo Bancario', key: 'interest', minus: true },
        { label: 'Interessi Finanziamento Soci (Accrual)', key: 'sociInterestAccrued', minus: true },
        { label: 'EBT — Utile ante Imposte SPV', key: 'ebt' },
        { label: 'Imponibile IRES Lordo', key: 'taxTaxableIres' },
        { label: 'Imponibile IRES Netto - post NOL', key: 'taxTaxableFinal' },
        { label: 'Base Imponibile IRAP', key: 'taxableIrap' },
        { label: '(-) Imposte Correnti SPV', key: 'currentTaxesSpv', minus: true },
        { label: 'di cui: IRES', key: 'iresTaxSpv' },
        { label: 'di cui: IRAP', key: 'irapTaxSpv' },
        { label: 'Variazione Imposte Differite', key: 'deferredTaxes' },
        { label: 'UTILE NETTO CIVILISTICO SPV', key: 'netProfitSpv' }
    ];

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = [];

    rowsToTest.forEach(item => {
        let matchedRowIndex = null;
        sCe.eachRow((r, rNum) => {
            const cellVal = String(r.getCell(1).value || '');
            if (cellVal.includes(item.label)) {
                matchedRowIndex = rNum;
            }
        });

        if (!matchedRowIndex) {
            console.error(`❌ Riga non trovata per label: "${item.label}"`);
            return;
        }

        const appArray = m[item.key] || [];
        let rowMismatches = 0;

        for (let yr = 1; yr <= 20; yr++) {
            totalTests++;
            const col = yr + 1;
            const xlValRaw = getHf('CONTO ECONOMICO', matchedRowIndex, col);
            const xlVal = Math.round(Number(xlValRaw) || 0);

            let appVal = appArray[yr - 1] || 0;
            if (item.minus) appVal = -Math.abs(appVal);
            appVal = Math.round(appVal);

            const diff = Math.abs(xlVal - appVal);
            if (diff <= 2) {
                passedTests++;
            } else {
                rowMismatches++;
                failedTests.push({
                    row: matchedRowIndex,
                    label: item.label,
                    year: yr,
                    excelVal: xlVal,
                    appVal: appVal,
                    diff: xlVal - appVal
                });
            }
        }

        const status = rowMismatches === 0 ? '✅ 20/20 anni perfetti' : `❌ ${rowMismatches}/20 anni discordanti`;
        const y1Val = Math.round(getHf('CONTO ECONOMICO', matchedRowIndex, 2)).toLocaleString('it-IT');
        const y2Val = Math.round(getHf('CONTO ECONOMICO', matchedRowIndex, 3)).toLocaleString('it-IT');
        const y12Val = Math.round(getHf('CONTO ECONOMICO', matchedRowIndex, 13)).toLocaleString('it-IT');
        console.log(`R${String(matchedRowIndex).padStart(2)} [${item.label.padEnd(42)}] -> ${status} (Y1=${y1Val} €, Y2=${y2Val} €, Y12=${y12Val} €)`);
    });

    console.log(`\n===============================================================`);
    console.log(`ESITO FINALE VERIFICA CONTO ECONOMICO:`);
    console.log(`Test Totali Superati: ${passedTests} / ${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
    if (failedTests.length > 0) {
        console.log(`Dettaglio discrepanze (${failedTests.length}):`);
        failedTests.slice(0, 10).forEach(f => {
            console.log(`   - R${f.row} [${f.label}] Anno ${f.year}: Excel=${f.excelVal} € vs App=${f.appVal} € (Δ = ${f.diff} €)`);
        });
        if (failedTests.length > 10) console.log(`   ... e altri ${failedTests.length - 10} anni`);
    } else {
        console.log('🎉 TUTTE LE CELLE E FORMULE DEL CONTO ECONOMICO QUADRANO AL 100% CON LA WEB APP!');
    }
    console.log(`===============================================================`);
}

verifyFile71Export().catch(console.error);
