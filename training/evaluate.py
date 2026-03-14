"""Evaluate trained models on real-world data (ChessReD dataset).

Usage:
    python evaluate.py --models ../models/ --data data/chessred/
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import chess


CLASS_NAMES = [
    'empty', 'wP', 'wR', 'wN', 'wB', 'wQ', 'wK',
    'bP', 'bR', 'bN', 'bB', 'bQ', 'bK'
]

FEN_MAP = {
    'empty': None, 'wP': 'P', 'wR': 'R', 'wN': 'N', 'wB': 'B', 'wQ': 'Q', 'wK': 'K',
    'bP': 'p', 'bR': 'r', 'bN': 'n', 'bB': 'b', 'bQ': 'q', 'bK': 'k',
}


def load_models(models_dir):
    models_dir = Path(models_dir)

    detector = ort.InferenceSession(
        str(models_dir / 'board-detect.onnx'),
        providers=['CPUExecutionProvider']
    )
    classifier = ort.InferenceSession(
        str(models_dir / 'piece-classify.onnx'),
        providers=['CPUExecutionProvider']
    )

    return detector, classifier


def detect_corners(detector, image):
    """Run board detection, return 4 corners in image space."""
    # Preprocess: resize to 640x640, normalize
    h, w = image.shape[:2]
    input_img = cv2.resize(image, (640, 640))
    input_img = input_img.astype(np.float32) / 255.0
    input_img = np.transpose(input_img, (2, 0, 1))  # HWC -> CHW
    input_img = np.expand_dims(input_img, 0)  # Add batch dim

    outputs = detector.run(None, {'images': input_img})
    # Parse YOLO pose output to extract keypoints
    # Output format depends on the exact YOLO export — adapt as needed
    # Expected: 4 keypoints per detection

    # Scale corners back to original image size
    # ... (implementation depends on exact YOLO output format)

    return corners  # [[x,y], [x,y], [x,y], [x,y]]


def classify_squares(classifier, image, corners, crop_size=64):
    """Classify all 64 squares from the image."""
    # Compute perspective transform from corners to flat board
    src = np.float32(corners)
    board_size = crop_size * 8
    dst = np.float32([[0, 0], [board_size, 0], [board_size, board_size], [0, board_size]])
    M = cv2.getPerspectiveTransform(src, dst)
    flat = cv2.warpPerspective(image, M, (board_size, board_size))

    # Extract 64 crops
    crops = []
    for row in range(8):
        for col in range(8):
            y0 = row * crop_size
            x0 = col * crop_size
            crop = flat[y0:y0+crop_size, x0:x0+crop_size]
            crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
            crop = crop.astype(np.float32) / 255.0
            # Normalize with ImageNet stats
            crop = (crop - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
            crop = np.transpose(crop, (2, 0, 1))  # HWC -> CHW
            crops.append(crop)

    # Batch inference
    batch = np.stack(crops).astype(np.float32)
    outputs = classifier.run(None, {'input': batch})[0]

    # Parse results
    predictions = []
    confidences = []
    for i, logits in enumerate(outputs):
        probs = softmax(logits)
        pred_idx = np.argmax(probs)
        predictions.append(CLASS_NAMES[pred_idx])
        confidences.append(float(probs[pred_idx]))

    return predictions, confidences


def softmax(x):
    e = np.exp(x - np.max(x))
    return e / e.sum()


def predictions_to_fen(predictions):
    """Convert 64 square predictions to FEN placement string."""
    fen_rows = []
    for row in range(8):
        fen_row = ''
        empty_count = 0
        for col in range(8):
            idx = row * 8 + col
            piece = FEN_MAP[predictions[idx]]
            if piece is None:
                empty_count += 1
            else:
                if empty_count > 0:
                    fen_row += str(empty_count)
                    empty_count = 0
                fen_row += piece
        if empty_count > 0:
            fen_row += str(empty_count)
        fen_rows.append(fen_row)

    return '/'.join(fen_rows)


def evaluate(args):
    detector, classifier = load_models(args.models)
    data_dir = Path(args.data)

    total = 0
    perfect_boards = 0
    total_squares = 0
    correct_squares = 0

    # Load ChessReD annotations (adapt path/format to actual dataset)
    for ann_path in sorted(data_dir.glob('*.json')):
        with open(ann_path) as f:
            ann = json.load(f)

        img_path = data_dir / ann['image']
        image = cv2.imread(str(img_path))
        if image is None:
            continue

        gt_fen = ann['fen'].split(' ')[0]

        try:
            corners = detect_corners(detector, image)
            predictions, confidences = classify_squares(classifier, image, corners)
            pred_fen = predictions_to_fen(predictions)
        except Exception as e:
            print(f'Error on {ann["image"]}: {e}')
            total += 1
            continue

        total += 1

        # Compare
        gt_board = expand_fen(gt_fen)
        pred_board = expand_fen(pred_fen)

        board_correct = True
        for i in range(64):
            total_squares += 1
            if gt_board[i] == pred_board[i]:
                correct_squares += 1
            else:
                board_correct = False

        if board_correct:
            perfect_boards += 1

    print(f'\n=== Evaluation Results ===')
    print(f'Total images: {total}')
    print(f'Per-square accuracy: {correct_squares/total_squares*100:.2f}%')
    print(f'Perfect board accuracy: {perfect_boards/total*100:.2f}%')
    print(f'========================')


def expand_fen(fen_placement):
    """Expand FEN placement to a flat list of 64 characters."""
    result = []
    for ch in fen_placement:
        if ch == '/':
            continue
        elif ch.isdigit():
            result.extend(['.'] * int(ch))
        else:
            result.append(ch)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', required=True)
    parser.add_argument('--data', required=True)
    args = parser.parse_args()
    evaluate(args)
