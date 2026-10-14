import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// Apache-2.0 OpenCV/Emscripten adaptation: replace dynamic function generation
// with equivalent closures. No unsafe-eval, CSP exceptions or remote code.
export const opencvCsp = {
  name: "opencv-static-functions",
  setup(build) {
    build.onLoad(
      { filter: /[\\/]@paddleocr[\\/]paddleocr-js[\\/]dist[\\/]index\.mjs$/ },
      async ({ path }) => {
        let contents = await readFile(path, "utf8");
        const lock = JSON.parse(
          await readFile("assets/opencv-adaptation.json", "utf8"),
        );
        if (
          createHash("sha256").update(contents).digest("hex") !==
          lock.paddleSdkSha256
        )
          throw Error("Paddle SDK source changed; review its worker adapter.");
        // The SDK's direct browser adapter assumes document/HTMLCanvasElement.
        // Our worker owns an OffscreenCanvas and supplies pixels explicitly.
        contents = contents.replace(
          'const canvas = document.createElement("canvas");\n  canvas.width = imageBitmap.width;',
          "const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);\n  canvas.width = imageBitmap.width;",
        );
        contents = contents.replace(
          "mat: cv.imread(canvas)",
          "mat: cv.matFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))",
        );
        return { contents, loader: "js" };
      },
    );
    build.onLoad(
      { filter: /[\\/]@techstark[\\/]opencv-js[\\/]dist[\\/]opencv\.js$/ },
      async ({ path }) => {
        const original = await readFile(path, "utf8");
        const lock = JSON.parse(
          await readFile("assets/opencv-adaptation.json", "utf8"),
        );
        if (
          createHash("sha256").update(original).digest("hex") !==
          lock.sourceSha256
        )
          throw Error("OpenCV source changed; review the CSP adaptation.");
        const start = original.indexOf(
            "function createNamedFunction(name,body)",
          ),
          end = original.indexOf("function extendError", start);
        const call =
          'return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)';
        if (start < 0 || end < start || !original.includes(call))
          throw Error("Unexpected OpenCV function generator");
        let contents =
          original.slice(0, start) +
          'function createNamedFunction(name,body){var fn=function(){"use strict";return body.apply(this,arguments)};Object.defineProperty(fn,"name",{value:makeLegalFunctionName(name)});return fn}' +
          original.slice(end);
        contents = contents.replace(
          call,
          'var invoke=function(){return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)))};Object.defineProperty(invoke,"length",{value:args.length});return invoke',
        );
        if (/new Function|\beval\(/.test(contents))
          throw Error("Unexpected dynamic execution remains in OpenCV");
        return { contents, loader: "js" };
      },
    );
  },
};
