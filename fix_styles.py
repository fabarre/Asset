import re

with open('src/excelExport.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Global Header style
code = code.replace("fgColor: { argb: 'FF0F172A' }", "fgColor: { argb: 'FF203864' }")
code = code.replace("color: { argb: 'FF334155' }", "color: { argb: 'FFD9D9D9' }") # borders

# Add showGridLines: false
code = code.replace("ySplit: 1 }]", "ySplit: 1, showGridLines: false }]")

# Default Row styles (replace all)
code = code.replace("let rowFont = { color: { argb: 'FFCBD5E1' }, italic: false, bold: false };", "let rowFont = { color: { argb: 'FF000000' }, italic: false, bold: false };")
code = code.replace("let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF020617' } };", "let rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };")

# Borders
code = code.replace("color: { argb: 'FF1E293B' }", "color: { argb: 'FFD9D9D9' }")

# Group Header
code = code.replace("rowFont = { bold: true, color: { argb: 'FFE2E8F0' } };", "rowFont = { bold: true, color: { argb: 'FF000000' } };")
code = code.replace("rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF080D19' } };", "rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };")
code = code.replace("rowFont = { bold: true, color: { argb: 'FF6366F1' } };", "rowFont = { bold: true, color: { argb: 'FF000000' } };")
code = code.replace("rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111C30' } };", "rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };")
code = code.replace("color: { argb: 'FF312E81' }", "color: { argb: 'FFD9D9D9' }")

# Bold
code = code.replace("rowFont = { bold: true, color: { argb: 'FFF8FAFC' } };", "rowFont = { bold: true, color: { argb: 'FF000000' } };")
code = code.replace("rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141F35' } };", "rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };")
code = code.replace("rowFont.bold = true; rowFont.color = { argb: 'FFF1F5F9' };", "rowFont.bold = true; rowFont.color = { argb: 'FF000000' };")
code = code.replace("rowFill.fgColor = { argb: 'FF0F172A' };", "rowFill.fgColor = { argb: 'FFF2F2F2' };")

# Bold Teal
code = code.replace("rowFont = { bold: true, color: { argb: 'FF2DD4BF' } };", "rowFont = { bold: true, color: { argb: 'FF000000' } };")

# Bold Rose
code = code.replace("rowFont = { bold: true, color: { argb: 'FFF43F5E' } };", "rowFont = { bold: true, color: { argb: 'FFC00000' } };")

# Total Gold
code = code.replace("rowFont = { bold: true, color: { argb: 'FFEAB308' } };", "rowFont = { bold: true, color: { argb: 'FF000000' } };")

# Total Purple
code = code.replace("rowFont.bold = true; rowFont.color = { argb: 'FFA78BFA' };", "rowFont.bold = true; rowFont.color = { argb: 'FF000000' };")
code = code.replace("rowFill.fgColor = { argb: 'FF1E1B4B' };", "rowFill.fgColor = { argb: 'FFF4ECF7' };")

# Minus
code = code.replace("rowFont = { color: { argb: 'FFF87171' } };", "rowFont = { color: { argb: 'FFC00000' } };")
code = code.replace("rowFont.color = { argb: 'FFF87171' };", "rowFont.color = { argb: 'FFC00000' };")

# Plus
code = code.replace("rowFont = { color: { argb: 'FF34D399' } };", "rowFont = { color: { argb: 'FF006100' } };")
code = code.replace("rowFont.color = { argb: 'FF34D399' };", "rowFont.color = { argb: 'FF006100' };")

# Detail
code = code.replace("rowFont = { italic: true, color: { argb: 'FF94A3B8' } };", "rowFont = { italic: true, color: { argb: 'FF595959' } };")
code = code.replace("rowFont = { italic: true, color: { argb: 'FF475569' } };", "rowFont = { italic: true, color: { argb: 'FF7F7F7F' } };")

# Title Purple
code = code.replace("rowFont = { bold: true, color: { argb: type === 'title-purple' ? 'FFC4B5FD' : 'FF6EE7B7' }, size: 10 };", "rowFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };")
code = code.replace("rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: type === 'title-purple' ? 'FF1E1B4B' : 'FF064E3B' } };", "rowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: type === 'title-purple' ? 'FF4A235A' : 'FF0E6251' } };")

# Normal
code = code.replace("rowFont = { color: { argb: 'FFCBD5E1' } };", "rowFont = { color: { argb: 'FF000000' } };")

with open('src/excelExport.js', 'w', encoding='utf-8') as f:
    f.write(code)

print('Styles updated successfully.')
