/**
 * Micro-Kernel Module: Physics & Solar Generation
 * Dominio di competenza: energy_expert
 */

export const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];

export function getMonthOfHour(t) {
    for (let m = 0; m < 12; m++) {
        if (t >= monthStartHours[m] && t < monthStartHours[m + 1]) return m;
    }
    return 11;
}

export function parseCodDate(codDate) {
    if (!codDate) return null;
    const s = String(codDate).slice(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
}

export function getPlantActiveHourRange(cod, calYear) {
    if (!cod || calYear === null || calYear === undefined) {
        return { hStart: 0, hEnd: 8760, isActive: true, isFullYear: true };
    }
    if (calYear < cod.y) {
        return { hStart: 8760, hEnd: 8760, isActive: false, isFullYear: false };
    }
    if (calYear > cod.y) {
        return { hStart: 0, hEnd: 8760, isActive: true, isFullYear: true };
    }
    const m = Math.max(1, Math.min(12, cod.m));
    const d = Math.max(1, Math.min(31, cod.d));
    const hStart = Math.min(8760, Math.max(0, monthStartHours[m - 1] + (d - 1) * 24));
    return {
        hStart,
        hEnd: 8760,
        isActive: hStart < 8760,
        isFullYear: hStart === 0
    };
}

export function generateDefaultSolarProfile(capacityMw = 1, yieldKwhKwp = 1300) {
    const profile = new Float64Array(8760);
    let totalUnitGen = 0;
    for (let hourIndex = 0; hourIndex < 8760; hourIndex++) {
        const dayOfYear = Math.floor(hourIndex / 24);
        const hourOfDay = hourIndex % 24;
        const seasonFactor = 1.0 + 0.35 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
        const sunrise = 6 - Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
        const sunset = 18 + Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);

        if (hourOfDay >= sunrise && hourOfDay <= sunset) {
            const peakFactor = Math.sin(Math.PI * (hourOfDay - sunrise) / (sunset - sunrise));
            const gen = peakFactor * seasonFactor;
            profile[hourIndex] = gen;
            totalUnitGen += gen;
        } else {
            profile[hourIndex] = 0;
        }
    }
    const targetTotalGenKwh = capacityMw * 1000 * yieldKwhKwp;
    const scaleFactor = totalUnitGen > 0 ? (targetTotalGenKwh / totalUnitGen) : 0;
    for (let i = 0; i < 8760; i++) {
        profile[i] *= scaleFactor;
    }
    return profile;
}
