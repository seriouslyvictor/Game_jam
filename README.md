# Brick Borough

A cozy LEGO-inspired city builder in Three.js. Spend a budget of bricks laying out a
borough; every piece is scored against its neighbours, and the run ends when you run out
of bricks or room. Pieces stack, so the borough grows upward as well as outward.

## Run locally

```bash
npm install
npm run dev
```

## Playing

| | |
|---|---|
| **Click** | place the selected piece where the ghost shows |
| **R** | rotate the next placement |
| **Ctrl/Cmd + Z** | undo the last placement or bulldoze |
| **Drag** | pan · **right-drag** orbit · **scroll** zoom |
| **♢ tool** | bulldoze — refunds the piece's bricks |
| **⟲ tool** | start a new city (clears the save) |

A translucent ghost previews where the piece will land, green when the spot is legal and
red when it isn't. Hover over something already built and the ghost rises to sit on top
of it — that is how you stack. A piece needs its whole footprint resting at one height,
so it can't hang off an edge or float, and a piece with something stacked on it can't be
bulldozed until you clear what's above. Roads stay clear.

Scoring rewards a borough that hangs together: homes like greenery, shops, a fire station
and a view of a landmark, and dislike being overshadowed by towers; towers like clustering;
shops like homes and a town square; a landmark wants lots of different neighbours. The
city saves to `localStorage` as you build.

## Pieces

| | |
|---|---|
| **City** | Cozy Home, Townhouse, Sunny Tower, Corner Shop, Bakery, Fire Station, Clock Tower |
| **Nature** | Round Tree, Pine Tree, Tiny Park, Flower Bed, Duck Pond |
| **Decor** | Fountain, Street Lamp |
| **Basic** | 2 × 2 / 2 × 4 / 4 × 4 Brick, 4 × 4 Plate, 2 × 6 Arch, Roof Slope |

Basic parts, homes and townhouses take the colour picked under the menu. Roofs, trees and
decor are caps: nothing stacks on top of them. To add a piece, write its build function
and give it an entry in `PIECES` in `src/main.js` (name, category, cost, footprint, height
and the `kind` it scores as); the build menu and its thumbnail are generated from that.

## Layout

- `src/main.js` — scene, piece models and the `PIECES` table, the column grid, build menu, placement and input
- `src/economy.js` — adjacency scoring by piece `kind`, population, happiness, levels
- `src/hud.js` — HUD and end-of-run overlay
- `src/persistence.js` — versioned `localStorage` save/load
- `src/history.js` — undo stack

Bricks are built procedurally and share geometry and materials; each piece batches its
studs into one `InstancedMesh` per colour, so a house is a handful of objects rather than
a couple of hundred.
