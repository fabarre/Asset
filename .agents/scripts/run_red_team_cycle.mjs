#!/usr/bin/env node
/**
 * Run Red-Team Cycle (Autonomous Closed-Loop Adversarial Cycle)
 * Lancia gli attacchi di self-play e, in caso di anomalia, attiva l'auto-reflexion
 * e registra la vulnerabilità per risolverla preventivamente.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { performPostMortem } from './auto_reflexion.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

console.log("=======================================================");
console.log("⚡ AVVIO CICLO DI RED-TEAMING & SELF-PLAY PROATTIVO");
console.log("=======================================================\n");

try {
    const output = execSync('node tests/adversarial_self_play.mjs --iterations 30', {
        cwd: rootDir,
        encoding: 'utf8'
    });
    console.log(output);
    console.log("🎉 Il motore è risultato impenetrabile a tutti i 30 attacchi combinatori!");
    process.exit(0);
} catch (error) {
    console.error("❌ VULNERABILITÀ RILEVATA DURANTE IL RED-TEAMING!");
    const errText = error.stdout || error.stderr || error.message;
    console.error(errText);

    // Attivazione immediata post-mortem
    const episode = performPostMortem({
        error: errText,
        context: 'Adversarial Self-Play Attack',
        testSuite: 'adversarial_self_play.mjs'
    });

    console.log(`\n⚡ Vulnerabilità catturata e registrata: [${episode.id}] ${episode.title}`);
    console.log("La regola e il caso sono stati salvati per il team di sviluppo.");
    process.exit(1);
}
