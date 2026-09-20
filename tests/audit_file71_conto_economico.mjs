import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
const workerCode = fs.readFileSync(workerPath, 'utf8');
const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (71).xlsx';

async function auditCeFile71() {
    console.log('=== AUDIT FORENSE CONTO ECONOMICO FILE 71: APP WORKER VS FORMULE EXCEL ===');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(excelPath);

    // Build HyperFormula for Excel evaluation
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
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    rawF = cell.value.formula;
                }
                if (rawF) val = rawF.startsWith('=') ? rawF : '=' + rawF;
                else if (cell.value !== undefined && cell.value !== null) val = cell.value;
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

    const sFin = wb.getWorksheet('FINANZA');
    const getFin = (r) => sFin.getCell(`B${r}`).value;

    const p1Base = sandbox.generateDefaultSolarProfile(4.14068, 1450);
    const p2Base = sandbox.generateDefaultSolarProfile(4.04552, 1400);

    const plants = [
        {
            id: 'plant-guasticce',
            name: 'Guasticce (kW)',
            capacity: 4140.68,
            capex: 614.9654,
            connectionCost: 62240,
            spvCost: 460130,
            landType: 'dds_attualizzato',
            landCostDds: 433820,
            cod: '2027-07-01',
            enabled: true,
            specificYield: 1450,
            degradation: 0.005,
            generation: p1Base,
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        },
        {
            id: 'plant-castenaso',
            name: 'Castenaso (kW)',
            capacity: 4045.52,
            capex: 609.7752,
            connectionCost: 34943,
            spvCost: 440352,
            landType: 'acquisto',
            landCost: 436687,
            cod: '2027-07-01',
            enabled: true,
            specificYield: 1400,
            degradation: 0.005,
            generation: p2Base,
            bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        }
    ];

    const inputs = {
        inflation: getFin(5) || 0.02,
        keVal: getFin(3) || 0.08,
        wacc: getFin(4) || 0.06,
        fiscalDeprRate: getFin(6) || 0.09,
        iresRate: getFin(7) || 0.24,
        irapRate: getFin(8) || 0.039,
        vatEnabled: true,
        vatFrequency: 'monthly',
        vatQuarterlyRefund: true,
        leverage: getFin(13) || 0.80,
        interestRate: getFin(14) || 0.045,
        debtBasis: 'total_capex',
        loanTerm: getFin(16) || 15,
        seniorGracePeriodMonths: getFin(20) || 12,
        constructionMonths: getFin(21) || 7,
        idcDrawdownFactor: (getFin(22) || 0.5) * 100,
        holdcoCapital: getFin(78) || 0,
        sociEquityPct: (getFin(36) || 1.0) * 100,
        sociInterestRate: (getFin(37) || 0.043) * 100,
        sociLoanTerm: getFin(40) || 10,
        sociCapitalGrace: getFin(39) || 0,
        sociInterestGrace: getFin(38) || 0,
        exitOption: 'mwp',
        exitYear: 20,
        exitValuePerMwp: getFin(82) || 900000,
        exitEnterpriseValue: getFin(83) || 7367580,
        exitMultiple: getFin(81) || 11.38,
        priceScenarioType: 'base',
        distributionPolicy: 'dividend_plus_capital_reserve',
        dividendLock: false
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

    const zonal = new Float64Array(8760).fill(95);
    const state = {
        inputs, plants, stabilimenti: [], opexEvents,
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
    };

    sandbox.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const res = lastMessage.results;
    const m = res.matrix;

    const sCe = wb.getWorksheet('CONTO ECONOMICO');

    // Mapping rows
    const ceRows = [
        { rNum: 2, label: 'RICAVI TOTALI SPV', appKey: 'revenueTotal' },
        { rNum: 3, label: 'Ricavi da RID generato da FV', appKey: 'revenueRid' },
        { rNum: 9, label: 'COSTI OPERATIVI (OPEX) TOTALE SPV', appKey: 'opexTotal', minus: true },
        { rNum: 10, label: 'O&M Impianti Fotovoltaici', appKey: 'opexPlants', minus: true },
        { rNum: 14, label: 'Assicurazione (All Risk / RC)', appKey: 'opexInsurance', minus: true },
        { rNum: 15, label: 'Tasse Locali / IMU', appKey: 'opexTaxes', minus: true },
        { rNum: 16, label: 'Vigilanza & Sicurezza', appKey: 'opexSecurity', minus: true },
        { rNum: 20, label: 'MARGINE OPERATIVO LORDO (EBITDA)', appKey: 'ebitda' },
        { rNum: 22, label: 'Ammortamento Civilistico', appKey: 'depreciationCivil', minus: true },
        { rNum: 23, label: 'di cui: Ammortamento Impianti Solari', appKey: 'depreciationCivilSolar', minus: true },
        { rNum: 25, label: 'di cui: Ammortamento Altri Costi Capitalizzati', appKey: 'depreciationCivilOther', minus: true },
        { rNum: 27, label: 'EBIT SPV (Risultato Operativo)', appKey: 'ebit' },
        { rNum: 30, label: 'Interessi Passivi Mutuo Bancario', appKey: 'interest', minus: true },
        { rNum: 31, label: 'Interessi Finanziamento Soci (Accrual)', appKey: 'sociInterestAccrued', minus: true },
        { rNum: 33, label: 'EBT — Utile ante Imposte SPV', appKey: 'ebt' },
        { rNum: 40, label: 'Amm.to Fiscale Totale', appKey: 'taxDeprDelta', custom: (yr) => m.taxDeprDelta ? m.taxDeprDelta[yr] : 0 },
        { rNum: 45, label: 'Imponibile IRES Lordo', appKey: 'taxTaxableIres' },
        { rNum: 51, label: 'Imponibile IRES Netto - post NOL', appKey: 'taxTaxableFinal' },
        { rNum: 53, label: 'Base Imponibile IRAP', appKey: 'taxableIrap' },
        { rNum: 55, label: 'Imposte Correnti SPV', appKey: 'currentTaxesSpv', minus: true },
        { rNum: 56, label: 'di cui: IRES', appKey: 'iresTaxSpv' },
        { rNum: 57, label: 'di cui: IRAP', appKey: 'irapTaxSpv' },
        { rNum: 58, label: 'Variazione Imposte Differite', appKey: 'deferredTaxes' },
        { rNum: 61, label: 'UTILE NETTO CIVILISTICO SPV', appKey: 'netProfitSpv' }
    ];

    console.log('\n--- ANALISI COMPARATIVA RIGA PER RIGA ---');
    const discrepancies = [];

    ceRows.forEach(item => {
        const row = sCe.getRow(item.rNum);
        const appArr = m[item.appKey] || [];

        let rowDiffs = [];
        for (let yr = 1; yr <= 20; yr++) {
            const col = yr + 1;
            const xlVal = getHf('CONTO ECONOMICO', item.rNum, col);
            let appVal = appArr[yr - 1] !== undefined ? appArr[yr - 1] : 0;
            if (item.minus) appVal = -Math.abs(appVal);

            const numXl = typeof xlVal === 'number' ? xlVal : 0;
            const diff = Math.round(numXl) - Math.round(appVal);

            if (Math.abs(diff) > 2) {
                rowDiffs.push({ yr, xlVal: Math.round(numXl), appVal: Math.round(appVal), diff });
            }
        }

        if (rowDiffs.length > 0) {
            console.log(`\n❌ R${item.rNum} [${item.label}]: ${rowDiffs.length}/20 anni discordanti`);
            console.log(`   Formula Y1: ${row.getCell(2).formula}`);
            console.log(`   Formula Y2: ${row.getCell(3).formula}`);
            rowDiffs.slice(0, 5).forEach(d => {
                console.log(`   - Anno ${d.yr}: Excel=${d.xlVal.toLocaleString('it-IT')} € vs App=${d.appVal.toLocaleString('it-IT')} € (Δ = ${d.diff.toLocaleString('it-IT')} €)`);
            });
            if (rowDiffs.length > 5) console.log(`   ... e altri ${rowDiffs.length - 5} anni`);
            discrepancies.push({ rNum: item.rNum, label: item.label, diffs: rowDiffs, fY1: row.getCell(2).formula, fY2: row.getCell(3).formula });
        } else {
            console.log(`✅ R${item.rNum} [${item.label}]: PERFETTAMENTE ALLINEATO (Δ <= 2€ su tutti i 20 anni)`);
        }
    });

    console.log(`\nTotale righe con scostamento significativo: ${discrepancies.length}/${ceRows.length}`);
}

auditCeFile71().catch(console.error);
