import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function runTest() {
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    let excelCode = fs.readFileSync('/home/ubuntu/Asset/src/excelExport.js', 'utf8');

    const workerCode = fs.readFileSync(workerPath, 'utf8');
    let lastMsg = null;
    const sbW = { self: { postMessage: (m) => { lastMsg = m; } }, console, structuredClone: global.structuredClone, Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String, Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN };
    vm.createContext(sbW);
    vm.runInContext(workerCode, sbW);

    const p1Base = sbW.generateDefaultSolarProfile(4.14068, 1631.11);
    const p2Base = sbW.generateDefaultSolarProfile(4.04552, 1631.11);
    const plants = [
        { id: 'plant-guasticce', name: 'Guasticce', capacity: 4140.68, capex: 614.9654, connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p1Base, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' },
        { id: 'plant-castenaso', name: 'Castenaso', capacity: 4045.52, capex: 609.7752, connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p2Base, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' }
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
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun: { CNOR: zonal } };
    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const workerRes = lastMsg.results;
    const m = workerRes.matrix;

    // Sostituiamo il blocco addRowDebt('principalScheduled') con la formula corretta
    const oldBlockStart = excelCode.indexOf("addRowDebt('principalScheduled'");
    const oldBlockEnd = excelCode.indexOf("addRowDebt('principalVoluntary'");

    const newBlock = `addRowDebt('principalScheduled', '(-) Quota Capitale Programmata (€)', 'minus', d.principalScheduled, numberFormatEuro, (col, yearIdx) => {
        const yearNum = yearIdx + 1;
        const maturity = \`FINANZA!$B$\${rowMapFin['activeMaturity']}\`;
        const sculpt = \`FINANZA!$B$\${rowMapFin['sculptingEnabled']}="Sì"\`;
        const target = \`FINANZA!$B$\${rowMapFin['targetDscr']}\`;
        const cfads = \`'RENDICONTO FINANZIARIO SPV'!\${col}\${rowMapRf['cfads']}\`;
        const begin = \`\${col}\${rowMapDebt['beginningBalance']}\`;
        const annuity = \`\${col}\${rowMapDebt['activeAnnuity']}\`;
        const rate = \`\${col}\${rowMapDebt.activeRate}\`;
        const intF = \`-\${col}\${rowMapDebt['interestAccrued']}\`;

        const dt = yearNum === 1 ? \`FINANZA!$B$\${rowMapFin['y1OperatingAvail']}\` : '1';
        const timeElapsed = yearNum === 1 ? \`(FINANZA!$B$\${rowMapFin['constructionMonths']}/12)\` : \`(FINANZA!$B$\${rowMapFin['constructionMonths']}/12+FINANZA!$B$\${rowMapFin['y1OperatingAvail']}+\${yearNum - 2})\`;
        const graceInYr = \`MAX(0, MIN(\${dt}, FINANZA!$B$\${rowMapFin['graceCappedYears']}-\${timeElapsed}))\`;
        const amortInYr = \`(\${dt}-\${graceInYr})\`;
        const baseAmort = \`MIN(\${begin}, MAX(0, (\${annuity}-\${begin}*\${rate})*\${amortInYr}))\`;
        const sculptBranch = \`IF(\${yearNum}=\${maturity}, MAX(0, \${begin}), MIN(MAX(0, \${begin}), MAX(0, \${cfads}/\${target}-\${intF})))\`;
        return \`-IF(\${yearNum} > \${maturity}, 0, IF(\${sculpt}, \${sculptBranch}, \${baseAmort}))\`;
    });\n    `;

    excelCode = excelCode.substring(0, oldBlockStart) + newBlock + excelCode.substring(oldBlockEnd);

    let genBuf = null;
    const winMock = {
        State: { inputs: state.inputs, plants: state.plants, stabilimenti: state.stabilimenti, opexEvents: state.opexEvents, results: workerRes, branding: { company: 'Test' } },
        _currentProjectName: 'Test', document: { createElement: () => ({ click: () => {} }), body: { appendChild: () => {}, removeChild: () => {} } },
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }, showToast: () => {}
    };
    const sbE = { window: winMock, ExcelJS, console, Blob: class { constructor(parts) { genBuf = parts[0]; } }, setTimeout: (fn) => fn(), document: winMock.document };
    vm.createContext(sbE);
    vm.runInContext(excelCode, sbE);
    await sbE.exportPnlToExcel();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(genBuf);

    const hfSheets = {};
    wb.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let c = 1; c <= ws.columnCount; c++) {
                const cell = row.getCell(c);
                let val = null;
                if (cell.formula) val = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
                else if (cell.value && typeof cell.value === 'object' && cell.value.formula) val = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
                else if (cell.value !== undefined && cell.value !== null) val = cell.value;
                rowData.push(val);
            }
            matrix.push(rowData);
        }
        hfSheets[ws.name] = matrix;
    });

    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true, precisionRounding: 6 });
    const getHf = (s, r, c) => hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });

    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    console.log('=== ESITO VERIFICA DOPO IL FIX COMPLETO ===');
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

    let totalTests = 0, passedTests = 0;
    rowsToTest.forEach(item => {
        let matchedRowIndex = null;
        sCe.eachRow((r, rNum) => {
            const cellVal = String(r.getCell(1).value || '');
            if (cellVal.includes(item.label)) matchedRowIndex = rNum;
        });

        const appArray = m[item.key] || [];
        let rowMismatches = 0;
        for (let yr = 1; yr <= 20; yr++) {
            totalTests++;
            const col = yr + 1;
            const xlVal = Math.round(Number(getHf('CONTO ECONOMICO', matchedRowIndex, col)) || 0);
            let appVal = appArray[yr - 1] || 0;
            if (item.minus) appVal = -Math.abs(appVal);
            appVal = Math.round(appVal);
            if (Math.abs(xlVal - appVal) <= 2) passedTests++;
            else {
                rowMismatches++;
                if (rowMismatches <= 3) console.log(`   DIFF R${matchedRowIndex} [${item.label}] Y${yr}: XL=${xlVal} App=${appVal} (Δ=${xlVal-appVal})`);
            }
        }
        const status = rowMismatches === 0 ? '✅ 20/20 PERFETTI' : `❌ ${rowMismatches}/20 discordanti`;
        console.log(`R${String(matchedRowIndex).padStart(2)} [${item.label.padEnd(42)}] -> ${status}`);
    });

    console.log(`\n===============================================================`);
    console.log(`TOTALE TEST SUPERATI: ${passedTests} / ${totalTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`===============================================================`);
}
runTest().catch(console.error);
