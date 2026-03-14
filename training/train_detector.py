"""Train YOLOv8n-pose for chessboard corner detection.

Usage:
    python train_detector.py --data data/synthetic/ --epochs 100 --output runs/detector/
"""

import argparse
import shutil
from pathlib import Path

import yaml
from ultralytics import YOLO

from data_utils import synthetic_to_yolo_keypoints


def prepare_dataset(data_dir, work_dir):
    """Convert synthetic data to YOLO pose format and create dataset YAML."""
    data_dir = Path(data_dir)
    work_dir = Path(work_dir)

    # Convert annotations
    yolo_labels = work_dir / 'labels'
    synthetic_to_yolo_keypoints(data_dir / 'labels', yolo_labels)

    # Symlink images
    yolo_images = work_dir / 'images'
    yolo_images.mkdir(parents=True, exist_ok=True)
    for img in sorted((data_dir / 'images').glob('*.png')):
        dst = yolo_images / img.name
        if not dst.exists():
            dst.symlink_to(img.resolve())

    # Split train/val (90/10)
    all_images = sorted(yolo_images.glob('*.png'))
    split_idx = int(len(all_images) * 0.9)

    for split, images in [('train', all_images[:split_idx]), ('val', all_images[split_idx:])]:
        split_dir = work_dir / split / 'images'
        split_labels = work_dir / split / 'labels'
        split_dir.mkdir(parents=True, exist_ok=True)
        split_labels.mkdir(parents=True, exist_ok=True)

        for img in images:
            (split_dir / img.name).symlink_to(img.resolve())
            label = yolo_labels / img.with_suffix('.txt').name
            if label.exists():
                (split_labels / label.name).symlink_to(label.resolve())

    # Create dataset YAML
    dataset_yaml = {
        'path': str(work_dir.resolve()),
        'train': 'train/images',
        'val': 'val/images',
        'kpt_shape': [4, 3],  # 4 keypoints, 3 values each (x, y, visibility)
        'names': {0: 'chessboard'},
    }

    yaml_path = work_dir / 'dataset.yaml'
    with open(yaml_path, 'w') as f:
        yaml.dump(dataset_yaml, f)

    return yaml_path


def train(args):
    data_dir = Path(args.data)
    output_dir = Path(args.output)
    work_dir = output_dir / 'dataset'

    print('Preparing dataset...')
    yaml_path = prepare_dataset(data_dir, work_dir)

    print('Training YOLOv8n-pose...')
    model = YOLO('yolov8n-pose.pt')  # Start from pretrained nano-pose
    model.train(
        data=str(yaml_path),
        epochs=args.epochs,
        imgsz=640,
        batch=16,
        project=str(output_dir),
        name='train',
        exist_ok=True,
        patience=20,
        save=True,
        plots=True,
    )

    print(f'Training complete. Best model: {output_dir}/train/weights/best.pt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='Path to synthetic data directory')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--output', default='runs/detector')
    args = parser.parse_args()
    train(args)
