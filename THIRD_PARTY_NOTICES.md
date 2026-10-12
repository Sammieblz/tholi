Internet Navigator code is MIT licensed. Bundled third-party components retain
their own licenses. The extension includes the complete license texts under
`licenses/` and the build-generated `third-party.json` with pinned versions.

* Compromise: MIT, Spencer Mountain and contributors.
* Transformers.js and Hugging Face tokenizers/Jinja: Apache-2.0, Hugging Face.
* all-MiniLM-L6-v2 weights/tokenizer: Apache-2.0, sentence-transformers;
  Xenova ONNX conversion pinned to revision
  `751bff37182d3f1213fa05d7196b954e230abad9`.
* ONNX Runtime / onnxruntime-common: MIT, Microsoft.
* React, React DOM, Zod: MIT, their respective contributors.
* Fastify and plugins (optional API): MIT, Fastify contributors.

Model upstream: https://huggingface.co/Xenova/all-MiniLM-L6-v2
Original model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
The model is used for semantic similarity, with no hosted inference service.
