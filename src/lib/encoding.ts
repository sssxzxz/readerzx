/**
 * Heuristic encoding detection for txt files.
 * Tries UTF-8 (with BOM check), GBK, GB18030, then Big5.
 * Returns decoded text.
 */
export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);

  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // UTF-16 LE BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  // UTF-16 BE BOM
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  const utf8Try = tryDecode(bytes, 'utf-8', true);
  if (utf8Try) return utf8Try;

  const gbk = tryDecode(bytes, 'gb18030', true);
  if (gbk) return gbk;

  const big5 = tryDecode(bytes, 'big5', true);
  if (big5) return big5;

  // Fallback: best effort utf-8 (will produce replacement chars)
  return new TextDecoder('utf-8').decode(bytes);
}

function tryDecode(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}
