export interface TextNodeSpan { node: Text; start: number; end: number }

export function speechCaret(doc: Document, x:number, y:number):Range|null {
  const range:Range|null=(doc as any).caretRangeFromPoint?.(x,y)??null;
  if(!range||range.startContainer.nodeType!==3)return null;
  const node=range.startContainer as Text;
  if(!node.length||node.parentElement?.closest('a,button,input,textarea,select,[data-hid],rt,script,style'))return null;
  const character=doc.createRange(),at=Math.min(range.startOffset,node.length-1);
  character.setStart(node,at);character.setEnd(node,at+1);
  if(!Array.from(character.getClientRects()).some(r=>x>=r.left-2&&x<=r.right+2&&y>=r.top-2&&y<=r.bottom+2))return null;
  return range;
}

export function highlightSpeech(doc:Document, range:Range|null) {
  const w=doc.defaultView as any;
  if(!w?.CSS?.highlights||!w.Highlight)return;
  if(range)w.CSS.highlights.set('narration-current',new w.Highlight(range));
  else w.CSS.highlights.delete('narration-current');
}

export function flattenSpeechDocument(doc: Document): { text: string; spans: TextNodeSpan[] } {
  const root = doc.body ?? doc.documentElement;
  const spans: TextNodeSpan[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  let previousBlock: Element | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,rt,[aria-hidden="true"]')) continue;
    const block = parent.closest('p,div,li,h1,h2,h3,h4,h5,h6,td,blockquote,pre') ?? root;
    if (previousBlock && block !== previousBlock) text += '\n';
    previousBlock = block;
    const start = text.length;
    text += node.textContent ?? '';
    spans.push({ node: node as Text, start, end: text.length });
  }
  return { text, spans };
}

export function offsetInDocument(doc: Document, node: Node, offset: number): number | null {
  const flat = flattenSpeechDocument(doc);
  const span = flat.spans.find(s => s.node === node);
  if (span) return span.start + Math.min(offset, span.end - span.start);
  const child = node.childNodes[offset];
  const next = flat.spans.find(s => child?.contains(s.node));
  return next?.start ?? null;
}

export function rangeAtOffset(doc: Document, start: number, end = start): Range | null {
  const { spans } = flattenSpeechDocument(doc);
  const a = spans.find(s => s.end > start) ?? spans.at(-1);
  const b = spans.find(s => s.end >= end) ?? spans.at(-1);
  if (!a || !b) return null;
  const range = doc.createRange();
  range.setStart(a.node, Math.max(0, Math.min(a.node.length, start - a.start)));
  range.setEnd(b.node, Math.max(0, Math.min(b.node.length, end - b.start)));
  return range;
}

export function decodeBookText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}
