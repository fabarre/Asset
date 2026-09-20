import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function runDeepAudit() {
    console.log('=== AUDIT APPROFONDITO RIGA PER RIGA: CONTO ECONOMICO EXCEL VS WEB APP ===\n');

    // 1. Setup Worker simulation
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
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

    const p1 = sbW.generateDefaultSolarProfile(4.14068, 1631.11);
    const p2 = sbW.generateDefaultSolarProfile(4.04552, 1631.11);

    const plants = [
        {
            id: 'plant-guasticce', name: 'Guasticce (kW)', capacity: 4140.68, capex: 614.9654,
            connectionCost: 62240, spvAcquisitionCost: 460130, landType: 'dds_attualizzato', landCost: 433820,
            cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512,
            generation: p1, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        },
        {
            id: 'plant-castenaso', name: 'Castenaso (kW)', capacity: 4045.52, capex: 609.7752,
            connectionCost: 34943, spvAcquisitionCost: 440352, landType: 'acquisto', landCost: 436687,
            cod: '2027-07-01', codDate: '2027-07-01', enabled: true, specificYield: 1631.11, degradation: 0.003512,
            generation: p2, bessMw: 0, bessMwh: 0, marketType: 'rid', zone: 'CNOR'
        }
    ];

    const inputs = {
        inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
        iresRate: 0.24, irapRate: 0.039, leverage: 1.0, interestRate: 0.045, debtBasis: 'ev_ex_spv',
        loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
        sociEquityPct: 100, sociPctSpv: 100, sociInterestRate: 4.5445, sociLoanTerm: 10,
        sociPrincipalGrace: 0, sociInterestGrace: 0,
        distributionPolicy: 'civil_with_capital_reserve_return',
        dividendLock: false,
        holdcoCapital: 10000,
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

    const zonalPun = { CNOR: new Float64Array(8760).fill(99.30213531920911) };
    const state = { inputs, plants, stabilimenti: [], opexEvents, zonalPun };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    state.results = lastMsg.results;
    const m = state.results.matrix;

    // 2. Run Excel export
    const excelExportCode = fs.readFileSync('/home/ubuntu/Asset/src/excelExport.js', 'utf8');
    let exportedBuffer = null;

    const fakeWindow = {
        State: state,
        ExcelJS: ExcelJS,
        saveAs: (blob, filename) => {}
    };

    const modifiedExportCode = excelExportCode.replace(
        'const buffer = await workbook.xlsx.writeBuffer();',
        'const buffer = await workbook.xlsx.writeBuffer(); global.__exportedBuffer = buffer;'
    );

    const sbE = {
        window: fakeWindow,
        ExcelJS: ExcelJS,
        console,
        showToast: () => {},
        Blob: class {},
        Math, Date, JSON, Array, Object, Number, String, parseInt, parseFloat,
        global: {}
    };
    vm.createContext(sbE);
    vm.runInContext(modifiedExportCode, sbE);

    await sbE.exportPnlToExcel();
    exportedBuffer = sbE.global.__exportedBuffer;

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exportedBuffer);

    // Build HyperFormula
    const hfSheets = {};
    wb.worksheets.forEach(ws => {
        const sheetMatrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let col = 1; col <= ws.columnCount; col++) {
                const cell = row.getCell(col);
                let val = null;
                let rawF = cell.formula;
                if (!rawF && cell.value && typeof cell.value === 'object' && cell.value.formula) rawF = cell.value.formula;
                if (rawF) val = rawF.startsWith('=') ? rawF : '=' + rawF;
                else if (cell.value !== undefined && cell.value !== null) val = cell.value;
                rowData.push(val);
            }
            sheetMatrix.push(rowData);
        }
        hfSheets[ws.name] = sheetMatrix;
    });

    const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true });
    const getHf = (s, r, c) => {
        const raw = hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });
        if (typeof raw === 'object' && raw && raw.value !== undefined) return raw.value;
        return raw;
    };

    const sCe = wb.getWorksheet('CONTO ECONOMICO');
    console.log(`Numero di righe in CONTO ECONOMICO: ${sCe.rowCount}\n`);

    // Mappatura tra label/key di CONTO ECONOMICO e chiavi di matrix nel worker
    const rowMapping = [
        { label: 'RICAVI TOTALI SPV', key: 'revenueTotal' },
        { label: 'Ricavi da RID generato da FV', key: 'revenueRid' },
        { label: 'Ricavi da PPA', key: 'revenuePpa' },
        { label: 'Ricavi da Time Shifting', key: 'revenueTimeshifting' },
        { label: 'Ricavi da Arbitraggio', key: 'revenueArbitrage' },
        { label: 'Ricavi Servizi Ancillari BESS', key: 'revenueMsd' },
        { label: 'COSTI OPERATIVI (OPEX) TOTALE SPV', key: 'opexTotal', minus: true },
        { label: 'O&M Impianti Fotovoltaici', key: 'opexPlants', minus: true },
        { label: 'Costi Operativi BESS', key: 'opexBess', minus: true },
        { label: 'Costo Energia Pre-carica da Rete BESS', key: 'opexGridCharging', minus: true },
        { label: 'Canone DDS/Affitto Terreno', key: 'opexLandDds', minus: true },
        { label: 'Assicurazione (All Risk / RC)', key: 'opexInsurance', minus: true },
        { label: 'Tasse Locali / IMU', key: 'opexTaxes', minus: true },
        { label: 'Vigilanza & Sicurezza', key: 'opexSecurity', minus: true },
        { label: 'Gestione Amministrativa & Asset Mgt', key: 'opexAssetManagement', minus: true },
        { label: 'Contratto di Servizio Commerciale', key: 'opexServiceContract', minus: true },
        { label: 'MARGINE OPERATIVO LORDO (EBITDA)', key: 'ebitda' },
        { label: 'Ammortamento Civilistico', key: 'depreciationCivil', minus: true },
        { label: 'Ammortamento Impianti Solari', key: 'depreciationCivilSolar', minus: true },
        { label: 'Ammortamento BESS', key: 'depreciationCivilBess', minus: true },
        { label: 'Ammortamento Altri Costi Capitalizzati', key: 'depreciationCivilOther', minus: true },
        { label: 'EBIT SPV (Risultato Operativo)', key: 'ebit' },
        { label: 'Interessi Attivi su MRA', key: 'interestActive' },
        { label: 'Interessi Passivi Mutuo Bancario', key: 'interest', minus: true },
        { label: 'Interessi Finanziamento Soci (Accrual)', key: 'sociInterestAccrued', minus: true },
        { label: 'EBT — Utile ante Imposte SPV', key: 'ebt' },
        { label: 'Amm.to Fiscale Base - anno 1 al 50%', key: 'taxFiscalDeprBase', fiscal: true },
        { label: 'Base Fiscale Residua', key: 'taxFiscalRemaining', fiscal: true },
        { label: 'Amm.to Fiscale Totale', key: 'taxFiscalDepr', fiscal: true },
        { label: 'ROL 30% EBITDA - Art. 96', key: 'rolCapacity', fiscal: true },
        { label: 'Interessi Passivi Netti - Art. 96', key: 'taxNetInterest', fiscal: true },
        { label: 'Interessi Deducibili - Art. 96', key: 'deductibleInterest', fiscal: true },
        { label: 'ROL Riportato a Nuovo - Art. 96', key: 'rolCF', fiscal: true },
        { label: 'Imponibile IRES Lordo', key: 'taxTaxableIres', fiscal: true },
        { label: 'Imponibile IRES Netto - post NOL', key: 'taxTaxableFinal', fiscal: true },
        { label: 'Quota IDC in Amm.to Civilistico - IRAP', key: 'taxCivilIdc', fiscal: true },
        { label: 'Base Imponibile IRAP', key: 'taxableIrap', fiscal: true },
        { label: 'Delta Amm.to x Aliquote', key: 'taxDeferredRaw', fiscal: true },
        { label: 'Imposte Correnti SPV', key: 'currentTaxesSpv', minus: true },
        { label: 'IRES', key: 'iresTaxSpv' },
        { label: 'IRAP', key: 'irapTaxSpv' },
        { label: 'Variazione Imposte Differite', key: 'deferredTaxes' },
        { label: 'Fondo Imposte Differite - saldo', key: 'taxDeferredFund', fiscal: true },
        { label: 'UTILE NETTO CIVILISTICO SPV', key: 'netProfitSpv' }
    ];

    let totalTests = 0, passedTests = 0, failedTests = 0;
    const discrepancies = [];

    sCe.eachRow((row, rNum) => {
        const labelCell = row.getCell(1).value;
        if (!labelCell || typeof labelCell !== 'string') return;

        // Cerca mapping
        const match = rowMapping.find(rm => labelCell.includes(rm.label));
        if (!match) return;

        const formulaY0 = row.getCell(2).formula;
        const formulaY1 = row.getCell(3).formula;

        // Se è una riga con key nel worker matrix
        const workerArr = m[match.key] || [];

        let rowDiscrepancies = 0;
        const details = [];

        for (let yr = 0; yr <= 20; yr++) {
            totalTests++;
            const col = yr + 2; // col 2 è Anno 0 (col B), col 3 è Anno 1 (col C), ecc.
            const xlVal = Math.round(Number(getHf('CONTO ECONOMICO', rNum, col)) || 0);
            let appVal = workerArr[yr] !== undefined ? workerArr[yr] : 0;
            if (match.minus) appVal = -Math.abs(appVal);
            appVal = Math.round(appVal);

            const delta = xlVal - appVal;
            if (Math.abs(delta) > 5) {
                rowDiscrepancies++;
                failedTests++;
                if (details.length < 4) {
                    details.push(`Y${yr}: XL=${xlVal}, App=${appVal} (Δ=${delta})`);
                }
            } else {
                passedTests++;
            }
        }

        const status = rowDiscrepancies === 0 ? '✅ OK (21/21)' : `❌ ${rowDiscrepancies}/21 DISCORDANTI`;
        console.log(`R${String(rNum).padStart(2)} [${labelCell.slice(0, 42).padEnd(42)}] -> ${status}`);
        if (rowDiscrepancies > 0) {
            console.log(`     Dettagli: ${details.join(' | ')}`);
            console.log(`     Formula Y0: ${formulaY0 || '(Nessuna formula / valore statico)'}`);
            console.log(`     Formula Y1: ${formulaY1 || '(Nessuna formula / valore statico)'}`);
            discrepancies.push({ rNum, label: labelCell, key: match.key, formulaY0, formulaY1, details });
        }
    });

    console.log(`\n===============================================================`);
    console.log(`RIEPILOGO AUDIT CONTO ECONOMICO:`);
    console.log(`Totale controlli (righe x 20 anni): ${totalTests}`);
    console.log(`Test superati: ${passedTests} (${((passedTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`Test falliti: ${failedTests}`);
    console.log(`===============================================================\n`);

    if (discrepancies.length > 0) {
        console.log('LISTA DISCREPANZE DA RISOLVERE:');
        discrepancies.forEach((d, i) => {
            console.log(`${i+1}. R${d.rNum} [${d.label}] (key: ${d.key}):`);
            console.log(`   Discrepanze: ${d.details.join(', ')}`);
            console.log(`   Formula Y1: ${d.formulaY1}`);
            console.log(`   Formula Y2: ${d.formulaY2}`);
        });
    }
}

runDeepAudit().catch(console.error);
