const fs = require('fs');
const file = 'C:/Users/Utente/ASSET/src/main.js';
let content = fs.readFileSync(file, 'utf8');

// Fix right arrows
content = content.replace(/→/g, '->');

// Add spvLockedDividends to _repRendicontoFinanziario and format negatively for the HoldCo rows
content = content.replace(
    /\{\s*key:\s*'holdcoInterestReceived',\s*label:\s*'\(-?\) Interessi Soci -?> HoldCo'\s*\},/g,
    "{ key: 'holdcoInterestReceived', label: '(-) Interessi Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },"
);

content = content.replace(
    /\{\s*key:\s*'holdcoLoanRepaymentReceived',\s*label:\s*'\(-?\) Rimborso Capitale Soci -?> HoldCo'\s*\},/g,
    "{ key: 'holdcoLoanRepaymentReceived', label: '(-) Rimborso Capitale Soci -> HoldCo', fmt: v => _fmtEFull(-Math.abs(v)) },\n        { key: 'spvLockedDividends', label: '  (+) Cassa SPV Vincolata Accumulata da Anni Precedenti' },"
);

content = content.replace(
    /\{\s*key:\s*'holdcoDividendReceived',\s*label:\s*'\(-?\) Dividendi -?> HoldCo \(quota Sponsor\)'\s*\},/g,
    "{ key: 'holdcoDividendReceived', label: '(-) Dividendi -> HoldCo (quota Sponsor)', fmt: v => _fmtEFull(-Math.abs(v)) },"
);

// We should also replace the spaces if the original had them somehow, but the original text from Select-String is:
// { key: 'holdcoInterestReceived', label: '(-) Interessi Soci -> HoldCo' } (we already replaced unicode dashes)
// Let's do another pass just in case
content = content.replace(/Interessi Soci   HoldCo/g, "Interessi Soci -> HoldCo");
content = content.replace(/Rimborso Capitale Soci   HoldCo/g, "Rimborso Capitale Soci -> HoldCo");
content = content.replace(/Dividendi   HoldCo/g, "Dividendi -> HoldCo");

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed file.');
