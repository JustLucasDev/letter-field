# letter-field

Generative texture with procedural wind and shockwaves on click. It's the background of [my portfolio](https://justlucasdev.github.io).

**Live demo:** https://justlucasdev.github.io/letter-field/

- A dense grid of tiny characters, almost all invisible.
- A noise "wind" blows diagonal gusts; only the letters the gust passes through light up.
- Each letter cycles through characters at its own pace.
- The mouse warms the air along its path.
- A click sends a shockwave that pushes the air, scrambles the letters and glows blue. Every third wave comes out heart-shaped.

Plain JavaScript and Canvas 2D, no dependencies. The frame is written straight into a pixel buffer, and the loop slows down when idle and pauses after a few minutes without interaction.

## Usage

```html
<canvas id="letters-bg" data-mode="blocks"></canvas>
<script src="letters-effect.js"></script>
```

```css
#letters-bg {
  position: fixed;
  inset: 0;
  --letters-ink: #2b7fd8;            /* letter / block color */
  --letters-glow: rgb(26, 173, 255); /* shockwave glow */
}
```

| Attribute | Values | |
| --- | --- | --- |
| `data-mode` | *(empty)* · `blocks` · `hacker` | letters, solid blocks, or blocks with katakana and digits |
| `data-cell` | number (default `6.5`) | cell width in CSS pixels |
| `data-calm-x`, `data-calm-y` | numbers | size of the calmer area behind centered content |

Any element with `data-pause-bg` pauses the animation while it covers most of the screen.
