/**
 * Micro-Kernel Module: Corporate Taxation & VAT Dynamics
 * Dominio di competenza: fiscal_expert
 */

export function calculateMonthlyVATStep({
    prevVatCredit = 0,
    vatPaidCapexOpex = 0,
    vatCollectedRevenue = 0,
    mode = 'ibrido', // 'ibrido' | 'rimborso' | 'compensazione' | 'credito'
    lagMonths = 2,
    pendingRefunds = [], // coda rimborsi attesi [{ monthDue, amount }]
    currentMonth = 1,
    grossTaxesDue = 0
}) {
    const netPeriodVat = vatPaidCapexOpex - vatCollectedRevenue;
    let currentVatCredit = prevVatCredit + netPeriodVat;

    let vatRefundReceived = 0;
    let vatCompensatedF24 = 0;

    // 1. Elaborazione rimborsi giunti a scadenza (Modello TR)
    for (let i = pendingRefunds.length - 1; i >= 0; i--) {
        if (pendingRefunds[i].monthDue <= currentMonth) {
            vatRefundReceived += pendingRefunds[i].amount;
            pendingRefunds.splice(i, 1);
        }
    }

    // 2. Compensazione F24 (se richiesta o in modalità compensazione/ibrido)
    if ((mode === 'compensazione' || mode === 'ibrido') && grossTaxesDue > 0 && currentVatCredit > 0) {
        vatCompensatedF24 = Math.min(currentVatCredit, grossTaxesDue);
        currentVatCredit -= vatCompensatedF24;
    }

    // 3. Istanza Modello TR trimestrale (fine Q1 marzo, Q2 giugno, Q3 settembre; Q4 in dichiarazione annuale)
    let newRefundScheduled = 0;
    const mInYear = ((currentMonth - 1) % 12) + 1;
    const isQuarterEnd = (mInYear === 3 || mInYear === 6 || mInYear === 9 || mInYear === 12);
    if ((mode === 'rimborso' || mode === 'ibrido') && isQuarterEnd && currentVatCredit >= 2582.28) {
        const refundRequest = currentVatCredit;
        if (lagMonths === 0) {
            // Incasso immediato
            vatRefundReceived += refundRequest;
            currentVatCredit = 0;
        } else {
            // Incasso differito: prenotato in pendingRefunds
            newRefundScheduled = refundRequest;
            pendingRefunds.push({ monthDue: currentMonth + lagMonths, amount: refundRequest });
            currentVatCredit = 0;
        }
    }

    // Conservazione: Credito Finale = Iniziale + Netto - Rimborsi Immediati - Prenotati TR - Compensazioni
    const expectedCredit = prevVatCredit + vatPaidCapexOpex - vatCollectedRevenue - (vatRefundReceived - (vatRefundReceived - (lagMonths === 0 ? newRefundScheduled : 0))) - newRefundScheduled - vatCompensatedF24;
    const conservedCheck = Math.abs((currentVatCredit + newRefundScheduled) - (prevVatCredit + netPeriodVat - vatCompensatedF24 - (lagMonths === 0 ? vatRefundReceived : 0))) < 0.05;

    return {
        month: currentMonth,
        vatCreditBeginning: prevVatCredit,
        vatPaidCapexOpex,
        vatCollectedRevenue,
        vatRefundReceived,
        vatCompensatedF24,
        vatCreditEnding: Math.max(0, currentVatCredit),
        pendingRefunds,
        netPeriodVat,
        isConserved: conservedCheck && expectedCredit !== null
    };
}
