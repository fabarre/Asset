import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';

async function compareMatrixVsFormulas() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    // Build HyperFormula
    const hfSheets = {};
    wb.worksheets.forEach(ws => {
        const maxRow = ws.rowCount || 1;
        const maxCol = ws.columnCount || 1;
        const matrix = [];

        for (let r = 1; r <= maxRow; r++) {
            const rowData = [];
            const row = ws.getRow(r);
            for (let c = 1; c <= maxCol; c++) {
                const cell = row.getCell(c);
                let val = null;

                if (cell.formula) {
                    let f = cell.formula;
                    if (f.startsWith('=')) f = f.substring(1); // strip leading = for HF
                    val = '=' + f;
                } else if (cell.value && typeof cell.value === 'object') {
                    if (cell.value.formula) {
                        let f = cell.value.formula;
                        if (f.startsWith('=')) f = f.substring(1);
                        val = '=' + f;
                    } else if (cell.value.result !== undefined) {
                        val = cell.value.result;
                    } else {
                        val = null;
                    }
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

    console.log('========================================================================');
    console.log('CONFRONTO VALORI EXCEL (FORMULA HYPERFORMULA) VS VALORI WEB APP (RESULT)');
    console.log('========================================================================');

    const discrepancies = [];

    const sheetsToAudit = [
        'CONTO ECONOMICO',
        'RENDICONTO FINANZIARIO SPV',
        'AMMORTAMENTO',
        'CONTO ECONOMICO HOLDING',
        'RENDICONTO FINANZIARIO HOLDING',
        'CASH FLOW MENSILE'
    ];

    for (const sName of sheetsToAudit) {
        const ws = wb.getWorksheet(sName);
        if (!ws) continue;

        ws.eachRow({ includeEmpty: false }, (row, rNum) => {
            const label = String(row.getCell(1).value || '').trim();
            if (!label || label.startsWith('==') || label.includes('DRIVER')) return;

            for (let cNum = 2; cNum <= (sName === 'CASH FLOW MENSILE' ? 17 : 21); cNum++) {
                const cell = row.getCell(cNum);
                const colLetter = ws.getColumn(cNum).letter;
                
                // Get web app exported value (stored in cell.value.result or cell.value)
                let webAppVal = null;
                if (cell.value && typeof cell.value === 'object' && cell.value.result !== undefined) {
                    webAppVal = cell.value.result;
                } else if (typeof cell.value === 'number') {
                    webAppVal = cell.value;
                }

                // Get HyperFormula value
                const hfVal = getHf(sName, rNum, cNum);

                if (webAppVal !== null && typeof webAppVal === 'number' && typeof hfVal === 'number') {
                    const diff = Math.abs(webAppVal - hfVal);
                    // Flag discrepancy if difference > 5 € (accounting for rounding differences)
                    if (diff > 5) {
                        discrepancies.push({
                            sheet: sName,
                            cell: `${colLetter}${rNum}`,
                            label,
                            yearCol: cNum - 1,
                            webAppVal: Math.round(webAppVal),
                            hfVal: Math.round(hfVal),
                            diff: Math.round(diff),
                            formula: cell.formula || (cell.value && cell.value.formula) || 'none'
                        });
                    }
                }
            }
        });
    }

    console.log(`Totale discrepanze trovate (> 5 €): ${discrepancies.length}\n`);

    // Group by sheet and label
    const grouped = {};
    discrepancies.forEach(d => {
        const k = `${d.sheet} -> [${d.label}] (Formula: ${d.formula.substring(0, 40)})`;
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(d);
    });

    for (const [k, list] of Object.entries(grouped)) {
        console.log(`\n🔴 ${k} (${list.length} anni disallineati):`);
        list.slice(0, 5).forEach(d => {
            console.log(`   Cell ${d.cell} (Y${d.yearCol}): WebApp = ${d.webAppVal.toLocaleString('it-IT')} € | Excel = ${d.hfVal.toLocaleString('it-IT')} € | Delta = ${d.diff.toLocaleString('it-IT')} €`);
        });
        if (list.length > 5) console.log(`   ... e altri ${list.length - 5} anni`);
    }
}

compareMatrixVsFormulas().catch(console.error);
