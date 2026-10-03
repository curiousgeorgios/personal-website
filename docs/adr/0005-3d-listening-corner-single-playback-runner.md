# ADR-0005: Build the listening corner as a 3D walnut console with a single playback runner

- Status: Accepted
- Date: 2026-10-03
- Authors: George Vlachos

## Context

The logbook (ADR-0001) had a small "on the turntable" player. George wanted "an actual 3d turn table animation with record sleeves" where records travel from their sleeves to the turntable and back. He chose to give it its own row in the notebook rather than growing it out of a small cell or pinning it to a corner of the screen. After a first Rams-style version he asked for "a more traditional Scandi" look ("walnut", "a little table", "more hygge"), then for a candle and a sheepskin rug, keeping the stoneware jug. The first prototype also had a bug: quick clicks could start two record journeys at once, leaving a record attached to the spinning platter off-centre and flying to odd places.

## Decision

The listening corner is its own row in the logbook, rendered with plain Three.js:

- The scene is a low walnut record console with tapered, splayed legs on a sheepskin, a walnut-framed turntable with a brushed deck and a wool-felt mat, a pillar candle in a stoneware dish on top and the rest of the collection with the stoneware jug on the shelf below. Light follows the time in Sydney.
- Three.js and the scene load only after the page has loaded and the visitor is within 200px of the row, never in the first download. A still image of the scene shows until then and whenever WebGL is unavailable. Nothing plays until the visitor asks and the scene renders frames only while something is moving.
- Playback has one owner. Clicks only record which record the visitor wants (`want`), and a single runner moves the deck from what is on the platter to what is wanted, one step at a time (`while (current !== want)`). Nothing else animates a record, and every journey starts by re-parenting the record into world space.
- The runner and audio live in a small module with no Three.js dependency, and the scene subscribes to it. An HTML track list sits under the scene and drives the same runner, so keyboard, screen reader and no-WebGL visitors can play every record, and playback keeps working when the scene is off screen or fails to load. Audio is unlocked inside the visitor's press (WebKit only allows playback that starts in a user gesture) and faded with a Web Audio gain node.

## Consequences

Rapid or contradictory clicks collapse to the visitor's latest intent instead of overlapping, and an eight-case rapid-click suite (play, switch, mash, change of mind mid-flight, browse while playing) passes against it. New behaviour that moves a record must go through the runner rather than starting its own animation. The scene adds roughly the weight of Three.js plus procedurally drawn textures, paid only by visitors who reach the row. On phones the canvas goes full width and frames the console top so the cover stays at least 90px tall. The candle flickers only while a record plays, because flickering at rest would mean rendering continuously.

## Alternatives considered

- **Grow the player out of the small "on the turntable" cell into a tray:** keeps the page calmer, but hides the moment George wanted to be seen.
- **A small turntable fixed in a corner of the screen:** music follows the reader, but the object is always on screen.
- **The first Rams-style off-white turntable on bare paper:** replaced by the walnut console at George's request.
- **Letting each click start its own animation sequence:** the original approach, which caused overlapping journeys and off-centre records.
