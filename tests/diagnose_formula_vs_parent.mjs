import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
const excelExportPath = '/home/ubuntu/Asset/src/excelExport.js';
const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (70).xlsx';

async function diagnose() {
    console.log('=== DIAGNOSTICA: FORMULA VS VALORE CELLA PADRE VS APP ===');

    // 1. Carica il file 70 esistente per estrarre tutti i parametri e i dati dei driver
    const wbExisting = new ExcelJS.Workbook();
    await wbExisting.xlsx.readFile(excelPath);

    // Estrarre piante e capex da CAPEX
    const sCapex = wbExisting.getWorksheet('CAPEX');
    const plant1Name = String(sCapex.getRow(1).getCell(2).value || 'Guasticce (kW)');
    const plant2Name = String(sCapex.getRow(1).getCell(3).value || 'Castenaso (kW)');

    // 2. Worker setup
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

    // Profilo solare sintetico
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

    const sFin = wbExisting.getWorksheet('FINANZA');
    const getFinVal = (rowNum) => sFin.getCell(`B${rowNum}`).value;

    const inputs = {
        inflation: getFinVal(5) || 0.02,
        keVal: getFinVal(3) || 0.08,
        wacc: getFinVal(4) || 0.06,
        fiscalDeprRate: getFinVal(6) || 0.09,
        iresRate: getFinVal(7) || 0.24,
        irapRate: getFinVal(8) || 0.039,
        vatEnabled: true,
        vatFrequency: 'monthly',
        vatQuarterlyRefund: true,
        leverage: getFinVal(13) || 0.80,
        interestRate: getFinVal(14) || 0.045,
        debtBasis: 'total_capex',
        loanTerm: getFinVal(16) || 15,
        seniorGracePeriodMonths: getFinVal(20) || 12,
        constructionMonths: getFinVal(21) || 7,
        idcDrawdownFactor: (getFinVal(22) || 0.5) * 100,
        holdcoCapital: getFinVal(78) || 0,
        sociEquityPct: (getFinVal(36) || 1.0) * 100,
        sociInterestRate: (getFinVal(37) || 0.043) * 100,
        sociLoanTerm: getFinVal(40) || 10,
        sociCapitalGrace: getFinVal(39) || 0,
        sociInterestGrace: getFinVal(38) || 0,
        exitOption: String(getFinVal(79) || '0'),
        exitValuePerMwp: getFinVal(82) || 900000,
        exitEnterpriseValue: getFinVal(83) || 7367580,
        exitMultiple: getFinVal(81) || 10.16,
        priceScenarioType: 'base',
        distributionPolicy: 'dividend_plus_capital_reserve',
        dividendLock: false
    };

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
    const workerResult = lastMessage.results;

    // 3. Intercettazione formule ed esportazione
    let capturedPendingFormulas = [];
    let generatedBuffer = null;

    const windowMock = {
        State: {
            inputs: state.inputs,
            plants: state.plants,
            stabilimenti: state.stabilimenti,
            opexEvents: state.opexEvents,
            results: workerResult,
            branding: { company: 'Diagnostic Verification' }
        },
        _currentProjectName: 'Portafoglio Diagnostico',
        document: {
            createElement: () => ({ click: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        URL: {
            createObjectURL: () => 'blob:mock',
            revokeObjectURL: () => {}
        },
        showToast: console.log
    };

    const excelCode = fs.readFileSync(excelExportPath, 'utf8');

    // Creiamo una sandbox per excelExport che intercetta i pendingFormulas
    const sandboxExcel = {
        window: windowMock,
        ExcelJS,
        console,
        Blob: class { constructor(parts) { generatedBuffer = parts[0]; } },
        setTimeout: (fn) => fn(),
        document: windowMock.document
    };
    vm.createContext(sandboxExcel);
    vm.runInContext(excelCode, sandboxExcel);

    console.log('Esecuzione esportazione per analisi diagnostica...');
    await sandboxExcel.exportPnlToExcel();

    // 4. Carica l'Excel generato in HyperFormula
    const testXlsxPath = '/home/ubuntu/Asset/scratch/test_diag_export.xlsx';
    fs.writeFileSync(testXlsxPath, Buffer.from(generatedBuffer));

    const wbGenerated = new ExcelJS.Workbook();
    await wbGenerated.xlsx.readFile(testXlsxPath);

    const hfSheets = {};
    wbGenerated.worksheets.forEach(ws => {
        const matrix = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let c = 1; c <= ws.columnCount; c++) {
                const cell = row.getCell(c);
                let val = null;
                if (cell.formula) {
                    val = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
                } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    val = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
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

    console.log('\n======================================================');
    console.log('🔍 SCANSIONE COMPARATIVA RIGHE: APP (WORKER) VS EXCEL FORMULA');
    console.log('======================================================');

    // Modifichiamo per raccogliere pendingFormulas e confrontare pf.result vs hfVal
    const mismatches = [];

    // Intercetta tutte le righe di CONTO ECONOMICO
    const sCe = wbGenerated.getWorksheet('CONTO ECONOMICO');
    const sRf = wbGenerated.getWorksheet('RENDICONTO FINANZIARIO SPV');
    const sCeHc = wbGenerated.getWorksheet('CONTO ECONOMICO HOLDING');
    const sRfHc = wbGenerated.getWorksheet('RENDICONTO FINANZIARIO HOLDING');

    function checkSheetDiscrepancies(sheet, sheetName, appMatrixMap) {
        sheet.eachRow((row, rNum) => {
            const label = String(row.getCell(1).value || '').trim();
            if (!label || label.startsWith('DRIVER') || label.startsWith('CASCATA') || label.startsWith('SERVIZIO') || label.startsWith('1.') || label.startsWith('2.') || label.startsWith('3.') || label.startsWith('CALCOLO FISCALE')) return;

            // Trova la chiave corrispondente in appMatrixMap
            let keyMatch = null;
            for (const [key, testLabel] of Object.entries(appMatrixMap)) {
                if (label.toLowerCase().includes(testLabel.toLowerCase()) || testLabel.toLowerCase().includes(label.toLowerCase())) {
                    keyMatch = key;
                    break;
                }
            }

            if (!keyMatch || !workerResult.matrix[keyMatch]) return;

            const appArr = workerResult.matrix[keyMatch];

            for (let yr = 1; yr <= 20; yr++) {
                const colNum = yr + 1;
                const cell = row.getCell(colNum);
                const formula = cell.formula || (cell.value && typeof cell.value === 'object' ? cell.value.formula : null);
                const hfVal = getHf(sheetName, rNum, colNum);

                let appVal = appArr[yr - 1] !== undefined ? appArr[yr - 1] : 0;
                // Gestione segno per righe minus
                if (label.includes('(-)') && !label.includes('(-/+)')) {
                    appVal = -Math.abs(appVal);
                }

                const numHf = typeof hfVal === 'number' ? hfVal : 0;
                const diff = Math.round(numHf) - Math.round(appVal);

                if (Math.abs(diff) > 5) {
                    mismatches.push({
                        sheet: sheetName,
                        row: rNum,
                        label,
                        year: yr,
                        appKey: keyMatch,
                        excelVal: Math.round(numHf),
                        appVal: Math.round(appVal),
                        diff,
                        formula: formula || 'none'
                    });
                }
            }
        });
    }

    const ceLabels = {
        revenueTotal: 'RICAVI TOTALI SPV',
        revenueRid: 'Ricavi da RID generato da FV',
        opexTotal: 'COSTI OPERATIVI (OPEX) TOTALE SPV',
        opexPlants: 'O&M Impianti Fotovoltaici',
        opexInsurance: 'Assicurazione',
        opexTaxes: 'Tasse Locali / IMU',
        opexSecurity: 'Vigilanza & Sicurezza',
        ebitda: 'MARGINE OPERATIVO LORDO (EBITDA)',
        depreciationCivil: 'Ammortamento Civilistico',
        ebit: 'EBIT SPV',
        interest: 'Interessi Passivi Mutuo Bancario',
        sociInterestAccrued: 'Interessi Finanziamento Soci',
        ebt: 'EBT — Utile ante Imposte SPV',
        currentTaxesSpv: 'Imposte Correnti SPV',
        deferredTaxes: 'Variazione Imposte Differite',
        netProfitSpv: 'UTILE NETTO CIVILISTICO SPV'
    };

    const rfLabels = {
        cfads: 'CFADS SPV',
        interestPaid: 'Quota Interessi Mutuo Bancario Pagati',
        principalScheduled: 'Quota Capitale Mutuo Bancario Programmata',
        spvFCFE: 'CASSA DISPONIBILE POST-DEBITO SENIOR',
        holdcoInterestReceived: 'Interessi Soci Pagati da SPV a HoldCo',
        holdcoDividendReceived: 'Dividendi SPV Distribuiti a HoldCo',
        holdcoLoanRepaymentReceived: 'Rimborso Capitale Finanziamento Soci',
        spvCapitalReserveReturned: 'Restituzione Riserve di Capitale',
        spvCashTrapCumulative: 'SALDO TOTALE CASSA VINCOLATA RESIDUA'
    };

    const rfHcLabels = {
        holdcoNetProfit: 'Utile Netto Civilistico Holding',
        holdcoOperatingCashflow: 'CASSA GENERATA DALLA GESTIONE ORDINARIA HOLDING',
        exitEnterpriseValue: 'Enterprise Value di Exit',
        exitDebtPayoff: 'Rimborso Debito Residuo Mutuo Bancario',
        holdcoFCFE: 'FCFE — FLUSSO NETTO INVESTITORE',
        holdcoFCFECumulated: 'FCFE CUMULATO INVESTITORE'
    };

    checkSheetDiscrepancies(sCe, 'CONTO ECONOMICO', ceLabels);
    checkSheetDiscrepancies(sRf, 'RENDICONTO FINANZIARIO SPV', rfLabels);
    checkSheetDiscrepancies(sRfHc, 'RENDICONTO FINANZIARIO HOLDING', rfHcLabels);

    console.log(`\nDiscrepanze complessive (Δ > 5€) tra Formula Excel e App Worker: ${mismatches.length}`);

    // Raggruppa per riga per leggibilità
    const grouped = {};
    mismatches.forEach(m => {
        const key = `${m.sheet} -> R${m.row} [${m.label}]`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(m);
    });

    for (const [rowKey, diffs] of Object.entries(grouped)) {
        console.log(`\n🔴 ${rowKey}: ${diffs.length} anni discordanti`);
        console.log(`   Formula esempio: ${diffs[0].formula}`);
        diffs.slice(0, 4).forEach(d => {
            console.log(`   - Anno ${d.year}: Excel=${d.excelVal.toLocaleString('it-IT')} € vs App=${d.appVal.toLocaleString('it-IT')} € (Δ = ${d.diff.toLocaleString('it-IT')} €)`);
        });
        if (diffs.length > 4) {
            console.log(`   ... e altri ${diffs.length - 4} anni`);
        }
    }
}

diagnose().catch(console.error);
