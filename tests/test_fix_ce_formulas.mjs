import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

let excelExportCode = fs.readFileSync('/home/ubuntu/Asset/src/excelExport.js', 'utf8');
let workerCode = fs.readFileSync('/home/ubuntu/Asset/src/worker/simulation.worker.js', 'utf8');

// 1. Worker fix: compute and return y1OperatingAvail
const oldWorkerAnchor = 'let portfolioDebtAvail = 1.0;';
const newWorkerAnchor = `let portfolioDebtAvail = 1.0;
                let y1DebtAvail = 1.0;`;
workerCode = workerCode.replace(oldWorkerAnchor, newWorkerAnchor);

workerCode = workerCode.replace(
    `portfolioDebtAvail = sumCapex > 0 ? (weightedAvailSum / sumCapex) : 1.0;`,
    `portfolioDebtAvail = sumCapex > 0 ? (weightedAvailSum / sumCapex) : 1.0;
                    if (yr === 1) y1DebtAvail = portfolioDebtAvail;`
);

workerCode = workerCode.replace(
    'totalProjectCost, debtAmount, equityAmount, initialShareholderLoan,',
    'totalProjectCost, debtAmount, equityAmount, initialShareholderLoan, y1OperatingAvail: y1DebtAvail,'
);

// 2. ExcelExport fixes:
// A. Depreciation Solar with y1OperatingAvail
const oldDeprSolar = `    addRowCe('depreciationCivilSolar', 'di cui: Ammortamento Impianti Solari (€)', 'minus', m.depreciationCivilSolar, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const capexRef = \`(CAPEX!\${deprColLetter}\${rowMapCapex['deprSolar']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprLandDds']})\`;
        return \`IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1)), 0), 0), 0))\`;
    });`;

const newDeprSolar = `    addRowCe('depreciationCivilSolar', 'di cui: Ammortamento Impianti Solari (€)', 'minus', m.depreciationCivilSolar, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const availRef = \`'FINANZA'!$B$\${rowMapFin['y1OperatingAvail']}\`;
        const capexRef = \`(CAPEX!\${deprColLetter}\${rowMapCapex['deprSolar']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprLandDds']})\`;
        return \`IF(\${yr} = 1, IFERROR(-ROUND(\${capexRef} * \${availRef}, 0), 0), IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1) + (1 - \${availRef})), 0), 0), 0)))\`;
    });`;

excelExportCode = excelExportCode.replace(oldDeprSolar, newDeprSolar);

// B. Depreciation Bess with y1OperatingAvail
const oldDeprBess = `    addRowCe('depreciationCivilBess', 'di cui: Ammortamento BESS (€)', 'minus', m.depreciationCivilBess, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const capexRef = \`CAPEX!\${deprColLetter}\${rowMapCapex['deprBess']}\`;
        return \`IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1)), 0), 0), 0))\`;
    });`;

const newDeprBess = `    addRowCe('depreciationCivilBess', 'di cui: Ammortamento BESS (€)', 'minus', m.depreciationCivilBess, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const availRef = \`'FINANZA'!$B$\${rowMapFin['y1OperatingAvail']}\`;
        const capexRef = \`CAPEX!\${deprColLetter}\${rowMapCapex['deprBess']}\`;
        return \`IF(\${yr} = 1, IFERROR(-ROUND(\${capexRef} * \${availRef}, 0), 0), IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1) + (1 - \${availRef})), 0), 0), 0)))\`;
    });`;

excelExportCode = excelExportCode.replace(oldDeprBess, newDeprBess);

// C. Depreciation Other with y1OperatingAvail
const oldDeprOther = `    addRowCe('depreciationCivilOther', 'di cui: Ammortamento Altri Costi Capitalizzati (€)', 'minus', m.depreciationCivilOther, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const capexRef = \`(CAPEX!\${deprColLetter}\${rowMapCapex['deprConn']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprDev']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprCustom']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprIdc']})\`;
        return \`IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1)), 0), 0), 0))\`;
    });`;

const newDeprOther = `    addRowCe('depreciationCivilOther', 'di cui: Ammortamento Altri Costi Capitalizzati (€)', 'minus', m.depreciationCivilOther, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = \`'FINANZA'!$B$\${rowMapFin['fiscalDeprRate']}\`;
        const availRef = \`'FINANZA'!$B$\${rowMapFin['y1OperatingAvail']}\`;
        const capexRef = \`(CAPEX!\${deprColLetter}\${rowMapCapex['deprConn']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprDev']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprCustom']} + CAPEX!\${deprColLetter}\${rowMapCapex['deprIdc']})\`;
        return \`IF(\${yr} = 1, IFERROR(-ROUND(\${capexRef} * \${availRef}, 0), 0), IF(\${yr} < ROUNDUP(1 / \${rateRef}, 0), IFERROR(-\${capexRef}, 0), IF(\${yr} = ROUNDUP(1 / \${rateRef}, 0), IFERROR(-ROUND(\${capexRef} * (1 / \${rateRef} - (\${yr} - 1) + (1 - \${availRef})), 0), 0), 0)))\`;
    });`;

excelExportCode = excelExportCode.replace(oldDeprOther, newDeprOther);

// D. Senior Debt principalScheduled in AMMORTAMENTO
const oldDebtBlock = `        const dt = yearNum === 1 ? \`FINANZA!$B$\${rowMapFin['y1OperatingAvail']}\` : '1';
        const timeElapsed = yearNum === 1
            ? \`(FINANZA!$B$\${rowMapFin['constructionMonths']}/12)\`
            : \`(FINANZA!$B$\${rowMapFin['constructionMonths']}/12+FINANZA!$B$\${rowMapFin['y1OperatingAvail']}+\${yearNum - 2})\`;
        const graceInYr = \`MAX(0, MIN(\${dt}, FINANZA!$B$\${rowMapFin['graceCappedYears']}-\${timeElapsed}))\`;
        const amortInYr = \`(\${dt}-\${graceInYr})\`;
        const baseAmort = \`MIN(\${begin}, MAX(0, (\${annuity}-\${begin}*\${rate})*\${amortInYr}))\`;`;

const newDebtBlock = `        const dt = yearNum === 1 ? \`FINANZA!$B$\${rowMapFin['y1OperatingAvail']}\` : '1';
        const timeElapsed = yearNum === 1 ? '0' : \`(FINANZA!$B$\${rowMapFin['y1OperatingAvail']}+\${yearNum - 2})\`;
        const graceInYr = \`MAX(0, MIN(\${dt}, FINANZA!$B$\${rowMapFin['graceCappedYears']}-\${timeElapsed}))\`;
        const amortInYr = \`(\${dt}-\${graceInYr})\`;
        const baseAmort = \`MIN(\${begin}, MAX(0, (\${annuity}-\${begin}*\${rate})*\${amortInYr}))\`;`;

excelExportCode = excelExportCode.replace(oldDebtBlock, newDebtBlock);

let lastMsg = null;
const sbW = { self: { postMessage: (m) => { lastMsg = m; } }, console, structuredClone: global.structuredClone, Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String, Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN };
vm.createContext(sbW);
vm.runInContext(workerCode, sbW);

const p1 = sbW.generateDefaultSolarProfile(4.14068, 1631.11);
const p2 = sbW.generateDefaultSolarProfile(4.04552, 1631.11);
const plants = [
    { id: 'plant-guasticce', name: 'Guasticce', capacity: 4140.68, capex: 614.9654, connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p1, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' },
    { id: 'plant-castenaso', name: 'Castenaso', capacity: 4045.52, capex: 609.7752, connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p2, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' }
];
const inputs = {
    fiscalDeprRate: 0.09, leverage: 1.0, debtBasis: 'ev_ex_spv', loanTerm: 15,
    interestRate: 0.045, constructionMonths: 7, seniorGracePeriodMonths: 12, idcDrawdownFactor: 50,
    sociEquityPct: 100, sociPctSpv: 100, sociInterestRate: 4.5445, sociLoanTerm: 10,
    sociPrincipalGrace: 0, sociInterestGrace: 0, iresRate: 0.24, irapRate: 0.039,
    distributionPolicy: 'civil_with_capital_reserve_return', exitOption: 'mwp', exitYear: 20
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

const fakeWindow = { State: state, ExcelJS: ExcelJS, saveAs: () => {} };
const modifiedExportCode = excelExportCode.replace(
    'const buffer = await workbook.xlsx.writeBuffer();',
    'const buffer = await workbook.xlsx.writeBuffer(); global.__wb = workbook;'
);
const sbE = { window: fakeWindow, ExcelJS: ExcelJS, console, showToast: () => {}, Blob: class {}, Math, Date, JSON, Array, Object, Number, String, parseInt, parseFloat, global: {} };
vm.createContext(sbE);
vm.runInContext(modifiedExportCode, sbE);

await sbE.exportPnlToExcel();
const wb = sbE.global.__wb;
const hfSheets = {};
wb.worksheets.forEach(ws => {
    const matrix = [];
    for (let r = 1; r <= ws.rowCount; r++) {
        const rowData = [];
        const row = ws.getRow(r);
        for (let c = 1; c <= ws.columnCount; c++) {
            const cell = row.getCell(c);
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
const getHf = (s, r, c) => hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });

const sCe = wb.getWorksheet('CONTO ECONOMICO');
const m = state.results.matrix;

const rowsToCheck = [
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
    { label: 'Imposte Correnti SPV', key: 'currentTaxesSpv', minus: true },
    { label: 'di cui: IRES', key: 'iresTaxSpv' },
    { label: 'di cui: IRAP', key: 'irapTaxSpv' },
    { label: 'Variazione Imposte Differite', key: 'deferredTaxes' },
    { label: 'UTILE NETTO CIVILISTICO SPV', key: 'netProfitSpv' }
];

console.log('=== ESITO CONFRONTO POST-FIX COMPLETO ===');
rowsToCheck.forEach(item => {
    let matchedRow = null;
    sCe.eachRow((r, rNum) => {
        if (String(r.getCell(1).value || '').includes(item.label)) matchedRow = rNum;
    });
    let mismatches = 0;
    const deltas = [];
    for (let yr = 1; yr <= 20; yr++) {
        const col = yr + 1;
        const xlVal = Math.round(Number(getHf('CONTO ECONOMICO', matchedRow, col)) || 0);
        let appVal = m[item.key] ? m[item.key][yr - 1] : 0;
        if (item.minus) appVal = -Math.abs(appVal);
        appVal = Math.round(appVal);
        const delta = xlVal - appVal;
        if (Math.abs(delta) > 2) {
            mismatches++;
            if (deltas.length < 3) deltas.push(`Y${yr}: XL=${xlVal} App=${appVal} (Δ=${delta})`);
        }
    }
    const status = mismatches === 0 ? '✅ 20/20 PERFETTI' : `❌ ${mismatches}/20 diff (${deltas.join(', ')})`;
    console.log(`R${String(matchedRow).padStart(2)} [${item.label.padEnd(42)}] -> ${status}`);
});
