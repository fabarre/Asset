import re

with open('src/main.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("Ricavi RID (Pure)", "Ricavi RID / FER X (Pure)")
content = content.replace("Ricavi RID (Reali)", "Ricavi RID / FER X (Reali)")
content = content.replace("Ricavi RID (FV)", "Ricavi RID / FER X (FV)")

with open('src/main.js', 'w', encoding='utf-8') as f:
    f.write(content)

with open('index.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

html_content = html_content.replace("Ricavi RID/PUN", "Ricavi RID / FER X")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html_content)

print("Patch UI labels completed.")
