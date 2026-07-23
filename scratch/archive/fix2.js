const fs = require('fs');
const file = 'C:/Users/Utente/ASSET/src/main.js';
let content = fs.readFileSync(file, 'utf8');

// Replace unicode minus signs and em-dashes
content = content.replace(/−/g, '-');
content = content.replace(/—/g, '-');

// Replace missing negative values in _repPianoAmmortamentoInline
content = content.replace(/\['\(-?\) Interessi Maturati', \.\.\.years\.map\(\(_, i\) => fmt\(d\.interestAccrued\[i\] \|\| 0\)\)\]/g, "['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccrued[i] || 0)))]");
content = content.replace(/\['\(-?\) Quota Capitale Programmata', \.\.\.years\.map\(\(_, i\) => fmt\(d\.principalScheduled\[i\] \|\| 0\)\)\]/g, "['(-) Quota Capitale Programmata', ...years.map((_, i) => fmt(-Math.abs(d.principalScheduled[i] || 0)))]");
content = content.replace(/\['\(-?\) Cash Sweep Volontario', \.\.\.years\.map\(\(_, i\) => fmt\(d\.principalVoluntary\[i\] \|\| 0\)\)\]/g, "['(-) Cash Sweep Volontario', ...years.map((_, i) => fmt(-Math.abs(d.principalVoluntary[i] || 0)))]");
content = content.replace(/\['Servizio Debito Effettivo', \.\.\.years\.map\(\(_, i\) => fmt\(d\.totalDebtService\[i\] \|\| 0\)\)\]/g, "['Servizio Debito Effettivo', ...years.map((_, i) => fmt(-Math.abs(d.totalDebtService[i] || 0)))]");

// Sezione 2
content = content.replace(/\['\(-?\) Interessi Maturati', \.\.\.years\.map\(\(_, i\) => fmt\(d\.interestAccruedSoci\[i\] \|\| 0\)\)\]/g, "['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedSoci[i] || 0)))]");
content = content.replace(/\['\(-?\) Rimborso Capitale', \.\.\.years\.map\(\(_, i\) => fmt\(d\.principalPaidSoci\[i\] \|\| 0\)\)\]/g, "['(-) Rimborso Capitale', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidSoci[i] || 0)))]");

// Sezione 3
content = content.replace(/\['\(-?\) Interessi Maturati', \.\.\.years\.map\(\(_, i\) => fmt\(d\.interestAccruedPd\[i\] \|\| 0\)\)\]/g, "['(-) Interessi Maturati', ...years.map((_, i) => fmt(-Math.abs(d.interestAccruedPd[i] || 0)))]");
content = content.replace(/\['\(-?\) Rimborso Capitale \/ Payoff', \.\.\.years\.map\(\(_, i\) => fmt\(d\.principalPaidPd\[i\] \|\| 0\)\)\]/g, "['(-) Rimborso Capitale / Payoff', ...years.map((_, i) => fmt(-Math.abs(d.principalPaidPd[i] || 0)))]");

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed file.');
