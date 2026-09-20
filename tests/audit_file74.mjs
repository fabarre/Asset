import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function auditFile74() {
    console.log('=== AUDIT COMPLETO FILE 74 (Focus: CONTO ECONOMICO HOLDING) ===\n');

    const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (74).xlsx';
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
    const getHf = (s, r, c) => {
        const raw = hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });
        if (typeof raw === 'object' && raw && raw.value !== undefined) return raw.value;
        return raw;
    };

    // Worker setup
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const workerCode = fs.readFileSync(workerPath, 'utf8');
    let lastMsg = null;
    const sbW = { self: { postMessage: (m) => { lastMsg = m; } }, console, structuredClone: global.structuredClone, Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String, Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN };
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
    const m = lastMsg.results.matrix;

    console.log('========================================================================================');
    console.log('CONFRONTO FOGLIO: CONTO ECONOMICO HOLDING (Excel File 74 vs Web App)');
    console.log('========================================================================================');
    const sCeHc = wb.getWorksheet('CONTO ECONOMICO HOLDING');
    const ceHcRows = [
        { rNum: 3, label: 'Ricavi Gestione Amministrativa & Asset Mgmt', key: 'opexAssetManagement' },
        { rNum: 4, label: 'TOTALE VALORE DELLA PRODUZIONE (A)', key: 'holdcoProductionValue' },
        { rNum: 6, label: 'Spese Generali HoldCo (OPEX)', key: 'holdcoOpex', minus: true },
        { rNum: 7, label: 'Oneri Diversi: Quota Earn-Out Holding', key: 'holdcoEarnoutPaid', minus: true },
        { rNum: 8, label: 'TOTALE COSTI DELLA PRODUZIONE (B)', key: 'holdcoProductionCosts', minus: true },
        { rNum: 9, label: 'EBIT HOLDCO (A - B)', key: 'holdcoOperatingEbit' },
        { rNum: 11, label: 'Proventi da Partecipazioni: Dividendi SPV', key: 'holdcoDividendReceived' },
        { rNum: 12, label: 'Altri Proventi Finanziari: Interessi Fin. Soci', key: 'holdcoInterestReceived' },
        { rNum: 13, label: 'TOTALE PROVENTI E ONERI FINANZIARI (C)', key: 'holdcoFinancialNet' },
        { rNum: 14, label: 'EBT HOLDCO [ (A - B) + C ]', key: 'holdcoEbt' },
        { rNum: 16, label: 'Imposta IRES HoldCo', key: 'holdcoIresTaxPaid', minus: true },
        { rNum: 17, label: 'Imposta IRAP HoldCo', key: 'holdcoIrapTaxPaid', minus: true },
        { rNum: 18, label: 'TOTALE IMPOSTE SUL REDDITO', key: 'holdcoTaxTotal', minus: true },
        { rNum: 20, label: 'UTILE NETTO CIVILISTICO HOLDING', key: 'holdcoNetProfit' }
    ];

    ceHcRows.forEach(item => {
        const formulaY1 = sCeHc.getRow(item.rNum).getCell(2).formula;
        const formulaY2 = sCeHc.getRow(item.rNum).getCell(3).formula;
        const hfY1 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 2)) || 0);
        const hfY2 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 3)) || 0);
        const hfY5 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 6)) || 0);
        const hfY6 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 7)) || 0);
        const hfY10 = Math.round(Number(getHf('CONTO ECONOMICO HOLDING', item.rNum, 11)) || 0);

        const arr = m[item.key];
        const getVal = (idx) => {
            if (!arr || arr[idx] === undefined) return '-';
            let v = arr[idx];
            if (item.minus) v = -Math.abs(v);
            return Math.round(v);
        };
        const appY1 = getVal(0);
        const appY2 = getVal(1);
        const appY5 = getVal(4);
        const appY6 = getVal(5);
        const appY10 = getVal(9);

        const ok1 = typeof appY1 === 'number' ? Math.abs(hfY1 - appY1) <= 2 : false;
        const ok2 = typeof appY2 === 'number' ? Math.abs(hfY2 - appY2) <= 2 : false;
        const ok5 = typeof appY5 === 'number' ? Math.abs(hfY5 - appY5) <= 2 : false;
        const ok6 = typeof appY6 === 'number' ? Math.abs(hfY6 - appY6) <= 2 : false;
        const ok10 = typeof appY10 === 'number' ? Math.abs(hfY10 - appY10) <= 2 : false;

        console.log(`R${String(item.rNum).padStart(2)} [${item.label.slice(0, 42).padEnd(42)}] | Y1: XL=${String(hfY1).padStart(7)} App=${String(appY1).padStart(7)} [${ok1?'OK':'FAIL'}] | Y2: XL=${String(hfY2).padStart(7)} App=${String(appY2).padStart(7)} [${ok2?'OK':'FAIL'}] | Y5: XL=${String(hfY5).padStart(7)} App=${String(appY5).padStart(7)} [${ok5?'OK':'FAIL'}] | Y6: XL=${String(hfY6).padStart(7)} App=${String(appY6).padStart(7)} [${ok6?'OK':'FAIL'}]`);
        if (!ok1 || !ok2 || !ok5 || !ok6) {
            console.log(`     Formula Y1: ${formulaY1}`);
            console.log(`     Formula Y2: ${formulaY2}`);
        }
    });

    console.log('\n========================================================================================');
    console.log('CONFRONTO FOGLIO: RENDICONTO FINANZIARIO SPV (Excel File 74 vs Web App)');
    console.log('========================================================================================');
    const sRf = wb.getWorksheet('RENDICONTO FINANZIARIO SPV');
    const rfRows = [
        { rNum: 18, label: 'CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV)', key: 'spvFCFE' },
        { rNum: 21, label: 'Accantonamento Riserva Legale SPV (5%)', key: 'spvLegalReserveAccrual' },
        { rNum: 22, label: 'Capacità Distributiva Utili SPV Cumulata', key: 'spvRetainedEarnings' },
        { rNum: 23, label: '(-) Interessi Soci Pagati da SPV a HoldCo', key: 'holdcoInterestReceived', minus: true },
        { rNum: 24, label: '(-) Rimborso Capitale Finanziamento Soci a HoldCo', key: 'holdcoLoanRepaymentReceived', minus: true },
        { rNum: 25, label: '(-) Dividendi SPV Distribuiti a HoldCo', key: 'holdcoDividendReceived', minus: true },
        { rNum: 26, label: '(-) Restituzione Riserve di Capitale a HoldCo', key: 'spvCapitalReserveReturned', minus: true },
        { rNum: 28, label: 'Flusso Netto SPV non distribuito (Cash Trap Annuo)', key: 'spvCashTrap' },
        { rNum: 29, label: 'Cassa SPV Vincolata a Inizio Esercizio', key: 'spvLockedDividends' },
        { rNum: 30, label: 'SALDO TOTALE CASSA VINCOLATA RESIDUA IN SPV', key: 'spvCashTrapCumulative' }
    ];

    rfRows.forEach(item => {
        const hfY1 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 2)) || 0);
        const hfY2 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 3)) || 0);
        const hfY5 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 6)) || 0);
        const hfY6 = Math.round(Number(getHf('RENDICONTO FINANZIARIO SPV', item.rNum, 7)) || 0);
        const arr = m[item.key];
        const getVal = (idx) => {
            if (!arr || arr[idx] === undefined) return '-';
            let v = arr[idx];
            if (item.minus) v = -Math.abs(v);
            return Math.round(v);
        };
        const appY1 = getVal(0);
        const appY2 = getVal(1);
        const appY5 = getVal(4);
        const appY6 = getVal(5);

        const ok1 = typeof appY1 === 'number' ? Math.abs(hfY1 - appY1) <= 2 : false;
        const ok2 = typeof appY2 === 'number' ? Math.abs(hfY2 - appY2) <= 2 : false;
        const ok5 = typeof appY5 === 'number' ? Math.abs(hfY5 - appY5) <= 2 : false;
        const ok6 = typeof appY6 === 'number' ? Math.abs(hfY6 - appY6) <= 2 : false;

        console.log(`R${String(item.rNum).padStart(2)} [${item.label.slice(0, 45).padEnd(45)}] | Y1: XL=${String(hfY1).padStart(7)} App=${String(appY1).padStart(7)} [${ok1?'OK':'FAIL'}] | Y2: XL=${String(hfY2).padStart(7)} App=${String(appY2).padStart(7)} [${ok2?'OK':'FAIL'}] | Y5: XL=${String(hfY5).padStart(7)} App=${String(appY5).padStart(7)} [${ok5?'OK':'FAIL'}] | Y6: XL=${String(hfY6).padStart(7)} App=${String(appY6).padStart(7)} [${ok6?'OK':'FAIL'}]`);
    });
}

auditFile74().catch(console.error);
