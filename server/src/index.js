import express from "express";
import axios from "axios";

const app = express();

app.get("/", (req, res) => {
  return res.status(200).json({ message: "Server Running Fine" });
});

app.get("/pgn", async (req, res) => {
  try {
    const { username, month, year } = req.query;

    if (!username || !month || !year) {
      return res
        .status(400)
        .json({ message: "username, month, and year are required" });
    }

    const mm = String(month).padStart(2, "0");
    const url = `https://api.chess.com/pub/player/${username}/games/${year}/${mm}/pgn`;

    const response = await axios.get(url, { responseType: "text" });
    const pgnString = response.data;

    // Split PGN into individual games
    const games = pgnString
      .split(/\n(?=\[Event\s+")|(?=^\[Event\s+")/gm)
      .filter((g) => g.trim().startsWith('[Event "'));

    const formattedGames = games.map((rawPGN) => {
      // Normalize line breaks
      const normalized = rawPGN.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n");

      // Separate header and moves
      const splitIdx = normalized.indexOf("\n\n");
      const headerPart =
        splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
      const movesPart = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : "";

      // Parse tags
      const tagRe = /\[(\w+)\s+"([^"]*)"\]/g;
      const tags = {};
      let m;
      while ((m = tagRe.exec(headerPart)) !== null) {
        tags[m[1]] = m[2];
      }

      // Extract fields with your exact preferences
      const event = tags.Event || "Live Chess";
      const site = tags.Site || "Chess.com";
      const date = tags.Date || tags.UTCDate || "";
      const round = "?";
      const white = tags.White || "";
      const black = tags.Black || "";
      const result = tags.Result || "*";
      const timeControl = tags.TimeControl || "";
      const whiteElo = tags.WhiteElo || "";
      const blackElo = tags.BlackElo || "";
      const termination = tags.Termination || "";
      const eco = tags.ECO || "";
      const endTimeRaw = tags.EndTime || tags.UTCTime || "";
      const linkRaw = tags.Link || "";

      // Build Link with ?move=0 and extract gameID
      let link = linkRaw;
      let gameID;
      const linkMatch = linkRaw.match(
        /^https:\/\/www\.chess\.com\/game\/live\/(\d+)(?:\?[^"]*)?$/
      );
      if (linkMatch) {
        gameID = linkMatch[1];
        if (!/\?/.test(linkRaw)) {
          link = `${linkRaw}?move=0`;
        } else if (!/[?&]move=0(?:&|$)/.test(linkRaw)) {
          link = `${linkRaw}&move=0`;
        }
      } else {
        const idFallback =
          (headerPart.match(/https:\/\/www\.chess\.com\/game\/live\/(\d+)/) ||
            [])[1] || Math.random().toString(36).slice(2, 10);
        gameID = idFallback;
        link = `https://www.chess.com/game/live/${idFallback}?move=0`;
      }

      // EndTime with " GMT+0000" if no GMT offset present
      let endTime = endTimeRaw;
      if (endTime && !/\bGMT[+-]\d{4}\b/.test(endTime)) {
        endTime = `${endTime} GMT+0000`;
      }

      // Clean moves: remove clocks, comments, NAGs, extra whitespace
      let moves = movesPart
        // remove chess.com bracketed annotations like {[%clk ...]}, {[%emt ...]}, {[%eval ...]}
        .replace(/\{\[%[^}]*\]\}/g, "")
        // remove any {% ... } leftovers
        .replace(/\{%\s*[^}]*\}/g, "")
        // remove normal comments in braces { ... }
        .replace(/\{[^}]*\}/g, "")
        // remove NAGs like $1, $3
        .replace(/\$\d+/g, "")
        // collapse whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n+/g, " ")
        .trim();

      // Ensure result appears exactly once at the end
      if (result && result !== "*") {
        // strip any existing trailing result
        moves = moves.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/i, "").trim();
        moves = `${moves} ${result}`.trim();
      }

      // Word-wrap moves to 80 columns for stable spacing/margins
      moves = wrapToWidth(moves, 80);

      // Rebuild header exactly in your order
      const headerLines = [
        `[Event "${event}"]`,
        `[Site "${site}"]`,
        `[Date "${date}"]`,
        `[Round "${round}"]`,
        `[White "${white}"]`,
        `[Black "${black}"]`,
        `[Result "${result}"]`,
        `[TimeControl "${timeControl}"]`,
        `[WhiteElo "${whiteElo}"]`,
        `[BlackElo "${blackElo}"]`,
        `[Termination "${termination}"]`,
        `[ECO "${eco}"]`,
      ];
      if (endTime) headerLines.push(`[EndTime "${endTime}"]`);
      headerLines.push(`[Link "${link}"]`);

      const formattedPGN = `${headerLines.join("\n")}\n\n${moves}`;

      return {
        gameID,
        PGN: formattedPGN,
      };
    });

    return res.status(200).json(formattedGames);
  } catch (error) {
    console.error(
      "Error fetching PGN:",
      error && error.message ? error.message : error
    );
    const status =
      error && error.response && Number.isInteger(error.response.status)
        ? error.response.status
        : 500;
    return res.status(status).json({ message: "Error fetching PGN data" });
  }
});

/**
 * Wrap a text to a given width without breaking tokens.
 * Keeps single spaces between tokens, inserts newlines where needed.
 */
function wrapToWidth(text, width) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const tok of tokens) {
    if (line.length === 0) {
      line = tok;
    } else if (line.length + 1 + tok.length <= width) {
      line += " " + tok;
    } else {
      lines.push(line);
      line = tok;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

app.listen(3100, () => {
  console.log("✅ Server started at http://localhost:3100");
});
