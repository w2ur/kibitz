"""Train MobileNetV3-Small for chess piece classification (13 classes).

Usage:
    python train_classifier.py --data data/synthetic/ --epochs 50 --output runs/classifier/
"""

import argparse
from pathlib import Path

import timm
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from torchvision import transforms
from torchvision.datasets import ImageFolder
from tqdm import tqdm

from data_utils import synthetic_to_classifier_crops


CLASS_NAMES = [
    'empty', 'wP', 'wR', 'wN', 'wB', 'wQ', 'wK',
    'bP', 'bR', 'bN', 'bB', 'bQ', 'bK'
]


def prepare_dataset(data_dir, work_dir, crop_size=64):
    """Extract square crops from synthetic renders."""
    data_dir = Path(data_dir)
    crops_dir = Path(work_dir) / 'crops'

    if not crops_dir.exists():
        print('Extracting square crops from synthetic data...')
        synthetic_to_classifier_crops(
            data_dir / 'labels',
            data_dir / 'images',
            crops_dir,
            crop_size=crop_size
        )
    else:
        print('Crops directory already exists, skipping extraction.')

    return crops_dir


def create_model(num_classes=13, pretrained=True):
    """Create MobileNetV3-Small with custom classifier head."""
    model = timm.create_model('mobilenetv3_small_100', pretrained=pretrained, num_classes=num_classes)
    return model


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu')
    print(f'Using device: {device}')

    work_dir = Path(args.output).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    # Prepare data
    crops_dir = prepare_dataset(Path(args.data).resolve(), work_dir)

    # Data transforms
    train_transform = transforms.Compose([
        transforms.Resize((64, 64)),
        transforms.RandomHorizontalFlip(p=0.3),
        transforms.RandomRotation(5),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    val_transform = transforms.Compose([
        transforms.Resize((64, 64)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    # Load dataset
    full_dataset = ImageFolder(str(crops_dir), transform=train_transform)

    # Verify class names match expected
    print(f'Found classes: {full_dataset.classes}')
    print(f'Total samples: {len(full_dataset)}')

    # Split 90/10
    train_size = int(0.9 * len(full_dataset))
    val_size = len(full_dataset) - train_size
    train_dataset, val_dataset = random_split(full_dataset, [train_size, val_size])
    val_dataset.dataset.transform = val_transform  # Use non-augmented transform for val

    train_loader = DataLoader(train_dataset, batch_size=128, shuffle=True, num_workers=4)
    val_loader = DataLoader(val_dataset, batch_size=128, shuffle=False, num_workers=4)

    # Model
    model = create_model(num_classes=13).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_val_acc = 0.0

    for epoch in range(args.epochs):
        # Train
        model.train()
        train_loss = 0
        train_correct = 0
        train_total = 0

        for images, labels in tqdm(train_loader, desc=f'Epoch {epoch+1}/{args.epochs}'):
            images, labels = images.to(device), labels.to(device)

            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

            train_loss += loss.item() * images.size(0)
            _, predicted = outputs.max(1)
            train_correct += predicted.eq(labels).sum().item()
            train_total += labels.size(0)

        scheduler.step()

        # Validate
        model.eval()
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(device), labels.to(device)
                outputs = model(images)
                _, predicted = outputs.max(1)
                val_correct += predicted.eq(labels).sum().item()
                val_total += labels.size(0)

        train_acc = train_correct / train_total
        val_acc = val_correct / val_total

        print(f'Epoch {epoch+1}: train_loss={train_loss/train_total:.4f}, '
              f'train_acc={train_acc:.4f}, val_acc={val_acc:.4f}')

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'val_acc': val_acc,
                'class_names': CLASS_NAMES,
            }, work_dir / 'best.pt')
            print(f'  New best model saved (val_acc={val_acc:.4f})')

    print(f'\nTraining complete. Best val accuracy: {best_val_acc:.4f}')
    print(f'Model saved to: {work_dir}/best.pt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='Path to synthetic data directory')
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--output', default='runs/classifier')
    args = parser.parse_args()
    train(args)
