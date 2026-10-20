Tholi code is MIT licensed. Legacy `@internet-navigator/*` package identifiers are retained for compatibility. Bundled third-party components retain
their own licenses. The extension includes the complete license texts under
`licenses/` and the build-generated `third-party.json` with pinned versions.

- Compromise: MIT, Spencer Mountain and contributors.
- Transformers.js and Hugging Face tokenizers/Jinja: Apache-2.0, Hugging Face.
- all-MiniLM-L6-v2 weights/tokenizer: Apache-2.0, sentence-transformers;
  Xenova ONNX conversion pinned to revision
  `751bff37182d3f1213fa05d7196b954e230abad9`.
- ONNX Runtime / onnxruntime-common: MIT, Microsoft.
- Mozilla webextension-polyfill 0.12.0: MPL-2.0, Mozilla contributors. Used as the shared WebExtensions API boundary; its license is included in each extension target.
- React, React DOM, Zod: MIT, their respective contributors.
- Iconoir React: MIT, Iconoir contributors.
- Base UI and Base UI utilities: MIT, MUI contributors.
- Manrope and Outfit fonts, packaged through Fontsource: SIL Open Font License 1.1, their respective designers and contributors. Font files are bundled locally; their license texts are included in the generated licenses directory.
- Sharp, used to generate toolbar icon sizes at build time: Apache-2.0, Lovell Fuller and contributors.
- Brand artwork in apps/public/media was supplied by the project owner.
- Website typography: Newsreader and Source Sans 3 through Fontsource, SIL Open Font License 1.1. License texts are served under `/licenses/`.
- Website animations: GSAP 3.15.0, GreenSock/Webflow, under the [GSAP standard license](https://gsap.com/standard-license). GSAP is bundled locally; no hosted animation script is loaded.
- Chrome and Firefox logos identify browser compatibility; their respective owners retain trademark rights. Original asset sources are recorded in `apps/public/media/browsers/README.md`.
- Fastify and plugins (optional API): MIT, Fastify contributors.

Model upstream: https://huggingface.co/Xenova/all-MiniLM-L6-v2
Original model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
The model is used for semantic similarity, with no hosted inference service.

OCR uses Tesseract.js 6.0.1, tesseract.js-core 6.1.2 and the English tessdata_fast model (Apache-2.0). The bundled model license and reproducible hashes are included with OCR assets.

## Reliability discovery and vision

Playwright discovery algorithms, Copyright Microsoft Corporation, Apache-2.0; adapted from revision a69a313712e43e09a53c57ae04ed6f110621875d. Changes restrict extraction to bounded structure and exclude editable values. Original file hashes are in assets/discovery-lock.json.

PaddleOCR.js 0.4.2, PaddleOCR PP-OCRv6 tiny model artifacts, and OpenCV.js are redistributed under their Apache-2.0 licenses. Model hashes and upstream URLs are in assets/paddle-lock.json. The OpenCV function generators were changed to static closures for Chrome CSP; the Paddle browser image adapter was changed to use OffscreenCanvas pixels. Original versions and hashes are recorded in assets/opencv-adaptation.json. Paddle is experimental and not the default recognition engine.
