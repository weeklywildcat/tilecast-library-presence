import { createBadge } from "../player/badge.js";
const $ = (id) => document.getElementById(id);
const source = "tilecast-studio-ui";
let port = null, sequence = 0, revision = 0, view = null, dirty = false, mode = "count", page = 1, total = 0, requestSequence = 0;
const pending = new Map(), selected = new Map(), names = new Map();
const badge = createBadge(document, $("canvas"));
function encode(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))); }
function decode(value) { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))); }
function call(input) {
  if (!port) return Promise.reject(new Error("The interface is still connecting."));
  if (pending.size >= 8) return Promise.reject(new Error("Please wait for the current request."));
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("The request timed out. Try again.")); }, 15000);
    pending.set(id, { resolve, reject, timeout }); port.postMessage({ source, id, input: encode(input) });
  });
}
function message(text) { $("message").textContent = text; }
function preview() {
  const state = { count: view?.currentCount ?? 12, position: $("position").value,
    greeting: mode === "welcome" ? { firstName: $("personalized").checked ? "Gibson" : null } : null };
  badge.paint(state, { reducedMotion: matchMedia("(prefers-reduced-motion:reduce)").matches }, true);
  $("count-mode").setAttribute("aria-pressed", String(mode === "count"));
  $("welcome-mode").setAttribute("aria-pressed", String(mode === "welcome"));
}
function targetKey(kind) { return `${kind}Ids`; }
function selection() {
  $("selection").replaceChildren();
  for (const [key, item] of selected) {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${names.get(key) ?? `${item.kind === "screen" ? "Screen" : item.kind === "group" ? "Group" : "Location"} selected`} ×`;
    button.setAttribute("aria-label", `Remove ${names.get(key) ?? "selected target"}`);
    button.onclick = () => { selected.delete(key); dirty = true; selection(); void loadOptions(); };
    $("selection").append(button);
  }
  $("target-picker").hidden = document.querySelector('input[name="target-mode"]:checked').value === "all";
}
async function loadOptions() {
  const current = ++requestSequence, kind = $("kind").value;
  try {
    const result = await call({ action: "options", kind, page, query: $("search").value || null });
    if (current !== requestSequence) return;
    total = result.total;
    $("all-option").hidden = !result.canSelectAll;
    $("options").replaceChildren();
    for (const item of result.items) {
      const key = `${kind}:${item.id}`; names.set(key, item.name);
      const label = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
      input.type = "checkbox"; input.checked = selected.has(key); text.textContent = item.name;
      input.onchange = () => { input.checked ? selected.set(key, { kind, id: item.id }) : selected.delete(key); dirty = true; selection(); };
      label.append(input, text); $("options").append(label);
    }
    if (!result.items.length) { const text = document.createElement("p"); text.textContent = "No targets found."; $("options").append(text); }
    $("previous").disabled = page <= 1; $("next").disabled = page * 50 >= total;
    $("page-info").textContent = `Page ${page} of ${Math.max(1, Math.ceil(total / 50))}`;
    selection();
  } catch (error) { message(error.message); }
}
function apply(next, replaceSettings) {
  view = next;
  $("connection").textContent = { connected: "Connected", reconnecting: "Reconnecting", stale: "Refresh needed", waiting: "Waiting for data" }[next.connection] ?? "Waiting for data";
  $("occupancy").textContent = next.currentCount === null ? "—" : String(next.currentCount);
  $("refresh").textContent = next.lastSuccess ? new Date(next.lastSuccess).toLocaleString() : "Waiting for the first refresh";
  if (replaceSettings) {
    revision = next.revision; $("enabled").checked = next.enabled;
    $("personalized").checked = next.configuration.personalizedGreetings; $("position").value = next.configuration.position;
    selected.clear();
    for (const kind of ["screen", "group", "location"]) for (const id of next.targets?.[targetKey(kind)] ?? []) selected.set(`${kind}:${id}`, { kind, id });
    document.querySelector(`input[name="target-mode"][value="${next.targets?.mode ?? "selected"}"]`).checked = true;
    dirty = false; selection();
  }
  preview();
}
$("save").onclick = async (event) => {
  event.preventDefault(); $("save").disabled = true; message("Saving…");
  try {
    const targetMode = document.querySelector('input[name="target-mode"]:checked').value;
    if (targetMode === "selected" && selected.size === 0) throw new Error("Select at least one target.");
    const targets = { mode: targetMode, screenIds: [], groupIds: [], locationIds: [] };
    if (targetMode === "selected") for (const item of selected.values()) targets[targetKey(item.kind)].push(item.id);
    apply(await call({ action: "save", enabled: $("enabled").checked, configuration: { personalizedGreetings: $("personalized").checked,
      position: $("position").value }, targets, revision }), true);
    message("Changes saved."); await loadOptions();
  } catch (error) { message(error.message); } finally { $("save").disabled = false; }
};
$("settings").addEventListener("change", () => { dirty = true; selection(); preview(); });
$("count-mode").onclick = () => { mode = "count"; preview(); };
$("welcome-mode").onclick = () => { mode = "welcome"; preview(); };
$("kind").onchange = () => { page = 1; void loadOptions(); };
$("find").onclick = () => { page = 1; void loadOptions(); };
$("previous").onclick = () => { if (page > 1) { --page; void loadOptions(); } };
$("next").onclick = () => { if (page * 50 < total) { ++page; void loadOptions(); } };
new ResizeObserver(() => { $("canvas").style.transform = `scale(${$("preview").clientWidth / 1920})`; }).observe($("preview"));
window.addEventListener("message", async function attach(event) {
  if (port || event.source !== window.parent || event.data?.source !== source || event.data?.kind !== "studio-handshake" || event.ports.length !== 1) return;
  port = event.ports[0]; window.removeEventListener("message", attach);
  port.onmessage = (event) => {
    const result = event.data, waiter = pending.get(result?.id);
    if (!waiter || result.source !== source) return;
    pending.delete(result.id); clearTimeout(waiter.timeout);
    try {
      if (result.status < 0 || typeof result.output !== "string" || result.output.length > 24 * 1024) throw new Error("This request could not be completed. Refresh and try again.");
      const answer = decode(result.output);
      if (!answer.ok) throw new Error(answer.message); waiter.resolve(answer.data);
    } catch (error) { waiter.reject(error); }
  };
  port.start(); port.postMessage({ source, kind: "studio-resize", height: 1000 });
  try { apply(await call({ action: "get" }), true); $("fields").disabled = false; await loadOptions(); }
  catch (error) { message(error.message); }
});
window.parent.postMessage({ source, kind: "studio-hello" }, "*");
setInterval(async () => { if (!port) return; try { apply(await call({ action: "get" }), !dirty); } catch (error) { message(error.message); } }, 10000);
preview();
