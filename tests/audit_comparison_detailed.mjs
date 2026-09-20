import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (70).xlsx';

async function auditComparison() {
    console.log('=== AUDIT FORENSE APPROFONDITO FILE 70: APP VS EXCEL ===');

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
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    rawF = cell.value.formula;
                }
                if (rawF) {
                    val = rawF.startsWith('=') ? rawF : '=' + rawF;
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
        licenseKey: 'gpl-v3',
        useColumnIndex: true,
        precisionRounding: 6
    });

    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    // 1. Worker setup
    const workerCode = fs.readFileSync(workerPath, 'utf8');
    let lastMessage = null;
    const sandboxWorker = {
        self: {
            postMessage: (msg) => { lastMessage = msg; }
        },
        console,
        structuredClone: global.structuredClone,
        Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
        Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
    };
    vm.createContext(sandboxWorker);
    vm.runInContext(workerCode, sandboxWorker);

    // Estrarre curve da DRIVER OPERATIVI
    const sDrivers = wb.getWorksheet('DRIVER OPERATIVI');
    const genMwh = [];
    const ridPrices = [];
    for (let y = 1; y <= 20; y++) {
        const col = y + 1;
        genMwh.push(getHf('DRIVER OPERATIVI', 5, col));
        ridPrices.push(getHf('DRIVER OPERATIVI', 29, col));
    }
    console.log('Driver Produzione Y1..Y3:', genMwh.slice(0, 3));
    console.log('Driver Prezzo RID Y1..Y3:', ridPrices.slice(0, 3));

    // Setup piante con profilo scalato esattamente alla produzione di file 70
    // Capacity: 4140.68 e 4045.52
    const p1Base = sandboxWorker.generateDefaultSolarProfile(4.14068, 1450);
    const p2Base = sandboxWorker.generateDefaultSolarProfile(4.04552, 1400);

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
            bessMw: 0,
            bessMwh: 0,
            marketType: 'rid',
            zone: 'CNOR'
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
            bessMw: 0,
            bessMwh: 0,
            marketType: 'rid',
            zone: 'CNOR'
        }
    ];

    // Read exact inputs from FINANZA sheet in file 70
    const sFin = wb.getWorksheet('FINANZA');
    const getFinVal = (rowNum) => sFin.getCell(`B${rowNum}`).value;
    const getFinHf = (rowNum) => getHf('FINANZA', rowNum, 2);

    const inputs = {
        inflation: getFinHf(5) || 0.02,
        keVal: getFinHf(3) || 0.08,
        wacc: getFinHf(4) || 0.06,
        fiscalDeprRate: getFinHf(6) || 0.09,
        iresRate: getFinHf(7) || 0.24,
        irapRate: getFinHf(8) || 0.039,
        vatEnabled: true,
        vatFrequency: 'monthly',
        vatQuarterlyRefund: true,
        leverage: getFinHf(13) || 0.80,
        interestRate: getFinHf(14) || 0.045,
        debtBasis: 'total_capex',
        loanTerm: getFinHf(16) || 15,
        seniorGracePeriodMonths: getFinHf(20) || 12,
        constructionMonths: getFinHf(21) || 7,
        idcDrawdownFactor: (getFinHf(22) || 0.5) * 100,
        holdcoCapital: getFinHf(78) || 0,
        sociEquityPct: (getFinHf(36) || 1.0) * 100,
        sociInterestRate: (getFinHf(37) || 0.043) * 100,
        sociLoanTerm: getFinHf(40) || 10,
        sociCapitalGrace: getFinHf(39) || 0,
        sociInterestGrace: getFinHf(38) || 0,
        exitOption: String(getFinHf(79)), // '0' in file 70
        exitValuePerMwp: getFinHf(82) || 900000,
        exitEnterpriseValue: getFinHf(83) || 7367580,
        exitMultiple: getFinHf(81) || 10.16,
        priceScenarioType: 'base',
        distributionPolicy: 'dividend_plus_capital_reserve',
        dividendLock: false
    };

    console.log('\nParametri estratti da FINANZA:', {
        leverage: inputs.leverage,
        interestRate: inputs.interestRate,
        loanTerm: inputs.loanTerm,
        seniorGracePeriodMonths: inputs.seniorGracePeriodMonths,
        constructionMonths: inputs.constructionMonths,
        exitOption: inputs.exitOption,
        exitValuePerMwp: inputs.exitValuePerMwp
    });

    const opexEvents = {
        'plant-guasticce': [
            { id: 'ev1', label: 'O&M FV Guasticce', amount: 76188, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev2', label: 'IMU Guasticce Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
            { id: 'ev3', label: 'IMU Guasticce Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true }
        ],
        'plant-castenaso': [
            { id: 'ev4', label: 'O&M FV Castenaso', amount: 74272, month: 7, rule: 'gt_cod', enabled: true },
            { id: 'ev5', label: 'IMU Castenaso Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
            { id: 'ev6', label: 'IMU Castenaso Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true }
        ]
    };

    // Creazione PUN ZONALE per matchare i prezzi esatti
    const zonal = new Float64Array(8760).fill(95);

    const state = {
        inputs,
        plants,
        stabilimenti: [],
        opexEvents,
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
    };

    sandboxWorker.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    if (!lastMessage || lastMessage.status !== 'success') {
        throw new Error('Calcolo fallito: ' + (lastMessage ? lastMessage.error : 'nessuna risposta'));
    }
    const res = lastMessage.results;
    const m = res.matrix;
    const d = res.debtSchedule;

    console.log('Keys of m:', Object.keys(m));
    console.log('\n=== CONFRONTO DETTAGLIATO CONTO ECONOMICO ===');
    for (let y = 1; y <= 5; y++) {
        const col = y + 1;
        console.log(`\n--- ANNO ${y} ---`);
        console.log(`Ricavi Totali: XL=${Math.round(getHf('CONTO ECONOMICO', 2, col))} | APP=${Math.round(m.revenueTotal[y-1])}`);
        console.log(`OPEX Totali: XL=${Math.round(getHf('CONTO ECONOMICO', 9, col))} | APP=${Math.round(-m.opexTotal[y-1])}`);
        console.log(`EBITDA: XL=${Math.round(getHf('CONTO ECONOMICO', 20, col))} | APP=${Math.round(m.ebitda[y-1])}`);
        console.log(`Ammortamento Civilistico: XL=${Math.round(getHf('CONTO ECONOMICO', 22, col))} | APP=${Math.round(-m.depreciationCivil[y-1])}`);
        console.log(`EBIT: XL=${Math.round(getHf('CONTO ECONOMICO', 27, col))} | APP=${Math.round(m.ebit[y-1])}`);
        console.log(`Interessi Senior: XL=${Math.round(getHf('CONTO ECONOMICO', 30, col))} | APP=${Math.round(-m.interest[y-1])}`);
        console.log(`Interessi Soci: XL=${Math.round(getHf('CONTO ECONOMICO', 31, col))} | APP=${Math.round(-m.sociInterestAccrued[y-1])}`);
        console.log(`EBT: XL=${Math.round(getHf('CONTO ECONOMICO', 33, col))} | APP=${Math.round(m.ebt[y-1])}`);
        console.log(`Imposte Correnti (IRES+IRAP): XL=${Math.round(getHf('CONTO ECONOMICO', 55, col))} | APP=${Math.round(-m.currentTaxesSpv[y-1])}`);
        console.log(`Variazione Imposte Differite: XL=${Math.round(getHf('CONTO ECONOMICO', 58, col))} | APP=${Math.round(m.deferredTaxes[y-1])}`);
        console.log(`Utile Netto SPV: XL=${Math.round(getHf('CONTO ECONOMICO', 61, col))} | APP=${Math.round(m.netProfitSpv[y-1])}`);
    }

    console.log('\n=== CONFRONTO DETTAGLIATO RENDICONTO FINANZIARIO SPV ===');
    for (let y = 1; y <= 5; y++) {
        const col = y + 1;
        console.log(`\n--- ANNO ${y} ---`);
        console.log(`CFADS: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 11, col))} | APP=${Math.round(m.cfads[y-1])}`);
        console.log(`Interessi Senior Pagati: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 14, col))} | APP=${Math.round(-m.interestPaid[y-1])}`);
        console.log(`Quota Capitale Senior: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 15, col))} | APP=${Math.round(-m.principalScheduled[y-1])}`);
        console.log(`FCFE SPV: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 18, col))} | APP=${Math.round(m.spvFCFE[y-1])}`);
        console.log(`Interessi Soci Pagati: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 23, col))} | APP=${Math.round(-m.holdcoInterestReceived[y-1])}`);
        console.log(`Dividendi SPV: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 24, col))} | APP=${Math.round(-m.holdcoDividendReceived[y-1])}`);
        console.log(`Rimborso Capitale Soci: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 25, col))} | APP=${Math.round(-m.holdcoLoanRepaymentReceived[y-1])}`);
        console.log(`Restituzione Riserve Capitale: XL=${Math.round(getHf('RENDICONTO FINANZIARIO SPV', 26, col))} | APP=${Math.round(-m.spvCapitalReserveReturned[y-1])}`);
    }

    console.log('\n=== CONFRONTO RENDICONTO FINANZIARIO HOLDING ===');
    for (let y = 1; y <= 5; y++) {
        const col = y + 1;
        console.log(`\n--- ANNO ${y} ---`);
        console.log(`Utile Netto HoldCo: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 3, col))} | APP=${Math.round(m.holdcoNetProfit[y-1])}`);
        console.log(`Cassa Ordinaria HoldCo: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 6, col))} | APP=${Math.round(m.holdcoOperatingCashflow[y-1])}`);
        console.log(`FCFE Investitore: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 13, col))} | APP=${Math.round(m.holdcoFCFE[y-1])}`);
    }

    console.log('\n--- ANNO 20 HOLDING (EXIT) ---');
    const col20 = 21;
    console.log(`Exit Proceeds: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 8, col20))} | APP=${Math.round(res.exitEquityValue || 0)}`);
    console.log(`Exit EV: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 9, col20))} | APP=${Math.round(res.exitEnterpriseValue || 0)}`);
    console.log(`FCFE Investitore Y20: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 13, col20))} | APP=${Math.round(m.holdcoFCFE[19])}`);
    console.log(`FCFE Cumulato Investitore Y20: XL=${Math.round(getHf('RENDICONTO FINANZIARIO HOLDING', 14, col20))} | APP=${Math.round(m.holdcoFCFECumulated[19])}`);
}

auditComparison().catch(console.error);
