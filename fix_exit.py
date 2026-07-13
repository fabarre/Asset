import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the specific block in index.html
old_block = '''<div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[11px] text-slate-400 mb-1">Multiplo EBITDA Exit (x)</label>
                                <input type="number" id="input-exit-multiple" value="8.0" step="0.5" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-amber-400 font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-[11px] text-slate-400 mb-1">Aliquota Tasse PEX (%)</label>
                                <input type="number" id="input-pex-rate" value="1.2" step="0.1" disabled class="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-500 font-bold text-xs cursor-not-allowed outline-none">
                            </div>
                        </div>'''

new_block = '''<div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-[11px] text-slate-400 mb-1">Moltiplicatore EBITDA</label>
                                <input type="number" id="input-exit-multiple" value="8.0" step="0.1" oninput="window.syncExitFields('multiple')" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-amber-400 font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-[11px] text-slate-400 mb-1">Valore Vendita (&#8364;/MWp)</label>
                                <input type="number" id="input-exit-value-mwp" value="0" step="1000" oninput="window.syncExitFields('mwpVal')" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                            </div>
                            <div>
                                <label class="block text-[11px] text-slate-400 mb-1">Enterprise Value (&#8364;)</label>
                                <input type="number" id="input-exit-ev" value="0" step="10000" oninput="window.syncExitFields('ev')" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                            </div>
                        </div>'''

# We need to find the exact existing block, whitespace might differ. So let's use regex.
import re
pattern = re.compile(r'<div class="grid grid-cols-2 gap-4">\s*<div>\s*<label class="block text-\[11px\] text-slate-400 mb-1">Multiplo EBITDA Exit \(x\)</label>[\s\S]*?<label class="block text-\[11px\] text-slate-400 mb-1">Aliquota Tasse PEX \(%\)</label>[\s\S]*?</div>\s*</div>')
html = pattern.sub(new_block, html)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

with open('src/main.js', 'r', encoding='utf-8') as f:
    js = f.read()

# 1. Update State parsing
js = js.replace("p.exitMultiple = parseFloat(getVal('input-exit-multiple')) || 8.0;", "p.exitMultiple = parseFloat(getVal('input-exit-multiple')) || 8.0;\n            p.exitValuePerMwp = parseFloat(getVal('input-exit-value-mwp')) || 0;\n            p.exitEnterpriseValue = parseFloat(getVal('input-exit-ev')) || 0;")

# 2. Update setVal
js = js.replace("setVal('input-exit-multiple', p.exitMultiple !== undefined ? p.exitMultiple : 8.0);", "setVal('input-exit-multiple', p.exitMultiple !== undefined ? p.exitMultiple : 8.0);\n            setVal('input-exit-value-mwp', p.exitValuePerMwp);\n            setVal('input-exit-ev', p.exitEnterpriseValue);")

# 3. Add to syncConfigToSupabase paramMap
js = js.replace("'exitMultiple': { id: 'input-exit-multiple', mult: 1 },", "'exitMultiple': { id: 'input-exit-multiple', mult: 1 },\n                        'exitValuePerMwp': { id: 'input-exit-value-mwp', mult: 1 },\n                        'exitEnterpriseValue': { id: 'input-exit-ev', mult: 1 },")

# 4. Add to sweepInputs
js = js.replace("'input-holdco-capital', 'input-exit-multiple'", "'input-holdco-capital', 'input-exit-multiple', 'input-exit-value-mwp', 'input-exit-ev'")

# 5. Add window.syncExitFields
sync_fn = '''
window.syncExitFields = function(source) {
    if (!window.State || !window.State.inputs) return;
    let p = window.State.inputs;
    
    let ebitdaExit = 0;
    let exitYear = parseInt(document.getElementById('select-exit-option').value);
    if(isNaN(exitYear)) exitYear = 20;
    
    if (window.State.results && window.State.results.pnl && window.State.results.pnl.ebitda) {
        if(exitYear > 0 && exitYear <= 20) {
            ebitdaExit = window.State.results.pnl.ebitda[exitYear - 1] || 0;
        }
    }
    
    let mwp = parseFloat(document.getElementById('input-plant-size').value) || p.plantSystemSize || 0;
    
    let multipleEl = document.getElementById('input-exit-multiple');
    let evEl = document.getElementById('input-exit-ev');
    let mwpValEl = document.getElementById('input-exit-value-mwp');
    
    if (!multipleEl || !evEl || !mwpValEl) return;
    
    if (source === 'multiple') {
        let multiple = parseFloat(multipleEl.value) || 0;
        let ev = ebitdaExit * multiple;
        evEl.value = Math.round(ev);
        if (mwp > 0) mwpValEl.value = Math.round(ev / mwp);
    } else if (source === 'ev') {
        let ev = parseFloat(evEl.value) || 0;
        if (ebitdaExit > 0) multipleEl.value = (ev / ebitdaExit).toFixed(2);
        if (mwp > 0) mwpValEl.value = Math.round(ev / mwp);
    } else if (source === 'mwpVal') {
        let mwpVal = parseFloat(mwpValEl.value) || 0;
        let ev = mwpVal * mwp;
        evEl.value = Math.round(ev);
        if (ebitdaExit > 0) multipleEl.value = (ev / ebitdaExit).toFixed(2);
    } else if (source === 'render') {
        let multiple = parseFloat(multipleEl.value) || 0;
        let ev = ebitdaExit * multiple;
        evEl.value = Math.round(ev);
        if (mwp > 0) mwpValEl.value = Math.round(ev / mwp);
    }
};
'''

# Add at the bottom of main.js if not there
if "window.syncExitFields" not in js:
    js += "\n" + sync_fn

# 6. Call syncExitFields in renderUI
js = js.replace("function renderUI() {", "function renderUI() {\n            window.syncExitFields('render');")

with open('src/main.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('Done')
