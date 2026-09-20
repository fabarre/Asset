import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function auditFile73() {
    console.log('=== AUDIT FILE 73: CONTO ECONOMICO HOLDING & RENDICONTO FINANZIARIO SPV ===\n');

    const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (73).xlsx';
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(excelPath);

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
        { id: 'plant-guasticce', name: 'Guasticce (kW)', capacity: 4140.68, capex: 614.9654, connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p1Base, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' },
        { id: 'plant-castenaso', name: 'Castenaso (kW)', capacity: 4045.52, capex: 609.7752, connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687, cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512, generation: p2Base, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR' }
    ];
    const inputs = {
        inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
        iresRate: 0.24, irapRate: 0.039, leverage: 0.80, interestRate: 0.045, debtBasis: 'total_capex',
        loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
        sociEquityPct: 100, sociInterestRate: 4.3, sociLoanTerm: 10,
        sociPrincipalGrace: 0, sociInterestGrace: 0,
        distributionPolicy: 'civil_with_capital_reserve_return',
        dividendLock: 'NO',
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
    const pY1 = 99.30213531920911;
    const zonal = new Float64Array(8760).fill(pY1);
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun: { CNOR: zonal } };
    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const m = lastMsg.results.matrix;

    // -------------------------------------------------------------
    // 1. FOCUS: CONTO ECONOMICO HOLDING
    // -------------------------------------------------------------
    console.log('===============================================================');
    console.log('CONFRONTO FOGLIO: CONTO ECONOMICO HOLDING (Excel vs Web App)');
    console.log('===============================================================');
    const sCeHc = wb.getWorksheet('CONTO ECONOMICO HOLDING');
    
    // Test all rows with keys
    const ceHcRows = [
        { rNum: 3, label: 'Ricavi Gestione Amministrativa & Asset Mgmt', key: 'holdcoAssetMgmtFee' },
        { rNum: 4, label: 'TOTALE VALORE DELLA PRODUZIONE (A)', key: 'holdcoProductionValue' },
        { rNum: 6, label: 'Spese Generali HoldCo (OPEX)', key: 'holdcoGeneralExpenses', minus: true },
        { rNum: 7, label: 'Oneri Diversi: Quota Earn-Out Holding', key: 'holdcoEarnOut', minus: true },
        { rNum: 8, label: 'TOTALE COSTI DELLA PRODUZIONE (B)', key: 'holdcoProductionCosts', minus: true },
        { rNum: 9, label: 'EBIT HOLDCO (A - B)', key: 'holdcoOperatingEbit' },
        { rNum: 11, label: 'Proventi da Partecipazioni: Dividendi SPV', key: 'holdcoDividendsReceived' },
        { rNum: 12, label: 'Altri Proventi Finanziari: Interessi Fin. Soci', key: 'holdcoInterestReceived' },
        { rNum: 13, label: 'TOTALE PROVENTI E ONERI FINANZIARI (C)', key: 'holdcoFinancialNet' },
        { rNum: 14, label: 'EBT HOLDCO [ (A - B) + C ]', key: 'holdcoEbt' },
        { rNum: 16, label: 'Imposta IRES HoldCo', key: 'holdcoIresTax', minus: true },
        { rNum: 17, label: 'Imposta IRAP HoldCo', key: 'holdcoIrapTax', minus: true },
        { rNum: 18, label: 'TOTALE IMPOSTE SUL REDDITO', key: 'holdcoTaxTotal', minus: true },
        { rNum: 20, label: 'UTILE NETTO CIVILISTICO HOLDING', key: 'holdcoNetProfit' }
    ];

    ceHcRows.forEach(item => {
        const formulaY1 = sCeHc.getRow(item.rNum).getCell(2).formula;
        const formulaY2 = sCeHc.getRow(item.rNum).getCell(3).formula;
        const hfY1 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 2)) || 0);
        const hfY2 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 3)) || 0);
        const hfY12 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 13)) || 0);

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

        console.log(`R${String(item.rNum).padStart(2)} [${item.label.padEnd(46)}] | Y1: XL=${hfY1} App=${appY1} [${matchY1}] | Y2: XL=${hfY2} App=${appY2} [${matchY2}] | Y12: XL=${hfY12} App=${appY12} [${matchY12}]`);
        if (matchY1 !== 'OK' || matchY2 !== 'OK' || matchY12 !== 'OK') {
            console.log(`     Formula Y1: ${formulaY1}`);
            console.log(`     Formula Y2: ${formulaY2}`);
        }
    });

    // -------------------------------------------------------------
    // 2. FOCUS: RENDICONTO FINANZIARIO SPV (R18 - R30)
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log('CONFRONTO FOGLIO: RENDICONTO FINANZIARIO SPV (Righe 18-30)');
    console.log('===============================================================');
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    const rfRows = [
        { rNum: 18, label: 'CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV)', key: 'spvFCFE' },
        { rNum: 21, label: 'Accantonamento Riserva Legale SPV (5%)', key: 'legalReserveAccrual' },
        { rNum: 22, label: 'Capacità Distributiva Utili SPV Cumulata', key: 'distributableProfitsCumulated' },
        { rNum: 23, label: '(-) Interessi Soci Pagati da SPV a HoldCo', key: 'sociInterestPaid', minus: true },
        { rNum: 24, label: '(-) Rimborso Capitale Finanziamento Soci a HoldCo', key: 'sociPrincipalPaid', minus: true },
        { rNum: 25, label: '(-) Dividendi SPV Distribuiti a HoldCo', key: 'dividendsPaid', minus: true },
        { rNum: 26, label: '(-) Restituzione Riserve di Capitale a HoldCo', key: 'capitalReserveReturned', minus: true },
        { rNum: 28, label: 'Flusso Netto SPV non distribuito (Cash Trap Annuo)', key: 'cashTrapAnnual' },
        { rNum: 29, label: 'Cassa SPV Vincolata a Inizio Esercizio', key: 'cashTrapBeginning' },
        { rNum: 30, label: 'SALDO TOTALE CASSA VINCOLATA RESIDUA IN SPV', key: 'cashTrapBalance' }
    ];

    rfRows.forEach(item => {
        const formulaY1 = sRf.getRow(item.rNum).getCell(2).formula;
        const formulaY2 = sRf.getRow(item.rNum).getCell(3).formula;
        const hfY1 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 2)) || 0);
        const hfY2 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 3)) || 0);
        const hfY12 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 13)) || 0);

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

        console.log(`R${String(item.rNum).padStart(2)} [${item.label.padEnd(50)}] | Y1: XL=${hfY1} App=${appY1} [${matchY1}] | Y2: XL=${hfY2} App=${appY2} [${matchY2}] | Y12: XL=${hfY12} App=${appY12} [${matchY12}]`);
        if (matchY1 !== 'OK' || matchY2 !== 'OK' || matchY12 !== 'OK') {
            console.log(`     Formula Y1: ${formulaY1}`);
            console.log(`     Formula Y2: ${formulaY2}`);
        }
    });

    // -------------------------------------------------------------
    // 3. FOCUS: RIGA CALCOLO FISCALE DI SUPPORTO in CONTO ECONOMICO
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log('FOCUS: RIGA 35 CALCOLO FISCALE DI SUPPORTO in CONTO ECONOMICO');
    console.log('===============================================================');
    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    const r35 = sCe.getRow(35);
    console.log(`R35 Label: "${r35.getCell(1).value}"`);
    console.log(`R35 Y1 cell value:`, JSON.stringify(r35.getCell(2).value), `formula: ${r35.getCell(2).formula}`);
    console.log(`R35 Y2 cell value:`, JSON.stringify(r35.getCell(3).value), `formula: ${r35.getCell(3).formula}`);
}

auditFile73().catch(console.error);
