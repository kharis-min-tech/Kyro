"""
Lookalike check: is this box a real person, or a statue / sculpture / mannequin /
doll / figurine / poster that the person detector mistook for one?

The person detector (YOLO11) only knows "person" vs "not a person" and often
scores statues and mannequins as people — on Kyro's lookalike test set
(ai/eval/build_lookalikes.py) it counted someone in 9 of 54 statue/sculpture
photos with nobody in them. This asks a second, independent model — OpenAI's
CLIP, which matches pictures to descriptions — how well each counted box fits
"a photo of a person" versus "a photo of a statue", "…a mannequin", etc., and
drops boxes it's confident are NOT a person (person probability below
`min_person`). Chosen on the tuning half of the test sets: 0.15 removed 8 of
those 9 statue mistakes while losing 6 of ~1,040 real people (count error
unchanged). Being cautious (0.15, not 0.5) matters: CLIP is unsure about tiny,
blurry distant people, and missing real people is worse than the odd statue.

Anonymous: it only compares each box with written descriptions; nothing about
anyone is stored. Weights: openai/clip-vit-base-patch32 (safetensors, loaded
from the Hugging Face hub once and cached). If it can't be loaded, counting
carries on without it (logged once).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

PERSON = ["a photo of a person", "a photo of a man", "a photo of a woman", "a photo of a child",
          "a photo of people sitting", "a photo of a person seen from behind"]
NOT_PERSON = ["a photo of a statue", "a photo of a sculpture", "a photo of a mannequin", "a photo of a doll",
              "a photo of a figurine", "a photo of a carved wooden figure", "a photo of a painting of a person",
              "a photo of a poster", "a photo of a toy", "a photo of furniture", "a photo of an object"]


class LookalikeFilter:
    def __init__(self, model_name: str, min_person: float, device: str, cache_dir: Optional[str] = None,
                 min_height: float = 0.055) -> None:
        self.min_person = min_person
        # Boxes shorter than this share of the picture aren't checked: CLIP can't
        # judge a few-pixel figure, and in a full hall most boxes are that small.
        # On the tuning half, checking them too made no difference (60 px at 1080p).
        self.min_height = min_height
        self._ok = False
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor
            self._torch = torch
            self._model = CLIPModel.from_pretrained(model_name, use_safetensors=True, cache_dir=cache_dir).to(device).eval()
            self._proc = CLIPProcessor.from_pretrained(model_name, cache_dir=cache_dir)
            self._device = device
            # The descriptions never change: turn them into CLIP's numbers once.
            with torch.no_grad():
                t = self._proc(text=PERSON + NOT_PERSON, return_tensors="pt", padding=True).to(device)
                txt = self._model.text_projection(self._model.text_model(**t).pooler_output)
                self._text = txt / txt.norm(dim=-1, keepdim=True)
                self._scale = self._model.logit_scale.exp()
            self._ok = True
            logger.info("Lookalike check ready | model=%s min_person=%.2f", model_name, min_person)
        except Exception as e:  # noqa: BLE001 — never stop counting because of this
            logger.warning("Lookalike check unavailable (%s) — counting without it", e)

    @property
    def ready(self) -> bool:
        return self._ok

    def person_probability(self, frame_bgr: np.ndarray, boxes: np.ndarray) -> np.ndarray:
        """For each box (x1, y1, x2, y2): how likely CLIP thinks it's a real person (0–1)."""
        if not self._ok or not len(boxes):
            return np.ones(len(boxes), dtype=np.float32)
        H, W = frame_bgr.shape[:2]
        crops = []
        for x1, y1, x2, y2 in boxes:
            w, h = x2 - x1, y2 - y1
            X1, Y1 = int(max(0, x1 - 0.1 * w)), int(max(0, y1 - 0.1 * h))
            X2, Y2 = int(min(W, x2 + 0.1 * w)), int(min(H, y2 + 0.1 * h))
            crops.append(np.ascontiguousarray(frame_bgr[Y1:max(Y2, Y1 + 1), X1:max(X2, X1 + 1), ::-1]))
        with self._torch.no_grad():
            px = self._proc(images=crops, return_tensors="pt")["pixel_values"].to(self._device)
            img = self._model.visual_projection(self._model.vision_model(pixel_values=px).pooler_output)
            img = img / img.norm(dim=-1, keepdim=True)
            pr = (self._scale * img @ self._text.T).softmax(-1).float().cpu().numpy()
        return pr[:, :len(PERSON)].sum(axis=1)


def from_env(device: str) -> Optional[LookalikeFilter]:
    if os.getenv("DETECTION_LOOKALIKE_CHECK", "true").lower() != "true":
        return None
    models = os.getenv("KYRO_MODELS_DIR")
    return LookalikeFilter(os.getenv("DETECTION_LOOKALIKE_MODEL", "openai/clip-vit-base-patch32"),
                           float(os.getenv("DETECTION_LOOKALIKE_MIN_PERSON", "0.15")), device,
                           os.path.join(models, "hf") if models else None,
                           float(os.getenv("DETECTION_LOOKALIKE_MIN_HEIGHT", "0.055")))
