# Fine-tuning Kyro's person detector

Experiment (October 2026): does fine-tuning YOLO11l on more hand-labelled people
make Kyro count better? A candidate only replaces the current model if it beats
it on the **held-out** halves of Kyro's test sets (`ai/train/evaluate.py`):
COCO val2017 frames, the lookalikes set (statues, mannequins) and the Mall
overhead crowd footage — none of which are in the training data.

    python -m ai.train.build_openimages <oi_dir> <data_dir> 12000 3000
    python -m ai.train.train <data_dir> <runs_dir> --imgsz 640 --batch 4 --fraction 0.5 --freeze 10 --epochs 6
    python -m ai.train.evaluate <eval_dir> baseline yolo11l.pt
    python -m ai.train.evaluate <eval_dir> candidate <runs_dir>/<name>/weights/best.pt

Training data: Open Images V6 (test split), people boxes merged into one class;
statues/paintings of people (IsDepiction) left unlabelled so the model learns
they aren't people; photos with "group of people" boxes skipped; 3,000 photos
verified to contain no people. Open Images annotations © Google, CC BY 4.0;
images are from Flickr under CC BY 2.0 (individual credits in the Open Images
metadata). Kuznetsova et al., "The Open Images Dataset V4", IJCV 2020.

On an Apple M1 (16 GB) yolo11l at 960 px didn't fit in memory; 640 px, batch 4,
frozen backbone, half the photos per epoch: ~65 min per epoch.
