import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const dumpPath = '/home/ubuntu/Asset/scratch/web_app_state_dump.json';
const excelPath = '/home/ubuntu/Asset/PL_Driver_Operativi (70).xlsx';

async function compare() {
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
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

    console.log('=== CONFRONTO INPUT APP VS INPUT EXCEL ===');
    console.log('App Project:', dump.projectName);
    console.log('App exitOption:', dump.inputs.exitOption);
    console.log('App exitValuePerMwp:', dump.inputs.exitValuePerMwp);
    console.log('App exitMultiple:', dump.inputs.exitMultiple);
    console.log('App exitEnterpriseValue:', dump.inputs.exitEnterpriseValue);
    console.log('App exitYear:', dump.results.exitYear);
    console.log('App exitEv Result:', dump.results.exitEnterpriseValue);
    console.log('App exitEquity Result:', dump.results.exitEquityValue);

    const sFin = wb.getWorksheet('FINANZA');
    const xlExitYear = getHf('FINANZA', 79, 2);
    const xlExitOpt = getHf('FINANZA', 80, 2);
    const xlExitMwp = getHf('FINANZA', 82, 2);
    console.log('Excel FINANZA Exit Year (B79):', xlExitYear);
    console.log('Excel FINANZA Exit Option (B80):', xlExitOpt);
    console.log('Excel FINANZA Exit MWp (B82):', xlExitMwp);

    // 2. CONFRONTO CONTO ECONOMICO
    console.log('\n=== CONFRONTO CONTO ECONOMICO (20 ANNI) ===');
    const m = dump.results.matrix;
    const sCe = wb.getWorksheet('CONTO ECONOMICO');

    // Mapping rows in CONTO ECONOMICO
    const ceMappings = [
        { label: 'Ricavi Totali', xlRow: 2, appKey: 'revenues' },
        { label: 'OPEX Totali', xlRow: 9, appKey: 'opexTotal', negate: true },
        { label: 'EBITDA', xlRow: 20, appKey: 'ebitda' },
        { label: 'Ammortamento Civilistico', xlRow: 22, appKey: 'depreciationTotal', negate: true },
        { label: 'EBIT SPV', xlRow: 27, appKey: 'ebit' },
        { label: 'Interessi Bancari Senior', xlRow: 30, appKey: 'seniorInterest', negate: true },
        { label: 'Interessi Soci Accrual', xlRow: 31, appKey: 'sociInterest', negate: true },
        { label: 'EBT SPV', xlRow: 33, appKey: 'ebt' },
        { label: 'Ammortamento Fiscale Totale', xlRow: 40, appKey: 'fiscalDepreciation' },
        { label: 'Imposte Correnti (IRES+IRAP)', xlRow: 55, appKey: 'taxes', negate: true },
        { label: 'Variazione Imposte Differite', xlRow: 58, appKey: 'deferredTaxVariation' },
        { label: 'Utile Netto Civilistico SPV', xlRow: 61, appKey: 'netIncome' },
    ];

    ceMappings.forEach(mapping => {
        const appArr = m[mapping.appKey] || [];
        const diffs = [];
        for (let y = 1; y <= 20; y++) {
            const col = y + 1; // Col B is Year 1
            const xlVal = getHf('CONTO ECONOMICO', mapping.xlRow, col);
            let appVal = appArr[y - 1] !== undefined ? appArr[y - 1] : 0;
            if (mapping.negate) appVal = -Math.abs(appVal);

            const numXl = typeof xlVal === 'number' ? xlVal : 0;
            const diff = Math.round(numXl) - Math.round(appVal);
            if (Math.abs(diff) > 2) {
                diffs.push(`Y${y}: XL=${Math.round(numXl).toLocaleString('it-IT')} vs APP=${Math.round(appVal).toLocaleString('it-IT')} (Δ=${diff.toLocaleString('it-IT')})`);
            }
        }
        if (diffs.length === 0) {
            console.log(`✓ ${mapping.label}: PERFETTAMENTE ALLINEATO (Δ <= 2€ su tutti i 20 anni)`);
        } else {
            console.log(`❌ ${mapping.label} (Riga ${mapping.xlRow}): ${diffs.length} DISCREPANZE!`);
            diffs.slice(0, 5).forEach(d => console.log(`   - ${d}`));
            if (diffs.length > 5) console.log(`   ... e altri ${diffs.length - 5} anni con scostamento`);
        }
    });

    // 3. CONFRONTO RENDICONTO FINANZIARIO SPV
    console.log('\n=== CONFRONTO RENDICONTO FINANZIARIO SPV ===');
    const rfMappings = [
        { label: 'CFADS SPV', xlRow: 11, appKey: 'cfads' },
        { label: 'Interessi Mutuo Senior Pagati', xlRow: 14, appKey: 'seniorInterestPaid', negate: true },
        { label: 'Quota Capitale Mutuo Senior', xlRow: 15, appKey: 'seniorPrincipalPaid', negate: true },
        { label: 'Cash Sweep Volontario', xlRow: 16, appKey: 'cashSweepPaid', negate: true },
        { label: 'FCFE SPV (Post Senior)', xlRow: 18, appKey: 'fcfe' },
        { label: 'Interessi Soci Pagati', xlRow: 23, appKey: 'sociInterestPaid', negate: true },
        { label: 'Dividendi SPV a HoldCo', xlRow: 24, appKey: 'dividends', negate: true },
        { label: 'Rimborso Capitale Soci', xlRow: 25, appKey: 'sociPrincipalPaid', negate: true },
        { label: 'Restituzione Riserve Capitale', xlRow: 26, appKey: 'capitalReturn', negate: true },
        { label: 'Saldo Cassa Vincolata SPV', xlRow: 30, appKey: 'trappedCashEnd' }
    ];

    rfMappings.forEach(mapping => {
        const appArr = m[mapping.appKey] || [];
        const diffs = [];
        for (let y = 1; y <= 20; y++) {
            const col = y + 1;
            const xlVal = getHf('RENDICONTO FINANZIARIO SPV', mapping.xlRow, col);
            let appVal = appArr[y - 1] !== undefined ? appArr[y - 1] : 0;
            if (mapping.negate) appVal = -Math.abs(appVal);

            const numXl = typeof xlVal === 'number' ? xlVal : 0;
            const diff = Math.round(numXl) - Math.round(appVal);
            if (Math.abs(diff) > 2) {
                diffs.push(`Y${y}: XL=${Math.round(numXl).toLocaleString('it-IT')} vs APP=${Math.round(appVal).toLocaleString('it-IT')} (Δ=${diff.toLocaleString('it-IT')})`);
            }
        }
        if (diffs.length === 0) {
            console.log(`✓ ${mapping.label}: PERFETTAMENTE ALLINEATO (Δ <= 2€ su tutti i 20 anni)`);
        } else {
            console.log(`❌ ${mapping.label} (Riga ${mapping.xlRow}): ${diffs.length} DISCREPANZE!`);
            diffs.slice(0, 5).forEach(d => console.log(`   - ${d}`));
            if (diffs.length > 5) console.log(`   ... e altri ${diffs.length - 5} anni con scostamento`);
        }
    });

    // 4. CONFRONTO RENDICONTO FINANZIARIO HOLDING
    console.log('\n=== CONFRONTO RENDICONTO FINANZIARIO HOLDING ===');
    const rfHcMappings = [
        { label: 'Utile Netto HoldCo', xlRow: 3, appKey: 'holdCoNetIncome' },
        { label: 'Cassa da Gestione Ordinaria HoldCo', xlRow: 6, appKey: 'holdCoCashOp' },
        { label: 'Flusso da Dismissione (Exit)', xlRow: 8, appKey: 'exitFlow' },
        { label: 'FCFE Investitore HoldCo', xlRow: 13, appKey: 'fcfeHoldCo' },
        { label: 'FCFE Cumulato Investitore', xlRow: 14, appKey: 'cumFcfeHoldCo' },
    ];

    rfHcMappings.forEach(mapping => {
        let appArr = m[mapping.appKey] || [];
        // if exitFlow, compute from exitEquity
        if (mapping.appKey === 'exitFlow') {
            appArr = Array(20).fill(0);
            if (dump.results.exitYear && dump.results.exitYear > 0 && dump.results.exitYear <= 20) {
                appArr[dump.results.exitYear - 1] = dump.results.exitEquityValue || 0;
            }
        }

        const diffs = [];
        for (let y = 1; y <= 20; y++) {
            const col = y + 1;
            const xlVal = getHf('RENDICONTO FINANZIARIO HOLDING', mapping.xlRow, col);
            let appVal = appArr[y - 1] !== undefined ? appArr[y - 1] : 0;
            if (mapping.negate) appVal = -Math.abs(appVal);

            const numXl = typeof xlVal === 'number' ? xlVal : 0;
            const diff = Math.round(numXl) - Math.round(appVal);
            if (Math.abs(diff) > 2) {
                diffs.push(`Y${y}: XL=${Math.round(numXl).toLocaleString('it-IT')} vs APP=${Math.round(appVal).toLocaleString('it-IT')} (Δ=${diff.toLocaleString('it-IT')})`);
            }
        }
        if (diffs.length === 0) {
            console.log(`✓ ${mapping.label}: PERFETTAMENTE ALLINEATO (Δ <= 2€ su tutti i 20 anni)`);
        } else {
            console.log(`❌ ${mapping.label} (Riga ${mapping.xlRow}): ${diffs.length} DISCREPANZE!`);
            diffs.slice(0, 5).forEach(d => console.log(`   - ${d}`));
            if (diffs.length > 5) console.log(`   ... e altri ${diffs.length - 5} anni con scostamento`);
        }
    });
}

compare().catch(console.error);
