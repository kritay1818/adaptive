// Render local, reviewed SVGs using the existing Electron dependency, never a remote service.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const root = path.join(__dirname, "..");
  const data = fs.mkdtempSync(
    path.join(process.env.TMPDIR, "adactive-artwork-"),
  );
  let app;
  try {
    app = await electron.launch({
      args: [root, `--adactive-data=${data}`],
      cwd: root,
    });
    let page = await app.firstWindow();
    await page.waitForFunction(
      () => document.querySelector("#projects")?.value,
    );
    for (const [file, output, width, height, background] of [
      ["brand-logo.svg", "brand-logo-reference.png", 450, 150, "#020a20"],
      ["pet.svg", "pet-enlarged.png", 230, 320, "#eaf0f6"],
      ["pet.svg", "icon-master.png", 256, 256, "transparent"],
    ]) {
      const svg = fs.readFileSync(path.join(root, "src/ui", file), "utf8");
      await page.evaluate(
        ({ svg, width, height, background }) => {
          document
            .querySelectorAll("link[rel=stylesheet]")
            .forEach((el) => el.remove());
          document.documentElement.dir = "ltr";
          document.body.innerHTML = "<div id='artwork'></div>";
          document.body.style.cssText = "margin:0;background:transparent";
          const box = document.querySelector("#artwork");
          box.style.cssText = `width:${width}px;height:${height}px;background:${background};display:grid;place-items:center;`;
          box.innerHTML = svg;
          const mark = box.querySelector("svg");
          mark.setAttribute("width", String(width - 24));
          mark.setAttribute("height", String(height - 24));
        },
        { svg, width, height, background },
      );
      await page
        .locator("#artwork")
        .screenshot({
          path: path.join(root, "artifacts", output),
          omitBackground: true,
        });
    }
    console.log(
      "Rendered local brand reference, enlarged mascot, and icon master.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
