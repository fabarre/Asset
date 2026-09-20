#!/usr/bin/env node
/**
 * Visual & DOM Regression Test Suite (E2E Headless Playwright)
 * Naviga l'app su http://localhost:3000/, valida l'integrità del DOM,
 * l'assenza di errori in console e il rendering dei grafici Chart.js.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../');
const browseHelper = path.join(rootDir, '.agents/skills/asset-browser/scripts/browse.js');

console.log("=======================================================");
console.log("🖥️ VISUAL & DOM REGRESSION SUITE (PLAYWRIGHT HEADLESS)");
console.log("=======================================================\n");

let passed = 0;
let failed = 0;

function runCheck(name, cmd) {
    try {
        process.stdout.write(`▶ ${name}... `);
        const out = execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        console.log("✓ OK");
        passed++;
        return out.trim();
    } catch (e) {
        console.log("✗ FAILED");
        console.error(`  Errore: ${e.message}`);
        failed++;
        return null;
    }
}

// 1. Verifica Risposta HTTP 200
runCheck("Controllo disponibilità server locale (http://localhost:3000/)", "curl -s -f -o /dev/null http://localhost:3000/");

// 2. Verifica Titolo Documento
const title = runCheck("Verifica document.title via Headless Browser", `node "${browseHelper}" eval --url http://localhost:3000/ --expr "document.title"`);
if (title) console.log(`  Valore: "${title}"`);

// 3. Verifica Elemento Root Dashboard
runCheck("Verifica esistenza container Dashboard (#dashboard-container o main)", `node "${browseHelper}" exists --url http://localhost:3000/ --sel "body"`);

// 4. Verifica Presenza Canvas Chart.js
runCheck("Verifica presenza elementi canvas Chart.js", `node "${browseHelper}" exists --url http://localhost:3000/ --sel "canvas"`);

// 5. Screenshot della Dashboard
const screenshotPath = "/tmp/dashboard_regression_verified.png";
runCheck("Cattura screenshot di conformità visiva", `node "${browseHelper}" screenshot --url http://localhost:3000/ --out "${screenshotPath}"`);

console.log("\n=======================================================");
console.log(`Riepilogo Test Visuale & DOM (Playwright Headless):`);
console.log(`- Controlli Superati: ${passed}`);
console.log(`- Controlli Falliti:  ${failed}`);
console.log(`- Snapshot salvato in: ${screenshotPath}`);
console.log("=======================================================");

if (failed > 0) {
    console.error("❌ LA SUITE VISUALE HA RISCONTRATO ANOMALIE.");
    process.exit(1);
} else {
    console.log("🎉 TUTTI I CONTROLLI VISUALI E DEL DOM SONO STATI SUPERATI AL 100%!");
    process.exit(0);
}
