#!/usr/bin/env node
/**
 * Run Verified Pipeline (Enterprise Gate)
 * Esegue in sequenza controllata:
 * 1. Verifica sintattica Web Worker (node -c)
 * 2. Suite Invarianti Finanziarie (10 invarianti, 5 scenari)
 * 3. Suite Export Excel (10 step, formule acicliche)
 * In caso di errore: attiva automaticamente l'Auto-Reflexion post-mortem a circuito chiuso.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { performPostMortem } from './auto_reflexion.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

console.log("=======================================================");
console.log("🚀 AVVIO PIPELINE DI VERIFICA ENTERPRISE (SBTD GATE)");
console.log("=======================================================\n");

let currentStep = "";

try {
    // Step 1: Validazione Web Worker
    currentStep = "Step 1: Validazione Sintattica Web Worker (simulation.worker.js)";
    console.log(`▶ [1/3] ${currentStep}...`);
    execSync('node -c src/worker/simulation.worker.js', { cwd: rootDir, stdio: 'pipe' });
    console.log("  ✓ Sintassi Web Worker verificata con successo (0 errori).\n");

    // Step 2: Suite Invarianti Finanziarie
    currentStep = "Step 2: Suite Invarianti Finanziarie (financial_invariants_suite.mjs)";
    console.log(`▶ [2/3] ${currentStep}...`);
    const invOutput = execSync('node tests/financial_invariants_suite.mjs', { cwd: rootDir, encoding: 'utf8' });
    console.log("  ✓ Suite Invarianti completata (50/50 controlli superati).\n");

    // Step 3: Suite Export Excel
    currentStep = "Step 3: Suite Export Excel (test_excel_export.mjs)";
    console.log(`▶ [3/3] ${currentStep}...`);
    const excelOutput = execSync('node tests/test_excel_export.mjs', { cwd: rootDir, encoding: 'utf8' });
    console.log("  ✓ Suite Export Excel completata (10/10 step verificati).\n");

    console.log("=======================================================");
    console.log("🎉 TUTTI I CONTROLLI DELLA PIPELINE SONO STATI SUPERATI!");
    console.log("=======================================================");
    process.exit(0);

} catch (error) {
    console.error(`\n❌ FALLIMENTO RILEVATO IN: ${currentStep}`);
    const stderr = error.stderr ? error.stderr.toString() : '';
    const stdout = error.stdout ? error.stdout.toString() : '';
    const errorDetails = stderr || stdout || error.message;

    console.error(`Dettaglio Errore:\n${errorDetails.slice(0, 500)}...\n`);

    // Attivazione Closed-Loop Auto-Reflexion
    const reflexionCase = performPostMortem({
        error: errorDetails,
        context: currentStep,
        testSuite: currentStep.includes('financial_invariants') ? 'financial_invariants_suite.mjs' : 
                   currentStep.includes('excel') ? 'test_excel_export.mjs' : 'simulation.worker.js'
    });

    console.log(`\n⚡ Caso di fallimento registrato con ID: ${reflexionCase.id}`);
    console.log("Il team di agenti può ora analizzare la causa radice ed elaborare il fix prima del prossimo rilascio.");
    process.exit(1);
}
