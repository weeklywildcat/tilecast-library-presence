import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const sdk = process.env.TILECAST_SDK_ROOT;
const skip = !sdk && "Set TILECAST_SDK_ROOT to the pinned Tilecast checkout for browser contract tests.";
const conflictMessage = "This request could not be completed. Refresh and try again.";

/**
 * The real built Studio page inside a sandboxed iframe, with a parent that
 * answers the opaque bridge like Tilecast's host: paged target options, a
 * host-owned configuration revision, and optional revision conflicts.
 */
async function studio(settings, run, pageOptions = {}) {
  const html = await readFile(new URL("../build/studio/index.html", import.meta.url));
  const view = { enabled: true, configuration: { personalizedGreetings: true, position: "bottom-left" },
    targets: { mode: "selected", screenIds: [], groupIds: [], locationIds: [] }, revision: 1,
    connection: "connected", currentCount: 12, lastSuccess: new Date().toISOString(), ...settings.view };
  const fixture = `<!doctype html><html><body style="margin:0"><iframe id="ui" title="Library Presence" sandbox="allow-scripts" style="width:100%;height:1000px;border:0" src="/studio"></iframe><script>
  const view=${JSON.stringify(view)};const total=${settings.total ?? 1};const names=${JSON.stringify(settings.names ?? {})};
  window.optionRequests=[];window.saveAttempts=[];window.saved=null;window.conflictNext=false;
  window.addEventListener('message',e=>{const frame=document.getElementById('ui');if(e.source!==frame.contentWindow||e.origin!=='null'||e.data.kind!=='studio-hello')return;
    const channel=new MessageChannel();channel.port1.onmessage=e=>{const m=e.data;if(!m.input)return;
      const input=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m.input),c=>c.charCodeAt(0))));let data=view,ok=true;
      if(input.action==='options'){window.optionRequests.push(input);const first=(input.page-1)*50,count=Math.max(0,Math.min(50,total-first));
        data={items:Array.from({length:count},(_,i)=>({id:input.kind+'-'+(first+i+1),name:(names[input.kind]??input.kind)+' '+(first+i+1),kind:input.kind})),total,page:input.page,pageSize:50,canSelectAll:true};}
      if(input.action==='save'){window.saveAttempts.push(input);
        if(window.conflictNext||input.revision!==view.revision){ok=false;data=undefined;}
        else{window.saved=input;Object.assign(view,input,{revision:view.revision+1});data=view;}}
      const body=ok?{ok:true,data}:{ok:false,message:${JSON.stringify(conflictMessage)}};
      const output=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(body))));
      channel.port1.postMessage({source:'tilecast-studio-ui',id:m.id,status:1,output});};channel.port1.start();
      frame.contentWindow.postMessage({source:'tilecast-studio-ui',kind:'studio-handshake'},'*',[channel.port2]);});
  window.bumpRevision=()=>{view.revision+=1;};
  </script></body></html>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/studio") {
      response.setHeader("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'");
      response.end(html);
    } else response.end(fixture);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, ...pageOptions });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frameLocator("#ui"); await frame.getByText("Connected", { exact: true }).waitFor();
    await run({ page, frame });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise((done) => server.close(done)); }
}

test("target picker pages through large directories and keeps selections across pages", { skip }, async () => {
  await studio({ total: 120, names: { screen: "Screen" } }, async ({ page, frame }) => {
    await frame.getByText("Page 1 of 3", { exact: true }).waitFor();
    assert.equal(await frame.locator("#previous").isDisabled(), true);
    assert.equal(await frame.locator("#next").isDisabled(), false);
    assert.equal(await frame.locator("#options label").count(), 50);
    await frame.getByLabel("Screen 1", { exact: true }).check();
    await frame.locator("#next").click(); await frame.getByText("Page 2 of 3", { exact: true }).waitFor();
    assert.equal(await frame.getByLabel("Screen 1", { exact: true }).count(), 0);
    await frame.getByLabel("Screen 51", { exact: true }).check();
    await frame.locator("#next").click(); await frame.getByText("Page 3 of 3", { exact: true }).waitFor();
    assert.equal(await frame.locator("#options label").count(), 20);
    assert.equal(await frame.locator("#next").isDisabled(), true);
    await frame.getByLabel("Screen 120", { exact: true }).check();
    await frame.locator("#previous").click(); await frame.locator("#previous").click();
    await frame.getByText("Page 1 of 3", { exact: true }).waitFor();
    assert.equal(await frame.getByLabel("Screen 1", { exact: true }).isChecked(), true, "page 1 selection survives paging");
    const pages = await page.evaluate(() => window.optionRequests.map((request) => request.page));
    assert.deepEqual(pages.slice(-5), [1, 2, 3, 2, 1]);
    assert.ok((await page.evaluate(() => window.optionRequests)).every((request) => request.kind === "screen" && request.query === null));
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("Changes saved.", { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.saved);
    assert.deepEqual(saved.targets, { mode: "selected", screenIds: ["screen-1", "screen-51", "screen-120"], groupIds: [], locationIds: [] });
  });
});

test("searching restarts at the first page and an empty result explains itself", { skip }, async () => {
  await studio({ total: 120 }, async ({ page, frame }) => {
    await frame.locator("#next").click(); await frame.getByText("Page 2 of 3", { exact: true }).waitFor();
    await frame.getByLabel("Find targets").fill("reading"); await frame.locator("#find").click();
    await frame.getByText("Page 1 of 3", { exact: true }).waitFor();
    const last = await page.evaluate(() => window.optionRequests.at(-1));
    assert.equal(last.page, 1); assert.equal(last.query, "reading");
    // The search field is bounded in the page itself.
    assert.equal(await frame.locator("#search").getAttribute("maxlength"), "100");
  });
  await studio({ total: 0 }, async ({ frame }) => {
    await frame.getByText("No targets found.", { exact: true }).waitFor();
    assert.equal(await frame.locator("#next").isDisabled(), true);
    await frame.getByText("Page 1 of 1", { exact: true }).waitFor();
  });
});

test("a stale configuration revision keeps the unsaved edit and explains the conflict", { skip }, async () => {
  await studio({ total: 3, names: { screen: "Screen" } }, async ({ page, frame }) => {
    await frame.getByLabel("Screen 2", { exact: true }).check();
    await frame.getByLabel("Corner position").selectOption("top-right");
    // Another operator saved first: the host revision moved on.
    await page.evaluate(() => window.bumpRevision());
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("This request could not be completed. Refresh and try again.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.saveAttempts.length), 1);
    assert.equal(await page.evaluate(() => window.saved), null, "nothing was saved");
    assert.equal(await frame.getByText("Changes saved.", { exact: true }).count(), 0);
    // The edit and the selection stay in the form, and Save works again.
    assert.equal(await frame.getByLabel("Corner position").inputValue(), "top-right");
    assert.equal(await frame.getByLabel("Screen 2", { exact: true }).isChecked(), true);
    assert.equal(await frame.getByRole("button", { name: "Save changes" }).isEnabled(), true);
    // The periodic refresh adopts the new revision only while the form is clean, so the dirty
    // form keeps its edit; saving against the stale revision is refused again.
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText(conflictMessage, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.saveAttempts.length), 2);
  });
});

test("selected targets are required and a save sends exactly the chosen kinds", { skip }, async () => {
  await studio({ total: 2, names: { screen: "Screen", group: "Group" } }, async ({ page, frame }) => {
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("Select at least one target.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.saveAttempts.length), 0, "an empty selection never reaches the host");
    await frame.getByLabel("Target type").selectOption("group");
    await frame.getByLabel("Group 1", { exact: true }).check();
    await frame.getByLabel("Target type").selectOption("screen");
    await frame.getByLabel("Screen 2", { exact: true }).check();
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("Changes saved.", { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.saved);
    assert.deepEqual(saved.targets, { mode: "selected", screenIds: ["screen-2"], groupIds: ["group-1"], locationIds: [] });
    assert.equal(saved.revision, 1);
    // Choosing "all" clears the picker but sends no ids.
    await frame.getByLabel("All screens").check();
    await frame.getByRole("button", { name: "Save changes" }).click();
    await frame.getByText("Changes saved.", { exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.saved)).targets, { mode: "all", screenIds: [], groupIds: [], locationIds: [] });
  });
});

for (const scheme of ["light", "dark"]) {
  test(`Studio follows the ${scheme} color scheme with readable text`, { skip }, async () => {
    await studio({ total: 1 }, async ({ frame }) => {
      const colors = await frame.locator("body").evaluate(() => {
        const style = getComputedStyle(document.body), root = getComputedStyle(document.documentElement), save = getComputedStyle(document.getElementById("save"));
        return { background: root.backgroundColor, text: style.color, saveBackground: save.backgroundColor, saveText: save.color };
      });
      const luminance = (value) => { const [r, g, b] = value.match(/\d+/g).slice(0, 3).map(Number).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      assert.ok(contrast(colors.background, colors.text) >= 7, `${scheme} body contrast ${JSON.stringify(colors)}`);
      assert.ok(contrast(colors.saveBackground, colors.saveText) >= 7, `${scheme} save button contrast`);
      assert.equal(luminance(colors.background) > 0.5, scheme === "light", "the page background matches the scheme");
    }, { colorScheme: scheme });
  });
}

test("the Studio preview does not animate when reduced motion is requested", { skip }, async () => {
  await studio({ total: 1 }, async ({ frame }) => {
    await frame.getByRole("button", { name: "Welcome", exact: true }).click();
    const badge = frame.locator(".library-badge");
    await badge.waitFor();
    const durations = await badge.evaluate((element) => [element, element.querySelector(".library-count"), element.querySelector(".library-welcome")]
      .map((node) => getComputedStyle(node).transitionDuration));
    assert.deepEqual(durations, ["0s", "0s", "0s"]);
    assert.equal(await badge.evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.transitionProperty).length), 0);
  }, { reducedMotion: "reduce" });
  await studio({ total: 1 }, async ({ frame }) => {
    await frame.getByRole("button", { name: "Welcome", exact: true }).click();
    const duration = await frame.locator(".library-badge").evaluate((element) => getComputedStyle(element).transitionDuration);
    assert.notEqual(duration, "0s", "motion is on by default");
  }, { reducedMotion: "no-preference" });
});
