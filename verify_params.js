const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const mainJs = fs.readFileSync('src/main.js', 'utf8');

const idRegex = /id="(input-|slide-|select-)([^"]+)"/g;
const idsInHtml = new Set();
let match;
while ((match = idRegex.exec(html)) !== null) {
    idsInHtml.add(match[1] + match[2]);
}

const jsIdsRegex = /id:\s*'((?:input|slide|select)-[^']+)'/g;
const idsInJs = new Set();
while ((match = jsIdsRegex.exec(mainJs)) !== null) {
    idsInJs.add(match[1]);
}

const getNumRegex = /getNum\('((?:input|slide|select)-[^']+)'/g;
const getValRegex = /getVal\('((?:input|slide|select)-[^']+)'/g;
const setValRegex = /setVal\('((?:input|slide|select)-[^']+)'/g;
const getCheckedRegex = /document\.getElementById\('((?:input)-[^']+)'\)\.checked/g;

const mappedInStateFromDOM = new Set();
while ((match = getNumRegex.exec(mainJs)) !== null) mappedInStateFromDOM.add(match[1]);
while ((match = getValRegex.exec(mainJs)) !== null) mappedInStateFromDOM.add(match[1]);
while ((match = setValRegex.exec(mainJs)) !== null) mappedInStateFromDOM.add(match[1]);
while ((match = getCheckedRegex.exec(mainJs)) !== null) mappedInStateFromDOM.add(match[1]);

// What is in HTML but not in domMap?
const missingInJs = [...idsInHtml].filter(id => !idsInJs.has(id));

// Filter out those that are clearly not simulation config (e.g. stab-, plant-, cer-)
const missingSimulationConfig = missingInJs.filter(id => {
    return !id.startsWith('input-stab-') && 
           !id.startsWith('input-plant-') &&
           !id.startsWith('select-plant-') &&
           !id.startsWith('select-stab-') &&
           !id.startsWith('input-cer-') &&
           !id.startsWith('slide-cer-') &&
           !id.startsWith('select-cer-');
});

console.log('IDs in HTML (Global Config) but missing in domMap:');
console.log(missingSimulationConfig);

// Are there any that are mapped in syncStateFromDOM but NOT in domMap?
const mappedButNotInDomMap = [...mappedInStateFromDOM].filter(id => !idsInJs.has(id));
console.log('\nIDs mapped in syncStateFromDOM/setVal but missing in domMap:');
console.log(mappedButNotInDomMap);

