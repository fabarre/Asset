/**
 * Micro-Kernel Module: Senior Debt & Subordinated Debt (Soci)
 * Dominio di competenza: finance_modeler
 */

export function calculateFrenchAnnuity(principal, annualRate, periods) {
    if (periods <= 0 || principal <= 0) return 0;
    if (annualRate <= 0) return principal / periods;
    const r = annualRate;
    return principal * (r * Math.pow(1 + r, periods)) / (Math.pow(1 + r, periods) - 1);
}

export function calculateMonthlyInterestAct360(principal, annualRate, daysInMonth = 30) {
    if (principal <= 0 || annualRate <= 0) return 0;
    return principal * annualRate * (daysInMonth / 360);
}

export function generateSeniorDebtSchedule({
    principalInitial = 1000000,
    annualRate = 0.045,
    loanTermYears = 15,
    gracePeriodMonths = 12,
    frequencyMonths = 12 // annuale o mensile
}) {
    const schedule = [];
    let currentBalance = principalInitial;
    const totalMonths = loanTermYears * 12;
    const amortizationMonths = Math.max(1, totalMonths - gracePeriodMonths);
    const periods = Math.ceil(amortizationMonths / frequencyMonths);
    const periodicRate = annualRate * (frequencyMonths / 12);
    const periodicPmt = calculateFrenchAnnuity(currentBalance, periodicRate, periods);

    for (let m = 1; m <= totalMonths; m++) {
        let principalRepayment = 0;
        let interestPayment = calculateMonthlyInterestAct360(currentBalance, annualRate, 30);

        if (m > gracePeriodMonths) {
            // Fuori dalla grazia: rimborso quota capitale alla frequenza stabilita
            if ((m - gracePeriodMonths) % frequencyMonths === 0) {
                principalRepayment = Math.min(currentBalance, periodicPmt - (currentBalance * periodicRate));
                currentBalance = Math.max(0, currentBalance - principalRepayment);
            }
        }

        schedule.push({
            month: m,
            beginningBalance: currentBalance + principalRepayment,
            principalRepayment,
            interestPayment,
            debtService: principalRepayment + interestPayment,
            endingBalance: currentBalance,
            isGracePeriod: m <= gracePeriodMonths
        });
    }

    return schedule;
}

export function calculateDSCR(cfads, debtService) {
    if (debtService <= 0) return cfads >= 0 ? 999 : 0;
    return cfads / debtService;
}
