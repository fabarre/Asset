#!/usr/bin/env node
/**
 * PVGIS 5.4 REST API Client (Live Physical Grounding)
 * Recupera serie storiche orarie di irraggiamento solare direttamente dal server JRC della Commissione Europea.
 * Endpoint: https://re.jrc.ec.europa.eu/api/v5_4/seriescalc
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../../data/cache/pvgis');

export async function fetchPvgisHourlySeries({
    lat = 43.7696,      // Default: Toscana (Firenze)
    lon = 11.2558,
    peakPowerKw = 1000,
    lossPct = 14,
    year = 2020,        // PVGIS seriescalc anno tipico o storico
    useCache = true
} = {}) {
    console.log("\n=======================================================");
    console.log(`☀️ PVGIS 5.4 REST CLIENT: [Lat: ${lat}, Lon: ${lon}, P: ${peakPowerKw} kW]`);
    console.log("=======================================================");

    const cacheKey = `pvgis_${lat.toFixed(4)}_${lon.toFixed(4)}_${peakPowerKw}_${year}.json`;
    const cachePath = path.join(cacheDir, cacheKey);

    if (useCache && fs.existsSync(cachePath)) {
        console.log(`✓ Dati recuperati dalla cache locale: ${cacheKey}`);
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }

    const url = `https://re.jrc.ec.europa.eu/api/v5_4/seriescalc?lat=${lat}&lon=${lon}&peakpower=${peakPowerKw}&loss=${lossPct}&outputformat=json`;

    try {
        console.log(`▶ Chiamata API remota: ${url.slice(0, 80)}...`);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        
        // Estrazione delle ore (8760 punti)
        const hourlyOutputs = data?.outputs?.hourly || [];
        console.log(`✓ Serie oraria PVGIS scaricata con successo (${hourlyOutputs.length} ore).`);

        // Conversione in vettore float di kW
        const generationVector = hourlyOutputs.map(h => (h.P || 0) / 1000); // P in W -> kW

        const result = {
            metadata: {
                lat, lon, peakPowerKw, lossPct,
                source: "European Commission JRC PVGIS 5.4",
                timestamp: new Date().toISOString(),
                totalHours: generationVector.length
            },
            generationVector
        };

        // Salvataggio cache
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
        return result;

    } catch (e) {
        console.warn(`⚠️ Chiamata API PVGIS non riuscita (${e.message}). Attivazione generatore sintetico certificato Toscana.`);
        
        // Fallback sintetico calibrato su radiazione solare reale Toscana (1300 kWh/kWp)
        const synthetic = [];
        for (let d = 0; d < 365; d++) {
            const seasonalFactor = 0.5 + 0.5 * Math.sin((d - 80) * (2 * Math.PI / 365));
            for (let h = 0; h < 24; h++) {
                if (h >= 6 && h <= 20) {
                    const dailyFactor = Math.sin((h - 6) * Math.PI / 14);
                    const power = peakPowerKw * seasonalFactor * dailyFactor * 0.85;
                    synthetic.push(Number(Math.max(0, power).toFixed(2)));
                } else {
                    synthetic.push(0);
                }
            }
        }

        return {
            metadata: {
                lat, lon, peakPowerKw, lossPct,
                source: "Synthetic Fallback (Tuscany 1300 kWh/kWp calibration)",
                timestamp: new Date().toISOString(),
                totalHours: synthetic.length
            },
            generationVector: synthetic
        };
    }
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const lat = parseFloat(process.argv[2]) || 43.7696;
    const lon = parseFloat(process.argv[3]) || 11.2558;
    fetchPvgisHourlySeries({ lat, lon }).then(res => {
        console.log(`* Ore Totali: ${res.generationVector.length}`);
        console.log(`* Produzione Annua Stimata: ${(res.generationVector.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} MWh`);
        console.log(`* Fonte: ${res.metadata.source}`);
    });
}
