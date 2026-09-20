#!/usr/bin/env node
/**
 * Auto-Reflexion & Autonomous Memory Manager (Enterprise Grade)
 * Registra ed estende la memoria episodica e procedurale dell'Harness Multi-Agentico a circuito chiuso.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const memoryDir = path.resolve(__dirname, '../memory');
const caseHistoryPath = path.join(memoryDir, 'episodic_case_history.json');
const learnedRulesPath = path.join(memoryDir, 'learned_rules.md');

function loadCaseHistory() {
    if (!fs.existsSync(caseHistoryPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(caseHistoryPath, 'utf8'));
    } catch (e) {
        console.error("Errore nel parsing di episodic_case_history.json:", e);
        return [];
    }
}

function saveCaseHistory(cases) {
    fs.writeFileSync(caseHistoryPath, JSON.stringify(cases, null, 2) + '\n', 'utf8');
}

export function recordCase({ id, domain, title, symptom, root_cause, invariant_violated, fix_description, test_reference, error_type }) {
    const cases = loadCaseHistory();
    const caseId = id || `CASE-${new Date().toISOString().slice(0, 10)}-${(domain || 'GEN').toUpperCase()}-${cases.length + 1}`;
    const newEntry = {
        id: caseId,
        timestamp: new Date().toISOString(),
        domain: domain || 'general',
        error_type: error_type || classifyError(symptom || root_cause),
        title: title || 'Caso non titolato',
        symptom: symptom || '',
        root_cause: root_cause || '',
        invariant_violated: invariant_violated || '',
        fix_description: fix_description || '',
        test_reference: test_reference || ''
    };
    cases.push(newEntry);
    saveCaseHistory(cases);
    console.log(`✓ [Reflexion] Caso registrato in memoria episodica: [${caseId}] ${title}`);
    return newEntry;
}

export function classifyError(text = '') {
    const str = String(text).toLowerCase();
    if (str.includes('syntaxerror') || str.includes('unexpected token') || str.includes('node -c')) {
        return 'SYNTAX_ERROR';
    }
    if (str.includes('inv-') || str.includes('invariante') || str.includes('failed')) {
        return 'INVARIANT_ERROR';
    }
    if (str.includes('circular') || str.includes('formula') || str.includes('exceljs') || str.includes('#value!')) {
        return 'CIRCULAR_FORMULA_ERROR';
    }
    if (str.includes('nan') || str.includes('infinity') || str.includes('discrepanza')) {
        return 'DATA_DRIFT_ERROR';
    }
    if (str.includes('iva') || str.includes('tuir') || str.includes('ires') || str.includes('irap') || str.includes('tide')) {
        return 'SEMANTIC_ERROR';
    }
    return 'PROCEDURAL_ERROR';
}

export function appendLearnedRule({ ruleId, ruleTitle, ruleContent, triggerEvent }) {
    if (!fs.existsSync(learnedRulesPath)) {
        fs.writeFileSync(learnedRulesPath, '# Learned Procedural Rules (Auto-Reflexion)\n\n', 'utf8');
    }
    const currentRules = fs.readFileSync(learnedRulesPath, 'utf8');
    if (currentRules.includes(ruleId)) {
        console.log(`ℹ Regola già presente in learned_rules.md: ${ruleId}`);
        return;
    }

    const ruleBlock = `\n## Regola: ${ruleTitle}\n- **ID**: \`${ruleId}\`\n- **Trigger Event**: ${triggerEvent || 'Test Failure / Anomaly'}\n- **Data Registrazione**: ${new Date().toISOString()}\n- **Prescrizione Procedurale**:\n  ${ruleContent.split('\n').join('\n  ')}\n`;

    fs.appendFileSync(learnedRulesPath, ruleBlock, 'utf8');
    console.log(`✓ [Reflexion] Nuova regola procedurale consolidata in learned_rules.md: ${ruleId}`);
}

export function performPostMortem({ error, context = '', testSuite = '' }) {
    console.log("\n=======================================================");
    console.log("⚡ INIZIO POST-MORTEM AUTO-REFLEXION A CIRCUITO CHIUSO");
    console.log("=======================================================");
    const errMsg = error?.message || String(error);
    const errType = classifyError(errMsg + ' ' + context);

    console.log(`* Tipo Errore Identificato: [${errType}]`);
    console.log(`* Contesto Operativo: ${context || 'Test Suite Execution'}`);
    console.log(`* Dettaglio Errore: ${errMsg.slice(0, 300)}`);

    const newCase = recordCase({
        domain: errType === 'SEMANTIC_ERROR' ? 'fiscal_or_energy' : 'code_and_execution',
        error_type: errType,
        title: `Auto-Detected: ${errMsg.slice(0, 80)}`,
        symptom: errMsg,
        root_cause: `Fallimento automatico rilevato durante l'esecuzione di ${testSuite || 'pipeline di verifica'}. Context: ${context}`,
        invariant_violated: errMsg.match(/INV-\d+/)?.[0] || 'N/A',
        fix_description: 'Richiesta investigazione specialistica e revisione invarianti.',
        test_reference: testSuite
    });

    return newCase;
}

export function auditMemoryIntegrity() {
    const cases = loadCaseHistory();
    console.log(`\n=== AUDIT MEMORIA EPISODICA (${cases.length} casi archiviati) ===`);
    const domains = {};
    const types = {};
    cases.forEach(c => {
        domains[c.domain] = (domains[c.domain] || 0) + 1;
        types[c.error_type || 'unclassified'] = (types[c.error_type || 'unclassified'] || 0) + 1;
        console.log(`  - [${c.id}] (${c.domain} | ${c.error_type || 'N/A'}) ${c.title}`);
    });
    console.log('\nRiepilogo per Dominio:');
    Object.entries(domains).forEach(([dom, count]) => {
        console.log(`  * ${dom}: ${count} casi`);
    });
    console.log('\nRiepilogo per Tipologia di Errore:');
    Object.entries(types).forEach(([t, count]) => {
        console.log(`  * ${t}: ${count} casi`);
    });
    const rulesExist = fs.existsSync(learnedRulesPath);
    console.log(`\nStato Memoria Procedurale (learned_rules.md): ${rulesExist ? 'PRESENTE' : 'ASSENTE'}`);
    return { count: cases.length, domains, types };
}

// CLI direct run
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    auditMemoryIntegrity();
}
