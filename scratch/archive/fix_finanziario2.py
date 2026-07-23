import re

with open('src/excelExport.js', 'r', encoding='utf-8') as f:
    content = f.read()

finanziario_old = """    // FOGLIO FINANZIARIO
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
    sheetFin.getCell(`B${rowMapFin['check']}`).numFmt = numberFormatEuro;"""


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

    const p = window.State.inputs;
    
    addFinRow('paramHeader', 'PARAMETRI DI FINANZIAMENTO', true, true);

    addFinRow('leverage', 'Leverage (D/E Ratio % Target)');
    sheetFin.getCell(`B${rowMapFin['leverage']}`).value = p.leverage;
    sheetFin.getCell(`B${rowMapFin['leverage']}`).numFmt = numberFormatPct;

    addFinRow('debtBasisType', 'Base di Calcolo Debito (Debt Basis)');
    sheetFin.getCell(`B${rowMapFin['debtBasisType']}`).value = p.debtBasis === 'ev_ex_spv' ? 'Totale Investimento al netto SPV' : 'Totale Investimento (Hard Costs)';

    addFinRow('loanTerm', 'Durata Debito Senior (Anni)');
    sheetFin.getCell(`B${rowMapFin['loanTerm']}`).value = p.loanTerm;

    addFinRow('sociEquityPct', 'Quota Equity Finanziata dai Soci (%)');
    sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`).value = p.sociEquityPct / 100;
    sheetFin.getCell(`B${rowMapFin['sociEquityPct']}`).numFmt = numberFormatPct;

    sheetFin.addRow([]); currentRowFin++;

    addFinRow('usi', 'TOTALE USI E BASE FINANZIABILE', true, true);
    addFinRow('totUsi', 'Costo Totale Progetto (CAPEX)', true);
    const capexTotColLetter = getColLetter(m.capexBreakdown ? m.capexBreakdown.length + 2 : 2);
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['totalCapex']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totUsi']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).value = 1;
    sheetFin.getCell(`C${rowMapFin['totUsi']}`).numFmt = numberFormatPct;

    addFinRow('spvCost', 'Costo Acquisizione SPV (Da escludere se base ev_ex_spv)');
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).value = { formula: `CAPEX!${capexTotColLetter}${rowMapCapex['spv']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['spvCost']}`).numFmt = numberFormatEuro;

    addFinRow('bankableBase', 'Base Finanziabile Effettiva');
    if (p.debtBasis === 'ev_ex_spv') {
        sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['spvCost']}`, result: undefined };
    } else {
        sheetFin.getCell(`B${rowMapFin['bankableBase']}`).value = { formula: `B${rowMapFin['totUsi']}`, result: undefined };
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

    // EQUITY
    addFinRow('equity', 'Totale Equity (Mezzi Propri)', true);
    sheetFin.getCell(`B${rowMapFin['equity']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['debt']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['equity']}`).numFmt = numberFormatEuro;
    sheetFin.getCell(`C${rowMapFin['equity']}`).value = { formula: `IFERROR(B${rowMapFin['equity']} / B${rowMapFin['totUsi']}, 0)`, result: undefined };
    sheetFin.getCell(`C${rowMapFin['equity']}`).numFmt = numberFormatPct;

    // Equity Stratification
    addFinRow('holdco', '  - Capitale Sociale HoldCo');
    sheetFin.getCell(`B${rowMapFin['holdco']}`).value = p.holdcoCapital || 10000;
    sheetFin.getCell(`B${rowMapFin['holdco']}`).numFmt = numberFormatEuro;
    
    addFinRow('subDebt', '  - Finanziamento Soci (Subordinated Debt)');
    // Construction equity minus holdco? In worker: constructionEquity = Math.max(0, (totalProjectCost - totalSpvAcquisitionCapex) - debtAmount);
    // subordinatedDebt = constructionEquity * (sociEquityPct / 100);
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).value = { formula: `MAX(0, B${rowMapFin['totUsi']} - B${rowMapFin['spvCost']} - B${rowMapFin['debt']}) * B${rowMapFin['sociEquityPct']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['subDebt']}`).numFmt = numberFormatEuro;

    addFinRow('otherEq', '  - Riserva / Altro Equity');
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).value = { formula: `B${rowMapFin['equity']} - B${rowMapFin['holdco']} - B${rowMapFin['subDebt']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['otherEq']}`).numFmt = numberFormatEuro;

    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('totFonti', 'TOTALE FONTI', true);
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).value = { formula: `B${rowMapFin['debt']} + B${rowMapFin['equity']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['totFonti']}`).numFmt = numberFormatEuro;
    
    sheetFin.addRow([]); currentRowFin++;
    
    addFinRow('check', 'Controllo Squadratura (Usi - Fonti)', true);
    sheetFin.getCell(`B${rowMapFin['check']}`).value = { formula: `B${rowMapFin['totUsi']} - B${rowMapFin['totFonti']}`, result: undefined };
    sheetFin.getCell(`B${rowMapFin['check']}`).numFmt = numberFormatEuro;"""

if finanziario_old in content:
    content = content.replace(finanziario_old, new_finanziario_sheet)
    with open('src/excelExport.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Done")
else:
    print("Could not find the old FINANZIARIO code to replace. Using fuzzy match fallback...")
    # fallback
    import re
    match = re.search(r"// FOGLIO FINANZIARIO.*?// FOGLIO SUCCESSIVO", content, re.DOTALL)
    if match:
        content = content[:match.start()] + new_finanziario_sheet + "\n    // FOGLIO SUCCESSIVO" + content[match.end():]
        with open('src/excelExport.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Fallback Replace Done")
    else:
        # manual fallback
        idx1 = content.find("    // FOGLIO FINANZIARIO")
        idx2 = content.find("    // FOGLIO SUCCESSIVO", idx1)
        if idx1 != -1 and idx2 != -1:
            content = content[:idx1] + new_finanziario_sheet + "\n" + content[idx2:]
            with open('src/excelExport.js', 'w', encoding='utf-8') as f:
                f.write(content)
            print("Manual Fallback Replace Done")
        else:
            print("Failed completely.")
