async function exportPnlToExcel() {
    console.log("ESPORTAZIONE AVVIATA CON VERSIONE AGGIORNATA (includeEmpty: true)");
    try {
    if (!window.State || !window.State.results) {
        showToast("Nessun dato da esportare. Esegui prima la simulazione.", 'warning');
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const brand = (window.State && window.State.branding) || {};
    workbook.creator = brand.company || 'Solar & BESS M&A Deal Simulator';
    workbook.company = brand.company || '';
    workbook.lastModifiedBy = 'Enterprise Edition';
    workbook.created = new Date();
    workbook.modified = new Date();

    // C4: foglio COPERTINA brandizzato (primo foglio della cartella)
    const cover = workbook.addWorksheet('COPERTINA', { views: [{ showGridLines: false }] });
    cover.columns = [{ width: 4 }, { width: 35 }, { width: 75 }];
    let coverRow = 3;
    if (brand.logoDataUrl) {
        try {
            const imgId = workbook.addImage({ base64: brand.logoDataUrl.split(',')[1], extension: 'png' });
            cover.addImage(imgId, { tl: { col: 1.05, row: coverRow - 1 }, ext: { width: 160, height: Math.max(30, Math.min(80, 160 * (brand.logoRatio || 0.4))) } });
            coverRow += 6;
        } catch (e) { /* immagine non incorporabile */ }
    }
    const cTitle = cover.getCell(`B${coverRow}`);
    cTitle.value = brand.company || 'Solar & BESS M&A Deal Simulator';
    cTitle.font = { bold: true, size: 18, color: { argb: 'FF0B0F19' } };
    if (brand.tagline) {
        coverRow++;
        const cTag = cover.getCell(`B${coverRow}`);
        cTag.value = brand.tagline;
        cTag.font = { size: 11, color: { argb: 'FF64748B' } };
    }
    coverRow += 2;
    const cProj = cover.getCell(`B${coverRow}`);
    cProj.value = 'Progetto: ' + (window._currentProjectName || 'Progetto New Green Deal');
    cProj.font = { bold: true, size: 13, color: { argb: 'FF10B981' } };
    coverRow++;
    const cDate = cover.getCell(`B${coverRow}`);
    cDate.value = 'Data report: ' + new Date().toLocaleString('it-IT');
    cDate.font = { size: 10, color: { argb: 'FF64748B' } };
    coverRow++;
    const cNote = cover.getCell(`B${coverRow}`);
    cNote.value = 'Documento strettamente confidenziale — Generato dal Financial & Engineering Simulator Enterprise';
    cNote.font = { italic: true, size: 9.5, color: { argb: 'FF94A3B8' } };

    // Sezione Guida alla lettura e Convenzione Celle (Financial Modeling FAST Standard)
    coverRow += 3;
    const cGuideHdr = cover.getCell(`B${coverRow}`);
    cGuideHdr.value = 'GUIDA ALLA MODELLAZIONE E CONVENZIONE CELLE';
    cGuideHdr.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cGuideHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    cover.getCell(`C${coverRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    coverRow++;

    // 1. Cella Parametro Modificabile (Input)
    const cLeg1Key = cover.getCell(`B${coverRow}`);
    cLeg1Key.value = 'PARAMETRO MODIFICABILE';
    cLeg1Key.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }; // Soft yellow
    cLeg1Key.font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } }; // Deep navy blue
    cLeg1Key.alignment = { horizontal: 'center', vertical: 'middle' };
    cLeg1Key.border = { top: { style: 'thin', color: { argb: 'FFFDE68A' } }, bottom: { style: 'thin', color: { argb: 'FFFDE68A' } }, left: { style: 'thin', color: { argb: 'FFFDE68A' } }, right: { style: 'thin', color: { argb: 'FFFDE68A' } } };
    const cLeg1Desc = cover.getCell(`C${coverRow}`);
    cLeg1Desc.value = 'Cella valore di assunzione (presente in FINANZA, DRIVER, CAPEX, OPEX). Modificandola, tutto il file si ricalcola in automatico.';
    cLeg1Desc.font = { size: 9.5, color: { argb: 'FF334155' } };
    cLeg1Desc.alignment = { vertical: 'middle' };
    coverRow++;

    // 2. Cella Calcolata (Formula)
    const cLeg2Key = cover.getCell(`B${coverRow}`);
    cLeg2Key.value = 'FORMULA DINAMICA EXCEL';
    cLeg2Key.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    cLeg2Key.font = { size: 10, color: { argb: 'FF0F172A' } };
    cLeg2Key.alignment = { horizontal: 'center', vertical: 'middle' };
    cLeg2Key.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    const cLeg2Desc = cover.getCell(`C${coverRow}`);
    cLeg2Desc.value = 'Formule native Excel (SUM, IF, MIN, MAX, ROUND, PMT). Governano bilanci, cascata waterfall e debito. Da non sovrascrivere.';
    cLeg2Desc.font = { size: 9.5, color: { argb: 'FF334155' } };
    cLeg2Desc.alignment = { vertical: 'middle' };
    coverRow++;

    // 3. Totale / KPI
    const cLeg3Key = cover.getCell(`B${coverRow}`);
    cLeg3Key.value = 'INDICATORE KPI / TOTALE';
    cLeg3Key.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cLeg3Key.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    cLeg3Key.alignment = { horizontal: 'center', vertical: 'middle' };
    cLeg3Key.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    const cLeg3Desc = cover.getCell(`C${coverRow}`);
    cLeg3Desc.value = 'Aggregazioni chiave di Due Diligence (EBITDA, EBIT, CFADS, FCFE, DSCR, Usi/Fonti).';
    cLeg3Desc.font = { size: 9.5, color: { argb: 'FF334155' } };
    cLeg3Desc.alignment = { vertical: 'middle' };
    coverRow++;

    // 4. Cella con Convalida Dati (Menù a Tendina)
    const cLeg4Key = cover.getCell(`B${coverRow}`);
    cLeg4Key.value = 'MENÙ A TENDINA (ELENCO)';
    cLeg4Key.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
    cLeg4Key.font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } };
    cLeg4Key.alignment = { horizontal: 'center', vertical: 'middle' };
    cLeg4Key.border = { top: { style: 'thin', color: { argb: 'FFFDE68A' } }, bottom: { style: 'thin', color: { argb: 'FFFDE68A' } }, left: { style: 'thin', color: { argb: 'FFFDE68A' } }, right: { style: 'thin', color: { argb: 'FFFDE68A' } } };
    const cLeg4Desc = cover.getCell(`C${coverRow}`);
    cLeg4Desc.value = 'Cella con convalida dati da elenco. Cliccando sulla freccia appare il menù a tendina con le opzioni previste dalla Web App.';
    cLeg4Desc.font = { size: 9.5, color: { argb: 'FF334155' } };
    cLeg4Desc.alignment = { vertical: 'middle' };
    coverRow += 2;

    // Indice Schede della Cartella
    const cIdxHdr = cover.getCell(`B${coverRow}`);
    cIdxHdr.value = 'INDICE DEI FOGLI DI LAVORO';
    cIdxHdr.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cIdxHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    cover.getCell(`C${coverRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    coverRow++;

    const sheetIndexList = [
        { name: '1. DRIVER OPERATIVI', desc: 'Quantitativi fisici di energia (MWh), sottomonopoli CER/PPA/RID e valori unitari (€/MWh)' },
        { name: '2. CAPEX', desc: 'Breakdown investimenti per impianto, totale portafoglio e quote di ammortamento civilistico' },
        { name: '3. OPEX', desc: 'Breakdown costi operativi anno 1 per impianto, totale di portafoglio e indicizzazione inflattiva' },
        { name: '4. CONTO ECONOMICO', desc: 'Sezione A: P&L SPV con ricavi, costi, ammortamenti, oneri finanziari, imposte e utile netto' },
        { name: '5. RENDICONTO FINANZIARIO SPV', desc: 'Sezione B: CFADS SPV, servizio debito senior e cascata di distribuzione (Art. 2430/2433/2482 c.c.)' },
        { name: '6. CONTO ECONOMICO HOLDING', desc: 'Sezione C: P&L HoldCo con ricavi asset management, proventi partecipazioni da SPV e imposte' },
        { name: '7. RENDICONTO FINANZIARIO HOLDING', desc: 'Sezione D: FCFE Investitore, cassa ordinaria, dismissione exit SPV e payoff private debt' },
        { name: '8. FINANZA', desc: 'Assunzioni macroeconomiche, tassi, parametri di debito, equity, exit e quadratura Usi & Fonti' },
        { name: '9. AMMORTAMENTO', desc: 'Piani di ammortamento completi di Senior Debt, Finanziamento Soci e Private Debt' },
        { name: '10. CASH FLOW MENSILE', desc: 'Analisi mensile a 72 mesi (Anno 0 + Anni 1-5), liquidazione IVA periodica TR e cassa progressiva' }
    ];
    sheetIndexList.forEach(item => {
        const cN = cover.getCell(`B${coverRow}`);
        cN.value = item.name;
        cN.font = { bold: true, size: 9.5, color: { argb: 'FF1E293B' } };
        cN.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        const cD = cover.getCell(`C${coverRow}`);
        cD.value = item.desc;
        cD.font = { size: 9, color: { argb: 'FF64748B' } };
        cD.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        coverRow++;
    });

    const m = window.State.results.matrix;
    const p = window.State.inputs;
    let years = m && m.years ? m.years : Array.from({length: 21}, (_, i) => i);
    // exitOption '0' = Nessun Exit -> esporta comunque tutti i 20 anni
    const exitOptInt = p && p.exitOption !== undefined ? parseInt(p.exitOption) : NaN;
    if (p && p.exitOption && p.exitOption !== 'none' && !isNaN(exitOptInt) && exitOptInt > 0) {
        if (years[0] === 0) {
            years = years.slice(0, exitOptInt + 1);
        } else {
            years = years.slice(0, exitOptInt);
        }
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

    // Stile celle di input/parametro modificabili (FAST / Financial Modeling Standard)
    const inputCellStyle = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }, // soft cream/yellow (#FFFBEB)
        font: { color: { argb: 'FF1E3A8A' }, bold: true }, // deep navy blue (#1E3A8A)
        border: {
            top: { style: 'thin', color: { argb: 'FFFDE68A' } },
            bottom: { style: 'thin', color: { argb: 'FFFDE68A' } },
            left: { style: 'thin', color: { argb: 'FFFDE68A' } },
            right: { style: 'thin', color: { argb: 'FFFDE68A' } }
        }
    };

    function applyInputStyle(cell, numFmt = null) {
        cell.fill = inputCellStyle.fill;
        cell.font = inputCellStyle.font;
        cell.border = inputCellStyle.border;
        if (numFmt) cell.numFmt = numFmt;
    }

    function applyListValidation(cell, optionsList, defaultValue = null) {
        if (defaultValue !== null && defaultValue !== undefined) {
            cell.value = defaultValue;
        }
        applyInputStyle(cell);
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.dataValidation = {
            type: 'list',
            allowBlank: false,
            formulae: ['"' + optionsList.join(',') + '"'],
            showErrorMessage: true,
            errorTitle: 'Valore non consentito',
            error: 'Selezionare un valore valido dall\'elenco a tendina.'
        };
    }

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
    const pendingFormulasCrossOp = [];

    function addRow(key, label, type, dataArray, format, formulaFn = null, isInput = false) {
        const rowValues = { label };
        
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val); // Assicura che sia negativo se l'array aveva già numeri negativi per errore, ma se l'array aveva un positivo lo fa negativo.
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetOp.addRow(rowValues);
        rowMap[key] = currentRowNum;

        // Formattazione
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
            rowFont = { color: { argb: 'FFC00000' } }; // red-400
        }

        row.eachCell((cell, colNumber) => {
            if (colNumber === 1) {
                cell.font = rowFont;
                cell.fill = rowFill;
                cell.alignment = { horizontal: 'left', indent: indent, vertical: 'middle' };
                cell.border = { right: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
            } else {
                if (isInput && !formulaFn) {
                    applyInputStyle(cell, format);
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                } else {
                    cell.font = rowFont;
                    cell.fill = rowFill;
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = format;
                    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
                }

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
    
    addRow('qtySolarPpa', isCER ? 'di cui: Energia FV Condivisa CER (MWh)' : 'di cui: Energia FV in Autoconsumo / PPA (MWh)', 'detail', m.qtySolarPpa, numberFormatMwh, null, true);
    addRow('qtySolarRid', 'di cui: Energia FV immessa in Rete / RID (MWh)', 'detail', m.qtySolarRid, numberFormatMwh, null, true);
    addRow('qtySolarToBess', 'di cui: Energia FV per Carica BESS (MWh)', 'detail', m.qtySolarToBess, numberFormatMwh, null, true);
    
    addRow('qtyBessDischarge', 'Scarica BESS Totale (MWh)', 'bold', m.qtyBessDischarge, numberFormatMwh, (col) => {
        // qtyBessDischarge = qtyBessSelfCons + qtyBessGridFeed
        return `${col}${rowMap.qtyBessSelfCons}+${col}${rowMap.qtyBessGridFeed}`;
    });
    
    addRow('qtyBessSelfCons', isCER ? 'di cui: Scarica BESS Condivisa CER (MWh)' : 'di cui: Scarica BESS per Autoconsumo / PPA (MWh)', 'detail', m.qtyBessSelfCons, numberFormatMwh, isCER ? (col) => {
        // qtyBessSelfCons = qtyBessSelfConsArb + qtyBessSelfConsTs
        return `${col}${rowMap.qtyBessSelfConsArb}+${col}${rowMap.qtyBessSelfConsTs}`;
    } : null, !isCER);

    if (isCER) {
        addRow('qtyBessSelfConsArb', '  - di cui: CER BESS da Arbitraggio (MWh)', 'detail-sub', m.qtyBessSelfConsArb, numberFormatMwh, null, true);
        addRow('qtyBessSelfConsTs', '  - di cui: CER BESS da Timeshifting (MWh)', 'detail-sub', m.qtyBessSelfConsTs, numberFormatMwh, null, true);
    }

    addRow('qtyBessGridFeed', 'di cui: Scarica BESS immessa in Rete / RID (MWh)', 'detail', m.qtyBessGridFeed, numberFormatMwh, (col) => {
        // qtyBessGridFeed = qtyBessGridFeedArb + qtyBessGridFeedTs
        return `${col}${rowMap.qtyBessGridFeedArb}+${col}${rowMap.qtyBessGridFeedTs}`;
    });
    
    addRow('qtyBessGridFeedArb', '  - di cui: Scarica Rete da Arbitraggio (MWh)', 'detail-sub', m.qtyBessGridFeedArb, numberFormatMwh, null, true);
    addRow('qtyBessGridFeedTs', '  - di cui: Scarica Rete da Timeshifting (MWh)', 'detail-sub', m.qtyBessGridFeedTs, numberFormatMwh, null, true);
    
    addRow('qtyBessChargeGrid', 'Carica BESS da Rete (MWh)', 'detail', m.qtyBessChargeGrid, numberFormatMwh, null, true); // I valori sono registrati positivi nel worker
    addRow('qtyBessLosses', 'Perdite di Efficienza BESS (RTE) (MWh)', 'minus', m.qtyBessLosses, numberFormatMwh, (col) => {
        return `IF(${col}${rowMap.qtySolarToBess}+${col}${rowMap.qtyBessChargeGrid}>0, ${col}${rowMap.qtyBessDischarge}-${col}${rowMap.qtySolarToBess}-${col}${rowMap.qtyBessChargeGrid}, 0)`;
    });
    
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
    addRow('ppaPremium', 'Premio Commerciale PPA (%)', 'bold', Array(numYears).fill(ppaServicePct), numberFormatPct, null, true);

    const totalKwp = window.State.plants.reduce((sum, p) => p.enabled !== false ? sum + (parseFloat(p.capacity) || 0) : sum, 0);
    addRow('totKwp', 'Potenza Totale Impianti (kWp)', 'bold', Array(numYears).fill(totalKwp), '#,##0');

    // ── Parametri fiscali (driver formule CE) ──
    const _res = window.State.results;
    const _idcAmount = (p.loanTerm > 0 && (_res.debtAmount || 0) > 0)
        ? _res.debtAmount * (p.interestRate || 0) * (((p.constructionMonths !== undefined ? p.constructionMonths : 6) / 12)) * (((p.idcDrawdownFactor !== undefined ? p.idcDrawdownFactor : 50)) / 100)
        : 0;
    const _fiscalBase = (_res.totalEpcCapex || 0) + (_res.bessCAPEX || 0) + (_res.totalConnectionCapex || 0)
        + (_res.totalLandDdsAttualizzatoCapex || 0) + (_res.totalDevelopmentCapex || 0) + _idcAmount + (_res.totalCustomCapex || 0);
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

    // Queue cross-sheet formulas in pendingFormulasCrossOp (da risolvere dopo che FINANZA e CAPEX sono stati popolati)
    for (let i = 0; i < numYears; i++) {
        const colLetter = getColLetter(i + 2);
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.inflation}`),
            formulaFn: () => `FINANZA!$B$${rowMapFin['inflation']}`,
            result: p.inflation
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.fiscalDeprRateConst}`),
            formulaFn: () => `FINANZA!$B$${rowMapFin['fiscalDeprRate']}`,
            result: p.fiscalDeprRate || 0.09
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.iresRateConst}`),
            formulaFn: () => `FINANZA!$B$${rowMapFin['iresRate']}`,
            result: p.iresRate !== undefined ? p.iresRate : 0.24
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.irapRateConst}`),
            formulaFn: () => `FINANZA!$B$${rowMapFin['irapRate']}`,
            result: p.irapRate !== undefined ? p.irapRate : 0.039
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.idcConst}`),
            formulaFn: () => `IF(FINANZA!$B$${rowMapFin['loanTerm']}>0, ROUND(FINANZA!$B$${rowMapFin['debt']} * FINANZA!$B$${rowMapFin['interestRate']} * (FINANZA!$B$${rowMapFin['constructionMonths']}/12) * FINANZA!$B$${rowMapFin['idcDrawdownFactor']}, 0), 0)`,
            result: _idcAmount
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.fiscalBaseConst}`),
            formulaFn: () => {
                const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
                const totColLetter = getColLetter(totColIndex);
                return `CAPEX!$${totColLetter}$${rowMapCapex['totalCapex']} - CAPEX!$${totColLetter}$${rowMapCapex['spv']} - CAPEX!$${totColLetter}$${rowMapCapex['landAcq']} + ${colLetter}${rowMap.idcConst}`;
            },
            result: _fiscalBase
        });
        pendingFormulasCrossOp.push({
            cell: sheetOp.getCell(`${colLetter}${rowMap.bessAugConst}`),
            formulaFn: () => {
                const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
                const totColLetter = getColLetter(totColIndex);
                return `ROUND(CAPEX!$${totColLetter}$${rowMapCapex['bess']} * 0.5, 0)`;
            },
            result: _bessAugCost
        });
    }

    // Riga Vuota
    sheetOp.addRow([]); currentRowNum++;

    // 3. VALORI UNITARI DI RICAVO E COSTO
    addRow('priceEnergyGroup', 'VALORI UNITARI DI RICAVO & COSTO (€/MWh)', 'group-header', null, '');
    
    addRow('priceSolarAvg', 'Valore Unitario Medio Ponderato FV (€/MWh)', 'bold', m.priceSolarAvg, numberFormatEuroMwh, (col) => {
        // Media ponderata: (PrezzoPPA * QtyPPA + PrezzoRID * QtyRID) / QtyGen(PPA+RID) -> Attenzione, QtyToBess non genera ricavi diretti FV
        // Evitiamo div/0 in Excel usando IFERROR
        return `IFERROR((${col}${rowMap.priceSolarPpa}*${col}${rowMap.qtySolarPpa} + ${col}${rowMap.priceSolarRid}*${col}${rowMap.qtySolarRid})/(${_isCerExport ? `${col}${rowMap.qtySolarRid}` : `${col}${rowMap.qtySolarPpa}+${col}${rowMap.qtySolarRid}`}), 0)`;
    });
    
    addRow('priceSolarPpa', isCER ? 'Prezzo Unitario CER FV (€/MWh)' : 'Prezzo Unitario PPA On-Site FV (€/MWh)', 'detail', m.priceSolarPpa, numberFormatEuroMwh, null, true);
    addRow('priceSolarRid', 'Prezzo Unitario RID FV (€/MWh)', 'detail', m.priceSolarRid, numberFormatEuroMwh, null, true);
    
    addRow('priceBessAvg', 'Valore Unitario Medio Ponderato BESS (€/MWh)', 'bold', m.priceBessAvg, numberFormatEuroMwh, (col) => {
        // Media ponderata scarica: (PPA*QtySelfCons + RID*QtyGridFeed) / QtyDischarge
        return `IFERROR((${col}${rowMap.priceBessPpa}*${col}${rowMap.qtyBessSelfCons} + ${col}${rowMap.priceBessRid}*${col}${rowMap.qtyBessGridFeed})/${col}${rowMap.qtyBessDischarge}, 0)`;
    });
    
    addRow('priceBessPpa', isCER ? 'Prezzo Unitario CER BESS (€/MWh)' : 'Prezzo Unitario PPA On-Site BESS (€/MWh)', 'detail', m.priceBessPpa, numberFormatEuroMwh, null, true);
    addRow('priceBessRid', 'Prezzo Unitario RID BESS (Arbitraggio + Time Shifting) (€/MWh)', 'detail', m.priceBessRid, numberFormatEuroMwh, (col) => {
        // Media ponderata tra arbitraggio e timeshifting
        return `IFERROR((${col}${rowMap.priceBessArbitrage}*${col}${rowMap.qtyBessGridFeedArb} + ${col}${rowMap.priceBessTimeshifting}*${col}${rowMap.qtyBessGridFeedTs})/${col}${rowMap.qtyBessGridFeed}, 0)`;
    });
    
    addRow('priceBessArbitrage', '  - di cui: Prezzo di Vendita Arbitraggio (€/MWh)', 'detail-sub', m.priceBessArbitrage, numberFormatEuroMwh, null, true);
    addRow('priceBessTimeshifting', '  - di cui: Prezzo di Vendita Timeshifting (€/MWh)', 'detail-sub', m.priceBessTimeshifting, numberFormatEuroMwh, null, true);
    
    addRow('priceBessChargeGrid', 'Costo Unitario Prelievo da Rete BESS (€/MWh)', 'detail', m.priceBessChargeGrid, numberFormatEuroMwh, null, true);

    // Applicazione Formule a posteriori (dopo che rowMap è completa)
    pendingFormulas.forEach(pf => {
        const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
        pf.cell.value = { formula: pf.formulaFn(pf.colLetter, pf.yearIndex), result: val !== undefined ? val : null };
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
    const pendingFormulasCapex = [];

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
        const firstPlantCol = getColLetter(2);
        const lastPlantCol = getColLetter(totColIndex - 1);
        
        for (let colNum = 1; colNum <= Math.max(totColIndex, pctColIndex); colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum < totColIndex) {
                // Cella parametro impianto editabile (FAST Standard)
                applyInputStyle(cell, numberFormatEuro);
            } else if (colNum === totColIndex) {
                const rowSum = (m.capexBreakdown || []).reduce((acc, cb) => acc + (mapFn ? mapFn(cb) : 0), 0);
                if (totColIndex > 2) {
                    cell.value = { formula: `SUM(${firstPlantCol}${currentRowNumCapex}:${lastPlantCol}${currentRowNumCapex})`, result: rowSum };
                } else {
                    cell.value = rowData[`p0`] || 0;
                }
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            } else if (colNum === pctColIndex && pct !== null) {
                // Formula a posteriori collegata a FINANZA!fiscalDeprRate
                pendingFormulasCapex.push({
                    cell: cell,
                    formulaFn: () => `FINANZA!$B$${rowMapFin['fiscalDeprRate']}`,
                    result: pct
                });
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
    addRowCapex('development', 'Compensazioni (€)', cb => cb.developmentCapex || 0, false, fiscalDeprRate);
    addRowCapex('spv', 'SPV Acquisizione (€)', cb => cb.spvAcquisitionCapex || 0, false, null);
    addRowCapex('landAcq', 'Terreni (Acquisto) (€)', cb => cb.landPurchaseCapex || 0, false, null);
    addRowCapex('landDds', 'Terreni (DDS Attualizzato) (€)', cb => cb.landDdsAttualizzatoCapex || 0, false, fiscalDeprRate);
    addRowCapex('custom', 'Voci Personalizzate / Altro (€)', cb => cb.customCapex || 0, false, fiscalDeprRate);
    
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
                const totVal = colNum <= totColIndex - 1
                    ? (m.capexBreakdown && m.capexBreakdown[colNum - 2] ? m.capexBreakdown[colNum - 2].totalCapex : 0)
                    : (m.capexTotal || (m.capexBreakdown || []).reduce((acc, cb) => acc + (cb.totalCapex || 0), 0));
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['solar']}:${colLetter}${rowMapCapex['custom']})`, result: totVal };
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
        const firstPlantCol = getColLetter(2);
        const lastPlantCol = getColLetter(totColIndex - 1);
        
        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum < totColIndex) {
                const colLetter = getColLetter(colNum);
                const capexRow = rowMapCapex[capexKeyRef];
                const cb = m.capexBreakdown ? m.capexBreakdown[colNum - 2] : null;
                const capexItemVal = cb ? (cb[capexKeyRef] || 0) : 0;
                const deprVal = Math.round(capexItemVal * fiscalDeprRate);
                cell.value = { formula: `ROUND(${colLetter}${capexRow} * ${pctColLetter}${capexRow}, 0)`, result: deprVal };
                cell.numFmt = numberFormatEuro;
            } else if (colNum === totColIndex) {
                const totItemVal = (m.capexBreakdown || []).reduce((acc, cb) => acc + (cb[capexKeyRef] || 0), 0);
                const totDeprVal = Math.round(totItemVal * fiscalDeprRate);
                if (totColIndex > 2) {
                    cell.value = { formula: `SUM(${firstPlantCol}${currentRowNumCapex}:${lastPlantCol}${currentRowNumCapex})`, result: totDeprVal };
                } else {
                    const colLetter = getColLetter(colNum);
                    const capexRow = rowMapCapex[capexKeyRef];
                    cell.value = { formula: `ROUND(${colLetter}${capexRow} * ${pctColLetter}${capexRow}, 0)`, result: totDeprVal };
                }
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
        }
        
        currentRowNumCapex++;
        return row;
    }

    addDeprRowCapex('deprSolar', `Quota Ammortamento EPC Solar`, 'solar');
    addDeprRowCapex('deprBess', `Quota Ammortamento BESS`, 'bess');
    addDeprRowCapex('deprConn', `Quota Ammortamento Connessione`, 'connection');
    addDeprRowCapex('deprDev', `Quota Ammortamento Compensazioni`, 'development');
    addDeprRowCapex('deprLandDds', `Quota Ammortamento Terreni DDS Att.`, 'landDds');
    addDeprRowCapex('deprCustom', `Quota Ammortamento Voci Personalizzate`, 'custom');
    
    // Quota Ammortamento Oneri Finanziari IDC Capitalizzati (OIC 16)
    {
        let rowDataIdc = { label: 'Quota Ammortamento Oneri Finanziari (IDC)' };
        const rowIdc = sheetCapex.addRow(rowDataIdc);
        rowMapCapex['deprIdc'] = currentRowNumCapex;
        const totColIndex = m.capexBreakdown ? m.capexBreakdown.length + 2 : 2;
        const totColLetter = getColLetter(totColIndex);
        const pctColIndex = totColIndex + 1;
        for (let colNum = 1; colNum <= Math.max(totColIndex, pctColIndex); colNum++) {
            const cell = rowIdc.getCell(colNum);
            if (colNum === totColIndex) {
                const idcVal = Math.round((m.idcTotal || 0) * fiscalDeprRate);
                pendingFormulasCapex.push({
                    cell: cell,
                    formulaFn: () => `ROUND('DRIVER OPERATIVI'!$B$${rowMap.idcConst} * 'FINANZA'!$B$${rowMapFin['fiscalDeprRate']}, 0)`,
                    result: idcVal
                });
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            } else if (colNum > 1 && colNum < totColIndex) {
                const colLetter = getColLetter(colNum);
                const capexRow = rowMapCapex['totalCapex'];
                const cb = m.capexBreakdown ? m.capexBreakdown[colNum - 2] : null;
                const totCap = m.capexTotal || 1;
                const plantIdcVal = Math.round((m.idcTotal || 0) * fiscalDeprRate * ((cb?.totalCapex || 0) / totCap));
                pendingFormulasCapex.push({
                    cell: cell,
                    formulaFn: () => `ROUND('DRIVER OPERATIVI'!$B$${rowMap.idcConst} * 'FINANZA'!$B$${rowMapFin['fiscalDeprRate']} * (${colLetter}${capexRow} / ${totColLetter}${capexRow}), 0)`,
                    result: plantIdcVal
                });
                cell.numFmt = numberFormatEuro;
            } else if (colNum === pctColIndex) {
                pendingFormulasCapex.push({
                    cell: cell,
                    formulaFn: () => `FINANZA!$B$${rowMapFin['fiscalDeprRate']}`,
                    result: fiscalDeprRate
                });
                cell.value = fiscalDeprRate;
                cell.numFmt = numberFormatPct;
            }
        }
        currentRowNumCapex++;
    }

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
                const cb = (colNum <= totColIndex - 1 && m.capexBreakdown) ? m.capexBreakdown[colNum - 2] : null;
                const totDeprVal = cb ? Math.round((cb.totalCapex || 0) * fiscalDeprRate) : Math.round(((m.capexTotal || 0) + (m.idcTotal || 0)) * fiscalDeprRate);
                cell.value = { formula: `SUM(${colLetter}${rowMapCapex['deprSolar']}:${colLetter}${rowMapCapex['deprIdc']})`, result: totDeprVal };
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
        if (m.opexBreakdown) {
            m.opexBreakdown.forEach((ob, idx) => {
                let val = (ob.years && ob.years.length > 1) ? mapFn(ob.years[1]) : ((ob.years && ob.years.length > 0) ? mapFn(ob.years[0]) : 0);
                // Se nell'Anno 1 il costo è 0 (es. cantiere / COD a metà anno con O&M post-COD),
                // campiona il primo anno attivo a regime per rappresentare la capacità contrattuale annua standard
                if (val === 0 && ob.years && ob.years.length > 2) {
                    const firstActiveIdx = ob.years.findIndex((y, yi) => yi > 0 && mapFn(y) > 0);
                    if (firstActiveIdx >= 1) {
                        const inf = (window.State.inputs && window.State.inputs.inflation !== undefined) ? window.State.inputs.inflation : 0.02;
                        val = mapFn(ob.years[firstActiveIdx]) / Math.pow(1 + inf, firstActiveIdx - 1);
                    }
                }
                rowData[`p${idx}`] = val;
            });
        }
        
        const row = sheetOpex.addRow(rowData);
        rowMapOpex[key] = currentRowNumOpex;
        
        const totColIndex = m.opexBreakdown ? m.opexBreakdown.length + 2 : 2;
        const firstPlantCol = getColLetter(2);
        const lastPlantCol = getColLetter(totColIndex - 1);

        for (let colNum = 1; colNum <= totColIndex; colNum++) {
            const cell = row.getCell(colNum);
            if (colNum > 1 && colNum < totColIndex) {
                // Cella parametro OPEX impianto editabile (FAST Standard)
                applyInputStyle(cell, numberFormatEuro);
            } else if (colNum === totColIndex) {
                const rowSum = (m.opexBreakdown || []).reduce((acc, ob, idx) => acc + (rowData[`p${idx}`] || 0), 0);
                if (totColIndex > 2) {
                    cell.value = { formula: `SUM(${firstPlantCol}${currentRowNumOpex}:${lastPlantCol}${currentRowNumOpex})`, result: rowSum };
                } else {
                    cell.value = rowData[`p0`] || 0;
                }
                cell.numFmt = numberFormatEuro;
                cell.font = { bold: true };
            }
            if (isBold) cell.font = { bold: true };
            if (isBold && colNum === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
        }
        
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
                const ob = (colNum <= totColIndex - 1 && m.opexBreakdown) ? m.opexBreakdown[colNum - 2] : null;
                const opexTot = ob ? (ob.years?.[1]?.opexTotal || ob.years?.[0]?.opexTotal || 0) : (m.opexBreakdown ? m.opexBreakdown.reduce((acc, b) => acc + (b.years?.[1]?.opexTotal || b.years?.[0]?.opexTotal || 0), 0) : 0);
                cell.value = { formula: `SUM(${colLetter}${rowMapOpex['opexPlants']}:${colLetter}${rowMapOpex['maintReserve']})`, result: opexTot };
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
        const mArr = m[opexKey];
        // In mArr, index 0 is Anno 0, index 1 is Anno 1
        const isY1Zero = !mArr || !mArr[1] || mArr[1] === 0;

        if (yearIndex === 0) {
            // Anno 0: nessun opex standard di impianto, ma DDS annuo o costi pre-COD se presenti
            if (!mArr || !mArr[0] || mArr[0] === 0) return '0';
            if (opexKey === 'landDdsAnnuo') return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
            return String(-Math.abs(mArr[0]));
        } else if (yearIndex === 1) {
            if (isY1Zero) return '0';
            return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex[opexKey]}, 0)`;
        } else if (yearIndex === 2 && isY1Zero) {
            return `IFERROR(-ROUND(OPEX!${opexTotCol}${rowMapOpex[opexKey]} * (1 + 'DRIVER OPERATIVI'!${colLetter}${rowMap.inflation}), 0), 0)`;
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
        if (type === 'section-title') {
            const row = sheetCe.addRow({ label });
            rowMapCe[key] = currentRowNumCe;
            row.getCell(1).font = { bold: true, color: { argb: 'FFE2E8F0' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            sheetCe.mergeCells(currentRowNumCe, 1, currentRowNumCe, numYears + 1);
            currentRowNumCe++;
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
    addRowCe('revenueMsd', 'di cui: Ricavi Servizi Ancillari BESS - MSD / Capacity (€)', 'detail', m.revenueMsd, numberFormatEuro, (col, yi) => (m.revenueMsd && m.revenueMsd[yi] ? String(m.revenueMsd[yi]) : '0'));
    
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
    
    // Le quote di ammortamento calcolate nel foglio CAPEX sono nella colonna TOTALE PORTAFOGLIO
    // (capexCols.length - 1), NON nella colonna Aliquota (capexCols.length, che è vuota per le quote depr).
    const deprColLetter = getColLetter(capexCols.length - 1);
    addRowCe('depreciationCivil', '(-) Ammortamento Civilistico (€)', 'group-header', m.depreciationCivil, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        return `SUM(${col}${rowMapCe.depreciationCivilSolar}:${col}${rowMapCe.depreciationCivilOther})`;
    });
    
    addRowCe('depreciationCivilSolar', 'di cui: Ammortamento Impianti Solari (€)', 'minus', m.depreciationCivilSolar, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = `'FINANZA'!$B$${rowMapFin['fiscalDeprRate']}`;
        const availRef = `'FINANZA'!$B$${rowMapFin['y1OperatingAvail']}`;
        const capexRef = `(CAPEX!${deprColLetter}${rowMapCapex['deprSolar']} + CAPEX!${deprColLetter}${rowMapCapex['deprLandDds']})`;
        return `IF(${yr} = 1, IFERROR(-ROUND(${capexRef} * ${availRef}, 0), 0), IF(${yr} < ROUNDUP(1 / ${rateRef}, 0), IFERROR(-${capexRef}, 0), IF(${yr} = ROUNDUP(1 / ${rateRef}, 0), IFERROR(-ROUND(${capexRef} * (1 / ${rateRef} - (${yr} - 1) + (1 - ${availRef})), 0), 0), 0)))`;
    });
    addRowCe('depreciationCivilBess', 'di cui: Ammortamento BESS (€)', 'minus', m.depreciationCivilBess, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = `'FINANZA'!$B$${rowMapFin['fiscalDeprRate']}`;
        const availRef = `'FINANZA'!$B$${rowMapFin['y1OperatingAvail']}`;
        const capexRef = `CAPEX!${deprColLetter}${rowMapCapex['deprBess']}`;
        return `IF(${yr} = 1, IFERROR(-ROUND(${capexRef} * ${availRef}, 0), 0), IF(${yr} < ROUNDUP(1 / ${rateRef}, 0), IFERROR(-${capexRef}, 0), IF(${yr} = ROUNDUP(1 / ${rateRef}, 0), IFERROR(-ROUND(${capexRef} * (1 / ${rateRef} - (${yr} - 1) + (1 - ${availRef})), 0), 0), 0)))`;
    });
    addRowCe('depreciationCivilOther', 'di cui: Ammortamento Altri Costi Capitalizzati (€)', 'minus', m.depreciationCivilOther, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const yr = yi;
        const rateRef = `'FINANZA'!$B$${rowMapFin['fiscalDeprRate']}`;
        const availRef = `'FINANZA'!$B$${rowMapFin['y1OperatingAvail']}`;
        const capexRef = `(CAPEX!${deprColLetter}${rowMapCapex['deprConn']} + CAPEX!${deprColLetter}${rowMapCapex['deprDev']} + CAPEX!${deprColLetter}${rowMapCapex['deprCustom']} + CAPEX!${deprColLetter}${rowMapCapex['deprIdc']})`;
        return `IF(${yr} = 1, IFERROR(-ROUND(${capexRef} * ${availRef}, 0), 0), IF(${yr} < ROUNDUP(1 / ${rateRef}, 0), IFERROR(-${capexRef}, 0), IF(${yr} = ROUNDUP(1 / ${rateRef}, 0), IFERROR(-ROUND(${capexRef} * (1 / ${rateRef} - (${yr} - 1) + (1 - ${availRef})), 0), 0), 0)))`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('ebit', 'EBIT SPV (Risultato Operativo) (€)', 'bold', m.ebit, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.ebitda}+${col}${rowMapCe.depreciationCivil}`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('interestActive', '  (+) Interessi Attivi su MRA (€)', 'plus', m.interestActive, numberFormatEuro, (col, yi) => (m.interestActive && m.interestActive[yi] ? String(m.interestActive[yi]) : '0'));
    addRowCe('interest', '  (-) Interessi Passivi Mutuo Bancario (€)', 'minus', m.interest, numberFormatEuro, (col) => {
        return `'AMMORTAMENTO'!${col}${rowMapDebt.interestAccrued}`;
    });
    
    const sociInterestRate = window.State.inputs.sociInterestRate;
    addRowCe('sociInterestAccrued', `  (-) Interessi Finanziamento Soci (Accrual) (${sociInterestRate > 0 ? sociInterestRate.toFixed(2) + '%' : 'Nessuno'}) (€)`, 'minus', m.sociInterestAccrued, numberFormatEuro, (col) => {
        return `'AMMORTAMENTO'!${col}${rowMapDebt.interestAccruedSoci}`;
    });
    
    // External financing interest rows (PD è a livello Holding → NON in CE SPV; solo AF convertible resta in CE SPV)
    if (window.State.inputs.afEnabled && window.State.inputs.afType === 'convertible_note') {
        addRowCe('afInterestAccrued', `  (-) Interessi Convertibile (Altra Forma) PIK ${(window.State.inputs.afConvertibleRate||0).toFixed(2)}% (€)`, 'minus', m.afInterestAccrued, numberFormatEuro, (col, yi) => (m.afInterestAccrued && m.afInterestAccrued[yi] ? String(-Math.abs(m.afInterestAccrued[yi])) : '0'));
    }
    // External financing opex rows (PE royalty + AF advisory) — mostrate come di cui opex
    if (window.State.inputs.peEnabled && window.State.inputs.peMode === 'royalty_fee') {
        addRowCe('peRoyalty', '  (-) Royalty Private Equity (% Ricavi) (€)', 'minus', m.peRoyalty, numberFormatEuro, (col) => {
            return `-ROUND(${col}${rowMapCe.revenueTotal} * 'FINANZA'!$B$${rowMapFin['peRoyaltyRate']}, 0)`;
        });
    }
    if (window.State.inputs.afEnabled && window.State.inputs.afType === 'advisory_fee') {
        addRowCe('afFee', '  (-) Advisory Fee (Altra Forma Parasociale) (€)', 'minus', m.afFee, numberFormatEuro, (col) => {
            return `-'FINANZA'!$B$${rowMapFin['afFeeAnnual']}`;
        });
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
    addRowCe('taxSupportHdr', 'CALCOLO FISCALE DI SUPPORTO (Amm.to Fiscale, Art. 96/84 TUIR)', 'section-title');
    
    // Ammortamento fiscale (anno 1 dimezzato) + Aug BESS da anno 11
    addRowCe('taxFiscalDeprBase', 'Amm.to Fiscale Base - anno 1 al 50% (€)', 'detail', m.taxFiscalDeprBase, numberFormatEuro, (col, yi) => {
        const base = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst}`;
        const rate = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalDeprRateConst}`;
        if (yi === 0) return '0';
        if (yi === 1) return `MIN(${base}*${rate}/2, ${base})`;
        const prevCol = getColLetter(yi + 1);
        return `MIN(${base}*${rate}, ${prevCol}${rowMapCe.taxFiscalRemaining})`;
    });
    addRowCe('taxFiscalRemaining', 'Base Fiscale Residua (€)', 'detail', m.taxFiscalRemaining, numberFormatEuro, (col, yi) => {
        const base = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst}`;
        if (yi === 0) return `${base}`;
        if (yi === 1) return `${base}-${col}${rowMapCe.taxFiscalDeprBase}`;
        const prevCol = getColLetter(yi + 1);
        return `MAX(0, ${prevCol}${rowMapCe.taxFiscalRemaining}-${col}${rowMapCe.taxFiscalDeprBase})`;
    });
    addRowCe('taxAugDepr', 'Amm.to Fiscale Aug BESS - da anno 11 (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        if (yi <= 10) return '0';
        const aug = `'DRIVER OPERATIVI'!$B$${rowMap.bessAugConst}`;
        const rate = `'DRIVER OPERATIVI'!$B$${rowMap.fiscalDeprRateConst}`;
        const prevCol = getColLetter(yi + 1);
        return `MIN(${aug}*${rate}, ${prevCol}${rowMapCe.taxAugRemaining})`;
    });
    addRowCe('taxAugRemaining', 'Base Fiscale Aug BESS Residua (€)', 'detail', _zeroArr, numberFormatEuro, (col, yi) => {
        const aug = `'DRIVER OPERATIVI'!$B$${rowMap.bessAugConst}`;
        if (yi <= 10) return `${aug}`;
        const prevCol = getColLetter(yi + 1);
        return `MAX(0, ${prevCol}${rowMapCe.taxAugRemaining}-${col}${rowMapCe.taxAugDepr})`;
    });
    addRowCe('taxFiscalDepr', 'Amm.to Fiscale Totale (€)', 'detail', m.taxFiscalDepr, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.taxFiscalDeprBase}+${col}${rowMapCe.taxAugDepr}`;
    });
    
    // Art. 96 TUIR — deducibilità interessi passivi entro ROL 30%
    addRowCe('taxRolCapacity', 'ROL 30% EBITDA - Art. 96 (€)', 'detail', m.rolCapacity, numberFormatEuro, (col) => {
        return `MAX(0, 0.3*${col}${rowMapCe.ebitda})`;
    });
    addRowCe('taxNetInterest', 'Interessi Passivi Netti - Art. 96 (€)', 'detail', m.taxNetInterest, numberFormatEuro, (col) => {
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
    addRowCe('taxTaxableIres', 'Imponibile IRES Lordo (€)', 'detail', m.taxTaxableIres, numberFormatEuro, (col) => {
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
    addRowCe('taxLossCF', '  (Memo Fiscale) Perdite Fiscali Pregresse Riportabili a Nuovo (€)', 'detail-sub', m.taxLossCF, numberFormatEuro, (col) => {
        return `${col}${rowMapCe.taxLossFirst3CF}+${col}${rowMapCe.taxLossNormalCF}`;
    });
    addRowCe('taxTaxableFinal', 'Imponibile IRES Netto - post NOL (€)', 'detail', m.taxTaxableFinal, numberFormatEuro, (col) => {
        return `MAX(0, ${col}${rowMapCe.taxTaxableIres}-${col}${rowMapCe.taxNolFirst3Applied}-${col}${rowMapCe.taxNolNormalApplied})`;
    });
    
    // IRAP — base = EBIT + IMU + quota IDC civilistico
    addRowCe('taxCivilIdc', 'Quota IDC in Amm.to Civilistico - IRAP (€)', 'detail', m.taxCivilIdc, numberFormatEuro, (col) => {
        return `-${col}${rowMapCe.depreciationCivil}*('DRIVER OPERATIVI'!$B$${rowMap.idcConst}/'DRIVER OPERATIVI'!$B$${rowMap.fiscalBaseConst})`;
    });
    addRowCe('taxIrapBase', 'Base Imponibile IRAP (€)', 'detail', m.taxableIrap || m.taxIrapBase, numberFormatEuro, (col) => {
        return `MAX(0, ${col}${rowMapCe.ebit}-${col}${rowMapCe.opexTaxes}+${col}${rowMapCe.taxCivilIdc})`;
    });
    
    // Imposte Differite — delta (fiscale - civilistico) x aliquote, con fondo e reversal
    addRowCe('taxDeferredRaw', 'Delta Amm.to x Aliquote (€)', 'detail', m.taxDeferredRaw, numberFormatEuro, (col) => {
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
    addRowCe('taxDeferredFund', 'Fondo Imposte Differite - saldo (€)', 'detail', m.taxDeferredFund, numberFormatEuro, (col, yi) => {
        const prevFund = yi > 0 ? `${getColLetter(yi + 1)}${rowMapCe.taxDeferredFund}` : '0';
        return `${prevFund}+${col}${rowMapCe.deferredTaxes}`;
    });
    
    sheetCe.addRow([]); currentRowNumCe++;
    
    addRowCe('netProfitSpv', 'UTILE NETTO CIVILISTICO SPV (⇒ Sez. B) (€)', 'bold', m.netProfitSpv, numberFormatEuro, (col) => {
        // netProfit = EBT - (correnti + differite); correnti già negative, differite da sottrarre
        return `${col}${rowMapCe.ebt}+${col}${rowMapCe.currentTaxesSpv}-${col}${rowMapCe.deferredTaxes}`;
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
                        rowIndex: currentRowNumRf,
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
    addRowRf('opexMaintReserve', '  (-) Accantonamento a Riserva di Manutenzione (MRA) (€)', 'minus', m.opexMaintReserve, numberFormatEuro, (col, yi, ri) => {
        if (yi === 0) {
            return '0';
        } else if (yi === 1) {
            return `IFERROR(-OPEX!${opexTotCol}${rowMapOpex['maintReserve']}, 0)`;
        } else {
            const prevCol = getColLetter((yi + 2) - 1);
            return `IFERROR(ROUND(${prevCol}${ri} * (1 + 'DRIVER OPERATIVI'!${col}${rowMap.inflation}), 0), 0)`;
        }
    });
    addRowRf('bessAugmentationCost', '  (-) CAPEX Sostituzione Celle NMC/LFP BESS (€)', 'minus', m.bessAugmentationCost, numberFormatEuro, (col, yi) => {
        if (yi === 10) {
            return `-'DRIVER OPERATIVI'!$B$${rowMap.bessAugConst}`;
        }
        return '0';
    });
    addRowRf('mraRelease', '  (+) Rilascio Riserva di Manutenzione (MRA) per CAPEX BESS (€)', 'plus', m.mraRelease, numberFormatEuro, (col, yi) => {
        if (yi === 10) {
            return `MIN(-SUM($B$${rowMapRf.opexMaintReserve}:${col}${rowMapRf.opexMaintReserve}), -${col}${rowMapRf.bessAugmentationCost})`;
        }
        return '0';
    });
    
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
        return `'AMMORTAMENTO'!${col}${rowMapDebt['interestAccrued']}`;
    });
    addRowRf('principalScheduled', '  (-) Quota Capitale Mutuo Bancario Programmata (€)', 'minus', m.principalScheduled, numberFormatEuro, (col) => {
        return `'AMMORTAMENTO'!${col}${rowMapDebt['principalScheduled']}`;
    });
    addRowRf('principalVoluntary', '  (-) Cash Sweep Mutuo Bancario Volontario (€)', 'minus', m.principalVoluntary, numberFormatEuro, (col) => {
        return `'AMMORTAMENTO'!${col}${rowMapDebt['principalVoluntary']}`;
    });
    
    const st = window.State.inputs && window.State.inputs.sweepType;
    if (st && st !== 'none') {
        const typeStr = st === 'pct_cfads' ? `${window.State.inputs.sweepValue || 0}% del CFADS disponibile` : `€ ${(window.State.inputs.sweepValue || 0).toLocaleString('it-IT')} fissi/anno`;
        const durStr = (window.State.inputs.sweepYears || 0) > 0 ? `per ${window.State.inputs.sweepYears} anni` : 'fino a estinzione mutuo';
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
    addRowRf('spvLegalReserveAccrual', '  (Nota civilistica) Accantonamento Riserva Legale SPV (5% ex Art. 2430 c.c.) (€)', 'detail', m.spvLegalReserveAccrual, numberFormatEuro, (col, yi) => {
        const pureEqRef = `('FINANZA'!$B$${rowMapFin['holdcoEq']}+'FINANZA'!$B$${rowMapFin['otherEq']})`;
        if (yi === 0) {
            return `IF(${col}${rowMapRf.rf_netProfitSpv}>0, MIN(0.05*${col}${rowMapRf.rf_netProfitSpv}, MAX(0, 0.2*${pureEqRef})), 0)`;
        }
        const prevCol = getColLetter(yi + 1);
        return `IF(${col}${rowMapRf.rf_netProfitSpv}>0, MIN(0.05*${col}${rowMapRf.rf_netProfitSpv}, MAX(0, 0.2*${pureEqRef}-SUM($B$${rowMapRf.spvLegalReserveAccrual}:${prevCol}${rowMapRf.spvLegalReserveAccrual}))), 0)`;
    });
    addRowRf('spvRetainedEarnings', '  (Capienza) Capacità Distributiva Utili SPV Cumulata (€)', 'detail', m.spvRetainedEarnings, numberFormatEuro, (col, yi) => {
        if (yi === 0) {
            return `MAX(0, ${col}${rowMapRf.rf_netProfitSpv}-${col}${rowMapRf.spvLegalReserveAccrual}+${col}${rowMapRf.holdcoDividendReceived})`;
        }
        const prevCol = getColLetter(yi + 1);
        return `MAX(0, ${prevCol}${rowMapRf.spvRetainedEarnings}+${col}${rowMapRf.rf_netProfitSpv}-${col}${rowMapRf.spvLegalReserveAccrual}+${col}${rowMapRf.holdcoDividendReceived})`;
    });
    addRowRf('holdcoInterestReceived', '  (-) Interessi Soci Pagati da SPV a HoldCo (⇒ Sez. C) (€)', 'minus', m.holdcoInterestReceived, numberFormatEuro, (col) => {
        return `-MIN(MAX(0, ${col}${rowMapRf.spvFCFE}), -'AMMORTAMENTO'!${col}${rowMapDebt.interestAccruedSoci})`;
    });
    // Quota dividendi/preferred Private Equity a partner esterno (non sale alla HoldCo)
    if (window.State.inputs.peEnabled && window.State.inputs.peMode !== 'royalty_fee') {
        addRowRf('peDividendPaid', '  (-) Quota Dividendi/Preferred Private Equity a Partner Esterno (€)', 'minus', m.peDividendPaid, numberFormatEuro);
    }
    // Rimborso Capitale Finanziamento Soci (Senior rispetto ai dividendi azionari)
    addRowRf('holdcoLoanRepaymentReceived', '  (-) Rimborso Capitale Finanziamento Soci a HoldCo (⇒ Sez. D) (€)', 'minus', m.holdcoLoanRepaymentReceived, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const cashPostInt = `MAX(0, ${col}${rowMapRf.spvFCFE}+${col}${rowMapRf.holdcoInterestReceived})`;
        const targetQuota = `IF(${yi}>'FINANZA'!$B$${rowMapFin['sociPrincipalGrace']}, IF('FINANZA'!$B$${rowMapFin['sociLoanTerm']}>0, 'AMMORTAMENTO'!${col}${rowMapDebt.beginningBalanceSoci}/MAX(1, 'FINANZA'!$B$${rowMapFin['sociPrincipalGrace']}+'FINANZA'!$B$${rowMapFin['sociLoanTerm']}-${yi}+1), 'AMMORTAMENTO'!${col}${rowMapDebt.beginningBalanceSoci}), 0)`;
        return `-MIN(${cashPostInt}, 'AMMORTAMENTO'!${col}${rowMapDebt.beginningBalanceSoci}, ${targetQuota})`;
    });
    // Dividendi azionari SPV (Cassa residua post-debito soci, fino a capienza utili distribuibili ex Art. 2433 c.c.)
    addRowRf('holdcoDividendReceived', '  (-) Dividendi SPV Distribuiti a HoldCo (da Utili Art. 2433 c.c.) (⇒ Sez. C) (€)', 'minus', m.holdcoDividendReceived, numberFormatEuro, (col, yi) => {
        const prevCol = yi > 0 ? getColLetter(yi + 1) : null;
        const cashPostLoan = `MAX(0, ${col}${rowMapRf.spvFCFE}+${col}${rowMapRf.holdcoInterestReceived}+${col}${rowMapRf.holdcoLoanRepaymentReceived})`;
        const capUtili = yi === 0 
            ? `MAX(0, ${col}${rowMapRf.rf_netProfitSpv}-${col}${rowMapRf.spvLegalReserveAccrual})`
            : `MAX(0, ${prevCol}${rowMapRf.spvRetainedEarnings}+${col}${rowMapRf.rf_netProfitSpv}-${col}${rowMapRf.spvLegalReserveAccrual})`;
        const divAmount = `IF(AND('FINANZA'!$B$${rowMapFin['dividendLock']}="SÌ", 'AMMORTAMENTO'!${col}${rowMapDebt.endingBalance}>1), 0, IF(ISNUMBER(SEARCH("Cash Flow Driven", 'FINANZA'!$B$${rowMapFin['distributionPolicy']})), ${cashPostLoan}, MIN(${cashPostLoan}, ${capUtili})))`;
        return `-${divAmount}`;
    });
    addRowRf('spvCapitalReserveReturned', '  (-) Restituzione Riserve di Capitale / Esuberanza a HoldCo (Art. 2482 c.c.) (⇒ Sez. D) (€)', 'minus', m.spvCapitalReserveReturned, numberFormatEuro, (col, yi) => {
        const cashPostDiv = `MAX(0, ${col}${rowMapRf.spvFCFE}+${col}${rowMapRf.holdcoInterestReceived}+${col}${rowMapRf.holdcoLoanRepaymentReceived}+${col}${rowMapRf.holdcoDividendReceived})`;
        const pureEqRef = `('FINANZA'!$B$${rowMapFin['holdcoEq']}+'FINANZA'!$B$${rowMapFin['otherEq']})`;
        let availableReserve = pureEqRef;
        if (yi > 0) {
            const prevCol = getColLetter(yi + 1);
            availableReserve = `MAX(0, ${pureEqRef}+SUM($B$${rowMapRf.spvCapitalReserveReturned}:${prevCol}${rowMapRf.spvCapitalReserveReturned}))`;
        }
        return `-IF(AND('FINANZA'!$B$${rowMapFin['dividendLock']}="SÌ", 'AMMORTAMENTO'!${col}${rowMapDebt.endingBalance}>1), 0, IF(ISNUMBER(SEARCH("Riserve Capitale", 'FINANZA'!$B$${rowMapFin['distributionPolicy']})), MIN(${cashPostDiv}, ${availableReserve}), 0))`;
    });
    
    sheetRf.addRow([]); currentRowNumRf++;
    
    addRowRf('spvCashTrap', '(=) Flusso Netto SPV non distribuito nell\'Esercizio (Cash Trap Annuo) (€)', 'bold', m.spvCashTrap, numberFormatEuro, (col) => {
        let f = `MAX(0, ${col}${rowMapRf.spvFCFE}+${col}${rowMapRf.holdcoInterestReceived}`;
        if (rowMapRf.peDividendPaid) f += `+${col}${rowMapRf.peDividendPaid}`;
        f += `+${col}${rowMapRf.holdcoLoanRepaymentReceived}+${col}${rowMapRf.holdcoDividendReceived}+${col}${rowMapRf.spvCapitalReserveReturned})`;
        return f;
    });
    addRowRf('spvLockedDividends', '  (+) Cassa SPV Vincolata a Inizio Esercizio (da Anni Precedenti) (€)', 'plus', m.spvLockedDividends, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        const prevCol = getColLetter(yi + 1);
        return `${prevCol}${rowMapRf.spvCashTrapCumulative}`;
    });
    addRowRf('spvCashTrapCumulative', '(=) SALDO TOTALE CASSA VINCOLATA IN SPV (CASH TRAP CUMULATO A FINE ANNO) (€)', 'bold-teal', m.spvCashTrapCumulative, numberFormatEuro, (col, yi) => {
        if (yi === 0) return `${col}${rowMapRf.spvCashTrap}`;
        return `${col}${rowMapRf.spvLockedDividends}+${col}${rowMapRf.spvCashTrap}`;
    });

    // ---------------------------------------------------------
    // FOGLIO: CONTO ECONOMICO HOLDING (SEZIONE C)
    // ---------------------------------------------------------
    const sheetCeHc = workbook.addWorksheet('CONTO ECONOMICO HOLDING', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetCeHc.columns = columns;

    sheetCeHc.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumCeHc = 2;
    const rowMapCeHc = {};
    const pendingFormulasCeHc = [];

    function addRowCeHc(key, label, type, dataArray, format, formulaFn = null) {
        if (type === 'section-title') {
            const row = sheetCeHc.addRow({ label });
            row.getCell(1).font = { bold: true, color: { argb: 'FFE2E8F0' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            sheetCeHc.mergeCells(currentRowNumCeHc, 1, currentRowNumCeHc, numYears + 1);
            currentRowNumCeHc++;
            return;
        }

        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val);
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetCeHc.addRow(rowValues);
        rowMapCeHc[key] = currentRowNumCeHc;

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
                    pendingFormulasCeHc.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        rowIndex: currentRowNumCeHc,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNumCeHc++;
    }

    // ── SEZIONE C: CONTO ECONOMICO CIVILISTICO HOLDING (P&L HOLDCO) ──
    // Struttura, aspetto, ordine e nomi speculari a CONTO ECONOMICO (SPV)
    addRowCeHc('holdcoProductionValue', 'RICAVI TOTALI HOLDING (€)', 'group-header', m.holdcoProductionValue, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.hc_holdcoAssetManagementReceived}`;
    });
    addRowCeHc('hc_holdcoAssetManagementReceived', 'di cui: Ricavi per Servizi: Gestione Amministrativa & Asset Management a SPV (€)', 'detail', m.opexAssetManagement, numberFormatEuro, (col) => {
        return `-('CONTO ECONOMICO'!${col}${rowMapCe.opexAssetManagement})`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoProductionCosts', '(-) COSTI OPERATIVI (OPEX) TOTALE HOLDING (€)', 'group-header', m.holdcoProductionCosts, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.holdcoOpex}+${col}${rowMapCeHc.holdcoEarnoutPaid}`;
    });
    addRowCeHc('holdcoOpex', 'di cui: Spese Generali e Costi di Funzionamento Holding (OPEX) (€)', 'minus', m.holdcoOpex, numberFormatEuro, (col, yi, ri) => {
        if (yi === 0) return `-15000`;
        const prevCol = getColLetter(yi + 1);
        if (yi === 1) return `${prevCol}${ri}`;
        return `ROUND(${prevCol}${ri} * (1 + 'DRIVER OPERATIVI'!${col}${rowMap.inflation}), 0)`;
    });
    addRowCeHc('holdcoEarnoutPaid', 'di cui: Oneri Diversi di Gestione: Quota Earn-Out Holding (€)', 'minus', m.holdcoEarnoutPaid, numberFormatEuro, (col, yi) => {
        if (yi === 0) return '0';
        if (!m.holdcoEarnoutPaid || !m.holdcoEarnoutPaid.some(v => v > 0)) return '0';
        if (!m.holdcoEarnoutPaid[yi] || m.holdcoEarnoutPaid[yi] <= 0) return '0';

        const yr = yi;
        const allPlants = (typeof window !== 'undefined' && window.State && window.State.plants) ? window.State.plants : [];
        const activeEarnoutPlants = allPlants.filter(pl => pl.enabled !== false && (pl.earnoutVal || 0) > 0 && yr <= (pl.earnoutYears || 0));

        if (activeEarnoutPlants.length === 0) return '0';

        const firstType = activeEarnoutPlants[0].earnoutType;
        const firstVal = activeEarnoutPlants[0].earnoutVal;
        const allSame = activeEarnoutPlants.every(pl => pl.earnoutType === firstType && pl.earnoutVal === firstVal);

        const hasBess = allPlants.some(pl => pl.enabled !== false && (pl.bessMwh || 0) > 0);
        const bessRevRef = [];
        if (hasBess && rowMapCe.revenueTimeshifting) bessRevRef.push(`'CONTO ECONOMICO'!${col}${rowMapCe.revenueTimeshifting}`);
        if (hasBess && rowMapCe.revenueArbitrage) bessRevRef.push(`'CONTO ECONOMICO'!${col}${rowMapCe.revenueArbitrage}`);
        const ridRef = bessRevRef.length > 0
            ? `('CONTO ECONOMICO'!${col}${rowMapCe.revenueRid} + ${bessRevRef.join(' + ')})`
            : `'CONTO ECONOMICO'!${col}${rowMapCe.revenueRid}`;

        if (allSame) {
            if (firstType === 'rid_pct') {
                return `-ROUND(${ridRef} * ${firstVal / 100}, 0)`;
            } else if (firstType === 'total_rev_pct') {
                return `-ROUND('CONTO ECONOMICO'!${col}${rowMapCe.revenueTotal} * ${firstVal / 100}, 0)`;
            } else if (firstType === 'fixed') {
                return `-ROUND(${firstVal} * POWER(1 + 'DRIVER OPERATIVI'!$B$${rowMap.inflation}, ${yi - 1}), 0)`;
            } else if (firstType === 'grid_feed_mwh') {
                return `-ROUND(('DRIVER OPERATIVI'!${col}${rowMap.qtySolarRid}) * ${firstVal}, 0)`;
            } else if (firstType === 'generation_mwh') {
                return `-ROUND('DRIVER OPERATIVI'!${col}${rowMap.qtySolarTotal} * ${firstVal}, 0)`;
            }
        }

        // Parametri eterogenei tra impianti: somma pesata per potenza
        const terms = [];
        activeEarnoutPlants.forEach(pl => {
            const capWeight = totalKwp > 0 ? ((parseFloat(pl.capacity) || 0) / totalKwp) : (1 / activeEarnoutPlants.length);
            if (pl.earnoutType === 'rid_pct') {
                terms.push(`${ridRef} * ${capWeight * (pl.earnoutVal / 100)}`);
            } else if (pl.earnoutType === 'total_rev_pct') {
                terms.push(`'CONTO ECONOMICO'!${col}${rowMapCe.revenueTotal} * ${capWeight * (pl.earnoutVal / 100)}`);
            } else if (pl.earnoutType === 'fixed') {
                terms.push(`${pl.earnoutVal} * POWER(1 + 'DRIVER OPERATIVI'!$B$${rowMap.inflation}, ${yi - 1})`);
            } else if (pl.earnoutType === 'grid_feed_mwh') {
                terms.push(`'DRIVER OPERATIVI'!${col}${rowMap.qtySolarRid} * ${capWeight * pl.earnoutVal}`);
            } else if (pl.earnoutType === 'generation_mwh') {
                terms.push(`'DRIVER OPERATIVI'!${col}${rowMap.qtySolarTotal} * ${capWeight * pl.earnoutVal}`);
            }
        });

        if (terms.length > 0) {
            return `-ROUND(${terms.join(' + ')}, 0)`;
        }
        return `-${Math.round(Math.abs(m.holdcoEarnoutPaid[yi]))}`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoEbitda', 'EBITDA HOLDING (€)', 'bold', m.holdcoEbitda, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.holdcoProductionValue}+${col}${rowMapCeHc.holdcoProductionCosts}`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoDepreciation', '(-) Ammortamento Civilistico (€)', 'group-header', Array(numYears).fill(0), numberFormatEuro, () => '0');
    addRowCeHc('holdcoDeprDetail', 'di cui: Ammortamenti Beni Materiali e Immateriali Holding (€)', 'minus', Array(numYears).fill(0), numberFormatEuro, () => '0');

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoOperatingEbit', 'EBIT HOLDING (Risultato Operativo) (€)', 'bold', m.holdcoOperatingEbit, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.holdcoEbitda}+${col}${rowMapCeHc.holdcoDepreciation}`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('hc_holdcoDividendReceived', '  (+) Proventi da Partecipazioni: Dividendi SPV da Utili (Art. 2433 c.c.) (€)', 'plus', m.holdcoDividendReceived, numberFormatEuro, (col) => {
        if (window.State.inputs.peEnabled && rowMapRf.peDividendPaid) {
            return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoDividendReceived} - 'RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.peDividendPaid})`;
        }
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoDividendReceived})`;
    });
    addRowCeHc('hc_holdcoInterestReceived', '  (+) Altri Proventi Finanziari: Interessi Attivi Finanziamento Soci SPV (€)', 'plus', m.holdcoInterestReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoInterestReceived})`;
    });

    if (window.State.inputs.pdEnabled) {
        addRowCeHc('pdInterestPaid', '  (-) Oneri Finanziari: Interessi Passivi Private Debt Holding (€)', 'minus', m.pdInterestPaid, numberFormatEuro, (col) => {
            return `-('AMMORTAMENTO'!${col}${rowMapDebt['interestPaidPd']})`;
        });
    }

    addRowCeHc('holdcoFinancialNet', '(=) TOTALE PROVENTI E ONERI FINANZIARI (C) (€)', 'bold', m.holdcoFinancialNet, numberFormatEuro, (col) => {
        let f = `${col}${rowMapCeHc.hc_holdcoDividendReceived}+${col}${rowMapCeHc.hc_holdcoInterestReceived}`;
        if (rowMapCeHc.pdInterestPaid) f += `+${col}${rowMapCeHc.pdInterestPaid}`;
        return f;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoEbt', 'EBT — Utile ante Imposte HOLDING (€)', 'bold', m.holdcoEbt, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.holdcoOperatingEbit}+${col}${rowMapCeHc.holdcoFinancialNet}`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    // IRES HoldCo: 24% su (interessi + 5% dividendi + asset mgt - opex - interessi PD se deducibili)
    const _pdDedHc = window.State.inputs.pdEnabled && window.State.inputs.pdTaxDeductible !== false;
    addRowCeHc('holdcoTaxTotal', '  (-) Imposte Correnti Holding (IRES 24% + IRAP 3.9%) (€)', 'minus', m.holdcoTaxTotal, numberFormatEuro, (col) => {
        let f = `${col}${rowMapCeHc.holdcoIresTaxPaid}`;
        if (rowMapCeHc.holdcoIrapTaxPaid) f += `+${col}${rowMapCeHc.holdcoIrapTaxPaid}`;
        return f;
    });
    addRowCeHc('holdcoIresTaxPaid', 'di cui: Imposta IRES HoldCo (24% su dividendi imponibili PEX 5% e interessi netti) (€)', 'detail', m.holdcoIresTaxPaid, numberFormatEuro, (col) => {
        let f = `-MAX(0, ${col}${rowMapCeHc.hc_holdcoInterestReceived}+0.05*${col}${rowMapCeHc.hc_holdcoDividendReceived}+${col}${rowMapCeHc.hc_holdcoAssetManagementReceived}+${col}${rowMapCeHc.holdcoOpex}`;
        if (_pdDedHc && rowMapCeHc.pdInterestPaid) f += `+${col}${rowMapCeHc.pdInterestPaid}`;
        f += `)*'DRIVER OPERATIVI'!$B$${rowMap.iresRateConst}`;
        return f;
    });
    addRowCeHc('holdcoIrapTaxPaid', 'di cui: Imposta IRAP HoldCo (3,9% su Valore Produzione Netta) (€)', 'detail', m.holdcoIrapTaxPaid, numberFormatEuro, (col) => {
        return `-MAX(0, ${col}${rowMapCeHc.hc_holdcoAssetManagementReceived}+${col}${rowMapCeHc.holdcoOpex})*'DRIVER OPERATIVI'!$B$${rowMap.irapRateConst}`;
    });

    sheetCeHc.addRow([]); currentRowNumCeHc++;

    addRowCeHc('holdcoNetProfit', 'UTILE NETTO CIVILISTICO HOLDING (⇒ Sez. D) (€)', 'bold', m.holdcoNetProfit, numberFormatEuro, (col) => {
        return `${col}${rowMapCeHc.holdcoEbt}+${col}${rowMapCeHc.holdcoTaxTotal}`;
    });

    // ---------------------------------------------------------
    // FOGLIO: RENDICONTO FINANZIARIO HOLDING (SEZIONE D)
    // ---------------------------------------------------------
    const sheetRfHc = workbook.addWorksheet('RENDICONTO FINANZIARIO HOLDING', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetRfHc.columns = columns;

    sheetRfHc.getRow(1).eachCell((cell, colNumber) => {
        cell.style = headerStyle;
        if (colNumber === 1) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    let currentRowNumRfHc = 2;
    const rowMapRfHc = {};
    const pendingFormulasRfHc = [];

    function addRowRfHc(key, label, type, dataArray, format, formulaFn = null) {
        if (type === 'section-title') {
            const row = sheetRfHc.addRow({ label });
            row.getCell(1).font = { bold: true, color: { argb: 'FFE2E8F0' } };
            row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            sheetRfHc.mergeCells(currentRowNumRfHc, 1, currentRowNumRfHc, numYears + 1);
            currentRowNumRfHc++;
            return;
        }

        const rowValues = { label };
        for (let i = 0; i < numYears; i++) {
            let val = dataArray && dataArray[i] !== undefined ? dataArray[i] : 0;
            if (type === 'minus' || (typeof label === 'string' && label.includes('(-)') && !label.includes('(-/+)'))) {
                val = -Math.abs(val);
            }
            rowValues[`y${i}`] = val;
        }

        const row = sheetRfHc.addRow(rowValues);
        rowMapRfHc[key] = currentRowNumRfHc;

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
                    pendingFormulasRfHc.push({
                        cell: cell,
                        formulaFn: formulaFn,
                        colLetter: colLetter,
                        yearIndex: yearIndex,
                        rowIndex: currentRowNumRfHc,
                        result: rowValues[`y${yearIndex}`]
                    });
                    cell.value = rowValues[`y${yearIndex}`];
                }
            }
        });

        currentRowNumRfHc++;
    }

    // ── SEZIONE D: RENDICONTO FINANZIARIO & FLUSSO NETTO INVESTITORE (FCFE HOLDCO) ──
    const hasCapitalReserve = (window.State.inputs.distributionPolicy === 'civil_with_capital_reserve_return') ||
        (m.holdcoCapitalReserveReceived && m.holdcoCapitalReserveReceived.some(v => Math.abs(v) > 0.01));

    addRowRfHc('sec_rf_holdco', 'RENDICONTO FINANZIARIO & FLUSSO NETTO INVESTITORE (FCFE HOLDCO)', 'section-title');

    // 1. FLUSSO CASSA RISALITO TOTALE DA SPV E RICONCILIAZIONE P&L
    addRowRfHc('holdcoInflowTotal', '-> Flusso Cassa Risalito Totale da SPV (da Sez. B) (€)', 'group-header', m.holdcoInflowTotal, numberFormatEuro, (col) => {
        let f = `${col}${rowMapRfHc.hc_holdcoInterestReceived}+${col}${rowMapRfHc.hc_holdcoLoanRepaymentReceived}+${col}${rowMapRfHc.hc_holdcoDividendReceived}`;
        if (rowMapRfHc.hc_holdcoCapitalReserveReceived) f += `+${col}${rowMapRfHc.hc_holdcoCapitalReserveReceived}`;
        if (rowMapRfHc.hc_holdcoAssetManagementReceived) f += `+${col}${rowMapRfHc.hc_holdcoAssetManagementReceived}`;
        return f;
    });

    addRowRfHc('hc_holdcoInterestReceived', '  di cui: Interessi Finanziamento Soci ricevuti (€)', 'detail', m.holdcoInterestReceived, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.hc_holdcoInterestReceived}`;
    });
    addRowRfHc('hc_holdcoLoanRepaymentReceived', '  di cui: Rimborso Capitale Finanziamento Soci ricevuto (€)', 'detail', m.holdcoLoanRepaymentReceived, numberFormatEuro, (col) => {
        return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoLoanRepaymentReceived})`;
    });
    addRowRfHc('hc_holdcoDividendReceived', '  di cui: Dividendi SPV ricevuti (quota Sponsor) (€)', 'detail', m.holdcoDividendReceived, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.hc_holdcoDividendReceived}`;
    });
    if (hasCapitalReserve) {
        addRowRfHc('hc_holdcoCapitalReserveReceived', '  di cui: Restituzione Riserve di Capitale SPV (Art. 2482 c.c.) (€)', 'detail', m.holdcoCapitalReserveReceived, numberFormatEuro, (col) => {
            return `-('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.spvCapitalReserveReturned})`;
        });
    }
    addRowRfHc('hc_holdcoAssetManagementReceived', '  di cui: Ricavi Gestione Amministrativa & Asset Mgt ricevuti da SPV (€)', 'detail', m.opexAssetManagement, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.hc_holdcoAssetManagementReceived}`;
    });

    // Costi operativi e imposte della Holding
    addRowRfHc('holdcoOpex', '  (-) Spese Funzionamento Holding (€)', 'minus', m.holdcoOpex, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.holdcoOpex}`;
    });
    addRowRfHc('holdcoEarnoutPaid', '  (-) Earn-Out Holding (€)', 'minus', m.holdcoEarnoutPaid, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.holdcoEarnoutPaid}`;
    });
    addRowRfHc('holdcoIresTaxPaid', '  (-) Imposta IRES HoldCo (24% su interessi netti e 5% dividendi) (€)', 'bold-rose', m.holdcoIresTaxPaid, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.holdcoIresTaxPaid}`;
    });
    addRowRfHc('holdcoIrapTaxPaid', '  (-) Imposta IRAP HoldCo (3,9% su Valore Produzione Netta) (€)', 'bold-rose', m.holdcoIrapTaxPaid, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.holdcoIrapTaxPaid}`;
    });
    addRowRfHc('holdcoNetProfit', 'UTILE NETTO HOLDING CIVILISTICO (€)', 'bold', m.holdcoNetProfit, numberFormatEuro, (col) => {
        return `'CONTO ECONOMICO HOLDING'!${col}${rowMapCeHc.holdcoNetProfit}`;
    });

    // 2. RETTIFICHE PATRIMONIALI E CASSA ORDINARIA
    addRowRfHc('hc_reconcileLoanRepayment', '  (+) Rimborso Capitale Finanziamento Soci (Cassa Patrimoniale) (€)', 'plus', m.holdcoLoanRepaymentReceived, numberFormatEuro, (col) => {
        return `${col}${rowMapRfHc.hc_holdcoLoanRepaymentReceived}`;
    });
    if (hasCapitalReserve) {
        addRowRfHc('hc_reconcileCapitalReserve', '  (+) Restituzione Riserve di Capitale SPV (Cassa Patrimoniale) (€)', 'plus', m.holdcoCapitalReserveReceived, numberFormatEuro, (col) => {
            return `${col}${rowMapRfHc.hc_holdcoCapitalReserveReceived}`;
        });
    }
    addRowRfHc('holdcoOperatingCashflow', '(=) CASSA GENERATA DALLA GESTIONE ORDINARIA HOLDING (€)', 'bold', m.holdcoOperatingCashflow, numberFormatEuro, (col) => {
        let f = `${col}${rowMapRfHc.holdcoNetProfit}+${col}${rowMapRfHc.hc_reconcileLoanRepayment}`;
        if (rowMapRfHc.hc_reconcileCapitalReserve) f += `+${col}${rowMapRfHc.hc_reconcileCapitalReserve}`;
        return f;
    });

    if (window.State.inputs.pdEnabled) {
        sheetRfHc.addRow([]); currentRowNumRfHc++;
        addRowRfHc('sec_pd_service_holdco', 'SERVIZIO PRIVATE DEBT (HOLDING LEVEL)', 'section-title');
        addRowRfHc('pdInterestPaid', '  (-) Interessi Private Debt Pagati dalla Holding (€)', 'minus', m.pdInterestPaid, numberFormatEuro, (col) => {
            return `'AMMORTAMENTO'!${col}${rowMapDebt['interestPaidPd']}`;
        });
        addRowRfHc('pdPrincipalPaid', '  (-) Quota Capitale Private Debt Holding (Ammortamento) (€)', 'minus', m.pdPrincipalPaid, numberFormatEuro, (col) => {
            return `'AMMORTAMENTO'!${col}${rowMapDebt['principalPaidPd']}`;
        });
    }

    sheetRfHc.addRow([]); currentRowNumRfHc++;

    // 3. FLUSSO DA DISMISSIONE INVESTIMENTO (EXIT SPV)
    addRowRfHc('exitValuationGroup', 'FLUSSO DA DISMISSIONE INVESTIMENTO (EXIT SPV) (€)', 'group-header', m.exitNetProceedsRow, numberFormatEuro, (col) => {
        let formula = `${col}${rowMapRfHc.exitEnterpriseValue}+${col}${rowMapRfHc.exitDebtPayoff}`;
        if (rowMapRfHc.peExitShare) formula += `+${col}${rowMapRfHc.peExitShare}`;
        if (rowMapRfHc.afExitCost) formula += `+${col}${rowMapRfHc.afExitCost}`;
        formula += `+${col}${rowMapRfHc.exitPexTaxRow}`;
        return formula;
    });

    addRowRfHc('exitEnterpriseValue', '  di cui: Enterprise Value di Exit (€)', 'detail', m.exitEnterpriseValue, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yr = yearIdx;
        const fMwp = `'FINANZA'!$B$${rowMapFin['exitValuePerMwp']} * ('DRIVER OPERATIVI'!${col}${rowMap['totKwp']} / 1000)`;
        const fMultiple = `'CONTO ECONOMICO'!${col}${rowMapCe.ebitda} * 'FINANZA'!$B$${rowMapFin['exitMultiple']}`;
        const fFixed = `'FINANZA'!$B$${rowMapFin['exitEnterpriseValue']}`;
        const fCalc = `IF('FINANZA'!$B$${rowMapFin['exitOption']}="Multiplo EBITDA", ${fMultiple}, IF('FINANZA'!$B$${rowMapFin['exitOption']}="Valore per MWp", ${fMwp}, ${fFixed}))`;
        return `IF(OR(${yr}='FINANZA'!$B$${rowMapFin['exitYear']}, ${yr}=VALUE('FINANZA'!$B$${rowMapFin['exitYear']})), ${fCalc}, 0)`;
    });
    addRowRfHc('exitDebtPayoff', '  (-) di cui: Rimborso Debito Residuo Mutuo Bancario (€)', 'detail', m.exitDebtPayoff, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yr = yearIdx;
        return `IF(OR(${yr}='FINANZA'!$B$${rowMapFin['exitYear']}, ${yr}=VALUE('FINANZA'!$B$${rowMapFin['exitYear']})), -('AMMORTAMENTO'!${col}${rowMapDebt['endingBalance']}), 0)`;
    });
    if (window.State.inputs.peEnabled) {
        addRowRfHc('peExitShare', '  (-) di cui: Quota Exit Private Equity (Partner Esterno) (€)', 'detail', m.peExitShare, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return '0';
            const yr = yearIdx;
            return `IF(OR(${yr}='FINANZA'!$B$${rowMapFin['exitYear']}, ${yr}=VALUE('FINANZA'!$B$${rowMapFin['exitYear']})), -MIN(MAX(0, ${col}${rowMapRfHc.exitEnterpriseValue}+${col}${rowMapRfHc.exitDebtPayoff}), 'FINANZA'!$B$${rowMapFin['peAmountValue']}*'FINANZA'!$B$${rowMapFin['peExitMultiple']}), 0)`;
        });
    }
    if (window.State.inputs.afEnabled) {
        addRowRfHc('afExitCost', '  (-) di cui: Costo Exit Altra Forma (Success Fee/Warrant/Convertibile) (€)', 'detail', m.afExitCost, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return '0';
            const yr = yearIdx;
            return `IF(OR(${yr}='FINANZA'!$B$${rowMapFin['exitYear']}, ${yr}=VALUE('FINANZA'!$B$${rowMapFin['exitYear']})), -MIN(${col}${rowMapRfHc.exitEnterpriseValue}*'FINANZA'!$B$${rowMapFin['afExitPct']}, MAX(0, ${col}${rowMapRfHc.exitEnterpriseValue}+${col}${rowMapRfHc.exitDebtPayoff})), 0)`;
        });
    }
    addRowRfHc('exitPexTaxRow', '  (-) di cui: Imposte PEX su Plusvalenza Exit (€)', 'detail', m.exitPexTaxRow, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yr = yearIdx;
        let equitySponsor = `${col}${rowMapRfHc.exitEnterpriseValue}+${col}${rowMapRfHc.exitDebtPayoff}`;
        if (rowMapRfHc.peExitShare) equitySponsor += `+${col}${rowMapRfHc.peExitShare}`;
        if (rowMapRfHc.afExitCost) equitySponsor += `+${col}${rowMapRfHc.afExitCost}`;
        const fPex = `-ROUND(MAX(0, (${equitySponsor}) - 'FINANZA'!$B$${rowMapFin['equity']}) * 0.05 * 'DRIVER OPERATIVI'!$B$${rowMap.iresRateConst}, 0)`;
        return `IF(OR(${yr}='FINANZA'!$B$${rowMapFin['exitYear']}, ${yr}=VALUE('FINANZA'!$B$${rowMapFin['exitYear']})), ${fPex}, 0)`;
    });

    if (window.State.inputs.pdEnabled) {
        sheetRfHc.addRow([]); currentRowNumRfHc++;
        addRowRfHc('sec_pd_payoff_holdco', 'PAYOFF PRIVATE DEBT (HOLDING LEVEL) A EXIT', 'section-title');
        addRowRfHc('pdBulletPayoff', '  (-) Payoff Private Debt (Bullet/Residuo) dalla cassa Holding (€)', 'minus', m.pdBulletPayoff, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx + 1 === numYears) {
                return `'AMMORTAMENTO'!${col}${rowMapDebt['bulletPayoffPd']}`;
            }
            return '0';
        });
        addRowRfHc('exitLimitedLiability', '  (+) Limited Liability Holding / Debt Forgiveness PD (se cassa < saldo) (€)', 'plus', m.exitLimitedLiability, numberFormatEuro);
    }

    sheetRfHc.addRow([]); currentRowNumRfHc++;

    // 4. FCFE — FLUSSO NETTO INVESTITORE
    addRowRfHc('holdcoFCFE', '(=) FCFE — FLUSSO NETTO INVESTITORE (€)', 'total-gold', m.holdcoFCFE, numberFormatEuro, (col) => {
        let formula = `${col}${rowMapRfHc.holdcoOperatingCashflow}`;
        if (rowMapRfHc.pdPrincipalPaid) formula += `+${col}${rowMapRfHc.pdPrincipalPaid}`;
        if (rowMapRfHc.pdInterestPaid) formula += `+${col}${rowMapRfHc.pdInterestPaid}`;
        formula += `+${col}${rowMapRfHc.exitValuationGroup}`;
        if (rowMapRfHc.pdBulletPayoff) formula += `+${col}${rowMapRfHc.pdBulletPayoff}`;
        if (rowMapRfHc.exitLimitedLiability) formula += `+${col}${rowMapRfHc.exitLimitedLiability}`;
        return formula;
    });

    addRowRfHc('holdcoFCFECumulated', 'FCFE CUMULATO INVESTITORE (€)', 'total-gold', m.holdcoFCFECumulated, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) {
            return `${col}${rowMapRfHc.holdcoFCFE}`;
        } else {
            const prevCol = getColLetter(yearIdx + 1);
            return `${prevCol}${rowMapRfHc.holdcoFCFECumulated}+${col}${rowMapRfHc.holdcoFCFE}`;
        }
    });

    // ---------------------------------------------------------
    // FOGLIO FINANZA
    // ---------------------------------------------------------
    const sheetFin = workbook.addWorksheet('FINANZA', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }] });
    sheetFin.columns = [
        { header: 'PARAMETRI E STRUTTURA FINANZIARIA', key: 'label', width: 52 },
        { header: 'Valore', key: 'val', width: 26 },
        { header: '%', key: 'pct', width: 16 }
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
            row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        } else {
            row.getCell(1).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
            row.getCell(2).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
            row.getCell(3).border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        }
        currentRowFin++;
        return row;
    }

    const paramsFin = window.State.inputs;
    const resultsFin = window.State.results || {};
    
    // --- 1. TASSI E RENDIMENTI (MACRO) ---
    addFinRow('hdrTassi', '1. TASSI, INFLAZIONE & FISCALITÀ (MACRO)', true, true);
    
    addFinRow('keVal', 'Ke Valutativo (Cost of Equity)');
    sheetFin.getCell(`B${rowMapFin['keVal']}`).value = paramsFin.keVal !== undefined ? paramsFin.keVal : 0.08;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['keVal']}`), numberFormatPct);

    addFinRow('wacc', 'WACC (Weighted Average Cost of Capital)');
    sheetFin.getCell(`B${rowMapFin['wacc']}`).value = paramsFin.wacc !== undefined ? paramsFin.wacc : 0.06;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['wacc']}`), numberFormatPct);

    addFinRow('inflation', 'Inflazione Media Attesa');
    sheetFin.getCell(`B${rowMapFin['inflation']}`).value = paramsFin.inflation !== undefined ? paramsFin.inflation : 0.02;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['inflation']}`), numberFormatPct);

    addFinRow('fiscalDeprRate', 'Tasso di Ammortamento Fiscale');
    sheetFin.getCell(`B${rowMapFin['fiscalDeprRate']}`).value = paramsFin.fiscalDeprRate !== undefined ? paramsFin.fiscalDeprRate : 0.09;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['fiscalDeprRate']}`), numberFormatPct);

    addFinRow('iresRate', 'Aliquota IRES (%)');
    sheetFin.getCell(`B${rowMapFin['iresRate']}`).value = paramsFin.iresRate !== undefined ? paramsFin.iresRate : 0.24;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['iresRate']}`), numberFormatPct);

    addFinRow('irapRate', 'Aliquota IRAP (%)');
    sheetFin.getCell(`B${rowMapFin['irapRate']}`).value = paramsFin.irapRate !== undefined ? paramsFin.irapRate : 0.039;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['irapRate']}`), numberFormatPct);

    addFinRow('vatSettlement', 'Regime Liquidazione IVA');
    const vatSettlementLabel = paramsFin.vatSettlement === 'trimestrale' ? 'Trimestrale' : 'Mensile';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['vatSettlement']}`), ['Mensile', 'Trimestrale'], vatSettlementLabel);

    addFinRow('vatRefundEnabled', 'Istanza Rimborso Modello IVA TR');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['vatRefundEnabled']}`), ['SÌ', 'NO'], (paramsFin.vatRefundEnabled !== false && paramsFin.vatQuarterlyRefund !== false) ? 'SÌ' : 'NO');

    sheetFin.addRow([]); currentRowFin++;

    // --- 2. STRUTTURA DEL DEBITO SENIOR & CASH SWEEP ---
    addFinRow('hdrDebito', '2. STRUTTURA DEL DEBITO SENIOR & CASH SWEEP', true, true);

    addFinRow('leverage', 'Leverage (D/E Ratio Target)');
    sheetFin.getCell(`B${rowMapFin['leverage']}`).value = paramsFin.leverage !== undefined ? paramsFin.leverage : 0.75;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['leverage']}`), numberFormatPct);
    
    addFinRow('interestRate', 'Tasso Interesse Debito Senior');
    sheetFin.getCell(`B${rowMapFin['interestRate']}`).value = paramsFin.interestRate !== undefined ? paramsFin.interestRate : 0.045;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['interestRate']}`), numberFormatPct);

    addFinRow('debtBasis', 'Base di Computo Debito Senior');
    const debtBasisLabels = {
        'hard_costs': 'Solo Hard Costs (EPC FV + BESS + Connessione)',
        'ev_ex_spv': 'CAPEX al netto Costo SPV (Hard Costs + Sviluppo)',
        'total_capex': 'Costo Totale di Progetto (CAPEX Totale)',
        'enterprise_value': 'Costo Totale di Progetto (CAPEX Totale)'
    };
    const defaultDebtBasis = debtBasisLabels[paramsFin.debtBasis] || 'Costo Totale di Progetto (CAPEX Totale)';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['debtBasis']}`), [
        'Solo Hard Costs (EPC FV + BESS + Connessione)',
        'CAPEX al netto Costo SPV (Hard Costs + Sviluppo)',
        'Costo Totale di Progetto (CAPEX Totale)'
    ], defaultDebtBasis);

    addFinRow('loanTerm', 'Durata Debito Senior (Anni)');
    sheetFin.getCell(`B${rowMapFin['loanTerm']}`).value = paramsFin.loanTerm !== undefined ? paramsFin.loanTerm : 12;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['loanTerm']}`), '#,##0');

    addFinRow('debtRepaymentFrequency', 'Frequenza Rimborso Debito Senior');
    const freqLabels = {
        'semestrale': 'Semestrale',
        'trimestrale': 'Trimestrale',
        'mensile': 'Mensile',
        'annuale': 'Annuale'
    };
    const defaultFreqLabel = freqLabels[paramsFin.debtRepaymentFrequency] || 'Semestrale';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['debtRepaymentFrequency']}`), [
        'Semestrale',
        'Trimestrale',
        'Mensile',
        'Annuale'
    ], defaultFreqLabel);

    addFinRow('periodsPerYear', 'Periodi Rimborso Debito all\'Anno');
    sheetFin.getCell(`B${rowMapFin['periodsPerYear']}`).value = {
        formula: `IF(B${rowMapFin['debtRepaymentFrequency']}="Mensile", 12, IF(B${rowMapFin['debtRepaymentFrequency']}="Trimestrale", 4, IF(B${rowMapFin['debtRepaymentFrequency']}="Semestrale", 2, 1)))`
    };
    sheetFin.getCell(`B${rowMapFin['periodsPerYear']}`).numFmt = '#,##0';

    let sweepLabel = '% del CFADS';
    if (paramsFin.sweepType === 'fixed_eur') sweepLabel = '€ Fisso/Anno';
    else if (paramsFin.sweepType === 'none') sweepLabel = 'Nessuno';
    addFinRow('sweepType', 'Tipo di Cash Sweep');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['sweepType']}`), ['% del CFADS', '€ Fisso/Anno', 'Nessuno'], sweepLabel);

    addFinRow('sweepValue', paramsFin.sweepType === 'fixed_eur' ? 'Valore Cash Sweep (€)' : 'Valore Cash Sweep (%)');
    const sweepNum = paramsFin.sweepType === 'fixed_eur' ? (paramsFin.sweepValue || 0) : ((paramsFin.sweepValue || 0) / 100);
    sheetFin.getCell(`B${rowMapFin['sweepValue']}`).value = sweepNum;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sweepValue']}`), paramsFin.sweepType === 'fixed_eur' ? numberFormatEuro : numberFormatPct);

    addFinRow('sweepYears', 'Durata Cash Sweep (Anni, 0=Sempre)');
    sheetFin.getCell(`B${rowMapFin['sweepYears']}`).value = paramsFin.sweepYears || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sweepYears']}`), '#,##0');

    // --- Preammortamento, DSCR Sculpting, Refinancing ---
    addFinRow('seniorGracePeriodMonths', 'Preammortamento Senior (Mesi)');
    sheetFin.getCell(`B${rowMapFin['seniorGracePeriodMonths']}`).value = paramsFin.seniorGracePeriodMonths !== undefined ? paramsFin.seniorGracePeriodMonths : 6;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['seniorGracePeriodMonths']}`), '#,##0');

    addFinRow('constructionMonths', 'Durata Costruzione (Mesi, per IDC)');
    sheetFin.getCell(`B${rowMapFin['constructionMonths']}`).value = paramsFin.constructionMonths !== undefined ? paramsFin.constructionMonths : 6;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['constructionMonths']}`), '#,##0');

    addFinRow('idcDrawdownFactor', 'Fattore Tiraggio Medio IDC (%)');
    sheetFin.getCell(`B${rowMapFin['idcDrawdownFactor']}`).value = (paramsFin.idcDrawdownFactor !== undefined ? paramsFin.idcDrawdownFactor : 50) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['idcDrawdownFactor']}`), numberFormatPct);

    addFinRow('sculptingEnabled', 'DSCR Sculpting (Rata Sagomata)');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['sculptingEnabled']}`), ['Sì', 'No'], paramsFin.sculptingEnabled ? 'Sì' : 'No');

    addFinRow('targetDscr', 'Target DSCR Sculpting (x)');
    sheetFin.getCell(`B${rowMapFin['targetDscr']}`).value = paramsFin.targetDscr !== undefined ? paramsFin.targetDscr : 1.30;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['targetDscr']}`), '0.00"x"');

    addFinRow('refiEnabled', 'Refinancing / Miniperm Attivo');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['refiEnabled']}`), ['Sì', 'No'], paramsFin.refiEnabled ? 'Sì' : 'No');

    addFinRow('refiYear', 'Anno Refinancing');
    sheetFin.getCell(`B${rowMapFin['refiYear']}`).value = paramsFin.refiYear !== undefined ? paramsFin.refiYear : 7;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['refiYear']}`), '#,##0');

    addFinRow('refiInterestRate', 'Nuovo Tasso Refinancing (%)');
    sheetFin.getCell(`B${rowMapFin['refiInterestRate']}`).value = (paramsFin.refiInterestRate !== undefined ? paramsFin.refiInterestRate : 5.0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['refiInterestRate']}`), numberFormatPct);

    addFinRow('refiLoanTerm', 'Nuova Durata Refinancing (Anni)');
    sheetFin.getCell(`B${rowMapFin['refiLoanTerm']}`).value = paramsFin.refiLoanTerm !== undefined ? paramsFin.refiLoanTerm : 10;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['refiLoanTerm']}`), '#,##0');

    // Costanti derivate (formule dinamiche native su parametri sopra)
    const graceMonths = paramsFin.seniorGracePeriodMonths !== undefined ? paramsFin.seniorGracePeriodMonths : 0;
    const loanTermVal = paramsFin.loanTerm !== undefined ? paramsFin.loanTerm : 15;
    const graceCappedVal = Math.min(graceMonths / 12, Math.max(0, loanTermVal - 1));
    const graceFullVal = Math.floor(graceCappedVal);
    const graceFracVal = graceCappedVal - graceFullVal;
    const amortizingYearsVal = Math.max(0.1, loanTermVal - graceCappedVal);
    const activeMaturityVal = paramsFin.refiEnabled ? Math.min(20, (paramsFin.refiYear || 7) - 1 + (paramsFin.refiLoanTerm || 10)) : loanTermVal;

    addFinRow('graceCappedYears', 'Preammortamento in Anni (capped)');
    sheetFin.getCell(`B${rowMapFin['graceCappedYears']}`).value = { formula: `MIN(B${rowMapFin['seniorGracePeriodMonths']}/12, MAX(0, B${rowMapFin['loanTerm']}-1))`, result: graceCappedVal };
    sheetFin.getCell(`B${rowMapFin['graceCappedYears']}`).numFmt = '0.00';

    addFinRow('graceFullYears', 'Preammortamento - Anni Interi');
    sheetFin.getCell(`B${rowMapFin['graceFullYears']}`).value = { formula: `INT(B${rowMapFin['graceCappedYears']})`, result: graceFullVal };
    sheetFin.getCell(`B${rowMapFin['graceFullYears']}`).numFmt = '#,##0';

    addFinRow('graceFrac', 'Preammortamento - Frazione Anno');
    sheetFin.getCell(`B${rowMapFin['graceFrac']}`).value = { formula: `B${rowMapFin['graceCappedYears']}-B${rowMapFin['graceFullYears']}`, result: graceFracVal };
    sheetFin.getCell(`B${rowMapFin['graceFrac']}`).numFmt = '0.00';

    addFinRow('amortizingYears', 'Anni Effettivi Ammortamento');
    sheetFin.getCell(`B${rowMapFin['amortizingYears']}`).value = { formula: `MAX(0.1, B${rowMapFin['loanTerm']}-B${rowMapFin['graceCappedYears']})`, result: amortizingYearsVal };
    sheetFin.getCell(`B${rowMapFin['amortizingYears']}`).numFmt = '0.00';

    addFinRow('activeMaturity', 'Scadenza Effettiva Debito Senior');
    sheetFin.getCell(`B${rowMapFin['activeMaturity']}`).value = { formula: `IF(B${rowMapFin['refiEnabled']}="Sì", MIN(20, B${rowMapFin['refiYear']}-1+B${rowMapFin['refiLoanTerm']}), B${rowMapFin['loanTerm']})`, result: activeMaturityVal };
    sheetFin.getCell(`B${rowMapFin['activeMaturity']}`).numFmt = '#,##0';

    addFinRow('y1OperatingAvail', 'Frazione Operativa Anno 1 post-COD (%)');
    const y1AvailVal = (resultsFin && resultsFin.y1OperatingAvail !== undefined) ? resultsFin.y1OperatingAvail : 1.0;
    sheetFin.getCell(`B${rowMapFin['y1OperatingAvail']}`).value = y1AvailVal;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['y1OperatingAvail']}`), numberFormatPct);

    sheetFin.addRow([]); currentRowFin++;

    // --- 3. FINANZIAMENTO SOCI E HOLDING ---
    addFinRow('hdrSoci', '3. FINANZIAMENTO SOCI E CONDIZIONI HOLDING', true, true);

    addFinRow('sociEquityPct', 'Quota Equity Finanziata dai Soci (Complessiva %)');
    const sociEqNum = (paramsFin.sociEquityPct !== undefined ? paramsFin.sociEquityPct : 100) / 100;
    sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`).value = sociEqNum;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`), numberFormatPct);
    
    addFinRow('sociInterestRate', 'Tasso Interesse Finanziamento Soci');
    sheetFin.getCell(`B${rowMapFin['sociInterestRate']}`).value = (paramsFin.sociInterestRate || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sociInterestRate']}`), numberFormatPct);

    addFinRow('sociInterestGrace', 'Preammortamento Interessi Soci (Anni)');
    sheetFin.getCell(`B${rowMapFin['sociInterestGrace']}`).value = paramsFin.sociInterestGrace || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sociInterestGrace']}`), '#,##0');

    addFinRow('sociPrincipalGrace', 'Preammortamento Capitale Soci (Anni)');
    sheetFin.getCell(`B${rowMapFin['sociPrincipalGrace']}`).value = paramsFin.sociPrincipalGrace || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sociPrincipalGrace']}`), '#,##0');

    addFinRow('sociLoanTerm', 'Durata Rimborso Capitale Soci (Anni)');
    sheetFin.getCell(`B${rowMapFin['sociLoanTerm']}`).value = paramsFin.sociLoanTerm !== undefined ? paramsFin.sociLoanTerm : 10;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['sociLoanTerm']}`), '#,##0');

    sheetFin.addRow([]); currentRowFin++;

    // --- 4. PRIVATE DEBT (MEZZANINE SPV) ---
    addFinRow('hdrPd', '4. PRIVATE DEBT — MEZZANINE ESTERNA SPV', true, true);
    addFinRow('pdEnabled', 'Private Debt Attivo');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['pdEnabled']}`), ['SÌ', 'NO'], paramsFin.pdEnabled ? 'SÌ' : 'NO');

    addFinRow('pdAmountType', 'Modalità Importo Private Debt');
    const pdAmtTypeLabel = paramsFin.pdAmountType === 'pct_bankable' ? '% Base Finanziabile' : (paramsFin.pdAmountType === 'pct_totusi' ? '% Totale Fabbisogno' : 'Importo Fisso (€)');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['pdAmountType']}`), ['% Base Finanziabile', '% Totale Fabbisogno', 'Importo Fisso (€)'], pdAmtTypeLabel);

    addFinRow('pdAmountValue', 'Valore Importo Private Debt');
    sheetFin.getCell(`B${rowMapFin['pdAmountValue']}`).value = paramsFin.pdAmountValue || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pdAmountValue']}`), (paramsFin.pdAmountType === 'fixed_eur') ? numberFormatEuro : numberFormatPct);

    addFinRow('pdInterestRate', 'Tasso Interesse Private Debt');
    sheetFin.getCell(`B${rowMapFin['pdInterestRate']}`).value = (paramsFin.pdInterestRate || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pdInterestRate']}`), numberFormatPct);

    addFinRow('pdMode', 'Modalità Rimborso Private Debt');
    const pdModeLabel = paramsFin.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (paramsFin.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['pdMode']}`), ['Bullet a Exit (PIK Composto)', 'Ammortamento Rateale', 'Interessi Annuari + Capitale'], pdModeLabel);

    addFinRow('pdInterestGrace', 'Grazia Interessi Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdInterestGrace']}`).value = paramsFin.pdInterestGrace || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pdInterestGrace']}`), '#,##0');

    addFinRow('pdPrincipalGrace', 'Grazia Capitale Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdPrincipalGrace']}`).value = paramsFin.pdPrincipalGrace || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pdPrincipalGrace']}`), '#,##0');

    addFinRow('pdLoanTerm', 'Durata Private Debt (Anni)');
    sheetFin.getCell(`B${rowMapFin['pdLoanTerm']}`).value = paramsFin.pdLoanTerm || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pdLoanTerm']}`), '#,##0');

    addFinRow('pdTaxDeductible', 'Interessi PD Deducibili Fiscalmente');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['pdTaxDeductible']}`), ['SÌ', 'NO'], paramsFin.pdTaxDeductible ? 'SÌ' : 'NO');

    addFinRow('pdWaterfallRank', 'Posizione Waterfall Private Debt');
    const pdRankLabel = paramsFin.pdWaterfallRank === 'after_soci' ? 'Dopo Soci (più subordinato)' : 'Dopo Senior, prima Soci';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['pdWaterfallRank']}`), ['Dopo Senior, prima Soci', 'Dopo Soci (più subordinato)'], pdRankLabel);

    sheetFin.addRow([]); currentRowFin++;

    // --- 5. PRIVATE EQUITY (CO-INVESTITORE SPV) ---
    addFinRow('hdrPe', '5. PRIVATE EQUITY — CO-INVESTITORE ESTERNO SPV', true, true);
    addFinRow('peEnabled', 'Private Equity Attivo');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['peEnabled']}`), ['SÌ', 'NO'], paramsFin.peEnabled ? 'SÌ' : 'NO');

    addFinRow('peAmountType', 'Modalità Importo Private Equity');
    const peAmtTypeLabel = paramsFin.peAmountType === 'pct_equity' ? '% Equity Totale' : 'Importo Fisso (€)';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['peAmountType']}`), ['% Equity Totale', 'Importo Fisso (€)'], peAmtTypeLabel);

    addFinRow('peAmountValue', 'Valore Importo Private Equity');
    sheetFin.getCell(`B${rowMapFin['peAmountValue']}`).value = paramsFin.peAmountValue || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['peAmountValue']}`), (paramsFin.peAmountType === 'fixed_eur') ? numberFormatEuro : numberFormatPct);

    addFinRow('peMode', 'Struttura Remunerazione PE');
    const peModeLabel = { dividend_share: 'Quote Dividendi Proporzionale', preferred_return: 'Preferred Return (Hurdle Composto)', bullet_exit: 'Bullet a Exit (Multiplo Garantito)', royalty_fee: 'Royalty % Ricavi (Parasociale)' }[paramsFin.peMode] || 'Quote Dividendi Proporzionale';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['peMode']}`), ['Quote Dividendi Proporzionale', 'Preferred Return (Hurdle Composto)', 'Bullet a Exit (Multiplo Garantito)', 'Royalty % Ricavi (Parasociale)'], peModeLabel);

    addFinRow('peHurdleRate', 'Hurdle Rate PE (composto)');
    sheetFin.getCell(`B${rowMapFin['peHurdleRate']}`).value = (paramsFin.peHurdleRate || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['peHurdleRate']}`), numberFormatPct);

    addFinRow('pePreferredPct', '% Dividendi Preferred PE');
    sheetFin.getCell(`B${rowMapFin['pePreferredPct']}`).value = (paramsFin.pePreferredPct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['pePreferredPct']}`), numberFormatPct);

    addFinRow('peExitMultiple', 'Multiplo Exit Garantito PE (x)');
    sheetFin.getCell(`B${rowMapFin['peExitMultiple']}`).value = paramsFin.peExitMultiple || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['peExitMultiple']}`), '0.00"x"');

    addFinRow('peRoyaltyPct', 'Royalty % Ricavi PE');
    sheetFin.getCell(`B${rowMapFin['peRoyaltyPct']}`).value = (paramsFin.peRoyaltyPct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['peRoyaltyPct']}`), numberFormatPct);

    addFinRow('peParticipatesExit', 'PE Partecipa Exit Equity Value');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['peParticipatesExit']}`), ['SÌ', 'NO'], paramsFin.peParticipatesExit ? 'SÌ' : 'NO');

    sheetFin.addRow([]); currentRowFin++;

    // --- 6. ALTRA FORMA (PARASOCIALE/CONVERTIBILE) ---
    addFinRow('hdrAf', '6. ALTRA FORMA — ACCORDI PARASOCIALI/STATUTARI/CONVERTIBILI', true, true);
    addFinRow('afEnabled', 'Altra Forma Attiva');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['afEnabled']}`), ['SÌ', 'NO'], paramsFin.afEnabled ? 'SÌ' : 'NO');

    addFinRow('afType', 'Tipo Accordo Altra Forma');
    const afTypeLabel = { advisory_fee: 'Advisory Fee Annuo', success_fee_exit: 'Success Fee a Exit (% EV)', warrant_kicker: 'Warrant Kicker (% Equity Exit)', convertible_note: 'Convertibile (PIK + %EV)' }[paramsFin.afType] || 'Advisory Fee Annuo';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['afType']}`), ['Advisory Fee Annuo', 'Success Fee a Exit (% EV)', 'Warrant Kicker (% Equity Exit)', 'Convertibile (PIK + %EV)'], afTypeLabel);

    addFinRow('afAnnualAmount', 'Importo Annuo Advisory (€)');
    sheetFin.getCell(`B${rowMapFin['afAnnualAmount']}`).value = paramsFin.afAnnualAmount || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afAnnualAmount']}`), numberFormatEuro);

    addFinRow('afRevenuePct', 'Quota % Ricavi Advisory');
    sheetFin.getCell(`B${rowMapFin['afRevenuePct']}`).value = (paramsFin.afRevenuePct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afRevenuePct']}`), numberFormatPct);

    addFinRow('afExitPct', 'Success Fee % EV');
    sheetFin.getCell(`B${rowMapFin['afExitPct']}`).value = (paramsFin.afExitPct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afExitPct']}`), numberFormatPct);

    addFinRow('afWarrantPct', 'Warrant % Equity Exit');
    sheetFin.getCell(`B${rowMapFin['afWarrantPct']}`).value = (paramsFin.afWarrantPct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afWarrantPct']}`), numberFormatPct);

    addFinRow('afConvertibleAmount', 'Importo Convertibile (€)');
    sheetFin.getCell(`B${rowMapFin['afConvertibleAmount']}`).value = paramsFin.afConvertibleAmount || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afConvertibleAmount']}`), numberFormatEuro);

    addFinRow('afConvertibleRate', 'Tasso PIK Composto Convertibile');
    sheetFin.getCell(`B${rowMapFin['afConvertibleRate']}`).value = (paramsFin.afConvertibleRate || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afConvertibleRate']}`), numberFormatPct);

    addFinRow('afConvertiblePct', 'Partecipazione % EV Convertibile');
    sheetFin.getCell(`B${rowMapFin['afConvertiblePct']}`).value = (paramsFin.afConvertiblePct || 0) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['afConvertiblePct']}`), numberFormatPct);

    addFinRow('afTaxDeductible', 'Costo/Interessi AF Deducibili SPV');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['afTaxDeductible']}`), ['SÌ', 'NO'], paramsFin.afTaxDeductible ? 'SÌ' : 'NO');

    sheetFin.addRow([]); currentRowFin++;

    // --- 7. VALUTAZIONE DI EXIT & LIQUIDITÀ ---
    addFinRow('hdrExit', '7. STRATEGIA DI EXIT & VALUTAZIONE ASSET', true, true);
    addFinRow('holdcoCapital2', 'Capitale Iniziale Holding (€)');
    sheetFin.getCell(`B${rowMapFin['holdcoCapital2']}`).value = paramsFin.holdcoCapital !== undefined ? paramsFin.holdcoCapital : 10000;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['holdcoCapital2']}`), numberFormatEuro);

    // Anno di Uscita (0 = Nessun Exit, 1..20) con convalida dati da elenco
    let exitYearNum = (paramsFin.exitOption && !isNaN(parseInt(paramsFin.exitOption))) ? parseInt(paramsFin.exitOption) : 20;
    if (exitYearNum === 0 && ((paramsFin.exitValuePerMwp || 0) > 0 || (paramsFin.exitEnterpriseValue || 0) > 0)) {
        if (paramsFin.exitOption === undefined || paramsFin.exitOption === null || paramsFin.exitOption === '' || paramsFin.exitOption === 'none') {
            exitYearNum = 20;
        }
    }
    addFinRow('exitYear', 'Anno di Uscita (Exit Year)');
    const cellExitYr = sheetFin.getCell(`B${rowMapFin['exitYear']}`);
    const exitYearOptions = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    applyListValidation(cellExitYr, exitYearOptions, String(exitYearNum));

    // Metodologia di Valutazione Exit
    let exitMethodLabel = 'Valore per MWp';
    if ((paramsFin.exitValuePerMwp || 0) > 0) {
        exitMethodLabel = 'Valore per MWp';
    } else if ((paramsFin.exitEnterpriseValue || 0) > 0) {
        exitMethodLabel = 'Enterprise Value Fissa';
    } else if (paramsFin.exitOption === 'custom_multiple') {
        exitMethodLabel = 'Multiplo EBITDA';
    } else if (paramsFin.exitOption === 'custom_ev') {
        exitMethodLabel = 'Enterprise Value Fissa';
    } else if (paramsFin.exitOption === 'custom_mwp') {
        exitMethodLabel = 'Valore per MWp';
    } else {
        exitMethodLabel = 'Multiplo EBITDA';
    }

    addFinRow('exitOption', 'Opzione di Uscita (Exit Strategy)');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['exitOption']}`), ['Valore per MWp', 'Enterprise Value Fissa', 'Multiplo EBITDA'], exitMethodLabel);

    // Multiplo EBITDA: calcola il multiplo implicito o default se <= 0
    let multipleVal = parseFloat(paramsFin.exitMultiple) || 0;
    if (multipleVal <= 0) {
        const exitYrIdx = (exitYearNum > 0 && exitYearNum <= 20) ? exitYearNum - 1 : 19;
        const ebitdaExit = (m && m.ebitda && m.ebitda[exitYrIdx]) || 0;
        const targetEv = paramsFin.exitEnterpriseValue || ((paramsFin.exitValuePerMwp || 0) * (totalKwp / 1000));
        if (ebitdaExit > 0 && targetEv > 0) {
            multipleVal = targetEv / ebitdaExit;
        } else {
            multipleVal = 8.0;
        }
    }
    addFinRow('exitMultiple', 'Multiplo EBITDA di Uscita (x)');
    sheetFin.getCell(`B${rowMapFin['exitMultiple']}`).value = Math.round(multipleVal * 100) / 100;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['exitMultiple']}`), '0.00"x"');

    addFinRow('exitValuePerMwp', 'Valutazione di Uscita per MWp (€)');
    sheetFin.getCell(`B${rowMapFin['exitValuePerMwp']}`).value = paramsFin.exitValuePerMwp || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['exitValuePerMwp']}`), numberFormatEuro);

    // Valutazione Enterprise Value Fissa
    let evVal = paramsFin.exitEnterpriseValue || 0;
    if (evVal === 0 && (paramsFin.exitValuePerMwp || 0) > 0) {
        evVal = (paramsFin.exitValuePerMwp || 0) * (totalKwp / 1000);
    }
    addFinRow('exitEnterpriseValue', 'Valutazione Enterprise Value Fissa (€)');
    sheetFin.getCell(`B${rowMapFin['exitEnterpriseValue']}`).value = evVal;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['exitEnterpriseValue']}`), numberFormatEuro);

    sheetFin.addRow([]); currentRowFin++;

    // --- 8. SCENARI PREZZI E VINCOLI DISTRIBUTIVI ---
    addFinRow('hdrScenari', '8. SCENARI PREZZI E VINCOLI DISTRIBUTIVI', true, true);

    addFinRow('priceScenarioType', 'Scenario Curve di Prezzo');
    const priceScenLabel = paramsFin.priceScenarioType === 'bull' 
        ? 'Rialzista (+20%)' 
        : ((paramsFin.priceScenarioType === 'bear' || paramsFin.priceScenarioType === 'bearish_floor') 
            ? 'Ribassista (Decadimento)' 
            : 'Caso Base (PUN GME)');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['priceScenarioType']}`), ['Caso Base (PUN GME)', 'Rialzista (+20%)', 'Ribassista (Decadimento)'], priceScenLabel);

    addFinRow('punZonalFloor', 'Prezzo Floor Minimo ZONALE (€/MWh)');
    sheetFin.getCell(`B${rowMapFin['punZonalFloor']}`).value = paramsFin.punZonalFloor || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['punZonalFloor']}`), numberFormatEuro);

    addFinRow('punBearishDecayRate', 'Tasso Decadimento Bearish Annuo (%)');
    sheetFin.getCell(`B${rowMapFin['punBearishDecayRate']}`).value = paramsFin.punBearishDecayRate || 0;
    applyInputStyle(sheetFin.getCell(`B${rowMapFin['punBearishDecayRate']}`), numberFormatPct);

    addFinRow('dividendLock', 'Blocco Dividendi Fino Estinzione Debito');
    applyListValidation(sheetFin.getCell(`B${rowMapFin['dividendLock']}`), ['SÌ', 'NO'], paramsFin.dividendLock ? 'SÌ' : 'NO');

    addFinRow('distributionPolicy', 'Politica Distribuzione Dividendi SPV');
    const polLabels = {
        'cash_flow_driven': 'FCFE Puro (Cash Flow Driven)',
        'civil_statutory_strict': 'Utile Civilistico Rigido (Art. 2433 c.c. con Riserva Legale 5%)',
        'civil_with_capital_reserve_return': 'Utile Civilistico + Restituzione Riserve Capitale (Art. 2482 c.c.)'
    };
    const distPolLabel = polLabels[paramsFin.distributionPolicy] || 'FCFE Puro (Cash Flow Driven)';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['distributionPolicy']}`), [
        'FCFE Puro (Cash Flow Driven)',
        'Utile Civilistico Rigido (Art. 2433 c.c. con Riserva Legale 5%)',
        'Utile Civilistico + Restituzione Riserve Capitale (Art. 2482 c.c.)'
    ], distPolLabel);

    addFinRow('cashTrapDeployment', 'Impiego Cassa Vincolata SPV (Cash Trap)');
    const trapLabels = {
        'bank_locked': 'Blocco Conservativo a Garanzia Debito',
        'distribute_on_profits': 'Distribuzione su Utili Capienti',
        'debt_free_release': 'Sblocco a Estinzione Debito Senior',
        'soci_loan_accelerated': 'Rimborso Accelerato Finanziamento Soci',
        'senior_debt_prepayment': 'Prepagamento Debito Senior'
    };
    const trapLabel = trapLabels[paramsFin.cashTrapDeployment] || 'Blocco Conservativo a Garanzia Debito';
    applyListValidation(sheetFin.getCell(`B${rowMapFin['cashTrapDeployment']}`), [
        'Blocco Conservativo a Garanzia Debito',
        'Distribuzione su Utili Capienti',
        'Sblocco a Estinzione Debito Senior',
        'Rimborso Accelerato Finanziamento Soci',
        'Prepagamento Debito Senior'
    ], trapLabel);

    sheetFin.addRow([]); currentRowFin++;

    // --- 9. TOTALE USI E BASE FINANZIABILE (100% FORMULE DINAMICHE) ---
    addFinRow('usi', '9. TOTALE USI E BASE FINANZIABILE', true, true);
    addFinRow('capexUsi', 'Costo Totale Progetto (CAPEX)', true);
    const capexTotColLetter = getColLetter(m.capexBreakdown ? m.capexBreakdown.length + 2 : 2);
    sheetFin.getCell(`B${rowMapFin['capexUsi']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['totalCapex']}`, result: m.capexTotal || 0 };
    sheetFin.getCell(`B${rowMapFin['capexUsi']}`).numFmt = numberFormatEuro;

    addFinRow('spvCost', 'Costo Acquisizione SPV (Da escludere se base ev_ex_spv)');
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['spv']}`, result: m.capexSpvAcquisition || 0 };
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).numFmt = numberFormatEuro;

    addFinRow('holdcoUsi', 'Capitale Sociale HoldCo (Da versare)');
    sheetFin.getCell(`B${rowMapFin['holdcoUsi']}`).value = { formula: `B${rowMapFin['holdcoCapital2']}`, result: p.holdcoCapital || 0 };
    sheetFin.getCell(`B${rowMapFin['holdcoUsi']}`).numFmt = numberFormatEuro;

    addFinRow('totUsi', 'TOTALE FABBISOGNO (Usi)', true);
    const totUsiVal = (m.capexTotal || 0) + (p.holdcoCapital || 0);
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).value = { formula: `B${rowMapFin['capexUsi']} + B${rowMapFin['holdcoUsi']}`, result: totUsiVal };
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).value = 1;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).numFmt = numberFormatPct;

    addFinRow('debtBasisEcho', 'Criterio di Computo Debito Senior (da Sez. 2)');
    sheetFin.getCell(`B${rowMapFin['debtBasisEcho']}`).value = { formula: `B${rowMapFin['debtBasis']}`, result: p.debtBasis || '' };

    addFinRow('bankableBase', 'Base Finanziabile Effettiva');
    const fHardCosts = `CAPEX!${capexTotColLetter}${rowMapCapex['solar']} + CAPEX!${capexTotColLetter}${rowMapCapex['bess']} + CAPEX!${capexTotColLetter}${rowMapCapex['connection']}`;
    const fEvExSpv = `B${rowMapFin['capexUsi']} - B${rowMapFin['spvCost']}`;
    const fTotCapex = `B${rowMapFin['capexUsi']}`;
    sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = {
        formula: `IF(B${rowMapFin['debtBasis']}="Solo Hard Costs (EPC FV + BESS + Connessione)", ${fHardCosts}, IF(B${rowMapFin['debtBasis']}="CAPEX al netto Costo SPV (Hard Costs + Sviluppo)", ${fEvExSpv}, ${fTotCapex}))`,
        result: m.bankableBase || 0
    };
    sheetFin.getCell(`B${rowMapFin['bankableBase']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;

    // --- 10. TOTALE FONTI (COPERTURE — 100% FORMULE DINAMICHE) ---
    addFinRow('fonti', '10. TOTALE FONTI (Coperture)', true, true);
    
    // DEBITO SENIOR
    addFinRow('debt', 'Debito Bancario (Senior Loan)');
    sheetFin.getCell(`B${rowMapFin['debt']}`).value = { formula: `IF(B${rowMapFin['loanTerm']} > 0, B${rowMapFin['bankableBase']} * B${rowMapFin['leverage']}, 0)`, result: m.debt || 0 };
    sheetFin.getCell(`B${rowMapFin['debt']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['debt']}`).value = { formula: `IFERROR(B${rowMapFin['debt']} / B${rowMapFin['totUsi']}, 0)`, result: totUsiVal > 0 ? (m.debt || 0) / totUsiVal : 0 };
    sheetFin.getCell(`C${rowMapFin['debt']}`).numFmt = numberFormatPct;

    // PRIVATE DEBT (FONTI)
    addFinRow('pdFonti', '  - Private Debt (Holding Level)');
    sheetFin.getCell(`B${rowMapFin['pdFonti']}`).value = {
        formula: `IF(B${rowMapFin['pdEnabled']}="NO", 0, IF(B${rowMapFin['pdAmountType']}="Importo Fisso (€)", B${rowMapFin['pdAmountValue']}, IF(B${rowMapFin['pdAmountType']}="% Base Finanziabile", B${rowMapFin['bankableBase']} * B${rowMapFin['pdAmountValue']}, B${rowMapFin['totUsi']} * B${rowMapFin['pdAmountValue']})))`,
        result: m.pdAmount || 0
    };
    sheetFin.getCell(`B${rowMapFin['pdFonti']}`).numFmt = numberFormatEuro;

    // PRIVATE EQUITY (FONTI)
    addFinRow('peFonti', '  - Private Equity (Co-Investitore SPV)');
    sheetFin.getCell(`B${rowMapFin['peFonti']}`).value = {
        formula: `IF(B${rowMapFin['peEnabled']}="NO", 0, IF(B${rowMapFin['peAmountType']}="Importo Fisso (€)", B${rowMapFin['peAmountValue']}, (B${rowMapFin['totUsi']} - B${rowMapFin['debt']}) * B${rowMapFin['peAmountValue']}))`,
        result: m.peAmount || 0
    };
    sheetFin.getCell(`B${rowMapFin['peFonti']}`).numFmt = numberFormatEuro;

    // EQUITY SPV (Totale equity immesso nella SPV; il PD è a Holding level e NON riduce l'equity SPV)
    addFinRow('equity', 'Totale Equity SPV (Mezzi Propri)', true);
    sheetFin.getCell(`B${rowMapFin['equity']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['debt']} - B${rowMapFin['peFonti']}`, result: m.equity || 0 };
    sheetFin.getCell(`B${rowMapFin['equity']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['equity']}`).value = { formula: `IFERROR(B${rowMapFin['equity']} / B${rowMapFin['totUsi']}, 0)`, result: totUsiVal > 0 ? (m.equity || 0) / totUsiVal : 0 };
    sheetFin.getCell(`C${rowMapFin['equity']}`).numFmt = numberFormatPct;

    // Equity Stratification
    addFinRow('holdcoEq', '  - Capitale Sociale HoldCo (Versato)');
    sheetFin.getCell(`B${rowMapFin['holdcoEq']}`).value = { formula: `B${rowMapFin['holdcoUsi']}`, result: p.holdcoCapital || 0 };
    sheetFin.getCell(`B${rowMapFin['holdcoEq']}`).numFmt = numberFormatEuro;
    
    // FINANZIAMENTO SOCI (Subordinated Debt) — Formula nativa pura, zero hardcoding
    addFinRow('subDebt', '  - Finanziamento Soci (Subordinated Debt)');
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).value = { formula: `MAX(0, B${rowMapFin['equity']} - B${rowMapFin['holdcoEq']}) * B${rowMapFin['sociEquityPct']}`, result: m.subDebt || 0 };
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).numFmt = numberFormatEuro;

    // Sponsor Pure Equity = equity SPV - holdcoEq - subDebt - PD (il PD è debt Holding, riduce l'esposizione Sponsor)
    addFinRow('otherEq', '  - Sponsor Pure Equity (al netto PD Holding)');
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).value = { formula: `MAX(0, B${rowMapFin['equity']} - B${rowMapFin['holdcoEq']} - B${rowMapFin['subDebt']} - B${rowMapFin['pdFonti']})`, result: m.otherEq || 0 };
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('totFonti', 'TOTALE FONTI', true);
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).value = { formula: `B${rowMapFin['debt']} + B${rowMapFin['pdFonti']} + B${rowMapFin['peFonti']} + B${rowMapFin['holdcoEq']} + B${rowMapFin['subDebt']} + B${rowMapFin['otherEq']}`, result: m.totFonti || totUsiVal };
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).numFmt = numberFormatEuro;
    
    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('check', 'Controllo Squadratura (Usi - Fonti)', true);
    sheetFin.getCell(`B${rowMapFin['check']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['totFonti']}`, result: 0 };
    sheetFin.getCell(`B${rowMapFin['check']}`).numFmt = numberFormatEuro;

    // Applicazione Formule CAPEX a posteriori (dopo che rowMapFin è completa)
    pendingFormulasCapex.forEach(pf => {
        const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
        pf.cell.value = { formula: pf.formulaFn(), result: val !== undefined ? val : null };
    });

    // Applicazione Formule Cross DRIVER OPERATIVI a posteriori (dopo che rowMapFin e rowMapCapex sono complete)
    pendingFormulasCrossOp.forEach(pf => {
        const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
        pf.cell.value = { formula: pf.formulaFn(), result: val !== undefined ? val : null };
    });

    
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
                pendingFormulasDebt.push({ cell: cell, formulaFn: formulaFn, colLetter: getColLetter(i + 2), yearIndex: i, result: rowValues[`y${i}`] });
            }
        }
        currentRowNumDebt++;
        return row;
    }

    const d = (window.State.results && window.State.results.debtSchedule) || {};
    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('sec_debt_1', '1. DEBITO BANCARIO SPV – Project Finance (Senior Debt)', 'title-purple');
    addRowDebt('beginningBalance', 'Debito Residuo Inizio Anno (€)', 'normal', d.beginningBalance, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const prevCol = getColLetter(yearIdx + 1);
        return `${prevCol}${rowMapDebt.endingBalance}`;
    });
    // Righe di supporto: tasso attivo (gestisce refinancing) e rata annuitaria attiva
    addRowDebt('activeRate', 'Tasso Debito Attivo (post-Refi) (%)', 'detail', Array.from({ length: numYears }, () => 0), numberFormatPct, (col, yearIdx) => {
        if (yearIdx === 0) return `FINANZA!$B$${rowMapFin['interestRate']}`;
        return `IF(AND(FINANZA!$B$${rowMapFin['refiEnabled']}="Sì", ${yearIdx} >= FINANZA!$B$${rowMapFin['refiYear']}), FINANZA!$B$${rowMapFin['refiInterestRate']}, FINANZA!$B$${rowMapFin['interestRate']})`;
    });
    addRowDebt('activeAnnuity', 'Rata Annuitaria Attiva (€)', 'detail', Array.from({ length: numYears }, () => 0), numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        if (yearIdx === 1) {
            return `FINANZA!$B$${rowMapFin['periodsPerYear']} * PMT(FINANZA!$B$${rowMapFin['interestRate']} / FINANZA!$B$${rowMapFin['periodsPerYear']}, FINANZA!$B$${rowMapFin['amortizingYears']} * FINANZA!$B$${rowMapFin['periodsPerYear']}, -FINANZA!$B$${rowMapFin['debt']})`;
        }
        const prevCol = getColLetter(yearIdx + 1);
        return `IF(AND(FINANZA!$B$${rowMapFin['refiEnabled']}="Sì", ${yearIdx} = FINANZA!$B$${rowMapFin['refiYear']}), FINANZA!$B$${rowMapFin['periodsPerYear']} * PMT(${col}${rowMapDebt.activeRate} / FINANZA!$B$${rowMapFin['periodsPerYear']}, FINANZA!$B$${rowMapFin['refiLoanTerm']} * FINANZA!$B$${rowMapFin['periodsPerYear']}, -${col}${rowMapDebt.beginningBalance}), ${prevCol}${rowMapDebt.activeAnnuity})`;
    });
    addRowDebt('interestAccrued', '(-) Quota Interessi Mutuo Maturati (€)', 'minus', d.interestAccrued, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yearNum = yearIdx;
        const maturity = `FINANZA!$B$${rowMapFin['activeMaturity']}`;
        const m = `FINANZA!$B$${rowMapFin['periodsPerYear']}`;
        const begin = `${col}${rowMapDebt['beginningBalance']}`;
        const rate = `${col}${rowMapDebt.activeRate}`;
        const annuity = `${col}${rowMapDebt['activeAnnuity']}`;
        const dt = yearNum === 1 ? `FINANZA!$B$${rowMapFin['y1OperatingAvail']}` : '1';
        const timeElapsed = yearNum === 1 ? '0' : `(FINANZA!$B$${rowMapFin['y1OperatingAvail']}+${yearNum - 2})`;
        const graceInYr = `MAX(0, MIN(${dt}, FINANZA!$B$${rowMapFin['graceCappedYears']}-${timeElapsed}))`;
        const amortInYr = `(${dt}-${graceInYr})`;

        const term = `(POWER(1 + ${rate}/${m}, ${m}) - 1)`;
        const iAmort = `(${begin} * ${term} + ${annuity} * (1 - ${term}/${rate})) * ${amortInYr}`;
        const iGrace = `${begin} * ${rate} * ${graceInYr}`;
        const intFormula = `IF(${amortInYr} > 0, ${iGrace} + ${iAmort}, ${begin} * ${rate} * ${dt})`;

        return `-IF(${yearNum} <= ${maturity}, ${intFormula}, 0)`;
    });
    addRowDebt('principalScheduled', '(-) Quota Capitale Programmata (€)', 'minus', d.principalScheduled, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yearNum = yearIdx;
        const maturity = `FINANZA!$B$${rowMapFin['activeMaturity']}`;
        const sculpt = `FINANZA!$B$${rowMapFin['sculptingEnabled']}="Sì"`;
        const target = `FINANZA!$B$${rowMapFin['targetDscr']}`;
        const cfads = `'RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf['cfads']}`;
        const begin = `${col}${rowMapDebt['beginningBalance']}`;
        const annuity = `${col}${rowMapDebt['activeAnnuity']}`;
        const rate = `${col}${rowMapDebt.activeRate}`;
        const intF = `-${col}${rowMapDebt['interestAccrued']}`;

        const dt = yearNum === 1 ? `FINANZA!$B$${rowMapFin['y1OperatingAvail']}` : '1';
        const timeElapsed = yearNum === 1 ? '0' : `(FINANZA!$B$${rowMapFin['y1OperatingAvail']}+${yearNum - 2})`;
        const graceInYr = `MAX(0, MIN(${dt}, FINANZA!$B$${rowMapFin['graceCappedYears']}-${timeElapsed}))`;
        const amortInYr = `(${dt}-${graceInYr})`;
        const baseAmort = `MIN(${begin}, MAX(0, (${annuity}-${intF})*${amortInYr}))`;
        const sculptBranch = `IF(${yearNum}=${maturity}, MAX(0, ${begin}), MIN(MAX(0, ${begin}), MAX(0, ${cfads}/${target}-${intF})))`;
        return `-IF(${yearNum} > ${maturity}, 0, IF(${sculpt}, ${sculptBranch}, ${baseAmort}))`;
    });
    addRowDebt('principalVoluntary', '(-) Quota Capitale Prepagata - Cash Sweep (€)', 'minus', d.principalVoluntary, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yearNum = yearIdx;
        return `-IF(OR(FINANZA!$B$${rowMapFin['sweepYears']}=0, ${yearNum} <= FINANZA!$B$${rowMapFin['sweepYears']}), MAX(0, MIN(${col}${rowMapDebt['beginningBalance']} + ${col}${rowMapDebt['principalScheduled']}, ` +
               `IF(FINANZA!$B$${rowMapFin['sweepType']}="% del CFADS", ('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf['cfads']} + ${col}${rowMapDebt['interestAccrued']} + ${col}${rowMapDebt['principalScheduled']}) * FINANZA!$B$${rowMapFin['sweepValue']}, ` +
               `IF(FINANZA!$B$${rowMapFin['sweepType']}="€ Fisso/Anno", FINANZA!$B$${rowMapFin['sweepValue']}, 0)))), 0)`;
    });
    addRowDebt('endingBalance', 'Debito Residuo Fine Anno (€)', 'bold', d.endingBalance, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return `FINANZA!$B$${rowMapFin['debt']}`;
        return `MAX(0, ${col}${rowMapDebt['beginningBalance']} + ${col}${rowMapDebt['principalScheduled']} + ${col}${rowMapDebt['principalVoluntary']})`;
    });
    if ((window.State.inputs.dsraMonths || 0) > 0) {
        addRowDebt('dsraBalance', 'Saldo DSRA - Riserva Servizio Debito (€)', 'normal', d.dsraBalance, numberFormatEuro);
    }
    
    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('totalDebtService', 'SERVIZIO DEL DEBITO EFFETTIVO (€)', 'total-purple', (d.totalDebtService || Array.from({ length: numYears }, () => 0)).map(v => -Math.abs(v)), numberFormatEuro, (col) => {
        return `${col}${rowMapDebt.interestAccrued}+${col}${rowMapDebt.principalScheduled}+${col}${rowMapDebt.principalVoluntary}`;
    });
    addRowDebt('dscr', 'DSCR (Debt Service Coverage Ratio)', 'bold', d.dscr, '0.00"x"', (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        return `IFERROR('RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.cfads}/-(${col}${rowMapDebt.interestAccrued}+${col}${rowMapDebt.principalScheduled}), 0)`;
    });

    sheetDebt.addRow([]); currentRowNumDebt++;

    addRowDebt('sec_debt_2', `2. FINANZIAMENTO SOCI – Subordinated Shareholder Loan (${p.sociEquityPct}% Equity)`, 'title-teal-debt');
    addRowDebt('beginningBalanceSoci', 'Finanziamento Soci Inizio Anno (€)', 'normal', d.beginningBalanceSoci, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const prevCol = getColLetter(yearIdx + 1);
        return `${prevCol}${rowMapDebt.endingBalanceSoci}`;
    });
    addRowDebt('interestAccruedSoci', `(-) Interessi Maturati (${p.sociInterestRate > 0 ? p.sociInterestRate.toFixed(2) + '% p.a.' : 'Nessuno'}${p.sociInterestGrace > 0 ? `, grazia anni 1-${p.sociInterestGrace}` : ', nessuna grazia'}) (€)`, 'minus', d.interestAccruedSoci, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return '0';
        const yearNum = yearIdx;
        return `-IF(${yearNum} > FINANZA!$B$${rowMapFin['sociInterestGrace']}, ${col}${rowMapDebt.beginningBalanceSoci} * FINANZA!$B$${rowMapFin['sociInterestRate']}, 0)`;
    });
    addRowDebt('interestPaidSoci', '(+) Interessi Pagati Effettivamente (€)', 'plus-debt', d.interestPaidSoci, numberFormatEuro, (col) => {
        return `-'RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoInterestReceived}`;
    });
    const sociGraceStr = p.sociPrincipalGrace > 0 ? `grazia anni 1-${p.sociPrincipalGrace}` : 'nessuna grazia';
    const sociTermStr = p.sociLoanTerm > 0 ? `ammortamento ${p.sociLoanTerm}a` : 'cash sweep';
    addRowDebt('principalPaidSoci', `(-) Rimborso Quota Capitale (${sociGraceStr}, ${sociTermStr}) (€)`, 'minus', d.principalPaidSoci, numberFormatEuro, (col) => {
        return `'RENDICONTO FINANZIARIO SPV'!${col}${rowMapRf.holdcoLoanRepaymentReceived}`;
    });
    addRowDebt('endingBalanceSoci', 'Finanziamento Soci Fine Anno (€)', 'bold', d.endingBalanceSoci, numberFormatEuro, (col, yearIdx) => {
        if (yearIdx === 0) return `FINANZA!$B$${rowMapFin['subDebt']}`;
        return `${col}${rowMapDebt.beginningBalanceSoci}-${col}${rowMapDebt.interestAccruedSoci}-${col}${rowMapDebt.interestPaidSoci}+${col}${rowMapDebt.principalPaidSoci}`;
    });

    // ── Sezione 3: Private Debt (se abilitato) ──
    if (window.State.inputs.pdEnabled) {
        const pdModeTxt = window.State.inputs.pdMode === 'bullet_exit' ? 'Bullet a Exit (PIK Composto)' : (window.State.inputs.pdMode === 'amortizing' ? 'Ammortamento Rateale' : 'Interessi Annuari + Capitale');
        sheetDebt.addRow([]); currentRowNumDebt++;
        addRowDebt('sec_debt_3', `3. PRIVATE DEBT – Mezzanine Esterna SPV (${(window.State.inputs.pdInterestRate||0).toFixed(2)}% — ${pdModeTxt})`, 'title-teal-debt');
        addRowDebt('beginningBalancePd', 'Private Debt Inizio Anno (€)', 'normal', d.beginningBalancePd, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return '0';
            const prevCol = getColLetter(yearIdx + 1);
            return `${prevCol}${rowMapDebt.endingBalancePd}`;
        });
        addRowDebt('interestAccruedPd', `(-) Interessi Maturati (${(window.State.inputs.pdInterestRate||0).toFixed(2)}% p.a.) (€)`, 'minus', d.interestAccruedPd, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return '0';
            return `-${col}${rowMapDebt.beginningBalancePd} * FINANZA!$B$${rowMapFin['pdInterestRate']}`;
        });
        addRowDebt('interestPaidPd', '(+) Interessi Pagati Effettivamente (€)', 'plus-debt', d.interestPaidPd, numberFormatEuro);
        addRowDebt('principalPaidPd', '(-) Rimborso Quota Capitale Ammortamento (€)', 'minus', d.principalPaidPd, numberFormatEuro);
        addRowDebt('bulletPayoffPd', '(-) Payoff Bullet / Residuo a Exit (€)', 'minus', d.bulletPayoffPd, numberFormatEuro);
        addRowDebt('endingBalancePd', 'Private Debt Fine Anno (€)', 'bold', d.endingBalancePd, numberFormatEuro, (col, yearIdx) => {
            if (yearIdx === 0) return `FINANZA!$B$${rowMapFin['pdFonti']}`;
            return `${col}${rowMapDebt.beginningBalancePd}-${col}${rowMapDebt.interestAccruedPd}-${col}${rowMapDebt.interestPaidPd}+${col}${rowMapDebt.principalPaidPd}+${col}${rowMapDebt.bulletPayoffPd}`;
        });
    }

    // Applicazione Formule Debt a posteriori
    pendingFormulasDebt.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex);
        if (f) {
            const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
            pf.cell.value = { formula: f, result: val !== undefined ? val : null };
        }
    });

    // Applicazione Formule Ce a posteriori (dopo che rowMapCe, rowMapDebt e rowMapFin sono complete)
    pendingFormulasCe.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex, pf.rowIndex);
        if (f) {
            const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
            pf.cell.value = { formula: f, result: val !== undefined ? val : null };
        }
    });

    // Applicazione Formule RF a posteriori (dopo che rowMapDebt è completa)
    pendingFormulasRf.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex, pf.rowIndex);
        if (f) {
            const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
            pf.cell.value = { formula: f, result: val !== undefined ? val : null };
        }
    });

    // Applicazione Formule CE HC e RF HC a posteriori (dopo che tutte le rowMap sono complete)
    pendingFormulasCeHc.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex, pf.rowIndex);
        if (f) {
            const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
            pf.cell.value = { formula: f, result: val !== undefined ? val : null };
        }
    });
    pendingFormulasRfHc.forEach(pf => {
        const f = pf.formulaFn(pf.colLetter, pf.yearIndex, pf.rowIndex);
        if (f) {
            const val = pf.result !== undefined ? pf.result : (typeof pf.cell.value === 'object' ? pf.cell.value?.result : pf.cell.value);
            pf.cell.value = { formula: f, result: val !== undefined ? val : null };
        }
    });

    // ---------------------------------------------------------
    // D2: FOGLIO CASH FLOW MENSILE ANALITICO (72 MESI / ANNI 0-5)
    // ---------------------------------------------------------
    const mc = window.State.results && window.State.results.monthlyCashflow;
    if (mc && mc.months && mc.months.length > 0) {
        const isDated = mc.mode === 'dated';
        const totalMonths = mc.months.length;
        const sheetMc = workbook.addWorksheet('CASH FLOW MENSILE', {
            views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: true }]
        });

        // Definizione Colonne e Larghezze (21 colonne)
        sheetMc.columns = [
            { key: 'mese', width: 16 },            // Col 1 (A)
            { key: 'revAccrued', width: 18 },       // Col 2 (B)
            { key: 'revCollected', width: 18 },     // Col 3 (C)
            { key: 'opex', width: 16 },             // Col 4 (D)
            { key: 'taxes', width: 16 },            // Col 5 (E)
            { key: 'debtSenior', width: 18 },       // Col 6 (F)
            { key: 'capex', width: 16 },            // Col 7 (G)
            { key: 'funding', width: 18 },          // Col 8 (H)
            { key: 'vatCollected', width: 16 },     // Col 9 (I)
            { key: 'vatPaid', width: 18 },          // Col 10 (J)
            { key: 'vatRemitted', width: 16 },      // Col 11 (K)
            { key: 'vatRefund', width: 18 },        // Col 12 (L)
            { key: 'vatCreditEnd', width: 18 },     // Col 13 (M)
            { key: 'vatCashFlow', width: 16 },      // Col 14 (N)
            { key: 'netCashflow', width: 18 },      // Col 15 (O)
            { key: 'cashClosing', width: 18 },      // Col 16 (P)
            { key: 'fundedClosing', width: 18 },    // Col 17 (Q)
            { key: 'sociService', width: 18 },      // Col 18 (R)
            { key: 'pdService', width: 18 },        // Col 19 (S)
            { key: 'holdcoCosts', width: 16 },      // Col 20 (T)
            { key: 'holdcoClosing', width: 18 }     // Col 21 (U)
        ];

        // Riga 1: Banner Titolo Deal
        const r1 = sheetMc.getRow(1);
        r1.getCell(1).value = `PROGETTO: ${(window._currentProjectName || 'Asset Ibrido FV + BESS')} - CASH FLOW MENSILE ANALITICO`;
        r1.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF203864' } };
        sheetMc.mergeCells('A1:U1');
        r1.height = 24;

        // Riga 2: Sottotitolo Metadati
        const r2 = sheetMc.getRow(2);
        const anchorTxt = mc.anchorYear ? ` · Anno Àncora: ${mc.anchorYear}` : '';
        const horizonTxt = isDated ? `Orizzonte: Anno 0 + Anni 1-5 (${totalMonths} mesi)` : `Orizzonte: Anni 1-5 (${totalMonths} mesi)`;
        const vatMethod = mc.vatQuarterlyRefund ? 'Liquidazione Periodica con Modello IVA TR Trimestrale' : 'Liquidazione Periodica Standard';
        r2.getCell(1).value = `${horizonTxt}${anchorTxt} · Regime IVA: ${vatMethod} · Valuta: EUR (€)`;
        r2.getCell(1).font = { italic: true, size: 9.5, color: { argb: 'FF64748B' } };
        sheetMc.mergeCells('A2:U2');
        r2.height = 18;

        // Riga 3: Spazio
        sheetMc.getRow(3).height = 8;

        // Riga 4: Header di Tabella (21 Colonne)
        const headers = [
            'Mese / Anno',
            'Ricavi Maturati (€)',
            'Ricavi Incassati (€)',
            'OPEX di Cassa (€)',
            'Imposte Correnti (€)',
            'Serv. Debito Senior (€)',
            'Esborsi CAPEX (€)',
            'Funding di Capitale (€)',
            'IVA Incassata (€)',
            'IVA Pagata Fornitori (€)',
            'IVA Versata Erario (€)',
            'IVA Rimborsata TR (€)',
            'Credito IVA Finale (€)',
            'IVA Cash Flow (€)',
            'Net Cashflow SPV (€)',
            'Cassa Finale Lorda (€)',
            'Cassa con Funding (€)',
            'Serv. Fin. Soci (€)',
            'Serv. Private Debt (€)',
            'Oneri HoldCo (€)',
            'Cassa Holding (€)'
        ];
        const r4 = sheetMc.getRow(4);
        r4.height = 28;
        headers.forEach((h, idx) => {
            const cell = r4.getCell(idx + 1);
            cell.value = h;
            cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } }; // Corporate Navy Blue
            cell.alignment = { horizontal: idx === 0 ? 'left' : 'right', vertical: 'middle', wrapText: true };
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF0F172A' } },
                bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                left: { style: 'thin', color: { argb: 'FF334155' } },
                right: { style: 'thin', color: { argb: 'FF334155' } }
            };
        });

        // Memorizzazione righe subtotale per calcolare il TOTALE CUMULATO
        const subtotalRowNumbers = [];
        let blockStartRow = 5;
        let currentRow = 5;

        // Helper colonne flussi e saldi
        const flowColIndices = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 19, 20];
        const balanceColIndices = [13, 16, 17, 21];

        // Iterazione sui mesi con formule dinamiche
        let prevMonthRowNum = null;
        let blockSums = {};
        const totalSums = {};

        for (let i = 0; i < totalMonths; i++) {
            const label = mc.labels ? mc.labels[i] : `Mese ${i + 1}`;
            const revAccrued = Math.round((mc.revenueAccrued && mc.revenueAccrued[i] !== undefined) ? mc.revenueAccrued[i] : (mc.revenueTotal ? mc.revenueTotal[i] : 0));
            const revCollected = Math.round((mc.revenueTotal && mc.revenueTotal[i] !== undefined) ? mc.revenueTotal[i] : 0);
            const opexVal = -Math.round(Math.abs((mc.opex && mc.opex[i] !== undefined) ? mc.opex[i] : 0));
            const taxesVal = -Math.round(Math.abs((mc.taxes && mc.taxes[i] !== undefined) ? mc.taxes[i] : 0));
            const debtVal = -Math.round(Math.abs((mc.debtService && mc.debtService[i] !== undefined) ? mc.debtService[i] : 0));
            const capexVal = -Math.round(Math.abs((mc.capexOutflow && mc.capexOutflow[i] !== undefined) ? mc.capexOutflow[i] : 0));
            const fundingVal = Math.round((mc.fundingInflow && mc.fundingInflow[i] !== undefined) ? mc.fundingInflow[i] : 0);
            const vatColl = Math.round((mc.vatCollected && mc.vatCollected[i] !== undefined) ? mc.vatCollected[i] : 0);
            const vatPaid = -Math.round(Math.abs((mc.vatPaidToSuppliers && mc.vatPaidToSuppliers[i] !== undefined) ? mc.vatPaidToSuppliers[i] : 0));
            const vatRem = -Math.round(Math.abs((mc.vatRemitted && mc.vatRemitted[i] !== undefined) ? mc.vatRemitted[i] : 0));
            const vatRef = Math.round((mc.vatRefundReceived && mc.vatRefundReceived[i] !== undefined) ? mc.vatRefundReceived[i] : 0);
            const vatCredEnd = Math.round((mc.vatCreditEnd && mc.vatCreditEnd[i] !== undefined) ? mc.vatCreditEnd[i] : 0);
            const vatCf = Math.round((mc.vatCashFlow && mc.vatCashFlow[i] !== undefined) ? mc.vatCashFlow[i] : 0);
            const netCf = Math.round((mc.netCashflow && mc.netCashflow[i] !== undefined) ? mc.netCashflow[i] : 0);
            const cashClose = Math.round((mc.cashClosing && mc.cashClosing[i] !== undefined) ? mc.cashClosing[i] : 0);
            const fundedClose = Math.round((mc.fundedCashClosing && mc.fundedCashClosing[i] !== undefined) ? mc.fundedCashClosing[i] : cashClose);
            const sociSvc = -Math.round(Math.abs((mc.holdcoSociService && mc.holdcoSociService[i] !== undefined) ? mc.holdcoSociService[i] : 0));
            const pdSvc = -Math.round(Math.abs((mc.holdcoPdService && mc.holdcoPdService[i] !== undefined) ? mc.holdcoPdService[i] : 0));
            const holdcoOpex = -Math.round(Math.abs((mc.holdcoOtherCosts && mc.holdcoOtherCosts[i] !== undefined) ? mc.holdcoOtherCosts[i] : 0));
            const holdcoClose = Math.round((mc.holdcoCashClosing && mc.holdcoCashClosing[i] !== undefined) ? mc.holdcoCashClosing[i] : 0);

            // Accumula somme per subtotali annuali e totale cumulato
            const monthVals = {
                2: revAccrued, 3: revCollected, 4: opexVal, 5: taxesVal, 6: debtVal,
                7: capexVal, 8: fundingVal, 9: vatColl, 10: vatPaid, 11: vatRem,
                12: vatRef, 14: vatCf, 15: netCf, 18: sociSvc, 19: pdSvc, 20: holdcoOpex
            };
            flowColIndices.forEach(cIdx => {
                const val = monthVals[cIdx] || 0;
                blockSums[cIdx] = (blockSums[cIdx] || 0) + val;
                totalSums[cIdx] = (totalSums[cIdx] || 0) + val;
            });

            const row = sheetMc.addRow({
                mese: label,
                revAccrued: revAccrued,
                revCollected: revCollected,
                opex: opexVal,
                taxes: taxesVal,
                debtSenior: debtVal,
                capex: capexVal,
                funding: fundingVal,
                vatCollected: vatColl,
                vatPaid: vatPaid,
                vatRemitted: vatRem,
                vatRefund: vatRef,
                vatCreditEnd: vatCredEnd,
                vatCashFlow: {
                    formula: `I${currentRow}+J${currentRow}+K${currentRow}+L${currentRow}`,
                    result: vatCf
                },
                netCashflow: {
                    formula: `C${currentRow}+D${currentRow}+E${currentRow}+F${currentRow}+G${currentRow}+N${currentRow}`,
                    result: netCf
                },
                cashClosing: (prevMonthRowNum === null) ? {
                    formula: `O${currentRow}`,
                    result: cashClose
                } : {
                    formula: `P${prevMonthRowNum}+O${currentRow}`,
                    result: cashClose
                },
                fundedClosing: (prevMonthRowNum === null) ? {
                    formula: `O${currentRow}+H${currentRow}`,
                    result: fundedClose
                } : {
                    formula: `Q${prevMonthRowNum}+O${currentRow}+H${currentRow}`,
                    result: fundedClose
                },
                sociService: sociSvc,
                pdService: pdSvc,
                holdcoCosts: holdcoOpex,
                holdcoClosing: (prevMonthRowNum === null) ? {
                    formula: `O${currentRow}+R${currentRow}+S${currentRow}+T${currentRow}`,
                    result: holdcoClose
                } : {
                    formula: `U${prevMonthRowNum}+O${currentRow}+R${currentRow}+S${currentRow}+T${currentRow}`,
                    result: holdcoClose
                }
            });

            prevMonthRowNum = currentRow;

            row.height = 19;
            const isOdd = i % 2 === 1;
            const rowBg = isOdd ? 'FFF8FAFC' : 'FFFFFFFF';

            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = {
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
                if (colNumber === 1) {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                    cell.font = { bold: true, size: 9, color: { argb: 'FF1E293B' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                } else {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = '€ #,##0';
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                    cell.font = { size: 9, color: { argb: 'FF334155' } };

                    // Evidenziazioni condizionali corporate
                    if (colNumber === 5 && mc.vatCompensated && mc.vatCompensated[i] > 0) { // Imposte con compensazione F24
                        cell.note = `Imposte P&L: € ${Math.round(Math.abs(taxesVal) + mc.vatCompensated[i])}, compensate con Credito IVA (F24) per € ${Math.round(mc.vatCompensated[i])}. Uscita effettiva di cassa: € ${Math.round(taxesVal)}.`;
                        if (taxesVal === 0) {
                            cell.font = { size: 9, bold: true, color: { argb: 'FF047857' } }; // Emerald
                        }
                    }
                    if (colNumber === 8 && fundingVal > 0) { // Funding
                        cell.font = { size: 9, bold: true, color: { argb: 'FF4338CA' } }; // Indigo
                    }
                    if (colNumber === 12 && vatRef > 0) { // IVA Rimborsata TR
                        cell.font = { size: 9, bold: true, color: { argb: 'FF047857' } }; // Emerald
                    }
                    if (colNumber === 15) { // Net Cashflow
                        cell.font = { size: 9, bold: true, color: { argb: netCf < 0 ? 'FFB91C32' : 'FF047857' } };
                    }
                    if (colNumber === 16) { // Cassa Lorda
                        cell.font = { size: 9, bold: true, color: { argb: cashClose < 0 ? 'FFB91C32' : 'FF0369A1' } };
                    }
                    if (colNumber === 17) { // Cassa con Funding
                        if (fundedClose < 0) {
                            cell.font = { size: 9, bold: true, color: { argb: 'FFB91C32' } };
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8EC' } };
                        } else {
                            cell.font = { size: 9, bold: true, color: { argb: 'FF047857' } };
                        }
                    }
                }
            });

            currentRow++;

            // Subtotale annuale ogni 12 mesi o all'ultimo mese
            const isYearEnd = ((i + 1) % 12 === 0) || (i === totalMonths - 1);
            if (isYearEnd) {
                const yearIndex = Math.floor(i / 12);
                let yearName = '';
                if (isDated) {
                    yearName = yearIndex === 0 ? 'ANNO 0 (Costruzione)' : `ANNO ${yearIndex}`;
                } else {
                    yearName = `ANNO ${yearIndex + 1}`;
                }
                const blockEndRow = currentRow - 1;

                const subRow = sheetMc.addRow({});
                subRow.height = 21;
                const subRowNum = currentRow;
                subtotalRowNumbers.push(subRowNum);

                subRow.getCell(1).value = `SUBTOTALE ${yearName}`;

                // Formule per colonne di flusso (somma periodo) con pre-computed result
                flowColIndices.forEach(cIdx => {
                    const cLet = getColLetter(cIdx);
                    subRow.getCell(cIdx).value = {
                        formula: `SUM(${cLet}${blockStartRow}:${cLet}${blockEndRow})`,
                        result: blockSums[cIdx] || 0
                    };
                });
                // Colonne di stato patrimoniale / saldo a fine anno (M=Credito IVA, P=Cassa Lorda, Q=Cassa Funding, U=Cassa Holding)
                balanceColIndices.forEach(cIdx => {
                    const cLet = getColLetter(cIdx);
                    let lastVal = 0;
                    if (cIdx === 13) lastVal = vatCredEnd;
                    else if (cIdx === 16) lastVal = cashClose;
                    else if (cIdx === 17) lastVal = fundedClose;
                    else if (cIdx === 21) lastVal = holdcoClose;
                    subRow.getCell(cIdx).value = {
                        formula: `${cLet}${blockEndRow}`,
                        result: lastVal
                    };
                });

                // Reset somme per blocco successivo
                blockSums = {};

                subRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; // Slate 200
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
                        bottom: { style: 'medium', color: { argb: 'FF475569' } },
                        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                    };
                    if (colNumber === 1) {
                        cell.alignment = { horizontal: 'left', vertical: 'middle' };
                    } else {
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                        cell.numFmt = '€ #,##0';
                    }
                });

                currentRow++;
                blockStartRow = currentRow;
            }
        }

        // Riga TOTALE CUMULATO
        const totalRow = sheetMc.addRow({});
        totalRow.height = 24;
        const lastDataRow = subtotalRowNumbers.length ? (subtotalRowNumbers[subtotalRowNumbers.length - 1] - 1) : (currentRow - 1);

        totalRow.getCell(1).value = `TOTALE CUMULATO (${totalMonths} MESI)`;
        // Per le colonne di flusso, sommiamo i subtotali annuali con precomputed result
        flowColIndices.forEach(cIdx => {
            const cLet = getColLetter(cIdx);
            const sumParts = subtotalRowNumbers.map(rNum => `${cLet}${rNum}`).join(',');
            totalRow.getCell(cIdx).value = {
                formula: `SUM(${sumParts})`,
                result: totalSums[cIdx] || 0
            };
        });
        // Per le colonne di saldo patrimoniale (M, P, Q, U), saldo a fine orizzonte
        balanceColIndices.forEach(cIdx => {
            const cLet = getColLetter(cIdx);
            let finalVal = 0;
            if (cIdx === 13) finalVal = (mc.vatCreditEnd && mc.vatCreditEnd.length) ? mc.vatCreditEnd[mc.vatCreditEnd.length - 1] : 0;
            else if (cIdx === 16) finalVal = (mc.cashClosing && mc.cashClosing.length) ? mc.cashClosing[mc.cashClosing.length - 1] : 0;
            else if (cIdx === 17) finalVal = (mc.fundedCashClosing && mc.fundedCashClosing.length) ? mc.fundedCashClosing[mc.fundedCashClosing.length - 1] : finalVal;
            else if (cIdx === 21) finalVal = (mc.holdcoCashClosing && mc.holdcoCashClosing.length) ? mc.holdcoCashClosing[mc.holdcoCashClosing.length - 1] : 0;
            totalRow.getCell(cIdx).value = {
                formula: `${cLet}${lastDataRow}`,
                result: Math.round(finalVal)
            };
        });

        totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Slate 800
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF0F172A' } },
                bottom: { style: 'double', color: { argb: 'FF0F172A' } },
                right: { style: 'thin', color: { argb: 'FF334155' } }
            };
            if (colNumber === 1) {
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '€ #,##0';
            }
        });

        currentRow++;

        // Riga vuota di separazione
        sheetMc.addRow({}).height = 14;
        currentRow++;

        // ---------------------------------------------------------
        // PANNELLO KPI BANCARI & LIQUIDITÀ (DUE DILIGENCE)
        // ---------------------------------------------------------
        const kpiTitleRow = sheetMc.addRow({});
        kpiTitleRow.height = 22;
        kpiTitleRow.getCell(1).value = 'SINTESI INDICATORI BANCARI, LIQUIDITÀ & BUDGET (DUE DILIGENCE)';
        kpiTitleRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF203864' } };
        sheetMc.mergeCells(`A${currentRow}:G${currentRow}`);
        currentRow++;

        const kpiFirstRow = currentRow;
        const capexBudgetRowNum = kpiFirstRow + 9;
        const capexAllocRowNum = kpiFirstRow + 10;
        const opexBudgetRowNum = kpiFirstRow + 12;
        const opexAllocRowNum = kpiFirstRow + 13;

        const kpis = [
            ['Cassa Minima SPV senza Funding (Fabbisogno Lordo)', { formula: `MIN(P5:P${lastDataRow})`, result: mc.minCashClosing || 0 }, '€ #,##0', (mc.minCashClosing || 0) < 0 ? 'FFB91C32' : 'FF047857'],
            ['Mese Fabbisogno Lordo Massimo', mc.minCashMonth ? String(mc.minCashMonth) : '—', '@', 'FF0F172A'],
            ['Cassa Minima SPV con Funding', { formula: `MIN(Q5:Q${lastDataRow})`, result: (mc.fundedMinCashClosing !== undefined ? mc.fundedMinCashClosing : mc.minCashClosing) || 0 }, '€ #,##0', ((mc.fundedMinCashClosing !== undefined ? mc.fundedMinCashClosing : mc.minCashClosing) || 0) < 0 ? 'FFB91C32' : 'FF047857'],
            ['Mese Cassa Minima con Funding', mc.fundedMinMonth ? String(mc.fundedMinMonth) : '—', '@', 'FF0F172A'],
            ['Mesi con Cassa Negativa (senza funding)', mc.negativeMonths || 0, '#,##0', (mc.negativeMonths || 0) > 0 ? 'FFB91C32' : 'FF047857'],
            ['XIRR Datato Equity HoldCo', (mc.datedXirr !== undefined ? mc.datedXirr / 100 : 0), '0.00%', (mc.datedXirr || 0) < 0 ? 'FFB91C32' : 'FF047857'],
            ['Credito IVA Massimo Registrato (Picco)', { formula: `MAX(M5:M${lastDataRow})`, result: mc.vatMaxCredit || 0 }, '€ #,##0', 'FF0284C7'],
            ['Saldo Credito IVA a Fine Orizzonte', { formula: `M${lastDataRow}`, result: (mc.vatCreditEnd && mc.vatCreditEnd.length) ? mc.vatCreditEnd[mc.vatCreditEnd.length - 1] : 0 }, '€ #,##0', 'FF0284C7'],
            ['Effetto Cassa Netto Cumulato IVA', { formula: `N${totalRow.number}`, result: mc.vatNetCumulative || 0 }, '€ #,##0', 'FF0F172A'],
            ['Budget CAPEX Totale SPV', mc.capexBudget || 0, '€ #,##0', 'FF0F172A'],
            ['CAPEX Datato Allocato Effettivo', mc.capexAllocated || 0, '€ #,##0', 'FF0F172A'],
            ['Residuo CAPEX non Allocato', { formula: `D${capexBudgetRowNum}-D${capexAllocRowNum}`, result: mc.capexResidual || 0 }, '€ #,##0', (mc.capexResidual || 0) <= 0 ? 'FF047857' : 'FFD97706'],
            ['Budget OPEX Anno 1', mc.opexBudgetY1 || 0, '€ #,##0', 'FF0F172A'],
            ['OPEX Allocato Anno 1', (mc.opexAllocatedY1 !== undefined ? mc.opexAllocatedY1 : mc.opexAllocated) || 0, '€ #,##0', 'FF0F172A'],
            ['Residuo OPEX Anno 1', { formula: `D${opexBudgetRowNum}-D${opexAllocRowNum}`, result: (mc.opexResidualY1 !== undefined ? mc.opexResidualY1 : mc.opexResidual) || 0 }, '€ #,##0', ((mc.opexResidualY1 !== undefined ? mc.opexResidualY1 : mc.opexResidual) || 0) <= 0 ? 'FF047857' : 'FFD97706'],
            ['Totale Imposte SPV a P&L (Competenza)', (mc.taxesAccruedTotal !== undefined ? mc.taxesAccruedTotal : 0), '€ #,##0', 'FF0F172A'],
            ['Imposte SPV Compensate F24 con Credito IVA', (mc.vatCompensatedTotal !== undefined ? mc.vatCompensatedTotal : 0), '€ #,##0', 'FF047857'],
            ['Imposte SPV Effettivamente Pagate di Cassa', (mc.taxesPaidTotal !== undefined ? mc.taxesPaidTotal : 0), '€ #,##0', 'FF0F172A']
        ];

        kpis.forEach(([label, val, fmt, colArgb]) => {
            const kRow = sheetMc.addRow({});
            kRow.height = 18;
            kRow.getCell(1).value = label;
            kRow.getCell(1).font = { bold: false, size: 9.5, color: { argb: 'FF334155' } };
            kRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            kRow.getCell(1).border = {
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            sheetMc.mergeCells(`A${currentRow}:C${currentRow}`);

            const valCell = kRow.getCell(4);
            valCell.value = val;
            valCell.font = { bold: true, size: 9.5, color: { argb: colArgb || 'FF0F172A' } };
            valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            valCell.alignment = { horizontal: 'right', vertical: 'middle' };
            valCell.numFmt = fmt;
            valCell.border = {
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            currentRow++;
        });
    }

    // Download del file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    
    // Metodo nativo HTML5 per il download (più affidabile per i nomi dei file)
    const urlHelper = (typeof window !== 'undefined' && window.URL) ? window.URL : (typeof URL !== 'undefined' ? URL : null);
    const url = (urlHelper && typeof urlHelper.createObjectURL === 'function') ? urlHelper.createObjectURL(blob) : '#';
    if (typeof document !== 'undefined') {
        const a = document.createElement('a');
        a.href = url;
        a.download = "PL_Driver_Operativi.xlsx";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            if (urlHelper && typeof urlHelper.revokeObjectURL === 'function') urlHelper.revokeObjectURL(url);
        }, 100);
    }

    } catch(err) {
        showToast("Si è verificato un errore durante l'esportazione in Excel:\n\n" + err.message, 'error');
        console.error("Excel export error:", err);
    }
}
