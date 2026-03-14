"""
Kibitz Synthetic Data Generator

Generates training images of chess positions rendered in Blender.
Run via: blender --background --python generate.py -- --count 1000 --output ../data/synthetic/

Each render produces:
- An RGB image (PNG)
- A JSON annotation file with:
  - Board corner positions in image space (for detector training)
  - FEN string (for classifier ground truth)
  - Per-square bounding boxes (for classifier training)
"""

import bpy
import bmesh
import json
import math
import os
import random
import sys
from pathlib import Path

import chess


def parse_args():
    """Parse arguments after '--' in the blender command."""
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=1000, help='Number of images to generate')
    parser.add_argument('--output', type=str, required=True, help='Output directory')
    parser.add_argument('--resolution', type=int, default=640, help='Image resolution (square)')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    return parser.parse_args(argv)


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()


def setup_render_settings(resolution):
    """Configure render engine and output settings."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64  # Balance quality vs speed
    scene.cycles.use_denoising = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.image_settings.file_format = 'PNG'


def create_board():
    """Create a chessboard mesh with two materials (light/dark squares)."""
    # Create board base
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    board = bpy.context.active_object
    board.name = 'Board'

    # Subdivide into 8x8 grid
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(board.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=7)
    bmesh.update_edit_mesh(board.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Create materials
    light_mat = bpy.data.materials.new('LightSquare')
    dark_mat = bpy.data.materials.new('DarkSquare')
    board.data.materials.append(light_mat)
    board.data.materials.append(dark_mat)

    return board


def create_piece_template(piece_type):
    """Create or import a 3D mesh for a chess piece type.

    In the initial version, pieces are represented as simple geometric
    approximations. For better training data, replace these with detailed
    Staunton piece models (free 3D assets available on Sketchfab, etc.).
    """
    # Simplified piece shapes — replace with real Staunton models later
    shapes = {
        'P': lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=0.6, location=(0, 0, 0.3)),
        'R': lambda: bpy.ops.mesh.primitive_cube_add(size=0.5, location=(0, 0, 0.3)),
        'N': lambda: bpy.ops.mesh.primitive_cone_add(radius1=0.25, depth=0.7, location=(0, 0, 0.35)),
        'B': lambda: bpy.ops.mesh.primitive_cone_add(radius1=0.2, depth=0.8, location=(0, 0, 0.4)),
        'Q': lambda: bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(0, 0, 0.4)),
        'K': lambda: bpy.ops.mesh.primitive_uv_sphere_add(radius=0.35, location=(0, 0, 0.45)),
    }
    shapes[piece_type]()
    obj = bpy.context.active_object
    obj.name = f'Template_{piece_type}'
    # Hide template
    obj.hide_set(True)
    obj.hide_render = True
    return obj


def place_pieces(fen_board, templates, white_mat, black_mat):
    """Place piece instances on the board according to FEN."""
    pieces = []
    board = chess.Board(fen_board)

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None:
            continue

        # Chess square to 3D coordinates
        col = chess.square_file(square)  # 0-7 (a-h)
        row = chess.square_rank(square)  # 0-7 (1-8)
        x = col - 3.5  # Center on origin
        y = row - 3.5

        piece_type = piece.symbol().upper()
        template = templates[piece_type]

        # Duplicate template
        obj = template.copy()
        obj.data = template.data.copy()
        obj.location = (x, y, 0)
        obj.hide_set(False)
        obj.hide_render = False

        # Assign material based on color
        mat = white_mat if piece.color == chess.WHITE else black_mat
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)

        bpy.context.collection.objects.link(obj)
        pieces.append(obj)

    return pieces


def setup_camera(pitch_deg, yaw_deg, distance):
    """Position camera looking at the board center."""
    pitch = math.radians(pitch_deg)
    yaw = math.radians(yaw_deg)

    x = distance * math.sin(pitch) * math.cos(yaw)
    y = distance * math.sin(pitch) * math.sin(yaw)
    z = distance * math.cos(pitch)

    bpy.ops.object.camera_add(location=(x, y, z))
    cam = bpy.context.active_object
    cam.name = 'Camera'

    # Point at board center
    constraint = cam.constraints.new('TRACK_TO')
    constraint.target = bpy.data.objects.get('Board')
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'

    bpy.context.scene.camera = cam
    return cam


def setup_lighting(num_lights, warmth_range=(4000, 6500)):
    """Add randomized point lights."""
    lights = []
    for i in range(num_lights):
        x = random.uniform(-5, 5)
        y = random.uniform(-5, 5)
        z = random.uniform(3, 8)
        energy = random.uniform(100, 500)

        bpy.ops.object.light_add(type='POINT', location=(x, y, z))
        light = bpy.context.active_object
        light.name = f'Light_{i}'
        light.data.energy = energy
        light.data.color = kelvin_to_rgb(random.uniform(*warmth_range))
        lights.append(light)

    return lights


def kelvin_to_rgb(kelvin):
    """Approximate color temperature to RGB."""
    temp = kelvin / 100
    if temp <= 66:
        r = 1.0
        g = max(0, min(1, 0.39 * math.log(temp) - 0.63))
        b = max(0, min(1, 0.54 * math.log(temp - 10) - 1.19)) if temp > 19 else 0
    else:
        r = max(0, min(1, 1.29 * (temp - 60) ** -0.13))
        g = max(0, min(1, 1.13 * (temp - 60) ** -0.08))
        b = 1.0
    return (r, g, b)


def get_board_corners_in_image(scene, cam):
    """Project the board's 4 corners into image coordinates."""
    from mathutils import Vector
    from bpy_extras.object_utils import world_to_camera_view

    # Board corners in world space (board is 8x8 centered at origin)
    world_corners = [
        Vector((-4, -4, 0)),  # bottom-left (a1 side)
        Vector((4, -4, 0)),   # bottom-right (h1 side)
        Vector((4, 4, 0)),    # top-right (h8 side)
        Vector((-4, 4, 0)),   # top-left (a8 side)
    ]

    image_corners = []
    for wc in world_corners:
        co = world_to_camera_view(scene, cam, wc)
        # co.x and co.y are normalized (0-1), convert to pixel coords
        px = co.x * scene.render.resolution_x
        py = (1 - co.y) * scene.render.resolution_y  # Flip Y
        image_corners.append([round(px, 2), round(py, 2)])

    return image_corners


def random_fen():
    """Generate a random legal chess position."""
    board = chess.Board()
    # Play random moves to get a mid-game position
    num_moves = random.randint(0, 40)
    for _ in range(num_moves):
        legal = list(board.legal_moves)
        if not legal:
            break
        board.push(random.choice(legal))
    return board.fen()


def get_square_bboxes(scene, cam):
    """Compute bounding box for each of the 64 squares in image space."""
    from mathutils import Vector
    from bpy_extras.object_utils import world_to_camera_view

    squares = {}
    for row in range(8):
        for col in range(8):
            # World coordinates of square corners
            x0 = col - 4
            y0 = row - 4
            corners = [
                Vector((x0, y0, 0)),
                Vector((x0 + 1, y0, 0)),
                Vector((x0 + 1, y0 + 1, 0)),
                Vector((x0, y0 + 1, 0)),
            ]

            img_corners = []
            for wc in corners:
                co = world_to_camera_view(scene, cam, wc)
                px = co.x * scene.render.resolution_x
                py = (1 - co.y) * scene.render.resolution_y
                img_corners.append([round(px, 2), round(py, 2)])

            # Square name (e.g., "a1", "h8")
            sq_name = chr(ord('a') + col) + str(row + 1)
            squares[sq_name] = img_corners

    return squares


def generate_dataset(args):
    """Main generation loop."""
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / 'images').mkdir(exist_ok=True)
    (output_dir / 'labels').mkdir(exist_ok=True)

    random.seed(args.seed)
    setup_render_settings(args.resolution)

    for i in range(args.count):
        clear_scene()

        # Random parameters
        pitch = random.uniform(30, 70)
        yaw = random.uniform(0, 360)
        distance = random.uniform(8, 14)
        num_lights = random.randint(2, 4)

        # Setup scene
        board = create_board()
        cam = setup_camera(pitch, yaw, distance)
        setup_lighting(num_lights)

        # Create piece templates and materials
        white_mat = bpy.data.materials.new('WhitePiece')
        white_mat.diffuse_color = (0.9, 0.85, 0.75, 1)
        black_mat = bpy.data.materials.new('BlackPiece')
        black_mat.diffuse_color = (0.15, 0.12, 0.1, 1)

        templates = {}
        for pt in ['P', 'R', 'N', 'B', 'Q', 'K']:
            templates[pt] = create_piece_template(pt)

        # Generate and place random position
        fen = random_fen()
        pieces = place_pieces(fen, templates, white_mat, black_mat)

        # Render
        img_path = str(output_dir / 'images' / f'{i:06d}.png')
        bpy.context.scene.render.filepath = img_path
        bpy.ops.render.render(write_still=True)

        # Get annotations
        corners = get_board_corners_in_image(bpy.context.scene, cam)

        # Compute per-square bounding boxes for classifier training
        squares = get_square_bboxes(bpy.context.scene, cam)

        annotation = {
            'image': f'{i:06d}.png',
            'fen': fen,
            'corners': corners,
            'squares': squares,
            'params': {
                'pitch': pitch,
                'yaw': yaw,
                'distance': distance,
                'num_lights': num_lights,
            }
        }

        label_path = output_dir / 'labels' / f'{i:06d}.json'
        with open(label_path, 'w') as f:
            json.dump(annotation, f, indent=2)

        if (i + 1) % 100 == 0:
            print(f'Generated {i + 1}/{args.count} images')


if __name__ == '__main__':
    args = parse_args()
    generate_dataset(args)
