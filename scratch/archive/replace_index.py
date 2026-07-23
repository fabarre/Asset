import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"""                    <!-- SEZIONE 5: Contratto Trader & Rete (RID/EIN) -->
                    <details class="border border-slate-800 rounded-xl overflow-hidden">
                        <summary class="flex items-center justify-between bg-slate-900/60 px-3 py-2 cursor-pointer select-none hover:bg-slate-800/60 transition-colors">
                            <span class="flex items-center space-x-2 text-[10px] font-bold text-white uppercase tracking-wider">
                                <i class="fa-solid fa-file-contract text-emerald-400 text-xs"></i>
                                <span>Contratto Trader & Rete (RID/EIN)</span>
                            </span>
                            <i class="fa-solid fa-chevron-down text-slate-500 text-[9px]"></i>
                        </summary>
                        <div class="p-3 space-y-3 bg-slate-950/40">
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-[10px] text-slate-400 mb-1">Tipo Contratto Trader</label>
                                    <select id="plant-trader-contract-type" class="w-full bg-slate-950 border border-slate-700/80 text-white px-2.5 py-1.5 rounded text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
                                        <option value="pun_orario" selected>PUN Orario</option>
                                        <option value="pun_medio">PUN Medio Mensile</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] text-slate-400 mb-1">Spread Trader (€/MWh)</label>
                                    <input type="number" id="plant-trader-spread-eur-mwh" value="0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-[10px] text-slate-400 mb-1">Dispacciamento (€/MWh)</label>
                                    <input type="number" id="plant-trader-disp-eur-mwh" value="0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                </div>
                                <div>
                                    <label class="block text-[10px] text-slate-400 mb-1">Contributo PNRR (%)</label>
                                    <input type="number" id="plant-pnrr-contribution-pct" value="0" step="0.1" min="0" max="40" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                </div>
                            </div>
                            <div class="border-t border-slate-800/60 pt-3 mt-3">
                                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Decadimento Listini Annuo (Anni 2-20)</span>
                                <div class="grid grid-cols-3 gap-2">
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Decadimento RID (%/a)</label>
                                        <input type="number" id="plant-degrade-rid" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Time Shifting (%/a)</label>
                                        <input type="number" id="plant-degrade-timeshifting" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Arbitraggio (%/a)</label>
                                        <input type="number" id="plant-degrade-arbitrage" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </details>"""

replacement = r"""                    <!-- SEZIONE 5: Mercato e Incentivi (RID/FER X) -->
                    <details class="border border-slate-800 rounded-xl overflow-hidden">
                        <summary class="flex items-center justify-between bg-slate-900/60 px-3 py-2 cursor-pointer select-none hover:bg-slate-800/60 transition-colors">
                            <span class="flex items-center space-x-2 text-[10px] font-bold text-white uppercase tracking-wider">
                                <i class="fa-solid fa-file-contract text-emerald-400 text-xs"></i>
                                <span>Mercato e Incentivi</span>
                            </span>
                            <i class="fa-solid fa-chevron-down text-slate-500 text-[9px]"></i>
                        </summary>
                        <div class="p-3 space-y-3 bg-slate-950/40">
                            <div>
                                <label class="block text-[10px] text-slate-400 mb-1">Mercato di Riferimento</label>
                                <select id="plant-market-type" class="w-full bg-slate-950 border border-slate-700/80 text-white px-2.5 py-1.5 rounded text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" onchange="onMarketTypeChange(); recalcPlantKpis();">
                                    <option value="rid" selected>RID GSE (Mercato Libero / PUN)</option>
                                    <option value="fer_x">Decreto FER X (Tariffa Incentivante)</option>
                                </select>
                            </div>

                            <!-- Parametri RID GSE -->
                            <div id="market-params-rid" class="space-y-3 pt-2 border-t border-slate-800/60">
                                <p class="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-2">Parametri Contratto Trader (RID)</p>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block text-[10px] text-slate-400 mb-1">Tipo Contratto Trader</label>
                                        <select id="plant-trader-contract-type" class="w-full bg-slate-950 border border-slate-700/80 text-white px-2.5 py-1.5 rounded text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
                                            <option value="pun_orario" selected>PUN Orario</option>
                                            <option value="pun_medio">PUN Medio Mensile</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] text-slate-400 mb-1">Spread Trader (€/MWh)</label>
                                        <input type="number" id="plant-trader-spread-eur-mwh" value="0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block text-[10px] text-slate-400 mb-1">Dispacciamento (€/MWh)</label>
                                        <input type="number" id="plant-trader-disp-eur-mwh" value="0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] text-slate-400 mb-1">Contributo PNRR (%)</label>
                                        <input type="number" id="plant-pnrr-contribution-pct" value="0" step="0.1" min="0" max="40" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Parametri FER X -->
                            <div id="market-params-ferx" class="hidden space-y-3 pt-2 border-t border-slate-800/60">
                                <p class="text-[9px] text-sky-500 uppercase tracking-widest font-bold mb-2">Parametri Decreto FER X</p>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block text-[10px] text-slate-400 mb-1">Tariffa di Aggiudicazione (€/MWh)</label>
                                        <input type="number" id="plant-ferx-tariff" value="85" step="0.1" class="w-full bg-slate-950 border border-sky-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none">
                                    </div>
                                </div>
                                <div class="bg-sky-900/20 border border-sky-800/30 rounded-lg p-2.5 mt-2">
                                    <p class="text-[9px] text-slate-400 leading-relaxed">
                                        <strong class="text-sky-400">Nota FER X:</strong> Se selezionato, l'energia immessa in rete (al netto di autoconsumo) verrà valorizzata a questa tariffa fissa (modalità CfD a due vie), garantendo immunità dalla volatilità del PUN zonale.
                                    </p>
                                </div>
                            </div>

                            <div class="border-t border-slate-800/60 pt-3 mt-3">
                                <span class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Decadimento Listini Annuo (Anni 2-20)</span>
                                <div class="grid grid-cols-3 gap-2">
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Decadimento RID (%/a)</label>
                                        <input type="number" id="plant-degrade-rid" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Time Shifting (%/a)</label>
                                        <input type="number" id="plant-degrade-timeshifting" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[9px] text-slate-400 mb-1">Arbitraggio (%/a)</label>
                                        <input type="number" id="plant-degrade-arbitrage" value="2.0" step="0.1" class="w-full bg-slate-950 border border-slate-700/80 rounded px-2.5 py-1.5 text-white font-bold text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </details>"""

if target in content:
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(content.replace(target, replacement))
    print("Success")
else:
    print("Target string not found in index.html")
