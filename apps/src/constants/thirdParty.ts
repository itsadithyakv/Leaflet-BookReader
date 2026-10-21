/**
 * Third-party work shipped with Leaflet, or downloaded by it, whose licence
 * asks to be named (Settings → About → Open-source notices). The full texts
 * are in THIRD_PARTY_NOTICES.md at the top of the repository.
 */
export type Notice = { name: string; licence: string; use: string; url: string };

export const THIRD_PARTY_NOTICES: readonly Notice[] = [
  {
    name: "sherpa-onnx",
    licence: "Apache-2.0",
    use: "Runs the Studio voice on this device",
    url: "https://github.com/k2-fsa/sherpa-onnx"
  },
  {
    name: "ONNX Runtime",
    licence: "MIT",
    use: "Runs the Studio voice's model",
    url: "https://github.com/microsoft/onnxruntime"
  },
  {
    name: "Kokoro-82M",
    licence: "Apache-2.0",
    use: "The Studio voice's model and voices (downloaded on request)",
    url: "https://huggingface.co/hexgrad/Kokoro-82M"
  },
  {
    // In every sherpa-onnx 1.x build; gone with sherpa-onnx 2.0 (docs/studio-voice.md).
    name: "eSpeak NG",
    licence: "GPL-3.0-or-later",
    use: "Pronounces words the Studio voice's dictionary lacks",
    url: "https://github.com/espeak-ng/espeak-ng"
  },
  {
    name: "cpal",
    licence: "Apache-2.0",
    use: "Plays the Studio voice on Windows",
    url: "https://github.com/RustAudio/cpal"
  }
];
