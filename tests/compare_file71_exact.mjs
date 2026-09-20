import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
const workerCode = fs.readFileSync(workerPath, 'utf8');
const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (71).xlsx';

async function compareExact() {
    console.log('=== VERIFICA ESATTA FILE 71: EXCEL FORMULA VS APP WORKER ===');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(excelPath);

    // HyperFormula Engine
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

    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true, precisionRounding: 6 });
    const getHf = (s, r, c) => hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });

    // 1. Leggiamo i driver da DRIVER OPERATIVI di File 71 per estrarre la produzione esatta
    const sDr = wb.getWorksheet('DRIVER OPERATIVI');
    const sFin = wb.getWorksheet('FINANZA');
    const getFin = (r) => sFin.getCell(`B${r}`).value;

    // Worker setup
    let lastMessage = null;
    const sandbox = {
        self: { postMessage: (msg) => { lastMessage = msg; } },
        console, structuredClone: global.structuredClone,
        Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
        Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
    };
    vm.createContext(sandbox);
    vm.runInContext(workerCode, sandbox);

    // Calcoliamo il fattore di scala del profilo solare per allineare esattamente l'energia prodotta a quella nel file 71
    // Nel file 71: Y2 = 13352.60768372184 MWh per 8186.2 kWp totali -> resa = 13352607 / 8186.2 = 1631.11 kWh/kWp
    const p1Base = sandbox.generateDefaultSolarProfile(4.14068, 1631.11);
    const p2Base = sandbox.generateDefaultSolarProfile(4.04552, 1631.11);

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
        inflation: getFin(5) || 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
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

    // Usiamo il PUN esatto per la zona CNOR calcolato da prezzo medio RID in File 71
    const pY1 = sDr.getRow(29).getCell(2).value; // 99.3021
    const zonal = new Float64Array(8760).fill(pY1);
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun: { CNOR: zonal } };

    sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const res = lastMessage.results;
    const m = res.matrix;

    console.log('\n===============================================================');
    console.log('CONFRONTO RIGA PER RIGA: CONTO ECONOMICO (EXCEL vs APP WORKER)');
    console.log('===============================================================');

    const ceMappings = [
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

    ceMappings.forEach(item => {
        const sCe = wb.getWorksheet('CONTO ECONOMICO');
        const fY1 = sCe.getRow(item.rNum).getCell(2).formula;
        const vY1 = Math.round(getHf('CONTO ECONOMICO', item.rNum, 2));
        const vY2 = Math.round(getHf('CONTO ECONOMICO', item.rNum, 3));
        const vY5 = Math.round(getHf('CONTO ECONOMICO', item.rNum, 6));
        const vY12 = Math.round(getHf('CONTO ECONOMICO', item.rNum, 13));
        const vY20 = Math.round(getHf('CONTO ECONOMICO', item.rNum, 21));

        let appY1 = '-', appY2 = '-', appY5 = '-', appY12 = '-', appY20 = '-';
        let matchY1 = '—', matchY2 = '—';

        if (item.key && m[item.key]) {
            const arr = m[item.key];
            const getVal = (idx) => {
                let val = arr[idx];
                if (item.minus) val = -Math.abs(val);
                return Math.round(val);
            };
            appY1 = getVal(0);
            appY2 = getVal(1);
            appY5 = getVal(4);
            appY12 = getVal(11);
            appY20 = getVal(19);

            const diffY1 = vY1 - appY1;
            const diffY2 = vY2 - appY2;
            matchY1 = Math.abs(diffY1) <= 2 ? '✅ OK' : `❌ Δ=${diffY1}`;
            matchY2 = Math.abs(diffY2) <= 2 ? '✅ OK' : `❌ Δ=${diffY2}`;
        }

        console.log(`\nR${String(item.rNum).padStart(2)} [${item.label.padEnd(38)}]`);
        console.log(`    Excel:  Y1=${vY1.toLocaleString('it-IT')} | Y2=${vY2.toLocaleString('it-IT')} | Y5=${vY5.toLocaleString('it-IT')} | Y12=${vY12.toLocaleString('it-IT')} | Y20=${vY20.toLocaleString('it-IT')}`);
        if (item.key) {
            console.log(`    App:    Y1=${appY1.toLocaleString('it-IT')} | Y2=${appY2.toLocaleString('it-IT')} | Y5=${appY5.toLocaleString('it-IT')} | Y12=${appY12.toLocaleString('it-IT')} | Y20=${appY20.toLocaleString('it-IT')}`);
            console.log(`    Match:  Y1: ${matchY1}  |  Y2: ${matchY2}`);
        } else {
            console.log(`    (Riga di supporto formula Excel - non esposta singolarmente in matrix)`);
        }
        console.log(`    Formula Y1: ${fY1 || 'nessuna (valore)'}`);
    });
}

compareExact().catch(console.error);
