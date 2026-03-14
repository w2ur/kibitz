"""Export trained models to ONNX format for browser deployment.

Usage:
    python export_onnx.py \
        --detector runs/detector/train/weights/best.pt \
        --classifier runs/classifier/best.pt \
        --output ../models/
"""

import argparse
from pathlib import Path

import torch
import timm
from ultralytics import YOLO


def export_detector(model_path, output_dir):
    """Export YOLOv8n-pose to ONNX."""
    model = YOLO(model_path)
    model.export(
        format='onnx',
        imgsz=640,
        simplify=True,
        opset=17,
        dynamic=False,
    )

    # YOLO exports next to the source file — move to output
    onnx_path = Path(model_path).with_suffix('.onnx')
    dest = Path(output_dir) / 'board-detect.onnx'
    onnx_path.rename(dest)
    print(f'Board detector exported to: {dest}')
    print(f'Size: {dest.stat().st_size / 1024 / 1024:.1f} MB')


def export_classifier(model_path, output_dir):
    """Export MobileNetV3-Small to ONNX with dynamic batch size."""
    checkpoint = torch.load(model_path, map_location='cpu')
    model = timm.create_model('mobilenetv3_small_100', pretrained=False, num_classes=13)
    model.load_state_dict(checkpoint['model_state_dict'])
    model.eval()

    # Dynamic batch dimension for batched inference (64 squares at once)
    dummy = torch.randn(1, 3, 64, 64)
    dest = Path(output_dir) / 'piece-classify.onnx'

    torch.onnx.export(
        model,
        dummy,
        str(dest),
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'batch'},
            'output': {0: 'batch'},
        },
        opset_version=17,
    )

    # Verify
    import onnx
    onnx_model = onnx.load(str(dest))
    onnx.checker.check_model(onnx_model)

    print(f'Piece classifier exported to: {dest}')
    print(f'Size: {dest.stat().st_size / 1024 / 1024:.1f} MB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--detector', required=True)
    parser.add_argument('--classifier', required=True)
    parser.add_argument('--output', default='../models/')
    args = parser.parse_args()

    Path(args.output).mkdir(parents=True, exist_ok=True)
    export_detector(args.detector, args.output)
    export_classifier(args.classifier, args.output)
