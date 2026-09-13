import assert from "node:assert/strict";
import { filterPositions, isPositionsResponse, POSITIONS_FIXTURE } from "../lib/shared/positions-schema.ts";

assert.equal(POSITIONS_FIXTURE.schemaVersion, 1);
assert.equal(POSITIONS_FIXTURE.status, "ok");
assert.equal(POSITIONS_FIXTURE.positionsChecked, 3);
assert.deepEqual(POSITIONS_FIXTURE.positions.map((position) => position.chain), ["Optimism", "Celo", "Soneium"]);
assert.equal(POSITIONS_FIXTURE.positions.filter((position) => position.inRange).length, 2);
assert.equal(POSITIONS_FIXTURE.positions.filter((position) => !position.inRange).length, 1);
assert.equal(filterPositions(POSITIONS_FIXTURE.positions, "Celo")[0]?.positionId, 66480);
assert.equal(filterPositions(POSITIONS_FIXTURE.positions, "all").length, 3);
assert.equal(filterPositions(POSITIONS_FIXTURE.positions, "Unknown").length, 0);
assert.equal(isPositionsResponse(POSITIONS_FIXTURE), true);
assert.equal(isPositionsResponse({ schemaVersion: 1, positions: [] }), false);

console.log("positions.test: PASS");
