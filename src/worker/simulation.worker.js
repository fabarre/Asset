// Web Worker per simulazione BESS
let State = null;

const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
function getMonthOfHour(t) {
    for (let m = 0; m < 12; m++) {
        if (t >= monthStartHours[m] && t < monthStartHours[m+1]) return m;
    }
    return 11;
}

self.onmessage = function(e) {
    const { action, payload } = e.data;
    if (action === 'EXECUTE_CALCULATION') {
        try {
            console.log("[Worker] Starting executeCalculation...");
            State = payload.State;
            const results = executeCalculation(State);
            console.log("[Worker] executeCalculation completed.");
            self.postMessage({ status: 'success', results });
        } catch (err) {
            console.error("[Worker] Error in executeCalculation:", err);
            self.postMessage({ status: 'error', error: err.message, stack: err.stack });
        }
    } else if (action === 'EXECUTE_SENSITIVITY') {
        try {
            const results = runSensitivityLoop(payload.State, payload.sensitivityConfig);
            self.postMessage({ status: 'sensitivity_success', results });
        } catch (err) {
            self.postMessage({ status: 'sensitivity_error', error: err.message, stack: err.stack });
        }
    }
};

function deepClone(obj) {
    return structuredClone(obj);
}

function applySensitivityParam(stateClone, varName, variation) {
    if (varName === 'none') return;
    
    switch (varName) {
        case 'capex':
            stateClone.plants.forEach(p => {
                if (p.capex) p.capex = p.capex * (1 + variation / 100);
            });
            break;
        case 'opex':
            stateClone.plants.forEach(p => {
                if (p.opex) p.opex = p.opex * (1 + variation / 100);
            });
            break;
        case 'wacc':
            stateClone.inputs.wacc = stateClone.inputs.wacc + (variation / 100);
            break;
        case 'inflation':
            stateClone.inputs.inflation = stateClone.inputs.inflation + (variation / 100);
            break;
        case 'euribor':
            stateClone.inputs.euribor = stateClone.inputs.euribor + (variation / 100);
            break;
        case 'pd_amount':
            stateClone.inputs.pdAmountValue = Math.max(0, (stateClone.inputs.pdAmountValue || 0) * (1 + variation / 100));
            break;
        case 'pe_amount':
            stateClone.inputs.peAmountValue = Math.max(0, (stateClone.inputs.peAmountValue || 0) * (1 + variation / 100));
            break;
        case 'pun':
            if (stateClone.zonalPun) {
                for (let zone in stateClone.zonalPun) {
                    if (stateClone.zonalPun[zone]) {
                        stateClone.zonalPun[zone] = stateClone.zonalPun[zone].map(p => p * (1 + variation / 100));
                    }
                }
            }
            break;
    }
}

function runSensitivityLoop(baseState, config) {
    const { xVar, xMin, xMax, xSteps, yVar, yMin, yMax, ySteps, targetKpi } = config;
    
    function generateRange(min, max, stepSize) {
        if (stepSize <= 0) return [min];
        const res = [];
        for(let val = min; val <= max + 0.0001; val += stepSize) {
            // Keep precision clean for UI
            res.push(Number(val.toFixed(4)));
        }
        return res;
    }

    const xVals = generateRange(xMin, xMax, xSteps);
    let is2D = (yVar !== 'none');
    let yVals = is2D ? generateRange(yMin, yMax, ySteps) : [0];

    const matrix = [];
    let kpiVals = [];

    for (let i = 0; i < yVals.length; i++) {
        const row = [];
        for (let j = 0; j < xVals.length; j++) {
            let stateClone = deepClone(baseState);
            applySensitivityParam(stateClone, xVar, xVals[j]);
            if (is2D) applySensitivityParam(stateClone, yVar, yVals[i]);
            
            State = stateClone;
            const res = executeCalculation(stateClone);
            
            let val = null;
            if (targetKpi === 'irr') val = res.calculatedIrr;
            else if (targetKpi === 'npv') val = res.holdcoNpv;
            else if (targetKpi === 'dscr_min') val = res.minDscr;
            else if (targetKpi === 'dscr_avg') val = res.avgDscr;
            
            row.push(val);
            if (!is2D) kpiVals.push(val);
        }
        matrix.push(row);
    }
    
    return {
        type: is2D ? '2D' : '1D',
        xVals,
        yVals: is2D ? yVals : null,
        matrix: is2D ? matrix : null,
        kpiVals: !is2D ? kpiVals : null,
        targetKpi,
        config
    };
}

        function simulateBessHourly(solarProfile, punProfile, loadProfile, p) {
            const bessMw = p.bessMw;
            const bessMwh = p.bessMwh;
            const bessEfficiency = p.bessEfficiency;
            const bessType = p.bessType;
            const bessConnection = p.bessConnection || 'ac';
            
            const lossMult = 1 + (p.gridLosses / 100);
            const lossWithdrawMult = 1 + ((p.gridLossesWithdraw || 0) / 100);
            const gseImb = p.gseImbalance;
            const spread = p.traderSpread;
            const disp = p.traderDisp;
            const ppaPrice = p.ppaPrice || 0;
            const marketType = p.marketType || 'rid';
            const ferxTariff = p.ferxTariff !== undefined ? p.ferxTariff : 85;
            
            const hourlySoC = new Float64Array(8760);
            const hourlyCharge = new Float64Array(8760);
            const hourlyDischarge = new Float64Array(8760);
            const hourlyGridFeed = new Float64Array(8760);
            const hourlySelfCons = new Float64Array(8760);
            const hourlyChargeGrid = new Float64Array(8760);
            
            const hourlyChargeSolar = new Float64Array(8760);
            const hourlyDischargeGrid = new Float64Array(8760);
            const hourlyDischargePpa = new Float64Array(8760);
            const hourlySelfConsSolar = new Float64Array(8760);
            const hourlySelfConsBess = new Float64Array(8760);
            const hourlyLossesRte = new Float64Array(8760);
            
            // New physical and economic arrays
            const hourlyGridFeedPv = new Float64Array(8760);
            const hourlyRevenueRidPure = new Float64Array(8760);
            const hourlyRevenueRidActual = new Float64Array(8760);
            const hourlyRevenueArbitrageGrid = new Float64Array(8760);
            const hourlyRevenuePpaPv = new Float64Array(8760);
            const hourlyRevenuePpaBess = new Float64Array(8760);
            const hourlyRevenueTimeshifting = new Float64Array(8760);
            const hourlyCostWithdrawal = new Float64Array(8760);
            const hourlyDischargeArbitrage = new Float64Array(8760);
            const hourlyDischargeTimeshifting = new Float64Array(8760);
            
            if (bessMwh === 0 || bessMw === 0 || bessType === 'none') {
                for (let t = 0; t < 8760; t++) {
                    const solar = solarProfile[t];
                    const load = loadProfile ? loadProfile[t] : 0;
                    const selfCons = Math.min(solar, load);
                    const p_fed_pv = Math.max(0, solar - load);
                    
                    const pricePUN = punProfile[t];
                    const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                    const pricePPA = ppaPrice / 1000;
                    
                    hourlyGridFeed[t] = p_fed_pv;
                    hourlySelfCons[t] = selfCons;
                    hourlySelfConsSolar[t] = selfCons;
                    
                    hourlyGridFeedPv[t] = p_fed_pv;
                    hourlyRevenueRidPure[t] = solar * priceRID;
                    hourlyRevenueRidActual[t] = p_fed_pv * priceRID;
                    hourlyRevenueArbitrageGrid[t] = 0;
                    hourlyRevenuePpaPv[t] = selfCons * pricePPA;
                    hourlyRevenuePpaBess[t] = 0;
                    hourlyRevenueTimeshifting[t] = 0;
                    hourlyCostWithdrawal[t] = 0;
                    hourlyDischargeArbitrage[t] = 0;
                    hourlyDischargeTimeshifting[t] = 0;
                }
                return {
                    hourlySoC,
                    hourlyCharge,
                    hourlyDischarge,
                    hourlyGridFeed,
                    hourlySelfCons,
                    hourlyChargeGrid,
                    hourlyChargeSolar,
                    hourlyDischargeGrid,
                    hourlyDischargePpa,
                    hourlySelfConsSolar,
                    hourlySelfConsBess,
                    hourlyLossesRte,
                    hourlyGridFeedPv,
                    hourlyRevenueRidPure,
                    hourlyRevenueRidActual,
                    hourlyRevenueArbitrageGrid,
                    hourlyRevenuePpaPv,
                    hourlyRevenuePpaBess,
                    hourlyRevenueTimeshifting,
                    hourlyCostWithdrawal,
                    hourlyDischargeArbitrage,
                    hourlyDischargeTimeshifting,
                    totalUplift: 0,
                    annualShifted: 0
                };
            }
            
            let rte = bessEfficiency;
            let defaultDod = 0.90;
            if (bessType === 'graphene') { rte = 0.96; defaultDod = 1.0; }
            else if (bessType === 'nmc') { rte = 0.86; defaultDod = 0.85; }
            else if (bessType === 'lfp') { rte = 0.90; defaultDod = 0.90; }
            
            const configuredDod = (p.bessDoD && p.bessDoD > 0) ? p.bessDoD / 100 : null;
            let dod = configuredDod !== null ? configuredDod : defaultDod;
            
            const maxSoc = bessMwh * 1000; // kWh
            const minSoc = maxSoc * (1 - dod);
            const maxPower = bessMw * 1000; // kW
            
            const chargeSolarEff = bessConnection === 'dc' ? 0.98 : Math.sqrt(rte);
            const chargeGridEff = Math.sqrt(rte);
            const dischargeEff = Math.sqrt(rte);
            
            // Check if we need 2D DP
            let hasOnSiteLoad = false;
            if (loadProfile) {
                for (let t = 0; t < 8760; t++) {
                    if (loadProfile[t] > 0) {
                        hasOnSiteLoad = true;
                        break;
                    }
                }
            }
            const run2D = hasOnSiteLoad && ppaPrice > 0;
            
            // Pre-compute monthly averages of PUN for pun_medio contract
            const monthStartHours = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016, 8760];
            const monthlyAveragePun = new Float64Array(12);
            const monthlyCounts = new Int32Array(12);
            for (let t = 0; t < 8760; t++) {
                const m = getMonthOfHour(t);
                monthlyAveragePun[m] += punProfile[t];
                monthlyCounts[m]++;
            }
            for (let m = 0; m < 12; m++) {
                if (monthlyCounts[m] > 0) {
                    monthlyAveragePun[m] /= monthlyCounts[m];
                }
            }
            
            // getMonthOfHour is now global
            let totalUplift = 0;
            let annualShiftedKwh = 0;
            
            if (!run2D) {
                // Run 1D DP
                const M = 15;
                const socLevels = new Float64Array(M + 1);
                for (let i = 0; i <= M; i++) {
                    socLevels[i] = minSoc + (i / M) * (maxSoc - minSoc);
                }
                
                const validTransitions = Array.from({ length: M + 1 }, () => []);
                const maxChgEnergy = maxPower * Math.max(chargeSolarEff, chargeGridEff);
                const maxDisEnergy = maxPower / dischargeEff;
                
                for (let i = 0; i <= M; i++) {
                    const socStart = socLevels[i];
                    for (let iNext = 0; iNext <= M; iNext++) {
                        const socEnd = socLevels[iNext];
                        const deltaSoC = socEnd - socStart;
                        if (deltaSoC > maxChgEnergy + 1e-3) continue;
                        if (-deltaSoC > maxDisEnergy + 1e-3) continue;
                        validTransitions[i].push(iNext);
                    }
                }
                
                const V = Array.from({ length: 25 }, () => new Float64Array(M + 1));
                const nextState = Array.from({ length: 24 }, () => new Int32Array(M + 1));
                const dayC_pv = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayC_grid = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayD_grid = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                const dayReward = Array.from({ length: 24 }, () => new Float64Array(M + 1));
                
                let currState = 0;
                let socGridVal = 0;
                
                for (let day = 0; day < 365; day++) {
                    const dayStart = day * 24;
                    
                    for (let t = 23; t >= 0; t--) {
                        const h = dayStart + t;
                        const solVal = solarProfile[h];
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const V_next = V[t+1];
                        const V_curr = V[t];
                        const next_state_t = nextState[t];
                        
                        const c_pv_t = dayC_pv[t];
                        const c_grid_t = dayC_grid[t];
                        const d_grid_t = dayD_grid[t];
                        const reward_t = dayReward[t];
                        
                        for (let i = 0; i <= M; i++) {
                            const socStart = socLevels[i];
                            let bestVal = -Infinity;
                            let bestNext = -1;
                            let bestC_pv = 0, bestC_grid = 0, bestD_grid = 0, bestReward = 0;
                            
                            const nextList = validTransitions[i];
                            const len = nextList.length;
                            
                            for (let k = 0; k < len; k++) {
                                const iNext = nextList[k];
                                const socEnd = socLevels[iNext];
                                const deltaSoC = socEnd - socStart;
                                
                                let c_pv = 0;
                                let c_grid = 0;
                                let d_grid = 0;
                                let reward = 0;
                                let feasible = false;
                                
                                if (deltaSoC > 0) {
                                    const E_ch = deltaSoC;
                                    const E_ch_pv = Math.min(E_ch, solVal * chargeSolarEff);
                                    const E_ch_grid = E_ch - E_ch_pv;
                                    
                                    c_pv = E_ch_pv / chargeSolarEff;
                                    c_grid = E_ch_grid / chargeGridEff;
                                    
                                    if (c_pv + c_grid <= maxPower + 1e-5) {
                                        feasible = true;
                                        if (c_pv > solVal) c_pv = solVal;
                                        const p_fed_pv = Math.max(0, solVal - c_pv);
                                        reward = p_fed_pv * priceRID - c_grid * costGrid;
                                    }
                                } else if (deltaSoC < 0) {
                                    const E_dis = -deltaSoC;
                                    d_grid = E_dis * dischargeEff;
                                    if (d_grid <= maxPower + 1e-5) {
                                        feasible = true;
                                        reward = (solVal + d_grid) * priceRID;
                                    }
                                } else {
                                    feasible = true;
                                    reward = solVal * priceRID;
                                }
                                
                                if (feasible) {
                                    const throughput = c_pv + c_grid + d_grid;
                                    const penalty = throughput * 0.0001;
                                    const val = reward - penalty + V_next[iNext];
                                    if (val > bestVal) {
                                        bestVal = val;
                                        bestNext = iNext;
                                        bestC_pv = c_pv;
                                        bestC_grid = c_grid;
                                        bestD_grid = d_grid;
                                        bestReward = reward;
                                    }
                                }
                            }
                            
                            V_curr[i] = bestVal;
                            next_state_t[i] = bestNext;
                            c_pv_t[i] = bestC_pv;
                            c_grid_t[i] = bestC_grid;
                            d_grid_t[i] = bestD_grid;
                            reward_t[i] = bestReward;
                        }
                    }
                    
                    for (let t = 0; t < 24; t++) {
                        const h = dayStart + t;
                        const ns = nextState[t][currState];
                        
                        hourlySoC[h] = socLevels[currState];
                        const c_pv = dayC_pv[t][currState];
                        const c_grid = dayC_grid[t][currState];
                        const d_grid = dayD_grid[t][currState];
                        
                        hourlyCharge[h] = c_pv + c_grid;
                        hourlyDischarge[h] = d_grid;
                        hourlyChargeGrid[h] = c_grid;
                        
                        hourlyChargeSolar[h] = c_pv;
                        hourlyDischargeGrid[h] = d_grid;
                        hourlyDischargePpa[h] = 0;
                        hourlySelfConsSolar[h] = 0;
                        hourlySelfConsBess[h] = 0;
                        
                        const lossChgSolar = c_pv * (1 - chargeSolarEff);
                        const lossChgGrid = c_grid * (1 - chargeGridEff);
                        const lossDis = d_grid * ((1 / dischargeEff) - 1);
                        hourlyLossesRte[h] = lossChgSolar + lossChgGrid + lossDis;
                        
                        const solVal = solarProfile[h];
                        const pricePUN = punProfile[h];
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                        const pricePPA = ppaPrice / 1000;
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        // Proportional grid-charged pool tracking in 1D DP
                        const socStart = socLevels[currState];
                        const socEnd = socLevels[ns];
                        const deltaSoC = socEnd - socStart;
                        let d_grid_from_grid = 0;
                        
                        if (deltaSoC > 0) {
                            const E_ch = deltaSoC;
                            const E_ch_pv = Math.min(E_ch, solVal * chargeSolarEff);
                            const E_ch_grid = E_ch - E_ch_pv;
                            socGridVal = socGridVal + E_ch_grid;
                        } else if (deltaSoC < 0) {
                            const E_dis = -deltaSoC;
                            const fraction = socStart > 0 ? (socGridVal / socStart) : 0;
                            const E_dis_grid = E_dis * fraction;
                            socGridVal = Math.max(0, socGridVal - E_dis_grid);
                            d_grid_from_grid = E_dis_grid * dischargeEff;
                        }
                        
                        const p_fed_pv = Math.max(0, solVal - c_pv);
                        
                        hourlyGridFeed[h] = p_fed_pv + d_grid;
                        hourlySelfCons[h] = 0;
                        
                        hourlyGridFeedPv[h] = p_fed_pv;
                        hourlyRevenueRidPure[h] = solVal * priceRID;
                        hourlyRevenueRidActual[h] = p_fed_pv * priceRID;
                        hourlyRevenueArbitrageGrid[h] = d_grid_from_grid * priceRID;
                        hourlyRevenueTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid) * priceRID;
                        hourlyRevenuePpaPv[h] = 0;
                        hourlyRevenuePpaBess[h] = 0;
                        hourlyCostWithdrawal[h] = c_grid * costGrid;
                        hourlyDischargeArbitrage[h] = d_grid_from_grid;
                        hourlyDischargeTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid);
                        
                        totalUplift += dayReward[t][currState];
                        annualShiftedKwh += d_grid;
                        
                        currState = ns;
                    }
                }
            } else {
                // Run 2D DP
                const M = 10;
                const socLevels = new Float64Array(M + 1);
                for (let i = 0; i <= M; i++) {
                    socLevels[i] = minSoc + (i / M) * (maxSoc - minSoc);
                }
                
                const numStates = (M + 1) * (M + 1);
                const stateSoc = new Float64Array(numStates);
                const stateSocGrid = new Float64Array(numStates);
                
                for (let s = 0; s < numStates; s++) {
                    const i = Math.floor(s / (M + 1));
                    const j = s % (M + 1);
                    stateSoc[s] = socLevels[i];
                    stateSocGrid[s] = (j / M) * socLevels[i];
                }
                
                const validTransitions = Array.from({ length: numStates }, () => []);
                const maxChgEnergy = maxPower * Math.max(chargeSolarEff, chargeGridEff);
                const maxDisEnergy = maxPower / dischargeEff;
                
                for (let s = 0; s < numStates; s++) {
                    const socStart = stateSoc[s];
                    const socGridStart = stateSocGrid[s];
                    
                    for (let sNext = 0; sNext < numStates; sNext++) {
                        const socEnd = stateSoc[sNext];
                        const socGridEnd = stateSocGrid[sNext];
                        const deltaSoC = socEnd - socStart;
                        const deltaSoCGrid = socGridEnd - socGridStart;
                        
                        if (deltaSoC > maxChgEnergy + 1e-3) continue;
                        if (-deltaSoC > maxDisEnergy + 1e-3) continue;
                        
                        if (deltaSoC > 0) {
                            if (deltaSoCGrid < -1e-5 || (deltaSoC - deltaSoCGrid) < -1e-5) continue;
                        } else if (deltaSoC < 0) {
                            if (deltaSoCGrid > 1e-5) continue;
                            if (-deltaSoCGrid > socGridStart + 1e-5) continue;
                            if (deltaSoC - deltaSoCGrid > 1e-5) continue;
                        } else {
                            if (Math.abs(deltaSoCGrid) > 1e-5) continue;
                        }
                        
                        validTransitions[s].push(sNext);
                    }
                }
                
                const V = Array.from({ length: 25 }, () => new Float64Array(numStates));
                const nextState = Array.from({ length: 24 }, () => new Int32Array(numStates));
                
                const dayC_pv = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayC_grid = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayD_ppa = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayD_grid = Array.from({ length: 24 }, () => new Float64Array(numStates));
                const dayReward = Array.from({ length: 24 }, () => new Float64Array(numStates));
                
                let currState = 0;
                
                for (let day = 0; day < 365; day++) {
                    const dayStart = day * 24;
                    
                    for (let t = 23; t >= 0; t--) {
                        const h = dayStart + t;
                        const solVal = solarProfile[h];
                        const lodVal = loadProfile[h];
                        const pricePUN = punProfile[h];
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        
                        const pricePPA = ppaPrice / 1000;
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const V_next = V[t+1];
                        const V_curr = V[t];
                        const next_state_t = nextState[t];
                        
                        const c_pv_t = dayC_pv[t];
                        const c_grid_t = dayC_grid[t];
                        const d_ppa_t = dayD_ppa[t];
                        const d_grid_t = dayD_grid[t];
                        const reward_t = dayReward[t];
                        
                        for (let s = 0; s < numStates; s++) {
                            const socStart = stateSoc[s];
                            const socGridStart = stateSocGrid[s];
                            
                            let bestVal = -Infinity;
                            let bestNext = -1;
                            let bestC_pv = 0, bestC_grid = 0, bestD_ppa = 0, bestD_grid = 0, bestReward = 0;
                            
                            const nextList = validTransitions[s];
                            const len = nextList.length;
                            
                            for (let k = 0; k < len; k++) {
                                const sNext = nextList[k];
                                const socEnd = stateSoc[sNext];
                                const socGridEnd = stateSocGrid[sNext];
                                
                                const deltaSoC = socEnd - socStart;
                                const deltaSoCGrid = socGridEnd - socGridStart;
                                
                                let c_pv = 0;
                                let c_grid = 0;
                                let d_ppa = 0;
                                let d_grid = 0;
                                let reward = 0;
                                let feasible = false;
                                
                                if (deltaSoC > 0) {
                                    const E_ch_grid = deltaSoCGrid > 0 ? deltaSoCGrid : 0;
                                    const E_ch_pv = deltaSoC - E_ch_grid > 0 ? deltaSoC - E_ch_grid : 0;
                                    
                                    c_grid = E_ch_grid / chargeGridEff;
                                    c_pv = E_ch_pv / chargeSolarEff;
                                    
                                    if (c_grid + c_pv <= maxPower + 1e-5 && c_pv <= solVal + 1e-5) {
                                        feasible = true;
                                        if (c_pv > solVal) c_pv = solVal;
                                        const p_self_pv = solVal - c_pv < lodVal ? solVal - c_pv : lodVal;
                                        const p_fed_pv = solVal - c_pv - lodVal > 0 ? solVal - c_pv - lodVal : 0;
                                        reward = p_self_pv * pricePPA + p_fed_pv * priceRID - c_grid * costGrid;
                                    }
                                } else if (deltaSoC < 0) {
                                    const E_dis = -deltaSoC;
                                    const E_dis_grid = -deltaSoCGrid;
                                    const E_dis_pv = E_dis - E_dis_grid > 0 ? E_dis - E_dis_grid : 0;
                                    
                                    const p_dis_delivered = E_dis * dischargeEff;
                                    const p_dis_ppa_max = E_dis_pv * dischargeEff;
                                    
                                    const p_self_pv = solVal < lodVal ? solVal : lodVal;
                                    const p_fed_pv = solVal - lodVal > 0 ? solVal - lodVal : 0;
                                    
                                    d_ppa = lodVal - p_self_pv < p_dis_ppa_max ? lodVal - p_self_pv : p_dis_ppa_max;
                                    d_grid = p_dis_delivered - d_ppa > 0 ? p_dis_delivered - d_ppa : 0;
                                    
                                    if (d_ppa + d_grid <= maxPower + 1e-5) {
                                        feasible = true;
                                        reward = (p_self_pv + d_ppa) * pricePPA + (p_fed_pv + d_grid) * priceRID;
                                    }
                                } else {
                                    feasible = true;
                                    const p_self_pv = solVal < lodVal ? solVal : lodVal;
                                    const p_fed_pv = solVal - lodVal > 0 ? solVal - lodVal : 0;
                                    reward = p_self_pv * pricePPA + p_fed_pv * priceRID;
                                }
                                
                                if (feasible) {
                                    const throughput = c_pv + c_grid + d_ppa + d_grid;
                                    const penalty = throughput * 0.0001;
                                    const val = reward - penalty + V_next[sNext];
                                    if (val > bestVal) {
                                        bestVal = val;
                                        bestNext = sNext;
                                        bestC_pv = c_pv;
                                        bestC_grid = c_grid;
                                        bestD_ppa = d_ppa;
                                        bestD_grid = d_grid;
                                        bestReward = reward;
                                    }
                                }
                            }
                            
                            V_curr[s] = bestVal;
                            next_state_t[s] = bestNext;
                            c_pv_t[s] = bestC_pv;
                            c_grid_t[s] = bestC_grid;
                            d_ppa_t[s] = bestD_ppa;
                            d_grid_t[s] = bestD_grid;
                            reward_t[s] = bestReward;
                        }
                    }
                    
                    for (let t = 0; t < 24; t++) {
                        const h = dayStart + t;
                        const ns = nextState[t][currState];
                        
                        hourlySoC[h] = stateSoc[currState];
                        const c_pv = dayC_pv[t][currState];
                        const c_grid = dayC_grid[t][currState];
                        const d_ppa = dayD_ppa[t][currState];
                        const d_grid = dayD_grid[t][currState];
                        
                        hourlyCharge[h] = c_pv + c_grid;
                        hourlyDischarge[h] = d_ppa + d_grid;
                        hourlyChargeGrid[h] = c_grid;
                        
                        hourlyChargeSolar[h] = c_pv;
                        hourlyDischargeGrid[h] = d_grid;
                        hourlyDischargePpa[h] = d_ppa;
                        
                        const solVal = solarProfile[h];
                        const lodVal = loadProfile[h];
                        const pricePUN = punProfile[h];
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const pricePPA = ppaPrice / 1000;
                        const month = getMonthOfHour(h);
                        const traderPrice = p.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;
                        
                        const p_self_pv = solVal - c_pv < lodVal ? solVal - c_pv : lodVal;
                        const p_fed_pv = solVal - c_pv - lodVal > 0 ? solVal - c_pv - lodVal : 0;
                        
                        const socStart = stateSoc[currState];
                        const socGridStart = stateSocGrid[currState];
                        const socEnd = stateSoc[ns];
                        const socGridEnd = stateSocGrid[ns];
                        
                        const deltaSoC = socEnd - socStart;
                        const deltaSoCGrid = socGridEnd - socGridStart;
                        
                        let d_grid_from_grid = 0;
                        if (deltaSoC < 0 && deltaSoCGrid < 0) {
                            d_grid_from_grid = Math.min(d_grid, -deltaSoCGrid * dischargeEff);
                        }
                        
                        hourlySelfConsSolar[h] = p_self_pv;
                        hourlySelfConsBess[h] = d_ppa;
                        
                        const lossChgSolar = c_pv * (1 - chargeSolarEff);
                        const lossChgGrid = c_grid * (1 - chargeGridEff);
                        const lossDis = (d_ppa + d_grid) * ((1 / dischargeEff) - 1);
                        hourlyLossesRte[h] = lossChgSolar + lossChgGrid + lossDis;
                        
                        hourlySelfCons[h] = p_self_pv + d_ppa;
                        hourlyGridFeed[h] = p_fed_pv + d_grid;
                        
                        hourlyGridFeedPv[h] = p_fed_pv;
                        hourlyRevenueRidPure[h] = solVal * priceRID;
                        hourlyRevenueRidActual[h] = p_fed_pv * priceRID;
                        hourlyRevenueArbitrageGrid[h] = d_grid_from_grid * priceRID;
                        hourlyRevenueTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid) * priceRID;
                        hourlyRevenuePpaPv[h] = p_self_pv * pricePPA;
                        hourlyRevenuePpaBess[h] = d_ppa * pricePPA;
                        hourlyCostWithdrawal[h] = c_grid * costGrid;
                        hourlyDischargeArbitrage[h] = d_grid_from_grid;
                        hourlyDischargeTimeshifting[h] = Math.max(0, d_grid - d_grid_from_grid);
                        
                        totalUplift += dayReward[t][currState];
                        annualShiftedKwh += d_ppa + d_grid;
                        
                        currState = ns;
                    }
                }
            }
            
            return {
                hourlySoC,
                hourlyCharge,
                hourlyDischarge,
                hourlyGridFeed,
                hourlySelfCons,
                hourlyChargeGrid,
                hourlyChargeSolar,
                hourlyDischargeGrid,
                hourlyDischargePpa,
                hourlySelfConsSolar,
                hourlySelfConsBess,
                hourlyLossesRte,
                hourlyGridFeedPv,
                hourlyRevenueRidPure,
                hourlyRevenueRidActual,
                hourlyRevenueArbitrageGrid,
                hourlyRevenuePpaPv,
                hourlyRevenuePpaBess,
                hourlyRevenueTimeshifting,
                hourlyCostWithdrawal,
                hourlyDischargeArbitrage,
                hourlyDischargeTimeshifting,
                totalUplift,
                annualShifted: annualShiftedKwh / 1000
            };
        }

        function executeCalculation(State) {
    let renderZeroState = () => {};

            const p = State.inputs;

            // 1. Build Combined Generation Profile & Portafoglio Weighted PUN
            const combinedSolarProfile = new Float64Array(8760);
            const portfolioWeightedPunProfile = new Float64Array(8760);
            
            const consolidatedHourlyCharge = new Float64Array(8760);
            const consolidatedHourlyDischarge = new Float64Array(8760);
            const consolidatedHourlySoC = new Float64Array(8760);
            const consolidatedHourlyGridFeed = new Float64Array(8760);
            const consolidatedHourlySelfCons = new Float64Array(8760);
            const consolidatedHourlyChargeGrid = new Float64Array(8760);
            
            const consolidatedHourlyChargeSolar = new Float64Array(8760);
            const consolidatedHourlyDischargeGrid = new Float64Array(8760);
            const consolidatedHourlyDischargeGridArb = new Float64Array(8760);
            const consolidatedHourlyDischargeGridTs = new Float64Array(8760);
            const consolidatedHourlyDischargePpa = new Float64Array(8760);
            const consolidatedHourlySelfConsSolar = new Float64Array(8760);
            const consolidatedHourlySelfConsBess = new Float64Array(8760);
            const consolidatedHourlyLossesRte = new Float64Array(8760);
            
            const consolidatedHourlyGridFeedPv = new Float64Array(8760);
            const consolidatedHourlyRevenueRidPure = new Float64Array(8760);
            const consolidatedHourlyRevenueRidActual = new Float64Array(8760);
            const consolidatedHourlyRevenueArbitrageGrid = new Float64Array(8760);
            const consolidatedHourlyRevenuePpaPv = new Float64Array(8760);
            const consolidatedHourlyRevenuePpaBess = new Float64Array(8760);
            const consolidatedHourlyRevenueTimeshifting = new Float64Array(8760);
            const consolidatedHourlyCostWithdrawal = new Float64Array(8760);
            
            let totalArbitrageUpliftY1 = 0;
            let totalBessCAPEX = 0;
            let totalBessLossesMwh = 0;
            let totalShiftedMwh = 0;
            let totalBessMw = 0;
            let totalBessMwh = 0;

            let totalEpcCapex = 0;
            let totalConnectionCapex = 0;
            let totalLandPurchaseCapex = 0;
            let totalLandDdsAttualizzatoCapex = 0;
            let totalLandDdsAnnuo = 0;
            let totalDevelopmentCapex = 0;
            let totalSpvAcquisitionCapex = 0;
            let totalOpexPlants = 0;
            let totalOpexInsurance = 0;
            let totalOpexTaxes = 0;
            let totalOpexSecurity = 0;
            let totalOpexAssetManagement = 0;

            // ── No plants loaded: zero out all results and return early ──
            if (State.plants.length === 0) {
                const finalResults = buildZeroResults();
                renderZeroState();
                return finalResults;
            }
            // Only process plants that are enabled (default: true if undefined)
            const activePlants = State.plants.filter(p => p.enabled !== false);

            // If all plants are disabled, zero out and return
            if (activePlants.length === 0) {
                const finalResults = buildZeroResults();
                renderZeroState();
                return finalResults;
            }

            const activeStabilimenti = State.stabilimenti.filter(s => s.enabled !== false);
            const capexBreakdown = [];
            const opexBreakdown = [];

            activePlants.forEach(plant => {
                const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                const plantBessEfficiency = plant.bessEfficiency !== undefined ? plant.bessEfficiency : 0.90;
                const plantBessDegradation = plant.bessDegradation !== undefined ? plant.bessDegradation : 0.018;
                const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                const plantBessType = plant.bessType || 'none';
                const plantBessConnection = plant.bessConnection || 'ac';

                // Precompute annual solar production (MWh)
                plant.annualSolarProductionMWh = plant.generation.reduce((a, b) => a + b, 0) / 1000;

                const plantBessCAPEX = plantBessMwh * 1000 * plantBessCapexKwh;
                totalBessCAPEX += plantBessCAPEX;
                totalBessMw += plantBessMw;
                totalBessMwh += plantBessMwh;

                // Accumulate other non-storage costs
                totalEpcCapex += (plant.capacity * plant.capex);
                totalOpexPlants += (plant.opex || 0);
                totalOpexInsurance += (plant.opexInsurance || 0);
                totalOpexTaxes += (plant.opexTaxes || 0);
                totalOpexSecurity += (plant.opexSecurity || 0);
                totalOpexAssetManagement += (plant.opexAssetManagement || 0);
                totalConnectionCapex += (plant.connectionCost || 0);
                totalDevelopmentCapex += (plant.developmentCost || 0);
                totalSpvAcquisitionCapex += (plant.spvAcquisitionCost || 0);
                
                const landType = plant.landType || 'acquisto';
                const landCost = plant.landCost || 0;
                let plantLandPurchase = 0, plantLandDdsAttualizzato = 0, plantLandDdsAnnuo = 0;
                if (landType === 'acquisto') {
                    plantLandPurchase = landCost;
                    totalLandPurchaseCapex += landCost;
                } else if (landType === 'dds_attualizzato') {
                    plantLandDdsAttualizzato = landCost;
                    totalLandDdsAttualizzatoCapex += landCost;
                } else if (landType === 'dds_annuo') {
                    plantLandDdsAnnuo = landCost;
                    totalLandDdsAnnuo += landCost;
                }
                
                const plantEpcCapex = plant.capacity * plant.capex;
                const plantConnectionCapex = plant.connectionCost || 0;
                const plantDevelopmentCapex = plant.developmentCost || 0;
                const plantSpvAcquisitionCapex = plant.spvAcquisitionCost || 0;
                
                capexBreakdown.push({
                    name: plant.name, capacity: plant.capacity,
                    solarCapex: plantEpcCapex, bessCapex: plantBessCAPEX,
                    connectionCapex: plantConnectionCapex, developmentCapex: plantDevelopmentCapex,
                    spvAcquisitionCapex: plantSpvAcquisitionCapex,
                    landPurchaseCapex: plantLandPurchase, landDdsAttualizzatoCapex: plantLandDdsAttualizzato,
                    totalCapex: plantEpcCapex + plantBessCAPEX + plantConnectionCapex + plantDevelopmentCapex + plantSpvAcquisitionCapex + plantLandPurchase + plantLandDdsAttualizzato
                });
                opexBreakdown.push({
                    name: plant.name, capacity: plant.capacity,
                    bessMwh: plantBessMwh, bessMw: plantBessMw, bessType: plantBessType,
                    years: []
                });
                plant._remainingCivilBase = plantEpcCapex + plantBessCAPEX + plantConnectionCapex + plantDevelopmentCapex + plantLandDdsAttualizzato;
                plant._remainingBessAug = 0;

                // Link plant to its active stabilimento
                const stab = activeStabilimenti.find(s => s.plantId === plant.id);
                plant._stab = stab || null;
                const loadProfile = (stab && stab.ppaType === 'on-site' && stab.load) ? stab.load : null;
                const ppaPrice = (stab && stab.ppaPrice !== undefined) ? stab.ppaPrice : 0;

                // Run BESS simulation for this plant
                const plantGeneration = plant.generation || new Float64Array(8760);
                const plantSim = simulateBessHourly(plantGeneration, State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"], loadProfile, {
                    bessMw: plantBessMw,
                    bessMwh: plantBessMwh,
                    bessEfficiency: plantBessEfficiency,
                    bessDegradation: plantBessDegradation,
                    bessCapexKwh: plantBessCapexKwh,
                    bessType: plantBessType,
                    bessConnection: plantBessConnection,
                    bessDoD: plant.bessDoD || 0,
                    bessSocMin: plant.bessSocMin || 0,
                    bessSocMax: plant.bessSocMax || 0,
                    traderContractType: plant.traderContractType || 'pun_orario',
                    traderSpread: plant.traderSpread || 0,
                    traderDisp: plant.traderDisp || 0,
                    marketType: plant.marketType || 'rid',
                    ferxTariff: plant.ferxTariff !== undefined ? plant.ferxTariff : 85,
                    gridLosses: resolveGridLosses(plant.gridVoltage, 'inject'),
                    gridLossesWithdraw: resolveGridLosses(plant.gridVoltage, 'withdraw'),
                    gseImbalance: State.inputs.ridImbalanceCost || 0,
                    ppaPrice: ppaPrice
                });

                plant.sim = plantSim;
                
                if (!plantSim.hourlySelfConsBessArb) plantSim.hourlySelfConsBessArb = new Float64Array(8760);
                if (!plantSim.hourlySelfConsBessTs) plantSim.hourlySelfConsBessTs = new Float64Array(8760);
                if (!plantSim.hourlyRevenuePpaBessArb) plantSim.hourlyRevenuePpaBessArb = new Float64Array(8760);
                if (!plantSim.hourlyRevenuePpaBessTs) plantSim.hourlyRevenuePpaBessTs = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentivePv) plantSim.hourlyCerGseIncentivePv = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBessArb) plantSim.hourlyCerGseIncentiveBessArb = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBessTs) plantSim.hourlyCerGseIncentiveBessTs = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentiveBess) plantSim.hourlyCerGseIncentiveBess = new Float64Array(8760);
                if (!plantSim.hourlyCerGseIncentive) plantSim.hourlyCerGseIncentive = new Float64Array(8760);

                totalShiftedMwh += plantSim.annualShifted;
                totalBessLossesMwh += plantSim.annualShifted * (1 - plantBessEfficiency);

                // Pre-compute hourly revenues and energy components for decoupled cash flows
                let solarPpaRevY1 = 0;
                let solarRidRevY1 = 0;
                let bessPpaRevY1 = 0;
                let bessRidRevY1 = 0;
                let bessPpaRevArbY1 = 0;
                let bessPpaRevTsY1 = 0;
                let bessGridChargingCostY1 = 0;
                let timeshiftingRevY1 = 0;
                let arbitrageRevY1 = 0;
                let arbitrageCostY1 = 0;

                let solarSelfConsMwhY1 = 0;
                let solarGridFeedMwhY1 = 0;
                let bessSelfConsMwhY1 = 0;
                let bessSelfConsArbMwhY1 = 0;
                let bessSelfConsTsMwhY1 = 0;
                let bessGridFeedMwhY1 = 0;

                const zonePrices = State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"];
                const lossInject = resolveGridLosses(plant.gridVoltage, 'inject');
                const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');
                const lossMult = 1 + (lossInject / 100);
                const gseImb = State.inputs.ridImbalanceCost || 0;
                const spread = plant.traderSpread || 0;
                const disp = plant.traderDisp || 0;

                // Monthly average PUN for monthly average contract
                const monthlyAveragePun = new Float64Array(12);
                const monthlyCounts = new Int32Array(12);
                for (let t = 0; t < 8760; t++) {
                    const m = getMonthOfHour(t);
                    monthlyAveragePun[m] += zonePrices[t];
                    monthlyCounts[m]++;
                }
                for (let m = 0; m < 12; m++) {
                    if (monthlyCounts[m] > 0) {
                        monthlyAveragePun[m] /= monthlyCounts[m];
                    }
                }
                plant._monthlyAveragePun = monthlyAveragePun;

                for (let t = 0; t < 8760; t++) {
                    const solar = plantGeneration[t];
                    const load = loadProfile ? loadProfile[t] : 0;
                    const pricePUN = zonePrices[t];
                    const month = getMonthOfHour(t);
                    const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                    
                    const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                    const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;

                    // Baseline solar flows (without BESS)
                    const baseSolarPpa = loadProfile ? Math.min(solar, load) : 0;
                    const baseSolarRid = loadProfile ? Math.max(0, solar - load) : solar;

                    // Actual flows with BESS
                    const actualPpa = plantSim.hourlySelfCons[t];
                    const actualRid = plantSim.hourlyGridFeed[t];
                    const gridCharge = plantSim.hourlyChargeGrid[t];

                    solarPpaRevY1 += baseSolarPpa * (ppaPrice / 1000);
                    
                    const chargeSolar = plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0;
                    const actualSolarGridFeed = Math.max(0, solar - baseSolarPpa - chargeSolar);
                    solarRidRevY1 += actualSolarGridFeed * priceRID;

                    bessPpaRevY1 += (actualPpa - baseSolarPpa) * (ppaPrice / 1000);
                    timeshiftingRevY1 += plantSim.hourlyRevenueTimeshifting[t] || 0;
                    arbitrageRevY1 += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                    arbitrageCostY1 += plantSim.hourlyCostWithdrawal[t] || 0;
                    bessRidRevY1 = timeshiftingRevY1 + arbitrageRevY1; // Consolidated BESS RID revenue
                    bessGridChargingCostY1 += gridCharge * costGrid;

                    solarSelfConsMwhY1 += baseSolarPpa / 1000;
                    solarGridFeedMwhY1 += actualSolarGridFeed / 1000;
                    bessSelfConsMwhY1 += (actualPpa - baseSolarPpa) / 1000;
                    bessGridFeedMwhY1 += Math.max(0, actualRid - actualSolarGridFeed) / 1000;
                }

                // If virtual off-site PPA: virtual contract on full solar production, PPA price replaces PUN
                if (stab && stab.ppaType === 'off-site') {
                    solarPpaRevY1 = plant.annualSolarProductionMWh * stab.ppaPrice;
                    solarRidRevY1 = 0;
                    bessPpaRevY1 = 0;
                    bessRidRevY1 = 0;
                    arbitrageRevY1 = 0;
                    arbitrageCostY1 = 0;
                    for (let t = 0; t < 8760; t++) {
                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const actualRid = plantSim.hourlyGridFeed[t];
                        bessRidRevY1 += (actualRid - plant.generation[t]) * priceRID;
                        arbitrageRevY1 += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                        arbitrageCostY1 += plantSim.hourlyCostWithdrawal[t] || 0;
                    }
                    timeshiftingRevY1 = bessRidRevY1 - arbitrageRevY1 + arbitrageCostY1;
                    solarSelfConsMwhY1 = plant.annualSolarProductionMWh;
                    solarGridFeedMwhY1 = 0;
                    bessSelfConsMwhY1 = 0;
                    bessGridFeedMwhY1 = 0;
                } else if (stab && stab.ppaType === 'cer') {
                    solarPpaRevY1 = 0;
                    bessPpaRevY1 = 0;
                    solarSelfConsMwhY1 = 0;
                    bessSelfConsMwhY1 = 0;
                    solarRidRevY1 = 0;
                    bessRidRevY1 = 0;
                    timeshiftingRevY1 = 0;
                    arbitrageRevY1 = 0;
                    arbitrageCostY1 = 0;
                    bessGridChargingCostY1 = 0;
                    solarGridFeedMwhY1 = 0;
                    bessGridFeedMwhY1 = 0;

                    const cerShareType = stab.cerShareType || 'shared_energy';

                    // Determine CER tariff size parameters based on plant capacity (kWp)
                    let fissa = 0;
                    let cap = 0;
                    if (plant.capacity <= 20) {
                        fissa = State.inputs.cerFissaSmall;
                        cap = State.inputs.cerCapSmall;
                    } else if (plant.capacity <= 200) {
                        fissa = State.inputs.cerFissaMedium;
                        cap = State.inputs.cerCapMedium;
                    } else {
                        fissa = State.inputs.cerFissaLarge;
                        cap = State.inputs.cerCapLarge;
                    }

                    // Geographic correction
                    let geoCorr = 0;
                    const zoneUpper = String(plant.zone).toUpperCase();
                    if (zoneUpper === 'NORD') {
                        geoCorr = State.inputs.cerGeoNord;
                    } else if (zoneUpper === 'CNOR') {
                        geoCorr = State.inputs.cerGeoCentro;
                    } else {
                        geoCorr = State.inputs.cerGeoSud;
                    }

                    // PNRR reduction factor
                    const pnrrPct = plant.pnrrContributionPct || 0;
                    const decurtazioneF = 0.5 * (pnrrPct / 40);
                    const factorPNRR = 1 - decurtazioneF;

                    const cerTras = State.inputs.cerTras;
                    const cPR = resolveGridLosses(plant.gridVoltage, 'cpr') / 100;
                    const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');

                    for (let t = 0; t < 8760; t++) {
                        const solar = plant.generation[t];
                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const month = getMonthOfHour(t);
                        const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                        const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;

                        const actualRid = plantSim.hourlyGridFeed[t];
                        const chargeSolar = plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0;
                        const gridCharge = plantSim.hourlyChargeGrid[t];

                        const actualSolarGridFeed = Math.max(0, solar - chargeSolar);
                        const actualBessGridFeed = Math.max(0, actualRid - actualSolarGridFeed);

                        // 1. RID Revenues
                        solarRidRevY1 += actualSolarGridFeed * priceRID;
                        
                        const hourlyArb = plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                        const hourlyTs = plantSim.hourlyRevenueTimeshifting[t] || 0;
                        arbitrageRevY1 += hourlyArb;
                        timeshiftingRevY1 += hourlyTs;
                        arbitrageCostY1 += (plantSim.hourlyCostWithdrawal[t] || 0);
                        bessRidRevY1 += (hourlyArb + hourlyTs);
                        bessGridChargingCostY1 += gridCharge * costGrid;

                        // Quantities in MWh
                        solarGridFeedMwhY1 += actualSolarGridFeed / 1000;
                        bessGridFeedMwhY1 += actualBessGridFeed / 1000;

                        // 2. CER Shared Energy (GSE)
                        const cerLoad = (stab.load && stab.load[t] !== undefined) ? stab.load[t] : 0;
                        const eSharedGse = Math.min(actualRid, cerLoad);

                        // Dynamic hourly price for CER shared energy (GSE incentive)
                        const cacv_t = cerTras + cPR * pricePUN;
                        const variablePortion = Math.min(State.inputs.cerVarMax, Math.max(0, State.inputs.cerVarReferencePrice - pricePUN));
                        const tip_t = Math.min(cap, fissa + variablePortion + geoCorr) * factorPNRR;
                        const priceCER_MWh = cacv_t + tip_t;
                        const priceCER_kWh = priceCER_MWh / 1000;

                        // Calculate BESS discharge split
                        const hourlyArbPhys = (plantSim.hourlyDischargeArbitrage ? plantSim.hourlyDischargeArbitrage[t] : 0);
                        const hourlyTsPhys = (plantSim.hourlyDischargeTimeshifting ? plantSim.hourlyDischargeTimeshifting[t] : 0);
                        const actualRenewableRid = actualSolarGridFeed + hourlyTsPhys;

                        // Priority-based shared energy allocation: Prioritize Renewable (Solar + BESS Timeshifting) over Arbitrage
                        const eSharedGseRenewable = Math.min(actualRenewableRid, cerLoad);
                        const eSharedGseBessArb = Math.min(hourlyArbPhys, eSharedGse - eSharedGseRenewable);

                        let eSharedGseSolar = 0;
                        let eSharedGseBessTs = 0;
                        if (actualRenewableRid > 0) {
                            const fSolarRen = actualSolarGridFeed / actualRenewableRid;
                            eSharedGseSolar = eSharedGseRenewable * fSolarRen;
                            eSharedGseBessTs = eSharedGseRenewable * (1 - fSolarRen);
                        }
                        const eSharedGseBess = eSharedGseBessTs + eSharedGseBessArb;

                        // CER GSE Incentives
                        const gseIncentiveSolar_t = eSharedGseSolar * priceCER_kWh;
                        // Grid-charged BESS energy (Arbitrage) is NOT renewable generation and is ineligible for GSE incentives (TIAD + TIP = 0)
                        const gseIncentiveBessArb_t = 0;
                        const gseIncentiveBessTs_t = eSharedGseBessTs * priceCER_kWh;
                        const gseIncentiveBess_t = gseIncentiveBessTs_t; // Only Timeshifting (solar-charged BESS) gets GSE incentives

                        // 3. SPV Private PPA Contract
                        const privatePpaPrice_kWh = (stab.ppaPrice || 0) / 1000;
                        let ePrivateSolar = 0;
                        let ePrivateBessArb = 0;
                        let ePrivateBessTs = 0;

                        if (cerShareType === 'total_generation') {
                            ePrivateSolar = actualSolarGridFeed;
                            ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                            ePrivateBessTs = hourlyTsPhys;
                        } else {
                            // If based on shared energy, we use the same priority allocation
                            ePrivateSolar = eSharedGseSolar;
                            ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                            ePrivateBessTs = eSharedGseBessTs;
                        }
                        const ePrivateBess = ePrivateBessTs + ePrivateBessArb;

                        const privateRevenuePv_t = ePrivateSolar * privatePpaPrice_kWh;
                        const privateRevenueBessArb_t = ePrivateBessArb * privatePpaPrice_kWh;
                        const privateRevenueBessTs_t = ePrivateBessTs * privatePpaPrice_kWh;
                        const privateRevenueBess_t = ePrivateBess * privatePpaPrice_kWh;

                        // Override hourly arrays in plantSim to keep consolidated graphs in sync (using SPV private revenues)
                        plantSim.hourlySelfConsSolar[t] = eSharedGseSolar;
                        plantSim.hourlySelfConsBess[t] = eSharedGseBess;
                        plantSim.hourlySelfConsBessArb[t] = eSharedGseBessArb;
                        plantSim.hourlySelfConsBessTs[t] = eSharedGseBessTs;
                        plantSim.hourlySelfCons[t] = eSharedGse;

                        plantSim.hourlyRevenuePpaPv[t] = privateRevenuePv_t;
                        plantSim.hourlyRevenuePpaBess[t] = privateRevenueBess_t;
                        plantSim.hourlyRevenuePpaBessArb[t] = privateRevenueBessArb_t;
                        plantSim.hourlyRevenuePpaBessTs[t] = privateRevenueBessTs_t;

                        plantSim.hourlyCerGseIncentivePv[t] = gseIncentiveSolar_t;
                        plantSim.hourlyCerGseIncentiveBessArb[t] = gseIncentiveBessArb_t;
                        plantSim.hourlyCerGseIncentiveBessTs[t] = gseIncentiveBessTs_t;
                        plantSim.hourlyCerGseIncentiveBess[t] = gseIncentiveBess_t;
                        plantSim.hourlyCerGseIncentive[t] = gseIncentiveSolar_t + gseIncentiveBess_t;

                        // SPV private PPA Revenues
                        solarPpaRevY1 += privateRevenuePv_t;
                        bessPpaRevY1 += privateRevenueBess_t;
                        bessPpaRevArbY1 += privateRevenueBessArb_t;
                        bessPpaRevTsY1 += privateRevenueBessTs_t;

                        solarSelfConsMwhY1 += eSharedGseSolar / 1000;
                        bessSelfConsMwhY1 += eSharedGseBess / 1000;
                        bessSelfConsArbMwhY1 += eSharedGseBessArb / 1000;
                        bessSelfConsTsMwhY1 += eSharedGseBessTs / 1000;
                    }
                }

                plant._solarPpaRevY1 = solarPpaRevY1;
                plant._solarRidRevY1 = solarRidRevY1;
                plant._bessPpaRevY1 = bessPpaRevY1;
                plant._bessPpaRevArbY1 = bessPpaRevArbY1;
                plant._bessPpaRevTsY1 = bessPpaRevTsY1;
                plant._bessRidRevY1 = bessRidRevY1;
                plant._bessGridChargingCostY1 = bessGridChargingCostY1;
                plant._timeshiftingRevY1 = timeshiftingRevY1;
                plant._arbitrageRevY1 = arbitrageRevY1;
                plant._arbitrageCostY1 = arbitrageCostY1;

                plant._solarSelfConsMwhY1 = solarSelfConsMwhY1;
                plant._bessSelfConsMwhY1 = bessSelfConsMwhY1;
                plant._bessSelfConsArbMwhY1 = bessSelfConsArbMwhY1;
                plant._bessSelfConsTsMwhY1 = bessSelfConsTsMwhY1;
                plant._solarGridFeedMwhY1 = solarGridFeedMwhY1;
                plant._bessGridFeedMwhY1 = bessGridFeedMwhY1;

                // Physical metrics for driver breakdown
                plant._physSolarGenMwhY1 = plant.annualSolarProductionMWh;
                plant._physSolarPpaMwhY1 = solarSelfConsMwhY1;
                plant._physSolarRidMwhY1 = solarGridFeedMwhY1;
                plant._physSolarToBessMwhY1 = plantSim.hourlyChargeSolar.reduce((a,b)=>a+b, 0) / 1000;
                
                plant._physBessDischargeMwhY1 = plantSim.hourlyDischarge.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessSelfConsMwhY1 = bessSelfConsMwhY1;
                plant._physBessGridFeedMwhY1 = plantSim.hourlyDischargeGrid.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessGridFeedArbMwhY1 = plantSim.hourlyDischargeArbitrage.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessGridFeedTsMwhY1 = plantSim.hourlyDischargeTimeshifting.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessChargeGridMwhY1 = plantSim.hourlyChargeGrid.reduce((a,b)=>a+b, 0) / 1000;
                plant._physBessLossesMwhY1 = plantSim.hourlyLossesRte.reduce((a,b)=>a+b, 0) / 1000;

                plant._selfConsumptionMwh = solarSelfConsMwhY1 + bessSelfConsMwhY1;
                plant._gridFeedMwh = solarGridFeedMwhY1 + bessGridFeedMwhY1;
                plant._ppaRevenue_y1 = solarPpaRevY1 + bessPpaRevY1;

                totalArbitrageUpliftY1 += (bessPpaRevY1 + bessRidRevY1 - bessGridChargingCostY1);

                // Accumulate profiles
                for (let t = 0; t < 8760; t++) {
                    combinedSolarProfile[t] += plant.generation[t];
                    portfolioWeightedPunProfile[t] += plant.generation[t] * zonePrices[t];
                    consolidatedHourlyCharge[t] += plantSim.hourlyCharge[t];
                    consolidatedHourlyDischarge[t] += plantSim.hourlyDischarge[t];
                    consolidatedHourlySoC[t] += plantSim.hourlySoC[t];
                    consolidatedHourlyGridFeed[t] += plantSim.hourlyGridFeed[t];
                    consolidatedHourlySelfCons[t] += plantSim.hourlySelfCons[t];
                    consolidatedHourlyChargeGrid[t] += plantSim.hourlyChargeGrid[t];
                    consolidatedHourlyChargeSolar[t] += plantSim.hourlyChargeSolar[t];
                    consolidatedHourlyDischargeGrid[t] += plantSim.hourlyDischargeGrid[t];
                    consolidatedHourlyDischargeGridArb[t] += plantSim.hourlyDischargeArbitrage[t] || 0;
                    consolidatedHourlyDischargeGridTs[t] += plantSim.hourlyDischargeTimeshifting[t] || 0;
                    consolidatedHourlyDischargePpa[t] += plantSim.hourlyDischargePpa[t];
                    consolidatedHourlySelfConsSolar[t] += plantSim.hourlySelfConsSolar[t];
                    consolidatedHourlySelfConsBess[t] += plantSim.hourlySelfConsBess[t];
                    consolidatedHourlyLossesRte[t] += plantSim.hourlyLossesRte[t];
                    consolidatedHourlyGridFeedPv[t] += plantSim.hourlyGridFeedPv[t] || 0;
                    consolidatedHourlyRevenueRidPure[t] += plantSim.hourlyRevenueRidPure[t] || 0;
                    consolidatedHourlyRevenueRidActual[t] += plantSim.hourlyRevenueRidActual[t] || 0;
                    consolidatedHourlyRevenueArbitrageGrid[t] += plantSim.hourlyRevenueArbitrageGrid[t] || 0;
                    consolidatedHourlyRevenuePpaPv[t] += plantSim.hourlyRevenuePpaPv[t] || 0;
                    consolidatedHourlyRevenuePpaBess[t] += plantSim.hourlyRevenuePpaBess[t] || 0;
                    consolidatedHourlyRevenueTimeshifting[t] += plantSim.hourlyRevenueTimeshifting[t] || 0;
                    consolidatedHourlyCostWithdrawal[t] += plantSim.hourlyCostWithdrawal[t] || 0;
                }
            });

            // Normalise the portfolio weighted PUN profile (general medione ponderato)
            const generalMedionePrices = new Float64Array(8760);
            let numSum = 0, denSum = 0;
            for (let t = 0; t < 8760; t++) {
                numSum += portfolioWeightedPunProfile[t];
                denSum += combinedSolarProfile[t];
                generalMedionePrices[t] = combinedSolarProfile[t] > 0 ? (portfolioWeightedPunProfile[t] / combinedSolarProfile[t]) : State.zonalPun["CNOR"][t];
            }
            const generalMedioneKpiValue = denSum > 0 ? (numSum / denSum) : 0;
            // For the medione, weight grid-fed energy (for CER/off-site, all generation goes to grid)
            let ridNumSum = 0, ridDenSum = 0;
            activePlants.forEach(plant => {
                const zonePrices = State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"];
                const plantStab = plant._stab;
                for (let t = 0; t < 8760; t++) {
                    let gridKw = 0;
                    if (plantStab && plantStab.ppaType === 'on-site' && plantStab.load) {
                        // On-site PPA: grid feed = generation minus self-consumption
                        const loadKw = plantStab.load[t] || 0;
                        gridKw = Math.max(0, plant.generation[t] - loadKw);
                    } else {
                        // CER, off-site or no stab: all generation (+ BESS) goes to grid
                        // Use sim hourlyGridFeed if available
                        gridKw = plant.sim ? (plant.sim.hourlyGridFeed[t] || plant.generation[t]) : plant.generation[t];
                    }
                    ridNumSum += gridKw * zonePrices[t];
                    ridDenSum += gridKw;
                }
            });
            const ridMedioneValue = ridDenSum > 0 ? (ridNumSum / ridDenSum) : 0;
            const avgPunZonalInjectedY1 = ridMedioneValue || 95.0;
            const ppaShare = (State.results && State.results.totalSelfConsMwh && denSum > 0)
                ? (State.results.totalSelfConsMwh / (denSum / 1000) * 100) : 0;
            let scenarioText = "";
            if (p.priceScenarioType === 'bearish_floor') {
                scenarioText = `  |  Scenario: Ribassista (PUN -%, TS -%, Arb -%).toFixed(1)}%/anno)`;
            } else {
                scenarioText = `  |  Scenario: Base`;
            }
            const medioneKpiText = `Medione Ponderato RID: € ${ridMedioneValue.toFixed(2)} /MWh` +
                (ppaShare > 0 ? `  |  Quota PPA: ${ppaShare.toFixed(1)}%` : '') +
                scenarioText;

            // Mock BESS consolidated simulation for downstream functions
            const bessSimulation = {
                annualShifted: totalShiftedMwh,
                totalUplift: totalArbitrageUpliftY1,
                hourlyCharge: consolidatedHourlyCharge,
                hourlyDischarge: consolidatedHourlyDischarge,
                hourlySoC: consolidatedHourlySoC,
                hourlyGridFeed: consolidatedHourlyGridFeed,
                hourlySelfCons: consolidatedHourlySelfCons,
                hourlyChargeGrid: consolidatedHourlyChargeGrid,
                hourlyChargeSolar: consolidatedHourlyChargeSolar,
                hourlyDischargeGrid: consolidatedHourlyDischargeGrid,
                hourlyDischargeArbitrage: consolidatedHourlyDischargeGridArb,
                hourlyDischargeTimeshifting: consolidatedHourlyDischargeGridTs,
                hourlyDischargePpa: consolidatedHourlyDischargePpa,
                hourlySelfConsSolar: consolidatedHourlySelfConsSolar,
                hourlySelfConsBess: consolidatedHourlySelfConsBess,
                hourlyLossesRte: consolidatedHourlyLossesRte,
                hourlyGridFeedPv: consolidatedHourlyGridFeedPv,
                hourlyRevenueRidPure: consolidatedHourlyRevenueRidPure,
                hourlyRevenueRidActual: consolidatedHourlyRevenueRidActual,
                hourlyRevenueArbitrageGrid: consolidatedHourlyRevenueArbitrageGrid,
                hourlyRevenuePpaPv: consolidatedHourlyRevenuePpaPv,
                hourlyRevenuePpaBess: consolidatedHourlyRevenuePpaBess,
                hourlyRevenueTimeshifting: consolidatedHourlyRevenueTimeshifting,
                hourlyCostWithdrawal: consolidatedHourlyCostWithdrawal
            };

            // Year 1 Energy Values
            const totalSolarProductionMWh = denSum / 1000;
            const netSystemEnergyMWh = totalSolarProductionMWh - totalBessLossesMwh;

            // BESS Capex & parameters
            const bessCAPEX = totalBessCAPEX;
            const totalProjectCost = totalEpcCapex + bessCAPEX + totalConnectionCapex + totalLandPurchaseCapex + totalLandDdsAttualizzatoCapex + totalDevelopmentCapex + totalSpvAcquisitionCapex;

            // Debt sizing
            let bankableBase = totalProjectCost;
            if (p.debtBasis === 'hard_costs') {
                bankableBase = totalEpcCapex + bessCAPEX + totalConnectionCapex;
            } else if (p.debtBasis === 'ev_ex_spv') {
                bankableBase = totalProjectCost - totalSpvAcquisitionCapex;
            }
            const debtAmount = p.loanTerm === 0 ? 0 : (bankableBase * p.leverage);
            
            // ── Private Debt sizing (external mezzanine/subordinated at SPV level) ──
            let pdAmount = 0;
            if (p.pdEnabled) {
                if (p.pdAmountType === 'fixed_eur') pdAmount = Math.max(0, p.pdAmountValue || 0);
                else if (p.pdAmountType === 'pct_bankable') pdAmount = Math.max(0, bankableBase * ((p.pdAmountValue || 0) / 100));
                else if (p.pdAmountType === 'pct_totusi') pdAmount = Math.max(0, (totalProjectCost + (typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000)) * ((p.pdAmountValue || 0) / 100));
            }
            // ── Private Equity sizing (external equity co-investor at SPV level) ──
            // % equity è calcolata sull'equity totale residua dopo senior debt + PD
            let peAmount = 0;
            if (p.peEnabled) {
                // PE è a livello SPV: sizing sull'equity SPV (che NON include il PD, perché il PD è a Holding level)
                const equityGrossSpv = Math.max(0, totalProjectCost + (typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000) - debtAmount);
                if (p.peAmountType === 'fixed_eur') peAmount = Math.min(Math.max(0, p.peAmountValue || 0), equityGrossSpv);
                else if (p.peAmountType === 'pct_equity') peAmount = Math.max(0, equityGrossSpv * ((p.peAmountValue || 0) / 100));
            }

            // ── Sizing con PD a livello HOLDING ──
            // Il PD è un debito della Holding (non della SPV). La Holding prende in prestito il PD
            // e lo immette nella SPV come equity. Quindi:
            // - L'equity SPV (quello che la SPV riceve) = totalProjectCost - senior - PE (il PD non riduce l'equity SPV)
            // - L'equity Sponsor puro = equity SPV - sponsorLoan - PD (il PD è debt Holding, riduce l'esposizione Sponsor)
            const equityFromHolding = Math.max(0, totalProjectCost + (typeof p.holdcoCapital === 'number' ? p.holdcoCapital : 10000) - debtAmount - peAmount);
            // equityAmount = esborso iniziale Sponsor puro (per IRR): equity totale - PD (debt Holding) - sponsorLoan (intra-gruppo)
            const equityAmount = Math.max(0, equityFromHolding - pdAmount - (Math.max(0, (totalProjectCost - totalSpvAcquisitionCapex) - debtAmount - peAmount) * (p.sociEquityPct / 100)));

            // Subordinated Debt (finanziamento soci) - sized sull'equity di costruzione SPV (senza PD, che è a Holding)
            const constructionEquity = Math.max(0, (totalProjectCost - totalSpvAcquisitionCapex) - debtAmount - peAmount);
            let remainingShareholderLoan = constructionEquity * (p.sociEquityPct / 100);
            let remainingDebt = debtAmount;

            // ── Private Debt running balance & schedule (ora a livello HOLDING) ──
            let remainingPd = pdAmount;
            const pdAmortizingAnnuality = (p.pdEnabled && p.pdMode === 'amortizing' && p.pdLoanTerm > 0 && pdAmount > 0)
                ? pdAmount * ((p.pdInterestRate/100) * Math.pow(1 + (p.pdInterestRate/100), p.pdLoanTerm)) / (Math.pow(1 + (p.pdInterestRate/100), p.pdLoanTerm) - 1)
                : 0;
            // ── Private Equity preferred return accrual (composto) ──
            let pePreferredAccrued = 0; // hurdle composto maturato non ancora distribuito
            // ── Altra Forma (convertible note) running balance PIK ──
            let remainingAfConvertible = (p.afEnabled && p.afType === 'convertible_note') ? Math.max(0, p.afConvertibleAmount || 0) : 0;

            // ── Parametri Configurabili IDC e Preammortamento ──
            const seniorGracePeriodMonths = p.seniorGracePeriodMonths !== undefined ? p.seniorGracePeriodMonths : 6;
            const constructionMonths = p.constructionMonths !== undefined ? p.constructionMonths : 6;
            const idcDrawdownFactor = p.idcDrawdownFactor !== undefined ? p.idcDrawdownFactor : 50;
            
            const gracePeriodYears = Math.min(1, seniorGracePeriodMonths / 12); // Maximum 1 year grace supported directly in Year 1 logic
            const constructionYears = constructionMonths / 12;

            // IDC = Interest During Construction
            const idcAmount = p.loanTerm > 0 ? (debtAmount * p.interestRate * constructionYears * (idcDrawdownFactor / 100)) : 0;

            let annualDebtService = 0;
            if (p.loanTerm > 0 && debtAmount > 0) {
                // Ammortamento calcolato sugli anni effettivi (scadenza originaria - preammortamento)
                const amortizingYears = Math.max(0.1, p.loanTerm - gracePeriodYears);
                const r = p.interestRate;
                if (amortizingYears > 0 && r > 0) {
                    annualDebtService = debtAmount * (r * Math.pow(1 + r, amortizingYears)) / (Math.pow(1 + r, amortizingYears) - 1);
                } else if (amortizingYears > 0) {
                    annualDebtService = debtAmount / amortizingYears;
                }
            }

            // Capitalization of BESS cells at Year 10 (sum of cell replacements for non-graphene)
            let bessAugmentationCost = 0;
            activePlants.forEach(plant => {
                const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                const plantBessType = plant.bessType || 'none';
                
                if (plantBessMw > 0 && plantBessType !== 'graphene') {
                    bessAugmentationCost += (plantBessMwh * 1000 * plantBessCapexKwh) * 0.50;
                }
            });
            let extraDepreciationY11_20 = 0;

            // LCOE and LCOS calculations
            let lcoeSumDiscountedCosts = totalProjectCost - bessCAPEX;
            let lcoeSumDiscountedEnergy = 0;
            let lcosSumDiscountedCosts = bessCAPEX;
            let lcosSumDiscountedEnergy = 0;

            const cashFlowsForIRR = [-equityAmount];

            // ── Stabilimenti Self-Consumption Pre-Computation ──────────────────────────────
            // Pre-computed inside the main plants loop above

            // ── P1 Fix: Pre-compute weighted PUN (€/MWh) per plant from imported GME data ──
            // Falls back to €95/MWh if no GME data is loaded for the zone
            activePlants.forEach(plant => {
                const zonePrices = State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"];
                let numP = 0, denP = 0;
                for (let t = 0; t < 8760; t++) {
                    numP += plant.generation[t] * zonePrices[t];
                    denP += plant.generation[t];
                }
                // If GME data not loaded (all zeros), fallback to default €95/MWh
                plant._weightedPun = (denP > 0 && numP > 0) ? (numP / denP) : 95;
            });
            let totalEbitda = 0;
            let totalHoldcoFCFE = 0;
            let minDscr = 999;
            let sumDscr = 0;
            let dscrYearsCount = 0;

            const matrix = {
                years: [], revenueTotal: [],
                qtyEnergyGroup: [], priceEnergyGroup: [],
                qtySolarGen: [], qtySolarPpa: [], qtySolarRid: [], qtySolarToBess: [],
                qtyBessDischarge: [], qtyBessSelfCons: [], qtyBessSelfConsArb: [], qtyBessSelfConsTs: [], qtyBessGridFeed: [],
                qtyBessGridFeedArb: [], qtyBessGridFeedTs: [],
                qtyBessChargeGrid: [], qtyBessLosses: [],
                priceSolarAvg: [], priceSolarPpa: [], priceSolarRid: [],
                priceBessAvg: [], priceBessPpa: [], priceBessRid: [],
                priceBessArbitrage: [], priceBessTimeshifting: [], priceBessChargeGrid: [],
                revenueTimeshifting: [], revenueArbitrage: [],
                revenueRid: [], revenuePpa: [], revenuePpaPv: [], revenuePpaBessArb: [], revenuePpaBessTs: [],
                opexTotal: [], opexPlants: [], opexBess: [], opexGridCharging: [], opexLandDds: [], 
                opexInsurance: [], opexTaxes: [], opexSecurity: [], opexAssetManagement: [], opexServiceContract: [],
                opexMaintReserve: [],
                ebitda: [], ebit: [], depreciationCivil: [], depreciationCivilSolar: [], depreciationCivilBess: [], depreciationCivilOther: [],
                interest: [], interestPaid: [], interestActive: [], sociInterestAccrued: [], ebt: [],
                currentTaxesSpv: [], iresTaxSpv: [], irapTaxSpv: [], deferredTaxes: [], civilTaxesSpv: [], netProfitSpv: [], cfads: [],
                deductibleInterest: [], interestCF: [], rolCF: [], taxLossCF: [],
                dividendsPaid: [], holdcoFCFE: [], rolCapacity: [], bessAugmentationCost: [], mraRelease: [],
                maintReserve: [], holdcoOpex: [], holdcoIresTaxPaid: [], holdcoNetProfit: [], holdcoEarnoutPaid: [], holdcoBuyoutPaid: [],
                holdcoInflowTotal: [], holdcoInterestReceived: [], holdcoLoanRepaymentReceived: [], holdcoDividendReceived: [], partnerDividendReceived: [], spvLockedDividends: [],
                cfadsCumulated: [], holdcoFCFECumulated: [], principalScheduled: [], principalVoluntary: [],
                spvFCFE: [], spvCashTrap: [],
                // ── External financing instruments (Private Debt / Private Equity / Altra Forma) ──
                pdInterestAccrued: [], pdInterestPaid: [], pdPrincipalPaid: [], pdBulletPayoff: [],
                pdServiceHoldco: [], pdPayoffHoldco: [],
                afFee: [], afInterestAccrued: [], afExitCost: [],
                peRoyalty: [], peDividendPaid: [], pePreferredPaid: [], peExitShare: [], pePreferredAccruedBalance: [],
                peDividendToSponsor: [], peExitToSponsor: [],
                exitValuationGroup: [], exitEnterpriseValue: [], exitDebtPayoff: [], exitPexTaxRow: [], exitNetProceedsRow: [], exitLimitedLiability: [],
                projectFCFF: [],
                capexBreakdown: capexBreakdown, opexBreakdown: opexBreakdown
            };

            const debtSchedule = {
                years: [], beginningBalance: [], interestAccrued: [], principalScheduled: [], principalVoluntary: [], endingBalance: [],
                totalDebtService: [], dscr: [], beginningBalanceSoci: [], interestAccruedSoci: [], interestPaidSoci: [], principalPaidSoci: [], endingBalanceSoci: [],
                // Private Debt schedule (sezione 3)
                beginningBalancePd: [], interestAccruedPd: [], interestPaidPd: [], principalPaidPd: [], bulletPayoffPd: [], endingBalancePd: []
            };
            let taxLossCarriedForwardFirst3Y = 0;
            let taxLossCarriedForwardNormal = 0;
            let deferredTaxFund = 0;
            let interestExpensesCarriedForward = 0;
            let rolCarriedForward = 0;
            let mraBalance = 0;
            let cumulativeCfads = 0;
            let cumulativeHoldcoFCFE = 0;

            // Depreciable base calculation includes IDC capitalized
            const depreciablePlantBaseCivil = totalEpcCapex + bessCAPEX + totalConnectionCapex + totalLandDdsAttualizzatoCapex + totalDevelopmentCapex + idcAmount;
            let remainingCapexToDepreciateFiscal = depreciablePlantBaseCivil;
            
            // Track base components separately for IRAP sterilization (IDC is non-deductible for IRAP)
            let remainingCapexFiscalPure = totalEpcCapex + bessCAPEX + totalConnectionCapex + totalLandDdsAttualizzatoCapex + totalDevelopmentCapex;
            let remainingCapexFiscalIdc = idcAmount;
            
            let remainingBessAugmentationFiscal = 0;
            let remainingSolarCivil = totalEpcCapex + totalLandDdsAttualizzatoCapex;
            let remainingBessCivil = bessCAPEX;
            let remainingBessAugCivil = 0;
            let remainingOtherCivil = totalConnectionCapex + totalDevelopmentCapex;

            const exitOptionYear = (p.exitOption && p.exitOption !== 'none') ? parseInt(p.exitOption) : 0;
            const exitYear = 20;
            let spvLockedDividends = 0;
            
            for (let yr = 1; yr <= exitYear; yr++) {
                const inflationMultiplier = Math.pow(1 + p.inflation, yr - 1);
                
                // Calculate Bearish Scenario with Floor scale factor K_y
                let K_y = 1.0;
                if (yr > 1 && p.priceScenarioType === 'bearish_floor') {
                    const rawDecay = Math.pow(1 - p.punBearishDecayRate, yr - 1);
                    const floorRatio = p.punZonalFloor / (avgPunZonalInjectedY1 || 1.0);
                    K_y = Math.max(rawDecay, floorRatio);
                }

                // Sum up plant-level values for year `yr`
                let ySolarMwh = 0;
                let yQtyEnergyGroup = 0;
                let yQtySolarAvgDen = 0;
                let yPriceEnergyGroup = 0;
                let yQtySolarGen = 0;
                let yQtySolarPpa = 0;
                let yQtySolarRid = 0;
                let yQtySolarToBess = 0;
                let yQtyBessDischarge = 0;
                let yQtyBessSelfCons = 0;
                let yQtyBessSelfConsArb = 0;
                let yQtyBessSelfConsTs = 0;
                let yQtyBessGridFeed = 0;
                let yQtyBessGridFeedArb = 0;
                let yQtyBessGridFeedTs = 0;
                let yQtyBessChargeGrid = 0;
                let yQtyBessLosses = 0;
                
                let ySolarPpaRev = 0;
                let ySolarRidRev = 0;
                let yBessPpaRev = 0;
                let yBessTimeshiftingRev = 0;
                let yBessArbitrageRev = 0;
                let yBessGridChargingCost = 0;
                let yShiftedMwh = 0;
                let yRevenueRid = 0;
                let yRevenuePpa = 0;
                let yRevenuePpaPv = 0;
                let yBessPpaRevArb = 0;
                let yBessPpaRevTs = 0;
                let yRevenueTimeshifting = 0;
                let yRevenueArbitrage = 0;
                let yBessOpex = 0;
                let yOpexGridCharging = 0;
                let yMaintReserve = 0;
                let yLcoeEnergyTotal = 0;
                let yLcosEnergyTotal = 0;
                let yLcosCostsTotal = 0;
                let yOpexServiceContract = 0;
                let yHoldcoEarnoutPaid = 0;

                activePlants.forEach((plant, pIdx) => {
                    const plantBessMw = plant.bessMw !== undefined ? plant.bessMw : 0;
                    const plantBessMwh = plant.bessMwh !== undefined ? plant.bessMwh : 0;
                    const plantBessEfficiency = plant.bessEfficiency !== undefined ? plant.bessEfficiency : 0.90;
                    const plantBessDegradation = plant.bessDegradation !== undefined ? plant.bessDegradation : 0.018;
                    const plantBessCapexKwh = plant.bessCapexKwh !== undefined ? plant.bessCapexKwh : 300;
                    const plantBessType = plant.bessType || 'none';

                    const solarDegradation = Math.max(0.50, 1 - 0.0035 * (yr - 1));
                    // Rule thermal_degradation_vs_revenue_arbitrage: Cap excessive degradation to preserve battery safety
                    const effectiveBessDegradation = Math.min(0.035, plantBessDegradation);
                    const bessDegradationMult = plantBessType === 'graphene' ? 1.0 : Math.max(0.50, 1 - effectiveBessDegradation * (yr - 1));
                    
                    const pSolarMwh = (plant.annualSolarProductionMWh || 0) * solarDegradation;
                    const pShiftedMwh = (plant.sim ? plant.sim.annualShifted : 0) * bessDegradationMult;

                    // Decoupled revenues with plant-specific custom decays
                    const degradeRidFactor = 1 - (plant.degradeRidPct !== undefined ? plant.degradeRidPct : 2.0) / 100;
                    const degradeTimeshiftingFactor = 1 - (plant.degradeTimeshiftingPct !== undefined ? plant.degradeTimeshiftingPct : 2.0) / 100;
                    const degradeArbitrageFactor = 1 - (plant.degradeArbitragePct !== undefined ? plant.degradeArbitragePct : 2.0) / 100;

                    const ppaDuration = (plant._stab && plant._stab.ppaDuration) ? parseInt(plant._stab.ppaDuration) : 15;
                    const lossInject = resolveGridLosses(plant.gridVoltage, 'inject');
                    const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');
                    const lossMult = 1 + (lossInject / 100);
                    const gseImb = State.inputs.ridImbalanceCost || 0;
                    const fallbackPrice = (plant.marketType === 'fer_x') ? plant.ferxTariff : (plant._weightedPun * lossMult - gseImb);
                    const ridPriceY1 = (plant._solarGridFeedMwhY1 > 0) ? (plant._solarRidRevY1 / plant._solarGridFeedMwhY1) : fallbackPrice;
                    
                    let currentRidDecay = Math.pow(degradeRidFactor, yr - 1);
                    let currentTimeshiftingDecay = Math.pow(degradeTimeshiftingFactor, yr - 1);
                    let currentArbitrageDecay = Math.pow(degradeArbitrageFactor, yr - 1);
                    let ridPriceYr = ridPriceY1 * Math.pow(degradeRidFactor, yr - 1);

                    if (p.priceScenarioType === 'bearish_floor') {
                        currentRidDecay = K_y;
                        currentTimeshiftingDecay = Math.pow(1 - (p.tsBearishDecayRate || 0), yr - 1);
                        currentArbitrageDecay = Math.pow(1 - (p.arbBearishDecayRate || 0), yr - 1);
                        ridPriceYr = ridPriceY1 * K_y;
                    }

                    if (plant.marketType === 'fer_x') {
                        currentRidDecay = 1;
                        currentTimeshiftingDecay = 1;
                        currentArbitrageDecay = 1;
                        ridPriceYr = ridPriceY1;
                    }

                    let solarRidRev = 0;
                    let solarPpaRev = 0;
                    let bessPpaRev = 0;
                    let bessPpaRevArb = 0;
                    let bessPpaRevTs = 0;
                    let timeshiftingRev = 0;
                    let arbitrageRev = 0;
                    let pBessGridChargingCost = 0;

                    const pPhysSolarGen = (plant._physSolarGenMwhY1 || 0) * solarDegradation;
                    const pPhysSolarToBess = (plant._physSolarToBessMwhY1 || 0) * bessDegradationMult;
                    let pPhysSolarPpa = 0;
                    let pPhysSolarRid = 0;
                    let pPhysBessSelfCons = 0;
                    let pPhysBessSelfConsArb = 0;
                    let pPhysBessSelfConsTs = 0;
                    let pPhysBessGridFeed = 0;
                    let pPhysBessGridFeedArb = 0;
                    let pPhysBessGridFeedTs = 0;

                    const stab = plant._stab;
                    const plantSim = plant.sim;

                    if (stab && stab.ppaType === 'cer') {
                        const cerShareType = stab.cerShareType || 'shared_energy';
                        const zonePrices = State.zonalPun[String(plant.zone).toUpperCase()] || State.zonalPun["CNOR"];
                        const spread = plant.traderSpread || 0;
                        const disp = plant.traderDisp || 0;

                        // Determine CER tariff size parameters based on plant capacity (kWp)
                        let fissa = 0;
                        let cap = 0;
                        if (plant.capacity <= 20) {
                            fissa = State.inputs.cerFissaSmall;
                            cap = State.inputs.cerCapSmall;
                        } else if (plant.capacity <= 200) {
                            fissa = State.inputs.cerFissaMedium;
                            cap = State.inputs.cerCapMedium;
                        } else {
                            fissa = State.inputs.cerFissaLarge;
                            cap = State.inputs.cerCapLarge;
                        }

                        // Geographic correction
                        let geoCorr = 0;
                        const zoneUpper = String(plant.zone).toUpperCase();
                        
                        const cerTras = State.inputs.cerTras;
                        const cPR = resolveGridLosses(plant.gridVoltage, 'cpr') / 100;
                        const lossWithdraw = resolveGridLosses(plant.gridVoltage, 'withdraw');

                        if (zoneUpper === 'NORD') {
                            geoCorr = State.inputs.cerGeoNord;
                        } else if (zoneUpper === 'CNOR') {
                            geoCorr = State.inputs.cerGeoCentro;
                        } else {
                            geoCorr = State.inputs.cerGeoSud;
                        }

                        // PNRR reduction factor
                        const pnrrPct = plant.pnrrContributionPct || 0;
                        const decurtazioneF = 0.5 * (pnrrPct / 40);
                        const factorPNRR = 1 - decurtazioneF;

                        for (let t = 0; t < 8760; t++) {
                            const solar = plant.generation[t] * solarDegradation;
                            const pricePUN = zonePrices[t];
                            const basePrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                            const priceRID = basePrice * currentRidDecay;
                            const month = getMonthOfHour(t);
                            const traderPrice = plant.traderContractType === 'pun_medio' ? plant._monthlyAveragePun[month] : pricePUN;
                            const costGrid = (((traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000) * currentArbitrageDecay);

                            const chargeSolar = (plantSim.hourlyChargeSolar ? plantSim.hourlyChargeSolar[t] : 0) * bessDegradationMult;
                            const gridCharge = (plantSim.hourlyChargeGrid[t] || 0) * bessDegradationMult;
                            const bessDischarge = (plantSim.hourlyDischarge[t] || 0) * bessDegradationMult;
                            const bessDischargeGrid = (plantSim.hourlyDischargeGrid[t] || 0) * bessDegradationMult;
                            const gridFeedPv = Math.max(0, solar - chargeSolar);
                            const actualRid = gridFeedPv + bessDischargeGrid;

                            // 1. RID Revenues
                            solarRidRev += gridFeedPv * priceRID;
                            
                            // BESS RID revenues
                            const hourlyArb = (plantSim.hourlyRevenueArbitrageGrid[t] || 0) * bessDegradationMult * currentArbitrageDecay;
                            const hourlyTs = (plantSim.hourlyRevenueTimeshifting[t] || 0) * bessDegradationMult * currentTimeshiftingDecay;
                            arbitrageRev += hourlyArb;
                            timeshiftingRev += hourlyTs;
                            pBessGridChargingCost += gridCharge * costGrid;

                            // 2. CER Shared Energy (GSE)
                            const cerLoad = (stab.load && stab.load[t] !== undefined) ? stab.load[t] : 0;
                            const eSharedGse = Math.min(actualRid, cerLoad);

                            const hourlyArbPhys = (plantSim.hourlyDischargeArbitrage ? plantSim.hourlyDischargeArbitrage[t] : 0) * bessDegradationMult;
                            const hourlyTsPhys = (plantSim.hourlyDischargeTimeshifting ? plantSim.hourlyDischargeTimeshifting[t] : 0) * bessDegradationMult;
                            const actualRenewableRid = gridFeedPv + hourlyTsPhys;

                            // Priority-based shared energy allocation: Prioritize Renewable (Solar + BESS Timeshifting) over Arbitrage
                            const eSharedGseRenewable = Math.min(actualRenewableRid, cerLoad);
                            const eSharedGseBessArb = Math.min(hourlyArbPhys, eSharedGse - eSharedGseRenewable);

                            let eSharedGseSolar = 0;
                            let eSharedGseBessTs = 0;
                            if (actualRenewableRid > 0) {
                                const fSolarRen = gridFeedPv / actualRenewableRid;
                                eSharedGseSolar = eSharedGseRenewable * fSolarRen;
                                eSharedGseBessTs = eSharedGseRenewable * (1 - fSolarRen);
                            }

                            // 3. SPV Private PPA Contract
                            if (yr <= ppaDuration) {
                                const privatePpaPrice_kWh = (stab.ppaPrice || 0) / 1000;
                                let ePrivateSolar = 0;
                                let ePrivateBessArb = 0;
                                let ePrivateBessTs = 0;

                                if (cerShareType === 'total_generation') {
                                    ePrivateSolar = gridFeedPv;
                                    ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                                    ePrivateBessTs = hourlyTsPhys;
                                } else {
                                    // Use the priority-based allocation
                                    ePrivateSolar = eSharedGseSolar;
                                    ePrivateBessArb = 0; // Grid-charged Arbitrage is ineligible for CER PPA revenues
                                    ePrivateBessTs = eSharedGseBessTs;
                                }
                                const ePrivateBess = ePrivateBessTs + ePrivateBessArb;

                                solarPpaRev += ePrivateSolar * privatePpaPrice_kWh;
                                bessPpaRev += ePrivateBess * privatePpaPrice_kWh;
                                bessPpaRevArb += ePrivateBessArb * privatePpaPrice_kWh;
                                bessPpaRevTs += ePrivateBessTs * privatePpaPrice_kWh;

                                pPhysSolarPpa += ePrivateSolar / 1000;
                                pPhysBessSelfCons += ePrivateBess / 1000;
                                pPhysBessSelfConsArb += ePrivateBessArb / 1000;
                                pPhysBessSelfConsTs += ePrivateBessTs / 1000;
                            }
                            
                            pPhysSolarRid += gridFeedPv / 1000;
                        }
                        let sumDischGrid = 0;
                        if (plantSim && plantSim.hourlyDischargeGrid) {
                            for (let i = 0; i < plantSim.hourlyDischargeGrid.length; i++) sumDischGrid += plantSim.hourlyDischargeGrid[i];
                        }
                        pPhysBessGridFeed = (sumDischGrid / 1000 * bessDegradationMult) - pPhysBessSelfCons;
                    } else {
                        // Standard PPA or RID calculation
                        if (yr <= ppaDuration) {
                            pPhysSolarPpa = (plant._physSolarPpaMwhY1 || 0) * solarDegradation;
                        }
                        pPhysSolarRid = Math.max(0, pPhysSolarGen - pPhysSolarPpa - pPhysSolarToBess);

                        if (yr <= ppaDuration) {
                            solarRidRev = (plant._solarRidRevY1 || 0) * solarDegradation * currentRidDecay;
                            solarPpaRev = (plant._solarPpaRevY1 || 0) * solarDegradation;
                            bessPpaRev = (plant._bessPpaRevY1 || 0) * bessDegradationMult;
                            timeshiftingRev = (plant._timeshiftingRevY1 || 0) * bessDegradationMult * currentTimeshiftingDecay;
                            arbitrageRev = (plant._arbitrageRevY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                            pPhysBessSelfCons = (plant._physBessSelfConsMwhY1 || 0) * bessDegradationMult;
                            pPhysBessGridFeed = (plant._physBessGridFeedMwhY1 || 0) * bessDegradationMult;
                        } else {
                            solarPpaRev = 0;
                            bessPpaRev = 0;
                            solarRidRev = pPhysSolarRid * ridPriceYr;
                            timeshiftingRev = (plant._timeshiftingRevY1 || 0) * bessDegradationMult * currentTimeshiftingDecay;
                            arbitrageRev = (plant._arbitrageRevY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                            const bessPpaMwhYr = (plant._bessSelfConsMwhY1 || 0) * bessDegradationMult;
                            timeshiftingRev += bessPpaMwhYr * ridPriceYr;
                            pPhysBessSelfCons = 0;
                            pPhysBessGridFeed = ((plant._physBessSelfConsMwhY1 || 0) + (plant._physBessGridFeedMwhY1 || 0)) * bessDegradationMult;
                        }
                        pBessGridChargingCost = (plant._arbitrageCostY1 || 0) * bessDegradationMult * currentArbitrageDecay;
                    }

                    if (!(stab && stab.ppaType === 'cer')) {
                        pPhysBessSelfConsTs = pPhysBessSelfCons;
                    }
                    let sumDischArb = 0, sumDischTs = 0;
                    if (plantSim && plantSim.hourlyDischargeArbitrage) {
                        for (let i = 0; i < plantSim.hourlyDischargeArbitrage.length; i++) sumDischArb += plantSim.hourlyDischargeArbitrage[i];
                    }
                    if (plantSim && plantSim.hourlyDischargeTimeshifting) {
                        for (let i = 0; i < plantSim.hourlyDischargeTimeshifting.length; i++) sumDischTs += plantSim.hourlyDischargeTimeshifting[i];
                    }
                    const totalDischArb = (sumDischArb / 1000) * bessDegradationMult;
                    const totalDischTs = (sumDischTs / 1000) * bessDegradationMult;
                    pPhysBessGridFeedArb = Math.max(0, totalDischArb - pPhysBessSelfConsArb);
                    pPhysBessGridFeedTs = Math.max(0, totalDischTs - pPhysBessSelfConsTs);

                    // Reconstruct helper variables for service contract and earn-out compatibility
                    const bessRidRev = timeshiftingRev + arbitrageRev;

                    yOpexGridCharging += pBessGridChargingCost;
                    
                    const plantBessCAPEX = plantBessMwh * 1000 * plantBessCapexKwh;
                    let pBessOpex = 0;
                    if (plantBessMwh > 0) {
                        if (plant.opexOmBess !== undefined && plant.opexOmBess > 0) {
                            pBessOpex = plant.opexOmBess * inflationMultiplier;
                        } else {
                            pBessOpex = plantBessCAPEX * 0.015 * inflationMultiplier;
                        }
                    }
                    const pMaintReserve = (plantBessMw > 0 && plantBessType !== 'graphene') ? (4000 * (plant.capacity / 1000) * inflationMultiplier) : 0;

                    // Calculate PPA Service Contract for this plant in year yr (if within duration)
                    let pOpexServiceContract = 0;
                    const serviceYears = plant.serviceYears !== undefined ? plant.serviceYears : 0;
                    if (yr <= serviceYears) {
                        if (plant.serviceType === 'ppa_rev_pct') {
                            pOpexServiceContract = (plant.serviceVal / 100) * (solarPpaRev + bessPpaRev);
                        } else if (plant.serviceType === 'shared_ppa_mwh') {
                            const pSelfConsMwh = pPhysSolarPpa + pPhysBessSelfCons;
                            pOpexServiceContract = plant.serviceVal * pSelfConsMwh;
                        }
                    }
                    yOpexServiceContract += pOpexServiceContract;

                    // Calculate HoldCo Earn-Out for this plant in year yr (if within duration)
                    let pHoldcoEarnoutPaid = 0;
                    const earnoutYears = plant.earnoutYears !== undefined ? plant.earnoutYears : 0;
                    if (yr <= earnoutYears) {
                        if (plant.earnoutType === 'fixed') {
                            pHoldcoEarnoutPaid = plant.earnoutVal * inflationMultiplier;
                        } else if (plant.earnoutType === 'rid_pct') {
                            pHoldcoEarnoutPaid = (plant.earnoutVal / 100) * (solarRidRev + bessRidRev);
                        } else if (plant.earnoutType === 'total_rev_pct') {
                            pHoldcoEarnoutPaid = (plant.earnoutVal / 100) * (solarRidRev + solarPpaRev + bessRidRev + bessPpaRev);
                        } else if (plant.earnoutType === 'grid_feed_mwh') {
                            const pGridFeedMwh = pPhysSolarRid + pPhysBessGridFeed;
                            pHoldcoEarnoutPaid = plant.earnoutVal * pGridFeedMwh;
                        } else if (plant.earnoutType === 'generation_mwh') {
                            pHoldcoEarnoutPaid = plant.earnoutVal * pSolarMwh;
                        }
                    }
                    yHoldcoEarnoutPaid += pHoldcoEarnoutPaid;

                    ySolarMwh += pSolarMwh;
                    yShiftedMwh += pShiftedMwh;
                    yRevenueRid += solarRidRev;
                    yRevenuePpa += (solarPpaRev + bessPpaRev);
                    yRevenuePpaPv += solarPpaRev;
                    yBessPpaRevArb += bessPpaRevArb;
                    yBessPpaRevTs += bessPpaRevTs;
                    yRevenueTimeshifting += timeshiftingRev;
                    yRevenueArbitrage += arbitrageRev;
                    yBessOpex += pBessOpex;
                    yMaintReserve += pMaintReserve;

                    // Accumulate physical metrics
                    const pPhysBessDischarge = (plant._physBessDischargeMwhY1 || 0) * bessDegradationMult;
                    const pPhysBessChargeGrid = (plant._physBessChargeGridMwhY1 || 0) * bessDegradationMult;
                    const pPhysBessLosses = (plant._physBessLossesMwhY1 || 0) * bessDegradationMult;

                    yQtySolarGen += pPhysSolarGen;
                    yQtySolarPpa += pPhysSolarPpa;
                    yQtySolarRid += pPhysSolarRid;
                    yQtySolarToBess += pPhysSolarToBess;
                    
                    yQtyBessDischarge += pPhysBessDischarge;
                    yQtyBessSelfCons += pPhysBessSelfCons;
                    yQtyBessSelfConsArb += pPhysBessSelfConsArb;
                    yQtyBessSelfConsTs += pPhysBessSelfConsTs;
                    yQtyBessGridFeed += pPhysBessGridFeed;
                    yQtyBessGridFeedArb += pPhysBessGridFeedArb;
                    yQtyBessGridFeedTs += pPhysBessGridFeedTs;
                    yQtyBessChargeGrid += pPhysBessChargeGrid;
                    yQtyBessLosses += pPhysBessLosses;

                    // Accumulate correct energy quantities (avoid double counting shared energy in CER)
                    const isPlantCer = plant._stab && plant._stab.ppaType === 'cer';
                    const plantSolarQty = isPlantCer ? pPhysSolarRid : (pPhysSolarPpa + pPhysSolarRid);
                    yQtyEnergyGroup += (plantSolarQty + pPhysBessDischarge);
                    yQtySolarAvgDen += plantSolarQty;

                    ySolarPpaRev += solarPpaRev;
                    ySolarRidRev += solarRidRev;
                    yBessPpaRev += bessPpaRev;
                    yBessTimeshiftingRev += timeshiftingRev;
                    yBessArbitrageRev += arbitrageRev;
                    yBessGridChargingCost += pBessGridChargingCost;

                    yLcoeEnergyTotal += (pSolarMwh - (pShiftedMwh * (1 - plantBessEfficiency)));
                    yLcosEnergyTotal += pShiftedMwh;
                    yLcosCostsTotal += pBessOpex;
                    
                    const pOpexPlants = (plant.opex || 0) * inflationMultiplier;
                    const pOpexInsurance = (plant.opexInsurance || 0) * inflationMultiplier;
                    const pOpexTaxes = (plant.opexTaxes || 0) * inflationMultiplier;
                    const pOpexSecurity = (plant.opexSecurity || 0) * inflationMultiplier;
                    const pOpexAssetManagement = (plant.opexAssetManagement || 0) * inflationMultiplier;
                    const pLandDdsAnnuo = (plant.landType === 'dds_annuo' ? (plant.landCost || 0) : 0) * inflationMultiplier;
                    const pOpexTotal = pOpexPlants + pBessOpex + pBessGridChargingCost + pLandDdsAnnuo + pOpexInsurance + pOpexTaxes + pOpexSecurity + pOpexAssetManagement + pOpexServiceContract;
                    
                    let plantBessAugActual = 0;
                    if (yr === 10 && plantBessMw > 0 && plantBessType !== 'graphene') {
                        plantBessAugActual = (plantBessMwh * 1000 * plantBessCapexKwh) * 0.50;
                        plant._remainingBessAug += plantBessAugActual;
                    }
                    
                    let pDeprCivilBase = 0;
                    if (plant._remainingCivilBase > 0) {
                        const plantEpcCapex = plant.capacity * plant.capex;
                        const plantBessCAPEX = plantBessMwh * 1000 * plantBessCapexKwh;
                        const plantConnectionCapex = plant.connectionCost || 0;
                        const plantDevelopmentCapex = plant.developmentCost || 0;
                        const plantLandDdsAttualizzato = (plant.landType === 'dds_attualizzato' ? (plant.landCost || 0) : 0);
                        const plantBase = plantEpcCapex + plantBessCAPEX + plantConnectionCapex + plantDevelopmentCapex + plantLandDdsAttualizzato;
                        pDeprCivilBase = Math.min(plantBase * p.fiscalDeprRate, plant._remainingCivilBase);
                        plant._remainingCivilBase -= pDeprCivilBase;
                    }
                    
                    let pDeprBessAug = 0;
                    if (yr > 10 && plant._remainingBessAug > 0) {
                        const plantBessAugCost = (plantBessMw > 0 && plantBessType !== 'graphene') ? (plantBessMwh * 1000 * plantBessCapexKwh) * 0.50 : 0;
                        pDeprBessAug = Math.min(plantBessAugCost / 10, plant._remainingBessAug);
                        plant._remainingBessAug -= pDeprBessAug;
                    }
                    
                    opexBreakdown[pIdx].years.push({
                        opexTotal: pOpexTotal,
                        deprCivil: pDeprCivilBase + pDeprBessAug,
                        opexPlants: pOpexPlants,
                        opexBess: pBessOpex,
                        opexGridCharging: pBessGridChargingCost,
                        opexInsurance: pOpexInsurance,
                        opexTaxes: pOpexTaxes,
                        opexSecurity: pOpexSecurity,
                        opexAssetManagement: pOpexAssetManagement,
                        opexServiceContract: pOpexServiceContract,
                        maintReserve: pMaintReserve,
                        landDdsAnnuo: pLandDdsAnnuo
                    });

                });

                const yRevenueTotal = yRevenueRid + yRevenuePpa + yRevenueTimeshifting + yRevenueArbitrage;
                
                // Opex components
                const yOpexPlants = totalOpexPlants * inflationMultiplier;
                const yOpexInsurance = totalOpexInsurance * inflationMultiplier;
                const yOpexTaxes = totalOpexTaxes * inflationMultiplier;
                const yOpexSecurity = totalOpexSecurity * inflationMultiplier;
                const yOpexAssetManagement = totalOpexAssetManagement * inflationMultiplier;
                const yLandDdsAnnuoFee = totalLandDdsAnnuo * inflationMultiplier;
                
                // ── External financing opex (PE royalty_fee / AF advisory_fee) — costi SPV deducibili ──
                let yPeRoyalty = 0;   // PE royalty_fee: % ricavi SPV (parasociale)
                if (p.peEnabled && p.peMode === 'royalty_fee') {
                    yPeRoyalty = yRevenueTotal * ((p.peRoyaltyPct || 0) / 100);
                }
                let yAfFee = 0;      // AF advisory_fee: importo fisso + (% ricavi) inflazione
                if (p.afEnabled && p.afType === 'advisory_fee') {
                    const fixedPart = (p.afAnnualAmount || 0) * inflationMultiplier;
                    const revPart = yRevenueTotal * ((p.afRevenuePct || 0) / 100);
                    yAfFee = fixedPart + revPart;
                }
                
                // EBITDA (including all opex components)
                const yOpexTotal = yOpexPlants + yBessOpex + yOpexGridCharging + yLandDdsAnnuoFee + yOpexInsurance + yOpexTaxes + yOpexSecurity + yOpexAssetManagement + yOpexServiceContract + yPeRoyalty + yAfFee;
                const yEbitda = yRevenueTotal - yOpexTotal;
                totalEbitda += yEbitda;

                // Provisions & Maintenance reserve
                let mraBeginning = mraBalance;
                let yInterestActive = mraBeginning * 0.015;
                
                let yBessAugmentationActual = 0;
                let mraRelease = 0;
                if (yr === 10 && bessAugmentationCost > 0) {
                    yBessAugmentationActual = bessAugmentationCost;
                    mraRelease = Math.min(mraBeginning + yMaintReserve, yBessAugmentationActual);
                    extraDepreciationY11_20 = yBessAugmentationActual / 10; // Amortize cell cost over remaining 10 years
                    remainingBessAugmentationFiscal = yBessAugmentationActual;
                    remainingBessAugCivil = yBessAugmentationActual;
                }
                mraBalance = mraBeginning + yMaintReserve - mraRelease;

                // Civil Depreciation at fiscalDeprRate
                let yDeprSolar = 0;
                if (remainingSolarCivil > 0) {
                    yDeprSolar = Math.min((totalEpcCapex + totalLandDdsAttualizzatoCapex) * p.fiscalDeprRate, remainingSolarCivil);
                    remainingSolarCivil -= yDeprSolar;
                }
                
                let yDeprBessBase = 0;
                if (remainingBessCivil > 0) {
                    yDeprBessBase = Math.min(bessCAPEX * p.fiscalDeprRate, remainingBessCivil);
                    remainingBessCivil -= yDeprBessBase;
                }
                
                let yDeprBessAug = 0;
                if (yr > 10 && remainingBessAugCivil > 0) {
                    yDeprBessAug = Math.min(bessAugmentationCost / 10, remainingBessAugCivil);
                    remainingBessAugCivil -= yDeprBessAug;
                }
                
                const yDeprBess = yDeprBessBase + yDeprBessAug;
                
                let yDeprOther = 0;
                if (remainingOtherCivil > 0) {
                    yDeprOther = Math.min((totalConnectionCapex + totalDevelopmentCapex) * p.fiscalDeprRate, remainingOtherCivil);
                    remainingOtherCivil -= yDeprOther;
                }
                
                const yDepreciationCivil = yDeprSolar + yDeprBess + yDeprOther;

                // Debt Interest & Amortization (Dynamic Grace Period)
                let yInterest = 0, yPrincipalScheduled = 0, yPrincipalVoluntary = 0, yDebtServiceScheduled = 0;
                if (p.loanTerm > 0 && yr <= p.loanTerm && remainingDebt > 0) {
                    yInterest = remainingDebt * p.interestRate;
                    if (yr === 1) {
                        // Anno 1: Mesi di grazia (solo interessi) + Mesi di ammortamento (interessi + quota capitale)
                        const graceInterest = remainingDebt * p.interestRate * gracePeriodYears;
                        const amortInterest = remainingDebt * p.interestRate * (1 - gracePeriodYears);
                        yInterest = graceInterest + amortInterest;
                        
                        const fractionAmortizing = 1 - gracePeriodYears;
                        yPrincipalScheduled = Math.min(remainingDebt, Math.max(0, (annualDebtService * fractionAmortizing) - amortInterest));
                    } else {
                        yPrincipalScheduled = Math.min(remainingDebt, Math.max(0, annualDebtService - yInterest));
                    }
                    yDebtServiceScheduled = yInterest + yPrincipalScheduled;
                }

                let yBeginningShareholderLoan = remainingShareholderLoan;
                let ySociInterestAccrued = (p.sociInterestRate > 0 && yr > p.sociInterestGrace)
                    ? (remainingShareholderLoan * (p.sociInterestRate / 100))
                    : 0;

                // ── Private Debt interest & principal (external mezzanine at SPV level) ──
                let yPdInterestAccrued = 0;
                let yPdInterestPaid = 0;
                let yPdPrincipalPaid = 0;
                let yPdBulletPayoff = 0;
                const pdIsExitYear = (exitOptionYear > 0 && yr === exitOptionYear) || yr === exitYear;
                if (p.pdEnabled && pdAmount > 0) {
                    if (p.pdMode === 'bullet_exit') {
                        // PIK composto: interessi capitalizzati sul saldo (grazia = anni senza accrual)
                        if (yr > (p.pdInterestGrace || 0)) {
                            yPdInterestAccrued = remainingPd * ((p.pdInterestRate || 0) / 100);
                            remainingPd += yPdInterestAccrued;
                        }
                        if (pdIsExitYear) {
                            yPdBulletPayoff = remainingPd; // payoff gestito in sezione exit
                            remainingPd = 0;
                        }
                    } else if (p.pdMode === 'annual_interest') {
                        if (yr > (p.pdInterestGrace || 0)) {
                            yPdInterestAccrued = remainingPd * ((p.pdInterestRate || 0) / 100);
                            yPdInterestPaid = yPdInterestAccrued; // interessi pagati in cassa annualmente
                        }
                        // Capitale bullet a exit (o a loanTerm): payoff gestito in sezione exit
                        if (pdIsExitYear && remainingPd > 0) {
                            yPdBulletPayoff = remainingPd;
                            remainingPd = 0;
                        }
                    } else if (p.pdMode === 'amortizing') {
                        if (pdIsExitYear && remainingPd > 0) {
                            // Anno di exit: payoff bullet del saldo residuo. NON pagare anche la rata
                            // annua (sostituita dal bullet), altrimenti doppio conteggio nel FCFE Holding.
                            yPdBulletPayoff = remainingPd;
                            yPdPrincipalPaid = 0;
                            // Interessi dell'anno exit ancora dovuti (maturati sul saldo inizio anno)
                            const yPdIntExit = (yr > (p.pdInterestGrace || 0)) ? remainingPd * ((p.pdInterestRate || 0) / 100) : 0;
                            yPdInterestAccrued = yPdIntExit;
                            yPdInterestPaid = yPdIntExit;
                            remainingPd = 0;
                        } else if (yr <= (p.pdLoanTerm || 0)) {
                            const yPdInt = (yr > (p.pdInterestGrace || 0)) ? remainingPd * ((p.pdInterestRate || 0) / 100) : 0;
                            yPdInterestAccrued = yPdInt;
                            yPdInterestPaid = yPdInt;
                            if (yr > (p.pdPrincipalGrace || 0)) {
                                yPdPrincipalPaid = Math.min(remainingPd, Math.max(0, pdAmortizingAnnuality - yPdInt));
                            }
                            remainingPd = Math.max(0, remainingPd - yPdPrincipalPaid);
                        }
                    }
                }
                // ── Altra Forma: convertible note (PIK composto) ──
                let yAfInterestAccrued = 0;
                if (p.afEnabled && p.afType === 'convertible_note' && remainingAfConvertible > 0) {
                    yAfInterestAccrued = remainingAfConvertible * ((p.afConvertibleRate || 0) / 100);
                    remainingAfConvertible += yAfInterestAccrued;
                }
                // Componenti deducibili (solo AF convertible; il PD ora è a livello Holding e NON entra nel CE SPV)
                const yPdDeductible = 0; // PD non è più costo SPV (gestito a livello Holding)
                const yAfDeductible = (p.afTaxDeductible !== false) ? yAfInterestAccrued : 0;

                // EBIT & EBT (PD rimosso: è debito Holding, non SPV)
                const yEbit = yEbitda - yDepreciationCivil;
                const yEbt = yEbit + yInterestActive - yInterest - ySociInterestAccrued - yAfDeductible;

                // LCOE & LCOS discounting
                // LCOE is Solar PV only, excluding BESS costs, opex, charging, and maintenance reserve
                const yLcoeOpex = yOpexTotal - yBessOpex - yOpexGridCharging;
                lcoeSumDiscountedCosts += (yLcoeOpex / Math.pow(1 + p.wacc, yr));
                lcoeSumDiscountedEnergy += (ySolarMwh / Math.pow(1 + p.wacc, yr));
                
                if (totalBessMwh > 0) {
                    // LCOS includes BESS Opex, BESS cell augmentation, BESS grid charging cost, and BESS maintenance reserve (MRA)
                    const yLcosCostsTotalWithCharging = yLcosCostsTotal + yOpexGridCharging + yMaintReserve;
                    lcosSumDiscountedCosts += ((yLcosCostsTotalWithCharging + yBessAugmentationActual) / Math.pow(1 + p.wacc, yr));
                    lcosSumDiscountedEnergy += (yLcosEnergyTotal / Math.pow(1 + p.wacc, yr));
                }

                // Fiscal Depreciation (Corrected year 10 augmentation capitalization and Year 1 50% rule)
                let yTaxDepreciationPlant = 0;
                let yTaxDepreciationIdc = 0;
                if (remainingCapexToDepreciateFiscal > 0) {
                    const deprRateActual = (yr === 1) ? (p.fiscalDeprRate / 2) : p.fiscalDeprRate;
                    yTaxDepreciationPlant = Math.min(depreciablePlantBaseCivil * deprRateActual, remainingCapexToDepreciateFiscal);
                    remainingCapexToDepreciateFiscal -= yTaxDepreciationPlant;
                    
                    // Ripartizione proporzionale per IRAP
                    const deprRatio = depreciablePlantBaseCivil > 0 ? (yTaxDepreciationPlant / depreciablePlantBaseCivil) : 0;
                    yTaxDepreciationIdc = idcAmount * deprRatio;
                    remainingCapexFiscalPure -= (yTaxDepreciationPlant - yTaxDepreciationIdc);
                    remainingCapexFiscalIdc -= yTaxDepreciationIdc;
                }
                let totalAnnualDepreciationFiscal = yTaxDepreciationPlant;
                let yTaxDepreciationBessAug = 0;
                if (yr > 10 && remainingBessAugmentationFiscal > 0) {
                    yTaxDepreciationBessAug = Math.min(bessAugmentationCost * p.fiscalDeprRate, remainingBessAugmentationFiscal);
                    remainingBessAugmentationFiscal -= yTaxDepreciationBessAug;
                    totalAnnualDepreciationFiscal += yTaxDepreciationBessAug;
                }

                // --- INTEGRATED ART. 96 TUIR INTERMEDIATE TAX ENGINE ---
                const ebitdaFiscale = yEbitda;
                const currentRolCapacity = Math.max(0, ebitdaFiscale * 0.30);
                const totalRolAvailable = currentRolCapacity + rolCarriedForward;
                
                // Deduct interest expenses up to active interest revenues first (Art. 96)
                const netInterestExpenses = Math.max(0, (yInterest + ySociInterestAccrued + yAfDeductible) - yInterestActive);
                const deductibleNetInterest = Math.min(netInterestExpenses, totalRolAvailable);
                const totalDeductibleInterest = yInterestActive + deductibleNetInterest;
                
                interestExpensesCarriedForward = Math.max(0, (yInterest + ySociInterestAccrued + yAfDeductible + interestExpensesCarriedForward) - totalDeductibleInterest);
                rolCarriedForward = Math.max(0, totalRolAvailable - deductibleNetInterest);

                // IRAP — Base imponibile = EBIT civilistico (Art. 5 D.Lgs.446/97) + ripresa indeducibilità IMU e IDC civilistico
                const yCivilDepreciationIdc = depreciablePlantBaseCivil > 0 ? (yDepreciationCivil * (idcAmount / depreciablePlantBaseCivil)) : 0;
                const taxableIrap = Math.max(0, yEbit + yOpexTaxes + yCivilDepreciationIdc);
                const yIrapTax = taxableIrap * p.irapRate;

                // IRES (Deductible interest applied)
                let rawTaxableIres = ebitdaFiscale + yInterestActive - totalDeductibleInterest - totalAnnualDepreciationFiscal;
                let yIresTax = 0;
                if (rawTaxableIres > 0) {
                    // Art. 84 TUIR: First 3 years losses can offset 100% of taxable income
                    const appliedLossesFirst3Y = Math.min(rawTaxableIres, taxLossCarriedForwardFirst3Y);
                    rawTaxableIres -= appliedLossesFirst3Y;
                    taxLossCarriedForwardFirst3Y -= appliedLossesFirst3Y;
                    
                    // Subsequent years losses can offset up to 80% of taxable income
                    const limit80 = rawTaxableIres * 0.8;
                    const appliedLossesNormal = Math.min(limit80, taxLossCarriedForwardNormal);
                    rawTaxableIres -= appliedLossesNormal;
                    taxLossCarriedForwardNormal -= appliedLossesNormal;
                    
                    yIresTax = rawTaxableIres * p.iresRate;
                } else {
                    if (yr <= 3) {
                        taxLossCarriedForwardFirst3Y += Math.abs(rawTaxableIres);
                    } else {
                        taxLossCarriedForwardNormal += Math.abs(rawTaxableIres);
                    }
                }
                const taxLossCarriedForward = taxLossCarriedForwardFirst3Y + taxLossCarriedForwardNormal;

                const yCurrentTaxesSpv = yIrapTax + yIresTax;
                let rawDeferredTaxes = (totalAnnualDepreciationFiscal - yDepreciationCivil) * (p.iresRate + p.irapRate);
                if (rawDeferredTaxes < 0) {
                    // Reversal cannot exceed the accumulated fund
                    rawDeferredTaxes = -Math.min(Math.abs(rawDeferredTaxes), Math.max(0, deferredTaxFund));
                }
                deferredTaxFund += rawDeferredTaxes;
                const yDeferredTaxes = rawDeferredTaxes;
                const yCivilTaxes = yCurrentTaxesSpv + yDeferredTaxes;
                
                const yNetProfitSpv = yEbt - yCivilTaxes;

                // CFADS
                const yCfads = yNetProfitSpv
                    + yDepreciationCivil
                    + yDeferredTaxes
                    + yInterest
                    + ySociInterestAccrued
                    + yAfDeductible
                    - yMaintReserve
                    - yBessAugmentationActual
                    + mraRelease;

                let dscr = -1;
                if (yDebtServiceScheduled > 0) {
                    dscr = yCfads / yDebtServiceScheduled;
                    if (dscr < minDscr) minDscr = dscr;
                    sumDscr += dscr;
                    dscrYearsCount++;

                    // ── Cash Sweep Configurabile ──────────────────────────────────────
                    // Il sweep è rimborso anticipato facoltativo. Non è deducibile.
                    // Si applica solo se c'è CFADS in eccesso dopo il debt service.
                    if (p.sweepType !== 'none' && p.sweepValue > 0) {
                        const sweepActive = (p.sweepYears === 0) || (yr <= p.sweepYears);
                        if (sweepActive) {
                            const cfadsAvailableForSweep = Math.max(0, yCfads - yDebtServiceScheduled);
                            const maxAllowedSweep = Math.max(0, remainingDebt - yPrincipalScheduled);
                            if (p.sweepType === 'pct_cfads') {
                                // % del CFADS disponibile dopo debt service
                                yPrincipalVoluntary = Math.min(maxAllowedSweep,
                                    cfadsAvailableForSweep * (p.sweepValue / 100));
                            } else if (p.sweepType === 'fixed_eur') {
                                // Importo fisso annuo (non più del disponibile né del debito residuo)
                                yPrincipalVoluntary = Math.min(maxAllowedSweep,
                                    Math.min(cfadsAvailableForSweep, p.sweepValue));
                            }
                            yPrincipalVoluntary = Math.max(0, yPrincipalVoluntary);
                        }
                    }
                }

                let yPrincipalTotal = yPrincipalScheduled + yPrincipalVoluntary;
                let yDebtServiceActual = yInterest + yPrincipalTotal;
                remainingDebt = Math.max(0, remainingDebt - yPrincipalTotal);

                const ySpvFCF = yCfads - yDebtServiceActual;

                // ── Waterfall SPV: Senior service (già in ySpvFCF) → Soci → Dividendi comuni/PE ──
                // Il PD non è più nel waterfall SPV (è a livello Holding). yPdInterestPaidActual/yPdPrincipalPaidActual restano 0 a livello SPV.
                let yPdInterestPaidActual = 0;
                let yPdPrincipalPaidActual = 0;
                let cashAvailable = ySpvFCF;

                // PE ownership % (per distribuzioni proporzionali / preferred)
                const peOwnershipPct = (peAmount > 0 && (peAmount + equityAmount + remainingShareholderLoan) > 0) ? (peAmount / (peAmount + equityAmount + remainingShareholderLoan)) : 0;

                // Shareholder distribution (Finanziamento Soci) — subito dopo senior (PD rimosso dal waterfall SPV)
                const yTotalInterestPaid = Math.max(0, Math.min(ySociInterestAccrued, cashAvailable));
                let yTotalLoanRepayment = 0;
                if (yr > p.sociPrincipalGrace) {
                    yTotalLoanRepayment = Math.max(0, Math.min(remainingShareholderLoan, cashAvailable - yTotalInterestPaid));
                }
                cashAvailable -= (yTotalInterestPaid + yTotalLoanRepayment);
                remainingShareholderLoan = Math.max(0, remainingShareholderLoan + (ySociInterestAccrued - yTotalInterestPaid) - yTotalLoanRepayment);

                // Dividendi comuni (residuo disponibile)
                const yTotalDividends = Math.max(0, cashAvailable);
                let yDividendsDistributed = yTotalDividends;
                let yCashTrap = 0;

                let accumulatedSpvCashAtStart = spvLockedDividends;

                // --- DIVIDEND LOCK (CASH SWEEP) LOGIC ---
                if (p.dividendLock) {
                    const isExitYear = (exitOptionYear > 0 && yr === exitOptionYear) || yr === exitYear;
                    if (remainingDebt > 0.001 && !isExitYear) {
                        // Trattieni tutti i dividendi nella SPV
                        spvLockedDividends += yTotalDividends;
                        yCashTrap = yTotalDividends;
                        yDividendsDistributed = 0;
                    } else {
                        // Sblocca i dividendi accumulati + dividendo corrente
                        yDividendsDistributed = yTotalDividends + spvLockedDividends;
                        spvLockedDividends = 0;
                    }
                } else {
                    yCashTrap = 0;
                }

                // ── Distribuzioni Private Equity (sulla quota dividendi Sponsor/totali) ──
                let yPeDividendPaid = 0;   // quota PE sui dividendi SPV (outflow SPV → PE partner)
                let yPePreferredPaid = 0;  // preferred return distribuito a PE
                let yPeDividendToSponsor = yDividendsDistributed; // quota Sponsor (default 100%)
                if (p.peEnabled && peAmount > 0) {
                    if (p.peMode === 'dividend_share') {
                        // PE riceve quota proporzionale; Sponsor riceve il resto
                        yPeDividendPaid = yDividendsDistributed * peOwnershipPct;
                        yPeDividendToSponsor = yDividendsDistributed * (1 - peOwnershipPct);
                    } else if (p.peMode === 'preferred_return') {
                        // Hurdle composto maturato sul capitale PE; PE riceve fino a copertura (preferredPct% dei dividendi)
                        const peHurdleAccrual = peAmount * Math.pow(1 + (p.peHurdleRate || 0)/100, yr) - peAmount;
                        pePreferredAccrued = Math.max(pePreferredAccrued, peHurdleAccrual);
                        const pePreferredShare = (p.pePreferredPct || 100) / 100;
                        const peMaxFromDiv = yDividendsDistributed * pePreferredShare;
                        yPePreferredPaid = Math.min(pePreferredAccrued, peMaxFromDiv);
                        pePreferredAccrued -= yPePreferredPaid;
                        yPeDividendToSponsor = Math.max(0, yDividendsDistributed - yPePreferredPaid);
                    } else if (p.peMode === 'bullet_exit') {
                        // Nessun dividendo annuo; PE riscuote multiplo a exit (gestito in sezione exit)
                        yPeDividendToSponsor = yDividendsDistributed; // Sponsor tiene tutti i dividendi comuni
                    } else if (p.peMode === 'royalty_fee') {
                        // Royalty già in opex; nessuna quota dividendi
                        yPeDividendToSponsor = yDividendsDistributed;
                    }
                }

                // HoldCo Level Inflows (Sponsor ownership = 100% dei flussi intra-gruppo, al netto quote PE)
                const yHoldcoOpex = 15000 * inflationMultiplier;
                // Aggiungiamo yOpexAssetManagement come ricavo per la Holdco
                const taxableHoldcoRevenues = yTotalInterestPaid + (0.05 * yPeDividendToSponsor) + yOpexAssetManagement;
                const yHoldcoIresTaxPaid = Math.max(0, taxableHoldcoRevenues - yHoldcoOpex) * p.iresRate;

                // ── EXIT: payoff PD bullet, quota PE, costi AF (success fee / warrant / convertible) ──
                let exitNetProceeds = 0;
                let exitEquityValue = 0;
                let exitPexTax = 0;
                let exitEv = 0;
                let exitDebtPayoffVal = 0;
                let exitLimitedLiability = 0; // bridge (ora sempre 0: PD è a Holding, non c'è default SPV)
                let yPdBulletPayoffHoldco = 0; // payoff PD a livello Holding (cassa Holding)
                let yPdInterestPaidHoldco = 0; // servizio PD Holding (annual_interest/amortizing) pagato in cassa
                let yPeExitShare = 0;   // quota PE sull'exit equity value (o multiplo garantito)
                let yPeExitToSponsor = 0;
                let yAfExitCost = 0;    // costo AF a exit (success fee / warrant / convertible payoff)
                if (exitOptionYear > 0 && yr === exitOptionYear) {
                    let mwpForExit = 0;
                    if (State.plants && State.plants.length > 0) {
                        State.plants.forEach(pl => {
                            if (pl.enabled !== false) mwpForExit += (parseFloat(pl.capacity) || 0) / 1000;
                        });
                    }
                    if (mwpForExit === 0) mwpForExit = p.plantSystemSize || 0;
                    
                    exitEv = (p.exitValuePerMwp || 0) * mwpForExit;
                    if (exitEv === 0 && p.exitEnterpriseValue > 0) {
                        exitEv = p.exitEnterpriseValue;
                    }
                    // ── EXIT SPV: il PD non è più debito SPV (è a Holding level) ──
                    // L'exit equity value della SPV = EV - senior (senza PD payoff).
                    // Il PD è a livello Holding: il payoff PD si fa a livello Holding con
                    // la cassa Holding (cumulato FCFE + exitNetProceeds SPV).
                    // 1. Senior debt: payoff nominale (priorità assoluta SPV)
                    exitDebtPayoffVal = remainingDebt;
                    // 2. PE exit share: calcolato su exitEquityValue SPV (EV - senior)
                    exitEquityValue = Math.max(0, exitEv - exitDebtPayoffVal);
                    if (p.peEnabled && peAmount > 0) {
                        if (p.peMode === 'bullet_exit') {
                            yPeExitShare = Math.min(exitEquityValue, peAmount * (p.peExitMultiple || 0));
                        } else if (p.peParticipatesExit !== false && (p.peMode === 'dividend_share' || p.peMode === 'preferred_return')) {
                            yPeExitShare = exitEquityValue * peOwnershipPct;
                        }
                    }
                    // 3. Altra Forma exit cost (su equity positivo residuo)
                    if (p.afEnabled && exitEquityValue > 0) {
                        if (p.afType === 'success_fee_exit') {
                            yAfExitCost = Math.min(exitEv * ((p.afExitPct || 0) / 100), Math.max(0, exitEquityValue - yPeExitShare));
                        } else if (p.afType === 'warrant_kicker') {
                            yAfExitCost = Math.min(Math.max(0, exitEquityValue - yPeExitShare) * ((p.afWarrantPct || 0) / 100), Math.max(0, exitEquityValue - yPeExitShare));
                        } else if (p.afType === 'convertible_note') {
                            const conversionValue = exitEv * ((p.afConvertiblePct || 0) / 100);
                            yAfExitCost = Math.min(Math.max(remainingAfConvertible, conversionValue), Math.max(0, exitEquityValue - yPeExitShare));
                            remainingAfConvertible = 0;
                        }
                    }
                    // L'exit per definizione chiude il debito bancario: azzeriamo il saldo
                    // DOPO aver calcolato exitEquityValue (che usa exitDebtPayoffVal), così
                    // gli anni successivi non hanno servizio senior e DSCR = N/A.
                    remainingDebt = 0;
                    // Equity sponsor SPV (sempre ≥ 0: la SPV non ha più il PD)
                    const exitEquityToSponsor = Math.max(0, exitEquityValue - yPeExitShare - yAfExitCost);
                    yPeExitToSponsor = exitEquityToSponsor;
                    const taxBasis = equityAmount;
                    const capitalGain = Math.max(0, exitEquityToSponsor - taxBasis);
                    // PEX Tax: 5% of gain is taxed at IRES (24%), effective 1.2%
                    exitPexTax = capitalGain * 0.05 * p.iresRate;
                    exitNetProceeds = exitEquityToSponsor - exitPexTax;
                    // ── EXIT HOLDING: payoff PD con cassa Holding ──
                    // La Holding ha: cumulato FCFE Sponsor (anni precedenti) + exitNetProceeds SPV (corrente).
                    // Deve ripagare: saldo PD (capitale + interessi PIK se bullet) + servizio PD dell'anno (se annual/amortizing).
                    if (p.pdEnabled && pdAmount > 0) {
                        // Cassa Holding disponibile a exit = cumulato FCFE Sponsor + exitNetProceeds
                        const holdcoCashAtExit = cumulativeHoldcoFCFE + exitNetProceeds + (yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor + yOpexAssetManagement - yHoldcoOpex - yHoldcoIresTaxPaid - yHoldcoEarnoutPaid);
                        // Payoff PD bullet/residuo
                        yPdBulletPayoffHoldco = yPdBulletPayoff; // saldo PD catturato (bullet_exit o residuo annual/amortizing)
                        // Il payoff è cappato alla cassa Holding (limited liability Holding)
                        const pdPayoffActual = Math.min(yPdBulletPayoffHoldco, Math.max(0, holdcoCashAtExit));
                        exitLimitedLiability = yPdBulletPayoffHoldco - pdPayoffActual; // perdita PD se cassa < saldo (default Holding, raro)
                        yPdBulletPayoffHoldco = pdPayoffActual;
                        remainingPd = 0;
                    }
                }

                let yHoldcoFCFE = 0;
                let yProjectFCFF = 0;
                if (exitOptionYear === 0 || yr <= exitOptionYear) {
                    // ── Servizio PD a livello HOLDING (annual_interest / amortizing) ──
                    // Per bullet_exit il servizio annuo è 0 (PIK); il payoff è a exit (yPdBulletPayoffHoldco).
                    yPdInterestPaidHoldco = yPdInterestPaid; // cassa pagata dalla Holding per interessi PD annuali
                    // FCFE Sponsor = flussi intra-gruppo (quota Sponsor) + exit net proceeds - servizio PD Holding - payoff PD Holding
                    yHoldcoFCFE = yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor - yHoldcoOpex - yHoldcoIresTaxPaid - yHoldcoEarnoutPaid + exitNetProceeds + yOpexAssetManagement - yPdInterestPaidHoldco - yPdBulletPayoffHoldco - yPdPrincipalPaid;
                    totalHoldcoFCFE += yHoldcoFCFE;
                    cashFlowsForIRR.push(yHoldcoFCFE);
                    
                    // FCFF (Project Unlevered)
                    // EBITDA - CAPEX (nell'anno 0) - Tasse Operative - Variazione NWC
                    // Include BESS augmentation cost if any, excludes ALL financial flows (interest, debt, holdco fees)
                    const taxesForFcff = yIresTax + yIrapTax;
                    yProjectFCFF = yEbitda - yBessAugmentationActual - taxesForFcff + exitEv; 
                    // exitEv is added in the exit year to reflect the unlevered terminal value
                }



                cumulativeCfads += yCfads;
                cumulativeHoldcoFCFE += yHoldcoFCFE;

                // Push results matrix
                matrix.projectFCFF.push(yProjectFCFF);
                matrix.years.push(yr);
                matrix.spvFCFE.push(ySpvFCF);
                matrix.spvCashTrap.push(Math.max(0, ySpvFCF - yTotalInterestPaid - yTotalLoanRepayment - yTotalDividends) + yCashTrap);
                // External financing instruments rows
                matrix.pdInterestAccrued.push(yPdInterestAccrued);
                matrix.pdInterestPaid.push(yPdInterestPaidHoldco); // ora servizio a livello Holding
                matrix.pdPrincipalPaid.push(yPdPrincipalPaid); // amortizing: quota capitale Holding
                matrix.pdBulletPayoff.push(yPdBulletPayoffHoldco); // payoff PD a livello Holding (cappato cassa)
                matrix.pdServiceHoldco.push(yPdInterestPaidHoldco + yPdPrincipalPaid); // servizio PD Holding annuo (annual/amortizing)
                matrix.pdPayoffHoldco.push(yPdBulletPayoffHoldco); // payoff PD Holding a exit
                matrix.afFee.push(yAfFee);
                matrix.afInterestAccrued.push(yAfInterestAccrued);
                matrix.afExitCost.push(yAfExitCost);
                matrix.peRoyalty.push(yPeRoyalty);
                matrix.peDividendPaid.push(yPeDividendPaid + yPePreferredPaid);
                matrix.pePreferredPaid.push(yPePreferredPaid);
                matrix.peExitShare.push(yPeExitShare);
                matrix.pePreferredAccruedBalance.push(pePreferredAccrued);
                matrix.peDividendToSponsor.push(yPeDividendToSponsor);
                matrix.peExitToSponsor.push(yPeExitToSponsor);
                matrix.revenueTotal.push(yRevenueTotal);
                matrix.revenueTimeshifting.push(yRevenueTimeshifting);
                matrix.revenueRid.push(yRevenueRid);
                matrix.revenuePpa.push(yRevenuePpa);
                matrix.revenuePpaPv.push(yRevenuePpaPv);
                matrix.revenuePpaBessArb.push(yBessPpaRevArb);
                matrix.revenuePpaBessTs.push(yBessPpaRevTs);
                matrix.revenueArbitrage.push(yRevenueArbitrage);
                matrix.opexTotal.push(yOpexTotal);
                // Calculate unit prices
                const safeDiv = (num, den) => (den > 0.001) ? (num / den) : 0;
                
                // yQtyEnergyGroup is already accumulated in the plants loop to prevent double-counting under CER
                yPriceEnergyGroup = safeDiv(ySolarPpaRev + ySolarRidRev + yBessPpaRev + yBessTimeshiftingRev + yBessArbitrageRev, yQtyEnergyGroup);

                const yPriceSolarAvg = safeDiv(ySolarPpaRev + ySolarRidRev, yQtySolarAvgDen);
                const yPriceSolarPpa = safeDiv(ySolarPpaRev, yQtySolarPpa);
                const yPriceSolarRid = safeDiv(ySolarRidRev, yQtySolarRid);
                
                const yPriceBessAvg = safeDiv(yBessPpaRev + yBessTimeshiftingRev + yBessArbitrageRev, yQtyBessDischarge);
                const yPriceBessPpa = safeDiv(yBessPpaRev, yQtyBessSelfCons);
                const yPriceBessRid = safeDiv(yBessTimeshiftingRev + yBessArbitrageRev, yQtyBessChargeGrid + yQtySolarToBess);
                const yPriceBessArbitrage = safeDiv(yBessArbitrageRev, yQtyBessChargeGrid);
                const yPriceBessTimeshifting = safeDiv(yBessTimeshiftingRev, yQtySolarToBess);
                const yPriceBessChargeGrid = safeDiv(yBessGridChargingCost, yQtyBessChargeGrid);

                matrix.qtyEnergyGroup.push(yQtyEnergyGroup);
                matrix.priceEnergyGroup.push(yPriceEnergyGroup);

                matrix.qtySolarGen.push(yQtySolarGen);
                matrix.qtySolarPpa.push(yQtySolarPpa);
                matrix.qtySolarRid.push(yQtySolarRid);
                matrix.qtySolarToBess.push(yQtySolarToBess);
                matrix.qtyBessDischarge.push(yQtyBessDischarge);
                matrix.qtyBessSelfCons.push(yQtyBessSelfCons);
                matrix.qtyBessSelfConsArb.push(yQtyBessSelfConsArb);
                matrix.qtyBessSelfConsTs.push(yQtyBessSelfConsTs);
                matrix.qtyBessGridFeed.push(yQtyBessGridFeed);
                matrix.qtyBessGridFeedArb.push(yQtyBessGridFeedArb);
                matrix.qtyBessGridFeedTs.push(yQtyBessGridFeedTs);
                matrix.qtyBessChargeGrid.push(yQtyBessChargeGrid);
                matrix.qtyBessLosses.push(yQtyBessLosses);
                
                matrix.priceSolarAvg.push(yPriceSolarAvg);
                matrix.priceSolarPpa.push(yPriceSolarPpa);
                matrix.priceSolarRid.push(yPriceSolarRid);
                matrix.priceBessAvg.push(yPriceBessAvg);
                matrix.priceBessPpa.push(yPriceBessPpa);
                matrix.priceBessRid.push(yPriceBessRid);
                matrix.priceBessArbitrage.push(yPriceBessArbitrage);
                matrix.priceBessTimeshifting.push(yPriceBessTimeshifting);
                matrix.priceBessChargeGrid.push(yPriceBessChargeGrid);

                matrix.opexPlants.push(yOpexPlants);
                matrix.opexBess.push(yBessOpex);
                matrix.opexGridCharging.push(yOpexGridCharging);
                matrix.opexLandDds.push(yLandDdsAnnuoFee);
                matrix.opexInsurance.push(yOpexInsurance);
                matrix.opexTaxes.push(yOpexTaxes);
                matrix.opexSecurity.push(yOpexSecurity);
                matrix.opexAssetManagement.push(yOpexAssetManagement);
                matrix.opexServiceContract.push(yOpexServiceContract);
                matrix.opexMaintReserve.push(yMaintReserve);
                matrix.ebitda.push(yEbitda);
                matrix.ebit.push(yEbit);
                matrix.depreciationCivil.push(yDepreciationCivil);
                matrix.depreciationCivilSolar.push(yDeprSolar);
                matrix.depreciationCivilBess.push(yDeprBess);
                matrix.depreciationCivilOther.push(yDeprOther);
                matrix.interest.push(yInterest);
                matrix.interestPaid.push(yInterest);
                matrix.interestActive.push(yInterestActive);
                matrix.sociInterestAccrued.push(ySociInterestAccrued);
                matrix.ebt.push(yEbt);
                matrix.currentTaxesSpv.push(yCurrentTaxesSpv);
                matrix.iresTaxSpv.push(yIresTax);
                matrix.irapTaxSpv.push(yIrapTax);
                matrix.deferredTaxes.push(yDeferredTaxes);
                matrix.civilTaxesSpv.push(yCivilTaxes);
                matrix.netProfitSpv.push(yNetProfitSpv);
                matrix.cfads.push(yCfads);
                matrix.deductibleInterest.push(totalDeductibleInterest);
                matrix.interestCF.push(interestExpensesCarriedForward);
                matrix.rolCF.push(rolCarriedForward);
                matrix.taxLossCF.push(taxLossCarriedForward);
                matrix.dividendsPaid.push(yDividendsDistributed);
                matrix.holdcoFCFE.push(yHoldcoFCFE);
                // exitValuationGroup = somma nominale delle figlie (trasparente, può essere negativa in caso di default PD)
                // exitValuationGroup (SPV): EV - senior - PE - AF - PEX (senza PD, che è a Holding)
                matrix.exitValuationGroup.push(exitEv - exitDebtPayoffVal - yPeExitShare - yAfExitCost - exitPexTax);
                matrix.exitEnterpriseValue.push(exitEv);
                matrix.exitDebtPayoff.push(exitDebtPayoffVal);
                matrix.exitPexTaxRow.push(exitPexTax);
                matrix.exitNetProceedsRow.push(exitNetProceeds);
                matrix.exitLimitedLiability.push(exitLimitedLiability);
                matrix.rolCapacity.push(currentRolCapacity);
                matrix.bessAugmentationCost.push(yBessAugmentationActual);
                matrix.mraRelease.push(mraRelease);
                matrix.maintReserve.push(yMaintReserve);
                matrix.holdcoOpex.push(yHoldcoOpex);
                matrix.holdcoIresTaxPaid.push(yHoldcoIresTaxPaid);
                matrix.holdcoNetProfit.push(yTotalInterestPaid + yPeDividendToSponsor + yOpexAssetManagement - yHoldcoOpex - yHoldcoIresTaxPaid - yHoldcoEarnoutPaid);
                matrix.holdcoEarnoutPaid.push(yHoldcoEarnoutPaid);
                matrix.holdcoBuyoutPaid.push(0);
                matrix.holdcoInflowTotal.push(yTotalInterestPaid + yTotalLoanRepayment + yPeDividendToSponsor + yOpexAssetManagement);
                matrix.holdcoInterestReceived.push(yTotalInterestPaid);
                matrix.holdcoLoanRepaymentReceived.push(yTotalLoanRepayment);
                matrix.holdcoDividendReceived.push(yPeDividendToSponsor);
                matrix.spvLockedDividends.push(accumulatedSpvCashAtStart);
                matrix.partnerDividendReceived.push(0);
                matrix.cfadsCumulated.push(cumulativeCfads);
                matrix.holdcoFCFECumulated.push(cumulativeHoldcoFCFE);
                matrix.principalScheduled.push(yPrincipalScheduled);
                matrix.principalVoluntary.push(yPrincipalVoluntary);

                // Debt matrices
                debtSchedule.years.push(yr);
                debtSchedule.beginningBalance.push(yr === 1 ? debtAmount : debtSchedule.endingBalance[yr-2]);
                debtSchedule.interestAccrued.push(yInterest);
                debtSchedule.principalScheduled.push(yPrincipalScheduled);
                debtSchedule.principalVoluntary.push(yPrincipalVoluntary);
                debtSchedule.endingBalance.push(remainingDebt);
                debtSchedule.totalDebtService.push(yDebtServiceActual);
                debtSchedule.dscr.push(dscr);
                
                debtSchedule.beginningBalanceSoci.push(yBeginningShareholderLoan);
                debtSchedule.interestAccruedSoci.push(ySociInterestAccrued);
                debtSchedule.interestPaidSoci.push(yTotalInterestPaid);
                debtSchedule.principalPaidSoci.push(yTotalLoanRepayment);
                debtSchedule.endingBalanceSoci.push(remainingShareholderLoan);
                // Private Debt schedule (sezione 3)
                debtSchedule.beginningBalancePd.push(yr === 1 ? pdAmount : debtSchedule.endingBalancePd[yr-2]);
                debtSchedule.interestAccruedPd.push(yPdInterestAccrued);
                debtSchedule.interestPaidPd.push(yPdInterestPaidHoldco); // servizio a livello Holding
                debtSchedule.principalPaidPd.push(yPdPrincipalPaid); // solo quota capitale AMMORTAMENTO (Holding)
                debtSchedule.bulletPayoffPd.push(yPdBulletPayoffHoldco); // solo payoff BULLET/residuo exit (Holding)
                debtSchedule.endingBalancePd.push(remainingPd);
            }

            // NPV discounting FCFE with the Cost of Equity (Ke)
            let holdcoNpv = -equityAmount;
            const npvYearsLimit = exitOptionYear > 0 ? exitOptionYear : exitYear;
            for (let yr = 1; yr <= npvYearsLimit; yr++) {
                holdcoNpv += matrix.holdcoFCFE[yr - 1] / Math.pow(1 + p.keVal, yr);
            }

            const calculatedIrr = calculateIRR(cashFlowsForIRR);
            
            // Build Unlevered Project FCFF cashflows
            const cashFlowsForProjectIRR = [-(totalProjectCost + idcAmount)];
            for (let i = 0; i < (exitOptionYear > 0 ? exitOptionYear : p.loanTerm || 20); i++) {
                cashFlowsForProjectIRR.push(matrix.projectFCFF[i]);
            }
            const calculatedProjectIrr = calculateIRR(cashFlowsForProjectIRR);

            const calculatedLcoe = lcoeSumDiscountedEnergy > 0 ? (lcoeSumDiscountedCosts / lcoeSumDiscountedEnergy) : 0;
            const calculatedLcos = lcosSumDiscountedEnergy > 0 ? (lcosSumDiscountedCosts / lcosSumDiscountedEnergy) : 0;

            const holdcoMoic = equityAmount > 0 ? (totalHoldcoFCFE / equityAmount) : 0;

            let paybackPeriod = `> ${npvYearsLimit} Anni`;
            let cumulativeCash = -equityAmount;
            for (let t = 1; t <= npvYearsLimit; t++) {
                let prev = cumulativeCash;
                cumulativeCash += matrix.holdcoFCFE[t-1];
                if (prev < 0 && cumulativeCash >= 0) {
                    paybackPeriod = ((t-1) + Math.abs(prev)/matrix.holdcoFCFE[t-1]).toFixed(1) + " Anni";
                    break;
                }
            }

            // Compute portfolio-level self-consumption summary for Dashboard
            let totalSelfConsMwh = 0, totalPpaRev_y1 = 0, totalStabLoadMwh = 0;
            activePlants.forEach(plant => {
                totalSelfConsMwh += plant._selfConsumptionMwh || 0;
                totalPpaRev_y1   += plant._ppaRevenue_y1 || 0;
            });
            State.stabilimenti.forEach(s => {
                if (s.load) totalStabLoadMwh += Array.from(s.load).reduce((a,b)=>a+b,0) / 1000;
                else totalStabLoadMwh += s.annualConsumption || 0;
            });
            // Sincronizza lo stato degli impianti selezionati per il tab BESS
            const activePlantsForBess = State.plants.filter(p => p.enabled !== false);
            if (!State.selectedBessPlantIds) {
                State.selectedBessPlantIds = new Set(activePlantsForBess.map(p => p.id));
            } else {
                const activeIds = new Set(activePlantsForBess.map(p => p.id));
                // Rimuovi ID obsoleti
                for (const id of State.selectedBessPlantIds) {
                    if (!activeIds.has(id)) {
                        State.selectedBessPlantIds.delete(id);
                    }
                }
                // Aggiungi nuovi impianti se non erano presenti
                activePlantsForBess.forEach(p => {
                    if (!State.selectedBessPlantIds.has(p.id) && !State.previouslySeenPlantIds?.has(p.id)) {
                        State.selectedBessPlantIds.add(p.id);
                    }
                });
            }
            State.previouslySeenPlantIds = new Set(activePlantsForBess.map(p => p.id));

            const finalResults = {
                medioneKpiText: medioneKpiText,
                totalProjectCost, debtAmount, equityAmount,
                calculatedIrr, calculatedProjectIrr, holdcoNpv, holdcoMoic, paybackPeriod, calculatedLcoe, calculatedLcos, avgDscr: dscrYearsCount > 0 ? (sumDscr / dscrYearsCount) : 0, minDscr, totalEbitda, totalHoldcoFCFE,
                matrix, debtSchedule, combinedSolarProfile, generalMedionePrices, bessSimulation,
                totalBessMw, totalBessMwh,
                totalSelfConsMwh, totalPpaRev_y1, totalStabLoadMwh,
                stabCoverage: totalStabLoadMwh > 0 ? (totalSelfConsMwh / totalStabLoadMwh * 100) : 0,
                // CAPEX breakdown fields
                totalEpcCapex, bessCAPEX, totalConnectionCapex, totalLandPurchaseCapex, totalLandDdsAttualizzatoCapex, totalDevelopmentCapex, totalSpvAcquisitionCapex,
                // External financing instruments totals
                pdAmount, peAmount, pdMode: p.pdMode, peMode: p.peMode, afType: p.afType, pdEnabled: p.pdEnabled, peEnabled: p.peEnabled, afEnabled: p.afEnabled,
                // Per-plant specific metrics needed by UI summaries
                plantsMetrics: activePlants.map(p => ({
                    id: p.id,
                    selfConsumptionMwh: p._selfConsumptionMwh || 0,
                    ppaRevenue_y1: p._ppaRevenue_y1 || 0,
                    annualSolarProductionMWh: p.annualSolarProductionMWh || 0,
                    sim: p.sim
                }))
            };
            return finalResults;
        }

        function resolveGridLosses(voltage, type) {
            // type: 'inject' | 'withdraw' | 'cpr'
            // voltage: 'bt' | 'mt' | 'at'
            const v = String(voltage || 'none').toLowerCase().trim();
            if (v !== 'bt' && v !== 'mt' && v !== 'at') return 0;
            const suffix = v === 'bt' ? 'Bt' : (v === 'mt' ? 'Mt' : 'At');
            let key = '';
            if (type === 'inject') key = 'ridLossInject' + suffix;
            else if (type === 'withdraw') key = 'ridLossWithdraw' + suffix;
            else if (type === 'cpr') key = 'cerLossCpr' + suffix;
            else return 0;
            return State.inputs[key] !== undefined ? State.inputs[key] : 0;
        }

        function generateDefaultSolarProfile(capacityMw, yieldKwhKwp) {
            const profile = new Float64Array(8760);
            let totalUnitGen = 0;
            for (let hourIndex = 0; hourIndex < 8760; hourIndex++) {
                const dayOfYear = Math.floor(hourIndex / 24);
                const hourOfDay = hourIndex % 24;
                const seasonFactor = 1.0 + 0.35 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                const sunrise = 6 - Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                const sunset = 18 + Math.sin(2 * Math.PI * (dayOfYear - 81) / 365);
                
                if (hourOfDay >= sunrise && hourOfDay <= sunset) {
                    const peakFactor = Math.sin(Math.PI * (hourOfDay - sunrise) / (sunset - sunrise));
                    const gen = peakFactor * seasonFactor;
                    profile[hourIndex] = gen;
                    totalUnitGen += gen;
                } else {
                    profile[hourIndex] = 0;
                }
            }
            const targetTotalGenKwh = capacityMw * 1000 * yieldKwhKwp;
            const scaleFactor = targetTotalGenKwh / totalUnitGen;
            for (let i = 0; i < 8760; i++) {
                profile[i] *= scaleFactor;
            }
            return profile;
        }

        function generateLoadCurve(annualMwh, worksSat, worksSun, worksHol, shiftType, plantId) {
            if (shiftType === 'public_lighting') {
                const plant = State.plants.find(p => p.id === plantId);
                const lat = plant ? plant.pvgisLatitude : null;
                const lng = plant ? plant.pvgisLongitude : null;
                return calculateTwilightCurve(annualMwh, lat, lng);
            }

            if (shiftType === 'domestic') {
                return generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol);
            }

            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (3 + dayIdx) % 7; // 0=Sun,6=Sat
                const isHoliday = IT_HOLIDAYS_2025.has(dayIdx);
                const isSunday  = dow === 0;
                const isSaturday= dow === 6;
                let isWorkDay = true;
                if (isHoliday && !worksHol) isWorkDay = false;
                else if (isSunday && !worksSun) isWorkDay = false;
                else if (isSaturday && !worksSat) isWorkDay = false;

                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    let f = 0;
                    if (shiftType === 'three_shifts') {
                        f = isWorkDay ? 0.85 : 0.40;
                    } else if (!isWorkDay) {
                        f = 0.05;
                    } else if (shiftType === 'two_shifts') {
                        if      (h === 5)               f = 0.30;
                        else if (h === 6)               f = 0.65;
                        else if (h === 7)               f = 0.90;
                        else if (h >= 8  && h <= 11)    f = 1.00;
                        else if (h === 12)              f = 0.72; // pausa pranzo
                        else if (h === 13)              f = 0.78;
                        else if (h >= 14 && h <= 18)    f = 1.00;
                        else if (h === 19)              f = 0.88;
                        else if (h === 20)              f = 0.68;
                        else if (h === 21)              f = 0.45;
                        else                            f = 0.10;
                    } else { // office 8-18
                        if      (h === 7)               f = 0.40;
                        else if (h === 8)               f = 0.75;
                        else if (h === 9)               f = 0.95;
                        else if (h >= 10 && h <= 11)    f = 1.00;
                        else if (h === 12)              f = 0.55;
                        else if (h === 13)              f = 0.65;
                        else if (h >= 14 && h <= 16)    f = 0.95;
                        else if (h === 17)              f = 0.70;
                        else if (h === 18)              f = 0.30;
                        else                            f = 0.05;
                    }
                    rawLoad[t] = f;
                }
            }
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }

        function generateDomesticCurve(annualMwh, worksSat, worksSun, worksHol) {
            const rawLoad = new Float64Array(8760);
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const dow = (3 + dayIdx) % 7; // 0=Sun,6=Sat
                const isHoliday = IT_HOLIDAYS_2025.has(dayIdx);
                const isSunday  = dow === 0;
                const isSaturday= dow === 6;
                let isWorkDay = true;
                if (isHoliday && !worksHol) isWorkDay = false;
                else if (isSunday && !worksSun) isWorkDay = false;
                else if (isSaturday && !worksSat) isWorkDay = false;

                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    let f = 0;
                    if (isWorkDay) {
                        // Domestic work day profile
                        if (h < 6)                      f = 0.15;
                        else if (h === 6)               f = 0.35;
                        else if (h === 7)               f = 0.70;
                        else if (h === 8)               f = 0.80;
                        else if (h === 9)               f = 0.50;
                        else if (h >= 10 && h <= 12)    f = 0.30;
                        else if (h === 13)              f = 0.40;
                        else if (h === 14)              f = 0.35;
                        else if (h >= 15 && h <= 17)    f = 0.30;
                        else if (h === 18)              f = 0.60;
                        else if (h === 19)              f = 0.85;
                        else if (h === 20)              f = 1.00;
                        else if (h === 21)              f = 0.95;
                        else if (h === 22)              f = 0.60;
                        else                            f = 0.30;
                    } else {
                        // Domestic weekend / holiday profile
                        if (h < 6)                      f = 0.15;
                        else if (h === 6)               f = 0.25;
                        else if (h === 7)               f = 0.45;
                        else if (h === 8)               f = 0.70;
                        else if (h === 9)               f = 0.80;
                        else if (h >= 10 && h <= 12)    f = 0.65;
                        else if (h === 13)              f = 0.85;
                        else if (h === 14)              f = 0.75;
                        else if (h >= 15 && h <= 17)    f = 0.65;
                        else if (h === 18)              f = 0.70;
                        else if (h === 19)              f = 0.90;
                        else if (h === 20)              f = 1.00;
                        else if (h === 21)              f = 0.95;
                        else if (h === 22)              f = 0.70;
                        else                            f = 0.40;
                    }
                    rawLoad[t] = f;
                }
            }
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }

        function calculateTwilightCurve(annualMwh, lat, lng) {
            const rawLoad = new Float64Array(8760);
            const latitude = (lat !== null && lat !== undefined) ? lat : 43.591;
            const longitude = (lng !== null && lng !== undefined) ? lng : 10.394;
            const latRad = latitude * Math.PI / 180;
            
            for (let dayIdx = 0; dayIdx < 365; dayIdx++) {
                const d = dayIdx + 1;
                // Solar declination
                const decl = 0.40928 * Math.sin(2 * Math.PI * (d - 80) / 365);
                // Zenith angle for civil twilight is 96 degrees
                const cosH = (-0.104528 - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
                
                let H;
                if (cosH >= 1) {
                    H = 0;
                } else if (cosH <= -1) {
                    H = Math.PI;
                } else {
                    H = Math.acos(cosH);
                }
                
                const H_hours = H * 12 / Math.PI;
                const b = 2 * Math.PI * (d - 81) / 364;
                const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
                const eotHours = eot / 60;
                
                const isDST = (d >= 89 && d < 299);
                const tzOffset = isDST ? 2 : 1;
                
                const solarNoon = 12 - (longitude - 15 * tzOffset) / 15 - eotHours;
                const sunrise = solarNoon - H_hours;
                const sunset = solarNoon + H_hours;
                
                for (let h = 0; h < 24; h++) {
                    const t = dayIdx * 24 + h;
                    if (h < sunrise || h >= sunset) {
                        rawLoad[t] = 1.0;
                    } else {
                        rawLoad[t] = 0.0;
                    }
                }
            }
            
            const rawSum = rawLoad.reduce((a, b) => a + b, 0);
            if (rawSum === 0) return rawLoad;
            const scaleFactor = (annualMwh * 1000) / rawSum;
            const load = new Float64Array(8760);
            for (let t = 0; t < 8760; t++) load[t] = rawLoad[t] * scaleFactor;
            return load;
        }

        function buildZeroResults() {
            return {
                cashFlowsForIRR: [], matrix: {}, debtSchedule: {}, pdSchedule: {}, cashTrapActiveYears: 0, exitEquityValue: 0,
                calculatedProjectIrr: 0, calculatedIrr: 0, holdcoNpv: 0, holdcoMoic: 0,
                paybackPeriod: "-", calculatedLcoe: 0, calculatedLcos: 0, avgDscr: 0, minDscr: 0, totalEbitda: 0, totalHoldcoFCFE: 0,
                totalProjectCost: 0, equityAmount: 0, debtAmount: 0,
                pdAmount: 0, peAmount: 0, pdEnabled: false, peEnabled: false, afEnabled: false,
                combinedSolarProfile: new Float64Array(8760),
                generalMedioneKpiValue: 0,
            };
        }

        function calculateIRR(cashFlows) {
            const len = cashFlows.length;
            const hasNegative = cashFlows.some(v => v < 0);
            const hasPositive = cashFlows.some(v => v > 0);
            if (!hasNegative || !hasPositive) return 0;
            
            // Try standard Newton-Raphson first
            let irr = 0.08; 
            const maxIterations = 100;
            const precision = 1e-7;
            let converged = false;
            
            for (let i = 0; i < maxIterations; i++) {
                let npv = 0;
                let dNpv = 0; 
                let valid = true;
                for (let t = 0; t < len; t++) {
                    const factor = Math.pow(1 + irr, t);
                    if (isNaN(factor) || !isFinite(factor)) {
                        valid = false;
                        break;
                    }
                    npv += cashFlows[t] / factor;
                    dNpv -= t * cashFlows[t] / (factor * (1 + irr));
                }
                if (!valid || !isFinite(npv) || !isFinite(dNpv) || dNpv === 0) {
                    break;
                }
                const newIrr = irr - npv / dNpv;
                if (Math.abs(newIrr - irr) < precision) {
                    irr = newIrr;
                    converged = true;
                    break;
                }
                if (newIrr <= -0.99 || newIrr > 50.0) {
                    break;
                }
                irr = newIrr;
            }
            
            if (converged) {
                return irr * 100;
            }
            
            // Fallback to stable Bisection Search
            let low = -0.9999;
            let high = 100.0;
            
            const getNpv = (rate) => {
                let npv = 0;
                for (let t = 0; t < len; t++) {
                    npv += cashFlows[t] / Math.pow(1 + rate, t);
                }
                return npv;
            };
            
            let npvLow = getNpv(low);
            let npvHigh = getNpv(high);
            
            if (npvLow * npvHigh > 0) {
                if (npvHigh > 0) {
                    high = 1000.0;
                    npvHigh = getNpv(high);
                }
            }
            
            if (npvLow * npvHigh <= 0) {
                for (let i = 0; i < 100; i++) {
                    const mid = (low + high) / 2;
                    const npvMid = getNpv(mid);
                    if (Math.abs(npvMid) < 1e-6 || (high - low) < precision) {
                        return mid * 100;
                    }
                    if (npvMid * npvLow > 0) {
                        low = mid;
                        npvLow = npvMid;
                    } else {
                        high = mid;
                        npvHigh = npvMid;
                    }
                }
                return ((low + high) / 2) * 100;
            }
            
            const sum = cashFlows.reduce((a, b) => a + b, 0);
            if (sum === 0) return 0;
            return sum < 0 ? -99.99 : 999.99;
        }
