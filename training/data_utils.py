"""Utilities for converting between annotation formats."""

import json
from pathlib import Path


def synthetic_to_yolo_keypoints(labels_dir, output_dir, image_size=640):
    """Convert synthetic JSON annotations to YOLO keypoint format.

    YOLO pose format (per image):
    <class> <x_center> <y_center> <width> <height> <kp1_x> <kp1_y> <kp1_visible> ...

    We have 1 class (chessboard) and 4 keypoints (corners).
    All coordinates are normalized to [0, 1].
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    labels_dir = Path(labels_dir)
    for json_path in sorted(labels_dir.glob('*.json')):
        with open(json_path) as f:
            ann = json.load(f)

        corners = ann['corners']  # [[x,y], [x,y], [x,y], [x,y]]

        # Bounding box from corners
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)

        # Normalize
        cx = ((x_min + x_max) / 2) / image_size
        cy = ((y_min + y_max) / 2) / image_size
        w = (x_max - x_min) / image_size
        h = (y_max - y_min) / image_size

        # Keypoints (normalized, all visible)
        kps = []
        for c in corners:
            kps.extend([c[0] / image_size, c[1] / image_size, 2])  # 2 = visible

        line = f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} " + " ".join(f"{v:.6f}" for v in kps)

        out_path = output_dir / json_path.with_suffix('.txt').name
        with open(out_path, 'w') as f:
            f.write(line + '\n')


def synthetic_to_classifier_crops(labels_dir, images_dir, output_dir, crop_size=64):
    """Extract and save per-square crops for classifier training.

    Uses the square bounding boxes from annotations to crop each square
    from the rendered image and save it with the piece label.
    """
    import cv2
    import numpy as np

    output_dir = Path(output_dir)
    images_dir = Path(images_dir)
    labels_dir = Path(labels_dir)

    # 13 classes: empty + 6 white + 6 black
    CLASS_MAP = {
        None: 'empty',
        'P': 'wP', 'R': 'wR', 'N': 'wN', 'B': 'wB', 'Q': 'wQ', 'K': 'wK',
        'p': 'bP', 'r': 'bR', 'n': 'bN', 'b': 'bB', 'q': 'bQ', 'k': 'bK',
    }

    for class_name in CLASS_MAP.values():
        (output_dir / class_name).mkdir(parents=True, exist_ok=True)

    import chess

    for json_path in sorted(labels_dir.glob('*.json')):
        with open(json_path) as f:
            ann = json.load(f)

        img_path = images_dir / ann['image']
        img = cv2.imread(str(img_path))
        if img is None:
            continue

        fen = ann['fen']
        board = chess.Board(fen)
        squares = ann['squares']

        for sq_name, sq_corners in squares.items():
            # Get piece at this square
            sq_idx = chess.parse_square(sq_name)
            piece = board.piece_at(sq_idx)
            piece_char = piece.symbol() if piece else None
            class_name = CLASS_MAP[piece_char]

            # Perspective crop using the 4 corners
            src = np.float32(sq_corners)
            dst = np.float32([[0, 0], [crop_size, 0], [crop_size, crop_size], [0, crop_size]])
            M = cv2.getPerspectiveTransform(src, dst)
            crop = cv2.warpPerspective(img, M, (crop_size, crop_size))

            # Save
            stem = json_path.stem
            crop_path = output_dir / class_name / f'{stem}_{sq_name}.png'
            cv2.imwrite(str(crop_path), crop)
