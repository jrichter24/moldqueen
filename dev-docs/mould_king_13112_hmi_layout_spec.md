# Mould King 13112 Excavator HMI Layout Specification

Image reference: latest landscape UI background  
Image size: **1672 × 941 px**  
Coordinate system: **top-left origin = (0,0)**

Coordinates below are approximate and intended for overlay planning.  
Use the percentage values for responsive scaling.

---

## Main Control Zones

| Area | Purpose | Position px `(x,y,w,h)` | Position % `(x,y,w,h)` |
|---|---|---:|---:|
| Full UI frame | Whole dashboard | `(15, 15, 1640, 910)` | `(0.9, 1.6, 98.1, 96.7)` |
| Top status bar | App/status area | `(24, 25, 1625, 70)` | `(1.4, 2.7, 97.2, 7.4)` |
| Left track panel | Left chain drive | `(38, 113, 270, 790)` | `(2.3, 12.0, 16.1, 84.0)` |
| Right track panel | Right chain drive | `(1363, 113, 270, 790)` | `(81.5, 12.0, 16.1, 84.0)` |
| Arm lift panel | Arm up/down | `(342, 116, 318, 386)` | `(20.5, 12.3, 19.0, 41.0)` |
| Front arm panel | Extend/retract | `(681, 116, 317, 386)` | `(40.7, 12.3, 19.0, 41.0)` |
| Rotation panel | Cabin left/right | `(1014, 116, 316, 386)` | `(60.6, 12.3, 18.9, 41.0)` |
| Bucket open panel | Shovel open | `(342, 520, 318, 388)` | `(20.5, 55.3, 19.0, 41.2)` |
| Bucket close panel | Shovel close | `(681, 520, 317, 388)` | `(40.7, 55.3, 19.0, 41.2)` |
| Status/info panel | Telemetry textboxes | `(1014, 520, 316, 388)` | `(60.6, 55.3, 18.9, 41.2)` |

---

## Textbox Placeholders

These are the empty rounded rectangles where language-dependent labels can be added later.

| Textbox | Suggested text | Position px `(x,y,w,h)` | Position % |
|---|---|---:|---:|
| Top center textbox | Title / profile / connection | `(747, 33, 198, 49)` | `(44.7, 3.5, 11.8, 5.2)` |
| Top small blue textbox | Mode/status | `(1093, 37, 91, 44)` | `(65.4, 3.9, 5.4, 4.7)` |
| Top battery value textbox | Battery voltage/percent | `(1347, 41, 106, 36)` | `(80.6, 4.4, 6.3, 3.8)` |
| Left track title | Left track | `(78, 128, 192, 38)` | `(4.7, 13.6, 11.5, 4.0)` |
| Left track upper label | Forward | `(118, 342, 108, 27)` | `(7.1, 36.3, 6.5, 2.9)` |
| Left track lower label | Backward | `(116, 715, 113, 26)` | `(6.9, 76.0, 6.8, 2.8)` |
| Right track title | Right track | `(1404, 128, 190, 38)` | `(84.0, 13.6, 11.4, 4.0)` |
| Right track upper label | Forward | `(1443, 342, 108, 27)` | `(86.3, 36.3, 6.5, 2.9)` |
| Right track lower label | Backward | `(1441, 715, 114, 26)` | `(86.2, 76.0, 6.8, 2.8)` |
| Arm lift title | Arm up/down | `(409, 128, 186, 36)` | `(24.5, 13.6, 11.1, 3.8)` |
| Front arm title | Front arm in/out | `(738, 128, 194, 36)` | `(44.1, 13.6, 11.6, 3.8)` |
| Rotation title | Rotation | `(1083, 128, 177, 36)` | `(64.8, 13.6, 10.6, 3.8)` |
| Bucket open title | Bucket open | `(408, 550, 187, 36)` | `(24.4, 58.4, 11.2, 3.8)` |
| Bucket close title | Bucket close | `(739, 550, 193, 36)` | `(44.2, 58.4, 11.5, 3.8)` |
| Info row 1 textbox | Runtime / hours | `(1124, 548, 162, 41)` | `(67.2, 58.2, 9.7, 4.4)` |
| Info row 2 textbox | Motor/temp/status | `(1124, 642, 162, 41)` | `(67.2, 68.2, 9.7, 4.4)` |
| Info row 3 textbox | Temperature/status | `(1124, 736, 162, 41)` | `(67.2, 78.2, 9.7, 4.4)` |
| Info row 4 textbox | Battery/status | `(1124, 832, 162, 41)` | `(67.2, 88.4, 9.7, 4.4)` |

---

## Interactive Button / Control Hotspots

### Left Track

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Left track forward button | Left chain forward | `(64, 180, 221, 138)` |
| Left track vertical slider area | Left chain speed / direction | `(145, 377, 54, 319)` |
| Left track slider knob | Current value visual | `(137, 493, 75, 75)` |
| Left track backward button | Left chain backward | `(73, 759, 199, 121)` |

### Right Track

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Right track forward button | Right chain forward | `(1388, 180, 221, 138)` |
| Right track vertical slider area | Right chain speed / direction | `(1471, 377, 54, 319)` |
| Right track slider knob | Current value visual | `(1461, 493, 75, 75)` |
| Right track backward button | Right chain backward | `(1398, 759, 198, 121)` |

### Arm Lift / Lowering

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Arm lift slider | Arm up/down analog control | `(506, 177, 55, 288)` |
| Arm lift slider knob | Current arm value | `(491, 284, 77, 75)` |
| Arm lift up arrow indicator | Visual direction hint | around `(577, 197, 30, 35)` |
| Arm lift down arrow indicator | Visual direction hint | around `(577, 407, 30, 35)` |

### Front Arm Extend / Retract

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Front arm slider | Front arm closer/further | `(838, 174, 55, 291)` |
| Front arm slider knob | Current value | `(821, 284, 78, 76)` |
| Front arm upper arrow indicator | Extend/retract hint | around `(914, 215, 32, 25)` |
| Front arm lower arrow indicator | Extend/retract hint | around `(914, 416, 32, 25)` |

### Cabin Rotation

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Rotation left button | Rotate cabin left | `(1038, 346, 121, 115)` |
| Rotation right button | Rotate cabin right | `(1181, 346, 119, 115)` |
| Rotation status/progress bar | Optional visual feedback | `(1039, 477, 262, 21)` |

### Bucket / Shovel

| Control | Function | Position px `(x,y,w,h)` |
|---|---|---:|
| Bucket open large button | Open shovel | `(379, 735, 252, 134)` |
| Bucket close large button | Close shovel | `(708, 735, 252, 134)` |

---

## Suggested Overlay Logic

Use the **left and right track panels as thumb zones** for mobile landscape.  
The two track controls are placed at the far left and far right for two-thumb driving.

Use the **middle-top panels** for arm functions:

- Left-middle: arm up/down.
- Center-middle: front arm in/out.
- Right-middle: rotation left/right.

Use the **bottom-middle panels** for shovel open/close.

For language switching, place all real text into the empty textbox rectangles and keep the icons as fixed visual hints.

---

## Recommended Function Mapping

| Motor / Function | UI Area | Input Type |
|---|---|---|
| Left track | Far left panel | Vertical forward/backward control |
| Right track | Far right panel | Vertical forward/backward control |
| Arm up/down | Upper left-middle panel | Vertical slider |
| Front arm in/out | Upper center panel | Vertical slider |
| Cabin rotation | Upper right-middle panel | Left/right buttons |
| Bucket open/close | Lower middle panels | Two large buttons |
