import re

with open('src/main.js', 'r', encoding='utf-8') as f:
    content = f.read()

function_code = """
        // Seasonal solar profile generator
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

"""

target = "        function initializeDefaultPrices() {"
if "function generateDefaultSolarProfile(" not in content:
    content = content.replace(target, function_code + target)
    with open('src/main.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Function injected successfully.")
else:
    print("Function already exists!")
