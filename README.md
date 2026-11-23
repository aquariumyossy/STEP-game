# STEP — walk to the beat

**Play it now:** <https://step.aquariumyossy.workers.dev/>
(that hosted build embeds the Mixamo-based characters; the repo alone runs
on Morph, see asset notes below.)

A browser rhythm-walk game: a character walks forward on a beat-locked 100 BPM
grid through a dawn-to-morning promenade (decayed suburb → farmland → small
town → city → station plaza). Keys / touch pads A·S·D·F trigger per-character
dance steps, W returns to walking. No goal — just steps, scenery, one song.

## Run locally

```
python3 server.py        # serves at http://localhost:8765/
```

Dev overlay (HUD, minimap, warp): add `?dev=1`.

## Credits & asset notes

- Made by Shuhei Yoshida.
- Engine: three.js (MIT, bundled under `vendor/`).
- 3D props (buildings, nature, cars, farm buildings, trains, RobotExpressive):
  Quaternius, CC0.
- Photo textures (asphalt, sand): Poly Haven, CC0.
- Character meshes (Timmy / Claire / Aj) and the dance-step data
  (`.stpc` containers) are derivatives of Adobe Mixamo content, and the
  UAL animation base likewise has no redistributable license here.
  Following Mixamo's embed-only licensing, ALL of these files are
  intentionally excluded from this repository — they ship only with the
  hosted game build. Opened as-is, this repo still plays end to end: with
  no Mixamo files present the game starts on Morph (Quaternius
  RobotExpressive, CC0) and the Timmy / Claire / Aj buttons stay greyed
  out. See `ASSETS-NOT-IN-REPO.md` for the exact file list.
- Music `audio/step-sideA.mp3`: generated locally with YuE2 by M-A-P
  (lyrics and production by the author).
- On-screen credits and the street banners along the road credit the
  tools used along the way: Qwen, Strata, Linger, ISTA-DASLab, Mixamo,
  Quaternius, Poly Haven, three.js.

## License

STEP (code, world design, music, lyrics) © Shuhei Yoshida, licensed under
**CC BY-NC 4.0** — free to use, modify and share non-commercially with
attribution; commercial use requires my written permission.

STEP's own CC BY-NC 4.0 license covers only what I created (code, world
design, music, lyrics). Every third-party asset and library keeps its own
original license and is not covered by the NC restriction — see
`THIRD-PARTY-NOTICES.md` for the item-by-item list. Mixamo-derived files
are excluded from this repo entirely (see `ASSETS-NOT-IN-REPO.md`).

## Repo scope

Only files fetched at runtime are included: entry HTML/JS, vendor three.js,
the used prop GLBs, textures, and the song. Build/bake/dev tooling, source
FBX packs, archives, superseded concept art and unused asset variants were
deliberately excluded for license and size reasons.
