# SeaBoost

SeaBoost extends Seanime's built-in volume control beyond the normal 100% limit without adding a second player control.

## Features

- Uses Seanime's **existing speaker button and volume slider**.
- Configurable maximum volume: **150%, 200%, 250%, 300%, 400%, or 500%**.
- **300%** is the default.
- Normal 0-100% volume behavior is preserved.
- Above 100%, SeaBoost uses the Web Audio API for additional gain.
- Dynamic compression is applied while boosted to reduce harsh clipping.
- Adds visual percentage checkpoints and a live percentage readout to the native slider.
- Up/Down arrow keys adjust SeaBoost in 10% steps.
- Remembers the selected volume across previous/next episode changes and app refreshes.
- Automatically reattaches when Seanime rerenders the player.

## Install

Add this manifest URL to Seanime:

`https://raw.githubusercontent.com/DefnoJae/Volume-booster/refs/heads/main/Manifest.json`

## Configuration

Open SeaBoost's extension settings and choose **Maximum volume**. The selected value becomes the upper limit of Seanime's native volume slider.

For example, with **Maximum volume = 300%**, the native slider represents 0-300% instead of 0-100%.

## Usage

Hover Seanime's normal speaker icon and use its volume slider as usual. The custom thumb and checkpoint dots show the extended range, and the exact percentage appears while you hover or use the keyboard.

- **0-100%** = normal Seanime volume
- **150%** = 1.5x gain
- **200%** = 2x gain
- **300%** = 3x gain
- **500%** = 5x gain

Higher boost levels can distort already-loud sources. Use only as much boost as the source needs.

## Compatibility

SeaBoost targets Seanime's Video Core volume controls and built-in HTML video player. If SeaBoost is updated while a video is already playing, restart playback before testing the new version so the media-audio graph can be rebuilt cleanly.
