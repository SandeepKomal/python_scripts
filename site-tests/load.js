// Loads the site's scripts under Node, as the browser would, without a DOM.
"use strict";
const path = require("path");
global.window = globalThis;
for (const f of ["data.js", "quiz-bank.js", "scenarios.js", "playground.js", "xray.js"]) require(path.resolve(__dirname, "../site", f));
module.exports = { Q: window.QUEST, quiz: window.QUEST_QUIZ, sim: window.PYSim, xray: window.PYXray };
