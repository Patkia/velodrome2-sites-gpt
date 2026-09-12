import assert from "node:assert/strict";
import { dashboardMock } from "../data/mock-positions.js";

assert.match(dashboardMock.walletAddress, /^0x[\da-fA-F]+\.\.\.[\da-fA-F]+$/);
assert.ok(dashboardMock.positions.length >= 2, "POC needs at least two positions.");
assert.ok(dashboardMock.positions.some((position) => position.status === "in-range"), "POC needs an in-range position.");
assert.ok(dashboardMock.positions.some((position) => position.status === "out-of-range"), "POC needs an out-of-range position.");
assert.ok(new Set(dashboardMock.positions.map((position) => position.chain)).size >= 2, "POC needs multiple chains.");

for (const position of dashboardMock.positions) {
    assert.equal(position.tokens.length, 2, "Each mock position needs two token amounts.");
    for (const field of ["pair", "currentValue", "initialValue", "profitLoss", "rewards", "lastUpdated"]) {
        assert.ok(position[field], `Position ${position.positionId} must include ${field}.`);
    }
}

console.log("Mock dashboard data: PASS");
