export const badgeCss = `
.library-badge{position:absolute;width:256px;max-width:calc(100% - 96px);height:80px;border-radius:20px;background:rgba(16,19,23,.97);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 22px rgba(0,0,0,.22);color:#fff;font-family:system-ui,sans-serif;overflow:hidden;opacity:0;transform:translateY(10px);transition:width 240ms ease,opacity 240ms ease,transform 240ms ease;pointer-events:none}
.library-badge[data-position$="left"]{left:48px}.library-badge[data-position$="right"]{right:48px}.library-badge[data-position^="top"]{top:48px}.library-badge[data-position^="bottom"]{bottom:48px}
.library-badge.is-visible{opacity:1;transform:translateY(0)}.library-badge.is-welcome{width:384px}
.library-count,.library-welcome{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 18px;transition:opacity 240ms ease,transform 240ms ease}
.library-count strong{font-size:40px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1}.library-count strong.is-long{font-size:24px}
.library-count span{font-size:12px;line-height:1.25;letter-spacing:1px;font-weight:600;white-space:nowrap}
.library-welcome{font-size:30px;font-weight:600;white-space:nowrap;opacity:0;transform:translateY(8px)}.library-welcome span{overflow:hidden;text-overflow:ellipsis}
.is-welcome .library-count{opacity:0;transform:translateY(-8px)}.is-welcome .library-welcome{opacity:1;transform:translateY(0)}
.library-badge.is-reduced,.is-reduced .library-count,.is-reduced .library-welcome{transition:none}
@media(prefers-reduced-motion:reduce){.library-badge,.library-count,.library-welcome{transition:none}}
`;
const positions = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
export function validateState(value, now) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.count) || value.count < 0 || value.count > 100000
      || !positions.has(value.position) || typeof value.validUntil !== "string" || !Number.isFinite(Date.parse(value.validUntil))) return null;
  const validUntil = Date.parse(value.validUntil);
  if (validUntil <= now) return null;
  let greeting = null;
  if (value.greeting != null) {
    const candidate = value.greeting;
    if (!candidate || typeof candidate.id !== "string" || !/^[a-f0-9]{64}$/.test(candidate.id)
        || typeof candidate.expiresAt !== "string" || !Number.isFinite(Date.parse(candidate.expiresAt))) return null;
    const name = candidate.firstName;
    if (name !== null && (typeof name !== "string" || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name))) return null;
    if (Date.parse(candidate.expiresAt) > now) greeting = candidate;
  }
  return { count: value.count, position: value.position, validUntil, greeting };
}
export function createBadge(document, parent = document.body) {
  const style = document.createElement("style"); style.textContent = badgeCss; parent.append(style);
  const shell = document.createElement("div"); shell.className = "library-badge";
  const count = document.createElement("div"); count.className = "library-count";
  const number = document.createElement("strong"); const label = document.createElement("span"); label.textContent = "IN THE LIBRARY";
  const welcome = document.createElement("div"); welcome.className = "library-welcome";
  const text = document.createElement("span"); welcome.append(text); count.append(number, label); shell.append(count, welcome); parent.append(shell);
  return {
    paint(state, context, shown) {
      shell.dataset.position = state?.position ?? "bottom-left";
      shell.classList.toggle("is-reduced", context.reducedMotion === true);
      shell.classList.toggle("is-visible", shown === true);
      shell.classList.toggle("is-welcome", Boolean(state?.greeting));
      number.textContent = String(state?.count ?? 0);
      number.classList.toggle("is-long", (state?.count ?? 0) >= 1000);
      text.textContent = state?.greeting?.firstName ? `Welcome, ${state.greeting.firstName}!` : "Welcome!";
    },
    dispose() { shell.remove(); style.remove(); },
    shell, number, text,
  };
}

export function createController(badge, timers = { set: (fn, delay) => setTimeout(fn, delay), clear: (id) => clearTimeout(id) }) {
  let raw = null, state = null, context = { awake: false, reducedMotion: true }, bridge = null, granted = false, stopped = false;
  let deadlines = [], exit = null;
  const clearDeadlines = () => { deadlines.forEach((timer) => timers.clear(timer)); deadlines = []; };
  const clearExit = () => { if (exit !== null) timers.clear(exit); exit = null; };
  function render() {
    if (stopped || !bridge) return;
    clearDeadlines();
    const now = bridge.now(); state = validateState(raw, now);
    const visible = state && state.count > 0 && context.awake === true;
    badge.paint(state, context, Boolean(visible && granted));
    if (visible) {
      clearExit(); bridge.claim({ slot: `corner.${state.position}`, priority: 0 });
      deadlines.push(timers.set(render, Math.max(1, state.validUntil - now)));
      if (state.greeting) deadlines.push(timers.set(render, Math.max(1, Date.parse(state.greeting.expiresAt) - now)));
    } else {
      clearExit();
      // Retain the existing claim only while the zero-count exit completes.
      if (state?.count === 0 && context.awake === true && granted && !context.reducedMotion) {
        exit = timers.set(() => { exit = null; bridge.claim(null); }, 240);
      } else { granted = false; bridge.claim(null); }
    }
  }
  return {
    update(value, hints, nextBridge) { if (stopped) return; raw = value; context = hints; bridge = nextBridge; render(); },
    grant(value) { if (stopped) return; granted = value?.shown === true; badge.paint(state, context, Boolean(granted && state?.count > 0 && context.awake)); },
    dispose() { stopped = true; clearDeadlines(); clearExit(); badge.dispose(); },
  };
}
