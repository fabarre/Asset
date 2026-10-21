import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { Blob as NodeBlob } from 'node:buffer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, '..', 'src', 'worker', 'simulation.worker.js');
const workerCode = fs.readFileSync(workerPath, 'utf8');

let lastMessage = null;
const sandbox = {
    self: { postMessage: (msg) => { lastMessage = msg; } },
    console, structuredClone: global.structuredClone,
    Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
    Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
};
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox);

const profile = sandbox.generateDefaultSolarProfile(5, 1350);
const zonal = new Float64Array(8760).fill(110);
const plant = {
    id: 'p1', name: 'FV Tuscania 5MW', capacity: 5000, zone: 'CNOR',
    capex: 750, opex: 85000, enabled: true,
    generation: profile,
    codDate: '2026-06-01',
    bessMw: 2, bessMwh: 4, bessType: 'lfp', bessEfficiency: 0.90,
    bessDegradation: 0.018, bessCapexKwh: 300, bessConnection: 'ac',
    bessDoD: 90, bessSocMin: 5, bessSocMax: 95,
    gridVoltage: 'mt', gridConnectionKw: 5000,
    marketType: 'rid', traderContractType: 'pun_orario',
    traderSpread: 2, traderDisp: 1
};
const inputs = {
    keVal: 0.08, wacc: 0.06, inflation: 0.02,
    fiscalDeprRate: 0.09, leverage: 0.75, interestRate: 0.045,
    loanTerm: 12, debtBasis: 'enterprise_value',
    sweepType: 'none', sweepValue: 0, sweepYears: 0,
    seniorGracePeriodMonths: 6, constructionMonths: 6, idcDrawdownFactor: 50,
    sociEquityPct: 80, sociInterestRate: 5.5, sociInterestGrace: 0, sociPrincipalGrace: 0,
    exitOption: '20', exitMultiple: 8, exitValuePerMwp: 0, exitEnterpriseValue: 0,
    holdcoCapital: 10000,
    distributionPolicy: 'civil_with_capital_reserve_return',
    priceScenarioType: 'base'
};

sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: { inputs, plants: [plant], stabilimenti: [], zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal } } } } });
const results = lastMessage.results;
console.log('Worker calculatedIrr:', results.calculatedIrr, '%', 'calculatedProjectIrr:', results.calculatedProjectIrr, '%');
console.log('Worker avgDscr:', results.avgDscr, 'minDscr:', results.minDscr);

let capturedBuffer = null;
class CustomBlob extends NodeBlob {
    constructor(buffers, opts) {
        super(buffers, opts);
        if (buffers && buffers[0]) capturedBuffer = buffers[0];
    }
}
global.Blob = CustomBlob;
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
global.window = {
    _currentProjectName: 'Test Audit IRR DSCR',
    State: { branding: { company: 'Test' }, inputs, plants: [plant], stabilimenti: [], results },
    URL: global.URL
};
global.ExcelJS = ExcelJS;
global.showToast = () => {};
global.document = { body: { appendChild: () => {}, removeChild: () => {} }, createElement: () => ({ click: () => {}, style: {} }) };

const excelCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'excelExport.js'), 'utf8');
const runExport = new Function('ExcelJS', 'window', 'showToast', 'Blob', 'URL', 'document', `${excelCode}\nreturn exportPnlToExcel;`);
const exportPnlToExcel = runExport(ExcelJS, global.window, global.showToast, global.Blob, global.URL, global.document);

await exportPnlToExcel();
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(capturedBuffer);

console.log('\n========================================================');
console.log('🔍 AUDIT COMPLETO WORKBOOK PER FORMULE IRR E DSCR');
console.log('========================================================');

const findings = [];
wb.worksheets.forEach(ws => {
    ws.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
            const f = cell.formula || (cell.value && typeof cell.value === 'object' && cell.value.formula);
            const val = cell.value?.result !== undefined ? cell.value.result : (typeof cell.value === 'object' ? null : cell.value);
            const label = row.getCell(1).value;
            if (f) {
                if (f.toUpperCase().includes('IRR(') || f.toUpperCase().includes('XIRR(') || f.includes('equityIrr') || f.includes('projectIrr')) {
                    findings.push({ type: 'IRR', sheet: ws.name, cell: cell.address, label, formula: f, val });
                }
                if (f.toUpperCase().includes('AVERAGEIF(') || f.toUpperCase().includes('MINIFS(') || f.toUpperCase().includes('DSCR') || f.includes('avgDscr') || f.includes('minDscr')) {
                    findings.push({ type: 'DSCR', sheet: ws.name, cell: cell.address, label, formula: f, val });
                }
            }
        });
    });
});

console.log(`\n▶ Formule IRR rilevate (${findings.filter(f => f.type === 'IRR').length}):`);
findings.filter(f => f.type === 'IRR').forEach(f => {
    console.log(`  • [${f.sheet}!${f.cell}] "${f.label}": Formula = ${f.formula} (Valore: ${typeof f.val === 'number' ? (f.val * 100).toFixed(2) + '%' : f.val})`);
});

console.log(`\n▶ Formule DSCR rilevate (${findings.filter(f => f.type === 'DSCR').length}):`);
findings.filter(f => f.type === 'DSCR').forEach(f => {
    console.log(`  • [${f.sheet}!${f.cell}] "${f.label}": Formula = ${f.formula} (Valore: ${typeof f.val === 'number' ? f.val.toFixed(2) + 'x' : f.val})`);
});

// HyperFormula validation
const hfSheets = {};
wb.worksheets.forEach(ws => {
    const maxRow = ws.rowCount || 1;
    const maxCol = ws.columnCount || 1;
    const matrix = [];
    for (let r = 1; r <= maxRow; r++) {
        const rowData = [];
        const row = ws.getRow(r);
        for (let c = 1; c <= maxCol; c++) {
            const cell = row.getCell(c);
            let v = null;
            if (cell.formula) {
                v = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
            } else if (cell.value && typeof cell.value === 'object') {
                if (cell.value.formula) {
                    v = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
                } else {
                    v = cell.value.result !== undefined ? cell.value.result : null;
                }
            } else {
                v = cell.value !== undefined ? cell.value : null;
            }
            rowData.push(v);
        }
        matrix.push(rowData);
    }
    hfSheets[ws.name] = matrix;
});

const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3' });
console.log('\n▶ Collaudo Ricalcolo Dinamico con HyperFormula:');
findings.forEach(f => {
    const sheetId = hf.getSheetId(f.sheet);
    const colIdx = f.cell.charCodeAt(0) - 65; // 'A' -> 0, 'B' -> 1, ...
    const rowIdx = parseInt(f.cell.slice(1)) - 1;
    const hfVal = hf.getCellValue({ col: colIdx, row: rowIdx, sheet: sheetId });
    const isErr = hfVal && typeof hfVal === 'object' && hfVal.type;
    console.log(`  • ${f.sheet}!${f.cell} (${f.label}): HF = ${isErr ? hfVal.value : (typeof hfVal === 'number' ? hfVal.toFixed(4) : hfVal)} ${isErr ? '❌ ERROR: ' + hfVal.message : '✓ OK'}`);
});

console.log('\n========================================================');
console.log('🎉 AUDIT CONCLUSO CON SUCCESSO!');
console.log('========================================================');
