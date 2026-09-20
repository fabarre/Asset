import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';

async function auditAllSheets() {
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

    console.log('========================================================================');
    console.log('AUDIT COMPLETO DI TUTTI I FOGLI DEL WORKBOOK: PL_Driver_Operativi (69).xlsx');
    console.log('========================================================================');

    const issuesFound = [];

    // Scan each sheet
    for (const ws of wb.worksheets) {
        console.log(`\n>>> ANALISI FOGLIO: ${ws.name}`);
        const sId = hf.getSheetId(ws.name);
        const maxRow = ws.rowCount;
        const maxCol = ws.columnCount;

        for (let r = 1; r <= maxRow; r++) {
            const row = ws.getRow(r);
            const rowLabel = String(row.getCell(1).value || '').trim();

            for (let c = 1; c <= maxCol; c++) {
                const cell = row.getCell(c);
                let rawFormula = null;
                let rawVal = cell.value;

                if (cell.formula) {
                    rawFormula = cell.formula;
                } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
                    rawFormula = cell.value.formula;
                }

                // Check 1: Double equal sign in raw formula
                if (rawFormula && rawFormula.startsWith('=')) {
                    issuesFound.push({
                        sheet: ws.name,
                        cell: `${ws.getColumn(c).letter}${r}`,
                        label: rowLabel,
                        issue: 'DOUBLE_EQUALS_SYNTAX_ERROR',
                        detail: `Formula inizia con doppio uguale: <f>=${rawFormula}</f>`,
                        formula: rawFormula
                    });
                }

                // Check 2: HyperFormula evaluation error
                const hfVal = getHf(ws.name, r, c);
                if (hfVal && typeof hfVal === 'object' && hfVal.type && hfVal.type.includes('ERROR')) {
                    issuesFound.push({
                        sheet: ws.name,
                        cell: `${ws.getColumn(c).letter}${r}`,
                        label: rowLabel,
                        issue: 'CALC_ERROR_' + hfVal.type,
                        detail: hfVal.message || hfVal.type,
                        formula: rawFormula
                    });
                }

                // Check 3: Broken reference in formula string (#REF!)
                if (rawFormula && rawFormula.includes('#REF!')) {
                    issuesFound.push({
                        sheet: ws.name,
                        cell: `${ws.getColumn(c).letter}${r}`,
                        label: rowLabel,
                        issue: 'REF_ERROR',
                        detail: 'Formula contiene #REF!',
                        formula: rawFormula
                    });
                }
            }
        }
    }

    console.log(`\n========================================================================`);
    console.log(`TOTALE PROBLEMI STRUTTURALI / DI SINTASSI TROVATI: ${issuesFound.length}`);
    console.log(`========================================================================`);
    issuesFound.forEach(iss => {
        console.log(`- [${iss.sheet}!${iss.cell}] (${iss.label}) [${iss.issue}]: ${iss.detail} | Formula: ${iss.formula}`);
    });
}

auditAllSheets().catch(console.error);
