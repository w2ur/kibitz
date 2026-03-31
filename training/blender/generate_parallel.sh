#!/usr/bin/env bash
#
# Parallel synthetic data generation using multiple Blender instances.
#
# Usage:
#   ./generate_parallel.sh --count 30000 --output /Volumes/MyDrive/kibitz/synthetic --workers 6
#
# Each worker gets a unique seed and non-overlapping index range.
# All workers write to the same output directory.

set -euo pipefail

# Defaults
COUNT=30000
OUTPUT=""
WORKERS=4
RESOLUTION=640
BASE_SEED=42
ENGINE="eevee"
BLENDER="blender"

usage() {
    echo "Usage: $0 --output DIR [--count N] [--workers N] [--resolution N] [--seed N] [--engine eevee|cycles] [--blender PATH]"
    echo ""
    echo "  --output DIR      Output directory (required, can be external drive)"
    echo "  --count N         Total images to generate (default: 30000)"
    echo "  --workers N       Number of parallel Blender instances (default: 4)"
    echo "  --resolution N    Image resolution in pixels (default: 640)"
    echo "  --seed N          Base random seed (default: 42)"
    echo "  --engine ENGINE   Render engine: eevee or cycles (default: eevee)"
    echo "  --blender PATH    Path to blender binary (default: blender)"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --count)     COUNT="$2"; shift 2 ;;
        --output)    OUTPUT="$2"; shift 2 ;;
        --workers)   WORKERS="$2"; shift 2 ;;
        --resolution) RESOLUTION="$2"; shift 2 ;;
        --seed)      BASE_SEED="$2"; shift 2 ;;
        --engine)    ENGINE="$2"; shift 2 ;;
        --blender)   BLENDER="$2"; shift 2 ;;
        -h|--help)   usage ;;
        *)           echo "Unknown option: $1"; usage ;;
    esac
done

if [[ -z "$OUTPUT" ]]; then
    echo "Error: --output is required"
    usage
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATE_PY="$SCRIPT_DIR/generate.py"

if [[ ! -f "$GENERATE_PY" ]]; then
    echo "Error: generate.py not found at $GENERATE_PY"
    exit 1
fi

# Calculate per-worker ranges
PER_WORKER=$(( COUNT / WORKERS ))
REMAINDER=$(( COUNT % WORKERS ))

echo "=== Kibitz Parallel Generator ==="
echo "Total images:  $COUNT"
echo "Workers:       $WORKERS"
echo "Per worker:    ~$PER_WORKER"
echo "Output:        $OUTPUT"
echo "Engine:        $ENGINE"
echo "Resolution:    ${RESOLUTION}x${RESOLUTION}"
echo "Base seed:     $BASE_SEED"
echo ""

mkdir -p "$OUTPUT/images" "$OUTPUT/labels"

PIDS=()
START_IDX=0

for (( w=0; w<WORKERS; w++ )); do
    # Last worker picks up the remainder
    if (( w == WORKERS - 1 )); then
        WORKER_COUNT=$(( PER_WORKER + REMAINDER ))
    else
        WORKER_COUNT=$PER_WORKER
    fi

    WORKER_SEED=$(( BASE_SEED + w ))
    LOG_FILE="$OUTPUT/worker_${w}.log"

    echo "Worker $w: images $START_IDX..$((START_IDX + WORKER_COUNT - 1)) (seed=$WORKER_SEED) → $LOG_FILE"

    "$BLENDER" --background --python "$GENERATE_PY" -- \
        --count "$WORKER_COUNT" \
        --output "$OUTPUT" \
        --start-index "$START_IDX" \
        --seed "$WORKER_SEED" \
        --resolution "$RESOLUTION" \
        --engine "$ENGINE" \
        > "$LOG_FILE" 2>&1 &

    PIDS+=($!)
    START_IDX=$(( START_IDX + WORKER_COUNT ))
done

echo ""
echo "All $WORKERS workers launched. Waiting for completion..."
echo "Monitor progress: tail -f $OUTPUT/worker_*.log"
echo ""

FAILED=0
for (( w=0; w<WORKERS; w++ )); do
    if wait "${PIDS[$w]}"; then
        echo "Worker $w finished successfully."
    else
        echo "Worker $w FAILED (exit code $?)."
        FAILED=$(( FAILED + 1 ))
    fi
done

echo ""
TOTAL_IMAGES=$(find "$OUTPUT/images" -name '*.png' | wc -l | tr -d ' ')
echo "=== Complete ==="
echo "Images generated: $TOTAL_IMAGES / $COUNT"
if (( FAILED > 0 )); then
    echo "WARNING: $FAILED worker(s) failed. Check logs in $OUTPUT/worker_*.log"
    exit 1
fi
