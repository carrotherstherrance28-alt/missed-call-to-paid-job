export function encode(s) { return Buffer.from(String(s)); }
export function decode(b) { return Buffer.from(b).toString("utf8"); }
export function encodingExists() { return true; }
export default { encode, decode, encodingExists };
