import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';

async function audit() {
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
                    val = cell.formula.startsWith('=') ? cell.formula : '=' + cell.formula;
                } else if (cell.value && typeof cell.value === 'object') {
                    if (cell.value.formula) {
                        val = cell.value.formula.startsWith('=') ? cell.value.formula : '=' + cell.value.formula;
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

    console.log('====================================================');
    console.log('AUDIT COMPLETO DEL FILE ESTRATTO (69)');
    console.log('====================================================\n');

    const sheetsToAudit = [
        'FINANZA',
        'CAPEX',
        'OPEX',
        'DRIVER OPERATIVI',
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
        console.log(`\n----------------------------------------------------`);
        console.log(`FOGLIO: ${sName} (Righe: ${ws.rowCount}, Colonne: ${ws.columnCount})`);
        console.log(`----------------------------------------------------`);

        ws.eachRow({ includeEmpty: false }, (row, rNum) => {
            const label = String(row.getCell(1).value || '').trim();
            if (!label && row.cellCount <= 1) return;

            // Sample columns: col 2 (Y1), col 3 (Y2), col 6 (Y5), col 11 (Y10), col 16 (Y15), col 21 (Y20)
            const colsToSample = sName === 'FINANZA' ? [2] : 
                                 sName === 'CAPEX' ? [2, 3, 4, 5] :
                                 sName === 'CASH FLOW MENSILE' ? [1, 2, 3, 4, 7, 8, 14, 15, 16, 17, 21] :
                                 [2, 3, 6, 11, 16, 21];

            const samples = [];
            for (const cNum of colsToSample) {
                const cell = row.getCell(cNum);
                const rawVal = cell.value;
                const formula = cell.formula || (rawVal && typeof rawVal === 'object' ? rawVal.formula : null);
                const cachedRes = cell.result !== undefined ? cell.result : (rawVal && typeof rawVal === 'object' ? rawVal.result : null);
                const hfVal = getHf(sName, rNum, cNum);

                let displayVal = hfVal;
                if (typeof displayVal === 'number') {
                    displayVal = Math.round(displayVal).toLocaleString('it-IT');
                } else if (displayVal === null || displayVal === undefined) {
                    displayVal = '—';
                }

                if (formula) {
                    samples.push(`C${cNum}: ${displayVal} [f: ${formula.substring(0, 40)}]`);
                } else if (rawVal !== null && rawVal !== undefined) {
                    samples.push(`C${cNum}: ${displayVal}`);
                }
            }

            if (samples.length > 0) {
                console.log(`R${String(rNum).padStart(3)} | ${label.padEnd(45).substring(0, 45)} | ${samples.join(' | ')}`);
            }
        });
    }
}

audit().catch(console.error);
