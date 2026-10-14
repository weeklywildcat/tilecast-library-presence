import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const sdk = process.env.TILECAST_SDK_ROOT;
const skip = !sdk && "Set TILECAST_SDK_ROOT to the pinned Tilecast checkout for browser contract tests.";
test("real sandboxed Studio bridge supports preview, targets and saved configuration", { skip }, async () => {
  const html = await readFile(new URL("../build/studio/index.html", import.meta.url));
  const view = { enabled: true, configuration: { personalizedGreetings: true, position: "bottom-left" },
    targets: { mode: "selected", screenIds: ["screen-1"], groupIds: [], locationIds: [] }, revision: 1,
    connection: "connected", currentCount: 12, lastSuccess: new Date().toISOString() };
  const fixture = `<!doctype html><html><body style="margin:0"><iframe id="ui" title="Library Presence" sandbox="allow-scripts" style="width:100%;height:900px;border:0" src="/studio"></iframe><script>
  const view=${JSON.stringify(view)};window.saved=null;
  window.addEventListener('message',e=>{const frame=document.getElementById('ui');if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.kind!=='studio-hello')return;
    const channel=new MessageChannel();channel.port1.onmessage=e=>{const m=e.data;if(!m.input)return;
      const input=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m.input),c=>c.charCodeAt(0))));let data=view;
      if(input.action==='options'){data={items:[{id:input.kind+'-1',name:input.kind==='screen'?'Library':input.kind==='group'?'Library group':'Library location',kind:input.kind}],total:1,page:1,pageSize:50,canSelectAll:true};}
      if(input.action==='save'){window.saved=input;Object.assign(view,input,{revision:view.revision+1});data=view;}
      const output=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ok:true,data}))));
      channel.port1.postMessage({source:'tilecast-studio-ui',id:m.id,status:1,output});};channel.port1.start();
      frame.contentWindow.postMessage({source:'tilecast-studio-ui',kind:'studio-handshake'},'*',[channel.port2]);});
  </script></body></html>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/studio") {
      response.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"); response.end(html);
    } else response.end(fixture);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frameLocator("#ui"); await frame.getByText("Connected", { exact: true }).waitFor();
    assert.equal(await frame.locator("#occupancy").textContent(), "12");
    await frame.getByRole("button", { name: "Welcome", exact: true }).click();
    assert.equal(await frame.locator(".library-welcome span").textContent(), "Welcome, Gibson!");
    await frame.getByLabel("Corner position").selectOption("top-right");
    await frame.getByLabel("Target type").selectOption("group");
    await frame.getByLabel("Library group", { exact: true }).check();
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("Changes saved.", { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved.configuration.position, "top-right"); assert.deepEqual(saved.targets.groupIds, ["group-1"]);
    assert.deepEqual(errors, []);
    await mkdir(new URL("../test-artifacts/", import.meta.url), { recursive: true });
    await frame.locator("body").evaluate(() => window.scrollTo(0, 0));
    await frame.locator(".library-badge").evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    await page.screenshot({ path: new URL("../test-artifacts/studio.png", import.meta.url).pathname });
  } finally { await browser.close(); await new Promise((done) => server.close(done)); }
});

test("assembled external frame uses the real ABI, safe text, deadlines and deny-all response policy", { skip }, async () => {
  const { buildExternalPluginFrame, EXTERNAL_PLUGIN_FRAME_POLICY } = await import(pathToFileURL(resolve(sdk, "packages/package-sdk/src/player-frame.ts")));
  const frameHtml = buildExternalPluginFrame(await readFile(new URL("../build/plugin/runtime/index.js", import.meta.url), "utf8"));
  const now = Date.now(), state = { count: 12, position: "bottom-left", validUntil: new Date(now + 60000).toISOString(),
    greeting: { id: "a".repeat(64), firstName: "<img src=x>", expiresAt: new Date(now + 3000).toISOString() } };
  const token = "a".repeat(32), nonce = "b".repeat(32);
  const pageHtml = `<!doctype html><html><body style="margin:0;background:#20272e"><iframe id="frame" title="Presence" sandbox="allow-scripts" style="position:absolute;bottom:0;left:0;width:480px;height:140px;border:0" src="/frame#${token}"></iframe><script>
    window.claims=[];window.port=null;let revision=1;const protocol='tilecast.plugin.surface/1';
    window.sendState=(state)=>{window.port.postMessage({protocol,nonce:'${nonce}',revision:++revision,kind:'state',state,context:{wallClockOffsetMs:0,reducedMotion:false,theme:'dark',locale:'en',awake:true}});};
    window.addEventListener('message',e=>{const frame=document.getElementById('frame');if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.helloToken!=='${token}')return;
    const channel=new MessageChannel();window.port=channel.port1;channel.port1.onmessage=e=>{const m=e.data;if(m.kind==='claim'){window.claims.push(m.value);channel.port1.postMessage({protocol,nonce:'${nonce}',revision:m.revision,kind:'grant',value:{shown:!!m.value,slot:m.value?.slot??null,topLiftPx:0,bottomLiftPx:0}});}};channel.port1.start();
    frame.contentWindow.postMessage({protocol,kind:'init',helloToken:'${token}',nonce:'${nonce}',revision:1,state:${JSON.stringify(state)},context:{wallClockOffsetMs:0,reducedMotion:false,theme:'dark',locale:'en',awake:true}},'*',[channel.port2]);});
  </script></body></html>`;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url); response.setHeader("Content-Type", "text/html");
    if (request.url === "/frame") { response.setHeader("Content-Security-Policy", EXTERNAL_PLUGIN_FRAME_POLICY); response.end(frameHtml); }
    else response.end(pageHtml);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.claims.length > 0);
    const frame = page.frameLocator("#frame");
    assert.equal(await frame.locator(".library-welcome span").textContent(), "Welcome, <img src=x>!");
    assert.equal(await frame.locator("img").count(), 0);
    await frame.locator(".library-badge.is-visible").waitFor();
    assert.equal(await frame.locator(".library-badge.is-visible").count(), 1);
    const claims = await page.evaluate(() => window.claims); assert.deepEqual(claims[0], { slot: "corner.bottom-left", priority: 0 });
    const inner = page.frames().find((frame) => frame.url().includes("/frame#"));
    assert.equal(await inner.evaluate(() => { try { return Boolean(parent.document); } catch { return false; } }), false);
    assert.equal(await inner.evaluate(() => typeof window.tilecastRuntimeHost), "undefined");
    await page.evaluate((state) => window.sendState({ ...state, count: 13 }), state);
    await frame.locator(".library-count strong").filter({ hasText: "13" }).waitFor({ state: "attached" });
    await frame.locator(".library-badge:not(.is-welcome)").waitFor();
    assert.equal(await frame.locator(".library-count strong").textContent(), "13");
    await frame.locator(".library-badge").evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    await mkdir(new URL("../test-artifacts/", import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL("../test-artifacts/badge.png", import.meta.url).pathname });
    await page.evaluate((state) => window.sendState({ ...state, count: 0, greeting: null }), state);
    await page.waitForFunction(() => window.claims.at(-1) === null);
    assert.equal(await frame.locator(".library-badge.is-visible").count(), 0);
    await page.evaluate((state) => window.sendState({ ...state, count: 13, greeting: null, validUntil: new Date(Date.now() + 1000).toISOString() }), state);
    await frame.locator(".library-badge.is-visible").waitFor();
    await page.waitForFunction(() => window.claims.at(-1) === null);
    assert.equal(await frame.locator(".library-badge.is-visible").count(), 0);
    assert.ok(requests.every((url) => ["/", "/frame", "/favicon.ico"].includes(url)));
  } finally { await browser.close(); await new Promise((done) => server.close(done)); }
});
