async function exportPnlToExcel() {
    console.log("ESPORTAZIONE AVVIATA CON VERSIONE AGGIORNATA (includeEmpty: true)");
    try {
    if (!window.State || !window.State.results) {
        alert("Nessun dato da esportare. Esegui prima la simulazione.");
        return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Solar & BESS M&A Deal Simulator';
    workbook.lastModifiedBy = 'Enterprise Edition';
    workbook.created = new Date();
    workbook.modified = new Date();

    const m = window.State.results.matrix;
    const p = window.State.inputs;
    let years = m && m.years ? m.years : Array.from({length: 20}, (_, i) => i + 1);
    // exitOption '0' = Nessun Exit -> esporta comunque tutti i 20 anni
    const exitOptInt = p && p.exitOption !== undefined ? parseInt(p.exitOption) : NaN;
    if (p && p.exitOption && p.exitOption !== 'none' && !isNaN(exitOptInt) && exitOptInt > 0) {
        years = years.slice(0, exitOptInt);
    }
    const numYears = years.length;

    // Colonna per anno. Colonna B è Anno 1, Col C è Anno 2, ecc.
    // Funzione helper per ottenere la lettera della colonna (1 = A, 2 = B, ...)
    function getColLetter(colIndex) {
        let temp, letter = '';
        while (colIndex > 0) {
            temp = (colIndex - 1) % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            colIndex = (colIndex - temp - 1) / 26;
        }
        return letter;
    }

    // Costanti stile
    const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } }, // bg-[#0f172a]
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } }
    };
    
    const rowTitleStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B0F19' } },
        alignment: { horizontal: 'left', vertical: 'middle' }
    };

    const groupHeaderStyle = {
        font: { bold: true, color: { argb: 'FF6366F1' } }, // Indigo 500
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111C30' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } }
    };

    const numberFormatMwh = '#,##0.0 "MWh"';
    const numberFormatEuroMwh = '€ #,##0.00 "/MWh"';
    const numberFormatEuro = '€ #,##0';
    const numberFormatPct = '0.00%';

    // ---------------------------------------------------------
    // FOGLIO 1: DRIVER OPERATIVI
    // ---------------------------------------------------------
    const sheetOp = workbook.addWorksheet('DRIVER OPERATIVI', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    
    // Configurazione Colonne
    const columns = [
        { header: 'DRIVER OPERATIVI', key: 'label', width: 55 },
    ];
    for (let i = 0; i < numYears; i++) {
        columns.push({ header: `Anno ${years[i]}`, key: `y${i}`, width: 16 });
    }
    sheetOp.columns = columns;

    // Stile Intestazione
    sheetOp.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    // Aiutante per aggiungere righe formattate
    let currentRowNum = 2; // Partiamo da riga 2
    
    // Mappa per tenere traccia delle righe (per le formule)
    const rowMap = {};
    const pendingFormulas = [];

    function addRow(key, label, type, dataArray, format, formulaFn = null) {
        const rowValues = { label };
        
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val); // Assicura che sia negativo anche se l'array aveva già numeri negativi per errore, ma se l'array aveva un positivo lo fa negativo.
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetOp.addRow(rowValues);
        rowMap[key] = currentRowNum;

        // Formattazione
        let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false }; // text-slate-300
        let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        let indent = 0;

        if (type === 'group-header') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        } else if (type === 'bold') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'detail') {
            rowFont = { italic: true, color: { argb: 'FF595959' } };
            indent = 1;
        } else if (type === 'detail-sub') {
            rowFont = { italic: true, color: { argb: 'FF7F7F7F' } };
            indent = 2;
        } else if (type === 'minus') {
            rowFont = { color: { argb: 'FFC00000' } }; // red-400
        }

        row.eachCell((cell, colNumber) => {
            if (colNumber === 1) {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'left', indent: indent, vertical: 'middle' };
                cell.border = { right: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
            } else {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = format;
                cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };

                // Se c'è una funzione per la formula, salviamola per dopo
                if (formulaFn) {
                    const colLetter = getColLetter(colNumber);
                    const yearIndex = colNumber - 2;
                    pendingFormulas.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNum++;
    }

    // Costruzione delle righe per "DRIVER OPERATIVI"

    // 1. QUANTITATIVI DI ENERGIA (MWh)
    addRow('qtyEnergyGroup', 'QUANTITATIVI DI ENERGIA (MWh)', 'group-header', null, '');
    
    // In CER l'energia condivisa (qtySolarPpa) è un sottoinsieme dell'immessa (qtySolarRid):
    // sommarla double-counterebbe la produzione. gen = immessa + carica BESS.
    const _isCerExport = window.State.stabilimenti.filter(s => s.enabled !== false).some(s => s.ppaType === 'cer');
    addRow('qtySolarGen', 'Produzione Fotovoltaica Totale (MWh)', 'bold', m.qtySolarGen, numberFormatMwh, (col) => {
        return _isCerExport
            ? `${col}${rowMap.qtySolarRid}+${col}${rowMap.qtySolarToBess}`
            : `${col}${rowMap.qtySolarPpa}+${col}${rowMap.qtySolarRid}+${col}${rowMap.qtySolarToBess}`;
    });
    
    const activeStabs = window.State.stabilimenti.filter(s => s.enabled !== false);
    const isCER = activeStabs.some(s => s.ppaType === 'cer');
    
    addRow('qtySolarPpa', isCER ? 'di cui: Energia FV Condivisa CER (MWh)' : 'di cui: Energia FV in Autoconsumo / PPA (MWh)', 'detail', m.qtySolarPpa, numberFormatMwh);
    addRow('qtySolarRid', 'di cui: Energia FV immessa in Rete / RID (MWh)', 'detail', m.qtySolarRid, numberFormatMwh);
    addRow('qtySolarToBess', 'di cui: Energia FV per Carica BESS (MWh)', 'detail', m.qtySolarToBess, numberFormatMwh);
    
    addRow('qtyBessDischarge', 'Scarica BESS Totale (MWh)', 'bold', m.qtyBessDischarge, numberFormatMwh, (col) => {
        // qtyBessDischarge = qtyBessSelfCons + qtyBessGridFeed
        return `${col}${rowMap.qtyBessSelfCons}+${col}${rowMap.qtyBessGridFeed}`;
    });
    
    addRow('qtyBessSelfCons', isCER ? 'di cui: Scarica BESS Condivisa CER (MWh)' : 'di cui: Scarica BESS per Autoconsumo / PPA (MWh)', 'detail', m.qtyBessSelfCons, numberFormatMwh, isCER ? (col) => {
        // qtyBessSelfCons = qtyBessSelfConsArb + qtyBessSelfConsTs
        return `${col}${rowMap.qtyBessSelfConsArb}+${col}${rowMap.qtyBessSelfConsTs}`;
    } : null);

    if (isCER) {
        addRow('qtyBessSelfConsArb', '  - di cui: CER BESS da Arbitraggio (MWh)', 'detail-sub', m.qtyBessSelfConsArb, numberFormatMwh);
        addRow('qtyBessSelfConsTs', '  - di cui: CER BESS da Timeshifting (MWh)', 'detail-sub', m.qtyBessSelfConsTs, numberFormatMwh);
    }

    addRow('qtyBessGridFeed', 'di cui: Scarica BESS immessa in Rete / RID (MWh)', 'detail', m.qtyBessGridFeed, numberFormatMwh, (col) => {
        // qtyBessGridFeed = qtyBessGridFeedArb + qtyBessGridFeedTs
        return `${col}${rowMap.qtyBessGridFeedArb}+${col}${rowMap.qtyBessGridFeedTs}`;
    });
    
    addRow('qtyBessGridFeedArb', '  - di cui: Scarica Rete da Arbitraggio (MWh)', 'detail-sub', m.qtyBessGridFeedArb, numberFormatMwh);
    addRow('qtyBessGridFeedTs', '  - di cui: Scarica Rete da Timeshifting (MWh)', 'detail-sub', m.qtyBessGridFeedTs, numberFormatMwh);
    
    addRow('qtyBessChargeGrid', 'Carica BESS da Rete (MWh)', 'detail', m.qtyBessChargeGrid, numberFormatMwh); // I valori sono registrati positivi nel worker
    addRow('qtyBessLosses', 'Perdite di Efficienza BESS (RTE) (MWh)', 'minus', m.qtyBessLosses, numberFormatMwh);
    
    // Riga Vuota
    sheetOp.addRow([]); currentRowNum++;

    // 2. FATTORI MACROECONOMICI
    addRow('macroFactors', 'FATTORI MACROECONOMICI', 'group-header', null, '');
    addRow('inflation', 'Tasso di Inflazione (%)', 'bold', Array(numYears).fill(window.State.inputs.inflation), numberFormatPct);
    
    let ppaServicePct = 0;
    if (window.State.plants && window.State.plants.length > 0) {
        const pWithService = window.State.plants.find(p => p.serviceVal > 0);
        if (pWithService) {
            ppaServicePct = pWithService.serviceVal / 100;
        }
    }
    addRow('ppaPremium', 'Premio Commerciale PPA (%)', 'bold', Array(numYears).fill(ppaServicePct), numberFormatPct);

    const totalKwp = window.State.plants.reduce((sum, p) => p.enabled !== false ? sum + (parseFloat(p.capacity) || 0) : sum, 0);
    addRow('totKwp', 'Potenza Totale Impianti (kWp)', 'bold', Array(numYears).fill(totalKwp), '#,##0');

    // ── Parametri fiscali (driver formule CE) ──
    const _res = window.State.results;
    const _idcAmount = (p.loanTerm > 0 && (_res.debtAmount || 0) > 0)
        ? _res.debtAmount * (p.interestRate || 0) * (((p.constructionMonths !== undefined ? p.constructionMonths : 6) / 12)) * (((p.idcDrawdownFactor !== undefined ? p.idcDrawdownFactor : 50)) / 100)
        : 0;
    const _fiscalBase = (_res.totalEpcCapex || 0) + (_res.bessCAPEX || 0) + (_res.totalConnectionCapex || 0)
        + (_res.totalLandDdsAttualizzatoCapex || 0) + (_res.totalDevelopmentCapex || 0) + _idcAmount;
    let _bessAugCost = 0;
    window.State.plants.filter(pl => pl.enabled !== false).forEach(pl => {
        if ((pl.bessMw || 0) > 0 && pl.bessType !== 'graphene' && (pl.bessMwh || 0) > 0) {
            _bessAugCost += (pl.bessMwh * 1000 * (pl.bessCapexKwh !== undefined ? pl.bessCapexKwh : 300)) * 0.5;
        }
    });
    addRow('fiscalDeprRateConst', 'Aliquota Ammortamento Fiscale (%)', 'bold', Array(numYears).fill(p.fiscalDeprRate || 0.09), numberFormatPct);
    addRow('iresRateConst', 'Aliquota IRES (%)', 'bold', Array(numYears).fill(p.iresRate !== undefined ? p.iresRate : 0.24), numberFormatPct);
    addRow('irapRateConst', 'Aliquota IRAP (%)', 'bold', Array(numYears).fill(p.irapRate !== undefined ? p.irapRate : 0.039), numberFormatPct);
    addRow('fiscalBaseConst', 'Base Amm.to Fiscale (incl. IDC) (€)', 'bold', Array(numYears).fill(_fiscalBase), numberFormatEuro);
    addRow('idcConst', 'IDC Capitalizzato (€)', 'bold', Array(numYears).fill(_idcAmount), numberFormatEuro);
    addRow('bessAugConst', 'CAPEX Sostituzione BESS - anno 10 (€)', 'bold', Array(numYears).fill(_bessAugCost), numberFormatEuro);

    // Riga Vuota
    sheetOp.addRow([]); currentRowNum++;

    // 3. VALORI UNITARI DI RICAVO E COSTO
    addRow('priceEnergyGroup', 'VALORI UNITARI DI RICAVO & COSTO (€/MWh)', 'group-header', null, '');
    
    addRow('priceSolarAvg', 'Valore Unitario Medio Ponderato FV (€/MWh)', 'bold', m.priceSolarAvg, numberFormatEuroMwh, (col) => {
        // Media ponderata: (PrezzoPPA * QtyPPA + PrezzoRID * QtyRID) / QtyGen(PPA+RID) -> Attenzione, QtyToBess non genera ricavi diretti FV
        // Evitiamo div/0 in Excel usando IFERROR
        return `IFERROR((${col}${rowMap.priceSolarPpa}*${col}${rowMap.qtySolarPpa} + ${col}${rowMap.priceSolarRid}*${col}${rowMap.qtySolarRid})/(${col}${rowMap.qtySolarPpa}+${col}${rowMap.qtySolarRid}), 0)`;
    });
    
    addRow('priceSolarPpa', isCER ? 'Prezzo Unitario CER FV (€/MWh)' : 'Prezzo Unitario PPA On-Site FV (€/MWh)', 'detail', m.priceSolarPpa, numberFormatEuroMwh);
    addRow('priceSolarRid', 'Prezzo Unitario RID FV (€/MWh)', 'detail', m.priceSolarRid, numberFormatEuroMwh);
    
    addRow('priceBessAvg', 'Valore Unitario Medio Ponderato BESS (€/MWh)', 'bold', m.priceBessAvg, numberFormatEuroMwh, (col) => {
        // Media ponderata scarica: (PPA*QtySelfCons + RID*QtyGridFeed) / QtyDischarge
        return `IFERROR((${col}${rowMap.priceBessPpa}*${col}${rowMap.qtyBessSelfCons} + ${col}${rowMap.priceBessRid}*${col}${rowMap.qtyBessGridFeed})/${col}${rowMap.qtyBessDischarge}, 0)`;
    });
    
    addRow('priceBessPpa', isCER ? 'Prezzo Unitario CER BESS (€/MWh)' : 'Prezzo Unitario PPA On-Site BESS (€/MWh)', 'detail', m.priceBessPpa, numberFormatEuroMwh);
    addRow('priceBessRid', 'Prezzo Unitario RID BESS (€/MWh)', 'detail', m.priceBessRid, numberFormatEuroMwh, (col) => {
        // Media ponderata tra arbitraggio e timeshifting
        return `IFERROR((${col}${rowMap.priceBessArbitrage}*${col}${rowMap.qtyBessGridFeedArb} + ${col}${rowMap.priceBessTimeshifting}*${col}${rowMap.qtyBessGridFeedTs})/${col}${rowMap.qtyBessGridFeed}, 0)`;
    });
    
    addRow('priceBessArbitrage', '  - di cui: Prezzo di Vendita Arbitraggio (€/MWh)', 'detail-sub', m.priceBessArbitrage, numberFormatEuroMwh);
    addRow('priceBessTimeshifting', '  - di cui: Prezzo di Vendita Timeshifting (€/MWh)', 'detail-sub', m.priceBessTimeshifting, numberFormatEuroMwh);
    
    addRow('priceBessChargeGrid', 'Costo Unitario Ricarica BESS da Rete (€/MWh)', 'minus', m.priceBessChargeGrid, numberFormatEuroMwh);

    // Applicazione Formule a posteriori (dopo che rowMap è completa)
    pendingFormulas.forEach(pf => {
        pf.cell.value = { formula: pf.formulaFn(pf.colLetter, pf.yearIndex), result: undefined };
    });

    // ---------------------------------------------------------
    // FOGLIO 2: CAPEX
    // ---------------------------------------------------------
    const sheetCapex = workbook.addWorksheet('CAPEX', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    
    const capexCols = [
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
    }

    // ---------------------------------------------------------
    // FOGLIO 3: OPEX (Solo Anno 1)
    // ---------------------------------------------------------
    const sheetOpex = workbook.addWorksheet('OPEX', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    const opexCols = [
        { header: 'Voci di Costo OPEX', key: 'label', width: 40 }
    ];
    if (m.opexBreakdown) {
        m.opexBreakdown.forEach((ob, idx) => {
            opexCols.push({ header: `${ob.name} (Anno 1)`, key: `p${idx}`, width: 20 });
        });
    }
    opexCols.push({ header: 'TOTALE PORTAFOGLIO (Anno 1)', key: 'total', width: 28 });
    sheetOpex.columns = opexCols;

    sheetOpex.getRow(1).eachCell((cell) => {
        cell.style = headerStyle;
    });

    let currentRowNumOpex = 2;
    const rowMapOpex = {};

    function addRowOpexVertical(key, label, mapFn, isBold = false) {
        let rowData = { label };
        let tot = 0;
        if (m.opexBreakdown) {
            m.opexBreakdown.forEach((ob, idx) => {
                const val = (ob.years && ob.years.length > 0) ? mapFn(ob.years[0]) : 0;
                rowData[`p${idx}`] = val;
                tot += val;
            });
        }
        rowData['total'] = tot;
        
        const row = sheetOpex.addRow(rowData);
        rowMapOpex[key] = currentRowNumOpex;
        
        row.eachCell((cell, colNum) => {
            if (colNum > 1) {
                cell.numFmt = numberFormatEuro;
            }
            if (isBold) cell.font = { bold: true };
            if (isBold && colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        });
        
        currentRowNumOpex++;
        return row;
    }

    addRowOpexVertical('opexPlants', 'di cui: O&M Impianti (€)', y => y.opexPlants || 0);
    addRowOpexVertical('opexBess', 'di cui: O&M BESS (€)', y => y.opexBess || 0);
    addRowOpexVertical('opexGridCharging', 'di cui: Costo Ricarica BESS da Rete (€)', y => y.opexGridCharging || 0);
    addRowOpexVertical('opexInsurance', 'di cui: Assicurazione (€)', y => y.opexInsurance || 0);
    addRowOpexVertical('opexTaxes', 'di cui: IMU/TASI (€)', y => y.opexTaxes || 0);
    addRowOpexVertical('opexSecurity', 'di cui: Security (€)', y => y.opexSecurity || 0);
    addRowOpexVertical('opexAssetManagement', 'di cui: Asset Management (€)', y => y.opexAssetManagement || 0);
    
    // opexServiceContract was removed from OPEX per user request

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
            return `IFERROR(-ROUND('DRIVER OPERATIVI'!${colLetter}${rowMap['priceSolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['qtySolarPpa']} * 'DRIVER OPERATIVI'!${colLetter}${rowMap['ppaPremium']}, 0), 0)`;
        }
        if (yearIndex === 0) {
            return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
        } else {
            const prevCol = getColLetter((yearIndex + 2) - 1);
            return `IFERROR(ROUND(${prevCol}${rowIndex} * (1 + 'DRIVER OPERATIVI'!${colLetter}${rowMap.inflation}), 0), 0)`;
        }
    }

    // ---------------------------------------------------------
    // FOGLIO 4: CONTO ECONOMICO (SEZIONE A)
    // ---------------------------------------------------------
    const sheetCe = workbook.addWorksheet('CONTO ECONOMICO', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetCe.columns = columns;

    sheetCe.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumCe = 2;
    const rowMapCe = {};
    const pendingFormulasCe = [];

    function addRowCe(key, label, type, dataArray, format, formulaFn = null) {
        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val); // Assicura che sia negativo anche se l'array aveva già numeri negativi per errore, ma se l'array aveva un positivo lo fa negativo.
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetCe.addRow(rowValues);
        rowMapCe[key] = currentRowNumCe;

        let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false };
        let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        let indent = 0;

        if (type === 'group-header') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        } else if (type === 'bold') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'detail') {
            rowFont = { italic: true, color: { argb: 'FF595959' } };
            indent = 1;
        } else if (type === 'detail-sub') {
            rowFont = { italic: true, color: { argb: 'FF7F7F7F' } };
            indent = 2;
        } else if (type === 'minus') {
            rowFont = { color: { argb: 'FFC00000' } };
        } else if (type === 'plus') {
            rowFont = { color: { argb: 'FF006100' } };
        }

        row.eachCell((cell, colNumber) => {
            if (colNumber === 1) {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'left', indent: indent, vertical: 'middle' };
                cell.border = { right: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
            } else {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = format;
                cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };

                if (formulaFn) {
                    const colLetter = getColLetter(colNumber);
                    const yearIndex = colNumber - 2;
                    pendingFormulasCe.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        rowIndex: currentRowNumCe,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNumCe++;
    }

    addRowCe('revenueTotal', 'RICAVI TOTALI SPV (€)', 'group-header', m.revenueTotal, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.revenueRid}+${col}${rowMapCe.revenuePpa}+${col}${rowMapCe.revenueTimeshifting}+${col}${rowMapCe.revenueArbitrage}+${col}${rowMapCe.revenueMsd}`;
    });
    
    addRowCe('revenueRid', 'di cui: Ricavi da RID generato da FV (€)', 'detail', m.revenueRid, numberFormatEuro, (col) => {
        return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtySolarRid}*'DRIVER OPERATIVI'!${col}${rowMap.priceSolarRid}, 0)`;
    });
    addRowCe('revenuePpa', isCER ? 'di cui: Ricavi da CER (Condivisione Energia) (€)' : 'di cui: Ricavi da PPA (FV + BESS) (€)', 'detail', m.revenuePpa, numberFormatEuro, isCER ? (col) => {
        return `${col}${rowMapCe.revenuePpaPv}+${col}${rowMapCe.revenuePpaBessArb}+${col}${rowMapCe.revenuePpaBessTs}`;
    } : (col) => {
        return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtySolarPpa}*'DRIVER OPERATIVI'!${col}${rowMap.priceSolarPpa} + 'DRIVER OPERATIVI'!${col}${rowMap.qtyBessSelfCons}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessPpa}, 0)`;
    });
    
    if (isCER) {
        addRowCe('revenuePpaPv', '  - di cui: Ricavi CER da FV (€)', 'detail-sub', m.revenuePpaPv, numberFormatEuro, (col) => {
            return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtySolarPpa}*'DRIVER OPERATIVI'!${col}${rowMap.priceSolarPpa}, 0)`;
        });
        addRowCe('revenuePpaBessArb', '  - di cui: Ricavi CER da BESS da Arbitraggio (€)', 'detail-sub', m.revenuePpaBessArb, numberFormatEuro, (col) => {
            return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtyBessSelfConsArb}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessPpa}, 0)`;
        });
        addRowCe('revenuePpaBessTs', '  - di cui: Ricavi CER da BESS da Timeshifting (€)', 'detail-sub', m.revenuePpaBessTs, numberFormatEuro, (col) => {
            return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtyBessSelfConsTs}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessPpa}, 0)`;
        });
    }
    
    addRowCe('revenueTimeshifting', 'di cui: Ricavi da Time Shifting (€)', 'detail', m.revenueTimeshifting, numberFormatEuro, (col) => {
        return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtyBessGridFeedTs}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessTimeshifting}, 0)`;
    });
    addRowCe('revenueArbitrage', 'di cui: Ricavi da Arbitraggio (€)', 'detail', m.revenueArbitrage, numberFormatEuro, (col) => {
        return `IFERROR('DRIVER OPERATIVI'!${col}${rowMap.qtyBessGridFeedArb}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessArbitrage}, 0)`;
    });
    addRowCe('revenueMsd', 'di cui: Ricavi Servizi Ancillari BESS - MSD / Capacity (€)', 'detail', m.revenueMsd, numberFormatEuro);
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('opexTotal', '(-) COSTI OPERATIVI (OPEX) TOTALE SPV (€)', 'group-header', m.opexTotal, numberFormatEuro, (col, yi, ri) => {
        return `${col}${rowMapCe.opexPlants}+${col}${rowMapCe.opexBess}+${col}${rowMapCe.opexGridCharging}+${col}${rowMapCe.opexLandDds}+${col}${rowMapCe.opexInsurance}+${col}${rowMapCe.opexTaxes}+${col}${rowMapCe.opexSecurity}+${col}${rowMapCe.opexAssetManagement}+${col}${rowMapCe.opexServiceContract}`;
    });
    
    addRowCe('opexPlants', 'di cui: O&M Impianti Fotovoltaici (€)', 'minus', m.opexPlants, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexPlants', col, yi, ri));
    addRowCe('opexBess', 'di cui: Costi Operativi BESS (€)', 'minus', m.opexBess, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexBess', col, yi, ri));
    addRowCe('opexGridCharging', 'di cui: Costo Energia Pre-carica da Rete BESS (€)', 'minus', m.opexGridCharging, numberFormatEuro, (col) => {
        return `IFERROR(-('DRIVER OPERATIVI'!${col}${rowMap.qtyBessChargeGrid}*'DRIVER OPERATIVI'!${col}${rowMap.priceBessChargeGrid}), 0)`;
    });
    addRowCe('opexLandDds', 'di cui: Canone DDS/Affitto Terreno (€)', 'minus', m.opexLandDds, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('landDdsAnnuo', col, yi, ri));
    addRowCe('opexInsurance', 'di cui: Assicurazione (All Risk / RC) (€)', 'minus', m.opexInsurance, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexInsurance', col, yi, ri));
    addRowCe('opexTaxes', 'di cui: Tasse Locali / IMU (€)', 'minus', m.opexTaxes, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexTaxes', col, yi, ri));
    addRowCe('opexSecurity', 'di cui: Vigilanza & Sicurezza (€)', 'minus', m.opexSecurity, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexSecurity', col, yi, ri));
    addRowCe('opexAssetManagement', 'di cui: Gestione Amministrativa & Asset Mgt (€)', 'minus', m.opexAssetManagement, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexAssetManagement', col, yi, ri));
    addRowCe('opexServiceContract', isCER ? 'di cui: Contratto di Servizio Commerciale CER (€)' : 'di cui: Contratto di Servizio Commerciale PPA (€)', 'minus', m.opexServiceContract, numberFormatEuro, (col, yi, ri) => getOpexFormulaCe('opexServiceContract', col, yi, ri));
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('ebitda', 'MARGINE OPERATIVO LORDO (EBITDA) (€)', 'bold', m.ebitda, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.revenueTotal}+${col}${rowMapCe.opexTotal}`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    const maxDeprYears = Math.ceil(1 / fiscalDeprRate);
    // Le quote di ammortamento calcolate nel foglio CAPEX sono nella colonna TOTALE PORTAFOGLIO
    // (capexCols.length - 1), NON nella colonna Aliquota (capexCols.length, che è vuota per le quote depr).
    const deprColLetter = getColLetter(capexCols.length - 1);
    addRowCe('depreciationCivil', '(-) Ammortamento Civilistico (€)', 'group-header', m.depreciationCivil, numberFormatEuro, (col, yi) => {
        return `IF(${yi + 1} <= ${maxDeprYears}, IFERROR(-CAPEX!${deprColLetter}${rowMapCapex['totalDepr']}, 0), 0)`;
    });
    
    addRowCe('depreciationCivilSolar', 'di cui: Ammortamento Impianti Solari (€)', 'minus', m.depreciationCivilSolar, numberFormatEuro, (col, yi) => {
        return `IF(${yi + 1} <= ${maxDeprYears}, IFERROR(-CAPEX!${deprColLetter}${rowMapCapex['deprSolar']}, 0), 0)`;
    });
    addRowCe('depreciationCivilBess', 'di cui: Ammortamento BESS (€)', 'minus', m.depreciationCivilBess, numberFormatEuro, (col, yi) => {
        return `IF(${yi + 1} <= ${maxDeprYears}, IFERROR(-CAPEX!${deprColLetter}${rowMapCapex['deprBess']}, 0), 0)`;
    });
    addRowCe('depreciationCivilOther', 'di cui: Ammortamento Altri Costi Capitalizzati (€)', 'minus', m.depreciationCivilOther, numberFormatEuro, (col, yi) => {
        return `IF(${yi + 1} <= ${maxDeprYears}, IFERROR(-(CAPEX!${deprColLetter}${rowMapCapex['deprConn']} + CAPEX!${deprColLetter}${rowMapCapex['deprDev']} + CAPEX!${deprColLetter}${rowMapCapex['deprLandDds']}), 0), 0)`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('ebit', 'EBIT SPV (Risultato Operativo) (€)', 'bold', m.ebit, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.ebitda}+${col}${rowMapCe.depreciationCivil}`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('interestActive', '  (+) Interessi Attivi su MRA (€)', 'plus', m.interestActive, numberFormatEuro);
    addRowCe('interest', '  (-) Interessi Passivi Mutuo Bancario (€)', 'minus', m.interest, numberFormatEuro);
    
    const sociInterestRate = window.State.inputs.sociInterestRate;
    addRowCe('sociInterestAccrued', `  (-) Interessi Finanziamento Soci (Accrual) (${sociInterestRate > 0 ? sociInterestRate.toFixed(2) + '%' : 'Nessuno'}) (€)`, 'minus', m.sociInterestAccrued, numberFormatEuro);
    
    // External financing interest rows (PD è a livello Holding → NON in CE SPV; solo AF convertible resta in CE SPV)
    if (window.State.inputs.afEnabled && window.State.inputs.afType === 'convertible_note') {
        addRowCe('afInterestAccrued', `  (-) Interessi Convertibile (Altra Forma) PIK ${(window.State.inputs.afConvertibleRate||0).toFixed(2)}% (€)`, 'minus', m.afInterestAccrued, numberFormatEuro);
    }
    // External financing opex rows (PE royalty + AF advisory) — mostrate come di cui opex
    if (window.State.inputs.peEnabled && window.State.inputs.peMode === 'royalty_fee') {
        addRowCe('peRoyalty', '  (-) Royalty Private Equity (% Ricavi) (€)', 'minus', m.peRoyalty, numberFormatEuro);
    }
    if (window.State.inputs.afEnabled && window.State.inputs.afType === 'advisory_fee') {
        addRowCe('afFee', '  (-) Advisory Fee (Altra Forma Parasociale) (€)', 'minus', m.afFee, numberFormatEuro);
    }
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('ebt', 'EBT — Utile ante Imposte SPV (€)', 'bold', m.ebt, numberFormatEuro, (col) => {
        // PD rimosso dal CE SPV (è a livello Holding). Restano: soci + AF convertible + PE royalty + AF fee
        let formula = `${col}${rowMapCe.ebit}+${col}${rowMapCe.interestActive}+${col}${rowMapCe.interest}+${col}${rowMapCe.sociInterestAccrued}`;
        if (rowMapCe.afInterestAccrued) formula += `+${col}${rowMapCe.afInterestAccrued}`;
        if (rowMapCe.peRoyalty) formula += `+${col}${rowMapCe.peRoyalty}`;
        if (rowMapCe.afFee) formula += `+${col}${rowMapCe.afFee}`;
        return formula;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    // ── CALCOLO FISCALE DI SUPPORTO (formule: Amm.to Fiscale, Art. 96, Art. 84, Differite) ──
    const _zeroArr = Array(numYears).fill(0);
    addRowCe('taxSupportHdr', 'CALCOLO FISCALE DI SUPPORTO (Amm.to Fiscale, Art. 96/84 TUIR)', 'group-header', null, '');
    
    // Ammortamento fiscale (anno 1 dimezzato) + Aug BESS da anno 11
    addRowCe('taxFiscalDeprBase', 'Amm.to Fiscale Base - anno 1 al 50% (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const base = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst}`;
        const rate = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalDeprRateConst}`;
        if (yi === 0) return `MIN(${base}*${rate}/2, ${base})`;
        const prevCol = getColLetter(yi + 1);
        return `MIN(${base}*${rate}, ${prevCol}${rowMapCe.taxFiscalRemaining})`;
    });
    addRowCe('taxFiscalRemaining', 'Base Fiscale Residua (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const base = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst}`;
        if (yi === 0) return `${base}-${col}${rowMapCe.taxFiscalDeprBase}`;
        const prevCol = getColLetter(yi + 1);
        return `MAX(0, ${prevCol}${rowMapCe.taxFiscalRemaining}-${col}${rowMapCe.taxFiscalDeprBase})`;
    });
    addRowCe('taxAugDepr', 'Amm.to Fiscale Aug BESS - da anno 11 (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const aug = `'DRIVER OPERATIVI'!$B$${rowMap.bessAugConst}`;
        const rate = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalDeprRateConst}`;
        const prevCol = getColLetter(yi + 1);
        return `IF(${yi + 1}>10, MIN(${aug}*${rate}, ${prevCol}${rowMapCe.taxAugRemaining}), 0)`;
    });
    addRowCe('taxAugRemaining', 'Base Fiscale Aug BESS Residua (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const aug = `'DRIVER OPERATIVI'!$B$${rowMap.bessAugConst}`;
        if (yi <= 9) return `${aug}`;
        const prevCol = getColLetter(yi + 1);
        return `MAX(0, ${prevCol}${rowMapCe.taxAugRemaining}-${col}${rowMapCe.taxAugDepr})`;
    });
    addRowCe('taxFiscalDepr', 'Amm.to Fiscale Totale (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.taxFiscalDeprBase}+${col}${rowMapCe.taxAugDepr}`;
    });
    
    // Art. 96 TUIR — deducibilità interessi passivi entro ROL 30%
    addRowCe('taxRolCapacity', 'ROL 30% EBITDA - Art. 96 (€)', 'detail', m.rolCapacity, numberFormatEuro, (col) => {
        return `MAX(0, 0.3*${col}${rowMapCe.ebitda})`;
    });
    addRowCe('taxNetInterest', 'Interessi Passivi Netti - Art. 96 (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        let f = `MAX(0, -${col}${rowMapCe.interest}-${col}${rowMapCe.sociInterestAccrued}`;
        if (rowMapCe.afInterestAccrued) f += `-${col}${rowMapCe.afInterestAccrued}`;
        f += `-${col}${rowMapCe.interestActive})`;
        return f;
    });
    addRowCe('taxDeductibleInterest', 'Interessi Deducibili - Art. 96 (€)', 'detail', m.deductibleInterest, numberFormatEuro, (col, yi) => {
        const prevRol = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxRolCF}` : '0';
        return `${col}${rowMapCe.interestActive}+MIN(${col}${rowMapCe.taxNetInterest}, ${col}${rowMapCe.taxRolCapacity}+${prevRol})`;
    });
    addRowCe('taxRolCF', 'ROL Riportato a Nuovo - Art. 96 (€)', 'detail', m.rolCF, numberFormatEuro, (col, yi) => {
        const prevRol = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxRolCF}` : '0';
        return `MAX(0, ${prevRol}+${col}${rowMapCe.taxRolCapacity}-MIN(${col}${rowMapCe.taxNetInterest}, ${col}${rowMapCe.taxRolCapacity}+${prevRol}))`;
    });
    
    // IRES — imponibile, NOL primi 3 anni (100%) e ordinaria (80%)
    addRowCe('taxTaxableIres', 'Imponibile IRES Lordo (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.ebitda}+${col}${rowMapCe.interestActive}-${col}${rowMapCe.taxDeductibleInterest}-${col}${rowMapCe.taxFiscalDepr}`;
    });
    addRowCe('taxNolFirst3Applied', 'NOL Primi 3 Anni Utilizzata - 100% (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const prev = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxLossFirst3CF}` : '0';
        return `IF(${col}${rowMapCe.taxTaxableIres}>0, MIN(${col}${rowMapCe.taxTaxableIres}, ${prev}), 0)`;
    });
    addRowCe('taxLossFirst3CF', 'NOL Primi 3 Anni Riportata (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const prev = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxLossFirst3CF}` : '0';
        const newLoss = yi < 3 ? `MAX(0, -${col}${rowMapCe.taxTaxableIres})` : '0';
        return `MAX(0, ${prev}-${col}${rowMapCe.taxNolFirst3Applied})+${newLoss}`;
    });
    addRowCe('taxNolNormalApplied', 'NOL Ordinaria Utilizzata - 80% (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const prev = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxLossNormalCF}` : '0';
        return `IF(${col}${rowMapCe.taxTaxableIres}-${col}${rowMapCe.taxNolFirst3Applied}>0, MIN((${col}${rowMapCe.taxTaxableIres}-${col}${rowMapCe.taxNolFirst3Applied})*0.8, ${prev}), 0)`;
    });
    addRowCe('taxLossNormalCF', 'NOL Ordinaria Riportata (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const prev = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxLossNormalCF}` : '0';
        const newLoss = yi >= 3 ? `MAX(0, -${col}${rowMapCe.taxTaxableIres})` : '0';
        return `MAX(0, ${prev}-${col}${rowMapCe.taxNolNormalApplied})+${newLoss}`;
    });
    addRowCe('taxTaxableFinal', 'Imponibile IRES Netto - post NOL (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `MAX(0, ${col}${rowMapCe.taxTaxableIres}-${col}${rowMapCe.taxNolFirst3Applied}-${col}${rowMapCe.taxNolNormalApplied})`;
    });
    
    // IRAP — base = EBIT + IMU + quota IDC civilistico
    addRowCe('taxCivilIdc', 'Quota IDC in Amm.to Civilistico - IRAP (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `-${col}${rowMapCe.depreciationCivil}*('DRIVER OPERATIVI'!$B$${rowMap.idcConst}/'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst})`;
    });
    addRowCe('taxIrapBase', 'Base Imponibile IRAP (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `MAX(0, ${col}${rowMapCe.ebit}-${col}${rowMapCe.opexTaxes}+${col}${rowMapCe.taxCivilIdc})`;
    });
    
    // Imposte Differite — delta (fiscale - civilistico) x aliquote, con fondo e reversal
    addRowCe('taxDeferredRaw', 'Delta Amm.to x Aliquote (€)', 'detail', _zeroArr, numberFormatEuro, (col) => {
        return `(${col}${rowMapCe.taxFiscalDepr}+${col}${rowMapCe.depreciationCivil})*('DRIVER OPERATIVI'!$B$${rowMap.iresRateConst}+'DRIVER OPERATIVI'!$B$${rowMap.irapRateConst})`;
    });
    
    addRowCe('currentTaxesSpv', '  (-) Imposte Correnti SPV (IRES 24% + IRAP 3.9%) (€)', 'minus', m.currentTaxesSpv, numberFormatEuro, (col) => {
        return `-(${col}${rowMapCe.iresTaxSpv}+${col}${rowMapCe.irapTaxSpv})`;
    });
    addRowCe('iresTaxSpv', 'di cui: IRES (24% su EBT +/- Variazioni Fiscali) (€)', 'detail', m.iresTaxSpv, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.taxTaxableFinal}*'DRIVER OPERATIVI'!$B$${rowMap.iresRateConst}`;
    });
    addRowCe('irapTaxSpv', 'di cui: IRAP (3.9% su EBIT + Costi Indeducibili) (€)', 'detail', m.irapTaxSpv, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.taxIrapBase}*'DRIVER OPERATIVI'!$B$${rowMap.irapRateConst}`;
    });
    addRowCe('deferredTaxes', '  (-/+) Variazione Imposte Differite (⇒ Sez. B) (€)', 'detail', m.deferredTaxes, numberFormatEuro, (col, yi) => {
        const prevFund = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxDeferredFund}` : '0';
        return `IF(${col}${rowMapCe.taxDeferredRaw}<0, -MIN(ABS(${col}${rowMapCe.taxDeferredRaw}), MAX(0, ${prevFund})), ${col}${rowMapCe.taxDeferredRaw})`;
    });
    addRowCe('taxDeferredFund', 'Fondo Imposte Differite - saldo (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const prevFund = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxDeferredFund}` : '0';
        return `${prevFund}+${col}${rowMapCe.deferredTaxes}`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('netProfitSpv', 'UTILE NETTO CIVILISTICO SPV (⇒ Sez. B) (€)', 'bold', m.netProfitSpv, numberFormatEuro, (col) => {
        // netProfit = EBT - (correnti + differite); correnti già negative, differite da sottrarre
        return `${col}${rowMapCe.ebt}+${col}${rowMapCe.currentTaxesSpv}-${col}${rowMapCe.deferredTaxes}`;
    });

    // Applicazione Formule Ce a posteriori (dopo che rowMapCe è completa)
    pendingFormulasCe.forEach(pf => {
        pf.cell.value = { formula: pf.formulaFn(pf.colLetter, pf.yearIndex, pf.rowIndex), result: undefined };
    });

    // ---------------------------------------------------------
    // FOGLIO 3: RENDICONTO FINANZIARIO SPV (SEZIONE B)
    // ---------------------------------------------------------
    const sheetRf = workbook.addWorksheet('RENDICONTO FINANZIARIO SPV', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetRf.columns = columns;

    sheetRf.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumRf = 2;
    const rowMapRf = {};
    const pendingFormulasRf = [];

    function addRowRf(key, label, type, dataArray, format, formulaFn = null) {
        if (type === 'section-title') {
            const row = sheetRf.addRow({ label });
            row.getCell(1).font = { bold: true, color: { argb: 'FFE2E8F0' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            // Merge cells across all years (1 column for label + numYears)
            sheetRf.mergeCells(currentRowNumRf, 1, currentRowNumRf, numYears + 1);
            currentRowNumRf++;
            return;
        }

        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val); // Assicura che sia negativo anche se l'array aveva già numeri negativi per errore, ma se l'array aveva un positivo lo fa negativo.
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetRf.addRow(rowValues);
        rowMapRf[key] = currentRowNumRf;

        let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false };
        let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        let indent = 0;

        if (type === 'group-header') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        } else if (type === 'bold') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'bold-teal') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'detail') {
            rowFont = { italic: true, color: { argb: 'FF595959' } };
            indent = 1;
        } else if (type === 'detail-sub') {
            rowFont = { italic: true, color: { argb: 'FF7F7F7F' } };
            indent = 2;
        } else if (type === 'minus') {
            rowFont = { color: { argb: 'FFC00000' } };
        } else if (type === 'plus') {
            rowFont = { color: { argb: 'FF006100' } };
        } else if (type === 'normal') {
            rowFont = { color: { argb: 'FF000000' } };
        }

        row.eachCell((cell, colNumber) => {
            if (colNumber === 1) {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'left', indent: indent, vertical: 'middle' };
                cell.border = { right: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
            } else {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = format;
                cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };

                if (formulaFn) {
                    const colLetter = getColLetter(colNumber);
                    const yearIndex = colNumber - 2;
                    pendingFormulasRf.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNumRf++;
    }

    addRowRf('rf_netProfitSpv', '⇒ Utile Netto Civilistico SPV (da Sez. A) (€)', 'detail', m.netProfitSpv, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO'!${col}${rowMapCe.netProfitSpv}`;
    });
    addRowRf('rf_depreciationCivil', '  (+) Ripresa Ammortamento Civilistico (Non-Cash) (€)', 'plus', m.depreciationCivil, numberFormatEuro, (col) => {
        return `-('CONTO ECONOMICO'!${col}${rowMapCe.depreciationCivil})`;
    });
    addRowRf('rf_deferredTaxes', '  (+/-) Ripresa Imposte Differite (da Sez. A) (€)', 'normal', m.deferredTaxes, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO'!${col}${rowMapCe.deferredTaxes}`;
    });
    addRowRf('rf_interest', '  (+) Ripresa Interessi Mutuo Bancario Senior (Accrual) (€)', 'plus', m.interest, numberFormatEuro, (col) => {
        return `-('CONTO ECONOMICO'!${col}${rowMapCe.interest})`;
    });
    addRowRf('rf_sociInterestAccrued', '  (+) Ripresa Interessi Finanziamento Soci (Accrual) (€)', 'plus', m.sociInterestAccrued, numberFormatEuro, (col) => {
        return `-('CONTO ECONOMICO'!${col}${rowMapCe.sociInterestAccrued})`;
    });
    // PD è a livello Holding → NON c'è ripresa interessi PD nel RF SPV
    if (window.State.inputs.afEnabled && window.State.inputs.afType === 'convertible_note') {
        addRowRf('rf_afInterestAccrued', '  (+) Ripresa Interessi Convertibile (Altra Forma) (€)', 'plus', m.afInterestAccrued, numberFormatEuro, (col) => {
            return `-('CONTO ECONOMICO'!${col}${rowMapCe.afInterestAccrued})`;
        });
    }
    addRowRf('opexMaintReserve', '  (-) Accantonamento a Riserva di Manutenzione (MRA) (€)', 'minus', m.opexMaintReserve, numberFormatEuro);
    addRowRf('bessAugmentationCost', '  (-) CAPEX Sostituzione Celle NMC/LFP BESS (€)', 'minus', m.bessAugmentationCost, numberFormatEuro);
    addRowRf('mraRelease', '  (+) Rilascio Riserva di Manutenzione (MRA) per CAPEX BESS (€)', 'plus', m.mraRelease, numberFormatEuro);
    
    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('cfads', 'CFADS SPV (Cassa Disponibile ante Servizio Debito) (€)', 'bold-teal', m.cfads, numberFormatEuro, (col) => {
        // PD rimosso dal CFADS SPV (è a livello Holding)
        let formula = `${col}${rowMapRf.rf_netProfitSpv}+${col}${rowMapRf.rf_depreciationCivil}+${col}${rowMapRf.rf_deferredTaxes}+${col}${rowMapRf.rf_interest}+${col}${rowMapRf.rf_sociInterestAccrued}`;
        if (rowMapRf.rf_afInterestAccrued) formula += `+${col}${rowMapRf.rf_afInterestAccrued}`;
        formula += `+${col}${rowMapRf.opexMaintReserve}+${col}${rowMapRf.bessAugmentationCost}+${col}${rowMapRf.mraRelease}`;
        return formula;
    });

    // DSRA: utilizzo a copertura del servizio debito (se abilitato)
    if ((window.State.inputs.dsraMonths || 0) > 0) {
        addRowRf('dsraDraw', '  (+) Utilizzo DSRA a copertura servizio debito (€)', 'plus', m.dsraDraw, numberFormatEuro);
    }

    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('sec_1', 'SERVIZIO DEL DEBITO SENIOR MUTUO BANCARIO SPV', 'section-title');
    addRowRf('interestPaid', '  (-) Quota Interessi Mutuo Bancario Pagati (€)', 'minus', m.interestPaid, numberFormatEuro, (col) => {
        return `AMMORTAMENTO!${col}${rowMapDebt['interestAccrued']}`;
    });
    addRowRf('principalScheduled', '  (-) Quota Capitale Mutuo Bancario Programmata (€)', 'minus', m.principalScheduled, numberFormatEuro, (col) => {
        return `AMMORTAMENTO!${col}${rowMapDebt['principalScheduled']}`;
    });
    addRowRf('principalVoluntary', '  (-) Cash Sweep Mutuo Bancario Volontario (€)', 'minus', m.principalVoluntary, numberFormatEuro, (col) => {
        return `AMMORTAMENTO!${col}${rowMapDebt['principalVoluntary']}`;
    });
    
    const st = window.State.inputs.sweepType;
    if (st !== 'none') {
        const typeStr = st === 'pct_cfads' ? `${window.State.inputs.sweepValue}% del CFADS disponibile` : `€ ${window.State.inputs.sweepValue.toLocaleString('it-IT')} fissi/anno`;
        const durStr = window.State.inputs.sweepYears > 0 ? `per ${window.State.inputs.sweepYears} anni` : 'fino a estinzione mutuo';
        addRowRf('_sweepDetailLabel', `Sweep: ${typeStr} — ${durStr}`, 'detail', null, numberFormatEuro);
    }
    
    // DSRA: accantonamento/integrazione fino al target (se abilitato)
    if ((window.State.inputs.dsraMonths || 0) > 0) {
        addRowRf('dsraFunding', '  (-) Accantonamento/Integrazione DSRA (€)', 'minus', m.dsraFunding, numberFormatEuro);
    }

    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('spvFCFE', 'CASSA DISPONIBILE POST-DEBITO SENIOR (FCFE SPV) (€)', 'bold-teal', m.spvFCFE, numberFormatEuro, (col) => {
        let f = `${col}${rowMapRf.cfads}+${col}${rowMapRf.interestPaid}+${col}${rowMapRf.principalScheduled}+${col}${rowMapRf.principalVoluntary}`;
        if (rowMapRf.dsraDraw) f += `+${col}${rowMapRf.dsraDraw}`;
        if (rowMapRf.dsraFunding) f += `+${col}${rowMapRf.dsraFunding}`;
        return f;
    });

    if ((window.State.inputs.dsraMonths || 0) > 0) {
        addRowRf('dsraRelease', '  (+) Rilascio DSRA a estinzione debito/exit (€)', 'plus', m.dsraRelease, numberFormatEuro);
    }

    // PD è a livello Holding: il servizio PD non è più nel RF SPV (gestito nel Rendiconto Holding, sezione C)

    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('sec_2', 'CASCATA DISTRIBUZIONE SPV → HOLDCO (Waterfall)', 'section-title');
    // Quota dividendi/preferred Private Equity a partner esterno (non sale alla HoldCo)
    if (window.State.inputs.peEnabled && window.State.inputs.peMode !== 'royalty_fee') {
        addRowRf('peDividendPaid', '  (-) Quota Dividendi/Preferred Private Equity a Partner Esterno (€)', 'minus', m.peDividendPaid, numberFormatEuro);
    }
    addRowRf('holdcoInterestReceived', '  (-) Interessi Soci Pagati da SPV a HoldCo (⇒ Sez. C) (€)', 'minus', m.holdcoInterestReceived, numberFormatEuro);
    addRowRf('holdcoLoanRepaymentReceived', '  (-) Rimborso Capitale Finanziamento Soci a HoldCo (⇒ Sez. C) (€)', 'minus', m.holdcoLoanRepaymentReceived, numberFormatEuro);
    addRowRf('spvLockedDividends', '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti (€)', 'detail', null, numberFormatEuro, (col, yearIdx) => {
        const prevCol = yearIdx > 0 ? getColLetter(yearIdx + 1) : null;
        if (yearIdx === 0) {
            return `0`;
        } else {
            const prevIsExit = (yearIdx - 1 === numYears - 1) ? 'TRUE()' : 'FALSE()';
            return `IF(FINANZA!$B$${rowMapFin['dividendLock']}="Sì", IF(AND(AMMORTAMENTO!${prevCol}${rowMapDebt['endingBalance']} > 0.01, NOT(${prevIsExit})), ${prevCol}${rowMapRf.spvLockedDividends} + MAX(0, ${prevCol}${rowMapRf.spvFCFE} + ${prevCol}${rowMapRf.holdcoInterestReceived} + ${prevCol}${rowMapRf.holdcoLoanRepaymentReceived}), 0), 0)`;
        }
    });
    addRowRf('holdcoDividendReceived', '  (-) Dividendi SPV Distribuiti a HoldCo (⇒ Sez. C) (€)', 'minus', m.holdcoDividendReceived, numberFormatEuro, (col, yearIdx) => {
        const isExitYear = yearIdx === numYears - 1 ? 'TRUE()' : 'FALSE()';
        return `-IF(FINANZA!$B$${rowMapFin['dividendLock']}="Sì", IF(AND(AMMORTAMENTO!${col}${rowMapDebt['endingBalance']} > 0.01, NOT(${isExitYear})), 0, MAX(0, ${col}${rowMapRf.spvFCFE} + ${col}${rowMapRf.holdcoInterestReceived} + ${col}${rowMapRf.holdcoLoanRepaymentReceived}) + ${col}${rowMapRf.spvLockedDividends}), MAX(0, ${col}${rowMapRf.spvFCFE} + ${col}${rowMapRf.holdcoInterestReceived} + ${col}${rowMapRf.holdcoLoanRepaymentReceived}))`;
    });
    
    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('spvCashTrap', '(=) Cassa Rimanente non distribuita in SPV (Cash Trap) (€)', 'bold', m.spvCashTrap, numberFormatEuro, (col) => {
        return `MAX(${col}${rowMapRf.spvFCFE}+${col}${rowMapRf.holdcoInterestReceived}+${col}${rowMapRf.holdcoLoanRepaymentReceived}+${col}${rowMapRf.holdcoDividendReceived}, 0)`;
    });

    // ---------------------------------------------------------
    // FOGLIO 4: RENDICONTO FINANZIARIO HOLDING (SEZIONE C)
    // ---------------------------------------------------------
    const sheetHc = workbook.addWorksheet('RENDICONTO FINANZIARIO HOLDING', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetHc.columns = columns;

    sheetHc.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumHc = 2;
    const rowMapHc = {};
    const pendingFormulasHc = [];

    function addRowHc(key, label, type, dataArray, format, formulaFn = null) {
        if (type === 'section-title') {
            const row = sheetHc.addRow({ label });
            row.getCell(1).font = { bold: true, color: { argb: 'FFE2E8F0' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            sheetHc.mergeCells(currentRowNumHc, 1, currentRowNumHc, numYears + 1);
            currentRowNumHc++;
            return;
        }

        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val); // Assicura che sia negativo anche se l'array aveva già numeri negativi per errore, ma se l'array aveva un positivo lo fa negativo.
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetHc.addRow(rowValues);
        rowMapHc[key] = currentRowNumHc;

        let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false };
        let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        let indent = 0;

        if (type === 'group-header') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        } else if (type === 'bold') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'bold-rose') {
            rowFont = { bold: true, color: { argb: 'FFC00000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'total-gold') {
            rowFont = { bold: true, color: { argb: 'FF000000' } };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        } else if (type === 'detail') {
            rowFont = { italic: true, color: { argb: 'FF595959' } };
            indent = 1;
        } else if (type === 'minus') {
            rowFont = { color: { argb: 'FFC00000' } };
        } else if (type === 'plus') {
            rowFont = { color: { argb: 'FF006100' } };
        }

        row.eachCell((cell, colNumber) => {
            if (colNumber === 1) {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'left', indent: indent, vertical: 'middle' };
                cell.border = { right: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
            } else {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = format;
                cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };

                if (formulaFn) {
                    const colLetter = getColLetter(colNumber);
                    const yearIndex = colNumber - 2;
                    pendingFormulasHc.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNumHc++;
    }

    addRowHc('holdcoInflowTotal', '⇒ Flusso Cassa Risalito Totale da SPV (da Sez. B) (€)', 'group-header', m.holdcoInflowTotal, numberFormatEuro, (col) => {
        return `${col}${rowMapHc.hc_holdcoInterestReceived}+${col}${rowMapHc.hc_holdcoLoanRepaymentReceived}+${col}${rowMapHc.hc_holdcoDividendReceived}+${col}${rowMapHc.hc_holdcoAssetManagementReceived}`;
    });
    
    addRowHc('hc_holdcoInterestReceived', '  di cui: Interessi Finanziamento Soci ricevuti (€)', 'detail', m.holdcoInterestReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoInterestReceived})`;
    });
    addRowHc('hc_holdcoLoanRepaymentReceived', '  di cui: Rimborso Capitale Finanziamento Soci ricevuto (€)', 'detail', m.holdcoLoanRepaymentReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoLoanRepaymentReceived})`;
    });
    addRowHc('hc_holdcoDividendReceived', '  di cui: Dividendi SPV ricevuti (quota Sponsor) (€)', 'detail', m.holdcoDividendReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoDividendReceived})`;
    });
    if (window.State.inputs.peEnabled && window.State.inputs.peMode !== 'royalty_fee') {
        addRowHc('hc_peDividendPaid', '  (-) Quota Dividendi/Preferred Private Equity (non sale alla HoldCo) (€)', 'minus', m.peDividendPaid, numberFormatEuro, (col) => {
            return `'RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.peDividendPaid}`;
        });
    }
    addRowHc('hc_holdcoAssetManagementReceived', '  di cui: Ricavi Gestione Amministrativa & Asset Mgt ricevuti da SPV (€)', 'detail', m.opexAssetManagement, numberFormatEuro, (col) => {
        return `-('CONTO ECONOMICO'!${col}${rowMapCe.opexAssetManagement})`;
    });
    
    addRowHc('holdcoOpex', '  (-) Spese Funzionamento Holding (€)', 'minus', m.holdcoOpex, numberFormatEuro);
    addRowHc('holdcoEarnoutPaid', '  (-) Earn-Out Holding (€)', 'minus', m.holdcoEarnoutPaid, numberFormatEuro);
    // IRES HoldCo: 24% su (interessi + 5% dividendi + asset mgt - opex - interessi PD se deducibili)
    const _pdDedHc = window.State.inputs.pdEnabled && window.State.inputs.pdTaxDeductible !== false;
    addRowHc('holdcoIresTaxPaid', '  (-) Imposta IRES HoldCo (24% su interessi netti e 5% dividendi) (€)', 'bold-rose', m.holdcoIresTaxPaid, numberFormatEuro, (col) => {
        let f = `-MAX(0, ${col}${rowMapHc.hc_holdcoInterestReceived}+0.05*${col}${rowMapHc.hc_holdcoDividendReceived}+${col}${rowMapHc.hc_holdcoAssetManagementReceived}+${col}${rowMapHc.holdcoOpex}`;
        if (_pdDedHc && rowMapHc.pdInterestPaid) f += `+${col}${rowMapHc.pdInterestPaid}`;
        f += `)*'DRIVER OPERATIVI'!$B$${rowMap.iresRateConst}`;
        return f;
    });
    addRowHc('holdcoIrapTaxPaid', '  (-) Imposta IRAP HoldCo (3,9% su Valore Produzione Netta) (€)', 'bold-rose', m.holdcoIrapTaxPaid, numberFormatEuro, (col) => {
        return `-MAX(0, ${col}${rowMapHc.hc_holdcoAssetManagementReceived}+${col}${rowMapHc.holdcoOpex})*'DRIVER OPERATIVI'!$B$${rowMap.irapRateConst}`;
    });
    
    sheetHc.addRow([]); currentRowNumHc++;
    
    addRowHc('holdcoNetProfit', 'UTILE NETTO HOLDING CIVILISTICO (€)', 'bold', m.holdcoNetProfit, numberFormatEuro, (col) => {
        return `${col}${rowMapHc.hc_holdcoInterestReceived}+${col}${rowMapHc.hc_holdcoDividendReceived}+${col}${rowMapHc.hc_holdcoAssetManagementReceived}+${col}${rowMapHc.holdcoOpex}+${col}${rowMapHc.holdcoEarnoutPaid}+${col}${rowMapHc.holdcoIresTaxPaid}+${col}${rowMapHc.holdcoIrapTaxPaid}`;
    });
    
    addRowHc('hc_reconcileLoanRepayment', '  (+) Rimborso Capitale Finanziamento Soci (Cassa Patrimoniale) (€)', 'plus', m.holdcoLoanRepaymentReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoLoanRepaymentReceived})`;
    });
    
    // ── SERVIZIO PRIVATE DEBT (HOLDING LEVEL) — se abilitato ──
    if (window.State.inputs.pdEnabled) {
        sheetHc.addRow([]); currentRowNumHc++;
        addRowHc('sec_pd_holdco', null, 'section-title');
        // sovrascrivi label della section-title
        const secRow = sheetHc.getRow(currentRowNumHc - 1);
        if (secRow) secRow.getCell(1).value = 'SERVIZIO PRIVATE DEBT (HOLDING LEVEL)';
        addRowHc('pdInterestPaid', '  (-) Interessi Private Debt Pagati dalla Holding (€)', 'minus', m.pdInterestPaid, numberFormatEuro, (col) => {
            return `AMMORTAMENTO!${col}${rowMapDebt['interestPaidPd']}`;
        });
        addRowHc('pdPrincipalPaid', '  (-) Quota Capitale Private Debt (Ammortamento) (€)', 'minus', m.pdPrincipalPaid, numberFormatEuro, (col) => {
            return `AMMORTAMENTO!${col}${rowMapDebt['principalPaidPd']}`;
        });
    }
    
    sheetHc.addRow([]); currentRowNumHc++;
    
    // ── EXIT SPV (senza PD, che è a Holding level) ──
    addRowHc('exitValuationGroup', 'FLUSSO DA DISMISSIONE INVESTIMENTO (EXIT SPV) (€)', 'group-header', m.exitNetProceedsRow, numberFormatEuro, (col) => {
        // exitValuationGroup SPV = EV - senior - PE - AF - PEX (senza PD)
        let formula = `${col}${rowMapHc.exitEnterpriseValue}+${col}${rowMapHc.exitDebtPayoff}`;
        if (rowMapHc.peExitShare) formula += `+${col}${rowMapHc.peExitShare}`;
        if (rowMapHc.afExitCost) formula += `+${col}${rowMapHc.afExitCost}`;
        formula += `+${col}${rowMapHc.exitPexTaxRow}`;
        return formula;
    });
    
    addRowHc('exitEnterpriseValue', 'di cui: Enterprise Value di Exit (€)', 'detail', m.exitEnterpriseValue, numberFormatEuro, (col, yearIdx) => {
        if (m.exitEnterpriseValue[yearIdx] > 0) {
            return `FINANZA!$B$${rowMapFin['exitValuePerMwp']} * ('DRIVER OPERATIVI'!${col}${rowMap['totKwp']} / 1000)`;
        } else {
            return `0`;
        }
    });
    addRowHc('exitDebtPayoff', '  (-) di cui: Rimborso Debito Residuo Mutuo Bancario (€)', 'detail', m.exitDebtPayoff, numberFormatEuro, (col, yearIdx) => {
        if (m.exitDebtPayoff[yearIdx] < 0 || m.exitDebtPayoff[yearIdx] > 0) {
            return `-AMMORTAMENTO!${col}${rowMapDebt['endingBalance']}`;
        } else {
            return `0`;
        }
    });
    // Quota Exit Private Equity (SPV level — PE resta a SPV)
    if (window.State.inputs.peEnabled) {
        addRowHc('peExitShare', '  (-) di cui: Quota Exit Private Equity (Partner Esterno) (€)', 'detail', m.peExitShare, numberFormatEuro);
    }
    // Costo Exit Altra Forma (SPV level)
    if (window.State.inputs.afEnabled) {
        addRowHc('afExitCost', '  (-) di cui: Costo Exit Altra Forma (Success Fee/Warrant/Convertibile) (€)', 'detail', m.afExitCost, numberFormatEuro);
    }
    addRowHc('exitPexTaxRow', '  (-) di cui: Imposte PEX su Plusvalenza Exit (€)', 'detail', m.exitPexTaxRow, numberFormatEuro);
    
    // ── PAYOFF PRIVATE DEBT (HOLDING LEVEL) A EXIT — se abilitato ──
    if (window.State.inputs.pdEnabled) {
        sheetHc.addRow([]); currentRowNumHc++;
        addRowHc('sec_pd_payoff_holdco', null, 'section-title');
        const secRow2 = sheetHc.getRow(currentRowNumHc - 1);
        if (secRow2) secRow2.getCell(1).value = 'PAYOFF PRIVATE DEBT (HOLDING LEVEL) A EXIT';
        addRowHc('pdBulletPayoff', '  (-) Payoff Private Debt (Bullet/Residuo) dalla cassa Holding (€)', 'minus', m.pdBulletPayoff, numberFormatEuro, (col, yearIdx) => {
            if (m.pdBulletPayoff && m.pdBulletPayoff[yearIdx] > 0) {
                return `AMMORTAMENTO!${col}${rowMapDebt['bulletPayoffPd']}`;
            }
            return `0`;
        });
        addRowHc('exitLimitedLiability', '  (+) Limited Liability Holding / Debt Forgiveness PD (se cassa < saldo) (€)', 'plus', m.exitLimitedLiability, numberFormatEuro);
    }
    
    sheetHc.addRow([]); currentRowNumHc++;
    
    addRowHc('holdcoFCFE', 'FCFE — FLUSSO NETTO INVESTITORE (€)', 'total-gold', m.holdcoFCFE, numberFormatEuro, (col) => {
        // FCFE Holding = netProfit + rimborso soci + exit SPV - servizio PD Holding - payoff PD Holding + quota PE dividend
        let formula = `${col}${rowMapHc.holdcoNetProfit}+${col}${rowMapHc.hc_reconcileLoanRepayment}+${col}${rowMapHc.exitValuationGroup}`;
        if (rowMapHc.hc_peDividendPaid) formula += `+${col}${rowMapHc.hc_peDividendPaid}`;
        if (rowMapHc.pdInterestPaid) formula += `+${col}${rowMapHc.pdInterestPaid}`;
        if (rowMapHc.pdPrincipalPaid) formula += `+${col}${rowMapHc.pdPrincipalPaid}`;
        if (rowMapHc.pdBulletPayoff) formula += `+${col}${rowMapHc.pdBulletPayoff}`;
        if (rowMapHc.exitLimitedLiability) formula += `+${col}${rowMapHc.exitLimitedLiability}`;
        return formula;
    });
    
    addRowHc('holdcoFCFECumulated', 'FCFE CUMULATO INVESTITORE (€)', 'total-gold', m.holdcoFCFECumulated, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) {
            return `${col}${rowMapHc.holdcoFCFE}`;
        } else {
            const prevCol = getColLetter(yearIdx + 1); // getColLetter(1) is A, getColLetter(2) is B (Year 1). So yearIdx 1 (Year 2) needs prevCol which is getColLetter(1+1) = getColLetter(2) = B.
            return `${prevCol}${rowMapHc.holdcoFCFECumulated}+${col}${rowMapHc.holdcoFCFE}`;
        }
    });

    // ---------------------------------------------------------
    // FOGLIO FINANZA
    const sheetFin = workbook.addWorksheet('FINANZA', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetFin.columns = [
        { header: 'PARAMETRI E STRUTTURA FINANZIARIA', key: 'label', width: 50 },
        { header: 'Valore', key: 'val', width: 25 },
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

    const paramsFin = window.State.inputs;
    
    // --- TASSI E RENDIMENTI ---
    addFinRow('hdrTassi', 'TASSI E RENDIMENTI (MACRO)', true, true);
    
    addFinRow('keVal', 'Ke Valutativo (Cost of Equity)');
    sheetFin.getCell(`B${rowMapFin['keVal']}`).value = paramsFin.keVal;
    sheetFin.getCell(`B${rowMapFin['keVal']}`).numFmt = numberFormatPct;

    addFinRow('wacc', 'WACC (Weighted Average Cost of Capital)');
    sheetFin.getCell(`B${rowMapFin['wacc']}`).value = paramsFin.wacc;
    sheetFin.getCell(`B${rowMapFin['wacc']}`).numFmt = numberFormatPct;

    addFinRow('inflation', 'Inflazione Media Attesa');
    sheetFin.getCell(`B${rowMapFin['inflation']}`).value = paramsFin.inflation;
    sheetFin.getCell(`B${rowMapFin['inflation']}`).numFmt = numberFormatPct;

    addFinRow('fiscalDeprRate', 'Tasso di Ammortamento Fiscale');
    sheetFin.getCell(`B${rowMapFin['fiscalDeprRate']}`).value = paramsFin.fiscalDeprRate;
    sheetFin.getCell(`B${rowMapFin['fiscalDeprRate']}`).numFmt = numberFormatPct;

    sheetFin.addRow([]); currentRowFin++;

    // --- STRUTTURA DEL DEBITO & CASH SWEEP ---
    addFinRow('hdrDebito', 'STRUTTURA DEL DEBITO & CASH SWEEP', true, true);

    addFinRow('leverage', 'Leverage (D/E Ratio Target)');
    sheetFin.getCell(`B${rowMapFin['leverage']}`).value = paramsFin.leverage;
    sheetFin.getCell(`B${rowMapFin['leverage']}`).numFmt = numberFormatPct;
    
    addFinRow('interestRate', 'Tasso Interesse Debito Senior');
    sheetFin.getCell(`B${rowMapFin['interestRate']}`).value = paramsFin.interestRate;
    sheetFin.getCell(`B${rowMapFin['interestRate']}`).numFmt = numberFormatPct;

    addFinRow('debtBasisType', 'Base di Calcolo Debito (Debt Basis)');
    sheetFin.getCell(`B${rowMapFin['debtBasisType']}`).value = paramsFin.debtBasis === 'ev_ex_spv' ? 'Totale Investimento al netto SPV' : 'Totale Investimento (Hard Costs)';

    addFinRow('loanTerm', 'Durata Debito Senior (Anni)');
    sheetFin.getCell(`B${rowMapFin['loanTerm']}`).value = paramsFin.loanTerm;

    let sweepLabel = 'Nessuno';
    if (paramsFin.sweepType === 'pct_cfads') sweepLabel = '% del CFADS';
    else if (paramsFin.sweepType === 'fixed_eur') sweepLabel = '€ Fisso/Anno';
    addFinRow('sweepType', 'Tipo di Cash Sweep');
    sheetFin.getCell(`B${rowMapFin['sweepType']}`).value = sweepLabel;

    addFinRow('sweepValue', paramsFin.sweepType === 'fixed_eur' ? 'Valore Cash Sweep (€)' : 'Valore Cash Sweep (%)');
    sheetFin.getCell(`B${rowMapFin['sweepValue']}`).value = paramsFin.sweepType === 'fixed_eur' ? paramsFin.sweepValue : paramsFin.sweepValue / 100;
    sheetFin.getCell(`B${rowMapFin['sweepValue']}`).numFmt = paramsFin.sweepType === 'fixed_eur' ? numberFormatEuro : numberFormatPct;

    addFinRow('sweepYears', 'Durata Cash Sweep (Anni, 0=Sempre)');
    sheetFin.getCell(`B${rowMapFin['sweepYears']}`).value = paramsFin.sweepYears;

    sheetFin.addRow([]); currentRowFin++;

    // --- FINANZIAMENTO SOCI E HOLDING ---
    addFinRow('hdrSoci', 'FINANZIAMENTO SOCI E HOLDING', true, true);

    addFinRow('sociEquityPct', 'Quota Equity Finanziata dai Soci (%)');
    sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`).value = paramsFin.sociEquityPct / 100;
    sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`).numFmt = numberFormatPct;
    
    addFinRow('sociInterestRate', 'Tasso Interesse Finanziamento Soci');
    sheetFin.getCell(`B${rowMapFin['sociInterestRate']}`).value = paramsFin.sociInterestRate / 100;
    sheetFin.getCell(`B${rowMapFin['sociInterestRate']}`).numFmt = numberFormatPct;

    addFinRow('sociInterestGrace', 'Preammortamento Interessi Soci (Anni)');
    sheetFin.getCell(`B${rowMapFin['sociInterestGrace']}`).value = paramsFin.sociInterestGrace;

    addFinRow('sociPrincipalGrace', 'Preammortamento Capitale Soci (Anni)');
    sheetFin.getCell(`B${rowMapFin['sociPrincipalGrace']}`).value = paramsFin.sociPrincipalGrace;

    sheetFin.addRow([]); currentRowFin++;

    // --- PRIVATE DEBT (MEZZANINE SPV) ---
    addFinRow('hdrPd', 'PRIVATE DEBT — MEZZANINE ESTERNA SPV', true, true);
    addFinRow('pdEnabled', 'Private Debt Attivo');
    sheetFin.getCell(`B${rowMapFin['pdEnabled']}`).value = paramsFin.pdEnabled ? 'SÌ' : 'NO';
    addFinRow('pdAmountType', 'Modalità Importo Private Debt');
    const pdAmtTypeLabel = paramsFin.pdAmountType === 'pct_bankable' ? '% Base Finanziabile' : (paramsFin.pdAmountType === 'pct_totusi' ? '% Totale Fabbisogno' : 'Importo Fisso (€)');
    sheetFin.getCell(`B${rowMapFin['pdAmountType']}`).value = pdAmtTypeLabel;
    addFinRow('pdAmountValue', 'Valore Importo Private Debt');
    sheetFin.getCell(`B${rowMapFin['pdAmountValue']}`).value = paramsFin.pdAmountValue || 0;
    sheetFin.getCell(`B${rowMapFin['pdAmountValue']}`).numFmt = (paramsFin.pdAmountType === 'fixed_eur') ? numberFormatEuro : numberFormatPct;
    addFinRow('pdInterestRate', 'Tasso Interesse Private Debt');
    sheetFin.getCell(`B${rowMapFin['pdInterestRate']}`).value = (paramsFin.pdInterestRate || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['pdInterestRate']}`).numFmt = numberFormatPct;
    addFinRow('pdMode', 'Modalità Rimborso Private Debt');
    const pdModeLabel = paramsFin.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (paramsFin.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
    sheetFin.getCell(`B${rowMapFin['pdMode']}`).value = pdModeLabel;
    addFinRow('pdInterestGrace', 'Grazia Interessi Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdInterestGrace']}`).value = paramsFin.pdInterestGrace || 0;
    addFinRow('pdPrincipalGrace', 'Grazia Capitale Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdPrincipalGrace']}`).value = paramsFin.pdPrincipalGrace || 0;
    addFinRow('pdLoanTerm', 'Durata Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdLoanTerm']}`).value = paramsFin.pdLoanTerm || 0;
    addFinRow('pdTaxDeductible', 'Interessi PD Deducibili Fiscalmente');
    sheetFin.getCell(`B${rowMapFin['pdTaxDeductible']}`).value = paramsFin.pdTaxDeductible ? 'SÌ' : 'NO';
    addFinRow('pdWaterfallRank', 'Posizione Waterfall Private Debt');
    sheetFin.getCell(`B${rowMapFin['pdWaterfallRank']}`).value = paramsFin.pdWaterfallRank === 'after_soci' ? 'Dopo Soci (più subordinato)' : 'Dopo Senior, prima Soci';

    sheetFin.addRow([]); currentRowFin++;

    // --- PRIVATE EQUITY (CO-INVESTITORE SPV) ---
    addFinRow('hdrPe', 'PRIVATE EQUITY — CO-INVESTITORE ESTERNO SPV', true, true);
    addFinRow('peEnabled', 'Private Equity Attivo');
    sheetFin.getCell(`B${rowMapFin['peEnabled']}`).value = paramsFin.peEnabled ? 'SÌ' : 'NO';
    addFinRow('peAmountType', 'Modalità Importo Private Equity');
    sheetFin.getCell(`B${rowMapFin['peAmountType']}`).value = paramsFin.peAmountType === 'pct_equity' ? '% Equity Totale' : 'Importo Fisso (€)';
    addFinRow('peAmountValue', 'Valore Importo Private Equity');
    sheetFin.getCell(`B${rowMapFin['peAmountValue']}`).value = paramsFin.peAmountValue || 0;
    sheetFin.getCell(`B${rowMapFin['peAmountValue']}`).numFmt = (paramsFin.peAmountType === 'fixed_eur') ? numberFormatEuro : numberFormatPct;
    addFinRow('peMode', 'Struttura Remunerazione PE');
    const peModeLabel = { dividend_share: 'Quote Dividendi Proporzionale', preferred_return: 'Preferred Return (Hurdle Composto)', bullet_exit: 'Bullet a Exit (Multiplo Garantito)', royalty_fee: 'Royalty % Ricavi (Parasociale)' }[paramsFin.peMode] || paramsFin.peMode;
    sheetFin.getCell(`B${rowMapFin['peMode']}`).value = peModeLabel;
    addFinRow('peHurdleRate', 'Hurdle Rate PE (composto)');
    sheetFin.getCell(`B${rowMapFin['peHurdleRate']}`).value = (paramsFin.peHurdleRate || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['peHurdleRate']}`).numFmt = numberFormatPct;
    addFinRow('pePreferredPct', '% Dividendi Preferred PE');
    sheetFin.getCell(`B${rowMapFin['pePreferredPct']}`).value = (paramsFin.pePreferredPct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['pePreferredPct']}`).numFmt = numberFormatPct;
    addFinRow('peExitMultiple', 'Multiplo Exit Garantito PE (x)');
    sheetFin.getCell(`B${rowMapFin['peExitMultiple']}`).value = paramsFin.peExitMultiple || 0;
    addFinRow('peRoyaltyPct', 'Royalty % Ricavi PE');
    sheetFin.getCell(`B${rowMapFin['peRoyaltyPct']}`).value = (paramsFin.peRoyaltyPct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['peRoyaltyPct']}`).numFmt = numberFormatPct;
    addFinRow('peParticipatesExit', 'PE Partecipa Exit Equity Value');
    sheetFin.getCell(`B${rowMapFin['peParticipatesExit']}`).value = paramsFin.peParticipatesExit ? 'SÌ' : 'NO';

    sheetFin.addRow([]); currentRowFin++;

    // --- ALTRA FORMA (PARASOCIALE/CONVERTIBILE) ---
    addFinRow('hdrAf', 'ALTRA FORMA — ACCORDI PARASOCIALI/STATUTARI/CONVERTIBILI', true, true);
    addFinRow('afEnabled', 'Altra Forma Attiva');
    sheetFin.getCell(`B${rowMapFin['afEnabled']}`).value = paramsFin.afEnabled ? 'SÌ' : 'NO';
    addFinRow('afType', 'Tipo Accordo Altra Forma');
    const afTypeLabel = { advisory_fee: 'Advisory Fee Annuo', success_fee_exit: 'Success Fee a Exit (% EV)', warrant_kicker: 'Warrant Kicker (% Equity Exit)', convertible_note: 'Convertibile (PIK + %EV)' }[paramsFin.afType] || paramsFin.afType;
    sheetFin.getCell(`B${rowMapFin['afType']}`).value = afTypeLabel;
    addFinRow('afAnnualAmount', 'Importo Annuo Advisory (€)');
    sheetFin.getCell(`B${rowMapFin['afAnnualAmount']}`).value = paramsFin.afAnnualAmount || 0;
    sheetFin.getCell(`B${rowMapFin['afAnnualAmount']}`).numFmt = numberFormatEuro;
    addFinRow('afRevenuePct', 'Quota % Ricavi Advisory');
    sheetFin.getCell(`B${rowMapFin['afRevenuePct']}`).value = (paramsFin.afRevenuePct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['afRevenuePct']}`).numFmt = numberFormatPct;
    addFinRow('afExitPct', 'Success Fee % EV');
    sheetFin.getCell(`B${rowMapFin['afExitPct']}`).value = (paramsFin.afExitPct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['afExitPct']}`).numFmt = numberFormatPct;
    addFinRow('afWarrantPct', 'Warrant % Equity Exit');
    sheetFin.getCell(`B${rowMapFin['afWarrantPct']}`).value = (paramsFin.afWarrantPct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['afWarrantPct']}`).numFmt = numberFormatPct;
    addFinRow('afConvertibleAmount', 'Importo Convertibile (€)');
    sheetFin.getCell(`B${rowMapFin['afConvertibleAmount']}`).value = paramsFin.afConvertibleAmount || 0;
    sheetFin.getCell(`B${rowMapFin['afConvertibleAmount']}`).numFmt = numberFormatEuro;
    addFinRow('afConvertibleRate', 'Tasso PIK Composto Convertibile');
    sheetFin.getCell(`B${rowMapFin['afConvertibleRate']}`).value = (paramsFin.afConvertibleRate || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['afConvertibleRate']}`).numFmt = numberFormatPct;
    addFinRow('afConvertiblePct', 'Partecipazione % EV Convertibile');
    sheetFin.getCell(`B${rowMapFin['afConvertiblePct']}`).value = (paramsFin.afConvertiblePct || 0) / 100;
    sheetFin.getCell(`B${rowMapFin['afConvertiblePct']}`).numFmt = numberFormatPct;
    addFinRow('afTaxDeductible', 'Costo/Interessi AF Deducibili SPV');
    sheetFin.getCell(`B${rowMapFin['afTaxDeductible']}`).value = paramsFin.afTaxDeductible ? 'SÌ' : 'NO';

    addFinRow('holdcoCapital2', 'Capitale Iniziale Holding (€)');
    sheetFin.getCell(`B${rowMapFin['holdcoCapital2']}`).value = paramsFin.holdcoCapital !== undefined ? paramsFin.holdcoCapital : 10000;
    sheetFin.getCell(`B${rowMapFin['holdcoCapital2']}`).numFmt = numberFormatEuro;

    let exitLabel = 'Uscita a Fine Anno 20';
    if (paramsFin.exitOption === '5') exitLabel = 'Uscita a Fine Anno 5 (RTB)';
    else if (paramsFin.exitOption === 'custom_multiple') exitLabel = 'Multiplo EBITDA';
    else if (paramsFin.exitOption === 'custom_ev') exitLabel = 'Enterprise Value Fissa';
    else if (paramsFin.exitOption === 'custom_mwp') exitLabel = 'Valore per MWp';
    addFinRow('exitOption', 'Opzione di Uscita (Exit Strategy)');
    sheetFin.getCell(`B${rowMapFin['exitOption']}`).value = exitLabel;

    addFinRow('exitMultiple', 'Multiplo EBITDA di Uscita (x)');
    sheetFin.getCell(`B${rowMapFin['exitMultiple']}`).value = paramsFin.exitMultiple;

    addFinRow('exitValuePerMwp', 'Valutazione di Uscita per MWp (€)');
    sheetFin.getCell(`B${rowMapFin['exitValuePerMwp']}`).value = paramsFin.exitValuePerMwp;
    sheetFin.getCell(`B${rowMapFin['exitValuePerMwp']}`).numFmt = numberFormatEuro;

    addFinRow('exitEnterpriseValue', 'Valutazione Enterprise Value Fissa (€)');
    sheetFin.getCell(`B${rowMapFin['exitEnterpriseValue']}`).value = paramsFin.exitEnterpriseValue;
    sheetFin.getCell(`B${rowMapFin['exitEnterpriseValue']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;

    // --- SCENARI PREZZI E VINCOLI ---
    addFinRow('hdrScenari', 'SCENARI PREZZI E VINCOLI', true, true);

    addFinRow('priceScenarioType', 'Scenario Curve di Prezzo');
    sheetFin.getCell(`B${rowMapFin['priceScenarioType']}`).value = paramsFin.priceScenarioType === 'bull' ? 'Rialzista (+20%)' : (paramsFin.priceScenarioType === 'bear' ? 'Ribassista (Decadimento)' : 'Caso Base (PUN GME)');

    addFinRow('punZonalFloor', 'Prezzo Floor Minimo ZONALE (€/MWh)');
    sheetFin.getCell(`B${rowMapFin['punZonalFloor']}`).value = paramsFin.punZonalFloor;
    sheetFin.getCell(`B${rowMapFin['punZonalFloor']}`).numFmt = numberFormatEuro;

    addFinRow('punBearishDecayRate', 'Tasso Decadimento Bearish Annuo (%)');
    sheetFin.getCell(`B${rowMapFin['punBearishDecayRate']}`).value = paramsFin.punBearishDecayRate;
    sheetFin.getCell(`B${rowMapFin['punBearishDecayRate']}`).numFmt = numberFormatPct;

    addFinRow('dividendLock', 'Blocco Dividendi Fino Estinzione Debito');
    sheetFin.getCell(`B${rowMapFin['dividendLock']}`).value = paramsFin.dividendLock ? 'SÌ' : 'NO';

    sheetFin.addRow([]); currentRowFin++;

    addFinRow('usi', 'TOTALE USI E BASE FINANZIABILE', true, true);
    addFinRow('capexUsi', 'Costo Totale Progetto (CAPEX)', true);
    const capexTotColLetter = getColLetter(m.capexBreakdown ? m.capexBreakdown.length + 2 : 2);
    sheetFin.getCell(`B${rowMapFin['capexUsi']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['totalCapex']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['capexUsi']}`).numFmt = numberFormatEuro;

    addFinRow('spvCost', 'Costo Acquisizione SPV (Da escludere se base ev_ex_spv)');
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['spv']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).numFmt = numberFormatEuro;

    addFinRow('holdcoUsi', 'Capitale Sociale HoldCo (Da versare)');
    sheetFin.getCell(`B${rowMapFin['holdcoUsi']}`).value = paramsFin.holdcoCapital !== undefined ? paramsFin.holdcoCapital : 10000;
    sheetFin.getCell(`B${rowMapFin['holdcoUsi']}`).numFmt = numberFormatEuro;

    addFinRow('totUsi', 'TOTALE FABBISOGNO (Usi)', true);
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).value = { formula: `B${rowMapFin['capexUsi']} + B${rowMapFin['holdcoUsi']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).value = 1;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).numFmt = numberFormatPct;

    addFinRow('bankableBase', 'Base Finanziabile Effettiva');
    if (paramsFin.debtBasis === 'hard_costs') {
        // Only EPC + BESS + Connection
        sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['solar']} + CAPEX!${capexTotColLetter}${rowMapCapex['bess']} + CAPEX!${capexTotColLetter}${rowMapCapex['connection']}`, result: undefined };
    } else if (paramsFin.debtBasis === 'ev_ex_spv') {
        // Total Project Cost excluding SPV
        sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = { formula: `B${rowMapFin['capexUsi']} - B${rowMapFin['spvCost']}`, result: undefined };
    } else {
        // Total Project Cost
        sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = { formula: `B${rowMapFin['capexUsi']}`, result: undefined };
    }
    sheetFin.getCell(`B${rowMapFin['bankableBase']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;

    addFinRow('fonti', 'TOTALE FONTI (Coperture)', true, true);
    
    // DEBT
    addFinRow('debt', 'Debito Bancario (Senior Loan)');
    sheetFin.getCell(`B${rowMapFin['debt']}`).value = { formula: `IF(B${rowMapFin['loanTerm']} > 0, B${rowMapFin['bankableBase']} * B${rowMapFin['leverage']}, 0)`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['debt']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['debt']}`).value = { formula: `IFERROR(B${rowMapFin['debt']} / B${rowMapFin['totUsi']}, 0)`, result: undefined };
    sheetFin.getCell(`C${rowMapFin['debt']}`).numFmt = numberFormatPct;

    // Private Debt / Private Equity fonti (definiti PRIMA di equity/subDebt che li referenziano)
    addFinRow('pdFonti', '  - Private Debt (Holding Level)');
    const pdFixed = (paramsFin.pdEnabled === false) ? 0 : (paramsFin.pdAmountType === 'fixed_eur' ? (paramsFin.pdAmountValue || 0) : null);
    if (pdFixed !== null) {
        sheetFin.getCell(`B${rowMapFin['pdFonti']}`).value = pdFixed;
    } else if (paramsFin.pdAmountType === 'pct_bankable') {
        sheetFin.getCell(`B${rowMapFin['pdFonti']}`).value = { formula: `B${rowMapFin['bankableBase']} * B${rowMapFin['pdAmountValue']}`, result: undefined };
    } else { // pct_totusi
        sheetFin.getCell(`B${rowMapFin['pdFonti']}`).value = { formula: `B${rowMapFin['totUsi']} * B${rowMapFin['pdAmountValue']}`, result: undefined };
    }
    sheetFin.getCell(`B${rowMapFin['pdFonti']}`).numFmt = numberFormatEuro;
    if (paramsFin.pdEnabled === false) sheetFin.getCell(`B${rowMapFin['pdFonti']}`).value = 0;

    addFinRow('peFonti', '  - Private Equity (Co-Investitore SPV)');
    sheetFin.getCell(`B${rowMapFin['peFonti']}`).value = (paramsFin.peEnabled === false) ? 0 : (paramsFin.peAmountValue || 0);
    sheetFin.getCell(`B${rowMapFin['peFonti']}`).numFmt = (paramsFin.peAmountType === 'fixed_eur') ? numberFormatEuro : numberFormatPct;

    // EQUITY SPV (Totale equity immesso nella SPV; il PD è a Holding level e NON riduce l'equity SPV)
    addFinRow('equity', 'Totale Equity SPV (Mezzi Propri)', true);
    sheetFin.getCell(`B${rowMapFin['equity']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['debt']} - B${rowMapFin['peFonti']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['equity']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['equity']}`).value = { formula: `IFERROR(B${rowMapFin['equity']} / B${rowMapFin['totUsi']}, 0)`, result: undefined };
    sheetFin.getCell(`C${rowMapFin['equity']}`).numFmt = numberFormatPct;

    // Equity Stratification
    addFinRow('holdcoEq', '  - Capitale Sociale HoldCo (Versato)');
    sheetFin.getCell(`B${rowMapFin['holdcoEq']}`).value = { formula: `B${rowMapFin['holdcoUsi']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['holdcoEq']}`).numFmt = numberFormatEuro;
    
    addFinRow('subDebt', '  - Finanziamento Soci (Subordinated Debt)');
    // PD è a livello Holding: NON riduce l'equity di costruzione SPV. Il soci loan è sized
    // su constructionEquity SPV = (CAPEX - spvCost - senior - PE), senza PD.
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).value = { formula: `MAX(0, B${rowMapFin['capexUsi']} - B${rowMapFin['spvCost']} - B${rowMapFin['debt']} - B${rowMapFin['peFonti']}) * B${rowMapFin['sociEquityPct']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).numFmt = numberFormatEuro;

    // Sponsor Pure Equity = equity SPV - holdcoEq - subDebt - PD (il PD è debt Holding, riduce l'esposizione Sponsor)
    addFinRow('otherEq', '  - Sponsor Pure Equity (al netto PD Holding)');
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).value = { formula: `MAX(0, B${rowMapFin['equity']} - B${rowMapFin['holdcoEq']} - B${rowMapFin['subDebt']} - B${rowMapFin['pdFonti']})`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('totFonti', 'TOTALE FONTI', true);
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).value = { formula: `B${rowMapFin['debt']} + B${rowMapFin['pdFonti']} + B${rowMapFin['peFonti']} + B${rowMapFin['holdcoEq']} + B${rowMapFin['subDebt']} + B${rowMapFin['otherEq']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).numFmt = numberFormatEuro;
    
    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('check', 'Controllo Squadratura (Usi - Fonti)', true);
    sheetFin.getCell(`B${rowMapFin['check']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['totFonti']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['check']}`).numFmt = numberFormatEuro;
    
    // FOGLIO SUCCESSIVO: AMMORTAMENTO (Piano Ammortamento Debito & Soci)
    // ---------------------------------------------------------
    const sheetDebt = workbook.addWorksheet('AMMORTAMENTO', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetDebt.columns = columns;

    sheetDebt.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumDebt = 2;
    const rowMapDebt = {};
    const pendingFormulasDebt = [];

    function addRowDebt(key, label, type, dataArray, format, formulaFn = null) {
        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val);
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetDebt.addRow(rowValues);
        rowMapDebt[key] = currentRowNumDebt;

        let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false };
        let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        let indent = 0;

        if (type === 'title-purple' || type === 'title-teal-debt') {
            rowFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
            rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: type === 'title-purple' ? 'FF4A235A' : 'FF0E6251' } };
        } else if (type === 'bold') {
            rowFont.bold = true; rowFont.color = { argb: 'FF000000' };
            rowFill.fgColor = { argb: 'FFF2F2F2' };
        } else if (type === 'total-purple') {
            rowFont.bold = true; rowFont.color = { argb: 'FF000000' };
            rowFill.fgColor = { argb: 'FFF4ECF7' };
        } else if (type === 'plus-debt') {
            rowFont.color = { argb: 'FF006100' };
        } else if (type === 'minus') {
            rowFont.color = { argb: 'FFC00000' };
        }

        row.getCell(1).font = rowFont;
        row.getCell(1).fill = rowFill;
        if (indent > 0) row.getCell(1).alignment = { indent: indent, vertical: 'middle' };

        for (let i = 0; i < numYears; i++) {
            const cell = row.getCell(i + 2);
            cell.font = rowFont;
            cell.fill = rowFill;
            if (format) cell.numFmt = format;
            
            if (formulaFn) {
                pendingFormulasDebt.push({ cell: cell, formulaFn: formulaFn, colLetter: getColLetter(i + 2), yearIndex: i });
            }
        }
        currentRowNumDebt++;
        return row;
    }

    const d = window.State.results.debtSchedule;
    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('sec_debt_1', '1. DEBITO BANCARIO SPV – Project Finance (Senior Debt)', 'title-purple');
    addRowDebt('beginningBalance', 'Debito Residuo Inizio Anno (€)', 'normal', d.beginningBalance, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return null; // Anno 1 è hardcoded / preso da array
        const prevCol = getColLetter(yearIdx + 1);
        return `${prevCol}${rowMapDebt.endingBalance}`;
    });
    addRowDebt('interestAccrued', '(-) Quota Interessi Mutuo Maturati (€)', 'minus', d.interestAccrued, numberFormatEuro, (col, yearIdx) => {
        return `-IF(${yearIdx + 1} <= FINANZA!$B$${rowMapFin['loanTerm']}, MAX(0, ${col}${rowMapDebt['beginningBalance']}) * FINANZA!$B$${rowMapFin['interestRate']}, 0)`;
    });
    addRowDebt('principalScheduled', '(-) Quota Capitale Programmata (€)', 'minus', d.principalScheduled, numberFormatEuro, (col, yearIdx) => {
        const yearNum = yearIdx + 1;
        return `-IF(${yearNum} <= FINANZA!$B$${rowMapFin['loanTerm']}, MAX(0, MIN(${col}${rowMapDebt['beginningBalance']}, PMT(FINANZA!$B$${rowMapFin['interestRate']}, FINANZA!$B$${rowMapFin['loanTerm']}, -FINANZA!$B$${rowMapFin['debt']}) + ${col}${rowMapDebt['interestAccrued']})), 0)`;
    });
    addRowDebt('principalVoluntary', '(-) Quota Capitale Prepagata - Cash Sweep (€)', 'minus', d.principalVoluntary, numberFormatEuro, (col, yearIdx) => {
        const yearNum = yearIdx + 1;
        return `-IF(OR(FINANZA!$B$${rowMapFin['sweepYears']}=0, ${yearNum} <= FINANZA!$B$${rowMapFin['sweepYears']}), MAX(0, MIN(${col}${rowMapDebt['beginningBalance']} + ${col}${rowMapDebt['principalScheduled']}, ` +
               `IF(FINANZA!$B$${rowMapFin['sweepType']}="% del CFADS", ('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf['cfads']} + ${col}${rowMapDebt['interestAccrued']} + ${col}${rowMapDebt['principalScheduled']}) * FINANZA!$B$${rowMapFin['sweepValue']}, ` +
               `IF(FINANZA!$B$${rowMapFin['sweepType']}="€ Fisso/Anno", FINANZA!$B$${rowMapFin['sweepValue']}, 0)))), 0)`;
    });
    addRowDebt('endingBalance', 'Debito Residuo Fine Anno (€)', 'bold', d.endingBalance, numberFormatEuro, (col) => {
        return `MAX(0, ${col}${rowMapDebt['beginningBalance']} + ${col}${rowMapDebt['principalScheduled']} + ${col}${rowMapDebt['principalVoluntary']})`;
    });
    if ((window.State.inputs.dsraMonths || 0) > 0) {
        addRowDebt('dsraBalance', 'Saldo DSRA - Riserva Servizio Debito (€)', 'normal', d.dsraBalance, numberFormatEuro);
    }
    
    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('totalDebtService', 'SERVIZIO DEL DEBITO EFFETTIVO (€)', 'total-purple', d.totalDebtService.map(v => -Math.abs(v)), numberFormatEuro, (col) => {
        return `${col}${rowMapDebt.interestAccrued}+${col}${rowMapDebt.principalScheduled}+${col}${rowMapDebt.principalVoluntary}`;
    });
    addRowDebt('dscr', 'DSCR (Debt Service Coverage Ratio)', 'bold', d.dscr, '0.00"x"', (col) => {
        return `IFERROR('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.cfads}/-(${col}${rowMapDebt.interestAccrued}+${col}${rowMapDebt.principalScheduled}), 0)`;
    });

    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('sec_debt_2', `2. FINANZIAMENTO SOCI – Subordinated Shareholder Loan (${p.sociEquityPct}% Equity)`, 'title-teal-debt');
    addRowDebt('beginningBalanceSoci', 'Finanziamento Soci Inizio Anno (€)', 'normal', d.beginningBalanceSoci, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return null;
        const prevCol = getColLetter(yearIdx + 1);
        return `${prevCol}${rowMapDebt.endingBalanceSoci}`;
    });
    addRowDebt('interestAccruedSoci', `(-) Interessi Maturati (${p.sociInterestRate > 0 ? p.sociInterestRate.toFixed(2) + '% p.a.' : 'Nessuno'}${p.sociInterestGrace > 0 ? `, grazia anni 1-${p.sociInterestGrace}` : ', nessuna grazia'}) (€)`, 'minus', d.interestAccruedSoci, numberFormatEuro);
    addRowDebt('interestPaidSoci', '(+) Interessi Pagati Effettivamente (€)', 'plus-debt', d.interestPaidSoci, numberFormatEuro);
    addRowDebt('principalPaidSoci', `(-) Rimborso Quota Capitale (${p.sociPrincipalGrace > 0 ? 'grazia anni 1-' + p.sociPrincipalGrace : 'nessuna grazia'}) (€)`, 'minus', d.principalPaidSoci, numberFormatEuro);
    addRowDebt('endingBalanceSoci', 'Finanziamento Soci Fine Anno (€)', 'bold', d.endingBalanceSoci, numberFormatEuro, (col) => {
        return `${col}${rowMapDebt.beginningBalanceSoci}-${col}${rowMapDebt.interestAccruedSoci}-${col}${rowMapDebt.interestPaidSoci}+${col}${rowMapDebt.principalPaidSoci}`;
    });

    // ── Sezione 3: Private Debt (se abilitato) ──
    if (window.State.inputs.pdEnabled) {
        const pdModeTxt = window.State.inputs.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (window.State.inputs.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
        sheetDebt.addRow([]); currentRowNumDebt++;
        addRowDebt('sec_debt_3', `3. PRIVATE DEBT — Mezzanine Esterna SPV (${(window.State.inputs.pdInterestRate||0).toFixed(2)}% — ${pdModeTxt})`, 'title-teal-debt');
        addRowDebt('beginningBalancePd', 'Private Debt Inizio Anno (€)', 'normal', d.beginningBalancePd, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return null;
            const prevCol = getColLetter(yearIdx + 1);
            return `${prevCol}${rowMapDebt.endingBalancePd}`;
        });
        addRowDebt('interestAccruedPd', `(-) Interessi Maturati (${(window.State.inputs.pdInterestRate||0).toFixed(2)}% p.a.) (€)`, 'minus', d.interestAccruedPd, numberFormatEuro);
        addRowDebt('interestPaidPd', '(+) Interessi Pagati Effettivamente (€)', 'plus-debt', d.interestPaidPd, numberFormatEuro);
        addRowDebt('principalPaidPd', '(-) Rimborso Quota Capitale Ammortamento (€)', 'minus', d.principalPaidPd, numberFormatEuro);
        addRowDebt('bulletPayoffPd', '(-) Payoff Bullet / Residuo a Exit (€)', 'minus', d.bulletPayoffPd, numberFormatEuro);
        addRowDebt('endingBalancePd', 'Private Debt Fine Anno (€)', 'bold', d.endingBalancePd, numberFormatEuro, (col) => {
            // Righe 'minus' sono memorizzate negative, 'plus' positive:
            // ending = beginning + accrued - paid - principal - payoff
            return `${col}${rowMapDebt.beginningBalancePd}-${col}${rowMapDebt.interestAccruedPd}-${col}${rowMapDebt.interestPaidPd}+${col}${rowMapDebt.principalPaidPd}+${col}${rowMapDebt.bulletPayoffPd}`;
        });
    }

    // Applicazione Formule Debt a posteriori
    pendingFormulasDebt.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex);
        if (f) {
            pf.cell.value = { formula: f, result: undefined };
        }
    });

    // Applicazione Formule RF a posteriori (dopo che rowMapDebt è completa)
    pendingFormulasRf.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex);
        if (f) {
            pf.cell.value = { formula: f, result: undefined };
        }
    });

    // Applicazione Formule HC a posteriori (dopo che tutte le rowMap sono complete)
    pendingFormulasHc.forEach(pf => {
        pf.cell.value = { formula: pf.formulaFn(pf.colLetter, pf.yearIndex), result: undefined };
    });

    // Download del file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    
    // Metodo nativo HTML5 per il download (più affidabile per i nomi dei file)
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "PL_Driver_Operativi.xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);

    } catch(err) {
        alert("Si è verificato un errore durante l'esportazione in Excel:\n\n" + err.message);
        console.error("Excel export error:", err);
    }
}
