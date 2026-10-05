#!/usr/bin/env bash
# Fetch dslim/distilbert-NER (Apache-2.0) and quantise it to int8 for the extension.
# The model is bundled inside the extension; it is never downloaded at run time.
set -euo pipefail
REV=main
DIR="$(cd "$(dirname "$0")/.." && pwd)/models/distilbert-NER"
mkdir -p "$DIR/onnx"
for f in config.json special_tokens_map.json tokenizer.json tokenizer_config.json vocab.txt; do
  curl -sfL "https://huggingface.co/dslim/distilbert-NER/resolve/$REV/onnx/$f" -o "$DIR/$f"
done
[ -f "$DIR/onnx/model.onnx" ] || curl -sfL "https://huggingface.co/dslim/distilbert-NER/resolve/$REV/onnx/model.onnx" -o "$DIR/onnx/model.onnx"
python3 -c "
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic('$DIR/onnx/model.onnx', '$DIR/onnx/model_quantized.onnx', weight_type=QuantType.QInt8)
"
rm -f "$DIR/onnx/model.onnx"
ls -la "$DIR/onnx"
