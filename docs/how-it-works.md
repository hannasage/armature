# How it works

## The spring

A spring pulls a value toward a target. The pull grows with the distance. Damping slows the value down.

    a = (-k (x - target) - c v) / m

`k` is stiffness, `c` is damping, and `m` is mass. Damping is critical at `c = 2 sqrt(k m)`. At that value the
spring returns as fast as it can without overshooting. Below it, the spring overshoots.

The solver uses semi-implicit Euler. It updates the velocity first, then the position with the new velocity.
It steps in slices of exactly 1/120 s. The leftover time waits in an accumulator for the next frame. The value
shown is the last whole slice advanced by the leftover time, so a frame that holds no whole slice still moves
the picture.

An extreme spring would blow up at 1/120 s. The solver shortens the slice to `1 / max(sqrt(k / m), c / m)` when
that is smaller, down to 1/20000 s. A frame longer than 0.1 s counts as 0.1 s.

The spring rests when `|velocity| < restSpeed` and `|value - target| < restDelta`. It then snaps to the target
and its velocity becomes 0.

### Numbers measured in the tests

A 100 unit travel, stepped at 60 frames per second, with both rest thresholds at 0.01:

| Preset | Overshoot, percent of travel | Time to rest |
|---|---|---|
| `lensX` | 3.8 | 0.90 s |
| `lensWidth` | 19.8 | 1.53 s |
| `press` | 0 | 1.25 s |
| `gentle` | 6.4 | 1.45 s |

Euler is first order. Against the closed-form solution of a critically damped spring, the worst error is
3.8 percent of the travel, at 83 ms. After one second, the `lensWidth` spring stepped at 30, 60, and 144 frames
per second differs from a 240 frames per second run by less than 0.001.

## The glass filter

The filter has two images and a displacement step.

1. **Shape.** The element is a rounded rectangle. A signed distance field says how far each pixel sits inside
   the edge. Its gradient is the outward normal.
2. **Rim.** The glass has a convex rim that is `bevel` pixels wide and `depth` pixels high. Its height is
   `h(t) = (1 - (1 - t)^4)^(1/4)`, with `t` the distance in from the edge divided by `bevel`. This is a squircle
   curve. It is steep at the edge and flat at the top.
3. **Refraction.** A ray falling straight down meets the rim at angle `θ1 = atan(slope)`. Snell's law gives
   `sin θ2 = sin θ1 / n`, with `n = 1.5` for glass. The bend is `θ1 - θ2`. The ray lands `depth * tan(bend)`
   pixels sideways. At the edge this is about `1.118 * depth`.
4. **Map.** The shift points toward the center, so the rim shows content from further in. It is stored in red
   (x) and green (y), where 128 means no shift. The shift is divided by `depth * 1.2` first, so the channels
   stay inside 1 to 255. Alpha is always 255, because the browser premultiplies alpha and would bend the
   channels.
5. **Scale.** `feDisplacementMap` moves a pixel by `scale * (channel - 0.5)`. The largest shift is therefore
   `scale / 2`, and the default `scale` is `2 * 1.2 * depth`. `scale` is the attribute to animate.
6. **Color space.** The filter sets `color-interpolation-filters="sRGB"`. The default, linear RGB, would turn
   128 into something else.
7. **Dispersion.** With dispersion on, three displacement passes run at `scale * (1 + d)`, `scale`, and
   `scale * (1 - d)`. Each is cut down to one color channel, and the three are added back together.
8. **Specular.** A second image, white with alpha, lights the rim where its normal faces the light. It
   draws over the refracted result.

A large element gets a smaller map, at most 16000 pixels by default. The browser stretches it to fit. The map
changes slowly, so the stretch is not visible.

The PNG encoder writes 8-bit RGBA with stored (uncompressed) deflate blocks, so a map is about as large as its
raw pixels.

## Detection

`detectRefraction` reads `navigator.userAgentData.brands` and accepts Chromium, Google Chrome, or Microsoft
Edge. Without `userAgentData` it reads the user agent, accepts `Chrome/` or `Chromium/`, and rejects the iOS
agents (`CriOS`, `FxiOS`, `EdgiOS`), Firefox, and the old Edge engine. It never reads `@supports`.
