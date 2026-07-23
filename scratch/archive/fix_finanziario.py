import re

with open('src/excelExport.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove opexServiceContract from OPEX
opex_block_old = """    {
        let rowData = { label: 'di cui: PPA Service Contract (€)' };
        // Empty plant columns per user request, only TOTAL column will hold the formula
        const row = sheetOpex.addRow(rowData);
        rowMapOpex['opexServiceContract'] = currentRowNumOpex;
        
        const totColIndex = m.opexBreakdown ? m.opexBreakdown.length + 2 : 2;
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum < totColIndex) {
                cell.value = 0;
                cell.numFmt = numberFormatEuro;
            } else if (colNum === totColIndex) {
                cell.value = { formula: `ROUND('DRIVER OPERATIVI'!B${rowMap['priceSolarPpa']} * 'DRIVER OPERATIVI'!B${rowMap['qtySolarPpa']} * 'DRIVER OPERATIVI'!B${rowMap['ppaPremium']}, 0)`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        }
        currentRowNumOpex++;
    }"""

if opex_block_old in content:
    content = content.replace(opex_block_old, "    // opexServiceContract was removed from OPEX per user request")
else:
    print("Could not find opexServiceContract block to remove.")

# 2. Update getOpexFormulaCe to always use the PPA Service Contract formula
opex_formula_old = """    function getOpexFormulaCe(opexKey, colLetter, yearIndex, rowIndex) {
        if (opexKey === 'opexServiceContract') {
            if (yearIndex === 0) {
                return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
            } else {
                return `IFERROR(-ROUND('DRIVER OPERATIVI'!${colLetter}${rowMap['priceSolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['qtySolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPremium']}, 0), 0)`;
            }
        }"""

opex_formula_new = """    function getOpexFormulaCe(opexKey, colLetter, yearIndex, rowIndex) {
        if (opexKey === 'opexServiceContract') {
            return `IFERROR(-ROUND('DRIVER OPERATIVI'!${colLetter}${rowMap['priceSolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['qtySolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPremium']}, 0), 0)`;
        }"""

if opex_formula_old in content:
    content = content.replace(opex_formula_old, opex_formula_new)
else:
    print("Could not find getOpexFormulaCe block to update.")


# 3. Insert FINANZIARIO sheet before AMMORTAMENTO
# Find where sheetDebt is added
finanziario_injection_point = "    // FOGLIO 5: AMMORTAMENTO (Piano Ammortamento Debito & Soci)"

new_finanziario_sheet = """    // FOGLIO FINANZIARIO
    const sheetFin = workbook.addWorksheet('FINANZIARIO', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetFin.columns = [
        { header: 'STRUTTURA FINANZIARIA', key: 'label', width: 50 },
        { header: 'Valore (€)', key: 'val', width: 25 },
        { header: '%', key: 'pct', width: 15 }
    ];
    sheetFin.getRow(1).eachCell({ includeEmpty: true }, (cell) => { cell.style = headerStyle; });

    let currentRowFin = 2;
    let rowMapFin = {};
    
    function addFinRow(key, label, isBold = false, isHeader = false) {
        const row = sheetFin.addRow({ label });
        rowMapFin[key] = currentRowFin;
        if (isBold) row.font = { bold: true };
        if (isHeader) {
            row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        }
        currentRowFin++;
        return row;
    }

    addFinRow('usi', 'TOTALE USI (Impieghi)', true, true);
    const rowUsiTotal = addFinRow('totUsi', 'Costo Totale Progetto (CAPEX)', true);
    const capexTotColLetter = getColLetter(m.capexBreakdown ? m.capexBreakdown.length + 2 : 2);
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['totalCapex']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).value = 1;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).numFmt = numberFormatPct;

    sheetFin.addRow([]); currentRowFin++;

    addFinRow('fonti', 'TOTALE FONTI (Coperture)', true, true);
    
    // DEBT
    const rowDebt = addFinRow('debt', 'Debito Bancario (Senior Loan)');
    sheetFin.getCell(`B${rowMapFin['debt']}`).value = m.debtAmount || 0;
    sheetFin.getCell(`B${rowMapFin['debt']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['debt']}`).value = { formula: `IFERROR(B${rowMapFin['debt']} / B${rowMapFin['totUsi']}, 0)`, result: undefined };
    sheetFin.getCell(`C${rowMapFin['debt']}`).numFmt = numberFormatPct;

    // EQUITY
    const rowEq = addFinRow('equity', 'Totale Equity (Mezzi Propri)', true);
    sheetFin.getCell(`B${rowMapFin['equity']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['debt']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['equity']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['equity']}`).value = { formula: `IFERROR(B${rowMapFin['equity']} / B${rowMapFin['totUsi']}, 0)`, result: undefined };
    sheetFin.getCell(`C${rowMapFin['equity']}`).numFmt = numberFormatPct;

    // Equity Stratification
    const holdcoCap = window.State.inputs.holdcoCapital || 10000;
    const subDebt = (m.debtSchedule && m.debtSchedule.beginningBalanceSoci && m.debtSchedule.beginningBalanceSoci.length > 0) ? m.debtSchedule.beginningBalanceSoci[0] : 0;
    
    const rowHoldco = addFinRow('holdco', '  - Capitale Sociale HoldCo');
    sheetFin.getCell(`B${rowMapFin['holdco']}`).value = holdcoCap;
    sheetFin.getCell(`B${rowMapFin['holdco']}`).numFmt = numberFormatEuro;
    
    const rowSubDebt = addFinRow('subDebt', '  - Finanziamento Soci (Subordinated Debt)');
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).value = subDebt;
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).numFmt = numberFormatEuro;

    const rowOtherEq = addFinRow('otherEq', '  - Riserva / Altro Equity');
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).value = { formula: `B${rowMapFin['equity']} - B${rowMapFin['holdco']} - B${rowMapFin['subDebt']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;
    
    const rowTotFonti = addFinRow('totFonti', 'TOTALE FONTI', true);
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).value = { formula: `B${rowMapFin['debt']} + B${rowMapFin['equity']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).numFmt = numberFormatEuro;
    
    sheetFin.addRow([]); currentRowFin++;
    
    const rowCheck = addFinRow('check', 'Controllo Squadratura (Usi - Fonti)', true);
    sheetFin.getCell(`B${rowMapFin['check']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['totFonti']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['check']}`).numFmt = numberFormatEuro;
    
    // FOGLIO SUCCESSIVO: AMMORTAMENTO (Piano Ammortamento Debito & Soci)"""

if finanziario_injection_point in content:
    content = content.replace(finanziario_injection_point, new_finanziario_sheet)
else:
    print("Could not find injection point for FINANZIARIO sheet.")


with open('src/excelExport.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
