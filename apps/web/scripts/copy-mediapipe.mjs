// Copia o runtime WASM do MediaPipe (segmentação de pessoa) para public/, de onde
// o navegador carrega. Fica fora do git (≈30 MB); roda antes de dev e de build.
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasm = path.dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision/vision_wasm_internal.js"));
const dest = path.join(here, "..", "public", "mediapipe", "wasm");
mkdirSync(dest, { recursive: true });
cpSync(wasm, dest, { recursive: true });
