#!/usr/bin/env python3
"""Sample frames of a video window and detect faces with OpenCV.

Usage: faces.py <video> <start_sec> <end_sec> [samples_per_sec]
Prints JSON to stdout:
  {"width": W, "height": H, "detector": "...", "samples": [{"t": rel_sec, "faces": [[cx, cy, w, h], ...]}]}
All face values are normalised to 0..1 of the frame. "t" is relative to start_sec.

Uses the Haar cascade bundled with opencv-python (no download). If FACE_MODEL points to a YuNet
ONNX file, the more accurate YuNet detector is used instead.
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: faces.py <video> <start> <end> [sps]", file=sys.stderr)
        return 2
    path, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    sps = float(sys.argv[4]) if len(sys.argv) > 4 else 4.0
    if not os.path.isfile(path) or not (end > start):
        print("bad input", file=sys.stderr)
        return 2

    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print("cannot open video", file=sys.stderr)
        return 3
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = 960.0 / W if W > 960 else 1.0
    sw, sh = int(W * scale), int(H * scale)

    model = os.environ.get("FACE_MODEL", "")
    yunet = None
    if model and os.path.isfile(model) and hasattr(cv2, "FaceDetectorYN"):
        yunet = cv2.FaceDetectorYN.create(model, "", (sw, sh), 0.7, 0.3, 50)
        detector = "yunet"
    else:
        cascade = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))
        detector = "haar-frontalface"
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    samples = []
    step = 1.0 / sps
    t = start
    total = max(1, int((end - start) * sps))
    n = 0
    while t < end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (sw, sh)) if scale != 1.0 else frame
        faces = []
        if yunet is not None:
            _, det = yunet.detect(small)
            for d in det if det is not None else []:
                x, y, w, h = d[:4]
                faces.append([(x + w / 2) / sw, (y + h / 2) / sh, w / sw, h / sh])
        else:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            min_side = max(24, int(sh * 0.05))
            found = cascade.detectMultiScale(gray, 1.1, 5, minSize=(min_side, min_side))
            if len(found) == 0:
                # second try for dim or low-contrast footage (local contrast, not global equalisation)
                found = cascade.detectMultiScale(clahe.apply(gray), 1.1, 6, minSize=(min_side, min_side))
            for (x, y, w, h) in found:
                faces.append([(x + w / 2) / sw, (y + h / 2) / sh, w / sw, h / sh])
        samples.append({"t": round(t - start, 3), "faces": [[round(v, 4) for v in f] for f in faces]})
        n += 1
        if n % 10 == 0:
            print(f"PROGRESS {min(100, int(n / total * 100))}", file=sys.stderr, flush=True)
        t += step
    cap.release()
    json.dump({"width": W, "height": H, "detector": detector, "samples": samples}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
