import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function testExport() {
    console.log('Testing export with verified code...');
    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const excelExportPath = '/home/ubuntu/Asset/src/excelExport.js';

    // Worker execution
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

    const p1Base = sbW.generateDefaultSolarProfile(4.14068, 1450);
    const p2Base = sbW.generateDefaultSolarProfile(4.04552, 1400);

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
        inflation: 0.02,
        keVal: 0.08,
        wacc: 0.06,
        fiscalDeprRate: 0.09,
        iresRate: 0.24,
        irapRate: 0.039,
        vatEnabled: true,
        vatFrequency: 'monthly',
        vatQuarterlyRefund: true,
        leverage: 0.80,
        interestRate: 0.045,
        debtBasis: 'total_capex',
        loanTerm: 15,
        seniorGracePeriodMonths: 12,
        constructionMonths: 7,
        idcDrawdownFactor: 50,
        holdcoCapital: 0,
        sociEquityPct: 100,
        sociInterestRate: 4.3,
        sociLoanTerm: 10,
        sociCapitalGrace: 0,
        sociInterestGrace: 0,
        exitOption: 'mwp',
        exitYear: 20,
        exitValuePerMwp: 900000,
        exitEnterpriseValue: 7367580,
        exitMultiple: 10.16,
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
        inputs, plants, stabilimenti: [], opexEvents,
        zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
    };

    sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
    const workerRes = lastMsg.results;

    let genBuf = null;
    const winMock = {
        State: {
            inputs: state.inputs,
            plants: state.plants,
            stabilimenti: state.stabilimenti,
            opexEvents: state.opexEvents,
            results: workerRes,
            branding: { company: 'Test Verification' }
        },
        _currentProjectName: 'Test File 70 Verified',
        document: {
            createElement: () => ({ click: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} }
        },
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
        showToast: () => {}
    };

    const excelCode = fs.readFileSync(excelExportPath, 'utf8');
    const sbE = {
        window: winMock, ExcelJS, console,
        Blob: class { constructor(parts) { genBuf = parts[0]; } },
        setTimeout: (fn) => fn(),
        document: winMock.document
    };
    vm.createContext(sbE);
    vm.runInContext(excelCode, sbE);

    await sbE.exportPnlToExcel();
    fs.writeFileSync('/home/ubuntu/Asset/scratch/test_file70_verified.xlsx', Buffer.from(genBuf));
    console.log('Workbook scritto in scratch/test_file70_verified.xlsx (size:', genBuf.length, 'bytes)');

    // HyperFormula verification
    const wbNew = new ExcelJS.Workbook();
    await wbNew.xlsx.readFile('/home/ubuntu/Asset/scratch/test_file70_verified.xlsx');

    const hfSheets = {};
    wbNew.worksheets.forEach(ws => {
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
        licenseKey: 'gpl-v3', useColumnIndex: true, precisionRounding: 6
    });
    const getHf = (sheetName, r, c) => {
        const sId = hf.getSheetId(sheetName);
        return hf.getCellValue({ col: c - 1, row: r - 1, sheet: sId });
    };

    console.log('\n--- VERIFICA HYPERFORMULA SUL NUOVO EXCEL ---');
    console.log('FINANZA B79 (Exit Year):', getHf('FINANZA', 79, 2));
    console.log('FINANZA B80 (Exit Option):', getHf('FINANZA', 80, 2));
    console.log('FINANZA B82 (Exit MWp):', getHf('FINANZA', 82, 2));

    const sRfHc = wbNew.getWorksheet('RENDICONTO FINANZIARIO HOLDING');
    let exitRow = null;
    let fcfeRow = null;
    sRfHc.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '');
        if (lbl.includes('Enterprise Value di Exit')) exitRow = rNum;
        if (lbl.includes('FCFE — FLUSSO NETTO INVESTITORE')) fcfeRow = rNum;
    });

    console.log('Exit Row in RF Holding:', exitRow, 'FCFE Row:', fcfeRow);
    const evY20 = getHf('RENDICONTO FINANZIARIO HOLDING', exitRow, 21);
    const fcfeY20 = getHf('RENDICONTO FINANZIARIO HOLDING', fcfeRow, 21);
    console.log('Y20 Enterprise Value di Exit:', typeof evY20 === 'number' ? Math.round(evY20).toLocaleString('it-IT') + ' €' : evY20);
    console.log('Y20 FCFE Investitore:', typeof fcfeY20 === 'number' ? Math.round(fcfeY20).toLocaleString('it-IT') + ' €' : fcfeY20);

    // Check CE EBITDA vs worker EBITDA
    const sCe = wbNew.getWorksheet('CONTO ECONOMICO');
    let ebitdaRow = null;
    sCe.eachRow((r, rNum) => {
        if (String(r.getCell(1).value || '').includes('MARGINE OPERATIVO LORDO (EBITDA)')) ebitdaRow = rNum;
    });
    console.log('\nEBITDA Comparison (Excel formula vs Worker):');
    let ebitdaMatches = 0;
    for (let y = 1; y <= 20; y++) {
        const xlVal = getHf('CONTO ECONOMICO', ebitdaRow, y + 1);
        const wVal = workerRes.matrix.ebitda[y - 1];
        const diff = Math.round(xlVal) - Math.round(wVal);
        if (Math.abs(diff) <= 2) {
            ebitdaMatches++;
        } else {
            console.log(`  Y${y}: XL=${Math.round(xlVal)} vs Worker=${Math.round(wVal)} (diff=${diff})`);
        }
    }
    console.log(`EBITDA allineato su ${ebitdaMatches}/20 anni.`);

    // Check RF SPV seniority: verify row ordering of loan repayment vs dividends
    const sRf = wbNew.getWorksheet('RENDICONTO FINANZIARIO SPV');
    let rLoanRepay = null;
    let rDiv = null;
    sRf.eachRow((r, rNum) => {
        const lbl = String(r.getCell(1).value || '');
        if (lbl.includes('Rimborso Capitale Finanziamento Soci')) rLoanRepay = rNum;
        if (lbl.includes('Dividendi SPV Distribuiti')) rDiv = rNum;
    });
    console.log('\nSeniority check in RF SPV:');
    console.log(`  Rimborso Capitale Soci Row: R${rLoanRepay}`);
    console.log(`  Dividendi SPV Row: R${rDiv}`);
    if (rLoanRepay < rDiv) {
        console.log('  ✅ Seniority Corretta: Rimborso Capitale Soci precede i Dividendi!');
    } else {
        console.log('  ❌ Errore Seniority: Dividendi precedono il Rimborso Capitale!');
    }
}

testExport().catch(console.error);
