export function supportedRuntime(version = process.versions.node) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) return false;
  const [major, minor, patch] = parts;
  const floor = major === 24 ? [22, 1] : major === 26 ? [12, 1] : null;
  return !!floor && (minor > floor[0] || minor === floor[0] && patch >= floor[1]);
}
export function requireSupportedRuntime() {
  if (!supportedRuntime()) throw new Error('Use Node 24.22.1+ (24.x LTS) or 26.12.1+ (26.x).');
}
