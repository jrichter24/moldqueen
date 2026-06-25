# Third-party notices

moldqueen includes third-party code, retained under its original license.

## MouldKingCrypt — J0EK3R/mkconnect-python

moldqueen re-implements the `MouldKingCrypt` cipher from
[J0EK3R/mkconnect-python](https://github.com/J0EK3R/mkconnect-python) once per
radio core. Each is a clean-room **port/derivative** — re-expressed in our own
module structure (the technique studied, the code written fresh, not copied from
the MK+tech app) and verified byte-exact against the same shared crypt vectors:

- `linux-core/mk4web/mouldking_crypt.py` (and the snapshot in
  `linux-core/reference/mouldking_crypt.py`) — the Python reference,
  cross-checked against the MK+tech app's captured adverts.
- `android-core/app/src/main/java/io/github/jrichter24/moldqueen/MouldKingCrypt.kt`
  — the Kotlin port.
- `esp32-core/components/mouldking_crypt/mouldking_crypt.c` — the C port.

All are used under the upstream MIT license, reproduced in full below:

```
MIT License

Copyright (c) 2024 J0EK3R

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
