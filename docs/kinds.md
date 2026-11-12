# Kinds

A kind says what a value is made of. `createValue` (a spring) and `createTweenValue` (a tween) both take a kind. A spring and a tween move any kind, so you can animate a color, a path, or a 3D transform the same way you animate a number.

A kind has these parts:

- `parse(input)` turns an input into a value, or throws a `TypeError` that says what the kind needs.
- `serialize(value)` writes the value as text.
- `interpolate(from, to, progress)` blends two values.
- `distance(a, b)` measures how far apart two values are.
- `toArray(value)` and `fromArray(parts)` turn a value into numbers and back. A spring moves these numbers one by one.
- `align(from, to)` is optional. It picks, among the number lists that name one target, the one nearest to `from`.

Every kind has the same rest rule. A value is at rest when it is close enough to its target and slow enough. The spring settings `restDelta` and `restSpeed` set "close enough" and "slow enough", and both default to 0.01. The number lists differ in scale for each kind, so set `restDelta` for the kind you use.

## Color

```ts
import { colorKind, createValue } from "@hannasage/armature/values";

const fill = createValue(scheduler, colorKind, "#336699", {
  spring: { stiffness: 170, damping: 26 },
  onChange: (css) => (element.style.backgroundColor = css),
});
fill.to("hsl(10 80% 50%)");
```

A color value is a CSS color string. `colorKind` reads:

- hex: `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`;
- `rgb()` and `rgba()`, with commas or spaces, numbers or percents, and an alpha;
- `hsl()` and `hsla()`, with an optional `deg` unit;
- the 148 CSS color names, and `transparent`.

It writes `#rrggbb`, or `#rrggbbaa` when the color is not opaque. `parse` gives that text, so `parse("rgb(51 102 153)")` is `"#336699"`.

### Which space, and why

The kind blends in OKLab. OKLab is a color space made to match how the eye sees color. An equal step in its numbers looks like an equal step.

The reasons:

- Hue wraps the short way by itself. OKLab has no hue number. It has a lightness and two color axes. A straight line between two colors in that space turns by the short arc, so hsl(350) to hsl(10) goes through red and not through cyan. A grey has no hue to jump.
- A spring and a tween give the same result. A spring moves each number alone, so it needs a space where one number is not an angle. A space with a hue angle (OKLCH) would send a spring the long way round the wheel, and the kind would need a special case for the spring.
- Blends keep their lightness. A blend in sRGB goes dark in the middle. Black to white in OKLab passes through `#636363`, where sRGB passes through `#808080`.

The components are the lightness and the two axes, each multiplied by the alpha, then the alpha. This is how CSS blends, so a fade from `transparent` to red stays red and only the alpha changes. A blend can leave the sRGB range. The kind clamps each channel when it writes the color.

## Path

```ts
import { createTweenValue } from "@hannasage/armature/curves";
import { pathKind } from "@hannasage/armature/values";

const kind = pathKind("M 0 0 L 10 0 L 5 10 Z");
const shape = createTweenValue(scheduler, kind, "M 0 0 L 10 0 L 5 10 Z", {
  duration: 0.4,
  onChange: (d) => path.setAttribute("d", d),
});
shape.to("M 0 4 L 12 0 L 5 14 Z");
```

`pathKind(template)` makes a kind for one structure: the commands of the template, in order. Two paths with the same commands in the same order blend number by number.

A path with another structure is rejected with a `TypeError`:

```
The path has a different structure than the template. Expected "M L L Z" and got "M L Z".
```

What counts as structure:

- The command letters, in order. A relative command (`l`) and an absolute command (`L`) are different commands.
- The two flags of an arc command, because a flag cannot be blended.
- `z` and `Z` are the same command.

Armature does not resample. It cannot blend a path of three segments into a path of four, and it does not guess. That is separate work.

The kind reads all path data forms: implicit repeats (`M 0 0 10 10`), compact numbers (`M0-1.5.5`), and arc flags with no separator. It writes one plain form: a letter, then its numbers, with a space between.

## 3D transform

```ts
import { createValue, transform3dKind, transform3dStyles } from "@hannasage/armature/values";

const card = createValue(scheduler, transform3dKind, transform3dKind.parse({}), {
  spring: { stiffness: 170, damping: 26 },
  onChange(value) {
    const { element, parent } = transform3dStyles(value);
    Object.assign(card.style, element);
    parentElement.style.perspective = parent.perspective;
  },
});
card.to(transform3dKind.parse({ rotate: { axis: [0, 1, 0], angle: 35 }, perspective: 800 }));
```

A value has four parts, and each is optional:

- `translate`: `[x, y, z]` in pixels.
- `rotate`: `{ axis: [x, y, z], angle }`, with the angle in degrees.
- `scale`: a number, or `[x, y, z]`.
- `perspective`: pixels from the viewer to the screen. `0` means none.

Any other key is rejected. A `transform` string, a matrix, and a skew are not values of this kind.

### The short way

A rotation is stored as a quaternion. A quaternion and its negative are the same rotation. The kind picks the one nearest to where the value is (`align`), and a tween blends along the great arc between them. So a turn from 10 degrees to 350 degrees goes 20 degrees backward, and not 340 degrees forward. There is no gimbal flip.
A rotation takes the shortest arc, so a turn of more than 180 degrees is written as the short turn the other way. To spin more than half a turn, move through a middle value.

### No `transform`

The kind writes only the individual properties `translate`, `rotate`, and `scale`, in this form:

```
translate: 10px 20px 30px; rotate: 0 0 1 45deg; scale: 1 1 1
```

It never writes `transform`, `matrix3d`, or a transform function. CSS applies the three individual properties in a fixed order (translate, rotate, scale), which is the order of the decomposition, so every value of this kind has an exact form without `transform`.

`transform3dStyles(value)` splits the output into `{ element, parent }`. The perspective is a property of the parent, so it goes on the parent of the element, as `perspective: 800px` or `none`. The vanishing point is then the center of the parent (set `perspective-origin` on the parent to move it). A per-element `perspective()` inside `transform` would put it at the element, and the kind does not write that.

The perspective blends as its inverse (1000 divided by the distance). A change from none to 500px so does not pass through a tiny distance, which would warp the element.

## Springs and the number lists

A spring moves the number list of a value. The lists are:

- number: 1 number.
- vector: its length.
- color: 4 numbers (OKLab lightness and two axes, each times the alpha, then the alpha). The lightness runs from 0 to 1.
- path: every number of the path except arc flags.
- 3D transform: 11 numbers. Translation (3), a quaternion (4), scale (3), and the inverse perspective (1).

`getState().velocity` has the shape of the kind. For a color, a path, or a 3D transform it is the velocity numbers written as a value of that kind, and it does not mean much to read it that way. Use it for a number or a vector.
