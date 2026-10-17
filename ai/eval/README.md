# Person-counting accuracy

## What each Kyro number means

| Number | Where | Meaning |
|---|---|---|
| **People now** (per camera) | Live Cameras, AI Count, Seat Map | People that camera can **see** in its latest pictures. Each picture is counted on its own, and the number shown is the middle of the last few readings (Camera Box: last 3, Camera Mode: last 5), so one odd picture doesn't make it jump. Someone fully hidden (behind a pillar) drops out after 2 of those readings and comes back when visible. |
| **Total now** | AI Count | The sum of "people now" across cameras. Cameras must cover **separate** areas: Kyro does not match people between cameras, so two cameras seeing the same people count them twice. |
| **Peak** | AI Count, Analytics | The highest "people now" so far today. |
| **In / out** (entries, exits) | Camera Box only | People who appeared / disappeared, from anonymous tracking (clothing colour, build and position; no faces). A rough guide, not an attendance figure; Camera Mode doesn't track (always 0). |
| **Out of date** | Cameras page | The Camera Box marks a camera "Needs attention: no new count for N s" after 60 s without a fresh count; the website shows a camera Offline after 45 s without a report. |

## October 2026 audit (current settings)

### Test set (hand-labelled ground truth)

`build_testset.py` builds 410 frames at 1920×1080 (the Goodmans camera's size)
from COCO val2017, whose people were outlined **by hand** (Kyro's AI never
supplies the answers). Frames alternate between a **tuning half** (used to choose
settings) and a **held-out half** (only used for the results below).

| Scenario | Frames | What it is |
|---|---|---|
| one_person | 60 | exactly one person, clearly visible |
| two_people | 50 | exactly two people |
| small_group | 50 | 3–7 people |
| overlapping | 50 | people overlapping / partly hidden by each other |
| edge | 50 | someone cut off by the edge of the picture |
| dim | 40 | dark photos (average brightness < 60/255) |
| no_people_objects | 80 | **no people**, but chairs, sofas, tables, screens, plants, toys, bags… |
| whole_hall | 30 | four crowded photos per frame: people small, like a camera over a hall |

2,034 labelled people. People under 16 px tall in the original photo are
ignored (neither a hit nor a miss). Known limitation: COCO occasionally leaves a
real person unlabelled (background, photos on walls); those show up as "object"
mistakes below, so the object counts slightly overstate real mistakes.

`build_sequences.py` builds 4 short "videos" (53 frames) by cutting real people
out along their hand-drawn outlines (checked by eye) and moving them through
empty-room photos: walking, hidden behind a pillar, 3 people arriving and
leaving, and a still scene. The true count is known for every frame.

### Metrics

MAE = mean |headcount − true people| per frame. Exact = frames counted exactly
right. Recall = labelled people found. Precision = counted boxes that are real
people. dup/part = extra boxes on a person (same person twice, or part of one).
object = extra boxes on no person. Matching: IoU ≥ 0.5, one-to-one.

### Results: held-out half (205 frames, 993 people)

| | Count error (MAE) | Exact | Recall | Precision | F1 | Same person twice / part | Objects as people | s per frame* |
|---|---|---|---|---|---|---|---|---|
| **Camera Box** before (count ≥ 0.25, no clean-up) | 0.88 | 61.5% | 85.4% | 77.9% | 0.815 | 62 | 178 | 2.7 |
| **Camera Box** now (clean-up + count ≥ 0.30) | **0.82** | **65.4%** | 81.9% | **85.1%** | **0.835** | **28** | **114** | 3.0 |
| **Camera Mode** before (count ≥ 0.20, no clean-up) | 1.10 | 57.1% | 86.5% | 73.4% | 0.794 | 83 | 229 | 1.7 |
| **Camera Mode** now (clean-up + count ≥ 0.30) | **0.84** | **62.9%** | 80.9% | **83.0%** | **0.819** | **39** | **126** | 2.4 |
| Camera Mode, light AI (weak graphics) | 1.14 | 66.8% | 71.4% | 84.0% | 0.772 | 44 | 91 | 0.3 |

\*Apple M1 (Camera Box: GPU via PyTorch MPS; Camera Mode: Apple Neural Engine via
onnxruntime CoreML). A browser with WebGPU on the same Mac is ~1 s per count.

Models: Camera Box `yolo11l.pt` (Ultralytics, `yolo11x.pt` on NVIDIA) at 1280 px
+ 2×2 tiles. Camera Mode `yolo11m` at 1280 px + 2×2 tiles (fp16 ONNX,
`dashboard/public/models/yolo11m1280-w16-v1`); light: `yolo11s` at 640 px.

By scenario (held-out half, before → now):

| Scenario | Camera Box MAE | Camera Mode MAE |
|---|---|---|
| one_person | 0.27 → **0.10** | 0.43 → **0.27** |
| two_people | 0.56 → **0.44** | 0.68 → **0.36** |
| small_group | 0.68 → **0.56** | 0.84 → **0.52** |
| overlapping | 2.20 → **1.92** | 2.36 → **1.68** |
| edge | 0.44 → **0.36** | 0.76 → **0.40** |
| dim | 0.80 → 0.80 | 1.40 → **1.00** |
| no_people_objects (rooms with a false person) | 3/40 → 3/40 | 5/40 → **3/40** |
| whole_hall | 3.47 → 4.13 (worse) | 4.20 → 4.53 (worse) |

**Crowds are not proven better.** On the tuning half the whole-hall error fell
(Camera Box 4.93 → 3.40), on the held-out half it rose (3.47 → 4.13). With 15
crowd frames per half this difference is within noise; the stricter count
misses some distant people while removing objects. Measuring the real hall
(see below) is the way to settle it.

Empty rooms, both halves (80 frames): Camera Box counted a non-person in 5
rooms (7 boxes), Camera Mode in 4 (4 boxes). The clear object mistakes left are
**a statue (0.50) and a sculpted head (0.36)**; the rest are small blurry
figures that look like unlabelled people.

### Moving people (Camera Box, real counting code, one picture every ~3 s)

| Video | True | Before (tracker headcount) | Now |
|---|---|---|---|
| walk (1 person crossing) | 1 every frame | 0 on the first frame | 1 every frame |
| pillar (2 people, one hidden 3 frames) | 2 present, 1 visible | MAE 0.33 vs present | MAE 0.25 vs present (drops to 1 while hidden) |
| enter_leave (3 arrive, then leave) | 1,1,2,2,3,…,0 | MAE 1.0, counted 4 at once, 4 entries | MAE 0.36 (one picture behind), 3 entries |
| still (2 people, 15 frames) | 2 | 0 on the first frame | 2 every frame |

Camera Mode counted every frame of every video exactly; its shown number
(middle of the last 5) trails changes by two readings (~2–3 s).

### What was wrong, and what changed

1. **A box for part of a person** (upper body, hands, an arm) counted as an
   extra person, and **unsure big boxes** (straddling two people) counted.
   → `tidy()` in `ai/detection/detector.py` and `dashboard/src/lib/peopleDetector.ts`
   (same rules in both). Regression tests in `tests/test_detector_merge.py`.
2. **The counting bar was too low** (0.25 / 0.20), so objects and body parts
   counted. → 0.30 in both (`DETECTION_COUNT_CONF`, `COUNT_CONFIDENCE`),
   chosen on the tuning half.
3. **Camera Box headcount came from tracking**, which on a slow computer
   (a picture every few seconds) missed newcomers for the first picture(s) and
   could count someone twice after they moved. → headcount from each picture,
   steadied over 3 (`camera-box/kyro_box/counting.py`); tracking still gives
   in/out. The tracker's "remember a hidden person" no longer keeps an old track
   when the same person reappears under a new one (`ai/analytics/counter.py`).
4. **Face data**: the re-identification module kept a face fingerprint in
   memory for in/out matching. Counting never needed it → off by default
   (`FACE_REID_WEIGHT_FACE=0`); faces aren't looked for.
5. Old numbers are flagged "out of date" instead of looking live.

Tried and **not** adopted (no measured benefit): checking unsure boxes with a
pose model (yolo11m-pose: head/shoulder keypoints) removed objects and real
people in equal measure (F1 0.840 → 0.841); a separate lower bar for small,
distant boxes (MAE 0.56 → 0.55 on the tuning half, worse for Camera Mode).

### Known limitations

- **Statues and figurines** can be counted. Reduced by the lookalike check
  (Camera Box); for the church's own statues, mark them with "Don't count an
  area" — see the second pass below.
- **Crowded halls**: ~80% of labelled people found, headcount off by ~4 in a
  frame of ~35 people; distant, overlapping people are the main misses.
- **Dim pictures**: ~60–70% of people found.
- **Several cameras** covering the same people are added together.
- Test photos are COCO, not Kharis Church footage. Real accuracy depends on the
  camera's position, height and lighting.

### Re-running

    # once: the COCO 2017 annotations (241 MB) into $DATA/annotations/
    python -m ai.eval.build_testset $DATA            # 410 frames + labels.json
    python -m ai.eval.build_sequences $DATA $SEQ     # 4 videos
    python -m ai.eval.run_box $DATA box.json --device mps          # Camera Box (--raw: without tidy)
    (cd dashboard && npm i --no-save onnxruntime-node sharp && \
      ORT_EP=coreml node scripts/eval-camera-mode.mjs $DATA ../cm.json accurate)   # Camera Mode
    python -m ai.eval.score $DATA box.json --count-conf 0.3 --split test
    python -m ai.eval.score $DATA cm.json  --count-conf 0.3 --split test
    PYTHONPATH=.:camera-box python -m ai.eval.run_sequences $SEQ --legacy
    # lookalikes: also the COCO captions + Open Images validation labels
    python -m ai.eval.build_lookalikes $DATA $OI $LOOK
    python -m ai.eval.run_box $LOOK look.json --device mps
    python -m ai.eval.score $LOOK look.json --count-conf 0.3 --split test
    pytest tests

## Second pass (October 2026): crowds, distance, statues

Same 410-frame test set (tuning half for choices, held-out half for results),
plus a new **lookalikes** set (`build_lookalikes.py`, 133 frames): 26 COCO
photos of statues / mannequins / figurines with no people, 87 Open Images
"Sculpture"/"Doll" photos with no person label (each checked by eye; 1
excluded), and 20 COCO statue photos that also contain labelled people. Neither
dataset was used to train YOLO11 (trained on COCO *train*2017).

### Why people are still missed (tuning half, Camera Box)

| Person's height in the frame | Found |
|---|---|
| under 20 px | 50% |
| 20–40 px | 63% |
| 40–80 px | 78% |
| 80–160 px | 88% |
| over 160 px | 92% |

People overlapped by another person: 81% found; not overlapped: 85%. **Distance
(too few pixels) is the main cause, more than occlusion.**

### Tried for crowds and distance (tuning half, all with the current clean-up and count ≥ 0.30)

| Change | Count error (MAE) | Missed | Objects counted | Whole-hall MAE | s/frame | Adopted? |
|---|---|---|---|---|---|---|
| Current: yolo11l, 1280 px, 2×2 tiles | **0.56** | 162 | 99 | 3.40 | 2.7 | — |
| Keep more overlapping boxes (NMS 0.75, merge 0.7) | 0.57 | 169 | 93 | 3.27 | 5.4 | no |
| 3×3 tiles | 0.81 | 152 | 171 | 5.33 | 4.2 | no |
| 3×3 tiles + lookalike check | 0.78 | 158 | 163 | 5.13 | 4.2 | no |
| yolo11x (bigger model) | **0.54** | **149** | 113 | **3.07** | 3.4 | already used with an NVIDIA GPU |
| 1600 px, no tiles | 0.82 | 228 | 71 | 6.07 | 0.6 | no |
| 1600 px + 2×2 tiles | 0.60 | 174 | 123 | 3.60 | 2.9 | no |
| + pose model (yolo11l-pose) adding people the detector missed | 0.60–0.67 | 158–159 | 103–118 | 3.47–3.60 | +5.6 | no |
| Camera Mode with yolo11l instead of yolo11m | 0.67 (was 0.70) | 174 (185) | 119 (132) | 4.6 (3.6) | 3.9 (1.7) | no: worse in crowds, 2× slower |

No head detector was tried: there is no official (Ultralytics / model-author)
head-detection model, and third-party weight files weren't used. The pose model
(official) is the closest anonymous "head and shoulders" evidence; it found
only ~3 extra people and added more false ones.

**Conclusion:** none of these settings counts distant people better without
counting more things that aren't people. The practical levers are the camera:
mount it higher and closer to the seats (people ≥ 80 px tall are found ~90% of
the time), use one camera per section rather than one for the whole hall, and
an NVIDIA graphics card (yolo11x is used automatically).

### Statues, sculptures, mannequins: what changed

1. **Lookalike check** (`ai/detection/verifier.py`, Camera Box): each counted box
   at least 60 px tall (at 1080p) is compared by OpenAI's CLIP
   (`openai/clip-vit-base-patch32`) with "a photo of a person" vs "…a statue",
   "…a mannequin", "…a doll" etc.; boxes with person probability < 0.15 are
   dropped. Anonymous (descriptions only, nothing stored). If CLIP can't load,
   counting continues without it. Settings: `DETECTION_LOOKALIKE_CHECK`,
   `DETECTION_LOOKALIKE_MIN_PERSON`, `DETECTION_LOOKALIKE_MODEL`.
2. **"Don't count an area"** per camera (Cameras page): an admin drags a box
   around a statue the camera always sees; detections ≥ 70% inside are ignored
   by the Camera Box and Camera Mode (`in_ignore_zone`, `outsideZones`).

| Lookalikes (rooms with a false person) | Tuning half | Held-out half |
|---|---|---|
| Camera Box before | 9 / 54 | 13 / 59 |
| Camera Box + lookalike check (CLIP B/32) | **1 / 54** | **9 / 59** |
| (CLIP L/14, larger, 4–5× slower — not adopted) | 1 / 54 | 7 / 59 |
| Camera Mode (no lookalike check) | — | 10 / 59 |

The held-out improvement is real but much smaller than on the tuning half —
treat statue-detection as **reduced, not solved**. What still fools it:
mannequins in shop windows, one large statue, a carving. On the statue photos
that also contain people, the check removed 2 "people" — both are bronze
statues that COCO's annotators labelled as people (a man reading a newspaper,
a figure on a bench), so the scored recall there (0.67 → 0.44 of 9) understates it.

Main test set with the check (held-out half, Camera Box): MAE 0.82 → **0.80**,
missed 180 → 181, objects 114 → 112, rooms with a false person 3/40 → 3/40.
Moving-people videos: unchanged (walk, pillar, arrivals/departures, still — as above).

Cost: CLIP B/32 ≈ 0.1 s per near person on a processor, ≈ 0.02 s on a GPU
(Apple M1); one-time download ≈ 600 MB. For a statue the camera always sees,
"Don't count an area" is the dependable fix (it can't miss, and costs nothing).

## Hybrid experiment (October 2026): person detector + crowd-counting / head model

**Question:** would a model built for crowds — finding each *head* as a point —
recover people Kyro's person detector misses, if the two are matched so nobody
is counted twice?

**Second model:** P2PNet (Song et al., ICCV 2021, Tencent; ShanghaiTech-A
weights), a point-based crowd counter: one point per head, so its output can be
matched one-to-one with person boxes (density-map counters only give a total,
which can't be matched). Its licence allows use **only for academic research**,
so it was used here purely as a benchmark; it can't ship in Kyro.

**Matching** (`hybrid/fuse.py`): a head point "belongs" to a person box if it
sits in the box's head area; each box takes at most one head. A head with no box
is added as a person only if P2PNet is confident (threshold swept) and — in the
strict version — it isn't inside any box Kyro already counted (a torso or second
point on the same person). Unmatched low-confidence heads would be "uncertain",
shown but not counted. Counts are never simply added.

**Test footage:** the Mall dataset (CUHK, Chen et al. 2012): a fixed overhead
camera over a busy shopping centre, every head hand-marked — close to a church
camera's view. Every 10th of 2,000 frames (200), alternating tuning/held-out,
~31 people per frame; neither model was trained on it. Scored inside the
dataset's official region of interest. Kyro run with 2×2 tiles (what it does on
a 1080p camera; the Mall frames are only 640×480).

Held-out half (100 frames, 3,114 people):

| | Count error / frame | People found | Counted boxes that are people |
|---|---|---|---|
| Kyro now (count ≥ 0.30) | 5.27 | 72.2% | 86.9% |
| Kyro, count ≥ 0.25 | 3.67 | 74.8% | 84.0% |
| Kyro, count ≥ 0.20 | **2.36** | **77.3%** | 80.3% |
| Kyro (≥ 0.30) + P2PNet heads ≥ 0.6, strict matching | 2.82 | 73.9% | 80.0% |
| Kyro (≥ 0.30) + P2PNet heads ≥ 0.9, strict matching | 3.68 | 72.9% | 82.3% |
| P2PNet alone (≥ 0.5) | 6.8 | 53.5% | 68.2% |

(The tuning half gave the same picture: hybrid 2.81 vs Kyro ≥ 0.20 2.86.)

**Result: the hybrid does not beat Kyro alone.** For every real person the head
model added, it added about four false ones — heads on the shop-window
mannequins, two points on one person, points on torsos. It closes the count gap
mostly by mistakes cancelling Kyro's misses, not by finding the missed people.
Simply letting Kyro count slightly less certain people finds *more* real people
than the hybrid at the same precision.

**What this does show:** the best counting bar depends on the camera view —
close-up photos favoured 0.30, this overhead crowd favours 0.20. A per-church
calibration (comparing Kyro with a few hand counts from the real camera and
picking the bar) is the evidence-based next step, not a second model.

**Not done:** a dedicated head *detector*. There's no official (model-author or
Ultralytics) head detector, the main crowd/head datasets (CrowdHuman,
ShanghaiTech, SCUT-HEAD) are research-only, and third-party weight files weren't
used. A licence-clean option is training one on Open Images "Human head" boxes
(CC BY 4.0); given the P2PNet result it's only worth it if real Kharis footage
shows missed people whose heads are clearly visible. The P2PNet run on the
statue and photo test sets didn't complete (lost with the scratch data); in the
Mall footage it marked mannequins as heads.

Re-run: `hybrid/build_mall.py`, `hybrid/p2p_run.py` (needs the P2PNet repo),
`python -m ai.eval.run_box <dir>/mallset box_mall_t2_raw.json --raw` with
`DETECTION_TILES=2`, then `ROI=1 python hybrid/eval_mall.py <dir> test`.

## Earlier benchmark (detection only)


How well Kyro finds people, measured on crowded scenes where every person has
been labelled by hand (COCO val2017 photos with 8+ people, no unlabelled crowd
regions).

## Results (October 2026)

**Whole-hall test**: four crowded photos per 1920×1080 frame, like a camera
covering a whole hall, so people are small in the frame. 37 frames, 1,537
labelled people. Run with Kyro's real detector code (`benchmark_wide.py`).

| Setup | People found | Small / distant | Medium | Near | Headcount error / frame | s / frame* |
|---|---|---|---|---|---|---|
| **Old default**: yolov8n @640 | 28.0% | 0.4% | 20.6% | 68.1% | 28.5 | 0.2 |
| yolo11m @640 | 56.6% | 12.2% | 68.0% | 90.4% | 19.0 | 0.1 |
| yolo11m @1280 | 74.8% | 45.2% | 84.9% | 93.8% | 10.0 | 0.3 |
| yolo11m @1920 | 81.1% | 62.3% | 87.2% | 93.8% | 6.5 | 0.7 |
| yolo11s @1280 + 2×2 tiles | 80.5% | 61.5% | 86.6% | 93.5% | 4.8 | 0.6 |
| yolo11m @1280 + 2×2 tiles | 83.3% | 66.5% | 88.4% | 94.9% | 4.4 | 1.4 |
| **New default (no GPU)**: yolo11l @1280 + 2×2 tiles | **84.2%** | **68.6%** | **89.4%** | **94.4%** | **4.0** | 1.7 |
| **New default (NVIDIA GPU)**: yolo11x @1280 + 2×2 tiles | 86.1% | 72.4% | 90.3% | 95.5% | 4.3 | 3.6 |
| yolo11l @1280 + 3×3 tiles | 86.0% | 76.9% | 88.3% | 93.1% | 6.0 | 3.4 |
| yolo11m @1280 + 2×2 + flip (TTA) | 84.4% | 68.4% | 89.1% | 95.8% | 4.7 | 3.2 |

\*Apple M-series GPU. CPU only: yolo11s ≈1.4 s, yolo11m ≈3.0 s, yolo11l ≈3.9 s per
1080p frame on the same Mac. Expect an office PC to be 1.5–2× slower.

Headcount error is measured at the confidence where the tracker starts
counting someone (0.25). 3×3 tiles find more distant people but add false
detections, so 2×2 gives the better count. TTA didn't pay for its cost.

**Single-photo test** (`benchmark_coco.py`, 150 photos, 1,558 people). The
photos are only ~640 px, so this mainly shows model strength: yolov8n 57% →
yolo11l 83% → yolo11x 84% of people found (at 640).

## What changed to get there

1. **Model**: yolov8n (smallest) → yolo11l / yolo11x (`YOLO_MODEL=auto`).
2. **Resolution**: 640 → 1280, and the AI now sees the camera's full
   resolution instead of a frame shrunk to 1280×720 first.
3. **Tiling**: the frame is checked whole AND as a 2×2 grid of overlapping
   tiles, so people at the back are big enough to recognise. Merging drops
   only half-people cut at a tile edge, never someone sitting behind another.
4. **Tracker**: anyone scored ≥ 0.25 can be counted (it was 0.6, so half-
   hidden and distant people were found and then discarded); optimal
   (Hungarian) matching; a short grace for flickering newcomers; "remember a
   hidden person" is ~4 seconds whatever the frame rate.
5. **Live headcount** includes people momentarily hidden (someone stood in
   front of them) instead of dropping them for that moment.
6. **Latest frame**: the worker always processes the newest camera frame, so
   a slower, stronger model never lags behind.

## Checking a real camera

    python -m ai.check_camera --stream rtsp://user:pass@camera/stream1

Saves a picture with a numbered box on everyone found. Anyone without a box
is someone that camera can't see well enough.

## Re-running the benchmark

    pip install pycocotools
    # data/annotations/instances_val2017.json from cocodataset.org
    python ai/eval/benchmark_wide.py data . auto 1280 auto 0 0.10
