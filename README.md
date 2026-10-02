# SeaBoost

SeaBoost is a Seanime plugin that adds a volume booster directly to Seanime's built-in web media player.

## Features

- Embedded beside Seanime's native volume control.
- Adjustable boost from **100% to 300%**.
- Quick presets for 100%, 150%, 200%, 250%, and 300%.
- Remembers the last selected boost level.
- Uses the browser Web Audio API for real gain above the normal 100% HTML video limit.
- Includes dynamic compression at boosted levels to reduce harsh clipping.
- Automatically reattaches when Seanime rerenders the player controls.

## Install

Add this manifest URL to Seanime:

`https://raw.githubusercontent.com/DefnoJae/Volume-booster/refs/heads/main/Manifest.json`

Then start playback in Seanime's built-in player. A **SeaBoost percentage control** with a lightning icon appears directly after the normal volume control.

## Usage

Click the SeaBoost percentage in the player controls and choose a preset or drag the slider.

- **100%** = normal volume
- **150%** = 1.5x gain
- **200%** = 2x gain
- **250%** = 2.5x gain
- **300%** = 3x gain

For the cleanest sound, raise Seanime's normal volume first, then use SeaBoost only when the source is still too quiet.

## Compatibility

SeaBoost targets Seanime's current Video Core markup, including:

- `video[data-vc-element="video"]`
- `[data-vc-element="control-volume"]`

The video element in Seanime is configured with `crossOrigin="anonymous"`, which allows the Web Audio gain chain to work with compatible streams.

## Notes

Very quiet sources can benefit significantly from boosting, but already-loud or heavily compressed audio can distort at high gain. SeaBoost uses a compressor while boosted, but it cannot restore detail that is not present in the original audio.

If SeaBoost is updated while a video is already playing, restart that playback before testing the new version so the browser can rebuild the media-audio graph cleanly.
