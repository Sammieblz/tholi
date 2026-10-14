Internet Navigator code is MIT licensed. Bundled third-party components retain
their own licenses. The extension includes the complete license texts under
`licenses/` and the build-generated `third-party.json` with pinned versions.

- Compromise: MIT, Spencer Mountain and contributors.
- Transformers.js and Hugging Face tokenizers/Jinja: Apache-2.0, Hugging Face.
- all-MiniLM-L6-v2 weights/tokenizer: Apache-2.0, sentence-transformers;
  Xenova ONNX conversion pinned to revision
  `751bff37182d3f1213fa05d7196b954e230abad9`.
- ONNX Runtime / onnxruntime-common: MIT, Microsoft.
- React, React DOM, Zod: MIT, their respective contributors.
- Fastify and plugins (optional API): MIT, Fastify contributors.

Model upstream: https://huggingface.co/Xenova/all-MiniLM-L6-v2
Original model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
The model is used for semantic similarity, with no hosted inference service.

OCR uses Tesseract.js 6.0.1, tesseract.js-core 6.1.2 and the English tessdata_fast model (Apache-2.0). The bundled model license and reproducible hashes are included with OCR assets.

## Reliability discovery and vision

Playwright discovery algorithms, Copyright Microsoft Corporation, Apache-2.0; adapted from revision a69a313712e43e09a53c57ae04ed6f110621875d. Changes restrict extraction to bounded structure and exclude editable values. Original file hashes are in assets/discovery-lock.json.

PaddleOCR.js 0.4.2, PaddleOCR PP-OCRv6 tiny model artifacts, and OpenCV.js are redistributed under their Apache-2.0 licenses. Model hashes and upstream URLs are in assets/paddle-lock.json. The OpenCV function generators were changed to static closures for Chrome CSP; the Paddle browser image adapter was changed to use OffscreenCanvas pixels. Original versions and hashes are recorded in assets/opencv-adaptation.json. Paddle is experimental and not the default recognition engine.
