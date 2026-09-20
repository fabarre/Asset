import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';

async function detailAudit() {
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

    const printSheetDetail = (sName, colIndices = [2, 3, 4, 5, 6, 11, 16, 21], colNames = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y10', 'Y15', 'Y20']) => {
        const ws = wb.getWorksheet(sName);
        if (!ws) return;
        console.log(`\n====================================================`);
        console.log(`DETTAGLIO FOGLIO: ${sName}`);
        console.log(`====================================================`);
        console.log(`Riga | Etichetta                                         | ` + colNames.map(c => c.padStart(12)).join(' | '));
        console.log('-'.repeat(140));

        ws.eachRow({ includeEmpty: false }, (row, rNum) => {
            const label = String(row.getCell(1).value || '').trim();
            if (!label) return;

            const vals = colIndices.map(cNum => {
                const hfVal = getHf(sName, rNum, cNum);
                let str = '—';
                if (typeof hfVal === 'number') {
                    str = Math.round(hfVal).toLocaleString('it-IT');
                } else if (hfVal && typeof hfVal === 'object' && hfVal.type) {
                    str = `ERR:${hfVal.type}`;
                } else if (typeof hfVal === 'string') {
                    str = hfVal.substring(0, 12);
                } else if (typeof hfVal === 'boolean') {
                    str = hfVal ? 'TRUE' : 'FALSE';
                }
                return str.padStart(12);
            });

            console.log(`R${String(rNum).padStart(3)} | ${label.padEnd(48).substring(0, 48)} | ${vals.join(' | ')}`);
        });
    };

    printSheetDetail('CONTO ECONOMICO');
    printSheetDetail('RENDICONTO FINANZIARIO SPV');
    printSheetDetail('AMMORTAMENTO');
    printSheetDetail('CONTO ECONOMICO HOLDING');
    printSheetDetail('RENDICONTO FINANZIARIO HOLDING');
}

detailAudit().catch(console.error);
