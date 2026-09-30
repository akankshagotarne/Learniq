"""
Builds the clean certificate template from the approved LearnIQ certificate image.

Only the seven dynamic fields are removed (student name, standard, grade, percentile,
certificate number, date of issue, QR). Every pixel outside those boxes is copied unchanged.
The values are drawn back on top of this template by the backend at PDF-generation time.
"""
import sys, json
import numpy as np, cv2

src, out, meta = sys.argv[1], sys.argv[2], sys.argv[3]
img = cv2.imread(src, cv2.IMREAD_COLOR)
H, W = img.shape[:2]

# field -> (x0, y0, x1, y1) search box in the 1536x1024 approved image
BOXES = {
    'name':       (590, 400, 955, 466),
    'standard':   (420, 640, 530, 692),
    'grade':      (722, 628, 816, 696),
    'percentage': (980, 640, 1130, 692),
    'certNo':     (1298, 626, 1492, 656),
    'date':       (1300, 703, 1490, 738),
}
QR_BOX = (1318, 384, 1476, 530)

result = img.copy()
info = {}
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

def ink_mask(box, pad_bg=8):
    x0, y0, x1, y1 = box
    roi = gray[y0:y1, x0:x1].astype(np.float32)
    bg = cv2.medianBlur(gray, 31)[y0:y1, x0:x1].astype(np.float32)   # local background estimate
    diff = bg - roi                                                   # text is darker than bg
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[y0:y1, x0:x1, 1].astype(np.float32)
    m = ((diff > 18) | (sat > 110)).astype(np.uint8) * 255
    return m

for name, box in BOXES.items():
    x0, y0, x1, y1 = box
    m = ink_mask(box)
    ys, xs = np.where(m > 0)
    info[name] = {'ink': [int(xs.min() + x0), int(ys.min() + y0), int(xs.max() + x0), int(ys.max() + y0)]}
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    full = np.zeros((H, W), np.uint8); full[y0:y1, x0:x1] = m
    result = cv2.inpaint(result, full, 6, cv2.INPAINT_TELEA)

# QR: the whole matrix area sits on a flat white card -> fill with the card's own colour
x0, y0, x1, y1 = QR_BOX
ring = np.concatenate([img[y0:y0+4, x0:x1].reshape(-1, 3), img[y1-4:y1, x0:x1].reshape(-1, 3),
                       img[y0:y1, x0:x0+4].reshape(-1, 3), img[y0:y1, x1-4:x1].reshape(-1, 3)])
card = np.median(ring, axis=0).astype(np.uint8)
result[y0:y1, x0:x1] = card
m = ink_mask((1325, 388, 1470, 528))
ys, xs = np.where(m > 0)
info['qr'] = {'box': list(QR_BOX), 'ink': [int(xs.min()+1325), int(ys.min()+388), int(xs.max()+1325), int(ys.max()+388)], 'card_bgr': card.tolist()}

cv2.imwrite(out, result, [cv2.IMWRITE_PNG_COMPRESSION, 9])

# Verify: nothing outside the declared boxes changed
allowed = np.zeros((H, W), bool)
for b in list(BOXES.values()) + [QR_BOX]:
    allowed[b[1]:b[3], b[0]:b[2]] = True
changed = np.any(img != result, axis=2)
outside = int((changed & ~allowed).sum())
info['size'] = [W, H]
info['pixels_changed_outside_boxes'] = outside
info['pixels_changed_inside_boxes'] = int((changed & allowed).sum())
json.dump(info, open(meta, 'w'), indent=1)
print(json.dumps(info, indent=1))
