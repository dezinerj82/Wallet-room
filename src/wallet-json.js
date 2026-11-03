// The private Drive format is JSON. The app's proven ledger operations
// continue to use tab-separated event strings in memory only.
export const WALLET_JSON_FORMAT = "wallet-room-events-v1";

export function encodeWalletJson(ledger) {
  if (typeof ledger !== "string") throw new Error("Invalid wallet history.");
  const lines = ledger.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events = lines.map(line => {
    if (!line || line.includes("\r")) throw new Error("Invalid wallet history row.");
    const fields = line.split("\t");
    if (!fields[0] || fields.some(field => /[\t\r\n]/.test(field)))
      throw new Error("Invalid wallet history fields.");
    return { kind: fields[0].startsWith("@") ? "directive" : "record", fields };
  });
  return JSON.stringify({ format: WALLET_JSON_FORMAT, events }, null, 2) + "\n";
}

export function decodeWalletJson(raw) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Wallet JSON is not valid. No changes were saved."); }
  if (!value || Array.isArray(value) || value.format !== WALLET_JSON_FORMAT ||
      !Array.isArray(value.events) || value.events.length > 100000)
    throw new Error("Unsupported wallet JSON format. No changes were saved.");
  const lines = value.events.map(event => {
    if (!event || !["record", "directive"].includes(event.kind) ||
        !Array.isArray(event.fields) || !event.fields.length ||
        event.fields.some(field => typeof field !== "string" || /[\t\r\n]/.test(field)) ||
        !event.fields[0] || (event.fields[0].startsWith("@") !== (event.kind === "directive")))
      throw new Error("Wallet JSON contains an invalid record. No changes were saved.");
    return event.fields.join("\t");
  });
  return lines.length ? lines.join("\n") + "\n" : "";
}
