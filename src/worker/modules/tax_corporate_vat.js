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

    // 3. Istanza Modello TR trimestrale (fine marzo, giugno, settembre)
    let newRefundScheduled = 0;
    const isQuarterEnd = currentMonth % 3 === 0;
    if ((mode === 'rimborso' || mode === 'ibrido') && isQuarterEnd && currentVatCredit > 2582.28) {
        const refundRequest = currentVatCredit;
        if (lagMonths === 0) {
            // Incasso immediato
            vatRefundReceived += refundRequest;
            currentVatCredit = 0;
        } else {
            // Incasso differito: il credito si decurta solo all'effettivo accredito
            newRefundScheduled = refundRequest;
            pendingRefunds.push({ monthDue: currentMonth + lagMonths, amount: refundRequest });
            currentVatCredit = 0;
        }
    }

    // Conservazione: Credito Finale = Iniziale + Netto - Rimborsi - Compensazioni
    const expectedCredit = prevVatCredit + vatPaidCapexOpex - vatCollectedRevenue - vatRefundReceived - vatCompensatedF24;

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
        isConserved: Math.abs(currentVatCredit - expectedCredit) < 0.05
    };
}
