#!/usr/bin/env node
/**
 * Tiered Context-Aware Memory Router
 * Seleziona e inietta dinamicamente la partizione di memoria (semantica, episodica, procedurale)
 * rilevante per ciascun subagente, prevenendo sovraccarico cognitivo e allucinazioni.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const memoryDir = path.resolve(__dirname, '../memory');

const semanticPath = path.join(memoryDir, 'semantic_grounding.md');
const episodicPath = path.join(memoryDir, 'episodic_case_history.json');
const learnedPath = path.join(memoryDir, 'learned_rules.md');

function loadJson(p) {
    if (!fs.existsSync(p)) return [];
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return [];
    }
}

function loadText(p) {
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
}

export function routeMemoryForAgent(agentRole = 'all') {
    const semanticText = loadText(semanticPath);
    const episodicCases = loadJson(episodicPath);
    const learnedText = loadText(learnedPath);

    const role = agentRole.toLowerCase();

    // 1. Filtraggio Memoria Semantica
    let semanticSlice = semanticText;
    if (role.includes('energy')) {
        const match = semanticText.match(/## 3\. Fisica del Fotovoltaico[\s\S]*/);
        semanticSlice = match ? match[0] : semanticText;
    } else if (role.includes('fisc')) {
        const match = semanticText.match(/## 1\. Disciplina Fiscale[\s\S]*?(?=## 2\.|$)/);
        semanticSlice = match ? match[0] : semanticText;
    } else if (role.includes('finan')) {
        const match = semanticText.match(/## 2\. Bancabilità[\s\S]*?(?=## 3\.|$)/);
        semanticSlice = match ? match[0] : semanticText;
    }

    // 2. Filtraggio Memoria Episodica
    let filteredCases = episodicCases;
    if (role.includes('energy')) {
        filteredCases = episodicCases.filter(c => (c.domain || '').includes('energy') || (c.domain || '').includes('physic'));
    } else if (role.includes('fisc') || role.includes('tax')) {
        filteredCases = episodicCases.filter(c => (c.domain || '').includes('tax') || (c.domain || '').includes('fisc'));
    } else if (role.includes('finan') || role.includes('debt')) {
        filteredCases = episodicCases.filter(c => (c.domain || '').includes('finan') || (c.domain || '').includes('debt'));
    } else if (role.includes('code') || role.includes('excel')) {
        filteredCases = episodicCases.filter(c => (c.domain || '').includes('excel') || (c.domain || '').includes('code') || c.error_type === 'SYNTAX_ERROR' || c.error_type === 'PROCEDURAL_ERROR');
    }

    // 3. Statistiche e output
    return {
        role,
        semanticLengthChars: semanticSlice.length,
        relevantCasesCount: filteredCases.length,
        cases: filteredCases.map(c => `[${c.id}] ${c.title}`),
        semanticExcerpt: semanticSlice.slice(0, 300) + '...'
    };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const targetRole = process.argv[2] || 'all';
    const res = routeMemoryForAgent(targetRole);
    console.log("=======================================================");
    console.log(`🧭 TIERED MEMORY ROUTER: [${res.role.toUpperCase()}]`);
    console.log("=======================================================");
    console.log(`* Dimensione Semantica Filtrata: ${res.semanticLengthChars} caratteri`);
    console.log(`* Casi Episodici Rilevanti:       ${res.relevantCasesCount}`);
    if (res.cases.length > 0) {
        console.log("  Casi:");
        res.cases.forEach(c => console.log(`  - ${c}`));
    }
    console.log(`\n* Estratto Semantico:\n${res.semanticExcerpt}`);
    console.log("=======================================================");
}
