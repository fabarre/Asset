import re

with open('src/excelExport.js', 'r', encoding='utf-8') as f:
    content = f.read()

# I will replace the eachCell logic with standard loops `for (let colNum = 1; colNum <= Math.max(totColIndex, pctColIndex || 0); colNum++)` or similar, to ensure cells are accessed via `row.getCell(colNum)`.

capex_old = """    function addRowCapex(key, label, mapFn, isBold = false, pct = null) {
        let rowData = { label };
        if (m.capexBreakdown && mapFn) {
            m.capexBreakdown.forEach((cb, idx) => {
                const val = mapFn(cb);
                rowData[`p${idx}`] = val;
            });
        }
        
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        const pctColIndex = totColIndex + 1;
        
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum < totColIndex) {
                cell.numFmt = numberFormatEuro;
            } else if (colNum === totColIndex) {
                const firstPlantCol = getColLetter(2);
                const lastPlantCol = getColLetter(totColIndex - 1);
                if (totColIndex > 2) {
                    cell.value = { formula: `SUM(${firstPlantCol}${currentRowNumCapex}:${lastPlantCol}${currentRowNumCapex})`, result: undefined };
                } else {
                    cell.value = 0;
                }
                cell.numFmt = numberFormatEuro;
            } else if (colNum === pctColIndex && pct !== null) {
                cell.value = pct;
                cell.numFmt = numberFormatPct;
            }
            if (isBold) cell.font = { bold: true };
            if (isBold && colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        });
        
        currentRowNumCapex++;
        return row;
    }
    
    const fiscalDeprRate = window.State.inputs.fiscalDeprRate || 0.09;

    addRowCapex('solar', 'EPC Solar (€)', cb => cb.solarCapex || 0, false, fiscalDeprRate);
    addRowCapex('bess', 'BESS (€)', cb => cb.bessCapex || 0, false, fiscalDeprRate);
    addRowCapex('connection', 'Connessione (€)', cb => cb.connectionCapex || 0, false, fiscalDeprRate);
    addRowCapex('development', 'Sviluppo (€)', cb => cb.developmentCapex || 0, false, fiscalDeprRate);
    addRowCapex('spv', 'SPV Acquisizione (€)', cb => cb.spvAcquisitionCapex || 0, false, null);
    addRowCapex('landAcq', 'Terreni (Acquisto) (€)', cb => cb.landPurchaseCapex || 0, false, null);
    addRowCapex('landDds', 'Terreni (DDS Attualizzato) (€)', cb => cb.landDdsAttualizzatoCapex || 0, false, fiscalDeprRate);
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    // TOTALE CAPEX con somma di tutte le singole colonne
    {
        const row = sheetCapex.addRow({ label: 'TOTALE CAPEX (€)' });
        rowMapCapex['totalCapex'] = currentRowNumCapex;
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['solar']}:${colLetter}${rowMapCapex['landDds']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
            if (colNum === 1) {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            }
        });
        currentRowNumCapex++;
    }

    sheetCapex.addRow([]); currentRowNumCapex++;
    
    // Sezione Ammortamenti in CAPEX
    const fiscalPctString = (fiscalDeprRate * 100).toFixed(1) + '%';
    const rowAmm = sheetCapex.addRow({ label: 'AMMORTAMENTO CIVILISTICO' });
    rowAmm.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rowAmm.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    currentRowNumCapex++;

    function addDeprRowCapex(key, label, capexKeyRef) {
        let rowData = { label };
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        const pctColIndex = totColIndex + 1;
        const pctColLetter = getColLetter(pctColIndex);
        
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                const capexRow = rowMapCapex[capexKeyRef];
                cell.value = { formula: `ROUND(${colLetter}${capexRow} * ${pctColLetter}${capexRow}, 0)`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        });
        
        currentRowNumCapex++;
        return row;
    }

    addDeprRowCapex('deprSolar', `Quota Ammortamento EPC Solar`, 'solar');
    addDeprRowCapex('deprBess', `Quota Ammortamento BESS`, 'bess');
    addDeprRowCapex('deprConn', `Quota Ammortamento Connessione`, 'connection');
    addDeprRowCapex('deprDev', `Quota Ammortamento Sviluppo`, 'development');
    addDeprRowCapex('deprLandDds', `Quota Ammortamento Terreni DDS Att.`, 'landDds');
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    {
        let rowDataTotDepr = { label: 'TOTALE AMMORTAMENTO ANNUALE (€)' };
        const rowTotDepr = sheetCapex.addRow(rowDataTotDepr);
        rowMapCapex['totalDepr'] = currentRowNumCapex;
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        rowTotDepr.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['deprSolar']}:${colLetter}${rowMapCapex['deprLandDds']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
            cell.font = { bold: true };
            if (colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        });
        currentRowNumCapex++;
    }"""

capex_new = """    function addRowCapex(key, label, mapFn, isBold = false, pct = null) {
        let rowData = { label };
        if (m.capexBreakdown && mapFn) {
            m.capexBreakdown.forEach((cb, idx) => {
                const val = mapFn(cb);
                rowData[`p${idx}`] = val;
            });
        }
        
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        const pctColIndex = totColIndex + 1;
        
        for (let colNum = 1; colNum <= Math.max(totColIndex, pctColIndex); colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum < totColIndex) {
                cell.numFmt = numberFormatEuro;
            } else if (colNum === totColIndex) {
                const firstPlantCol = getColLetter(2);
                const lastPlantCol = getColLetter(totColIndex - 1);
                if (totColIndex > 2) {
                    cell.value = { formula: `SUM(${firstPlantCol}${currentRowNumCapex}:${lastPlantCol}${currentRowNumCapex})`, result: undefined };
                } else {
                    cell.value = 0;
                }
                cell.numFmt = numberFormatEuro;
            } else if (colNum === pctColIndex && pct !== null) {
                cell.value = pct;
                cell.numFmt = numberFormatPct;
            }
            if (isBold) cell.font = { bold: true };
            if (isBold && colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        }
        
        currentRowNumCapex++;
        return row;
    }
    
    const fiscalDeprRate = window.State.inputs.fiscalDeprRate || 0.09;

    addRowCapex('solar', 'EPC Solar (€)', cb => cb.solarCapex || 0, false, fiscalDeprRate);
    addRowCapex('bess', 'BESS (€)', cb => cb.bessCapex || 0, false, fiscalDeprRate);
    addRowCapex('connection', 'Connessione (€)', cb => cb.connectionCapex || 0, false, fiscalDeprRate);
    addRowCapex('development', 'Sviluppo (€)', cb => cb.developmentCapex || 0, false, fiscalDeprRate);
    addRowCapex('spv', 'SPV Acquisizione (€)', cb => cb.spvAcquisitionCapex || 0, false, null);
    addRowCapex('landAcq', 'Terreni (Acquisto) (€)', cb => cb.landPurchaseCapex || 0, false, null);
    addRowCapex('landDds', 'Terreni (DDS Attualizzato) (€)', cb => cb.landDdsAttualizzatoCapex || 0, false, fiscalDeprRate);
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    // TOTALE CAPEX con somma di tutte le singole colonne
    {
        const row = sheetCapex.addRow({ label: 'TOTALE CAPEX (€)' });
        rowMapCapex['totalCapex'] = currentRowNumCapex;
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['solar']}:${colLetter}${rowMapCapex['landDds']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
            if (colNum === 1) {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            }
        }
        currentRowNumCapex++;
    }

    sheetCapex.addRow([]); currentRowNumCapex++;
    
    // Sezione Ammortamenti in CAPEX
    const fiscalPctString = (fiscalDeprRate * 100).toFixed(1) + '%';
    const rowAmm = sheetCapex.addRow({ label: 'AMMORTAMENTO CIVILISTICO' });
    rowAmm.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rowAmm.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    currentRowNumCapex++;

    function addDeprRowCapex(key, label, capexKeyRef) {
        let rowData = { label };
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        const pctColIndex = totColIndex + 1;
        const pctColLetter = getColLetter(pctColIndex);
        
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                const capexRow = rowMapCapex[capexKeyRef];
                cell.value = { formula: `ROUND(${colLetter}${capexRow} * ${pctColLetter}${capexRow}, 0)`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        }
        
        currentRowNumCapex++;
        return row;
    }

    addDeprRowCapex('deprSolar', `Quota Ammortamento EPC Solar`, 'solar');
    addDeprRowCapex('deprBess', `Quota Ammortamento BESS`, 'bess');
    addDeprRowCapex('deprConn', `Quota Ammortamento Connessione`, 'connection');
    addDeprRowCapex('deprDev', `Quota Ammortamento Sviluppo`, 'development');
    addDeprRowCapex('deprLandDds', `Quota Ammortamento Terreni DDS Att.`, 'landDds');
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    {
        let rowDataTotDepr = { label: 'TOTALE AMMORTAMENTO ANNUALE (€)' };
        const rowTotDepr = sheetCapex.addRow(rowDataTotDepr);
        rowMapCapex['totalDepr'] = currentRowNumCapex;
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = rowTotDepr.getCell(colNum);
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['deprSolar']}:${colLetter}${rowMapCapex['deprLandDds']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
            cell.font = { bold: true };
            if (colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        }
        currentRowNumCapex++;
    }"""
content = content.replace(capex_old, capex_new)

opex_old = """    {
        let rowData = { label: 'di cui: PPA Service Contract (€)' };
        let tot = 0;
        if (m.opexBreakdown) {
            m.opexBreakdown.forEach((ob, idx) => {
                const val = (ob.years && ob.years.length > 0) ? ob.years[0].opexServiceContract || 0 : 0;
                rowData[`p${idx}`] = val;
                tot += val;
            });
        }
        rowData['total'] = tot; // Verrà sovrascritto dalla formula se applicabile
        
        const row = sheetOpex.addRow(rowData);
        rowMapOpex['opexServiceContract'] = currentRowNumOpex;
        
        const totColIndex = m.opexBreakdown ? m.opexBreakdown.length + 2 : 2;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum < totColIndex) {
                cell.numFmt = numberFormatEuro;
            } else if (colNum === totColIndex) {
                cell.value = { formula: `ROUND('DRIVER OPERATIVI'!C${rowMap['ppaPrice']} * 'DRIVER OPERATIVI'!C${rowMap['ppaEnergy']} * 'DRIVER OPERATIVI'!C${rowMap['ppaPremium']}, 0)`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        });
        currentRowNumOpex++;
    }

    addRowOpexVertical('landDdsAnnuo', 'di cui: DDS Terreni Annuo (€)', y => y.landDdsAnnuo || 0);
    addRowOpexVertical('maintReserve', 'di cui: BESS Maint. Reserve Accantonata (€)', y => y.maintReserve || 0);
    
    sheetOpex.addRow([]); currentRowNumOpex++;
    
    {
        let rowData = { label: 'TOTALE OPEX (€)' };
        const row = sheetOpex.addRow(rowData);
        rowMapOpex['opexTotal'] = currentRowNumOpex;
        const totColIndex = m.opexBreakdown ? m.opexBreakdown.length + 2 : 2;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapOpex['opexPlants']}:${colLetter}${rowMapOpex['maintReserve']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
            if (colNum === 1) {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
            }
        });
        currentRowNumOpex++;
    }

    // Helper formula per OPEX nel CONTO ECONOMICO
    const opexTotCol = getColLetter(opexCols.length);
    function getOpexFormulaCe(opexKey, colLetter, yearIndex, rowIndex) {
        if (opexKey === 'opexServiceContract') {
            if (yearIndex === 0) {
                return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
            } else {
                return `IFERROR(-ROUND('DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPrice']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaEnergy']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPremium']}, 0), 0)`;
            }
        }"""

opex_new = """    {
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
                cell.value = { formula: `ROUND('DRIVER OPERATIVI'!B${rowMap['ppaPrice']} * 'DRIVER OPERATIVI'!B${rowMap['ppaEnergy']} * 'DRIVER OPERATIVI'!B${rowMap['ppaPremium']}, 0)`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        }
        currentRowNumOpex++;
    }

    addRowOpexVertical('landDdsAnnuo', 'di cui: DDS Terreni Annuo (€)', y => y.landDdsAnnuo || 0);
    addRowOpexVertical('maintReserve', 'di cui: BESS Maint. Reserve Accantonata (€)', y => y.maintReserve || 0);
    
    sheetOpex.addRow([]); currentRowNumOpex++;
    
    {
        let rowData = { label: 'TOTALE OPEX (€)' };
        const row = sheetOpex.addRow(rowData);
        rowMapOpex['opexTotal'] = currentRowNumOpex;
        const totColIndex = m.opexBreakdown ? m.opexBreakdown.length + 2 : 2;
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum <= totColIndex) {
                const colLetter = getColLetter(colNum);
                cell.value = { formula: `SUM(${colLetter}${rowMapOpex['opexPlants']}:${colLetter}${rowMapOpex['maintReserve']})`, result: undefined };
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
            if (colNum === 1) {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
            }
        }
        currentRowNumOpex++;
    }

    // Helper formula per OPEX nel CONTO ECONOMICO
    const opexTotCol = getColLetter(opexCols.length);
    function getOpexFormulaCe(opexKey, colLetter, yearIndex, rowIndex) {
        if (opexKey === 'opexServiceContract') {
            if (yearIndex === 0) {
                return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
            } else {
                return `IFERROR(-ROUND('DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPrice']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaEnergy']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPremium']}, 0), 0)`;
            }
        }"""
content = content.replace(opex_old, opex_new)

with open('src/excelExport.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
