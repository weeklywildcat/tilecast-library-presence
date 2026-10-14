import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const sdk = process.env.TILECAST_SDK_ROOT;
const skip = !sdk && "Set TILECAST_SDK_ROOT to the pinned Tilecast checkout for browser contract tests.";

// The assembled Player frame under every host hint combination. The badge has one fixed dark
// card design, so the theme hint must not change it, while reduced motion must remove motion.
for (const theme of ["light", "dark"]) for (const reducedMotion of [false, true]) {
  test(`frame hints theme=${theme} reducedMotion=${reducedMotion}`, { skip }, async () => {
    const { buildExternalPluginFrame, EXTERNAL_PLUGIN_FRAME_POLICY } = await import(pathToFileURL(resolve(sdk, "packages/package-sdk/src/player-frame.ts")));
    const frameHtml = buildExternalPluginFrame(await readFile(new URL("../build/plugin/runtime/index.js", import.meta.url), "utf8"));
    const state = { count: 12, position: "top-right", validUntil: new Date(Date.now() + 60000).toISOString(), greeting: null };
    const token = "a".repeat(32), nonce = "b".repeat(32);
    const context = { wallClockOffsetMs: 0, reducedMotion, theme, locale: "en", awake: true };
    const pageHtml = `<!doctype html><html><body style="margin:0"><iframe id="frame" title="Presence" sandbox="allow-scripts" style="position:absolute;top:0;right:0;width:480px;height:140px;border:0" src="/frame#${token}"></iframe><script>
      window.claims=[];window.port=null;let revision=1;const protocol='tilecast.plugin.surface/1';
      window.sendState=(state)=>{window.port.postMessage({protocol,nonce:'${nonce}',revision:++revision,kind:'state',state,context:${JSON.stringify(context)}});};
      window.addEventListener('message',e=>{const frame=document.getElementById('frame');if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.helloToken!=='${token}')return;
      const channel=new MessageChannel();window.port=channel.port1;channel.port1.onmessage=e=>{const m=e.data;if(m.kind==='claim'){window.claims.push(m.value);channel.port1.postMessage({protocol,nonce:'${nonce}',revision:m.revision,kind:'grant',value:{shown:!!m.value,slot:m.value?.slot??null,topLiftPx:0,bottomLiftPx:0}});}};channel.port1.start();
      frame.contentWindow.postMessage({protocol,kind:'init',helloToken:'${token}',nonce:'${nonce}',revision:1,state:${JSON.stringify(state)},context:${JSON.stringify(context)}},'*',[channel.port2]);});
    </script></body></html>`;
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      if (request.url === "/frame") { response.setHeader("Content-Security-Policy", EXTERNAL_PLUGIN_FRAME_POLICY); response.end(frameHtml); } else response.end(pageHtml);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.claims.length > 0);
      assert.deepEqual((await page.evaluate(() => window.claims))[0], { slot: "corner.top-right", priority: 0 });
      const frame = page.frameLocator("#frame");
      const badge = frame.locator(".library-badge.is-visible"); await badge.waitFor();
      const style = await badge.evaluate((element) => { const s = getComputedStyle(element); return { background: s.backgroundColor, color: s.color, duration: s.transitionDuration }; });
      assert.equal(style.background, "rgba(16, 19, 23, 0.97)", "the card does not depend on the theme hint");
      assert.equal(style.color, "rgb(255, 255, 255)");
      assert.equal(style.duration === "0s", reducedMotion, "motion follows the reduced-motion hint");
      // A zero count releases the surface at once under reduced motion; otherwise only after its exit.
      const before = await page.evaluate(() => window.claims.length);
      await page.evaluate((value) => window.sendState({ ...value, count: 0 }), state);
      if (reducedMotion) await page.waitForFunction((n) => window.claims.length > n && window.claims.at(-1) === null, before, { timeout: 150 });
      await page.waitForFunction(() => window.claims.at(-1) === null);
      assert.equal(await frame.locator(".library-badge.is-visible").count(), 0);
    } finally { await browser.close(); await new Promise((done) => server.close(done)); }
  });
}
