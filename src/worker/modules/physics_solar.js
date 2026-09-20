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

export function generateDefaultSolarProfile(capacityMwp = 1, yieldKwhPerKwp = 1300) {
    const profile = new Float64Array(8760);
    const totalTarget = capacityMwp * 1000 * yieldKwhPerKwp;
    let sum = 0;
    for (let d = 0; d < 365; d++) {
        const seasonal = 0.5 + 0.5 * Math.sin((d - 80) * (2 * Math.PI / 365));
        for (let h = 0; h < 24; h++) {
            const idx = d * 24 + h;
            if (h >= 6 && h <= 20) {
                const daily = Math.sin((h - 6) * Math.PI / 14);
                const val = seasonal * daily;
                profile[idx] = Math.max(0, val);
                sum += profile[idx];
            } else {
                profile[idx] = 0;
            }
        }
    }
    const factor = sum > 0 ? totalTarget / sum : 0;
    for (let i = 0; i < 8760; i++) {
        profile[i] *= factor;
    }
    return profile;
}
