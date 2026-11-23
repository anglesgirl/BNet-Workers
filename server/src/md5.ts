// 纯 TypeScript MD5 实现（RFC 1321）。
// Workers 的 WebCrypto 没有 MD5，但微信支付 v2 签名必须用 MD5，
// 所以这里手写一个紧凑实现。已用已知向量自测：
//   md5("") = d41d8cd98f00b204e9800998ecf8427e
//   md5("abc") = 900150983cd24fb0d6963f7d28e17f72

function safeAdd(x: number, y: number): number {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
}

function bitRotateLeft(num: number, cnt: number): number {
  return (num << cnt) | (num >>> (32 - cnt));
}

function md5cycle(x: number[], k: number[]): number[] {
  let [a, b, c, d] = x;

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259);
  b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = safeAdd(a, x[0]);
  x[1] = safeAdd(b, x[1]);
  x[2] = safeAdd(c, x[2]);
  x[3] = safeAdd(d, x[3]);
  return x;
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return bitRotateLeft(safeAdd(safeAdd(a, (b & c) | (~b & d)), safeAdd(x, t)), s) + b;
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return bitRotateLeft(safeAdd(safeAdd(a, (b & d) | (c & ~d)), safeAdd(x, t)), s) + b;
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return bitRotateLeft(safeAdd(safeAdd(a, b ^ c ^ d), safeAdd(x, t)), s) + b;
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return bitRotateLeft(safeAdd(safeAdd(a, c ^ (b | ~d)), safeAdd(x, t)), s) + b;
}

function md5blk(s: string): number[] {
  const blocks: number[] = [];
  for (let i = 0; i < 64; i += 4) {
    blocks[i >> 2] =
      s.charCodeAt(i) +
      (s.charCodeAt(i + 1) << 8) +
      (s.charCodeAt(i + 2) << 16) +
      (s.charCodeAt(i + 3) << 24);
  }
  return blocks;
}

const HEX_CHARS = '0123456789abcdef';

function rhex(n: number): string {
  let s = '';
  for (let j = 0; j < 4; j++) {
    s += HEX_CHARS[(n >> (j * 8 + 4)) & 0x0f] + HEX_CHARS[(n >> (j * 8)) & 0x0f];
  }
  return s;
}

function hex(x: number[]): string {
  return x.map(rhex).join('');
}

/** 返回 UTF-8 字符串的 MD5 十六进制小写摘要。 */
export function md5(input: string): string {
  // 先转 UTF-8（unescape/encodeURIComponent 是 Workers 里可用的标准做法）
  const s = unescape(encodeURIComponent(input));
  const state = [1732584193, -271733879, -1732584194, 271733878];
  const len = s.length;
  const tail = len % 64;
  // 填充：0x80 + 0，直到长度 ≡ 56 (mod 64)，再 append 64 位小端 bit 长度
  let padded = s + '\x80';
  while (padded.length % 64 !== 56) padded += '\x00';
  const bitLen = len * 8;
  const lenBytes = String.fromCharCode(
    bitLen & 0xff,
    (bitLen >>> 8) & 0xff,
    (bitLen >>> 16) & 0xff,
    (bitLen >>> 24) & 0xff,
    0, 0, 0, 0,
  );
  padded += lenBytes;
  for (let i = 0; i < padded.length; i += 64) {
    md5cycle(state, md5blk(padded.slice(i, i + 64)));
  }
  void tail;
  return hex(state);
}
