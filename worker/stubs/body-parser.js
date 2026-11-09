function noop() { return (req, res, next) => next(); }
export default { json: noop, raw: noop, text: noop, urlencoded: noop };
export const json = noop;
export const raw = noop;
export const text = noop;
export const urlencoded = noop;
