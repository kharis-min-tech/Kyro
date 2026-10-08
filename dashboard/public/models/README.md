People-detection models for Camera Mode (dashboard/src/lib/cameraMode.ts), run in the browser with onnxruntime-web.

- `yolo11m1280-w16-v1.part*.bin` — Ultralytics YOLO11m exported to ONNX (opset 17, 1280×1280 input), weights stored as float16 (cast to float32 at load, so results match the float32 model). Split into parts under the 25 MB per-file hosting limit; the page joins them.
- `yolo11s-w16-v1.part0.bin` — YOLO11s at 640×640, same format, for browsers without WebGPU.

YOLO11 is by Ultralytics and licensed AGPL-3.0. To update: export a new model, bump the `-v1` name here and in `MODELS` in cameraMode.ts.
