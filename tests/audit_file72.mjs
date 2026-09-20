import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function auditFile72() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile('/home/ubuntu/Asset/PL_Driver_Operativi (72).xlsx');

    // Build HyperFormula
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

    // Worker setup
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const workerCode = fs.readFileSync(workerPath, 'utf8');
    let lastMsg = null;
    const sbW = { self: { postMessage: (m) => { lastMsg = m; } }, console, structuredClone: global.structuredClone, Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String, Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN };
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
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun: { CNOR: zonal } };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const m = lastMsg.results.matrix;

    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    console.log('=== CONFRONTO EXCEL FILE 72 VS APP WORKER ===');
    const rowsToTest = [
        { rNum: 2, label: 'RICAVI TOTALI SPV', key: 'revenueTotal' },
        { rNum: 9, label: 'COSTI OPERATIVI (OPEX) TOTALE SPV', key: 'opexTotal', minus: true },
        { rNum: 10, label: '  di cui: O&M Impianti Fotovoltaici', key: 'opexPlants', minus: true },
        { rNum: 14, label: '  di cui: Assicurazione (All Risk / RC)', key: 'opexInsurance', minus: true },
        { rNum: 15, label: '  di cui: Tasse Locali / IMU', key: 'opexTaxes', minus: true },
        { rNum: 16, label: '  di cui: Vigilanza & Sicurezza', key: 'opexSecurity', minus: true },
        { rNum: 20, label: 'MARGINE OPERATIVO LORDO (EBITDA)', key: 'ebitda' },
        { rNum: 22, label: '(-) Ammortamento Civilistico', key: 'depreciationCivil', minus: true },
        { rNum: 23, label: '  di cui: Ammortamento Impianti Solari', key: 'depreciationCivilSolar', minus: true },
        { rNum: 25, label: '  di cui: Ammortamento Altri Costi Capitalizzati', key: 'depreciationCivilOther', minus: true },
        { rNum: 27, label: 'EBIT SPV (Risultato Operativo)', key: 'ebit' },
        { rNum: 30, label: '  (-) Interessi Passivi Mutuo Bancario', key: 'interest', minus: true },
        { rNum: 31, label: '  (-) Interessi Finanziamento Soci (Accrual)', key: 'sociInterestAccrued', minus: true },
        { rNum: 33, label: 'EBT — Utile ante Imposte SPV', key: 'ebt' },
        { rNum: 36, label: 'Amm.to Fiscale Base - anno 1 al 50%', formulaOnly: true },
        { rNum: 40, label: 'Amm.to Fiscale Totale', formulaOnly: true },
        { rNum: 41, label: 'ROL 30% EBITDA - Art. 96', formulaOnly: true },
        { rNum: 42, label: 'Interessi Passivi Netti - Art. 96', formulaOnly: true },
        { rNum: 43, label: 'Interessi Deducibili - Art. 96', formulaOnly: true },
        { rNum: 45, label: 'Imponibile IRES Lordo', key: 'taxTaxableIres' },
        { rNum: 51, label: 'Imponibile IRES Netto - post NOL', key: 'taxTaxableFinal' },
        { rNum: 52, label: 'Quota IDC in Amm.to Civilistico - IRAP', formulaOnly: true },
        { rNum: 53, label: 'Base Imponibile IRAP', key: 'taxableIrap' },
        { rNum: 54, label: 'Delta Amm.to x Aliquote', formulaOnly: true },
        { rNum: 55, label: '  (-) Imposte Correnti SPV (IRES + IRAP)', key: 'currentTaxesSpv', minus: true },
        { rNum: 56, label: '  di cui: IRES', key: 'iresTaxSpv' },
        { rNum: 57, label: '  di cui: IRAP', key: 'irapTaxSpv' },
        { rNum: 58, label: '  (-/+) Variazione Imposte Differite', key: 'deferredTaxes' },
        { rNum: 59, label: 'Fondo Imposte Differite - saldo', formulaOnly: true },
        { rNum: 61, label: 'UTILE NETTO CIVILISTICO SPV', key: 'netProfitSpv' }
    ];

    rowsToTest.forEach(item => {
        const formulaY1 = sCe.getRow(item.rNum).getCell(2).formula;
        const formulaY2 = sCe.getRow(item.rNum).getCell(3).formula;
        const hfY1 = Math.round(Number(getHf('CONTO ECONOMICO', item.rNum, 2)) || 0);
        const hfY2 = Math.round(Number(getHf('CONTO ECONOMICO', item.rNum, 3)) || 0);
        const hfY12 = Math.round(Number(getHf('CONTO ECONOMICO', item.rNum, 13)) || 0);

        let appY1 = '-', appY2 = '-', appY12 = '-';
        let matchY1 = '—', matchY2 = '—', matchY12 = '—';
        if (item.key && m[item.key]) {
            const arr = m[item.key];
            const getVal = (idx) => {
                let val = arr[idx];
                if (item.minus) val = -Math.abs(val);
                return Math.round(val);
            };
            appY1 = getVal(0);
            appY2 = getVal(1);
            appY12 = getVal(11);
            const d1 = hfY1 - appY1;
            const d2 = hfY2 - appY2;
            const d12 = hfY12 - appY12;
            matchY1 = Math.abs(d1) <= 2 ? 'OK' : ('DIFF=' + d1);
            matchY2 = Math.abs(d2) <= 2 ? 'OK' : ('DIFF=' + d2);
            matchY12 = Math.abs(d12) <= 2 ? 'OK' : ('DIFF=' + d12);
        }

        console.log(`R${String(item.rNum).padStart(2)} [${item.label.padEnd(38)}] | Y1: XL=${hfY1} App=${appY1} [${matchY1}] | Y2: XL=${hfY2} App=${appY2} [${matchY2}] | Y12: XL=${hfY12} App=${appY12} [${matchY12}]`);
        if (matchY1 !== 'OK' && matchY1 !== '—' || matchY2 !== 'OK' && matchY2 !== '—' || matchY12 !== 'OK' && matchY12 !== '—') {
            console.log(`     Formula Y1: ${formulaY1}`);
            console.log(`     Formula Y2: ${formulaY2}`);
        }
    });
}
auditFile72().catch(console.error);
