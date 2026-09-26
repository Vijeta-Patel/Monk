# The monk in each mood

Monk, the mascot: a 17×7 ASCII figure with one mood per state. Draw it with the `ink` token in bold, its shadow in `ink-ghost`, aura in `saffron` and `skill`, sparks in `fault`, relief sparkles in `ok`.

- Body rows (11 cells wide): `    ___    `, `   (- -)   `, `  __) (__  `, ` /  \_/  \ `, `(____|____)`. Only the face changes between moods.
- Faces: calm `- -`, working `o o` (blinks `- -`), startled `O o` / `o O`, happy `^ ^`.

## Animations

Every moving element on this screen. Frames are listed from the first; the static mockup below shows frame 1.

| animation | pieces | interval | frames | first frames |
| --- | --- | --- | --- | --- |
| mascot · calm | 13 | 700 ms | 4 | `(blank)` → `    ___` |
| mascot · work | 2 | 450 ms | 6 | `   (o o)` → `   (- -)` |
| mascot · look | 2 | 450 ms | 4 | `   (o o)` → `   (- -)` |
| mascot · fault | 2 | 420 ms | 9 | `   (O o)` → `   (o O)` → `   (o o)` |
| mascot · hold | 1 | 600 ms | 4 | `   (o o)` → `   (- -)` |

```text

  .                             .                    .                \ | /
        ___     .            ___                  ___                  ___                  ___
 .     (- -)                (o o)                (o o)                (O o)                (o o)
      __) (__    .         __) (__              __) (__              __) (__              __) (__
  .  /  \_/  \            /  \_/  \            /  \_/  \            /  \_/  \            /  \_/  \
    (____|____)  .       (____|____)          (____|____)          (____|____)          (____|____)
    ~~~~~~~~~~~          ~~~~~~~~~~~          ~~~~~~~~~~~          ~~~~~~~~~~~          ~~~~~~~~~~~

  idle · floating      working · thinking   watching output      fault → recovered    needs your ok

```
