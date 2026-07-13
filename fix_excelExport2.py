import re
import sys

with open('src/excelExport.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. PPA Service Premium in DRIVER OPERATIVI
if "addRow('ppaPremium'" not in content:
    content = content.replace(
        "addRow('inflation', 'Tasso di Inflazione (%)', 'bold', Array(numYears).fill(window.State.inputs.inflation), numberFormatPct);",
        """addRow('inflation', 'Tasso di Inflazione (%)', 'bold', Array(numYears).fill(window.State.inputs.inflation), numberFormatPct);
    
    let ppaServicePct = 0;
    if (window.State.plants && window.State.plants.length > 0) {
        const pWithService = window.State.plants.find(p => p.serviceVal > 0);
        if (pWithService) {
            ppaServicePct = pWithService.serviceVal / 100;
        }
    }
    addRow('ppaPremium', 'Premio Commerciale PPA (%)', 'bold', Array(numYears).fill(ppaServicePct), numberFormatPct);"""
    )

# 2. CAPEX modification
capex_old = """    const capexCols = [
        { header: 'Voci di Costo CAPEX', key: 'label', width: 40 }
    ];
    if (m.capexBreakdown) {
        m.capexBreakdown.forEach((cb, idx) => {
            capexCols.push({ header: `${cb.name} (kW)`, key: `p${idx}`, width: 20 });
        });
    }
    capexCols.push({ header: 'TOTALE PORTAFOGLIO', key: 'total', width: 25 });
    sheetCapex.columns = capexCols;

    sheetCapex.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
    });

    let rowMapCapex = {};
    let currentRowNumCapex = 2;

    function addRowCapex(key, label, mapFn, isBold = false) {
        let rowData = { label };
        let tot = 0;
        if (m.capexBreakdown) {
            m.capexBreakdown.forEach((cb, idx) => {
                const val = mapFn(cb);
                rowData[`p${idx}`] = val;
                tot += val;
            });
        }
        rowData['total'] = tot;
        
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        row.eachCell((cell, colNum) => {
            if (colNum > 1) {
                cell.numFmt = numberFormatEuro;
            }
            if (isBold) cell.font = { bold: true };
            if (isBold && colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        });
        
        currentRowNumCapex++;
        return row;
    }

    addRowCapex('solar', 'EPC Solar (€)', cb => cb.solarCapex || 0);
    addRowCapex('bess', 'BESS (€)', cb => cb.bessCapex || 0);
    addRowCapex('connection', 'Connessione (€)', cb => cb.connectionCapex || 0);
    addRowCapex('development', 'Sviluppo (€)', cb => cb.developmentCapex || 0);
    addRowCapex('spv', 'SPV Acquisizione (€)', cb => cb.spvAcquisitionCapex || 0);
    addRowCapex('landAcq', 'Terreni (Acquisto) (€)', cb => cb.landPurchaseCapex || 0);
    addRowCapex('landDds', 'Terreni (DDS Attualizzato) (€)', cb => cb.landDdsAttualizzatoCapex || 0);
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    addRowCapex('totalCapex', 'TOTALE CAPEX (€)', cb => cb.totalCapex || 0, true);

    sheetCapex.addRow([]); currentRowNumCapex++;
    
    // Sezione Ammortamenti in CAPEX
    const fiscalDeprRate = window.State.inputs.fiscalDeprRate || 0.09;
    const fiscalPctString = (fiscalDeprRate * 100).toFixed(1) + '%';
    
    const rowAmm = sheetCapex.addRow({ label: 'AMMORTAMENTO CIVILISTICO' });
    rowAmm.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rowAmm.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    currentRowNumCapex++;

    function addDeprRowCapex(key, label, capexKeyRef) {
        let rowData = { label };
        const row = sheetCapex.addRow(rowData);
        rowMapCapex[key] = currentRowNumCapex;
        
        row.eachCell((cell, colNum) => {
            if (colNum > 1) {
                const colLetter = getColLetter(colNum);
                const capexRow = rowMapCapex[capexKeyRef];
                cell.value = { formula: `${colLetter}${capexRow}*${fiscalDeprRate}`, result: undefined };
                cell.numFmt = numberFormatEuro;
            }
        });
        
        currentRowNumCapex++;
        return row;
    }

    addDeprRowCapex('deprSolar', `Quota Ammortamento EPC Solar (${fiscalPctString})`, 'solar');
    addDeprRowCapex('deprBess', `Quota Ammortamento BESS (${fiscalPctString})`, 'bess');
    addDeprRowCapex('deprConn', `Quota Ammortamento Connessione (${fiscalPctString})`, 'connection');
    addDeprRowCapex('deprDev', `Quota Ammortamento Sviluppo (${fiscalPctString})`, 'development');
    addDeprRowCapex('deprLandDds', `Quota Ammortamento Terreni DDS Att. (${fiscalPctString})`, 'landDds');
    
    sheetCapex.addRow([]); currentRowNumCapex++;
    
    let rowDataTotDepr = { label: 'TOTALE AMMORTAMENTO ANNUALE (€)' };
    const rowTotDepr = sheetCapex.addRow(rowDataTotDepr);
    rowMapCapex['totalDepr'] = currentRowNumCapex;
    rowTotDepr.eachCell((cell, colNum) => {
        if (colNum > 1) {
            const colLetter = getColLetter(colNum);
            cell.value = { formula: `SUM(${colLetter}${rowMapCapex['deprSolar']}:${colLetter}${rowMapCapex['deprLandDds']})`, result: undefined };
            cell.numFmt = numberFormatEuro;
        }
        cell.font = { bold: true };
        if (colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    });
    currentRowNumCapex++;"""

capex_new = """    const capexCols = [
        { header: 'Voci di Costo CAPEX', key: 'label', width: 40 }
    ];
    if (m.capexBreakdown) {
        m.capexBreakdown.forEach((cb, idx) => {
            capexCols.push({ header: `${cb.name} (kW)`, key: `p${idx}`, width: 20 });
        });
    }
    capexCols.push({ header: 'TOTALE PORTAFOGLIO', key: 'total', width: 25 });
    capexCols.push({ header: 'Aliquota Ammortamento (%)', key: 'deprRate', width: 25 });
    sheetCapex.columns = capexCols;

    sheetCapex.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
    });

    let rowMapCapex = {};
    let currentRowNumCapex = 2;

    function addRowCapex(key, label, mapFn, isBold = false, pct = null) {
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
        
        row.eachCell((cell, colNum) => {
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
        row.eachCell((cell, colNum) => {
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
        
        row.eachCell((cell, colNum) => {
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
        rowTotDepr.eachCell((cell, colNum) => {
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
content = content.replace(capex_old, capex_new)

# 3. OPEX modification
opex_old = """    addRowOpexVertical('opexAssetManagement', 'di cui: Asset Management (€)', y => y.opexAssetManagement || 0);
    addRowOpexVertical('opexServiceContract', 'di cui: PPA Service Contract (€)', y => y.opexServiceContract || 0);
    addRowOpexVertical('landDdsAnnuo', 'di cui: DDS Terreni Annuo (€)', y => y.landDdsAnnuo || 0);
    addRowOpexVertical('maintReserve', 'di cui: BESS Maint. Reserve Accantonata (€)', y => y.maintReserve || 0);
    
    sheetOpex.addRow([]); currentRowNumOpex++;
    addRowOpexVertical('opexTotal', 'TOTALE OPEX (€)', y => y.opexTotal || 0, true);

    // Helper formula per OPEX nel CONTO ECONOMICO
    const opexTotCol = getColLetter(opexCols.length);
    function getOpexFormulaCe(opexKey, colLetter, yearIndex, rowIndex) {
        if (yearIndex === 0) {
            return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
        } else {
            const prevCol = getColLetter((yearIndex + 2) - 1);
            return `IFERROR(${prevCol}${rowIndex} * (1 + 'DRIVER OPERATIVI'!${colLetter}${rowMap.inflation}), 0)`;
        }
    }"""

opex_new = """    addRowOpexVertical('opexAssetManagement', 'di cui: Asset Management (€)', y => y.opexAssetManagement || 0);
    
    {
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
        row.eachCell((cell, colNum) => {
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
        row.eachCell((cell, colNum) => {
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
        }
        if (yearIndex === 0) {
            return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
        } else {
            const prevCol = getColLetter((yearIndex + 2) - 1);
            return `IFERROR(ROUND(${prevCol}${rowIndex} * (1 + 'DRIVER OPERATIVI'!${colLetter}${rowMap.inflation}), 0), 0)`;
        }
    }"""
content = content.replace(opex_old, opex_new)

with open('src/excelExport.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
