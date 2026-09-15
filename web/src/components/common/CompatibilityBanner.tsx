import { checkBrowserCompatibility } from "../../muse/museClient";

export function CompatibilityBanner() {
  const compat = checkBrowserCompatibility();
  if (compat.isSecureContext && compat.bluetoothAvailable && compat.serialAvailable) return null;

  return (
    <div className="border-b border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-xs text-[var(--text)]">
      <span className="font-semibold text-[var(--warning)]">Browser compatibility: </span>
      Secure context: <b>{compat.isSecureContext ? "YES" : "NO"}</b> · Bluetooth API:{" "}
      <b>{compat.bluetoothAvailable ? "AVAILABLE" : "UNAVAILABLE"}</b> · Serial API:{" "}
      <b>{compat.serialAvailable ? "AVAILABLE" : "UNAVAILABLE"}</b>.{" "}
      {!compat.bluetoothAvailable && "Web Bluetooth is not available in this browser — open BCI Hand Configurator in Google Chrome or Microsoft Edge to connect a Muse 2. "}
      {!compat.isSecureContext && "This page must be served over HTTPS (or localhost) to use Bluetooth/Serial. "}
      Simulation Mode still works everywhere.
    </div>
  );
}
