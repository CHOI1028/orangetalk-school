/* Pure validation: never substitute a bare endpoint for a connection address. */
const CONNECTION_KEY = /^[a-f0-9]{64}$/;
function endpoint(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('//') + 2).replace(/\/$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || authority.includes('/')) return null;
    return url;
  } catch (_) { return null; }
}
export function buildSharedConnectionAddress(base, key) {
  if (typeof key !== 'string' || key.length !== 64 || !CONNECTION_KEY.test(key) || !endpoint(base)) return '';
  return base.replace(/\/$/, '') + '/#ot-share=' + key;
}
export function isSharedConnectionAddress(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\s\\]/.test(value)) return false;
  const marker = value.indexOf('#');
  if (marker < 0 || !endpoint(value.slice(0, marker))) return false;
  return /^#ot-share=[a-f0-9]{64}$/.test(value.slice(marker));
}
export async function copySharedConnectionAddress(address, options = {}) {
  if (!isSharedConnectionAddress(address)) return { success: false, reason: 'invalid-address' };
  try {
    const text = options.format ? options.format(address) : address;
    if (typeof text !== 'string' || !text.includes(address)) return { success: false, reason: 'invalid-message' };
    if (!options.clipboard || typeof options.clipboard.writeText !== 'function') {
      return { success: false, reason: 'clipboard-unavailable' };
    }
    await options.clipboard.writeText(text);
    return { success: true };
  } catch (_) {
    /* Do not expose clipboard errors, URLs or keys in logs or status messages. */
    return { success: false, reason: 'clipboard-failed' };
  }
}
