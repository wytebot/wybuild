/**
 * Turn an assistant reply into a downloadable file in the format the prompt asked for.
 * Pure helpers (no React, no Dexie) so they run in the browser, the Capacitor APK and Node tests.
 *
 * Supported here: txt, md, csv, json, html, docx. PDF is produced by the caller (App.jsx owns the
 * PDF writer). Anything else returns null so the caller can say so plainly instead of faking a file.
 */

export const TEXT_OUTPUT_FORMATS = ['txt','md','csv','json','html','docx','pdf','xlsx','zip','pptx','xml','yaml','py','js','ts','css','sql','sh'];

const MIME = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xml: 'application/xml', yaml: 'application/yaml', py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript', css: 'text/css', sql: 'application/sql', sh: 'text/x-shellscript',
};

export function mimeForFormat(format) {
  return MIME[format] || 'application/octet-stream';
}

export function safeBaseName(value, fallback = 'pothub-output') {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || fallback;
}

/** First fenced block, optionally restricted to given languages. */
export function firstFence(text, languages = []) {
  const rx = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = rx.exec(String(text || '')))) {
    const lang = (match[1] || '').toLowerCase();
    if (!languages.length || languages.includes(lang)) return match[2].replace(/\n$/, '');
  }
  return '';
}

/** Markdown → readable plain text (used for txt and pdf). */
export function markdownToPlain(text) {
  return String(text || '')
    .replace(/```[\w+-]*[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMarkdownTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) continue;
    const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const rows = [cells(lines[i])];
    for (let j = i + 2; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]); j++) rows.push(cells(lines[j]));
    return rows;
  }
  return null;
}

function csvCell(value) {
  const text = String(value ?? '');
  // Neutralise spreadsheet formula injection while keeping ordinary negative numbers intact.
  const safe = /^[=+@]/.test(text) || /^-(?![\d.])/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(text) {
  const fenced = firstFence(text, ['csv']);
  if (fenced.trim()) { const rows = parseCsvRows(fenced); return rows.length ? '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' : ''; }
  const table = parseMarkdownTable(text);
  if (table) return '\uFEFF' + table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return '';
}

function toJson(text) {
  const candidates = [firstFence(text, ['json']), firstFence(text), String(text || '').trim()].filter((c) => c && c.trim());
  const braces = String(text || '').match(/[\[{][\s\S]*[\]}]/);
  if (braces) candidates.push(braces[0]);
  for (const candidate of candidates) {
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2) + '\n';
    } catch { /* try next candidate */ }
  }
  return '';
}

function toHtml(text) {
  const fenced = firstFence(text, ['html']);
  if (fenced.trim()) return fenced.trim() + '\n';
  const raw = String(text || '').trim();
  return /<\s*(?:html|body|div|p|h1|section)\b/i.test(raw) ? raw + '\n' : '';
}

const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  // Strip characters that are illegal in XML 1.0.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

function docxRun(text, { bold = false, italic = false, mono = false, size = 0 } = {}) {
  const props = `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function inlineRuns(text, base = {}) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== '');
  return parts.map((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return docxRun(part.slice(2, -2), { ...base, bold: true });
    if (/^`[^`]+`$/.test(part)) return docxRun(part.slice(1, -1), { ...base, mono: true });
    return docxRun(part, base);
  }).join('');
}

function markdownToDocxBody(markdown) {
  const out = [];
  let inFence = false;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { out.push(`<w:p>${docxRun(line || ' ', { mono: true, size: 20 })}</w:p>`); continue; }
    if (!line.trim()) { out.push('<w:p/>'); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) { out.push(`<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>${inlineRuns(heading[2], { bold: true, size: Math.max(24, 40 - heading[1].length * 4) })}</w:p>`); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/) || line.match(/^\s*(\d+[.)])\s+(.*)$/);
    if (bullet) { const label = bullet.length === 3 ? `${bullet[1]} ` : '• '; out.push(`<w:p><w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr>${docxRun(label)}${inlineRuns(bullet[bullet.length - 1])}</w:p>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { out.push(`<w:p>${docxRun(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('    '), { mono: true, size: 20 })}</w:p>`); continue; }
    out.push(`<w:p>${inlineRuns(line)}</w:p>`);
  }
  return out.join('');
}

async function toDocx(text, title) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const heading = title ? `<w:p>${docxRun(title, { bold: true, size: 40 })}</w:p>` : '';
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${heading}${markdownToDocxBody(text)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}


function namedFences(source) {
  const out = []; const rx = /```([\w.+-]*)\s+file=([^\n]+)\n([\s\S]*?)```/g; let m;
  while ((m = rx.exec(source))) {
    let name = m[2].trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(?:\/|$)/g, '').replace(/[^a-zA-Z0-9._/-]/g, '-');
    name = name.split('/').filter(part => part && part !== '.' && part !== '..').map(part => part.replace(/[. ]+$/g, '')).join('/');
    if (!name || name.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) continue;
    out.push({name, content:m[3].replace(/\n$/, '')});
  } return out;
}
function toXml(source) { const raw = firstFence(source, ['xml']) || source.trim(); return /^<\?xml\b|^<[A-Za-z_:][\w:.-]*(?:\s|>)/.test(raw) ? raw + '\n' : ''; }
function toYaml(source) { const raw = firstFence(source, ['yaml','yml']) || source.trim(); return raw && !/```/.test(raw) && (/^[\w.-]+\s*:\s*.+/m.test(raw) || /^\s*-\s+\S+/m.test(raw)) ? raw + '\n' : ''; }
async function toZip(source, title) {
  const files = namedFences(source); if (!files.length) return null;
  const JSZip = (await import('jszip')).default; const zip = new JSZip(); const used = new Set(); const manifest = [];
  for (const file of files) { let name=file.name,n=2; while(used.has(name.toLowerCase())) { const dot=name.lastIndexOf('.'); name=dot>0?`${file.name.slice(0,dot)}-${n++}${file.name.slice(dot)}`:`${file.name}-${n++}`; } used.add(name.toLowerCase()); const bytes=new TextEncoder().encode(file.content); if(bytes.byteLength>2*1024*1024) continue; zip.file(name,bytes); manifest.push(`- ${name} (${bytes.byteLength} bytes)`); }
  if(!manifest.length) return null; zip.file('README.md',`# ${title || 'PotHub export'}\n\nFiles included:\n${manifest.join('\n')}\n`); const data=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}); return data.byteLength<=10*1024*1024?data:null;
}


function parseCsvRows(csv) {
  const rows=[]; let row=[], cell='', quoted=false; const s=String(csv||'').replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++){const c=s[i]; if(c==='"'&&quoted&&s[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell!==''||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row);} return rows;
}
function allTables(source){
  const out=[]; const lines=String(source||'').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(/^\s*```csv\s*$/i.test(lines[i])){const chunk=[];for(i++;i<lines.length&&!/^\s*```/.test(lines[i]);i++)chunk.push(lines[i]);const rows=parseCsvRows(chunk.join('\n'));if(rows.length)out.push({name:`CSV ${out.length+1}`,rows});continue;}
    if(/^\s*\|.*\|\s*$/.test(lines[i])&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i+1])){const rows=[];const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());rows.push(cells(lines[i]));i+=2;while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(cells(lines[i++]));i--;out.push({name:`Table ${out.length+1}`,rows});}
  } return out.slice(0,20);
}
function xmlText(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'');}
function colName(n){let out='';for(n++;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
function typedCell(value,ref,style=0){const raw=String(value??'');if(/^[=+@]/.test(raw)||/^-(?!\d+(?:\.\d+)?$)/.test(raw))return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">'${xmlText(raw)}</t></is></c>`;if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const d=new Date(raw+'T00:00:00Z');if(!Number.isNaN(d.getTime())){const serial=Math.floor((d.getTime()-Date.UTC(1899,11,30))/86400000);return `<c r="${ref}" s="2"><v>${serial}</v></c>`;}}if(raw.trim()!==''&&Number.isFinite(Number(raw))&&/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(raw.trim()))return `<c r="${ref}"${style?` s="${style}"`:''}><v>${Number(raw)}</v></c>`;return `<c r="${ref}" t="inlineStr"${style?` s="${style}"`:''}><is><t xml:space="preserve">${xmlText(raw)}</t></is></c>`;}
async function toXlsx(source,title){
 const tables=allTables(source);if(!tables.length)return null;const JSZip=(await import('jszip')).default,zip=new JSZip();
 const usedSheetNames=new Set();const unique=tables.map((t,i)=>{const base=(t.name||`Sheet ${i+1}`).replace(/[\\/*?:\[\]]/g,' ').slice(0,25)||`Sheet${i+1}`;let name=base,n=2;while(usedSheetNames.has(name.toLowerCase()))name=`${base.slice(0,Math.max(1,25-String(n).length))} ${n++}`;usedSheetNames.add(name.toLowerCase());return {...t,name}});
 const sheets=unique.map((t,si)=>{const max=Math.max(1,...t.rows.map(r=>r.length));const rows=t.rows.map((r,ri)=>`<row r="${ri+1}">${Array.from({length:max},(_,ci)=>typedCell(r[ci],`${colName(ci)}${ri+1}`,ri===0?1:0)).join('')}</row>`).join('');const widths=Array.from({length:max},(_,ci)=>{const width=Math.min(48,Math.max(10,...t.rows.slice(0,100).map(r=>String(r[ci]??'').length+2)));return `<col min="${ci+1}" max="${ci+1}" width="${width}" customWidth="1"/>`}).join('');return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${colName(max-1)}${Math.max(1,t.rows.length)}"/></worksheet>`;});
 zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
 zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 zip.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${unique.map((t,i)=>`<sheet name="${xmlText(t.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${unique.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${unique.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
 zip.file('xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF202938"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');sheets.forEach((x,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,x));const data=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});return data.byteLength<=10*1024*1024?data:null;
}
async function toPptx(source,title){
 const raw=String(source||''),sections=[];let current={title:title||'Presentation',lines:[]};for(const line of raw.split(/\r?\n/)){const h=line.match(/^##\s+(.+)/);if(h){if(current.lines.length||sections.length||h)sections.push(current);current={title:h[1].trim(),lines:[]};}else if(/^\s*[-*+]\s+/.test(line))current.lines.push(line.replace(/^\s*[-*+]\s+/,''));else if(line.trim()&&!/^#{1,6}\s/.test(line)&&!/^```/.test(line))current.lines.push(line.trim());}sections.push(current);const slides=sections.filter((s,i)=>i===0||s.title||s.lines.length).slice(0,60);if(!slides.length)return null;
 const JSZip=(await import('jszip')).default,zip=new JSZip(),esc=xmlText;const contentTypes=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`;zip.file('[Content_Types].xml',contentTypes);zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
 zip.file('ppt/presentation.xml',`<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slides.length+1}"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);zip.file('ppt/_rels/presentation.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`).join('')}<Relationship Id="rId${slides.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`);
 zip.file('ppt/slideMasters/slideMaster1.xml','<?xml version="1.0" encoding="UTF-8"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');zip.file('ppt/slideLayouts/slideLayout1.xml','<?xml version="1.0" encoding="UTF-8"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');zip.file('ppt/theme/theme1.xml','<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="PotHub"><a:themeElements><a:clrScheme name="PotHub"><a:dk1><a:srgbClr val="202938"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="111827"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="10B981"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="PotHub"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="PotHub"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="70000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:lumMod val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="50000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
 slides.forEach((slide,i)=>{const shape=(id,name,y,h,text,isTitle=false)=>'';const titleShape=`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="365760"/><a:ext cx="10820400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${esc(slide.title)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;const paras=slide.lines.slice(0,24).map(line=>`<a:p><a:pPr lvl="0"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${esc(line)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`).join('');const body=`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1524000"/><a:ext cx="10363200" cy="4800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paras||'<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`;zip.file(`ppt/slides/slide${i+1}.xml`,`<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${titleShape}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);zip.file(`ppt/slides/_rels/slide${i+1}.xml.rels`,'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');});const data=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});return data.byteLength<=10*1024*1024?data:null;
}

/**
 * @returns {Promise<{name:string,type:string,data:string|Uint8Array}|null>} null when the reply cannot
 * be represented in that format (e.g. the model did not return valid JSON) or the format is unsupported.
 * `pdf` is intentionally not built here; see TEXT_OUTPUT_FORMATS.
 */
export async function buildOutputFile(format, text, { title = '' } = {}) {
  const source = String(text || '');
  if (!source.trim()) return null;
  const base = safeBaseName(title);
  let data = '';
  switch (format) {
    case 'txt': data = markdownToPlain(source) + '\n'; break;
    case 'md': data = source.trim() + '\n'; break;
    case 'csv': data = toCsv(source); break;
    case 'json': data = toJson(source); break;
    case 'html': data = toHtml(source); break;
    case 'docx': data = await toDocx(source, ''); break;
    case 'xml': data = toXml(source); break;
    case 'yaml': data = toYaml(source); break;
    case 'py': case 'js': case 'ts': case 'html': case 'css': case 'sql': case 'sh': { const fence = namedFences(source).find(f => f.name.toLowerCase().endsWith('.'+format)); data = fence ? fence.content + '\n' : (firstFence(source, [format]) ? firstFence(source, [format])+'\n' : ''); break; }
    case 'zip': { const archive = await toZip(source, title); if (!archive) return null; data = archive; break; }
    case 'xlsx': { const workbook = await toXlsx(source, title); if (!workbook) return null; data = workbook; break; }
    case 'pptx': { const presentation = await toPptx(source, title); if (!presentation) return null; data = presentation; break; }
    default: return null;
  }
  if (!data || (typeof data === 'string' && !data.trim())) return null;
  return { name: `${base}.${format}`, type: mimeForFormat(format), data };
}

/** Bound extracted attachment text before it enters a chat request. */
export function boundAttachmentText(value, maxChars = 80000) {
  const limit = Math.max(1, Math.min(Number(maxChars) || 80000, 100000));
  return String(value ?? '').slice(0, limit);
}
