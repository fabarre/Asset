import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

async function runWaterfallAudit() {
    console.log('=== AUDIT RENDICONTO FINANZIARIO SPV: CASCATA DISTRIBUZIONE (WATERFALL) ===\n');

    const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';
    const excelExportPath = '/home/ubuntu/Asset/src/excelExport.js';

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

    const policies = [
        'civil_with_capital_reserve_return',
        'civil_statutory_strict',
        'cash_flow_driven'
    ];

    for (const policy of policies) {
        console.log(`\n======================================================`);
        console.log(`TEST POLICY: ${policy}`);
        console.log(`======================================================`);

        const inputs = {
            inflation: 0.02, keVal: 0.08, wacc: 0.06, fiscalDeprRate: 0.09,
            iresRate: 0.24, irapRate: 0.039, leverage: 0.80, interestRate: 0.045, debtBasis: 'total_capex',
            loanTerm: 15, seniorGracePeriodMonths: 12, constructionMonths: 7, idcDrawdownFactor: 50,
            sociEquityPct: 100, sociInterestRate: 4.3, sociLoanTerm: 10,
            sociPrincipalGrace: 0, sociInterestGrace: 0,
            distributionPolicy: policy,
            dividendLock: false,
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
                { id: 'ev6', label: 'O&M FV Castenaso', amount: 58364.55, month: 7, rule: 'gt_cod', enabled: true },
                { id: 'ev7', label: 'Assicurazione Castenaso', amount: 14591.14, month: 7, rule: 'gt_cod', enabled: true },
                { id: 'ev8', label: 'IMU Castenaso Acconto', amount: 5000, month: 6, rule: 'sempre', enabled: true },
                { id: 'ev9', label: 'IMU Castenaso Saldo', amount: 5000, month: 12, rule: 'sempre', enabled: true },
                { id: 'ev10', label: 'Security Castenaso', amount: 3672, month: 7, rule: 'gt_cod', enabled: true }
            ]
        };

        const pY1 = 99.30213531920911;
        const zonal = new Float64Array(8760).fill(pY1);
        const state = {
            inputs, plants, stabilimenti: [], opexEvents,
            zonalPun: { NORD: zonal, CNOR: zonal, CSUD: zonal, SUD: zonal, SICI: zonal, SARD: zonal }
        };

        sbW.self.onmessage({ data: { action: 'EXECUTE_CALCULATION', payload: { State: state } } });
        const results = lastMsg.results;
        const m = results.matrix;
        const d = results.debtSchedule;

        // Run excel export in sandbox
        let genBuf = null;
        const mockWindow = {
            State: {
                inputs, plants, stabilimenti: [], opexEvents, results,
                financialModels: { currentModel: { id: 'test' } },
                branding: { company: 'Test Verification' }
            },
            _currentProjectName: 'Test Waterfall Verified',
            document: {
                createElement: () => ({ click: () => {} }),
                body: { appendChild: () => {}, removeChild: () => {} }
            },
            URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
            showToast: () => {}
        };
        const exportSandbox = {
            window: mockWindow, document: mockWindow.document,
            ExcelJS, console,
            Blob: class { constructor(parts) { genBuf = parts[0]; } },
            setTimeout: (fn) => fn(), alert: console.log
        };
        vm.createContext(exportSandbox);
        const exportCode = fs.readFileSync(excelExportPath, 'utf8');
        vm.runInContext(exportCode, exportSandbox);

        await exportSandbox.exportPnlToExcel();
        const exportedWorkbook = new ExcelJS.Workbook();
        await exportedWorkbook.xlsx.load(Buffer.from(genBuf));

        const sRf = exportedWorkbook.getWorksheet('RENDICONTO FINANZIARIO SPV');
        const hfSheets = {};
        exportedWorkbook.worksheets.forEach(ws => {
            const matrix = [];
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
                matrix.push(rowData);
            }
            hfSheets[ws.name] = matrix;
        });

        const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useColumnIndex: true });
        const getHf = (s, r, c) => {
            const raw = hf.getCellValue({ col: c - 1, row: r - 1, sheet: hf.getSheetId(s) });
            if (typeof raw === 'object' && raw && raw.value !== undefined) return raw.value;
            return raw;
        };

        // Find row numbers in sheetRf
        const rowMap = {};
        for (let r = 1; r <= sRf.rowCount; r++) {
            const label = sRf.getRow(r).getCell(1).value;
            if (typeof label === 'string') {
                if (label.includes('Accantonamento Riserva Legale SPV')) rowMap.spvLegalReserveAccrual = r;
                else if (label.includes('Capacità Distributiva Utili SPV')) rowMap.spvRetainedEarnings = r;
                else if (label.includes('Interessi Soci Pagati da SPV')) rowMap.holdcoInterestReceived = r;
                else if (label.includes('Rimborso Capitale Finanziamento Soci a HoldCo')) rowMap.holdcoLoanRepaymentReceived = r;
                else if (label.includes('Dividendi SPV Distribuiti a HoldCo')) rowMap.holdcoDividendReceived = r;
                else if (label.includes('Restituzione Riserve di Capitale')) rowMap.spvCapitalReserveReturned = r;
                else if (label.includes('Flusso Netto SPV non distribuito')) rowMap.spvCashTrap = r;
                else if (label.includes('Cassa SPV Vincolata a Inizio')) rowMap.spvLockedDividends = r;
                else if (label.includes('SALDO TOTALE CASSA VINCOLATA IN SPV')) rowMap.spvCashTrapCumulative = r;
            }
        }

        console.log('Detected RF Row Map:');
        for (const [k, r] of Object.entries(rowMap)) {
            console.log(`  ${k}: Row ${r}`);
        }

        const waterfallKeys = [
            'spvLegalReserveAccrual',
            'spvRetainedEarnings',
            'holdcoInterestReceived',
            'holdcoLoanRepaymentReceived',
            'holdcoDividendReceived',
            'spvCapitalReserveReturned',
            'spvCashTrap',
            'spvLockedDividends',
            'spvCashTrapCumulative'
        ];

        let passCount = 0;
        let failCount = 0;

        for (const key of waterfallKeys) {
            const r = rowMap[key];
            if (!r) {
                console.error(`Row not found for key: ${key}`);
                failCount += 21;
                continue;
            }
            let rowPass = true;
            let maxDelta = 0;
            for (let yr = 0; yr <= 20; yr++) {
                const col = yr + 2; // Col 2 is Anno 0, Col 3 is Anno 1, etc.
                const hfVal = getHf('RENDICONTO FINANZIARIO SPV', r, col);
                const workerVal = m[key] ? m[key][yr] : 0;
                
                // Note: in RF, outflows are displayed as negative in Excel
                const expectedSign = (key === 'holdcoInterestReceived' || key === 'holdcoLoanRepaymentReceived' || key === 'holdcoDividendReceived' || key === 'spvCapitalReserveReturned') ? -1 : 1;
                const expectedHfVal = expectedSign * workerVal;

                const delta = Math.abs(hfVal - expectedHfVal);
                const relDelta = Math.abs(expectedHfVal) > 1 ? delta / Math.abs(expectedHfVal) : delta;
                if (delta > maxDelta) maxDelta = delta;
                if (delta > 10.0 && relDelta > 0.0005) { // 10 euro or 0.05% tolerance for cumulative floating point across 20 years
                    rowPass = false;
                    failCount++;
                    console.log(`  [FAIL] ${key} Y${yr}: HF=${hfVal.toFixed(2)}, Worker=${workerVal.toFixed(2)}, Expected=${expectedHfVal.toFixed(2)}, Delta=${delta.toFixed(2)}`);
                } else {
                    passCount++;
                }
            }
            if (rowPass) {
                console.log(`  [OK] ${key.padEnd(28)}: 21/21 passed (max delta: ${maxDelta.toFixed(4)} €)`);
            }
        }

        console.log(`\nPolicy Summary: ${passCount} passed, ${failCount} failed.`);
    }
}

runWaterfallAudit().catch(console.error);
