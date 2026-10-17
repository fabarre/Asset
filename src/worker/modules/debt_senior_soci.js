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
        const beginBal = currentBalance;
        let principalRepayment = 0;
        let interestPayment = 0;

        if (m <= gracePeriodMonths) {
            if (m % frequencyMonths === 0 || frequencyMonths === 1) {
                interestPayment = beginBal * periodicRate;
            }
        } else {
            if ((m - gracePeriodMonths) % frequencyMonths === 0) {
                interestPayment = beginBal * periodicRate;
                const isLastPeriod = (m + frequencyMonths > totalMonths);
                principalRepayment = isLastPeriod
                    ? beginBal
                    : Math.min(beginBal, Math.max(0, periodicPmt - interestPayment));
                currentBalance = Math.max(0, beginBal - principalRepayment);
            }
        }

        schedule.push({
            month: m,
            beginningBalance: beginBal,
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
